ALTER TABLE public.family_categories
  ADD COLUMN IF NOT EXISTS emoji text,
  ADD COLUMN IF NOT EXISTS button_label text,
  ADD COLUMN IF NOT EXISTS button_style smallint NOT NULL DEFAULT 2,
  ADD COLUMN IF NOT EXISTS line_format text;

CREATE TABLE IF NOT EXISTS public.family_info_messages (
  id bigserial PRIMARY KEY,
  guild_id text NOT NULL,
  key text NOT NULL,
  label text NOT NULL,
  emoji text,
  button_style smallint NOT NULL DEFAULT 2,
  title text,
  description text,
  color integer,
  image_url text,
  thumbnail_url text,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, key)
);
ALTER TABLE public.family_info_messages ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "public read family_info_messages" ON public.family_info_messages;
CREATE POLICY "public read family_info_messages"
  ON public.family_info_messages FOR SELECT USING (true);