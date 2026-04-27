# Per-command roles, multi-server, monthly reset, dev/prod split

## Overview
Four upgrades to the Discord bot:
1. **Per-command role permissions** — Discord-native defaults + DB overrides via `/perm`
2. **Multi-server (per-guild) scoping** for clans, global config, and permissions
3. **Auto-sync slash commands** on new servers (global registration + lazy on-join guild sync)
4. **Monthly reset** with `.xlsx` archive posted to leaderboard channels + separate **Dev / Prod** Lovable Cloud projects

---

## 1. Database changes (migration)

```sql
ALTER TABLE clans ADD COLUMN guild_id text;
ALTER TABLE discord_config ADD COLUMN guild_id text;
CREATE INDEX clans_guild_idx ON clans(guild_id);

-- Same clan can be tracked in multiple guilds
ALTER TABLE clans DROP CONSTRAINT clans_pkey;
ALTER TABLE clans ADD PRIMARY KEY (guild_id, tag);

ALTER TABLE discord_config DROP CONSTRAINT discord_config_pkey;
ALTER TABLE discord_config ADD PRIMARY KEY (guild_id, key);

CREATE TABLE command_permissions (
  guild_id text NOT NULL,
  command  text NOT NULL,
  role_id  text NOT NULL,
  PRIMARY KEY (guild_id, command, role_id)
);
ALTER TABLE command_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read command_permissions" ON command_permissions FOR SELECT USING (true);

CREATE TABLE guilds (
  guild_id text PRIMARY KEY,
  name text,
  joined_at timestamptz NOT NULL DEFAULT now(),
  commands_synced_at timestamptz
);
ALTER TABLE guilds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read guilds" ON guilds FOR SELECT USING (true);
```
Backfill `guild_id` on existing rows with current `DISCORD_GUILD_ID`.

## 2. Permissions: Discord-native + DB overrides

In `discord-register-commands`:
- Add `default_member_permissions: "0"` (admin-only by default) on mutating commands (`clan`, `global`, `blacklist add/remove`, `whitelist add/remove`, `refresh`, `perm`). Server admins loosen via Server Settings → Integrations.
- Read-only commands (`top`, `lowest`, `player`, `profile`, `*list*`) stay open.

New `/perm` command:
```
/perm grant <command> <role>
/perm revoke <command> <role>
/perm list
```

Replace `hasManagerRole(member)` with `canRunCommand(guildId, command, member)`:
1. If `command_permissions` rows exist for `(guild_id, command)` → allow when member's roles intersect.
2. Else fall back to `DISCORD_MANAGER_ROLE_IDS`.
3. Else allow if member has ADMINISTRATOR permission bit.

## 3. Multi-server scoping

Every handler reads `interaction.guild_id` and scopes queries:
- `handleClan`, `handleGlobal`, `/perm` → keyed by `guild_id`.
- `/blacklist` and `/whitelist` stay alliance-wide for simplicity.
- `refreshAllDiscordMessages()` iterates all guilds' clans + global configs.
- `poll-clans` polls each unique `tag` once but writes leaderboard messages per `(guild_id, tag)` channel binding.

## 4. Command sync to new servers

**Global registration** (baseline, ~1h propagation):
- New endpoint `discord-register-global-commands` PUTs to `/applications/{app}/commands`. Run once after deploy.

**On-join instant sync** (interactions-only, no gateway):
- When any interaction arrives from a guild not in `guilds`, fire-and-forget `PUT /applications/{app}/guilds/{guild_id}/commands` so subsequent commands work instantly. Insert the guild row with `commands_synced_at`.
- Gateway-based GUILD_CREATE isn't feasible in serverless edge functions — lazy sync is the standard pattern for interactions-only bots.

## 5. Monthly reset + xlsx archive

New scheduled function `monthly-reset` (cron on the 1st of month, IST):
1. Compute previous `month_key` (IST).
2. For each `guild_id`:
   - For each tracked clan + the global view: query `monthly_aggregates`, apply blacklist filter, sort by donations desc.
   - Build `.xlsx` via `npm:exceljs` — columns: Rank | Clan | Player | Tag | Donated | Received | Ratio.
   - Post to the leaderboard channel via `POST /channels/{id}/messages` with `multipart/form-data` attachment + summary embed ("📊 Final standings — <Month> <Year>").
3. Clear `leaderboard_message_id` on `clans` rows and `discord_config.global_message_id` for that guild → next `poll-clans` posts a fresh leaderboard for the new month.
4. Optional: snapshot xlsx into a `monthly-archives/` Storage bucket for the web dashboard.

Add cron entry in `supabase/config.toml`. Support `?dry_run=1` to preview.

## 6. Dev / Prod environments

Lovable Cloud is 1:1 per project. Approach:
- User **Remixes** this project to create **clan-loot-tracker-dev** — separate Cloud (DB, edge functions, secrets) sharing the codebase for easy sync.
- Create a **second Discord application** (test bot) installed in a test server.
- Set dev secrets: `DISCORD_APPLICATION_ID`, `DISCORD_PUBLIC_KEY`, `DISCORD_BOT_TOKEN`, `COC_PROXY_*`.
- Add `DISCORD_ENV` secret (`"dev" | "prod"`); embed footers display `Env: dev` to prevent confusion.
- Point the dev Discord app's interactions URL at the dev project's `discord-interactions` function.
- README gets a "Dev / Prod setup" section.

(Lovable has no built-in stage/prod toggle — two projects is the canonical pattern.)

## 7. Files touched

**New**
- `supabase/migrations/<ts>_multi_guild_and_perms.sql`
- `supabase/functions/monthly-reset/index.ts`
- `supabase/functions/discord-register-global-commands/index.ts`
- `supabase/functions/_shared/permissions.ts`
- `supabase/functions/_shared/xlsx.ts`

**Edited**
- `supabase/functions/discord-interactions/index.ts` (guild scoping, lazy sync, `/perm`, perm checks)
- `supabase/functions/discord-register-commands/index.ts` (`default_member_permissions`, `/perm`)
- `supabase/functions/_shared/leaderboard.ts` (iterate all guilds)
- `supabase/functions/poll-clans/index.ts` (poll unique tags, fan-out per guild)
- `supabase/config.toml` (cron)
- `README.md` (dev/prod doc)

## 8. Verification
- Trigger `discord-register-global-commands` → 200.
- In a 2nd test server, run `/clan list` → bot auto-syncs guild commands and responds.
- `/perm grant clan @SomeRole` → verify non-manager with that role can `/clan add`.
- Invoke `monthly-reset?dry_run=1` to preview xlsx without clearing message IDs.

## 9. Out of scope (revisit if needed)
- Per-guild blacklist/whitelist (kept alliance-wide).
- Web dashboard guild switcher.
- Migrating existing leaderboard messages — old ones get replaced on next refresh after backfill.