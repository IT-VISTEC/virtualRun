-- Virtual Run: schema + Row Level Security
-- รันใน Supabase Dashboard → SQL Editor หรือ `supabase db push`

-- ───────── ตาราง ─────────
create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  avatar_url text,
  created_at timestamptz not null default now()
);

create table public.challenges (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  starts_on date not null,
  ends_on date not null,
  target_km numeric(6,1) check (target_km is null or target_km > 0),
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on)
);

create table public.challenge_members (
  challenge_id uuid not null references public.challenges (id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (challenge_id, user_id)
);

create table public.runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  ran_on date not null default current_date,
  distance_km numeric(6,2) not null check (distance_km > 0 and distance_km <= 300),
  duration_min numeric(7,1) check (duration_min is null or duration_min > 0),
  elevation_m integer check (elevation_m is null or elevation_m >= 0),
  note text check (note is null or char_length(note) <= 500),
  created_at timestamptz not null default now()
);

create index runs_user_date_idx on public.runs (user_id, ran_on desc);
create index challenge_members_user_idx on public.challenge_members (user_id);

-- ───────── สร้างโปรไฟล์อัตโนมัติเมื่อมีผู้ใช้ใหม่ (Microsoft login) ─────────
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, ''), '@', 1),
      ''
    ),
    new.raw_user_meta_data ->> 'avatar_url'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────── Row Level Security ─────────
alter table public.profiles enable row level security;
alter table public.challenges enable row level security;
alter table public.challenge_members enable row level security;
alter table public.runs enable row level security;

-- profiles: ผู้ใช้ที่ล็อกอินอ่านชื่อกันได้ (ใช้แสดงอันดับ) แก้ได้เฉพาะของตัวเอง
create policy "profiles are readable by signed-in users"
  on public.profiles for select to authenticated using (true);
create policy "users update own profile"
  on public.profiles for update to authenticated
  using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

-- challenges: อ่านได้ทุกคนที่ล็อกอิน ส่วนการสร้าง/แก้ไขทำผ่าน Dashboard (service role) เท่านั้น
create policy "challenges are readable by signed-in users"
  on public.challenges for select to authenticated using (true);

-- challenge_members: เห็น/เข้า/ออก ได้เฉพาะของตัวเอง
create policy "users read own memberships"
  on public.challenge_members for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "users join challenges as themselves"
  on public.challenge_members for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "users leave challenges"
  on public.challenge_members for delete to authenticated
  using ((select auth.uid()) = user_id);

-- runs: เจ้าของเท่านั้น
create policy "users read own runs"
  on public.runs for select to authenticated using ((select auth.uid()) = user_id);
create policy "users insert own runs"
  on public.runs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "users update own runs"
  on public.runs for update to authenticated
  using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "users delete own runs"
  on public.runs for delete to authenticated using ((select auth.uid()) = user_id);

-- ───────── ฟังก์ชันสำหรับหน้าชาเลนจ์ ─────────
-- security definer เพราะต้องนับสมาชิก/รวมระยะของคนอื่น ซึ่ง RLS ปกติไม่ให้อ่าน
create function public.list_challenges()
returns table (
  id uuid, title text, description text,
  starts_on date, ends_on date, target_km numeric,
  member_count bigint, joined boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select c.id, c.title, c.description, c.starts_on, c.ends_on, c.target_km,
         (select count(*) from public.challenge_members m where m.challenge_id = c.id),
         exists (select 1 from public.challenge_members m
                 where m.challenge_id = c.id and m.user_id = auth.uid())
  from public.challenges c
  order by c.starts_on desc, c.created_at desc;
$$;

create function public.challenge_leaderboard(p_challenge uuid)
returns table (rank bigint, user_id uuid, display_name text, total_km numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select rank() over (order by coalesce(sum(r.distance_km), 0) desc),
         p.id,
         p.display_name,
         coalesce(sum(r.distance_km), 0)
  from public.challenges c
  join public.challenge_members m on m.challenge_id = c.id
  join public.profiles p on p.id = m.user_id
  left join public.runs r
    on r.user_id = p.id and r.ran_on between c.starts_on and c.ends_on
  where c.id = p_challenge
  group by p.id, p.display_name
  order by 1, p.display_name
  limit 100;
$$;

revoke execute on function public.list_challenges() from public, anon;
revoke execute on function public.challenge_leaderboard(uuid) from public, anon;
grant execute on function public.list_challenges() to authenticated;
grant execute on function public.challenge_leaderboard(uuid) to authenticated;
