-- Etapa 6.9 — fecha a lacuna de concorrência encontrada na auditoria da
-- Etapa 6.8: nada impedia múltiplas dm_calls 'ringing'/'active' simultâneas
-- para a mesma conversa (confirmado empiricamente: duas abas, ou os dois
-- participantes ligando ao mesmo tempo, sempre criavam linhas concorrentes,
-- e a mais antiga ficava presa em 'ringing' pra sempre, já que a auto-cura
-- em livekit.ts só olha a linha mais recente).
--
-- Antes desta migration, 26 linhas conflitantes (13 'ringing' + 13 'active',
-- todas de contas de teste desta própria auditoria) foram convertidas pra
-- um estado terminal via UPDATE aprovado explicitamente pelo usuário —
-- 'ringing' -> 'missed' (nunca atendida), 'active' -> 'ended' (chegou a
-- ficar ativa) — sem nenhum DELETE, sem tocar em started_by/conversation_id/
-- kind/started_at/answered_at, e passando pelo trigger de transição da
-- Etapa 6.5 normalmente (nenhuma alteração nele).
--
-- Garantia que este índice passa a dar, no banco, não só na UI: para uma
-- conversation_id, nunca existe mais de uma dm_calls em ringing OU active
-- ao mesmo tempo. Chamadas ended/declined/missed continuam sem limite,
-- preservando o histórico normalmente.
create unique index dm_calls_one_ringing_or_active_per_conversation
  on public.dm_calls (conversation_id)
  where status in ('ringing', 'active');
