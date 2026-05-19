# Dashboard Button Reordering

Make every button on the Family Clan Dashboard reorderable: category buttons, custom info buttons, and the Clan Statistics button. Two ways to reorder — Discord slash commands (quick) and drag-and-drop in the web app (visual).

## What you'll get

### Discord commands
- `/family_category reorder` — opens an ordered picker so you can move a category up/down, or set its exact position
- `/family_category edit … position:<n>` — set position inline when editing
- `/family_category add … position:<n>` — choose insertion position when adding
- `/family_info reorder`, `/family_info edit … position:<n>`, `/family_info add … position:<n>` — same for custom info buttons
- `/family_dashboard_layout stats_position:<n> stats_enabled:<bool>` — control where the Clan Statistics button sits in the global order (or hide it)

After any reorder, the dashboard message auto-refreshes.

### Web UI (new "Family Dashboard" page)
- Single list showing every button in render order (categories, info, stats) with its emoji + label + type badge
- Drag handles to reorder across the whole list
- Stats button shown as a draggable pinned row with a visibility toggle
- "Save order" persists positions; "Preview" re-renders the dashboard in Discord

## Technical details

**DB migration**
- `family_categories.position` and `family_info_messages.position` already exist — reuse them.
- New table `family_dashboard_layout` (one row per guild): `guild_id pk`, `stats_position int default 9999`, `stats_enabled bool default true`, `updated_at`. Public read, no client writes (edge function uses service role).
- Helper: when inserting at position N, shift existing rows `position >= N` by +1 (done in edge function, not as a trigger, to keep it scoped per-guild and per-list).

**Edge function changes** (`supabase/functions/_shared/family.ts`, `discord-interactions/index.ts`, `_shared/commands.ts`, `discord-register-global-commands`)
- Add `position` option to existing `family_category add/edit` and `family_info add/edit` subcommands.
- Add `reorder` subcommand to both — responds with an ephemeral string-select of items; selecting an item opens a follow-up select with "Move to position 1…N". Two interactions, no modals.
- Add `/family_dashboard_layout` command with `stats_position` and `stats_enabled` options.
- In `buildDashboardPayload`: merge categories + infos into one array, each tagged with its `position`, then splice the stats button at `layout.stats_position` (or append if unset); only emit stats button when `stats_enabled`. Pack into rows of 5 as today.
- After every reorder mutation, call `syncDashboardMessage(guildId)`.

**Web UI** (new route `/family-dashboard`, added to `src/components/Layout.tsx` nav)
- Fetch categories + infos + layout for the configured guild (reuse existing guild selector pattern from other admin pages).
- Use `@dnd-kit/core` + `@dnd-kit/sortable` (already a common pick; will add via `bun add` if missing) for the unified sortable list.
- On drop, compute new positions and write via a new edge function `family-dashboard-reorder` (service-role; validates guild admin via Discord token like existing admin endpoints) that updates `position` columns + `family_dashboard_layout`, then calls `syncDashboardMessage`.

**Help text**
- Update `/help` output to list the new `reorder` subcommands and `/family_dashboard_layout`.

## Files touched

- `supabase/migrations/<ts>_family_dashboard_layout.sql` (new)
- `supabase/functions/_shared/family.ts`
- `supabase/functions/_shared/commands.ts`
- `supabase/functions/discord-interactions/index.ts`
- `supabase/functions/discord-register-global-commands/index.ts`
- `supabase/functions/family-dashboard-reorder/index.ts` (new)
- `src/pages/FamilyDashboard.tsx` (new) + route in `src/App.tsx` + nav entry in `src/components/Layout.tsx`

## Out of scope
- Reordering clans **within** a category (only buttons, per your scope).
- Changing button colors/emojis from the web UI (still done via slash commands).
