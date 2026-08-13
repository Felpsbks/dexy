-- The Configurações screen (Tema/Idioma/Notificações) was pure local
-- useState — never persisted, reset on every reload. This makes those
-- preferences real, on the same profiles table every other account setting
-- already lives on (banner_*, accent_color, status, ...).
alter table public.profiles
  add column if not exists app_theme text not null default 'cyan',
  add column if not exists language text not null default 'pt-BR',
  add column if not exists notify_mentions boolean not null default true,
  add column if not exists notify_all_messages boolean not null default false,
  add column if not exists notify_sound boolean not null default true;

alter table public.profiles drop constraint if exists profiles_app_theme_check;
alter table public.profiles add constraint profiles_app_theme_check check (app_theme in ('dark', 'cyan', 'lime'));

alter table public.profiles drop constraint if exists profiles_language_check;
alter table public.profiles add constraint profiles_language_check check (language in ('pt-BR', 'en', 'es'));
