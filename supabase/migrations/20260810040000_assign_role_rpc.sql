-- assign_role — Etapa 4A Step 3 (atribuição segura de cargo). role_id is
-- pure identity/organization (name, color, position) — this RPC writes
-- ONLY server_members.role_id, nothing else, and grants no authorization
-- power to any role.
--
-- Why an RPC instead of a scoped UPDATE policy on server_members: Postgres
-- RLS has no declarative way to compare OLD vs NEW column values within a
-- single UPDATE policy (no trigger involved), so a `for update` policy
-- cannot by itself guarantee that only role_id changes and server_id/
-- user_id/joined_at stay untouched — the client could always send those
-- columns in the same UPDATE payload. A SECURITY DEFINER function that
-- accepts server_id/user_id/role_id purely as lookup/target identifiers,
-- and only ever writes role_id itself, closes that gap completely without
-- opening any general UPDATE on server_members at all.
--
-- Authorization: owner-only, via is_server_owner(server_id, auth.uid()) —
-- exact same helper already used by create_invite/is_server_owner call
-- sites, reused here instead of duplicating the ownership check.
--
-- Cross-server validation: p_role_id is never trusted via FK alone. When
-- non-null, this explicitly checks that the role's own server_id matches
-- p_server_id — a valid server_roles UUID from a DIFFERENT server is
-- rejected, not silently accepted.
--
-- p_role_id = null is a valid, explicit "remove this member's role" call,
-- not an error.
create or replace function public.assign_role(
  p_server_id uuid,
  p_user_id uuid,
  p_role_id uuid
)
returns public.server_members
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_member public.server_members;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not public.is_server_owner(p_server_id, v_caller) then
    raise exception 'Only the server owner can assign roles' using errcode = '42501';
  end if;

  if not exists (
    select 1 from public.server_members
    where server_id = p_server_id and user_id = p_user_id
  ) then
    raise exception 'Target user is not a member of this server' using errcode = '22023';
  end if;

  if p_role_id is not null and not exists (
    select 1 from public.server_roles
    where id = p_role_id and server_id = p_server_id
  ) then
    raise exception 'Role does not belong to this server' using errcode = '22023';
  end if;

  update public.server_members
  set role_id = p_role_id
  where server_id = p_server_id and user_id = p_user_id
  returning * into v_member;

  return v_member;
end;
$$;

revoke all on function public.assign_role(uuid, uuid, uuid) from public;
grant execute on function public.assign_role(uuid, uuid, uuid) to authenticated;
