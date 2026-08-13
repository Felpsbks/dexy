-- Widen the darkness-overlay range from 0-70% to the full 0-100% now
-- requested for the redesigned profile editor.
alter table public.profiles drop constraint if exists profiles_banner_overlay_check;
alter table public.profiles add constraint profiles_banner_overlay_check check (banner_overlay between 0 and 100);
