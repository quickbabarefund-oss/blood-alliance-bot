// Scheduled every 5 minutes. Polls every active clan, snapshots donations,
// updates monthly aggregates with deltas, then refreshes Discord leaderboards.
import { corsHeaders } from "../_shared/cors.ts";
import { fetchClan, fetchPlayer, normalizeTag } from "../_shared/coc.ts";
import { adminClient, refreshAllDiscordMessages } from "../_shared/leaderboard.ts";
import { istMonthKey } from "../_shared/month.ts";

// Fetch per-player stats in parallel batches. The clan endpoint's memberList
// does NOT include attackWins/defenseWins, so we hydrate from /players/{tag}.
async function fetchMemberStats(tags: string[]): Promise<Map<string, { attackWins: number; defenseWins: number }>> {
  const out = new Map<string, { attackWins: number; defenseWins: number }>();
  const CONCURRENCY = 6;
  let i = 0;
  async function worker() {
    while (i < tags.length) {
      const idx = i++;
      const t = tags[idx];
      try {
        const p: any = await fetchPlayer(t);
        out.set(t, {
          attackWins: Number(p?.attackWins ?? 0),
          defenseWins: Number(p?.defenseWins ?? 0),
        });
      } catch (e) {
        console.error("fetchPlayer failed", t, e instanceof Error ? e.message : e);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tags.length) }, worker));
  return out;
}

async function pollOne(clanTag: string) {
  const sb = adminClient();
  const startedAt = new Date().toISOString();
  const { data: run } = await sb.from("poll_runs").insert({ clan_tag: clanTag, status: "running", started_at: startedAt }).select("id").single();
  const runId = run?.id;

  try {
    const data = await fetchClan(clanTag);
    const members = data.memberList ?? [];
    const monthKey = istMonthKey();
    const nowIso = new Date().toISOString();

    // Update clan meta
    await sb.from("clans").update({
      name: data.name ?? "",
      badge_url: data.badgeUrls?.medium ?? null,
      member_count: members.length,
      last_polled_at: nowIso,
    }).eq("tag", clanTag);

    // ---- Roster diff: detect joins/leaves vs previously-seen membership ----
    const currentTags = new Set(members.map((m: any) => normalizeTag(m.tag)));
    const { data: prevMembers } = await sb
      .from("players")
      .select("tag,name")
      .eq("current_clan_tag", clanTag);
    const prevTags = new Set((prevMembers ?? []).map((p: any) => p.tag));

    // Leaves: in prevTags, not in currentTags
    for (const p of (prevMembers ?? []) as Array<{ tag: string; name: string }>) {
      if (!currentTags.has(p.tag)) {
        await sb.from("clan_member_events").insert({
          clan_tag: clanTag, player_tag: p.tag, player_name: p.name, event: "leave", occurred_at: nowIso,
        });
        await sb.from("player_activity_events").insert({
          player_tag: p.tag, clan_tag: clanTag, kind: "leave", occurred_at: nowIso,
        });
        // Clear current_clan_tag if it still points here
        await sb.from("players").update({ current_clan_tag: null }).eq("tag", p.tag).eq("current_clan_tag", clanTag);
      }
    }

    // Hydrate per-player attack/defense wins (not present in clan memberList).
    const memberTags = members.map((m: any) => normalizeTag(m.tag));
    const stats = await fetchMemberStats(memberTags);

    // For each member: upsert player, snapshot, compute delta vs last snapshot, update aggregate
    for (const m of members) {
      const ptag = normalizeTag(m.tag);
      const donated = m.donations ?? 0;
      const recv = m.donationsReceived ?? 0;
      const ps = stats.get(ptag);
      const atkWins = ps?.attackWins ?? 0;
      const defWins = ps?.defenseWins ?? 0;

      // Join detection
      if (!prevTags.has(ptag)) {
        await sb.from("clan_member_events").insert({
          clan_tag: clanTag, player_tag: ptag, player_name: m.name ?? "", event: "join", occurred_at: nowIso,
        });
        await sb.from("player_activity_events").insert({
          player_tag: ptag, clan_tag: clanTag, kind: "join", occurred_at: nowIso,
        });
      }

      // Upsert player
      await sb.from("players").upsert({
        tag: ptag,
        name: m.name ?? "",
        current_clan_tag: clanTag,
        role: m.role ?? null,
        town_hall: m.townHallLevel ?? null,
        last_seen_at: nowIso,
      }, { onConflict: "tag" });

      // Last snapshot for this player in this clan
      const { data: last } = await sb
        .from("donation_snapshots")
        .select("donations,donations_received,attack_wins,defense_wins,captured_at")
        .eq("player_tag", ptag)
        .eq("clan_tag", clanTag)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Delta logic: if current >= last, delta = current - last; else (in-game weekly reset) delta = current
      let dDon = donated;
      let dRecv = recv;
      let dAtk = 0;
      let dDef = 0;
      if (last) {
        dDon  = donated >= last.donations ? donated - last.donations : donated;
        dRecv = recv    >= last.donations_received ? recv - last.donations_received : recv;
        const prevAtk = (last as any).attack_wins  ?? 0;
        const prevDef = (last as any).defense_wins ?? 0;
        dAtk = atkWins >= prevAtk ? atkWins - prevAtk : atkWins;
        dDef = defWins >= prevDef ? defWins - prevDef : defWins;
      } else {
        // First time we see this player — don't credit accumulated game value to this month
        dDon = 0;
        dRecv = 0;
        dAtk = 0;
        dDef = 0;
      }

      // Insert snapshot
      await sb.from("donation_snapshots").insert({
        player_tag: ptag,
        clan_tag: clanTag,
        donations: donated,
        donations_received: recv,
        attack_wins: atkWins,
        defense_wins: defWins,
        captured_at: nowIso,
      });

      // Activity events from deltas
      const evRows: any[] = [];
      if (dDon  > 0) evRows.push({ player_tag: ptag, clan_tag: clanTag, kind: "donation", occurred_at: nowIso });
      if (dRecv > 0) evRows.push({ player_tag: ptag, clan_tag: clanTag, kind: "receive",  occurred_at: nowIso });
      if (dAtk  > 0) evRows.push({ player_tag: ptag, clan_tag: clanTag, kind: "attack",   occurred_at: nowIso });
      if (dDef  > 0) evRows.push({ player_tag: ptag, clan_tag: clanTag, kind: "defense",  occurred_at: nowIso });
      if (evRows.length) await sb.from("player_activity_events").insert(evRows);

      // Update monthly aggregate (additive)
      if (dDon > 0 || dRecv > 0) {
        // Read existing
        const { data: agg } = await sb
          .from("monthly_aggregates")
          .select("id,donations,donations_received")
          .eq("month_key", monthKey)
          .eq("player_tag", ptag)
          .eq("clan_tag", clanTag)
          .maybeSingle();
        if (agg) {
          await sb.from("monthly_aggregates").update({
            donations: agg.donations + dDon,
            donations_received: agg.donations_received + dRecv,
            player_name: m.name ?? "",
            updated_at: nowIso,
          }).eq("id", agg.id);
        } else {
          await sb.from("monthly_aggregates").insert({
            month_key: monthKey,
            player_tag: ptag,
            player_name: m.name ?? "",
            clan_tag: clanTag,
            donations: dDon,
            donations_received: dRecv,
            updated_at: nowIso,
          });
        }
      } else {
        // Still ensure a zero row exists for this month so leaderboard shows the player
        const { data: agg } = await sb
          .from("monthly_aggregates")
          .select("id")
          .eq("month_key", monthKey)
          .eq("player_tag", ptag)
          .eq("clan_tag", clanTag)
          .maybeSingle();
        if (!agg) {
          await sb.from("monthly_aggregates").insert({
            month_key: monthKey,
            player_tag: ptag,
            player_name: m.name ?? "",
            clan_tag: clanTag,
            donations: 0,
            donations_received: 0,
            updated_at: nowIso,
          });
        } else {
          await sb.from("monthly_aggregates").update({ player_name: m.name ?? "", updated_at: nowIso }).eq("id", agg.id);
        }
      }
    }

    if (runId) await sb.from("poll_runs").update({ status: "ok", finished_at: new Date().toISOString(), message: `${members.length} members` }).eq("id", runId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("pollOne error", clanTag, msg);
    if (runId) await sb.from("poll_runs").update({ status: "error", finished_at: new Date().toISOString(), message: msg }).eq("id", runId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = adminClient();
  let onlyClan: string | null = null;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body?.clan_tag) onlyClan = normalizeTag(body.clan_tag);
    }
  } catch { /* ignore */ }

  const q = sb.from("clans").select("tag").eq("active", true);
  const { data: clans } = onlyClan ? await q.eq("tag", onlyClan) : await q;

  for (const c of clans ?? []) {
    await pollOne(c.tag);
  }

  // Prune old data
  try { await sb.rpc("prune_old_snapshots"); } catch { /* ignore */ }

  // Refresh discord leaderboards
  try { await refreshAllDiscordMessages(); } catch (e) { console.error("discord refresh", e); }

  return new Response(JSON.stringify({ ok: true, polled: clans?.length ?? 0 }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
