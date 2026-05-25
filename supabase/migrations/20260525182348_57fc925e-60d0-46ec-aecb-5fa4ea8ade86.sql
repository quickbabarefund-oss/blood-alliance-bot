
CREATE TABLE IF NOT EXISTS public.clan_war_rules (
  guild_id   text NOT NULL,
  clan_tag   text NOT NULL,
  key        text NOT NULL,
  value      text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by text,
  PRIMARY KEY (guild_id, clan_tag, key)
);

ALTER TABLE public.clan_war_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read clan_war_rules"
ON public.clan_war_rules
FOR SELECT
USING (true);

CREATE INDEX IF NOT EXISTS idx_clan_war_rules_clan
  ON public.clan_war_rules (guild_id, clan_tag);
