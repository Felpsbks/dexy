-- Etapa 4A Step 8: server_members.role_id changes already propagate to
-- other tabs via the existing server_members realtime subscription
-- (useMembers) — no change needed there. But editing a role's own name/
-- color (UPDATE on server_roles) does NOT touch server_members at all, so
-- without this, a role rename/recolor by the owner would silently not
-- reflect in other tabs' member badges until an unrelated members refetch.
-- Adding server_roles to the publication (same idempotent guard pattern as
-- dm_message_reactions/message_attachments) closes that gap.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'server_roles'
  ) then
    alter publication supabase_realtime add table public.server_roles;
  end if;
end $$;
