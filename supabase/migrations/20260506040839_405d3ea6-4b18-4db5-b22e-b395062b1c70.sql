ALTER TABLE public.family_dashboards
  ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '🏛️ Family Clan Dashboard',
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS color integer NOT NULL DEFAULT 5793266,
  ADD COLUMN IF NOT EXISTS footer_text text,
  ADD COLUMN IF NOT EXISTS show_timestamp boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS thumbnail_url text,
  ADD COLUMN IF NOT EXISTS image_url text,
  ADD COLUMN IF NOT EXISTS category_emoji text NOT NULL DEFAULT '🏰',
  ADD COLUMN IF NOT EXISTS clan_line_format text NOT NULL DEFAULT '`{i}.` **{name}** `{tag}`';