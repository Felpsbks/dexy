-- Etapa 6.1 — closes an integrity gap found while auditing Fase 6: the
-- UPDATE policy on dm_calls ("participants can update their dm calls",
-- 20260730161110_dm_calls_and_read_state.sql) has no WITH CHECK, so
-- Postgres reuses its USING clause (is_dm_participant(conversation_id)) to
-- validate the post-update row too — which only confirms the caller is
-- still a participant, not that started_by/conversation_id are unchanged.
-- Any participant (not just the one who started the call) could rewrite
-- who started it, or in principle retarget the row to a different
-- conversation they're also part of.
--
-- Not fixable with WITH CHECK alone: RLS policies can't compare OLD vs NEW
-- within one expression (USING sees the old row, WITH CHECK sees the new
-- one, never both at once) — the exact same limitation that led to
-- assign_role being an RPC in Fase 5 instead of a column-scoped UPDATE
-- policy. A BEFORE UPDATE trigger is the right tool here, and the project
-- already has the identical pattern for friendships.user_id/friend_id
-- (prevent_friendship_identity_change, 20260808200000_fix_friendships_rls.sql)
-- — this mirrors it exactly, just for dm_calls' own two identity columns.
--
-- Deliberately NOT touching the existing UPDATE policy at all: it's still
-- exactly what accept/decline/hangup/the 30s ring-timeout/reconnect cleanup
-- need (all of them only ever write status/answered_at/ended_at — see
-- useDmCall in src/lib/livekit.ts). kind is left out of this trigger on
-- purpose, out of scope for this etapa per explicit product decision.
create function public.prevent_dm_call_identity_change()
returns trigger
language plpgsql
as $$
begin
  if new.started_by <> old.started_by or new.conversation_id <> old.conversation_id then
    raise exception 'dm_calls.started_by and dm_calls.conversation_id cannot be changed';
  end if;
  return new;
end;
$$;

create trigger dm_calls_prevent_identity_change
  before update on public.dm_calls
  for each row execute procedure public.prevent_dm_call_identity_change();
