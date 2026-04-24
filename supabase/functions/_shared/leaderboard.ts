import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { istMonthKey } from "./month.ts";
import { clipDiscord, upsertLeaderboardMessage } from "./discord.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

function fmtRow(rank: number, name: string, tag: string, donated: number, recv: number) {
  const ratio = recv > 0 ? (donated / recv).toFixed(2) : "∞";
  const n = `${rank}.`.padEnd(4);
  const nm = (name || tag).slice(0, 16).padEnd(17);
  const d = String(donated).padStart(7);
  const r = String(recv).padStart(7);
  return `${n}${nm}${d} /${r}  ${ratio}`;
}

export async function buildClanLeaderboard(clanTag: string, monthKey?: string, limit = 50): Promise<string> {
  const sb = adminClient();
  const mk = monthKey ?? istMonthKey();
  const { data: clan } = await sb.from("clans").select("name,tag").eq("tag", clanTag).maybeSingle();
  const { data: rows } = await sb
    .from("monthly_aggregates")
    .select("player_tag,player_name,donations,donations_received")
    .eq("month_key", mk)
    .eq("clan_tag", clanTag)
    .order("donations", { ascending: false })
    .limit(limit);

  const header = `**${clan?.name ?? clanTag}** — ${clanTag}\nMonth: ${mk} (IST)\n\n\`\`\`\n#   Player           Donated /  Recv   Ratio\n`;
  const body = (rows ?? []).map((r, i) => fmtRow(i + 1, r.player_name, r.player_tag, r.donations, r.donations_received)).join("\n");
  const footer = `\n\`\`\`\nUpdated <t:${Math.floor(Date.now() / 1000)}:R>`;
  return clipDiscord(header + (body || "(no data yet)") + footer);
}

export async function buildGlobalLeaderboard(monthKey?: string, limit = 50): Promise<string> {
  const sb = adminClient();
  const mk = monthKey ?? istMonthKey();
  const { data: rows } = await sb
    .from("monthly_aggregates")
    .select("player_tag,player_name,clan_tag,donations,donations_received")
    .eq("month_key", mk)
    .order("donations", { ascending: false })
    .limit(limit);

  const header = `**🌐 Alliance Global Leaderboard**\nMonth: ${mk} (IST)\n\n\`\`\`\n#   Player           Donated /  Recv   Ratio\n`;
  const body = (rows ?? []).map((r, i) => fmtRow(i + 1, r.player_name, r.player_tag, r.donations, r.donations_received)).join("\n");
  const footer = `\n\`\`\`\nUpdated <t:${Math.floor(Date.now() / 1000)}:R>`;
  return clipDiscord(header + (body || "(no data yet)") + footer);
}

export async function refreshAllDiscordMessages() {
  const sb = adminClient();

  // Per-clan
  const { data: clans } = await sb.from("clans").select("tag,leaderboard_channel_id,leaderboard_message_id").eq("active", true);
  for (const c of clans ?? []) {
    if (!c.leaderboard_channel_id) continue;
    const content = await buildClanLeaderboard(c.tag);
    const newId = await upsertLeaderboardMessage(c.leaderboard_channel_id, c.leaderboard_message_id, content);
    if (newId && newId !== c.leaderboard_message_id) {
      await sb.from("clans").update({ leaderboard_message_id: newId }).eq("tag", c.tag);
    }
  }

  // Global
  const { data: cfg } = await sb.from("discord_config").select("*").eq("key", "global").maybeSingle();
  if (cfg?.global_channel_id) {
    const content = await buildGlobalLeaderboard();
    const newId = await upsertLeaderboardMessage(cfg.global_channel_id, cfg.global_message_id, content);
    if (newId && newId !== cfg.global_message_id) {
      await sb.from("discord_config").update({ global_message_id: newId, updated_at: new Date().toISOString() }).eq("key", "global");
    }
  }
}
