-- Fynix core schema: profiles, servers, channels, messages, reactions, roles, friendships, notifications.

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  handle text not null unique,
  avatar_url text,
  banner_url text,
  bio text not null default '',
  status text not null default 'offline' check (status in ('online', 'idle', 'dnd', 'offline')),
  created_at timestamptz not null default now()
);

create table public.servers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  icon_initial text,
  color text,
  owner_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.server_roles (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers (id) on delete cascade,
  name text not null,
  color text,
  position int not null default 0
);

create table public.server_members (
  server_id uuid not null references public.servers (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role_id uuid references public.server_roles (id) on delete set null,
  joined_at timestamptz not null default now(),
  primary key (server_id, user_id)
);

create table public.channels (
  id uuid primary key default gen_random_uuid(),
  server_id uuid not null references public.servers (id) on delete cascade,
  name text not null,
  type text not null check (type in ('text', 'voice', 'forum')),
  category text not null default 'Geral',
  topic text,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  channel_id uuid not null references public.channels (id) on delete cascade,
  author_id uuid not null references public.profiles (id) on delete cascade,
  content text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz
);

create table public.message_reactions (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  unique (message_id, user_id, emoji)
);

create table public.friendships (
  user_id uuid not null references public.profiles (id) on delete cascade,
  friend_id uuid not null references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'blocked')),
  created_at timestamptz not null default now(),
  primary key (user_id, friend_id),
  check (user_id <> friend_id)
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  text text not null,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create index messages_channel_id_created_at_idx on public.messages (channel_id, created_at);
create index channels_server_id_idx on public.channels (server_id);
create index server_members_user_id_idx on public.server_members (user_id);
create index message_reactions_message_id_idx on public.message_reactions (message_id);
create index notifications_user_id_idx on public.notifications (user_id) where not read;

-- Auto-create a profile row whenever a new auth user signs up.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, handle, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'handle', split_part(new.email, '@', 1) || '_' || substr(new.id::text, 1, 4)),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Membership helpers, defined SECURITY DEFINER so RLS policies that call them
-- don't recursively re-check RLS on server_members while evaluating server_members' own policies.
create function public.is_server_member(p_server_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.server_members
    where server_id = p_server_id and user_id = p_user_id
  );
$$;

create function public.is_server_owner(p_server_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.servers
    where id = p_server_id and owner_id = p_user_id
  );
$$;

create function public.is_channel_member(p_channel_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.channels c
    join public.server_members sm on sm.server_id = c.server_id
    where c.id = p_channel_id and sm.user_id = p_user_id
  );
$$;

create function public.is_message_channel_member(p_message_id uuid, p_user_id uuid default auth.uid())
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.messages m
    join public.channels c on c.id = m.channel_id
    join public.server_members sm on sm.server_id = c.server_id
    where m.id = p_message_id and sm.user_id = p_user_id
  );
$$;

alter table public.profiles enable row level security;
alter table public.servers enable row level security;
alter table public.server_roles enable row level security;
alter table public.server_members enable row level security;
alter table public.channels enable row level security;
alter table public.messages enable row level security;
alter table public.message_reactions enable row level security;
alter table public.friendships enable row level security;
alter table public.notifications enable row level security;

-- profiles: readable by any signed-in user, editable only by the owner.
create policy "profiles are readable by authenticated users"
  on public.profiles for select
  to authenticated
  using (true);

create policy "users can update their own profile"
  on public.profiles for update
  to authenticated
  using (auth.uid() = id);

-- servers: visible to members, creatable by any signed-in user, mutable only by the owner.
create policy "members can view their servers"
  on public.servers for select
  to authenticated
  using (public.is_server_member(id));

create policy "authenticated users can create servers"
  on public.servers for insert
  to authenticated
  with check (owner_id = auth.uid());

create policy "owners can update their servers"
  on public.servers for update
  to authenticated
  using (owner_id = auth.uid());

create policy "owners can delete their servers"
  on public.servers for delete
  to authenticated
  using (owner_id = auth.uid());

-- server_roles: visible to members, managed only by the owner.
create policy "members can view server roles"
  on public.server_roles for select
  to authenticated
  using (public.is_server_member(server_id));

create policy "owners can manage server roles"
  on public.server_roles for all
  to authenticated
  using (public.is_server_owner(server_id))
  with check (public.is_server_owner(server_id));

-- server_members: visible to other members; users can join/leave themselves, owners can remove anyone.
create policy "members can view server rosters"
  on public.server_members for select
  to authenticated
  using (public.is_server_member(server_id));

create policy "users can join a server"
  on public.server_members for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "users can leave or be removed by the owner"
  on public.server_members for delete
  to authenticated
  using (user_id = auth.uid() or public.is_server_owner(server_id));

-- channels: visible to members, managed only by the owner.
create policy "members can view channels"
  on public.channels for select
  to authenticated
  using (public.is_server_member(server_id));

create policy "owners can manage channels"
  on public.channels for all
  to authenticated
  using (public.is_server_owner(server_id))
  with check (public.is_server_owner(server_id));

-- messages: visible to channel members; authors write/edit/delete their own.
create policy "channel members can view messages"
  on public.messages for select
  to authenticated
  using (public.is_channel_member(channel_id));

create policy "channel members can send messages"
  on public.messages for insert
  to authenticated
  with check (author_id = auth.uid() and public.is_channel_member(channel_id));

create policy "authors can edit their messages"
  on public.messages for update
  to authenticated
  using (author_id = auth.uid());

create policy "authors can delete their messages"
  on public.messages for delete
  to authenticated
  using (author_id = auth.uid());

-- message_reactions: visible to channel members; users manage only their own reactions.
create policy "channel members can view reactions"
  on public.message_reactions for select
  to authenticated
  using (public.is_message_channel_member(message_id));

create policy "channel members can react"
  on public.message_reactions for insert
  to authenticated
  with check (user_id = auth.uid() and public.is_message_channel_member(message_id));

create policy "users can remove their own reactions"
  on public.message_reactions for delete
  to authenticated
  using (user_id = auth.uid());

-- friendships: only the two parties involved can see or manage the relationship.
create policy "participants can view their friendships"
  on public.friendships for select
  to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_id);

create policy "users can send friend requests"
  on public.friendships for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "participants can update friendship status"
  on public.friendships for update
  to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_id);

create policy "participants can remove a friendship"
  on public.friendships for delete
  to authenticated
  using (auth.uid() = user_id or auth.uid() = friend_id);

-- notifications: strictly private to their owner; created by trusted server-side code only.
create policy "users can view their own notifications"
  on public.notifications for select
  to authenticated
  using (auth.uid() = user_id);

create policy "users can update their own notifications"
  on public.notifications for update
  to authenticated
  using (auth.uid() = user_id);

create policy "users can delete their own notifications"
  on public.notifications for delete
  to authenticated
  using (auth.uid() = user_id);

-- Realtime: stream inserts/updates/deletes for live chat, presence and rosters.
alter publication supabase_realtime add table
  public.messages,
  public.message_reactions,
  public.channels,
  public.servers,
  public.server_members,
  public.profiles,
  public.notifications;
