import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/DataTable";
import { History, Search, Shield, Trophy, User } from "lucide-react";
import { istMonthKey, timeAgo } from "@/lib/format";

type Player = { tag: string; name: string; current_clan_tag: string | null; role: string | null; town_hall: number | null; last_seen_at: string };
type Snap = { id: number; clan_tag: string; donations: number; donations_received: number; captured_at: string };
type Agg = { month_key: string; clan_tag: string; donations: number; donations_received: number };
type Clan = { tag: string; name: string; badge_url: string | null; member_count: number };

function normTag(t: string) {
  let x = t.trim().toUpperCase();
  if (!x.startsWith("#")) x = "#" + x;
  return x;
}

export default function PlayerHistory() {
  const [params, setParams] = useSearchParams();
  const initial = params.get("tag") ?? "";
  const [input, setInput] = useState(initial);
  const [tag, setTag] = useState(initial ? normTag(initial) : "");
  const [player, setPlayer] = useState<Player | null>(null);
  const [snaps, setSnaps] = useState<Snap[]>([]);
  const [aggs, setAggs] = useState<Agg[]>([]);
  const [clan, setClan] = useState<Clan | null>(null);
  const [rank, setRank] = useState<{ pos: number; total: number; donations: number } | null>(null);
  const [blacklisted, setBlacklisted] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tag) return;
    setLoading(true);
    setRank(null);
    setClan(null);
    setBlacklisted(false);
    const monthNow = istMonthKey();
    Promise.all([
      supabase.from("players").select("*").eq("tag", tag).maybeSingle(),
      supabase.from("donation_snapshots").select("id,clan_tag,donations,donations_received,captured_at").eq("player_tag", tag).order("captured_at", { ascending: false }).limit(500),
      supabase.from("monthly_aggregates").select("month_key,clan_tag,donations,donations_received").eq("player_tag", tag).order("month_key", { ascending: false }),
      supabase.from("monthly_aggregates").select("player_tag,donations").eq("month_key", monthNow).order("donations", { ascending: false }).limit(2000),
      supabase.from("blacklist").select("player_tag").eq("player_tag", tag).maybeSingle(),
    ]).then(async ([p, s, a, monthAll, bl]) => {
      const playerData = p.data as Player | null;
      setPlayer(playerData);
      setSnaps((s.data as Snap[]) ?? []);
      setAggs((a.data as Agg[]) ?? []);
      setBlacklisted(!!bl.data);

      // Compute current month rank (excluding blacklisted)
      const blRes = await supabase.from("blacklist").select("player_tag");
      const blocked = new Set(((blRes.data as { player_tag: string }[] | null) ?? []).map((b) => b.player_tag));
      const ranked = ((monthAll.data as { player_tag: string; donations: number }[] | null) ?? [])
        .filter((r) => !blocked.has(r.player_tag));
      const idx = ranked.findIndex((r) => r.player_tag === tag);
      if (idx >= 0) setRank({ pos: idx + 1, total: ranked.length, donations: ranked[idx].donations });

      // Fetch clan info
      if (playerData?.current_clan_tag) {
        const { data: cl } = await supabase.from("clans").select("tag,name,badge_url,member_count").eq("tag", playerData.current_clan_tag).maybeSingle();
        setClan(cl as Clan | null);
      }
      setLoading(false);
    });
  }, [tag]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = normTag(input);
    setTag(t);
    setParams({ tag: t });
  };

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-gold">Player History</h1>
        <p className="text-sm text-muted-foreground">Last 60 days of donation snapshots, plus monthly totals.</p>
      </header>

      <form onSubmit={submit} className="flex gap-2 max-w-md">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="#PLAYERTAG" className="pl-9 font-mono" />
        </div>
        <Button type="submit" className="bg-gold-gradient text-primary-foreground hover:opacity-90">Look up</Button>
      </form>

      {loading && <div className="text-sm text-muted-foreground">Loading…</div>}

      {tag && !player && !loading && (
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center text-muted-foreground">
          No record for <span className="font-mono">{tag}</span> yet.
        </div>
      )}

      {player && (
        <>
          <div className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="grid h-12 w-12 place-items-center rounded-md bg-gold-gradient text-primary-foreground"><User /></div>
                <div>
                  <div className="text-xl font-semibold">{player.name}</div>
                  <div className="text-xs text-muted-foreground font-mono">{player.tag}</div>
                </div>
              </div>
              {blacklisted && (
                <span className="rounded-md bg-destructive/20 text-destructive px-3 py-1 text-xs font-semibold uppercase tracking-wider">
                  Blacklisted
                </span>
              )}
            </div>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <Field label="Current clan" value={clan?.name ?? player.current_clan_tag ?? "—"} />
              <Field label="Role" value={player.role ?? "—"} />
              <Field label="Town Hall" value={player.town_hall ?? "—"} />
              <Field label="Last seen" value={timeAgo(player.last_seen_at)} />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                <Trophy className="h-4 w-4 text-gold" /> Current global rank · {istMonthKey()}
              </div>
              {rank ? (
                <>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-3xl font-bold text-gold">#{rank.pos}</span>
                    <span className="text-sm text-muted-foreground">of {rank.total}</span>
                  </div>
                  <div className="mt-1 text-sm">
                    <span className="font-mono text-gold">{rank.donations.toLocaleString()}</span>
                    <span className="text-muted-foreground"> donated this month</span>
                  </div>
                </>
              ) : (
                <div className="mt-2 text-sm text-muted-foreground">{blacklisted ? "Excluded from rankings (blacklisted)" : "Not ranked yet this month"}</div>
              )}
            </div>

            <div className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-muted-foreground">
                <Shield className="h-4 w-4 text-gold" /> Clan info
              </div>
              {clan ? (
                <div className="mt-2 flex items-center gap-3">
                  {clan.badge_url ? (
                    <img src={clan.badge_url} alt={clan.name} className="h-12 w-12 rounded" />
                  ) : (
                    <div className="grid h-12 w-12 place-items-center rounded bg-secondary"><Shield className="h-5 w-5" /></div>
                  )}
                  <div>
                    <div className="font-semibold">{clan.name}</div>
                    <div className="text-xs text-muted-foreground font-mono">{clan.tag} · {clan.member_count} members</div>
                  </div>
                </div>
              ) : (
                <div className="mt-2 text-sm text-muted-foreground">Not in a tracked clan</div>
              )}
            </div>
          </div>

          <section>
            <h2 className="text-lg font-semibold mb-2 flex items-center gap-2"><History className="h-4 w-4 text-gold" />Monthly totals</h2>
            <DataTable
              rows={aggs}
              search={false}
              columns={[
                { key: "month_key", label: "Month" },
                { key: "clan_tag", label: "Clan", className: "font-mono text-xs text-muted-foreground" },
                { key: "donations", label: "Donated", className: "text-right font-mono text-gold", render: (r) => r.donations.toLocaleString() },
                { key: "donations_received", label: "Received", className: "text-right font-mono", render: (r) => r.donations_received.toLocaleString() },
              ]}
            />
          </section>

          <section>
            <h2 className="text-lg font-semibold mb-2">Recent snapshots (60-day window)</h2>
            <DataTable
              rows={snaps}
              search={false}
              defaultSort={{ key: "captured_at", dir: "desc" }}
              columns={[
                { key: "captured_at", label: "When", render: (r) => new Date(r.captured_at).toLocaleString() },
                { key: "clan_tag", label: "Clan", className: "font-mono text-xs text-muted-foreground" },
                { key: "donations", label: "Donated (cumulative)", className: "text-right font-mono", render: (r) => r.donations.toLocaleString() },
                { key: "donations_received", label: "Received (cumulative)", className: "text-right font-mono", render: (r) => r.donations_received.toLocaleString() },
              ]}
            />
          </section>
        </>
      )}
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded border border-border bg-background/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="font-medium">{value}</div>
    </div>
  );
}
