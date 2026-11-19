-- แก้ปัญหา: ผู้ใช้ที่สมัครก่อนมี trigger ไม่มีแถวใน profiles ทำให้บันทึกรูป/ชื่อไม่ได้
-- รันใน Supabase → SQL Editor 1 ครั้ง

-- 1) อนุญาตให้ผู้ใช้สร้างโปรไฟล์ของตัวเอง
drop policy if exists "users insert own profile" on public.profiles;
create policy "users insert own profile"
  on public.profiles for insert to authenticated
  with check ((select auth.uid()) = id);

-- 2) สร้างโปรไฟล์ให้ผู้ใช้เดิมทุกคนที่ยังไม่มี (ใช้ Display Name จาก Microsoft 365)
insert into public.profiles (id, display_name, avatar_url)
select u.id,
       coalesce(u.raw_user_meta_data ->> 'full_name',
                u.raw_user_meta_data ->> 'name',
                split_part(coalesce(u.email, ''), '@', 1),
                ''),
       u.raw_user_meta_data ->> 'avatar_url'
from auth.users u
where not exists (select 1 from public.profiles p where p.id = u.id);
