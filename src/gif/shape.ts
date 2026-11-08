import type { Size } from '../core/geometry';

export type GifShape = 'original' | '1:1' | '4:5' | '9:16' | '16:9';
export type GifFit = 'fill' | 'fit';
export const GIF_WIDTHS = [480, 720, 1080] as const;

const RATIOS: Record<Exclude<GifShape, 'original'>, number> = { '1:1': 1, '4:5': 4 / 5, '9:16': 9 / 16, '16:9': 16 / 9 };

/** Output pixel size: `width` wide, height from the shape (Original follows `first`, the first photo, within 1:3 to 3:1). */
export function gifSize(first: Size | null, shape: GifShape, width: number): Size {
  const ratio = shape === 'original' ? Math.min(3, Math.max(1 / 3, first ? first.width / first.height : 1)) : RATIOS[shape];
  return { width, height: Math.max(2, Math.round(width / ratio)) };
}

/** Rectangle (in `src` pixels) to copy and where it goes in a `dst`-sized frame. Fill crops to cover, Fit letterboxes. */
export function placePhoto(src: Size, dst: Size, fit: GifFit): { sx: number; sy: number; sw: number; sh: number; dx: number; dy: number; dw: number; dh: number } {
  const wide = src.width / src.height > dst.width / dst.height;
  if (fit === 'fill') {
    const sw = wide ? (src.height * dst.width) / dst.height : src.width;
    const sh = wide ? src.height : (src.width * dst.height) / dst.width;
    return { sx: (src.width - sw) / 2, sy: (src.height - sh) / 2, sw, sh, dx: 0, dy: 0, dw: dst.width, dh: dst.height };
  }
  const dw = wide ? dst.width : (dst.height * src.width) / src.height;
  const dh = wide ? (dst.width * src.height) / src.width : dst.height;
  return { sx: 0, sy: 0, sw: src.width, sh: src.height, dx: (dst.width - dw) / 2, dy: (dst.height - dh) / 2, dw, dh };
}
