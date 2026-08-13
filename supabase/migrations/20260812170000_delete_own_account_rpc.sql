-- Etapa 7.1 — self-service account deletion.
-- Users must be able to permanently delete their own account (LGPD/GDPR).
--
-- The profile row has ON DELETE CASCADE from auth.users, so deleting from
-- auth.users cascades to profiles → server_members, messages, reactions,
-- friendships, notifications, dm_messages, dm_calls, etc.
--
-- Servers owned by the deleted user are deleted first (cascade handles their
-- channels, messages, members, roles, invites). For a community app, this is
-- simpler than reassigning ownership to a headless admin.
--
-- SECURITY DEFINER allows writing to auth.users (which has no RLS and is
-- normally only accessible to service_role). The WHERE clause ensures only
-- the caller's own row is affected.

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Not authenticated';
  end if;

  -- Delete servers owned by this user (cascade handles channels, messages, members, etc)
  delete from public.servers where owner_id = uid;

  -- Delete the auth user — cascades to profiles and all FK-dependent rows.
  delete from auth.users where id = uid;
end;
$$;

-- Only the authenticated user themselves can call this.
revoke all on function public.delete_own_account() from public;
grant execute on function public.delete_own_account() to authenticated;
