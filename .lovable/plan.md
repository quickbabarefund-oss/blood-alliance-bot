## Goals

1. Rename all "ClashChamps / cc" references to **ChocolateClash (CC)** everywhere in code, embeds, and UI labels.
2. Redesign the **Clan Detail embed** (the one shown when a user picks a clan from the Family Dashboard dropdown) per the attached screenshot.
3. Expose **placeholder variables** in the Embed Editor UI so users know what `{name}`, `{tag}`, etc. they can use per slot.
4. Curate a richer **emoji palette** in the Embed Editor builder.

---

## 1. Rename CC → ChocolateClash

- Memory note: CC = ChocolateClash (not ClashChamps). Save to `mem://index.md` Core.
- Search/replace across:
  - `supabase/functions/_shared/coc_commands.ts` — link labels for `/clan_info`, `/player_info` embeds.
  - `supabase/functions/_shared/embed_templates.ts` — slot labels if any mention CC.
  - `src/pages/EmbedEditor.tsx` — any helper text.
- Link URLs stay the same (`cc.fwafarm.com/cc_n/clan.php?tag=...` and `member.php?tag=...`) but **link text** becomes `ChocolateClash`.

---

## 2. Clan Detail Embed Redesign (`buildClanDetailEmbed` in `_shared/family.ts`)

Match the attached screenshot exactly:

```text
[Clan Badge as author icon] **Clan Name**         [Large badge as thumbnail]
{clan.description — full, up to ~300 chars}

🏷️ Tag           👥 Members        🏆 Level
#CYQVL002        50/50             30

⚔️ War League    🛡️ Trophies       🔥 Win Streak
Gold League I    80350             1

👑 Leader
Darkness #GYYPRRP09     (or @mention if linked)

🥈 Co-Leaders — 6
• ⚡ FlasH ⚡  #R9ULP9VQ
• kylian mbapps  @BLOOD | MESSI
• Clasher  #PU9GYRQP9
• Büd'dha  #L9YVVJ8JJ
• MADARA  @Buddha
• LEGION 9  #GLGCCC8RJ

🎖️ Elders
14

[Open in Game](link) • [ChocolateClash](cc link)

Live from Clash of Clans • {timestamp}
```

Implementation changes in `buildClanDetailEmbed`:
- Set `embed.author = { name: clan.name, icon_url: badgeUrls.small }` and **keep title empty** OR use `title: clan.name` with author removed — pick title = clan name, thumbnail = large badge (matches screenshot).
- Use `description` to hold the clan description (currently truncated at 300 — keep).
- Append a footer-of-description action line with two hyperlinks:
  - `[🎮 Open in Game](https://link.clashofclans.com/en?action=OpenClanProfile&tag=<URLENCODED>)`
  - `[🍫 ChocolateClash](https://cc.fwafarm.com/cc_n/clan.php?tag=<TAG_NO_HASH>)`
- Field order/icons exactly as above. Use new emojis: 🏷️ 👥 🏆 ⚔️ 🛡️ 🔥 👑 🥈 🎖️.
- Keep existing linked-user @mention logic for leader & co-leaders.
- Pass through `applyTemplate(guildId, "clan_info", ...)` so users can still override via Embed Editor (currently this embed bypasses template — wire it up).

---

## 3. Placeholders in Embed Editor UI

In `src/pages/EmbedEditor.tsx`:
- Add a per-slot **"Available placeholders"** panel above the editor fields, listing the `{var}` tokens supported for the currently selected slot, each as a click-to-copy chip.
- Source the list from a new constant `SLOT_PLACEHOLDERS` (mirrored both in frontend and `_shared/embed_templates.ts` so backend can keep using the same vars):
  - `family_dashboard`: none today (no interpolation passed).
  - `war_started` / `war_win` / `war_lose` / `war_reminder`: `{clan}`, `{opponent}`, `{stars}`, `{opp_stars}`, `{destruction}`, `{opp_destruction}`, `{team_size}`, `{end_time}`, `{result}`.
  - `clan_leaderboard`: `{clan}`, `{tag}`, `{month}`.
  - `player_info`: `{name}`, `{tag}`, `{th}`, `{xp}`, `{trophies}`, `{war_stars}`, `{donations}`, `{league}`, `{clan}`, `{role}`.
  - `clan_info`: `{name}`, `{tag}`, `{level}`, `{members}`, `{league}`, `{trophies}`, `{streak}`, `{leader}`, `{description}`.
  - `current_war`: `{clan}`, `{opponent}`, `{state}`, `{stars}`, `{opp_stars}`, `{destruction}`, `{end_time}`, `{team_size}`.
  - `war_log`: `{clan}`, `{recent}`.
  - `clan_members`: `{clan}`, `{count}`, `{page}`.
  - `cwl`: `{clan}`, `{round}`, `{league}`.
  - `capital_raids`: `{clan}`, `{capital_gold}`, `{districts}`, `{top_attacker}`.
- Update `coc_commands.ts` handlers to pass `vars` matching the placeholders above into `applyTemplate`.

---

## 4. Curated Emoji Picker in Embed Editor

In `src/pages/EmbedEditor.tsx`:
- Add a small emoji grid popover next to Title / Description / Field Name / Field Value inputs.
- Curated set (themed for CoC bot): 🏰 🛡️ ⚔️ 🏆 🔥 👑 🥈 🎖️ 🏷️ 👥 🎮 🍫 ⭐ 💥 🎯 📊 📈 📉 🟢 🔴 🟡 ✅ ❌ ⏰ 🕒 🗡️ 🪖 💀 ☠️ 🧱 💣 ⚡ ✨ 💎 📜 📣 📢 🔔 ❤️ 💙 💚.
- Click to insert at caret. No external deps; keep local array.

---

## Files to change

- `supabase/functions/_shared/family.ts` — redesign `buildClanDetailEmbed`, add ChocolateClash + Open in Game hyperlinks, hook `applyTemplate("clan_info", ...)` (or a new slot `clan_detail`).
- `supabase/functions/_shared/coc_commands.ts` — rename CC → ChocolateClash, pass `vars` for each command.
- `supabase/functions/_shared/embed_templates.ts` — export `SLOT_PLACEHOLDERS` map.
- `src/pages/EmbedEditor.tsx` — placeholder chips + emoji picker + CC label fix.
- `mem://index.md` (new) — note CC = ChocolateClash.

## Deploy

- Auto-deploys: `discord-interactions`, `embed-templates-api`.
- No DB migration needed.
- Tell user to refresh `/embed_editor` page and re-run `/family_clan_dashboard`-related interactions to see the new clan detail layout.
