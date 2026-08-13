-- Phone number, collected as a required field at signup (client-side
-- enforced) for future account-recovery/contact use. Nullable at the DB
-- level so this doesn't break existing rows that predate the field.
alter table public.profiles add column if not exists phone text;
alter table public.profiles drop constraint if exists profiles_phone_format_check;
alter table public.profiles add constraint profiles_phone_format_check check (phone is null or phone ~ '^\+?[0-9]{8,15}$');

-- Auto-create a profile row whenever a new auth user signs up — same as
-- before, now also copying the phone number out of signup metadata.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, name, handle, avatar_url, phone)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)),
    coalesce(new.raw_user_meta_data ->> 'handle', split_part(new.email, '@', 1) || '_' || substr(new.id::text, 1, 4)),
    new.raw_user_meta_data ->> 'avatar_url',
    new.raw_user_meta_data ->> 'phone'
  );
  return new;
end;
$$;
