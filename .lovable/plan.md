## Goal
Make the FWA Points verdict visible everywhere a war is shown, and fix the reason `/current_war` says "verdict not yet posted" — `points.fwafarm.com` is behind a Cloudflare bot challenge, so our edge fetch (with a `ValkonWarBot` UA) is being served the JS-challenge page instead of the real HTML, so `winner-box` never matches.

## Changes

### 1. Fix the FWA Points fetch (`supabase/functions/_shared/fwa_points.ts`)
- Send realistic browser headers so Cloudflare lets us through:
  `User-Agent: Mozilla/5.0 ... Chrome/124 Safari/537.36`, `Accept: text/html,...`, `Accept-Language: en-US,en;q=0.9`, `Referer: https://points.fwafarm.com/`, `Sec-Fetch-*` headers.
- Detect a challenge response (HTML contains `Just a moment` / `cf_chl_opt` / no `winner-box`) and log a clear `"fwa points: cloudflare challenge"` line, return `null` with a typed reason so callers can show "blocked" vs "no verdict yet".
- Add a short in-memory cache (5 min, keyed by clan tag) so we don't hammer fwafarm for every poll + every `/current_war`.
- Extend the return shape with `winCalculatorUrl` and `warId` already-extracted so embeds can deep-link.

### 2. Persist the verdict on the war row
Add new columns to `public.wars` so the verdict is shown even if fwafarm is temporarily blocked:
- `fwa_decision text` (`win` | `lose`)
- `fwa_reason text`
- `fwa_winner_name text`
- `fwa_winner_tag text`
- `fwa_war_id text`
- `fwa_checked_at timestamptz`

`war-poll` writes these whenever `fetchFwaRecommendation` succeeds (in both preparation and battle day), independent of the auto-decision logic. Auto-decision still only fires on battle day when `decision` is unset, exactly like today.

### 3. Show FWA Verdict on the Reps approval embed (`_shared/war.ts` → `buildRepsPayload`)
Add a new field (only when `matchType === "FWA"`):
- ✅ Verdict known →
  `🍫 FWA Verdict` : `🏆 WIN — points (10 > 6)` + `[Win Calculator ↗](https://points.fwafarm.com/clan?tag=...)`
- ⏳ Not posted yet → `_FWA match — verdict not yet posted on points.fwafarm.com_`
- 🛑 Cloudflare blocked us → `_Could not reach points.fwafarm.com (rate limited) — will retry_`

`war-poll` calls `editMessage` to refresh the reps embed when the verdict first appears, so an embed posted in preparation gets updated once fwafarm publishes the verdict.

### 4. Update `/current_war` (`_shared/coc_commands.ts`)
Use the cached/persisted verdict from `wars` first, fall back to a live fetch. Same three-state field text as above so "blocked" and "not yet posted" are no longer confused.

### 5. Show decision + FWA verdict on the War UI (`src/pages/WarTracker.tsx`)
The current page already lists wars from the `wars` table. Add two columns / badges to each war row:
- **Strategy** — `WIN` / `LOSE` / `MISS` badge from `wars.decision` (with "auto-fwa" / "manual" tag from `decided_by`), or `—` if unset.
- **FWA Verdict** — `🏆 WIN` / `🏳️ LOSE` badge from `wars.fwa_decision` with `fwa_reason` as tooltip, link icon to the Win Calculator. Shown only for `match_type = 'FWA'`.

No other UI restructuring.

### 6. Re-deploy edge functions
`war-poll`, `discord-interactions`, `war-tracker-api` (the last reads `wars` and must surface the new columns).

## Technical notes
- New columns are nullable + default `null`, so no backfill needed.
- The Reps embed update on verdict-arrival reuses `buildRepsPayload` and `editMessage`; buttons row is preserved by passing `components: [buildDecisionButtons(war.id)]`.
- `WarTracker.tsx` reads `wars` via the existing supabase client — RLS for `wars` is `deny all client access`, so reads go through `war-tracker-api`; add `fwa_*` and `decision`/`decided_by` to the response shape there.
- No new secrets, no schema breakage.
