// Shared helpers for Clash of Clans proxy API.
// Set COC_PROXY_BASE_URL to e.g. "https://proxy.clashking.dev/v1" or your proxy's base.
// Token is sent as Bearer COC_PROXY_API_TOKEN.

const RAW_BASE = (Deno.env.get("COC_PROXY_BASE_URL") ?? "https://api.clashk.ing").replace(/\/+$/, "");
// Tolerate users including or omitting /v1 suffix
const BASE = RAW_BASE.endsWith("/v1") ? RAW_BASE.slice(0, -3) : RAW_BASE;
const TOKEN = Deno.env.get("COC_PROXY_API_TOKEN") ?? "";

export function encodeTag(tag: string) {
  let t = tag.trim().toUpperCase();
  if (!t.startsWith("#")) t = "#" + t;
  return encodeURIComponent(t);
}

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

export async function fetchClan(tag: string): Promise<CoCClan> {
  const url = `${BASE}/v1/clans/${encodeTag(tag)}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (TOKEN) headers.Authorization = `Bearer ${TOKEN}`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`CoC API ${res.status} for ${tag}: ${body.slice(0, 200)}`);
  }
  return await res.json();
}
