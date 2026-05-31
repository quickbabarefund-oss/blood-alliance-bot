ALTER TABLE public.wars
  ADD COLUMN IF NOT EXISTS fwa_decision text,
  ADD COLUMN IF NOT EXISTS fwa_reason text,
  ADD COLUMN IF NOT EXISTS fwa_winner_name text,
  ADD COLUMN IF NOT EXISTS fwa_winner_tag text,
  ADD COLUMN IF NOT EXISTS fwa_war_id text,
  ADD COLUMN IF NOT EXISTS fwa_checked_at timestamptz;