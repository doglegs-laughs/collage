import { aspectRatio, defaultPhotoEl, defaultRectEl, defaultTextEl, makeRng, type Aspect, type El, type PhotoEl, type StyleId, type TextEl } from './model';
import type { Photo } from '../core/images';
import { FONT_ADVANCE, snapWeight } from './fonts';

export type Orient = 'p' | 'l' | 's';
export type Category = 'title' | 'single' | 'pair' | 'trio' | 'grid' | 'story';
export type LayoutOpts = {
  title?: string;
  subtitle?: string;
  /** Caption for polaroid-on-photo (defaults to nothing). */
  caption?: string;
  /** Gutter between photos, fraction of page width (default 0.025). */
  gap?: number;
  /** Outer margin, fraction of page width (default = gap). */
  margin?: number;
  seed?: number;
};
export type LayoutResult = { pages: El[][]; backgrounds: string[] };
export interface Template {
  id: string;
  name: string;
  category: Category;
  /** Number of photos consumed (title-card: 0, optionally one hero). */
  slots: number;
  /** Pages produced (2 or 3 for spreads). */
  pageCount: number;
  /** Score 0..1 for the next photos' orientations (needs >= slots entries, else 0). `aspect` lets portrait-page-only layouts opt out of wide pages. */
  fits(orientations: Orient[], aspect?: Aspect): number;
  layout(aspect: Aspect, photos: Photo[], opts?: LayoutOpts): LayoutResult;
}

export const WIDE_RATIO = 1.9;
export function orientationOf(p: { width: number; height: number }): Orient {
  const r = p.width / p.height;
  return r > 1.15 ? 'l' : r < 0.87 ? 'p' : 's';
}

/* ---------- layout helpers (all lengths in "width units": page width = 1, page height = H = 1/A) ---------- */

type Ctx = { A: number; H: number; g: number; m: number; seed: number; opts: LayoutOpts };
type Rect = { x: number; y: number; w: number; h: number };
const ar = (p?: Photo) => (p ? p.width / p.height : 1.5);
const clampN = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

export function fitBox(a: number, aw: number, ah: number): { w: number; h: number } {
  return aw / ah > a ? { w: ah * a, h: ah } : { w: aw, h: aw / a };
}
/** Like fitBox but lets the frame deviate from the photo aspect by `tol` (cropping) to fill more of the area. */
function fitLoose(a: number, aw: number, ah: number, tol = 0.12) {
  return fitBox(clampN(aw / ah, a * (1 - tol), a / (1 - tol)), aw, ah);
}
const centered = (c: Ctx, w: number, h: number): Rect => ({ x: (1 - w) / 2, y: (c.H - h) / 2, w, h });

function photoEl(c: Ctx, photo: Photo | undefined, r: Rect, extra: Partial<PhotoEl> = {}): PhotoEl {
  return defaultPhotoEl({ photoId: photo?.id ?? null, x: r.x, y: r.y * c.A, w: r.w, h: r.h * c.A, ...extra });
}
function rectEl(c: Ctx, r: Rect, extra: Partial<ReturnType<typeof defaultRectEl>> = {}) {
  return defaultRectEl({ x: r.x, y: r.y * c.A, w: r.w, h: r.h * c.A, ...extra });
}
function textEl(c: Ctx, r: Rect, fontUnits: number, extra: Partial<TextEl>): TextEl {
  return defaultTextEl({ x: r.x, y: r.y * c.A, w: r.w, h: r.h * c.A, size: fontUnits * c.A, ...extra });
}
/** Greedy word wrap into lines of at most `maxChars`. */
export function breakLines(text: string, maxChars: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      if (line && (line + ' ' + word).length > maxChars) {
        out.push(line);
        line = word;
      } else line = line ? line + ' ' + word : word;
    }
    out.push(line);
  }
  return out;
}
const rotBox = (w: number, h: number, deg: number) => {
  const t = (Math.abs(deg) * Math.PI) / 180;
  return { bw: w * Math.cos(t) + h * Math.sin(t), bh: w * Math.sin(t) + h * Math.cos(t) };
};
/** Centre that keeps the rotated box inside the page (width units). */
function clampCenter(c: Ctx, cx: number, cy: number, w: number, h: number, rot: number, pad = 0.01) {
  const { bw, bh } = rotBox(w, h, rot);
  const f = (v: number, size: number, total: number) => (size + 2 * pad >= total ? total / 2 : clampN(v, size / 2 + pad, total - size / 2 - pad));
  return { cx: f(cx, bw, 1), cy: f(cy, bh, c.H) };
}

/* ---------- builders: each returns pages of elements ---------- */

const WHITE = '#ffffff';
type Built = { pages: El[][]; bg?: string };

type TextStyle = { font: TextEl['font']; weight: TextEl['weight']; ls: number };
type TitleStyle = TextStyle & { color: string; upper: boolean; shadow: boolean; sub?: TextStyle };
/** Default title look per font: Italiana (the Faroes look) is airy but not extreme, geometric sans fonts are widest. */
export const titleSpacing = (font: TextEl['font']): number => (font === 'italiana' ? 0.12 : font === 'displaySans' || font === 'josefin' || font === 'montserrat' ? 0.25 : 0.18);
const SUBTITLE_STYLE: TextStyle = { font: 'josefin', weight: 300, ls: 0.3 };
type Box = { x: number; w: number };
/** Height (width units) of a block of text elements. */
const blockHeight = (c: Ctx, els: TextEl[]) => Math.max(0, ...els.map((e) => (e.y + e.h) / c.A));
const shiftY = (c: Ctx, els: TextEl[], dy: number) => els.map((e) => ({ ...e, y: e.y + dy * c.A }));

/** Large title sized so the longest line spans ~80% of the page width (of `box`), clamped to 5%..13% of page height. */
function titleBlock(c: Ctx, title: string, subtitle: string | undefined, y: number, o: TitleStyle, box?: Box): TextEl[] {
  const bx = box ?? { x: 0.05, w: 0.9 };
  const target = (0.8 / 0.9) * bx.w;
  const weight = snapWeight(o.font, o.weight);
  const adv = FONT_ADVANCE[o.font] * (o.upper ? 1 : 0.8) + o.ls;
  const minFu = 0.05 * c.H;
  const maxFu = 0.13 * c.H;
  const flat = title.replace(/\s+/g, ' ').trim();
  const single = target / (Math.max(1, flat.length) * adv);
  const lines = single >= minFu || flat.includes('\n') === false && !/\s/.test(flat) ? [flat] : breakLines(title, Math.max(4, Math.floor(target / (minFu * adv))));
  const longest = Math.max(1, ...lines.map((l) => l.length));
  const fu = clampN(target / (longest * adv), box ? Math.min(minFu, 0.02 * c.H) : minFu, maxFu);
  const out = [textEl(c, { x: bx.x, y, w: bx.w, h: lines.length * fu * 1.25 }, fu, { text: lines.join('\n'), role: 'title', font: o.font, weight, color: o.color, letterSpacing: o.ls, uppercase: o.upper, shadow: o.shadow, align: 'center' })];
  if (subtitle) {
    const sfu = 0.022 * c.H;
    const sub = o.sub ?? SUBTITLE_STYLE;
    out.push(textEl(c, { x: bx.x, y: y + lines.length * fu * 1.25 + sfu * 0.5, w: bx.w, h: sfu * 1.4 }, sfu, { text: subtitle, role: 'subtitle', font: sub.font, weight: snapWeight(sub.font, sub.weight), color: o.color, letterSpacing: sub.ls, uppercase: true, shadow: o.shadow, align: 'center' }));
  }
  return out;
}

/**
 * Title (and subtitle) text elements for any page, auto-sized like the cover template.
 * `y` is the top as a fraction of page height (default 0.09). Elements carry roles 'title' / 'subtitle'.
 */
export function titleElements(aspect: Aspect, title: string, subtitle: string | undefined, o: { font?: TextEl['font']; color?: string; y?: number; shadow?: boolean } = {}): TextEl[] {
  const A = aspectRatio(aspect);
  const c: Ctx = { A, H: 1 / A, g: 0.025, m: 0.025, seed: 1, opts: {} };
  const font = o.font ?? 'italiana';
  const color = o.color ?? '#ffffff';
  const els = titleBlock(c, title, subtitle?.trim() || undefined, (o.y ?? 0.09) * c.H, { font, weight: 400, ls: titleSpacing(font), color, upper: true, shadow: o.shadow ?? color.toLowerCase() === '#ffffff' });
  return els.map((e, z) => ({ ...e, z }));
}

const buildCover = (sans: boolean) => (c: Ctx, [p]: Photo[]): Built => {
  const els: El[] = [photoEl(c, p, { x: 0, y: 0, w: 1, h: c.H })];
  if (c.opts.title) {
    els.push(...titleBlock(c, c.opts.title, c.opts.subtitle, 0.09 * c.H, sans ? { font: 'montserrat', weight: 300, ls: 0.25, color: '#ffffff', upper: true, shadow: true, sub: { font: 'montserrat', weight: 300, ls: 0.3 } } : { font: 'italiana', weight: 400, ls: 0.12, color: '#ffffff', upper: true, shadow: true }));
  }
  return { pages: [els] };
};

function buildTitleCard(c: Ctx, [hero]: Photo[]): Built {
  const els: El[] = [];
  const { Wav, Hav } = dims(c);
  let ty = c.H * 0.4;
  if (hero) {
    els.push(photoEl(c, hero, { x: c.m, y: c.m, w: Wav, h: Hav * 0.55 }));
    ty = c.m + Hav * 0.55 + Hav * 0.08;
  }
  if (c.opts.title) els.push(...titleBlock(c, c.opts.title, c.opts.subtitle, ty, { font: 'italiana', weight: 400, color: '#111111', ls: 0.12, upper: true, shadow: false }));
  return { pages: [els] };
}

const WHITE_COVER: TitleStyle = { font: 'italiana', weight: 400, ls: 0.12, color: '#ffffff', upper: true, shadow: true };
const DARK_COVER: TitleStyle = { font: 'italiana', weight: 400, ls: 0.12, color: '#111111', upper: true, shadow: false };

/** Cover: photo inset with an even white margin (the single-border margin), title overlaid near its top. */
function buildCoverBorder(c: Ctx, [p]: Photo[]): Built {
  const { Wav, Hav } = dims(c);
  const b = fitLoose(ar(p), Wav, Hav);
  const r = centered(c, b.w, b.h);
  const els: El[] = [photoEl(c, p, r)];
  if (c.opts.title) {
    const box = { x: r.x + 0.025, w: r.w - 0.05 };
    els.push(...titleBlock(c, c.opts.title, c.opts.subtitle, r.y + Math.min(0.07 * c.H, r.h * 0.1), WHITE_COVER, box));
  }
  return { pages: [els] };
}
/** Cover: photo with an even side/top margin and a deeper white band below holding the dark title and subtitle. */
function buildCoverBorderBelow(c: Ctx, [p]: Photo[]): Built {
  const { Wav } = dims(c);
  const pad = 0.035;
  const text = c.opts.title ? titleBlock(c, c.opts.title, c.opts.subtitle, 0, DARK_COVER, { x: c.m, w: Wav }) : [];
  const th = blockHeight(c, text);
  const band = text.length ? th + 2 * pad : c.m;
  const b = fitLoose(ar(p), Wav, c.H - c.m - band);
  const top = Math.max(c.m, (c.H - (b.h + band)) / 2);
  const els: El[] = [photoEl(c, p, { x: (1 - b.w) / 2, y: top, w: b.w, h: b.h })];
  els.push(...shiftY(c, text, top + b.h + pad));
  return { pages: [els] };
}
/** Cover: photo inside the print-mat paper, dark title and subtitle on the white page below the mat (above it for wide photos on tall pages). */
function buildCoverMat(c: Ctx, [p]: Photo[]): Built {
  const { aw, ah } = matAvail(c);
  const gap = 0.03;
  const text = c.opts.title ? titleBlock(c, c.opts.title, c.opts.subtitle, 0, DARK_COVER, { x: c.m, w: 1 - 2 * c.m }) : [];
  const th = blockHeight(c, text);
  const reserve = text.length ? th + gap : 0;
  const b = fitBox(ar(p), aw, ah - reserve);
  const mat = matAround(c, b.w, b.h);
  const total = mat.paper.h + reserve;
  const above = ar(p) > 1.15 && c.A > 1;
  const y0 = (c.H - total) / 2;
  const paperY = y0 + (above ? reserve : 0);
  const dy = paperY - mat.paper.y;
  const els: El[] = [{ ...mat.rect, y: mat.rect.y + dy * c.A }, photoEl(c, p, { x: mat.x, y: mat.y + dy, w: b.w, h: b.h })];
  els.push(...shiftY(c, text, above ? y0 : y0 + mat.paper.h + gap));
  return { pages: [els] };
}

const dims = (c: Ctx) => ({ Wav: 1 - 2 * c.m, Hav: c.H - 2 * c.m });

const buildBleed = (c: Ctx, [p]: Photo[]): Built => ({ pages: [[photoEl(c, p, { x: 0, y: 0, w: 1, h: c.H })]] });

function buildBorder(c: Ctx, [p]: Photo[]): Built {
  const { Wav, Hav } = dims(c);
  const b = fitBox(ar(p), Wav, Hav);
  return { pages: [[photoEl(c, p, centered(c, b.w, b.h))]] };
}
function buildInset(c: Ctx, [p]: Photo[]): Built {
  const b = fitLoose(ar(p), 1 - 0.1, c.H - 0.03);
  return { pages: [[photoEl(c, p, centered(c, b.w, b.h))]] };
}
function buildMatted(c: Ctx, [p]: Photo[]): Built {
  const f = 0.017;
  const b = fitBox(ar(p), 0.88 - 2 * f, 0.86 * c.H - 2 * f);
  return { pages: [[photoEl(c, p, centered(c, b.w + 2 * f, b.h + 2 * f), { frame: f, frameColor: '#0a0a0a' })]] };
}
function buildFramedShadow(c: Ctx, [p]: Photo[]): Built {
  const f = 0.012;
  const b = fitBox(ar(p), 0.88 - 2 * f, 0.86 * c.H - 2 * f);
  return { pages: [[photoEl(c, p, centered(c, b.w + 2 * f, b.h + 2 * f), { frame: f, frameColor: '#0a0a0a', shadow: true })]] };
}
const buildPano = (n: number) => (c: Ctx, [p]: Photo[]): Built => {
  const w = n - 2 * c.m;
  const h = Math.min(w / ar(p), c.H - 2 * c.m);
  const pages: El[][] = Array.from({ length: n }, () => []);
  pages[0].push(photoEl(c, p, { x: c.m, y: (c.H - h) / 2, w, h }));
  return { pages };
};
const buildStack = (n: number, tight: boolean, black = false) => (c: Ctx, photos: Photo[]): Built => {
  const g = tight ? 0.005 : c.g;
  const { Wav, Hav } = dims(c);
  const h = (Hav - (n - 1) * g) / n;
  return { pages: [photos.slice(0, n).map((p, i) => photoEl(c, p, { x: c.m, y: c.m + i * (h + g), w: Wav, h }, black ? { frame: 0.006, frameBottom: 0.006, frameColor: '#000000' } : {}))] };
};
/** Two photos stacked at a common width, aspects preserved; returns the rects and total size. */
function stackedPair(c: Ctx, photos: Photo[], availW: number, availH: number) {
  const S = 1 / ar(photos[0]) + 1 / ar(photos[1]);
  const w = Math.min(availW, (availH - c.g) / S);
  const h0 = w / ar(photos[0]);
  const h1 = w / ar(photos[1]);
  return { w, h: h0 + h1 + c.g, h0, h1 };
}
function buildPairStacked(c: Ctx, photos: Photo[]): Built {
  const { Wav, Hav } = dims(c);
  const s = stackedPair(c, photos, Wav, Hav);
  const y0 = (c.H - s.h) / 2;
  const x = (1 - s.w) / 2;
  return { pages: [[photoEl(c, photos[0], { x, y: y0, w: s.w, h: s.h0 }), photoEl(c, photos[1], { x, y: y0 + s.h0 + c.g, w: s.w, h: s.h1 })]] };
}
function buildPairSide(c: Ctx, photos: Photo[]): Built {
  const { Wav, Hav } = dims(c);
  const a0 = ar(photos[0]);
  const a1 = ar(photos[1]);
  const h = Math.min(Hav, (Wav - c.g) / (a0 + a1));
  const x0 = (1 - (h * (a0 + a1) + c.g)) / 2;
  const y = (c.H - h) / 2;
  return { pages: [[photoEl(c, photos[0], { x: x0, y, w: h * a0, h }), photoEl(c, photos[1], { x: x0 + h * a0 + c.g, y, w: h * a1, h })]] };
}
function buildTrio(c: Ctx, photos: Photo[]): Built {
  const { Wav, Hav } = dims(c);
  const [a, b, d] = photos;
  if (c.A >= 1.3) {
    const w1 = (Wav - c.g) * 0.6;
    const w2 = Wav - c.g - w1;
    const h2 = (Hav - c.g) / 2;
    return { pages: [[photoEl(c, a, { x: c.m, y: c.m, w: w1, h: Hav }), photoEl(c, b, { x: c.m + w1 + c.g, y: c.m, w: w2, h: h2 }), photoEl(c, d, { x: c.m + w1 + c.g, y: c.m + h2 + c.g, w: w2, h: h2 })]] };
  }
  const h1 = (Hav - c.g) * 0.58;
  const h2 = Hav - c.g - h1;
  const w2 = (Wav - c.g) / 2;
  return { pages: [[photoEl(c, a, { x: c.m, y: c.m, w: Wav, h: h1 }), photoEl(c, b, { x: c.m, y: c.m + h1 + c.g, w: w2, h: h2 }), photoEl(c, d, { x: c.m + w2 + c.g, y: c.m + h1 + c.g, w: w2, h: h2 })]] };
}
function buildTriptych(c: Ctx, photos: Photo[]): Built {
  const { Wav, Hav } = dims(c);
  const cw = (Wav - 2 * c.g) / 3;
  const ch = Math.min(Hav, cw * 1.5);
  return { pages: [photos.slice(0, 3).map((p, i) => photoEl(c, p, { x: c.m + i * (cw + c.g), y: (c.H - ch) / 2, w: cw, h: ch }))] };
}
const buildGrid = (rows: number, cols: number) => (c: Ctx, photos: Photo[]): Built => {
  const { Wav, Hav } = dims(c);
  const w = (Wav - (cols - 1) * c.g) / cols;
  const h = (Hav - (rows - 1) * c.g) / rows;
  return { pages: [photos.slice(0, rows * cols).map((p, i) => photoEl(c, p, { x: c.m + (i % cols) * (w + c.g), y: c.m + Math.floor(i / cols) * (h + c.g), w, h }))] };
};
const buildFilm = (n: number) => (c: Ctx, photos: Photo[]): Built => {
  const fg = c.g * 0.8;
  const { Hav } = dims(c);
  const fh = (Hav - (n - 1) * fg) / n;
  const fw = Math.min(0.72, fh * 1.5);
  const x = (1 - fw) / 2;
  const els: El[] = [];
  const band = x;
  const sw = Math.min(0.03, band * 0.4);
  if (sw > 0.008) {
    const sh = sw * 1.3;
    const pitch = sh * 1.9;
    const count = Math.max(1, Math.floor((c.H - 0.04) / pitch));
    const y0 = (c.H - (count * pitch - (pitch - sh))) / 2;
    for (let i = 0; i < count; i++) {
      for (const cx of [band / 2, 1 - band / 2]) els.push(rectEl(c, { x: cx - sw / 2, y: y0 + i * pitch, w: sw, h: sh }, { fill: '#d9d4c7', radius: sw * 0.25 }));
    }
  }
  photos.slice(0, n).forEach((p, i) => els.push(photoEl(c, p, { x, y: c.m + i * (fh + fg), w: fw, h: fh })));
  return { pages: [els], bg: '#0b0b0b' };
};

const POLA = { f: 0.06, fb: 0.16, inner: 0.88, ratio: 1.16 };
function polaroidEl(c: Ctx, photo: Photo | undefined, cx: number, cy: number, cw: number, rot: number): PhotoEl {
  const ch = cw * POLA.ratio;
  return photoEl(c, photo, { x: cx - cw / 2, y: cy - ch / 2, w: cw, h: ch }, { frame: cw * POLA.f, frameBottom: cw * POLA.fb, frameColor: '#fbf9f4', shadow: true, rotation: rot });
}
const buildScatter = (n: number) => (c: Ctx, photos: Photo[]): Built => {
  const rng = makeRng(c.seed * 7919 + n);
  const wide = c.A >= 1.3;
  const cw = wide ? Math.min(0.9 / n - 0.02, (c.H * 0.8) / POLA.ratio) : Math.min(0.52, (c.H * 0.4) / POLA.ratio * 1.2);
  const spots = wide
    ? Array.from({ length: n }, (_, i) => [(i + 0.5) / n, c.H / 2] as const)
    : n === 3 ? ([[0.38, 0.22], [0.64, 0.5], [0.38, 0.78]] as const).map(([x, y]) => [x, y * c.H] as const)
    : ([[0.42, 0.3], [0.58, 0.7]] as const).map(([x, y]) => [x, y * c.H] as const);
  const els = photos.slice(0, n).map((p, i) => {
    const rot = (i % 2 ? 1 : -1) * (2 + rng() * 4);
    const ch = cw * POLA.ratio;
    const { cx, cy } = clampCenter(c, spots[i][0], spots[i][1], cw, ch, rot);
    return polaroidEl(c, p, cx, cy, cw, Math.round(rot * 10) / 10);
  });
  return { pages: [els] };
};
function buildPolaroidOnPhoto(c: Ctx, [bg, card]: Photo[]): Built {
  const rng = makeRng(c.seed * 104729 + 3);
  const rot = Math.round((rng() < 0.5 ? -1 : 1) * (1 + rng() * 2) * 10) / 10;
  const cw = Math.min(0.66, (c.H * 0.7) / POLA.ratio);
  const ch = cw * POLA.ratio;
  const cx = 0.5;
  const cy = c.H / 2;
  const els: El[] = [photoEl(c, bg, { x: 0, y: 0, w: 1, h: c.H }, { blur: 0.55 }), polaroidEl(c, card, cx, cy, cw, rot)];
  if (c.opts.caption) {
    const band = cw * (POLA.f + POLA.fb);
    const dy = ch / 2 - band / 2;
    const t = (rot * Math.PI) / 180;
    const tx = cx - dy * Math.sin(t);
    const ty = cy + dy * Math.cos(t);
    const tw = cw * 0.8;
    const th = band * 0.5;
    els.push(textEl(c, { x: tx - tw / 2, y: ty - th / 2, w: tw, h: th }, band * 0.26, { text: c.opts.caption, role: 'title', font: 'dmmono', weight: 400, color: '#3a3733', rotation: rot, align: 'center' }));
  }
  return { pages: [els] };
}
function buildMagazine(c: Ctx, [p]: Photo[]): Built {
  const { Wav, Hav } = dims(c);
  const ph = Hav * 0.8;
  const els: El[] = [photoEl(c, p, { x: c.m, y: c.m, w: Wav, h: ph })];
  if (c.opts.title) {
    const lines = breakLines(c.opts.title, 12);
    const fu = Math.min(0.11, 0.8 / (Math.max(...lines.map((l) => l.length)) * (FONT_ADVANCE.playfair + 0.05)));
    const th = lines.length * fu * 1.2;
    els.push(textEl(c, { x: c.m + 0.04, y: c.m + ph - th - 0.03, w: Wav - 0.08, h: th }, fu, { text: lines.join('\n'), role: 'title', font: 'playfair', weight: 700, color: '#ffffff', align: 'left', shadow: true }));
  }
  if (c.opts.subtitle) els.push(textEl(c, { x: c.m, y: c.m + ph + 0.015, w: Wav, h: 0.03 }, 0.018, { text: c.opts.subtitle, role: 'subtitle', font: 'dmmono', color: '#444444', align: 'left' }));
  return { pages: [els] };
}
function buildPrintMat(c: Ctx, photos: Photo[]): Built {
  const pad = 0.04;
  const m2 = Math.max(c.m, 0.05);
  const s = stackedPair(c, photos, 1 - 2 * (m2 + pad), c.H - 2 * (m2 + pad));
  const paper: Rect = centered(c, s.w + 2 * pad, s.h + 2 * pad);
  const x = paper.x + pad;
  const y0 = paper.y + pad;
  return {
    pages: [[
      rectEl(c, paper, { fill: '#ffffff', stroke: '#d6d6d6', strokeWidth: 0.0012, shadow: true }),
      photoEl(c, photos[0], { x, y: y0, w: s.w, h: s.h0 }),
      photoEl(c, photos[1], { x, y: y0 + s.h0 + c.g, w: s.w, h: s.h1 }),
    ]],
  };
}
/** Shared paper-mat chrome and sizing for the print-mat family (mirrors print-mat: 0.04 padding, >= 0.05 page margin). */
const MAT_PAD = 0.04;
const matAvail = (c: Ctx) => {
  const m2 = Math.max(c.m, 0.05) + MAT_PAD;
  return { aw: 1 - 2 * m2, ah: c.H - 2 * m2 };
};
/** Mat sized around a block of `bw` x `bh`, centred on the page, plus the block's top-left corner inside it. */
function matAround(c: Ctx, bw: number, bh: number) {
  const paper: Rect = centered(c, bw + 2 * MAT_PAD, bh + 2 * MAT_PAD);
  return { paper, x: paper.x + MAT_PAD, y: paper.y + MAT_PAD, rect: rectEl(c, paper, { fill: '#ffffff', stroke: '#d6d6d6', strokeWidth: 0.0012, shadow: true }) };
}
const clampedMean = (photos: Photo[], lo: number, hi: number) => clampN(photos.reduce((a, p) => a + ar(p), 0) / Math.max(photos.length, 1), lo, hi);
/** Three landscapes stacked at a shared wide aspect, or three portraits side by side at a shared tall aspect. */
function buildPrintMat3(c: Ctx, photos: Photo[]): Built {
  const { aw, ah } = matAvail(c);
  const stacked = photos.reduce((a, p) => a + ar(p), 0) / Math.max(photos.length, 1) >= 1;
  if (stacked) {
    // Crop wide enough that the stack fills the mat width, like the reference stacks (up to ~2.6:1).
    const a = clampN(Math.max(clampedMean(photos, 1.3, 1.9), (3 * aw) / (ah - 2 * c.g)), 1.3, 2.6);
    const w = Math.min(aw, (ah - 2 * c.g) / (3 / a));
    const h = w / a;
    const mat = matAround(c, w, 3 * h + 2 * c.g);
    return { pages: [[mat.rect, ...photos.slice(0, 3).map((p, i) => photoEl(c, p, { x: mat.x, y: mat.y + i * (h + c.g), w, h }))]] };
  }
  const a = clampedMean(photos, 0.5, 0.8);
  const h = Math.min(ah, (aw - 2 * c.g) / (3 * a));
  const w = a * h;
  const mat = matAround(c, 3 * w + 2 * c.g, h);
  return { pages: [[mat.rect, ...photos.slice(0, 3).map((p, i) => photoEl(c, p, { x: mat.x + i * (w + c.g), y: mat.y, w, h }))]] };
}
/** Four photos in a 2x2 grid inside one mat; cells take the shared orientation's aspect (square-ish when mixed). */
function buildPrintMat4(c: Ctx, photos: Photo[]): Built {
  const { aw, ah } = matAvail(c);
  const os = photos.slice(0, 4).map(orientationOf);
  const a = os.every((o) => o === 'l') ? clampedMean(photos, 1.2, 1.8) : os.every((o) => o === 'p') ? clampedMean(photos, 0.55, 0.83) : 1;
  const w = Math.min((aw - c.g) / 2, ((ah - c.g) / 2) * a);
  const h = w / a;
  const mat = matAround(c, 2 * w + c.g, 2 * h + c.g);
  return { pages: [[mat.rect, ...photos.slice(0, 4).map((p, i) => photoEl(c, p, { x: mat.x + (i % 2) * (w + c.g), y: mat.y + Math.floor(i / 2) * (h + c.g), w, h }))]] };
}
function buildSplit(c: Ctx, [a, s, b]: Photo[]): Built {
  const { Hav } = dims(c);
  const left = photoEl(c, a, { x: c.m, y: c.m, w: 0.55 - c.g - c.m, h: Hav });
  const span = photoEl(c, s, { x: 0.55, y: 0, w: 0.9, h: c.H });
  const right = photoEl(c, b, { x: 0.45 + c.g, y: c.m, w: 1 - c.m - (0.45 + c.g), h: Hav });
  return { pages: [[left, span], [right]] };
}

/* ---------- catalog ---------- */

type Want = Record<Orient, number>;
const scoreOf = (want: Want, slots: number, bias?: (A: number) => number, only?: Orient[]) => (o: Orient[], aspect?: Aspect): number => {
  if (o.length < slots) return 0;
  if (only && o.slice(0, slots).some((x) => !only.includes(x))) return 0;
  const A = aspect ? aspectRatio(aspect) : 0.8;
  const b = bias ? bias(A) : 1;
  if (slots === 0) return 0.5 * b;
  let s = 0;
  for (let i = 0; i < slots; i++) s += want[o[i]];
  return clampN((s / slots) * b, 0, 1);
};
const tallPage = (A: number) => (A < 1.3 ? 1 : 0.15);

type Def = { id: string; name: string; category: Category; slots: number; pages?: number; want: Want; bias?: (A: number) => number; only?: Orient[]; build: (c: Ctx, photos: Photo[]) => Built };

function make(d: Def): Template {
  const pageCount = d.pages ?? 1;
  return {
    id: d.id, name: d.name, category: d.category, slots: d.slots, pageCount,
    fits: scoreOf(d.want, d.slots, d.bias, d.only),
    layout(aspect, photos, opts = {}) {
      const A = aspectRatio(aspect);
      const g = opts.gap ?? 0.025;
      const c: Ctx = { A, H: 1 / A, g, m: opts.margin ?? g, seed: opts.seed ?? 1, opts };
      const built = d.build(c, photos);
      const pages = built.pages.map((els) => els.map((e, z) => ({ ...e, z })));
      return { pages, backgrounds: pages.map(() => built.bg ?? WHITE) };
    },
  };
}
const W = (p: number, l: number, s: number): Want => ({ p, l, s });

export const TEMPLATES: Template[] = [
  make({ id: 'cover', name: 'Cover', category: 'title', slots: 1, want: W(1, 0.7, 0.8), build: buildCover(false) }),
  make({ id: 'cover-sans', name: 'Cover (sans)', category: 'title', slots: 1, want: W(0.9, 0.7, 0.8), build: buildCover(true) }),
  make({ id: 'cover-border', name: 'Cover — white border', category: 'title', slots: 1, want: W(0.8, 1, 0.9), build: buildCoverBorder }),
  make({ id: 'cover-border-below', name: 'Cover — white border, title below', category: 'title', slots: 1, want: W(0.8, 1, 0.9), build: buildCoverBorderBelow }),
  make({ id: 'cover-mat', name: 'Cover — print mat', category: 'title', slots: 1, want: W(0.7, 1, 0.8), build: buildCoverMat }),
  make({ id: 'title-card', name: 'Title card', category: 'title', slots: 0, want: W(0, 0, 0), build: buildTitleCard }),
  make({ id: 'single-bleed', name: 'Single, full bleed', category: 'single', slots: 1, want: W(0.8, 0.4, 0.6), build: buildBleed }),
  make({ id: 'single-border', name: 'Single, white border', category: 'single', slots: 1, want: W(0.6, 0.55, 0.7), build: buildBorder }),
  make({ id: 'inset-single', name: 'Inset single', category: 'single', slots: 1, want: W(1, 0.35, 0.7), build: buildInset }),
  make({ id: 'matted-single', name: 'Matted single', category: 'single', slots: 1, want: W(0.45, 1, 0.7), build: buildMatted }),
  make({ id: 'framed-portrait', name: 'Framed portrait with shadow', category: 'single', slots: 1, want: W(1, 0.2, 0.6), build: buildFramedShadow }),
  make({ id: 'pano-2', name: 'Panorama spread', category: 'story', slots: 1, pages: 2, want: W(0, 0.9, 0.1), build: buildPano(2) }),
  make({ id: 'pano-3', name: 'Panorama (3 pages)', category: 'story', slots: 1, pages: 3, want: W(0, 0.8, 0.1), build: buildPano(3) }),
  make({ id: 'stack-2', name: 'Stack 2', category: 'pair', slots: 2, want: W(0.15, 1, 0.4), bias: tallPage, only: ['l'], build: buildStack(2, false) }),
  make({ id: 'stack-3', name: 'Stack 3', category: 'trio', slots: 3, want: W(0.1, 1, 0.3), bias: tallPage, only: ['l'], build: buildStack(3, false) }),
  { ...make({ id: 'stack-2-black', name: 'Stack 2 — black borders', category: 'pair', slots: 2, want: W(0.15, 1, 0.4), bias: tallPage, only: ['l'], build: buildStack(2, false, true) }), fits: (o, a) => 0.95 * (getTemplate('stack-2')!.fits(o, a)) },
  { ...make({ id: 'stack-3-black', name: 'Stack 3 — black borders', category: 'trio', slots: 3, want: W(0.1, 1, 0.3), bias: tallPage, only: ['l'], build: buildStack(3, false, true) }), fits: (o, a) => 0.95 * (getTemplate('stack-3')!.fits(o, a)) },
  make({ id: 'stack-2-tight', name: 'Stack 2 tight', category: 'pair', slots: 2, want: W(0.15, 1, 0.4), bias: tallPage, only: ['l'], build: buildStack(2, true) }),
  make({ id: 'stack-3-tight', name: 'Stack 3 tight', category: 'trio', slots: 3, want: W(0.1, 1, 0.3), bias: tallPage, only: ['l'], build: buildStack(3, true) }),
  make({ id: 'pair-stacked', name: 'Pair stacked', category: 'pair', slots: 2, want: W(0.2, 1, 0.5), bias: tallPage, only: ['l'], build: buildPairStacked }),
  make({ id: 'pair-side', name: 'Pair side by side', category: 'pair', slots: 2, want: W(1, 0.25, 0.6), only: ['p', 's'], build: buildPairSide }),
  make({ id: 'trio', name: 'Trio', category: 'trio', slots: 3, want: W(0.7, 0.7, 0.6), build: buildTrio }),
  make({ id: 'triptych', name: 'Triptych', category: 'trio', slots: 3, want: W(1, 0.2, 0.5), build: buildTriptych }),
  make({ id: 'grid-2x2', name: 'Grid 2x2', category: 'grid', slots: 4, want: W(0.6, 0.6, 0.8), build: buildGrid(2, 2) }),
  make({ id: 'grid-3x3', name: 'Grid 3x3', category: 'grid', slots: 9, want: W(0.55, 0.55, 0.7), build: buildGrid(3, 3) }),
  make({ id: 'overview-grid', name: 'Overview grid 3x2', category: 'grid', slots: 6, want: W(1, 0.25, 0.5), build: buildGrid(2, 3) }),
  make({ id: 'film-strip', name: 'Film strip', category: 'story', slots: 3, want: W(0.15, 1, 0.4), bias: tallPage, only: ['l'], build: buildFilm(3) }),
  make({ id: 'film-strip-4', name: 'Film strip (4)', category: 'story', slots: 4, want: W(0.15, 1, 0.4), bias: tallPage, only: ['l'], build: buildFilm(4) }),
  make({ id: 'polaroid-scatter', name: 'Polaroid scatter', category: 'story', slots: 3, want: W(0.7, 0.7, 0.9), build: buildScatter(3) }),
  make({ id: 'polaroid-scatter-2', name: 'Polaroid pair', category: 'story', slots: 2, want: W(0.7, 0.7, 0.9), build: buildScatter(2) }),
  make({ id: 'magazine', name: 'Magazine', category: 'story', slots: 1, want: W(0.8, 0.8, 0.7), build: buildMagazine }),
  make({ id: 'print-mat', name: 'Print mat (2)', category: 'pair', slots: 2, want: W(0.15, 1, 0.4), bias: tallPage, only: ['l'], build: buildPrintMat }),
  { ...make({ id: 'print-mat-3', name: 'Print mat (3)', category: 'trio', slots: 3, want: W(1, 1, 0), build: buildPrintMat3 }),
    fits: (o, aspect) => (o.length < 3 ? 0 : o.slice(0, 3).every((x) => x === 'l') ? tallPage(aspect ? aspectRatio(aspect) : 0.8) : o.slice(0, 3).every((x) => x === 'p') ? 1 : 0) },
  { ...make({ id: 'print-mat-4', name: 'Print mat (4)', category: 'grid', slots: 4, want: W(1, 1, 1), build: buildPrintMat4 }),
    fits: (o) => (o.length < 4 ? 0 : new Set(o.slice(0, 4)).size > 1 ? 0.3 : o[0] === 's' ? 0.6 : 1) },
  make({ id: 'polaroid-on-photo', name: 'Polaroid on photo', category: 'story', slots: 2, want: W(0.8, 0.8, 0.8), build: buildPolaroidOnPhoto }),
  make({ id: 'seamless-split', name: 'Seamless split', category: 'story', slots: 3, pages: 2, want: W(1, 0.3, 0.6), build: buildSplit }),
];

export const getTemplate = (id: string | null | undefined): Template | undefined => TEMPLATES.find((t) => t.id === id);

/** Template ids offered by each style for auto-fill (cover / panorama / overview are handled explicitly by autofill). */
export const STYLE_TEMPLATE_IDS: Record<StyleId, string[]> = {
  clean: ['inset-single', 'single-border', 'stack-2', 'stack-3', 'stack-2-black', 'stack-3-black', 'pair-side'],
  stylized: ['matted-single', 'framed-portrait', 'print-mat', 'print-mat-3', 'print-mat-4', 'stack-2-black', 'stack-3-black', 'polaroid-on-photo', 'seamless-split', 'stack-2-tight', 'stack-3-tight', 'polaroid-scatter'],
  carousel: ['stack-2', 'stack-3', 'matted-single', 'seamless-split', 'single-border', 'inset-single'],
  gallery: ['pair-stacked', 'pair-side', 'trio', 'triptych', 'grid-2x2', 'inset-single', 'single-border'],
  film: ['film-strip', 'film-strip-4', 'single-border', 'matted-single'],
  polaroid: ['polaroid-scatter', 'polaroid-scatter-2', 'polaroid-on-photo', 'single-border', 'matted-single'],
  magazine: ['magazine', 'inset-single', 'single-border'],
};
export const templatesForStyle = (style: StyleId): Template[] => STYLE_TEMPLATE_IDS[style].map((id) => getTemplate(id)!).filter(Boolean);
