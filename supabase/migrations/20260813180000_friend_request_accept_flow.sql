-- Fase 2 do sistema de convites/amigos — duas correções que exigem SQL:
--
-- 1. Notificação de aceite. notify_friend_request() (20260730141821) só
--    dispara em INSERT, então quem enviou o convite nunca fica sabendo que
--    foi aceito. Trigger nova em UPDATE, guardada pela transição exata
--    pending -> accepted (nunca duplica em updates futuros da mesma linha,
--    já que depois de accepted essa condição nunca volta a ser verdadeira).
--
-- 2. Corrida de convite mútuo. O fix client-side em useSendFriendRequest
--    (check-then-act) resolve o caso sequencial, mas não fecha 100% o caso
--    de dois envios literalmente simultâneos em direções opostas — cada um
--    pode checar "não existe nada ainda" antes do outro terminar, e como
--    (user_id, friend_id) são PKs diferentes por direção, a constraint
--    unique não pega isso. send_friend_request() serializa qualquer
--    tentativa concorrente entre um par específico de usuários com um
--    advisory lock transacional, então só uma das duas pode "vencer" a
--    corrida — a outra vê o estado já resolvido e funde em accepted em vez
--    de criar uma segunda linha pending.
--
-- Nenhuma das duas amplia o que RLS já permite: cada ramo da RPC replica
-- exatamente uma operação que a policy de INSERT/UPDATE de friendships já
-- deixaria o respectivo lado fazer (insert só como dono com status
-- pending; update para accepted só quem é friend_id) — só empacota em uma
-- transação única com lock em vez de duas idas e vindas do client.

create function public.notify_friend_request_accepted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  accepter_name text;
begin
  if old.status = 'pending' and new.status = 'accepted' then
    select name into accepter_name from public.profiles where id = new.friend_id;
    insert into public.notifications (user_id, text, type, related_id)
    values (new.user_id, coalesce(accepter_name, 'Alguém') || ' aceitou seu convite de amizade', 'friend_request_accepted', new.friend_id);
  end if;
  return new;
end;
$$;

create trigger on_friend_request_accepted
  after update on public.friendships
  for each row execute procedure public.notify_friend_request_accepted();

create function public.send_friend_request(target_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  me uuid := auth.uid();
  existing record;
  updated_rows int;
begin
  if me is null then
    raise exception 'not_authenticated';
  end if;
  if me = target_id then
    raise exception 'self';
  end if;

  -- Serializa qualquer tentativa concorrente entre este par específico (em
  -- qualquer direção) até o fim desta transação, para que duas chamadas
  -- simultâneas nunca passem ambas pela checagem "não existe nada ainda".
  perform pg_advisory_xact_lock(
    hashtextextended(least(me, target_id)::text || ':' || greatest(me, target_id)::text, 0)
  );

  select fs.user_id, fs.status into existing
  from public.friendships fs
  where (fs.user_id = me and fs.friend_id = target_id)
     or (fs.user_id = target_id and fs.friend_id = me)
  limit 1;

  if existing.status = 'accepted' then
    raise exception 'already_friends';
  end if;
  if existing.status = 'blocked' then
    raise exception 'blocked';
  end if;
  if existing.user_id = me and existing.status = 'pending' then
    raise exception 'already_pending';
  end if;

  if existing.user_id = target_id and existing.status = 'pending' then
    update public.friendships
    set status = 'accepted'
    where user_id = target_id and friend_id = me and status = 'pending';
    return 'auto_accepted';
  end if;

  insert into public.friendships (user_id, friend_id) values (me, target_id);
  return 'sent';
end;
$$;

revoke all on function public.send_friend_request(uuid) from public;
grant execute on function public.send_friend_request(uuid) to authenticated;
