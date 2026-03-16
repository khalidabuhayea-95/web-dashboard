create table if not exists public."Template" (
  id uuid primary key default gen_random_uuid(),
  "ownerId" uuid not null,
  name text not null,
  data jsonb not null,
  "createdAt" timestamptz not null default now(),
  "updatedAt" timestamptz not null default now()
);

create unique index if not exists template_owner_name_unique
  on public."Template"("ownerId", name);

create index if not exists template_owner_idx
  on public."Template"("ownerId");

create or replace function public.set_template_updated_at()
returns trigger
language plpgsql
as $$
begin
  new."updatedAt" = now();
  return new;
end;
$$;

drop trigger if exists template_updated_at on public."Template";
create trigger template_updated_at
  before update on public."Template"
  for each row
  execute function public.set_template_updated_at();
