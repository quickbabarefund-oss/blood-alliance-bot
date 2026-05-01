-- War tracking config (per guild + clan)
CREATE TABLE public.war_track_config (
  guild_id text NOT NULL,
  clan_tag text NOT NULL,
  rep_channel_id text,
  rep_role_id text,
  mail_channel_id text,
  mail_ping_role_id text,
  log_channel_id text,
  win_announcement text,
  lose_announcement text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, clan_tag)
);
ALTER TABLE public.war_track_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read war_track_config" ON public.war_track_config FOR SELECT USING (true);

CREATE TABLE public.war_reminders (
  id bigserial PRIMARY KEY,
  guild_id text NOT NULL,
  clan_tag text NOT NULL,
  minutes int NOT NULL,
  anchor text NOT NULL CHECK (anchor IN ('before_end','after_start')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX war_reminders_clan_idx ON public.war_reminders(guild_id, clan_tag);
ALTER TABLE public.war_reminders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read war_reminders" ON public.war_reminders FOR SELECT USING (true);

CREATE TABLE public.wars (
  id bigserial PRIMARY KEY,
  guild_id text NOT NULL,
  clan_tag text NOT NULL,
  clan_name text,
  clan_badge_url text,
  opponent_tag text NOT NULL,
  opponent_name text,
  opponent_badge_url text,
  team_size int,
  start_time timestamptz,
  end_time timestamptz,
  state text NOT NULL,
  match_type text,
  decision text,
  decided_by text,
  decided_at timestamptz,
  result text,
  our_stars int,
  opp_stars int,
  our_destruction numeric,
  opp_destruction numeric,
  rep_message_id text,
  result_message_id text,
  fired_reminders bigint[] NOT NULL DEFAULT '{}',
  war_started_msg_sent boolean NOT NULL DEFAULT false,
  result_posted boolean NOT NULL DEFAULT false,
  raw_roster jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clan_tag, opponent_tag, start_time)
);
CREATE INDEX wars_active_idx ON public.wars(state) WHERE state <> 'warEnded';
CREATE INDEX wars_guild_clan_idx ON public.wars(guild_id, clan_tag);
ALTER TABLE public.wars ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read wars" ON public.wars FOR SELECT USING (true);

CREATE TABLE public.war_attacks (
  war_id bigint NOT NULL REFERENCES public.wars(id) ON DELETE CASCADE,
  attacker_tag text NOT NULL,
  attacker_name text,
  attacker_th int,
  attacker_map_pos int,
  defender_tag text,
  defender_map_pos int,
  stars int,
  destruction int,
  attack_order int NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (war_id, attacker_tag, attack_order)
);
ALTER TABLE public.war_attacks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read war_attacks" ON public.war_attacks FOR SELECT USING (true);

CREATE TABLE public.war_rule_breaks (
  id bigserial PRIMARY KEY,
  war_id bigint NOT NULL REFERENCES public.wars(id) ON DELETE CASCADE,
  player_tag text NOT NULL,
  player_name text,
  rule text NOT NULL,
  detail text,
  detected_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX war_rule_breaks_war_idx ON public.war_rule_breaks(war_id);
ALTER TABLE public.war_rule_breaks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read war_rule_breaks" ON public.war_rule_breaks FOR SELECT USING (true);

CREATE TABLE public.coc_links (
  player_tag text PRIMARY KEY,
  user_id text NOT NULL,
  refreshed_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.coc_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read coc_links" ON public.coc_links FOR SELECT USING (true);

CREATE TABLE public.th_emojis (
  th_level int PRIMARY KEY,
  emoji text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.th_emojis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read th_emojis" ON public.th_emojis FOR SELECT USING (true);