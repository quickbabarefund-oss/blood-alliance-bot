// Global slash command registration — available in every server the bot joins.
// Discord propagation: ~1 hour. For instant availability in new guilds, the
// discord-interactions function lazily PUTs guild commands on first interaction.
import { corsHeaders } from "../_shared/cors.ts";
import { COMMANDS } from "../_shared/commands.ts";

const APP_ID = Deno.env.get("DISCORD_APPLICATION_ID")!;
const BOT = Deno.env.get("DISCORD_BOT_TOKEN")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = `https://discord.com/api/v10/applications/${APP_ID}/commands`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bot ${BOT}`, "Content-Type": "application/json" },
    body: JSON.stringify(COMMANDS),
  });
  const text = await res.text();
  return new Response(JSON.stringify({ status: res.status, body: text }), {
    status: res.ok ? 200 : 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
