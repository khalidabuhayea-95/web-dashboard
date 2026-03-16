alter table public."Template"
  add column if not exists slug text,
  add column if not exists status text not null default 'draft',
  add column if not exists version integer not null default 1,
  add column if not exists "canvasSize" jsonb not null default '{"width":1080,"height":1080}'::jsonb,
  add column if not exists "publishedAt" timestamptz;

update public."Template"
set slug = lower(regexp_replace(name, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || left(id::text, 8)
where slug is null or length(trim(slug)) = 0;

alter table public."Template"
  alter column slug set not null;

create unique index if not exists template_slug_unique
  on public."Template"(slug);

create index if not exists template_status_idx
  on public."Template"(status);
