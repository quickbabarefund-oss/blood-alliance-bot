// Token-authenticated CRUD for embed_templates + per-clan war announcements.
// GET    ?token=...                               -> { guild_id, slots, templates, war_clans }
// POST   { token, slot, ...embedFields }          -> upsert template
// DELETE { token, slot }                          -> reset template
// PATCH  { token, action: "save_announcement", clan_tag, win_announcement?, lose_announcement? }
// PATCH  { token, action: "test_announcement",  clan_tag, outcome, template }
import { corsHeaders } from "../_shared/cors.ts";
import { adminClient } from "../_shared/leaderboard.ts";
import { EMBED_SLOTS, SLOT_PLACEHOLDERS, SLOT_PLACEHOLDER_DESCRIPTIONS } from "../_shared/embed_templates.ts";

const BOT = Deno.env.get("DISCORD_BOT_TOKEN")!;

async function resolveToken(token: string): Promise<string | null> {
  if (!token || token.length < 10) return null;
  const sb = adminClient();
  const { data } = await sb.from("embed_edit_tokens").select("guild_id,expires_at").eq("token", token).maybeSingle();
  if (!data) return null;
  if (new Date(data.expires_at).getTime() < Date.now()) return null;
  return data.guild_id as string;
}

// Pull war-tracked clans for guild. Joins clan_name from `clans` if known.
async function loadWarClans(guildId: string) {
  const sb = adminClient();
  const { data: cfgs } = await sb.from("war_track_config")
    .select("clan_tag,win_announcement,lose_announcement,mail_channel_id,mail_ping_role_id")
    .eq("guild_id", guildId);
  const list = (cfgs ?? []) as any[];
  if (!list.length) return [];
  const tags = list.map((c) => c.clan_tag);
  const { data: clans } = await sb.from("clans").select("tag,name").in("tag", tags);
  const nameMap = new Map<string, string>();
  for (const c of (clans ?? []) as any[]) nameMap.set(c.tag, c.name);
  return list.map((c) => ({
    clan_tag: c.clan_tag,
    clan_name: nameMap.get(c.clan_tag) ?? "",
    win_announcement: c.win_announcement ?? null,
    lose_announcement: c.lose_announcement ?? null,
    mail_channel_id: c.mail_channel_id ?? null,
    mail_ping_role_id: c.mail_ping_role_id ?? null,
  }));
}

const WIN_DEFAULT = "🏆 {ping} — We're going for the **WIN** vs **{opponent}** ({opp_tag})! Mirror first attack 3⭐, ≥2⭐ in first 16h, 3⭐ in last 8h.";
const LOSE_DEFAULT = "🏳️ {ping} — We're **LOSING** vs **{opponent}** ({opp_tag}). Mirror first attack 2⭐, 1⭐ first 16h, 2⭐ last 8h. No extras.";

function renderAnnouncement(tpl: string, clanName: string, clanTag: string, ping: string) {
  return tpl
    .replaceAll("{opponent}", "Sample Enemy Clan")
    .replaceAll("{opp_tag}", "#OPPTAG")
    .replaceAll("{our}", clanName || clanTag)
    .replaceAll("{our_tag}", clanTag)
    .replaceAll("{ping}", ping);
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
      const { data: g } = await sb.from("guilds").select("name").eq("guild_id", guildId).maybeSingle();
      const { data: famDash } = await sb.from("family_dashboards")
        .select("spacing_lines").eq("guild_id", guildId).maybeSingle();
      const war_clans = await loadWarClans(guildId);
      return json({
        guild_id: guildId, guild_name: g?.name ?? null,
        slots: EMBED_SLOTS, placeholders: SLOT_PLACEHOLDERS, placeholder_descriptions: SLOT_PLACEHOLDER_DESCRIPTIONS,
        templates: map,
        war_clans,
        family_dashboard_spacing: famDash?.spacing_lines ?? 1,
        announcement_defaults: { win: WIN_DEFAULT, lose: LOSE_DEFAULT },
      });
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

      if (slot === "family_dashboard") {
        const dashboardPatch: Record<string, any> = { updated_at: new Date().toISOString() };
        if (row.title) dashboardPatch.title = row.title;
        dashboardPatch.description = row.description;
        if (typeof row.color === "number") dashboardPatch.color = row.color;
        dashboardPatch.footer_text = row.footer_text;
        dashboardPatch.show_timestamp = row.show_timestamp;
        dashboardPatch.thumbnail_url = row.thumbnail_url;
        dashboardPatch.image_url = row.image_url;
        if (typeof body.spacing_lines === "number") {
          const sp = Math.max(0, Math.min(2, Math.floor(body.spacing_lines)));
          dashboardPatch.spacing_lines = sp;
        }
        await sb.from("family_dashboards").update(dashboardPatch).eq("guild_id", guildId);
        let syncWarn: string | undefined;
        try {
          const { syncDashboardMessage } = await import("../_shared/family.ts");
          const sync = await syncDashboardMessage(guildId);
          if (!sync.ok) {
            syncWarn = sync.error;
            console.error("sync after edit failed", sync.error);
          }
        } catch (e) {
          syncWarn = e instanceof Error ? e.message : String(e);
          console.error("import/sync family", e);
        }
        return json({ ok: true, sync_warning: syncWarn });
      }

      if (slot === "clan_leaderboard") {
        let syncWarn: string | undefined;
        try {
          const { refreshGuildLeaderboardMessages } = await import("../_shared/leaderboard.ts");
          const sync = await refreshGuildLeaderboardMessages(guildId);
          if (!sync.ok) {
            syncWarn = sync.error;
            console.error("leaderboard sync after edit failed", sync.error);
          }
        } catch (e) {
          syncWarn = e instanceof Error ? e.message : String(e);
          console.error("import/sync leaderboard", e);
        }
        return json({ ok: true, sync_warning: syncWarn });
      }
      return json({ ok: true });
    }

    if (req.method === "PATCH") {
      const body = await req.json().catch(() => ({}));
      const token = String(body.token ?? "");
      const guildId = await resolveToken(token);
      if (!guildId) return json({ error: "invalid or expired token" }, 401);
      const action = String(body.action ?? "");

      if (action === "force_sync") {
        const warnings: string[] = [];
        let proof: any = undefined;

        // Optionally accept the editor's current unsaved template+spacing so that
        // "Force sync" always pushes what the user sees in the UI right now.
        const pending = body.pending_template;
        if (pending && typeof pending === "object" && pending.slot === "family_dashboard") {
          const row = {
            guild_id: guildId,
            slot: "family_dashboard",
            enabled: pending.enabled !== false,
            title: nullStr(pending.title),
            description: nullStr(pending.description),
            color: typeof pending.color === "number" ? pending.color : null,
            footer_text: nullStr(pending.footer_text),
            thumbnail_url: nullStr(pending.thumbnail_url),
            image_url: nullStr(pending.image_url),
            content: nullStr(pending.content),
            fields: Array.isArray(pending.fields) ? pending.fields.slice(0, 25) : [],
            show_timestamp: !!pending.show_timestamp,
            updated_at: new Date().toISOString(),
          };
          await sb.from("embed_templates").upsert(row, { onConflict: "guild_id,slot" });
        }
        if (typeof body.spacing_lines === "number") {
          const sp = Math.max(0, Math.min(2, Math.floor(body.spacing_lines)));
          await sb.from("family_dashboards").update({ spacing_lines: sp, updated_at: new Date().toISOString() }).eq("guild_id", guildId);
        }

        try {
          const { data: tpl } = await sb.from("embed_templates")
            .select("title,description,color,footer_text,show_timestamp,thumbnail_url,image_url")
            .eq("guild_id", guildId).eq("slot", "family_dashboard").maybeSingle();
          if (tpl) {
            const patch: Record<string, any> = {
              updated_at: new Date().toISOString(),
              description: tpl.description ?? null,
              footer_text: tpl.footer_text ?? null,
              show_timestamp: !!tpl.show_timestamp,
              thumbnail_url: tpl.thumbnail_url ?? null,
              image_url: tpl.image_url ?? null,
            };
            if (tpl.title) patch.title = tpl.title;
            if (typeof tpl.color === "number") patch.color = tpl.color;
            await sb.from("family_dashboards").update(patch).eq("guild_id", guildId);
          }
          const { syncDashboardMessage } = await import("../_shared/family.ts");
          const sync = await syncDashboardMessage(guildId);
          proof = {
            message_id: sync.message_id,
            channel_id: sync.channel_id,
            title: sync.title,
            description_preview: sync.description_preview,
          };
          if (!sync.ok && sync.error) warnings.push(`Family dashboard: ${sync.error}`);
        } catch (e) {
          warnings.push(`Family dashboard: ${e instanceof Error ? e.message : String(e)}`);
        }
        try {
          const { refreshGuildLeaderboardMessages } = await import("../_shared/leaderboard.ts");
          const sync = await refreshGuildLeaderboardMessages(guildId);
          if (!sync.ok && sync.error) warnings.push(`Donation leaderboards: ${sync.error}`);
        } catch (e) {
          warnings.push(`Donation leaderboards: ${e instanceof Error ? e.message : String(e)}`);
        }
        return json({
          ok: warnings.length === 0,
          sync_warning: warnings.length ? warnings.join("; ") : undefined,
          proof,
        });
      }

      const clanTag = String(body.clan_tag ?? "").toUpperCase();
      if (!clanTag) return json({ error: "clan_tag required" }, 400);

      // Verify the clan is actually tracked in this guild
      const { data: existing } = await sb.from("war_track_config")
        .select("clan_tag,mail_channel_id,mail_ping_role_id")
        .eq("guild_id", guildId).eq("clan_tag", clanTag).maybeSingle();
      if (!existing) return json({ error: `clan ${clanTag} not war-tracked in this server` }, 404);

      if (action === "save_announcement") {
        const patch: Record<string, any> = { updated_at: new Date().toISOString() };
        if ("win_announcement" in body) patch.win_announcement = nullStr(body.win_announcement);
        if ("lose_announcement" in body) patch.lose_announcement = nullStr(body.lose_announcement);
        const { error } = await sb.from("war_track_config").update(patch)
          .eq("guild_id", guildId).eq("clan_tag", clanTag);
        if (error) return json({ error: error.message }, 500);
        return json({ ok: true });
      }

      if (action === "test_announcement") {
        const outcome = body.outcome === "lose" ? "lose" : "win";
        const tpl = String(body.template ?? "") || (outcome === "win" ? WIN_DEFAULT : LOSE_DEFAULT);
        if (!existing.mail_channel_id) return json({ error: "no mail channel configured for this clan" }, 400);
        const { data: clan } = await sb.from("clans").select("name").eq("tag", clanTag).maybeSingle();
        const ping = existing.mail_ping_role_id ? `<@&${existing.mail_ping_role_id}>` : "";
        const content = `🧪 **Test announcement** (${outcome.toUpperCase()})\n` +
          renderAnnouncement(tpl, clan?.name ?? "", clanTag, ping);
        const r = await fetch(`https://discord.com/api/v10/channels/${existing.mail_channel_id}/messages`, {
          method: "POST",
          headers: { Authorization: `Bot ${BOT}`, "Content-Type": "application/json" },
          body: JSON.stringify({ content, allowed_mentions: { parse: ["roles"] } }),
        });
        if (!r.ok) {
          const txt = await r.text();
          return json({ error: `Discord ${r.status}: ${txt.slice(0, 200)}` }, 502);
        }
        return json({ ok: true, channel_id: existing.mail_channel_id });
      }

      return json({ error: "unknown action" }, 400);
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
