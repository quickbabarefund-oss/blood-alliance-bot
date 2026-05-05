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
import { syncGuildCommands, createMessageWithFile } from "../_shared/discord.ts";
import { COMMANDS } from "../_shared/commands.ts";
import { evaluateRules, buildResultEmbeds, parseCocTime, type CurrentWar } from "../_shared/war.ts";

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
const RESP_PONG = 1;
const RESP_CHANNEL_MSG = 4;
const RESP_DEFERRED = 5;
const RESP_UPDATE_MESSAGE = 7;

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
  (async () => {
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
  })();
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

  (async () => {
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

  const breaks = evaluateRules({ decision, endTime, ourMembers });
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
  })();
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

  (async () => {
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
  })();
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

  (async () => {
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

      // Trigger an immediate poll to re-baseline snapshots & refresh leaderboards
      try {
        await fetch(`${SUPABASE_URL}/functions/v1/poll-clans`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}` },
          body: clanTags.length === 1 ? JSON.stringify({ clan_tag: clanTags[0] }) : "{}",
        });
      } catch (e) { console.error("post-reset poll trigger failed", e); }

      const scope = clanArg ? `\`${clanTags[0]}\`` : `**all ${clanTags.length} tracked clan(s)**`;
      await followUp(appId, token, `✅ Donation totals reset to 0 for ${scope} (month \`${monthKey}\`). ${totalRows} player rows zeroed; leaderboard refreshing.`, true);
    } catch (e) {
      console.error("donation_reset failed", e);
      await followUp(appId, token, `❌ Reset failed: ${e instanceof Error ? e.message : String(e)}`, true);
    }
  })();
  return deferred(true);
}

// --- /help ---
function handleHelp(_interaction: any): Response {
  const sections: { title: string; lines: string[] }[] = [
    {
      title: "📊 Leaderboards & Stats",
      lines: [
        "`/top [clan] [count]` — Top donators this month",
        "`/lowest [clan] [count]` — Lowest donators this month",
        "`/player <tag>` — Player history & monthly totals",
        "`/refresh [clan]` — Force immediate poll & leaderboard refresh *(admin)*",
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
      title: "🔐 Permissions",
      lines: [
        "`/perm grant <command> <role>` — Allow a role to use a command *(admin)*",
        "`/perm revoke <command> <role>` — Revoke a role *(admin)*",
        "`/perm list` — Show per-command role overrides",
      ],
    },
  ];

  const embed = {
    title: "🤖 Bot Commands",
    description: "Here's everything I can do. Commands marked *(admin)* require server-admin or a granted role.",
    color: COLOR_BLURPLE,
    fields: sections.map((s) => ({ name: s.title, value: s.lines.join("\n"), inline: false })),
    footer: { text: "Tip: type / in chat to see all commands with autocomplete." },
  };
  return replyEmbed(embed, true);
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

// --- Server ---
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

  if (interaction.type === MESSAGE_COMPONENT) {
    try {
      const cid: string = interaction.data?.custom_id ?? "";
      // Formats:
      //   lb:clan:<GUILD>:<TAG>:first|prev:<n>|next:<n>|last
      //   lb:global:<GUILD>:first|prev:<n>|next:<n>|last
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
      if (cid.startsWith("war:decide:")) {
        return await handleWarDecide(interaction);
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
      switch (name) {
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
        case "force_reset": return await handleForceReset(interaction);
        case "donation_reset": return await handleDonationReset(interaction);
        case "help": return handleHelp(interaction);
        default: return reply(`Unknown command: ${name}`);
      }
    } catch (e) {
      console.error("handler error", e);
      return reply(`❌ Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return reply("Unsupported interaction type.");
});
