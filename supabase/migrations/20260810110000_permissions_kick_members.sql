-- Etapa 5.2, Grupo 4 — server_members DELETE (kick) gains a
-- permission-based path alongside the owner. Same OR-not-replace shape:
-- is_server_owner(server_id) stays as its own branch, has_permission(...)
-- is only added.
--
-- The outer guard `not is_server_owner(server_id, user_id)` is untouched
-- and still applies unconditionally to the ROW being deleted, regardless
-- of which branch below authorizes the caller — so the owner still cannot
-- be removed by anyone, including a kick_members holder. Self-leave
-- (`user_id = auth.uid()`) is also untouched: a kick_members holder
-- removing their own row still hits that same pre-existing branch, exactly
-- like a plain member leaving — RLS has no notion of "kick vs leave
-- intent", both are the same row deletion by its own owner, so this
-- doesn't introduce a new self-kick path, just doesn't try to (and can't)
-- distinguish it from voluntary leaving.
--
-- No UPDATE policy is introduced here or anywhere else — role_id remains
-- writable only through the assign_role RPC, kick remains DELETE-only.
drop policy if exists "members can leave, owner can remove others, owner cannot remove self" on public.server_members;

create policy "members can leave, owner or kick_members holders can remove others, owner cannot be removed"
  on public.server_members for delete
  to authenticated
  using (
    not public.is_server_owner(server_id, user_id)
    and (
      user_id = auth.uid()
      or public.is_server_owner(server_id)
      or public.has_permission(server_id, 'kick_members')
    )
  );
