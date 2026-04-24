import { useEffect, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export type Column<T> = {
  key: keyof T | string;
  label: string;
  sortable?: boolean;
  className?: string;
  render?: (row: T, idx: number) => React.ReactNode;
  accessor?: (row: T) => string | number;
};

export function DataTable<T extends Record<string, any>>({
  rows, columns, search = true, defaultSort, searchKeys,
}: {
  rows: T[];
  columns: Column<T>[];
  search?: boolean;
  defaultSort?: { key: string; dir: "asc" | "desc" };
  searchKeys?: (keyof T | string)[];
}) {
  const [q, setQ] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(defaultSort?.key ?? null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSort?.dir ?? "desc");

  useEffect(() => {
    if (defaultSort) {
      setSortKey(defaultSort.key);
      setSortDir(defaultSort.dir);
    }
  }, [defaultSort?.key, defaultSort?.dir]);

  const filtered = useMemo(() => {
    let r = rows;
    if (q.trim()) {
      const needle = q.toLowerCase();
      const keys = searchKeys ?? columns.map((c) => c.key as string);
      r = r.filter((row) => keys.some((k) => String((row as any)[k] ?? "").toLowerCase().includes(needle)));
    }
    if (sortKey) {
      const col = columns.find((c) => c.key === sortKey);
      const acc = col?.accessor ?? ((row: T) => (row as any)[sortKey] ?? "");
      r = [...r].sort((a, b) => {
        const va = acc(a);
        const vb = acc(b);
        if (typeof va === "number" && typeof vb === "number") return sortDir === "asc" ? va - vb : vb - va;
        return sortDir === "asc"
          ? String(va).localeCompare(String(vb))
          : String(vb).localeCompare(String(va));
      });
    }
    return r;
  }, [rows, q, sortKey, sortDir, columns, searchKeys]);

  return (
    <div className="space-y-3">
      {search && (
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" className="pl-9" />
        </div>
      )}
      <div className="rounded-lg border border-border bg-card overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {columns.map((c) => (
                <TableHead
                  key={c.key as string}
                  className={`${c.className ?? ""} ${c.sortable ? "cursor-pointer select-none" : ""}`}
                  onClick={() => {
                    if (!c.sortable) return;
                    if (sortKey === c.key) setSortDir(sortDir === "asc" ? "desc" : "asc");
                    else { setSortKey(c.key as string); setSortDir("desc"); }
                  }}
                >
                  <span className="inline-flex items-center gap-1">
                    {c.label}
                    {c.sortable && sortKey === c.key && (sortDir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />)}
                  </span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow><TableCell colSpan={columns.length} className="text-center text-muted-foreground py-10">No data</TableCell></TableRow>
            ) : filtered.map((row, i) => (
              <TableRow key={(row as any).id ?? (row as any).tag ?? (row as any).player_tag ?? i}>
                {columns.map((c) => (
                  <TableCell key={c.key as string} className={c.className}>
                    {c.render ? c.render(row, i) : String((row as any)[c.key] ?? "")}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
