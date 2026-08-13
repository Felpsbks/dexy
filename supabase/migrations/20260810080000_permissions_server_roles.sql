-- Etapa 5.2, Grupo 1 — server_roles gains a permission-based path alongside
-- the owner. Never a replacement: is_server_owner(...) stays as one branch
-- of an OR, has_permission(...) is only ever added, never substituted in.
-- Owner remains a strict superset by construction — dropping this policy
-- entirely would still leave "members can view server roles" (untouched,
-- separate policy, not part of this change) for read access.
drop policy if exists "owners can manage server roles" on public.server_roles;

create policy "owners and manage_roles holders can manage server roles"
  on public.server_roles for all
  to authenticated
  using (public.is_server_owner(server_id) or public.has_permission(server_id, 'manage_roles'))
  with check (public.is_server_owner(server_id) or public.has_permission(server_id, 'manage_roles'));
