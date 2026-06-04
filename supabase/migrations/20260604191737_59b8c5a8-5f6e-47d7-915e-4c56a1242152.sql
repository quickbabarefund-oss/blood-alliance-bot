
-- War callers: target assignments for the active war
CREATE TABLE public.war_callers (
  id            BIGSERIAL PRIMARY KEY,
  guild_id      TEXT NOT NULL,
  clan_tag      TEXT NOT NULL,
  war_start_time TIMESTAMPTZ,
  attacker_tag  TEXT NOT NULL,
  attacker_name TEXT,
  defender_tag  TEXT,
  defender_name TEXT,
  defender_pos  INTEGER,
  set_by        TEXT,
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX war_callers_unique
  ON public.war_callers (guild_id, clan_tag, attacker_tag);
CREATE INDEX war_callers_clan_idx
  ON public.war_callers (guild_id, clan_tag);

GRANT SELECT ON public.war_callers TO anon, authenticated;
GRANT ALL ON public.war_callers TO service_role;
ALTER TABLE public.war_callers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read war_callers" ON public.war_callers FOR SELECT USING (true);

-- Recently used clan tags (manually typed) per guild
CREATE TABLE public.recent_clan_tags (
  guild_id     TEXT NOT NULL,
  clan_tag     TEXT NOT NULL,
  clan_name    TEXT,
  use_count    INTEGER NOT NULL DEFAULT 1,
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, clan_tag)
);
CREATE INDEX recent_clan_tags_recent_idx
  ON public.recent_clan_tags (guild_id, last_used_at DESC);

GRANT SELECT ON public.recent_clan_tags TO anon, authenticated;
GRANT ALL ON public.recent_clan_tags TO service_role;
ALTER TABLE public.recent_clan_tags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read recent_clan_tags" ON public.recent_clan_tags FOR SELECT USING (true);
