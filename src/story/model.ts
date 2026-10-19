import { DEFAULT_CROP, type Crop } from '../core/geometry';
import type { Photo } from '../core/images';
import { isFontKey } from './fonts';
import { isFinishId, migrateTemplate, type FinishId } from './templateAliases';

export type { Crop, Photo };

export type Aspect = '4:5' | '1:1' | '9:16' | '16:9' | '3:2' | '2:3';
export const ASPECTS: readonly Aspect[] = ['4:5', '1:1', '9:16', '16:9', '3:2', '2:3'];
export type StyleId = 'clean' | 'stylized' | 'carousel' | 'gallery' | 'film' | 'polaroid' | 'magazine';
export const STYLE_IDS: readonly StyleId[] = ['clean', 'stylized', 'carousel', 'gallery', 'film', 'polaroid', 'magazine'];

export type FontKey = 'sans' | 'serif' | 'mono' | 'display' | 'displaySans' | 'italiana' | 'poiret' | 'josefin' | 'cormorant' | 'playfair' | 'montserrat' | 'bebas' | 'caveat' | 'dmmono' | 'marcellus';

/** x,y,w,h are page fractions (x,w of page width; y,h of page height). The box is the OUTER box (frame included). x may be outside 0..1 for overflow/spread elements. */
export type ElementBase = { id: string; x: number; y: number; w: number; h: number; rotation: number; z: number };
export type PhotoEl = ElementBase & {
  kind: 'photo';
  photoId: string | null;
  crop: Crop;
  /** Border thickness as a fraction of page WIDTH, inside the outer box. */
  frame: number;
  frameColor: string;
  /** Extra bottom band (fraction of page width) added to `frame` at the bottom (polaroid). */
  frameBottom: number;
  shadow: boolean;
  /** 0..1 */
  blur: number;
};
export type TextEl = ElementBase & {
  kind: 'text';
  text: string;
  /** Marks the story title / subtitle text so editing the Story fields can find it. */
  role?: 'title' | 'subtitle';
  font: FontKey;
  /** Font size as a fraction of page HEIGHT. */
  size: number;
  weight: 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900;
  color: string;
  align: 'left' | 'center' | 'right';
  /** em */
  letterSpacing: number;
  uppercase: boolean;
  shadow: boolean;
};
export type RectEl = ElementBase & {
  kind: 'rect';
  fill: string;
  stroke: string;
  /** fraction of page width */
  strokeWidth: number;
  shadow: boolean;
  /** corner radius, fraction of page width */
  radius: number;
};
export type El = PhotoEl | TextEl | RectEl;
export type ElKind = El['kind'];

export type Page = {
  id: string;
  /** Arrangement id (where the photos go), or null for a page that matches no layout. */
  templateId: string | null;
  /** How the arrangement is presented; absent for arrangements with a built-in look. */
  finish?: FinishId;
  background: string;
  elements: El[];
  duration: number;
  /** Set on every page of a multi-page template (panorama, seamless split). */
  spread?: { index: number; count: number };
  /** Hidden pages stay in the story (and the editor) but are left out of exports. Applies to a whole spread group. */
  hidden?: boolean;
};
export type BoundaryTransition = 'none' | 'crossfade' | 'slide';
export const BOUNDARY_TRANSITIONS: readonly BoundaryTransition[] = ['none', 'crossfade', 'slide'];
/**
 * Optional manual timing, edited in the Timeline panel. Absent = timing comes from page durations or beat sync alone.
 * `locked`: manual clip lengths in seconds by page id. `transitions`: override for the boundary AFTER that page.
 */
export type Timeline = { audioOffset: number; locked: Record<string, number>; transitions: Record<string, BoundaryTransition> };
export const MIN_CLIP_SECONDS = 0.2;
export const MAX_CLIP_SECONDS = 60;
export type VideoSettings = { transition: 'none' | 'crossfade'; transitionSeconds: number; kenBurns: boolean; audioPath: string | null; fitToMusic: boolean; syncToBeats: boolean; beatsPerPage: 1 | 2 | 4 | 8; timeline?: Timeline };
export type Story = {
  version: 1;
  title: string;
  subtitle?: string;
  aspect: Aspect;
  style: StyleId;
  background: string;
  pages: Page[];
  photos: Photo[];
  video: VideoSettings;
};

/* ---------- geometry of pages ---------- */

export function aspectRatio(aspect: Aspect): number {
  const [w, h] = aspect.split(':').map(Number);
  return w / h;
}
export function pageSize(aspect: Aspect, widthPx: number): { width: number; height: number } {
  const width = Math.max(1, Math.round(widthPx));
  return { width, height: Math.max(1, Math.round(width / aspectRatio(aspect))) };
}
/** Same as pageSize but both edges even (H.264 needs this). */
export function evenPageSize(aspect: Aspect, widthPx: number): { width: number; height: number } {
  const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);
  const width = even(widthPx);
  return { width, height: even(width / aspectRatio(aspect)) };
}

/* ---------- ids and random ---------- */

let counter = 0;
export function newId(): string {
  counter = (counter + 1) % 1679616;
  return `${counter.toString(36)}${Math.random().toString(36).slice(2, 9)}`;
}
/** Small deterministic PRNG (mulberry32); returns floats in [0,1). */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/* ---------- factories ---------- */

export const DEFAULT_VIDEO: VideoSettings = { transition: 'crossfade', transitionSeconds: 0.6, kenBurns: false, audioPath: null, fitToMusic: false, syncToBeats: false, beatsPerPage: 4 };

export function emptyStory(aspect: Aspect = '4:5', style: StyleId = 'clean'): Story {
  return { version: 1, title: '', aspect, style, background: '#ffffff', pages: [], photos: [], video: { ...DEFAULT_VIDEO } };
}
export function emptyPage(background = '#ffffff'): Page {
  return { id: newId(), templateId: null, background, elements: [], duration: 3 };
}
export function defaultPhotoEl(p: Partial<PhotoEl> = {}): PhotoEl {
  return {
    id: newId(), x: 0, y: 0, w: 0.5, h: 0.5, rotation: 0, z: 0,
    kind: 'photo', photoId: null, crop: { ...DEFAULT_CROP }, frame: 0, frameColor: '#ffffff', frameBottom: 0, shadow: false, blur: 0,
    ...p,
  };
}
export function defaultTextEl(p: Partial<TextEl> = {}): TextEl {
  return {
    id: newId(), x: 0.1, y: 0.1, w: 0.8, h: 0.1, rotation: 0, z: 0,
    kind: 'text', text: 'Title', font: 'sans', size: 0.04, weight: 400, color: '#111111', align: 'center', letterSpacing: 0, uppercase: false, shadow: false,
    ...p,
  };
}
export function defaultRectEl(p: Partial<RectEl> = {}): RectEl {
  return {
    id: newId(), x: 0.1, y: 0.1, w: 0.5, h: 0.5, rotation: 0, z: 0,
    kind: 'rect', fill: '#ffffff', stroke: 'transparent', strokeWidth: 0, shadow: false, radius: 0,
    ...p,
  };
}

/* ---------- element queries ---------- */

export const sortByZ = <T extends { z: number }>(els: readonly T[]): T[] => els.map((e, i) => [e, i] as const).sort((a, b) => a[0].z - b[0].z || a[1] - b[1]).map((p) => p[0]);

export type VisibleEl = El & { ghostOf?: number };

/**
 * Elements to draw on page `pageIndex`: its own, plus other pages' elements that overflow onto it
 * (shifted by whole page widths and flagged `ghostOf: owningPageIndex`).
 */
export function elementsVisibleOnPage(story: Story, pageIndex: number): VisibleEl[] {
  const out: VisibleEl[] = [];
  story.pages.forEach((page, j) => {
    if (j === pageIndex) {
      out.push(...page.elements);
      return;
    }
    const shift = j - pageIndex;
    for (const el of page.elements) {
      const x = el.x + shift;
      if (x < 1 - 1e-9 && x + el.w > 1e-9) out.push({ ...el, x, ghostOf: j });
    }
  });
  return out;
}
/** True when the seam between page `boundaryIndex` and `boundaryIndex + 1` is crossed by an element (panorama spread, seamless split). */
export function crossesBoundary(story: Story, boundaryIndex: number): boolean {
  const a = story.pages[boundaryIndex];
  const b = story.pages[boundaryIndex + 1];
  if (!a || !b) return false;
  return a.elements.some((e) => e.x + e.w > 1 + 1e-9 && e.x < 1 - 1e-9) || b.elements.some((e) => e.x < -1e-9 && e.x + e.w > 1e-9);
}
export function owningPage(story: Story, elementId: string): number {
  return story.pages.findIndex((p) => p.elements.some((e) => e.id === elementId));
}
/** Number of pages an element touches horizontally (>1 for spreads). */
export function pagesSpanned(el: El): number {
  return Math.max(1, Math.ceil(el.x + el.w - 1e-9) - Math.floor(el.x + 1e-9));
}
export function photoIdsInUse(story: Story): Set<string> {
  const ids = new Set<string>();
  for (const p of story.pages) for (const e of p.elements) if (e.kind === 'photo' && e.photoId) ids.add(e.photoId);
  return ids;
}
export const findPhoto = (story: Story, id: string | null): Photo | undefined => (id ? story.photos.find((p) => p.id === id) : undefined);

/* ---------- immutable updates ---------- */

const mapPage = (story: Story, i: number, fn: (p: Page) => Page): Story =>
  i < 0 || i >= story.pages.length ? story : { ...story, pages: story.pages.map((p, k) => (k === i ? fn(p) : p)) };

export function updatePage(story: Story, pageIndex: number, patch: Partial<Omit<Page, 'id'>>): Story {
  return mapPage(story, pageIndex, (p) => ({ ...p, ...patch }));
}
export function updateElement(story: Story, pageIndex: number, elementId: string, patch: Partial<PhotoEl> | Partial<TextEl> | Partial<RectEl>): Story {
  return mapPage(story, pageIndex, (p) => ({ ...p, elements: p.elements.map((e) => (e.id === elementId ? ({ ...e, ...patch, id: e.id, kind: e.kind } as El) : e)) }));
}
export function updateElements(story: Story, pageIndex: number, ids: readonly string[], fn: (el: El) => El): Story {
  const set = new Set(ids);
  return mapPage(story, pageIndex, (p) => ({ ...p, elements: p.elements.map((e) => (set.has(e.id) ? fn(e) : e)) }));
}
export function addElement(story: Story, pageIndex: number, el: El): Story {
  return mapPage(story, pageIndex, (p) => ({ ...p, elements: [...p.elements, { ...el, z: Math.max(-1, ...p.elements.map((e) => e.z)) + 1 }] }));
}
export function removeElements(story: Story, pageIndex: number, ids: readonly string[]): Story {
  const set = new Set(ids);
  return mapPage(story, pageIndex, (p) => ({ ...p, elements: p.elements.filter((e) => !set.has(e.id)) }));
}
/** Copies go on top, nudged by `offset` (page fractions). Returns the new story and the new ids in source order. */
export function duplicateElements(story: Story, pageIndex: number, ids: readonly string[], offset = 0.02): { story: Story; newIds: string[] } {
  const page = story.pages[pageIndex];
  if (!page) return { story, newIds: [] };
  const set = new Set(ids);
  const sources = page.elements.filter((e) => set.has(e.id));
  let z = Math.max(-1, ...page.elements.map((e) => e.z));
  const copies = sources.map((e): El => ({ ...e, id: newId(), x: e.x + offset, y: e.y + offset, z: ++z, ...(e.kind === 'photo' ? { crop: { ...e.crop } } : {}) }) as El);
  return { story: mapPage(story, pageIndex, (p) => ({ ...p, elements: [...p.elements, ...copies] })), newIds: copies.map((c) => c.id) };
}
export type ZMove = 'forward' | 'backward' | 'front' | 'back';
/** Re-stack the selected elements; z values are renumbered densely 0..n-1. */
export function reorderZ(story: Story, pageIndex: number, ids: readonly string[], move: ZMove): Story {
  return mapPage(story, pageIndex, (p) => {
    const sel = new Set(ids);
    let order = sortByZ(p.elements).map((e) => e.id);
    if (move === 'front') order = [...order.filter((i) => !sel.has(i)), ...order.filter((i) => sel.has(i))];
    else if (move === 'back') order = [...order.filter((i) => sel.has(i)), ...order.filter((i) => !sel.has(i))];
    else if (move === 'forward') {
      for (let i = order.length - 2; i >= 0; i--) if (sel.has(order[i]) && !sel.has(order[i + 1])) [order[i], order[i + 1]] = [order[i + 1], order[i]];
    } else {
      for (let i = 1; i < order.length; i++) if (sel.has(order[i]) && !sel.has(order[i - 1])) [order[i], order[i - 1]] = [order[i - 1], order[i]];
    }
    const z = new Map(order.map((id, i) => [id, i]));
    return { ...p, elements: p.elements.map((e) => ({ ...e, z: z.get(e.id) ?? e.z })) };
  });
}
/** Swap a photo element's photo, resetting its crop. */
export function replacePhoto(story: Story, pageIndex: number, elementId: string, photoId: string | null): Story {
  return updateElement(story, pageIndex, elementId, { photoId, crop: { ...DEFAULT_CROP } } as Partial<PhotoEl>);
}
export function addPhotos(story: Story, photos: readonly Photo[]): Story {
  const have = new Set(story.photos.map((p) => p.id));
  const fresh = photos.filter((p, i) => !have.has(p.id) && photos.findIndex((q) => q.id === p.id) === i);
  return fresh.length ? { ...story, photos: [...story.photos, ...fresh] } : story;
}
/** Remove photos from the library; slots using them become placeholders. */
export function removePhotos(story: Story, ids: readonly string[]): Story {
  const set = new Set(ids);
  return {
    ...story,
    photos: story.photos.filter((p) => !set.has(p.id)),
    pages: story.pages.map((pg) => ({ ...pg, elements: pg.elements.map((e) => (e.kind === 'photo' && e.photoId && set.has(e.photoId) ? { ...e, photoId: null } : e)) })),
  };
}
/**
 * The pages that belong together with page `i`: a multi-page template (panorama, seamless split) marks each of its
 * pages with `spread { index, count }`. Returns the half-open range [start, end); a plain page is its own group.
 */
export function groupOf(story: Story, i: number): { start: number; end: number } {
  const page = story.pages[i];
  const sp = page?.spread;
  if (!page || !sp || sp.count < 2) return { start: i, end: i + 1 };
  const start = i - sp.index;
  const end = start + sp.count;
  if (start < 0 || end > story.pages.length) return { start: i, end: i + 1 };
  for (let k = 0; k < sp.count; k++) {
    const s = story.pages[start + k]?.spread;
    if (!s || s.index !== k || s.count !== sp.count) return { start: i, end: i + 1 };
  }
  return { start, end };
}
/** Move an insertion point that falls inside a spread group to just after that group. */
function outsideGroups(story: Story, at: number): number {
  const i = Math.max(0, Math.min(at, story.pages.length));
  if (i <= 0 || i >= story.pages.length) return i;
  const g = groupOf(story, i);
  return g.start < i && i < g.end ? g.end : i;
}
/**
 * Elements may overflow only onto pages of their own spread group. Clip anything that reaches into another existing page
 * (the open outer edges of the first and last page are left alone). Elements that would be left with nothing visible are dropped.
 */
export function clipStrayOverflow(story: Story): Story {
  const n = story.pages.length;
  let changed = false;
  const pages = story.pages.map((page, j) => {
    const { start, end } = groupOf(story, j);
    const lo = start > 0 ? start - j : -Infinity;
    const hi = end < n ? end - j : Infinity;
    const els: El[] = [];
    let pageChanged = false;
    for (const el of page.elements) {
      const left = Math.max(el.x, lo);
      const right = Math.min(el.x + el.w, hi);
      if (left === el.x && right === el.x + el.w) { els.push(el); continue; }
      pageChanged = true;
      if (right - left > 1e-9) els.push({ ...el, x: left, w: right - left });
    }
    if (!pageChanged) return page;
    changed = true;
    return { ...page, elements: els };
  });
  return changed ? { ...story, pages } : story;
}
const cloneSpread = (page: Page): Page => ({
  ...page, id: newId(), elements: page.elements.map((e) => ({ ...e, id: newId(), ...(e.kind === 'photo' ? { crop: { ...e.crop } } : {}) }) as El),
  ...(page.spread ? { spread: { ...page.spread } } : {}),
});

/** Indices of the pages that get exported, in order. */
export function visibleIndices(story: Story): number[] {
  return story.pages.flatMap((p, i) => (p.hidden ? [] : [i]));
}
export const visiblePages = (story: Story): Page[] => story.pages.filter((p) => !p.hidden);
export const hiddenCount = (story: Story): number => story.pages.reduce((n, p) => n + (p.hidden ? 1 : 0), 0);
/** Hide or show a page together with the rest of its spread group. */
export function setPageHidden(story: Story, pageIndex: number, hidden: boolean): Story {
  if (!story.pages[pageIndex]) return story;
  const { start, end } = groupOf(story, pageIndex);
  return {
    ...story,
    pages: story.pages.map((p, i) => {
      if (i < start || i >= end) return p;
      const { hidden: _drop, ...rest } = p;
      void _drop;
      return hidden ? { ...rest, hidden: true } : rest;
    }),
  };
}

/** Insert a page; a position inside a spread group lands after that group. */
export function addPage(story: Story, page: Page = emptyPage(story.background), at = story.pages.length): Story {
  const pages = story.pages.slice();
  pages.splice(outsideGroups(story, at), 0, page);
  return clipStrayOverflow({ ...story, pages });
}
/** Remove a page, or its whole spread group. */
export function removePage(story: Story, pageIndex: number): Story {
  if (pageIndex < 0 || pageIndex >= story.pages.length) return story;
  const { start, end } = groupOf(story, pageIndex);
  return clipStrayOverflow({ ...story, pages: story.pages.filter((_, i) => i < start || i >= end) });
}
/** Copy a page, or its whole spread group, with fresh ids; the copy goes right after the original. */
export function duplicatePage(story: Story, pageIndex: number): Story {
  if (!story.pages[pageIndex]) return story;
  const { start, end } = groupOf(story, pageIndex);
  const copies = story.pages.slice(start, end).map(cloneSpread);
  const pages = story.pages.slice();
  pages.splice(end, 0, ...copies);
  return clipStrayOverflow({ ...story, pages });
}
/**
 * Move a page (or its whole spread group) so it ends up where page `to` was; dropping onto a page inside another group lands after that group.
 * `index` is the new position of the page that was at `from`.
 */
export function movePageTo(story: Story, from: number, to: number): { story: Story; index: number } {
  if (from < 0 || from >= story.pages.length) return { story, index: from };
  const { start, end } = groupOf(story, from);
  if (to >= start && to < end) return { story, index: from };
  const len = end - start;
  const moving = story.pages.slice(start, end);
  const rest = story.pages.filter((_, i) => i < start || i >= end);
  const target = Math.max(0, Math.min(to >= end ? to - len + 1 : to, rest.length));
  const without: Story = { ...story, pages: rest };
  const at = outsideGroups(without, target);
  const pages = rest.slice();
  pages.splice(at, 0, ...moving);
  return { story: clipStrayOverflow({ ...story, pages }), index: at + (from - start) };
}
export function movePage(story: Story, from: number, to: number): Story {
  return movePageTo(story, from, to).story;
}
export function setPages(story: Story, pages: Page[]): Story {
  return { ...story, pages };
}

/* ---------- serialization ---------- */

export type SerializedPhoto = { id: string; name: string; path?: string; width: number; height: number };
export class StoryFormatError extends Error {}

export function serializeStory(story: Story): string {
  const photos: SerializedPhoto[] = story.photos.map((p) => ({ id: p.id, name: p.name, ...(p.path ? { path: p.path } : {}), width: p.width, height: p.height }));
  return JSON.stringify({ ...story, photos }, null, 2);
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const fail = (msg: string): never => {
  throw new StoryFormatError(msg);
};
const num = (v: unknown, what: string): number => (typeof v === 'number' && Number.isFinite(v) ? v : fail(`Invalid number for ${what}`));
const str = (v: unknown, what: string): string => (typeof v === 'string' ? v : fail(`Invalid text for ${what}`));

function readElement(raw: unknown): El {
  if (!isObj(raw)) return fail('Invalid element');
  const base = { id: str(raw.id, 'element id'), x: num(raw.x, 'x'), y: num(raw.y, 'y'), w: num(raw.w, 'w'), h: num(raw.h, 'h'), rotation: num(raw.rotation ?? 0, 'rotation'), z: num(raw.z ?? 0, 'z') };
  if (raw.kind === 'photo') {
    const d = defaultPhotoEl();
    const c = isObj(raw.crop) ? raw.crop : {};
    return { ...d, ...(raw as Partial<PhotoEl>), ...base, kind: 'photo', photoId: typeof raw.photoId === 'string' ? raw.photoId : null, crop: { zoom: num(c.zoom ?? 1, 'zoom'), cx: num(c.cx ?? 0.5, 'cx'), cy: num(c.cy ?? 0.5, 'cy') } };
  }
  if (raw.kind === 'text') return { ...defaultTextEl(), ...(raw as Partial<TextEl>), ...base, kind: 'text', text: str(raw.text ?? '', 'text'), font: isFontKey(raw.font) ? raw.font : 'sans' };
  if (raw.kind === 'rect') return { ...defaultRectEl(), ...(raw as Partial<RectEl>), ...base, kind: 'rect' };
  return fail(`Unknown element kind ${String(raw.kind)}`);
}

/** Parse and validate project JSON. Throws StoryFormatError with a readable message. */
export function deserializeStory(json: string): Story {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return fail('This file is not valid JSON.');
  }
  if (!isObj(raw)) return fail('This file is not a story project.');
  if (raw.version !== 1) return fail(`Unsupported project version ${String(raw.version)}.`);
  const aspect = raw.aspect as Aspect;
  if (!ASPECTS.includes(aspect)) return fail('Unknown page aspect.');
  if (!Array.isArray(raw.pages) || !Array.isArray(raw.photos)) return fail('Project is missing pages or photos.');
  const photos: Photo[] = raw.photos.map((p: unknown) => {
    if (!isObj(p)) return fail('Invalid photo entry');
    return { id: str(p.id, 'photo id'), name: str(p.name, 'photo name'), ...(typeof p.path === 'string' ? { path: p.path } : {}), width: num(p.width, 'photo width'), height: num(p.height, 'photo height') };
  });
  const pages: Page[] = raw.pages.map((p: unknown) => {
    if (!isObj(p) || !Array.isArray(p.elements)) return fail('Invalid page');
    const spread = isObj(p.spread) ? { index: num(p.spread.index, 'spread'), count: num(p.spread.count, 'spread') } : undefined;
    const elements = p.elements.map(readElement);
    const lead = elements.find((e): e is PhotoEl => e.kind === 'photo');
    // Pages saved before finishes existed: 'stack-3-tight' becomes stack-3 + tight, and so on.
    const old = migrateTemplate(typeof p.templateId === 'string' ? p.templateId : null, !!lead && (lead.w * aspectRatio(aspect)) / Math.max(1e-9, lead.h) < 1);
    const finish = isFinishId(p.finish) ? p.finish : old.finish;
    return { id: str(p.id, 'page id'), templateId: old.templateId, ...(finish ? { finish } : {}), background: typeof p.background === 'string' ? p.background : '#ffffff', duration: typeof p.duration === 'number' && Number.isFinite(p.duration) ? Math.min(60, Math.max(0.5, p.duration)) : 3, elements, ...(spread ? { spread } : {}), ...(p.hidden === true ? { hidden: true } : {}) };
  });
  const title = typeof raw.title === 'string' ? raw.title : '';
  const subtitle = typeof raw.subtitle === 'string' ? raw.subtitle : '';
  const flat = (t: string) => t.replace(/\s+/g, ' ').trim().toLowerCase();
  for (const p of pages) {
    p.elements = p.elements.map((e) => {
      if (e.kind !== 'text' || e.role) return e;
      if (flat(title) && flat(e.text) === flat(title)) return { ...e, role: 'title' as const };
      if (flat(subtitle) && flat(e.text) === flat(subtitle)) return { ...e, role: 'subtitle' as const };
      return e;
    });
  }
  const v = isObj(raw.video) ? raw.video : {};
  const timeline = readTimeline(v.timeline, new Set(pages.map((p) => p.id)));
  delete (v as Partial<VideoSettings>).timeline; // re-added below only when valid
  const style = STYLE_IDS.includes(raw.style as StyleId) ? (raw.style as StyleId) : 'clean';
  return {
    version: 1,
    title,
    ...(subtitle ? { subtitle } : {}),
    aspect,
    style,
    background: typeof raw.background === 'string' ? raw.background : '#ffffff',
    pages,
    photos,
    video: {
      ...DEFAULT_VIDEO, ...(v as Partial<VideoSettings>),
      syncToBeats: v.syncToBeats === true,
      beatsPerPage: [1, 2, 4, 8].includes(v.beatsPerPage as number) ? v.beatsPerPage as 1 | 2 | 4 | 8 : 4,
      ...(timeline ? { timeline } : {}),
    },
  };
}

/** Validate a saved timeline: offset >= 0, durations clamped to 0.2-60 s, entries for pages that no longer exist dropped. */
function readTimeline(raw: unknown, pageIds: ReadonlySet<string>): Timeline | undefined {
  if (!isObj(raw)) return undefined;
  const audioOffset = typeof raw.audioOffset === 'number' && Number.isFinite(raw.audioOffset) ? Math.max(0, raw.audioOffset) : 0;
  const locked: Record<string, number> = {};
  if (isObj(raw.locked)) {
    for (const [id, d] of Object.entries(raw.locked)) {
      if (pageIds.has(id) && typeof d === 'number' && Number.isFinite(d)) locked[id] = Math.min(MAX_CLIP_SECONDS, Math.max(MIN_CLIP_SECONDS, d));
    }
  }
  const transitions: Record<string, BoundaryTransition> = {};
  if (isObj(raw.transitions)) {
    for (const [id, t] of Object.entries(raw.transitions)) {
      if (pageIds.has(id) && BOUNDARY_TRANSITIONS.includes(t as BoundaryTransition)) transitions[id] = t as BoundaryTransition;
    }
  }
  return { audioOffset, locked, transitions };
}
