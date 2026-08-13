-- A server with zero channels breaks the app on selection — app.tsx's
-- `if (!activeServer || !channel) return <LoadingScreen />` guard never
-- resolves once channels is empty (activeChannel never gets set), the same
-- failure mode Fase 0 fixed for zero server_members. Extending the same
-- create_server() RPC (not a second mechanism) to also create one default
-- text channel, atomically with the server + membership already there.
--
-- category/position are left unset on purpose — public.channels defaults
-- them to 'Geral' / 0, so this doesn't hardcode a value the schema already
-- owns. type must be one of ('text','voice','forum') per the table's check
-- constraint; 'text' is what a first, general-purpose channel should be.
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

  -- No exception handler: a failure at any of the three inserts above rolls
  -- back all of them, same atomicity guarantee as before.
  return v_server;
end;
$$;

-- Signature is unchanged, so the existing grants from 20260809030000 still
-- apply — restating them here anyway so this migration is self-contained
-- and doesn't rely on a prior one having run correctly.
revoke all on function public.create_server(text, text, text) from public;
grant execute on function public.create_server(text, text, text) to authenticated;
