-- Reactions on direct messages, mirroring public.message_reactions for channels.
-- Written idempotently (if-not-exists / create-or-replace / drop-then-create
-- for policies) since an earlier partial run already created some of these
-- objects on the linked project.

create table if not exists public.dm_message_reactions (
  id uuid primary key default gen_random_uuid(),
  dm_message_id uuid not null references public.dm_messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (dm_message_id, user_id, emoji)
);

create index if not exists dm_message_reactions_dm_message_id_idx on public.dm_message_reactions (dm_message_id);

create or replace function public.is_dm_message_participant(p_dm_message_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.dm_messages m
    where m.id = p_dm_message_id and public.is_dm_participant(m.conversation_id, p_user_id)
  );
$$;

alter table public.dm_message_reactions enable row level security;

-- dm_message_reactions: visible to the two conversation participants; users manage only their own reactions.
drop policy if exists "participants can view dm reactions" on public.dm_message_reactions;
create policy "participants can view dm reactions"
  on public.dm_message_reactions for select
  to authenticated
  using (public.is_dm_message_participant(dm_message_id));

drop policy if exists "participants can react to dm messages" on public.dm_message_reactions;
create policy "participants can react to dm messages"
  on public.dm_message_reactions for insert
  to authenticated
  with check (user_id = auth.uid() and public.is_dm_message_participant(dm_message_id));

drop policy if exists "users can remove their own dm reactions" on public.dm_message_reactions;
create policy "users can remove their own dm reactions"
  on public.dm_message_reactions for delete
  to authenticated
  using (user_id = auth.uid());

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'dm_message_reactions'
  ) then
    alter publication supabase_realtime add table public.dm_message_reactions;
  end if;
end $$;
