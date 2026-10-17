import { drawPhotoCropped } from '../core/canvas';
import { fontShorthand, LINE_HEIGHT } from './fonts';
import { elementsVisibleOnPage, findPhoto, pageSize, sortByZ, type El, type PhotoEl, type RectEl, type Story, type TextEl, type VisibleEl } from './model';
import type { Photo } from '../core/images';

export type Bitmap = ImageBitmap;
export type GetBitmap = (photo: Photo) => Promise<Bitmap | null> | Bitmap | null;
export type PageCanvas = HTMLCanvasElement | OffscreenCanvas;
export type RenderOpts = {
  /** Override canvas creation (tests, workers). */
  createCanvas?: (w: number, h: number) => PageCanvas;
  /** Draw placeholder slots (default true). */
  placeholders?: boolean;
};

export type Px = { x: number; y: number; w: number; h: number };
export type ElementPx = {
  /** Outer box including frame, unrotated. */
  outer: Px;
  /** Photo area inside the frame (equals outer for text/rect). */
  inner: Px;
  frame: number;
  frameBottom: number;
  rotation: number;
  /** Rotation centre. */
  cx: number;
  cy: number;
};

/** Pixel layout shared by canvas rendering and the DOM editor so both match exactly. */
export function layoutElementPx(el: El, pageW: number, pageH: number): ElementPx {
  const outer = { x: el.x * pageW, y: el.y * pageH, w: el.w * pageW, h: el.h * pageH };
  const frame = el.kind === 'photo' ? el.frame * pageW : 0;
  const frameBottom = el.kind === 'photo' ? el.frameBottom * pageW : 0;
  const inner =
    el.kind === 'photo'
      ? { x: outer.x + frame, y: outer.y + frame, w: Math.max(0, outer.w - 2 * frame), h: Math.max(0, outer.h - 2 * frame - frameBottom) }
      : outer;
  return { outer, inner, frame, frameBottom, rotation: el.rotation, cx: outer.x + outer.w / 2, cy: outer.y + outer.h / 2 };
}
/** Drop shadow parameters in px (shared with the editor's CSS box-shadow). */
export const shadowPx = (pageW: number) => ({ blur: 0.03 * pageW, offsetY: 0.01 * pageW, color: 'rgba(0,0,0,0.35)' });
export const blurPx = (blur: number, pageW: number) => blur * 0.03 * pageW;

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

function defaultCreate(w: number, h: number): PageCanvas {
  if (typeof document !== 'undefined') return Object.assign(document.createElement('canvas'), { width: w, height: h });
  return new OffscreenCanvas(w, h);
}

function withRotation(ctx: Ctx2D, e: ElementPx, draw: () => void) {
  ctx.save();
  if (e.rotation) {
    ctx.translate(e.cx, e.cy);
    ctx.rotate((e.rotation * Math.PI) / 180);
    ctx.translate(-e.cx, -e.cy);
  }
  draw();
  ctx.restore();
}
function setShadow(ctx: Ctx2D, W: number) {
  const s = shadowPx(W);
  ctx.shadowColor = s.color;
  ctx.shadowBlur = s.blur;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = s.offsetY;
}
function roundRectPath(ctx: Ctx2D, r: Px, radius: number) {
  ctx.beginPath();
  if (radius > 0 && 'roundRect' in ctx) (ctx as CanvasRenderingContext2D).roundRect(r.x, r.y, r.w, r.h, radius);
  else ctx.rect(r.x, r.y, r.w, r.h);
}

function drawRect(ctx: Ctx2D, el: RectEl, W: number, H: number) {
  const e = layoutElementPx(el, W, H);
  withRotation(ctx, e, () => {
    const radius = (el.radius || 0) * W;
    if (el.shadow) {
      ctx.save();
      setShadow(ctx, W);
      ctx.fillStyle = el.fill;
      roundRectPath(ctx, e.outer, radius);
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = el.fill;
    roundRectPath(ctx, e.outer, radius);
    ctx.fill();
    if (el.strokeWidth > 0 && el.stroke && el.stroke !== 'transparent') {
      ctx.strokeStyle = el.stroke;
      ctx.lineWidth = Math.max(1, el.strokeWidth * W);
      ctx.stroke();
    }
  });
}

function drawPhoto(ctx: Ctx2D, el: PhotoEl, W: number, H: number, photo: Photo | undefined, bitmap: Bitmap | null, placeholders: boolean) {
  const e = layoutElementPx(el, W, H);
  withRotation(ctx, e, () => {
    const framed = e.frame > 0 || e.frameBottom > 0;
    if (el.shadow) {
      ctx.save();
      setShadow(ctx, W);
      ctx.fillStyle = framed ? el.frameColor : '#000';
      ctx.fillRect(e.outer.x, e.outer.y, e.outer.w, e.outer.h);
      ctx.restore();
    }
    if (framed) {
      ctx.fillStyle = el.frameColor;
      ctx.fillRect(e.outer.x, e.outer.y, e.outer.w, e.outer.h);
    }
    const { inner } = e;
    if (inner.w <= 0 || inner.h <= 0) return;
    if (photo && bitmap) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(inner.x, inner.y, inner.w, inner.h);
      ctx.clip();
      let { x, y, w, h } = inner;
      if (el.blur > 0 && 'filter' in ctx) {
        const b = blurPx(el.blur, W);
        ctx.filter = `blur(${b}px)`;
        x -= 2 * b;
        y -= 2 * b;
        w += 4 * b;
        h += 4 * b;
      }
      drawPhotoCropped(ctx as CanvasRenderingContext2D, bitmap, { width: photo.width, height: photo.height }, el.crop, w / h, x, y, w, h);
      ctx.restore();
    } else if (placeholders) {
      ctx.fillStyle = '#e4e4e7';
      ctx.fillRect(inner.x, inner.y, inner.w, inner.h);
    }
  });
}

/** Lines of text as drawn (uppercase applied, split on \n). */
export const textLines = (el: TextEl): string[] => (el.uppercase ? el.text.toUpperCase() : el.text).split('\n');

function drawText(ctx: Ctx2D, el: TextEl, W: number, H: number) {
  if (!el.text) return;
  const e = layoutElementPx(el, W, H);
  const fontPx = el.size * H;
  withRotation(ctx, e, () => {
    ctx.font = fontShorthand(el, H);
    ctx.fillStyle = el.color;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    const ls = el.letterSpacing * fontPx;
    const native = 'letterSpacing' in ctx;
    if (native) (ctx as CanvasRenderingContext2D).letterSpacing = `${ls}px`;
    if (el.shadow) {
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = fontPx * 0.18;
      ctx.shadowOffsetY = fontPx * 0.04;
    }
    const measure = (line: string) => (native || !ls ? ctx.measureText(line).width : [...line].reduce((s, ch) => s + ctx.measureText(ch).width + ls, 0));
    textLines(el).forEach((line, i) => {
      // Trailing letter-spacing is not visible ink; remove it so centred text is optically centred.
      const w = measure(line) - (ls && native ? ls : ls ? ls : 0);
      const x = el.align === 'left' ? e.outer.x : el.align === 'right' ? e.outer.x + e.outer.w - w : e.outer.x + (e.outer.w - w) / 2;
      const y = e.outer.y + i * fontPx * LINE_HEIGHT;
      if (native || !ls) ctx.fillText(line, x, y);
      else {
        let cx = x;
        for (const ch of line) {
          ctx.fillText(ch, cx, y);
          cx += ctx.measureText(ch).width + ls;
        }
      }
    });
  });
}

/** Draw one page (own elements plus neighbours' overflow) into a canvas `widthPx` wide. */
export async function renderPage(story: Story, pageIndex: number, widthPx: number, getBitmap: GetBitmap, opts: RenderOpts = {}): Promise<PageCanvas> {
  const { width: W, height: H } = pageSize(story.aspect, widthPx);
  const page = story.pages[pageIndex];
  const canvas = (opts.createCanvas ?? defaultCreate)(W, H);
  const ctx = canvas.getContext('2d') as Ctx2D | null;
  if (!ctx) throw new Error('Could not create a drawing surface.');
  ctx.fillStyle = page?.background ?? story.background;
  ctx.fillRect(0, 0, W, H);
  if (!page) return canvas;

  const visible: VisibleEl[] = sortByZ(elementsVisibleOnPage(story, pageIndex));
  const bitmaps = new Map<string, Bitmap | null>();
  for (const el of visible) {
    if (el.kind !== 'photo' || !el.photoId || bitmaps.has(el.photoId)) continue;
    const photo = findPhoto(story, el.photoId);
    bitmaps.set(el.photoId, photo ? await getBitmap(photo) : null);
  }
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, H);
  ctx.clip();
  for (const el of visible) {
    if (el.kind === 'rect') drawRect(ctx, el, W, H);
    else if (el.kind === 'text') drawText(ctx, el, W, H);
    else drawPhoto(ctx, el, W, H, findPhoto(story, el.photoId), el.photoId ? bitmaps.get(el.photoId) ?? null : null, opts.placeholders !== false);
  }
  ctx.restore();
  return canvas;
}
