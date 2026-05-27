import { ReactNode, useState } from "react";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { ShieldCheck, KeyRound, Loader2 } from "lucide-react";

export default function AdminGate({ title, children }: { title?: string; children: ReactNode }) {
  const { isAdmin, loading, login } = useAdminAuth();
  const [pw, setPw] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="grid min-h-[40vh] place-items-center text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (isAdmin) return <>{children}</>;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!pw) return;
    setSubmitting(true); setError(null);
    const res = await login(pw);
    setSubmitting(false);
    if (!res.ok) setError(res.error ?? "Wrong password");
    else setPw("");
  }

  return (
    <div className="grid min-h-[60vh] place-items-center px-4">
      <Card className="w-full max-w-md border-gold/40 bg-card/80 p-8 shadow-emerald">
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-xl bg-gold-gradient text-primary-foreground ring-gold">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <h2 className="text-xl text-gold">Admin Access</h2>
            <p className="text-sm text-muted-foreground">{title ?? "Enter the shared admin password to continue."}</p>
          </div>
        </div>
        <form onSubmit={onSubmit} className="space-y-3">
          <div className="relative">
            <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="password"
              autoFocus
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              placeholder="Admin password"
              className="pl-9"
              maxLength={256}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button type="submit" disabled={submitting || !pw} className="w-full bg-gold-gradient text-primary-foreground hover:opacity-90">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Unlock"}
          </Button>
        </form>
        <p className="mt-4 text-center text-xs text-muted-foreground">
          Session lasts 12 hours on this device.
        </p>
      </Card>
    </div>
  );
}
