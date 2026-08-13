-- Etapa 6.4 — closes the "incomplete block" gap found while auditing Fase 6:
-- friendships.status = 'blocked' already stops new conversations
-- (get_or_create_dm requires 'accepted') and hides the pair from the friends
-- list, but an existing dm_conversations row had no RLS tying it to
-- friendship status at all — either side could still send messages, start
-- calls, or attach files in a conversation that predates the block.
--
-- Deliberately NOT touched (out of scope for this etapa, per explicit
-- product decision — see plan discussion): dm_calls UPDATE (accept/decline/
-- hangup/ring-timeout), the identity-lock trigger from Etapa 6.1,
-- dm_message_reactions, existing messages/attachments (read access
-- untouched — history stays fully visible on both sides).

-- True if the two participants of a DM conversation currently have a
-- 'blocked' friendship between them, in either direction — friendships is
-- stored as a single row per unordered pair (see prevent_friendship_identity_change,
-- 20260808200000_fix_friendships_rls.sql), so both directions must be checked,
-- same as is_dm_participant/get_or_create_dm already do.
create function public.is_dm_blocked(p_conversation_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.dm_conversations c
    join public.friendships f
      on (f.user_id = c.user_a and f.friend_id = c.user_b)
      or (f.user_id = c.user_b and f.friend_id = c.user_a)
    where c.id = p_conversation_id
      and f.status = 'blocked'
  );
$$;

drop policy "participants can send dm messages" on public.dm_messages;
create policy "participants can send dm messages"
  on public.dm_messages for insert
  to authenticated
  with check (
    author_id = auth.uid()
    and public.is_dm_participant(conversation_id)
    and not public.is_dm_blocked(conversation_id)
  );

drop policy "participants can start dm calls" on public.dm_calls;
create policy "participants can start dm calls"
  on public.dm_calls for insert
  to authenticated
  with check (
    started_by = auth.uid()
    and public.is_dm_participant(conversation_id)
    and not public.is_dm_blocked(conversation_id)
  );

drop policy "authors can add attachments to their dm messages" on public.dm_message_attachments;
create policy "authors can add attachments to their dm messages"
  on public.dm_message_attachments for insert
  to authenticated
  with check (
    exists (
      select 1 from public.dm_messages m
      where m.id = dm_message_id
        and m.author_id = auth.uid()
        and not public.is_dm_blocked(m.conversation_id)
    )
  );
