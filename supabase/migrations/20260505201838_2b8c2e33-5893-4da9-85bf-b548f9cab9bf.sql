
CREATE TABLE public.family_categories (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(guild_id, name)
);
ALTER TABLE public.family_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read family_categories" ON public.family_categories FOR SELECT USING (true);

CREATE TABLE public.family_clans (
  id BIGSERIAL PRIMARY KEY,
  guild_id TEXT NOT NULL,
  category_id BIGINT NOT NULL REFERENCES public.family_categories(id) ON DELETE CASCADE,
  clan_tag TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(guild_id, category_id, clan_tag)
);
CREATE INDEX idx_family_clans_guild ON public.family_clans(guild_id);
ALTER TABLE public.family_clans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read family_clans" ON public.family_clans FOR SELECT USING (true);

CREATE TABLE public.family_dashboards (
  guild_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  message_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.family_dashboards ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read family_dashboards" ON public.family_dashboards FOR SELECT USING (true);
