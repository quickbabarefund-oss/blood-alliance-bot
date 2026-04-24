// Scheduled every 5 minutes. Polls every active clan, snapshots donations,
// updates monthly aggregates with deltas, then refreshes Discord leaderboards.
import { corsHeaders } from "../_shared/cors.ts";
import { fetchClan, normalizeTag } from "../_shared/coc.ts";
import { adminClient, refreshAllDiscordMessages } from "../_shared/leaderboard.ts";
import { istMonthKey } from "../_shared/month.ts";

async function pollOne(clanTag: string) {
  const sb = adminClient();
  const startedAt = new Date().toISOString();
  const { data: run } = await sb.from("poll_runs").insert({ clan_tag: clanTag, status: "running", started_at: startedAt }).select("id").single();
  const runId = run?.id;

  try {
    const data = await fetchClan(clanTag);
    const members = data.memberList ?? [];
    const monthKey = istMonthKey();
    const nowIso = new Date().toISOString();

    // Update clan meta
    await sb.from("clans").update({
      name: data.name ?? "",
      badge_url: data.badgeUrls?.medium ?? null,
      member_count: members.length,
      last_polled_at: nowIso,
    }).eq("tag", clanTag);

    // For each member: upsert player, snapshot, compute delta vs last snapshot, update aggregate
    for (const m of members) {
      const ptag = normalizeTag(m.tag);
      const donated = m.donations ?? 0;
      const recv = m.donationsReceived ?? 0;

      // Upsert player
      await sb.from("players").upsert({
        tag: ptag,
        name: m.name ?? "",
        current_clan_tag: clanTag,
        role: m.role ?? null,
        town_hall: m.townHallLevel ?? null,
        last_seen_at: nowIso,
      }, { onConflict: "tag" });

      // Last snapshot for this player in this clan
      const { data: last } = await sb
        .from("donation_snapshots")
        .select("donations,donations_received,captured_at")
        .eq("player_tag", ptag)
        .eq("clan_tag", clanTag)
        .order("captured_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      // Delta logic: if current >= last, delta = current - last; else (in-game weekly reset) delta = current
      let dDon = donated;
      let dRecv = recv;
      if (last) {
        dDon = donated >= last.donations ? donated - last.donations : donated;
        dRecv = recv >= last.donations_received ? recv - last.donations_received : recv;
      } else {
        // First time we see this player — don't credit accumulated game value to this month
        dDon = 0;
        dRecv = 0;
      }

      // Insert snapshot
      await sb.from("donation_snapshots").insert({
        player_tag: ptag,
        clan_tag: clanTag,
        donations: donated,
        donations_received: recv,
        captured_at: nowIso,
      });

      // Update monthly aggregate (additive)
      if (dDon > 0 || dRecv > 0) {
        // Read existing
        const { data: agg } = await sb
          .from("monthly_aggregates")
          .select("id,donations,donations_received")
          .eq("month_key", monthKey)
          .eq("player_tag", ptag)
          .eq("clan_tag", clanTag)
          .maybeSingle();
        if (agg) {
          await sb.from("monthly_aggregates").update({
            donations: agg.donations + dDon,
            donations_received: agg.donations_received + dRecv,
            player_name: m.name ?? "",
            updated_at: nowIso,
          }).eq("id", agg.id);
        } else {
          await sb.from("monthly_aggregates").insert({
            month_key: monthKey,
            player_tag: ptag,
            player_name: m.name ?? "",
            clan_tag: clanTag,
            donations: dDon,
            donations_received: dRecv,
            updated_at: nowIso,
          });
        }
      } else {
        // Still ensure a zero row exists for this month so leaderboard shows the player
        const { data: agg } = await sb
          .from("monthly_aggregates")
          .select("id")
          .eq("month_key", monthKey)
          .eq("player_tag", ptag)
          .eq("clan_tag", clanTag)
          .maybeSingle();
        if (!agg) {
          await sb.from("monthly_aggregates").insert({
            month_key: monthKey,
            player_tag: ptag,
            player_name: m.name ?? "",
            clan_tag: clanTag,
            donations: 0,
            donations_received: 0,
            updated_at: nowIso,
          });
        } else {
          await sb.from("monthly_aggregates").update({ player_name: m.name ?? "", updated_at: nowIso }).eq("id", agg.id);
        }
      }
    }

    if (runId) await sb.from("poll_runs").update({ status: "ok", finished_at: new Date().toISOString(), message: `${members.length} members` }).eq("id", runId);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("pollOne error", clanTag, msg);
    if (runId) await sb.from("poll_runs").update({ status: "error", finished_at: new Date().toISOString(), message: msg }).eq("id", runId);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const sb = adminClient();
  let onlyClan: string | null = null;
  try {
    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      if (body?.clan_tag) onlyClan = normalizeTag(body.clan_tag);
    }
  } catch { /* ignore */ }

  const q = sb.from("clans").select("tag").eq("active", true);
  const { data: clans } = onlyClan ? await q.eq("tag", onlyClan) : await q;

  for (const c of clans ?? []) {
    await pollOne(c.tag);
  }

  // Prune old data
  await sb.rpc("prune_old_snapshots").catch(() => {});

  // Refresh discord leaderboards
  try { await refreshAllDiscordMessages(); } catch (e) { console.error("discord refresh", e); }

  return new Response(JSON.stringify({ ok: true, polled: clans?.length ?? 0 }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
