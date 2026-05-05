// Family Clan Dashboard helpers
import { adminClient } from "./leaderboard.ts";
import { fetchClan, normalizeTag, type CoCClan } from "./coc.ts";

const BOT = Deno.env.get("DISCORD_BOT_TOKEN")!;
const COLOR = 0x5865F2;

export interface FamilyClanRow { id: number; category_id: number; clan_tag: string; position: number }
export interface FamilyCategoryRow { id: number; name: string; position: number }

export async function loadFamily(guildId: string) {
  const sb = adminClient();
  const [{ data: cats }, { data: clans }] = await Promise.all([
    sb.from("family_categories").select("id,name,position").eq("guild_id", guildId).order("position").order("name"),
    sb.from("family_clans").select("id,category_id,clan_tag,position").eq("guild_id", guildId).order("position"),
  ]);
  return { categories: (cats ?? []) as FamilyCategoryRow[], clans: (clans ?? []) as FamilyClanRow[] };
}

// Build the dashboard summary embed (overview of all categories / clans by tag)
export async function buildDashboardPayload(guildId: string): Promise<any> {
  const { categories, clans } = await loadFamily(guildId);
  const fields: any[] = [];

  if (!categories.length) {
    fields.push({ name: "No categories yet", value: "Use `/family_category add <name>` to create one, then `/family_clan add` to populate.", inline: false });
  }

  for (const cat of categories) {
    const cs = clans.filter((c) => c.category_id === cat.id);
    const value = cs.length
      ? cs.map((c, i) => `\`${i + 1}.\` **${c.clan_tag}**`).join("\n")
      : "_No clans yet_";
    fields.push({ name: `🏰 ${cat.name} — ${cs.length}`, value, inline: false });
  }

  // One select menu per category (max 25 options, max 5 menus = 5 action rows)
  const components: any[] = [];
  for (const cat of categories.slice(0, 5)) {
    const cs = clans.filter((c) => c.category_id === cat.id).slice(0, 25);
    if (!cs.length) continue;
    components.push({
      type: 1,
      components: [{
        type: 3,
        custom_id: `fam:view:${cat.id}`,
        placeholder: `🔎 ${cat.name} — pick a clan to view details`,
        options: cs.map((c) => ({ label: c.clan_tag.slice(0, 100), value: c.clan_tag })),
      }],
    });
  }

  const embed = {
    title: "🏛️ Family Clan Dashboard",
    description: "All official clans grouped by category. Use the select menus below to view full clan info (leader, co-leaders, members).",
    color: COLOR,
    fields,
    footer: { text: "Updated automatically when /family_clan or /family_category commands run." },
    timestamp: new Date().toISOString(),
  };

  return { embeds: [embed], components, allowed_mentions: { parse: [] } };
}

// Build the per-clan detail embed (live from CoC API)
export async function buildClanDetailEmbed(clanTag: string): Promise<any> {
  let clan: CoCClan | null = null;
  try { clan = await fetchClan(clanTag); }
  catch (e) {
    return { embeds: [{ title: "⚠️ Clan lookup failed", description: `Could not fetch \`${clanTag}\`: ${e instanceof Error ? e.message : String(e)}`, color: 0xED4245 }] };
  }
  const c: any = clan ?? {};
  const members: any[] = c.memberList ?? [];
  const leader = members.find((m) => m.role === "leader");
  const coLeaders = members.filter((m) => m.role === "coLeader");
  const elders = members.filter((m) => m.role === "admin").length;
  const memberCount = members.length || c.members || 0;

  const fields: any[] = [
    { name: "🏷️ Tag", value: `\`${c.tag ?? clanTag}\``, inline: true },
    { name: "👥 Members", value: `${memberCount}/50`, inline: true },
    { name: "🏆 Level", value: String(c.clanLevel ?? "—"), inline: true },
  ];
  if (c.warLeague?.name) fields.push({ name: "⚔️ War League", value: c.warLeague.name, inline: true });
  if (c.clanPoints != null) fields.push({ name: "🛡️ Trophies", value: String(c.clanPoints), inline: true });
  if (c.warWinStreak != null) fields.push({ name: "🔥 Win Streak", value: String(c.warWinStreak), inline: true });

  fields.push({
    name: "👑 Leader",
    value: leader ? `**${leader.name}** \`${leader.tag}\`` : "_Unknown_",
    inline: false,
  });
  fields.push({
    name: `🥈 Co-Leaders — ${coLeaders.length}`,
    value: coLeaders.length
      ? coLeaders.slice(0, 10).map((m) => `• **${m.name}** \`${m.tag}\``).join("\n")
      : "_None_",
    inline: false,
  });
  fields.push({ name: "🎖️ Elders", value: String(elders), inline: true });

  const embed = {
    title: `🏰 ${c.name ?? clanTag}`,
    description: c.description ? String(c.description).slice(0, 300) : undefined,
    color: COLOR,
    thumbnail: c.badgeUrls?.medium ? { url: c.badgeUrls.medium } : undefined,
    fields,
    footer: { text: "Live from Clash of Clans" },
    timestamp: new Date().toISOString(),
  };
  return { embeds: [embed], flags: 64, allowed_mentions: { parse: [] } };
}

// Persist dashboard message — create or edit
export async function syncDashboardMessage(guildId: string): Promise<{ ok: boolean; error?: string }> {
  const sb = adminClient();
  const { data: cfg } = await sb.from("family_dashboards").select("*").eq("guild_id", guildId).maybeSingle();
  if (!cfg) return { ok: false, error: "no dashboard registered. Run `/family_clan_dashboard` first." };

  const payload = await buildDashboardPayload(guildId);

  // Try editing the existing message
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
    // fall through to recreate
  }

  // Create a new message
  const r2 = await fetch(`https://discord.com/api/v10/channels/${cfg.channel_id}/messages`, {
    method: "POST",
    headers: { Authorization: `Bot ${BOT}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!r2.ok) return { ok: false, error: `Discord ${r2.status}: ${(await r2.text()).slice(0, 200)}` };
  const j = await r2.json();
  await sb.from("family_dashboards").upsert({
    guild_id: guildId,
    channel_id: cfg.channel_id,
    message_id: j.id,
    updated_at: new Date().toISOString(),
  });
  return { ok: true };
}

export { normalizeTag };
