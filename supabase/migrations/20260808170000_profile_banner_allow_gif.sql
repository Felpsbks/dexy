-- Profile backgrounds can now be animated GIFs too (previously JPG/PNG/WebP
-- only). CSS background-image animates GIFs natively, same as an <img>, so
-- no rendering changes were needed — just widening the bucket's allowlist
-- to match the client-side validation in src/lib/profileMedia.ts.
update storage.buckets
set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif']
where id = 'profile-banners';
