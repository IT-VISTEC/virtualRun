-- Fix for 0007: the auth hook runs as supabase_auth_admin, which is subject to RLS on public.pin_attempts.
-- 0007 enabled RLS without a policy, so the hook could not read/write attempts and PINs never locked.
-- Run once in the Supabase SQL editor (safe to re-run).

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then
    execute 'drop policy if exists "auth hook manages pin attempts" on public.pin_attempts';
    execute 'create policy "auth hook manages pin attempts" on public.pin_attempts
               for all to supabase_auth_admin using (true) with check (true)';
    execute 'grant select, insert, update, delete on public.pin_attempts to supabase_auth_admin';
    execute 'grant execute on function public.hook_password_verification_attempt(jsonb) to supabase_auth_admin';
  end if;
end $$;
