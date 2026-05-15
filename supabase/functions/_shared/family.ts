// Family Clan Dashboard helpers
import { adminClient } from "./leaderboard.ts";
import { fetchClan, normalizeTag, type CoCClan } from "./coc.ts";
import { applyTemplate } from "./embed_templates.ts";

const BOT = Deno.env.get("DISCORD_BOT_TOKEN")!;
const DEFAULT_COLOR = 0x5865F2;

export interface FamilyClanRow { id: number; category_id: number; clan_tag: string; clan_name: string; position: number }
export interface FamilyCategoryRow { id: number; name: string; position: number }
export interface FamilyDashboardCfg {
  guild_id: string;
  channel_id: string;
  message_id: string | null;
  title: string;
  description: string | null;
  color: number;
  footer_text: string | null;
  show_timestamp: boolean;
  thumbnail_url: string | null;
  image_url: string | null;
  category_emoji: string;
  clan_line_format: string;
}

export async function loadFamily(guildId: string) {
  const sb = adminClient();
  const [{ data: cats }, { data: clans }] = await Promise.all([
    sb.from("family_categories").select("id,name,position").eq("guild_id", guildId).order("position").order("name"),
    sb.from("family_clans").select("id,category_id,clan_tag,clan_name,position").eq("guild_id", guildId).order("position"),
  ]);
  return { categories: (cats ?? []) as FamilyCategoryRow[], clans: (clans ?? []) as FamilyClanRow[] };
}

export async function refreshClanName(guildId: string, clanTag: string): Promise<string> {
  const tag = normalizeTag(clanTag);
  try {
    const c = await fetchClan(tag);
    const name = c?.name ?? "";
    if (name) {
      await adminClient().from("family_clans")
        .update({ clan_name: name }).eq("guild_id", guildId).eq("clan_tag", tag);
    }
    return name;
  } catch (e) {
    console.error("refreshClanName failed", tag, e);
    return "";
  }
}

function formatLine(tpl: string, vars: Record<string, string | number>) {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ""));
}

export async function buildDashboardPayload(guildId: string, cfg?: FamilyDashboardCfg | null): Promise<any> {
  const sb = adminClient();
  if (!cfg) {
    const { data } = await sb.from("family_dashboards").select("*").eq("guild_id", guildId).maybeSingle();
    cfg = data as FamilyDashboardCfg | null;
  }
  const c = cfg ?? ({} as FamilyDashboardCfg);
  const { categories, clans } = await loadFamily(guildId);
  const fields: any[] = [];

  if (!categories.length) {
    fields.push({ name: "No categories yet", value: "Use `/family_category add <name>` to create one, then `/family_clan add` to populate.", inline: false });
  }

  const emoji = c.category_emoji || "🏰";
  const lineTpl = c.clan_line_format || "`{i}.` **{name}** `{tag}`";
  categories.forEach((cat) => {
    const cs = clans.filter((x) => x.category_id === cat.id);
    const value = cs.length
      ? cs.map((cl, i) => formatLine(lineTpl, {
          i: i + 1, tag: cl.clan_tag, name: cl.clan_name || cl.clan_tag,
        })).join("\n")
      : "_No clans yet_";
    fields.push({ name: `${emoji} ${cat.name} — ${cs.length}`, value, inline: false });
  });

  const components: any[] = [];
  for (const cat of categories.slice(0, 5)) {
    const cs = clans.filter((x) => x.category_id === cat.id).slice(0, 25);
    if (!cs.length) continue;
    components.push({
      type: 1,
      components: [{
        type: 3,
        custom_id: `fam:view:${cat.id}`,
        placeholder: `🔎 ${cat.name} — pick a clan to view details`,
        options: cs.map((cl) => ({
          label: (cl.clan_name ? `${cl.clan_name} (${cl.clan_tag})` : cl.clan_tag).slice(0, 100),
          value: cl.clan_tag,
        })),
      }],
    });
  }

  let embed: any = {
    title: c.title || "🏛️ Family Clan Dashboard",
    color: c.color ?? DEFAULT_COLOR,
    fields,
  };
  if (c.description) embed.description = c.description;
  if (c.thumbnail_url) embed.thumbnail = { url: c.thumbnail_url };
  if (c.image_url) embed.image = { url: c.image_url };
  if (c.footer_text) embed.footer = { text: c.footer_text };
  if (c.show_timestamp) embed.timestamp = new Date().toISOString();

  // Apply user-overridden template (from web UI builder), preserving fields
  const tplResult = await applyTemplate(guildId, "family_dashboard", embed, { keepFields: true });
  return { content: tplResult.content ?? undefined, embeds: [tplResult.embed], components, allowed_mentions: { parse: [] } };
}

// Build per-clan detail embed (live from CoC API). Mentions linked Discord users when known.
export async function buildClanDetailEmbed(clanTag: string, guildId?: string): Promise<any> {
  let clan: CoCClan | null = null;
  try { clan = await fetchClan(clanTag); }
  catch (e) {
    return { embeds: [{ title: "⚠️ Clan lookup failed", description: `Could not fetch \`${clanTag}\`: ${e instanceof Error ? e.message : String(e)}`, color: 0xED4245 }], flags: 64 };
  }
  const c: any = clan ?? {};
  const members: any[] = c.memberList ?? [];
  const leader = members.find((m) => m.role === "leader");
  const coLeaders = members.filter((m) => m.role === "coLeader");
  const elders = members.filter((m) => m.role === "admin").length;
  const memberCount = members.length || c.members || 0;

  // Bulk-lookup linked discord users for leader + co-leaders
  const lookupTags = [leader, ...coLeaders].filter(Boolean).map((m: any) => m.tag);
  const linkMap = new Map<string, string>();
  if (lookupTags.length) {
    const sb = adminClient();
    const { data } = await sb.from("coc_links").select("player_tag,user_id").in("player_tag", lookupTags);
    for (const r of (data ?? []) as { player_tag: string; user_id: string }[]) {
      if (!linkMap.has(r.player_tag)) linkMap.set(r.player_tag, r.user_id);
    }
  }
  const renderMember = (m: any) => {
    const uid = linkMap.get(m.tag);
    return uid ? `**${m.name}** <@${uid}>` : `**${m.name}** \`${m.tag}\``;
  };

  const tagNoHash = (c.tag ?? clanTag).replace(/^#/, "");
  const inGameUrl = `https://link.clashofclans.com/en?action=OpenClanProfile&tag=${encodeURIComponent(c.tag ?? clanTag)}`;
  const ccUrl = `https://cc.fwafarm.com/cc_n/clan.php?tag=${tagNoHash}`;

  const fields: any[] = [
    { name: "🏷️ Tag", value: `\`${c.tag ?? clanTag}\``, inline: true },
    { name: "👥 Members", value: `${memberCount}/50`, inline: true },
    { name: "🏆 Level", value: String(c.clanLevel ?? "—"), inline: true },
    { name: "⚔️ War League", value: c.warLeague?.name ?? "—", inline: true },
    { name: "🛡️ Trophies", value: String(c.clanPoints ?? "—"), inline: true },
    { name: "🔥 Win Streak", value: String(c.warWinStreak ?? 0), inline: true },
  ];

  fields.push({
    name: "👑 Leader",
    value: leader ? renderMember(leader) : "_Unknown_",
    inline: false,
  });
  fields.push({
    name: `🥈 Co-Leaders — ${coLeaders.length}`,
    value: coLeaders.length
      ? coLeaders.slice(0, 10).map((m) => `• ${renderMember(m)}`).join("\n")
      : "_None_",
    inline: false,
  });
  fields.push({ name: "🎖️ Elders", value: String(elders), inline: true });
  fields.push({
    name: "🔗 Links",
    value: `[🎮 Open in Game](${inGameUrl}) • [🍫 ChocolateClash](${ccUrl})`,
    inline: false,
  });

  const baseEmbed: any = {
    author: c.badgeUrls?.small
      ? { name: c.name ?? clanTag, icon_url: c.badgeUrls.small }
      : undefined,
    title: c.name ?? clanTag,
    url: inGameUrl,
    description: c.description ? String(c.description).slice(0, 300) : undefined,
    color: DEFAULT_COLOR,
    thumbnail: c.badgeUrls?.large ? { url: c.badgeUrls.large } : (c.badgeUrls?.medium ? { url: c.badgeUrls.medium } : undefined),
    fields,
    footer: { text: "Live from Clash of Clans" },
    timestamp: new Date().toISOString(),
  };

  if (!guildId) {
    return { embeds: [baseEmbed], allowed_mentions: { parse: [] } };
  }
  // Allow guild admins to override via Embed Editor (clan_info slot)
  const tplResult = await applyTemplate(guildId, "clan_info", baseEmbed, {
    keepFields: true,
    vars: {
      name: c.name ?? "", tag: c.tag ?? clanTag,
      level: c.clanLevel ?? "", members: memberCount,
      league: c.warLeague?.name ?? "", trophies: c.clanPoints ?? "",
      streak: c.warWinStreak ?? 0, leader: leader?.name ?? "",
      description: c.description ?? "",
    },
  });
  return { embeds: [tplResult.embed], content: tplResult.content, allowed_mentions: { parse: [] } };
}

// Persist dashboard message — create or edit
export async function syncDashboardMessage(guildId: string): Promise<{ ok: boolean; error?: string }> {
  const sb = adminClient();
  const { data: cfg } = await sb.from("family_dashboards").select("*").eq("guild_id", guildId).maybeSingle();
  if (!cfg) return { ok: false, error: "no dashboard registered. Run `/family_clan_dashboard` first." };

  const payload = await buildDashboardPayload(guildId, cfg as FamilyDashboardCfg);

  if (cfg.message_id) {
    const r = await fetch(`https://discord.com/api/v10/channels/${cfg.channel_id}/messages/${cfg.message_id}`, {
      method: "PATCH",
      headers: { Authorization: `Bot ${BOT}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.ok) {
      await sb.from("family_dashboards").update({ updated_at: new Date().toISOString() }).eq("guild_id", guildId);
      return { ok: true };
    }
  }

  const r2 = await fetch(`https://discord.com/api/v10/channels/${cfg.channel_id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${BOT}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r2.ok) return { ok: false, error: `Discord ${r2.status}: ${(await r2.text()).slice(0, 200)}` };
  const j = await r2.json();
  await sb.from("family_dashboards").update({
    message_id: j.id, updated_at: new Date().toISOString(),
  }).eq("guild_id", guildId);
  return { ok: true };
}

export { normalizeTag };
