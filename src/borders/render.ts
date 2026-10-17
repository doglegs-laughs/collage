import { drawSmooth } from '../core/canvas';
import type { BorderLayout } from './borderMath';

export type ColorChoice = 'white' | 'black' | 'custom';

export function fillFor(color: ColorChoice, custom: string): string {
  return color === 'white' ? '#ffffff' : color === 'black' ? '#000000' : custom;
}

/** Paints the border fill and the photo into a canvas already sized to layout.canvasW x canvasH. */
export function drawBorder(ctx: CanvasRenderingContext2D, source: ImageBitmap, layout: BorderLayout, fill: string) {
  ctx.fillStyle = fill;
  ctx.fillRect(0, 0, layout.canvasW, layout.canvasH);
  drawSmooth(ctx, source, { left: 0, top: 0, w: source.width, h: source.height }, layout.x, layout.y, layout.w, layout.h);
}
