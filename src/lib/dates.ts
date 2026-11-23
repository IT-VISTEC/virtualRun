export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** วันจันทร์ของสัปดาห์นี้ (เวลาท้องถิ่น) */
export function weekStart(from = new Date()): Date {
  const d = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const offset = (d.getDay() + 6) % 7; // จันทร์ = 0
  d.setDate(d.getDate() - offset);
  return d;
}

export function parseISODate(s: string): Date {
  return new Date(`${s}T00:00:00`);
}

export function formatShort(s: string): string {
  return parseISODate(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Today's date (YYYY-MM-DD) in Asia/Bangkok, computed on the client. */
export function bangkokToday(now = new Date()): string {
  // Preview harness override (set by the mock api); never set in production.
  const override = (globalThis as { __VR_TODAY__?: string }).__VR_TODAY__;
  if (override) return override;
  return now.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}

/** Every date (YYYY-MM-DD) from start to end inclusive. */
export function dateRange(start: string, end: string): string[] {
  const out: string[] = [];
  const d = parseISODate(start);
  const last = parseISODate(end);
  while (d <= last) {
    out.push(toISODate(d));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export function formatLong(s: string): string {
  return parseISODate(s).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}
