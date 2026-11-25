/** ชนิดไฟล์ที่เบราว์เซอร์ถอดรหัสได้ทั่วไป (HEIC จากไอโฟนจะถูกแปลงเป็น JPEG โดย iOS ตอนเลือกรูป) */
export const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif';
export const FORMATS_LABEL = 'JPG, PNG, WebP, GIF, BMP, AVIF';
export const MAX_INPUT_BYTES = 15 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // ต้องตรงกับ file_size_limit ของ bucket
const MAX_SIDE = 1280;

/** Lowercase hex SHA-256 of the file's bytes (use the ORIGINAL file, before toPng). */
export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

export type CompressedImage = { blob: Blob; type: 'image/webp' | 'image/jpeg'; ext: 'webp' | 'jpg' };

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not convert the image.'))), type, quality),
  );
}

/** WebP where the browser can encode it; Safari (all versions) silently returns PNG, so fall back to JPEG. */
async function encode(canvas: HTMLCanvasElement, quality: number): Promise<CompressedImage> {
  const webp = await canvasToBlob(canvas, 'image/webp', quality);
  if (webp.type === 'image/webp') return { blob: webp, type: 'image/webp', ext: 'webp' };
  const jpg = await canvasToBlob(canvas, 'image/jpeg', quality);
  return { blob: jpg, type: 'image/jpeg', ext: 'jpg' };
}

/** Resize (long side ≤ 1280 px, EXIF-rotated) and compress for upload. Keeps text on screenshots readable. */
export async function compressImage(file: File): Promise<CompressedImage> {
  if (file.size > MAX_INPUT_BYTES) throw new Error('Image is too large (max 15 MB).');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`Unsupported image. Please use ${FORMATS_LABEL}.`);
  }
  try {
    let side = MAX_SIDE;
    let quality = 0.8;
    for (let attempt = 0; attempt < 4; attempt++) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#fff'; // JPEG has no alpha: transparent areas become white, not black
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const out = await encode(canvas, quality);
      if (out.blob.size <= MAX_OUTPUT_BYTES) return out;
      side = Math.round(side * 0.75);
      quality = Math.max(0.6, quality - 0.1);
    }
    throw new Error('Image is still too large after resizing. Try a smaller image.');
  } finally {
    bitmap.close();
  }
}
