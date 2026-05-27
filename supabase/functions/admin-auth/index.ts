// Shared-password admin auth. Issues HMAC-signed bearer tokens that the frontend
// stores in sessionStorage and re-verifies on mount.
import { corsHeaders } from "npm:@supabase/supabase-js@2/cors";

const PASSWORD = Deno.env.get("ADMIN_PASSWORD") ?? "";
const SECRET = Deno.env.get("ADMIN_AUTH_SECRET") ?? "";
const TTL_MS = 12 * 60 * 60 * 1000; // 12h

function b64url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = btoa(String.fromCharCode(...bytes));
  return s.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sign(payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return b64url(sig);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

async function makeToken(): Promise<{ token: string; exp: number }> {
  const exp = Date.now() + TTL_MS;
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ role: "admin", exp })));
  const sig = await sign(payload);
  return { token: `${payload}.${sig}`, exp };
}

async function verifyToken(token: string): Promise<boolean> {
  const [payload, sig] = (token ?? "").split(".");
  if (!payload || !sig) return false;
  const expected = await sign(payload);
  if (!timingSafeEqual(sig, expected)) return false;
  try {
    const raw = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const data = JSON.parse(raw);
    return typeof data.exp === "number" && data.exp > Date.now();
  } catch { return false; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    if (!PASSWORD || !SECRET) return json({ error: "Admin auth not configured" }, 500);
    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === "login") {
      const pw = String(body?.password ?? "");
      if (!pw || pw.length > 256) return json({ error: "Invalid password" }, 400);
      // Constant-time-ish compare
      const a = pw, b = PASSWORD;
      const maxLen = Math.max(a.length, b.length);
      let diff = a.length ^ b.length;
      for (let i = 0; i < maxLen; i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
      if (diff !== 0) {
        await new Promise((r) => setTimeout(r, 400));
        return json({ error: "Wrong password" }, 401);
      }
      const t = await makeToken();
      return json({ ok: true, ...t });
    }

    if (action === "verify") {
      const ok = await verifyToken(String(body?.token ?? ""));
      return json({ ok });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
