/** Pure logic of the Collage "Layout" mode: a one-page Story fed by the selected library photos. */
import { cropBox } from '../core/geometry';
import type { Photo } from '../core/images';
import { ARRANGEMENTS, getArrangement } from '../story/arrangements';
import { resolveFinish } from '../story/finishes';
import { applyLayout, currentOf, MAX_SLOTS, pageSeed, type LayoutTarget } from '../story/layouts';
import { addPhotos, aspectRatio, emptyPage, emptyStory, findPhoto, pageSize, photoIdsInUse, type Aspect, type Story } from '../story/model';
import { layoutElementPx } from '../story/render';
import { orientationOf } from '../story/templates';
import type { FinishId } from '../story/templateAliases';

export type PageShape = Aspect | 'match';
export const SHAPES: { value: PageShape; label: string }[] = [
  { value: '1:1', label: '1:1' },
  { value: '4:5', label: '4:5' },
  { value: '3:2', label: '3:2' },
  { value: '2:3', label: '2:3' },
  { value: '16:9', label: '16:9' },
  { value: '9:16', label: '9:16' },
];
export const DEFAULT_SHAPE: PageShape = '4:5';
export const DEFAULT_FINISH: FinishId = 'plain';

/** Arrangements the automatic choice never picks: they need a title, or carry generated text. */
const NOT_AUTO = new Set(['magazine', 'polaroid-on-photo']);

/** Page aspect for the shape; "match" uses the first photo's own proportions (any "w:h" parses as an Aspect). */
export function aspectFor(shape: PageShape, photos: readonly Photo[]): Aspect {
  if (shape !== 'match') return shape;
  const p = photos[0];
  if (!p || !(p.width > 0) || !(p.height > 0)) return '1:1';
  return `${p.width}:${p.height}` as Aspect;
}

/** Arrangements that make a single page without text of their own and show 1..MAX_SLOTS photos. */
const eligible = (slots: number) => (a: (typeof ARRANGEMENTS)[number]) => a.pages === 1 && a.slots === slots && a.group !== 'cover' && !NOT_AUTO.has(a.id);

/** Best-fitting arrangement for these photos on this page shape: the most photos shown (up to MAX_SLOTS), then the best score. */
export function bestArrangementId(photos: readonly Photo[], aspect: Aspect): string | null {
  const n = Math.min(photos.length, MAX_SLOTS);
  if (n === 0) return null;
  const orient = photos.slice(0, MAX_SLOTS).map(orientationOf);
  for (let slots = n; slots >= 1; slots--) {
    let best: { id: string; score: number } | null = null;
    for (const a of ARRANGEMENTS.filter(eligible(slots))) {
      const score = a.fits(orient, aspect);
      if (score > 0 && (!best || score > best.score)) best = { id: a.id, score };
    }
    if (best) return best.id;
  }
  return 'single';
}

/**
 * What to lay the selection out with. The current arrangement and finish stay when they still suit the selection:
 * it shows every selected photo (up to MAX_SLOTS), or the number of photos has not changed since it was chosen and it needs no more than that.
 * Otherwise the best fit is used, keeping the finish where the new arrangement allows it.
 */
export function chooseTarget(photos: readonly Photo[], aspect: Aspect, current: LayoutTarget | null, prevCount: number): LayoutTarget | null {
  const n = Math.min(photos.length, MAX_SLOTS);
  if (n === 0) return null;
  const cur = current ? getArrangement(current.arrangement) : undefined;
  const keep = !!cur && cur.pages === 1 && cur.slots >= 1 && (cur.slots === n || (photos.length === prevCount && cur.slots <= photos.length));
  const arrangement = keep ? cur! : getArrangement(bestArrangementId(photos, aspect))!;
  return { arrangement: arrangement.id, finish: resolveFinish(arrangement, current?.finish ?? DEFAULT_FINISH) };
}

export type PageLook = { background: string; gap?: number; margin?: number };

/** The current arrangement and finish of the one page, or null when it holds no layout yet. */
export function targetOf(story: Story): LayoutTarget | null {
  if (!story.pages[0]) return null;
  const cur = currentOf(story, 0);
  return cur ? { arrangement: cur.arrangement.id, finish: cur.finish } : null;
}

/** A one-page story showing `photos` (in order) in `target`; an empty page when there is no target. */
export function buildLayoutStory(prev: Story | null, photos: readonly Photo[], aspect: Aspect, target: LayoutTarget | null, look: PageLook): Story {
  const base = prev ?? emptyStory(aspect);
  const lead = base.pages[0] ?? emptyPage(look.background);
  const blank = { id: lead.id, templateId: null, background: look.background, elements: [], duration: lead.duration };
  const story: Story = { ...base, aspect, background: look.background, photos: [...photos], pages: [blank] };
  if (!target) return story;
  const r = applyLayout(story, 0, target, { seed: pageSeed(story, 0), extraPhotoIds: photos.map((p) => p.id), gap: look.gap, margin: look.margin });
  return trimPhotos(r.story);
}

/** Switch the page to `target` using the page's photos first, then `extra` (selected photos not on the page) for any more slots. */
export function applyTarget(story: Story, extra: readonly Photo[], target: LayoutTarget, look: Pick<PageLook, 'gap' | 'margin'>): Story {
  const base = addPhotos(story, extra);
  const r = applyLayout(base, 0, target, { seed: pageSeed(story, 0), extraPhotoIds: extra.map((p) => p.id), ...look });
  if (r.story === base) return story;
  return trimPhotos(r.story);
}

/** Photos the page does not show do not belong to the story's photo list (the library keeps them). */
function trimPhotos(story: Story): Story {
  const used = photoIdsInUse(story);
  const photos = story.photos.filter((p) => used.has(p.id));
  return photos.length === story.photos.length ? story : { ...story, photos };
}

/** Selected photos that are not on the page, in selection order. */
export function unusedPhotos(story: Story, selected: readonly Photo[]): Photo[] {
  const used = photoIdsInUse(story);
  return selected.filter((p) => !used.has(p.id));
}

export const EXPORT_EDGES = [2160, 4096] as const;
export const MAX_EXPORT_EDGE = 8192;
export type ExportChoice = '2160' | '4096' | 'original';

/** Largest long edge at which no photo on the page is upscaled (frames at their on-page crop), capped at MAX_EXPORT_EDGE. */
export function originalLongEdge(story: Story): number {
  const ratio = aspectRatio(story.aspect);
  const REF = 1000;
  let width = Infinity;
  for (const el of story.pages[0]?.elements ?? []) {
    if (el.kind !== 'photo' || !el.photoId) continue;
    const photo = findPhoto(story, el.photoId);
    if (!photo) continue;
    const { inner } = layoutElementPx(el, REF, REF / ratio);
    if (inner.w <= 0 || inner.h <= 0) continue;
    const box = cropBox(photo, el.crop, inner.w / inner.h);
    const pxPerSource = Math.max(inner.w / box.w, inner.h / box.h);
    width = Math.min(width, REF / pxPerSource);
  }
  if (!Number.isFinite(width)) return EXPORT_EDGES[0];
  const long = ratio >= 1 ? width : width / ratio;
  return Math.max(256, Math.min(MAX_EXPORT_EDGE, Math.floor(long)));
}

export function exportLongEdge(choice: ExportChoice, story: Story): number {
  return choice === 'original' ? originalLongEdge(story) : Number(choice);
}

/** Pixel size of the exported page for a long edge. */
export function exportSize(story: Story, longEdge: number): { width: number; height: number } {
  const ratio = aspectRatio(story.aspect);
  return pageSize(story.aspect, ratio >= 1 ? longEdge : longEdge * ratio);
}
