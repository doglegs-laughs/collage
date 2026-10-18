import type { Photo } from '../core/images';
import { aspectRatio, type Aspect } from './model';
import { applyFinish, finishLabel, resolveFinish } from './finishes';
import {
  buildCover, buildCoverBorder, buildCoverBorderBelow, buildCoverMat, buildFilm, buildGrid, buildInset, buildMagazine, buildPairSide, buildPairStacked,
  buildPano, buildPolaroidOnPhoto, buildScatter, buildSingle, buildSplit, buildStack, buildTitleCard, buildTrio, buildTriptych, clampN, WHITE,
  type Built, type Ctx, type LayoutOpts, type LayoutResult, type Orient,
} from './layoutKit';
import type { FinishId } from './templateAliases';

/** Where a layout sits in the picker. */
export type Group = 'cover' | 'single' | 'multi' | 'spread' | 'special';
export const GROUP_LABELS: Record<Group, string> = { cover: 'Cover', single: 'Single', multi: 'Multiple photos', spread: 'Across pages', special: 'Special' };
export const GROUP_ORDER: Group[] = ['cover', 'single', 'multi', 'spread', 'special'];

/** Where the photos go. How they are presented is the finish. */
export interface Arrangement {
  id: string;
  name: string;
  group: Group;
  /** Photos consumed (title-card: 0, optionally one hero). */
  slots: number;
  /** Pages produced (2 or 3 for spreads). */
  pages: number;
  /** Score 0..1 for the next photos' orientations (needs >= slots entries, else 0). `aspect` lets portrait-page-only layouts opt out of wide pages. */
  fits(orientations: Orient[], aspect?: Aspect): number;
  /** Raw geometry in the context (gap `c.g`, available area), before any finish. */
  build(c: Ctx, photos: Photo[]): Built;
  /** Finishes the user can pick. Empty for arrangements with a built-in look (spreads, specials); one entry for covers. */
  finishes: FinishId[];
  defaultFinish: FinishId | null;
}

/* ---------- fit scoring ---------- */

export type Want = Record<Orient, number>;
export const W = (p: number, l: number, s: number): Want => ({ p, l, s });
export const scoreOf = (want: Want, slots: number, bias?: (A: number) => number, only?: Orient[]) => (o: Orient[], aspect?: Aspect): number => {
  if (o.length < slots) return 0;
  if (only && o.slice(0, slots).some((x) => !only.includes(x))) return 0;
  const A = aspect ? aspectRatio(aspect) : 0.8;
  const b = bias ? bias(A) : 1;
  if (slots === 0) return 0.5 * b;
  let s = 0;
  for (let i = 0; i < slots; i++) s += want[o[i]];
  return clampN((s / slots) * b, 0, 1);
};
export const tallPage = (A: number) => (A < 1.3 ? 1 : 0.15);

type Def = {
  id: string; name: string; group: Group; slots: number; pages?: number; want: Want; bias?: (A: number) => number; only?: Orient[];
  build: (c: Ctx, photos: Photo[]) => Built; finishes?: FinishId[]; defaultFinish?: FinishId;
};
const make = (d: Def): Arrangement => ({
  id: d.id, name: d.name, group: d.group, slots: d.slots, pages: d.pages ?? 1,
  fits: scoreOf(d.want, d.slots, d.bias, d.only), build: d.build,
  finishes: d.finishes ?? [], defaultFinish: d.defaultFinish ?? d.finishes?.[0] ?? null,
});

const GROUPED: FinishId[] = ['plain', 'tight', 'black', 'mat'];
const SINGLE: FinishId[] = ['plain', 'black', 'frame', 'shadow', 'mat', 'bleed'];
const own = (f: FinishId): FinishId[] => [f];

export const ARRANGEMENTS: Arrangement[] = [
  make({ id: 'cover', name: 'Cover', group: 'cover', slots: 1, want: W(1, 0.7, 0.8), build: buildCover(false), finishes: own('bleed') }),
  make({ id: 'cover-sans', name: 'Cover (sans)', group: 'cover', slots: 1, want: W(0.9, 0.7, 0.8), build: buildCover(true), finishes: own('bleed') }),
  make({ id: 'cover-border', name: 'Cover — white border', group: 'cover', slots: 1, want: W(0.8, 1, 0.9), build: buildCoverBorder, finishes: own('plain') }),
  make({ id: 'cover-border-below', name: 'Cover — white border, title below', group: 'cover', slots: 1, want: W(0.8, 1, 0.9), build: buildCoverBorderBelow, finishes: own('plain') }),
  make({ id: 'cover-mat', name: 'Cover — print mat', group: 'cover', slots: 1, want: W(0.7, 1, 0.8), build: buildCoverMat, finishes: own('mat') }),
  make({ id: 'title-card', name: 'Title card', group: 'special', slots: 0, want: W(0, 0, 0), build: buildTitleCard }),
  make({ id: 'single', name: 'Single', group: 'single', slots: 1, want: W(0.8, 0.8, 0.7), build: buildSingle, finishes: SINGLE, defaultFinish: 'plain' }),
  make({ id: 'inset-single', name: 'Inset single', group: 'single', slots: 1, want: W(1, 0.35, 0.7), build: buildInset, finishes: ['plain', 'black', 'frame', 'shadow', 'mat'], defaultFinish: 'plain' }),
  make({ id: 'pano-2', name: 'Panorama spread', group: 'spread', slots: 1, pages: 2, want: W(0, 0.9, 0.1), build: buildPano(2) }),
  make({ id: 'pano-3', name: 'Panorama (3 pages)', group: 'spread', slots: 1, pages: 3, want: W(0, 0.8, 0.1), build: buildPano(3) }),
  make({ id: 'stack-2', name: 'Stack 2', group: 'multi', slots: 2, want: W(0.15, 1, 0.4), bias: tallPage, only: ['l'], build: buildStack(2), finishes: GROUPED, defaultFinish: 'plain' }),
  make({ id: 'stack-3', name: 'Stack 3', group: 'multi', slots: 3, want: W(0.1, 1, 0.3), bias: tallPage, only: ['l'], build: buildStack(3), finishes: GROUPED, defaultFinish: 'plain' }),
  make({ id: 'pair-stacked', name: 'Pair stacked', group: 'multi', slots: 2, want: W(0.2, 1, 0.5), bias: tallPage, only: ['l'], build: buildPairStacked, finishes: GROUPED, defaultFinish: 'plain' }),
  make({ id: 'pair-side', name: 'Pair side by side', group: 'multi', slots: 2, want: W(1, 0.25, 0.6), only: ['p', 's'], build: buildPairSide, finishes: GROUPED, defaultFinish: 'plain' }),
  make({ id: 'trio', name: 'Trio', group: 'multi', slots: 3, want: W(0.7, 0.7, 0.6), build: buildTrio, finishes: GROUPED, defaultFinish: 'plain' }),
  make({ id: 'triptych', name: 'Triptych', group: 'multi', slots: 3, want: W(1, 0.2, 0.5), build: buildTriptych, finishes: GROUPED, defaultFinish: 'plain' }),
  make({ id: 'grid-2x2', name: 'Grid 2x2', group: 'multi', slots: 4, want: W(0.6, 0.6, 0.8), build: buildGrid(2, 2), finishes: GROUPED, defaultFinish: 'plain' }),
  make({ id: 'grid-3x3', name: 'Grid 3x3', group: 'multi', slots: 9, want: W(0.55, 0.55, 0.7), build: buildGrid(3, 3), finishes: GROUPED, defaultFinish: 'plain' }),
  make({ id: 'overview-grid', name: 'Overview grid 3x2', group: 'multi', slots: 6, want: W(1, 0.25, 0.5), build: buildGrid(2, 3), finishes: GROUPED, defaultFinish: 'plain' }),
  make({ id: 'film-strip', name: 'Film strip', group: 'special', slots: 3, want: W(0.15, 1, 0.4), bias: tallPage, only: ['l'], build: buildFilm(3) }),
  make({ id: 'film-strip-4', name: 'Film strip (4)', group: 'special', slots: 4, want: W(0.15, 1, 0.4), bias: tallPage, only: ['l'], build: buildFilm(4) }),
  make({ id: 'polaroid-scatter', name: 'Polaroid scatter', group: 'special', slots: 3, want: W(0.7, 0.7, 0.9), build: buildScatter(3) }),
  make({ id: 'polaroid-scatter-2', name: 'Polaroid pair', group: 'special', slots: 2, want: W(0.7, 0.7, 0.9), build: buildScatter(2) }),
  make({ id: 'magazine', name: 'Magazine', group: 'special', slots: 1, want: W(0.8, 0.8, 0.7), build: buildMagazine }),
  make({ id: 'polaroid-on-photo', name: 'Polaroid on photo', group: 'special', slots: 2, want: W(0.8, 0.8, 0.8), build: buildPolaroidOnPhoto }),
  make({ id: 'seamless-split', name: 'Seamless split', group: 'spread', slots: 3, pages: 2, want: W(1, 0.3, 0.6), build: buildSplit }),
];

export const getArrangement = (id: string | null | undefined): Arrangement | undefined => ARRANGEMENTS.find((a) => a.id === id);

/** Finishes the arrangement offers to pick from (none when it has a single built-in look). */
export const pickableFinishes = (a: Arrangement): FinishId[] => (a.finishes.length > 1 ? a.finishes : []);

/** "Stack 3 · Black borders"; the arrangement's default finish is not repeated, and a full-bleed single is "Full screen photo". */
export function arrangementLabel(a: Arrangement, finish: FinishId | null | undefined): string {
  const f = resolveFinish(a, finish);
  if (a.id === 'single' && f === 'bleed') return 'Full screen photo';
  return f && f !== a.defaultFinish && a.finishes.length > 1 ? `${a.name} · ${finishLabel(f)}` : a.name;
}

/** Lay an arrangement out with a finish: pages of elements (z in order) and page backgrounds. */
export function layoutArrangement(a: Arrangement, finish: FinishId | null | undefined, aspect: Aspect, photos: Photo[], opts: LayoutOpts = {}): LayoutResult {
  const A = aspectRatio(aspect);
  const g = opts.gap ?? 0.025;
  const c: Ctx = { A, H: 1 / A, g, m: opts.margin ?? g, seed: opts.seed ?? 1, opts };
  const built = applyFinish(a, finish, c, photos);
  const pages = built.pages.map((els) => els.map((e, z) => ({ ...e, z })));
  return { pages, backgrounds: pages.map(() => built.bg ?? WHITE) };
}
