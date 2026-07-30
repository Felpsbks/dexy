-- Direct messages between friends. Friend requests already work off the
-- existing `friendships` table; this adds 1:1 conversations on top of it.

create table public.dm_conversations (
  id uuid primary key default gen_random_uuid(),
  user_a uuid not null references public.profiles (id) on delete cascade,
  user_b uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (user_a, user_b),
  check (user_a < user_b)
);

create table public.dm_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dm_conversations (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create index dm_messages_conversation_id_created_at_idx on public.dm_messages (conversation_id, created_at);

-- Creates (or returns the existing) canonical conversation between the caller
-- and another user. Requires an accepted friendship — DMs are friends-only.
create function public.get_or_create_dm(other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  a uuid;
  b uuid;
  conv_id uuid;
begin
  if me is null then
    raise exception 'Not authenticated';
  end if;
  if me = other_user_id then
    raise exception 'Cannot start a DM with yourself';
  end if;

  if not exists (
    select 1 from public.friendships
    where status = 'accepted'
      and ((user_id = me and friend_id = other_user_id)
        or (user_id = other_user_id and friend_id = me))
  ) then
    raise exception 'You must be friends to start a direct message';
  end if;

  a := least(me, other_user_id);
  b := greatest(me, other_user_id);

  insert into public.dm_conversations (user_a, user_b)
  values (a, b)
  on conflict (user_a, user_b) do nothing;

  select id into conv_id from public.dm_conversations where user_a = a and user_b = b;
  return conv_id;
end;
$$;

create function public.is_dm_participant(p_conversation_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.dm_conversations
    where id = p_conversation_id and (user_a = p_user_id or user_b = p_user_id)
  );
$$;

alter table public.dm_conversations enable row level security;
alter table public.dm_messages enable row level security;

-- Conversations are only ever created via get_or_create_dm (SECURITY DEFINER),
-- so the only policy needed here is read access for the two participants.
create policy "participants can view their dm conversations"
  on public.dm_conversations for select
  to authenticated
  using (auth.uid() = user_a or auth.uid() = user_b);

create policy "participants can view dm messages"
  on public.dm_messages for select
  to authenticated
  using (public.is_dm_participant(conversation_id));

create policy "participants can send dm messages"
  on public.dm_messages for insert
  to authenticated
  with check (author_id = auth.uid() and public.is_dm_participant(conversation_id));

create policy "authors can edit their dm messages"
  on public.dm_messages for update
  to authenticated
  using (author_id = auth.uid());

create policy "authors can delete their dm messages"
  on public.dm_messages for delete
  to authenticated
  using (author_id = auth.uid());

alter publication supabase_realtime add table
  public.dm_conversations,
  public.dm_messages;
