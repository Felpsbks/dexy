-- Fase 7.6, item 8 (aprovado explicitamente, migration separada da do
-- item 4) — a limpeza de dm_calls órfãs (expireStaleCall, src/lib/livekit.ts)
-- só roda no cliente, sob demanda, quando alguém abre a conversa em questão.
-- Confirmado empiricamente na Fase 7.5 (fechar a aba durante uma chamada
-- ativa e esperar ~5min30s reais): a linha fica 'active' indefinidamente até
-- alguém reabrir aquela conversa específica -- sem isso, nunca se resolve
-- sozinha.
--
-- Verificação de infraestrutura feita antes desta migration (consulta
-- somente leitura, sem alterar nada):
-- - pg_cron já instalado no projeto (extversion 1.6.4), habilitado pela
--   migration 20260812180000_guest_accounts.sql -- create extension
--   abaixo é só idempotência (if not exists).
-- - Único job de cron existente hoje é 'cleanup-expired-guests' -- sem
--   colisão com o nome novo 'expire-stale-dm-calls' usado aqui.
-- - Nenhuma função chamada expire_stale_dm_calls já existe.
--
-- Isto é só um BACKSTOP -- não substitui expireStaleCall() do client, que
-- continua dando resposta imediata a quem reabre a conversa. Mesmos limiares
-- já usados lá (STALE_RINGING_MS = 2 minutos, STALE_ACTIVE_MS = 5 minutos,
-- src/lib/livekit.ts) -- nenhum valor novo inventado.
--
-- Segurança:
-- - SECURITY DEFINER com search_path fixo em 'public' apenas (a função só
--   lê/escreve public.dm_calls, não precisa de mais nada).
-- - EXECUTE revogado de PUBLIC e nunca concedido a authenticated -- só o
--   agendador do pg_cron (que roda como o dono da função) deve chamar isto;
--   diferente das RPCs normais deste projeto (ex. send_friend_request), não
--   existe motivo legítimo para um usuário comum invocá-la diretamente.
-- - UPDATE só em public.dm_calls, nada mais.
-- - As mesmas duas transições já usadas pelo client (ringing->missed,
--   active->ended) e pela trigger de bloqueio (20260813200000) -- ambas já
--   permitidas para qualquer participante pela trigger
--   validate_dm_call_transition (20260810180000), sem exigir ser quem
--   iniciou a chamada -- nada aqui contorna essa máquina de estados.
-- - Idempotente: cada UPDATE tem status='ringing'/'active' no WHERE, então
--   rodar de novo sobre uma linha já transicionada é um no-op (zero linhas
--   afetadas), não um erro -- seguro de rodar repetidamente a cada minuto,
--   e sem conflito com o client rodando expireStaleCall() ao mesmo tempo
--   (quem chegar primeiro resolve a linha; o outro simplesmente não acha
--   mais nada para atualizar).

create extension if not exists pg_cron;

create function public.expire_stale_dm_calls()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.dm_calls
  set status = 'missed', ended_at = now()
  where status = 'ringing' and started_at < now() - interval '2 minutes';

  update public.dm_calls
  set status = 'ended', ended_at = now()
  where status = 'active' and started_at < now() - interval '5 minutes';
end;
$$;

revoke all on function public.expire_stale_dm_calls() from public;

select cron.schedule(
  'expire-stale-dm-calls',
  '* * * * *',
  $$select public.expire_stale_dm_calls()$$
);
