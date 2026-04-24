
-- Clans registered for tracking
CREATE TABLE public.clans (
  tag TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  badge_url TEXT,
  member_count INT NOT NULL DEFAULT 0,
  leaderboard_channel_id TEXT,
  leaderboard_message_id TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_polled_at TIMESTAMPTZ,
  active BOOLEAN NOT NULL DEFAULT true
);

-- Players (persist by tag forever)
CREATE TABLE public.players (
  tag TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  current_clan_tag TEXT REFERENCES public.clans(tag) ON DELETE SET NULL,
  role TEXT,
  town_hall INT,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_players_clan ON public.players(current_clan_tag);

-- Raw poll snapshots (kept 60 days)
CREATE TABLE public.donation_snapshots (
  id BIGSERIAL PRIMARY KEY,
  player_tag TEXT NOT NULL,
  clan_tag TEXT NOT NULL,
  donations INT NOT NULL DEFAULT 0,
  donations_received INT NOT NULL DEFAULT 0,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_snap_player_time ON public.donation_snapshots(player_tag, captured_at DESC);
CREATE INDEX idx_snap_clan_time ON public.donation_snapshots(clan_tag, captured_at DESC);
CREATE INDEX idx_snap_captured ON public.donation_snapshots(captured_at);

-- Monthly aggregated totals (kept indefinitely, IST month key YYYY-MM)
CREATE TABLE public.monthly_aggregates (
  id BIGSERIAL PRIMARY KEY,
  month_key TEXT NOT NULL,
  player_tag TEXT NOT NULL,
  player_name TEXT NOT NULL DEFAULT '',
  clan_tag TEXT NOT NULL,
  donations INT NOT NULL DEFAULT 0,
  donations_received INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(month_key, player_tag, clan_tag)
);
CREATE INDEX idx_agg_month_clan ON public.monthly_aggregates(month_key, clan_tag);
CREATE INDEX idx_agg_month_donations ON public.monthly_aggregates(month_key, donations DESC);
CREATE INDEX idx_agg_player ON public.monthly_aggregates(player_tag);

-- Blacklist / Whitelist
CREATE TABLE public.blacklist (
  player_tag TEXT PRIMARY KEY,
  reason TEXT,
  added_by TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.whitelist (
  player_tag TEXT PRIMARY KEY,
  reason TEXT,
  added_by TEXT,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Discord config (single row, key = 'global')
CREATE TABLE public.discord_config (
  key TEXT PRIMARY KEY,
  global_channel_id TEXT,
  global_message_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Poll run log
CREATE TABLE public.poll_runs (
  id BIGSERIAL PRIMARY KEY,
  clan_tag TEXT,
  status TEXT NOT NULL,
  message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX idx_poll_runs_started ON public.poll_runs(started_at DESC);

-- Enable RLS
ALTER TABLE public.clans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.donation_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.monthly_aggregates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.blacklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.whitelist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.discord_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.poll_runs ENABLE ROW LEVEL SECURITY;

-- Public read on everything (read-only dashboard)
CREATE POLICY "public read clans" ON public.clans FOR SELECT USING (true);
CREATE POLICY "public read players" ON public.players FOR SELECT USING (true);
CREATE POLICY "public read snapshots" ON public.donation_snapshots FOR SELECT USING (true);
CREATE POLICY "public read aggregates" ON public.monthly_aggregates FOR SELECT USING (true);
CREATE POLICY "public read blacklist" ON public.blacklist FOR SELECT USING (true);
CREATE POLICY "public read whitelist" ON public.whitelist FOR SELECT USING (true);
CREATE POLICY "public read discord_config" ON public.discord_config FOR SELECT USING (true);
CREATE POLICY "public read poll_runs" ON public.poll_runs FOR SELECT USING (true);
-- No INSERT/UPDATE/DELETE policies => only service role can mutate.

-- Helper: prune snapshots older than 60 days
CREATE OR REPLACE FUNCTION public.prune_old_snapshots()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.donation_snapshots WHERE captured_at < now() - INTERVAL '60 days';
  DELETE FROM public.poll_runs WHERE started_at < now() - INTERVAL '14 days';
END;
$$;

-- Enable scheduling extensions
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
