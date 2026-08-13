-- Guest accounts (Supabase anonymous sign-ins): a display-name-only account
-- that can use the app immediately, with two safeguards --
--   1. anonymous accounts that never link an email are deleted (with all
--      their data) after 2 days of inactivity, via a new pg_cron job;
--   2. anonymous accounts cannot create servers -- create_server() is
--      SECURITY DEFINER and never goes through servers' RLS, so this has to
--      be enforced inside the function itself, not as a table policy.

-- handle_new_user(): anonymous sign-ins have new.email = null, so the old
-- fallback (split_part(new.email, '@', 1)) resolved to null for both name
-- and handle -- and handle is not null unique on profiles, so every guest
-- signup failed. Same body as the last redefinition, with a final
-- non-null fallback added to both coalesce chains.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, handle, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1), 'Convidado'),
    coalesce(
      new.raw_user_meta_data ->> 'handle',
      split_part(new.email, '@', 1) || '_' || substr(new.id::text, 1, 4),
      'convidado_' || substr(new.id::text, 1, 8)
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  );

  if new.raw_user_meta_data ->> 'phone' is not null then
    insert into public.profile_private (user_id, phone)
    values (new.id, new.raw_user_meta_data ->> 'phone');
  end if;

  insert into public.server_members (server_id, user_id)
  values ('00000000-0000-0000-0000-000000000001', new.id)
  on conflict (server_id, user_id) do nothing;

  return new;
end;
$$;

-- create_server(): identical body to the previous version, only adding a
-- guard at the top that rejects anonymous callers before any insert runs.
create or replace function public.create_server(
  p_name text,
  p_icon_initial text default null,
  p_color text default null
)
returns public.servers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_name text := trim(p_name);
  v_server public.servers;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Contas convidadas não podem criar servidores. Vincule um e-mail para desbloquear.' using errcode = '42501';
  end if;

  if v_name is null or length(v_name) = 0 then
    raise exception 'Server name is required' using errcode = '22023';
  end if;

  if length(v_name) > 100 then
    raise exception 'Server name is too long (max 100 characters)' using errcode = '22023';
  end if;

  insert into public.servers (name, owner_id, icon_initial, color)
  values (v_name, v_user_id, p_icon_initial, p_color)
  returning * into v_server;

  insert into public.server_members (server_id, user_id)
  values (v_server.id, v_user_id);

  insert into public.channels (server_id, name, type)
  values (v_server.id, 'geral', 'text');

  return v_server;
end;
$$;

revoke all on function public.create_server(text, text, text) from public;
grant execute on function public.create_server(text, text, text) to authenticated;

-- Cleanup job: deletes any anonymous account that hasn't signed back in for
-- 2+ days and never linked an email (linking flips is_anonymous to false on
-- GoTrue's own, so this query naturally excludes upgraded accounts without
-- needing an extra flag). Mirrors delete_own_account()'s exact deletion
-- order: servers first (owner_id fk), then auth.users (cascades profiles
-- and everything hanging off it).
create extension if not exists pg_cron;

create or replace function public.cleanup_expired_guest_accounts()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  expired uuid[];
begin
  select array_agg(u.id) into expired
  from auth.users u
  where u.is_anonymous is true
    and coalesce(u.last_sign_in_at, u.created_at) < now() - interval '2 days';

  if expired is null then
    return;
  end if;

  delete from public.servers where owner_id = any(expired);
  delete from auth.users where id = any(expired);
end;
$$;

select cron.schedule(
  'cleanup-expired-guests',
  '0 * * * *',
  $$select public.cleanup_expired_guest_accounts()$$
);
