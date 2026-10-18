import { drawSmooth } from '../core/canvas';
import { BLACK_COLOR, FRAME_COLOR } from '../story/finishes';
import { ensureFonts, FONTS } from '../story/fonts';
import { shadowPx } from '../story/render';
import { POLAROID, type FinishId, type FinishLayout } from './borderMath';

export type ColorChoice = 'white' | 'black' | 'custom';

export function fillFor(color: ColorChoice, custom: string): string {
  return color === 'white' ? '#ffffff' : color === 'black' ? '#000000' : custom;
}

/** Styling shared with Story's print mat and polaroid. */
export const MAT_STROKE = '#d6d6d6';
export const MAT_STROKE_WIDTH = 0.0012; // fraction of canvas width
export const POLAROID_CARD = '#fbf9f4';
export const POLAROID_INK = '#3a3733';
const CAPTION_FONT = 'dmmono' as const;

export type DrawStyle = { finish: FinishId; fill: string; caption?: string };

/** Load the caption font before drawing a polaroid with text. */
export const prepareFonts = (): Promise<void> => ensureFonts([{ font: CAPTION_FONT, weight: 400 }]);

function shadowFill(ctx: CanvasRenderingContext2D, canvasW: number, color: string, r: FinishLayout['outer']) {
  const s = shadowPx(canvasW);
  ctx.save();
  ctx.shadowColor = s.color;
  ctx.shadowBlur = s.blur;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = s.offsetY;
  ctx.fillStyle = color;
  ctx.fillRect(r.x, r.y, r.w, r.h);
  ctx.restore();
  ctx.fillStyle = color;
  ctx.fillRect(r.x, r.y, r.w, r.h);
}

function drawCaption(ctx: CanvasRenderingContext2D, layout: FinishLayout, text: string) {
  const { outer } = layout;
  const band = outer.w * (POLAROID.side + POLAROID.bottom);
  const size = band * 0.26;
  ctx.save();
  ctx.font = `400 ${size}px ${FONTS[CAPTION_FONT].stack}`;
  ctx.fillStyle = POLAROID_INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const maxW = outer.w * 0.8;
  let line = text.replace(/\s+/g, ' ').trim();
  while (line.length > 1 && ctx.measureText(line).width > maxW) line = `${line.slice(0, -2).trimEnd()}…`;
  ctx.fillText(line, outer.x + outer.w / 2, outer.y + outer.h - band / 2, maxW);
  ctx.restore();
}

/** Paints the canvas colour, the finish chrome (frame / paper / card with Story's stroke and shadow) and the photo. Call prepareFonts() first for captions. */
export function drawBorder(ctx: CanvasRenderingContext2D, source: ImageBitmap, layout: FinishLayout, style: DrawStyle) {
  const { canvasW, canvasH, photo, outer } = layout;
  ctx.fillStyle = style.fill;
  ctx.fillRect(0, 0, canvasW, canvasH);
  switch (style.finish) {
    case 'black':
      ctx.fillStyle = BLACK_COLOR;
      ctx.fillRect(outer.x, outer.y, outer.w, outer.h);
      break;
    case 'framed':
      shadowFill(ctx, canvasW, FRAME_COLOR, outer);
      break;
    case 'mat':
      shadowFill(ctx, canvasW, '#ffffff', outer);
      ctx.strokeStyle = MAT_STROKE;
      ctx.lineWidth = Math.max(1, MAT_STROKE_WIDTH * canvasW);
      ctx.strokeRect(outer.x, outer.y, outer.w, outer.h);
      break;
    case 'polaroid':
      shadowFill(ctx, canvasW, POLAROID_CARD, outer);
      break;
  }
  drawSmooth(ctx, source, { left: 0, top: 0, w: source.width, h: source.height }, photo.x, photo.y, photo.w, photo.h);
  if (style.finish === 'polaroid' && style.caption?.trim()) drawCaption(ctx, layout, style.caption);
}
