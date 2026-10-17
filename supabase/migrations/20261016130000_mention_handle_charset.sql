-- Handles vêm da parte local do e-mail (+ "_xxxx"), então podem ter "-",
-- "+", "." e "_". A versão anterior só casava [A-Za-z0-9_.] e perdia
-- menções como @joao-silva_ab12. Pontuação no fim ("@joao.") é ignorada.
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
  from regexp_matches(coalesce(new.content, ''), '@([A-Za-z0-9_.+-]{2,64})', 'g') as m(h)
  join public.profiles p
    on lower(p.handle) = lower(m.h[1]) or lower(p.handle) = lower(rtrim(m.h[1], '.-+'))
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
