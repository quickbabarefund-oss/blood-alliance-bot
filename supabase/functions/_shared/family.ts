// Family Clan Dashboard helpers
import { adminClient } from "./leaderboard.ts";
import { fetchClan, normalizeTag, type CoCClan } from "./coc.ts";
import { applyTemplate, getTemplate } from "./embed_templates.ts";

const BOT = Deno.env.get("DISCORD_BOT_TOKEN")!;
const DEFAULT_COLOR = 0x5865F2;

export interface FamilyClanRow { id: number; category_id: number; clan_tag: string; clan_name: string; position: number }
export interface FamilyCategoryRow {
  id: number; name: string; position: number;
  emoji?: string | null; button_label?: string | null;
  button_style?: number | null; line_format?: string | null;
}
export interface FamilyInfoRow {
  id: number; guild_id: string; key: string; label: string;
  emoji: string | null; button_style: number;
  title: string | null; description: string | null; color: number | null;
  image_url: string | null; thumbnail_url: string | null; position: number;
}
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
  spacing_lines?: number;
}

export async function loadFamily(guildId: string) {
  const sb = adminClient();
  const [{ data: cats }, { data: clans }] = await Promise.all([
    sb.from("family_categories").select("id,name,position,emoji,button_label,button_style,line_format").eq("guild_id", guildId).order("position").order("name"),
    sb.from("family_clans").select("id,category_id,clan_tag,clan_name,position").eq("guild_id", guildId).order("position"),
  ]);
  return { categories: (cats ?? []) as FamilyCategoryRow[], clans: (clans ?? []) as FamilyClanRow[] };
}

export async function loadFamilyInfo(guildId: string): Promise<FamilyInfoRow[]> {
  const { data } = await adminClient()
    .from("family_info_messages")
    .select("*").eq("guild_id", guildId)
    .order("position").order("id");
  return (data ?? []) as FamilyInfoRow[];
}

// Parse a Discord emoji string. Accepts unicode ("🏆") or custom "<:name:id>" / "<a:name:id>".
function parseEmoji(s?: string | null): any | undefined {
  if (!s) return undefined;
  const t = s.trim();
  if (!t) return undefined;
  const m = /^<(a)?:([A-Za-z0-9_~]+):(\d+)>$/.exec(t);
  if (m) return { name: m[2], id: m[3], animated: !!m[1] };
  return { name: t };
}

function packButtonRows(buttons: any[]): any[] {
  const rows: any[] = [];
  for (let i = 0; i < buttons.length && rows.length < 5; i += 5) {
    rows.push({ type: 1, components: buttons.slice(i, i + 5) });
  }
  return rows;
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
  const [{ categories, clans }, infos, layoutRow] = await Promise.all([
    loadFamily(guildId),
    loadFamilyInfo(guildId),
    sb.from("family_dashboard_layout").select("stats_position,stats_enabled").eq("guild_id", guildId).maybeSingle().then((r) => r.data as { stats_position: number; stats_enabled: boolean } | null),
  ]);
  const statsPosition = layoutRow?.stats_position ?? 9999;
  const statsEnabled = layoutRow ? layoutRow.stats_enabled : true;

  // Build a unified, position-sorted list of buttons (categories + info entries),
  // then splice the Clan Statistics button at the configured position.
  type Btn = { pos: number; button: any };
  const items: Btn[] = [];
  for (const cat of categories) {
    const label = (cat.button_label?.trim() || cat.name).slice(0, 80);
    items.push({
      pos: cat.position ?? 0,
      button: {
        type: 2,
        style: cat.button_style ?? 2,
        label,
        emoji: parseEmoji(cat.emoji),
        custom_id: `fam:cat:${cat.id}`,
      },
    });
  }
  for (const info of infos) {
    items.push({
      pos: info.position ?? 0,
      button: {
        type: 2,
        style: info.button_style ?? 2,
        label: (info.label || info.key).slice(0, 80),
        emoji: parseEmoji(info.emoji),
        custom_id: `fam:info:${info.id}`,
      },
    });
  }
  // Stable sort by position then by insertion order
  items.sort((a, b) => a.pos - b.pos);
  if (statsEnabled && clans.length) {
    const statsBtn = {
      type: 2, style: 2, label: "Clan Statistics",
      emoji: parseEmoji("📊"),
      custom_id: `fam:stats`,
    };
    // Insert at first index where existing pos >= statsPosition, else append
    let idx = items.findIndex((it) => it.pos >= statsPosition);
    if (idx < 0) idx = items.length;
    items.splice(idx, 0, { pos: statsPosition, button: statsBtn });
  }
  const buttons = items.slice(0, 25).map((it) => it.button);
  const components = packButtonRows(buttons);

  // Build the embed body. If admin hasn't set a description we keep the
  // original "category lists in fields" layout so the message still looks
  // helpful before they wire info / stats buttons up.
  const fields: any[] = [];
  if (!categories.length) {
    fields.push({ name: "No categories yet", value: "Use `/family_category add <name>` to create one (becomes a button), then `/family_clan add` to populate.", inline: false });
  }

  const embedConfigHasFields = Boolean(c.description);
  if (categories.length && !embedConfigHasFields) {
    const lineTpl = c.clan_line_format || "`{i}.` **{name}** `{tag}`";
    const emoji = c.category_emoji || "🏰";
    categories.forEach((cat) => {
      const cs = clans.filter((x) => x.category_id === cat.id);
      const value = cs.length
        ? cs.map((cl, i) => formatLine(cat.line_format || lineTpl, {
            i: i + 1, tag: cl.clan_tag, name: cl.clan_name || cl.clan_tag,
          })).join("\n")
        : "_No clans yet_";
      fields.push({
        name: `${cat.emoji || emoji} ${cat.name} — ${cs.length}`,
        value: value.slice(0, 1024),
        inline: false,
      });
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
  const finalEmbed = { ...tplResult.embed };
  if (typeof finalEmbed.title === "string") finalEmbed.title = finalEmbed.title.replace(/^[\s\u200b]+|[\s\u200b]+$/g, "");
  if (typeof finalEmbed.description === "string") finalEmbed.description = finalEmbed.description.replace(/^[\s\u200b]+|[\s\u200b]+$/g, "");
  const content = tplResult.content ? tplResult.content.replace(/^[\s\u200b]+|[\s\u200b]+$/g, "") : undefined;
  return { content: content || undefined, embeds: [finalEmbed], components, allowed_mentions: { parse: [] } };
}

// Build the "category click" response: embed listing clans in that category + a select menu.
export async function buildCategoryListPayload(guildId: string, categoryId: number): Promise<any> {
  const sb = adminClient();
  const { data: cat } = await sb.from("family_categories")
    .select("id,name,emoji,line_format").eq("guild_id", guildId).eq("id", categoryId).maybeSingle();
  if (!cat) return { content: "Category not found.", flags: 64 };
  const { data: cs } = await sb.from("family_clans")
    .select("clan_tag,clan_name,position")
    .eq("guild_id", guildId).eq("category_id", categoryId)
    .order("position");
  const clans = (cs ?? []) as Array<{ clan_tag: string; clan_name: string }>;

  const lineTpl = (cat as any).line_format || "`{i}.` **{name}** `{tag}`";
  const emoji = (cat as any).emoji || "🏰";
  const body = clans.length
    ? clans.map((cl, i) => formatLine(lineTpl, {
        i: i + 1, tag: cl.clan_tag, name: cl.clan_name || cl.clan_tag,
      })).join("\n")
    : "_No clans yet_";

  const embed = {
    title: `${emoji} ${cat.name} Clans`,
    description: `**${cat.name} Clans — ${clans.length}**\n${body}`,
    color: DEFAULT_COLOR,
  };
  const components: any[] = [];
  if (clans.length) {
    components.push({
      type: 1,
      components: [{
        type: 3,
        custom_id: `fam:view:${cat.id}`,
        placeholder: `Select a ${cat.name} Clan`,
        options: clans.slice(0, 25).map((cl) => ({
          label: (cl.clan_name || cl.clan_tag).slice(0, 100),
          description: cl.clan_tag.slice(0, 100),
          value: cl.clan_tag,
        })),
      }],
    });
  }
  return { embeds: [embed], components, allowed_mentions: { parse: [] }, flags: 64 };
}

// Build the "info button click" payload
export async function buildInfoPayload(guildId: string, infoId: number): Promise<any> {
  const { data } = await adminClient()
    .from("family_info_messages").select("*")
    .eq("guild_id", guildId).eq("id", infoId).maybeSingle();
  if (!data) return { content: "Info not found.", flags: 64 };
  const info = data as FamilyInfoRow;
  const embed: any = {
    title: info.title || info.label,
    description: (info.description ?? "").replace(/\\n/g, "\n") || undefined,
    color: info.color ?? DEFAULT_COLOR,
  };
  if (info.image_url) embed.image = { url: info.image_url };
  if (info.thumbnail_url) embed.thumbnail = { url: info.thumbnail_url };
  return { embeds: [embed], flags: 64, allowed_mentions: { parse: [] } };
}

// Build the "Clan Statistics" payload — month-to-date donations + active/inactive activity.
export async function buildFamilyStatsPayload(guildId: string): Promise<any> {
  const sb = adminClient();
  const [{ categories, clans }] = await Promise.all([loadFamily(guildId)]);
  if (!clans.length) return { content: "No clans tracked yet.", flags: 64 };

  // Month-to-date donations per clan (sum from monthly_aggregates for current IST month)
  const istNow = new Date(Date.now() + (5 * 60 + 30) * 60_000);
  const monthKey = `${istNow.getUTCFullYear()}-${String(istNow.getUTCMonth() + 1).padStart(2, "0")}`;
  const clanTags = clans.map((c) => c.clan_tag);
  const [{ data: agg }, { data: clanMeta }, { data: activity }] = await Promise.all([
    sb.from("monthly_aggregates").select("clan_tag,donations")
      .eq("month_key", monthKey).in("clan_tag", clanTags),
    sb.from("clans").select("tag,name,member_count").in("tag", clanTags),
    sb.from("player_activity_events")
      .select("player_tag,clan_tag,occurred_at")
      .in("clan_tag", clanTags)
      .gte("occurred_at", new Date(Date.now() - 24 * 3600_000).toISOString()),
  ]);

  const donationByClan = new Map<string, number>();
  for (const r of (agg ?? []) as any[]) {
    donationByClan.set(r.clan_tag, (donationByClan.get(r.clan_tag) ?? 0) + (r.donations ?? 0));
  }
  const metaByTag = new Map<string, { name: string; member_count: number }>();
  for (const r of (clanMeta ?? []) as any[]) {
    metaByTag.set(r.tag, { name: r.name, member_count: r.member_count ?? 0 });
  }
  const activeByClan = new Map<string, Set<string>>();
  for (const r of (activity ?? []) as any[]) {
    if (!activeByClan.has(r.clan_tag)) activeByClan.set(r.clan_tag, new Set());
    activeByClan.get(r.clan_tag)!.add(r.player_tag);
  }

  const fmtNum = (n: number) => n.toLocaleString("en-US");
  const blocks: string[] = [];
  for (const cat of categories) {
    const cs = clans.filter((x) => x.category_id === cat.id);
    if (!cs.length) continue;
    const lines: string[] = [`**${cat.emoji || "🏰"} ${cat.name}**`];
    for (const cl of cs) {
      const meta = metaByTag.get(cl.clan_tag);
      const name = cl.clan_name || meta?.name || cl.clan_tag;
      const members = meta?.member_count ?? 0;
      const status = members >= 50 ? "🔴 FULL" : members >= 45 ? "🟡 LIMITED" : "🟢 OPEN";
      const donations = donationByClan.get(cl.clan_tag) ?? 0;
      const active = activeByClan.get(cl.clan_tag)?.size ?? 0;
      const inactive = Math.max(0, members - active);
      lines.push(
        `🏆 **${name}** — ${status}`,
        `⚔️ Donations: ${fmtNum(donations)}`,
        `✅ Wars: Active`,
        `👥 People: ${active} Active | ${inactive} Inactive`,
        "",
      );
    }
    blocks.push(lines.join("\n"));
  }
  const desc = blocks.join("\n").slice(0, 3900) || "No data yet.";
  return {
    embeds: [{
      title: "📊 Family Alliance Statistics",
      description: desc,
      color: DEFAULT_COLOR,
      footer: { text: `Month-to-date donations · activity = last 24h · ${monthKey}` },
    }],
    flags: 64,
    allowed_mentions: { parse: [] },
  };
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
export async function syncDashboardMessage(guildId: string): Promise<{ ok: boolean; error?: string; message_id?: string; channel_id?: string; title?: string; description_preview?: string }> {
  const sb = adminClient();
  const { data: cfg } = await sb.from("family_dashboards").select("*").eq("guild_id", guildId).maybeSingle();
  if (!cfg) return { ok: false, error: "no dashboard registered. Run `/family_clan_dashboard` first." };

  const payload = await buildDashboardPayload(guildId, cfg as FamilyDashboardCfg);
  const sentEmbed = payload.embeds?.[0] ?? {};
  const proof = {
    title: typeof sentEmbed.title === "string" ? sentEmbed.title : undefined,
    description_preview: typeof sentEmbed.description === "string" ? sentEmbed.description.slice(0, 80) : undefined,
    channel_id: cfg.channel_id,
  };

  if (cfg.message_id) {
    const r = await fetch(`https://discord.com/api/v10/channels/${cfg.channel_id}/messages/${cfg.message_id}`, {
      method: "PATCH",
      headers: { Authorization: `Bot ${BOT}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.ok) {
      await sb.from("family_dashboards").update({ updated_at: new Date().toISOString() }).eq("guild_id", guildId);
      return { ok: true, ...proof, message_id: cfg.message_id };
    }
    const errText = (await r.text()).slice(0, 300);
    // Only fall through to creating a NEW message if the existing one was deleted.
    if (r.status !== 404 && r.status !== 410) {
      return { ok: false, error: `Discord PATCH ${r.status}: ${errText}`, ...proof, message_id: cfg.message_id };
    }
    console.warn("dashboard message gone, posting fresh", r.status, errText);
  }

  const r2 = await fetch(`https://discord.com/api/v10/channels/${cfg.channel_id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${BOT}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r2.ok) return { ok: false, error: `Discord POST ${r2.status}: ${(await r2.text()).slice(0, 200)}`, ...proof };
  const j = await r2.json();
  await sb.from("family_dashboards").update({
    message_id: j.id, updated_at: new Date().toISOString(),
  }).eq("guild_id", guildId);
  return { ok: true, ...proof, message_id: j.id };
}

export { normalizeTag };
