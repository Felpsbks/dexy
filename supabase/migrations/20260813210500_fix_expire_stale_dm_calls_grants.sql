-- Correção imediata à migration anterior (20260813210000). `revoke all on
-- function ... from public` não é suficiente neste projeto: Supabase
-- concede EXECUTE em funções novas do schema public diretamente pra
-- `anon`/`authenticated`/`service_role` via privilégios padrão do schema,
-- não por herança de PUBLIC -- confirmado consultando
-- information_schema.routine_privileges logo após aplicar a migration
-- anterior: anon e authenticated ainda apareciam com EXECUTE, exatamente o
-- que o pedido original queria evitar ("não possa ser chamada de forma
-- indevida por usuários comuns").
--
-- Revoga explicitamente de anon/authenticated (os papéis que representam
-- sessões de usuário real via chave anônima/JWT) -- mantém postgres
-- (dono da função, usado pelo pg_cron) intacto.

revoke execute on function public.expire_stale_dm_calls() from anon;
revoke execute on function public.expire_stale_dm_calls() from authenticated;
