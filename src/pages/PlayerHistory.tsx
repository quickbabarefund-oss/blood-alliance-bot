import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { DataTable } from "@/components/DataTable";
import { History, Search, User } from "lucide-react";
import { timeAgo } from "@/lib/format";

type Player = { tag: string; name: string; current_clan_tag: string | null; role: string | null; town_hall: number | null; last_seen_at: string };
type Snap = { id: number; clan_tag: string; donations: number; donations_received: number; captured_at: string };
type Agg = { month_key: string; clan_tag: string; donations: number; donations_received: number };

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
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tag) return;
    setLoading(true);
    Promise.all([
      supabase.from("players").select("*").eq("tag", tag).maybeSingle(),
      supabase.from("donation_snapshots").select("id,clan_tag,donations,donations_received,captured_at").eq("player_tag", tag).order("captured_at", { ascending: false }).limit(500),
      supabase.from("monthly_aggregates").select("month_key,clan_tag,donations,donations_received").eq("player_tag", tag).order("month_key", { ascending: false }),
    ]).then(([p, s, a]) => {
      setPlayer(p.data as Player | null);
      setSnaps((s.data as Snap[]) ?? []);
      setAggs((a.data as Agg[]) ?? []);
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
            <div className="flex items-center gap-3">
              <div className="grid h-12 w-12 place-items-center rounded-md bg-gold-gradient text-primary-foreground"><User /></div>
              <div>
                <div className="text-xl font-semibold">{player.name}</div>
                <div className="text-xs text-muted-foreground font-mono">{player.tag}</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <Field label="Current clan" value={player.current_clan_tag ?? "—"} />
              <Field label="Role" value={player.role ?? "—"} />
              <Field label="Town Hall" value={player.town_hall ?? "—"} />
              <Field label="Last seen" value={timeAgo(player.last_seen_at)} />
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
