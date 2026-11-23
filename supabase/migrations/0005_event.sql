-- 0005_event.sql — VISTEC Virtual Run event (1–15 Dec 2026, Asia/Bangkok)
-- Teams, groups, run review workflow, admin tools, hidden-distance leaderboards.
-- Run once in Supabase -> SQL Editor. Does not modify 0001–0004 objects except where noted.

-- ───────── Settings & admins ─────────
create table if not exists public.app_settings (
  id smallint primary key default 1 check (id = 1),
  reveal_distances boolean not null default false,
  event_start date not null default date '2026-12-01',
  event_end date not null default date '2026-12-15',
  group_lock_at timestamptz not null default (timestamp '2026-12-01 00:00:00' at time zone 'Asia/Bangkok')
);
insert into public.app_settings (id) values (1) on conflict (id) do nothing;
-- Lock starts at 2026-12-01 00:00:00 Bangkok (checked with now() >= group_lock_at).
alter table public.app_settings alter column group_lock_at set default (timestamp '2026-12-01 00:00:00' at time zone 'Asia/Bangkok');
update public.app_settings set group_lock_at = (timestamp '2026-12-01 00:00:00' at time zone 'Asia/Bangkok')
  where id = 1 and group_lock_at = (timestamp '2026-11-30 23:59:59' at time zone 'Asia/Bangkok');

-- Admins: matched by user_id once bound (preferred). Email fallback only while user_id is unbound, and only
-- against the Azure identity's email (auth.identities), never auth.users.email (user-changeable). The Supabase
-- Azure provider MUST use the VISTEC tenant URL (single-tenant) so foreign tenants cannot present this email.
-- The binding below runs on every apply; to bind manually after a first sign-in, re-run it.
create table if not exists public.admins (
  email text primary key check (email = lower(email))
);
alter table public.admins add column if not exists user_id uuid unique references auth.users (id) on delete cascade;
insert into public.admins (email) values ('it@vistec.ac.th') on conflict (email) do nothing;
update public.admins a
   set user_id = i.user_id
  from auth.identities i
 where a.user_id is null
   and i.provider = 'azure'
   and lower(i.identity_data ->> 'email') = a.email;

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor uuid,
  action text not null,
  target text,
  before jsonb,
  after jsonb,
  at timestamptz not null default now()
);

-- True when the caller is bound in public.admins, or (unbound rows only) their Azure identity email is listed.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins a where a.user_id = auth.uid()
  ) or exists (
    select 1 from auth.identities i
    join public.admins a on a.user_id is null
                        and a.email = lower(i.identity_data ->> 'email')
    where i.user_id = auth.uid()
      and i.provider = 'azure'
  );
$$;

-- Today's date in Asia/Bangkok.
create or replace function public.bkk_today()
returns date
language sql
stable
set search_path = ''
as $$ select (pg_catalog.now() at time zone 'Asia/Bangkok')::date; $$;

-- ───────── Groups ─────────
create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  avatar_url text check (avatar_url is null or char_length(avatar_url) <= 200000),
  join_code text not null unique,
  leader_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now()
);
create unique index if not exists groups_name_uniq on public.groups (lower(btrim(name)));

-- Profile additions. Membership lives on profiles.group_id (one group per user by construction).
alter table public.profiles
  add column if not exists team text check (team is null or team in ('MSE', 'ESE', 'BSE', 'IST', 'STAFF')),
  add column if not exists registered_at timestamptz,
  add column if not exists group_id uuid references public.groups (id) on delete set null;
-- Existing installs: leader FK cascades so deleting a leader's account disbands the group.
alter table public.groups drop constraint if exists groups_leader_id_fkey;
alter table public.groups add constraint groups_leader_id_fkey
  foreign key (leader_id) references public.profiles (id) on delete cascade;
create index if not exists profiles_group_idx on public.profiles (group_id);
create index if not exists profiles_team_idx on public.profiles (team);

-- ───────── Runs additions ─────────
-- Nullable so legacy rows survive; requirements for new rows are enforced by trigger.
alter table public.runs
  add column if not exists duration_sec integer check (duration_sec is null or duration_sec > 0),
  add column if not exists image_sha256 text check (image_sha256 is null or image_sha256 ~ '^[0-9a-f]{64}$'),
  add column if not exists status text not null default 'counted' check (status in ('counted', 'pending', 'rejected')),
  add column if not exists flags text[] not null default '{}',
  add column if not exists reviewed_by uuid,
  add column if not exists reviewed_at timestamptz,
  add column if not exists review_note text check (review_note is null or char_length(review_note) <= 500);
-- Spec: no distance caps (drop 0001's <= 300 check; keep > 0).
alter table public.runs drop constraint if exists runs_distance_km_check;
alter table public.runs drop constraint if exists runs_distance_km_positive;
alter table public.runs add constraint runs_distance_km_positive check (distance_km > 0);
-- Spec: no distance caps. 0003's steps <= 400000 (= 300 km) would reimpose one; keep > 0 only.
alter table public.runs drop constraint if exists runs_steps_check;
alter table public.runs drop constraint if exists runs_steps_positive;
alter table public.runs add constraint runs_steps_positive check (steps is null or steps > 0);
alter table public.runs alter column ran_on set default ((now() at time zone 'Asia/Bangkok')::date);
create index if not exists runs_sha_idx on public.runs (image_sha256) where image_sha256 is not null;
-- One run per uploaded photo (race-safe backstop for the trigger check).
create unique index if not exists runs_image_path_uniq on public.runs (image_path) where image_path is not null;
create index if not exists runs_status_idx on public.runs (status);

-- ───────── Triggers ─────────
-- Profiles: signed-in users cannot change team (once set), group_id, registered_at directly.
-- RPCs run as the function owner, so current_user is not 'authenticated' there.
create or replace function public.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') then
    if tg_op = 'INSERT' then
      new.team := null; new.group_id := null; new.registered_at := null;
    elsif new.team is distinct from old.team
       or new.group_id is distinct from old.group_id
       or new.registered_at is distinct from old.registered_at then
      raise exception 'Team, group and registration can only be changed through the app';
    end if;
  end if;
  return new;
end;
$$;
-- Triggers fire in name order: the guard (10) must reject client writes before the group limit (20) runs.
drop trigger if exists profiles_guard on public.profiles;
drop trigger if exists profiles_10_guard on public.profiles;
create trigger profiles_10_guard before insert or update on public.profiles
  for each row execute function public.profiles_guard();

-- Profiles: max 4 members per group, race-safe (locks the group row).
create or replace function public.profiles_group_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare n int;
begin
  if new.group_id is not null and new.group_id is distinct from old.group_id then
    perform 1 from public.groups g where g.id = new.group_id for update;
    if not found then raise exception 'Group not found'; end if;
    select count(*) into n from public.profiles p where p.group_id = new.group_id and p.id <> new.id;
    if n >= 4 then raise exception 'Group is full (max 4 members)'; end if;
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_group_limit on public.profiles;
drop trigger if exists profiles_20_group_limit on public.profiles;
create trigger profiles_20_group_limit before update of group_id on public.profiles
  for each row execute function public.profiles_group_limit();

-- Runs BEFORE INSERT: identity, Bangkok same-day date, event window, required fields, status rule.
-- NOT security definer: current_user must be the caller's role ('authenticated') for the check below.
create or replace function public.runs_before_insert()
returns trigger
language plpgsql
set search_path = ''
as $$
declare s public.app_settings;
begin
  if current_user in ('authenticated', 'anon') then
    new.user_id := auth.uid();
    new.ran_on := public.bkk_today();
    new.flags := '{}';
    new.reviewed_by := null; new.reviewed_at := null; new.review_note := null;
    new.created_at := pg_catalog.now();
    if new.user_id is null then raise exception 'Not signed in'; end if;
    if new.duration_sec is null or new.duration_sec <= 0 then
      raise exception 'Duration is required';
    end if;
    if new.image_path is null then raise exception 'A run photo is required'; end if;
    if split_part(new.image_path, '/', 1) <> new.user_id::text then
      raise exception 'Invalid image path';
    end if;
    -- Photo must already be uploaded (caller sees own objects via 0004 owner read) and not reused.
    if not exists (select 1 from storage.objects o
                   where o.bucket_id = 'run-images' and o.name = new.image_path) then
      raise exception 'A run photo is required';
    end if;
    if exists (select 1 from public.runs r where r.image_path = new.image_path) then
      raise exception 'This photo is already used by another run';
    end if;
    if new.image_sha256 is null then raise exception 'Image hash is required'; end if;
    select * into s from public.app_settings where id = 1;
    if not public.is_admin() and (new.ran_on < s.event_start or new.ran_on > s.event_end) then
      raise exception 'Runs can only be submitted during the event (% to %)', s.event_start, s.event_end;
    end if;
    new.status := case
      -- nullif: 0.00 (incl. rounded tiny values) yields NULL here; runs_distance_km_positive then rejects the row.
      when new.distance_km > 20 or (new.duration_sec::numeric / nullif(new.distance_km, 0)) < 270 then 'pending'
      else 'counted' end;
  end if;
  return new;
end;
$$;
drop trigger if exists runs_before_insert on public.runs;
create trigger runs_before_insert before insert on public.runs
  for each row execute function public.runs_before_insert();

-- Runs AFTER INSERT: flag every run sharing the same image hash (including the new one).
create or replace function public.runs_flag_duplicates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.image_sha256 is null then return null; end if;
  -- Serialize inserts sharing a hash so concurrent duplicates see each other.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.image_sha256, 0));
  if exists (
    select 1 from public.runs r where r.image_sha256 = new.image_sha256 and r.id <> new.id
  ) then
    update public.runs r
      set flags = array_append(r.flags, 'duplicate_image')
      where r.image_sha256 = new.image_sha256
        and not ('duplicate_image' = any (r.flags));
  end if;
  return null;
end;
$$;
drop trigger if exists runs_flag_duplicates on public.runs;
create trigger runs_flag_duplicates after insert on public.runs
  for each row execute function public.runs_flag_duplicates();

-- ───────── RLS ─────────
alter table public.app_settings enable row level security;
alter table public.admins enable row level security;
alter table public.audit_log enable row level security;
alter table public.groups enable row level security;

drop policy if exists "settings readable" on public.app_settings;
create policy "settings readable" on public.app_settings for select to authenticated using (true);

drop policy if exists "admins read audit log" on public.audit_log;
create policy "admins read audit log" on public.audit_log for select to authenticated
  using ((select public.is_admin()));

-- Groups: members see their own group (incl. join code); writes only via RPCs.
drop policy if exists "members read own group" on public.groups;
create policy "members read own group" on public.groups for select to authenticated
  using (id = (select p.group_id from public.profiles p where p.id = (select auth.uid())));

-- Runs: no user UPDATE; delete only own runs on the same Bangkok day.
drop policy if exists "users update own runs" on public.runs;
drop policy if exists "users delete own runs" on public.runs;
drop policy if exists "users delete own runs same day" on public.runs;
create policy "users delete own runs same day" on public.runs for delete to authenticated
  using ((select auth.uid()) = user_id and ran_on = (select public.bkk_today()));

-- Storage: admins can read every run image.
drop policy if exists "run images: admin read" on storage.objects;
create policy "run images: admin read" on storage.objects for select to authenticated
  using (bucket_id = 'run-images' and (select public.is_admin()));

-- Storage: owners may delete only photos that no run references (keeps review evidence).
drop policy if exists "run images: owner delete" on storage.objects;
create policy "run images: owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'run-images'
         and (storage.foldername(name))[1] = (select auth.uid())::text
         and not exists (select 1 from public.runs r where r.image_path = name));

-- Legacy challenge leaderboard returns km of all runs: no longer client-callable.
revoke execute on function public.challenge_leaderboard(uuid) from public, anon, authenticated;

-- ───────── Internal helpers ─────────
create or replace function public.new_join_code()
returns text
language sql
volatile
set search_path = ''
as $$ select upper(substr(replace(pg_catalog.gen_random_uuid()::text, '-', ''), 1, 8)); $$;

create or replace function public.assert_membership_open()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin()
     and pg_catalog.now() >= (select s.group_lock_at from public.app_settings s where s.id = 1) then
    raise exception 'Group membership is locked';
  end if;
end;
$$;

create or replace function public.assert_admin()
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then raise exception 'Admin only'; end if;
end;
$$;

create or replace function public.audit(p_action text, p_target text, p_before jsonb, p_after jsonb)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.audit_log (actor, action, target, before, after)
  values (auth.uid(), p_action, p_target, p_before, p_after);
$$;

-- Counted km per user within the event window (internal; never granted).
create or replace function public.counted_km_by_user()
returns table (user_id uuid, km numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select r.user_id, sum(r.distance_km)
  from public.runs r, public.app_settings s
  where s.id = 1 and r.status = 'counted' and r.ran_on between s.event_start and s.event_end
  group by r.user_id;
$$;

create or replace function public.can_see_distances()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_admin() or (select s.reveal_distances from public.app_settings s where s.id = 1);
$$;

-- Km used for leaderboard ranking. While distances are hidden, only runs that can no longer be
-- deleted by their owner (ran_on before today, Bangkok) count, so insert/compare/delete probes cannot reveal totals.
create or replace function public.ranked_km_by_user()
returns table (user_id uuid, km numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select r.user_id, sum(r.distance_km)
  from public.runs r, public.app_settings s
  where s.id = 1 and r.status = 'counted' and r.ran_on between s.event_start and s.event_end
    and (public.can_see_distances() or r.ran_on < public.bkk_today())
  group by r.user_id;
$$;

-- ───────── User RPCs ─────────
create or replace function public.complete_registration(p_display_name text, p_team text, p_avatar_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare cur_team text;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_display_name is null or char_length(btrim(p_display_name)) not between 1 and 60 then
    raise exception 'Display name must be 1-60 characters';
  end if;
  if p_team is null or p_team not in ('MSE', 'ESE', 'BSE', 'IST', 'STAFF') then
    raise exception 'Invalid team';
  end if;
  insert into public.profiles (id) values (auth.uid()) on conflict (id) do nothing;
  select p.team into cur_team from public.profiles p where p.id = auth.uid();
  if cur_team is not null and cur_team <> p_team and not public.is_admin() then
    raise exception 'Team cannot be changed';
  end if;
  if cur_team is not null and cur_team <> p_team then  -- only admins reach here
    perform public.audit('profile.set_team', auth.uid()::text,
      jsonb_build_object('team', cur_team), jsonb_build_object('team', p_team));
  end if;
  update public.profiles p
    set display_name = btrim(p_display_name),
        team = p_team,
        avatar_url = p_avatar_url,
        registered_at = coalesce(p.registered_at, pg_catalog.now())
    where p.id = auth.uid();
end;
$$;

create or replace function public.my_summary()
returns table (total_km numeric, today_km numeric, steps bigint, active_days bigint, pending_count bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(r.distance_km) filter (where r.status = 'counted'), 0),
         coalesce(sum(r.distance_km) filter (where r.status = 'counted' and r.ran_on = public.bkk_today()), 0),
         round(coalesce(sum(r.distance_km) filter (where r.status = 'counted'), 0) / 0.00075)::bigint,
         count(distinct r.ran_on) filter (where r.status = 'counted'),
         count(*) filter (where r.status = 'pending')
  from public.runs r, public.app_settings s
  where s.id = 1 and r.user_id = auth.uid() and r.ran_on between s.event_start and s.event_end;
$$;

-- Leaderboards use standard rank() (ties share a rank, next rank skips).
create or replace function public.leaderboard_individual()
returns table (rank bigint, user_id uuid, display_name text, avatar_url text, team text, is_me boolean, total_km numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select p.id, p.display_name, p.avatar_url, p.team, coalesce(k.km, 0) as km
    from public.profiles p
    left join public.ranked_km_by_user() k on k.user_id = p.id
    where p.registered_at is not null
  )
  select rank() over (order by t.km desc), t.id, t.display_name, t.avatar_url, t.team,
         t.id = auth.uid(),
         case when public.can_see_distances() then t.km end
  from t
  where auth.uid() is not null
  order by t.km desc, t.display_name;
$$;

create or replace function public.leaderboard_groups()
returns table (rank bigint, group_id uuid, name text, avatar_url text, member_count bigint, is_mine boolean, total_km numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with t as (
    select g.id, g.name, g.avatar_url, count(p.id) as n, coalesce(sum(k.km), 0) as km
    from public.groups g
    join public.profiles p on p.group_id = g.id
    left join public.ranked_km_by_user() k on k.user_id = p.id
    group by g.id
  )
  select rank() over (order by t.km desc), t.id, t.name, t.avatar_url, t.n,
         coalesce(t.id = (select p.group_id from public.profiles p where p.id = auth.uid()), false),
         case when public.can_see_distances() then t.km end
  from t
  where auth.uid() is not null
  order by t.km desc, t.name;
$$;

create or replace function public.leaderboard_teams()
returns table (rank bigint, team text, member_count bigint, is_mine boolean, total_km numeric)
language sql
stable
security definer
set search_path = ''
as $$
  with teams(code) as (values ('MSE'), ('ESE'), ('BSE'), ('IST'), ('STAFF')),
  t as (
    select tm.code, count(p.id) as n, coalesce(sum(k.km), 0) as km
    from teams tm
    left join public.profiles p on p.team = tm.code and p.registered_at is not null
    left join public.ranked_km_by_user() k on k.user_id = p.id
    group by tm.code
  )
  select rank() over (order by t.km desc), t.code, t.n,
         coalesce(t.code = (select p.team from public.profiles p where p.id = auth.uid()), false),
         case when public.can_see_distances() then t.km end
  from t
  where auth.uid() is not null
  order by t.km desc, t.code;
$$;

-- One row per member of the caller's group (empty if none). Members see each other's km.
create or replace function public.my_group()
returns table (group_id uuid, group_name text, group_avatar_url text, join_code text, leader_id uuid,
               member_id uuid, member_name text, member_avatar_url text, member_team text,
               member_km numeric, is_leader boolean, is_me boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select g.id, g.name, g.avatar_url, g.join_code, g.leader_id,
         p.id, p.display_name, p.avatar_url, p.team,
         coalesce(k.km, 0), p.id = g.leader_id, p.id = auth.uid()
  from public.profiles me
  join public.groups g on g.id = me.group_id
  join public.profiles p on p.group_id = g.id
  left join public.counted_km_by_user() k on k.user_id = p.id
  where me.id = auth.uid()
  order by (p.id = g.leader_id) desc, p.display_name;
$$;

create or replace function public.is_group_name_available(p_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_name is not null
    and char_length(btrim(p_name)) between 1 and 40
    and not exists (
      select 1 from public.groups g where lower(btrim(g.name)) = lower(btrim(p_name))
    );
$$;

create or replace function public.create_group(p_name text, p_avatar_url text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare gid uuid; cur uuid; reg timestamptz;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform public.assert_membership_open();
  select p.group_id, p.registered_at into cur, reg from public.profiles p where p.id = auth.uid() for update;
  if not found or reg is null then raise exception 'Complete registration first'; end if;
  if cur is not null then raise exception 'You are already in a group'; end if;
  if p_name is null or char_length(btrim(p_name)) not between 1 and 40 then
    raise exception 'Group name must be 1-40 characters';
  end if;
  insert into public.groups (name, avatar_url, join_code, leader_id)
    values (btrim(p_name), p_avatar_url, public.new_join_code(), auth.uid())
    returning id into gid;
  update public.profiles p set group_id = gid where p.id = auth.uid();
  return gid;
end;
$$;

create or replace function public.join_group(p_code text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare gid uuid; cur uuid; reg timestamptz;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  perform public.assert_membership_open();
  select p.group_id, p.registered_at into cur, reg from public.profiles p where p.id = auth.uid() for update;
  if not found or reg is null then raise exception 'Complete registration first'; end if;
  if cur is not null then raise exception 'You are already in a group'; end if;
  select g.id into gid from public.groups g where g.join_code = upper(btrim(p_code));
  if gid is null then raise exception 'Invalid join code'; end if;
  update public.profiles p set group_id = gid where p.id = auth.uid();  -- limit trigger locks + counts
  return gid;
end;
$$;

create or replace function public.leave_group()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare gid uuid; lid uuid; n int;
begin
  perform public.assert_membership_open();
  select p.group_id into gid from public.profiles p where p.id = auth.uid();
  if gid is null then raise exception 'You are not in a group'; end if;
  select g.leader_id into lid from public.groups g where g.id = gid for update;
  -- Re-check membership under the group lock (a concurrent remove may have changed it).
  perform 1 from public.profiles p where p.id = auth.uid() and p.group_id = gid for update;
  if not found then raise exception 'You are not in a group'; end if;
  select count(*) into n from public.profiles p where p.group_id = gid;
  if lid = auth.uid() and n > 1 then
    raise exception 'Transfer leadership before leaving the group';
  end if;
  update public.profiles p set group_id = null where p.id = auth.uid();
  if n = 1 then delete from public.groups g where g.id = gid; end if;
end;
$$;

-- Returns the caller's group id if the caller leads it, else raises.
create or replace function public.assert_leader()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare gid uuid;
begin
  select g.id into gid from public.groups g where g.leader_id = auth.uid() for update;
  if gid is null then raise exception 'Only the group leader can do this'; end if;
  return gid;
end;
$$;

create or replace function public.remove_member(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare gid uuid;
begin
  perform public.assert_membership_open();
  gid := public.assert_leader();
  if p_user_id = auth.uid() then raise exception 'Use leave group instead'; end if;
  update public.profiles p set group_id = null where p.id = p_user_id and p.group_id = gid;
  if not found then raise exception 'User is not in your group'; end if;
end;
$$;

create or replace function public.regenerate_join_code()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare gid uuid; c text;
begin
  gid := public.assert_leader();
  c := public.new_join_code();
  update public.groups g set join_code = c where g.id = gid;
  return c;
end;
$$;

create or replace function public.transfer_leadership(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare gid uuid;
begin
  gid := public.assert_leader();
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.group_id = gid) then
    raise exception 'User is not in your group';
  end if;
  update public.groups g set leader_id = p_user_id where g.id = gid;
end;
$$;

create or replace function public.update_group(p_name text, p_avatar_url text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare gid uuid;
begin
  gid := public.assert_leader();
  if p_name is null or char_length(btrim(p_name)) not between 1 and 40 then
    raise exception 'Group name must be 1-40 characters';
  end if;
  update public.groups g set name = btrim(p_name), avatar_url = p_avatar_url where g.id = gid;
end;
$$;

-- ───────── Admin RPCs ─────────
create or replace function public.admin_list_users()
returns table (user_id uuid, email text, display_name text, team text, group_id uuid, group_name text,
               registered_at timestamptz, counted_km numeric, pending_count bigint, is_admin boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  return query
    select p.id, u.email::text, p.display_name, p.team, p.group_id, g.name, p.registered_at,
           coalesce(k.km, 0),
           (select count(*) from public.runs r where r.user_id = p.id and r.status = 'pending'),
           -- Same rule as is_admin(): bound user_id, else (unbound rows) the Azure identity email.
           exists (select 1 from public.admins a
                   where a.user_id = p.id
                      or (a.user_id is null and exists (
                            select 1 from auth.identities i
                            where i.user_id = p.id and i.provider = 'azure'
                              and lower(i.identity_data ->> 'email') = a.email)))
    from public.profiles p
    join auth.users u on u.id = p.id
    left join public.groups g on g.id = p.group_id
    left join public.counted_km_by_user() k on k.user_id = p.id
    order by p.display_name;
end;
$$;

create or replace function public.admin_list_runs(p_status text default null, p_flagged_only boolean default false)
returns table (run_id uuid, user_id uuid, display_name text, email text, team text, ran_on date,
               distance_km numeric, duration_sec integer, pace_sec_per_km numeric, image_path text,
               image_sha256 text, status text, flags text[], review_note text, reviewed_at timestamptz,
               created_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  perform public.assert_admin();
  return query
    select r.id, r.user_id, p.display_name, u.email::text, p.team, r.ran_on,
           r.distance_km, r.duration_sec,
           case when r.duration_sec is not null then round(r.duration_sec::numeric / r.distance_km, 1) end,
           r.image_path, r.image_sha256, r.status, r.flags, r.review_note, r.reviewed_at, r.created_at
    from public.runs r
    join public.profiles p on p.id = r.user_id
    left join auth.users u on u.id = r.user_id
    where (p_status is null or r.status = p_status)
      and (not coalesce(p_flagged_only, false) or cardinality(r.flags) > 0)
    order by r.created_at desc;
end;
$$;

create or replace function public.admin_set_run_status(p_run_id uuid, p_status text, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare b jsonb; a jsonb;
begin
  perform public.assert_admin();
  if p_status is null or p_status not in ('counted', 'pending', 'rejected') then raise exception 'Invalid status'; end if;
  select to_jsonb(r) into b from public.runs r where r.id = p_run_id for update;
  if b is null then raise exception 'Run not found'; end if;
  update public.runs r
    set status = p_status, review_note = p_note, reviewed_by = auth.uid(), reviewed_at = pg_catalog.now()
    where r.id = p_run_id
    returning to_jsonb(r) into a;
  perform public.audit('run.set_status', p_run_id::text, b, a);
end;
$$;

create or replace function public.admin_edit_run(p_run_id uuid, p_distance_km numeric, p_duration_sec integer, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare b jsonb; a jsonb;
begin
  perform public.assert_admin();
  if p_distance_km is null or p_distance_km <= 0 then raise exception 'Invalid distance'; end if;
  if p_duration_sec is not null and p_duration_sec <= 0 then raise exception 'Invalid duration'; end if;
  select to_jsonb(r) into b from public.runs r where r.id = p_run_id for update;
  if b is null then raise exception 'Run not found'; end if;
  update public.runs r
    set distance_km = p_distance_km, duration_sec = p_duration_sec,
        review_note = coalesce(p_note, r.review_note), reviewed_by = auth.uid(), reviewed_at = pg_catalog.now()
    where r.id = p_run_id
    returning to_jsonb(r) into a;
  perform public.audit('run.edit', p_run_id::text, b, a);
end;
$$;

-- Reject both runs of a duplicate-image pair.
create or replace function public.admin_void_duplicate_pair(p_run_id_a uuid, p_run_id_b uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare b jsonb; a jsonb;
begin
  perform public.assert_admin();
  if p_run_id_a = p_run_id_b then raise exception 'Choose two different runs'; end if;
  select jsonb_agg(to_jsonb(r)) into b from public.runs r where r.id in (p_run_id_a, p_run_id_b);
  if jsonb_array_length(coalesce(b, '[]')) <> 2 then raise exception 'Run not found'; end if;
  update public.runs r
    set status = 'rejected', review_note = coalesce(p_note, 'Duplicate image'),
        reviewed_by = auth.uid(), reviewed_at = pg_catalog.now()
    where r.id in (p_run_id_a, p_run_id_b);
  select jsonb_agg(to_jsonb(r)) into a from public.runs r where r.id in (p_run_id_a, p_run_id_b);
  perform public.audit('run.void_duplicate_pair', p_run_id_a::text || ',' || p_run_id_b::text, b, a);
end;
$$;

create or replace function public.admin_set_reveal(p_reveal boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare old boolean;
begin
  perform public.assert_admin();
  select s.reveal_distances into old from public.app_settings s where s.id = 1;
  update public.app_settings s set reveal_distances = coalesce(p_reveal, false) where s.id = 1;
  perform public.audit('settings.reveal_distances', null,
    jsonb_build_object('reveal_distances', old), jsonb_build_object('reveal_distances', coalesce(p_reveal, false)));
end;
$$;

create or replace function public.admin_set_team(p_user_id uuid, p_team text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare old text;
begin
  perform public.assert_admin();
  if p_team is null or p_team not in ('MSE', 'ESE', 'BSE', 'IST', 'STAFF') then raise exception 'Invalid team'; end if;
  select p.team into old from public.profiles p where p.id = p_user_id;
  if not found then raise exception 'User not found'; end if;
  update public.profiles p set team = p_team where p.id = p_user_id;
  perform public.audit('profile.set_team', p_user_id::text,
    jsonb_build_object('team', old), jsonb_build_object('team', p_team));
end;
$$;

-- Move/remove a user's group (works after the lock). p_group_id null removes.
create or replace function public.admin_set_user_group(p_user_id uuid, p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare old uuid; lid uuid; n int := 0;
begin
  perform public.assert_admin();
  -- Read without a lock, then lock in group -> profile order (same as leave_group/remove_member).
  select p.group_id into old from public.profiles p where p.id = p_user_id;
  if not found then raise exception 'User not found'; end if;
  if old is not null then
    select g.leader_id into lid from public.groups g where g.id = old for update;
  end if;
  perform 1 from public.profiles p
    where p.id = p_user_id and p.group_id is not distinct from old for update;
  if not found then raise exception 'User''s group changed concurrently; please retry'; end if;
  if old is not distinct from p_group_id then return; end if;
  if old is not null then
    select count(*) into n from public.profiles p where p.group_id = old;
    if lid = p_user_id and n > 1 then
      raise exception 'Transfer leadership before moving the group leader';
    end if;
  end if;
  update public.profiles p set group_id = p_group_id where p.id = p_user_id;  -- limit trigger applies
  if old is not null and n = 1 then delete from public.groups g where g.id = old; end if;
  perform public.audit('profile.set_group', p_user_id::text,
    jsonb_build_object('group_id', old), jsonb_build_object('group_id', p_group_id));
end;
$$;

create or replace function public.admin_delete_run(p_run_id uuid, p_note text default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare b jsonb;
begin
  perform public.assert_admin();
  delete from public.runs r where r.id = p_run_id returning to_jsonb(r) into b;
  if b is null then raise exception 'Run not found'; end if;
  perform public.audit('run.delete', p_run_id::text, b, jsonb_build_object('note', p_note));
end;
$$;

-- ───────── Grants ─────────
grant select on public.app_settings, public.groups, public.audit_log to authenticated;

-- Internal helpers: not callable by clients.
revoke execute on function public.new_join_code() from public, anon, authenticated;
revoke execute on function public.assert_membership_open() from public, anon, authenticated;
revoke execute on function public.assert_admin() from public, anon, authenticated;
revoke execute on function public.assert_leader() from public, anon, authenticated;
revoke execute on function public.audit(text, text, jsonb, jsonb) from public, anon, authenticated;
revoke execute on function public.counted_km_by_user() from public, anon, authenticated;
revoke execute on function public.ranked_km_by_user() from public, anon, authenticated;
revoke execute on function public.can_see_distances() from public, anon, authenticated;
revoke execute on function public.profiles_guard() from public, anon, authenticated;
revoke execute on function public.profiles_group_limit() from public, anon, authenticated;
revoke execute on function public.runs_before_insert() from public, anon, authenticated;
revoke execute on function public.runs_flag_duplicates() from public, anon, authenticated;

-- Client-callable RPCs.
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.bkk_today() from public, anon;
revoke execute on function public.complete_registration(text, text, text) from public, anon;
revoke execute on function public.my_summary() from public, anon;
revoke execute on function public.leaderboard_individual() from public, anon;
revoke execute on function public.leaderboard_groups() from public, anon;
revoke execute on function public.leaderboard_teams() from public, anon;
revoke execute on function public.my_group() from public, anon;
revoke execute on function public.create_group(text, text) from public, anon;
revoke execute on function public.join_group(text) from public, anon;
revoke execute on function public.leave_group() from public, anon;
revoke execute on function public.remove_member(uuid) from public, anon;
revoke execute on function public.regenerate_join_code() from public, anon;
revoke execute on function public.transfer_leadership(uuid) from public, anon;
revoke execute on function public.update_group(text, text) from public, anon;
revoke execute on function public.admin_list_users() from public, anon;
revoke execute on function public.admin_list_runs(text, boolean) from public, anon;
revoke execute on function public.admin_set_run_status(uuid, text, text) from public, anon;
revoke execute on function public.admin_edit_run(uuid, numeric, integer, text) from public, anon;
revoke execute on function public.admin_void_duplicate_pair(uuid, uuid, text) from public, anon;
revoke execute on function public.admin_set_reveal(boolean) from public, anon;
revoke execute on function public.admin_set_team(uuid, text) from public, anon;
revoke execute on function public.admin_set_user_group(uuid, uuid) from public, anon;
revoke execute on function public.admin_delete_run(uuid, text) from public, anon;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.bkk_today() to authenticated;
grant execute on function public.complete_registration(text, text, text) to authenticated;
grant execute on function public.my_summary() to authenticated;
grant execute on function public.leaderboard_individual() to authenticated;
grant execute on function public.leaderboard_groups() to authenticated;
grant execute on function public.leaderboard_teams() to authenticated;
grant execute on function public.my_group() to authenticated;
grant execute on function public.create_group(text, text) to authenticated;
grant execute on function public.join_group(text) to authenticated;
grant execute on function public.leave_group() to authenticated;
grant execute on function public.remove_member(uuid) to authenticated;
grant execute on function public.regenerate_join_code() to authenticated;
grant execute on function public.transfer_leadership(uuid) to authenticated;
grant execute on function public.update_group(text, text) to authenticated;
grant execute on function public.admin_list_users() to authenticated;
grant execute on function public.admin_list_runs(text, boolean) to authenticated;
grant execute on function public.admin_set_run_status(uuid, text, text) to authenticated;
grant execute on function public.admin_edit_run(uuid, numeric, integer, text) to authenticated;
grant execute on function public.admin_void_duplicate_pair(uuid, uuid, text) to authenticated;
grant execute on function public.admin_set_reveal(boolean) to authenticated;
grant execute on function public.admin_set_team(uuid, text) to authenticated;
grant execute on function public.admin_set_user_group(uuid, uuid) to authenticated;
grant execute on function public.admin_delete_run(uuid, text) to authenticated;
