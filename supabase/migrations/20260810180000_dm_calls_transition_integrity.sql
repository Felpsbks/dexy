-- Etapa 6.5 — closes the dm_calls UPDATE gaps found while auditing the
-- secondary finding flagged during Etapa 6.4: the UPDATE policy had no
-- WITH CHECK and no state-machine awareness at all, so any participant
-- could self-accept/self-decline their own call, rewrite status to an
-- arbitrary string (no CHECK constraint existed), or freely set
-- answered_at/ended_at to whatever value they wanted.
--
-- Deliberately NOT touched, per explicit product decision: mintDmVoiceToken
-- (only checks is_dm_participant, not dm_calls at all — a separate surface,
-- its own future etapa), kind's mutability (left alone since Etapa 6.1, not
-- reopened here), Presence, notifications, deep-link.

-- 1) Value integrity: dm_calls.status/kind never had a CHECK constraint,
-- unlike friendships.status/profiles.status which always have. Confirmed via
-- audit that an arbitrary string was silently accepted.
alter table public.dm_calls
  add constraint dm_calls_status_check check (status in ('ringing', 'active', 'ended', 'declined', 'missed')),
  add constraint dm_calls_kind_check check (kind in ('audio', 'video'));

-- 2) State-transition + timestamp integrity. RLS policies can't compare OLD
-- and NEW within one expression (USING sees the old row, WITH CHECK sees
-- the new one, never both at once) — the same limitation documented in
-- prevent_dm_call_identity_change (Etapa 6.1) — so this has to be a
-- BEFORE UPDATE trigger, not a policy. Kept as its own separate trigger
-- rather than folded into the 6.1 one, so that trigger stays untouched.
--
-- Only 4 transitions are legal, matching the app's 6 real flows exactly:
--   ringing -> active   (accept — only the non-caller may do this)
--   ringing -> declined (decline — only the non-caller may do this)
--   ringing -> missed   (ring timeout, caller-cancel-via-hangup, or the
--                        stuck-ringing auto-heal — any participant)
--   active  -> ended    (hangup, or the reconnect-exhausted cleanup —
--                        any participant)
-- Every other (old_status, new_status) pair — including a same-status
-- no-op, which none of the 6 real flows ever send — is rejected outright.
--
-- answered_at/ended_at are never trusted from the client: the trigger
-- overwrites the timestamp being set on a valid transition with its own
-- now(), and requires the *other* timestamp to be byte-for-byte unchanged.
-- started_at is fully immutable after insert (nothing legitimate ever
-- rewrites it, and letting it move would let a caller extend their own
-- ring/auto-heal timeout windows arbitrarily).
create function public.validate_dm_call_transition()
returns trigger
language plpgsql
as $$
declare
  is_caller boolean := (auth.uid() = old.started_by);
begin
  if new.started_at <> old.started_at then
    raise exception 'dm_calls.started_at cannot be changed after creation';
  end if;

  if old.status = 'ringing' and new.status = 'active' then
    if is_caller then
      raise exception 'the caller cannot accept their own call';
    end if;
    if old.answered_at is not null then
      raise exception 'call was already answered';
    end if;
    if new.ended_at is distinct from old.ended_at then
      raise exception 'ended_at cannot change while accepting a call';
    end if;
    new.answered_at := now();
    return new;
  end if;

  if old.status = 'ringing' and new.status = 'declined' then
    if is_caller then
      raise exception 'the caller cannot decline their own call';
    end if;
    if new.answered_at is distinct from old.answered_at then
      raise exception 'answered_at cannot change while declining a call';
    end if;
    new.ended_at := now();
    return new;
  end if;

  if old.status = 'ringing' and new.status = 'missed' then
    if new.answered_at is distinct from old.answered_at then
      raise exception 'answered_at cannot change while marking a call missed';
    end if;
    new.ended_at := now();
    return new;
  end if;

  if old.status = 'active' and new.status = 'ended' then
    if new.answered_at is distinct from old.answered_at then
      raise exception 'answered_at cannot change while ending a call';
    end if;
    new.ended_at := now();
    return new;
  end if;

  raise exception 'invalid dm_calls state transition: % -> %', old.status, new.status;
end;
$$;

create trigger dm_calls_validate_transition
  before update on public.dm_calls
  for each row execute procedure public.validate_dm_call_transition();

-- 3) UPDATE policy gains the same blocked-conversation check INSERT already
-- has (Etapa 6.4), via the same is_dm_blocked function. WITH CHECK mirrors
-- USING here (conversation_id can't move, it's locked by the 6.1 trigger) —
-- this is belt-and-suspenders; the real transition rules live in the
-- trigger above, which RLS alone structurally cannot express.
drop policy "participants can update their dm calls" on public.dm_calls;
create policy "participants can update their dm calls"
  on public.dm_calls for update
  to authenticated
  using (public.is_dm_participant(conversation_id) and not public.is_dm_blocked(conversation_id))
  with check (public.is_dm_participant(conversation_id) and not public.is_dm_blocked(conversation_id));
