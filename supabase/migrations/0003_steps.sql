-- เพิ่มการบันทึกแบบ "ก้าว" ควบคู่กับ กม.
-- รันใน Supabase → SQL Editor 1 ครั้ง (ก่อนใช้งานเวอร์ชันใหม่)
-- distance_km ยังเป็นค่าหลักที่ใช้จัดอันดับ: ถ้ากรอกเป็นก้าว แอปจะแปลงเป็น กม. ให้ (1 ก้าว = 0.00075 กม.)

alter table public.runs
  add column if not exists steps integer check (steps is null or (steps > 0 and steps <= 400000)),
  add column if not exists entry_type text not null default 'km' check (entry_type in ('km', 'steps'));

-- เติมก้าวย้อนหลังให้แถวเดิม (ประมาณจาก กม.)
update public.runs set steps = round(distance_km / 0.00075) where steps is null;
