import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { DataTable } from "@/components/DataTable";
import { Ban } from "lucide-react";

type Row = { player_tag: string; reason: string | null; added_by: string | null; added_at: string };

export default function Blacklist() {
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => {
    supabase.from("blacklist").select("*").order("added_at", { ascending: false }).then(({ data }) => setRows((data as Row[]) ?? []));
  }, []);
  return (
    <div className="space-y-6">
      <header className="flex items-center gap-3">
        <div className="grid h-10 w-10 place-items-center rounded-md bg-destructive/20 text-destructive"><Ban className="h-5 w-5" /></div>
        <div>
          <h1 className="text-3xl font-bold text-gold">Blacklist</h1>
          <p className="text-sm text-muted-foreground">Player tags flagged across the alliance — do not invite.</p>
        </div>
      </header>
      <DataTable
        rows={rows}
        defaultSort={{ key: "added_at", dir: "desc" }}
        searchKeys={["player_tag", "reason"]}
        columns={[
          { key: "player_tag", label: "Tag", sortable: true, render: (r) => <span className="font-mono text-destructive">{r.player_tag}</span> },
          { key: "reason", label: "Reason", render: (r) => r.reason || <span className="text-muted-foreground">—</span> },
          { key: "added_by", label: "Added by", className: "text-xs text-muted-foreground" },
          { key: "added_at", label: "Date", sortable: true, className: "text-xs text-muted-foreground", render: (r) => new Date(r.added_at).toLocaleDateString() },
        ]}
      />
    </div>
  );
}
