// 10 Chibi Runner Avatars (transparent PNGs stored in public/avatars/)

const BASE = `${import.meta.env.BASE_URL}avatars/`;

export const DEFAULT_AVATAR_BG = '#E5E5E0';

export const AVATAR_BG_COLORS: { id: string; label: string; color: string }[] = [
  { id: 'stone', label: 'Warm Stone', color: '#E5E5E0' },
  { id: 'orange', label: 'VISTEC Orange', color: '#F26A21' },
  { id: 'amber', label: 'Amber', color: '#FBBF24' },
  { id: 'mint', label: 'Mint', color: '#34D399' },
  { id: 'cyan', label: 'Cyan', color: '#38BDF8' },
  { id: 'blue', label: 'Royal Blue', color: '#60A5FA' },
  { id: 'indigo', label: 'Indigo', color: '#818CF8' },
  { id: 'purple', label: 'Lavender', color: '#C084FC' },
  { id: 'pink', label: 'Rose Pink', color: '#F472B6' },
  { id: 'slate', label: 'Charcoal', color: '#334155' },
];

export const CHIBI_AVATARS: { id: string; label: string; url: string }[] = [
  { id: 'chibi-1', label: 'Shiba', url: `${BASE}chibi-1.png` },
  { id: 'chibi-2', label: 'Tabby Cat', url: `${BASE}chibi-2.png` },
  { id: 'chibi-3', label: 'Golden', url: `${BASE}chibi-3.png` },
  { id: 'chibi-4', label: 'White Cat', url: `${BASE}chibi-4.png` },
  { id: 'chibi-5', label: 'Corgi', url: `${BASE}chibi-5.png` },
  { id: 'chibi-6', label: 'Bunny', url: `${BASE}chibi-6.png` },
  { id: 'chibi-7', label: 'Penguin', url: `${BASE}chibi-7.png` },
  { id: 'chibi-8', label: 'Panda', url: `${BASE}chibi-8.png` },
  { id: 'chibi-9', label: 'Duck', url: `${BASE}chibi-9.png` },
  { id: 'chibi-10', label: 'Hamster', url: `${BASE}chibi-10.png` },
];

export function getDefaultAvatar(seed = ''): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return CHIBI_AVATARS[hash % CHIBI_AVATARS.length].url;
}

/**
 * Composite a transparent chibi PNG over a chosen solid background color into a 256x256 Data URL.
 */
export function composeChibiAvatar(chibiUrl: string, bgColor: string, size = 256): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onerror = () => reject(new Error('Failed to load avatar image'));
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Canvas error'));
      ctx.fillStyle = bgColor || DEFAULT_AVATAR_BG;
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      resolve(canvas.toDataURL('image/jpeg', 0.92));
    };
    img.src = chibiUrl;
  });
}

/** 'chibi-3' for '.../avatars/chibi-3.png', otherwise null. */
export function chibiIdFromUrl(url: string): string | null {
  const m = /\/avatars\/(chibi-(?:10|[1-9]))\.png(?:[?#].*)?$/.exec(url);
  return m ? m[1] : null;
}

export function chibiUrl(id: string): string {
  return `${BASE}${id}.png`;
}

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image load failed'));
    img.src = src;
  });
}

const detectCache = new Map<string, string | null>();

/**
 * Work out which chibi preset an avatar picture was composed from (composeChibiAvatar output).
 * Compares a 32x32 thumbnail against every preset drawn on the same background colour.
 * Returns e.g. 'chibi-3', or null when it is not a chibi (an uploaded photo).
 */
export async function detectChibi(src: string): Promise<string | null> {
  if (!src) return null;
  const direct = chibiIdFromUrl(src);
  if (direct) return direct;
  if (detectCache.has(src)) return detectCache.get(src) ?? null;
  const N = 32;
  const canvas = document.createElement('canvas');
  canvas.width = N;
  canvas.height = N;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  try {
    const target = await loadImg(src);
    ctx.drawImage(target, 0, 0, N, N);
    const t = ctx.getImageData(0, 0, N, N).data;
    // background colour = top-left corner (chibis never reach the corners)
    const bg = `rgb(${t[0]},${t[1]},${t[2]})`;
    let best: string | null = null;
    let bestScore = Infinity;
    for (const c of CHIBI_AVATARS) {
      const img = await loadImg(c.url);
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, N, N);
      ctx.drawImage(img, 0, 0, N, N);
      const p = ctx.getImageData(0, 0, N, N).data;
      let diff = 0;
      for (let i = 0; i < p.length; i += 4) diff += Math.abs(p[i] - t[i]) + Math.abs(p[i + 1] - t[i + 1]) + Math.abs(p[i + 2] - t[i + 2]);
      const score = diff / (N * N * 3);
      if (score < bestScore) {
        bestScore = score;
        best = c.id;
      }
    }
    const result = bestScore < 22 ? best : null;
    detectCache.set(src, result);
    return result;
  } catch {
    return null;
  }
}
