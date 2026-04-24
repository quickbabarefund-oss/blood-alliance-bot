// Helpers shared across leaderboard pages
export function istMonthKey(d: Date = new Date()): string {
  const ist = new Date(d.getTime() + (5 * 60 + 30) * 60_000);
  return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function ratio(donated: number, recv: number): string {
  if (!recv) return "∞";
  return (donated / recv).toFixed(2);
}

export function timeAgo(iso?: string | null): string {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function ratioBadgeClass(donated: number, recv: number): string {
  const r = recv > 0 ? donated / recv : 99;
  if (r >= 1.5) return "text-emerald-400";
  if (r >= 0.8) return "text-foreground";
  return "text-destructive";
}

export function pastMonthKeys(count = 6): string[] {
  const arr: string[] = [];
  const now = new Date();
  const istNow = new Date(now.getTime() + (5 * 60 + 30) * 60_000);
  for (let i = 0; i < count; i++) {
    const d = new Date(Date.UTC(istNow.getUTCFullYear(), istNow.getUTCMonth() - i, 1));
    arr.push(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return arr;
}
