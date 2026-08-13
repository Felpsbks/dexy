-- Etapa 5.2, Grupo 2 — channels gains a permission-based path alongside the
-- owner, same OR-not-replace shape as Grupo 1. Covers create/edit/delete
-- (direct policy) and reorder (upsert hits the same `for all` policy's
-- update branch — useReorderChannels has no separate mechanism).
drop policy if exists "owners can manage channels" on public.channels;

create policy "owners and manage_channels holders can manage channels"
  on public.channels for all
  to authenticated
  using (public.is_server_owner(server_id) or public.has_permission(server_id, 'manage_channels'))
  with check (public.is_server_owner(server_id) or public.has_permission(server_id, 'manage_channels'));
