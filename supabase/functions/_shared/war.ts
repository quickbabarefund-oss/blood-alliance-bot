// War tracking shared logic: FWA verification, embeds, rule evaluation, txt log.
import { adminClient } from "./leaderboard.ts";

export type Attack = {
  attackerTag: string;
  defenderTag: string;
  stars: number;
  destructionPercentage: number;
  order: number;
  attacker_map_pos?: number;
  defender_map_pos?: number;
};

export type WarMember = {
  tag: string;
  name: string;
  townhallLevel: number;
  mapPosition: number;
  attacks?: Array<{ attackerTag: string; defenderTag: string; stars: number; destructionPercentage: number; order: number; }>;
};

export type CurrentWar = {
  state: string; // "notInWar" | "preparation" | "inWar" | "warEnded"
  teamSize?: number;
  preparationStartTime?: string;
  startTime?: string;
  endTime?: string;
  clan?: { tag: string; name: string; badgeUrls?: { medium?: string }; stars?: number; destructionPercentage?: number; members?: WarMember[]; attacks?: number; };
  opponent?: { tag: string; name: string; badgeUrls?: { medium?: string }; stars?: number; destructionPercentage?: number; members?: WarMember[]; attacks?: number; };
};

// CoC API time format: "20260501T103000.000Z"
export function parseCocTime(s?: string): Date | null {
  if (!s) return null;
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})\.\d+Z$/.exec(s);
  if (!m) return null;
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]));
}

export function tagNoHash(t: string): string {
  return (t ?? "").replace(/^#/, "").trim().toUpperCase();
}

export function clanProfileLink(tag: string): string {
  const t = encodeURIComponent(tag.startsWith("#") ? tag : `#${tag}`);
  return `https://link.clashofclans.com/?action=OpenClanProfile&tag=${t}`;
}

// FWA registry from fwastats — opponent tag in this list = FWA match.
let FWA_TAGS_CACHE: Set<string> | null = null;
let FWA_TAGS_AT = 0;
async function loadFwaTags(): Promise<Set<string>> {
  const now = Date.now();
  if (FWA_TAGS_CACHE && now - FWA_TAGS_AT < 60 * 60_000) return FWA_TAGS_CACHE;
  try {
    const res = await fetch("https://fwastats.com/Clans.json", { headers: { "User-Agent": "ClanLootTracker/1.0" } });
    if (!res.ok) { console.log("fwastats Clans.json non-ok", res.status); return FWA_TAGS_CACHE ?? new Set(); }
    const data = await res.json();
    const arr: any[] = Array.isArray(data) ? data : (data?.Clans ?? data?.clans ?? []);
    const set = new Set<string>();
    for (const c of arr) {
      const t = tagNoHash(c?.tag ?? c?.Tag ?? c?.clanTag ?? "");
      if (t) set.add(t);
    }
    FWA_TAGS_CACHE = set; FWA_TAGS_AT = now;
    console.log("Loaded FWA registry:", set.size, "clans");
    return set;
  } catch (e) {
    console.error("loadFwaTags error", e);
    return FWA_TAGS_CACHE ?? new Set();
  }
}

// War is FWA when the opponent clan exists in the FWA registry.
export async function isFwaMatch(_ourTag: string, oppTag: string): Promise<boolean> {
  const tags = await loadFwaTags();
  return tags.has(tagNoHash(oppTag));
}

// Look up TH emoji from the th_emojis table; fallback to plain text.
let THE_EMOJI_CACHE: Record<number, string> | null = null;
let THE_EMOJI_CACHE_AT = 0;
export async function loadThEmojis(): Promise<Record<number, string>> {
  const now = Date.now();
  if (THE_EMOJI_CACHE && now - THE_EMOJI_CACHE_AT < 5 * 60_000) return THE_EMOJI_CACHE;
  const sb = adminClient();
  const { data } = await sb.from("th_emojis").select("th_level,emoji");
  const map: Record<number, string> = {};
  for (const row of (data ?? []) as { th_level: number; emoji: string }[]) {
    map[row.th_level] = row.emoji;
  }
  THE_EMOJI_CACHE = map;
  THE_EMOJI_CACHE_AT = now;
  return map;
}

export function thEmoji(map: Record<number, string>, level?: number | null): string {
  if (!level) return "🏠";
  return map[level] ?? `TH${level}`;
}

// Build composition lines: TH16 x4, TH15 x6 ...
export function compositionLine(members: WarMember[] | undefined, thMap: Record<number, string>): string {
  if (!members?.length) return "—";
  const counts: Record<number, number> = {};
  for (const m of members) counts[m.townhallLevel] = (counts[m.townhallLevel] ?? 0) + 1;
  const sorted = Object.entries(counts).map(([k, v]) => [parseInt(k, 10), v] as [number, number]).sort((a, b) => b[0] - a[0]);
  return sorted.map(([th, n]) => `${thEmoji(thMap, th)} \`${n}\``).join("  ");
}

// Build the Reps approval embed + select component.
export async function buildRepsPayload(opts: {
  warId: number;
  war: CurrentWar;
  matchType: string;
}): Promise<{ embeds: any[]; components: any[] }> {
  const { war } = opts;
  const thMap = await loadThEmojis();
  const ours = war.clan!;
  const opp = war.opponent!;
  const endTs = parseCocTime(war.endTime ?? "")?.getTime();
  const endRel = endTs ? `<t:${Math.floor(endTs / 1000)}:R>` : "—";

  const embed = {
    title: `${ours.name} vs ${opp.name}`,
    description: `[${ours.name} (\`${ours.tag}\`)](${clanProfileLink(ours.tag)}) **VS** [${opp.name} (\`${opp.tag}\`)](${clanProfileLink(opp.tag)})`,
    color: opts.matchType === "FWA" ? 0x57F287 : 0xF1B93B,
    thumbnail: ours.badgeUrls?.medium ? { url: ours.badgeUrls.medium } : undefined,
    fields: [
      { name: "Match Type", value: opts.matchType, inline: true },
      { name: "Team Size", value: `${war.teamSize ?? "—"} vs ${war.teamSize ?? "—"}`, inline: true },
      { name: "Ends", value: endRel, inline: true },
      { name: `${ours.name} Composition`, value: compositionLine(ours.members, thMap), inline: false },
      { name: `${opp.name} Composition`, value: compositionLine(opp.members, thMap), inline: false },
    ],
    footer: { text: "Reps: pick WIN / LOSE / MISS. Re-clickable any time before war ends. If unset before battle day, FWA points auto-picks for FWA matches." },
    timestamp: new Date().toISOString(),
  };

  const buttons = buildDecisionButtons(opts.warId);
  return { embeds: [embed], components: [buttons] };
}

// Reusable WIN / LOSE / MISS button row used for the reps approval message.
// Buttons stay enabled while the war is active so admins can override at any time.
export function buildDecisionButtons(warId: number) {
  return {
    type: 1,
    components: [
      { type: 2, style: 3, custom_id: `war:set:${warId}:win`,  label: "WIN",  emoji: { name: "🏆" } },
      { type: 2, style: 4, custom_id: `war:set:${warId}:lose`, label: "LOSE", emoji: { name: "🏳️" } },
      { type: 2, style: 2, custom_id: `war:set:${warId}:miss`, label: "MISS", emoji: { name: "🚫" } },
    ],
  };
}

// Build a war-started or reminder message as plain content (so mentions actually ping users).
// Format:
//   ⏰ **12h Remaining in War**
//   **CLAN** vs **OPPONENT**
//   ⚔️ 12/50   ⭐ 32/75
//   🕒 <t:...:F> (<t:...:R>)
//
//   Remaining (38/50):
//   (0/2) {TH} name | `#TAG` @mention
export async function buildReminderPayload(opts: {
  reminderLabel: string;
  emoji: string;
  war: any;
  current: CurrentWar;
  slot?: "war_started" | "war_reminder";
  minutes?: number;
}): Promise<Array<{ content: string; allowed_mentions: any }>> {
  const thMap = await loadThEmojis();
  const sb = adminClient();
  const ours = opts.current.clan!;
  const opp = opts.current.opponent!;
  const members = ours.members ?? [];
  const teamSize = opts.current.teamSize ?? members.length;
  const maxAttacks = teamSize * 2;

  const tags = members.map((m) => m.tag);
  const { resolveLinksForTags } = await import("./coc_commands.ts");
  const links = await resolveLinksForTags(tags);

  let usedAttacks = 0;
  let starsEarned = 0;
  for (const m of members) {
    const atks = m.attacks ?? [];
    usedAttacks += atks.length;
    for (const a of atks) starsEarned += a.stars;
  }

  // Sort: TH desc, then map position asc — list ALL members
  const sorted = members.slice().sort((a, b) => (b.townhallLevel - a.townhallLevel) || (a.mapPosition - b.mapPosition));
  const memberLines: { line: string; userId?: string }[] = sorted.map((m) => {
    const used = m.attacks?.length ?? 0;
    const userId = links[m.tag];
    const mention = userId ? ` | <@${userId}>` : "";
    return {
      line: `(${used}/2) ${thEmoji(thMap, m.townhallLevel)} ${m.name} | \`${m.tag}\`${mention}`,
      userId,
    };
  });

  const endTs = parseCocTime(opts.current.endTime ?? "")?.getTime();
  const nowMs = Date.now();
  let headerLabel = opts.reminderLabel;
  if (opts.slot !== "war_started" && endTs) {
    const minsLeft = Math.max(0, Math.round((endTs - nowMs) / 60000));
    const hrs = Math.floor(minsLeft / 60);
    const mins = minsLeft % 60;
    headerLabel = hrs >= 1
      ? `${hrs}h${mins ? ` ${mins}m` : ""} Remaining in War`
      : `${mins}m Remaining in War`;
  }

  const tsRel = endTs ? `<t:${Math.floor(endTs / 1000)}:R>` : "";
  const headerBlock = [
    `${opts.emoji} **${headerLabel}**`,
    `📌 **${ours.name}** vs **${opp.name}**`,
    `⚔️ ${usedAttacks}/${maxAttacks}  ⭐ ${starsEarned}/${teamSize * 3}  🕒 ${tsRel}`.trim(),
    "",
  ].join("\n");

  // Chunk into messages under 2000 chars. Header goes on first message only.
  const MAX = 1950;
  const chunks: { content: string; users: string[] }[] = [];
  let curLines: string[] = [];
  let curUsers: string[] = [];
  let curLen = headerBlock.length;
  let isFirst = true;

  const flush = () => {
    const prefix = isFirst ? headerBlock : "*(continued)*\n";
    chunks.push({ content: prefix + curLines.join("\n"), users: curUsers });
    isFirst = false;
    curLines = [];
    curUsers = [];
    curLen = prefix.length;
  };

  for (const ml of memberLines) {
    const addLen = ml.line.length + 1;
    if (curLen + addLen > MAX && curLines.length) flush();
    curLines.push(ml.line);
    if (ml.userId) curUsers.push(ml.userId);
    curLen += addLen;
  }
  if (curLines.length || isFirst) flush();

  // Allow guild template to override the FIRST message content (placeholders interpolated).
  const slot = opts.slot ?? (opts.reminderLabel.toLowerCase().includes("started") ? "war_started" : "war_reminder");
  if (opts.war?.guild_id) {
    try {
      const { applyTemplate } = await import("./embed_templates.ts");
      const allUsers = Array.from(new Set(memberLines.map((m) => m.userId).filter(Boolean) as string[]));
      const vars = {
        clan: ours.name, opponent: opp.name,
        team_size: opts.current.teamSize ?? "",
        end_time: tsRel,
        ping: allUsers.map((u) => `<@${u}>`).join(" "),
        minutes: opts.minutes ?? "",
      };
      const r = await applyTemplate(opts.war.guild_id, slot, {}, { vars });
      if (r.content) chunks[0].content = r.content.slice(0, 1990);
    } catch (e) { console.error("template apply (reminder)", e); }
  }

  return chunks.map((c) => ({
    content: c.content.slice(0, 1990),
    allowed_mentions: { users: Array.from(new Set(c.users)).slice(0, 100) },
  }));
}

// --- Rule evaluation ---
export type RuleBreak = {
  player_tag: string;
  player_name: string;
  rule: string;
  detail: string;
  attack_window?: "first_16h" | "mid" | "last_8h";
};

export type ClanRules = {
  cleanup_window_hours: number;       // last-N-hours cleanup window (default 8)
  first_window_hours: number;         // early window from war start (default 16)
  early_min_stars_win: number;        // 2nd-attack stars threshold during early window (win)
  early_min_stars_lose: number;       // ... (lose)
  low_star_min_2nd_win: number;       // 2nd-attack min stars outside cleanup (win)
  low_star_min_2nd_lose: number;      // (lose)
  mirror_first_enabled: boolean;
  mirror_first_min_stars_win: number; // default 3
  mirror_first_min_stars_lose: number;// default 2
};

export const DEFAULT_CLAN_RULES: ClanRules = {
  cleanup_window_hours: 8,
  first_window_hours: 16,
  early_min_stars_win: 3,
  early_min_stars_lose: 2,
  low_star_min_2nd_win: 2,
  low_star_min_2nd_lose: 1,
  mirror_first_enabled: true,
  mirror_first_min_stars_win: 3,
  mirror_first_min_stars_lose: 2,
};

function parseRuleValue(key: keyof ClanRules, raw: string): any {
  if (key === "mirror_first_enabled") return raw === "true" || raw === "1";
  const n = Number(raw);
  return Number.isFinite(n) ? n : DEFAULT_CLAN_RULES[key];
}

export async function loadClanRules(guildId: string, clanTag: string): Promise<ClanRules> {
  const sb = adminClient();
  const { data } = await sb.from("clan_war_rules")
    .select("key,value").eq("guild_id", guildId).eq("clan_tag", clanTag);
  const out: ClanRules = { ...DEFAULT_CLAN_RULES };
  for (const r of (data ?? []) as { key: string; value: string }[]) {
    if (r.key in out) (out as any)[r.key] = parseRuleValue(r.key as keyof ClanRules, r.value);
  }
  return out;
}

function windowLabel(w: "first_16h" | "mid" | "last_8h", rules: ClanRules): string {
  if (w === "first_16h") return `first-${rules.first_window_hours}h`;
  if (w === "last_8h") return `last-${rules.cleanup_window_hours}h cleanup`;
  return "mid-war";
}

export function evaluateRules(opts: {
  decision: "win" | "lose" | "miss";
  startTime?: Date;
  endTime: Date;
  ourMembers: WarMember[];
  oppMembers?: WarMember[];
  attackTimes?: Record<string, Date | string>;
  rules?: ClanRules;
}): RuleBreak[] {
  // "miss" strategy = everyone is supposed to miss; no rule breaks to flag.
  if (opts.decision === "miss") return [];

  const rules = opts.rules ?? DEFAULT_CLAN_RULES;
  const breaks: RuleBreak[] = [];
  const cleanupStart = new Date(opts.endTime.getTime() - rules.cleanup_window_hours * 3600_000);
  const firstEnd = opts.startTime
    ? new Date(opts.startTime.getTime() + rules.first_window_hours * 3600_000)
    : null;
  const times = opts.attackTimes ?? {};
  const isWin = opts.decision === "win";
  const earlyMin = isWin ? rules.early_min_stars_win : rules.early_min_stars_lose;
  const lowMin2nd = isWin ? rules.low_star_min_2nd_win : rules.low_star_min_2nd_lose;
  const mirrorMin = isWin ? rules.mirror_first_min_stars_win : rules.mirror_first_min_stars_lose;

  const posMap: Record<string, number> = {};
  for (const m of (opts.oppMembers ?? [])) posMap[m.tag] = m.mapPosition;

  const classify = (ts: Date | null): "first_16h" | "mid" | "last_8h" => {
    if (!ts) return "mid";
    if (ts >= cleanupStart) return "last_8h";
    if (firstEnd && ts < firstEnd) return "first_16h";
    return "mid";
  };

  for (const m of opts.ourMembers) {
    const attacks = (m.attacks ?? []).slice().sort((a, b) => a.order - b.order);
    const myPos = m.mapPosition;

    if (attacks.length < 2) {
      breaks.push({
        player_tag: m.tag, player_name: m.name,
        rule: "missed_attack",
        detail: `Used ${attacks.length}/2 attacks`,
      });
    }

    // 1st attack mirror rule
    if (rules.mirror_first_enabled && attacks.length >= 1) {
      const a = attacks[0];
      const tsRaw = times[`${m.tag}:${a.order}`];
      const ts = tsRaw ? (tsRaw instanceof Date ? tsRaw : new Date(tsRaw)) : null;
      const win = classify(ts);
      const defPos = posMap[a.defenderTag] ?? -999;
      const isMirror = defPos === myPos;
      const winLabel = windowLabel(win, rules);
      if (!isMirror) {
        breaks.push({
          player_tag: m.tag, player_name: m.name,
          rule: "mirror_first",
          attack_window: win,
          detail: `1st attack should mirror own #${myPos} for ${mirrorMin}⭐ — hit #${defPos} for ${a.stars}⭐ (${winLabel})`,
        });
      } else if (a.stars < mirrorMin) {
        breaks.push({
          player_tag: m.tag, player_name: m.name,
          rule: "mirror_first",
          attack_window: win,
          detail: `1st attack mirrored own #${myPos} but only got ${a.stars}⭐ (need ${mirrorMin}⭐, ${winLabel})`,
        });
      }
    }

    // Per-attack rules — 2nd attack only
    for (let i = 0; i < attacks.length; i++) {
      const a = attacks[i];
      if (i < 1) continue; // 1st handled above
      const tsRaw = times[`${m.tag}:${a.order}`];
      const ts = tsRaw ? (tsRaw instanceof Date ? tsRaw : new Date(tsRaw)) : null;
      const win = classify(ts);
      const winLabel = windowLabel(win, rules);

      let flagged = false;

      // early_cleanup: 2nd attack before cleanup AND below early_min_stars threshold.
      // 3⭐ early 2nd attacks are fine (cleanup steal / loot).
      if (ts && win !== "last_8h" && a.stars < earlyMin) {
        breaks.push({
          player_tag: m.tag, player_name: m.name,
          rule: "early_cleanup",
          attack_window: win,
          detail: `2nd attack done in ${winLabel} got ${a.stars}⭐ (need ${earlyMin}⭐ outside cleanup)`,
        });
        flagged = true;
      }

      // low_stars on 2nd: only outside cleanup, only if not already flagged above.
      if (!flagged && win !== "last_8h" && a.stars < lowMin2nd) {
        breaks.push({
          player_tag: m.tag, player_name: m.name,
          rule: "low_stars",
          attack_window: win,
          detail: `2nd attack got ${a.stars}⭐ (need ${lowMin2nd}⭐ outside cleanup, ${winLabel})`,
        });
      }
    }
  }

  const seen = new Set<string>();
  return breaks.filter((b) => {
    const k = `${b.player_tag}|${b.rule}|${b.detail}`;
    if (seen.has(k)) return false;
    seen.add(k); return true;
  });
}

// Build final result embed + paginated violator embeds + .txt log.
// Returns:
//   embeds      — to send with the .txt file (page 1 + up to 1 violators page)
//   extraEmbeds — additional violator pages to send as separate follow-up messages
export async function buildResultEmbeds(opts: {
  warRow: any;
  breaks: RuleBreak[];
  ourMembers: WarMember[];
}): Promise<{ embeds: any[]; extraEmbeds: any[]; txt: string; content?: string }> {
  const w = opts.warRow;
  const violators = new Set(opts.breaks.map((b) => b.player_tag));
  const compliantCount = opts.ourMembers.length - violators.size;
  const okEmoji = "<a:tick:1447242811949711441>";
  const noEmoji = "<a:cross:1477055818229878915>";
  const allOk = violators.size === 0;
  const teamSize = w.team_size ?? opts.ourMembers.length;
  const maxAttacks = teamSize * 2;
  let usedAttacks = 0;
  let missedCount = 0;
  for (const m of opts.ourMembers) {
    const used = m.attacks?.length ?? 0;
    usedAttacks += used;
    if (used < 2) missedCount += (2 - used);
  }

  // Group violators by player
  const grouped: Record<string, RuleBreak[]> = {};
  for (const b of opts.breaks) (grouped[b.player_tag] ??= []).push(b);
  const violatorBlocks = Object.entries(grouped).map(([_, list]) => {
    const head = `**${list[0].player_name}** \`${list[0].player_tag}\``;
    const sub = list.map((b) => `• \`${b.rule}\` — ${b.detail}`).join("\n");
    return `${head}\n${sub}`;
  });

  // Paginate violator blocks into embeds of ≤ 3800 chars each
  const MAX = 3800;
  const pages: string[] = [];
  if (violatorBlocks.length === 0) {
    pages.push("No violations 🎉");
  } else {
    let cur = "";
    for (const block of violatorBlocks) {
      const add = (cur ? "\n\n" : "") + block;
      if (cur.length + add.length > MAX && cur) {
        pages.push(cur);
        cur = block;
      } else {
        cur += add;
      }
    }
    if (cur) pages.push(cur);
  }
  const totalPages = 1 + pages.length;

  const page1: any = {
    title: `${w.clan_name ?? w.clan_tag} vs ${w.opponent_name ?? w.opponent_tag} — Final Result`,
    description: `[${w.clan_name ?? w.clan_tag} (\`${w.clan_tag}\`)](${clanProfileLink(w.clan_tag)}) **VS** [${w.opponent_name ?? w.opponent_tag} (\`${w.opponent_tag}\`)](${clanProfileLink(w.opponent_tag)})`,
    color: w.result === "win" ? 0x57F287 : w.result === "lose" ? 0xED4245 : 0xF1B93B,
    fields: [
      { name: "Match Type", value: w.match_type ?? "—", inline: true },
      { name: "War Result", value: (w.result ?? "—").toUpperCase(), inline: true },
      { name: "Decision", value: (w.decision ?? "—").toUpperCase(), inline: true },
      { name: "Stars", value: `${w.our_stars ?? 0} vs ${w.opp_stars ?? 0}`, inline: true },
      { name: "Destruction", value: `${(w.our_destruction ?? 0).toFixed?.(2) ?? w.our_destruction ?? 0}% vs ${(w.opp_destruction ?? 0).toFixed?.(2) ?? w.opp_destruction ?? 0}%`, inline: true },
      { name: "Attacks Used", value: `${usedAttacks}/${maxAttacks}`, inline: true },
      { name: "Missed Attacks", value: String(missedCount), inline: true },
      { name: "Rules followed 100%", value: allOk ? okEmoji : noEmoji, inline: true },
      { name: "Compliant Players", value: String(compliantCount), inline: true },
      { name: "Players Breaking Rules", value: String(violators.size), inline: true },
    ],
    footer: { text: `Page 1/${totalPages}` },
    timestamp: new Date().toISOString(),
  };

  const violatorEmbeds = pages.map((desc, i) => ({
    title: `Rule violations — ${w.clan_name ?? w.clan_tag}${pages.length > 1 ? ` (${i + 1}/${pages.length})` : ""}`,
    description: desc,
    color: 0xED4245,
    footer: { text: `Page ${i + 2}/${totalPages}` },
  }));

  // .txt log
  const lines: string[] = [];
  lines.push(`War: ${w.clan_name ?? w.clan_tag} ${w.clan_tag} vs ${w.opponent_name ?? w.opponent_tag} ${w.opponent_tag}`);
  lines.push(`Ended: ${w.end_time}`);
  lines.push(`Decision: ${w.decision ?? "—"}    Result: ${w.result ?? "—"}`);
  lines.push(`Stars: ${w.our_stars}-${w.opp_stars}    Destruction: ${w.our_destruction}-${w.opp_destruction}`);
  lines.push("---");
  if (!opts.breaks.length) {
    lines.push("No rule violations.");
  } else {
    for (const [tag, list] of Object.entries(grouped)) {
      lines.push(`[${tag}] ${list[0].player_name}`);
      for (const b of list) {
        lines.push(`  - ${b.rule}: ${b.detail} (at ${(b as any).detected_at ?? new Date().toISOString()})`);
      }
    }
  }

  // Apply guild template override for war_win / war_lose
  let finalPage1: any = page1;
  let content: string | undefined;
  if (w.guild_id && (w.result === "win" || w.result === "lose")) {
    try {
      const { applyTemplate } = await import("./embed_templates.ts");
      const slot = w.result === "win" ? "war_win" : "war_lose";
      const vars = {
        clan: w.clan_name ?? w.clan_tag,
        opponent: w.opponent_name ?? w.opponent_tag,
        stars: w.our_stars ?? 0, opp_stars: w.opp_stars ?? 0,
        destruction: (w.our_destruction ?? 0).toFixed?.(2) ?? w.our_destruction ?? 0,
        opp_destruction: (w.opp_destruction ?? 0).toFixed?.(2) ?? w.opp_destruction ?? 0,
        team_size: w.team_size ?? "",
        result: (w.result ?? "").toUpperCase(),
      };
      const r = await applyTemplate(w.guild_id, slot, page1, { vars, keepFields: true });
      finalPage1 = r.embed; content = r.content;
    } catch (e) { console.error("template apply (result)", e); }
  }

  // First message carries page1 + first violator page; remainder ride in follow-up messages.
  const firstEmbeds = violatorEmbeds.length > 0 ? [finalPage1, violatorEmbeds[0]] : [finalPage1];
  const extraEmbeds = violatorEmbeds.slice(1);
  return { embeds: firstEmbeds, extraEmbeds, txt: lines.join("\n"), content };
}

