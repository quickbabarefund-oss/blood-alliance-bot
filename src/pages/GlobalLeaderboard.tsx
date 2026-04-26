import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DataTable } from "@/components/DataTable";
import { istMonthKey, pastMonthKeys } from "@/lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Crown, Trophy } from "lucide-react";
import { Link } from "react-router-dom";

type Row = {
  player_tag: string;
  player_name: string;
  clan_tag: string;
  donations: number;
  donations_received: number;
  clan_name?: string;
};

export default function GlobalLeaderboard() {
  const [month, setMonth] = useState<string>(istMonthKey());
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const months = useMemo(() => pastMonthKeys(12), []);

  useEffect(() => {
    setLoading(true);
    (async () => {
      const [aggsRes, clansRes, blRes] = await Promise.all([
        supabase
          .from("monthly_aggregates")
          .select("player_tag,player_name,clan_tag,donations,donations_received")
          .eq("month_key", month)
          .order("donations", { ascending: false })
          .limit(1000),
        supabase.from("clans").select("tag,name"),
        supabase.from("blacklist").select("player_tag"),
      ]);
      const clanMap: Record<string, string> = {};
      (clansRes.data as { tag: string; name: string }[] | null)?.forEach((c) => {
        clanMap[c.tag] = c.name || c.tag;
      });
      const blocked = new Set(
        ((blRes.data as { player_tag: string }[] | null) ?? []).map((b) => b.player_tag)
      );
      const merged = ((aggsRes.data as Row[]) ?? [])
        .filter((r) => !blocked.has(r.player_tag))
        .map((r) => ({ ...r, clan_name: clanMap[r.clan_tag] || r.clan_tag }));
      setRows(merged);
      setLoading(false);
    })();
  }, [month]);

  const totalDonated = rows.reduce((s, r) => s + r.donations, 0);

  return (
    <div className="space-y-6">
      <section className="bg-hero-gradient -mx-4 px-4 py-10 sm:-mx-8 sm:px-8 rounded-lg border border-border">
        <div className="flex items-start justify-between flex-wrap gap-4">
          <div>
            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
              <Trophy className="h-4 w-4 text-gold" /> Global Alliance Leaderboard
            </div>
            <h1 className="mt-2 text-4xl font-bold text-gold">Top Donators · {month}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Combined ranking across every tracked clan. Resets 00:00 IST on the 1st.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Select value={month} onValueChange={setMonth}>
              <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {months.map((m) => (<SelectItem key={m} value={m}>{m}</SelectItem>))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Players" value={rows.length} />
          <Stat label="Total Donated" value={totalDonated.toLocaleString()} />
          <Stat label="Top Donator" value={rows[0]?.player_name ?? "—"} />
          <Stat label="Top Amount" value={(rows[0]?.donations ?? 0).toLocaleString()} />
        </div>
      </section>

      <DataTable
        rows={rows}
        defaultSort={{ key: "donations", dir: "desc" }}
        searchKeys={["player_name", "player_tag", "clan_tag", "clan_name"]}
        columns={[
          { key: "standing", label: "Standing", className: "w-20", render: (_r, i) => <RankBadge idx={i} /> },
          { key: "clan_name", label: "Clan Name", sortable: true, render: (r) => (
            <Link to={`/clan/${encodeURIComponent(r.clan_tag)}`} className="hover:text-gold">
              <div className="font-medium">{r.clan_name || r.clan_tag}</div>
              <div className="text-xs text-muted-foreground font-mono">{r.clan_tag}</div>
            </Link>
          )},
          { key: "player_name", label: "Player Name", sortable: true, render: (r) => (
            <Link to={`/player?tag=${encodeURIComponent(r.player_tag)}`} className="hover:text-gold">
              <div className="font-medium">{r.player_name || "—"}</div>
              <div className="text-xs text-muted-foreground font-mono">{r.player_tag}</div>
            </Link>
          )},
          { key: "donations", label: "Donation", sortable: true, className: "text-right",
            render: (r) => <span className="font-mono text-gold text-base">{r.donations.toLocaleString()}</span> },
        ]}
      />
      {loading && <div className="text-center text-sm text-muted-foreground">Loading…</div>}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border bg-card px-4 py-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="mt-1 text-lg font-semibold text-foreground truncate">{value}</div>
    </div>
  );
}

function RankBadge({ idx }: { idx: number }) {
  if (idx === 0) return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-gold-gradient text-primary-foreground font-bold ring-gold">
      <Crown className="h-4 w-4" />
    </span>
  );
  if (idx < 3) return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border-2 border-primary/60 text-gold font-bold">
      {idx + 1}
    </span>
  );
  return <span className="inline-block w-8 text-center text-muted-foreground font-mono">{idx + 1}</span>;
}
