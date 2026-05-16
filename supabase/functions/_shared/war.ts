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
    footer: { text: "Reps: please select Win or Lose to lock in the strategy." },
    timestamp: new Date().toISOString(),
  };

  const select = {
    type: 1,
    components: [{
      type: 3, // STRING_SELECT
      custom_id: `war:decide:${opts.warId}`,
      placeholder: "Select Win or Lose",
      min_values: 1, max_values: 1,
      options: [
        { label: "Win this war", value: "win", emoji: { name: "🏆" } },
        { label: "Lose this war", value: "lose", emoji: { name: "🏳️" } },
      ],
    }],
  };

  return { embeds: [embed], components: [select] };
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
  reminderLabel: string; // "War Started" or "2h reminder"
  emoji: string;
  war: any; // wars row
  current: CurrentWar;
  slot?: "war_started" | "war_reminder";
  minutes?: number;
}): Promise<{ content: string; allowed_mentions: any }> {
  const thMap = await loadThEmojis();
  const sb = adminClient();
  const ours = opts.current.clan!;
  const opp = opts.current.opponent!;
  const members = ours.members ?? [];
  const teamSize = opts.current.teamSize ?? members.length;
  const maxAttacks = teamSize * 2;

  // Pull discord links for these tags
  const tags = members.map((m) => m.tag);
  const links: Record<string, string> = {};
  if (tags.length) {
    const { data } = await sb.from("coc_links").select("player_tag,user_id").in("player_tag", tags);
    for (const r of (data ?? []) as { player_tag: string; user_id: string }[]) {
      links[r.player_tag] = r.user_id;
    }
  }

  // Stats
  let usedAttacks = 0;
  let starsEarned = 0;
  for (const m of members) {
    const atks = m.attacks ?? [];
    usedAttacks += atks.length;
    for (const a of atks) starsEarned += a.stars;
  }
  const remainingCount = members.filter((m) => (m.attacks?.length ?? 0) < 2).length;

  const mentionedUsers: string[] = [];
  // Sort: TH desc, then map position asc
  const sorted = members.slice().sort((a, b) => (b.townhallLevel - a.townhallLevel) || (a.mapPosition - b.mapPosition));
  const lines = sorted
    .map((m) => {
      const used = m.attacks?.length ?? 0;
      const left = 2 - used;
      if (left <= 0) return null;
      let mention = "";
      if (links[m.tag]) {
        mention = ` | <@${links[m.tag]}>`;
        mentionedUsers.push(links[m.tag]);
      }
      return `(${used}/2) ${thEmoji(thMap, m.townhallLevel)} ${m.name} | \`${m.tag}\`${mention}`;
    })
    .filter(Boolean) as string[];

  // Header: "12h Remaining in War" (or label override for war_started)
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

  const headLine1 = `${opts.emoji} **${headerLabel}**`;
  const headLine2 = `**${ours.name}** vs **${opp.name}**`;
  const statsLine = `⚔️ ${usedAttacks}/${maxAttacks}   ⭐ ${starsEarned}/${teamSize * 3}`;
  const timeLine = endTs ? `🕒 <t:${Math.floor(endTs / 1000)}:F> (<t:${Math.floor(endTs / 1000)}:R>)` : "";

  // Body (may need to be chunked to fit 2000 chars; we keep it simple and slice)
  const remainingHeader = `Remaining (${remainingCount}/${teamSize}):`;
  const body = lines.length ? `${remainingHeader}\n${lines.join("\n")}` : "✅ All attacks used!";
  let content = [headLine1, headLine2, statsLine, timeLine, "", body].filter(Boolean).join("\n").slice(0, 1990);

  // Dedupe user IDs and cap to 100 (Discord limit)
  const uniqueUsers = Array.from(new Set(mentionedUsers)).slice(0, 100);

  // Allow guild template to override the content (placeholders interpolated).
  const slot = opts.slot ?? (opts.reminderLabel.toLowerCase().includes("started") ? "war_started" : "war_reminder");
  if (opts.war?.guild_id) {
    try {
      const { applyTemplate } = await import("./embed_templates.ts");
      const end = parseCocTime(opts.current.endTime ?? "")?.getTime();
      const vars = {
        clan: ours.name, opponent: opp.name,
        team_size: opts.current.teamSize ?? "",
        end_time: end ? `<t:${Math.floor(end / 1000)}:R>` : "",
        ping: uniqueUsers.map((u) => `<@${u}>`).join(" "),
        minutes: opts.minutes ?? "",
      };
      const r = await applyTemplate(opts.war.guild_id, slot, {}, { vars });
      if (r.content) content = r.content.slice(0, 1990);
    } catch (e) { console.error("template apply (reminder)", e); }
  }
  return { content, allowed_mentions: { users: uniqueUsers } };
}

// --- Rule evaluation ---
// decision = 'win' | 'lose'. Returns array of { player_tag, name, rule, detail } violations.
export type RuleBreak = { player_tag: string; player_name: string; rule: string; detail: string };

export function evaluateRules(opts: {
  decision: "win" | "lose";
  endTime: Date;
  ourMembers: WarMember[];
  oppMembers?: WarMember[];
  // Map of `${attackerTag}:${order}` -> first-observed timestamp (war_attacks.recorded_at).
  // Used to decide whether an attack happened inside the last-8h cleanup window.
  attackTimes?: Record<string, Date | string>;
}): RuleBreak[] {
  const breaks: RuleBreak[] = [];
  const last8Start = new Date(opts.endTime.getTime() - 8 * 3600_000);
  const times = opts.attackTimes ?? {};

  const posMap: Record<string, number> = {};
  for (const m of (opts.oppMembers ?? [])) posMap[m.tag] = m.mapPosition;

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

    // 1st attack mirror rule — clearer wording
    if (attacks.length >= 1) {
      const a = attacks[0];
      const defPos = posMap[a.defenderTag] ?? -999;
      const isMirror = defPos === myPos;
      const minStars = opts.decision === "win" ? 3 : 2;
      if (!isMirror) {
        breaks.push({
          player_tag: m.tag, player_name: m.name,
          rule: "mirror_first",
          detail: `1st attack should mirror own #${myPos} for ${minStars}⭐ — hit #${defPos} for ${a.stars}⭐`,
        });
      } else if (a.stars < minStars) {
        breaks.push({
          player_tag: m.tag, player_name: m.name,
          rule: "mirror_first",
          detail: `1st attack mirrored own #${myPos} but only got ${a.stars}⭐ (need ${minStars}⭐)`,
        });
      }
    }

    // Per-attack rules
    for (let i = 0; i < attacks.length; i++) {
      const a = attacks[i];
      const tsRaw = times[`${m.tag}:${a.order}`];
      const ts = tsRaw ? (tsRaw instanceof Date ? tsRaw : new Date(tsRaw)) : null;
      const inCleanup = ts ? ts >= last8Start : false;

      if (opts.decision === "win") {
        // 2nd attack must be inside last-8h cleanup window. Early 2nd attacks (esp. 3⭐ steals) = violation.
        if (i >= 1 && ts && !inCleanup) {
          breaks.push({
            player_tag: m.tag, player_name: m.name,
            rule: "early_cleanup",
            detail: `2nd attack #${a.order} done before last-8h cleanup window (got ${a.stars}⭐)`,
          });
        }
        // Low-star: 1st handled by mirror_first; 2nd needs ≥2⭐ unless in cleanup window (then 1⭐ ok).
        if (i >= 1 && a.stars < 2) {
          if (!(inCleanup && a.stars >= 1)) {
            breaks.push({
              player_tag: m.tag, player_name: m.name,
              rule: "low_stars",
              detail: `2nd attack #${a.order} got ${a.stars}⭐ (need 2⭐${inCleanup ? "" : ", or 1⭐ inside last-8h cleanup"})`,
            });
          }
        }
      } else {
        // Lose war: any attack must get ≥1⭐
        if (a.stars < 1) {
          breaks.push({
            player_tag: m.tag, player_name: m.name,
            rule: "low_stars",
            detail: `Attack #${a.order} got 0⭐ (need 1⭐)`,
          });
        }
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

// Build final result embed + page 2 + .txt log.
export async function buildResultEmbeds(opts: {
  warRow: any;
  breaks: RuleBreak[];
  ourMembers: WarMember[];
}): Promise<{ embeds: any[]; txt: string; content?: string }> {
  const w = opts.warRow;
  const violators = new Set(opts.breaks.map((b) => b.player_tag));
  const compliantCount = opts.ourMembers.length - violators.size;
  const okEmoji = "<a:tick:1447242811949711441>";
  const noEmoji = "<a:cross:1477055818229878915>";
  const allOk = violators.size === 0;

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
      { name: "Rules followed 100%", value: allOk ? okEmoji : noEmoji, inline: true },
      { name: "Compliant Players", value: String(compliantCount), inline: true },
      { name: "Players Breaking Rules", value: String(violators.size), inline: true },
    ],
    footer: { text: "Page 1/2" },
    timestamp: new Date().toISOString(),
  };

  // Page 2: list violators
  const grouped: Record<string, RuleBreak[]> = {};
  for (const b of opts.breaks) (grouped[b.player_tag] ??= []).push(b);
  const violatorLines = Object.entries(grouped).map(([_, list]) => {
    const head = `**${list[0].player_name}** \`${list[0].player_tag}\``;
    const sub = list.map((b) => `• \`${b.rule}\` — ${b.detail}`).join("\n");
    return `${head}\n${sub}`;
  });

  const page2 = {
    title: `Rule violations — ${w.clan_name ?? w.clan_tag}`,
    description: violatorLines.length ? violatorLines.join("\n\n").slice(0, 4000) : "No violations 🎉",
    color: 0xED4245,
    footer: { text: "Page 2/2" },
  };

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
        lines.push(`  - ${b.rule}: ${b.detail} (at ${b.detected_at ?? new Date().toISOString()})`);
      }
    }
  }
  // Apply guild template override for war_win / war_lose (interpolates title/description/footer/fields/content).
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
  return { embeds: [finalPage1, page2], txt: lines.join("\n"), content };
}
