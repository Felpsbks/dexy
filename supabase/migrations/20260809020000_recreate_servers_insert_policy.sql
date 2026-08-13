-- DIAGNOSTIC FIX: `owner_id = auth.uid()` INSERT on public.servers has been
-- rejected by RLS for every authenticated user, even when owner_id exactly
-- matches auth.uid() (verified via pg_policies — the live policy text is
-- byte-identical to the one below — and via Postgres logs showing PostgREST
-- sending a well-formed INSERT with the correct owner_id). Every other
-- angle checked out: RLS enabled correctly, no triggers, no unexpected
-- constraints, base table GRANT present.
--
-- Leading hypothesis: a stale cached query plan on a pooled connection
-- (Supabase sits behind PgBouncer) evaluating against an older version of
-- this policy that predates whatever change produced the current, correct
-- text in pg_policies — pg_policies always reflects the current catalog
-- state, not what a given pooled backend has cached. Dropping and
-- recreating the policy (identical definition, not a behavior change)
-- forces Postgres to bump the relation's cache-invalidation counter, which
-- makes every backend discard cached plans for this table.
drop policy if exists "authenticated users can create servers" on public.servers;

create policy "authenticated users can create servers"
  on public.servers for insert
  to authenticated
  with check (owner_id = auth.uid());
