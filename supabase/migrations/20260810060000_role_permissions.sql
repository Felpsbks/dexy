-- Etapa 5.1 — Fundação de permissões. Pure foundation: this migration only
-- adds storage. It does NOT touch any existing RLS on channels/server_roles/
-- server_members/server_invites/messages/servers, and grants no
-- authorization power to anything yet — has_permission() (next migration)
-- is not called from any existing policy or RPC in this phase.
--
-- Model: Option B from the permissions audit (role_permissions table, one
-- row per granted/denied permission), single role per member (reuses
-- server_members.role_id exactly as-is — no member_roles junction table).
-- Absence of a row = denied, by product decision (default deny).
--
-- Catalog is intentionally closed via CHECK, not an open text column —
-- these 6 values are exactly the 6 operations named in the permissions
-- audit as needing control (gerenciar canais / convites / expulsar membros
-- / gerenciar cargos / atribuir cargos / moderar mensagens). Adding a 7th
-- permission later is a deliberate migration (widen this constraint), not
-- a silent app-level convention — matches the explicit instruction not to
-- invent permissions that don't map to an audited operation.
create table public.role_permissions (
  role_id uuid not null references public.server_roles (id) on delete cascade,
  permission text not null check (permission in (
    'manage_channels',
    'manage_invites',
    'kick_members',
    'manage_roles',
    'assign_roles',
    'moderate_messages'
  )),
  allow boolean not null default true,
  primary key (role_id, permission)
);

alter table public.role_permissions enable row level security;

-- Owner-only, end to end — mirrors "owners can manage server roles"
-- exactly, joined through server_roles since this table has no server_id
-- column of its own. `for all` already covers select, so there is no
-- separate members-can-view policy: nothing reads this table from the
-- frontend yet this phase (no usePermissions(), no permissions UI), so
-- there's no reason to expose it beyond the owner before that exists.
-- has_permission() itself is SECURITY DEFINER and bypasses this entirely,
-- so this RLS never blocks the one thing that actually needs to read every
-- role's permissions regardless of who's asking.
create policy "owners can manage role permissions"
  on public.role_permissions for all
  to authenticated
  using (
    exists (
      select 1 from public.server_roles sr
      where sr.id = role_permissions.role_id and public.is_server_owner(sr.server_id)
    )
  )
  with check (
    exists (
      select 1 from public.server_roles sr
      where sr.id = role_permissions.role_id and public.is_server_owner(sr.server_id)
    )
  );

-- Not added to the supabase_realtime publication in this migration.
-- Nothing consumes this table yet (no frontend hook, no UI) — there is
-- nothing to keep in sync live. Same deferral already used for
-- server_invites (Etapa 1) and server_roles before Etapa 4A's members UI
-- needed it: realtime gets added in the migration that introduces the
-- first real consumer, not preemptively.
