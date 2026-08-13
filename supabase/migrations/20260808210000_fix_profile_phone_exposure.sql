-- SECURITY FIX: `profiles` has a blanket "readable by any signed-in user"
-- SELECT policy (using (true)). RLS is row-level only — there is no way to
-- keep a single column private on a row that's otherwise fully readable.
-- That meant the `phone` column added in 20260808180000_profile_phone.sql
-- was exposed, in full, to every authenticated user via a plain
-- `select id, phone from profiles`, not just to friends. Move it into its
-- own table that only the owner can read.

create table public.profile_private (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  phone text,
  created_at timestamptz not null default now()
);

alter table public.profile_private
  add constraint profile_private_phone_format_check
  check (phone is null or phone ~ '^\+?[0-9]{8,15}$');

alter table public.profile_private enable row level security;

create policy "users can view their own phone"
  on public.profile_private for select
  to authenticated
  using (auth.uid() = user_id);

create policy "users can add their own phone"
  on public.profile_private for insert
  to authenticated
  with check (auth.uid() = user_id);

create policy "users can update their own phone"
  on public.profile_private for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Carry over any phone numbers collected while the column lived on profiles.
insert into public.profile_private (user_id, phone)
select id, phone from public.profiles where phone is not null
on conflict (user_id) do nothing;

alter table public.profiles drop column if exists phone;

-- Same as before, now writing the phone number to the private table instead
-- of the publicly-readable profiles table.
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
  return new;
end;
$$;
