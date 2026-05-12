// Token-authenticated CRUD for embed_templates.
// GET  ?token=...           -> { guild_id, slots: [{slot,label}], templates: { slot: {...} } }
// POST { token, slot, ...embedFields } -> upsert
import { corsHeaders } from "../_shared/cors.ts";
import { adminClient } from "../_shared/leaderboard.ts";
import { EMBED_SLOTS, SLOT_PLACEHOLDERS, SLOT_PLACEHOLDER_DESCRIPTIONS } from "../_shared/embed_templates.ts";

async function resolveToken(token: string): Promise<string | null> {
  if (!token || token.length < 10) return null;
  const sb = adminClient();
  const { data } = await sb.from("embed_edit_tokens").select("guild_id,expires_at").eq("token", token).maybeSingle();
  if (!data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return data.guild_id as string;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  const url = new URL(req.url);
  const sb = adminClient();

  try {
    if (req.method === "GET") {
      const token = url.searchParams.get("token") ?? "";
      const guildId = await resolveToken(token);
      if (!guildId) return json({ error: "invalid or expired token" }, 401);
      const { data } = await sb.from("embed_templates").select("*").eq("guild_id", guildId);
      const map: Record<string, any> = {};
      for (const r of data ?? []) map[(r as any).slot] = r;
      // Also include guild name if we have one
      const { data: g } = await sb.from("guilds").select("name").eq("guild_id", guildId).maybeSingle();
      return json({ guild_id: guildId, guild_name: g?.name ?? null, slots: EMBED_SLOTS, placeholders: SLOT_PLACEHOLDERS, templates: map });
    }

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      const token = String(body.token ?? "");
      const guildId = await resolveToken(token);
      if (!guildId) return json({ error: "invalid or expired token" }, 401);
      const slot = String(body.slot ?? "");
      if (!EMBED_SLOTS.find((s) => s.slot === slot)) return json({ error: "unknown slot" }, 400);

      const row = {
        guild_id: guildId,
        slot,
        enabled: body.enabled !== false,
        title: nullStr(body.title),
        description: nullStr(body.description),
        color: typeof body.color === "number" ? body.color : null,
        footer_text: nullStr(body.footer_text),
        thumbnail_url: nullStr(body.thumbnail_url),
        image_url: nullStr(body.image_url),
        content: nullStr(body.content),
        fields: Array.isArray(body.fields) ? body.fields.slice(0, 25) : [],
        show_timestamp: !!body.show_timestamp,
        updated_at: new Date().toISOString(),
      };
      const { error } = await sb.from("embed_templates").upsert(row, { onConflict: "guild_id,slot" });
      if (error) return json({ error: error.message }, 500);

      // If family_dashboard updated, push to Discord
      if (slot === "family_dashboard") {
        try {
          const { syncDashboardMessage } = await import("../_shared/family.ts");
          syncDashboardMessage(guildId).catch((e) => console.error("sync after edit", e));
        } catch (e) { console.error("import family", e); }
      }
      return json({ ok: true });
    }

    if (req.method === "DELETE") {
      const body = await req.json().catch(() => ({}));
      const token = String(body.token ?? "");
      const guildId = await resolveToken(token);
      if (!guildId) return json({ error: "invalid or expired token" }, 401);
      const slot = String(body.slot ?? "");
      await sb.from("embed_templates").delete().eq("guild_id", guildId).eq("slot", slot);
      return json({ ok: true });
    }

    return json({ error: "method not allowed" }, 405);
  } catch (e) {
    console.error("embed-templates-api error", e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});

function nullStr(v: any): string | null {
  if (v == null) return null;
  const s = String(v);
  return s.trim() === "" ? null : s;
}
function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
