import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { DataTable } from "@/components/DataTable";
import { istMonthKey, pastMonthKeys, ratio, ratioBadgeClass, timeAgo } from "@/lib/format";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ArrowLeft, Shield } from "lucide-react";

type AggRow = { player_tag: string; player_name: string; donations: number; donations_received: number };
type PlayerRow = { tag: string; role: string | null; last_seen_at: string };
type Clan = { tag: string; name: string; badge_url: string | null; member_count: number; last_polled_at: string | null };

export default function ClanLeaderboard() {
  const { tag = "" } = useParams();
  const clanTag = decodeURIComponent(tag);
  const [month, setMonth] = useState(istMonthKey());
  const [clan, setClan] = useState<Clan | null>(null);
  const [rows, setRows] = useState<AggRow[]>([]);
  const [players, setPlayers] = useState<Record<string, PlayerRow>>({});
  const months = useMemo(() => pastMonthKeys(12), []);

  useEffect(() => {
    supabase.from("clans").select("*").eq("tag", clanTag).maybeSingle().then(({ data }) => setClan(data as Clan | null));
  }, [clanTag]);

  useEffect(() => {
    (async () => {
      const [aggRes, blRes] = await Promise.all([
        supabase
          .from("monthly_aggregates")
          .select("player_tag,player_name,donations,donations_received")
          .eq("month_key", month).eq("clan_tag", clanTag)
          .order("donations", { ascending: false }),
        supabase.from("blacklist").select("player_tag"),
      ]);
      const blocked = new Set(
        ((blRes.data as { player_tag: string }[] | null) ?? []).map((b) => b.player_tag)
      );
      setRows(((aggRes.data as AggRow[]) ?? []).filter((r) => !blocked.has(r.player_tag)));
    })();
  }, [month, clanTag]);

  useEffect(() => {
    supabase.from("players").select("tag,role,last_seen_at").eq("current_clan_tag", clanTag).then(({ data }) => {
      const map: Record<string, PlayerRow> = {};
      (data as PlayerRow[] | null)?.forEach((p) => { map[p.tag] = p; });
      setPlayers(map);
    });
  }, [clanTag]);

  return (
    <div className="space-y-6">
      <Link to="/clans" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-gold"><ArrowLeft className="h-4 w-4" />All clans</Link>

      <div className="flex items-start justify-between flex-wrap gap-4 rounded-lg border border-border bg-card p-5">
        <div className="flex items-center gap-4">
          {clan?.badge_url ? (
            <img src={clan.badge_url} alt={clan.name} className="h-16 w-16 rounded" />
          ) : (
            <div className="grid h-16 w-16 place-items-center rounded bg-secondary"><Shield /></div>
          )}
          <div>
            <h1 className="text-2xl font-bold text-gold">{clan?.name || clanTag}</h1>
            <div className="text-sm text-muted-foreground">{clanTag} · {clan?.member_count ?? 0} members · Updated {timeAgo(clan?.last_polled_at)}</div>
          </div>
        </div>
        <Select value={month} onValueChange={setMonth}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>{months.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
        </Select>
      </div>

      <DataTable
        rows={rows}
        defaultSort={{ key: "donations", dir: "desc" }}
        searchKeys={["player_name", "player_tag"]}
        columns={[
          { key: "rank", label: "#", className: "w-12", render: (_r, i) => <span className="text-muted-foreground">{i + 1}</span> },
          { key: "player_name", label: "Player", sortable: true, render: (r) => (
            <Link to={`/player?tag=${encodeURIComponent(r.player_tag)}`} className="hover:text-gold">
              <div className="font-medium">{r.player_name || "—"}</div>
              <div className="text-xs text-muted-foreground">{r.player_tag}</div>
            </Link>
          )},
          { key: "role", label: "Role", className: "text-xs text-muted-foreground", render: (r) => players[r.player_tag]?.role ?? "—" },
          { key: "donations", label: "Donated", sortable: true, className: "text-right", render: (r) => <span className="font-mono text-gold">{r.donations.toLocaleString()}</span> },
          { key: "donations_received", label: "Received", sortable: true, className: "text-right", render: (r) => <span className="font-mono">{r.donations_received.toLocaleString()}</span> },
          { key: "ratio", label: "Ratio", className: "text-right", accessor: (r) => r.donations_received > 0 ? r.donations / r.donations_received : 999, render: (r) => <span className={`font-mono ${ratioBadgeClass(r.donations, r.donations_received)}`}>{ratio(r.donations, r.donations_received)}</span> },
          { key: "last_seen", label: "Last seen", className: "text-right text-xs text-muted-foreground", render: (r) => timeAgo(players[r.player_tag]?.last_seen_at) },
        ]}
      />
    </div>
  );
}
