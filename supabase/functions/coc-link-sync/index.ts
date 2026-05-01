// Cron (every 6h): refresh coc_links cache so reminders can mention linked Discord users.
// Walks all known players + war rosters and asks the coc-api proxy for the linked user_id.
import { corsHeaders } from "../_shared/cors.ts";
import { adminClient } from "../_shared/leaderboard.ts";
import { postCoc } from "../_shared/coc.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const sb = adminClient();

  // Pull a deduped list of player tags we care about: players we've polled + active war rosters
  const tags = new Set<string>();
  const { data: players } = await sb.from("players").select("tag").limit(5000);
  for (const p of (players ?? []) as { tag: string }[]) tags.add(p.tag);
  const { data: wars } = await sb.from("wars").select("raw_roster").neq("state", "warEnded").limit(200);
  for (const w of (wars ?? []) as { raw_roster: any }[]) {
    const ours = w?.raw_roster?.clan ?? [];
    for (const m of ours) if (m?.tag) tags.add(m.tag);
  }

  let synced = 0;
  for (const tag of tags) {
    try {
      const res: any = await postCoc({ action: "get", type: "player", filters: { tag } });
      const items: any[] = Array.isArray(res) ? res : (res?.items ?? res?.links ?? (res ? [res] : []));
      for (const it of items) {
        const uid = it?.user_id ?? it?.userId ?? it?.discord_id;
        if (uid) {
          await sb.from("coc_links").upsert({ player_tag: tag, user_id: String(uid), refreshed_at: new Date().toISOString() });
          synced++;
        }
      }
    } catch (_e) { /* ignore per-tag errors */ }
  }

  return new Response(JSON.stringify({ ok: true, scanned: tags.size, synced }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
