-- Product rule (Etapa 3 — Sair do servidor): the owner cannot leave their
-- own server this phase (no ownership-transfer flow exists yet). The
-- previous DELETE policy on server_members allowed the SAME row to be
-- removed two ways — `user_id = auth.uid()` (self) or
-- `is_server_owner(server_id)` (owner removing anyone) — and neither
-- clause distinguished "whose row is this" from "who is asking", so an
-- owner could delete their own row through either path. This is the
-- smallest change that closes both: block deleting any row where the
-- row's own user_id belongs to the server's owner, regardless of who's
-- asking, before evaluating the existing self/owner clauses at all.
--
-- Reuses is_server_owner(server_id, user_id) exactly as already defined —
-- its second parameter already accepts an explicit user id instead of only
-- defaulting to auth.uid(), so no new function is needed. Does not touch
-- server_members INSERT, accept_invite, roles, or permissions.
drop policy if exists "users can leave or be removed by the owner" on public.server_members;

create policy "members can leave, owner can remove others, owner cannot remove self"
  on public.server_members for delete
  to authenticated
  using (
    not public.is_server_owner(server_id, user_id)
    and (user_id = auth.uid() or public.is_server_owner(server_id))
  );
