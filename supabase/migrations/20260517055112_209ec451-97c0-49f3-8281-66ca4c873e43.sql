CREATE TABLE public.disabled_commands (
  guild_id text NOT NULL,
  command text NOT NULL,
  disabled_by text,
  disabled_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, command)
);

ALTER TABLE public.disabled_commands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read disabled_commands"
  ON public.disabled_commands FOR SELECT
  USING (true);