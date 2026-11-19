import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// VITE_BASE ใช้ตอน deploy บน GitHub Pages เช่น /virtual-run-web/ (ตั้งใน workflow ให้อัตโนมัติ)
export default defineConfig({
  plugins: [react()],
  base: process.env.VITE_BASE ?? '/',
});
