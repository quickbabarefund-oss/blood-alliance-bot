create table if not exists public.embed_templates (
  id bigserial primary key,
  guild_id text not null,
  slot text not null,
  enabled boolean not null default true,
  title text,
  description text,
  color integer,
  footer_text text,
  thumbnail_url text,
  image_url text,
  content text,
  fields jsonb not null default '[]'::jsonb,
  show_timestamp boolean not null default false,
  updated_at timestamptz not null default now(),
  unique (guild_id, slot)
);
alter table public.embed_templates enable row level security;
create policy "public read embed_templates" on public.embed_templates for select using (true);

create table if not exists public.embed_edit_tokens (
  token text primary key,
  guild_id text not null,
  issued_by text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);
alter table public.embed_edit_tokens enable row level security;
-- no public policies; only service role accesses