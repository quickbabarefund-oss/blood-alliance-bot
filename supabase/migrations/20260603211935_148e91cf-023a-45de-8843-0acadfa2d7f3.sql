ALTER TABLE public.embed_templates
  ADD COLUMN IF NOT EXISTS author_name text,
  ADD COLUMN IF NOT EXISTS author_icon_url text,
  ADD COLUMN IF NOT EXISTS author_url text,
  ADD COLUMN IF NOT EXISTS title_url text,
  ADD COLUMN IF NOT EXISTS components jsonb NOT NULL DEFAULT '[]'::jsonb;