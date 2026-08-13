-- preview_invite — read-only, public preview for the /invite/:code flow
-- (Etapa 5.1). This is the first function in the project granted to `anon`
-- — every other RPC/policy so far is authenticated-only — so the returned
-- surface is kept as narrow as physically possible: name/icon_initial/color
-- plus a computed status, nothing else. accept_invite/create_invite are not
-- touched by this migration, and no RLS policy on server_invites or servers
-- is added or changed — this function bypasses both via SECURITY DEFINER
-- (same mechanism already used by create_server/accept_invite), it doesn't
-- need either table to open up.
--
-- Never SELECT *: every query below names its columns explicitly, and the
-- RETURNS TABLE only has the 5 columns this function is allowed to expose
-- — server_id, created_by, use_count and max_uses are read internally
-- (status computation, existence check) but never appear in a returned
-- column or a `select *`.
create or replace function public.preview_invite(p_code text)
returns table (
  name text,
  icon_initial text,
  color text,
  status text,
  already_member boolean
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_server_id uuid;
  v_expires_at timestamptz;
  v_max_uses int;
  v_use_count int;
  v_revoked_at timestamptz;
  v_status text;
  v_name text;
  v_icon_initial text;
  v_color text;
begin
  select si.server_id, si.expires_at, si.max_uses, si.use_count, si.revoked_at
    into v_server_id, v_expires_at, v_max_uses, v_use_count, v_revoked_at
  from public.server_invites si
  where si.code = p_code;

  if not found then
    return query select null::text, null::text, null::text, 'not_found'::text, false;
    return;
  end if;

  if v_revoked_at is not null then
    v_status := 'revoked';
  elsif v_expires_at is not null and v_expires_at <= now() then
    v_status := 'expired';
  elsif v_max_uses is not null and v_use_count >= v_max_uses then
    v_status := 'exhausted';
  else
    v_status := 'valid';
  end if;

  select s.name, s.icon_initial, s.color
    into v_name, v_icon_initial, v_color
  from public.servers s
  where s.id = v_server_id;

  -- is_server_member() already handles a null p_user_id correctly (an
  -- anonymous caller): `user_id = null` never matches in SQL, so this
  -- returns false for anon without a separate branch — reusing the
  -- existing, already-tested function instead of re-implementing the check.
  return query
    select v_name, v_icon_initial, v_color, v_status, public.is_server_member(v_server_id, v_user_id);
end;
$$;

revoke all on function public.preview_invite(text) from public;
grant execute on function public.preview_invite(text) to anon, authenticated;
