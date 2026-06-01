// Parse FWA Points Database recommendation for a clan.
// Source: https://points.fwafarm.com/clan?tag=<TAG>
// The "winner-box" paragraph contains a sentence like:
//   "<b>Blood Bound</b> should win by tiebreak (8 = 8, high sync)"
// We extract which clan is recommended to win, then compare to OUR tag
// to return decision: "win" | "lose".
//
// points.fwafarm.com is fronted by Cloudflare which sometimes serves a JS
// challenge to bot-looking clients. We send realistic browser headers so the
// challenge is bypassed, and detect the challenge page so callers can show
// "blocked" vs "verdict not yet posted" instead of conflating the two.

export type FwaRecommendation = {
  winnerName: string;
  winnerTag: string;
  decision: "win" | "lose";
  reason: string;          // e.g. "points (10 > 6)" / "tiebreak (8 = 8, high sync)"
  warId?: string | null;   // FWA war id (for traceability)
  winCalculatorUrl: string;
};

export type FwaStatus = "ok" | "not_posted" | "blocked" | "error";

export type FwaResult = {
  status: FwaStatus;
  rec: FwaRecommendation | null;
};

function stripHash(t: string): string {
  return (t ?? "").replace(/^#/, "").trim().toUpperCase();
}

// 5-minute in-memory cache so we don't hammer fwafarm for every poll + every
// /current_war invocation. Edge functions persist this between invocations on
// warm starts.
const CACHE = new Map<string, { at: number; res: FwaResult }>();
const CACHE_TTL_MS = 5 * 60_000;

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept":
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Referer": "https://points.fwafarm.com/",
  "Upgrade-Insecure-Requests": "1",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-User": "?1",
  "sec-ch-ua": '"Chromium";v="124", "Not-A.Brand";v="99"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"Windows"',
};

function isCloudflareChallenge(html: string): boolean {
  return /Just a moment|cf_chl_opt|challenge-platform|__cf_chl_/i.test(html);
}

// Primary source: clashbotdata aggregated endpoint that's keyed by clan tag
// and returns { wartype, result } per clan. Avoids Cloudflare entirely.
const CBD_URL = "http://clashbotdata.duckdns.org:3015/wartype";
type CbdMap = Record<string, { wartype?: string; result?: string }>;
let CBD_CACHE: { at: number; map: CbdMap } | null = null;

async function fetchClashbotdata(): Promise<CbdMap | null> {
  if (CBD_CACHE && Date.now() - CBD_CACHE.at < CACHE_TTL_MS) return CBD_CACHE.map;
  try {
    const res = await fetch(CBD_URL);
    if (!res.ok) { console.log("clashbotdata non-ok", res.status); return null; }
    const json = (await res.json()) as CbdMap;
    CBD_CACHE = { at: Date.now(), map: json };
    return json;
  } catch (e) {
    console.error("clashbotdata fetch error", e);
    return null;
  }
}

function lookupCbd(map: CbdMap, tag: string): { wartype: string; result: string } | null {
  // The endpoint keys include '#'. Normalize for safety.
  const target = stripHash(tag);
  for (const [k, v] of Object.entries(map)) {
    if (stripHash(k) === target) {
      return { wartype: (v.wartype ?? "").trim(), result: (v.result ?? "").trim() };
    }
  }
  return null;
}

export async function fetchFwa(ourTag: string): Promise<FwaResult> {
  const tag = stripHash(ourTag);
  if (!tag) return { status: "error", rec: null };

  const cached = CACHE.get(tag);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.res;

  let result: FwaResult = { status: "error", rec: null };

  // 1) Try clashbotdata first.
  const cbd = await fetchClashbotdata();
  const hit = cbd ? lookupCbd(cbd, tag) : null;
  if (hit) {
    const r = hit.result.toLowerCase();
    if (r === "win" || r === "lose") {
      result = {
        status: "ok",
        rec: {
          winnerName: r === "win" ? "Our clan" : "Opponent",
          winnerTag: r === "win" ? tag : "",
          decision: r as "win" | "lose",
          reason: `${hit.wartype} — ${r.toUpperCase()}`,
          warId: null,
          winCalculatorUrl: `https://points.fwafarm.com/clan?tag=${tag}`,
        },
      };
    } else {
      // wartype known (e.g. Blacklisted Match) but no decision yet.
      result = { status: "not_posted", rec: null };
    }
  } else {
    // 2) Fall back to scraping points.fwafarm.com.
    try {
      const res = await fetch(`https://points.fwafarm.com/clan?tag=${tag}`, {
        headers: BROWSER_HEADERS,
        redirect: "follow",
      });
      const html = await res.text();
      if (!res.ok) {
        console.log("fwa points non-ok", tag, res.status);
      } else if (isCloudflareChallenge(html)) {
        console.log("fwa points: cloudflare challenge for", tag);
        result = { status: "blocked", rec: null };
      } else {
        const boxMatch = /<p class="winner-box">([\s\S]*?)<\/p>/i.exec(html);
        if (!boxMatch) {
          result = { status: "not_posted", rec: null };
        } else {
          const box = boxMatch[1];
          const decisionMatch = /<b>([^<]+)<\/b>\s*should\s+win\s+by\s+([^<\n]+?)(?:<|$)/i.exec(box);
          if (!decisionMatch) {
            result = { status: "not_posted", rec: null };
          } else {
            const winnerName = decisionMatch[1].trim();
            const reason = decisionMatch[2].replace(/\s+/g, " ").trim();
            const pairRe = /([^()<>\n]+?)\s*\(<a[^>]*tag=([A-Z0-9]+)[^>]*>\s*\2\s*<\/a>\)/g;
            const pairs: Array<{ name: string; tag: string }> = [];
            let pm: RegExpExecArray | null;
            while ((pm = pairRe.exec(box))) pairs.push({ name: pm[1].trim(), tag: pm[2].trim().toUpperCase() });
            const winner = pairs.find((p) => p.name === winnerName)
              ?? pairs.find((p) => winnerName.includes(p.name) || p.name.includes(winnerName));
            if (winner) {
              const warIdMatch = /\?id=(\d+)/.exec(box);
              const decision: "win" | "lose" = winner.tag === tag ? "win" : "lose";
              result = {
                status: "ok",
                rec: {
                  winnerName: winner.name,
                  winnerTag: winner.tag,
                  decision,
                  reason,
                  warId: warIdMatch?.[1] ?? null,
                  winCalculatorUrl: `https://points.fwafarm.com/clan?tag=${tag}`,
                },
              };
            } else {
              result = { status: "not_posted", rec: null };
            }
          }
        }
      }
    } catch (e) {
      console.error("fetchFwa error", tag, e);
    }
  }

  CACHE.set(tag, { at: Date.now(), res: result });
  return result;
}

// Back-compat wrapper used by older callers that only need the recommendation.
export async function fetchFwaRecommendation(ourTag: string): Promise<FwaRecommendation | null> {
  const { rec } = await fetchFwa(ourTag);
  return rec;
}

// Render a single Discord embed field describing the FWA verdict, given a
// status + optional rec. Use this from both the reps approval embed and
// /current_war so the wording is consistent.
export function fwaVerdictField(status: FwaStatus, rec: FwaRecommendation | null, ourTag: string) {
  const calc = `https://points.fwafarm.com/clan?tag=${stripHash(ourTag)}`;
  if (status === "ok" && rec) {
    const verdict = rec.decision === "win" ? "🏆 **WIN**" : "🏳️ **LOSE**";
    return {
      name: "🍫 FWA Verdict",
      value: `${verdict} — _${rec.reason}_\n[Win Calculator ↗](${rec.winCalculatorUrl})`,
      inline: false,
    };
  }
  if (status === "blocked") {
    return {
      name: "🍫 FWA Verdict",
      value: `_Could not reach points.fwafarm.com (rate limited) — will retry._ [Open ↗](${calc})`,
      inline: false,
    };
  }
  return {
    name: "🍫 FWA Verdict",
    value: `_FWA match — verdict not yet posted on points.fwafarm.com._ [Open ↗](${calc})`,
    inline: false,
  };
}
