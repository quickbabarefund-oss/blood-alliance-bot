## Plan: Discord Embeds + Global Leaderboard Format

### 1. Discord — Rich Embeds with Pagination (20 per page)
**New file:** `supabase/functions/_shared/embeds.ts`
- Build embed payloads (gold for clan, blue for global) with 20 rows per page
- Footer: "Page X / Y · Updated <t:..:R> · Resets 1st 00:00 IST"
- Components: `First` ⏮ · `Prev` ◀ · `Next` ▶ · `Last` ⏭ buttons (disable at edges)
- Custom IDs: `lb:clan:<TAG>:<page>` and `lb:global:<page>`

**Update `_shared/leaderboard.ts`:**
- `buildClanLeaderboard(tag, monthKey?, page=0)` → returns `{ embeds, components }`
- `buildGlobalLeaderboard(monthKey?, page=0)` → returns `{ embeds, components }`
- `refreshAllDiscordMessages()` always pushes page 0 every 5 min
- `upsertLeaderboardMessage` in `_shared/discord.ts` updated to send full payload (embeds + components) instead of plain `content`

**Update `discord-interactions/index.ts`:**
- Handle `type === 3` (MESSAGE_COMPONENT) → parse custom_id → respond with type `7` (UPDATE_MESSAGE) carrying the new page's embeds + components
- Existing slash commands switch from `content` strings to embed payloads

### 2. Global Leaderboard (Web) — New Column Layout
**Update `src/pages/GlobalLeaderboard.tsx`:**
- New columns in this exact order:
  1. **Standing** (rank with crown for #1, gold pill for top 3)
  2. **Clan Name** (resolve from `clans` table, link to `/clan/<tag>`)
  3. **Player Name** (link to `/player?tag=...`, tag underneath)
  4. **Donation** (right-aligned, gold mono)
- Remove Received and Ratio columns from the global view
- Fetch clan names: add a second query `supabase.from("clans").select("tag,name")` and merge into rows as `clan_name`
- Update search keys to include `clan_name`
- Keep month selector + hero stats unchanged

### Out of scope
- Per-clan page format (stays as-is with Received/Ratio)
- Web-side pagination (web table already handles 500 rows with search/sort)

### Notes on "0 / 0" rows
First snapshot per player is treated as baseline (delta = 0). Real numbers accumulate from the **second** poll onward as players donate. No code change needed — this is the correct anti-double-count behavior.