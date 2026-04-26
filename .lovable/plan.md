## Root cause

The 5-min poller IS running (confirmed: `poll_runs` shows successful polls every 5 min for all clans). The data is fine. **But every Discord post fails** with:

```
COMPONENT_CUSTOM_ID_DUPLICATED — Component custom id cannot be duplicated
```

In `supabase/functions/_shared/embeds.ts` → `navButtons()`, when a leaderboard has only one page (or is on page 0), the First/Prev/Next/Last buttons all resolve to the same `custom_id` (e.g. all become `lb:clan:#TAG:0`). Discord rejects the whole message — so:

- No new message is created → `leaderboard_message_id` stays `NULL`
- Each subsequent poll tries to create again → fails again
- The one clan that *did* get a message earlier (`#CYQVL002`) now hits a 404 ("Unknown Message") on edit because that message was deleted, then falls back to create → also fails with the same duplicate-id error

## Fix

### 1. `supabase/functions/_shared/embeds.ts` — make every button's `custom_id` unique

Rewrite `navButtons` so each of the 5 buttons has a distinct id regardless of page/totalPages. Use semantic action names instead of target page numbers:

- `${prefix}:first`
- `${prefix}:prev:${page}`   (encode current page so handler can compute page-1)
- `${prefix}:noop`            (the page indicator)
- `${prefix}:next:${page}`
- `${prefix}:last`

This guarantees uniqueness even when totalPages=1.

### 2. `supabase/functions/discord-interactions/index.ts` — update the button handler

Update the `MESSAGE_COMPONENT` (type 3) handler to parse the new id format:

- `lb:clan:<TAG>:first` → page 0
- `lb:clan:<TAG>:prev:<n>` → page max(0, n-1)
- `lb:clan:<TAG>:next:<n>` → page n+1 (clamped in builder via `safePage`)
- `lb:clan:<TAG>:last` → pass a very large page; builder already clamps to `totalPages-1`
- `lb:global:...` → same patterns
- `:noop` → ignore (return type 6 DEFERRED_UPDATE_MESSAGE or just ignore)

### 3. Self-heal stale `leaderboard_message_id`

In `_shared/discord.ts` → `upsertLeaderboardMessage`: if `editMessage` returns 404 (Unknown Message), fall through to `createMessage` AND signal the caller so `leaderboard.ts` clears/updates the stored id. Already partially done — just confirm the flow returns the new id and that `refreshAllDiscordMessages` writes it back (it does).

### 4. Clean up the malformed clan row

The `clans` table contains a bad row: `tag = "#(#YQGQQYGV"` (extra `(#` typo). It pollutes polling and discord refresh. After approval I'll run a migration to delete it (and let the user re-add via the proper command if desired).

### 5. Redeploy

Deploy `poll-clans` and `discord-interactions`. Within ~5 minutes, every active clan channel will get its embed, and the global channel will too. Pagination buttons will work.

## Out of scope

- Web UI changes (the global leaderboard table already works correctly per network logs)
- Changing the embed visual format

## Verification after deploy

1. Trigger `poll-clans` once manually to avoid waiting 5 min
2. Check `clans.leaderboard_message_id` and `discord_config.global_message_id` become populated
3. Confirm no `COMPONENT_CUSTOM_ID_DUPLICATED` errors in `poll-clans` logs
4. Click pagination buttons in Discord to confirm `discord-interactions` updates the message