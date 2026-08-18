-- Fix: O cron expire_stale_dm_calls() usava started_at para determinar se uma
-- chamada "active" era órfã. Como started_at marca o início do RINGING (não da
-- conversa em si), chamadas legítimas eram encerradas ~5 min após o ringing
-- iniciar — ou seja, ~4:30 de conversa real (30s de ring + 4:30 ativo = 5 min
-- desde started_at).
--
-- Correção:
-- 1. Para chamadas "active", usar COALESCE(answered_at, started_at) — a
--    chamada só entra em "active" quando answered_at é preenchido, mas o
--    COALESCE cobre qualquer edge case de dados antigos sem answered_at.
-- 2. Aumentar o intervalo de 5 minutos para 6 horas — alinhado com o TTL
--    do token LiveKit. Uma chamada legítima pode durar horas; o backstop
--    existe apenas para limpar chamadas verdadeiramente órfãs (browser
--    crashou sem cleanup).
--
-- O client-side expireStaleCall() (src/lib/livekit.ts) já foi atualizado
-- para STALE_ACTIVE_MS = 6h no mesmo commit.

create or replace function public.expire_stale_dm_calls()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Ringing calls: 2 min desde started_at (inalterado — se ninguém atendeu
  -- em 2 min o ring timer do client já marcou como missed, isto é backstop).
  update public.dm_calls
  set status = 'missed', ended_at = now()
  where status = 'ringing' and started_at < now() - interval '2 minutes';

  -- Active calls: 6 horas desde answered_at (quando a conversa de fato começou).
  -- COALESCE cobre edge case de rows antigos sem answered_at preenchido.
  update public.dm_calls
  set status = 'ended', ended_at = now()
  where status = 'active'
    and coalesce(answered_at, started_at) < now() - interval '6 hours';
end;
$$;
