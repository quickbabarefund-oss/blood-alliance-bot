## Add "active time" tracking to `/player_activity`

### Definition

A **session** is a run of consecutive `player_activity_events` for the player where each event is ≤ **10 minutes** after the previous one. A gap > 10 min closes the session (player considered offline). Session duration = `lastEvent - firstEvent` of that session. A lone event = 0 duration (we only saw one ping).

Active time for a bucket = sum of session durations whose events fall in the bucket window.
Avg/day = total active time ÷ number of days in bucket.

Caveat: poll cadence is ~5 min, so this is a lower-bound approximation of real online time — labelled as "approx" in the footer.

### Where it shows

1. **Summary line** under the existing "Active today" line:
   `⏱️ Approx active time today: 1h 23m  •  avg/day 7d: 48m  •  30d: 41m`

2. **New row in the bucket table** (`hh:mm` format):
   ```
              Today    7d      30d     Month
   Donated    …
   ...
   Active     1h23m    5h36m   21h10m  18h42m
   ```

### Technical changes

- **`supabase/functions/_shared/player_activity.ts`**
  - Add `computeActiveTime(playerTag, sinceIso, untilIso?)` that queries `player_activity_events` in the window (ordered asc), walks them, splits into sessions on >10 min gaps, returns total ms + session count.
  - Add a small `fmtDur(ms)` (`Xh Ym` or `Ym` or `0m`).
  - In `buildPlayerActivity`, compute active time for Today / 7d / 30d / Month in parallel.
  - Compute avg/day = total ÷ {1, 7, 30, daysElapsedInMonth}.
  - Add the `Active` row to the table and the new summary line under "Active today".

- **`buildPlayerJoins`** — unchanged.
- **No DB migration** needed (uses existing `player_activity_events`).
- **No `poll-clans` change** needed.

### Out of scope

- "Real" minute-by-minute online detection (CoC API does not expose it).
- Backfill — only events captured going forward count.