// Discord slash-command interactions endpoint.
// - Multi-server (per-guild) scoping for clans/global config
// - Per-command role permissions (DB overrides + Discord-native admin fallback)
// - Lazy on-join command sync: when an unknown guild interacts, re-PUT guild commands
import { corsHeaders } from "../_shared/cors.ts";
import { adminClient } from "../_shared/leaderboard.ts";
import { buildClanEmbed, buildGlobalEmbed } from "../_shared/embeds.ts";
import { normalizeTag, postCoc } from "../_shared/coc.ts";
import { istMonthKey } from "../_shared/month.ts";
import { canRunCommand } from "../_shared/permissions.ts";
import { syncGuildCommands, createMessage, createMessageWithFile } from "../_shared/discord.ts";
import { COMMANDS } from "../_shared/commands.ts";
import { evaluateRules, buildResultEmbeds, parseCocTime, type CurrentWar } from "../_shared/war.ts";
import { buildDashboardPayload, buildClanDetailEmbed, syncDashboardMessage, loadFamily, refreshClanName, buildCategoryListPayload, buildInfoPayload, buildFamilyStatsPayload } from "../_shared/family.ts";
import {
  buildPlayerInfo, buildClanInfo, buildCurrentWar, buildWarLog,
  buildClanMembers, buildCwl, buildCwlRoster, buildCwlBoard, buildCapitalRaids, buildCompo, fetchLiveUserLinks, resolveLinksForTags,
} from "../_shared/coc_commands.ts";
import { buildPlayerActivity, buildPlayerJoins } from "../_shared/player_activity.ts";

const PUBLIC_KEY = Deno.env.get("DISCORD_PUBLIC_KEY") ?? "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ENV_TAG = Deno.env.get("DISCORD_ENV") ?? "prod";

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
      { name: "Ed25519" }, false, ["verify"],
    );
    const sigBytes = hexToBytes(sig);
    const msg = new TextEncoder().encode(ts + rawBody);
    return await crypto.subtle.verify(
      "Ed25519", key,
      sigBytes.buffer.slice(sigBytes.byteOffset, sigBytes.byteOffset + sigBytes.byteLength) as ArrayBuffer,
      msg.buffer.slice(msg.byteOffset, msg.byteOffset + msg.byteLength) as ArrayBuffer,
    );
  } catch (e) { console.error("verify error", e); return false; }
}

const PING = 1;
const APPLICATION_COMMAND = 2;
const MESSAGE_COMPONENT = 3;
const APPLICATION_COMMAND_AUTOCOMPLETE = 4;
const RESP_PONG = 1;
const RESP_CHANNEL_MSG = 4;
const RESP_DEFERRED = 5;
const RESP_UPDATE_MESSAGE = 7;
const RESP_AUTOCOMPLETE = 8;

const COC_AUTOCOMPLETE_CMDS = new Set([
  "clan_info","current_war","war_log","clan_members",
  "cwl","cwl_roster","cwl_board","capital_raids","compo",
]);
const PLAYER_AUTOCOMPLETE_CMDS = new Set(["player_activity","player_joins"]);

const COLOR_GREEN = 0x57F287;
const COLOR_RED = 0xED4245;
const COLOR_BLURPLE = 0x5865F2;

function reply(content: string, ephemeral = true) {
  return new Response(JSON.stringify({
    type: RESP_CHANNEL_MSG,
    data: { content, flags: ephemeral ? 64 : 0, allowed_mentions: { parse: [] } },
  }), { headers: { "Content-Type": "application/json" } });
}
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
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content, flags: ephemeral ? 64 : 0, allowed_mentions: { parse: [] } }),
  });
}

function runAfterResponse(promise: Promise<unknown>) {
  const edgeRuntime = (globalThis as any).EdgeRuntime;
  if (edgeRuntime?.waitUntil) edgeRuntime.waitUntil(promise);
  else promise.catch((e) => console.error("background task failed", e));
}

async function followUpPayload(applicationId: string, token: string, payload: any) {
  const res = await fetch(`https://discord.com/api/v10/webhooks/${applicationId}/${token}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ allowed_mentions: { parse: [] }, ...payload }),
  });
  if (!res.ok) console.error("followUpPayload failed", res.status, await res.text().catch(() => ""));
}

function getOpt(opts: any[] | undefined, name: string): any { return opts?.find((o) => o.name === name)?.value; }
function getSubOptions(opts: any[] | undefined): { sub: string; options: any[] } {
  const sub = opts?.[0]; return { sub: sub?.name ?? "", options: sub?.options ?? [] };
}
function callerUserId(interaction: any): string {
  return interaction.member?.user?.id ?? interaction.user?.id ?? "";
}
function fmtTag(t: any): string { if (!t) return "—"; return String(t).startsWith("#") ? String(t) : `#${t}`; }

// Track guild + ensure no per-guild command duplicates exist (we use globals only).
async function ensureGuildSynced(guildId: string, guildName?: string) {
  if (!guildId) return;
  const sb = adminClient();
  const { data: existing } = await sb.from("guilds").select("guild_id,commands_synced_at").eq("guild_id", guildId).maybeSingle();
  if (existing?.commands_synced_at) return;
  console.log("Clearing per-guild commands for", guildId, "(using globals)");
  // Wipe any per-guild commands so only globals are shown (prevents duplicates).
  await syncGuildCommands(guildId, []);
  await sb.from("guilds").upsert({
    guild_id: guildId,
    name: guildName ?? null,
    commands_synced_at: new Date().toISOString(),
  }, { onConflict: "guild_id" });
}

// Permission gate that returns either null (allowed) or a Response (denied).
async function gate(interaction: any, command: string): Promise<Response | null> {
  const guildId = interaction.guild_id ?? "";
  if (!guildId) return reply("⛔ This command must be run inside a server.");
  const allowed = await canRunCommand(guildId, command, interaction.member);
  if (!allowed) return reply(`⛔ You don't have permission to use \`/${command}\` here.\nAsk an admin to run \`/perm grant ${command} <role>\`.`);
  return null;
}

// --- Handlers ---

async function handleClan(interaction: any) {
  const guildId = interaction.guild_id;
  const sb = adminClient();
  const { sub, options } = getSubOptions(interaction.data.options);

  if (sub === "list") {
    const { data } = await sb.from("clans").select("tag,name,member_count,active").eq("guild_id", guildId).order("name");
    if (!data?.length) return reply("No clans registered yet in this server.");
    const lines = data.map((c) => `• ${c.active ? "✅" : "⏸️"} **${c.name || c.tag}** \`${c.tag}\` — ${c.member_count} members`);
    return reply(lines.join("\n"));
  }

  const denied = await gate(interaction, "clan");
  if (denied) return denied;

  if (sub === "add") {
    const tag = normalizeTag(getOpt(options, "tag"));
    const channel = getOpt(options, "channel");
    await sb.from("clans").upsert({
      guild_id: guildId, tag, leaderboard_channel_id: channel, active: true,
    }, { onConflict: "guild_id,tag" });
    return reply(`✅ Added clan \`${tag}\`. Leaderboard will post in <#${channel}> within 5 minutes.`);
  }
  if (sub === "remove") {
    const tag = normalizeTag(getOpt(options, "tag"));
    await sb.from("clans").update({ active: false }).eq("guild_id", guildId).eq("tag", tag);
    return reply(`🗑️ Deactivated \`${tag}\` in this server. Historical data is kept.`);
  }
  return reply("Unknown subcommand.");
}

async function handleGlobal(interaction: any) {
  const denied = await gate(interaction, "global"); if (denied) return denied;
  const guildId = interaction.guild_id;
  const { sub, options } = getSubOptions(interaction.data.options);
  if (sub === "setchannel") {
    const channel = getOpt(options, "channel");
    const sb = adminClient();
    await sb.from("discord_config").upsert({
      guild_id: guildId, key: "global", global_channel_id: channel, global_message_id: null,
      updated_at: new Date().toISOString(),
    }, { onConflict: "guild_id,key" });
    return reply(`✅ Global leaderboard channel set to <#${channel}>.`);
  }
  return reply("Unknown subcommand.");
}

async function handleTopOrLowest(interaction: any, asc: boolean) {
  const sb = adminClient();
  const guildId = interaction.guild_id;
  const opts = interaction.data.options ?? [];
  const clanTagRaw = getOpt(opts, "clan");
  const count = Math.min(50, Math.max(1, getOpt(opts, "count") ?? 10));
  const mk = istMonthKey();

  // Restrict to clans tracked by this guild
  const { data: guildClans } = await sb.from("clans").select("tag").eq("guild_id", guildId);
  const clanTags = ((guildClans as { tag: string }[] | null) ?? []).map((c) => c.tag);
  if (!clanTagRaw && clanTags.length === 0) return reply("No clans tracked in this server yet.");

  let q = sb.from("monthly_aggregates")
    .select("player_tag,player_name,clan_tag,donations,donations_received")
    .eq("month_key", mk)
    .order("donations", { ascending: asc })
    .limit(count + 200);
  if (clanTagRaw) q = q.eq("clan_tag", normalizeTag(clanTagRaw));
  else q = q.in("clan_tag", clanTags);

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
  const denied = await gate(interaction, table); if (denied) return denied;
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
  const denied = await gate(interaction, "refresh"); if (denied) return denied;
  const opts = interaction.data.options ?? [];
  const clan = getOpt(opts, "clan");
  const appId = interaction.application_id;
  const token = interaction.token;
  runAfterResponse((async () => {
    try {
      const url = `${SUPABASE_URL}/functions/v1/poll-clans`;
      const body = clan ? JSON.stringify({ clan_tag: normalizeTag(clan) }) : "{}";
      await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body,
      });
      await followUp(appId, token, `🔁 Refresh ${clan ? `for \`${normalizeTag(clan)}\`` : "for all clans"} complete.`, true);
    } catch (e) {
      await followUp(appId, token, `❌ Refresh failed: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  })());
  return deferred(true);
}

// --- /perm ---
async function handlePerm(interaction: any) {
  const denied = await gate(interaction, "perm"); if (denied) return denied;
  const guildId = interaction.guild_id;
  const sb = adminClient();
  const { sub, options } = getSubOptions(interaction.data.options);

  if (sub === "list") {
    const { data } = await sb.from("command_permissions").select("command,role_id").eq("guild_id", guildId).order("command");
    if (!data?.length) return reply("No per-command role overrides set. Discord admins can run all commands by default.");
    const grouped: Record<string, string[]> = {};
    for (const r of data) (grouped[r.command] ??= []).push(`<@&${r.role_id}>`);
    const lines = Object.entries(grouped).map(([cmd, roles]) => `• \`/${cmd}\` → ${roles.join(", ")}`);
    return reply(`**Per-command roles for this server**\n${lines.join("\n")}`);
  }

  const cmd = String(getOpt(options, "command") ?? "").trim().toLowerCase();
  const role = String(getOpt(options, "role") ?? "");
  if (!cmd || !role) return reply("Both `command` and `role` are required.");
  const known = COMMANDS.map((c) => c.name);
  if (!known.includes(cmd)) return reply(`Unknown command \`${cmd}\`. Known: ${known.map((c) => `\`${c}\``).join(", ")}`);

  if (sub === "grant") {
    await sb.from("command_permissions").upsert({ guild_id: guildId, command: cmd, role_id: role });
    return reply(`✅ <@&${role}> can now run \`/${cmd}\` in this server.`);
  }
  if (sub === "revoke") {
    await sb.from("command_permissions").delete().eq("guild_id", guildId).eq("command", cmd).eq("role_id", role);
    return reply(`🗑️ Revoked <@&${role}> from \`/${cmd}\`.`);
  }
  return reply("Unknown subcommand.");
}

// --- /link, /unlink, /profile ---
async function handleLink(interaction: any) {
  const { sub, options } = getSubOptions(interaction.data.options);
  const type = sub === "clan" ? "clan" : "player";
  const tag = normalizeTag(getOpt(options, "tag"));
  const targetUser = getOpt(options, "user") ?? callerUserId(interaction);
  try {
    await postCoc({ action: "link", type, user_id: String(targetUser), tag });
    if (type === "player") {
      await adminClient().from("coc_links").upsert({ player_tag: tag, user_id: String(targetUser), refreshed_at: new Date().toISOString() });
    }
    return replyEmbed({
      title: `🔗 ${type === "clan" ? "Clan" : "Player"} Linked`,
      description: `Successfully linked **${type}** \`${tag}\` to <@${targetUser}>.`,
      color: COLOR_GREEN,
      fields: [
        { name: "Type", value: type, inline: true },
        { name: "Tag", value: `\`${tag}\``, inline: true },
        { name: "User", value: `<@${targetUser}>`, inline: true },
      ],
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return replyEmbed({ title: "❌ Link Failed", description: e instanceof Error ? e.message : String(e), color: COLOR_RED });
  }
}

async function handleUnlink(interaction: any) {
  const { sub, options } = getSubOptions(interaction.data.options);
  const type = sub === "clan" ? "clan" : "player";
  const tag = normalizeTag(getOpt(options, "tag"));
  const targetUser = getOpt(options, "user") ?? callerUserId(interaction);
  try {
    await postCoc({ action: "unlink", type, user_id: String(targetUser), tag });
    if (type === "player") {
      await adminClient().from("coc_links").delete().eq("player_tag", tag).eq("user_id", String(targetUser));
    }
    return replyEmbed({
      title: `🔓 ${type === "clan" ? "Clan" : "Player"} Unlinked`,
      description: `Removed link for **${type}** \`${tag}\` from <@${targetUser}>.`,
      color: COLOR_BLURPLE, timestamp: new Date().toISOString(),
    });
  } catch (e) {
    return replyEmbed({ title: "❌ Unlink Failed", description: e instanceof Error ? e.message : String(e), color: COLOR_RED });
  }
}

function buildProfileEmbed(kind: "player" | "clan", payload: any, queriedBy: string) {
  const items: any[] = Array.isArray(payload) ? payload : (payload?.items ?? payload?.links ?? [payload]);
  const fields = items.slice(0, 10).map((it, i) => {
    const tag = fmtTag(it?.tag ?? it?.player_tag ?? it?.clan_tag);
    const uid = it?.user_id ?? it?.userId ?? it?.discord_id;
    const name = it?.name ?? it?.player_name ?? it?.clan_name ?? "—";
    return { name: `#${i + 1} ${name}`, value: `Tag: \`${tag}\`${uid ? `\nDiscord: <@${uid}>` : ""}`, inline: false };
  });
  return {
    title: kind === "clan" ? "🛡️ Clan Profile" : "👤 Player Profile",
    description: `Lookup by **${queriedBy}** · ${items.length} result${items.length === 1 ? "" : "s"}`,
    color: kind === "clan" ? 0xF1B93B : COLOR_BLURPLE,
    fields: fields.length ? fields : [{ name: "No results", value: "Nothing linked.", inline: false }],
    timestamp: new Date().toISOString(),
  };
}

async function handleProfile(interaction: any) {
  const { sub, options } = getSubOptions(interaction.data.options);
  try {
    if (sub === "user") {
      const uid = getOpt(options, "user") ?? callerUserId(interaction);
      const res = await postCoc({ action: "get", type: "player", filters: { user_id: String(uid) } });
      return replyEmbed(buildProfileEmbed("player", res, `user <@${uid}>`));
    }
    if (sub === "tag") {
      const tag = normalizeTag(getOpt(options, "tag"));
      const res = await postCoc({ action: "get", type: "player", filters: { tag } });
      return replyEmbed(buildProfileEmbed("player", res, `tag \`${tag}\``));
    }
    if (sub === "clan") {
      const uid = getOpt(options, "user") ?? callerUserId(interaction);
      const res = await postCoc({ action: "get", type: "clan", filters: { user_id: String(uid) } });
      return replyEmbed(buildProfileEmbed("clan", res, `user <@${uid}>`));
    }
    return reply("Unknown subcommand.");
  } catch (e) {
    return replyEmbed({ title: "❌ Profile Lookup Failed", description: e instanceof Error ? e.message : String(e), color: COLOR_RED });
  }
}

// --- War tracking handlers ---
async function handleWarTrackSetup(interaction: any) {
  const denied = await gate(interaction, "war_track_setup"); if (denied) return denied;
  const guildId = interaction.guild_id;
  const opts = interaction.data.options ?? [];
  const clanTag = normalizeTag(getOpt(opts, "clan_tag"));
  const sb = adminClient();
  await sb.from("war_track_config").upsert({
    guild_id: guildId, clan_tag: clanTag,
    rep_channel_id: String(getOpt(opts, "rep_channel")),
    rep_role_id: String(getOpt(opts, "rep_role")),
    mail_channel_id: String(getOpt(opts, "mail_channel")),
    mail_ping_role_id: String(getOpt(opts, "mail_ping_role")),
    log_channel_id: getOpt(opts, "log_channel") ? String(getOpt(opts, "log_channel")) : null,
    updated_at: new Date().toISOString(),
  }, { onConflict: "guild_id,clan_tag" });
  return reply(`✅ War tracking configured for \`${clanTag}\`.\n• Rep channel: <#${getOpt(opts, "rep_channel")}>\n• Mail channel: <#${getOpt(opts, "mail_channel")}>\n${getOpt(opts, "log_channel") ? `• Log channel: <#${getOpt(opts, "log_channel")}>` : "⚠️ Set a log channel via `/setup_war_log_channel` for reminders & results."}`);
}

async function handleSetupWarLogChannel(interaction: any) {
  const denied = await gate(interaction, "setup_war_log_channel"); if (denied) return denied;
  const guildId = interaction.guild_id;
  const opts = interaction.data.options ?? [];
  const clanTag = normalizeTag(getOpt(opts, "clan_tag"));
  const channel = String(getOpt(opts, "channel"));
  const sb = adminClient();
  const { data: existing } = await sb.from("war_track_config").select("guild_id").eq("guild_id", guildId).eq("clan_tag", clanTag).maybeSingle();
  if (!existing) return reply(`⚠️ Run \`/war_track_setup\` for \`${clanTag}\` first.`);
  await sb.from("war_track_config").update({ log_channel_id: channel, updated_at: new Date().toISOString() })
    .eq("guild_id", guildId).eq("clan_tag", clanTag);
  return reply(`✅ Log channel for \`${clanTag}\` set to <#${channel}>.`);
}

async function handleSetupWarReminder(interaction: any) {
  const denied = await gate(interaction, "setup_war_reminder"); if (denied) return denied;
  const guildId = interaction.guild_id;
  const sb = adminClient();
  const { sub, options } = getSubOptions(interaction.data.options);
  if (sub === "add") {
    const clanTag = normalizeTag(getOpt(options, "clan_tag"));
    const minutes = parseInt(getOpt(options, "minutes"), 10);
    const anchor = String(getOpt(options, "anchor"));
    if (!minutes || minutes <= 0) return reply("Minutes must be a positive integer.");
    const { data } = await sb.from("war_reminders").insert({
      guild_id: guildId, clan_tag: clanTag, minutes, anchor, active: true,
    }).select("id").single();
    return reply(`✅ Reminder #${data?.id}: **${minutes}m ${anchor === "before_end" ? "before war ends" : "after battle day starts"}** for \`${clanTag}\`.`);
  }
  if (sub === "remove") {
    const id = parseInt(getOpt(options, "id"), 10);
    await sb.from("war_reminders").delete().eq("guild_id", guildId).eq("id", id);
    return reply(`🗑️ Removed reminder #${id}.`);
  }
  if (sub === "list") {
    const clanTag = normalizeTag(getOpt(options, "clan_tag"));
    const { data } = await sb.from("war_reminders").select("id,minutes,anchor,active").eq("guild_id", guildId).eq("clan_tag", clanTag).order("minutes");
    if (!data?.length) return reply(`No reminders configured for \`${clanTag}\`.`);
    const lines = data.map((r: any) => `• #${r.id} — ${r.minutes}m ${r.anchor === "before_end" ? "before end" : "after start"} ${r.active ? "" : "(off)"}`);
    return reply(`**Reminders for \`${clanTag}\`**\n${lines.join("\n")}`);
  }
  return reply("Unknown subcommand.");
}

async function handleWarAnnouncement(interaction: any) {
  const denied = await gate(interaction, "war_announcement"); if (denied) return denied;
  const guildId = interaction.guild_id;
  const opts = interaction.data.options ?? [];
  const clanTag = normalizeTag(getOpt(opts, "clan_tag"));
  const outcome = String(getOpt(opts, "outcome"));
  const template = String(getOpt(opts, "template"));
  const sb = adminClient();
  const field = outcome === "win" ? "win_announcement" : "lose_announcement";
  const { data: existing } = await sb.from("war_track_config").select("guild_id").eq("guild_id", guildId).eq("clan_tag", clanTag).maybeSingle();
  if (!existing) return reply(`⚠️ Run \`/war_track_setup\` for \`${clanTag}\` first.`);
  await sb.from("war_track_config").update({ [field]: template, updated_at: new Date().toISOString() })
    .eq("guild_id", guildId).eq("clan_tag", clanTag);
  return reply(`✅ ${outcome.toUpperCase()} announcement template saved for \`${clanTag}\`.\nTokens: \`{opponent}\` \`{opp_tag}\` \`{our}\` \`{our_tag}\` \`{ping}\``);
}

async function handleWarTrackList(interaction: any) {
  const denied = await gate(interaction, "war_track_list"); if (denied) return denied;
  const guildId = interaction.guild_id;
  const sb = adminClient();
  const { data } = await sb.from("war_track_config")
    .select("clan_tag,rep_channel_id,mail_channel_id,log_channel_id,rep_role_id,mail_ping_role_id")
    .eq("guild_id", guildId).order("clan_tag");
  if (!data?.length) return reply("No war-tracked clans in this server. Use `/war_track_setup` to add one.");
  const lines = data.map((c: any) => {
    const parts = [
      `• **\`${c.clan_tag}\`**`,
      `Rep: <#${c.rep_channel_id}> (<@&${c.rep_role_id}>)`,
      `Mail: <#${c.mail_channel_id}> (<@&${c.mail_ping_role_id}>)`,
      c.log_channel_id ? `Log: <#${c.log_channel_id}>` : "Log: ⚠️ not set",
    ];
    return parts.join(" · ");
  });
  return reply(`**War-tracked clans (${data.length})**\n${lines.join("\n")}`);
}

async function handleWarTrackRemove(interaction: any) {
  const denied = await gate(interaction, "war_track_remove"); if (denied) return denied;
  const guildId = interaction.guild_id;
  const clanTag = normalizeTag(getOpt(interaction.data.options, "clan_tag"));
  const sb = adminClient();
  const { data: existing } = await sb.from("war_track_config")
    .select("clan_tag").eq("guild_id", guildId).eq("clan_tag", clanTag).maybeSingle();
  if (!existing) return reply(`⚠️ \`${clanTag}\` is not war-tracked in this server.`);
  await sb.from("war_track_config").delete().eq("guild_id", guildId).eq("clan_tag", clanTag);
  await sb.from("war_reminders").delete().eq("guild_id", guildId).eq("clan_tag", clanTag);
  return reply(`🗑️ Removed war tracking for \`${clanTag}\`. Reminders cleared. Historical war data is kept.`);
}

async function handleWarResendResult(interaction: any) {
  const denied = await gate(interaction, "war_resend_result"); if (denied) return denied;
  const guildId = interaction.guild_id;
  const clanTag = normalizeTag(getOpt(interaction.data.options, "clan_tag"));
  const appId = interaction.application_id;
  const token = interaction.token;

  runAfterResponse((async () => {
    try {
      const sb = adminClient();
      const { data: cfg } = await sb.from("war_track_config").select("log_channel_id")
        .eq("guild_id", guildId).eq("clan_tag", clanTag).maybeSingle();
      if (!cfg?.log_channel_id) { await followUp(appId, token, `⚠️ No log channel configured for \`${clanTag}\`. Use \`/setup_war_log_channel\`.`, true); return; }
      const { data: war } = await sb.from("wars").select("*")
        .eq("guild_id", guildId).eq("clan_tag", clanTag)
        .order("start_time", { ascending: false }).limit(1).maybeSingle();
      if (!war) { await followUp(appId, token, `⚠️ No war found for \`${clanTag}\`.`, true); return; }

  // Re-fetch current war from CoC for fresh attack data
  let cw: CurrentWar | null = null;
  try {
    cw = await postCoc<CurrentWar>({ action: "current_war", tag: clanTag });
  } catch (e) { console.error("resend fetch failed", e); }

  const ourMembers = (cw?.clan?.members ?? (war.raw_roster as any)?.clan ?? []) as any[];
  const oppMembers = (cw?.opponent?.members ?? (war.raw_roster as any)?.opponent ?? []) as any[];

  // Re-persist attacks if we have fresh data
  if (cw?.clan?.members) {
    for (const m of cw.clan.members) {
      for (const a of (m.attacks ?? [])) {
        const defPos = oppMembers.find((x: any) => x.tag === a.defenderTag)?.mapPosition ?? null;
        await sb.from("war_attacks").upsert({
          war_id: war.id, attacker_tag: m.tag, attacker_name: m.name, attacker_th: m.townhallLevel,
          attacker_map_pos: m.mapPosition, defender_tag: a.defenderTag, defender_map_pos: defPos,
          stars: a.stars, destruction: Math.round(a.destructionPercentage), attack_order: a.order,
        }, { onConflict: "war_id,attacker_tag,attack_order" });
      }
    }
  }

  const ourStars = cw?.clan?.stars ?? war.our_stars ?? 0;
  const oppStars = cw?.opponent?.stars ?? war.opp_stars ?? 0;
  const ourDes = cw?.clan?.destructionPercentage ?? war.our_destruction ?? 0;
  const oppDes = cw?.opponent?.destructionPercentage ?? war.opp_destruction ?? 0;
  const result = ourStars > oppStars ? "win" : ourStars < oppStars ? "lose" : (ourDes > oppDes ? "win" : ourDes < oppDes ? "lose" : "tie");
  const decision = (war.decision ?? result) as "win" | "lose";
  const endTime = parseCocTime(war.end_time) ?? new Date(war.end_time);

  const { data: atkRows } = await sb.from("war_attacks")
    .select("attacker_tag,attack_order,recorded_at").eq("war_id", war.id);
  const attackTimes: Record<string, string> = {};
  for (const r of (atkRows ?? []) as any[]) {
    attackTimes[`${r.attacker_tag}:${r.attack_order}`] = r.recorded_at;
  }
  const breaks = evaluateRules({ decision, endTime, ourMembers, oppMembers, attackTimes });
  await sb.from("war_rule_breaks").delete().eq("war_id", war.id);
  if (breaks.length) {
    await sb.from("war_rule_breaks").insert(breaks.map((b) => ({
      war_id: war.id, player_tag: b.player_tag, player_name: b.player_name, rule: b.rule, detail: b.detail,
    })));
  }

      const updatedWar = { ...war, result, our_stars: ourStars, opp_stars: oppStars, our_destruction: ourDes, opp_destruction: oppDes };
      const { embeds, txt } = await buildResultEmbeds({ warRow: updatedWar, breaks, ourMembers });
      const startIso = (war.start_time ?? new Date().toISOString()).slice(0, 10);
      const filename = `war-${war.clan_tag.replace("#","")}-vs-${war.opponent_tag.replace("#","")}-${startIso}-RESENT.txt`;
      await createMessageWithFile(cfg.log_channel_id, filename, new TextEncoder().encode(txt), { embeds });
      await sb.from("wars").update({
        result, our_stars: ourStars, opp_stars: oppStars,
        our_destruction: ourDes, opp_destruction: oppDes,
        result_posted: true, updated_at: new Date().toISOString(),
      }).eq("id", war.id);
      await followUp(appId, token, `✅ Resent result for \`${clanTag}\` to <#${cfg.log_channel_id}> (${breaks.length} violations).`, true);
    } catch (e) {
      console.error("war_resend_result failed", e);
      await followUp(appId, token, `❌ Resend failed: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  })());
  return deferred(true);
}

// /war_last_result clan_tag:<tag> mode:<full|violations>
// full → reposts page1+page2+txt to the configured log channel (same as war_resend_result)
// violations → ephemeral list of rule violations (no public message)
async function handleWarLastResult(interaction: any) {
  const denied = await gate(interaction, "war_last_result"); if (denied) return denied;
  const guildId = interaction.guild_id;
  const clanTag = normalizeTag(getOpt(interaction.data.options, "clan_tag"));
  const mode = (getOpt(interaction.data.options, "mode") ?? "violations") as string;
  const appId = interaction.application_id;
  const token = interaction.token;

  runAfterResponse((async () => {
    try {
      const sb = adminClient();
      const { data: war } = await sb.from("wars").select("*")
        .eq("guild_id", guildId).eq("clan_tag", clanTag)
        .eq("result_posted", true)
        .order("end_time", { ascending: false }).limit(1).maybeSingle();
      if (!war) { await followUp(appId, token, `⚠️ No ended war found for \`${clanTag}\`.`, true); return; }

      // Use stored roster from when the war was active (NOT live current_war — that's a different war).
      const rosterOur = ((war.raw_roster as any)?.clan ?? []) as any[];
      const rosterOpp = ((war.raw_roster as any)?.opponent ?? []) as any[];

      // Pull stored attacks for this specific war and merge into members so attack counts are correct.
      const { data: atkRows } = await sb.from("war_attacks")
        .select("attacker_tag,defender_tag,stars,destruction,attack_order,recorded_at")
        .eq("war_id", war.id);
      const byAttacker: Record<string, any[]> = {};
      for (const r of (atkRows ?? []) as any[]) {
        (byAttacker[r.attacker_tag] ??= []).push({
          attackerTag: r.attacker_tag, defenderTag: r.defender_tag,
          stars: r.stars, destructionPercentage: r.destruction, order: r.attack_order,
        });
      }
      const ourMembers = rosterOur.map((m: any) => ({ ...m, attacks: byAttacker[m.tag] ?? [] }));
      const oppMembers = rosterOpp;

      // Prefer stored breaks (computed when war ended). Re-evaluate only if none stored.
      let breaks: any[] = [];
      const { data: storedBreaks } = await sb.from("war_rule_breaks")
        .select("player_tag,player_name,rule,detail").eq("war_id", war.id);
      if (storedBreaks?.length) {
        breaks = storedBreaks as any[];
      } else {
        const endTime = parseCocTime(war.end_time) ?? new Date(war.end_time);
        const decision = (war.decision ?? war.result ?? "win") as "win" | "lose";
        const attackTimes: Record<string, string> = {};
        for (const r of (atkRows ?? []) as any[]) attackTimes[`${r.attacker_tag}:${r.attack_order}`] = r.recorded_at;
        breaks = evaluateRules({ decision, endTime, ourMembers, oppMembers, attackTimes });
      }

      if (mode === "full") {
        const { data: cfg } = await sb.from("war_track_config").select("log_channel_id")
          .eq("guild_id", guildId).eq("clan_tag", clanTag).maybeSingle();
        if (!cfg?.log_channel_id) { await followUp(appId, token, `⚠️ No log channel configured. Use \`/setup_war_log_channel\`.`, true); return; }
        const { embeds, txt } = await buildResultEmbeds({ warRow: war, breaks, ourMembers });
        const startIso = (war.start_time ?? new Date().toISOString()).slice(0, 10);
        const filename = `war-${war.clan_tag.replace("#","")}-vs-${war.opponent_tag.replace("#","")}-${startIso}-LAST.txt`;
        await createMessageWithFile(cfg.log_channel_id, filename, new TextEncoder().encode(txt), { embeds });
        await followUp(appId, token, `✅ Posted last result for \`${clanTag}\` to <#${cfg.log_channel_id}> (${breaks.length} violations).`, true);
      } else {
        // violations-only ephemeral
        if (!breaks.length) {
          await followUp(appId, token, `✅ Last war for \`${clanTag}\` had **no rule violations**.`, true);
          return;
        }
        const grouped: Record<string, typeof breaks> = {};
        for (const b of breaks) (grouped[b.player_tag] ??= []).push(b);
        const lines = Object.values(grouped).map((list) => {
          const head = `**${list[0].player_name}** \`${list[0].player_tag}\``;
          const sub = list.map((b) => `• \`${b.rule}\` — ${b.detail}`).join("\n");
          return `${head}\n${sub}`;
        });
        const header = `**Last war violations — ${war.clan_name ?? war.clan_tag} vs ${war.opponent_name ?? war.opponent_tag}** (${breaks.length} total)\n\n`;
        await followUp(appId, token, (header + lines.join("\n\n")).slice(0, 1990), true);
      }
    } catch (e) {
      console.error("war_last_result failed", e);
      await followUp(appId, token, `❌ Failed: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  })());
  return deferred(true);
}

async function handleThEmoji(interaction: any) {
  const denied = await gate(interaction, "th_emoji"); if (denied) return denied;
  const sb = adminClient();
  const { sub, options } = getSubOptions(interaction.data.options);
  if (sub === "set") {
    const th = parseInt(getOpt(options, "th"), 10);
    const emoji = String(getOpt(options, "emoji"));
    await sb.from("th_emojis").upsert({ th_level: th, emoji, updated_at: new Date().toISOString() });
    return reply(`✅ TH${th} emoji set to ${emoji}.`);
  }
  if (sub === "list") {
    const { data } = await sb.from("th_emojis").select("th_level,emoji").order("th_level", { ascending: false });
    if (!data?.length) return reply("No TH emojis configured. Use `/th_emoji set` to add them.");
    return reply(data.map((r: any) => `TH${r.th_level} → ${r.emoji}`).join("\n"));
  }
  return reply("Unknown subcommand.");
}

// --- /force_reset ---
async function handleForceReset(interaction: any): Promise<Response> {
  // Admin-only (gate also enforces server-side)
  if (!((BigInt(interaction.member?.permissions ?? "0")) & 0x8n)) {
    return reply("⛔ Only server admins can run `/force_reset`.");
  }
  const guildId = interaction.guild_id;
  const appId = interaction.application_id;
  const token = interaction.token;
  const APP_ID = Deno.env.get("DISCORD_APPLICATION_ID")!;
  const BOT = Deno.env.get("DISCORD_BOT_TOKEN")!;

  runAfterResponse((async () => {
    const log: string[] = [];
    try {
      // 1. Wipe per-guild command copies for this guild (kills duplicates / stale).
      const wipe = await fetch(
        `https://discord.com/api/v10/applications/${APP_ID}/guilds/${guildId}/commands`,
        { method: "PUT", headers: { Authorization: `Bot ${BOT}`, "Content-Type": "application/json" }, body: "[]" },
      );
      log.push(`Guild commands wiped: ${wipe.status}`);

      // 2. Re-PUT global commands so visibility changes propagate.
      const put = await fetch(
        `https://discord.com/api/v10/applications/${APP_ID}/commands`,
        { method: "PUT", headers: { Authorization: `Bot ${BOT}`, "Content-Type": "application/json" }, body: JSON.stringify(COMMANDS) },
      );
      log.push(`Global commands re-registered: ${put.status} (${COMMANDS.length} cmds)`);

      // 3. Refresh guilds.commands_synced_at marker.
      const sb = adminClient();
      await sb.from("guilds").upsert({
        guild_id: guildId,
        name: interaction.guild?.name ?? null,
        commands_synced_at: new Date().toISOString(),
      }, { onConflict: "guild_id" });

      await followUp(
        appId, token,
        `✅ Force-reset complete for this server.\n${log.map((l) => `• ${l}`).join("\n")}\n\n**Restart your Discord client (Ctrl+R)** to refresh the slash menu.`,
        true,
      );
    } catch (e) {
      await followUp(appId, token, `❌ Force-reset failed: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  })());
  return deferred(true);
}

// --- /donation_reset ---
async function handleDonationReset(interaction: any): Promise<Response> {
  const denied = await gate(interaction, "donation_reset"); if (denied) return denied;
  const guildId = interaction.guild_id;
  const opts = interaction.data.options ?? [];
  const clanArg = getOpt(opts, "clan_tag");
  const appId = interaction.application_id;
  const token = interaction.token;

  runAfterResponse((async () => {
    try {
      const sb = adminClient();
      const monthKey = istMonthKey();

      // Resolve clan tags scoped to this guild
      let clanTags: string[] = [];
      if (clanArg) {
        const tag = normalizeTag(clanArg);
        const { data } = await sb.from("clans").select("tag").eq("guild_id", guildId).eq("tag", tag).maybeSingle();
        if (!data) {
          await followUp(appId, token, `❌ Clan \`${tag}\` is not tracked in this server.`, true);
          return;
        }
        clanTags = [tag];
      } else {
        const { data } = await sb.from("clans").select("tag").eq("guild_id", guildId).eq("active", true);
        clanTags = (data ?? []).map((c: any) => c.tag);
      }

      if (clanTags.length === 0) {
        await followUp(appId, token, "⚠️ No tracked clans in this server.", true);
        return;
      }

      let totalRows = 0;
      for (const tag of clanTags) {
        // Zero out monthly aggregates
        const { data: agg, error: aggErr } = await sb.from("monthly_aggregates")
          .update({ donations: 0, donations_received: 0, updated_at: new Date().toISOString() })
          .eq("month_key", monthKey).eq("clan_tag", tag)
          .select("id");
        if (aggErr) throw aggErr;
        totalRows += agg?.length ?? 0;

        // Re-baseline: delete snapshots so next poll starts fresh from current in-game values
        await sb.from("donation_snapshots").delete().eq("clan_tag", tag);
      }

      const scope = clanArg ? `\`${clanTags[0]}\`` : `**all ${clanTags.length} tracked clan(s)**`;
      await followUp(appId, token, `✅ Donation totals reset to 0 for ${scope} (month \`${monthKey}\`). ${totalRows} player rows zeroed. Leaderboard will refresh on next poll (within ~5 min) or you can run \`/refresh\`.`, true);

      // Fire-and-forget: trigger an immediate poll to re-baseline snapshots
      runAfterResponse(fetch(`${SUPABASE_URL}/functions/v1/poll-clans`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
        body: clanTags.length === 1 ? JSON.stringify({ clan_tag: clanTags[0] }) : "{}",
      }).catch((e) => console.error("post-reset poll trigger failed", e)));
    } catch (e) {
      console.error("donation_reset failed", e);
      await followUp(appId, token, `❌ Reset failed: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  })());
  return deferred(true);
}

// --- /help ---
const HELP_SECTIONS: { title: string; lines: string[] }[] = [
  {
    title: "📊 Leaderboards & Stats",
    lines: [
      "`/top [clan] [count]` — Top donators this month",
      "`/lowest [clan] [count]` — Lowest donators this month",
      "`/player <tag>` — Player history & monthly totals",
      "`/refresh [clan]` — Force immediate poll & leaderboard refresh *(admin)*",
      "`/donation_reset [clan_tag]` — Reset this month's donation totals *(admin)*",
    ],
  },
  {
    title: "🔍 Clash of Clans Lookups",
    lines: [
      "`/player_info [tag] [user]` — TH, heroes, donations, war stars",
      "`/clan_info [tag] [user]` — Level, league, members, war record",
      "`/clan_members [tag] [user]` — Members sorted by donations",
      "`/compo [tag] [user]` — Town Hall composition breakdown",
      "`/current_war [tag] [user]` — Live current-war status",
      "`/war_log [tag] [user]` — Last 10 regular wars",
      "`/cwl [tag] [user]` — Current CWL status / round",
      "`/cwl_roster [tag] [user]` — Full CWL roster",
      "`/cwl_board [tag] [user]` — CWL leaderboard image",
      "`/capital_raids [tag] [user]` — Latest Clan Capital raid weekend",
      "`/player_activity [tag] [user]` — Today / 7d / 30d / month activity + last-seen + stays",
      "`/player_joins [tag] [user]` — Player's join/leave history & total stay per clan",
      "_Tip: type a clan tag to autocomplete from this server's Family clans._",
    ],
  },
  {
    title: "🛡️ Clan Setup",
    lines: [
      "`/clan add <tag> <channel>` — Track a clan & bind leaderboard channel *(admin)*",
      "`/clan remove <tag>` — Stop tracking a clan *(admin)*",
      "`/clan list` — List tracked clans in this server",
      "`/global setchannel <channel>` — Bind global alliance leaderboard *(admin)*",
    ],
  },
  {
    title: "🏛️ Family Dashboard",
    lines: [
      "`/family_category add|edit|remove|rename|reorder|list` — Categories (buttons on dashboard) *(admin)*",
      "`/family_info add|edit|remove|reorder|list` — Custom info buttons (e.g. What is FWA?) *(admin)*",
      "`/family_clan add|remove|move|list` — Manage clans in categories *(admin)*",
      "`/family_clan_dashboard [channel]` — Post / re-bind the dashboard message *(admin)*",
      "`/family_customize ...` — Title, color, footer, line format, images *(admin)*",
      "`/family_dashboard_layout stats_position:<n> stats_enabled:<bool>` — Move/hide the 📊 Clan Statistics button *(admin)*",
      "`/embed_editor` — Open the web-based embed builder *(admin)*",
    ],
  },
  {
    title: "⚔️ War Tracking (FWA)",
    lines: [
      "`/war_track_setup` — Configure clan, rep channel/role, mail channel/ping *(admin)*",
      "`/setup_war_log_channel <clan> <channel>` — Reminders, war-started & results *(admin)*",
      "`/setup_war_reminder add <clan> <minutes> <anchor>` — Schedule a reminder *(admin)*",
      "`/setup_war_reminder list|remove` — Manage reminders *(admin)*",
      "`/war_announcement <clan> <win|lose> <template>` — Customize mail-room text *(admin)*",
      "`/th_emoji set|list` — Map custom Town Hall emojis *(admin)*",
      "`/war_track_list` — List war-tracked clans in this server *(admin)*",
      "`/war_track_remove <clan>` — Stop war tracking for a clan *(admin)*",
      "`/war_resend_result <clan>` — Re-evaluate & repost latest war result *(admin)*",
      "`/war_last_result <clan> [mode]` — Show last ended war's violations (ephemeral) or full repost *(admin)*",
    ],
  },
  {
    title: "🔗 Linking & Profiles",
    lines: [
      "`/link player <tag> [user]` — Link a player tag to a Discord user",
      "`/link clan <tag> [user]` — Link a clan tag to a Discord user",
      "`/unlink player|clan <tag> [user]` — Remove a link",
      "`/profile user [user]` — Show linked players for a user",
      "`/profile tag <tag>` — Find the Discord user linked to a tag",
      "`/profile clan [user]` — Show linked clans for a user",
    ],
  },
  {
    title: "🚫 Lists",
    lines: [
      "`/blacklist add|remove|list` — Manage blacklist *(add/remove: admin)*",
      "`/whitelist add|remove|list` — Manage whitelist *(add/remove: admin)*",
    ],
  },
  {
    title: "🔐 Permissions & Maintenance",
    lines: [
      "`/perm grant <command> <role>` — Allow a role to use a command *(admin)*",
      "`/perm revoke <command> <role>` — Revoke a role *(admin)*",
      "`/perm list` — Show per-command role overrides",
      "`/force_reset` — Wipe guild slash commands & re-sync globals *(admin)*",
    ],
  },
];

function buildHelpPayload(page: number) {
  const total = HELP_SECTIONS.length;
  const safe = Math.min(Math.max(0, page), total - 1);
  const s = HELP_SECTIONS[safe];
  const embed = {
    title: `🤖 Bot Commands — ${s.title}`,
    description:
      "Commands marked *(admin)* require server-admin or a granted role.\n\n" +
      s.lines.join("\n"),
    color: COLOR_BLURPLE,
    footer: { text: `Page ${safe + 1}/${total} · Tip: type / in chat to see all commands with autocomplete.` },
  };
  const components = [{
    type: 1,
    components: [
      { type: 2, style: 2, label: "⏮", custom_id: `help:first`, disabled: safe <= 0 },
      { type: 2, style: 2, label: "◀", custom_id: `help:prev:${safe}`, disabled: safe <= 0 },
      { type: 2, style: 1, label: `${safe + 1}/${total}`, custom_id: `help:noop`, disabled: true },
      { type: 2, style: 2, label: "▶", custom_id: `help:next:${safe}`, disabled: safe >= total - 1 },
      { type: 2, style: 2, label: "⏭", custom_id: `help:last`, disabled: safe >= total - 1 },
    ],
  }];
  return { embeds: [embed], components, allowed_mentions: { parse: [] } };
}

const BOT_OWNER_ID = "1416822914950496366";
const ALWAYS_ENABLED = new Set(["command_toggle", "help", "perm", "force_reset"]);

async function isCommandDisabled(guildId: string, command: string): Promise<boolean> {
  if (!guildId || ALWAYS_ENABLED.has(command)) return false;
  const sb = adminClient();
  const { data } = await sb.from("disabled_commands")
    .select("command").eq("guild_id", guildId).eq("command", command).maybeSingle();
  return !!data;
}

async function handleCommandToggle(interaction: any): Promise<Response> {
  const userId = interaction.member?.user?.id ?? interaction.user?.id ?? "";
  if (userId !== BOT_OWNER_ID) {
    return reply("⛔ Only the bot owner can use this command.");
  }
  const guildId = interaction.guild_id;
  if (!guildId) return reply("⛔ Must be run inside a server.");
  const sb = adminClient();
  const { sub, options } = getSubOptions(interaction.data.options);

  if (sub === "list") {
    const { data } = await sb.from("disabled_commands")
      .select("command,disabled_at").eq("guild_id", guildId).order("command");
    if (!data?.length) return reply("✅ No commands are disabled in this server.", false);
    return reply("🚫 Disabled commands:\n" + data.map((r: any) => `• \`/${r.command}\``).join("\n"), false);
  }

  const cmd = String(options?.find((o: any) => o.name === "command")?.value ?? "").trim().toLowerCase().replace(/^\//, "");
  if (!cmd) return reply("Provide a command name.", false);
  if (ALWAYS_ENABLED.has(cmd)) return reply(`⛔ \`/${cmd}\` cannot be disabled.`, false);

  if (sub === "disable") {
    await sb.from("disabled_commands").upsert(
      { guild_id: guildId, command: cmd, disabled_by: userId },
      { onConflict: "guild_id,command" },
    );
    return reply(`🚫 Disabled \`/${cmd}\` in this server.`, false);
  }
  if (sub === "enable") {
    await sb.from("disabled_commands").delete().eq("guild_id", guildId).eq("command", cmd);
    return reply(`✅ Enabled \`/${cmd}\` in this server.`, false);
  }
  return reply("Unknown subcommand.", false);
}

function handleHelp(_interaction: any): Response {
  const payload = buildHelpPayload(0);
  return new Response(JSON.stringify({ type: RESP_CHANNEL_MSG, data: payload }), {
    headers: { "Content-Type": "application/json" },
  });
}

// War decision select menu handler (custom_id: war:decide:<war_id>)
async function handleWarDecide(interaction: any): Promise<Response> {
  const sb = adminClient();
  const cid: string = interaction.data?.custom_id ?? "";
  const warId = parseInt(cid.split(":")[2], 10);
  const choice = interaction.data?.values?.[0]; // "win" | "lose"
  if (!warId || !["win", "lose"].includes(choice)) {
    return new Response(JSON.stringify({ type: 6 }), { headers: { "Content-Type": "application/json" } });
  }

  const { data: war } = await sb.from("wars").select("*").eq("id", warId).maybeSingle();
  if (!war) return reply("⚠️ This war is no longer being tracked.");

  const { data: cfg } = await sb.from("war_track_config")
    .select("*").eq("guild_id", war.guild_id).eq("clan_tag", war.clan_tag).maybeSingle();

  // Permission: must have rep_role_id
  const memberRoles: string[] = interaction.member?.roles ?? [];
  const repRole = cfg?.rep_role_id;
  const allowed = (repRole && memberRoles.includes(repRole)) || (BigInt(interaction.member?.permissions ?? "0") & 0x8n) === 0x8n;
  if (!allowed) return reply(`⛔ Only members with <@&${repRole ?? "rep_role"}> can decide this war.`);

  const userId = callerUserId(interaction);
  await sb.from("wars").update({
    decision: choice, decided_by: userId, decided_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq("id", warId);

  // Edit the original rep message: disable select + add footer
  if (war.rep_message_id) {
    try {
      const updated = JSON.parse(JSON.stringify(interaction.message ?? {}));
      const embed = (updated.embeds ?? [{}])[0] ?? {};
      embed.footer = { text: `Decided: ${choice.toUpperCase()} by ${interaction.member?.user?.username ?? "—"}` };
      await fetch(`https://discord.com/api/v10/channels/${interaction.channel_id}/messages/${war.rep_message_id}`, {
        method: "PATCH",
        headers: { Authorization: `Bot ${Deno.env.get("DISCORD_BOT_TOKEN")}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          embeds: [embed],
          components: [{ type: 1, components: [{
            type: 3, custom_id: `war:decided:${warId}`, placeholder: `Decided: ${choice.toUpperCase()}`,
            disabled: true, options: [{ label: "Decided", value: "x" }],
          }]}],
        }),
      });
    } catch (e) { console.error("edit rep msg failed", e); }
  }

  // Mail-room announcement
  if (cfg?.mail_channel_id) {
    const tpl = (choice === "win" ? cfg.win_announcement : cfg.lose_announcement)
      ?? (choice === "win"
        ? "🏆 {ping} — We're going for the **WIN** vs **{opponent}** ({opp_tag})! Mirror first attack 3⭐, ≥2⭐ in first 16h, 3⭐ in last 8h."
        : "🏳️ {ping} — We're **LOSING** vs **{opponent}** ({opp_tag}). Mirror first attack 2⭐, 1⭐ first 16h, 2⭐ last 8h. No extras.");
    const ping = cfg.mail_ping_role_id ? `<@&${cfg.mail_ping_role_id}>` : "";
    const content = tpl
      .replaceAll("{opponent}", war.opponent_name ?? war.opponent_tag)
      .replaceAll("{opp_tag}", war.opponent_tag)
      .replaceAll("{our}", war.clan_name ?? war.clan_tag)
      .replaceAll("{our_tag}", war.clan_tag)
      .replaceAll("{ping}", ping);
    await fetch(`https://discord.com/api/v10/channels/${cfg.mail_channel_id}/messages`, {
      method: "POST",
      headers: { Authorization: `Bot ${Deno.env.get("DISCORD_BOT_TOKEN")}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        allowed_mentions: { parse: ["roles"] },
      }),
    });
  }

  return new Response(JSON.stringify({
    type: RESP_CHANNEL_MSG,
    data: { content: `✅ Locked in: **${choice.toUpperCase()}**. Announcement posted.`, flags: 64 },
  }), { headers: { "Content-Type": "application/json" } });
}


// =================== Family Clan Dashboard ===================

async function handleFamilyCategory(interaction: any): Promise<Response> {
  const denied = await gate(interaction, "family_category"); if (denied) return denied;
  const guildId = interaction.guild_id;
  const sb = adminClient();
  const { sub, options } = getSubOptions(interaction.data.options);

  const styleLabel = (n?: number | null) => ({ 1: "Blurple", 2: "Grey", 3: "Green", 4: "Red" } as any)[n ?? 2] ?? "Grey";

  if (sub === "list") {
    const { data } = await sb.from("family_categories")
      .select("id,name,position,emoji,button_label,button_style,line_format")
      .eq("guild_id", guildId).order("position").order("name");
    if (!data?.length) return reply("No categories yet. Add one with `/family_category add <name>`.");
    return reply(data.map((c: any, i: number) => {
      const label = c.button_label?.trim() || c.name;
      return `\`${i + 1}.\` ${c.emoji ?? "🏰"} **${c.name}** — Button: ${styleLabel(c.button_style)} "${label}"`;
    }).join("\n"));
  }

  if (sub === "add") {
    const name = String(getOpt(options, "name") ?? "").trim();
    if (!name) return reply("Name is required.");
    const row: Record<string, any> = { guild_id: guildId, name };
    const emoji = getOpt(options, "emoji"); if (emoji != null) row.emoji = String(emoji);
    const lbl = getOpt(options, "button_label"); if (lbl != null) row.button_label = String(lbl);
    const style = getOpt(options, "button_style"); if (style != null) row.button_style = Number(style);
    const lf = getOpt(options, "line_format"); if (lf != null) row.line_format = String(lf);
    const pos = getOpt(options, "position"); if (pos != null) row.position = Number(pos);
    const { error } = await sb.from("family_categories").insert(row);
    if (error) return reply(`❌ ${error.message}`);
    syncDashboardMessage(guildId).catch((e) => console.error("dashboard sync", e));
    return reply(`✅ Category **${name}** created${row.emoji ? ` ${row.emoji}` : ""}.`);
  }
  if (sub === "edit") {
    const name = String(getOpt(options, "name") ?? "").trim();
    if (!name) return reply("`name` is required.");
    const patch: Record<string, any> = {};
    const setNullable = (key: string, v: any) => {
      if (v == null) return;
      const s = String(v);
      patch[key] = s === "-" ? null : s;
    };
    setNullable("emoji", getOpt(options, "emoji"));
    setNullable("button_label", getOpt(options, "button_label"));
    setNullable("line_format", getOpt(options, "line_format"));
    const newName = getOpt(options, "new_name"); if (newName != null) patch.name = String(newName);
    const style = getOpt(options, "button_style"); if (style != null) patch.button_style = Number(style);
    const pos = getOpt(options, "position"); if (pos != null) patch.position = Number(pos);
    if (!Object.keys(patch).length) return reply("Nothing to update.");
    const { error } = await sb.from("family_categories").update(patch).eq("guild_id", guildId).ilike("name", name);
    if (error) return reply(`❌ ${error.message}`);
    syncDashboardMessage(guildId).catch((e) => console.error("dashboard sync", e));
    return reply(`✏️ Updated **${name}**: ${Object.keys(patch).join(", ")}.`);
  }
  if (sub === "remove") {
    const name = String(getOpt(options, "name") ?? "").trim();
    const { error } = await sb.from("family_categories").delete().eq("guild_id", guildId).eq("name", name);
    if (error) return reply(`❌ ${error.message}`);
    syncDashboardMessage(guildId).catch((e) => console.error("dashboard sync", e));
    return reply(`🗑️ Removed category **${name}** and its clans.`);
  }
  if (sub === "rename") {
    const oldName = String(getOpt(options, "old_name") ?? "").trim();
    const newName = String(getOpt(options, "new_name") ?? "").trim();
    const { error } = await sb.from("family_categories").update({ name: newName }).eq("guild_id", guildId).eq("name", oldName);
    if (error) return reply(`❌ ${error.message}`);
    syncDashboardMessage(guildId).catch((e) => console.error("dashboard sync", e));
    return reply(`✏️ Renamed **${oldName}** → **${newName}**.`);
  }
  if (sub === "reorder") {
    return buildReorderPicker(guildId, "cat");
  }
  return reply("Unknown subcommand.");
}

async function handleFamilyInfo(interaction: any): Promise<Response> {
  const denied = await gate(interaction, "family_info"); if (denied) return denied;
  const guildId = interaction.guild_id;
  const sb = adminClient();
  const { sub, options } = getSubOptions(interaction.data.options);

  if (sub === "list") {
    const { data } = await sb.from("family_info_messages")
      .select("key,label,emoji,position").eq("guild_id", guildId)
      .order("position").order("id");
    if (!data?.length) return reply("No info entries. Add one with `/family_info add`.");
    return reply(data.map((r: any, i: number) =>
      `\`${i + 1}.\` ${r.emoji ?? "ℹ️"} **${r.label}** — key: \`${r.key}\``).join("\n"));
  }

  if (sub === "add") {
    const name = String(getOpt(options, "name") ?? "").trim();
    let key = String(getOpt(options, "key") ?? "").trim();
    const labelOverride = String(getOpt(options, "label") ?? "").trim();
    const label = labelOverride || name;
    const title = String(getOpt(options, "title") ?? "").trim();
    const message = String(getOpt(options, "message") ?? "").trim();
    if (!name || !title || !message) return reply("`name`, `title`, `message` are required.");
    if (!key) {
      // Auto-slug from name
      const base = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "info";
      key = base;
      // Ensure uniqueness within guild
      const { data: existing } = await sb.from("family_info_messages")
        .select("key").eq("guild_id", guildId).like("key", `${base}%`);
      const taken = new Set((existing ?? []).map((r: any) => r.key));
      let n = 2;
      while (taken.has(key)) { key = `${base}_${n++}`; }
    }
    const row: Record<string, any> = {
      guild_id: guildId, key, label, title,
      description: message.replace(/\\n/g, "\n"),
    };
    const emoji = getOpt(options, "emoji"); if (emoji != null) row.emoji = String(emoji);
    const style = getOpt(options, "button_style"); if (style != null) row.button_style = Number(style);
    const color = getOpt(options, "color");
    if (color != null) {
      const c = parseHexColor(String(color));
      if (c == null) return reply("❌ Invalid color. Use a hex like `#5865F2`.");
      row.color = c;
    }
    const img = getOpt(options, "image_url"); if (img != null) row.image_url = String(img);
    const thumb = getOpt(options, "thumbnail_url"); if (thumb != null) row.thumbnail_url = String(thumb);
    const pos = getOpt(options, "position"); if (pos != null) row.position = Number(pos);
    const { error } = await sb.from("family_info_messages").insert(row);
    if (error) return reply(`❌ ${error.message}`);
    syncDashboardMessage(guildId).catch((e) => console.error("dashboard sync", e));
    return reply(`✅ Info **${label}** added (key \`${key}\`).`);
  }
  if (sub === "edit") {
    const key = String(getOpt(options, "key") ?? "").trim();
    if (!key) return reply("`key` is required.");
    const patch: Record<string, any> = {};
    const setNullable = (k: string, v: any) => { if (v == null) return; const s = String(v); patch[k] = s === "-" ? null : s; };
    setNullable("label", getOpt(options, "label"));
    setNullable("title", getOpt(options, "title"));
    const msg = getOpt(options, "message");
    if (msg != null) { const s = String(msg); patch.description = s === "-" ? null : s.replace(/\\n/g, "\n"); }
    setNullable("emoji", getOpt(options, "emoji"));
    setNullable("image_url", getOpt(options, "image_url"));
    setNullable("thumbnail_url", getOpt(options, "thumbnail_url"));
    const style = getOpt(options, "button_style"); if (style != null) patch.button_style = Number(style);
    const pos = getOpt(options, "position"); if (pos != null) patch.position = Number(pos);
    const color = getOpt(options, "color");
    if (color != null) {
      const s = String(color);
      if (s === "-") patch.color = null;
      else {
        const c = parseHexColor(s);
        if (c == null) return reply("❌ Invalid color. Use a hex like `#5865F2`.");
        patch.color = c;
      }
    }
    if (!Object.keys(patch).length) return reply("Nothing to update.");
    patch.updated_at = new Date().toISOString();
    const { error } = await sb.from("family_info_messages").update(patch).eq("guild_id", guildId).eq("key", key);
    if (error) return reply(`❌ ${error.message}`);
    syncDashboardMessage(guildId).catch((e) => console.error("dashboard sync", e));
    return reply(`✏️ Updated info \`${key}\`: ${Object.keys(patch).filter((k) => k !== "updated_at").join(", ")}.`);
  }
  if (sub === "remove") {
    const key = String(getOpt(options, "key") ?? "").trim();
    const { error } = await sb.from("family_info_messages").delete().eq("guild_id", guildId).eq("key", key);
    if (error) return reply(`❌ ${error.message}`);
    syncDashboardMessage(guildId).catch((e) => console.error("dashboard sync", e));
    return reply(`🗑️ Removed info \`${key}\`.`);
  }
  if (sub === "reorder") {
    return buildReorderPicker(guildId, "info");
  }
  return reply("Unknown subcommand.");
}

async function handleFamilyDashboardLayout(interaction: any): Promise<Response> {
  const denied = await gate(interaction, "family_dashboard_layout"); if (denied) return denied;
  const guildId = interaction.guild_id;
  const sb = adminClient();
  const { options } = getSubOptions(interaction.data.options);
  const patch: Record<string, any> = { guild_id: guildId, updated_at: new Date().toISOString() };
  const pos = getOpt(options, "stats_position"); if (pos != null) patch.stats_position = Number(pos);
  const en = getOpt(options, "stats_enabled"); if (en != null) patch.stats_enabled = !!en;
  if (Object.keys(patch).length <= 2) {
    const { data } = await sb.from("family_dashboard_layout").select("stats_position,stats_enabled").eq("guild_id", guildId).maybeSingle();
    return reply(`📋 **Family Dashboard Layout**\n• Stats button position: \`${data?.stats_position ?? 9999}\`\n• Stats button enabled: \`${data?.stats_enabled ?? true}\`\n\nUse \`/family_dashboard_layout stats_position:<n>\` or \`stats_enabled:<true|false>\`.`);
  }
  const { error } = await sb.from("family_dashboard_layout").upsert(patch, { onConflict: "guild_id" });
  if (error) return reply(`❌ ${error.message}`);
  syncDashboardMessage(guildId).catch((e) => console.error("dashboard sync", e));
  return reply(`✅ Updated layout: ${Object.keys(patch).filter((k) => k !== "guild_id" && k !== "updated_at").join(", ")}.`);
}

// Reorder picker: ephemeral 2-step select flow over a UNIFIED list of all
// dashboard buttons (category buttons + info buttons + Clan Statistics).
// Positions are shared across categories + infos so the visual order on the
// dashboard matches what the admin picks here.
//   Step 1: select which button to move
//   Step 2: select target absolute position 1..N
// `kind` is kept only for the entry-point message ("category" vs "info" wording).
async function buildReorderPicker(guildId: string, kind: "cat" | "info"): Promise<Response> {
  const sb = adminClient();
  const [cats, infos, layout] = await Promise.all([
    sb.from("family_categories").select("id,name,emoji,position").eq("guild_id", guildId).order("position").order("name")
      .then((r) => (r.data ?? []) as Array<{ id: number; name: string; emoji: string | null; position: number }>),
    sb.from("family_info_messages").select("id,key,label,emoji,position").eq("guild_id", guildId).order("position").order("id")
      .then((r) => (r.data ?? []) as Array<{ id: number; key: string; label: string; emoji: string | null; position: number }>),
    sb.from("family_dashboard_layout").select("stats_position,stats_enabled").eq("guild_id", guildId).maybeSingle()
      .then((r) => r.data as { stats_position: number; stats_enabled: boolean } | null),
  ]);

  type Item = { value: string; label: string; emoji: string | null; pos: number; kind: "cat" | "info" | "stats" };
  const merged: Item[] = [
    ...cats.map((c) => ({ value: `cat:${c.id}`, label: c.name, emoji: c.emoji, pos: c.position ?? 0, kind: "cat" as const })),
    ...infos.map((i) => ({ value: `info:${i.id}`, label: i.label || i.key, emoji: i.emoji, pos: i.position ?? 0, kind: "info" as const })),
  ];
  if (!layout || layout.stats_enabled !== false) {
    merged.push({ value: "stats", label: "Clan Statistics", emoji: "📊", pos: layout?.stats_position ?? 9999, kind: "stats" });
  }
  merged.sort((a, b) => a.pos - b.pos);

  if (!merged.length) {
    return reply(kind === "cat"
      ? "No categories to reorder. Add one with `/family_category add`."
      : "No info buttons to reorder. Add one with `/family_info add`.");
  }

  const options = merged.slice(0, 25).map((it, i) => ({
    label: `${i + 1}. ${it.label.slice(0, 90)}`,
    description: `${it.kind === "cat" ? "Category" : it.kind === "info" ? "Info" : "Stats"} button`,
    value: it.value,
    emoji: it.emoji ? (function () {
      const m = /^<(a)?:([A-Za-z0-9_~]+):(\d+)>$/.exec(String(it.emoji).trim());
      return m ? { name: m[2], id: m[3], animated: !!m[1] } : { name: String(it.emoji).trim() };
    })() : undefined,
  }));

  return new Response(JSON.stringify({
    type: RESP_CHANNEL_MSG,
    data: {
      content: "**Reorder dashboard buttons** — pick any button (category / info / stats), then choose its new position. Order is shared across all button types.",
      flags: 64,
      components: [{
        type: 1,
        components: [{
          type: 3,
          custom_id: `fam:reorder:pick:any`,
          placeholder: "Pick a button to move",
          options,
        }],
      }],
    },
  }), { headers: { "Content-Type": "application/json" } });
}

async function handleFamilyClan(interaction: any): Promise<Response> {
  const denied = await gate(interaction, "family_clan"); if (denied) return denied;
  const guildId = interaction.guild_id;
  const sb = adminClient();
  const { sub, options } = getSubOptions(interaction.data.options);

  if (sub === "list") {
    const { categories, clans } = await loadFamily(guildId);
    if (!categories.length) return reply("No categories yet.");
    const lines: string[] = [];
    for (const cat of categories) {
      lines.push(`**${cat.name}**`);
      const cs = clans.filter((c) => c.category_id === cat.id);
      lines.push(cs.length ? cs.map((c) => `  • \`${c.clan_tag}\``).join("\n") : "  _empty_");
    }
    return reply(lines.join("\n"));
  }

  async function findCat(name: string) {
    const { data } = await sb.from("family_categories").select("id,name").eq("guild_id", guildId).ilike("name", name).maybeSingle();
    return data;
  }

  if (sub === "add") {
    const catName = String(getOpt(options, "category") ?? "").trim();
    const tag = normalizeTag(getOpt(options, "clan_tag"));
    const cat = await findCat(catName);
    if (!cat) return reply(`❌ Category \`${catName}\` not found. Create it with \`/family_category add\`.`);
    const { error } = await sb.from("family_clans").insert({ guild_id: guildId, category_id: cat.id, clan_tag: tag });
    if (error) return reply(`❌ ${error.message}`);
    // best-effort fetch + cache the clan name, then sync
    refreshClanName(guildId, tag).finally(() => {
      syncDashboardMessage(guildId).catch((e) => console.error("dashboard sync", e));
    });
    return reply(`✅ Added \`${tag}\` to **${cat.name}**.`);
  }
  if (sub === "remove") {
    const catName = String(getOpt(options, "category") ?? "").trim();
    const tag = normalizeTag(getOpt(options, "clan_tag"));
    const cat = await findCat(catName);
    if (!cat) return reply(`❌ Category \`${catName}\` not found.`);
    const { error } = await sb.from("family_clans").delete().eq("guild_id", guildId).eq("category_id", cat.id).eq("clan_tag", tag);
    if (error) return reply(`❌ ${error.message}`);
    syncDashboardMessage(guildId).catch((e) => console.error("dashboard sync", e));
    return reply(`🗑️ Removed \`${tag}\` from **${cat.name}**.`);
  }
  if (sub === "move") {
    const tag = normalizeTag(getOpt(options, "clan_tag"));
    const toName = String(getOpt(options, "to_category") ?? "").trim();
    const cat = await findCat(toName);
    if (!cat) return reply(`❌ Category \`${toName}\` not found.`);
    const { error } = await sb.from("family_clans").update({ category_id: cat.id }).eq("guild_id", guildId).eq("clan_tag", tag);
    if (error) return reply(`❌ ${error.message}`);
    syncDashboardMessage(guildId).catch((e) => console.error("dashboard sync", e));
    return reply(`➡️ Moved \`${tag}\` to **${cat.name}**.`);
  }
  return reply("Unknown subcommand.");
}

async function handleFamilyDashboard(interaction: any): Promise<Response> {
  const denied = await gate(interaction, "family_clan_dashboard"); if (denied) return denied;
  const guildId = interaction.guild_id;
  const sb = adminClient();
  const channel = getOpt(interaction.data.options, "channel") ?? interaction.channel_id;

  const { data: existing } = await sb.from("family_dashboards").select("guild_id").eq("guild_id", guildId).maybeSingle();
  if (existing) {
    await sb.from("family_dashboards").update({
      channel_id: channel, message_id: null, updated_at: new Date().toISOString(),
    }).eq("guild_id", guildId);
  } else {
    await sb.from("family_dashboards").insert({
      guild_id: guildId, channel_id: channel, message_id: null,
    });
  }
  const r = await syncDashboardMessage(guildId);
  if (!r.ok) return reply(`❌ Failed to post dashboard: ${r.error}`);
  return reply(`✅ Family Clan Dashboard registered in <#${channel}>. It will auto-update when you change clans/categories.`);
}

function parseHexColor(s: string): number | null {
  const m = s.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(m)) return null;
  return parseInt(m, 16);
}

async function handleFamilyCustomize(interaction: any): Promise<Response> {
  const denied = await gate(interaction, "family_customize"); if (denied) return denied;
  const guildId = interaction.guild_id;
  const sb = adminClient();
  const opts = interaction.data.options ?? [];

  const { data: existing } = await sb.from("family_dashboards").select("*").eq("guild_id", guildId).maybeSingle();
  if (!existing) return reply("❌ No dashboard registered yet. Run `/family_clan_dashboard` first.");

  const reset = getOpt(opts, "reset") === true;
  const refreshNames = getOpt(opts, "refresh_names") === true;

  const patch: Record<string, any> = {};
  if (reset) {
    Object.assign(patch, {
      title: "🏛️ Family Clan Dashboard",
      description: null,
      color: 0x5865F2,
      footer_text: null,
      show_timestamp: false,
      thumbnail_url: null,
      image_url: null,
      category_emoji: "🏰",
      clan_line_format: "`{i}.` **{name}** `{tag}`",
    });
  }

  const setStr = (key: string, optName: string) => {
    const v = getOpt(opts, optName);
    if (v == null) return;
    const s = String(v);
    patch[key] = s === "-" ? null : s.replace(/\\n/g, "\n");
  };
  setStr("title", "title");
  setStr("description", "description");
  setStr("footer_text", "footer");
  setStr("thumbnail_url", "thumbnail_url");
  setStr("image_url", "image_url");
  setStr("category_emoji", "category_emoji");
  setStr("clan_line_format", "clan_line_format");

  const showTs = getOpt(opts, "show_timestamp");
  if (showTs != null) patch.show_timestamp = !!showTs;

  const colorRaw = getOpt(opts, "color");
  if (colorRaw != null) {
    const c = parseHexColor(String(colorRaw));
    if (c == null) return reply("❌ Invalid color. Use a hex like `#5865F2`.");
    patch.color = c;
  }

  if (Object.keys(patch).length) {
    const { error } = await sb.from("family_dashboards").update(patch).eq("guild_id", guildId);
    if (error) return reply(`❌ ${error.message}`);
  }

  if (refreshNames) {
    const { data: clans } = await sb.from("family_clans").select("clan_tag").eq("guild_id", guildId);
    (async () => {
      for (const c of clans ?? []) {
        try { await refreshClanName(guildId, c.clan_tag); } catch (e) { console.error(e); }
      }
      syncDashboardMessage(guildId).catch((e) => console.error("sync", e));
    })();
  } else {
    syncDashboardMessage(guildId).catch((e) => console.error("sync", e));
  }

  const summary: string[] = [];
  if (reset) summary.push("reset to defaults");
  for (const k of Object.keys(patch)) if (k !== "color") summary.push(k);
  if ("color" in patch) summary.push("color");
  if (refreshNames) summary.push("refreshing clan names from CoC API");
  return reply(`✅ Dashboard updated: ${summary.join(", ") || "no changes"}.`);
}

// --- Generic dispatcher for the read-only CoC commands ---
const COC_BUILDERS: Record<string, (guildId: string, args: { tag?: string; targetUser?: string; caller: string }) => Promise<any>> = {
  player_info: buildPlayerInfo,
  clan_info: buildClanInfo,
  current_war: buildCurrentWar,
  war_log: buildWarLog,
  clan_members: buildClanMembers,
  cwl: buildCwl,
  cwl_roster: buildCwlRoster,
  cwl_board: buildCwlBoard,
  capital_raids: buildCapitalRaids,
  compo: buildCompo,
  player_activity: buildPlayerActivity,
  player_joins: buildPlayerJoins,
};

async function fetchUserLinks(userId: string): Promise<Array<{ player_tag: string; name: string }>> {
  const live = await fetchLiveUserLinks(userId);
  if (!live.length) return [];
  // Enrich missing names from local players table.
  const missing = live.filter((l) => !l.name).map((l) => l.tag);
  let nameMap = new Map<string, string>(live.filter((l) => l.name).map((l) => [l.tag, l.name!]));
  if (missing.length) {
    const sb = adminClient();
    const { data: players } = await sb.from("players").select("tag,name").in("tag", missing);
    for (const p of (players ?? []) as any[]) nameMap.set(p.tag, p.name);
  }
  return live.map((l) => ({ player_tag: l.tag, name: nameMap.get(l.tag) ?? l.tag }));
}

function accountPickerPayload(cmdName: string, targetUser: string | undefined, links: Array<{ player_tag: string; name: string }>, forUserId: string) {
  const options = links.slice(0, 25).map((l) => ({
    label: (l.name || l.player_tag).slice(0, 100),
    value: l.player_tag,
    description: l.player_tag.slice(0, 100),
  }));
  const subjectLabel = targetUser ? `<@${targetUser}>` : "you";
  return {
    content: `🔗 ${subjectLabel} ${targetUser ? "has" : "have"} multiple linked accounts. Pick one to use for **/${cmdName}**:`,
    components: [{
      type: 1,
      components: [{
        type: 3,
        custom_id: `coc:pick:${cmdName}:${targetUser ?? ""}:${forUserId}`,
        placeholder: "Select an account…",
        options,
        min_values: 1,
        max_values: 1,
      }],
    }],
    allowed_mentions: { parse: [] },
  };
}

async function handleCocCmd(
  interaction: any,
  builder: (guildId: string, args: { tag?: string; targetUser?: string; caller: string }) => Promise<any>,
): Promise<Response> {
  const guildId = interaction.guild_id ?? "";
  const opts = interaction.data.options ?? [];
  const tag = getOpt(opts, "tag");
  const targetUser = getOpt(opts, "user");
  const caller = callerUserId(interaction);
  const appId = interaction.application_id;
  const token = interaction.token;
  const cmdName = interaction.data.name;

  runAfterResponse((async () => {
    try {
      // If no explicit tag, check linked accounts after acknowledging Discord.
      if (!tag) {
        const uid = targetUser ?? caller;
        const links = await fetchUserLinks(uid);
        if (links.length > 1) {
          await followUpPayload(appId, token, { ...accountPickerPayload(cmdName, targetUser, links, caller), flags: 64 });
          return;
        }
      }
      const data = await builder(guildId, { tag, targetUser, caller });
      await followUpPayload(appId, token, { ...data, flags: 0 });
    } catch (e) {
      console.error("coc cmd failed", e);
      await followUp(appId, token, `❌ ${e instanceof Error ? e.message : String(e)}`, true);
    }
  })());
  return deferred(false);
}
const PUBLIC_APP_URL = Deno.env.get("PUBLIC_APP_URL") ?? "https://clan-loot-tracker.lovable.app";
async function handleEmbedEditor(interaction: any): Promise<Response> {
  if (!((BigInt(interaction.member?.permissions ?? "0")) & 0x8n)) {
    return reply("⛔ Only server admins can open the embed editor.");
  }
  const guildId = interaction.guild_id;
  const sb = adminClient();
  const token = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const expires = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1h
  await sb.from("embed_edit_tokens").insert({
    token, guild_id: guildId, issued_by: callerUserId(interaction), expires_at: expires,
  });
  const url = `${PUBLIC_APP_URL}/embeds?token=${token}`;
  return replyEmbed({
    title: "🎨 Embed Editor",
    description: `Open this private link to customize all bot embeds for this server.\n\n[**Open Embed Editor →**](${url})\n\n⏰ Link expires in **60 minutes**.`,
    color: COLOR_BLURPLE,
  }, true);
}

// /discord_link — shows an ephemeral clan multi-select; component handler fans out per clan.
async function handleDiscordLink(interaction: any): Promise<Response> {
  const guildId = interaction.guild_id ?? "";
  const sb = adminClient();
  // Prefer family_clans (curated dashboard set); fall back to tracked `clans`.
  const { data: famClans } = await sb.from("family_clans")
    .select("clan_tag,clan_name,position").eq("guild_id", guildId).order("position");
  let pool: Array<{ tag: string; name: string }> = (famClans ?? []).map((c: any) => ({
    tag: c.clan_tag, name: c.clan_name || c.clan_tag,
  }));
  if (!pool.length) {
    const { data: tracked } = await sb.from("clans").select("tag,name").eq("guild_id", guildId).eq("active", true).order("name");
    pool = (tracked ?? []).map((c: any) => ({ tag: c.tag, name: c.name || c.tag }));
  }
  if (!pool.length) return reply("No clans registered in this server. Use `/clan add` or `/family_clan add` first.");

  // De-dupe by tag, cap at 25 (Discord max options)
  const seen = new Set<string>();
  const options = pool.filter((c) => { if (seen.has(c.tag)) return false; seen.add(c.tag); return true; })
    .slice(0, 25)
    .map((c) => ({ label: `${c.name} (${c.tag})`.slice(0, 100), value: c.tag }));

  return new Response(JSON.stringify({
    type: RESP_CHANNEL_MSG,
    data: {
      content: "Select clan(s) to show Discord links for their current in-game members:",
      flags: 64,
      components: [{
        type: 1,
        components: [{
          type: 3,
          custom_id: "disclink:pick",
          placeholder: "Select Clan(s)",
          min_values: 1,
          max_values: Math.min(options.length, 25),
          options,
        }],
      }],
    },
  }), { headers: { "Content-Type": "application/json" } });
}

// Build one embed per clan listing each member with their linked Discord user (or ❌).
async function buildDiscordLinkEmbeds(guildId: string, clanTags: string[]): Promise<any[]> {
  const { fetchClan } = await import("../_shared/coc.ts");
  const embeds: any[] = [];
  for (const tag of clanTags.slice(0, 10)) {
    try {
      const clan: any = await fetchClan(tag);
      const members: any[] = clan?.memberList ?? [];
      if (!members.length) {
        embeds.push({ title: `${clan?.name ?? tag} (${tag})`, description: "_No members found._", color: COLOR_BLURPLE });
        continue;
      }
      const links = await resolveLinksForTags(members.map((m) => m.tag));
      const linkedCount = members.filter((m) => links[normalizeTag(m.tag)]).length;
      const lines = members.map((m) => {
        const uid = links[normalizeTag(m.tag)];
        const name = String(m.name ?? "").slice(0, 24).padEnd(24, " ");
        return uid
          ? `\`✅ ${name}\` <@${uid}>`
          : `\`❌ ${name}\` _not linked_`;
      });
      // Split into chunks under 4096 chars
      const chunks: string[] = [];
      let buf = "";
      for (const ln of lines) {
        if ((buf + "\n" + ln).length > 3800) { chunks.push(buf); buf = ln; }
        else { buf = buf ? `${buf}\n${ln}` : ln; }
      }
      if (buf) chunks.push(buf);
      chunks.forEach((desc, i) => {
        embeds.push({
          title: i === 0 ? `${clan?.name ?? tag} Discord Links` : `${clan?.name ?? tag} Discord Links (cont.)`,
          description: desc,
          color: COLOR_BLURPLE,
          thumbnail: i === 0 && clan?.badgeUrls?.small ? { url: clan.badgeUrls.small } : undefined,
          footer: i === chunks.length - 1
            ? { text: `${linkedCount}/${members.length} linked · ${tag}` }
            : undefined,
        });
      });
    } catch (e) {
      embeds.push({ title: `⚠️ ${tag}`, description: `Lookup failed: ${e instanceof Error ? e.message : String(e)}`, color: COLOR_RED });
    }
  }
  return embeds;
}


// ============================================================
// /myr — CWL "My Registration" lookup via external CC endpoint
// ============================================================
const MYR_API = "https://zvbtdnywdmfffxvxgzso.supabase.co/functions/v1/cwl-player-info";

async function fetchMyrData(discordUserId: string): Promise<any | null> {
  try {
    const r = await fetch(`${MYR_API}?discord_user_id=${encodeURIComponent(discordUserId)}`);
    if (!r.ok) { console.error("myr fetch", r.status, await r.text().catch(() => "")); return null; }
    const json = await r.json();
    const accounts = Array.isArray(json?.accounts) ? json.accounts : [];
    if (accounts.length) {
      const now = new Date().toISOString();
      const rows = accounts
        .map((acc: any) => acc?.player_tag ? { player_tag: normalizeTag(acc.player_tag), user_id: String(discordUserId), refreshed_at: now } : null)
        .filter(Boolean);
      if (rows.length) {
        runAfterResponse(adminClient().from("coc_links").upsert(rows).then(({ error }) => {
          if (error) console.error("myr coc_links upsert", error);
        }));
      }
    }
    return json;
  } catch (e) { console.error("myr fetch err", e); return null; }
}

function myrAccountDetailEmbed(acc: any, avatarUrl: string | undefined): any {
  const tagClean = String(acc?.assigned_clan_tag ?? "").replace(/^#/, "");
  const link = `https://link.clashofclans.com/en/?action=OpenClanProfile&tag=%23${tagClean}`;
  const lines = [
    `# [Deep Look Registration](${link})`,
    ``,
    `- ➡️ Player Name : ${acc?.player_name ?? "—"}`,
    `- ➡️ Player Tag : ${acc?.player_tag ?? "—"}`,
    `- ➡️ Town Hall : ${acc?.town_hall ?? "—"}`,
    `- ➡️ Play Style : ${acc?.registration_type ?? "—"}`,
    `- ➡️ Assigned Clan : ${acc?.assigned_clan_name ?? "—"}`,
    `- ➡️ Assigned Tag : ${acc?.assigned_clan_tag ?? "—"}`,
    `- ➡️ Clan League : ${acc?.assigned_clan_cwl_league ?? "—"}`,
    `- ➡️ In Assigned Clan : ${acc?.is_in_assigned_clan ?? "—"}`,
    `- ➡️ Pending CWL Attack : ${acc?.pending_war_attacks ?? "—"}`,
    `- ➡️ Performance Score : ${acc?.performance_score ?? "—"}`,
    `- ➡️ War Weight : ${acc?.war_weight ?? "—"} ${acc?.war_weight_status ?? ""}`.trimEnd(),
  ];
  return {
    color: 0xFFFF00,
    description: lines.join("\n"),
    thumbnail: avatarUrl ? { url: avatarUrl } : undefined,
  };
}

function myrAccountButtonRow(acc: any): any {
  const tagClean = String(acc?.assigned_clan_tag ?? "").replace(/^#/, "");
  const link = `https://link.clashofclans.com/en/?action=OpenClanProfile&tag=%23${tagClean}`;
  return {
    type: 1,
    components: [{
      type: 2,
      style: 5, // link
      url: link,
      label: `🌐 View ${acc?.assigned_clan_tag ?? "Clan"} Profile`.slice(0, 80),
    }],
  };
}

function avatarUrlFor(userId: string, avatarHash?: string | null): string | undefined {
  if (!userId) return undefined;
  if (avatarHash) {
    const ext = avatarHash.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/avatars/${userId}/${avatarHash}.${ext}?size=128`;
  }
  // Default avatar (new system: (userId >> 22) % 6)
  try {
    const idx = Number((BigInt(userId) >> 22n) % 6n);
    return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
  } catch { return undefined; }
}

async function handleMyr(interaction: any): Promise<Response> {
  const options = interaction.data?.options ?? [];
  const targetUserId: string = getOpt(options, "user") ?? callerUserId(interaction);
  const resolvedUser = interaction.data?.resolved?.users?.[targetUserId];
  const avatar = avatarUrlFor(targetUserId, resolvedUser?.avatar);
  const displayName = resolvedUser?.global_name ?? resolvedUser?.username
    ?? interaction.member?.user?.global_name ?? interaction.member?.user?.username ?? "User";

  const appId = interaction.application_id;
  const token = interaction.token;

  runAfterResponse((async () => {
    const data = await fetchMyrData(targetUserId);
    const accounts: any[] = Array.isArray(data?.accounts) ? data.accounts : [];
    const total = Number(data?.total_accounts ?? data?.account_count ?? accounts.length ?? 0);

    if (!data || total === 0) {
      await followUpPayload(appId, token, {
        flags: 64,
        embeds: [{
          color: 0xFFFF00,
          title: "📋 My Registration Details",
          description: `❌ **No Registered Account Found for <@${targetUserId}>!**\n\n👉 Please register first using the CWL panel.`,
        }],
      });
      return;
    }

    // Chunk into select menus of up to 25 options (Discord max).
    const components: any[] = [];
    for (let chunk = 0; chunk < accounts.length && components.length < 4; chunk += 25) {
      const slice = accounts.slice(chunk, chunk + 25);
      const opts = slice.map((acc, i) => {
        const globalIdx = chunk + i;
        const label = `👤 ${acc?.player_name ?? "Unknown"}`.slice(0, 100);
        const desc = `🏰 TH ${acc?.town_hall ?? "?"} | 🛡️ ${acc?.assigned_clan_name ?? "—"} | ⌲ ${acc?.registration_type ?? "—"}`.slice(0, 100);
        return { label, value: `${targetUserId}:${globalIdx}`, description: desc };
      });
      components.push({
        type: 1,
        components: [{
          type: 3,
          custom_id: `myr:pick:${targetUserId}:${chunk}`,
          placeholder: "👤 My CWL Registered Accounts",
          min_values: 1,
          max_values: 1,
          options: opts,
        }],
      });
    }

    await followUpPayload(appId, token, {
      flags: 64,
      embeds: [{
        color: 0xFFFF00,
        title: "📋 My Registration Details",
        description: [
          `👤 **CWL Registered Accounts for <@${targetUserId}>**`,
          ``,
          `Select an account from the dropdown below to view details.`,
          ``,
          `⚖️ *Make sure your War Weight is accurate before CWL starts.*`,
          `⚔️ *Stay prepared. Stay competitive.*`,
        ].join("\n"),
        thumbnail: avatar ? { url: avatar } : undefined,
        footer: { text: `${displayName} • ${total} account${total === 1 ? "" : "s"}` },
      }],
      components,
    });
  })());
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

  // Fire-and-forget: ensure this guild has commands registered
  if (interaction.guild_id) {
    ensureGuildSynced(interaction.guild_id, interaction.guild?.name).catch((e) => console.error("ensureGuildSynced", e));
  }

  // Autocomplete: Family clans for /clan_info etc., or players table for /player_activity etc.
  if (interaction.type === APPLICATION_COMMAND_AUTOCOMPLETE) {
    try {
      const cmdName = interaction.data?.name ?? "";
      const focused = (interaction.data?.options ?? []).find((o: any) => o.focused);
      if (!focused || focused.name !== "tag") {
        return new Response(JSON.stringify({ type: RESP_AUTOCOMPLETE, data: { choices: [] } }), { headers: { "Content-Type": "application/json" } });
      }
      const q = String(focused.value ?? "").trim().toLowerCase().replace(/^#/, "");
      const guildId = interaction.guild_id ?? "";
      const sb = adminClient();

      if (PLAYER_AUTOCOMPLETE_CMDS.has(cmdName)) {
        // Prefer players in this guild's Family clans, then global match by name/tag.
        const { data: fam } = await sb.from("family_clans").select("clan_tag").eq("guild_id", guildId);
        const famClanTags = (fam ?? []).map((r: any) => r.clan_tag);
        let players: any[] = [];
        if (q) {
          const { data } = await sb.from("players")
            .select("tag,name,current_clan_tag")
            .or(`name.ilike.%${q.replace(/[%_]/g, "")}%,tag.ilike.%${q.toUpperCase()}%`)
            .limit(50);
          players = (data ?? []) as any[];
        } else if (famClanTags.length) {
          const { data } = await sb.from("players")
            .select("tag,name,current_clan_tag")
            .in("current_clan_tag", famClanTags)
            .order("name")
            .limit(25);
          players = (data ?? []) as any[];
        }
        // Sort: family-clan members first
        const famSet = new Set(famClanTags);
        players.sort((a, b) => Number(famSet.has(b.current_clan_tag)) - Number(famSet.has(a.current_clan_tag)));
        const choices = players.slice(0, 25).map((p) => ({
          name: `${p.name || p.tag} (${p.tag})`.slice(0, 100),
          value: p.tag,
        }));
        return new Response(JSON.stringify({ type: RESP_AUTOCOMPLETE, data: { choices } }), { headers: { "Content-Type": "application/json" } });
      }

      if (!COC_AUTOCOMPLETE_CMDS.has(cmdName)) {
        return new Response(JSON.stringify({ type: RESP_AUTOCOMPLETE, data: { choices: [] } }), { headers: { "Content-Type": "application/json" } });
      }
      const { data: rows } = await sb.from("family_clans")
        .select("clan_tag,clan_name,category_id,position")
        .eq("guild_id", guildId)
        .order("position")
        .limit(200);
      const list = (rows ?? []) as any[];
      const filtered = q
        ? list.filter((r) => (r.clan_name ?? "").toLowerCase().includes(q) || (r.clan_tag ?? "").toLowerCase().replace(/^#/, "").includes(q))
        : list;
      const choices = filtered.slice(0, 25).map((r) => {
        const tag = String(r.clan_tag).startsWith("#") ? r.clan_tag : `#${r.clan_tag}`;
        const name = (r.clan_name ?? "").trim() || tag;
        return { name: `${name} (${tag})`.slice(0, 100), value: tag };
      });
      return new Response(JSON.stringify({ type: RESP_AUTOCOMPLETE, data: { choices } }), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      console.error("autocomplete error", e);
      return new Response(JSON.stringify({ type: RESP_AUTOCOMPLETE, data: { choices: [] } }), { headers: { "Content-Type": "application/json" } });
    }
  }

  if (interaction.type === MESSAGE_COMPONENT) {
    try {
      const cid: string = interaction.data?.custom_id ?? "";
      const VERY_LARGE = 1_000_000;
      if (cid.startsWith("lb:") && !cid.endsWith(":noop")) {
        const parts = cid.split(":");
        const kind = parts[1]; // "clan" | "global"
        const isClan = kind === "clan";
        const guildId = isClan ? parts[2] : parts[2];
        const clanTag = isClan ? parts[3] : "";
        const action = isClan ? parts[4] : parts[3];
        const arg = isClan ? parts[5] : parts[4];

        let page = 0;
        if (action === "first") page = 0;
        else if (action === "last") page = VERY_LARGE;
        else if (action === "prev") page = Math.max(0, (parseInt(arg ?? "0", 10) || 0) - 1);
        else if (action === "next") page = (parseInt(arg ?? "0", 10) || 0) + 1;

        const payload = isClan ? await buildClanEmbed(guildId, clanTag, page) : await buildGlobalEmbed(guildId, page);
        return new Response(JSON.stringify({ type: RESP_UPDATE_MESSAGE, data: payload }), { headers: { "Content-Type": "application/json" } });
      }
      if (cid.startsWith("help:") && !cid.endsWith(":noop")) {
        const parts = cid.split(":");
        const action = parts[1];
        const arg = parts[2];
        let page = 0;
        if (action === "first") page = 0;
        else if (action === "last") page = HELP_SECTIONS.length - 1;
        else if (action === "prev") page = Math.max(0, (parseInt(arg ?? "0", 10) || 0) - 1);
        else if (action === "next") page = (parseInt(arg ?? "0", 10) || 0) + 1;
        const payload = buildHelpPayload(page);
        return new Response(JSON.stringify({ type: RESP_UPDATE_MESSAGE, data: payload }), { headers: { "Content-Type": "application/json" } });
      }
      if (cid.startsWith("war:decide:")) {
        return await handleWarDecide(interaction);
      }
      if (cid.startsWith("fam:view:")) {
        const guildId = interaction.guild_id ?? "";
        const tag = interaction.data?.values?.[0];
        const data = await buildClanDetailEmbed(tag, guildId);
        return new Response(JSON.stringify({ type: RESP_CHANNEL_MSG, data: { ...data, flags: 64 } }), { headers: { "Content-Type": "application/json" } });
      }
      if (cid.startsWith("fam:cat:")) {
        const guildId = interaction.guild_id ?? "";
        const catId = parseInt(cid.split(":")[2] ?? "0", 10);
        const data = await buildCategoryListPayload(guildId, catId);
        return new Response(JSON.stringify({ type: RESP_CHANNEL_MSG, data }), { headers: { "Content-Type": "application/json" } });
      }
      if (cid.startsWith("fam:info:")) {
        const guildId = interaction.guild_id ?? "";
        const infoId = parseInt(cid.split(":")[2] ?? "0", 10);
        const data = await buildInfoPayload(guildId, infoId);
        return new Response(JSON.stringify({ type: RESP_CHANNEL_MSG, data }), { headers: { "Content-Type": "application/json" } });
      }
      if (cid === "fam:stats") {
        const guildId = interaction.guild_id ?? "";
        const data = await buildFamilyStatsPayload(guildId);
        return new Response(JSON.stringify({ type: RESP_CHANNEL_MSG, data }), { headers: { "Content-Type": "application/json" } });
      }
      // Reorder: step 1 — user picked an item to move; show position picker
      // Reorder step 1 — picked a button; show unified position picker (cats + infos + stats).
      if (cid.startsWith("fam:reorder:pick:")) {
        const guildId = interaction.guild_id ?? "";
        const pickedValue = String(interaction.data?.values?.[0] ?? "");
        const sbR = adminClient();
        const [cats, infos, layout] = await Promise.all([
          sbR.from("family_categories").select("id,name,emoji,position").eq("guild_id", guildId).order("position").order("name")
            .then((r) => (r.data ?? []) as any[]),
          sbR.from("family_info_messages").select("id,key,label,emoji,position").eq("guild_id", guildId).order("position").order("id")
            .then((r) => (r.data ?? []) as any[]),
          sbR.from("family_dashboard_layout").select("stats_position,stats_enabled").eq("guild_id", guildId).maybeSingle()
            .then((r) => r.data as { stats_position: number; stats_enabled: boolean } | null),
        ]);
        type U = { value: string; label: string; pos: number };
        const merged: U[] = [
          ...cats.map((c) => ({ value: `cat:${c.id}`, label: c.name as string, pos: c.position ?? 0 })),
          ...infos.map((i) => ({ value: `info:${i.id}`, label: (i.label || i.key) as string, pos: i.position ?? 0 })),
        ];
        if (!layout || layout.stats_enabled !== false) {
          merged.push({ value: "stats", label: "Clan Statistics", pos: layout?.stats_position ?? 9999 });
        }
        merged.sort((a, b) => a.pos - b.pos);
        const picked = merged.find((x) => x.value === pickedValue);
        if (!picked) {
          return new Response(JSON.stringify({ type: RESP_UPDATE_MESSAGE, data: { content: "Item not found.", components: [], flags: 64 } }), { headers: { "Content-Type": "application/json" } });
        }
        const n = merged.length;
        const options = Array.from({ length: Math.min(n, 25) }, (_, i) => ({
          label: `Position ${i + 1}`,
          description: merged[i] ? `currently: ${merged[i].label.slice(0, 80)}` : undefined,
          value: String(i + 1),
        }));
        return new Response(JSON.stringify({
          type: RESP_UPDATE_MESSAGE,
          data: {
            content: `Moving **${picked.label}** — pick its new position in the unified button order:`,
            flags: 64,
            components: [{
              type: 1,
              components: [{
                type: 3,
                custom_id: `fam:reorder:apply:${pickedValue}`,
                placeholder: "Choose new position",
                options,
              }],
            }],
          },
        }), { headers: { "Content-Type": "application/json" } });
      }
      // Reorder step 2 — apply new global position; renumber ALL items 1..N across cats+infos+stats.
      if (cid.startsWith("fam:reorder:apply:")) {
        const guildId = interaction.guild_id ?? "";
        const pickedValue = cid.slice("fam:reorder:apply:".length); // "cat:123" | "info:45" | "stats"
        const target = parseInt(interaction.data?.values?.[0] ?? "1", 10);
        const sbR = adminClient();
        const [cats, infos, layout] = await Promise.all([
          sbR.from("family_categories").select("id,position").eq("guild_id", guildId).order("position").order("name")
            .then((r) => (r.data ?? []) as Array<{ id: number; position: number }>),
          sbR.from("family_info_messages").select("id,position").eq("guild_id", guildId).order("position").order("id")
            .then((r) => (r.data ?? []) as Array<{ id: number; position: number }>),
          sbR.from("family_dashboard_layout").select("stats_position,stats_enabled").eq("guild_id", guildId).maybeSingle()
            .then((r) => r.data as { stats_position: number; stats_enabled: boolean } | null),
        ]);
        type M = { value: string; pos: number };
        const merged: M[] = [
          ...cats.map((c) => ({ value: `cat:${c.id}`, pos: c.position ?? 0 })),
          ...infos.map((i) => ({ value: `info:${i.id}`, pos: i.position ?? 0 })),
        ];
        const statsIncluded = !layout || layout.stats_enabled !== false;
        if (statsIncluded) merged.push({ value: "stats", pos: layout?.stats_position ?? 9999 });
        merged.sort((a, b) => a.pos - b.pos);
        const fromIdx = merged.findIndex((x) => x.value === pickedValue);
        if (fromIdx < 0) {
          return new Response(JSON.stringify({ type: RESP_UPDATE_MESSAGE, data: { content: "Item not found.", components: [], flags: 64 } }), { headers: { "Content-Type": "application/json" } });
        }
        const [moved] = merged.splice(fromIdx, 1);
        const toIdx = Math.max(0, Math.min(merged.length, target - 1));
        merged.splice(toIdx, 0, moved);
        // Renumber across both tables and the stats layout row.
        for (let i = 0; i < merged.length; i++) {
          const newPos = i + 1;
          const v = merged[i].value;
          if (v === "stats") {
            await sbR.from("family_dashboard_layout").upsert(
              { guild_id: guildId, stats_position: newPos, stats_enabled: layout?.stats_enabled ?? true, updated_at: new Date().toISOString() },
              { onConflict: "guild_id" },
            );
          } else {
            const [t, idStr] = v.split(":");
            const table = t === "cat" ? "family_categories" : "family_info_messages";
            await sbR.from(table).update({ position: newPos }).eq("id", Number(idStr)).eq("guild_id", guildId);
          }
        }
        syncDashboardMessage(guildId).catch((e) => console.error("dashboard sync", e));
        return new Response(JSON.stringify({
          type: RESP_UPDATE_MESSAGE,
          data: { content: `✅ Moved to position **${toIdx + 1}** in the unified order. Dashboard refreshing…`, components: [], flags: 64 },
        }), { headers: { "Content-Type": "application/json" } });
      }
      if (cid.startsWith("coc:pick:")) {
        // coc:pick:<cmdName>:<targetUserOrEmpty>:<forUserId>
        const parts = cid.split(":");
        const cmdName = parts[2];
        const targetUser = parts[3] || undefined;
        const forUserId = parts[4];
        const caller = callerUserId(interaction);
        if (forUserId && caller !== forUserId) {
          return new Response(JSON.stringify({
            type: RESP_CHANNEL_MSG,
            data: { content: "⛔ Only the user who ran the command can pick.", flags: 64 },
          }), { headers: { "Content-Type": "application/json" } });
        }
        const tag = interaction.data?.values?.[0];
        const builder = COC_BUILDERS[cmdName];
        if (!builder || !tag) {
          return new Response(JSON.stringify({ type: 6 }), { headers: { "Content-Type": "application/json" } });
        }
        const guildId = interaction.guild_id ?? "";
        const appId = interaction.application_id;
        const token = interaction.token;
        runAfterResponse((async () => {
          try {
            const data = await builder(guildId, { tag, targetUser, caller });
            // Post the result as a normal (public) follow-up message.
            // Leave the ephemeral picker untouched so the caller can pick again.
            await followUpPayload(appId, token, { ...data, flags: 0 });
          } catch (e) {
            console.error("coc pick failed", e);
            await followUpPayload(appId, token, { content: `❌ ${e instanceof Error ? e.message : String(e)}`, flags: 64 });
          }
        })());
        return new Response(JSON.stringify({ type: 6 }), { headers: { "Content-Type": "application/json" } });
      }
      // /discord_link — user picked clan(s) from the select menu
      if (cid === "disclink:pick") {
        const guildId = interaction.guild_id ?? "";
        const appId = interaction.application_id;
        const token = interaction.token;
        const picked: string[] = (interaction.data?.values ?? []).map((v: string) => normalizeTag(v));
        runAfterResponse((async () => {
          try {
            const embeds = await buildDiscordLinkEmbeds(guildId, picked);
            // Send up to 10 embeds per follow-up
            for (let i = 0; i < embeds.length; i += 10) {
              await followUpPayload(appId, token, { embeds: embeds.slice(i, i + 10), flags: 64 });
            }
          } catch (e) {
            console.error("disclink failed", e);
            await followUpPayload(appId, token, { content: `❌ ${e instanceof Error ? e.message : String(e)}`, flags: 64 });
          }
        })());
        return new Response(JSON.stringify({ type: 6 }), { headers: { "Content-Type": "application/json" } });
      }
      // /myr — user picked an account from the select menu
      if (cid.startsWith("myr:pick:")) {
        const val: string = interaction.data?.values?.[0] ?? "";
        const [pickedUserId, idxStr] = val.split(":");
        const idx = parseInt(idxStr ?? "", 10);
        if (!pickedUserId || !Number.isFinite(idx)) {
          return new Response(JSON.stringify({ type: 6 }), { headers: { "Content-Type": "application/json" } });
        }
        const appId = interaction.application_id;
        const token = interaction.token;
        (async () => {
          try {
            const data = await fetchMyrData(pickedUserId);
            const acc = data?.accounts?.[idx];
            if (!acc) {
              await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}`, {
                method: "POST", headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ content: "❌ Account not found.", flags: 64 }),
              });
              return;
            }
            const resolvedUser = interaction.message?.interaction?.user
              ?? interaction.member?.user ?? interaction.user;
            const avatar = avatarUrlFor(pickedUserId, resolvedUser?.id === pickedUserId ? resolvedUser?.avatar : undefined);
            await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                embeds: [myrAccountDetailEmbed(acc, avatar)],
                components: [myrAccountButtonRow(acc)],
                flags: 64,
                allowed_mentions: { parse: [] },
              }),
            });
          } catch (e) {
            console.error("myr pick failed", e);
            await fetch(`https://discord.com/api/v10/webhooks/${appId}/${token}`, {
              method: "POST", headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ content: `❌ ${e instanceof Error ? e.message : String(e)}`, flags: 64 }),
            }).catch(() => {});
          }
        })();
        return new Response(JSON.stringify({ type: 6 }), { headers: { "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ type: 6 }), { headers: { "Content-Type": "application/json" } });
    } catch (e) {
      console.error("component handler error", e);
      return new Response(JSON.stringify({ type: 6 }), { headers: { "Content-Type": "application/json" } });
    }
  }

  if (interaction.type === APPLICATION_COMMAND) {
    const name = interaction.data.name;
    try {
      if (await isCommandDisabled(interaction.guild_id ?? "", name)) {
        return reply(`🚫 \`/${name}\` is disabled in this server.`);
      }
      switch (name) {
        case "command_toggle": return await handleCommandToggle(interaction);
        case "clan": return await handleClan(interaction);
        case "global": return await handleGlobal(interaction);
        case "top": return await handleTopOrLowest(interaction, false);
        case "lowest": return await handleTopOrLowest(interaction, true);
        case "player": return await handlePlayer(interaction);
        case "blacklist": return await handleListCmd(interaction, "blacklist");
        case "whitelist": return await handleListCmd(interaction, "whitelist");
        case "refresh": return await handleRefresh(interaction);
        case "link": return await handleLink(interaction);
        case "unlink": return await handleUnlink(interaction);
        case "profile": return await handleProfile(interaction);
        case "perm": return await handlePerm(interaction);
        case "war_track_setup": return await handleWarTrackSetup(interaction);
        case "setup_war_log_channel": return await handleSetupWarLogChannel(interaction);
        case "setup_war_reminder": return await handleSetupWarReminder(interaction);
        case "war_announcement": return await handleWarAnnouncement(interaction);
        case "th_emoji": return await handleThEmoji(interaction);
        case "war_track_list": return await handleWarTrackList(interaction);
        case "war_track_remove": return await handleWarTrackRemove(interaction);
        case "war_resend_result": return await handleWarResendResult(interaction);
        case "war_last_result": return await handleWarLastResult(interaction);
        case "force_reset": return await handleForceReset(interaction);
        case "donation_reset": return await handleDonationReset(interaction);
        case "family_category": return await handleFamilyCategory(interaction);
        case "family_info": return await handleFamilyInfo(interaction);
        case "family_dashboard_layout": return await handleFamilyDashboardLayout(interaction);
        case "family_clan": return await handleFamilyClan(interaction);
        case "family_clan_dashboard": return await handleFamilyDashboard(interaction);
        case "family_customize": return await handleFamilyCustomize(interaction);
        case "embed_editor": return await handleEmbedEditor(interaction);
        case "discord_link": return await handleDiscordLink(interaction);
        case "myr": return await handleMyr(interaction);
        case "help": return handleHelp(interaction);
        case "player_info": return await handleCocCmd(interaction, buildPlayerInfo);
        case "clan_info": return await handleCocCmd(interaction, buildClanInfo);
        case "current_war": return await handleCocCmd(interaction, buildCurrentWar);
        case "war_log": return await handleCocCmd(interaction, buildWarLog);
        case "clan_members": return await handleCocCmd(interaction, buildClanMembers);
        case "cwl": return await handleCocCmd(interaction, buildCwl);
        case "cwl_roster": return await handleCocCmd(interaction, buildCwlRoster);
        case "cwl_board": return await handleCocCmd(interaction, buildCwlBoard);
        case "capital_raids": return await handleCocCmd(interaction, buildCapitalRaids);
        case "compo": return await handleCocCmd(interaction, buildCompo);
        case "player_activity": return await handleCocCmd(interaction, buildPlayerActivity);
        case "player_joins": return await handleCocCmd(interaction, buildPlayerJoins);
        default: return reply(`Unknown command: ${name}`);
      }
    } catch (e) {
      console.error("handler error", e);
      return reply(`❌ Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return reply("Unsupported interaction type.");
});
