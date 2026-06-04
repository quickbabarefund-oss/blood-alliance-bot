// Handlers for CoC-data slash commands: /player_info, /clan_info, /current_war,
// /war_log, /clan_members, /cwl, /capital_raids
//
// Each builds a default embed, then runs it through applyTemplate so admins can
// customize via the /embed_editor web UI.
import { adminClient } from "./leaderboard.ts";
import { normalizeTag, postCoc, fetchClan, fetchPlayer } from "./coc.ts";
import { applyTemplate } from "./embed_templates.ts";
import { loadThEmojis, thEmoji, parseCocTime, clanProfileLink, compositionLine, isFwaMatch } from "./war.ts";
import { fetchFwa, fwaVerdictField } from "./fwa_points.ts";



const COLOR = 0x5865F2;
const COLOR_GREEN = 0x57F287;
const COLOR_RED = 0xED4245;
const COLOR_GOLD = 0xF1B93B;

function tagNoHash(t: string) { return (t ?? "").replace(/^#/, "").trim().toUpperCase(); }
function ccPlayerLink(tag: string) { return `https://cc.fwafarm.com/cc_n/member.php?tag=${tagNoHash(tag)}`; }
function ccClanLink(tag: string) { return `https://cc.fwafarm.com/cc_n/clan.php?tag=${tagNoHash(tag)}`; }
function playerProfileLink(tag: string) { return `https://link.clashofclans.com/?action=OpenPlayerProfile&tag=${encodeURIComponent(tag.startsWith("#") ? tag : `#${tag}`)}`; }

// Live-fetch all player tags linked to a Discord user from the CC proxy.
// Falls back to the cached coc_links table if the proxy is unreachable.
export async function fetchLiveUserLinks(userId: string): Promise<Array<{ tag: string; name?: string }>> {
  try {
    const res: any = await postCoc({ action: "get", type: "player", filters: { user_id: String(userId) } });
    const items: any[] = Array.isArray(res) ? res : (res?.items ?? res?.links ?? (res ? [res] : []));
    const out: Array<{ tag: string; name?: string }> = [];
    for (const it of items) {
      const t = it?.tag ?? it?.player_tag;
      if (t) out.push({ tag: normalizeTag(t), name: it?.name ?? it?.player_name });
    }
    if (out.length) return out;
  } catch (_e) { /* fall through to cache */ }
  const sb = adminClient();
  const { data } = await sb.from("coc_links").select("player_tag").eq("user_id", String(userId));
  return (data ?? []).map((r: any) => ({ tag: normalizeTag(r.player_tag) }));
}

// Resolve Discord user_id for a list of CoC player tags.
// 1) Reads cached `coc_links` rows.
// 2) For tags missing from cache, live-queries the CC proxy and upserts results.
// Returns a map: { "#PLAYER": "discord_user_id", ... } (omits unlinked tags).
export async function resolveLinksForTags(tags: string[]): Promise<Record<string, string>> {
  if (!tags?.length) return {};
  const sb = adminClient();
  const norm = Array.from(new Set(tags.map(normalizeTag)));
  const out: Record<string, string> = {};
  const { data } = await sb.from("coc_links").select("player_tag,user_id").in("player_tag", norm);
  for (const r of (data ?? []) as { player_tag: string; user_id: string }[]) {
    if (r.user_id) out[r.player_tag] = r.user_id;
  }
  const missing = norm.filter((t) => !out[t]);
  if (!missing.length) return out;

  const upserts: Array<{ player_tag: string; user_id: string; refreshed_at: string }> = [];
  const CONCURRENCY = 6;
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, missing.length) }, async () => {
    while (idx < missing.length) {
      const t = missing[idx++];
      try {
        const res: any = await postCoc({ action: "get", type: "player", filters: { tag: t } });
        const items: any[] = Array.isArray(res) ? res : (res?.items ?? res?.links ?? (res ? [res] : []));
        for (const it of items) {
          const uid = it?.user_id ?? it?.userId ?? it?.discord_id;
          if (uid) {
            out[t] = String(uid);
            upserts.push({ player_tag: t, user_id: String(uid), refreshed_at: new Date().toISOString() });
            break;
          }
        }
      } catch (_e) { /* per-tag failure ignored */ }
    }
  }));
  if (upserts.length) {
    try { await sb.from("coc_links").upsert(upserts); } catch (e) { console.error("coc_links upsert", e); }
  }
  return out;
}

// Resolve a tag from explicit arg, or from the user's links (live from proxy).
async function resolveTag(opts: {
  explicit?: string;
  userId?: string;
  fallbackUserId?: string;
}): Promise<string | null> {
  if (opts.explicit) return normalizeTag(opts.explicit);
  const uid = opts.userId ?? opts.fallbackUserId;
  if (!uid) return null;
  const links = await fetchLiveUserLinks(uid);
  return links[0]?.tag ?? null;
}

// Resolve a CLAN tag for clan-context commands.
// - If `explicit` is passed: try as clan tag first; if not a clan, treat as
//   player tag and return that player's current clan tag.
// - Otherwise: pull the user's linked player tag(s) and return their clan.
async function resolveClanTag(opts: {
  explicit?: string;
  userId?: string;
  fallbackUserId?: string;
}): Promise<{ tag: string | null; error?: string }> {
  if (opts.explicit) {
    const t = normalizeTag(opts.explicit);
    try {
      await fetchClan(t);
      return { tag: t };
    } catch (_e) {
      // Not a clan — maybe it's a player tag. Look up player → clan.
      try {
        const p: any = await fetchPlayer(t);
        if (p?.clan?.tag) return { tag: normalizeTag(p.clan.tag) };
        return { tag: null, error: `\`${t}\` is a player not in any clan.` };
      } catch (e) {
        return { tag: null, error: `\`${t}\`: ${e instanceof Error ? e.message : String(e)}` };
      }
    }
  }
  const uid = opts.userId ?? opts.fallbackUserId;
  if (!uid) return { tag: null };
  const links = await fetchLiveUserLinks(uid);
  const playerTag = links[0]?.tag;
  if (!playerTag) return { tag: null };
  try {
    const p: any = await fetchPlayer(playerTag);
    if (p?.clan?.tag) return { tag: normalizeTag(p.clan.tag) };
    return { tag: null, error: `Linked player \`${playerTag}\` is not in any clan.` };
  } catch (e) {
    return { tag: null, error: `\`${playerTag}\`: ${e instanceof Error ? e.message : String(e)}` };
  }
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
  const r = await resolveClanTag({ explicit: args.tag, userId: args.targetUser, fallbackUserId: args.caller });
  const tag = r.tag; if (!tag) return { embeds: [errEmbed(r.error ?? "Provide a `tag:` or link a player with `/link player`.")], flags: 64 };
  // tag check above
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
  const rt = await resolveClanTag({ explicit: args.tag, userId: args.targetUser, fallbackUserId: args.caller });
  const tag = rt.tag; if (!tag) return { embeds: [errEmbed(rt.error ?? "Provide a `tag:` or link a player with `/link player`.")], flags: 64 };
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
  const thMap = await loadThEmojis();
  const fields = [
    { name: "Status", value: stateLabel, inline: true },
    { name: "Team Size", value: `${cw.teamSize ?? "—"} vs ${cw.teamSize ?? "—"}`, inline: true },
    { name: cw.state === "preparation" ? "Starts" : "Ends", value: cw.state === "preparation"
        ? (start ? `<t:${Math.floor(start/1000)}:R>` : "—")
        : (end ? `<t:${Math.floor(end/1000)}:R>` : "—"), inline: true },
    { name: "⭐ Stars", value: `**${ours.stars ?? 0}** vs ${opp.stars ?? 0}`, inline: true },
    { name: "💥 Destruction", value: `**${(ours.destructionPercentage ?? 0).toFixed?.(2) ?? 0}%** vs ${(opp.destructionPercentage ?? 0).toFixed?.(2) ?? 0}%`, inline: true },
    { name: "🗡️ Attacks Used", value: `${ours.attacks ?? 0}/${(cw.teamSize ?? 0) * 2}`, inline: true },
    { name: `🏠 ${ours.name} Composition`, value: compositionLine(ours.members, thMap), inline: false },
    { name: `🏠 ${opp.name} Composition`, value: compositionLine(opp.members, thMap), inline: false },
    { name: "🔗 Links", value: `[Us — ChocolateClash](${ccClanLink(tag)}) • [Opponent — ChocolateClash](${ccClanLink(opp.tag)})`, inline: false },
  ];

  // FWA verdict: only meaningful for FWA matches. Prefer persisted verdict on
  // the wars row (war-poll keeps it fresh) and fall back to a live fetch.
  try {
    const isFwa = await isFwaMatch(tag, opp.tag);
    if (isFwa) {
      const sb = adminClient();
      const { data: warRow } = await sb.from("wars")
        .select("fwa_decision,fwa_reason,fwa_winner_name,fwa_winner_tag,fwa_war_id")
        .eq("guild_id", guildId).eq("clan_tag", tag).eq("opponent_tag", opp.tag)
        .order("created_at", { ascending: false }).limit(1).maybeSingle();
      if (warRow?.fwa_decision) {
        fields.splice(3, 0, fwaVerdictField("ok", {
          winnerName: warRow.fwa_winner_name ?? "",
          winnerTag: warRow.fwa_winner_tag ?? "",
          decision: warRow.fwa_decision as "win" | "lose",
          reason: warRow.fwa_reason ?? "",
          warId: warRow.fwa_war_id ?? null,
          winCalculatorUrl: `https://points.fwafarm.com/clan?tag=${tagNoHash(tag)}`,
        }, tag));
      } else {
        const { status, rec } = await fetchFwa(tag);
        fields.splice(3, 0, fwaVerdictField(status, rec, tag));
      }
    }
  } catch (e) { console.error("fwa verdict lookup failed", e); }


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
  const rt = await resolveClanTag({ explicit: args.tag, userId: args.targetUser, fallbackUserId: args.caller });
  const tag = rt.tag; if (!tag) return { embeds: [errEmbed(rt.error ?? "Provide a `tag:` or link a player with `/link player`.")], flags: 64 };
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
  const rt = await resolveClanTag({ explicit: args.tag, userId: args.targetUser, fallbackUserId: args.caller });
  const tag = rt.tag; if (!tag) return { embeds: [errEmbed(rt.error ?? "Provide a `tag:` or link a player with `/link player`.")], flags: 64 };
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
  const rt = await resolveClanTag({ explicit: args.tag, userId: args.targetUser, fallbackUserId: args.caller });
  const tag = rt.tag; if (!tag) return { embeds: [errEmbed(rt.error ?? "Provide a `tag:` or link a player with `/link player`.")], flags: 64 };
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
  const rt = await resolveClanTag({ explicit: args.tag, userId: args.targetUser, fallbackUserId: args.caller });
  const tag = rt.tag; if (!tag) return { embeds: [errEmbed(rt.error ?? "Provide a `tag:` or link a player with `/link player`.")], flags: 64 };
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

// ---------- /compo ----------
export async function buildCompo(guildId: string, args: { tag?: string; targetUser?: string; caller: string }) {
  const rt = await resolveClanTag({ explicit: args.tag, userId: args.targetUser, fallbackUserId: args.caller });
  const tag = rt.tag; if (!tag) return { embeds: [errEmbed(rt.error ?? "Provide a `tag:` or link a player with `/link player`.")], flags: 64 };
  let c: any;
  try { c = await fetchClan(tag); } catch (e) {
    return { embeds: [errEmbed(`\`${tag}\`: ${e instanceof Error ? e.message : String(e)}`)], flags: 64 };
  }
  const thMap = await loadThEmojis();
  const members: any[] = c.memberList ?? [];
  if (!members.length) {
    return await send(guildId, "compo", { title: `🏰 ${c.name ?? tag}`, description: "No members.", color: COLOR_GOLD }, { tag });
  }
  // Count by TH level
  const counts = new Map<number, number>();
  for (const m of members) {
    const th = m.townHallLevel ?? 0;
    counts.set(th, (counts.get(th) ?? 0) + 1);
  }
  const sorted = Array.from(counts.entries()).sort((a, b) => b[0] - a[0]);
  const total = members.length;
  const maxCount = Math.max(...counts.values());
  const lines = sorted.map(([th, n]) => {
    const pct = ((n / total) * 100).toFixed(1);
    const barLen = Math.max(1, Math.round((n / maxCount) * 12));
    const bar = "█".repeat(barLen) + "░".repeat(12 - barLen);
    return `${thEmoji(thMap, th)} **TH${th}** \`${bar}\` **${n}** (${pct}%)`;
  });
  const avgTh = (members.reduce((s, m) => s + (m.townHallLevel ?? 0), 0) / total).toFixed(2);
  const base = {
    title: `🏰 ${c.name ?? tag} — Composition`,
    description: lines.join("\n"),
    color: COLOR,
    thumbnail: c.badgeUrls?.medium ? { url: c.badgeUrls.medium } : undefined,
    fields: [
      { name: "👥 Members", value: `${total}/50`, inline: true },
      { name: "📊 Avg TH", value: avgTh, inline: true },
      { name: "🏆 Top TH", value: `TH${sorted[0]?.[0] ?? "—"}`, inline: true },
      { name: "🔗 Links", value: `[ChocolateClash](${ccClanLink(tag)}) • [In-game](${clanProfileLink(tag)})`, inline: false },
    ],
    footer: { text: "Live from Clash of Clans" },
  };
  return await send(guildId, "compo", base, { tag, name: c.name, members: total, avg_th: avgTh });
}

// ---------- /cwl_roster ----------
// Lists every clan in the current CWL group with its full roster (TH + name + tag).
export async function buildCwlRoster(guildId: string, args: { tag?: string; targetUser?: string; caller: string }) {
  const rt = await resolveClanTag({ explicit: args.tag, userId: args.targetUser, fallbackUserId: args.caller });
  const tag = rt.tag; if (!tag) return { embeds: [errEmbed(rt.error ?? "Provide a `tag:` or link a player with `/link player`.")], flags: 64 };
  let g: any;
  try { g = await postCoc({ action: "cwl_group", tag }); } catch (e) {
    return { embeds: [errEmbed(`\`${tag}\`: ${e instanceof Error ? e.message : String(e)}`)], flags: 64 };
  }
  if (!g || g.state === "notInWar" || !g.clans?.length) {
    return { embeds: [{ title: "🛡️ CWL Roster", description: g?.reason ?? `\`${tag}\` is not currently in CWL.`, color: COLOR_GOLD }] };
  }
  const thMap = await loadThEmojis();
  const clans: any[] = g.clans ?? [];
  const header = {
    title: `🛡️ CWL Roster — ${g.season ?? "current"}`,
    description: `**${clans.length}** clans • War size **${g.teamSize ?? clans[0]?.members?.length ?? "—"}**`,
    color: COLOR,
  };
  const embeds: any[] = [header];
  for (const cl of clans.slice(0, 9)) {
    const members: any[] = (cl.members ?? []).slice().sort((a: any, b: any) => (b.townHallLevel ?? 0) - (a.townHallLevel ?? 0));
    const counts = new Map<number, number>();
    for (const m of members) counts.set(m.townHallLevel ?? 0, (counts.get(m.townHallLevel ?? 0) ?? 0) + 1);
    const compoLine = Array.from(counts.entries()).sort((a, b) => b[0] - a[0])
      .map(([th, n]) => `${thEmoji(thMap, th)}×${n}`).join(" ");
    const lines = members.map((m, i) =>
      `\`${String(i + 1).padStart(2)}.\` ${thEmoji(thMap, m.townHallLevel)} **${m.name}** \`${m.tag}\``
    );
    const fields: any[] = [];
    if (compoLine) fields.push({ name: "📊 TH Composition", value: compoLine, inline: false });
    let buf = "", part = 1;
    for (const ln of lines) {
      if (buf.length + ln.length + 1 > 1000) {
        fields.push({ name: part === 1 ? `Roster (${members.length})` : `Roster (cont. ${part})`, value: buf, inline: false });
        buf = ln; part++;
      } else { buf = buf ? `${buf}\n${ln}` : ln; }
    }
    if (buf) fields.push({ name: part === 1 ? `Roster (${members.length})` : `Roster (cont. ${part})`, value: buf, inline: false });
    embeds.push({
      title: `🏰 ${cl.name} \`${cl.tag}\``,
      url: clanProfileLink(cl.tag),
      color: COLOR,
      thumbnail: cl.badgeUrls?.medium ? { url: cl.badgeUrls.medium } : undefined,
      fields,
    });
  }
  return { embeds, allowed_mentions: { parse: [] } };
}

// ---------- /cwl_board ----------
// Computes a CWL leaderboard by fetching every round war and tallying stars/dest%/attacks/W-L-D per clan.
export async function buildCwlBoard(guildId: string, args: { tag?: string; targetUser?: string; caller: string }) {
  const rt = await resolveClanTag({ explicit: args.tag, userId: args.targetUser, fallbackUserId: args.caller });
  const tag = rt.tag; if (!tag) return { embeds: [errEmbed(rt.error ?? "Provide a `tag:` or link a player with `/link player`.")], flags: 64 };
  let g: any;
  try { g = await postCoc({ action: "cwl_group", tag }); } catch (e) {
    return { embeds: [errEmbed(`\`${tag}\`: ${e instanceof Error ? e.message : String(e)}`)], flags: 64 };
  }
  if (!g || g.state === "notInWar" || !g.clans?.length) {
    return { embeds: [{ title: "🛡️ CWL Board", description: g?.reason ?? `\`${tag}\` is not currently in CWL.`, color: COLOR_GOLD }] };
  }
  const clans: any[] = g.clans ?? [];
  type Stats = { name: string; tag: string; badge?: string; w: number; l: number; d: number; stars: number; dest: number; attacks: number; rounds: number };
  const stats = new Map<string, Stats>();
  for (const c of clans) stats.set(c.tag, {
    name: c.name, tag: c.tag, badge: c.badgeUrls?.medium,
    w: 0, l: 0, d: 0, stars: 0, dest: 0, attacks: 0, rounds: 0,
  });

  const rounds: any[] = (g.rounds ?? []).filter((r: any) => (r.warTags ?? []).some((t: string) => t && t !== "#0"));
  let currentRound = 0;
  for (let ri = 0; ri < rounds.length; ri++) {
    const tags = (rounds[ri].warTags ?? []).filter((t: string) => t && t !== "#0");
    const wars = await Promise.all(tags.map(async (wt: string) => {
      try { return await postCoc({ action: "cwl_war", tag: wt }); } catch (_e) { return null; }
    }));
    let roundActive = false;
    for (const w of wars as any[]) {
      if (!w || !w.clan || !w.opponent) continue;
      if (w.state !== "warEnded") roundActive = true;
      for (const side of [w.clan, w.opponent] as any[]) {
        const opp = side === w.clan ? w.opponent : w.clan;
        const s = stats.get(side.tag); if (!s) continue;
        s.stars += side.stars ?? 0;
        s.dest += side.destructionPercentage ?? 0;
        s.attacks += side.attacks ?? 0;
        s.rounds += 1;
        if (w.state === "warEnded") {
          const sStars = side.stars ?? 0, oStars = opp.stars ?? 0;
          const sDest = side.destructionPercentage ?? 0, oDest = opp.destructionPercentage ?? 0;
          if (sStars > oStars || (sStars === oStars && sDest > oDest)) s.w++;
          else if (sStars < oStars || (sStars === oStars && sDest < oDest)) s.l++;
          else s.d++;
        }
      }
    }
    if (roundActive && !currentRound) currentRound = ri + 1;
  }

  const ranked = Array.from(stats.values()).sort((a, b) =>
    b.stars - a.stars || b.dest - a.dest || b.w - a.w
  );
  const myRank = ranked.findIndex((s) => s.tag === tag) + 1;
  const myStats = stats.get(tag);

  const rows = ranked.map((s, i) => {
    const rank = String(i + 1).padStart(2);
    const name = (s.name.length > 18 ? s.name.slice(0, 17) + "…" : s.name).padEnd(18);
    const wld = `${s.w}-${s.l}-${s.d}`.padStart(5);
    const stars = String(s.stars).padStart(3);
    const dest = `${s.dest.toFixed(1)}%`.padStart(6);
    const att = String(s.attacks).padStart(3);
    const marker = s.tag === tag ? "▶" : " ";
    return `${marker}${rank}  ${name}  ${wld}  ⭐${stars}  ${dest}  🗡️${att}`;
  }).join("\n");
  const tableHeader = "  #  Clan                   W-L-D    ⭐    💥%      🗡️";
  const totalRounds = (g.rounds ?? []).length;
  const playedRounds = currentRound > 0 ? currentRound : (rounds.length || totalRounds);

  const fields: any[] = [
    { name: `📋 Standings — Round ${playedRounds}/${totalRounds}`, value: "```\n" + tableHeader + "\n" + rows + "\n```", inline: false },
  ];
  if (myStats) {
    fields.push({
      name: `📍 Your clan — ${myStats.name}`,
      value: `Rank **#${myRank}** • ${myStats.w}-${myStats.l}-${myStats.d} • ⭐ **${myStats.stars}** • 💥 **${myStats.dest.toFixed(1)}%** • 🗡️ ${myStats.attacks} attacks`,
      inline: false,
    });
  }
  const base = {
    title: `🏆 CWL Leaderboard — ${g.season ?? "current"}`,
    description: `League group • ${clans.length} clans • Size ${g.teamSize ?? "—"}v${g.teamSize ?? "—"}`,
    color: COLOR_GOLD,
    thumbnail: ranked[0]?.badge ? { url: ranked[0].badge } : undefined,
    fields,
    footer: { text: "Live from Clash of Clans • Sorted by stars, then destruction" },
    timestamp: new Date().toISOString(),
  };
  return await send(guildId, "cwl_board", base, { season: g.season, tag, rank: myRank });
}

// ---------- /remaining ----------
// Shows remaining/missed war hits for the current war.
export async function buildRemaining(guildId: string, args: { tag?: string; targetUser?: string; caller: string }) {
  const rt = await resolveClanTag({ explicit: args.tag, userId: args.targetUser, fallbackUserId: args.caller });
  const tag = rt.tag; if (!tag) return { embeds: [errEmbed(rt.error ?? "Provide a `tag:` or link a player with `/link player`.")], flags: 64 };
  let cw: any;
  try { cw = await postCoc({ action: "current_war", tag }); } catch (e) {
    return { embeds: [errEmbed(`\`${tag}\`: ${e instanceof Error ? e.message : String(e)}`)], flags: 64 };
  }
  if (!cw || cw.state === "notInWar" || !cw.clan) {
    return { embeds: [{ title: "🕊️ Not in war", description: `\`${tag}\` is not currently in a war.`, color: COLOR_GOLD }] };
  }
  const isPrep = cw.state === "preparation";
  const isEnded = cw.state === "warEnded";
  const perPlayer = cw.attacksPerMember ?? 2;
  const thMap = await loadThEmojis();
  const members: any[] = (cw.clan.members ?? []).slice().sort((a: any, b: any) => a.mapPosition - b.mapPosition);
  const noHits: any[] = [];
  const oneHit: any[] = [];
  for (const m of members) {
    const used = (m.attacks ?? []).length;
    const remaining = perPlayer - used;
    if (remaining <= 0) continue;
    const line = `\`${String(m.mapPosition).padStart(2)}.\` ${thEmoji(thMap, m.townhallLevel)} **${m.name}** \`${m.tag}\` — **${remaining}** left`;
    if (used === 0) noHits.push(line); else oneHit.push(line);
  }
  const totalRemaining = noHits.length * perPlayer + oneHit.length;
  const heading = isEnded ? "❌ Missed Hits" : isPrep ? "🗡️ Hits to use (Prep)" : "🗡️ Remaining Hits";
  const fields: any[] = [
    { name: "Status", value: isPrep ? "📦 Preparation" : isEnded ? "🏁 Ended" : "⚔️ Battle Day", inline: true },
    { name: "Team", value: `${cw.teamSize ?? "—"} vs ${cw.teamSize ?? "—"}`, inline: true },
    { name: "Total left", value: String(totalRemaining), inline: true },
  ];
  if (noHits.length) fields.push({ name: `🚫 No hits (${noHits.length})`, value: noHits.join("\n").slice(0, 1024), inline: false });
  if (oneHit.length) fields.push({ name: `⚠️ One hit left (${oneHit.length})`, value: oneHit.join("\n").slice(0, 1024), inline: false });
  if (!noHits.length && !oneHit.length) fields.push({ name: "✅ All hits used", value: "Every player has used all their attacks.", inline: false });
  const base = {
    title: `${heading} — ${cw.clan.name ?? tag}`,
    description: `vs **${cw.opponent?.name ?? "?"}** \`${cw.opponent?.tag ?? ""}\``,
    color: totalRemaining ? COLOR_GOLD : COLOR_GREEN,
    thumbnail: cw.clan.badgeUrls?.medium ? { url: cw.clan.badgeUrls.medium } : undefined,
    fields,
  };
  return await send(guildId, "remaining", base, { tag, remaining: totalRemaining });
}

// ---------- /lineup ----------
// Ordered roster + mirror opponent (+ called target if any).
export async function buildLineup(guildId: string, args: { tag?: string; targetUser?: string; caller: string }) {
  const rt = await resolveClanTag({ explicit: args.tag, userId: args.targetUser, fallbackUserId: args.caller });
  const tag = rt.tag; if (!tag) return { embeds: [errEmbed(rt.error ?? "Provide a `tag:` or link a player with `/link player`.")], flags: 64 };
  let cw: any;
  try { cw = await postCoc({ action: "current_war", tag }); } catch (e) {
    return { embeds: [errEmbed(`\`${tag}\`: ${e instanceof Error ? e.message : String(e)}`)], flags: 64 };
  }
  if (!cw || cw.state === "notInWar" || !cw.clan || !cw.opponent) {
    return { embeds: [{ title: "🕊️ Not in war", description: `\`${tag}\` is not currently in a war.`, color: COLOR_GOLD }] };
  }
  const thMap = await loadThEmojis();
  const oppByPos: Record<number, any> = {};
  for (const m of (cw.opponent.members ?? [])) oppByPos[m.mapPosition] = m;

  // Load any active callers for this clan
  const sb = adminClient();
  const { data: callers } = await sb.from("war_callers")
    .select("attacker_tag,defender_pos,defender_name").eq("guild_id", guildId).eq("clan_tag", tag);
  const callerMap = new Map<string, { pos?: number; name?: string }>();
  for (const c of (callers ?? []) as any[]) callerMap.set(c.attacker_tag, { pos: c.defender_pos, name: c.defender_name });

  const members: any[] = (cw.clan.members ?? []).slice().sort((a: any, b: any) => a.mapPosition - b.mapPosition);
  const lines = members.map((m) => {
    const mirror = oppByPos[m.mapPosition];
    const mirrorStr = mirror ? `${thEmoji(thMap, mirror.townhallLevel)} ${mirror.name}` : "—";
    const c = callerMap.get(m.tag);
    const callTag = c?.pos ? ` 🎯 #${c.pos}${c.name ? ` ${c.name}` : ""}` : "";
    return `\`${String(m.mapPosition).padStart(2)}.\` ${thEmoji(thMap, m.townhallLevel)} **${m.name}** vs ${mirrorStr}${callTag}`;
  });
  const chunks: string[] = [];
  let buf = "";
  for (const ln of lines) {
    if (buf.length + ln.length + 1 > 1000) { chunks.push(buf); buf = ln; } else { buf = buf ? `${buf}\n${ln}` : ln; }
  }
  if (buf) chunks.push(buf);
  const fields = chunks.map((v, i) => ({ name: i === 0 ? `Lineup (${members.length})` : `Lineup (cont. ${i + 1})`, value: v, inline: false }));
  const base = {
    title: `📋 Lineup — ${cw.clan.name ?? tag}`,
    description: `vs **${cw.opponent.name}** \`${cw.opponent.tag}\` • ${cw.teamSize}v${cw.teamSize}`,
    color: COLOR,
    thumbnail: cw.clan.badgeUrls?.medium ? { url: cw.clan.badgeUrls.medium } : undefined,
    fields,
  };
  return await send(guildId, "lineup", base, { tag, opponent: cw.opponent.name });
}

// ---------- /cwl_round ----------
// Summary for the current round's war (our pair only).
export async function buildCwlRound(guildId: string, args: { tag?: string; targetUser?: string; caller: string }) {
  const round = await fetchCwlRoundForClan(args);
  if ("error" in round) return { embeds: [errEmbed(round.error)], flags: 64 };
  const { war, tag } = round;
  const ours = war.clan?.tag === tag ? war.clan : war.opponent;
  const opp = ours === war.clan ? war.opponent : war.clan;
  if (!ours || !opp) return { embeds: [errEmbed("Could not identify clan in CWL war.")], flags: 64 };
  const stateLabel = war.state === "preparation" ? "📦 Preparation" : war.state === "inWar" ? "⚔️ Battle Day" : "🏁 Ended";
  const end = parseCocTime(war.endTime ?? "")?.getTime();
  const usedOurs = (ours.members ?? []).reduce((n: number, m: any) => n + (m.attacks?.length ?? 0), 0);
  const usedOpp = (opp.members ?? []).reduce((n: number, m: any) => n + (m.attacks?.length ?? 0), 0);
  const fields = [
    { name: "Status", value: stateLabel, inline: true },
    { name: "Team", value: `${war.teamSize ?? "—"} vs ${war.teamSize ?? "—"}`, inline: true },
    { name: "Ends", value: end ? `<t:${Math.floor(end / 1000)}:R>` : "—", inline: true },
    { name: "⭐ Stars", value: `**${ours.stars ?? 0}** vs ${opp.stars ?? 0}`, inline: true },
    { name: "💥 Destruction", value: `**${(ours.destructionPercentage ?? 0).toFixed?.(2) ?? 0}%** vs ${(opp.destructionPercentage ?? 0).toFixed?.(2) ?? 0}%`, inline: true },
    { name: "🗡️ Attacks", value: `${usedOurs}/${war.teamSize ?? 0} vs ${usedOpp}/${war.teamSize ?? 0}`, inline: true },
    { name: "🔗 Links", value: `[Us — ChocolateClash](${ccClanLink(ours.tag)}) • [Opp — ChocolateClash](${ccClanLink(opp.tag)})`, inline: false },
  ];
  const base = {
    title: `🛡️ CWL Round — ${ours.name} vs ${opp.name}`,
    color: COLOR,
    thumbnail: ours.badgeUrls?.medium ? { url: ours.badgeUrls.medium } : undefined,
    fields,
  };
  return await send(guildId, "cwl_round", base, { tag, our: ours.name, opponent: opp.name });
}

// ---------- /current_cwl_war ----------
// Detailed live current CWL war (per-attacker feed).
export async function buildCurrentCwlWar(guildId: string, args: { tag?: string; targetUser?: string; caller: string }) {
  const round = await fetchCwlRoundForClan(args);
  if ("error" in round) return { embeds: [errEmbed(round.error)], flags: 64 };
  const { war, tag } = round;
  const ours = war.clan?.tag === tag ? war.clan : war.opponent;
  const opp = ours === war.clan ? war.opponent : war.clan;
  if (!ours || !opp) return { embeds: [errEmbed("Could not identify clan in CWL war.")], flags: 64 };
  const thMap = await loadThEmojis();
  const oppByTag: Record<string, number> = {};
  for (const m of (opp.members ?? [])) oppByTag[m.tag] = m.mapPosition;
  const attacks: any[] = [];
  for (const m of (ours.members ?? [])) {
    for (const a of (m.attacks ?? [])) {
      attacks.push({ m, a, defPos: oppByTag[a.defenderTag] ?? "?" });
    }
  }
  attacks.sort((x, y) => y.a.order - x.a.order);
  const feed = attacks.slice(0, 10).map(({ m, a, defPos }) => {
    const stars = "⭐".repeat(a.stars) + "·".repeat(3 - a.stars);
    return `${thEmoji(thMap, m.townhallLevel)} **${m.name}** (#${m.mapPosition}) → #${defPos} ${stars} ${Math.round(a.destructionPercentage)}%`;
  }).join("\n") || "_No attacks yet._";

  const end = parseCocTime(war.endTime ?? "")?.getTime();
  const stateLabel = war.state === "preparation" ? "📦 Preparation" : war.state === "inWar" ? "⚔️ Battle Day" : "🏁 Ended";
  const usedOurs = attacks.length;
  const usedOpp = (opp.members ?? []).reduce((n: number, m: any) => n + (m.attacks?.length ?? 0), 0);
  const fields = [
    { name: "Status", value: stateLabel, inline: true },
    { name: "Team", value: `${war.teamSize ?? "—"}`, inline: true },
    { name: "Ends", value: end ? `<t:${Math.floor(end / 1000)}:R>` : "—", inline: true },
    { name: "⭐ Stars", value: `**${ours.stars ?? 0}** vs ${opp.stars ?? 0}`, inline: true },
    { name: "💥 Destruction", value: `**${(ours.destructionPercentage ?? 0).toFixed?.(2) ?? 0}%** vs ${(opp.destructionPercentage ?? 0).toFixed?.(2) ?? 0}%`, inline: true },
    { name: "🗡️ Attacks", value: `${usedOurs}/${war.teamSize ?? 0} vs ${usedOpp}/${war.teamSize ?? 0}`, inline: true },
    { name: "🔁 Recent attacks", value: feed.slice(0, 1024), inline: false },
  ];
  const base = {
    title: `🛡️ Current CWL War — ${ours.name} vs ${opp.name}`,
    color: COLOR,
    thumbnail: ours.badgeUrls?.medium ? { url: ours.badgeUrls.medium } : undefined,
    fields,
  };
  return await send(guildId, "current_cwl_war", base, { tag, our: ours.name, opponent: opp.name });
}

// Helper: locate the current CWL round war for a clan.
async function fetchCwlRoundForClan(args: { tag?: string; targetUser?: string; caller: string }):
  Promise<{ war: any; tag: string } | { error: string }>
{
  const rt = await resolveClanTag({ explicit: args.tag, userId: args.targetUser, fallbackUserId: args.caller });
  const tag = rt.tag; if (!tag) return { error: rt.error ?? "Provide a `tag:` or link a player with `/link player`." };
  let g: any;
  try { g = await fetchCwlGroupCached(tag); } catch (e) {
    return { error: `\`${tag}\`: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (!g || g.state === "notInWar" || !g.rounds?.length) {
    return { error: `\`${tag}\` is not currently in CWL.` };
  }
  const rounds = (g.rounds ?? []).filter((r: any) => (r.warTags ?? []).some((t: string) => t && t !== "#0"));
  // Walk rounds from latest to earliest; pick the most recent war involving `tag` that isn't already past.
  for (let i = rounds.length - 1; i >= 0; i--) {
    const wts = (rounds[i].warTags ?? []).filter((t: string) => t && t !== "#0");
    for (const wt of wts) {
      try {
        const w: any = await postCocWithTimeout({ action: "cwl_war", tag: wt }, 10_000);
        if (!w?.clan || !w?.opponent) continue;
        if (w.clan.tag === tag || w.opponent.tag === tag) {
          return { war: w, tag };
        }
      } catch (_e) { /* skip */ }
    }
  }
  return { error: `Could not find a CWL war for \`${tag}\`.` };
}

// 5-minute cache + 12s timeout + 1 retry for cwl_group (large response).
const CWL_GROUP_CACHE = new Map<string, { at: number; data: any }>();
const CWL_GROUP_TTL_MS = 5 * 60_000;
export async function fetchCwlGroupCached(tag: string): Promise<any> {
  const key = tag.toUpperCase();
  const hit = CWL_GROUP_CACHE.get(key);
  if (hit && Date.now() - hit.at < CWL_GROUP_TTL_MS) return hit.data;
  let lastErr: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const data = await postCocWithTimeout({ action: "cwl_group", tag }, 12_000);
      CWL_GROUP_CACHE.set(key, { at: Date.now(), data });
      return data;
    } catch (e) { lastErr = e; }
  }
  throw lastErr ?? new Error("cwl_group failed");
}

// postCoc with an AbortController timeout. Falls back to plain postCoc on success.
export async function postCocWithTimeout<T = any>(body: Record<string, any>, ms: number): Promise<T> {
  return await Promise.race([
    postCoc<T>(body),
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`CoC timeout (${ms}ms) for ${body.action}`)), ms)),
  ]);
}

// ---------- /caller assign|clear ----------
export async function callerAssign(guildId: string, args: {
  tag?: string; targetUser?: string; caller: string; playerTag: string; position: number;
}) {
  const rt = await resolveClanTag({ explicit: args.tag, userId: args.targetUser, fallbackUserId: args.caller });
  const tag = rt.tag; if (!tag) return { embeds: [errEmbed(rt.error ?? "Provide a `tag:`.")], flags: 64 };
  let cw: any;
  try { cw = await postCoc({ action: "current_war", tag }); } catch (e) {
    return { embeds: [errEmbed(`\`${tag}\`: ${e instanceof Error ? e.message : String(e)}`)], flags: 64 };
  }
  if (!cw || cw.state === "notInWar" || !cw.clan || !cw.opponent) {
    return { embeds: [errEmbed(`\`${tag}\` is not currently in a war.`)], flags: 64 };
  }
  const attacker = (cw.clan.members ?? []).find((m: any) => normalizeTag(m.tag) === normalizeTag(args.playerTag));
  if (!attacker) return { embeds: [errEmbed(`Player \`${args.playerTag}\` is not in the current war roster.`)], flags: 64 };
  const defender = (cw.opponent.members ?? []).find((m: any) => m.mapPosition === args.position);
  if (!defender) return { embeds: [errEmbed(`No opponent base at position #${args.position}.`)], flags: 64 };
  const sb = adminClient();
  const start = parseCocTime(cw.startTime ?? "")?.toISOString() ?? null;
  await sb.from("war_callers").upsert({
    guild_id: guildId, clan_tag: tag, war_start_time: start,
    attacker_tag: attacker.tag, attacker_name: attacker.name,
    defender_tag: defender.tag, defender_name: defender.name, defender_pos: defender.mapPosition,
    set_by: args.caller, updated_at: new Date().toISOString(),
  }, { onConflict: "guild_id,clan_tag,attacker_tag" });
  return {
    embeds: [{
      title: "🎯 Target assigned",
      description: `**${attacker.name}** \`${attacker.tag}\` → **#${defender.mapPosition} ${defender.name}** \`${defender.tag}\``,
      color: COLOR_GREEN,
    }],
  };
}

export async function callerClear(guildId: string, args: { tag?: string; targetUser?: string; caller: string; playerTag: string }) {
  const rt = await resolveClanTag({ explicit: args.tag, userId: args.targetUser, fallbackUserId: args.caller });
  const tag = rt.tag; if (!tag) return { embeds: [errEmbed(rt.error ?? "Provide a `tag:`.")], flags: 64 };
  const sb = adminClient();
  const norm = normalizeTag(args.playerTag);
  const { error, count } = await sb.from("war_callers")
    .delete({ count: "exact" })
    .eq("guild_id", guildId).eq("clan_tag", tag).eq("attacker_tag", norm);
  if (error) return { embeds: [errEmbed(error.message)], flags: 64 };
  return {
    embeds: [{
      title: count ? "🧹 Target cleared" : "ℹ️ Nothing to clear",
      description: count ? `Cleared target for \`${norm}\`.` : `No target was set for \`${norm}\`.`,
      color: count ? COLOR_GREEN : COLOR_GOLD,
    }],
  };
}

// Fire-and-forget: remember manually-typed (non-Family) clan tags so they
// surface in autocomplete next time.
export async function rememberClanTag(guildId: string, tag: string): Promise<void> {
  try {
    const sb = adminClient();
    const norm = (tag.startsWith("#") ? tag : `#${tag}`).toUpperCase();
    // Skip if already in family_clans
    const { data: fam } = await sb.from("family_clans")
      .select("clan_tag").eq("guild_id", guildId).eq("clan_tag", norm).maybeSingle();
    if (fam) return;
    let name = "";
    try { const c: any = await fetchClan(norm); name = c?.name ?? ""; } catch (_e) { /* keep empty */ }
    await sb.from("recent_clan_tags").upsert({
      guild_id: guildId, clan_tag: norm, clan_name: name, last_used_at: new Date().toISOString(),
    }, { onConflict: "guild_id,clan_tag" });
    // Bump use_count
    await sb.rpc("noop_no_existing"); // ignored if missing
  } catch (e) { console.error("rememberClanTag", e); }
}

