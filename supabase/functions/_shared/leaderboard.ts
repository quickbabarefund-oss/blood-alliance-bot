import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { upsertLeaderboardMessage } from "./discord.ts";
import { buildClanEmbed, buildGlobalEmbed } from "./embeds.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

export function adminClient() {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

// Refresh every guild's leaderboard messages (per-clan + global).
export async function refreshAllDiscordMessages() {
  const sb = adminClient();

  // Per-clan, per-guild
  const { data: clans } = await sb.from("clans")
    .select("guild_id,tag,leaderboard_channel_id,leaderboard_message_id")
    .eq("active", true);
  for (const c of clans ?? []) {
    if (!c.leaderboard_channel_id || !c.guild_id) continue;
    try {
      const payload = await buildClanEmbed(c.guild_id, c.tag, 0);
      const newId = await upsertLeaderboardMessage(c.leaderboard_channel_id, c.leaderboard_message_id, payload);
      if (newId && newId !== c.leaderboard_message_id) {
        await sb.from("clans").update({ leaderboard_message_id: newId })
          .eq("guild_id", c.guild_id).eq("tag", c.tag);
      }
    } catch (e) {
      console.error("refresh clan failed", c.guild_id, c.tag, e);
    }
  }

  // Global, per-guild
  const { data: cfgs } = await sb.from("discord_config")
    .select("guild_id,global_channel_id,global_message_id")
    .eq("key", "global");
  for (const cfg of cfgs ?? []) {
    if (!cfg?.global_channel_id || !cfg.guild_id) continue;
    try {
      const payload = await buildGlobalEmbed(cfg.guild_id, 0);
      const newId = await upsertLeaderboardMessage(cfg.global_channel_id, cfg.global_message_id, payload);
      if (newId && newId !== cfg.global_message_id) {
        await sb.from("discord_config")
          .update({ global_message_id: newId, updated_at: new Date().toISOString() })
          .eq("guild_id", cfg.guild_id).eq("key", "global");
      }
    } catch (e) {
      console.error("refresh global failed", cfg.guild_id, e);
    }
  }
}
