-- Server invites — foundation only (this migration). No RPC yet: create_invite
-- and accept_invite are a separate, later step (Etapa 2), once this schema is
-- validated. Direct client INSERT/UPDATE/DELETE against this table is
-- restricted to the server owner via RLS below; the accept flow will run as
-- a SECURITY DEFINER RPC that bypasses these policies entirely (same
-- mechanism as create_server), so a normal member/stranger never gets a
-- direct-write path to this table, and this migration does NOT reopen the
-- public "users can join a server" INSERT policy on server_members that
-- 20260809010000_lock_down_server_members_insert.sql intentionally removed.
create table public.server_invites (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers (id) on delete cascade,
  code text not null unique,
  created_by uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- null = never expires / never revoked / unlimited uses. Nullable instead
  -- of a sentinel value (e.g. 0 or far-future date) so "no limit" reads
  -- unambiguously in every query, including inside the future accept_invite
  -- RPC's validation checks.
  expires_at timestamptz,
  max_uses int,
  use_count int not null default 0,
  revoked_at timestamptz,
  constraint server_invites_max_uses_positive check (max_uses is null or max_uses > 0),
  constraint server_invites_use_count_non_negative check (use_count >= 0),
  -- Defense in depth against the last-use race the accept_invite RPC (next
  -- step) is responsible for preventing with a guarded atomic UPDATE: even
  -- if that RPC ever had a bug, the database itself refuses to store a
  -- use_count past max_uses.
  constraint server_invites_use_count_within_max_uses check (max_uses is null or use_count <= max_uses),
  -- Loose sanity bound on the code shape. The actual generation strategy
  -- (alphabet, length) is an accept_invite/create_invite RPC decision for
  -- the next step, not something this migration should lock in — this only
  -- rejects empty-string/garbage values, not enforce a specific format.
  constraint server_invites_code_length check (char_length(code) between 6 and 64)
);

create index server_invites_server_id_idx on public.server_invites (server_id);

alter table public.server_invites enable row level security;

-- Management (list/create/revoke/delete) is owner-only, mirroring
-- "owners can manage channels": is_server_owner() already proved reliable
-- for direct client INSERT/UPDATE/DELETE (unlike the raw owner_id=auth.uid()
-- comparison on servers itself), so no RPC is needed for these operations.
-- Only the higher-stakes, multi-step accept flow (validate expiry/limit/
-- revocation/membership, then insert into server_members, then increment
-- use_count, all atomically) is deferred to a SECURITY DEFINER RPC in the
-- next step — not because owner-scoped RLS here is unreliable, but because
-- accept_invite runs as a DIFFERENT, non-owner user who has no business
-- having any direct policy access to this table at all.
create policy "owners can view their server invites"
  on public.server_invites for select
  to authenticated
  using (public.is_server_owner(server_id));

create policy "owners can create invites for their servers"
  on public.server_invites for insert
  to authenticated
  with check (public.is_server_owner(server_id) and created_by = auth.uid());

create policy "owners can update their server invites"
  on public.server_invites for update
  to authenticated
  using (public.is_server_owner(server_id))
  with check (public.is_server_owner(server_id));

create policy "owners can delete their server invites"
  on public.server_invites for delete
  to authenticated
  using (public.is_server_owner(server_id));

-- Deliberately no SELECT policy for non-owners (member, stranger, or anon).
-- The "logged-out preview" and "accept by code" flows both need to read a
-- single invite row by its code regardless of who's asking — that will be
-- a SECURITY DEFINER RPC in a later step (bypasses RLS by design, same as
-- accept_invite), not a public/anon RLS policy. Keeping this table private
-- end-to-end means the invite `code` itself is the only thing that grants
-- any visibility into it, and only through a function that validates it
-- properly (expiry/revocation/limit) before returning anything.
--
-- Not added to the supabase_realtime publication in this migration either
-- — no UI consumes it yet, and that's a one-line addition to bring in
-- later if/when an owner-facing "manage invites" screen needs live updates.
