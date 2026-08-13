-- Etapa 5.4A — adds role_permissions to the realtime publication, ahead of
-- any frontend consumer (usePermissions doesn't exist yet — that's a later
-- step). Justification: the Etapa 5.3 audit flagged this explicitly as a
-- risk to close before building the permissions hook — without it, an
-- owner editing a role's permissions in one tab would never propagate to
-- an affected member's other tab without a manual refetch, and retrofitting
-- realtime onto an already-built permission hook is more error-prone than
-- having the plumbing tested and ready first. Same idempotent guard pattern
-- already used for server_roles/dm_message_reactions/message_attachments.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'role_permissions'
  ) then
    alter publication supabase_realtime add table public.role_permissions;
  end if;
end $$;
