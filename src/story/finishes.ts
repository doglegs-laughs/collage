import type { Arrangement } from './arrangements';
import { centered, matAvail, MAT_PAD, photoEl, rectEl, type Built, type Ctx, type Rect } from './layoutKit';
import type { El, PhotoEl } from './model';
import type { Photo } from '../core/images';
import type { FinishId } from './templateAliases';

export { FINISH_IDS, isFinishId, type FinishId } from './templateAliases';

export const FINISH_INFO: Record<FinishId, { label: string; hint: string }> = {
  plain: { label: 'Plain', hint: 'White gutters and margins' },
  tight: { label: 'Tight', hint: 'Hairline gutters' },
  black: { label: 'Black borders', hint: 'Thin black frame around each photo' },
  frame: { label: 'Thick frame', hint: 'Heavy black frame' },
  mat: { label: 'Print mat', hint: 'Photos on a paper mat with a hairline outline' },
  shadow: { label: 'Shadow', hint: 'Black frame with a soft drop shadow' },
  bleed: { label: 'Full bleed', hint: 'Edge to edge' },
};
export const finishLabel = (f: FinishId): string => FINISH_INFO[f].label;

/** Geometry constants (fractions of page width). */
export const TIGHT_GAP = 0.005;
export const BLACK_FRAME = 0.006;
export const THICK_FRAME = 0.017;
export const FRAME_COLOR = '#0a0a0a';
export const BLACK_COLOR = '#000000';
/** Share of the page a framed single may fill (width, height). */
const FRAMED_W = 0.88;
const FRAMED_H = 0.86;

/** The finish that will actually be used: `want` when the arrangement allows it, else its default (null for arrangements with a built-in look). */
export function resolveFinish(arr: Arrangement, want: FinishId | null | undefined): FinishId | null {
  if (arr.finishes.length === 0) return null;
  return want && arr.finishes.includes(want) ? want : arr.defaultFinish;
}

const mapPhotos = (b: Built, fn: (e: PhotoEl) => PhotoEl): Built => ({ ...b, pages: b.pages.map((els) => els.map((e) => (e.kind === 'photo' ? fn(e) : e))) });

/** Wrap the page's photo group in a paper mat, centred on the page (the group was built in the smaller mat area). */
function wrapInMat(c: Ctx, b: Built): Built {
  const els = b.pages[0];
  const boxes = els.filter((e): e is PhotoEl => e.kind === 'photo').map((e) => ({ x: e.x, y: e.y / c.A, r: e.x + e.w, b: (e.y + e.h) / c.A }));
  if (boxes.length === 0) return b;
  const x0 = Math.min(...boxes.map((r) => r.x));
  const y0 = Math.min(...boxes.map((r) => r.y));
  const x1 = Math.max(...boxes.map((r) => r.r));
  const y1 = Math.max(...boxes.map((r) => r.b));
  const paper: Rect = centered(c, x1 - x0 + 2 * MAT_PAD, y1 - y0 + 2 * MAT_PAD);
  const dx = paper.x + MAT_PAD - x0;
  const dy = paper.y + MAT_PAD - y0;
  const moved: El[] = els.map((e) => ({ ...e, x: e.x + dx, y: e.y + dy * c.A }));
  const rect = rectEl(c, paper, { fill: '#ffffff', stroke: '#d6d6d6', strokeWidth: 0.0012, shadow: true });
  return { ...b, pages: [[rect, ...moved], ...b.pages.slice(1)] };
}

/**
 * Build the arrangement's photos with a finish. Every multi-photo arrangement gets plain / tight / black / mat this way;
 * singles also get frame / shadow / bleed. Arrangements with a built-in look (covers, spreads, specials) are built as they are.
 */
export function applyFinish(arr: Arrangement, finish: FinishId | null | undefined, c: Ctx, photos: Photo[]): Built {
  const f = arr.finishes.length < 2 ? null : resolveFinish(arr, finish);
  switch (f) {
    case 'tight':
      return arr.build({ ...c, g: TIGHT_GAP }, photos);
    case 'black':
      return mapPhotos(arr.build(c, photos), (e) => ({ ...e, frame: BLACK_FRAME, frameBottom: BLACK_FRAME, frameColor: BLACK_COLOR }));
    case 'frame':
    case 'shadow': {
      const built = arr.build({ ...c, area: { w: FRAMED_W, h: FRAMED_H * c.H }, pad: THICK_FRAME }, photos);
      return mapPhotos(built, (e) => ({ ...e, frame: THICK_FRAME, frameColor: FRAME_COLOR, ...(f === 'shadow' ? { shadow: true } : {}) }));
    }
    case 'bleed':
      return { pages: [photos.slice(0, arr.slots).map((p) => photoEl(c, p, { x: 0, y: 0, w: 1, h: c.H }))] };
    case 'mat': {
      const { aw, ah } = matAvail(c);
      return wrapInMat(c, arr.build({ ...c, area: { w: aw, h: ah } }, photos));
    }
    default:
      return arr.build(c, photos);
  }
}
