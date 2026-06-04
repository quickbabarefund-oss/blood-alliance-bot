## Goal

Round out the slash-command set shown in the screenshot, fix `/cwl_roster` getting stuck on "thinking…", and remember manually-typed clan tags so they appear in autocomplete next to Family clans.

## 1. New / restructured slash commands

Register these in `supabase/functions/_shared/commands.ts` and wire handlers in `supabase/functions/discord-interactions/index.ts`. All take the standard `tag` (autocomplete) + `user` options.


| Slash                        | Status         | Purpose                                                                               |
| ---------------------------- | -------------- | ------------------------------------------------------------------------------------- |
| `/remaining`                 | NEW            | Remaining / missed war hits for the current war (per player, with TH and map pos).    |
| `/war`                       | NEW alias      | Live war summary (wrapper around the existing `current_war` builder).                 |
| `/warlog`                    | NEW alias      | Last 10 regular wars (wrapper around the existing `war_log` builder).                 |
| `/cwl roster`                | RESTRUCTURE    | Subcommand of `/cwl`, reuses `buildCwlRoster`.                                        |
| `/cwl round`                 | NEW subcommand | Current CWL round war (stars, destruction, attacks used per side, end time).          |
| `/cwl war` (current_cwl_war) | NEW subcommand | Live in-progress CWL war detail with feed (mirror of `current_war` but for CWL pair). |
| `/lineup`                    | NEW            | War line-up of a clan: ordered roster with TH + mirror opponent.                      |
| &nbsp;                       | NEW            | &nbsp;                                                                                |
| `.`                          | NEW            | &nbsp;                                                                                |


The existing `/cwl`, `/cwl_roster`, `/cwl_board`, `/war_log`, `/current_war` keep working — they become subcommands or are kept as hidden aliases so nothing breaks for users who already use them. Global-command registration endpoint is re-run after deploy.

New backend pieces:

- `coc_commands.ts` → add `buildRemaining`, `buildLineup`, `buildCurrentCwlWar`, `buildCwlRound`. They reuse `postCoc({action:"current_war"|"cwl_group"|"cwl_war"})`.
- New table `war_callers` (guild_id, clan_tag, war_start_time, attacker_tag, defender_tag, defender_pos, set_by, updated_at) with RLS + grants. `/caller assign|clear` upsert/delete rows; `/lineup` and `/current_war` include the caller's target inline next to each attacker.

## 2. Fix `/cwl_roster` stuck on "thinking"

Root cause is the CoC proxy `cwl_group` call: when the group has 8 clans × 50 members the response is large and intermittently times out, and the current builder has no timeout or partial-failure path, so `runAfterResponse` finishes after Discord has already discarded the interaction.

Changes:

- Wrap `postCoc({action:"cwl_group"})` in a 12 s `AbortController` timeout and retry once.
- Cache the cwl_group response per (guild, season, clan group) for 5 min in memory.
- Build the embeds defensively: if a clan's roster fails to load, render a placeholder field rather than throwing.
- Cap total payload to Discord's 10-embed / 6000-char rules and split into multiple follow-up messages when needed.
- On any failure send a `followUp` error so the spinner always resolves.

Same hardening applied to `buildCwl`, `buildCwlBoard`, `buildCurrentCwlWar`.

## 3. Remember manually-typed clan tags

When a user runs any clan-tag command with a tag that is not in `family_clans`, record it so the same tag autocompletes next time.

- New table `recent_clan_tags` (guild_id, clan_tag, clan_name, last_used_at, use_count) — unique (guild_id, clan_tag), RLS + grants.
- In `handleCocCmd`, after the builder resolves the tag and we have the clan name from CoC, upsert a row (fire-and-forget) when the tag isn't in `family_clans`.
- In the autocomplete handler (`discord-interactions/index.ts` ~line 2007), union `family_clans` (first) with `recent_clan_tags` (after), de-dup by tag, then filter/sort by query. Recently used tags within the last 30 days, max 10 of them, surfaced after Family clans.
- Choice labels keep the existing `Name (#TAG)` format; recent (non-family) entries get a leading `🕘`  prefix so users can tell them apart.

## Technical notes

- Migration adds two tables (`war_callers`, `recent_clan_tags`) with `GRANT SELECT ON ... TO anon, authenticated; GRANT ALL ... TO service_role;` and RLS policies (public read, no client writes — bot writes via service role).
- Subcommand restructure for `/cwl` keeps backwards compat by ALSO registering the flat names; Discord deduplicates by name so both surface, with help text updated.
- `/caller assign` autocomplete on `player` option queries the active war roster via `current_war`; `defender` option autocompletes opponent positions `1..teamSize`.
- `runAfterResponse` is kept but every long path now also has an explicit `followUp` on failure so users never see a permanent "thinking…".
- No frontend changes; this is all edge-function + DB.

## Out of scope

- Modifying the Embed Editor.
- Persisting callers across multiple wars (only the active war is tracked; row is GC'd when a new war row appears).