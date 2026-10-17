import { drawPhotoCropped, makeCanvasFit, toJpeg } from '../core/canvas';
import { outputSize, tileEdges, type Size } from '../core/geometry';
import { getFullBitmap, type Photo } from '../core/images';
import type { Slots } from './placements';

export type RenderInput = {
  slots: Slots;
  getPhoto: (id: string) => Photo | undefined;
  rows: number;
  columns: number;
  cell: Size;
  border: number;
};

export type Rendered = { data: Uint8Array; width: number; height: number; scaled: boolean };

/** Draw the collage at full size (shrunk only if the canvas cannot be that large) and encode it as JPEG 0.95. */
export async function renderCollage(input: RenderInput, onProgress?: (done: number, total: number) => void): Promise<Rendered> {
  const { slots, getPhoto, rows, columns, cell, border } = input;
  const { canvas, scale } = makeCanvasFit(outputSize(cell, rows, columns, border));
  try {
    const ctx = canvas.getContext('2d')!;
    const aspect = cell.width / cell.height;
    for (let i = 0; i < slots.length; i++) {
      const placement = slots[i];
      const photo = placement && getPhoto(placement.photoId);
      if (!placement || !photo) throw new Error('A photo is missing. Fill every box and try again.');
      const e = tileEdges(i, { rows, columns }, cell, border, scale);
      const bitmap = await getFullBitmap(photo);
      try {
        drawPhotoCropped(ctx, bitmap, photo, placement.crop, aspect, e.x0, e.y0, e.w, e.h);
      } finally {
        bitmap.close();
      }
      onProgress?.(i + 1, slots.length);
    }
    const width = canvas.width;
    const height = canvas.height;
    const data = await toJpeg(canvas, 0.95);
    return { data, width, height, scaled: scale < 1 };
  } finally {
    canvas.width = canvas.height = 0;
  }
}

export const collageFileName = () => `Collage ${new Date().toISOString().slice(0, 16).replace('T', ' ').replace(':', '.')}.jpg`;
