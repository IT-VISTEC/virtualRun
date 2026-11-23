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

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}
