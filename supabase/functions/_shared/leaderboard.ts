import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { upsertLeaderboardMessage } from "./discord.ts";
import { buildClanEmbed, buildGlobalEmbed } from "./embeds.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

export async function refreshAllDiscordMessages() {
  const sb = adminClient();

  // Per-clan
  const { data: clans } = await sb.from("clans").select("tag,leaderboard_channel_id,leaderboard_message_id").eq("active", true);
  for (const c of clans ?? []) {
    if (!c.leaderboard_channel_id) continue;
    const payload = await buildClanEmbed(c.tag, 0);
    const newId = await upsertLeaderboardMessage(c.leaderboard_channel_id, c.leaderboard_message_id, payload);
    if (newId && newId !== c.leaderboard_message_id) {
      await sb.from("clans").update({ leaderboard_message_id: newId }).eq("tag", c.tag);
    }
  }

  // Global
  const { data: cfg } = await sb.from("discord_config").select("*").eq("key", "global").maybeSingle();
  if (cfg?.global_channel_id) {
    const payload = await buildGlobalEmbed(0);
    const newId = await upsertLeaderboardMessage(cfg.global_channel_id, cfg.global_message_id, payload);
    if (newId && newId !== cfg.global_message_id) {
      await sb.from("discord_config").update({ global_message_id: newId, updated_at: new Date().toISOString() }).eq("key", "global");
    }
  }
}
