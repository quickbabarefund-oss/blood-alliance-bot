// One-shot helper: registers (or re-registers) all guild slash commands.
// Call: POST /functions/v1/discord-register-commands  (no body needed)
import { corsHeaders } from "../_shared/cors.ts";

const APP_ID = Deno.env.get("DISCORD_APPLICATION_ID")!;
const GUILD_ID = Deno.env.get("DISCORD_GUILD_ID")!;
const BOT = Deno.env.get("DISCORD_BOT_TOKEN")!;

const CHANNEL = 7;
const STRING = 3;
const INTEGER = 4;
const USER = 6;
const SUB = 1;

const commands = [
  {
    name: "clan", description: "Manage tracked clans",
    options: [
      { type: SUB, name: "add", description: "Register a clan and bind its leaderboard channel", options: [
        { type: STRING, name: "tag", description: "Clan tag (e.g. #ABC123)", required: true },
        { type: CHANNEL, name: "channel", description: "Channel for the auto-updated leaderboard", required: true },
      ]},
      { type: SUB, name: "remove", description: "Stop tracking a clan", options: [
        { type: STRING, name: "tag", description: "Clan tag", required: true },
      ]},
      { type: SUB, name: "list", description: "List tracked clans" },
    ],
  },
  {
    name: "global", description: "Global alliance leaderboard config",
    options: [
      { type: SUB, name: "setchannel", description: "Bind global leaderboard channel", options: [
        { type: CHANNEL, name: "channel", description: "Channel", required: true },
      ]},
    ],
  },
  {
    name: "top", description: "Top donators this month",
    options: [
      { type: STRING, name: "clan", description: "Clan tag (optional)" },
      { type: INTEGER, name: "count", description: "How many (default 10, max 50)" },
    ],
  },
  {
    name: "lowest", description: "Lowest donators this month",
    options: [
      { type: STRING, name: "clan", description: "Clan tag (optional)" },
      { type: INTEGER, name: "count", description: "How many (default 10, max 50)" },
    ],
  },
  {
    name: "player", description: "Player history & totals",
    options: [{ type: STRING, name: "tag", description: "Player tag", required: true }],
  },
  {
    name: "blacklist", description: "Manage blacklist",
    options: [
      { type: SUB, name: "add", description: "Add tag", options: [
        { type: STRING, name: "tag", description: "Player tag", required: true },
        { type: STRING, name: "reason", description: "Reason" },
      ]},
      { type: SUB, name: "remove", description: "Remove tag", options: [
        { type: STRING, name: "tag", description: "Player tag", required: true },
      ]},
      { type: SUB, name: "list", description: "List blacklist" },
    ],
  },
  {
    name: "whitelist", description: "Manage whitelist",
    options: [
      { type: SUB, name: "add", description: "Add tag", options: [
        { type: STRING, name: "tag", description: "Player tag", required: true },
        { type: STRING, name: "reason", description: "Reason" },
      ]},
      { type: SUB, name: "remove", description: "Remove tag", options: [
        { type: STRING, name: "tag", description: "Player tag", required: true },
      ]},
      { type: SUB, name: "list", description: "List whitelist" },
    ],
  },
  {
    name: "refresh", description: "Force immediate poll & leaderboard refresh",
    options: [{ type: STRING, name: "clan", description: "Clan tag (optional, all if omitted)" }],
  },
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = `https://discord.com/api/v10/applications/${APP_ID}/guilds/${GUILD_ID}/commands`;
  const res = await fetch(url, {
    method: "PUT",
    headers: { Authorization: `Bot ${BOT}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  });
  const text = await res.text();
  return new Response(JSON.stringify({ status: res.status, body: text }), {
    status: res.ok ? 200 : 500,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
