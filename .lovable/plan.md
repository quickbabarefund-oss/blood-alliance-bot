## 1. War TH composition in `/current_war`

Add a single-line TH breakdown for each side, under the score row.

```
🏠 Us:  TH17×5  TH16×10  TH15×8  TH14×2
🏠 Opp: TH17×6  TH16×9   TH15×9  TH14×1
```

**Where:** `supabase/functions/_shared/war.ts` — in the function that builds the current war embed (and reused by `/current_war` handler). Pull `townhallLevel` from each side's roster (stored in `wars.raw_roster`), bucket → sort TH desc → format with TH emoji from `th_emojis` table.

---

## 2. Redesigned Family Dashboard

Replace the current per-category select-menu dashboard with a **button-based** layout matching the reference.

### Dashboard message

- Embed (configurable via Embed Editor `family_dashboard` slot, already exists) — title, description, image, etc.
- **Button row(s)**: one button per family category, in `position` order. Discord allows 5 buttons/row → up to 5 rows = 25 categories.
- Each category gets a configurable **emoji + label + button style** (Primary/Secondary/Success/Danger).

### New table: `family_category_buttons` (or new columns on `family_categories`)

Add columns to `family_categories`:

- `emoji text` (e.g. `🏆`, `⚔️`, `👑`)
- `button_style smallint default 2` (1=Primary 2=Secondary 3=Success 4=Danger)
- `button_label text` (optional override; defaults to `name`)

### Clicking a category button

Sends an **ephemeral** message containing:

1. A header embed listing all clans in that category (numbered, with names + tags) — uses the same `clan_line_format` per-category override (new optional column on `family_categories.line_format`).
2. A **select menu** "Select a {category} Clan" with each clan as an option (label = name, description = tag).

### Selecting a clan from the menu

Reuses existing `buildClanDetailEmbed(clanTag, guildId)` — already shows name/tag/level/members/league/links and respects `clan_info` embed template override. This satisfies the "CWL pull from API" requirement (live CoC data, hyperlinked CC + Open in Game).

### New/updated slash commands

- `/family_category add` — add `emoji`, `label`, `style`, `line_format` options
- `/family_category edit <name>` — change emoji/label/style/line_format/position
- `/family_category list` — show categories with their button preview info

### Info buttons (`/family_info`)

New table `family_info_messages`:

- `guild_id, key (unique per guild), label, emoji, button_style, title, description, color, image_url, thumbnail_url`

Commands:

- `/family_info add <key> <label> <title> <message>` (+ optional emoji, style, color, image)
- `/family_info edit <key> ...`
- `/family_info remove <key>`
- `/family_info list`

Each info entry becomes an extra button on the dashboard, appended **after** category buttons (still 5/row, up to 25 total including categories). Clicking sends an ephemeral embed with that info content.

### Dashboard build changes

`buildDashboardPayload` (in `_shared/family.ts`):

- Stop pushing one field per category and stop emitting select-menu rows.
- Instead: keep base embed (template-driven), then build `components[]` from categories + info entries, packed into rows of 5.
- Interaction handler in `discord-interactions/index.ts`:
  - `custom_id: fam:cat:{categoryId}` → ephemeral category list + clan select
  - `custom_id: fam:info:{key}` → ephemeral info embed
  - Existing `fam:view:{categoryId}` clan-detail flow stays for the per-category select menu.

---

## 3. Migrations

```sql
ALTER TABLE family_categories
  ADD COLUMN emoji text,
  ADD COLUMN button_label text,
  ADD COLUMN button_style smallint NOT NULL DEFAULT 2,
  ADD COLUMN line_format text;

CREATE TABLE family_info_messages (
  id bigserial PRIMARY KEY,
  guild_id text NOT NULL,
  key text NOT NULL,
  label text NOT NULL,
  emoji text,
  button_style smallint NOT NULL DEFAULT 2,
  title text,
  description text,
  color integer,
  image_url text,
  thumbnail_url text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, key)
);
ALTER TABLE family_info_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read family_info_messages"
  ON family_info_messages FOR SELECT USING (true);
```

---

## Files touched

- **New migration** for the two schema changes above
- `supabase/functions/_shared/commands.ts` — add `family_info`, extend `family_category` subcommand options
- `supabase/functions/_shared/family.ts` — new payload builder (buttons, packed rows), helpers for info messages
- `supabase/functions/_shared/war.ts` — TH composition line in current-war embed
- `supabase/functions/discord-interactions/index.ts` — handlers for `family_info` subcommands, `fam:cat:*` and `fam:info:*` button interactions, expanded `family_category` options
- `supabase/functions/discord-register-global-commands` redeploy

---

## Out of scope

- Web Embed Editor UI changes for category emoji/style (admins set via slash commands; can be added later) Modify that also as per it
- "Clan Statistics" button from the reference screenshot (donations + active/inactive counts) — confirm if you want this included now; if yes I'll add it as a separate button on the dashboard that aggregates from `donation_snapshots` + `player_activity_events`. Make it Yes I wanted this