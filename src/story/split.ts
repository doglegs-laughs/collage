import { DEFAULT_CROP } from '../core/geometry';
import type { Photo } from '../core/images';
import { makeStory } from './autofill';
import { applyLayout, FULL_EACH, layoutOptions, pageSeed, userTexts, type LayoutTarget } from './layouts';
import { addPage, aspectRatio, groupOf, newId, removePage, updateElements, type El, type Page, type PhotoEl, type Story } from './model';
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

/** No template takes exactly the photos: lay them out with the autofill instead (no empty slots). `extra` is one more photo to show after the others. */
function relayAll(story: Story, without: Story, start: number, end: number, srcIndex: number, seed: number, extra?: Photo): Story {
  const remaining = without.pages.slice(start, end)
    .flatMap((p) => p.elements.filter((e): e is PhotoEl => e.kind === 'photo' && !!e.photoId))
    .map((e) => story.photos.find((p) => p.id === e.photoId))
    .filter((p): p is Photo => !!p);
  if (extra) remaining.push(extra);
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

/** A page of its own for one photo in the style's single layout. `prior` is a frame the photo had: its crop is kept when the new frame is about the same shape. */
function singlePage(story: Story, photo: Photo, seed: number, from: Page, prior?: PhotoEl): Page | null {
  const t = getTemplate(singleTemplateFor(story.style, photo))!;
  const res = t.layout(story.aspect, [photo], { seed });
  const base = res.pages[0].find((e): e is PhotoEl => e.kind === 'photo');
  if (!base) return null;
  const A = aspectRatio(story.aspect);
  const keep = !!prior && Math.abs(ratioOf(base, A) / ratioOf(prior, A) - 1) <= 0.05;
  const els: El[] = res.pages[0].map((e) => (e === base ? { ...base, crop: keep ? { ...prior!.crop } : { ...DEFAULT_CROP } } : e));
  const ownBg = res.backgrounds[0] && res.backgrounds[0].toLowerCase() !== '#ffffff' ? res.backgrounds[0] : undefined;
  return { id: newId(), templateId: t.id, ...(t.finish ? { finish: t.finish } : {}), background: ownBg ?? from.background, elements: els, duration: from.duration };
}

/** Drop one photo element from its page and lay the rest of its spread group out again (user text stays). */
function relayWithout(story: Story, srcIndex: number, elementId: string, seed: number): Story {
  const { start, end } = groupOf(story, srcIndex);
  const source = story.pages[srcIndex];
  const groupPhotos = story.pages.slice(start, end).flatMap((p) => p.elements.filter((e): e is PhotoEl => e.kind === 'photo'));
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
  return option ? applyLayout(without, srcIndex, option, { seed }).story : relayAll(story, without, start, end, srcIndex, seed);
}

/**
 * Take a photo out of every page that shows it (it stays in the story's photo list). Each page is laid out again with
 * its other photos; a page left without photos is deleted, unless it has its own text (a title), where the slot is emptied.
 */
export function removePhotoFromPages(story: Story, photoId: string): Story {
  let s = story;
  for (let guard = 0; guard < 1000; guard++) {
    const i = s.pages.findIndex((p) => p.elements.some((e) => e.kind === 'photo' && e.photoId === photoId));
    if (i < 0) return s;
    const el = s.pages[i].elements.find((e): e is PhotoEl => e.kind === 'photo' && e.photoId === photoId)!;
    const { start, end } = groupOf(s, i);
    const group = s.pages.slice(start, end);
    const others = group.flatMap((p) => p.elements).filter((e) => e.kind === 'photo' && e.photoId && e.id !== el.id).length;
    if (others > 0) s = relayWithout(s, i, el.id, pageSeed(s, i));
    else if (group.some((p) => p.elements.some((e) => e.kind === 'text' && e.text.trim()))) s = updateElements(s, i, [el.id], (e) => ({ ...e, photoId: null }) as El);
    else s = removePage(s, i);
  }
  return s;
}

/** Where a photo sat in the story: the first page showing it, and that page's index. */
export type PhotoSpot = { pageId: string; index: number };

export function photoSpot(story: Story, photoId: string): PhotoSpot | null {
  const index = story.pages.findIndex((p) => p.elements.some((e) => e.kind === 'photo' && e.photoId === photoId));
  return index < 0 ? null : { pageId: story.pages[index].id, index };
}

/** The inverse of relayWithout: add one photo to the page's spread group and lay the group out again with one more slot (user text stays). */
function relayWith(story: Story, pageIndex: number, photo: Photo, seed: number): Story {
  const { start, end } = groupOf(story, pageIndex);
  const n = story.pages.slice(start, end).flatMap((p) => p.elements.filter((e) => e.kind === 'photo')).length;
  const all = layoutOptions(story, pageIndex).filter((o) => o.arrangement !== FULL_EACH && o.pages === 1 && o.slots === n + 1);
  const fam = familyOf(story.pages[pageIndex].templateId);
  const option = (fam && all.find((o) => familyOf(o.arrangement) === fam)) || all[0];
  return option
    ? applyLayout(story, pageIndex, option, { seed, extraPhotoIds: [photo.id] }).story
    : relayAll(story, story, start, end, pageIndex, seed, photo);
}

/**
 * Put a photo that no page shows into the story. With the `spot` it was taken from: back onto that page (laid out again with
 * one more photo, or into its emptied slot), or, when that page is gone, onto a new page at the same position. Without a spot,
 * a new page at the end. `back` says whether the old spot was used. Returns the story and the page to show.
 */
export function addPhotoToStory(story: Story, photo: Photo, spot?: PhotoSpot | null, seed?: number): { story: Story; pageIndex: number; back: boolean } {
  const s = story.photos.some((p) => p.id === photo.id) ? story : { ...story, photos: [...story.photos, photo] };
  const at = spot ? s.pages.findIndex((p) => p.id === spot.pageId) : -1;
  if (spot && at >= 0) {
    const { start, end } = groupOf(s, at);
    const slots = s.pages.slice(start, end).flatMap((p, k) => p.elements.filter((e): e is PhotoEl => e.kind === 'photo').map((e) => ({ e, page: start + k })));
    const empty = slots.find((x) => !x.e.photoId);
    if (empty) return { story: updateElements(s, empty.page, [empty.e.id], (e) => ({ ...e, photoId: photo.id }) as El), pageIndex: empty.page, back: true };
    if (slots.length) return { story: relayWith(s, at, photo, seed ?? pageSeed(s, at)), pageIndex: at, back: true };
  }
  const where = spot ? Math.max(0, Math.min(spot.index, s.pages.length)) : s.pages.length;
  const from = s.pages[Math.min(where, s.pages.length - 1)] ?? s.pages[s.pages.length - 1];
  const page = singlePage(s, photo, seed ?? pageSeed(s, Math.max(0, s.pages.length - 1)), from);
  if (!page) return { story, pageIndex: Math.max(0, story.pages.length - 1), back: false };
  const next = addPage(s, page, where);
  return { story: next, pageIndex: next.pages.findIndex((p) => p.id === page.id), back: !!spot };
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
  const source = story.pages[srcIndex];

  // 1. Remaining photos on the source page(s).
  const relaid = relayWithout(story, srcIndex, elementId, seed);
  const delta = relaid.pages.length - story.pages.length;

  // 2. The new page.
  const page = singlePage(story, photo, seed, source, moved);
  if (!page) return null;

  // 3. Where it goes (positions are in the original numbering; the relaid group may have a different length).
  let at = opts.insertAt === undefined ? end : Math.max(0, Math.min(opts.insertAt, story.pages.length));
  if (at > start && at < end) at = end;
  if (at >= end) at += delta;
  const next = addPage(relaid, page, at);
  const index = next.pages.findIndex((p) => p.id === page.id);
  return { story: next, pageIndex: index };
}
