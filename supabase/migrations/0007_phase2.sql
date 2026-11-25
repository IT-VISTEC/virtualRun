-- VISTEC Virtual Run — phase 2
--  1. Unique group names (case/space-insensitive) + is_group_name_available() used by the app.
--  2. Only VISTEC Microsoft 365 accounts can finish registration (email/PIN accounts must link to an Azure user first).
--  3. Sign-in PIN lockout: Supabase "Password Verification Attempt" auth hook (5 wrong PINs -> locked 15 minutes).
-- Run once in the Supabase SQL editor (safe to re-run). Requires 0005.

-- ───────── 1. Group names ─────────
-- Fails if two existing groups already share a name: rename one of them first.
create unique index if not exists groups_name_uniq on public.groups (lower(btrim(name)));

create or replace function public.is_group_name_available(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select char_length(btrim(coalesce(p_name, ''))) between 1 and 40
     and not exists (
       select 1 from public.groups g
       where lower(btrim(g.name)) = lower(btrim(p_name))
         -- renaming your own group to the same name (e.g. only changing case) is fine
         and g.id is distinct from (select p.group_id from public.profiles p where p.id = auth.uid())
     );
$$;
revoke execute on function public.is_group_name_available(text) from public, anon;
grant execute on function public.is_group_name_available(text) to authenticated;

-- ───────── 2. Registration only for Microsoft 365 (Azure) accounts ─────────
create or replace function public.profiles_require_azure()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.registered_at is not null and old.registered_at is null
     and not public.is_admin()
     and not exists (select 1 from auth.identities i where i.user_id = new.id and i.provider = 'azure') then
    raise exception 'Please sign in with your VISTEC Microsoft 365 account first';
  end if;
  return new;
end;
$$;
revoke execute on function public.profiles_require_azure() from public, anon, authenticated;
drop trigger if exists profiles_30_require_azure on public.profiles;
create trigger profiles_30_require_azure before update on public.profiles
  for each row execute function public.profiles_require_azure();

-- ───────── 3. PIN lockout (auth hook) ─────────
-- Enable in Dashboard → Authentication → Hooks → "Password Verification Attempt" → Postgres function
-- public.hook_password_verification_attempt. (Hook availability depends on the Supabase plan.)
create table if not exists public.pin_attempts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  failed int not null default 0,
  locked_until timestamptz,
  last_attempt_at timestamptz not null default now()
);
alter table public.pin_attempts enable row level security;   -- no policies: only the auth hook touches it
revoke all on public.pin_attempts from anon, authenticated;

create or replace function public.hook_password_verification_attempt(event jsonb)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  uid uuid := (event ->> 'user_id')::uuid;
  ok boolean := coalesce((event ->> 'valid')::boolean, false);
  rec public.pin_attempts;
begin
  select * into rec from public.pin_attempts where user_id = uid for update;

  if rec.locked_until is not null and rec.locked_until > now() then
    return jsonb_build_object('decision', 'reject',
      'message', 'Too many wrong PINs. Try again after ' ||
                 to_char(rec.locked_until at time zone 'Asia/Bangkok', 'HH24:MI') || ' or sign in with Microsoft.',
      'should_logout_user', false);
  end if;

  if ok then
    delete from public.pin_attempts where user_id = uid;
    return jsonb_build_object('decision', 'continue');
  end if;

  insert into public.pin_attempts as p (user_id, failed, last_attempt_at)
  values (uid, 1, now())
  on conflict (user_id) do update
    set failed = case when p.locked_until is not null then 1 else p.failed + 1 end,
        locked_until = case when (case when p.locked_until is not null then 1 else p.failed + 1 end) >= 5
                            then now() + interval '15 minutes' end,
        last_attempt_at = now();
  return jsonb_build_object('decision', 'continue');
end;
$$;

-- The hook runs as supabase_auth_admin; nobody else may call it.
revoke execute on function public.hook_password_verification_attempt(jsonb) from public, anon, authenticated;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'grant usage on schema public to supabase_auth_admin';
    execute 'grant execute on function public.hook_password_verification_attempt(jsonb) to supabase_auth_admin';
    execute 'grant select, insert, update, delete on public.pin_attempts to supabase_auth_admin';
  end if;
end $$;
