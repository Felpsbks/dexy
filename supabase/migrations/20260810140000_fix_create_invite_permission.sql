-- Etapa 5.4A — closes the second gap flagged in the Etapa 5.3 audit:
-- create_invite was explicitly left owner-only in Etapa 5.2 (RLS-only
-- scope), even though the manage_invites RLS policies on server_invites
-- were already updated. This finishes that: manage_invites now works for
-- the full CRUD surface, RPC included. Same OR-not-replace rule as
-- assign_role's fix above and every RLS change since Etapa 5.2.
--
-- Nothing else changes: same signature, same code-generation loop, same
-- validation, same created_by = v_user_id (never a client-supplied value).
create or replace function public.create_invite(
  p_server_id uuid,
  p_expires_at timestamptz default null,
  p_max_uses int default null
)
returns public.server_invites
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_code text;
  v_invite public.server_invites;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  if not (public.is_server_owner(p_server_id, v_user_id) or public.has_permission(p_server_id, 'manage_invites')) then
    raise exception 'Only the server owner or a member with manage_invites can create invites' using errcode = '42501';
  end if;

  if p_max_uses is not null and p_max_uses <= 0 then
    raise exception 'max_uses must be a positive number' using errcode = '22023';
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'expires_at must be in the future' using errcode = '22023';
  end if;

  loop
    v_code := substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
    exit when not exists (select 1 from public.server_invites where code = v_code);
  end loop;

  insert into public.server_invites (server_id, code, created_by, expires_at, max_uses)
  values (p_server_id, v_code, v_user_id, p_expires_at, p_max_uses)
  returning * into v_invite;

  return v_invite;
end;
$$;
