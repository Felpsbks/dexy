-- Profile customization: a real avatar (circular photo, GIF allowed) and a
-- separate profile background (banner behind the avatar). Files live in
-- Storage; profiles only ever holds a URL/reference, never raw bytes.
-- Written idempotently since earlier profile columns/buckets may already
-- exist from partial runs.

alter table public.profiles
  add column if not exists banner_position text not null default 'center'
    check (banner_position in ('top', 'center', 'bottom')),
  add column if not exists banner_overlay smallint not null default 0
    check (banner_overlay between 0 and 70),
  add column if not exists accent_color text;

-- Public buckets: avatars and banners are shown to anyone viewing a profile,
-- so served via the public CDN URL (no signed URLs needed). Size/MIME limits
-- are enforced by Storage itself as a server-side backstop to the client-side
-- validation in src/lib/profileMedia.ts.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', true, 5242880, array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('profile-banners', 'profile-banners', true, 10485760, array['image/png', 'image/jpeg', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Objects are stored as "<user_id>/<uuid>.<ext>" — the first path segment is
-- the owner, checked against auth.uid() for writes. Reads need no policy:
-- public buckets serve GETs straight from the CDN without an RLS check.
drop policy if exists "users can upload their own avatar" on storage.objects;
create policy "users can upload their own avatar"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users can replace their own avatar" on storage.objects;
create policy "users can replace their own avatar"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users can delete their own avatar" on storage.objects;
create policy "users can delete their own avatar"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users can upload their own banner" on storage.objects;
create policy "users can upload their own banner"
  on storage.objects for insert
  to authenticated
  with check (bucket_id = 'profile-banners' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users can replace their own banner" on storage.objects;
create policy "users can replace their own banner"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'profile-banners' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "users can delete their own banner" on storage.objects;
create policy "users can delete their own banner"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'profile-banners' and (storage.foldername(name))[1] = auth.uid()::text);
