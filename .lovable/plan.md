# War Tracker — Plan

## 1. New `/war_tracker` slash command + public web page

Mirror the `/discord_link` pattern: slash command replies with a link to a hosted page that loads live data by clan tag.

**Discord side**

- New global command `/war_tracker` with optional `clan` arg (defaults to first tracked clan in the guild). When invoked, posts an ephemeral embed with a "🛡️ Open War Tracker" link button → `https://clan-loot-tracker.lovable.app/war/<clanTag>`.
- Registered in `_shared/commands.ts`, handled in `discord-interactions/index.ts`.

**Web page (`/war/:clanTag`)**
Single React page styled to match the uploaded screenshots:

- Header: "WAR TRACKER · SLACKER ALERT", gold/yellow display font on a dark CoC-themed background.
- Top: tag input + "🔍 Check War" button (preloads from URL param).
- Tabs: **Live Intel**, **War Room**, **War Debrief**, **Clan Overview**.
- **Live Intel** — current war card (state, our/opp stars + destruction + attacks N/100), countdown, War Momentum bar (color-graded), Win Probability %, Priority Targets count, Live Feed of attacks (timestamp, attacker, stars, destruction, CLUTCH/RISKY badges).
- **War Room** — roster (TH, map pos, used 0/2/1/2/2/2), mirror suggestions, who still owes attacks, last-8h cleanup queue.
- **War Debrief** — last completed war: result, stars, destruction, violations grouped by player (uses same rule engine).
- **Clan Overview** — clan badge, members, recent war history, win/loss streak.

**Data sources**

- New edge function `war-tracker-api` (verify_jwt = false) with actions: `live`, `room`, `debrief`, `overview`. Pulls from `wars`, `war_attacks`, `war_rule_breaks` and live `current_war` via the existing CoC proxy.
- Win probability: simple heuristic — `0.5 + 0.5 * (starsDiff / (teamSize*3)) + 0.2 * (destructionDiff/100)` clamped 5–95%.
- Momentum: `(ourRecentStars - oppRecentStars) / max` over last 6 attacks → 0–100%.
- CLUTCH = 3⭐ on a mirror or higher; RISKY = stars < 2 outside cleanup window.

## 2. Rule engine updates (`_shared/war.ts → evaluateRules`)  
  
Apply in WIn War and -1 stars in Lose war in all situations

Add an `is16hWindow` concept: first 16h of battle day = `[startTime, startTime + 16h)`; last-8h cleanup unchanged.

- **early_cleanup**: only report when the 2nd attack lands **before** the last-8h window **AND** stars < 3. A 3⭐ early second hit is **fine** (loot/cleanup safe). 1⭐/2⭐ early second → still a break.
- **low_stars** (2nd attack): trigger only outside the cleanup window with stars < 2, and skip if the same attack already produced an `early_cleanup` break (no double-report).
- **mirror_first**: keep the rule, but always append the attack window in the detail string:  `— attacked in first-16h` or  `— attacked in last-8h cleanup`. Wording becomes e.g. `1st attack should mirror own #34 for 3⭐ — hit #1 for 3⭐ (last-8h cleanup)`.
- Add `attack_window` field to each `RuleBreak` for the UI to color-tag.

## 3. Discord message cut-off fix

`buildResultEmbeds` currently truncates the violators list with `.slice(0, 4000)`. Discord embed description max is 4096, but the full final-result post is sent as a single embed → long wars overflow.

- Split violators into multiple embeds of ≤ 3800 chars each (page 2, 3, 4 …) with paginated footers.
- `war-poll/index.ts` already calls `createMessageWithFile` once; switch to sending the file once, then follow-up `createMessage` calls for any extra violation pages so nothing is dropped.

## 4. Custom per-clan rules

New table `clan_war_rules` (guild_id, clan_tag, key, value):


| key                              | default          | meaning                                                      |
| -------------------------------- | ---------------- | ------------------------------------------------------------ |
| `cleanup_window_hours`           | 8                | size of cleanup window from war end                          |
| `first_window_hours`             | 16               | size of "early" window from war start                        |
| `early_min_stars`                | 3                | min stars for an early 2nd hit to NOT break early_cleanup    |
| `low_star_min_2nd`               | 2                | required stars on 2nd attack outside cleanup                 |
| `mirror_first_enabled`           | true             | enforce 1st attack on mirror                                 |
| `mirror_first_min_stars`         | 3 (win)/2 (lose) | min stars on mirror                                          |
| `report_first_window_only_3star` | true             | when true, only report 3⭐-related issues during first window |


- `evaluateRules` accepts an optional `rules` map and falls back to defaults.
- `war-poll` loads rules per `(guild_id, clan_tag)` before evaluating.
- Web page gets a small "Rules" editor in **Clan Overview** for admins (guarded by existing permission check) → writes to `clan_war_rules`.

## Technical Notes

- Files touched: `_shared/commands.ts`, `_shared/war.ts`, `_shared/discord.ts` (paginated follow-ups), `discord-interactions/index.ts`, `war-poll/index.ts`, new `war-tracker-api/index.ts`, new pages `src/pages/WarTracker.tsx` (+ sub-tab components), route added in `src/App.tsx`.
- DB migration: create `clan_war_rules` with public read RLS and no public write (admin writes via edge function with service key).
- Page is public read (matches existing leaderboard pages). Edits require Discord-verified token (reuse `embed_edit_tokens` pattern, issued by the slash command).
- No changes to auth model; everything keyed by `guild_id` + `clan_tag` as today.

## Suggested build order

1. Migration for `clan_war_rules`.
2. Rule engine changes + message pagination (fixes the cut-off and 3⭐ false positives immediately).
3. `war-tracker-api` edge function.
4. `/war_tracker` slash command + page link.
5. React `WarTracker` page with the 4 tabs.
6. Admin rules editor on **Clan Overview** tab.

Confirm and I'll start with steps 1–3 (the bug-fix and rules backend) so reports stop breaking, then build the page.