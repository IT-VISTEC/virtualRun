-- ชาเลนจ์ตัวอย่าง (แก้ชื่อ/ระยะเป้าหมายได้ตามต้องการ) — รันใน SQL Editor หลังรัน migration
insert into public.challenges (title, description, starts_on, ends_on, target_km)
values (
  'ชาเลนจ์ประจำสัปดาห์',
  'วิ่งสะสมระยะให้มากที่สุดภายใน 7 วัน',
  date_trunc('week', current_date)::date,
  (date_trunc('week', current_date) + interval '6 days')::date,
  30
);
