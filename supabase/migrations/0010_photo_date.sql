-- VISTEC Virtual Run — flag runs whose screenshot shows a different day.
-- The browser reads the date printed on the screenshot (OCR) and sends it as runs.photo_date.
-- If it is not the run day, the run gets flag 'date_mismatch'; if no date was read, flag 'no_date'.
-- Either way it goes to 'pending' for an admin. This is a hint, not a guarantee: the value comes from the client.
-- Run once in the Supabase SQL editor (safe to re-run). Requires 0005.

alter table public.runs add column if not exists photo_date date;

-- Same as 0005 plus the photo_date check (search for "photo_date").
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
    -- photo_date: no date read from the screenshot, or another day → flag for review
    if new.photo_date is null then
      new.flags := array_append(new.flags, 'no_date');
    elsif new.photo_date <> new.ran_on then
      new.flags := array_append(new.flags, 'date_mismatch');
    end if;
    new.status := case
      when new.distance_km > 20 or (new.duration_sec::numeric / nullif(new.distance_km, 0)) < 270 then 'pending'
      when new.flags && array['date_mismatch', 'no_date'] then 'pending'
      else 'counted' end;
  end if;
  return new;
end;
$$;

-- Duplicate photo: still flags every run sharing the hash, and now also holds the NEW run as
-- 'pending' so it doesn't count until an admin decides (older runs keep their status).
create or replace function public.runs_flag_duplicates()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.image_sha256 is null then return null; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(new.image_sha256, 0));
  if exists (
    select 1 from public.runs r where r.image_sha256 = new.image_sha256 and r.id <> new.id
  ) then
    update public.runs r
      set flags = case when 'duplicate_image' = any (r.flags) then r.flags
                       else array_append(r.flags, 'duplicate_image') end,
          status = case when r.id = new.id and r.status = 'counted' then 'pending' else r.status end
      where r.image_sha256 = new.image_sha256
        and (not ('duplicate_image' = any (r.flags)) or r.id = new.id);
  end if;
  return null;
end;
$$;

-- admin_list_runs gains photo_date (return type changes, so drop first).
drop function if exists public.admin_list_runs(text, boolean);
create function public.admin_list_runs(p_status text default null, p_flagged_only boolean default false)
returns table (run_id uuid, user_id uuid, display_name text, email text, team text, ran_on date,
               distance_km numeric, duration_sec integer, pace_sec_per_km numeric, image_path text,
               image_sha256 text, status text, flags text[], review_note text, reviewed_at timestamptz,
               created_at timestamptz, photo_date date)
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
           r.image_path, r.image_sha256, r.status, r.flags, r.review_note, r.reviewed_at, r.created_at,
           r.photo_date
    from public.runs r
    join public.profiles p on p.id = r.user_id
    left join auth.users u on u.id = r.user_id
    where (p_status is null or r.status = p_status)
      and (not coalesce(p_flagged_only, false) or cardinality(r.flags) > 0)
    order by r.created_at desc;
end;
$$;
revoke execute on function public.admin_list_runs(text, boolean) from public, anon;
grant execute on function public.admin_list_runs(text, boolean) to authenticated;

notify pgrst, 'reload schema';
