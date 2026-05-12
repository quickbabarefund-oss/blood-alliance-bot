// Generic embed-template overlay system.
// Bot code builds a "default" embed; if guild has a saved template for that slot,
// override the matching properties. Empty/null template fields fall through to defaults.
import { adminClient } from "./leaderboard.ts";

export const EMBED_SLOTS = [
  { slot: "family_dashboard", label: "Family Clan Dashboard" },
  { slot: "war_started",      label: "War Started Announcement" },
  { slot: "war_win",          label: "War Win Announcement" },
  { slot: "war_lose",         label: "War Lose Announcement" },
  { slot: "war_reminder",     label: "War Reminder" },
  { slot: "clan_leaderboard", label: "Clan Donation Leaderboard" },
  { slot: "player_info",      label: "/player_info embed" },
  { slot: "clan_info",        label: "/clan_info embed" },
  { slot: "current_war",      label: "/current_war embed" },
  { slot: "war_log",          label: "/war_log embed" },
  { slot: "clan_members",     label: "/clan_members embed" },
  { slot: "cwl",              label: "/cwl embed" },
  { slot: "capital_raids",    label: "/capital_raids embed" },
] as const;

export interface EmbedTemplate {
  slot: string;
  enabled: boolean;
  title: string | null;
  description: string | null;
  color: number | null;
  footer_text: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
  content: string | null;
  fields: any[];
  show_timestamp: boolean;
}

export async function getTemplate(guildId: string, slot: string): Promise<EmbedTemplate | null> {
  const sb = adminClient();
  const { data } = await sb.from("embed_templates")
    .select("*").eq("guild_id", guildId).eq("slot", slot).maybeSingle();
  return data as EmbedTemplate | null;
}

function interp(s: string | null | undefined, vars: Record<string, any>): string | undefined {
  if (s == null) return undefined;
  return String(s).replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : `{${k}}`));
}

export interface ApplyOptions {
  vars?: Record<string, any>;
  keepFields?: boolean; // if true, original fields are kept when template doesn't define any
}

export async function applyTemplate(
  guildId: string,
  slot: string,
  baseEmbed: any,
  opts: ApplyOptions = {},
): Promise<{ embed: any; content?: string }> {
  const tpl = await getTemplate(guildId, slot);
  if (!tpl || !tpl.enabled) return { embed: baseEmbed };
  const v = opts.vars ?? {};
  const out: any = { ...baseEmbed };

  if (tpl.title) out.title = interp(tpl.title, v);
  if (tpl.description) out.description = interp(tpl.description, v);
  if (typeof tpl.color === "number") out.color = tpl.color;
  if (tpl.footer_text) out.footer = { text: interp(tpl.footer_text, v) };
  if (tpl.thumbnail_url) out.thumbnail = { url: tpl.thumbnail_url };
  if (tpl.image_url) out.image = { url: tpl.image_url };
  if (tpl.show_timestamp) out.timestamp = new Date().toISOString();

  if (Array.isArray(tpl.fields) && tpl.fields.length) {
    out.fields = tpl.fields.map((f: any) => ({
      name: interp(f.name, v) ?? "",
      value: interp(f.value, v) ?? "",
      inline: !!f.inline,
    }));
  } else if (!opts.keepFields) {
    // leave baseEmbed.fields alone
  }

  return { embed: out, content: tpl.content ? interp(tpl.content, v) : undefined };
}
