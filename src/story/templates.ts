/**
 * Compatibility layer over the two-axis catalog (arrangements.ts x finishes.ts).
 * A Template is one (arrangement, finish) pair; `getTemplate` also understands every id a story could have stored before finishes existed.
 */
import type { Aspect } from './model';
import type { Photo } from '../core/images';
import { ARRANGEMENTS, arrangementLabel, getArrangement, layoutArrangement, type Arrangement } from './arrangements';
import { resolveFinish } from './finishes';
import type { LayoutOpts, LayoutResult, Orient } from './layoutKit';
import { TEMPLATE_ALIASES, type FinishId } from './templateAliases';

export * from './layoutKit';
export { TEMPLATE_ALIASES } from './templateAliases';

export interface Template {
  /** The arrangement id (finishes are not part of it). */
  id: string;
  name: string;
  arrangement: Arrangement;
  finish: FinishId | null;
  slots: number;
  pageCount: number;
  fits(orientations: Orient[], aspect?: Aspect): number;
  layout(aspect: Aspect, photos: Photo[], opts?: LayoutOpts): LayoutResult;
}

const cache = new Map<string, Template>();
/** The template for an arrangement with a finish (cached; a finish the arrangement does not allow falls back to its default). */
export function templateFor(a: Arrangement, finish?: FinishId | null): Template {
  const f = resolveFinish(a, finish);
  const key = `${a.id}|${f ?? ''}`;
  let t = cache.get(key);
  if (!t) {
    t = {
      id: a.id, name: arrangementLabel(a, f), arrangement: a, finish: f, slots: a.slots, pageCount: a.pages, fits: a.fits,
      layout: (aspect, photos, opts) => layoutArrangement(a, f, aspect, photos, opts),
    };
    cache.set(key, t);
  }
  return t;
}

/** Arrangements with their default finish. */
export const TEMPLATES: Template[] = ARRANGEMENTS.map((a) => templateFor(a));

/** Print mat (3) was stacked landscapes or side-by-side portraits depending on the photos. */
function printMat3(): Template {
  const stack = templateFor(getArrangement('stack-3')!, 'mat');
  const tri = templateFor(getArrangement('triptych')!, 'mat');
  const portrait = (photos: Photo[]) => photos.length > 0 && photos.reduce((a, p) => a + p.width / p.height, 0) / photos.length < 1;
  return {
    ...stack, name: 'Print mat (3)',
    fits: (o, aspect) => (o.length < 3 ? 0 : o.slice(0, 3).every((x) => x === 'l') ? stack.fits(o, aspect) : o.slice(0, 3).every((x) => x === 'p') ? 1 : 0),
    layout: (aspect, photos, opts) => (portrait(photos) ? tri : stack).layout(aspect, photos, opts),
  };
}

/** The print-mat templates keep their old names and fit scores (they are stack / grid arrangements in the mat finish now). */
const LEGACY_PRINT_MAT: Record<string, { name: string; fits?: Template['fits'] }> = {
  'print-mat': { name: 'Print mat (2)' },
  'print-mat-4': { name: 'Print mat (4)', fits: (o) => (o.length < 4 ? 0 : new Set(o.slice(0, 4)).size > 1 ? 0.3 : o[0] === 's' ? 0.6 : 1) },
};

/** Template for an arrangement id or any id from before finishes existed (e.g. 'stack-3-tight', 'print-mat'). */
export function getTemplate(id: string | null | undefined, finish?: FinishId | null): Template | undefined {
  if (!id) return undefined;
  if (id === 'print-mat-3') return printMat3();
  const alias = TEMPLATE_ALIASES[id];
  const a = getArrangement(alias?.arrangement ?? id);
  if (!a) return undefined;
  const t = templateFor(a, finish ?? alias?.finish);
  const legacy = LEGACY_PRINT_MAT[id];
  return legacy ? { ...t, name: legacy.name, fits: legacy.fits ?? t.fits } : t;
}
