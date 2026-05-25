// War poll — runs every 10 min via pg_cron.
// Per (guild, clan) in war_track_config:
//   - Fetch current war via coc-api proxy ({action:"current_war", tag})
//   - Detect new war -> verify FWA -> post Reps approval embed
//   - During battle day -> post war-started msg + reminders, log attacks
//   - At war end -> post final result embed + .txt log + clear
import { corsHeaders } from "../_shared/cors.ts";
import { adminClient } from "../_shared/leaderboard.ts";
import { postCoc, normalizeTag } from "../_shared/coc.ts";
import { createMessage, editMessage, createMessageWithFile } from "../_shared/discord.ts";
import {
  CurrentWar, parseCocTime, isFwaMatch, buildRepsPayload, buildReminderPayload,
  evaluateRules, buildResultEmbeds, loadClanRules,
} from "../_shared/war.ts";


async function fetchCurrentWar(tag: string): Promise<CurrentWar | null> {
  try {
    return await postCoc<CurrentWar>({ action: "current_war", tag: normalizeTag(tag) });
  } catch (e) {
    console.error("fetchCurrentWar failed", tag, e);
    return null;
  }
}

async function processClan(guildId: string, clanTag: string, cfg: any) {
  const sb = adminClient();
  const cw = await fetchCurrentWar(clanTag);
  if (!cw || cw.state === "notInWar" || !cw.clan || !cw.opponent) return;

  const startTime = parseCocTime(cw.startTime);
  const endTime = parseCocTime(cw.endTime);
  if (!startTime || !endTime) return;

  // Look up existing war row
  const { data: existing } = await sb.from("wars")
    .select("*")
    .eq("clan_tag", clanTag)
    .eq("opponent_tag", cw.opponent.tag)
    .eq("start_time", startTime.toISOString())
    .maybeSingle();

  let war = existing;

  // Create new war row if needed (only when in preparation or inWar)
  if (!war) {
    const matchType = await isFwaMatch(clanTag, cw.opponent.tag) ? "FWA" : "Regular";
    const { data: created } = await sb.from("wars").insert({
      guild_id: guildId,
      clan_tag: clanTag,
      clan_name: cw.clan.name,
      clan_badge_url: cw.clan.badgeUrls?.medium ?? null,
      opponent_tag: cw.opponent.tag,
      opponent_name: cw.opponent.name,
      opponent_badge_url: cw.opponent.badgeUrls?.medium ?? null,
      team_size: cw.teamSize ?? null,
      start_time: startTime.toISOString(),
      end_time: endTime.toISOString(),
      state: cw.state,
      match_type: matchType,
      raw_roster: { clan: cw.clan.members ?? [], opponent: cw.opponent.members ?? [] },
    }).select("*").single();
    war = created;
  }

  if (!war) return;

  // Post Reps embed if not yet posted and we have a rep channel
  if (!war.rep_message_id && cfg.rep_channel_id) {
    try {
      const payload = await buildRepsPayload({ warId: war.id, war: cw, matchType: war.match_type ?? "Unknown" });
      const msgId = await createMessage(cfg.rep_channel_id, payload);
      if (msgId) {
        await sb.from("wars").update({ rep_message_id: msgId, updated_at: new Date().toISOString() }).eq("id", war.id);
        war.rep_message_id = msgId;
      }
    } catch (e) { console.error("rep post failed", war.id, e); }
  }

  // Update state if changed
  if (war.state !== cw.state) {
    await sb.from("wars").update({ state: cw.state, updated_at: new Date().toISOString() }).eq("id", war.id);
    war.state = cw.state;
  }

  // ---- Battle day actions ----
  if (cw.state === "inWar") {
    const now = new Date();

    // war-started msg
    if (!war.war_started_msg_sent && cfg.log_channel_id && now >= startTime) {
      try {
        const payloads = await buildReminderPayload({ reminderLabel: "War Day Started", emoji: "🚨", war, current: cw, slot: "war_started" });
        for (const p of payloads) await createMessage(cfg.log_channel_id, p);
        await sb.from("wars").update({ war_started_msg_sent: true, updated_at: new Date().toISOString() }).eq("id", war.id);
        war.war_started_msg_sent = true;
      } catch (e) { console.error("war-started post failed", war.id, e); }
    }

    // Reminders
    if (cfg.log_channel_id) {
      const { data: rems } = await sb.from("war_reminders")
        .select("*").eq("guild_id", guildId).eq("clan_tag", clanTag).eq("active", true);
      for (const r of (rems ?? []) as any[]) {
        const fired: number[] = (war.fired_reminders ?? []) as number[];
        if (fired.includes(r.id)) continue;
        const fireAt = r.anchor === "before_end"
          ? new Date(endTime.getTime() - r.minutes * 60_000)
          : new Date(startTime.getTime() + r.minutes * 60_000);
        if (now < fireAt) continue;
        try {
          const label = r.minutes >= 60 && r.minutes % 60 === 0
            ? `${r.minutes / 60}h ${r.anchor === "before_end" ? "before war ends" : "into battle day"}`
            : `${r.minutes}m ${r.anchor === "before_end" ? "before war ends" : "into battle day"}`;
          const payloads = await buildReminderPayload({ reminderLabel: `${label} reminder`, emoji: "⏰", war, current: cw, slot: "war_reminder", minutes: r.minutes });
          for (const p of payloads) await createMessage(cfg.log_channel_id, p);
          fired.push(r.id);
          await sb.from("wars").update({ fired_reminders: fired, updated_at: new Date().toISOString() }).eq("id", war.id);
        } catch (e) { console.error("reminder post failed", war.id, r.id, e); }
      }
    }

    // Persist new attacks
    const ourMembers = cw.clan.members ?? [];
    for (const m of ourMembers) {
      for (const a of (m.attacks ?? [])) {
        const defPos = (cw.opponent.members ?? []).find((x) => x.tag === a.defenderTag)?.mapPosition ?? null;
        await sb.from("war_attacks").upsert({
          war_id: war.id,
          attacker_tag: m.tag,
          attacker_name: m.name,
          attacker_th: m.townhallLevel,
          attacker_map_pos: m.mapPosition,
          defender_tag: a.defenderTag,
          defender_map_pos: defPos,
          stars: a.stars,
          destruction: Math.round(a.destructionPercentage),
          attack_order: a.order,
        }, { onConflict: "war_id,attacker_tag,attack_order" });
      }
    }
  }

  // ---- War ended actions ----
  if (cw.state === "warEnded" && !war.result_posted && cfg.log_channel_id) {
    try {
      const ourStars = cw.clan.stars ?? 0;
      const oppStars = cw.opponent.stars ?? 0;
      const ourDes = cw.clan.destructionPercentage ?? 0;
      const oppDes = cw.opponent.destructionPercentage ?? 0;
      const result = ourStars > oppStars ? "win" : ourStars < oppStars ? "lose" : (ourDes > oppDes ? "win" : ourDes < oppDes ? "lose" : "tie");

      // Persist any missed attacks
      const ourMembers = cw.clan.members ?? [];
      for (const m of ourMembers) {
        for (const a of (m.attacks ?? [])) {
          const defPos = (cw.opponent.members ?? []).find((x) => x.tag === a.defenderTag)?.mapPosition ?? null;
          await sb.from("war_attacks").upsert({
            war_id: war.id, attacker_tag: m.tag, attacker_name: m.name, attacker_th: m.townhallLevel,
            attacker_map_pos: m.mapPosition, defender_tag: a.defenderTag, defender_map_pos: defPos,
            stars: a.stars, destruction: Math.round(a.destructionPercentage), attack_order: a.order,
          }, { onConflict: "war_id,attacker_tag,attack_order" });
        }
      }

      // Use decision (set by reps) or fall back to actual result
      const decision = (war.decision ?? result) as "win" | "lose";
      // Build attackTimes map from war_attacks.recorded_at (first-seen timestamps)
      const { data: atkRows } = await sb.from("war_attacks")
        .select("attacker_tag,attack_order,recorded_at").eq("war_id", war.id);
      const attackTimes: Record<string, string> = {};
      for (const r of (atkRows ?? []) as any[]) {
        attackTimes[`${r.attacker_tag}:${r.attack_order}`] = r.recorded_at;
      }
      const clanRules = await loadClanRules(guildId, clanTag);
      const breaks = evaluateRules({
        decision, startTime, endTime,
        ourMembers, oppMembers: cw.opponent.members ?? [],
        attackTimes, rules: clanRules,
      });

      // Persist breaks
      await sb.from("war_rule_breaks").delete().eq("war_id", war.id);
      if (breaks.length) {
        await sb.from("war_rule_breaks").insert(breaks.map((b) => ({
          war_id: war.id, player_tag: b.player_tag, player_name: b.player_name, rule: b.rule, detail: b.detail,
        })));
      }


      const updatedWar = {
        ...war,
        result, our_stars: ourStars, opp_stars: oppStars,
        our_destruction: ourDes, opp_destruction: oppDes,
      };
      const { embeds, extraEmbeds, txt, content } = await buildResultEmbeds({ warRow: updatedWar, breaks, ourMembers });
      const filename = `war-${(war.clan_tag).replace("#", "")}-vs-${(war.opponent_tag).replace("#", "")}-${startTime.toISOString().slice(0, 10)}.txt`;
      const msgId = await createMessageWithFile(cfg.log_channel_id, filename, new TextEncoder().encode(txt), { embeds, content });
      for (const extra of extraEmbeds) {
        await createMessage(cfg.log_channel_id, { embeds: [extra] });
      }

      await sb.from("wars").update({
        result, our_stars: ourStars, opp_stars: oppStars,
        our_destruction: ourDes, opp_destruction: oppDes,
        result_posted: true, result_message_id: msgId,
        updated_at: new Date().toISOString(),
      }).eq("id", war.id);
    } catch (e) { console.error("result post failed", war.id, e); }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = adminClient();
  const { data: cfgs } = await sb.from("war_track_config").select("*");
  let processed = 0;
  for (const cfg of (cfgs ?? []) as any[]) {
    try {
      await processClan(cfg.guild_id, cfg.clan_tag, cfg);
      processed++;
    } catch (e) { console.error("processClan error", cfg.guild_id, cfg.clan_tag, e); }
  }
  return new Response(JSON.stringify({ ok: true, processed }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
