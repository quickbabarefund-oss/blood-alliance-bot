// Builders for /player_activity and /player_joins.
// Aggregates donation_snapshots, war_attacks, player_activity_events, clan_member_events.

import { adminClient } from "./leaderboard.ts";
import { normalizeTag } from "./coc.ts";
import { istMonthKey } from "./month.ts";
import { fetchLiveUserLinks } from "./coc_commands.ts";

const IST_OFFSET_MIN = 5 * 60 + 30;

function istMidnightUtcIso(): string {
  // Today 00:00 IST converted back to UTC
  const nowIst = new Date(Date.now() + IST_OFFSET_MIN * 60_000);
  const istMidnight = Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), nowIst.getUTCDate());
  return new Date(istMidnight - IST_OFFSET_MIN * 60_000).toISOString();
}

function isoNDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86400_000).toISOString();
}

function istMonthStartUtcIso(): string {
  const nowIst = new Date(Date.now() + IST_OFFSET_MIN * 60_000);
  const istMonthStart = Date.UTC(nowIst.getUTCFullYear(), nowIst.getUTCMonth(), 1);
  return new Date(istMonthStart - IST_OFFSET_MIN * 60_000).toISOString();
}

function fmtAgo(iso?: string | null): string {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function fmtDate(iso: string): string {
  const d = new Date(new Date(iso).getTime() + IST_OFFSET_MIN * 60_000);
  return d.toISOString().slice(0, 10);
}

async function aggregateDonations(playerTag: string, sinceIso: string) {
  const sb = adminClient();
  const { data } = await sb
    .from("donation_snapshots")
    .select("donations,donations_received,attack_wins,defense_wins,captured_at,clan_tag")
    .eq("player_tag", playerTag)
    .gte("captured_at", sinceIso)
    .order("captured_at", { ascending: true });
  const rows = (data ?? []) as any[];
  // Also need the snapshot *just before* sinceIso as a baseline.
  const { data: baseline } = await sb
    .from("donation_snapshots")
    .select("donations,donations_received,attack_wins,defense_wins,captured_at,clan_tag")
    .eq("player_tag", playerTag)
    .lt("captured_at", sinceIso)
    .order("captured_at", { ascending: false })
    .limit(1);
  let dDon = 0, dRecv = 0, dAtk = 0;
  // Per-clan walk: rows grouped by clan_tag in time order
  const byClan = new Map<string, any[]>();
  for (const r of rows) {
    const k = r.clan_tag;
    if (!byClan.has(k)) byClan.set(k, []);
    byClan.get(k)!.push(r);
  }
  for (const [clanTag, list] of byClan) {
    let prev = (baseline ?? []).find((b: any) => b.clan_tag === clanTag) ?? null;
    for (const cur of list) {
      if (prev) {
        const dd = cur.donations          >= prev.donations          ? cur.donations          - prev.donations          : cur.donations;
        const dr = cur.donations_received >= prev.donations_received ? cur.donations_received - prev.donations_received : cur.donations_received;
        const da = cur.attack_wins        >= prev.attack_wins        ? cur.attack_wins        - prev.attack_wins        : cur.attack_wins;
        if (dd > 0) dDon  += dd;
        if (dr > 0) dRecv += dr;
        if (da > 0) dAtk  += da;
      }
      prev = cur;
    }
  }
  return { donations: dDon, received: dRecv, attackWins: dAtk };
}

async function aggregateWars(playerTag: string, sinceIso: string) {
  const sb = adminClient();
  const { data } = await sb
    .from("war_attacks")
    .select("stars,destruction,war_id,recorded_at")
    .eq("attacker_tag", playerTag)
    .gte("recorded_at", sinceIso);
  const rows = (data ?? []) as any[];
  if (!rows.length) return { used: 0, allowed: 0, stars: 0, avgStars: 0, missed: 0 };
  // Allowed = 2 * number of distinct wars participated
  const warIds = Array.from(new Set(rows.map((r) => r.war_id)));
  const allowed = warIds.length * 2;
  const stars = rows.reduce((s, r) => s + (r.stars ?? 0), 0);
  return {
    used: rows.length,
    allowed,
    stars,
    avgStars: rows.length ? +(stars / rows.length).toFixed(2) : 0,
    missed: Math.max(0, allowed - rows.length),
  };
}

async function activityToday(playerTag: string) {
  const sb = adminClient();
  const since = istMidnightUtcIso();
  const { data } = await sb
    .from("player_activity_events")
    .select("occurred_at")
    .eq("player_tag", playerTag)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: true });
  const rows = (data ?? []) as any[];
  const { data: lastAll } = await sb
    .from("player_activity_events")
    .select("occurred_at")
    .eq("player_tag", playerTag)
    .order("occurred_at", { ascending: false })
    .limit(1);
  return {
    eventsToday: rows.length,
    firstToday: rows[0]?.occurred_at ?? null,
    lastToday: rows[rows.length - 1]?.occurred_at ?? null,
    lastEver: lastAll?.[0]?.occurred_at ?? null,
  };
}

const IDLE_GAP_MS = 10 * 60_000; // >10 min gap = offline

async function computeActiveTime(playerTag: string, sinceIso: string, untilIso?: string) {
  const sb = adminClient();
  let q = sb
    .from("player_activity_events")
    .select("occurred_at")
    .eq("player_tag", playerTag)
    .gte("occurred_at", sinceIso)
    .order("occurred_at", { ascending: true });
  if (untilIso) q = q.lt("occurred_at", untilIso);
  const { data } = await q;
  const rows = (data ?? []) as Array<{ occurred_at: string }>;
  if (rows.length < 2) return { totalMs: 0, sessions: rows.length ? 1 : 0 };
  let total = 0;
  let sessions = 1;
  let sessionStart = new Date(rows[0].occurred_at).getTime();
  let prev = sessionStart;
  for (let i = 1; i < rows.length; i++) {
    const t = new Date(rows[i].occurred_at).getTime();
    if (t - prev > IDLE_GAP_MS) {
      total += prev - sessionStart;
      sessions++;
      sessionStart = t;
    }
    prev = t;
  }
  total += prev - sessionStart;
  return { totalMs: total, sessions };
}

function fmtDur(ms: number): string {
  if (ms <= 0) return "0m";
  const m = Math.floor(ms / 60_000);
  const h = Math.floor(m / 60);
  const rem = m % 60;
  if (h > 0) return `${h}h${rem}m`;
  return `${m}m`;
}

function daysElapsedInIstMonth(): number {
  const nowIst = new Date(Date.now() + IST_OFFSET_MIN * 60_000);
  return nowIst.getUTCDate(); // day-of-month in IST, ≥1
}

async function recentMoves(playerTag: string) {
  const sb = adminClient();
  const since = isoNDaysAgo(30);
  const { data } = await sb
    .from("clan_member_events")
    .select("clan_tag,event,occurred_at")
    .eq("player_tag", playerTag)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(20);
  return (data ?? []) as Array<{ clan_tag: string; event: string; occurred_at: string }>;
}

/** Compute total stay days per clan from clan_member_events (open intervals = ongoing). */
async function stayDaysByClan(playerTag: string) {
  const sb = adminClient();
  const { data } = await sb
    .from("clan_member_events")
    .select("clan_tag,event,occurred_at")
    .eq("player_tag", playerTag)
    .order("occurred_at", { ascending: true });
  const rows = (data ?? []) as Array<{ clan_tag: string; event: string; occurred_at: string }>;
  const stays = new Map<string, number>(); // clan_tag -> total ms
  const open = new Map<string, number>(); // clan_tag -> join ts
  for (const r of rows) {
    const t = new Date(r.occurred_at).getTime();
    if (r.event === "join") {
      if (!open.has(r.clan_tag)) open.set(r.clan_tag, t);
    } else if (r.event === "leave") {
      const j = open.get(r.clan_tag);
      if (j != null) {
        stays.set(r.clan_tag, (stays.get(r.clan_tag) ?? 0) + (t - j));
        open.delete(r.clan_tag);
      }
    }
  }
  // Close any open intervals with "now"
  const now = Date.now();
  for (const [c, j] of open) {
    stays.set(c, (stays.get(c) ?? 0) + (now - j));
  }
  // Convert to days, sorted desc
  const list = Array.from(stays.entries()).map(([clan_tag, ms]) => ({
    clan_tag,
    days: Math.max(0, Math.floor(ms / 86400_000)),
    ongoing: open.has(clan_tag),
  }));
  list.sort((a, b) => b.days - a.days);
  return list;
}

async function clanNameMap(tags: string[]): Promise<Map<string, string>> {
  const sb = adminClient();
  const m = new Map<string, string>();
  if (!tags.length) return m;
  const { data: clans } = await sb.from("clans").select("tag,name").in("tag", tags);
  for (const c of (clans ?? []) as any[]) if (c.name) m.set(c.tag, c.name);
  const missing = tags.filter((t) => !m.has(t));
  if (missing.length) {
    const { data: fam } = await sb.from("family_clans").select("clan_tag,clan_name").in("clan_tag", missing);
    for (const c of (fam ?? []) as any[]) if (c.clan_name) m.set(c.clan_tag, c.clan_name);
  }
  return m;
}

export async function buildPlayerActivity(
  _guildId: string,
  args: { tag?: string; targetUser?: string; caller: string },
): Promise<any> {
  const sb = adminClient();
  let tag = args.tag ? normalizeTag(args.tag) : "";
  let resolvedUser = args.targetUser ?? null;

  if (!tag) {
    const uid = args.targetUser ?? args.caller;
    const links = await fetchLiveUserLinks(uid);
    if (!links.length) {
      return { content: `❌ No linked player tag for ${args.targetUser ? `<@${args.targetUser}>` : "you"}. Use \`/link player <tag>\` first.`, allowed_mentions: { parse: [] } };
    }
    if (links.length === 1) tag = normalizeTag(links[0].tag);
    else {
      // Caller side handles multi-link via picker; here we just take first as fallback.
      tag = normalizeTag(links[0].tag);
    }
    resolvedUser = uid;
  }

  const { data: player } = await sb.from("players").select("tag,name,town_hall,current_clan_tag").eq("tag", tag).maybeSingle();
  if (!player) return { content: `❌ No record for \`${tag}\` yet. Wait for the next poll.`, allowed_mentions: { parse: [] } };

  // Buckets
  const sinceToday = istMidnightUtcIso();
  const since7d  = isoNDaysAgo(7);
  const since30d = isoNDaysAgo(30);
  const sinceMo  = istMonthStartUtcIso();

  const [donToday, don7d, don30d, donMo, warToday, war7d, war30d, warMo, act, moves, stays, actToday, act7d, act30d, actMo] = await Promise.all([
    aggregateDonations(tag, sinceToday),
    aggregateDonations(tag, since7d),
    aggregateDonations(tag, since30d),
    aggregateDonations(tag, sinceMo),
    aggregateWars(tag, sinceToday),
    aggregateWars(tag, since7d),
    aggregateWars(tag, since30d),
    aggregateWars(tag, sinceMo),
    activityToday(tag),
    recentMoves(tag),
    stayDaysByClan(tag),
    computeActiveTime(tag, sinceToday),
    computeActiveTime(tag, since7d),
    computeActiveTime(tag, since30d),
    computeActiveTime(tag, sinceMo),
  ]);
  const monthDays = daysElapsedInIstMonth();
  const avg7  = act7d.totalMs  / 7;
  const avg30 = act30d.totalMs / 30;
  const avgMo = actMo.totalMs  / Math.max(1, monthDays);

  // Clan name lookup for current + moves + stays
  const tagsForNames = new Set<string>();
  if (player.current_clan_tag) tagsForNames.add(player.current_clan_tag);
  for (const m of moves) tagsForNames.add(m.clan_tag);
  for (const s of stays) tagsForNames.add(s.clan_tag);
  const names = await clanNameMap(Array.from(tagsForNames));

  // Linked user (if not provided)
  let linkedLine = "";
  if (resolvedUser) {
    linkedLine = `Linked to <@${resolvedUser}>`;
  } else {
    const { data: lk } = await sb.from("coc_links").select("user_id").eq("player_tag", tag).limit(3);
    const ids = (lk ?? []).map((r: any) => `<@${r.user_id}>`);
    if (ids.length) linkedLine = `Linked to ${ids.join(", ")}`;
  }

  const monthLabel = istMonthKey();

  // Build table — mobile-friendly stacked
  const fmtNum = (n: number) => n.toLocaleString("en-US");
  const fmtRatio = (d: number, r: number) => r > 0 ? (d / r).toFixed(2) : (d > 0 ? "∞" : "—");

  const tableHeader = "```\n           Today    7d      30d     Month\n";
  const rowDon  = `Donated    ${fmtNum(donToday.donations).padEnd(8)} ${fmtNum(don7d.donations).padEnd(7)} ${fmtNum(don30d.donations).padEnd(7)} ${fmtNum(donMo.donations)}\n`;
  const rowRecv = `Received   ${fmtNum(donToday.received).padEnd(8)} ${fmtNum(don7d.received).padEnd(7)} ${fmtNum(don30d.received).padEnd(7)} ${fmtNum(donMo.received)}\n`;
  const rowRat  = `Ratio      ${fmtRatio(donToday.donations, donToday.received).padEnd(8)} ${fmtRatio(don7d.donations, don7d.received).padEnd(7)} ${fmtRatio(don30d.donations, don30d.received).padEnd(7)} ${fmtRatio(donMo.donations, donMo.received)}\n`;
  const rowAtk  = `Atk wins   ${fmtNum(donToday.attackWins).padEnd(8)} ${fmtNum(don7d.attackWins).padEnd(7)} ${fmtNum(don30d.attackWins).padEnd(7)} ${fmtNum(donMo.attackWins)}\n`;
  const rowWar  = `War atks   ${(warToday.used + "/" + warToday.allowed).padEnd(8)} ${(war7d.used + "/" + war7d.allowed).padEnd(7)} ${(war30d.used + "/" + war30d.allowed).padEnd(7)} ${warMo.used + "/" + warMo.allowed}\n`;
  const rowStar = `War ⭐avg  ${String(warToday.avgStars).padEnd(8)} ${String(war7d.avgStars).padEnd(7)} ${String(war30d.avgStars).padEnd(7)} ${warMo.avgStars}\n`;
  const rowMiss = `Missed     ${String(warToday.missed).padEnd(8)} ${String(war7d.missed).padEnd(7)} ${String(war30d.missed).padEnd(7)} ${warMo.missed}\n`;
  const rowAct  = `Active     ${fmtDur(actToday.totalMs).padEnd(8)} ${fmtDur(act7d.totalMs).padEnd(7)} ${fmtDur(act30d.totalMs).padEnd(7)} ${fmtDur(actMo.totalMs)}\n\`\`\``;

  const currentClanLabel = player.current_clan_tag
    ? `${names.get(player.current_clan_tag) ?? "Unknown"} \`${player.current_clan_tag}\``
    : "—";

  const activityLine = (() => {
    if (!act.eventsToday) {
      return `🕒 **Active today:** 0 events  •  last active **${fmtAgo(act.lastEver)}**`;
    }
    return `🕒 **Active today:** ${act.eventsToday} events  •  last active **${fmtAgo(act.lastToday)}**`;
  })();
  const activeTimeLine = `⏱️ **Approx active time** — today: **${fmtDur(actToday.totalMs)}**  •  avg/day 7d: **${fmtDur(avg7)}**  •  30d: **${fmtDur(avg30)}**  •  month: **${fmtDur(avgMo)}**`;

  const stayLines = stays.length
    ? stays.slice(0, 8).map((s) => `• **${names.get(s.clan_tag) ?? "Unknown"}** \`${s.clan_tag}\` — ${s.days} day${s.days === 1 ? "" : "s"}${s.ongoing ? " (ongoing)" : ""}`).join("\n")
    : "_No tracked stays yet._";

  const moveLines = moves.length
    ? moves.slice(0, 10).map((m) => `• **${m.event === "join" ? "Joined" : "Left"}** ${names.get(m.clan_tag) ?? "Unknown"} \`${m.clan_tag}\` — ${fmtDate(m.occurred_at)}`).join("\n")
    : "_No clan changes in the last 30 days._";

  const embed = {
    title: `👤 ${player.name}  ${player.town_hall ? `TH${player.town_hall}` : ""}  ${tag}`.trim(),
    description: [
      `Clan: ${currentClanLabel}${linkedLine ? `  •  ${linkedLine}` : ""}`,
      "",
      activityLine,
      "",
      `**Activity (${monthLabel} IST)**`,
      tableHeader + rowDon + rowRecv + rowRat + rowAtk + rowWar + rowStar + rowMiss,
    ].join("\n"),
    color: 0x5865F2,
    fields: [
      { name: "🗓️ Total stay (tracked)", value: stayLines, inline: false },
      { name: "🔁 Clan moves (30d)", value: moveLines, inline: false },
    ],
    footer: { text: "Activity = observed deltas between polls (~hourly). Wars cover bot-tracked wars only." },
  };
  return { embeds: [embed], allowed_mentions: { parse: [] } };
}

export async function buildPlayerJoins(
  _guildId: string,
  args: { tag?: string; targetUser?: string; caller: string },
): Promise<any> {
  const sb = adminClient();
  let tag = args.tag ? normalizeTag(args.tag) : "";
  if (!tag) {
    const uid = args.targetUser ?? args.caller;
    const links = await fetchLiveUserLinks(uid);
    if (!links.length) return { content: `❌ No linked player tag.`, allowed_mentions: { parse: [] } };
    tag = normalizeTag(links[0].tag);
  }
  const { data: player } = await sb.from("players").select("tag,name").eq("tag", tag).maybeSingle();
  const since = isoNDaysAgo(180);
  const { data } = await sb
    .from("clan_member_events")
    .select("clan_tag,event,occurred_at")
    .eq("player_tag", tag)
    .gte("occurred_at", since)
    .order("occurred_at", { ascending: false })
    .limit(50);
  const rows = (data ?? []) as any[];
  const names = await clanNameMap(Array.from(new Set(rows.map((r) => r.clan_tag))));
  const stays = await stayDaysByClan(tag);
  const stayNames = await clanNameMap(stays.map((s) => s.clan_tag));

  const eventLines = rows.length
    ? rows.map((r) => `• **${r.event === "join" ? "Joined" : "Left"}** ${names.get(r.clan_tag) ?? "Unknown"} \`${r.clan_tag}\` — ${fmtDate(r.occurred_at)}`).join("\n")
    : "_No join/leave events in the last 180 days._";

  const stayLines = stays.length
    ? stays.map((s) => `• **${stayNames.get(s.clan_tag) ?? "Unknown"}** \`${s.clan_tag}\` — ${s.days} day${s.days === 1 ? "" : "s"}${s.ongoing ? " (ongoing)" : ""}`).join("\n")
    : "_No tracked stays yet._";

  const embed = {
    title: `🔁 ${player?.name ?? tag} — Clan history`,
    color: 0x5865F2,
    fields: [
      { name: "Total stay per clan", value: stayLines.slice(0, 1024), inline: false },
      { name: "Recent events (180d)", value: eventLines.slice(0, 1024), inline: false },
    ],
  };
  return { embeds: [embed], allowed_mentions: { parse: [] } };
}
