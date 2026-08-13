-- Etapa 5.4A — closes the gap flagged in the Etapa 5.3 audit: assign_role
-- was never touched by Etapa 5.2's five RLS groups, so the assign_roles
-- permission (created in Etapa 5.1's catalog) had zero effect anywhere.
-- Same OR-not-replace rule as every other change since Etapa 5.2:
-- is_server_owner(...) stays as its own explicit branch, has_permission(...)
-- is only added alongside it — even though has_permission() already
-- short-circuits true for the owner internally, the explicit branch is
-- kept for the same reason it's kept in every RLS policy touched so far:
-- readability/auditability, and an independent guarantee that doesn't rely
-- on has_permission()'s internal owner-shortcut never changing.
--
-- Nothing else in this function changes: same signature, same
-- membership check, same cross-server role validation, same "only ever
-- writes role_id" contract.
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

  if not (public.is_server_owner(p_server_id, v_caller) or public.has_permission(p_server_id, 'assign_roles')) then
    raise exception 'Only the server owner or a member with assign_roles can assign roles' using errcode = '42501';
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
