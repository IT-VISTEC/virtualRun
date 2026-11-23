-- แนบรูปในการบันทึกการวิ่ง: เก็บไฟล์ PNG ใน Supabase Storage และเก็บ path ไว้ในตาราง runs
-- รันใน Supabase → SQL Editor 1 ครั้ง

alter table public.runs
  add column if not exists image_path text
  check (image_path is null or image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.png$');

-- bucket แบบ private: รับเฉพาะ PNG ไม่เกิน 5 MB (แอปแปลงเป็น PNG ก่อนอัปโหลด)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('run-images', 'run-images', false, 5242880, array['image/png'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/png'];

-- เจ้าของไฟล์เท่านั้น (โฟลเดอร์ = auth.uid()) อ่าน / อัปโหลด / ลบได้
drop policy if exists "run images: owner read" on storage.objects;
drop policy if exists "run images: owner insert" on storage.objects;
drop policy if exists "run images: owner delete" on storage.objects;

create policy "run images: owner read" on storage.objects for select to authenticated
  using (bucket_id = 'run-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "run images: owner insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'run-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
create policy "run images: owner delete" on storage.objects for delete to authenticated
  using (bucket_id = 'run-images' and (storage.foldername(name))[1] = (select auth.uid())::text);
