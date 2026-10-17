-- Respostas (reply) em mensagens de canal e de DM, e notificação de
-- @menção em canais de servidor (como no Discord).

alter table public.messages
  add column if not exists reply_to_id uuid references public.messages (id) on delete set null;
alter table public.dm_messages
  add column if not exists reply_to_id uuid references public.dm_messages (id) on delete set null;

create index if not exists messages_reply_to_id_idx on public.messages (reply_to_id);
create index if not exists dm_messages_reply_to_id_idx on public.dm_messages (reply_to_id);

-- A mensagem citada tem que estar no mesmo canal / na mesma conversa:
-- impede usar reply_to_id pra "vazar" uma mensagem de outro lugar.
create or replace function public.validate_message_reply()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.reply_to_id is null then
    return new;
  end if;
  if tg_table_name = 'messages' then
    if not exists (select 1 from public.messages where id = new.reply_to_id and channel_id = new.channel_id) then
      raise exception 'reply_to_id must reference a message in the same channel';
    end if;
  else
    if not exists (select 1 from public.dm_messages where id = new.reply_to_id and conversation_id = new.conversation_id) then
      raise exception 'reply_to_id must reference a message in the same conversation';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists messages_validate_reply on public.messages;
create trigger messages_validate_reply
  before insert or update of reply_to_id on public.messages
  for each row execute function public.validate_message_reply();

drop trigger if exists dm_messages_validate_reply on public.dm_messages;
create trigger dm_messages_validate_reply
  before insert or update of reply_to_id on public.dm_messages
  for each row execute function public.validate_message_reply();

-- @handle numa mensagem de canal notifica a pessoa, se ela for membro do
-- servidor e não for o próprio autor. Responder alguém também notifica.
create or replace function public.notify_channel_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_server uuid;
  v_channel text;
  v_sender text;
  v_reply_author uuid;
begin
  select c.server_id, c.name into v_server, v_channel from public.channels c where c.id = new.channel_id;
  select name into v_sender from public.profiles where id = new.author_id;

  insert into public.notifications (user_id, text, type, related_id)
  select distinct p.id, v_sender || ' mencionou você em #' || v_channel, 'mention', new.channel_id
  from regexp_matches(coalesce(new.content, ''), '@([A-Za-z0-9_.]{2,32})', 'g') as m(h)
  join public.profiles p on lower(p.handle) = lower(m.h[1])
  where p.id <> new.author_id
    and public.is_server_member(v_server, p.id);

  if new.reply_to_id is not null then
    select author_id into v_reply_author from public.messages where id = new.reply_to_id;
    if v_reply_author is not null and v_reply_author <> new.author_id
       and not exists (
         select 1 from public.notifications
         where user_id = v_reply_author and type = 'mention' and related_id = new.channel_id
           and created_at > now() - interval '2 seconds'
       ) then
      insert into public.notifications (user_id, text, type, related_id)
      values (v_reply_author, v_sender || ' respondeu você em #' || v_channel, 'mention', new.channel_id);
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists on_channel_message_mentions on public.messages;
create trigger on_channel_message_mentions
  after insert on public.messages
  for each row execute function public.notify_channel_mentions();
