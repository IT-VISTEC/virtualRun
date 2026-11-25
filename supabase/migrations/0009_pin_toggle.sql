-- VISTEC Virtual Run — admin on/off switch for PIN sign-in.
-- The lockout hook (0007/0008) needs the Team plan, so PIN sign-in has NO per-account lockout on this project.
-- Default is OFF. While OFF the database itself makes PIN sign-in impossible (hiding the UI is not enough,
-- because anyone can call the Supabase Auth API directly):
--   * turning it off removes every existing password (PIN) from auth.users;
--   * a trigger on auth.users drops any password set or signed up with while it is off.
-- Run once in the Supabase SQL editor (safe to re-run). Requires 0005 and 0007.

alter table public.app_settings add column if not exists pin_login_enabled boolean not null default false;

-- Readable before sign-in (the login page decides whether to show the PIN form). Returns a boolean only.
create or replace function public.pin_login_enabled()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select s.pin_login_enabled from public.app_settings s where s.id = 1), false);
$$;
revoke execute on function public.pin_login_enabled() from public;
grant execute on function public.pin_login_enabled() to anon, authenticated;

-- Admin switch. Turning it off also wipes all PINs.
create or replace function public.admin_set_pin_login(p_enabled boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  old boolean;
  wiped int := 0;
begin
  perform public.assert_admin();
  select s.pin_login_enabled into old from public.app_settings s where s.id = 1;
  update public.app_settings s set pin_login_enabled = coalesce(p_enabled, false) where s.id = 1;
  if not coalesce(p_enabled, false) then
    update auth.users u set encrypted_password = ''
    where u.encrypted_password is not null and u.encrypted_password <> '';
    get diagnostics wiped = row_count;
  end if;
  perform public.audit('settings.pin_login_enabled', null,
    jsonb_build_object('pin_login_enabled', old),
    jsonb_build_object('pin_login_enabled', coalesce(p_enabled, false), 'pins_removed', wiped));
end;
$$;
revoke execute on function public.admin_set_pin_login(boolean) from public, anon;
grant execute on function public.admin_set_pin_login(boolean) to authenticated;

-- While PIN sign-in is off, nobody can give an account a password (updateUser or email sign-up).
create or replace function public.auth_users_block_pin()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.encrypted_password is not null and new.encrypted_password <> ''
     and (tg_op = 'INSERT' or new.encrypted_password is distinct from old.encrypted_password)
     and not coalesce((select s.pin_login_enabled from public.app_settings s where s.id = 1), false) then
    new.encrypted_password := '';
  end if;
  return new;
end;
$$;
revoke execute on function public.auth_users_block_pin() from public, anon, authenticated;
drop trigger if exists vr_block_pin_when_disabled on auth.users;
create trigger vr_block_pin_when_disabled before insert or update of encrypted_password on auth.users
  for each row execute function public.auth_users_block_pin();

-- New column defaults to OFF. While OFF, remove any PINs that were set while the feature was being tested.
-- (Re-running keeps the admin's current choice.)
update auth.users set encrypted_password = '' where encrypted_password is not null and encrypted_password <> ''
  and not coalesce((select s.pin_login_enabled from public.app_settings s where s.id = 1), false);
