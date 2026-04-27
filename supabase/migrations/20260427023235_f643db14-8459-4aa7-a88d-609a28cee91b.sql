
ALTER TABLE public.clans ADD COLUMN IF NOT EXISTS guild_id TEXT;
ALTER TABLE public.discord_config ADD COLUMN IF NOT EXISTS guild_id TEXT;

UPDATE public.clans SET guild_id = COALESCE(guild_id, '__legacy__') WHERE guild_id IS NULL;
UPDATE public.discord_config SET guild_id = COALESCE(guild_id, '__legacy__') WHERE guild_id IS NULL;

ALTER TABLE public.clans ALTER COLUMN guild_id SET NOT NULL;
ALTER TABLE public.discord_config ALTER COLUMN guild_id SET NOT NULL;

-- Drop FK from players → clans so we can re-key clans
ALTER TABLE public.players DROP CONSTRAINT IF EXISTS players_current_clan_tag_fkey;

ALTER TABLE public.clans DROP CONSTRAINT IF EXISTS clans_pkey;
ALTER TABLE public.clans ADD PRIMARY KEY (guild_id, tag);

ALTER TABLE public.discord_config DROP CONSTRAINT IF EXISTS discord_config_pkey;
ALTER TABLE public.discord_config ADD PRIMARY KEY (guild_id, key);

CREATE INDEX IF NOT EXISTS clans_guild_idx ON public.clans(guild_id);
CREATE INDEX IF NOT EXISTS clans_tag_idx ON public.clans(tag);

CREATE TABLE IF NOT EXISTS public.command_permissions (
  guild_id TEXT NOT NULL,
  command  TEXT NOT NULL,
  role_id  TEXT NOT NULL,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, command, role_id)
);
ALTER TABLE public.command_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read command_permissions" ON public.command_permissions FOR SELECT USING (true);

CREATE TABLE IF NOT EXISTS public.guilds (
  guild_id TEXT PRIMARY KEY,
  name TEXT,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  commands_synced_at TIMESTAMPTZ
);
ALTER TABLE public.guilds ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read guilds" ON public.guilds FOR SELECT USING (true);
