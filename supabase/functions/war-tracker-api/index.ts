// War Tracker public API — powers the /war/:clanTag dashboard.
// Actions:
//   GET ?action=live&clan=#TAG&guild=GID         — current war + momentum + win prob + live feed
//   GET ?action=debrief&clan=#TAG&guild=GID      — most recent completed war + violations
//   GET ?action=overview&clan=#TAG&guild=GID     — clan info + last N war results
//   GET ?action=rules&clan=#TAG&guild=GID        — read current clan_war_rules
//   POST {action:"rules_set", clan, guild, token, rules:{...}} — admin update via edit token
import { corsHeaders } from "../_shared/cors.ts";
import { adminClient } from "../_shared/leaderboard.ts";
import { postCoc, normalizeTag, fetchClan } from "../_shared/coc.ts";
import {
  CurrentWar, parseCocTime, loadClanRules, DEFAULT_CLAN_RULES, evaluateRules,
} from "../_shared/war.ts";

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function bad(msg: string, status = 400) { return ok({ error: msg }, status); }

async function fetchCurrentWar(tag: string): Promise<CurrentWar | null> {
  try { return await postCoc<CurrentWar>({ action: "current_war", tag: normalizeTag(tag) }); }
  catch (e) { console.error("current_war failed", tag, e); return null; }
}

function pctSafe(n?: number) { return Math.round((n ?? 0) * 10) / 10; }

function computeMomentum(cw: CurrentWar): number {
  const ourS = cw.clan?.stars ?? 0;
  const oppS = cw.opponent?.stars ?? 0;
  const total = ourS + oppS;
  if (total === 0) return 50;
  return Math.round((ourS / total) * 100);
}

function computeWinProb(cw: CurrentWar): number {
  const ts = cw.teamSize ?? cw.clan?.members?.length ?? 50;
  const starsDiff = (cw.clan?.stars ?? 0) - (cw.opponent?.stars ?? 0);
  const desDiff = (cw.clan?.destructionPercentage ?? 0) - (cw.opponent?.destructionPercentage ?? 0);
  let p = 0.5 + 0.5 * (starsDiff / (ts * 3)) + 0.2 * (desDiff / 100);
  p = Math.max(0.05, Math.min(0.95, p));
  return Math.round(p * 100);
}

function buildLiveFeed(cw: CurrentWar) {
  const ts = cw.teamSize ?? cw.clan?.members?.length ?? 50;
  const oppByTag: Record<string, number> = {};
  for (const m of (cw.opponent?.members ?? [])) oppByTag[m.tag] = m.mapPosition;
  const items: any[] = [];
  for (const m of (cw.clan?.members ?? [])) {
    for (const a of (m.attacks ?? [])) {
      const defPos = oppByTag[a.defenderTag] ?? null;
      const isMirror = defPos === m.mapPosition;
      let badge: "CLUTCH" | "RISKY" | null = null;
      if (a.stars === 3) badge = "CLUTCH";
      else if (a.stars < 2) badge = "RISKY";
      items.push({
        attacker_tag: m.tag,
        attacker_name: m.name,
        attacker_pos: m.mapPosition,
        attacker_th: m.townhallLevel,
        defender_tag: a.defenderTag,
        defender_pos: defPos,
        stars: a.stars,
        destruction: Math.round(a.destructionPercentage),
        order: a.order,
        mirror: isMirror,
        badge,
      });
    }
  }
  items.sort((a, b) => b.order - a.order);
  // Priority targets = opp bases not yet 3-starred
  const oppHits: Record<string, number> = {};
  for (const m of (cw.clan?.members ?? [])) {
    for (const a of (m.attacks ?? [])) {
      oppHits[a.defenderTag] = Math.max(oppHits[a.defenderTag] ?? 0, a.stars);
    }
  }
  const priorityTargets = (cw.opponent?.members ?? [])
    .filter((m) => (oppHits[m.tag] ?? 0) < 3)
    .map((m) => ({ tag: m.tag, name: m.name, pos: m.mapPosition, th: m.townhallLevel, best_stars: oppHits[m.tag] ?? 0 }))
    .sort((a, b) => a.pos - b.pos);
  return { items, priorityTargets, teamSize: ts };
}

async function handleLive(clanTag: string) {
  const cw = await fetchCurrentWar(clanTag);
  if (!cw || cw.state === "notInWar" || !cw.clan || !cw.opponent) {
    return ok({ state: "notInWar" });
  }
  const startTime = parseCocTime(cw.startTime);
  const endTime = parseCocTime(cw.endTime);
  const { items, priorityTargets, teamSize } = buildLiveFeed(cw);
  const ourAtkUsed = (cw.clan.members ?? []).reduce((n, m) => n + (m.attacks?.length ?? 0), 0);
  const oppAtkUsed = (cw.opponent.members ?? []).reduce((n, m) => n + (m.attacks?.length ?? 0), 0);
  return ok({
    state: cw.state,
    team_size: teamSize,
    start_time: startTime?.toISOString() ?? null,
    end_time: endTime?.toISOString() ?? null,
    clan: {
      tag: cw.clan.tag, name: cw.clan.name, badge: cw.clan.badgeUrls?.medium ?? null,
      stars: cw.clan.stars ?? 0, destruction: pctSafe(cw.clan.destructionPercentage), attacks: ourAtkUsed,
    },
    opponent: {
      tag: cw.opponent.tag, name: cw.opponent.name, badge: cw.opponent.badgeUrls?.medium ?? null,
      stars: cw.opponent.stars ?? 0, destruction: pctSafe(cw.opponent.destructionPercentage), attacks: oppAtkUsed,
    },
    momentum: computeMomentum(cw),
    win_prob: computeWinProb(cw),
    priority_targets: priorityTargets,
    feed: items,
  });
}

async function handleRoom(clanTag: string, guildId: string) {
  const cw = await fetchCurrentWar(clanTag);
  if (!cw || !cw.clan || !cw.opponent) return ok({ state: "notInWar" });
  const oppByPos: Record<number, any> = {};
  for (const m of (cw.opponent.members ?? [])) oppByPos[m.mapPosition] = m;
  const roster = (cw.clan.members ?? []).slice()
    .sort((a, b) => a.mapPosition - b.mapPosition)
    .map((m) => {
      const used = m.attacks?.length ?? 0;
      const stars = (m.attacks ?? []).reduce((n, a) => n + a.stars, 0);
      const mirror = oppByPos[m.mapPosition];
      const firstAttack = (m.attacks ?? []).sort((a, b) => a.order - b.order)[0];
      return {
        tag: m.tag, name: m.name, th: m.townhallLevel, pos: m.mapPosition,
        used, stars,
        mirror: mirror ? { tag: mirror.tag, name: mirror.name, th: mirror.townhallLevel } : null,
        first_attack: firstAttack ? {
          defender_tag: firstAttack.defenderTag,
          defender_pos: (cw.opponent.members ?? []).find((x) => x.tag === firstAttack.defenderTag)?.mapPosition ?? null,
          stars: firstAttack.stars, destruction: Math.round(firstAttack.destructionPercentage),
        } : null,
      };
    });
  return ok({ state: cw.state, end_time: parseCocTime(cw.endTime)?.toISOString() ?? null, roster });
}

async function handleDebrief(clanTag: string, guildId: string) {
  const sb = adminClient();
  const { data: war } = await sb.from("wars")
    .select("*").eq("guild_id", guildId).eq("clan_tag", clanTag)
    .eq("result_posted", true)
    .order("end_time", { ascending: false }).limit(1).maybeSingle();
  if (!war) return ok({ war: null });
  const { data: breaks } = await sb.from("war_rule_breaks")
    .select("*").eq("war_id", war.id);
  const { data: attacks } = await sb.from("war_attacks")
    .select("*").eq("war_id", war.id);
  return ok({ war, breaks: breaks ?? [], attacks: attacks ?? [] });
}

async function handleOverview(clanTag: string, guildId: string) {
  const sb = adminClient();
  let clan: any = null;
  try { clan = await fetchClan(clanTag); } catch (e) { console.error("fetchClan", e); }
  const { data: history } = await sb.from("wars")
    .select("id,opponent_name,opponent_tag,result,decision,our_stars,opp_stars,our_destruction,opp_destruction,end_time,match_type")
    .eq("guild_id", guildId).eq("clan_tag", clanTag)
    .eq("result_posted", true)
    .order("end_time", { ascending: false }).limit(10);
  const wins = (history ?? []).filter((w) => w.result === "win").length;
  const losses = (history ?? []).filter((w) => w.result === "lose").length;
  return ok({
    clan: clan ? {
      tag: clan.tag, name: clan.name, badge: clan.badgeUrls?.large ?? clan.badgeUrls?.medium ?? null,
      members: clan.members ?? clan.memberList?.length ?? 0,
      level: (clan as any).clanLevel ?? null,
      description: (clan as any).description ?? null,
    } : null,
    history: history ?? [],
    record: { wins, losses, total: (history ?? []).length },
  });
}

async function handleRulesGet(clanTag: string, guildId: string) {
  const rules = await loadClanRules(guildId, clanTag);
  return ok({ rules, defaults: DEFAULT_CLAN_RULES });
}

async function handleRulesSet(body: any) {
  const { clan, guild, token, rules } = body ?? {};
  if (!clan || !guild || !token || !rules) return bad("missing fields");
  const sb = adminClient();
  const { data: tok } = await sb.from("embed_edit_tokens")
    .select("guild_id,expires_at").eq("token", token).maybeSingle();
  if (!tok || tok.guild_id !== guild) return bad("invalid token", 401);
  if (new Date(tok.expires_at).getTime() < Date.now()) return bad("token expired", 401);

  const valid = Object.keys(DEFAULT_CLAN_RULES);
  const rows: any[] = [];
  for (const [k, v] of Object.entries(rules)) {
    if (!valid.includes(k)) continue;
    rows.push({ guild_id: guild, clan_tag: clan, key: k, value: String(v), updated_at: new Date().toISOString() });
  }
  if (rows.length === 0) return bad("no valid rules");
  const { error } = await sb.from("clan_war_rules").upsert(rows, { onConflict: "guild_id,clan_tag,key" });
  if (error) return bad(error.message, 500);
  return ok({ ok: true, updated: rows.length });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const url = new URL(req.url);
    let action = url.searchParams.get("action") ?? "";
    let clan = url.searchParams.get("clan") ?? "";
    let guild = url.searchParams.get("guild") ?? "";

    let body: any = null;
    if (req.method === "POST") {
      body = await req.json().catch(() => ({}));
      action = body.action ?? action;
      clan = body.clan ?? clan;
      guild = body.guild ?? guild;
    }
    if (clan && !clan.startsWith("#")) clan = "#" + clan;
    clan = normalizeTag(clan);

    if (action === "rules_set") return await handleRulesSet(body);
    if (!clan) return bad("missing clan tag");

    switch (action) {
      case "live":     return await handleLive(clan);
      case "room":     return await handleRoom(clan, guild);
      case "debrief":  return await handleDebrief(clan, guild);
      case "overview": return await handleOverview(clan, guild);
      case "rules":    return await handleRulesGet(clan, guild);
      default:         return bad("unknown action");
    }
  } catch (e) {
    console.error("war-tracker-api error", e);
    return bad(e instanceof Error ? e.message : String(e), 500);
  }
});
