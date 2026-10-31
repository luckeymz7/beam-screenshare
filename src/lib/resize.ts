// Browser only: crops and shrinks a picked image before upload, so the server only ever stores
// small files (a 12 MB phone photo becomes a ~30 KB picture).

const SIZES = { avatar: { w: 256, h: 256 }, banner: { w: 960, h: 320 } } as const;

export async function resizeImage(file: File, kind: keyof typeof SIZES): Promise<Blob> {
  const { w, h } = SIZES[kind];
  const bitmap = await createImageBitmap(file);
  // Cover: fill the frame, crop what sticks out, centred
  const scale = Math.max(w / bitmap.width, h / bitmap.height);
  const sw = w / scale;
  const sh = h / scale;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (bitmap.width - sw) / 2, (bitmap.height - sh) / 2, sw, sh, 0, 0, w, h);
  bitmap.close();
  const encode = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));
  // Older Safari can't encode WebP (it hands back a PNG): use JPEG there
  const webp = await encode('image/webp', 0.85);
  if (webp && webp.type === 'image/webp') return webp;
  const jpeg = await encode('image/jpeg', 0.85);
  if (!jpeg) throw new Error('Could not read this image');
  return jpeg;
}
