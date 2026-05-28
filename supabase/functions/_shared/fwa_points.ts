// Parse FWA Points Database recommendation for a clan.
// Source: https://points.fwafarm.com/clan?tag=<TAG>
// The "winner-box" paragraph contains a sentence like:
//   "<b>Blood Bound</b> should win by tiebreak (8 = 8, high sync)"
// We extract which clan is recommended to win, then compare to OUR tag
// to return decision: "win" | "lose".

export type FwaRecommendation = {
  winnerName: string;
  winnerTag: string;
  decision: "win" | "lose";
  reason: string;          // e.g. "points (10 > 6)" / "tiebreak (8 = 8, high sync)"
  warId?: string | null;   // FWA war id (for traceability)
};

function stripHash(t: string): string {
  return (t ?? "").replace(/^#/, "").trim().toUpperCase();
}

export async function fetchFwaRecommendation(ourTag: string): Promise<FwaRecommendation | null> {
  const tag = stripHash(ourTag);
  if (!tag) return null;
  try {
    const res = await fetch(`https://points.fwafarm.com/clan?tag=${tag}`, {
      headers: { "User-Agent": "ValkonWarBot/1.0 (+war-tracker)" },
    });
    if (!res.ok) {
      console.log("fwa points fetch non-ok", tag, res.status);
      return null;
    }
    const html = await res.text();

    const boxMatch = /<p class="winner-box">([\s\S]*?)<\/p>/i.exec(html);
    if (!boxMatch) return null;
    const box = boxMatch[1];

    // Decision sentence: "<b>NAME</b> should win by REASON"
    const decisionMatch = /<b>([^<]+)<\/b>\s*should\s+win\s+by\s+([^<\n]+?)(?:<|$)/i.exec(box);
    if (!decisionMatch) return null;
    const winnerName = decisionMatch[1].trim();
    const reason = decisionMatch[2].replace(/\s+/g, " ").trim();

    // Pairs of "Name (<a ...?tag=XYZ">XYZ</a>)" — both clans on the vs line.
    const pairRe = /([^()<>\n]+?)\s*\(<a[^>]*tag=([A-Z0-9]+)[^>]*>\s*\2\s*<\/a>\)/g;
    const pairs: Array<{ name: string; tag: string }> = [];
    let pm: RegExpExecArray | null;
    while ((pm = pairRe.exec(box))) pairs.push({ name: pm[1].trim(), tag: pm[2].trim().toUpperCase() });

    // Match the bold winner name to one of the two clans.
    const winner = pairs.find((p) => p.name === winnerName)
      ?? pairs.find((p) => winnerName.includes(p.name) || p.name.includes(winnerName));
    if (!winner) return null;

    const warIdMatch = /\?id=(\d+)/.exec(box);
    const decision: "win" | "lose" = winner.tag === tag ? "win" : "lose";

    return {
      winnerName: winner.name,
      winnerTag: winner.tag,
      decision,
      reason,
      warId: warIdMatch?.[1] ?? null,
    };
  } catch (e) {
    console.error("fetchFwaRecommendation error", tag, e);
    return null;
  }
}
