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

export const SLOT_PLACEHOLDERS: Record<string, string[]> = {
  family_dashboard: [],
  war_started:  ["clan", "opponent", "team_size", "end_time"],
  war_win:      ["clan", "opponent", "stars", "opp_stars", "destruction", "opp_destruction", "team_size", "result"],
  war_lose:     ["clan", "opponent", "stars", "opp_stars", "destruction", "opp_destruction", "team_size", "result"],
  war_reminder: ["clan", "opponent", "ping", "minutes", "end_time"],
  clan_leaderboard: ["clan", "tag", "month"],
  player_info:  ["name", "tag", "th", "trophies", "clan"],
  clan_info:    ["name", "tag", "level", "members", "league", "trophies", "streak", "leader", "description"],
  current_war:  ["our", "opponent", "tag"],
  war_log:      ["tag", "wins", "losses"],
  clan_members: ["tag", "name"],
  cwl:          ["tag", "season"],
  capital_raids:["tag", "loot"],
};

// Human-readable descriptions for each placeholder variable.
export const SLOT_PLACEHOLDER_DESCRIPTIONS: Record<string, Record<string, string>> = {
  war_started: {
    clan:      "Your clan's name",
    opponent:  "Enemy clan name",
    team_size: "War team size (e.g. 15 vs 15)",
    end_time:  "War end time (ISO / human-readable)",
  },
  war_win: {
    clan:            "Your clan's name",
    opponent:        "Enemy clan name",
    stars:           "Your clan's star count",
    opp_stars:       "Enemy star count",
    destruction:     "Your destruction percentage",
    opp_destruction: "Enemy destruction percentage",
    team_size:       "War team size",
    result:          "Result text (e.g. 'Victory')",
  },
  war_lose: {
    clan:            "Your clan's name",
    opponent:        "Enemy clan name",
    stars:           "Your clan's star count",
    opp_stars:       "Enemy star count",
    destruction:     "Your destruction percentage",
    opp_destruction: "Enemy destruction percentage",
    team_size:       "War team size",
    result:          "Result text (e.g. 'Defeat')",
  },
  war_reminder: {
    clan:      "Your clan's name",
    opponent:  "Enemy clan name",
    ping:      "Mention string for the war role/channel",
    minutes:   "Minutes remaining until war ends",
    end_time:  "War end time",
  },
  clan_leaderboard: {
    clan:  "Clan name",
    tag:   "Clan tag (e.g. #ABC123)",
    month: "Current month name",
  },
  player_info: {
    name:     "Player name",
    tag:      "Player tag",
    th:       "Town Hall level",
    trophies: "Trophy count",
    clan:     "Current clan name",
  },
  clan_info: {
    name:        "Clan name",
    tag:         "Clan tag",
    level:       "Clan level",
    members:     "Member count / 50",
    league:      "Current league name",
    trophies:    "Clan trophy count",
    streak:      "War win streak",
    leader:      "Leader's name",
    description: "Clan description",
  },
  current_war: {
    our:      "Your clan name",
    opponent: "Enemy clan name",
    tag:      "Enemy clan tag",
  },
  war_log: {
    tag:    "Clan tag",
    wins:   "Number of war wins",
    losses: "Number of war losses",
  },
  clan_members: {
    tag:  "Clan tag",
    name: "Clan name",
  },
  cwl: {
    tag:    "Clan tag",
    season: "CWL season string",
  },
  capital_raids: {
    tag:  "Clan tag",
    loot: "Total raid loot",
  },
};

export interface EmbedTemplate {
  slot: string;
  enabled: boolean;
  title: string | null;
  title_url: string | null;
  description: string | null;
  color: number | null;
  footer_text: string | null;
  thumbnail_url: string | null;
  image_url: string | null;
  content: string | null;
  fields: any[];
  show_timestamp: boolean;
  author_name: string | null;
  author_icon_url: string | null;
  author_url: string | null;
  components: any[];
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

function interpComponents(components: any[], vars: Record<string, any>): any[] {
  if (!Array.isArray(components)) return [];
  return components.map((row: any) => {
    if (!row || row.type !== 1 || !Array.isArray(row.components)) return row;
    return {
      type: 1,
      components: row.components.map((c: any) => {
        const out: any = { ...c };
        if (typeof c.label === "string") out.label = interp(c.label, vars);
        if (typeof c.url === "string") out.url = interp(c.url, vars);
        if (typeof c.placeholder === "string") out.placeholder = interp(c.placeholder, vars);
        if (typeof c.custom_id === "string") out.custom_id = interp(c.custom_id, vars);
        if (Array.isArray(c.options)) {
          out.options = c.options.map((o: any) => ({
            ...o,
            label: typeof o.label === "string" ? interp(o.label, vars) : o.label,
            description: typeof o.description === "string" ? interp(o.description, vars) : o.description,
          }));
        }
        return out;
      }),
    };
  });
}

export interface ApplyOptions {
  vars?: Record<string, any>;
  keepFields?: boolean;
}

export async function applyTemplate(
  guildId: string,
  slot: string,
  baseEmbed: any,
  opts: ApplyOptions = {},
): Promise<{ embed: any; content?: string; components?: any[] }> {
  const tpl = await getTemplate(guildId, slot);
  if (!tpl || !tpl.enabled) return { embed: baseEmbed };
  const v = opts.vars ?? {};
  const out: any = { ...baseEmbed };

  if (tpl.title) {
    out.title = interp(tpl.title, v);
    if (tpl.title_url) out.url = interp(tpl.title_url, v);
  }
  if (tpl.description) out.description = interp(tpl.description, v);
  if (typeof tpl.color === "number") out.color = tpl.color;
  if (tpl.footer_text) out.footer = { text: interp(tpl.footer_text, v) };
  if (tpl.thumbnail_url) out.thumbnail = { url: tpl.thumbnail_url };
  if (tpl.image_url) out.image = { url: tpl.image_url };
  if (tpl.show_timestamp) out.timestamp = new Date().toISOString();
  if (tpl.author_name) {
    out.author = {
      name: interp(tpl.author_name, v) ?? "",
      ...(tpl.author_icon_url ? { icon_url: tpl.author_icon_url } : {}),
      ...(tpl.author_url ? { url: interp(tpl.author_url, v) } : {}),
    };
  }

  if (Array.isArray(tpl.fields) && tpl.fields.length) {
    out.fields = tpl.fields.map((f: any) => ({
      name: interp(f.name, v) ?? "",
      value: interp(f.value, v) ?? "",
      inline: !!f.inline,
    }));
  }

  const components = Array.isArray(tpl.components) && tpl.components.length
    ? interpComponents(tpl.components, v)
    : undefined;

  return {
    embed: out,
    content: tpl.content ? interp(tpl.content, v) : undefined,
    components,
  };
}
