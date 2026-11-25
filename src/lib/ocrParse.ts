// Pure text parsing for OCR output of running-app screenshots (no DOM; unit-testable in Node).

type Time = { sec: number; exact: boolean };

/** Clean common OCR artefacts shared by every parser below. */
function normalize(raw: string): string {
  return raw
    .replace(/[’‘`´°]/g, "'")
    .replace(/[“”″]|''/g, '"')
    .replace(/[|]/g, ' ')
    .replace(/(\d),(\d)/g, '$1.$2')
    // Thai comes out one glyph at a time: "พ . ย ." / "น า ท ี" → "พ.ย." / "นาที"
    .replace(/([฀-๿.])[ \t]+(?=[฀-๿])/g, '$1')
    .replace(/([฀-๿])[ \t]+\./g, '$1.')
    // h:mm:ss split by stray spaces: "0 1:1 5:20" → "01:15:20"
    .replace(/(?<![\d:])(\d) ?(\d) ?: ?(\d) ?(\d) ?: ?(\d) ?(\d)(?![\d:])/g, '$1$2:$3$4:$5$6');
}

/** Pull distance / moving time / pace out of raw OCR text. Exported for testing. */
export function parseRunText(raw: string): { km: number | null; sec: number | null; pace: number | null } {
  const t = normalize(raw);

  // distance: "5.00 km", "4.52\n» km", "4.52 กม.", "3.1 mi" — not a pace ("/km")
  const dists: number[] = [];
  for (const m of t.matchAll(/(?<![\d:'/.])(\d{1,3}\.\d{1,2})(?:[^\d\n:]{0,4}\n)?[^\d\n:/]{0,6}?\s*(km|kn|krn|kilomet(?:er|re)s?|กม|กิโลเมตร|mi\b|miles?)(?!\s*\/)/gi)) {
    let v = parseFloat(m[1]);
    if (/^mi/i.test(m[2])) v *= 1.609344;
    if (v > 0 && v < 200) dists.push(v);
  }
  // very large digits come out spaced, with the point misread: "4 & 5 2 km", "1 0 ® 0 2 km"
  if (!dists.length) {
    for (const m of t.matchAll(/(?<![\d.:])(\d(?:\s?\d){0,2})\s?[&@®©•·°o.,]\s?(\d)\s?(\d)\s?(km|กม)\b/gi)) {
      const v = parseFloat(`${m[1].replace(/\s/g, '')}.${m[2]}${m[3]}`);
      if (v > 0 && v < 200) dists.push(v);
    }
  }
  // whole kilometres: "3 km", "3km" (not "5 km/h")
  if (!dists.length) {
    for (const m of t.matchAll(/(?<![\d.:'/])(\d{1,3})\s?(km|กม)(?![a-z])(?!\.?\s*[/[])/gi)) {
      const v = +m[1];
      if (v > 0 && v < 200) dists.push(v);
    }
  }

  // pace: "7:08 /km" (OCR may read "/" as "["), "10'19\""
  const paces: number[] = [];
  for (const m of t.matchAll(/(?<![\d:])(\d{1,2})\s*[:']\s*(\d{2})\s*"?\s*[/[]\s*(km|kn|กม|mi)/gi)) {
    let s = +m[1] * 60 + +m[2];
    if (/^mi/i.test(m[3])) s /= 1.609344;
    paces.push(s);
  }
  for (const m of t.matchAll(/(?<![\d:])(\d{1,2})'(\d{2})"/g)) paces.push(+m[1] * 60 + +m[2]);
  // "11m 15s/km"
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})\s*m\s*(\d{1,2})\s*s\s*[/[]\s*(km|กม|mi)/gi)) {
    let p = +m[1] * 60 + +m[2];
    if (/^mi/i.test(m[3])) p /= 1.609344;
    paces.push(p);
  }

  // time: h:mm:ss, mm:ss (not a pace), "1h 14m", "35m 41s", Thai ชม./นาที/วินาที
  const times: Time[] = [];
  for (const m of t.matchAll(/(?<![\d:])(\d{1,2})\s?:\s?(\d{2})\s?:\s?(\d{2})(?![\d:])/g))
    times.push({ sec: +m[1] * 3600 + +m[2] * 60 + +m[3], exact: true });
  for (const m of t.matchAll(/(?<!\d)(\d{1,2})\s*(?:h|hr|ชม\.?|ชั่วโมง)\s*(\d{1,2})\s*(?:m|min|นาที)(?:\s*(\d{1,2})\s*(?:s|วินาที))?/gi))
    times.push({ sec: +m[1] * 3600 + +m[2] * 60 + (m[3] ? +m[3] : 0), exact: !!m[3] });
  for (const m of t.matchAll(/(?<![\dh]\s?)(?<!\d)(\d{1,3})\s*(?:m|min|นาที)\s*(\d{1,2})\s*(?:s|sec|วินาที)(?!\s*[/[])/gi))
    times.push({ sec: +m[1] * 60 + +m[2], exact: true });
  // plain mm:ss last — skip the status-bar clock (first line), clock times after a date, and paces
  const body = t.slice(t.indexOf('\n') + 1);
  for (const m of body.matchAll(/(?<![\d:'])(?<!\d{4},?\s?)(\d{1,3}):(\d{2})(?![\d:])(?!\s*"?\s*[/[]\s*k)/g))
    times.push({ sec: +m[1] * 60 + +m[2], exact: true });

  const pace = paces.find((p) => p >= 150 && p <= 1200) ?? null;

  // Unit misread (e.g. "กม." → "a"): fall back to a bare 2-decimal number. With several, keep the one
  // that agrees with time ÷ pace; with exactly one, take it (no other stat on these screens has 2 decimals).
  if (!dists.length) {
    const bare = [...new Set([...t.matchAll(/(?<![\d:'/.])(\d{1,3}\.\d{2})(?![\d.:'])/g)].map((m) => parseFloat(m[1])))]
      .filter((v) => v >= 0.5 && v < 200);
    const fits = pace ? bare.filter((v) => times.some((x) => Math.abs(x.sec - v * pace) <= Math.max(90, v * pace * 0.03))) : [];
    if (fits.length === 1) dists.push(fits[0]);
    else if (bare.length === 1) dists.push(bare[0]);
  }
  const km = dists.length ? dists[0] : null;

  // Prefer the time that agrees with km × pace (moving time, not elapsed); "1h 14m" gets seconds from pace.
  let sec: number | null = null;
  const want = km && pace ? km * pace : null;
  const plausible = times.filter((x) => x.sec >= 60 && x.sec <= 12 * 3600);
  if (want) {
    const ok = plausible.filter((x) => Math.abs(x.sec - want) <= Math.max(90, want * 0.03));
    const exact = ok.find((x) => x.exact);
    if (exact) sec = exact.sec;
    else if (ok.length) sec = Math.round(want);
  }
  if (sec == null) {
    // No pace to check against: the longest exact time (a pace like 9:16 is always shorter than a ≥1 km run).
    const ex = plausible.filter((x) => x.exact).sort((a, b) => b.sec - a.sec)[0];
    if (want) sec = Math.round(want); // none agree with km × pace: trust km × pace over a stray time
    else if (ex) sec = ex.sec;
    else if (plausible.length) sec = plausible[0].sec;
  }

  // Distance unreadable (unit glued on as digits, "4.0704."; unit lost, "3."): derive it from time ÷ pace.
  // Only with a clock-style time (h:mm:ss) so both inputs are solid. OCR sometimes reads the ' of
  // 11'15" as a 7 ("11715\""): accept that shape for the pace here only.
  let derivedKm: number | null = null;
  const solid = times.find((x) => x.exact && x.sec === sec && x.sec >= 600);
  if (km == null && sec != null && solid) {
    let p = pace;
    if (p == null) {
      const m = t.match(/(?<![\d:])(\d{1,2})7([0-5]\d)"/);
      if (m) p = +m[1] * 60 + +m[2];
    }
    if (p != null && p >= 150 && p <= 1200) derivedKm = Math.round((sec / p) * 100) / 100;
  }
  const outKm = km ?? derivedKm;
  return { km: outKm != null ? Math.round(outKm * 100) / 100 : null, sec, pace };
}

// ── Dates ─────────────────────────────────────────────────────────────────────────────────────────
const EN_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const TH_MONTHS: Array<[RegExp, number]> = [
  [/มกรา(?:คม)?|ม\.?\s?ค\./, 1], [/กุมภา(?:พันธ์)?|ก\.?\s?พ\./, 2], [/มีนา(?:คม)?|มี\.?\s?ค\./, 3],
  [/เมษา(?:ยน)?|เม\.?\s?ย\./, 4], [/พฤษภา(?:คม)?|พ\.?\s?ค\./, 5], [/มิถุนา(?:ยน)?|มิ\.?\s?ย\./, 6],
  [/กรกฎา(?:คม)?|ก\.?\s?ค\./, 7], [/สิงหา(?:คม)?|ส\.?\s?ค\./, 8], [/กันยา(?:ยน)?|ก\.?\s?ย\./, 9],
  [/ตุลา(?:คม)?|ต\.?\s?ค\./, 10], [/พฤศจิกา(?:ยน)?|พ\.?\s?ย\./, 11], [/ธันวา(?:คม)?|ธ\.?\s?ค\./, 12],
];

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function valid(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 4-digit, 2-digit, or Thai Buddhist-era year → Gregorian; null when absent. */
function normYear(raw: string | undefined, todayY: number): number | null {
  if (!raw) return null;
  let y = +raw;
  if (raw.length === 2) y = y + 2000 > todayY + 5 ? y + 2500 : y + 2000; // "69" → 2569 BE, "26" → 2026
  if (y > 2400) y -= 543; // Buddhist era
  return y;
}

/**
 * Every date the screenshot might show, as ISO strings (both readings for ambiguous 11/12/2026).
 * "Today"/"วันนี้" and "Yesterday"/"เมื่อวาน" are resolved against `todayIso` (Bangkok, YYYY-MM-DD).
 * Candidates more than ~13 months from today are dropped (OCR noise).
 */
export function parseDates(raw: string, todayIso: string): string[] {
  const t = normalize(raw);
  const [ty, tm, td] = todayIso.split('-').map(Number);
  const out = new Set<string>();
  const add = (y: number | null, m: number, d: number) => {
    const yy = y ?? ty;
    if (valid(yy, m, d)) out.add(iso(yy, m, d));
  };

  // Only with a clock time after it ("Today at 6:14 PM", "วันนี้ 18:14") — a bare "Today" is often a tab label.
  const REL_TIME = String.raw`\s*(?:at|เวลา)?\s*\d{1,2}[:.]\d{2}`;
  if (new RegExp(String.raw`(?:\btoday\b|วันนี้)${REL_TIME}`, 'i').test(t)) out.add(todayIso);
  if (new RegExp(String.raw`(?:\byesterday\b|เมื่อวาน)${REL_TIME}`, 'i').test(t)) {
    const y = new Date(Date.UTC(ty, tm - 1, td - 1));
    out.add(iso(y.getUTCFullYear(), y.getUTCMonth() + 1, y.getUTCDate()));
  }

  // ISO: 2026-11-22, 2026/11/22
  for (const m of t.matchAll(/(?<!\d)(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?!\d)/g)) add(normYear(m[1], ty), +m[2], +m[3]);
  // Numeric a/b/y — could be D/M or M/D; keep both readings
  for (const m of t.matchAll(/(?<![\d/.-])(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})(?![\d/.-])/g)) {
    const y = normYear(m[3], ty);
    add(y, +m[2], +m[1]);
    add(y, +m[1], +m[2]);
  }
  // English month names: "November 22, 2026", "Nov 22", "22 Nov 2026", "Sat, 22 Nov"
  const MON = String.raw`(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?`;
  for (const m of t.matchAll(new RegExp(String.raw`\b${MON}\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?`, 'gi')))
    add(normYear(m[3], ty), EN_MONTHS.indexOf(m[1].toLowerCase()) + 1, +m[2]);
  for (const m of t.matchAll(new RegExp(String.raw`(?<!\d)(\d{1,2})(?:st|nd|rd|th)?\s+${MON}(?:,?\s+(\d{4}))?`, 'gi')))
    add(normYear(m[3], ty), EN_MONTHS.indexOf(m[2].toLowerCase()) + 1, +m[1]);
  // Thai: "22 พ.ย. 2569", "22 พฤศจิกายน 69", "22 พ.ย."
  for (const [re, mon] of TH_MONTHS) {
    for (const m of t.matchAll(new RegExp(String.raw`(?<!\d)(\d{1,2})\s*(?:${re.source})\s*(\d{4}|\d{2})?(?!\d)`, 'g')))
      add(normYear(m[2], ty), mon, +m[1]);
  }

  const today = Date.UTC(ty, tm - 1, td);
  return [...out].filter((d) => {
    const [y, mo, da] = d.split('-').map(Number);
    return Math.abs(Date.UTC(y, mo - 1, da) - today) <= 400 * 86400e3;
  });
}

/**
 * Compare what the screenshot shows with the run day.
 * 'match' when any candidate is the run day, 'mismatch' when dates were read and none is, 'unknown' when none were read.
 */
export function checkPhotoDate(dates: string[], runDayIso: string): { state: 'match' | 'mismatch' | 'unknown'; date: string | null } {
  if (!dates.length) return { state: 'unknown', date: null };
  if (dates.includes(runDayIso)) return { state: 'match', date: runDayIso };
  return { state: 'mismatch', date: dates[0] };
}
