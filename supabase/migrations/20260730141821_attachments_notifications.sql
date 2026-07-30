-- File attachments on channel messages, plus real (trigger-driven)
-- notifications for DMs and friend requests.

create table public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.messages (id) on delete cascade,
  path text not null,
  name text not null,
  type text not null,
  size bigint not null,
  created_at timestamptz not null default now()
);

alter table public.message_attachments enable row level security;

create policy "channel members can view attachments"
  on public.message_attachments for select
  to authenticated
  using (public.is_message_channel_member(message_id));

create policy "authors can add attachments to their messages"
  on public.message_attachments for insert
  to authenticated
  with check (
    exists (select 1 from public.messages where id = message_id and author_id = auth.uid())
  );

create policy "authors can delete their attachments"
  on public.message_attachments for delete
  to authenticated
  using (
    exists (select 1 from public.messages where id = message_id and author_id = auth.uid())
  );

alter publication supabase_realtime add table public.message_attachments;

-- Private bucket: attachments are only as visible as the messages they belong to.
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;

create policy "channel members can read attachment files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'attachments'
    and public.is_channel_member(((storage.foldername(name))[1])::uuid)
  );

create policy "channel members can upload attachment files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'attachments'
    and public.is_channel_member(((storage.foldername(name))[1])::uuid)
  );

create policy "uploaders can delete their attachment files"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'attachments' and owner = auth.uid());

-- Notifications: add routing columns so a click can jump to the right place.
alter table public.notifications
  add column type text not null default 'generic',
  add column related_id uuid;

create function public.notify_dm_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  recipient uuid;
  sender_name text;
begin
  select case when user_a = new.author_id then user_b else user_a end
    into recipient
    from public.dm_conversations where id = new.conversation_id;

  select name into sender_name from public.profiles where id = new.author_id;

  insert into public.notifications (user_id, text, type, related_id)
  values (recipient, sender_name || ' te enviou uma mensagem', 'dm_message', new.conversation_id);
  return new;
end;
$$;

create trigger on_dm_message_created
  after insert on public.dm_messages
  for each row execute procedure public.notify_dm_message();

create function public.notify_friend_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  sender_name text;
begin
  if new.status = 'pending' then
    select name into sender_name from public.profiles where id = new.user_id;
    insert into public.notifications (user_id, text, type, related_id)
    values (new.friend_id, sender_name || ' quer ser seu amigo', 'friend_request', new.user_id);
  end if;
  return new;
end;
$$;

create trigger on_friend_request_created
  after insert on public.friendships
  for each row execute procedure public.notify_friend_request();
