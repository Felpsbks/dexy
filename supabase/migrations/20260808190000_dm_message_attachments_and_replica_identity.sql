-- File attachments on DM messages, mirroring message_attachments/the
-- 'attachments' bucket but scoped to DM conversations instead of channels.
create table public.dm_message_attachments (
  id uuid primary key default gen_random_uuid(),
  dm_message_id uuid not null references public.dm_messages (id) on delete cascade,
  path text not null,
  name text not null,
  type text not null,
  size bigint not null,
  created_at timestamptz not null default now()
);

alter table public.dm_message_attachments enable row level security;

create policy "participants can view dm attachments"
  on public.dm_message_attachments for select
  to authenticated
  using (
    exists (
      select 1 from public.dm_messages m
      where m.id = dm_message_id and public.is_dm_participant(m.conversation_id)
    )
  );

create policy "authors can add attachments to their dm messages"
  on public.dm_message_attachments for insert
  to authenticated
  with check (
    exists (select 1 from public.dm_messages where id = dm_message_id and author_id = auth.uid())
  );

create policy "authors can delete their dm attachments"
  on public.dm_message_attachments for delete
  to authenticated
  using (
    exists (select 1 from public.dm_messages where id = dm_message_id and author_id = auth.uid())
  );

alter publication supabase_realtime add table public.dm_message_attachments;

-- Private bucket, same shape as 'attachments': path is "{conversationId}/{uuid}-{name}"
-- so storage RLS can check participation directly off the first path segment.
insert into storage.buckets (id, name, public)
values ('dm-attachments', 'dm-attachments', false)
on conflict (id) do nothing;

create policy "participants can read dm attachment files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'dm-attachments'
    and public.is_dm_participant(((storage.foldername(name))[1])::uuid)
  );

create policy "participants can upload dm attachment files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'dm-attachments'
    and public.is_dm_participant(((storage.foldername(name))[1])::uuid)
  );

create policy "uploaders can delete their dm attachment files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'dm-attachments' and owner = auth.uid());

-- The chat views now page messages instead of fetching a whole conversation's
-- history at once, and realtime updates are applied by patching the already-
-- loaded pages directly (see useMessages/useDmMessages) rather than
-- re-fetching everything on every change. For that patch to work on a
-- reaction/attachment DELETE, the realtime payload's "old" row needs to still
-- carry message_id/dm_message_id — which requires REPLICA IDENTITY FULL,
-- since the default (primary key only) would only give us the deleted row's
-- own id.
alter table public.message_reactions replica identity full;
alter table public.message_attachments replica identity full;
alter table public.dm_message_reactions replica identity full;
alter table public.dm_message_attachments replica identity full;
