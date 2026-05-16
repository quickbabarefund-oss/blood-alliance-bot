## Goal

A `/player_activity` command that summarises a player's recent activity across **today, last 7 days, last 30 days, and current month**, with optional `tag` (Family-clan autocomplete) or `user` (Discord mention) filter. When a mentioned user has multiple linked tags, the bot replies with an ephemeral select menu to pick one.  
  
Add Total stay days in a clan record   
Clan name (Tag) - xx Days

&nbsp;

## What gets tracked


| Signal                                                    | Source                                                                                                                 | Status          |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | --------------- |
| Donations / received                                      | `donation_snapshots`                                                                                                   | already tracked |
| War attacks (count, stars, ⭐avg, destruction avg, missed) | `war_attacks` + `wars.raw_roster`                                                                                      | already tracked |
| Multiplayer attack wins                                   | new column on `donation_snapshots` (`attack_wins`)                                                                     | **new**         |
| Defense wins                                              | new column on `donation_snapshots` (`defense_wins`) — captured but **hidden from report** per request                  | **new**         |
| Join / Leave events                                       | new `clan_member_events` table, written by `poll-clans` via roster diff                                                | **new**         |
| Activity events / last-seen                               | new `player_activity_events` table, derived in `poll-clans` whenever any tracked counter changes between two snapshots | **new**         |


Defense wins are stored for future use but never shown (you said ignore).

## New command

```
/player_activity
  tag?    String  (Family-clan-style autocomplete over known player tags)
  user?   User    (resolves via coc_links)
```

- No date option (per your choice). One embed shows Today / 7d / 30d / This-month columns.
- Tag and user both omitted → uses the invoker's own linked tag (error if none).
- User with **>1 linked tag** → ephemeral message with a string-select component listing each tag + player name; on submit, the embed is sent.
- Tag provided → used directly (case/`O→0` normalised via existing `normalizeTag`).

### Report layout (single embed)

```
👤 PlayerName  TH15  #ABC123
Clan: INDIAN FIGHTERS #XYZ  •  Linked to @user (if any)

🕒 Active today:  7 events  •  last active 14m ago
                  (window 09:12 → 22:40 IST)

           Today    7d      30d     Month
Donated    320      4,210   18,900  12,400
Received   80       1,100   5,200   3,800
Ratio      4.00     3.83    3.63    3.26
Atk wins   3        21      88      60
War atks   1/2      4/6     12/18   8/12
War ⭐avg  3.0      2.5     2.4     2.4
Missed     0        2       6       4

🔁 Clan moves (30d):
  • Joined  INDIAN FIGHTERS  May 04
  • Left    悠揚之風          May 03
```

### "Activity event" definition

On each poll cycle, if **any** of these change vs the previous snapshot for a player, write one row to `player_activity_events` (timestamp = poll time):

- `donations`, `donations_received`, `attack_wins`, `defense_wins` (defense triggers an event but is otherwise hidden)
- A new `war_attacks` row counts as an event (already timestamped)
- Roster join/leave counts as an event

`last_active_at` = `max(event_at)`. "Active today" = events since 00:00 IST.

## New companion commands (small, related)

- `/player_joins` — list of join/leave events for a tag or user, last 30 days. (Useful on its own; reuses the new table.)

I'm intentionally **not** adding a separate "activity leaderboard" command yet — say the word and I'll add `/active_top` per-clan later.

---

## Technical section

### Migration

```sql
ALTER TABLE public.donation_snapshots
  ADD COLUMN attack_wins  integer NOT NULL DEFAULT 0,
  ADD COLUMN defense_wins integer NOT NULL DEFAULT 0;

CREATE TABLE public.clan_member_events (
  id bigserial PRIMARY KEY,
  clan_tag   text NOT NULL,
  player_tag text NOT NULL,
  player_name text,
  event      text NOT NULL CHECK (event IN ('join','leave')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.clan_member_events (player_tag, occurred_at DESC);
CREATE INDEX ON public.clan_member_events (clan_tag, occurred_at DESC);

CREATE TABLE public.player_activity_events (
  id bigserial PRIMARY KEY,
  player_tag text NOT NULL,
  clan_tag   text,
  kind text NOT NULL,   -- 'donation' | 'receive' | 'attack' | 'defense' | 'war_attack' | 'join' | 'leave'
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON public.player_activity_events (player_tag, occurred_at DESC);

ALTER TABLE public.clan_member_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_activity_events   ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read clan_member_events"     ON public.clan_member_events     FOR SELECT USING (true);
CREATE POLICY "public read player_activity_events" ON public.player_activity_events FOR SELECT USING (true);
```

Extend `prune_old_snapshots` to also delete `player_activity_events` older than 60 days and `clan_member_events` older than 180 days.

### `poll-clans` changes

After fetching each clan's `memberList`:

1. Read previous snapshot row per player.
2. Insert new `donation_snapshots` row including `attack_wins`/`defense_wins` from `member.attackWins` / `member.defenseWins`.
3. For each deltas > 0 → insert into `player_activity_events`.
4. Diff previous `memberList` vs current → insert `clan_member_events` rows and matching activity events.

### `discord-interactions` changes

- New `player_activity` slash handler (registered in `_shared/commands.ts`, also in global registrar).
- Autocomplete on `tag` reuses the existing Family-clan/player-tag autocomplete pattern (search `players` by name/tag, prefer Family clans' members).
- Multi-link resolution: when `user` resolves to ≥2 rows in `coc_links`, return a `MESSAGE_COMPONENT` ephemeral with a `STRING_SELECT`; on `MESSAGE_COMPONENT` callback (custom_id `pa_pick:<userId>`), build and send the embed.
- Aggregations done as 4 small `read_query`-style calls (today/7d/30d/this-month) using `istMonthKey()` for the month bucket and IST midnight for "today".
- `/player_joins` shares the same resolution helper.

### Files touched

- `supabase/migrations/<new>.sql` — schema above
- `supabase/functions/_shared/commands.ts` — add `player_activity`, `player_joins`
- `supabase/functions/discord-register-global-commands/index.ts` — picks up new commands automatically (uses `COMMANDS`)
- `supabase/functions/discord-interactions/index.ts` — new handlers + select-menu component handler + autocomplete
- `supabase/functions/poll-clans/index.ts` — snapshot new columns, write events, diff rosters
- `supabase/functions/_shared/coc.ts` — extend `CoCMember` interface with `attackWins`, `defenseWins`

### Deploy

`poll-clans`, `discord-interactions`, `discord-register-global-commands`.

---

### Caveats I want to flag

- **No historical activity / no historical joins.** Both new tables start empty; the first 7-day/30-day views will fill in as polls run.
- "Active time" is approximate at poll cadence (~hourly). Reported as event count + last-seen, never as "X hours online".
- War attack counts are accurate only for wars the bot saw (rep-approved wars in `wars` table).