-- Etapa 5.2, Grupo 5 — the most sensitive change in this etapa: adds real
-- moderation capability to messages that didn't exist in any form before
-- (RLS was strictly author-only for both UPDATE and DELETE).
--
-- Deliberately implemented as a NEW, SEPARATE permissive policy rather
-- than editing "authors can delete their messages" at all — Postgres RLS
-- combines multiple permissive policies for the same command with OR
-- automatically, so this cannot narrow or interfere with the existing
-- author-only path; it can only ever add cases where a delete is allowed
-- that wasn't before. The original policy is untouched, byte for byte.
--
-- messages has no server_id column of its own, so the owner/permission
-- check goes through channels (channel_id -> server_id), the same join
-- shape already used by is_message_channel_member().
--
-- INSERT is not touched. UPDATE (message editing) is not touched either —
-- moderation in this etapa is scoped exactly to "excluir mensagem" per the
-- audited operation list, not to editing someone else's message content.
create policy "owners and moderate_messages holders can delete any message"
  on public.messages for delete
  to authenticated
  using (
    exists (
      select 1 from public.channels c
      where c.id = messages.channel_id
        and (public.is_server_owner(c.server_id) or public.has_permission(c.server_id, 'moderate_messages'))
    )
  );
