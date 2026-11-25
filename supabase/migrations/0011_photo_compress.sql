-- VISTEC Virtual Run — run photos are now compressed in the browser to WebP (JPEG on Safari, which can't encode WebP).
-- Allows .webp / .jpg object names and mime types; existing .png photos stay valid.
-- Run once in the Supabase SQL editor (safe to re-run). Requires 0004.

alter table public.runs drop constraint if exists runs_image_path_check;
alter table public.runs add constraint runs_image_path_check
  check (image_path is null or image_path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}\.(png|webp|jpg)$');

update storage.buckets
set allowed_mime_types = array['image/png', 'image/webp', 'image/jpeg'],
    file_size_limit = 5242880
where id = 'run-images';
