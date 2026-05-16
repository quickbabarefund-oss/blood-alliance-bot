ALTER TABLE public.donation_snapshots
  ADD COLUMN IF NOT EXISTS attack_wins  integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS defense_wins integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS public.clan_member_events (
  id bigserial PRIMARY KEY,
  clan_tag    text NOT NULL,
  player_tag  text NOT NULL,
  player_name text,
  event       text NOT NULL CHECK (event IN ('join','leave')),
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clan_member_events_player_idx ON public.clan_member_events (player_tag, occurred_at DESC);
CREATE INDEX IF NOT EXISTS clan_member_events_clan_idx   ON public.clan_member_events (clan_tag,   occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.player_activity_events (
  id bigserial PRIMARY KEY,
  player_tag text NOT NULL,
  clan_tag   text,
  kind       text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS player_activity_events_player_idx ON public.player_activity_events (player_tag, occurred_at DESC);

ALTER TABLE public.clan_member_events     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.player_activity_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public read clan_member_events"     ON public.clan_member_events;
DROP POLICY IF EXISTS "public read player_activity_events" ON public.player_activity_events;
CREATE POLICY "public read clan_member_events"     ON public.clan_member_events     FOR SELECT USING (true);
CREATE POLICY "public read player_activity_events" ON public.player_activity_events FOR SELECT USING (true);

CREATE OR REPLACE FUNCTION public.prune_old_snapshots()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.donation_snapshots     WHERE captured_at < now() - INTERVAL '60 days';
  DELETE FROM public.poll_runs              WHERE started_at < now() - INTERVAL '14 days';
  DELETE FROM public.player_activity_events WHERE occurred_at < now() - INTERVAL '60 days';
  DELETE FROM public.clan_member_events     WHERE occurred_at < now() - INTERVAL '180 days';
END;
$$;