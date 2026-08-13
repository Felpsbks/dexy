-- Etapa 6.10 — achado 🟡 1 da auditoria final da Fase 6: a policy de UPDATE
-- de `notifications` não tinha WITH CHECK, então o dono da notificação
-- podia reescrever user_id/type/related_id livremente (confirmado
-- empiricamente; não era explorável hoje porque o único consumidor de
-- related_id, o deep-link de dm_message em app.tsx, já revalida contra a
-- lista de conversas do próprio usuário — mas a lacuna no banco era real).
--
-- RLS não compara OLD e NEW numa única expressão, então — mesmo padrão já
-- usado pra started_by/conversation_id em dm_calls (6.1) e user_id/friend_id
-- em friendships — isso precisa ser um trigger BEFORE UPDATE, não uma
-- policy. `read` (e `text`, não pedido pra travar) continuam livres; só os
-- três campos explicitamente listados ficam imutáveis.
create function public.prevent_notification_tamper()
returns trigger
language plpgsql
as $$
begin
  if new.user_id <> old.user_id then
    raise exception 'notifications.user_id cannot be changed';
  end if;
  if new.type <> old.type then
    raise exception 'notifications.type cannot be changed';
  end if;
  if new.related_id is distinct from old.related_id then
    raise exception 'notifications.related_id cannot be changed';
  end if;
  return new;
end;
$$;

create trigger notifications_prevent_tamper
  before update on public.notifications
  for each row execute procedure public.prevent_notification_tamper();
