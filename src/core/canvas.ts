import { cropBox, type Box, type Crop, type Size } from './geometry';

/** A white canvas, or null if the browser cannot actually back one this large (probed by reading the last pixel). */
export function makeCanvas(width: number, height: number): HTMLCanvasElement | null {
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no 2d context');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#000';
    ctx.fillRect(width - 1, height - 1, 1, 1);
    if (ctx.getImageData(width - 1, height - 1, 1, 1).data[3] === 255) {
      ctx.fillStyle = '#fff';
      ctx.fillRect(width - 1, height - 1, 1, 1);
      return canvas;
    }
  } catch {
    // fall through
  }
  canvas.width = canvas.height = 0;
  return null;
}

/** Largest canvas up to `size` (and `maxEdge`), shrinking 20% at a time. `scale` < 1 means it was reduced. */
export function makeCanvasFit(size: Size, maxEdge = 16384): { canvas: HTMLCanvasElement; scale: number } {
  let scale = Math.min(1, maxEdge / Math.max(size.width, size.height));
  for (;;) {
    const canvas = makeCanvas(Math.max(1, Math.round(size.width * scale)), Math.max(1, Math.round(size.height * scale)));
    if (canvas) return { canvas, scale };
    scale *= 0.8;
    if (scale < 0.02) throw new Error('This computer cannot make an image that large. Try fewer rows or columns.');
  }
}

/** Halve in steps before the final draw: one big downscale skips pixels and looks jagged. */
export function drawSmooth(ctx: CanvasRenderingContext2D, source: CanvasImageSource, box: Box, dx: number, dy: number, dw: number, dh: number) {
  let src = source;
  let { left: sx, top: sy, w: sw, h: sh } = box;
  const temps: HTMLCanvasElement[] = [];
  while (sw > dw * 2 && sh > dh * 2) {
    const step = Object.assign(document.createElement('canvas'), { width: Math.ceil(sw / 2), height: Math.ceil(sh / 2) });
    const stepCtx = step.getContext('2d')!;
    stepCtx.imageSmoothingQuality = 'high';
    stepCtx.drawImage(src, sx, sy, sw, sh, 0, 0, step.width, step.height);
    temps.push(step);
    src = step;
    sx = sy = 0;
    sw = step.width;
    sh = step.height;
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(src, sx, sy, sw, sh, dx, dy, dw, dh);
  for (const t of temps) t.width = t.height = 0;
}

/**
 * Draw the part of a photo that a frame of aspect dw/dh shows into (dx, dy, dw, dh).
 * `bitmap` may be a downscaled copy; `photoSize` is the full oriented size the crop refers to.
 */
export function drawPhotoCropped(
  ctx: CanvasRenderingContext2D,
  bitmap: CanvasImageSource & { width: number; height: number },
  photoSize: Size,
  crop: Crop,
  aspect: number,
  dx: number,
  dy: number,
  dw: number,
  dh: number,
) {
  const box = cropBox(photoSize, crop, aspect);
  const sx = bitmap.width / photoSize.width;
  const sy = bitmap.height / photoSize.height;
  drawSmooth(ctx, bitmap, { left: box.left * sx, top: box.top * sy, w: box.w * sx, h: box.h * sy }, dx, dy, dw, dh);
}

export async function toJpeg(canvas: HTMLCanvasElement | OffscreenCanvas, quality = 0.95): Promise<Uint8Array> {
  const blob =
    canvas instanceof HTMLCanvasElement
      ? await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality))
      : await canvas.convertToBlob({ type: 'image/jpeg', quality });
  if (!blob) throw new Error('The image could not be encoded. Try a smaller size.');
  return new Uint8Array(await blob.arrayBuffer());
}
