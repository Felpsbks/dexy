-- Server creation, done as a SECURITY DEFINER RPC instead of relying on the
-- direct-table INSERT policies on `servers`/`server_members`. Two reasons:
--
-- 1. Creating a server is really two writes that must happen together
--    (the servers row, and the creator's own server_members row) — there is
--    no client-safe way to do that atomically through two separate RLS-
--    gated REST calls, and server_members no longer accepts client INSERTs
--    at all as of 20260809010000 (Fase 0 lockdown — intentionally not
--    reintroducing that policy here).
-- 2. The direct `servers` INSERT policy (with check (owner_id = auth.uid()))
--    was independently confirmed broken against the live database — a
--    correctly-authenticated request with owner_id = auth.uid() is
--    rejected by RLS even though the policy text, grants, triggers and
--    constraints all check out. Root cause not identified. This function
--    sidesteps that entirely: SECURITY DEFINER functions run as the
--    function owner (BYPASSRLS in this project, same mechanism
--    handle_new_user() already relies on), so it is not subject to
--    whatever is misbehaving in the `servers` INSERT policy.
--
-- Not touching the `servers` policies themselves in this migration — this
-- is a new, separate, trusted entry point alongside them, not a fix to them.
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
  -- Belt-and-suspenders: EXECUTE is granted only to `authenticated` below,
  -- but this makes the function itself refuse to act without a real,
  -- verified caller regardless of how it's invoked.
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if v_name is null or length(v_name) = 0 then
    raise exception 'Server name is required' using errcode = '22023';
  end if;

  if length(v_name) > 100 then
    raise exception 'Server name is too long (max 100 characters)' using errcode = '22023';
  end if;

  -- owner_id is always v_user_id (derived from auth.uid() above) — there is
  -- no parameter for it, so the caller has no way to make themselves the
  -- owner of a server "on behalf of" anyone else.
  insert into public.servers (name, owner_id, icon_initial, color)
  values (v_name, v_user_id, p_icon_initial, p_color)
  returning * into v_server;

  insert into public.server_members (server_id, user_id)
  values (v_server.id, v_user_id);

  -- No exception handler in this function: if either insert above fails,
  -- the error propagates unhandled and Postgres rolls back everything this
  -- function did as part of the same transaction — there is no code path
  -- that returns successfully with only one of the two rows written.
  return v_server;
end;
$$;

-- Explicit, not assumed: functions get PUBLIC execute by default in
-- Postgres, which would include `anon`. Revoke that, then grant only to
-- `authenticated`.
revoke all on function public.create_server(text, text, text) from public;
grant execute on function public.create_server(text, text, text) to authenticated;
