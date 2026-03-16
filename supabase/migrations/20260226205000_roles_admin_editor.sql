update public.user_roles set role = 'editor' where role::text = 'viewer';

do $$
begin
  if exists (select 1 from pg_type where typname = 'app_role') then
    alter table public.user_roles alter column role drop default;
    create type public.app_role_new as enum ('admin', 'editor');
    alter table public.user_roles
      alter column role type public.app_role_new
      using role::text::public.app_role_new;
    drop type public.app_role;
    alter type public.app_role_new rename to app_role;
    alter table public.user_roles alter column role set default 'editor';
  end if;
end $$;

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
