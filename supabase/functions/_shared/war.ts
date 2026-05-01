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

// Verify war against fwastats.com — returns true if match is FWA-flagged.
export async function isFwaMatch(ourTag: string, oppTag: string): Promise<boolean> {
  try {
    const url = `https://fwastats.com/Clan/${tagNoHash(ourTag)}/Wars.json`;
    const res = await fetch(url, { headers: { "User-Agent": "ClanLootTracker/1.0" } });
    if (!res.ok) {
      console.log("fwastats lookup non-ok", ourTag, res.status);
      return false;
    }
    const data = await res.json();
    const wars: any[] = Array.isArray(data) ? data : (data?.Wars ?? data?.wars ?? []);
    const oppNorm = tagNoHash(oppTag);
    const found = wars.find((w: any) => {
      const t = tagNoHash(w?.OpponentTag ?? w?.opponentTag ?? w?.opponent_tag ?? "");
      return t === oppNorm;
    });
    if (!found) return false;
    // Most fwastats records carry a "MatchType" / "WarType" or similar field. If present, check it.
    const type = (found.MatchType ?? found.WarType ?? found.matchType ?? "").toString().toLowerCase();
    if (!type) return true; // present in fwastats list at all = high confidence FWA
    return type.includes("fwa") || type.includes("match");
  } catch (e) {
    console.error("isFwaMatch error", e);
    return false;
  }
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

// Build a war-started or reminder embed showing players who still owe attacks.
export async function buildReminderPayload(opts: {
  reminderLabel: string; // "War Started" or "2h reminder"
  emoji: string;
  war: any; // wars row
  current: CurrentWar;
}): Promise<{ embeds: any[]; content?: string }> {
  const thMap = await loadThEmojis();
  const sb = adminClient();
  const ours = opts.current.clan!;
  const opp = opts.current.opponent!;
  const members = ours.members ?? [];

  // Pull discord links for these tags
  const tags = members.map((m) => m.tag);
  const links: Record<string, string> = {};
  if (tags.length) {
    const { data } = await sb.from("coc_links").select("player_tag,user_id").in("player_tag", tags);
    for (const r of (data ?? []) as { player_tag: string; user_id: string }[]) {
      links[r.player_tag] = r.user_id;
    }
  }

  const lines = members
    .map((m) => {
      const used = m.attacks?.length ?? 0;
      const left = 2 - used; // standard war = 2 attacks each
      if (left <= 0) return null;
      const mention = links[m.tag] ? `<@${links[m.tag]}>` : "";
      return `⚔️ ${left}/2 | ${thEmoji(thMap, m.townhallLevel)} **${m.name}** | \`${m.tag}\` ${mention}`.trim();
    })
    .filter(Boolean)
    .join("\n");

  const embed = {
    title: `${opts.emoji} ${opts.reminderLabel}`,
    description: `[${ours.name} (\`${ours.tag}\`)](${clanProfileLink(ours.tag)}) **VS** [${opp.name} (\`${opp.tag}\`)](${clanProfileLink(opp.tag)})\n\n${lines || "✅ All attacks used!"}`,
    color: 0x4A8DFF,
    timestamp: new Date().toISOString(),
  };
  return { embeds: [embed] };
}

// --- Rule evaluation ---
// decision = 'win' | 'lose'. Returns array of { player_tag, name, rule, detail } violations.
export type RuleBreak = { player_tag: string; player_name: string; rule: string; detail: string };

export function evaluateRules(opts: {
  decision: "win" | "lose";
  endTime: Date;
  ourMembers: WarMember[];
}): RuleBreak[] {
  const breaks: RuleBreak[] = [];
  const last8Start = new Date(opts.endTime.getTime() - 8 * 3600_000);

  // Build map: tag -> mapPosition
  const posMap: Record<string, number> = {};
  for (const m of opts.ourMembers) posMap[m.tag] = m.mapPosition;

  for (const m of opts.ourMembers) {
    const attacks = (m.attacks ?? []).slice().sort((a, b) => a.order - b.order);
    const myPos = m.mapPosition;

    // missed attacks
    if (attacks.length < 2) {
      breaks.push({
        player_tag: m.tag, player_name: m.name,
        rule: "missed_attack",
        detail: `Used ${attacks.length}/2 attacks`,
      });
    }

    // 1st attack mirror rule
    if (attacks.length >= 1) {
      const a = attacks[0];
      const defPos = posMap[a.defenderTag] ?? -999;
      const isMirror = defPos === myPos;
      if (opts.decision === "win") {
        if (!isMirror || a.stars < 3) {
          breaks.push({
            player_tag: m.tag, player_name: m.name,
            rule: "mirror_first",
            detail: `1st attack ${isMirror ? "mirror" : `pos ${defPos} (own ${myPos})`} got ${a.stars}⭐ — expected mirror 3⭐`,
          });
        }
      } else {
        if (!isMirror || a.stars < 2) {
          breaks.push({
            player_tag: m.tag, player_name: m.name,
            rule: "mirror_first",
            detail: `1st attack ${isMirror ? "mirror" : `pos ${defPos} (own ${myPos})`} got ${a.stars}⭐ — expected mirror 2⭐`,
          });
        }
      }
    }

    // Window rules per attack
    // Note: CoC API doesn't timestamp individual attacks; use attack order as proxy isn't perfect.
    // We approximate: if war has reached last8 window AND this attack hasn't been logged yet at recording time,
    // we treat newly-observed attacks as "current window" (handled by war-poll when inserting).
    // Here, evaluate retrospectively by ALL attacks based on whether attack passes minimum stars.
    for (let i = 0; i < attacks.length; i++) {
      const a = attacks[i];
      const minWin = i === 0 ? 3 : 2; // win war: any 2nd attack >= 2
      const minLose = i === 0 ? 2 : 1;
      if (opts.decision === "win") {
        if (a.stars < 2) {
          breaks.push({ player_tag: m.tag, player_name: m.name, rule: "low_stars",
            detail: `Attack #${a.order} got ${a.stars}⭐ (min ${minWin === 3 && i === 0 ? "3⭐ mirror" : "2⭐"})` });
        }
      } else {
        if (a.stars < 1) {
          breaks.push({ player_tag: m.tag, player_name: m.name, rule: "low_stars",
            detail: `Attack #${a.order} got 0⭐ (min ${minLose}⭐)` });
        }
      }
    }
  }

  // Dedupe (player + rule + detail)
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
}): Promise<{ embeds: any[]; txt: string }> {
  const w = opts.warRow;
  const violators = new Set(opts.breaks.map((b) => b.player_tag));
  const compliantCount = opts.ourMembers.length - violators.size;
  const okEmoji = "<a:tick:1447242811949711441>";
  const noEmoji = "<a:cross:1477055818229878915>";
  const allOk = violators.size === 0;

  const page1 = {
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
  return { embeds: [page1, page2], txt: lines.join("\n") };
}
