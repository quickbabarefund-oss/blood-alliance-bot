// Discord slash-command interactions endpoint.
// Set this URL as your Discord Application's "Interactions Endpoint URL".
// All mutating commands are gated by DISCORD_MANAGER_ROLE_IDS (comma-separated role IDs).
import { corsHeaders } from "../_shared/cors.ts";
import { adminClient } from "../_shared/leaderboard.ts";
import { buildClanEmbed, buildGlobalEmbed } from "../_shared/embeds.ts";
import { normalizeTag, postCoc } from "../_shared/coc.ts";
import { istMonthKey } from "../_shared/month.ts";

const PUBLIC_KEY = Deno.env.get("DISCORD_PUBLIC_KEY") ?? "";
const MANAGER_ROLES = (Deno.env.get("DISCORD_MANAGER_ROLE_IDS") ?? "").split(",").map((s) => s.trim()).filter(Boolean);
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;

// --- Ed25519 signature verification ---
function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.substr(i * 2, 2), 16);
  return out;
}

async function verifyDiscord(req: Request, rawBody: string): Promise<boolean> {
  const sig = req.headers.get("x-signature-ed25519");
  const ts = req.headers.get("x-signature-timestamp");
  if (!sig || !ts || !PUBLIC_KEY) return false;
  try {
    const keyBytes = hexToBytes(PUBLIC_KEY);
    const key = await crypto.subtle.importKey(
      "raw",
      keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength) as ArrayBuffer,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const sigBytes = hexToBytes(sig);
    const msg = new TextEncoder().encode(ts + rawBody);
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      sigBytes.buffer.slice(sigBytes.byteOffset, sigBytes.byteOffset + sigBytes.byteLength) as ArrayBuffer,
      msg.buffer.slice(msg.byteOffset, msg.byteOffset + msg.byteLength) as ArrayBuffer,
    );
  } catch (e) {
    console.error("verify error", e);
    return false;
  }
}

// --- Discord interaction types ---
const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;
const RESP_PONG = 1;
const RESP_CHANNEL_MSG = 4;
const RESP_DEFERRED = 5;
const RESP_UPDATE_MESSAGE = 7;

function reply(content: string, ephemeral = true) {
  return new Response(JSON.stringify({
    type: RESP_CHANNEL_MSG,
    data: { content, flags: ephemeral ? 64 : 0, allowed_mentions: { parse: [] } },
  }), { headers: { "Content-Type": "application/json" } });
}

const COLOR_GREEN = 0x57F287;
const COLOR_RED = 0xED4245;
const COLOR_BLURPLE = 0x5865F2;

function replyEmbed(embed: any, ephemeral = true) {
  return new Response(JSON.stringify({
    type: RESP_CHANNEL_MSG,
    data: { embeds: [embed], flags: ephemeral ? 64 : 0, allowed_mentions: { parse: [] } },
  }), { headers: { "Content-Type": "application/json" } });
}

function deferred(ephemeral = true) {
  return new Response(JSON.stringify({ type: RESP_DEFERRED, data: { flags: ephemeral ? 64 : 0 } }), { headers: { "Content-Type": "application/json" } });
}

async function followUp(applicationId: string, token: string, content: string, ephemeral = true) {
  await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, flags: ephemeral ? 64 : 0, allowed_mentions: { parse: [] } }),
  });
}

function hasManagerRole(member: any): boolean {
  if (MANAGER_ROLES.length === 0) return true; // not configured => allow
  const roles: string[] = member?.roles ?? [];
  return roles.some((r) => MANAGER_ROLES.includes(r));
}

function getOpt(opts: any[] | undefined, name: string): any {
  return opts?.find((o) => o.name === name)?.value;
}

function getSubOptions(opts: any[] | undefined): { sub: string; options: any[] } {
  const sub = opts?.[0];
  return { sub: sub?.name ?? "", options: sub?.options ?? [] };
}

// --- Handlers ---

async function handleClan(interaction: any) {
  const sb = adminClient();
  const { sub, options } = getSubOptions(interaction.data.options);
  if (sub === "list") {
    const { data } = await sb.from("clans").select("tag,name,member_count,active").order("name");
    if (!data?.length) return reply("No clans registered yet.");
    const lines = data.map((c) => `• ${c.active ? "✅" : "⏸️"} **${c.name || c.tag}** \`${c.tag}\` — ${c.member_count} members`);
    return reply(lines.join("\n"));
  }
  if (!hasManagerRole(interaction.member)) return reply("⛔ You need a manager role to do this.");

  if (sub === "add") {
    const tag = normalizeTag(getOpt(options, "tag"));
    const channel = getOpt(options, "channel");
    await sb.from("clans").upsert({ tag, leaderboard_channel_id: channel, active: true }, { onConflict: "tag" });
    return reply(`✅ Added clan \`${tag}\`. Leaderboard will post in <#${channel}> within 5 minutes.`);
  }
  if (sub === "remove") {
    const tag = normalizeTag(getOpt(options, "tag"));
    await sb.from("clans").update({ active: false }).eq("tag", tag);
    return reply(`🗑️ Deactivated \`${tag}\`. Historical data is kept.`);
  }
  return reply("Unknown subcommand.");
}

async function handleGlobal(interaction: any) {
  if (!hasManagerRole(interaction.member)) return reply("⛔ Manager role required.");
  const { sub, options } = getSubOptions(interaction.data.options);
  if (sub === "setchannel") {
    const channel = getOpt(options, "channel");
    const sb = adminClient();
    await sb.from("discord_config").upsert({ key: "global", global_channel_id: channel, global_message_id: null, updated_at: new Date().toISOString() }, { onConflict: "key" });
    return reply(`✅ Global leaderboard channel set to <#${channel}>.`);
  }
  return reply("Unknown subcommand.");
}

async function handleTopOrLowest(interaction: any, asc: boolean) {
  const sb = adminClient();
  const opts = interaction.data.options ?? [];
  const clanTagRaw = getOpt(opts, "clan");
  const count = Math.min(50, Math.max(1, getOpt(opts, "count") ?? 10));
  const mk = istMonthKey();
  // Fetch a wider window so we can drop blacklisted entries and still return `count` rows.
  let q = sb.from("monthly_aggregates").select("player_tag,player_name,clan_tag,donations,donations_received").eq("month_key", mk).order("donations", { ascending: asc }).limit(count + 200);
  if (clanTagRaw) q = q.eq("clan_tag", normalizeTag(clanTagRaw));
  const [{ data }, blRes] = await Promise.all([q, sb.from("blacklist").select("player_tag")]);
  const blocked = new Set(((blRes.data as { player_tag: string }[] | null) ?? []).map((b) => b.player_tag));
  const filtered = (data ?? []).filter((r) => !blocked.has(r.player_tag)).slice(0, count);
  if (!filtered.length) return reply("No data for this month yet.");
  const lines = filtered.map((r, i) => `\`${String(i + 1).padStart(2)}.\` **${r.player_name || r.player_tag}** \`${r.player_tag}\` — ${r.donations} donated / ${r.donations_received} received`);
  return reply(`**${asc ? "Lowest" : "Top"} ${count} (${mk} IST)**\n` + lines.join("\n"), false);
}

async function handlePlayer(interaction: any) {
  const sb = adminClient();
  const tag = normalizeTag(getOpt(interaction.data.options, "tag"));
  const { data: p } = await sb.from("players").select("*").eq("tag", tag).maybeSingle();
  if (!p) return reply(`No record for \`${tag}\` yet.`);
  const { data: aggs } = await sb.from("monthly_aggregates").select("month_key,clan_tag,donations,donations_received").eq("player_tag", tag).order("month_key", { ascending: false }).limit(6);
  const lines = (aggs ?? []).map((a) => `• ${a.month_key} — \`${a.clan_tag}\` — ${a.donations} / ${a.donations_received}`);
  const body = `**${p.name}** \`${p.tag}\`\nCurrent clan: \`${p.current_clan_tag ?? "—"}\` · Role: ${p.role ?? "—"} · TH${p.town_hall ?? "—"}\nLast seen: <t:${Math.floor(new Date(p.last_seen_at).getTime() / 1000)}:R>\n\n**Recent months**\n${lines.join("\n") || "(none)"}`;
  return reply(body);
}

async function handleListCmd(interaction: any, table: "blacklist" | "whitelist") {
  const sb = adminClient();
  const { sub, options } = getSubOptions(interaction.data.options);
  if (sub === "list") {
    const { data } = await sb.from(table).select("*").order("added_at", { ascending: false }).limit(50);
    if (!data?.length) return reply(`${table} is empty.`);
    const lines = data.map((b) => `• \`${b.player_tag}\` — ${b.reason ?? "—"}`);
    return reply(`**${table}**\n` + lines.join("\n"));
  }
  if (!hasManagerRole(interaction.member)) return reply("⛔ Manager role required.");
  const tag = normalizeTag(getOpt(options, "tag"));
  if (sub === "add") {
    const reason = getOpt(options, "reason") ?? null;
    await sb.from(table).upsert({ player_tag: tag, reason, added_by: interaction.member?.user?.username ?? "discord" }, { onConflict: "player_tag" });
    return reply(`✅ Added \`${tag}\` to ${table}.`);
  }
  if (sub === "remove") {
    await sb.from(table).delete().eq("player_tag", tag);
    return reply(`🗑️ Removed \`${tag}\` from ${table}.`);
  }
  return reply("Unknown subcommand.");
}

async function handleRefresh(interaction: any) {
  if (!hasManagerRole(interaction.member)) return reply("⛔ Manager role required.");
  const opts = interaction.data.options ?? [];
  const clan = getOpt(opts, "clan");
  // Defer + run async
  const appId = interaction.application_id;
  const token = interaction.token;
  (async () => {
    try {
      const url = `${SUPABASE_URL}/functions/v1/poll-clans`;
      const body = clan ? JSON.stringify({ clan_tag: normalizeTag(clan) }) : "{}";
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body,
      });
      await followUp(appId, token, `🔁 Refresh ${clan ? `for \`${normalizeTag(clan)}\`` : "for all clans"} complete.`, true);
    } catch (e) {
      await followUp(appId, token, `❌ Refresh failed: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  })();
  return deferred(true);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return new Response("ok");

  const raw = await req.text();
  const ok = await verifyDiscord(req, raw);
  if (!ok) return new Response("invalid request signature", { status: 401 });

  const interaction = JSON.parse(raw);
  if (interaction.type === PING) return new Response(JSON.stringify({ type: RESP_PONG }), { headers: { "Content-Type": "application/json" } });

  if (interaction.type === MESSAGE_COMPONENT) {
    try {
      const cid: string = interaction.data?.custom_id ?? "";
      // New formats:
      //   lb:clan:<TAG>:first | lb:clan:<TAG>:prev:<n> | lb:clan:<TAG>:next:<n> | lb:clan:<TAG>:last
      //   lb:global:first     | lb:global:prev:<n>     | lb:global:next:<n>     | lb:global:last
      //   ...:noop
      const VERY_LARGE = 1_000_000;
      if (cid.startsWith("lb:") && !cid.endsWith(":noop")) {
        const parts = cid.split(":");
        const kind = parts[1]; // "clan" | "global"
        const isClan = kind === "clan";
        const clanTag = isClan ? parts[2] : "";
        const action = isClan ? parts[3] : parts[2];
        const arg = isClan ? parts[4] : parts[3];

        let page = 0;
        if (action === "first") page = 0;
        else if (action === "last") page = VERY_LARGE; // builder clamps to last page
        else if (action === "prev") page = Math.max(0, (parseInt(arg ?? "0", 10) || 0) - 1);
        else if (action === "next") page = (parseInt(arg ?? "0", 10) || 0) + 1;

        const payload = isClan ? await buildClanEmbed(clanTag, page) : await buildGlobalEmbed(page);
        return new Response(JSON.stringify({ type: RESP_UPDATE_MESSAGE, data: payload }), { headers: { "Content-Type": "application/json" } });
      }
      // Acknowledge no-op buttons silently
      return new Response(JSON.stringify({ type: 6 }), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      console.error("component handler error", e);
      return new Response(JSON.stringify({ type: 6 }), { headers: { "Content-Type": "application/json" } });
    }
  }

  if (interaction.type === APPLICATION_COMMAND) {
    const name = interaction.data.name;
    try {
      switch (name) {
        case "clan": return await handleClan(interaction);
        case "global": return await handleGlobal(interaction);
        case "top": return await handleTopOrLowest(interaction, false);
        case "lowest": return await handleTopOrLowest(interaction, true);
        case "player": return await handlePlayer(interaction);
        case "blacklist": return await handleListCmd(interaction, "blacklist");
        case "whitelist": return await handleListCmd(interaction, "whitelist");
        case "refresh": return await handleRefresh(interaction);
        default: return reply(`Unknown command: ${name}`);
      }
    } catch (e) {
      console.error("handler error", e);
      return reply(`❌ Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return reply("Unsupported interaction type.");
});
