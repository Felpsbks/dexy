-- Etapa 5.2, Grupo 3 — server_invites RLS gains a permission-based path
-- alongside the owner, same OR-not-replace shape as Grupos 1-2. Covers all
-- 4 owner-only RLS policies on this table (select/insert/update/delete) —
-- "qualquer outra operação atualmente owner-only" per the task scope.
--
-- Deliberately NOT touched: create_invite and accept_invite RPCs. Both are
-- SECURITY DEFINER and bypass this table's RLS entirely — accept_invite
-- was explicitly excluded by product decision, and create_invite is left
-- untouched because it's an RPC, not a policy, and this etapa's scope is
-- RLS migration only. Net effect: a manage_invites holder can list/revoke/
-- delete invites (direct table access, governed by the policies below) but
-- cannot create a new one through the app's actual UI path (useCreateInvite
-- calls the create_invite RPC, which still checks is_server_owner only).
-- The INSERT policy below is still updated for consistency of the table's
-- RLS surface and as a real defense-in-depth layer for direct-table access,
-- even though it isn't the path the app currently exercises.
drop policy if exists "owners can view their server invites" on public.server_invites;
create policy "owners and manage_invites holders can view server invites"
  on public.server_invites for select
  to authenticated
  using (public.is_server_owner(server_id) or public.has_permission(server_id, 'manage_invites'));

drop policy if exists "owners can create invites for their servers" on public.server_invites;
create policy "owners and manage_invites holders can create invites"
  on public.server_invites for insert
  to authenticated
  with check (
    (public.is_server_owner(server_id) or public.has_permission(server_id, 'manage_invites'))
    and created_by = auth.uid()
  );

drop policy if exists "owners can update their server invites" on public.server_invites;
create policy "owners and manage_invites holders can update server invites"
  on public.server_invites for update
  to authenticated
  using (public.is_server_owner(server_id) or public.has_permission(server_id, 'manage_invites'))
  with check (public.is_server_owner(server_id) or public.has_permission(server_id, 'manage_invites'));

drop policy if exists "owners can delete their server invites" on public.server_invites;
create policy "owners and manage_invites holders can delete server invites"
  on public.server_invites for delete
  to authenticated
  using (public.is_server_owner(server_id) or public.has_permission(server_id, 'manage_invites'));
