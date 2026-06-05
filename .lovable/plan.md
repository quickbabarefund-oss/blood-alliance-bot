## Plan

1. Fix command visibility in Discord
- Update the command registration flow so the latest slash commands are definitely deployed to Discord.
- Make `/force_reset` also refresh global commands, not only clear stale guild command copies.
- Keep the existing flat commands (`/cwl_roster`, `/remaining`, `/lineup`, `/current_cwl_war`, etc.) so users do not need to learn a new structure.

2. Fix `/cwl_roster` stuck on “thinking”
- Change the CWL roster response path so it sends an immediate lightweight response, then posts roster pages as follow-up messages.
- Split large CWL roster output into Discord-safe chunks instead of trying to send one oversized response.
- Add a hard timeout/fallback so Discord always receives either roster output or a clear error message.

3. Harden CWL API calls
- Replace the current fake timeout (`Promise.race` without aborting the fetch) with real `AbortController` timeout support in the CoC proxy helper.
- Apply that real timeout to `cwl_group` and `cwl_war` calls.
- Keep the 5-minute CWL cache, but make failure messages user-friendly.

4. Deploy and verify
- Deploy the changed edge functions.
- Re-run global command registration after deployment.
- Check backend logs for `discord-interactions` and registration errors.

## Technical notes

- Main files: `supabase/functions/_shared/coc.ts`, `supabase/functions/_shared/coc_commands.ts`, `supabase/functions/discord-interactions/index.ts`, and possibly `supabase/functions/discord-register-global-commands/index.ts`.
- No frontend changes are needed.
- No new database table is needed for this fix.