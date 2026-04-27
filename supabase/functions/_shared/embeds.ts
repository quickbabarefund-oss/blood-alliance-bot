// Discord embed builders for paginated leaderboards (per-guild scoped).
import { adminClient } from "./leaderboard.ts";
import { istMonthKey } from "./month.ts";

export const PAGE_SIZE = 20;
const COLOR_GOLD = 0xF1B93B;
const COLOR_BLUE = 0x4A8DFF;

type Row = {
  player_tag: string;
  player_name: string;
  clan_tag: string;
  donations: number;
  donations_received: number;
};

type ClanInfo = { tag: string; name: string; badge_url: string | null };

function pad(s: string, n: number) {
  if (s.length >= n) return s.slice(0, n - 1) + "…";
  return s + " ".repeat(n - s.length);
}
function padNum(n: number, w: number) {
  return String(n).padStart(w, " ");
}

function navButtons(prefix: string, page: number, totalPages: number) {
  // Each custom_id MUST be unique even when buttons are disabled.
  return [{
    type: 1,
    components: [
      { type: 2, style: 2, label: "⏮", custom_id: `${prefix}:first`, disabled: page <= 0 },
      { type: 2, style: 2, label: "◀", custom_id: `${prefix}:prev:${page}`, disabled: page <= 0 },
      { type: 2, style: 1, label: `Page ${page + 1}/${Math.max(1, totalPages)}`, custom_id: `${prefix}:noop`, disabled: true },
      { type: 2, style: 2, label: "▶", custom_id: `${prefix}:next:${page}`, disabled: page >= totalPages - 1 },
      { type: 2, style: 2, label: "⏭", custom_id: `${prefix}:last`, disabled: page >= totalPages - 1 },
    ],
  }];
}

async function getBlacklistSet(sb: ReturnType<typeof adminClient>): Promise<Set<string>> {
  const { data } = await sb.from("blacklist").select("player_tag");
  return new Set(((data as { player_tag: string }[] | null) ?? []).map((b) => b.player_tag));
}

const ENV_TAG = Deno.env.get("DISCORD_ENV") ?? "prod";
function envFooter(text: string) {
  return ENV_TAG === "prod" ? text : `${text} · Env: ${ENV_TAG}`;
}

export async function buildClanEmbed(guildId: string, clanTag: string, page = 0, monthKey?: string) {
  const sb = adminClient();
  const mk = monthKey ?? istMonthKey();

  const { data: clan } = await sb.from("clans")
    .select("tag,name,badge_url")
    .eq("guild_id", guildId).eq("tag", clanTag).maybeSingle();
  const c = (clan as ClanInfo | null) ?? { tag: clanTag, name: clanTag, badge_url: null };

  const [aggRes, blocked] = await Promise.all([
    sb.from("monthly_aggregates")
      .select("player_tag,player_name,clan_tag,donations,donations_received")
      .eq("month_key", mk).eq("clan_tag", clanTag)
      .order("donations", { ascending: false }),
    getBlacklistSet(sb),
  ]);
  const all = ((aggRes.data as Row[]) ?? []).filter((r) => !blocked.has(r.player_tag));
  const total = all.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const rows = all.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const startRank = safePage * PAGE_SIZE + 1;
  const lines = rows.length === 0
    ? "(no data yet — wait for next poll)"
    : rows.map((r, i) => {
        const rank = padNum(startRank + i, 3);
        const name = pad(r.player_name || r.player_tag, 16);
        const d = padNum(r.donations, 6);
        const rcv = padNum(r.donations_received, 6);
        const ratio = r.donations_received > 0 ? (r.donations / r.donations_received).toFixed(2) : "∞";
        return `\`${rank} ${name} ${d} /${rcv}  ${ratio}\``;
      }).join("\n");

  const embed: any = {
    title: `🛡️ ${c.name || c.tag} — Donation Leaderboard`,
    description: `**Tag:** \`${c.tag}\`\n**Members tracked:** ${total}\n\n\`#   Player           Donated /  Recv  Ratio\`\n${lines}`,
    color: COLOR_GOLD,
    footer: { text: envFooter(`Page ${safePage + 1}/${totalPages} · Month ${mk} (IST) · Resets 1st 00:00 IST`) },
    timestamp: new Date().toISOString(),
  };
  if (c.badge_url) embed.thumbnail = { url: c.badge_url };

  return {
    embeds: [embed],
    components: navButtons(`lb:clan:${guildId}:${clanTag}`, safePage, totalPages),
  };
}

export async function buildGlobalEmbed(guildId: string, page = 0, monthKey?: string) {
  const sb = adminClient();
  const mk = monthKey ?? istMonthKey();

  // Only include clans tracked by this guild
  const { data: guildClans } = await sb.from("clans").select("tag").eq("guild_id", guildId);
  const clanTags = ((guildClans as { tag: string }[] | null) ?? []).map((c) => c.tag);
  if (clanTags.length === 0) {
    return {
      embeds: [{
        title: "🌐 Alliance Global Leaderboard",
        description: "No clans tracked in this server yet.\nUse `/clan add` to register one.",
        color: COLOR_BLUE,
        footer: { text: envFooter(`Month ${mk} (IST)`) },
      }],
      components: navButtons("lb:global:" + guildId, 0, 1),
    };
  }

  const [aggRes, blocked] = await Promise.all([
    sb.from("monthly_aggregates")
      .select("player_tag,player_name,clan_tag,donations,donations_received")
      .eq("month_key", mk)
      .in("clan_tag", clanTags)
      .order("donations", { ascending: false })
      .limit(2000),
    getBlacklistSet(sb),
  ]);
  const all = ((aggRes.data as Row[]) ?? []).filter((r) => !blocked.has(r.player_tag));
  const total = all.length;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(0, page), totalPages - 1);
  const rows = all.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);

  const tags = Array.from(new Set(rows.map((r) => r.clan_tag)));
  const clanMap: Record<string, string> = {};
  if (tags.length) {
    const { data: clans } = await sb.from("clans").select("tag,name").in("tag", tags).eq("guild_id", guildId);
    (clans as { tag: string; name: string }[] | null)?.forEach((c) => { clanMap[c.tag] = c.name || c.tag; });
  }

  const startRank = safePage * PAGE_SIZE + 1;
  const lines = rows.length === 0
    ? "(no data yet — wait for next poll)"
    : rows.map((r, i) => {
        const rank = padNum(startRank + i, 3);
        const clan = pad(clanMap[r.clan_tag] || r.clan_tag, 14);
        const player = pad(r.player_name || r.player_tag, 16);
        const d = padNum(r.donations, 7);
        return `\`${rank} ${clan} ${player} ${d}\``;
      }).join("\n");

  const embed = {
    title: "🌐 Alliance Global Leaderboard",
    description: `**Total players:** ${total}\n\n\`#   Clan           Player            Donated\`\n${lines}`,
    color: COLOR_BLUE,
    footer: { text: envFooter(`Page ${safePage + 1}/${totalPages} · Month ${mk} (IST) · Resets 1st 00:00 IST`) },
    timestamp: new Date().toISOString(),
  };

  return {
    embeds: [embed],
    components: navButtons(`lb:global:${guildId}`, safePage, totalPages),
  };
}
