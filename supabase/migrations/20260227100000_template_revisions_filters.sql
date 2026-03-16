alter table public."Template"
  add column if not exists category text not null default 'general',
  add column if not exists tags jsonb not null default '[]'::jsonb,
  add column if not exists "thumbnailDataUrl" text;

create table if not exists public."TemplateRevision" (
  id uuid primary key default gen_random_uuid(),
  "templateId" uuid not null references public."Template"(id) on delete cascade,
  version integer not null,
  action text not null,
  "actorId" uuid not null,
  snapshot jsonb not null,
  "createdAt" timestamptz not null default now()
);

create index if not exists template_revision_template_created_idx
  on public."TemplateRevision"("templateId", "createdAt" desc);

create index if not exists template_category_idx
  on public."Template"(category);
