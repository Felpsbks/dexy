-- Fase 7.6, item 4 (aprovado explicitamente) — bloquear alguém no meio de
-- uma chamada ativa não a encerrava (achado 🟠 confirmado empiricamente na
-- Fase 7.5: A liga, B aceita, chamada fica active, B bloqueia A -> a
-- chamada continuava active nos dois lados). RLS de dm_calls já impede
-- INSERT/UPDATE futuros entre pares bloqueados, mas nada derrubava uma
-- chamada que já estava em andamento no instante do bloqueio.
--
-- Esta trigger fecha esse gap: ao friendships.status virar 'blocked', encerra
-- qualquer dm_calls 'ringing'/'active' entre exatamente esse par.
--
-- Segurança/integridade preservadas:
-- - Só a transição exata pending/accepted -> blocked dispara (old.status <>
--   'blocked' guard) -- não refaz trabalho em updates subsequentes.
-- - Escopo estritamente ao par bloqueado: busca a única dm_conversations
--   entre new.user_id/new.friend_id (nas duas direções possíveis, já que
--   friendships não tem direção fixa) e só toca dm_calls daquela conversa.
--   Nenhuma outra conversa ou par é afetado.
-- - ended_at nunca é aceito do cliente -- calculado aqui com now(), igual a
--   todo o resto do fluxo de chamadas.
-- - As UPDATEs em dm_calls ainda passam pela trigger de transição existente
--   (validate_dm_call_transition, 20260810180000): ringing->missed e
--   active->ended já são transições permitidas para qualquer participante,
--   sem exigir ser quem iniciou a chamada -- nada aqui contorna essa máquina
--   de estados, só aciona uma transição já válida automaticamente.
-- - SECURITY DEFINER é necessário para escrever em dm_calls a partir de uma
--   trigger em friendships (mesmo padrão já usado por notify_friend_request/
--   notify_friend_request_accepted neste projeto) -- RLS de dm_calls
--   continua em vigor para qualquer outro caminho de escrita.

create function public.end_dm_calls_on_block()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  conv_id uuid;
begin
  if new.status <> 'blocked' or old.status = 'blocked' then
    return new;
  end if;

  select id into conv_id
  from public.dm_conversations
  where (user_a = new.user_id and user_b = new.friend_id)
     or (user_a = new.friend_id and user_b = new.user_id)
  limit 1;

  if conv_id is null then
    return new;
  end if;

  update public.dm_calls
  set status = 'missed', ended_at = now()
  where conversation_id = conv_id and status = 'ringing';

  update public.dm_calls
  set status = 'ended', ended_at = now()
  where conversation_id = conv_id and status = 'active';

  return new;
end;
$$;

create trigger on_friendship_blocked_end_calls
  after update on public.friendships
  for each row execute procedure public.end_dm_calls_on_block();
