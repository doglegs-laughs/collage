import { drawSmooth, makeCanvas, toJpeg } from '../core/canvas';
import type { Size } from '../core/geometry';
import { getBitmapForSize, type Photo } from '../core/images';
import type { PlanFrame } from './plan';
import { placePhoto, type GifFit } from './shape';

export type Bitmap = CanvasImageSource & Size;

export type FrameStyle = { size: Size; fit: GifFit; background: string };

/** Draws the frames of one animation. Preview and export share it, so what plays is what is saved. */
export function createFrameDrawer({ size, fit, background }: FrameStyle) {
  // A blend in Fit mode needs the next photo on its own letterboxed layer, or the previous one would show through its bars.
  const layer = fit === 'fit' ? Object.assign(document.createElement('canvas'), size) : null;
  const paint = (ctx: CanvasRenderingContext2D, bitmap: Bitmap) => {
    const p = placePhoto(bitmap, size, fit);
    if (fit === 'fit') {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, size.width, size.height);
    }
    drawSmooth(ctx, bitmap, { left: p.sx, top: p.sy, w: p.sw, h: p.sh }, p.dx, p.dy, p.dw, p.dh);
  };
  return {
    draw(ctx: CanvasRenderingContext2D, bitmaps: Bitmap[], frame: PlanFrame) {
      paint(ctx, bitmaps[frame.a]);
      if (frame.mix <= 0 || frame.b === frame.a) return;
      ctx.save();
      ctx.globalAlpha = frame.mix;
      if (layer) {
        paint(layer.getContext('2d')!, bitmaps[frame.b]);
        ctx.drawImage(layer, 0, 0);
      } else {
        paint(ctx, bitmaps[frame.b]);
      }
      ctx.restore();
    },
    dispose() {
      if (layer) layer.width = layer.height = 0;
    },
  };
}

/** Long edge to decode `photo` at so it is sharp in an output of `size`, but no bigger. */
export function decodeEdge(photo: Size, size: Size, fit: GifFit): number {
  const scale = fit === 'fill' ? Math.max(size.width / photo.width, size.height / photo.height) : Math.min(size.width / photo.width, size.height / photo.height);
  return Math.ceil(Math.max(photo.width, photo.height) * Math.min(1, scale));
}

export const FRAME_JPEG_QUALITY = 0.92;

/** Renders every frame to JPEG bytes at the output size. Identical frames (a boomerang's return trip) are encoded once. */
export async function renderFrames(
  photos: Photo[],
  frames: PlanFrame[],
  style: FrameStyle,
  opts: { cancelled: () => boolean; onProgress: (done: number, total: number) => void },
): Promise<Uint8Array[] | null> {
  const bitmaps: ImageBitmap[] = [];
  const drawer = createFrameDrawer(style);
  const canvas = makeCanvas(style.size.width, style.size.height);
  try {
    if (!canvas) throw new Error('This size is too large for this computer. Try a smaller width.');
    for (const photo of photos) bitmaps.push(await getBitmapForSize(photo, decodeEdge(photo, style.size, style.fit)));
    const ctx = canvas.getContext('2d')!;
    const done = new Map<string, Uint8Array>();
    const out: Uint8Array[] = [];
    for (const [i, frame] of frames.entries()) {
      if (opts.cancelled()) return null;
      const key = frame.mix > 0 ? `${frame.a}>${frame.b}@${frame.mix}` : `${frame.a}`;
      let bytes = done.get(key);
      if (!bytes) {
        ctx.fillStyle = style.background;
        ctx.fillRect(0, 0, style.size.width, style.size.height);
        drawer.draw(ctx, bitmaps, frame);
        bytes = await toJpeg(canvas, FRAME_JPEG_QUALITY);
        done.set(key, bytes);
      }
      out.push(bytes);
      opts.onProgress(i + 1, frames.length);
    }
    return out;
  } finally {
    for (const b of bitmaps) b.close();
    drawer.dispose();
    if (canvas) canvas.width = canvas.height = 0;
  }
}
