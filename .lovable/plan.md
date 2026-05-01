# War Tracking System (FWA verification, rule enforcement, reminders)

## What we'll build

A multi-clan war tracking system on top of the existing Discord bot:

1. **War detection + FWA verification** — every ~10 min we sync each tracked clan's current war and cross-check against `fwastats.com/Clan/<TAG>/Wars.json`. New wars get a "Reps" embed for review.
2. **Reps approval flow** — embed shows roster (with TH custom emojis), war stats, and a Win/Lose select menu locked to the configured rep role.
3. **Mail Room announcement** — on selection, a customizable Win/Lose announcement posts to the mail channel, pinging the configured role.
4. **Rule enforcement during battle day** — bot tracks every attack; flags violations of the FWA rule set you specified.
5. **Final result embed + .txt log** — at war end, a 2-page result embed posts to the war log channel (rule-followed Yes/No, counts, page 2 lists violators) with a `.txt` file detailing every broken rule.
6. **War-day reminders** — bot posts a "war started" message + custom timed reminders (before-end OR after-start) showing per-player attack status with TH icon, name, tag, and linked Discord mention if available.
7. **Setup commands** — `/war_track_setup`, `/setup_war_reminder`, `/setup_war_log_channel` — each scoped per (guild, clan) so one server can manage multiple clans independently.

---

## Decisions (locked from your answers)

- **FWA verification source**: `https://fwastats.com/Clan/<TAG_NO_HASH>/Wars.json` — we look up the opponent tag in the recent war list. If found and marked FWA → confirmed. Reviewer can still override via select menu.
- **Rule windows**: anchored on `war.endTime`. "Last 8h" = `endTime - 8h → endTime`. "First 16h" = battle-day start → `endTime - 8h`.
- **Reminders**: each reminder stores `time + anchor` where anchor ∈ `before_end` | `after_start`.
- **Sync cadence**: new `currentwar` action added to existing `coc-api` proxy; cron polls every 10 min.

---

## Database changes (one migration)

```sql
-- War tracking config (per guild + clan)
CREATE TABLE war_track_config (
  guild_id text NOT NULL,
  clan_tag text NOT NULL,
  rep_channel_id text,           -- approval embeds posted here
  rep_role_id text,              -- only this role can use the Win/Lose select
  mail_channel_id text,          -- announcement target
  mail_ping_role_id text,        -- role pinged in announcement
  log_channel_id text,           -- reminders, war-started, results
  win_announcement text,         -- custom template, supports {opponent} {tag}
  lose_announcement text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, clan_tag)
);

-- Custom timed reminders
CREATE TABLE war_reminders (
  id bigserial PRIMARY KEY,
  guild_id text NOT NULL,
  clan_tag text NOT NULL,
  minutes int NOT NULL,                 -- offset in minutes
  anchor text NOT NULL CHECK (anchor IN ('before_end','after_start')),
  active boolean NOT NULL DEFAULT true
);
CREATE INDEX war_reminders_clan_idx ON war_reminders(guild_id, clan_tag);

-- Each detected war (one per clan per war)
CREATE TABLE wars (
  id bigserial PRIMARY KEY,
  guild_id text NOT NULL,
  clan_tag text NOT NULL,
  opponent_tag text NOT NULL,
  opponent_name text,
  team_size int,
  start_time timestamptz,        -- battle day start
  end_time timestamptz,
  state text NOT NULL,           -- 'preparation' | 'inWar' | 'warEnded'
  match_type text,               -- 'FWA' | 'Regular' | 'Unknown'
  decision text,                 -- 'win' | 'lose' | null (set by reps)
  decided_by text,
  decided_at timestamptz,
  result text,                   -- 'win' | 'lose' | 'tie' (final API result)
  our_stars int, opp_stars int,
  our_destruction numeric, opp_destruction numeric,
  rep_message_id text,
  result_message_id text,
  fired_reminders int[] DEFAULT '{}',     -- which reminders already sent
  war_started_msg_sent boolean DEFAULT false,
  result_posted boolean DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clan_tag, opponent_tag, start_time)
);
CREATE INDEX wars_active_idx ON wars(state) WHERE state <> 'warEnded';

-- Per-attack log + rule-break log
CREATE TABLE war_attacks (
  war_id bigint REFERENCES wars(id) ON DELETE CASCADE,
  attacker_tag text NOT NULL,
  attacker_name text,
  attacker_th int,
  attacker_map_pos int,
  defender_tag text,
  defender_map_pos int,
  stars int,
  destruction int,
  attack_order int,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (war_id, attacker_tag, attack_order)
);

CREATE TABLE war_rule_breaks (
  id bigserial PRIMARY KEY,
  war_id bigint REFERENCES wars(id) ON DELETE CASCADE,
  player_tag text NOT NULL,
  player_name text,
  rule text NOT NULL,            -- 'mirror_first' | 'window_first16' | 'window_last8'
  detail text,
  detected_at timestamptz NOT NULL DEFAULT now()
);

-- Cache of CoC linked players (refreshed periodically)
CREATE TABLE coc_links (
  player_tag text PRIMARY KEY,
  user_id text NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);

-- TH custom emoji map (admin-managed; one row per TH level)
CREATE TABLE th_emojis (
  th_level int PRIMARY KEY,
  emoji text NOT NULL              -- e.g. '<:th15:123456789>'
);
```

All tables get `ENABLE ROW LEVEL SECURITY` + `public read` policies (matching existing convention).

---

## New / edited edge functions

### New: `supabase/functions/war-poll/index.ts` (cron, every 10 min)

For every distinct `clan_tag` in `war_track_config`:

1. POST `coc-api` with `{ action: "current_war", tag }` (we add this action — see proxy section).
2. If `state === "notInWar"` → skip.
3. Lookup or insert a `wars` row keyed on `(clan_tag, opponent_tag, startTime)`.
4. **New war flow** (`rep_message_id IS NULL`):
   - Fetch `https://fwastats.com/Clan/<opp_tag_no_hash>/Wars.json`. If our clan tag appears in opponent's recent wars and is flagged FWA → `match_type='FWA'` else `'Regular'`.
   - Build the Reps embed (title, tags as hyperlinks to `https://link.clashofclans.com/?action=OpenClanProfile&tag=...`, war stats, roster lines using TH emoji from `th_emojis`).
   - Post to `rep_channel_id` with a string-select component `custom_id=war:decide:<war_id>` options Win/Lose. Save message id.
5. **Battle day flow** (`state='inWar'`):
   - Diff `attacks` vs stored `war_attacks`, insert new ones.
   - For each new attack, evaluate rules (see below) and insert `war_rule_breaks` if violated.
   - If `!war_started_msg_sent` and `now >= startTime` → post war-started embed to `log_channel_id`, set flag.
   - For each enabled `war_reminder` not in `fired_reminders` whose firing time has passed → post reminder embed (see format below) and append id.
6. **War ended flow** (`state='warEnded'` and `!result_posted`):
   - Snapshot final stars/destruction, decide `result`.
   - Build 2-page result embed + generate `.txt` log of all rule-breaks → upload via `createMessageWithFile` to `log_channel_id`.
   - Set `result_posted = true`.

### New: `supabase/functions/coc-link-sync/index.ts` (cron, every 6h)

For each player in `players` table, POST `coc-api` `{action:"get", type:"player", filters:{tag}}` and upsert `coc_links`. Used by reminders to mention linked Discord users.

### Edited: `supabase/functions/_shared/commands.ts`

Add three commands (admin-only by default):

- `/war_track_setup clan_tag rep_channel rep_role mail_channel mail_ping_role`
- `/setup_war_reminder clan_tag time_value time_unit anchor` (anchor = before_end | after_start; subcommands `add`, `remove`, `list`)
- `/setup_war_log_channel clan_tag channel`
- `/war_announcement clan_tag outcome:win|lose template` (set custom Win/Lose templates)

### Edited: `supabase/functions/discord-interactions/index.ts`

- Handlers for the 4 new commands above (write to `war_track_config` / `war_reminders`).
- New component handler for `custom_id` starting with `war:decide:`:
  - Verify caller has `rep_role_id` from config → else ephemeral deny.
  - Update `wars.decision`, post mail-room announcement using the saved Win/Lose template, pinging `mail_ping_role_id`.
  - Update the rep embed: disable the select, append "Decided: WIN by @user".

### Edited: `supabase/functions/_shared/coc.ts`

Add `fetchCurrentWar(tag)` → `postCoc({action:"current_war", tag})`. (We rely on the existing proxy supporting this; if not already, the proxy itself needs a one-line addition. Plan assumes the proxy owner adds `current_war` mapped to CoC `/clans/{tag}/currentwar`. If unavailable, fallback path: the proxy already exposes raw CoC data via `search_clan` — we'd ask you to confirm.)

### Edited: `supabase/config.toml`

```toml
[functions.war-poll]
verify_jwt = false

[functions.coc-link-sync]
verify_jwt = false
```

### pg_cron schedules (created via insert tool, not migration)

- `war-poll`: every 10 min
- `coc-link-sync`: every 6 hours

---

## Rule evaluation logic

Constants per war: `endTime`, `startTime`, `now`.
- `LAST8_START = endTime - 8h`
- `FIRST16_END = LAST8_START`

For each new attack (ordered by attack number per attacker, 1 or 2):

- **Mirror first attack** (1st attack only): `defender_map_pos == attacker_map_pos`?
  - WIN war: must also be 3⭐. If not mirror OR not 3⭐ → break `mirror_first` ("expected mirror 3-star").
  - LOSE war: must be mirror + 2⭐ → else break.
- **Window rules** (any attack performed in window):
  - WIN war: in first 16h require ≥2⭐ on any base; in last 8h require 3⭐.
  - LOSE war: 1⭐ in first 16h; 2⭐ in last 8h.
- Players who never attacked by `endTime` → break `missed_attack`.

Win vs Lose rule set is selected by `wars.decision` (set by reps). If reps haven't decided yet, war-poll defers rule evaluation and re-runs once decision is recorded.

---

## Embed formats

### Reps approval embed
Title: `<our_name> (<tag link>) VS <opp_name> (<tag link>)`
Fields: Match Type (`FWA`/`Regular`), War State, Ends `<t:...:R>`, War Stats (stars/dest/attacks), Composition (TH counts using emojis from `th_emojis`).
Component: select menu `Choose result` → Win/Lose.

### War-started + Reminder embed
```
⏰ {N}h reminder
{our_name} (#TAG) VS {opp_name} (#TAG)
⚔️ {attacks_left}/{total} | <th_emoji> {Player} | #PTAG {<@discord_id> if linked}
… one line per missing/incomplete attacker
```

### Result embed (page 1)
Title same as above. Match Type, Stars (ours vs opp), Destruction, War Result, "Is Rule followed 100%: Yes/No" with the tick/cross emojis you provided, counts of compliant vs violators.

### Result embed (page 2 — paginated button)
List of violators with the rule(s) they broke and timestamps.

### Result `.txt` attachment
```
War: <our_name> #TAG vs <opp> #TAG
Ended: 2026-05-01 18:00 IST
Result: WIN
---
[#PTAG] PlayerName
  - mirror_first: 1st attack hit position 7 (own pos 3), 2 stars (expected 3) at 2026-05-01 09:14 IST
  - window_last8: scored 2 stars in last 8h window (expected 3) at 2026-05-01 16:30 IST
...
```

---

## Multi-clan / multi-server scoping

Every config row, war row, reminder, and attack is keyed on `(guild_id, clan_tag)`. One server can run `/war_track_setup` multiple times for different clan tags, each pointing to its own rep/mail/log channels and roles. Permission gate (`canRunCommand`) reuses existing `command_permissions` system.

---

## File touch list

**New**
- `supabase/migrations/<ts>_war_tracking.sql`
- `supabase/functions/war-poll/index.ts`
- `supabase/functions/coc-link-sync/index.ts`
- `supabase/functions/_shared/war.ts` (rule eval, embed builders, fwastats verifier)
- `supabase/functions/_shared/th_emoji.ts` (TH lookup helper)

**Edited**
- `supabase/functions/_shared/commands.ts` (new slash commands)
- `supabase/functions/_shared/coc.ts` (`fetchCurrentWar`)
- `supabase/functions/discord-interactions/index.ts` (new handlers + select-menu component handler)
- `supabase/config.toml`

**Cron** (via insert tool, not migration)
- Schedule `war-poll` every 10 min
- Schedule `coc-link-sync` every 6h

---

## Things you'll need to provide after I build

1. **TH custom emoji IDs** — paste TH7–TH17 emoji strings; I'll insert into `th_emojis`. (Bot must share servers that host them, or use application emojis.)
2. **Confirm the coc-api proxy supports `{action:"current_war"}`** — if not, ask the proxy owner to add it (it just calls `/clans/{tag}/currentwar`). Without war data we cannot enforce rules.
3. (Optional) Default Win/Lose announcement templates — otherwise we ship sensible defaults that you can override via `/war_announcement`.

## Out of scope (revisit later)

- CWL (clan war league) — different API endpoint, complex roster.
- Friendly/Challenge wars.
- Web dashboard for war history (data is captured; UI later).
