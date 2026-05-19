CREATE TABLE IF NOT EXISTS public.family_dashboard_layout (
  guild_id text PRIMARY KEY,
  stats_position integer NOT NULL DEFAULT 9999,
  stats_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.family_dashboard_layout ENABLE ROW LEVEL SECURITY;

CREATE POLICY "public read family_dashboard_layout"
ON public.family_dashboard_layout FOR SELECT
USING (true);