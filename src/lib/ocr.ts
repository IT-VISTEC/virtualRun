// Read distance + moving time from a running-app screenshot, entirely in the browser (Tesseract.js).
// Tesseract is loaded only when a photo is picked. Language data is served from /public/tessdata.
// Tested against Strava (activity page + share cards) and Mi Fitness screenshots: 10/10.
import type { Worker } from 'tesseract.js';
import { parseDates, parseRunText } from './ocrParse';

export { checkPhotoDate } from './ocrParse';

export interface OcrResult {
  distanceKm: number | null;
  durationSec: number | null;
  /** Dates the screenshot appears to show (ISO; ambiguous 11/12 gives both readings). */
  dates: string[];
}

const EMPTY: OcrResult = { distanceKm: null, durationSec: null, dates: [] };

const workers = new Map<string, Promise<Worker>>();
function getWorker(lang: string): Promise<Worker> {
  let w = workers.get(lang);
  if (!w) {
    w = import('tesseract.js').then(({ createWorker }) =>
      createWorker(lang, 1, { langPath: `${import.meta.env.BASE_URL}tessdata`, gzip: true }),
    );
    w.catch(() => workers.delete(lang)); // allow a retry on the next photo
    workers.set(lang, w);
  }
  return w;
}

// Tried in order until both values are found. Thai+English reads mixed screens best; English-only reads
// big spaced digits ("4.52") that the Thai model splits apart; inverted helps light-on-dark text.
const PASSES: Array<[lang: string, invert: boolean]> = [
  ['eng+tha', false],
  ['eng', false],
  ['eng', true],
];

/** Grayscale, scaled to 1600 px wide (optionally inverted) — what tested best. */
async function prepare(blob: Blob, invert: boolean): Promise<HTMLCanvasElement> {
  const bmp = await createImageBitmap(blob);
  // 1600 px wide, but keep the canvas under ~12 MP (very tall scrolling screenshots break iOS canvases)
  const scale = Math.min(1600 / bmp.width, Math.sqrt(12e6 / (bmp.width * bmp.height)) || 1);
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(bmp.width * scale));
  c.height = Math.max(1, Math.round(bmp.height * scale));
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.filter = invert ? 'grayscale(1) invert(1)' : 'grayscale(1)';
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return c;
}

export async function extractRunFromImage(imageSource: Blob | string, todayIso: string): Promise<OcrResult> {
  try {
    const blob = typeof imageSource === 'string' ? await fetch(imageSource).then((r) => r.blob()) : imageSource;
    let best = EMPTY;
    const n = (r: OcrResult) => (r.distanceKm != null ? 1 : 0) + (r.durationSec != null ? 1 : 0);
    for (const [lang, invert] of PASSES) {
      const worker = await getWorker(lang);
      const { data } = await worker.recognize(await prepare(blob, invert));
      const r = parseRunText(data.text);
      const dates = [...new Set([...best.dates, ...parseDates(data.text, todayIso)])];
      const res = { distanceKm: r.km, durationSec: r.sec, dates };
      if (n(res) === 2) return res;
      best = n(res) > n(best) ? res : { ...best, dates };
    }
    return best;
  } catch (e) {
    console.warn('[OCR]', e);
    return EMPTY;
  }
}
