-- The last two handle_new_user() redefinitions (profile_phone.sql,
-- fix_profile_phone_exposure.sql) were both based on the *original*
-- pre-default-server version of the function and silently dropped the
-- `insert into server_members` that default_server.sql had added. Every
-- account created since profile_phone.sql was applied has zero server
-- memberships — and since `servers` RLS only shows servers you're a member
-- of, useServers() returns [] for them, activeServer never gets set, and
-- the app is stuck on `if (!activeServer || !channel) return <LoadingScreen />`
-- forever. This restores that insert while keeping every responsibility the
-- two later migrations added (phone now goes to profile_private, not
-- profiles, per the security fix).
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

  if new.raw_user_meta_data ->> 'phone' is not null then
    insert into public.profile_private (user_id, phone)
    values (new.id, new.raw_user_meta_data ->> 'phone');
  end if;

  insert into public.server_members (server_id, user_id)
  values ('00000000-0000-0000-0000-000000000001', new.id)
  on conflict (server_id, user_id) do nothing;

  return new;
end;
$$;

-- Backfill accounts created while the bug was live (any signup since
-- profile_phone.sql first dropped the insert) so already-affected users
-- aren't stuck forever. Only ever adds server_members rows — never touches
-- profiles/profile_private — and is a no-op for anyone already joined.
insert into public.server_members (server_id, user_id)
select '00000000-0000-0000-0000-000000000001', p.id
from public.profiles p
where not exists (
  select 1 from public.server_members sm
  where sm.server_id = '00000000-0000-0000-0000-000000000001' and sm.user_id = p.id
)
on conflict (server_id, user_id) do nothing;
