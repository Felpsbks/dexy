-- 1:1 DM calls (LiveKit-backed) and per-user read state for DM conversations.

create table public.dm_calls (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.dm_conversations (id) on delete cascade,
  started_by uuid not null references public.profiles (id) on delete cascade,
  kind text not null default 'audio',
  status text not null default 'ringing',
  started_at timestamptz not null default now(),
  answered_at timestamptz,
  ended_at timestamptz
);

create index dm_calls_conversation_id_started_at_idx on public.dm_calls (conversation_id, started_at);

alter table public.dm_calls enable row level security;

create policy "participants can view their dm calls"
  on public.dm_calls for select
  to authenticated
  using (public.is_dm_participant(conversation_id));

create policy "participants can start dm calls"
  on public.dm_calls for insert
  to authenticated
  with check (started_by = auth.uid() and public.is_dm_participant(conversation_id));

create policy "participants can update their dm calls"
  on public.dm_calls for update
  to authenticated
  using (public.is_dm_participant(conversation_id));

alter publication supabase_realtime add table public.dm_calls;

-- Per-user read tracking, one row per (conversation, user).
create table public.dm_read_state (
  conversation_id uuid not null references public.dm_conversations (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table public.dm_read_state enable row level security;

create policy "users can view their own dm read state"
  on public.dm_read_state for select
  to authenticated
  using (user_id = auth.uid());

create policy "users can upsert their own dm read state"
  on public.dm_read_state for insert
  to authenticated
  with check (user_id = auth.uid() and public.is_dm_participant(conversation_id));

create policy "users can update their own dm read state"
  on public.dm_read_state for update
  to authenticated
  using (user_id = auth.uid());

alter publication supabase_realtime add table public.dm_read_state;
