-- Server invites — RPCs. Builds on server_invites exactly as created in
-- 20260810000000_server_invites.sql (not recreated, not altered here) and
-- its owner-only RLS (also untouched). Both functions are SECURITY DEFINER,
-- same mechanism as create_server: they run as the function owner (which
-- has BYPASSRLS in this project), so they are not subject to the
-- owner-only policies on server_invites, nor to server_members having no
-- INSERT policy at all — that policy is intentionally NOT reintroduced
-- here (Fase 0 lockdown stays exactly as it is).

-- create_invite: only the server owner may call this successfully. The
-- code is generated server-side (derived from gen_random_uuid(), already
-- used everywhere else in this schema, instead of depending on the
-- pgcrypto extension for gen_random_bytes()) — the client never supplies
-- or influences the code. created_by is always auth.uid(); there is no
-- p_created_by parameter, so a caller has no way to attribute an invite to
-- someone else.
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

  if not public.is_server_owner(p_server_id, v_user_id) then
    raise exception 'Only the server owner can create invites' using errcode = '42501';
  end if;

  if p_max_uses is not null and p_max_uses <= 0 then
    raise exception 'max_uses must be a positive number' using errcode = '22023';
  end if;

  if p_expires_at is not null and p_expires_at <= now() then
    raise exception 'expires_at must be in the future' using errcode = '22023';
  end if;

  -- 10 hex chars from a fresh random uuid ~= 40 bits of entropy, plenty for
  -- a shareable invite code (same order of magnitude as Discord's own
  -- codes). Loop only exists as a formality for the astronomically
  -- unlikely collision — the table's own unique constraint is the real
  -- backstop either way.
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

revoke all on function public.create_invite(uuid, timestamptz, int) from public;
grant execute on function public.create_invite(uuid, timestamptz, int) to authenticated;

-- accept_invite: takes ONLY the code — no user_id parameter exists, so
-- there is no way to accept on someone else's behalf; the acting user is
-- always auth.uid(). `select ... for update` locks the invite row for the
-- duration of this transaction: two concurrent accept_invite calls for the
-- SAME code (whether two different users on the last remaining use, or the
-- same user double-submitting) serialize on that lock. The second call
-- only proceeds after the first commits, and re-reads the row's
-- post-commit state (standard Postgres FOR UPDATE behavior under READ
-- COMMITTED) — so its use_count/membership checks see the real, up to date
-- values instead of a stale snapshot, closing both race windows with one
-- mechanism.
create or replace function public.accept_invite(p_code text)
returns table (server_id uuid, already_member boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_invite public.server_invites;
  v_already_member boolean;
begin
  if v_user_id is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  select * into v_invite
  from public.server_invites
  where code = p_code
  for update;

  if not found then
    raise exception 'Invite not found' using errcode = '22023';
  end if;

  if v_invite.revoked_at is not null then
    raise exception 'Invite has been revoked' using errcode = '22023';
  end if;

  if v_invite.expires_at is not null and v_invite.expires_at <= now() then
    raise exception 'Invite has expired' using errcode = '22023';
  end if;

  select exists(
    select 1 from public.server_members sm
    where sm.server_id = v_invite.server_id and sm.user_id = v_user_id
  ) into v_already_member;

  -- Idempotent: an already-accepted invite is a no-op success, not an
  -- error, and never touches use_count again — repeat calls (double
  -- click, retried request) don't inflate usage.
  if not v_already_member then
    if v_invite.max_uses is not null and v_invite.use_count >= v_invite.max_uses then
      raise exception 'Invite has reached its usage limit' using errcode = '22023';
    end if;

    insert into public.server_members (server_id, user_id)
    values (v_invite.server_id, v_user_id);

    update public.server_invites
    set use_count = use_count + 1
    where id = v_invite.id;
  end if;

  return query select v_invite.server_id, v_already_member;
end;
$$;

revoke all on function public.accept_invite(text) from public;
grant execute on function public.accept_invite(text) to authenticated;
