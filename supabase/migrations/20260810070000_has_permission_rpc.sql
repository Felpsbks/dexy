-- has_permission — Etapa 5.1. Read-only SECURITY DEFINER helper, same
-- mechanism as is_server_owner/is_server_member (runs as the function
-- owner, which has BYPASSRLS, so it can read server_members/role_permissions
-- regardless of the caller's own RLS visibility into those tables).
--
-- NOT wired into any existing policy or RPC in this migration — nothing
-- calls this yet. It exists so it can be tested in isolation before any
-- existing RLS is touched, per the explicit instruction for this phase.
--
-- Contract (all verified below, in order):
--   1. auth.uid() is the only identity source — no p_user_id parameter, so
--      there is no way to ask "does someone else have this permission".
--   2. Owner short-circuit: the server owner always returns true,
--      regardless of role_id or role_permissions content — owner is a
--      strict superset by product decision, never reduced by this system.
--   3. Membership is re-derived from server_members itself, not assumed —
--      a non-member (even one who somehow knows a role_id) gets false.
--   4. role_id = null (no role assigned) returns false — there is nothing
--      to look up permissions for.
--   5. Cross-server guard: the looked-up role's own server_id must equal
--      p_server_id. server_members.role_id should already only ever point
--      to a same-server role (assign_role enforces this on write), but
--      this function never trusts that blindly — same defense-in-depth
--      principle already applied in assign_role itself.
--   6. Missing row in role_permissions (permission never granted, or
--      permission name doesn't exist in the catalog) = false. This is the
--      literal implementation of "default deny".
--   7. No exception path returns true — every early return in this
--      function is `false` (or the owner's `true`), and any unexpected
--      error propagates as a Postgres exception (function aborts) rather
--      than being caught and defaulted to permissive.
create or replace function public.has_permission(p_server_id uuid, p_permission text)
returns boolean
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  v_user_id uuid := auth.uid();
  v_role_id uuid;
  v_allow boolean;
begin
  if v_user_id is null then
    return false;
  end if;

  if public.is_server_owner(p_server_id, v_user_id) then
    return true;
  end if;

  select sm.role_id into v_role_id
  from public.server_members sm
  where sm.server_id = p_server_id and sm.user_id = v_user_id;

  -- Not found = not a member of this server at all.
  if not found then
    return false;
  end if;

  -- Member exists but has no role assigned.
  if v_role_id is null then
    return false;
  end if;

  select rp.allow into v_allow
  from public.role_permissions rp
  join public.server_roles sr on sr.id = rp.role_id
  where rp.role_id = v_role_id
    and sr.server_id = p_server_id
    and rp.permission = p_permission;

  -- Not found covers three cases at once: the permission was never granted
  -- for this role, the permission name doesn't exist in the catalog, or
  -- (defense-in-depth) the role's own server_id doesn't match p_server_id.
  if not found then
    return false;
  end if;

  return coalesce(v_allow, false);
end;
$$;

revoke all on function public.has_permission(uuid, text) from public;
grant execute on function public.has_permission(uuid, text) to authenticated;
