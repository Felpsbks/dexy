-- Fixar mensagens, threads em canais, status personalizado e atividade.
-- pinned_by não tem FK de propósito: uma segunda relação messages->profiles
-- deixaria o embed author:profiles(*) ambíguo e quebraria toda leitura.

alter table public.messages
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by uuid,
  add column if not exists thread_root_id uuid references public.messages (id) on delete cascade;
alter table public.dm_messages
  add column if not exists pinned_at timestamptz,
  add column if not exists pinned_by uuid;

create index if not exists messages_thread_root_id_idx on public.messages (thread_root_id);
create index if not exists messages_pinned_idx on public.messages (channel_id) where pinned_at is not null;
create index if not exists dm_messages_pinned_idx on public.dm_messages (conversation_id) where pinned_at is not null;

alter table public.profiles
  add column if not exists custom_status text check (char_length(custom_status) <= 128),
  add column if not exists activity text check (char_length(activity) <= 64);

-- Fixar em canal: dono ou quem tem moderate_messages. A policy de UPDATE de
-- messages é só do autor, por isso a função.
create or replace function public.set_message_pinned(p_message_id uuid, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server uuid;
begin
  select c.server_id into v_server
  from public.messages m join public.channels c on c.id = m.channel_id
  where m.id = p_message_id;
  if v_server is null then
    raise exception 'message not found';
  end if;
  if not (public.is_server_owner(v_server, auth.uid()) or public.has_permission(v_server, 'moderate_messages')) then
    raise exception 'not allowed to pin messages here';
  end if;
  update public.messages
  set pinned_at = case when p_pinned then now() end,
      pinned_by = case when p_pinned then auth.uid() end
  where id = p_message_id;
end;
$$;

-- Em DM, qualquer um dos dois participantes.
create or replace function public.set_dm_message_pinned(p_message_id uuid, p_pinned boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_conv uuid;
begin
  select conversation_id into v_conv from public.dm_messages where id = p_message_id;
  if v_conv is null or not public.is_dm_participant(v_conv) or public.is_dm_blocked(v_conv) then
    raise exception 'not allowed to pin this message';
  end if;
  update public.dm_messages
  set pinned_at = case when p_pinned then now() end,
      pinned_by = case when p_pinned then auth.uid() end
  where id = p_message_id;
end;
$$;

revoke all on function public.set_message_pinned(uuid, boolean) from public, anon;
revoke all on function public.set_dm_message_pinned(uuid, boolean) from public, anon;
grant execute on function public.set_message_pinned(uuid, boolean) to authenticated;
grant execute on function public.set_dm_message_pinned(uuid, boolean) to authenticated;

-- Thread: a raiz tem que ser do mesmo canal e não pode ser ela mesma de thread.
create or replace function public.validate_message_thread()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.thread_root_id is null then
    return new;
  end if;
  if not exists (
    select 1 from public.messages
    where id = new.thread_root_id and channel_id = new.channel_id and thread_root_id is null
  ) then
    raise exception 'thread_root_id must be a top-level message in the same channel';
  end if;
  return new;
end;
$$;

drop trigger if exists messages_validate_thread on public.messages;
create trigger messages_validate_thread
  before insert or update of thread_root_id on public.messages
  for each row execute function public.validate_message_thread();
