-- Read receipts: a DM participant needs to see the OTHER participant's
-- last_read_at (not just their own) to render "read" checkmarks on their own
-- sent messages. The original policy only allowed seeing your own row.
drop policy "users can view their own dm read state" on public.dm_read_state;

create policy "participants can view dm read state in their conversations"
  on public.dm_read_state for select
  to authenticated
  using (public.is_dm_participant(conversation_id));
