/** ชนิดไฟล์ที่เบราว์เซอร์ถอดรหัสได้ทั่วไป (HEIC จากไอโฟนจะถูกแปลงเป็น JPEG โดย iOS ตอนเลือกรูป) */
export const ACCEPT = 'image/jpeg,image/png,image/webp,image/gif,image/bmp,image/avif';
export const FORMATS_LABEL = 'JPG, PNG, WebP, GIF, BMP, AVIF';
export const MAX_INPUT_BYTES = 15 * 1024 * 1024;
export const MAX_OUTPUT_BYTES = 5 * 1024 * 1024; // ต้องตรงกับ file_size_limit ของ bucket
const MAX_SIDE = 1600;

/** Lowercase hex SHA-256 of the file's bytes (use the ORIGINAL file, before toPng). */
export async function sha256Hex(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not convert the image.'))), 'image/png'),
  );
}

/** แปลงรูปเป็น PNG (หมุนตาม EXIF, ย่อด้านยาวไม่เกิน 1600px, ลดขนาดซ้ำถ้ายังเกิน 5 MB) */
export async function toPng(file: File): Promise<Blob> {
  if (file.size > MAX_INPUT_BYTES) throw new Error('Image is too large (max 15 MB).');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`Unsupported image. Please use ${FORMATS_LABEL}.`);
  }
  try {
    let side = MAX_SIDE;
    for (let attempt = 0; attempt < 4; attempt++) {
      const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const png = await canvasToPng(canvas);
      if (png.size <= MAX_OUTPUT_BYTES) return png;
      side = Math.round(side * 0.7);
    }
    throw new Error('Image is still too large after resizing. Try a smaller image.');
  } finally {
    bitmap.close();
  }
}
