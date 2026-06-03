## Goal

Turn the current limited Embed Editor into a fully customizable, dynamic embed + message builder that matches what Discord supports — author block, advanced fields, buttons & select menus, full color picker, per-slot placeholders, and a true Discord-style live preview.

## What changes

### 1. Embed schema upgrade

Extend `embed_templates` with the missing Discord embed fields:

- `author_name`, `author_icon_url`, `author_url`
- `title_url` (clickable title)
- `image_height`, no — Discord doesn't allow. Stick to what's supported.
- `components` (jsonb) — action rows of buttons / link buttons / select menus

Migration adds the new columns (nullable, safe defaults) plus GRANTs preserved. `embed_templates.fields` already exists for custom fields.

### 2. New Embed Editor UI (`src/pages/EmbedEditor.tsx`)

Replace the single flat form with a tabbed editor inside the existing left-sidebar layout:

```text
[ Sidebar: slots ]   [ Tabs: Content | Embed | Fields | Components | Placeholders ]   [ Live Preview ]
```

- **Content tab**: message `content` text, markdown helpers (B / I / U / S / code / link / mention chips), placeholder chip inserter.
- **Embed tab**:
  - Author block (name + icon URL + URL) with avatar preview
  - Title + title URL
  - Description with markdown toolbar
  - Footer text + footer icon + show timestamp toggle
  - Thumbnail URL + main image URL with thumbnail previews
  - Full color picker: HSL sliders + hex input + 12 curated preset swatches + "recent colors" stored in localStorage
- **Fields tab**:
  - Add / remove / drag-to-reorder up to 25 fields (using `@dnd-kit/core` already lightweight, or simple up/down buttons to avoid new deps)
  - Per field: name, value (with markdown toolbar + placeholder chips), inline toggle
  - Inline validation: name ≤ 256, value ≤ 1024, totals ≤ 6000
- **Components tab** (new):
  - Up to 5 action rows
  - Per row: add Button, Link Button, or Select Menu
  - Button: label, style (Primary/Secondary/Success/Danger), emoji, custom_id, disabled
  - Link Button: label, URL, emoji
  - Select Menu: placeholder, min/max values, up to 25 options (label, value, description, emoji, default)
  - Drag-to-reorder rows and items
- **Placeholders tab**:
  - Lists every `{placeholder}` available for the active slot with its description
  - Click to insert into the focused input
  - "Sample values" editor so the live preview renders real-looking data

### 3. Dynamic Response Builder (live preview)

A faithful Discord-style preview panel pinned to the right:

- Renders content + embed exactly like Discord (dark theme by default, toggle for light + mobile widths)
- Substitutes `{placeholder}` tokens using the Sample Values from the Placeholders tab
- Renders markdown (bold, italic, underline, strike, inline code, code blocks, links, headers, lists, blockquotes, masked links, user/role/channel mentions)
- Renders timestamp tokens like `<t:1700000000:R>` as relative time
- Renders the components row (buttons + select menus) with correct Discord styles
- Live updates as you type (debounced 100 ms)

### 4. Backend (`supabase/functions/embed-templates-api/index.ts`)

- Accept and persist the new fields (`author_*`, `title_url`, `components`)
- Validate component payloads server-side (row count ≤ 5, items per row ≤ 5 for buttons / 1 for select, option count ≤ 25, custom_id uniqueness)
- Keep the existing token + slot + war-clan endpoints unchanged

### 5. Bot side (`supabase/functions/_shared/embed_templates.ts`)

- `applyTemplate` interpolates placeholders into the new author/title-URL fields
- Returned object now also includes `components` so callers can attach them to the Discord message payload
- Update every call site (`current_war`, `war_started`, `war_win`, `war_lose`, family dashboard, etc.) to forward `components` when present

### 6. Per-slot placeholder expansion

Add more placeholders per slot in `SLOT_PLACEHOLDERS` + `SLOT_PLACEHOLDER_DESCRIPTIONS` so each embed can be "customized for the proper detail" the user mentioned. Examples:

- `war_started`: + `our_tag`, `opp_tag`, `our_badge`, `opp_badge`, `our_level`, `opp_level`, `start_time`, `prep_end`
- `war_win` / `war_lose`: + `our_avg_th`, `opp_avg_th`, `attacks_used`, `attacks_total`, `mvp_name`, `mvp_stars`
- `current_war`: + `state`, `stars`, `opp_stars`, `destruction`, `opp_destruction`, `attacks_used`, `time_left`
- `clan_info`: + `wars_won`, `wars_lost`, `cwl_league`, `capital_hall`, `clan_points`, `versus_points`
- `player_info`: + `role`, `donations`, `received`, `war_stars`, `attack_wins`, `xp`

All call sites in `_shared/war.ts`, `_shared/coc_commands.ts`, `_shared/family.ts` populate the new variables.

## Technical details

- Migration is additive; no data loss. All new columns nullable so existing templates keep working.
- Components are stored as the exact Discord component JSON shape (`{ type: 1, components: [...] }`) so the bot can attach them directly to message payloads.
- Live preview is pure React (no iframe). A small markdown renderer (~150 lines) covers the Discord-supported subset — no new dependency.
- Drag-to-reorder uses native HTML5 DnD to avoid adding a library.
- Color picker uses `react-colorful` (tiny, ~3 KB) added via `bun add react-colorful`.
- Placeholder insertion tracks the last-focused input with a ref so chip clicks insert at the caret.
- Sample values for placeholders are stored in `localStorage` per (guild, slot) — never sent to server.

## Out of scope

- Modals / forms triggered by buttons (would need bot interaction handlers; can be a follow-up)
- Multiple embeds per message (Discord supports 10, but this would require a bigger schema change — flag this as a follow-up if you want it)
- File attachments in embeds