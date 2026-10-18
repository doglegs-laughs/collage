import { BLACK_FRAME, THICK_FRAME } from '../story/finishes';
import { MAT_PAD, POLA } from '../story/layoutKit';

/** Pure border geometry for batch border export. No DOM access, so it runs under Vitest in node. */

export type BorderShape = 'original' | '1:1' | '4:5' | '9:16';
export type LongEdge = 'original' | 2160 | 1080;

export type BorderOptions = {
  /** Border width as a percentage of the photo's long edge (0..20). */
  borderPct: number;
  /** 'original' keeps an even border on all sides; the others fit the photo into that aspect (width:height). */
  shape: BorderShape;
  /** Output canvas long edge in px, or 'original' for the size the border implies at native resolution. */
  longEdge: LongEdge;
};

export type Size = { width: number; height: number };

/** Canvas size plus the photo rectangle inside it, all integers. */
export type BorderLayout = { canvasW: number; canvasH: number; x: number; y: number; w: number; h: number };

const RATIO: Record<Exclude<BorderShape, 'original'>, [number, number]> = {
  '1:1': [1, 1],
  '4:5': [4, 5],
  '9:16': [9, 16],
};

type Placed = BorderLayout & { s: number };

/** Places a pw x ph piece on a canvas of the chosen shape with at least `b` (source px) on every side, then scales to the long edge. */
function place(pw: number, ph: number, b: number, shape: BorderShape, longEdge: LongEdge): Placed {
  // Canvas before scaling, in source pixels.
  let W: number;
  let H: number;
  if (shape === 'original') {
    W = pw + 2 * b;
    H = ph + 2 * b;
  } else {
    // Smallest canvas of this aspect that holds the piece plus b on every side.
    const [rw, rh] = RATIO[shape];
    const k = Math.max((pw + 2 * b) / rw, (ph + 2 * b) / rh);
    W = Math.ceil(k * rw - 1e-9);
    H = Math.ceil(k * rh - 1e-9);
  }
  const x = Math.floor((W - pw) / 2);
  const y = Math.floor((H - ph) / 2);

  // Uniform scale so the long edge hits the target. 'original' never rescales.
  const target = longEdge === 'original' ? Math.max(W, H) : longEdge;
  const s = target / Math.max(W, H);
  const canvasW = Math.round(W * s);
  const canvasH = Math.round(H * s);
  const ox = Math.round(x * s);
  const oy = Math.round(y * s);
  const w = Math.max(1, Math.min(Math.round(pw * s), canvasW - ox));
  const h = Math.max(1, Math.min(Math.round(ph * s), canvasH - oy));
  return { canvasW, canvasH, x: ox, y: oy, w, h, s };
}

const normPhoto = (photo: Size) => {
  const pw = Math.max(1, Math.round(photo.width));
  const ph = Math.max(1, Math.round(photo.height));
  return { pw, ph, long: Math.max(pw, ph) };
};

/** White border: the photo centred on the canvas. */
export function borderLayout(photo: Size, opts: BorderOptions): BorderLayout {
  const { pw, ph, long } = normPhoto(photo);
  const b = Math.round((Math.max(0, opts.borderPct) / 100) * long);
  const { s: _s, ...layout } = place(pw, ph, b, opts.shape, opts.longEdge);
  return layout;
}

// ---------- finishes ----------

export type FinishId = 'white' | 'black' | 'mat' | 'framed' | 'polaroid';
export const FINISH_IDS: FinishId[] = ['white', 'black', 'mat', 'framed', 'polaroid'];

export const FRAME_RANGE = { min: 0.2, max: 3, step: 0.1 } as const;
export const MAT_RANGE = { min: 1, max: 15, step: 0.5 } as const;
/** Frame thickness defaults, % of the photo's long edge. */
const pct = (v: number) => Math.round(v * 1000) / 10;
export const DEFAULT_FRAME_PCT: Record<'black' | 'framed', number> = { black: pct(BLACK_FRAME), framed: pct(THICK_FRAME) };
export const DEFAULT_MAT_PCT = pct(MAT_PAD);
/** Polaroid card bands as fractions of the card width (Story's POLA). */
export const POLAROID = { side: POLA.f, bottom: POLA.fb } as const;

export type FinishOptions = BorderOptions & {
  finish: FinishId;
  /** Frame thickness in % of the photo's long edge (black border, framed). */
  framePct: number;
  /** Mat padding in % of the photo's long edge (print mat). */
  matPct: number;
};

export type Rect = { x: number; y: number; w: number; h: number };

/**
 * Everything the renderer needs, in output pixels (integers).
 * `photo` is where the picture goes; `outer` is the paper / frame / card around it (equal to `photo` for a plain white border).
 */
export type FinishLayout = { canvasW: number; canvasH: number; photo: Rect; outer: Rect };

const clipTo = (r: Rect, w: number, h: number): Rect => {
  const x = Math.max(0, r.x);
  const y = Math.max(0, r.y);
  return { x, y, w: Math.min(w, r.x + r.w) - x, h: Math.min(h, r.y + r.h) - y };
};

/**
 * Layout for any finish. The photo stays at native size for 'original' output; paper, frame and card grow around it,
 * and the border (`borderPct`) is the margin around that piece.
 */
export function finishLayout(photo: Size, o: FinishOptions): FinishLayout {
  const { pw, ph, long } = normPhoto(photo);
  const b = Math.round((Math.max(0, o.borderPct) / 100) * long);
  const frame = Math.round((Math.max(0, o.framePct) / 100) * long);
  const mat = Math.round((Math.max(0, o.matPct) / 100) * long);

  // Insets of the photo inside the piece placed on the canvas, in source px.
  let side = 0;
  let top = 0;
  let bottom = 0;
  if (o.finish === 'mat') side = top = bottom = mat;
  else if (o.finish === 'framed') side = top = bottom = frame;
  else if (o.finish === 'polaroid') {
    const card = pw / (1 - 2 * POLAROID.side);
    side = top = Math.round(card * POLAROID.side);
    bottom = Math.round(card * POLAROID.bottom);
  }
  const p = place(pw + 2 * side, ph + top + bottom, b, o.shape, o.longEdge);
  const piece: Rect = { x: p.x, y: p.y, w: p.w, h: p.h };
  const sd = Math.round(side * p.s);
  const tp = Math.round(top * p.s);
  const bt = Math.round(bottom * p.s);
  const photoRect: Rect = { x: piece.x + sd, y: piece.y + tp, w: Math.max(1, piece.w - 2 * sd), h: Math.max(1, piece.h - tp - bt) };

  let outer = piece;
  if (o.finish === 'white') outer = photoRect;
  else if (o.finish === 'black') {
    // The frame sits inside the white margin: photo and canvas are exactly those of the white border.
    const t = Math.max(1, Math.round(frame * p.s));
    outer = clipTo({ x: photoRect.x - t, y: photoRect.y - t, w: photoRect.w + 2 * t, h: photoRect.h + 2 * t }, p.canvasW, p.canvasH);
  }
  return { canvasW: p.canvasW, canvasH: p.canvasH, photo: photoRect, outer };
}

/** Output base name for a source file: `IMG_1.heic` gives `IMG_1-border`. */
export function borderStem(fileName: string): string {
  const stem = fileName.replace(/\.[^./\\]+$/, '') || fileName;
  return `${stem}-border`;
}

/**
 * First free `<stem>.jpg`, then `<stem> 2.jpg`, `<stem> 3.jpg`, ...
 * `exists` may be sync or async (for example a wrapper around api.exists).
 */
export async function uniqueName(stem: string, exists: (name: string) => boolean | Promise<boolean>): Promise<string> {
  let name = `${stem}.jpg`;
  for (let n = 2; await exists(name); n++) name = `${stem} ${n}.jpg`;
  return name;
}
