// Monthly reset: posts last month's final standings as an .xlsx file
// to each leaderboard channel, then clears stored message IDs so the next
// poll-clans run posts a fresh leaderboard for the new month.
//
// Trigger: scheduled cron + manual `?dry_run=1` for previews.
import { corsHeaders } from "../_shared/cors.ts";
import { adminClient } from "../_shared/leaderboard.ts";
import { buildLeaderboardXlsx, type LbRow } from "../_shared/xlsx.ts";
import { createMessageWithFile } from "../_shared/discord.ts";

function previousIstMonthKey(now = new Date()): { key: string; label: string } {
  const ist = new Date(now.getTime() + (5 * 60 + 30) * 60_000);
  const d = new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() - 1, 1));
  const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  const label = d.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  return { key, label };
}

async function getBlocked(sb: ReturnType<typeof adminClient>): Promise<Set<string>> {
  const { data } = await sb.from("blacklist").select("player_tag");
  return new Set(((data as { player_tag: string }[] | null) ?? []).map((b) => b.player_tag));
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const url = new URL(req.url);
  const dryRun = url.searchParams.get("dry_run") === "1";
  const sb = adminClient();
  const { key: monthKey, label: monthLabel } = previousIstMonthKey();
  const blocked = await getBlocked(sb);
  const results: any[] = [];

  // Fetch all guild clans
  const { data: clans } = await sb.from("clans")
    .select("guild_id,tag,name,leaderboard_channel_id")
    .eq("active", true);

  // Group clans by guild
  const byGuild = new Map<string, any[]>();
  for (const c of clans ?? []) {
    if (!c.guild_id) continue;
    if (!byGuild.has(c.guild_id)) byGuild.set(c.guild_id, []);
    byGuild.get(c.guild_id)!.push(c);
  }

  for (const [guildId, guildClans] of byGuild) {
    // Per-clan archives
    for (const c of guildClans) {
      if (!c.leaderboard_channel_id) continue;
      const { data } = await sb.from("monthly_aggregates")
        .select("player_tag,player_name,donations,donations_received")
        .eq("month_key", monthKey).eq("clan_tag", c.tag)
        .order("donations", { ascending: false });
      const rows: LbRow[] = ((data as any[]) ?? [])
        .filter((r) => !blocked.has(r.player_tag))
        .map((r, i) => ({
          rank: i + 1,
          player_name: r.player_name,
          player_tag: r.player_tag,
          donations: r.donations,
          donations_received: r.donations_received,
        }));
      const xlsx = await buildLeaderboardXlsx({
        title: c.name || c.tag, monthLabel, rows, includeClan: false,
      });
      const filename = `${(c.name || c.tag).replace(/[^a-z0-9]/gi, "_")}_${monthKey}.xlsx`;
      results.push({ guildId, clan: c.tag, rows: rows.length, dryRun });
      if (!dryRun) {
        await createMessageWithFile(c.leaderboard_channel_id, filename, xlsx, {
          embeds: [{
            title: `📊 Final standings — ${monthLabel}`,
            description: `**${c.name || c.tag}** \`${c.tag}\` · ${rows.length} players\nFresh leaderboard starts now.`,
            color: 0xF1B93B,
            timestamp: new Date().toISOString(),
          }],
        });
        await sb.from("clans").update({ leaderboard_message_id: null })
          .eq("guild_id", guildId).eq("tag", c.tag);
      }
    }

    // Global archive for this guild
    const { data: cfg } = await sb.from("discord_config")
      .select("global_channel_id")
      .eq("guild_id", guildId).eq("key", "global").maybeSingle();
    if (cfg?.global_channel_id) {
      const clanTags = guildClans.map((c) => c.tag);
      const { data: gAgg } = await sb.from("monthly_aggregates")
        .select("player_tag,player_name,clan_tag,donations,donations_received")
        .eq("month_key", monthKey).in("clan_tag", clanTags)
        .order("donations", { ascending: false }).limit(2000);
      const nameMap: Record<string, string> = {};
      for (const c of guildClans) nameMap[c.tag] = c.name || c.tag;
      const rows: LbRow[] = ((gAgg as any[]) ?? [])
        .filter((r) => !blocked.has(r.player_tag))
        .map((r, i) => ({
          rank: i + 1,
          clan_name: nameMap[r.clan_tag] || r.clan_tag,
          player_name: r.player_name,
          player_tag: r.player_tag,
          donations: r.donations,
          donations_received: r.donations_received,
        }));
      const xlsx = await buildLeaderboardXlsx({
        title: "Alliance Global", monthLabel, rows, includeClan: true,
      });
      const filename = `global_${guildId}_${monthKey}.xlsx`;
      results.push({ guildId, scope: "global", rows: rows.length, dryRun });
      if (!dryRun) {
        await createMessageWithFile(cfg.global_channel_id, filename, xlsx, {
          embeds: [{
            title: `🌐 Final Alliance standings — ${monthLabel}`,
            description: `${rows.length} players across ${clanTags.length} clans.\nNew month resets at 00:00 IST on the 1st.`,
            color: 0x4A8DFF,
            timestamp: new Date().toISOString(),
          }],
        });
        await sb.from("discord_config").update({ global_message_id: null, updated_at: new Date().toISOString() })
          .eq("guild_id", guildId).eq("key", "global");
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, monthKey, monthLabel, dryRun, results }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
