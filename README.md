# Virtual Run – เว็บแอป (React + Vite + Supabase)

เว็บแอปที่ยืดหยุ่นตามขนาดจอ: บนเดสก์ท็อปเป็น sidebar ซ้าย บนมือถือเป็นแถบเมนูลอยด้านล่าง
ล็อกอินด้วย Microsoft ผ่าน Supabase Auth เก็บข้อมูลใน Supabase Postgres และ deploy บน GitHub Pages

**ฟีเจอร์:** ล็อกอิน Microsoft · หน้าหลัก (สรุปสัปดาห์ + กราฟรายวัน + เป้าหมายแรก) · บันทึก/ลบการวิ่ง · ชาเลนจ์ (เข้าร่วม/ออก + อันดับ) · โปรไฟล์

## 1) สร้างโปรเจกต์ Supabase และฐานข้อมูล

1. สร้างโปรเจกต์ที่ https://supabase.com/dashboard
2. ไปที่ **SQL Editor** แล้วรันไฟล์ตามลำดับ
   - `supabase/migrations/0001_init.sql` (ตาราง + Row Level Security + ฟังก์ชันอันดับ)
   - `supabase/seed.sql` (ชาเลนจ์ตัวอย่าง 1 รายการ แก้ชื่อ/เป้าหมายได้)
3. ไปที่ **Project Settings → API** คัดลอก **Project URL** และ **publishable key** (`sb_publishable_...` หรือ anon key แบบเดิมก็ใช้ได้)

> ห้ามนำ `service_role` key มาใส่ในเว็บ ความปลอดภัยของข้อมูลมาจาก RLS ในไฟล์ migration (ผู้ใช้เห็น/แก้ได้เฉพาะการวิ่งของตัวเอง)

## 2) เปิดล็อกอิน Microsoft (Azure) ใน Supabase

**ฝั่ง Microsoft Entra** (https://portal.azure.com → Microsoft Entra ID → App registrations → New registration)

1. เลือก *Supported account types* ให้ตรงกับผู้ใช้ของคุณ (ถ้าให้บัญชี Outlook/Hotmail ล็อกอินได้ด้วย เลือกแบบที่รวมบัญชีส่วนตัว)
2. **Redirect URI** เลือกแพลตฟอร์ม **Web** แล้วใส่  
   `https://<project-ref>.supabase.co/auth/v1/callback`  
   (`<project-ref>` ดูได้จาก Project URL ของ Supabase)
3. ไปที่ **Certificates & secrets** → New client secret แล้วคัดลอกค่าในคอลัมน์ **Value** (ไม่ใช่ Secret ID) เก็บไว้ทันทีเพราะดูซ้ำไม่ได้ และตั้งเตือนวันหมดอายุของ secret
4. แนะนำ: ที่ **Token configuration** เพิ่ม optional claim `email` และ `xms_edov` เพื่อให้ Supabase แน่ใจว่าอีเมลจาก Microsoft ผ่านการยืนยันแล้ว

**ฝั่ง Supabase** (Authentication → Sign In / Providers → Azure)

1. เปิดใช้ Azure ใส่ **Client ID** (Application ID) และ **Secret** (ค่า Value จากข้อ 3)
2. **Azure Tenant URL**: เว้นว่างได้ (ค่าเริ่มต้นคือ `common`) ถ้าแอปรับเฉพาะบัญชีส่วนตัวใส่ `https://login.microsoftonline.com/consumers` ถ้ารับเฉพาะองค์กรของคุณใส่ `https://login.microsoftonline.com/<tenant-id>`
3. ไปที่ **Authentication → URL Configuration**
   - **Site URL**: URL หน้าเว็บจริงของคุณ เช่น `https://<user>.github.io/<repo>/`
   - **Redirect URLs**: เพิ่มทั้ง `https://<user>.github.io/<repo>/` และ `http://localhost:5173/` (ต้องมี `/` ท้าย ตรงกับที่โค้ดส่งเป็น `redirectTo`)

> Azure ไม่รับ `127.0.0.1` เป็น redirect hostname ตอนพัฒนาในเครื่องให้เปิดด้วย `localhost`  
> โค้ดขอ scope `email` ตามที่ Supabase ต้องการสำหรับ Azure

## 3) รันในเครื่อง

```bash
npm install
cp .env.example .env.local     # แล้วใส่ URL และ publishable key
npm run dev                    # เปิด http://localhost:5173
```

## 4) ขึ้น GitHub + deploy อัตโนมัติ (GitHub Pages)

```bash
git init
git add .
git commit -m "Initial commit: Virtual Run web app"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git   # สร้าง repo ว่างบน github.com ก่อน
git push -u origin main
```

จากนั้นใน GitHub repo:

1. **Settings → Pages → Build and deployment → Source: GitHub Actions**
2. **Settings → Secrets and variables → Actions → tab *Variables*** เพิ่ม 2 ตัวแปร  
   `VITE_SUPABASE_URL` และ `VITE_SUPABASE_PUBLISHABLE_KEY`  
   (ค่าสองตัวนี้ถูกฝังใน JavaScript ที่ส่งให้เบราว์เซอร์อยู่แล้ว จึงเก็บเป็น Variables ได้ ไม่ต้องเป็น Secret)
3. push ไป `main` อีกครั้ง (หรือกด *Run workflow*) workflow `.github/workflows/deploy.yml` จะ build แล้ว deploy  
   เว็บจะอยู่ที่ `https://<user>.github.io/<repo>/`
4. อย่าลืมใส่ URL นี้ใน Supabase (ข้อ 2.3)

โปรเจกต์ใช้ `HashRouter` (URL เป็น `/#/runs`) เพื่อให้รีเฟรชหน้าบน GitHub Pages ได้โดยไม่ต้องตั้งค่า rewrite ถ้าย้ายไปโฮสต์อื่นที่รองรับ SPA เปลี่ยนเป็น `BrowserRouter` ได้

## โครงสร้าง

```
supabase/migrations/0001_init.sql   ตาราง profiles, challenges, challenge_members, runs + RLS + ฟังก์ชัน
supabase/seed.sql                   ชาเลนจ์ตัวอย่าง
src/lib/supabase.ts                 สร้าง client (PKCE)
src/lib/api.ts                      ฟังก์ชันเรียกฐานข้อมูลทั้งหมด
src/auth/AuthProvider.tsx           session, โปรไฟล์, ล็อกอิน/ออกจากระบบ
src/components/                     Layout (sidebar/tab bar), Protected, Icons
src/pages/                          Login, Home, Challenges, Runs, Profile
src/styles.css                      สไตล์ + breakpoint (ตัดที่ 899px และ 1100px)
.github/workflows/deploy.yml        build + deploy GitHub Pages
```

## การจัดการข้อมูล

- **สร้างชาเลนจ์ใหม่**: ผู้ใช้ทั่วไปสร้างเองไม่ได้ (ตั้งใจ) เพิ่มที่ Table Editor ของ Supabase หรือด้วย SQL ตามตัวอย่างใน `seed.sql`
- **อันดับ**: คำนวณจากระยะวิ่งของสมาชิกที่ `ran_on` อยู่ระหว่างวันเริ่ม–วันจบของชาเลนจ์ ผ่านฟังก์ชัน `challenge_leaderboard` (แสดงชื่อที่ผู้ใช้ตั้งไว้ในโปรไฟล์ให้ผู้ล็อกอินคนอื่นเห็น)
- **ข้อมูลส่วนตัว**: ผู้ล็อกอินทุกคนอ่านชื่อที่แสดง (`display_name`) ของกันและกันได้เพราะต้องใช้ในอันดับ ไม่เห็นอีเมลหรือประวัติการวิ่งของคนอื่น

## ทำต่อได้

- ใช้ฐานข้อมูลเดียวกันกับแอปมือถือ (React Native + `@supabase/supabase-js` และ provider `azure` เช่นกัน)
- นำเข้าข้อมูลจากนาฬิกา/Strava, อัปโหลดรูปโปรไฟล์ (Supabase Storage), ชาเลนจ์แบบทีม
