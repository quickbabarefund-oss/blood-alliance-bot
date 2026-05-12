// Handlers for CoC-data slash commands: /player_info, /clan_info, /current_war,
// /war_log, /clan_members, /cwl, /capital_raids
//
// Each builds a default embed, then runs it through applyTemplate so admins can
// customize via the /embed_editor web UI.
import { adminClient } from "./leaderboard.ts";
import { normalizeTag, postCoc, fetchClan, fetchPlayer } from "./coc.ts";
import { applyTemplate } from "./embed_templates.ts";
import { loadThEmojis, thEmoji, parseCocTime, clanProfileLink } from "./war.ts";

const COLOR = 0x5865F2;
const COLOR_GREEN = 0x57F287;
const COLOR_RED = 0xED4245;
const COLOR_GOLD = 0xF1B93B;

function tagNoHash(t: string) { return (t ?? "").replace(/^#/, "").trim().toUpperCase(); }
function ccPlayerLink(tag: string) { return `https://cc.fwafarm.com/cc_n/member.php?tag=${tagNoHash(tag)}`; }
function ccClanLink(tag: string) { return `https://cc.fwafarm.com/cc_n/clan.php?tag=${tagNoHash(tag)}`; }
function playerProfileLink(tag: string) { return `https://link.clashofclans.com/?action=OpenPlayerProfile&tag=${encodeURIComponent(tag.startsWith("#") ? tag : `#${tag}`)}`; }

// Resolve a tag from explicit arg, or from the user's coc_links (player or clan).
async function resolveTag(opts: {
  explicit?: string;
  userId?: string;
  fallbackUserId?: string;
}): Promise<string | null> {
  if (opts.explicit) return normalizeTag(opts.explicit);
  const uid = opts.userId ?? opts.fallbackUserId;
  if (!uid) return null;
  const sb = adminClient();
  const { data } = await sb.from("coc_links").select("player_tag").eq("user_id", uid).limit(1);
  return data?.[0]?.player_tag ? normalizeTag(data[0].player_tag) : null;
}

function errEmbed(msg: string) {
  return { title: "⚠️ Lookup failed", description: msg, color: COLOR_RED };
}

async function send(guildId: string, slot: string, baseEmbed: any, vars: Record<string, any>) {
  const { embed, content } = await applyTemplate(guildId, slot, baseEmbed, { vars, keepFields: true });
  return { embeds: [embed], content, allowed_mentions: { parse: [] } };
}

async function isFwa(tag: string): Promise<boolean> {
  try {
    const response = await fetch("https://fwastats.com/Clans.json");
    const fwaClans = await response.json();
    return fwaClans.includes(tag.startsWith("#") ? tag : `#${tag}`);
  } catch {
    return false;
  }
}

// ---------- /player_info ----------
export async function buildPlayerInfo(guildId: string, args: { tag?: string; targetUser?: string; caller: string }) {
  const tag = await resolveTag({ explicit: args.tag, userId: args.targetUser, fallbackUserId: args.caller });
  if (!tag) return { embeds: [errEmbed("Provide a `tag:` or link a player with `/link player`.")], flags: 64 };
  let p: any;
  try { p = await fetchPlayer(tag); } catch (e) {
    return { embeds: [errEmbed(`\`${tag}\`: ${e instanceof Error ? e.message : String(e)}`)], flags: 64 };
  }
  const heroes = (p.heroes ?? []).map((h: any) => `${h.name.split(" ").map((w: string) => w[0]).join("")} **${h.level}**/${h.maxLevel}`).join(" • ") || "—";
  const fields = [
    { name: "🏠 Town Hall", value: `**${p.townHallLevel ?? "—"}**`, inline: true },
    { name: "🏆 Trophies", value: `${p.trophies ?? 0} (best ${p.bestTrophies ?? 0})`, inline: true },
    { name: "🎖️ League", value: p.league?.name ?? "Unranked", inline: true },
    { name: "⭐ War Stars", value: String(p.warStars ?? 0), inline: true },
    { name: "🎁 Donated", value: String(p.donations ?? 0), inline: true },
    { name: "📥 Received", value: String(p.donationsReceived ?? 0), inline: true },
    { name: "🏰 Clan", value: p.clan ? `**${p.clan.name}** \`${p.clan.tag}\` (${p.role ?? "—"})` : "_No clan_", inline: false },
    { name: "🦸 Heroes", value: heroes, inline: false },
    { name: "🔗 Links", value: `[ChocolateClash](${ccPlayerLink(tag)}) • [In-game](${playerProfileLink(tag)})`, inline: false },
  ];
  const base = {
    title: `${p.name ?? tag}`,
    description: `\`${tag}\` • XP **${p.expLevel ?? "—"}**`,
    color: COLOR,
    thumbnail: p.league?.iconUrls?.medium ? { url: p.league.iconUrls.medium } : undefined,
    fields,
    footer: { text: "Live from Clash of Clans" },
  };
  return await send(guildId, "player_info", base, { name: p.name, tag, th: p.townHallLevel, trophies: p.trophies, clan: p.clan?.name ?? "" });
}

// ---------- /clan_info ----------
export async function buildClanInfo(guildId: string, args: { tag?: string; targetUser?: string; caller: string }) {
  const tag = await resolveTag({ explicit: args.tag, userId: args.targetUser, fallbackUserId: args.caller });
  if (!tag) return { embeds: [errEmbed("Provide a `tag:` or link a clan with `/link clan`.")], flags: 64 };
  let c: any;
  try { c = await fetchClan(tag); } catch (e) {
    return { embeds: [errEmbed(`\`${tag}\`: ${e instanceof Error ? e.message : String(e)}`)], flags: 64 };
  }
  const fwa = await isFwa(tag);
  const fields = [
    { name: "🏷️ Tag", value: `\`${c.tag ?? tag}\``, inline: true },
    { name: "🏆 Level", value: String(c.clanLevel ?? "—"), inline: true },
    { name: "👥 Members", value: `${c.members ?? 0}/50`, inline: true },
    { name: "🛡️ Trophies", value: String(c.clanPoints ?? 0), inline: true },
    { name: "🎖️ War League", value: c.warLeague?.name ?? "—", inline: true },
    { name: "🔥 Win Streak", value: String(c.warWinStreak ?? 0), inline: true },
    { name: "⚔️ War Record", value: `W **${c.warWins ?? 0}** • T ${c.warTies ?? 0} • L ${c.warLosses ?? 0}`, inline: true },
    { name: "🌍 Location", value: c.location?.name ?? "—", inline: true },
    { name: "📜 Type", value: c.type ?? "—", inline: true },
    { name: "🔗 Links", value: `[ChocolateClash](${ccClanLink(tag)}) • [In-game](${clanProfileLink(tag)}) ${fwa ? "• 🛡️ **FWA**" : ""}`, inline: false },
  ];
  if (c.description) fields.push({ name: "ℹ️ Description", value: String(c.description).slice(0, 500), inline: false });
  const base = {
    title: `🏰 ${c.name ?? tag}`,
    color: COLOR,
    thumbnail: c.badgeUrls?.medium ? { url: c.badgeUrls.medium } : undefined,
    fields,
    footer: { text: "Live from Clash of Clans" },
  };
  return await send(guildId, "clan_info", base, { name: c.name, tag, level: c.clanLevel, members: c.members });
}

// ---------- /current_war ----------
export async function buildCurrentWar(guildId: string, args: { tag?: string; targetUser?: string; caller: string }) {
  const tag = await resolveTag({ explicit: args.tag, userId: args.targetUser, fallbackUserId: args.caller });
  if (!tag) return { embeds: [errEmbed("Provide a `tag:` or link a clan with `/link clan`.")], flags: 64 };
  let cw: any;
  try { cw = await postCoc({ action: "current_war", tag }); } catch (e) {
    return { embeds: [errEmbed(`\`${tag}\`: ${e instanceof Error ? e.message : String(e)}`)], flags: 64 };
  }
  if (!cw || cw.state === "notInWar" || !cw.clan || !cw.opponent) {
    return await send(guildId, "current_war", {
      title: "🕊️ Not in war", description: `\`${tag}\` is not currently in a war.`, color: COLOR_GOLD,
    }, { tag });
  }
  const ours = cw.clan, opp = cw.opponent;
  const end = parseCocTime(cw.endTime ?? "")?.getTime();
  const start = parseCocTime(cw.startTime ?? "")?.getTime();
  const stateLabel = cw.state === "preparation" ? "📦 Preparation" : cw.state === "inWar" ? "⚔️ Battle Day" : "🏁 Ended";
  const fields = [
    { name: "Status", value: stateLabel, inline: true },
    { name: "Team Size", value: `${cw.teamSize ?? "—"} vs ${cw.teamSize ?? "—"}`, inline: true },
    { name: cw.state === "preparation" ? "Starts" : "Ends", value: cw.state === "preparation"
        ? (start ? `<t:${Math.floor(start/1000)}:R>` : "—")
        : (end ? `<t:${Math.floor(end/1000)}:R>` : "—"), inline: true },
    { name: "⭐ Stars", value: `**${ours.stars ?? 0}** vs ${opp.stars ?? 0}`, inline: true },
    { name: "💥 Destruction", value: `**${(ours.destructionPercentage ?? 0).toFixed?.(2) ?? 0}%** vs ${(opp.destructionPercentage ?? 0).toFixed?.(2) ?? 0}%`, inline: true },
    { name: "🗡️ Attacks Used", value: `${ours.attacks ?? 0}/${(cw.teamSize ?? 0) * 2}`, inline: true },
    { name: "🔗 Links", value: `[Us — ChocolateClash](${ccClanLink(tag)}) • [Opponent — ChocolateClash](${ccClanLink(opp.tag)})`, inline: false },
  ];
  const base = {
    title: `${ours.name} vs ${opp.name}`,
    description: `[${ours.name} (\`${ours.tag}\`)](${clanProfileLink(ours.tag)}) **VS** [${opp.name} (\`${opp.tag}\`)](${clanProfileLink(opp.tag)})`,
    color: COLOR,
    thumbnail: ours.badgeUrls?.medium ? { url: ours.badgeUrls.medium } : undefined,
    fields,
  };
  return await send(guildId, "current_war", base, { our: ours.name, opponent: opp.name, tag });
}

// ---------- /war_log ----------
export async function buildWarLog(guildId: string, args: { tag?: string; targetUser?: string; caller: string }) {
  const tag = await resolveTag({ explicit: args.tag, userId: args.targetUser, fallbackUserId: args.caller });
  if (!tag) return { embeds: [errEmbed("Provide a `tag:` or link a clan with `/link clan`.")], flags: 64 };
  let log: any;
  try { log = await postCoc({ action: "war_log", tag }); } catch (e) {
    return { embeds: [errEmbed(`\`${tag}\`: ${e instanceof Error ? e.message : String(e)}`)], flags: 64 };
  }
  const items: any[] = (log?.items ?? []).slice(0, 10);
  if (!items.length) {
    return await send(guildId, "war_log", { title: "📜 War Log", description: "War log is private or empty.", color: COLOR_GOLD }, { tag });
  }
  const lines = items.map((w) => {
    const r = w.result === "win" ? "🟢 W" : w.result === "lose" ? "🔴 L" : "🟡 T";
    const opp = w.opponent?.name ?? "?";
    const oppTag = w.opponent?.tag ?? "";
    const ourS = w.clan?.stars ?? 0, oppS = w.opponent?.stars ?? 0;
    const ourD = (w.clan?.destructionPercentage ?? 0).toFixed?.(1) ?? 0;
    const oppD = (w.opponent?.destructionPercentage ?? 0).toFixed?.(1) ?? 0;
    return `${r} vs **${opp}** \`${oppTag}\` — ⭐${ourS}-${oppS} • 💥${ourD}%-${oppD}% (${w.teamSize}v${w.teamSize})`;
  });
  const wins = items.filter(i => i.result === "win").length;
  const losses = items.filter(i => i.result === "lose").length;
  const ties = items.filter(i => i.result === "tie").length;
  const base = {
    title: `📜 Last ${items.length} Wars`,
    description: lines.join("\n").slice(0, 4000),
    color: COLOR,
    fields: [
      { name: "Record", value: `🟢 ${wins}  🔴 ${losses}  🟡 ${ties}`, inline: true },
      { name: "🔗 ChocolateClash", value: `[Open](${ccClanLink(tag)})`, inline: true },
    ],
  };
  return await send(guildId, "war_log", base, { tag, wins, losses });
}

// ---------- /clan_members ----------
export async function buildClanMembers(guildId: string, args: { tag?: string; targetUser?: string; caller: string }) {
  const tag = await resolveTag({ explicit: args.tag, userId: args.targetUser, fallbackUserId: args.caller });
  if (!tag) return { embeds: [errEmbed("Provide a `tag:` or link a clan with `/link clan`.")], flags: 64 };
  let c: any;
  try { c = await fetchClan(tag); } catch (e) {
    return { embeds: [errEmbed(`\`${tag}\`: ${e instanceof Error ? e.message : String(e)}`)], flags: 64 };
  }
  const thMap = await loadThEmojis();
  const members: any[] = (c.memberList ?? []).slice().sort((a: any, b: any) => (b.donations ?? 0) - (a.donations ?? 0));
  if (!members.length) {
    return await send(guildId, "clan_members", { title: `👥 ${c.name}`, description: "No members.", color: COLOR_GOLD }, { tag });
  }
  const lines = members.slice(0, 25).map((m, i) => {
    const role = m.role === "leader" ? "👑" : m.role === "coLeader" ? "🥈" : m.role === "admin" ? "🎖️" : "•";
    return `\`${String(i+1).padStart(2)}.\` ${role} ${thEmoji(thMap, m.townHallLevel)} **${m.name}** \`${m.tag}\` — 🎁${m.donations ?? 0} / 📥${m.donationsReceived ?? 0}`;
  });
  const base = {
    title: `👥 ${c.name ?? tag} — ${members.length}/50`,
    description: lines.join("\n").slice(0, 4000),
    color: COLOR,
    thumbnail: c.badgeUrls?.medium ? { url: c.badgeUrls.medium } : undefined,
    fields: [{ name: "🔗 ChocolateClash", value: `[Open](${ccClanLink(tag)})`, inline: true }],
    footer: { text: members.length > 25 ? `Showing top 25 of ${members.length} by donations` : "Sorted by donations" },
  };
  return await send(guildId, "clan_members", base, { tag, name: c.name });
}

// ---------- /cwl ----------
export async function buildCwl(guildId: string, args: { tag?: string; targetUser?: string; caller: string }) {
  const tag = await resolveTag({ explicit: args.tag, userId: args.targetUser, fallbackUserId: args.caller });
  if (!tag) return { embeds: [errEmbed("Provide a `tag:` or link a clan with `/link clan`.")], flags: 64 };
  let g: any;
  try { g = await postCoc({ action: "cwl_group", tag }); } catch (e) {
    return { embeds: [errEmbed(`\`${tag}\`: ${e instanceof Error ? e.message : String(e)}`)], flags: 64 };
  }
  if (!g || g.state === "notInWar") {
    return await send(guildId, "cwl", {
      title: "🛡️ Clan War League",
      description: g?.reason ?? `\`${tag}\` is not currently in CWL.`,
      color: COLOR_GOLD,
    }, { tag });
  }
  const round = (g.rounds ?? []).filter((r: any) => (r.warTags ?? []).some((t: string) => t !== "#0")).length;
  const clans: any[] = g.clans ?? [];
  const lines = clans.map((cl, i) => `\`${i+1}.\` **${cl.name}** \`${cl.tag}\``).join("\n").slice(0, 1024) || "—";
  const base = {
    title: `🛡️ CWL — ${g.season ?? "current"}`,
    description: `Round **${round}/${(g.rounds ?? []).length}** • Size ${g.teamSize ?? "—"}`,
    color: COLOR,
    fields: [
      { name: "Group", value: lines, inline: false },
      { name: "🔗 ChocolateClash", value: `[Open](${ccClanLink(tag)})`, inline: true },
    ],
  };
  return await send(guildId, "cwl", base, { tag, season: g.season });
}

// ---------- /capital_raids ----------
export async function buildCapitalRaids(guildId: string, args: { tag?: string; targetUser?: string; caller: string }) {
  const tag = await resolveTag({ explicit: args.tag, userId: args.targetUser, fallbackUserId: args.caller });
  if (!tag) return { embeds: [errEmbed("Provide a `tag:` or link a clan with `/link clan`.")], flags: 64 };
  let r: any;
  try { r = await postCoc({ action: "capital_raids", tag }); } catch (e) {
    return { embeds: [errEmbed(`\`${tag}\`: ${e instanceof Error ? e.message : String(e)}`)], flags: 64 };
  }
  const last = (r?.items ?? [])[0];
  if (!last) {
    return await send(guildId, "capital_raids", { title: "🏯 Capital Raids", description: "No raid data found.", color: COLOR_GOLD }, { tag });
  }
  const start = parseCocTime(last.startTime)?.getTime();
  const end = parseCocTime(last.endTime)?.getTime();
  const top: any[] = (last.members ?? []).slice().sort((a: any, b: any) => (b.capitalResourcesLooted ?? 0) - (a.capitalResourcesLooted ?? 0)).slice(0, 5);
  const topLines = top.map((m, i) => `\`${i+1}.\` **${m.name}** — 💰 ${m.capitalResourcesLooted?.toLocaleString?.() ?? m.capitalResourcesLooted} (${m.attacks ?? 0}/${m.attackLimit ?? 0})`).join("\n") || "—";
  const fields = [
    { name: "🗓️ Weekend", value: `${start ? `<t:${Math.floor(start/1000)}:D>` : "—"} → ${end ? `<t:${Math.floor(end/1000)}:D>` : "—"}`, inline: false },
    { name: "💰 Capital Loot", value: (last.capitalTotalLoot ?? 0).toLocaleString(), inline: true },
    { name: "✅ Raids", value: String(last.raidsCompleted ?? 0), inline: true },
    { name: "💥 Districts", value: String(last.enemyDistrictsDestroyed ?? 0), inline: true },
    { name: "🗡️ Attacks", value: `${last.totalAttacks ?? 0}`, inline: true },
    { name: "🏆 Offensive Reward", value: String(last.offensiveReward ?? 0), inline: true },
    { name: "🛡️ Defensive Reward", value: String(last.defensiveReward ?? 0), inline: true },
    { name: "🥇 Top Raiders", value: topLines, inline: false },
    { name: "🔗 ChocolateClash", value: `[Open](${ccClanLink(tag)})`, inline: true },
  ];
  const base = { title: "🏯 Capital Raid Weekend", color: COLOR, fields };
  return await send(guildId, "capital_raids", base, { tag, loot: last.capitalTotalLoot });
}
