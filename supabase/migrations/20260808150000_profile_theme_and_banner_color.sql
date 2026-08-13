-- Splits the previously-overloaded "accent_color" into two distinct fields:
-- banner_color (a flat color used as the banner background, alternative to
-- an uploaded/preset image) and the existing accent_color, which is
-- repurposed as "Tema do perfil" — a small accent color used only for a
-- few profile-facing details (avatar ring, selection indicators), never a
-- full repaint.
alter table public.profiles
  add column if not exists banner_color text;
