export function fmtKm(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** 1 step ≈ 0.75 m */
export const KM_PER_STEP = 0.00075;
export const stepsToKm = (steps: number): number => Math.round(steps * KM_PER_STEP * 100) / 100;
export const kmToSteps = (km: number): number => Math.round(km / KM_PER_STEP);
export function fmtSteps(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/** Pace as min:sec per km */
export function fmtPace(durationMin: number, distanceKm: number): string {
  const perKm = durationMin / distanceKm;
  const m = Math.floor(perKm);
  const s = Math.round((perKm - m) * 60);
  return `${m}:${String(s === 60 ? 0 : s).padStart(2, '0')}`;
}

/** Pace from seconds per km -> "m:ss" (e.g. 330 -> "5:30"). */
export function fmtPaceSec(secPerKm: number): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return '–';
  const total = Math.round(secPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Seconds -> "h:mm:ss" (or "m:ss" under an hour). */
export function fmtHms(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = String(s % 60).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${r}` : `${m}:${r}`;
}

/** Server rule: a run goes to review when pace < 4:30 /km or distance > 20 km. */
export const REVIEW_PACE_SEC = 270;
export const REVIEW_DISTANCE_KM = 20;
export const needsReview = (km: number, sec: number): boolean =>
  km > REVIEW_DISTANCE_KM || (km > 0 && sec / km < REVIEW_PACE_SEC);

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
