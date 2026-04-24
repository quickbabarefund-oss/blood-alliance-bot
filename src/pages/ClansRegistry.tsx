import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Shield, Users } from "lucide-react";
import { timeAgo } from "@/lib/format";

type Clan = {
  tag: string;
  name: string;
  badge_url: string | null;
  member_count: number;
  last_polled_at: string | null;
  active: boolean;
};

export default function ClansRegistry() {
  const [clans, setClans] = useState<Clan[]>([]);
  useEffect(() => {
    supabase.from("clans").select("*").eq("active", true).order("name").then(({ data }) => setClans((data as Clan[]) ?? []));
  }, []);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-bold text-gold">Registered Clans</h1>
        <p className="text-sm text-muted-foreground">All clans currently being tracked by the alliance.</p>
      </header>

      {clans.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-card p-10 text-center">
          <Shield className="mx-auto h-10 w-10 text-muted-foreground" />
          <p className="mt-3 text-muted-foreground">No clans registered yet. Use <code className="rounded bg-secondary px-1.5 py-0.5">/clan add</code> in Discord.</p>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {clans.map((c) => (
          <Link
            key={c.tag}
            to={`/clan/${encodeURIComponent(c.tag)}`}
            className="group rounded-lg border border-border bg-card p-5 transition-all hover:border-primary/60 hover:ring-gold"
          >
            <div className="flex items-center gap-3">
              {c.badge_url ? (
                <img src={c.badge_url} alt={c.name} className="h-14 w-14 rounded" loading="lazy" />
              ) : (
                <div className="grid h-14 w-14 place-items-center rounded bg-secondary text-muted-foreground"><Shield /></div>
              )}
              <div className="min-w-0 flex-1">
                <div className="font-semibold text-foreground group-hover:text-gold truncate">{c.name || c.tag}</div>
                <div className="text-xs text-muted-foreground">{c.tag}</div>
              </div>
            </div>
            <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{c.member_count} members</span>
              <span>Updated {timeAgo(c.last_polled_at)}</span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
