-- Seed a shared default server so every new signup lands somewhere instead of an empty app,
-- and auto-join new profiles to it.

alter table public.servers alter column owner_id drop not null;

insert into public.servers (id, name, icon_initial, color, owner_id)
values ('00000000-0000-0000-0000-000000000001', 'Dexy HQ', 'D', 'from-[#00D8FF] to-[#8DFF2F]', null);

insert into public.channels (server_id, name, type, category, topic, position) values
  ('00000000-0000-0000-0000-000000000001', 'boas-vindas', 'text', 'Geral', 'Diga oi para todo mundo aqui.', 0),
  ('00000000-0000-0000-0000-000000000001', 'anuncios', 'text', 'Geral', 'Novidades oficiais da Dexy.', 1),
  ('00000000-0000-0000-0000-000000000001', 'conversa-geral', 'text', 'Comunidade', 'Papo livre, sem regras rigidas.', 2),
  ('00000000-0000-0000-0000-000000000001', 'sala-de-voz', 'voice', 'Comunidade', null, 3);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, handle, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'handle', split_part(new.email, '@', 1) || '_' || substr(new.id::text, 1, 4)),
    new.raw_user_meta_data ->> 'avatar_url'
  );

  insert into public.server_members (server_id, user_id)
  values ('00000000-0000-0000-0000-000000000001', new.id);

  return new;
end;
$$;
