// 10 Chibi Runner Avatars (stored in public/avatars/)

const BASE = `${import.meta.env.BASE_URL}avatars/`;

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
