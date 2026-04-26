// Shared helpers for Clash of Clans proxy API.
// This proxy is a POST-style edge function:
//   POST <BASE> with JSON body { action: "search_clan" | "search_player", tag: "#XXXX" }
// Configure with COC_PROXY_BASE_URL (full URL to the function endpoint).

const BASE = (Deno.env.get("COC_PROXY_BASE_URL") ?? "https://otbsecnrlgkpmomgwrtx.supabase.co/functions/v1/coc-api").replace(/\/+$/, "");
const TOKEN = Deno.env.get("COC_PROXY_API_TOKEN") ?? "";

export function normalizeTag(tag: string) {
  let t = (tag ?? "").trim().toUpperCase().replace(/O/g, "0");
  if (!t.startsWith("#")) t = "#" + t;
  return t;
}

export interface CoCMember {
  tag: string;
  name: string;
  role?: string;
  townHallLevel?: number;
  donations?: number;
  donationsReceived?: number;
}

export interface CoCClan {
  tag: string;
  name: string;
  badgeUrls?: { small?: string; medium?: string; large?: string };
  members?: number;
  memberList?: CoCMember[];
}

async function postAction<T>(action: string, tag: string): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  console.log("CoC POST", BASE, action, tag);
  const res = await fetch(BASE, {
    method: "POST",
    headers,
    body: JSON.stringify({ action, tag: normalizeTag(tag) }),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`CoC API ${res.status} for ${action} ${tag}: ${text.slice(0, 300)}`);
  }
  let json: any;
  try { json = JSON.parse(text); } catch {
    throw new Error(`CoC API non-JSON response for ${action} ${tag}: ${text.slice(0, 200)}`);
  }
  if (json && json.success === false) {
    throw new Error(`CoC API error for ${action} ${tag}: ${json.error ?? "unknown"}`);
  }
  // Some proxies wrap the payload in { success: true, data: {...} }; unwrap if present.
  return (json?.data ?? json) as T;
}

export async function fetchClan(tag: string): Promise<CoCClan> {
  return await postAction<CoCClan>("search_clan", tag);
}

export async function fetchPlayer(tag: string): Promise<any> {
  return await postAction<any>("search_player", tag);
}

// Generic POST to the CoC proxy with a custom JSON body (for link/unlink/get/etc.).
// Returns the unwrapped payload (data field if present) or throws on error.
export async function postCoc<T = any>(body: Record<string, any>): Promise<T> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  console.log("CoC POST (generic)", BASE, JSON.stringify(body));
  const res = await fetch(BASE, { method: "POST", headers, body: JSON.stringify(body) });
  const text = await res.text();
  let json: any = null;
  try { json = text ? JSON.parse(text) : null; } catch {
    throw new Error(`CoC API non-JSON response: ${text.slice(0, 200)}`);
  }
  if (!res.ok) {
    const msg = json?.error ?? json?.message ?? text.slice(0, 300);
    throw new Error(`CoC API ${res.status}: ${msg}`);
  }
  if (json && json.success === false) {
    throw new Error(`CoC API error: ${json.error ?? "unknown"}`);
  }
  return (json?.data ?? json) as T;
}
