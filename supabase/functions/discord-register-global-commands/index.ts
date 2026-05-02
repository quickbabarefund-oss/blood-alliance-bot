// Global slash command registration — available in every server the bot joins.
// Discord propagation: ~1 hour for global. Also wipes any per-guild command
// copies in known guilds to prevent duplicate command listings.
import { corsHeaders } from "../_shared/cors.ts";
import { COMMANDS } from "../_shared/commands.ts";
import { adminClient } from "../_shared/leaderboard.ts";

const APP_ID = Deno.env.get("DISCORD_APPLICATION_ID")!;
const BOT = Deno.env.get("DISCORD_BOT_TOKEN")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  // 1. PUT global commands
  const url = `https://discord.com/api/v10/applications/${APP_ID}/commands`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bot ${BOT}`, "Content-Type": "application/json" },
    body: JSON.stringify(COMMANDS),
  });
  const text = await res.text();

  // 2. Wipe per-guild command copies in every known guild (kills duplicates).
  const sb = adminClient();
  const { data: guilds } = await sb.from("guilds").select("guild_id");
  const wiped: string[] = [];
  for (const g of (guilds ?? []) as { guild_id: string }[]) {
    try {
      const r = await fetch(
        `https://discord.com/api/v10/applications/${APP_ID}/guilds/${g.guild_id}/commands`,
        { method: "PUT", headers: { Authorization: `Bot ${BOT}`, "Content-Type": "application/json" }, body: "[]" },
      );
      if (r.ok) wiped.push(g.guild_id);
      else console.error("wipe guild failed", g.guild_id, r.status, await r.text());
    } catch (e) { console.error("wipe guild error", g.guild_id, e); }
  }

  return new Response(JSON.stringify({ status: res.status, body: text, wiped_guild_commands: wiped }), {
    status: res.ok ? 200 : 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
