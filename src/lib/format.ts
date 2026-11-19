export function fmtKm(n: number): string {
  return n.toLocaleString('th-TH', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
}

/** เพซเป็น นาที:วินาที ต่อ กม. */
export function fmtPace(durationMin: number, distanceKm: number): string {
  const perKm = durationMin / distanceKm;
  const m = Math.floor(perKm);
  const s = Math.round((perKm - m) * 60);
  return `${m}:${String(s === 60 ? 0 : s).padStart(2, '0')}`;
}

export function fmtDuration(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที`;
}
