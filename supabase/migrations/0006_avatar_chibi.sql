-- Remember which chibi preset a profile avatar was composed from, so the UI can show the transparent cut-out
-- (profiles.avatar_url keeps the composed picture used everywhere else).
-- Safe to run more than once. Run once in the Supabase SQL editor.

alter table public.profiles
  add column if not exists avatar_chibi text;

alter table public.profiles drop constraint if exists profiles_avatar_chibi_check;
alter table public.profiles
  add constraint profiles_avatar_chibi_check
  check (avatar_chibi is null or avatar_chibi ~ '^chibi-(10|[1-9])$');
