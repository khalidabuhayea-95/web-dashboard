do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_role') then
    create type public.app_role as enum ('admin', 'editor');
  end if;
end $$;

create table if not exists public.user_roles (
  user_id uuid primary key references auth.users on delete cascade,
  role public.app_role not null default 'editor'
);

alter table public.user_roles enable row level security;

create policy "Allow auth admin read"
  on public.user_roles
  for select
  to supabase_auth_admin
  using (true);

create policy "Allow auth admin write"
  on public.user_roles
  for all
  to supabase_auth_admin
  using (true)
  with check (true);

grant usage on type public.app_role to supabase_auth_admin;
revoke all on type public.app_role from public;

grant all on table public.user_roles to supabase_auth_admin;
revoke all on table public.user_roles from public;

create or replace function public.custom_access_token_hook(event jsonb)
returns jsonb
language plpgsql
stable
as $$
  declare
    claims jsonb;
    user_role public.app_role;
  begin
    select role into user_role
      from public.user_roles
     where user_id = (event->>'user_id')::uuid;

    claims := event->'claims';

    if user_role is not null then
      claims := jsonb_set(claims, '{user_role}', to_jsonb(user_role));
    else
      claims := jsonb_set(claims, '{user_role}', '"editor"');
    end if;

    return jsonb_set(event, '{claims}', claims);
  end;
$$;

grant execute on function public.custom_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.custom_access_token_hook(jsonb) from public;
