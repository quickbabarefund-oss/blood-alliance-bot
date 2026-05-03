# Fix: granted role still can't see `/war_announcement`

## Root cause

In `supabase/functions/_shared/commands.ts`, admin-style commands are registered with:

```ts
default_member_permissions: ADMIN_ONLY  // = "0"
```

Discord interprets `"0"` as **"no permission bits required → only Administrators see it"**, and this is enforced **client-side before** any `/perm` override in our DB is consulted. So even after `/perm grant @ManagementTeam war_announcement`, members of that role do not see the command in the slash menu — exactly what the screenshot shows.

The previous round only removed `ADMIN_ONLY` from a few commands; `war_announcement` and most other admin commands still carry it.

## Fix

Remove `default_member_permissions: ADMIN_ONLY` from every command that is meant to be grantable via `/perm`. Backend access stays safe because `canRunCommand()` in `_shared/permissions.ts` still gates execution against `command_permissions` + admin bit.

Commands to unlock (drop the `default_member_permissions` line):

- `clan`, `global`
- `blacklist`, `whitelist`
- `refresh`
- `perm` *(keep admin-only — managing perms must stay admin)*
- `war_track_setup`, `setup_war_log_channel`, `setup_war_reminder`
- `war_announcement`
- `war_track_list`, `war_track_remove`
- `th_emoji`
- `war_resend_result`

Keep `ADMIN_ONLY` **only** on `/perm` itself (so non-admins can never grant themselves permissions).

## Steps

1. Edit `supabase/functions/_shared/commands.ts`: remove `default_member_permissions: ADMIN_ONLY` from all commands listed above; keep it on `perm`.
2. Redeploy `discord-register-global-commands` and trigger it to re-register the global command set (and wipe any per-guild duplicates).
3. Tell the user to **Ctrl+R** their Discord client; granted roles will now see the commands. Server admins who want to lock a specific command back to admins can still do it via *Server Settings → Integrations → Bot → Command*.

## Notes

- Backend permission check (`canRunCommand`) is unchanged, so unauthorized users invoking a command still get denied server-side.
- Global command propagation is usually near-instant for visibility changes but can take up to ~1 hour in rare cases.