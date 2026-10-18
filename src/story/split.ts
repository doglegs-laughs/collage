import { DEFAULT_CROP } from '../core/geometry';
import type { Photo } from '../core/images';
import { makeStory } from './autofill';
import { applyLayout, FULL_EACH, layoutOptions, pageSeed, userTexts, type LayoutTarget } from './layouts';
import { addPage, aspectRatio, groupOf, newId, type El, type Page, type PhotoEl, type Story } from './model';
import { getTemplate, orientationOf, type Template } from './templates';

export type MoveOpts = {
  seed?: number;
  /** Position (index in the story's pages before the move) for the new page. Default: right after the source page's spread group. A spot inside a group lands after it. */
  insertAt?: number;
};

/** "stack-3" and "stack-2" are one family, as are "grid-2x2" and "grid-3x3" (the finish is kept separately). */
const familyOf = (id: string | null): string => (getTemplate(id)?.id ?? id ?? '').replace(/-\d+(x\d+)?$/, '');

/** The style's default layout for one photo on its own page. */
export function singleTemplateFor(style: Story['style'], photo: Photo | undefined): string {
  const o = photo ? orientationOf(photo) : 's';
  if (style === 'clean') return o === 'l' ? 'single-border' : 'inset-single';
  if (style === 'stylized') return o === 'p' ? 'framed-portrait' : 'matted-single';
  return 'single-border';
}

const optionOf = (t: Template): LayoutTarget => ({ arrangement: t.id, finish: t.finish });

const ratioOf = (e: PhotoEl, A: number) => (e.w * A) / Math.max(1e-9, e.h);

/** No template takes exactly the remaining photos: lay them out with the autofill instead (no empty slots). */
function relayAll(story: Story, without: Story, start: number, end: number, srcIndex: number, seed: number): Story {
  const remaining = without.pages.slice(start, end)
    .flatMap((p) => p.elements.filter((e): e is PhotoEl => e.kind === 'photo' && !!e.photoId))
    .map((e) => story.photos.find((p) => p.id === e.photoId))
    .filter((p): p is Photo => !!p);
  const lead = story.pages[start];
  const fresh = makeStory(remaining, { style: story.style, aspect: story.aspect, seed });
  if (!fresh.length) return without;
  const texts = userTexts(without, srcIndex);
  const pages = fresh.map((p, i): Page => {
    const bg = p.background.toLowerCase() !== '#ffffff' ? p.background : lead.background;
    const base = { ...p, background: bg, duration: lead.duration };
    if (i > 0) return base;
    const top = Math.max(-1, ...p.elements.map((e) => e.z));
    return { ...base, id: lead.id, elements: [...p.elements, ...texts.map((t, k): El => ({ ...t, z: top + 1 + k }))] };
  });
  return { ...without, pages: [...without.pages.slice(0, start), ...pages, ...without.pages.slice(end)] };
}

/** True when moveToOwnPage would do something for this element. */
export function canMoveToOwnPage(story: Story, pageIndex: number, elementId: string): boolean {
  return moveToOwnPage(story, pageIndex, elementId) !== null;
}

/**
 * Send one photo of a multi-photo page (or spread group) to a page of its own, inserted after the source page's group
 * (or at `opts.insertAt`). The remaining photos are laid out again; user-added text stays on the source page.
 * Returns null when the element is not a photo, or the page has fewer than two photos.
 */
export function moveToOwnPage(story: Story, pageIndex: number, elementId: string, opts: MoveOpts = {}): { story: Story; pageIndex: number } | null {
  if (!story.pages[pageIndex]) return null;
  const { start, end } = groupOf(story, pageIndex);
  let srcIndex = -1;
  let moved: PhotoEl | undefined;
  for (let i = start; i < end; i++) {
    const e = story.pages[i].elements.find((x) => x.id === elementId);
    if (e) { srcIndex = i; moved = e.kind === 'photo' ? e : undefined; break; }
  }
  if (!moved || !moved.photoId || srcIndex < 0) return null;
  const photo = story.photos.find((p) => p.id === moved!.photoId);
  if (!photo) return null;
  const groupPhotos = story.pages.slice(start, end).flatMap((p) => p.elements.filter((e): e is PhotoEl => e.kind === 'photo'));
  if (groupPhotos.filter((e) => e.photoId).length < 2) return null;

  const seed = opts.seed ?? pageSeed(story, pageIndex);
  const A = aspectRatio(story.aspect);
  const source = story.pages[srcIndex];

  // 1. Remaining photos on the source page(s).
  const without: Story = {
    ...story,
    pages: story.pages.map((p, i) => (i === srcIndex ? { ...p, elements: p.elements.filter((e) => e.id !== elementId) } : p)),
  };
  const n = groupPhotos.length - 1;
  let option: LayoutTarget | undefined;
  if (n === 1) {
    const left = groupPhotos.find((e) => e.id !== elementId)!;
    const t = getTemplate(singleTemplateFor(story.style, story.photos.find((p) => p.id === left.photoId)));
    if (t) option = optionOf(t);
  } else {
    const all = layoutOptions(without, srcIndex).filter((o) => o.arrangement !== FULL_EACH && o.pages === 1 && o.slots === n && !o.slotsDiffer);
    const fam = familyOf(source.templateId);
    option = (fam && all.find((o) => !o.slotsDiffer && o.slots === n && familyOf(o.arrangement) === fam)) || all[0];
  }
  const relaid = option ? applyLayout(without, srcIndex, option, { seed }).story : relayAll(story, without, start, end, srcIndex, seed);
  const delta = relaid.pages.length - story.pages.length;

  // 2. The new page.
  const t = getTemplate(singleTemplateFor(story.style, photo))!;
  const res = t.layout(story.aspect, [photo], { seed });
  const base = res.pages[0].find((e): e is PhotoEl => e.kind === 'photo');
  if (!base) return null;
  const keep = Math.abs(ratioOf(base, A) / ratioOf(moved, A) - 1) <= 0.05;
  const els: El[] = res.pages[0].map((e) => (e === base ? { ...base, crop: keep ? { ...moved!.crop } : { ...DEFAULT_CROP } } : e));
  const ownBg = res.backgrounds[0] && res.backgrounds[0].toLowerCase() !== '#ffffff' ? res.backgrounds[0] : undefined;
  const page: Page = { id: newId(), templateId: t.id, ...(t.finish ? { finish: t.finish } : {}), background: ownBg ?? source.background, elements: els, duration: source.duration };

  // 3. Where it goes (positions are in the original numbering; the relaid group may have a different length).
  let at = opts.insertAt === undefined ? end : Math.max(0, Math.min(opts.insertAt, story.pages.length));
  if (at > start && at < end) at = end;
  if (at >= end) at += delta;
  const next = addPage(relaid, page, at);
  const index = next.pages.findIndex((p) => p.id === page.id);
  return { story: next, pageIndex: index };
}
