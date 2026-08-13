-- Etapa 6.10 — achado 🟡 2 da auditoria final da Fase 6: a policy de INSERT
-- do bucket de storage 'dm-attachments' só checava is_dm_participant, nunca
-- is_dm_blocked — confirmado empiricamente que um usuário bloqueado
-- conseguia fazer upload físico do arquivo (só não conseguia criar a linha
-- em dm_message_attachments, já protegida desde a 6.4). Sem impacto de
-- vazamento de dado (leitura continua exigindo is_dm_participant), mas
-- fechava incompleto o bloqueio.
--
-- Mesma função is_dm_blocked já usada em dm_messages/dm_calls (6.4/6.5),
-- aplicada aqui só na policy de INSERT — SELECT/download não é tocado.
drop policy "participants can upload dm attachment files" on storage.objects;

create policy "participants can upload dm attachment files"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'dm-attachments'
    and public.is_dm_participant(((storage.foldername(name))[1])::uuid)
    and not public.is_dm_blocked(((storage.foldername(name))[1])::uuid)
  );
