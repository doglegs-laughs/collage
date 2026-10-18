import { breakLines } from './templates';
import { addPage, makeRng, type El, type PhotoEl, type Story, type TextEl } from './model';
import { buildPages } from './autofill';
import { getTemplate, titleElements } from './templates';

const norm = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Re-wrap a replacement title the way the cover template wrapped the old one. */
function rewrap(old: string, next: string): string {
  if (!old.includes('\n')) return next;
  const longest = Math.max(6, ...old.split('\n').map((l) => l.length));
  return breakLines(next, longest).join('\n');
}

/**
 * Update the cover's text when the story title (or subtitle) changes: text elements on page 0
 * whose content equals the old value are rewritten. No-op when nothing matches.
 */
export function replaceCoverText(story: Story, from: string, to: string): Story {
  const first = story.pages[0];
  if (!first || !norm(from)) return story;
  let changed = false;
  const elements = first.elements.map((el) => {
    if (el.kind !== 'text' || norm(el.text) !== norm(from)) return el;
    changed = true;
    return { ...el, text: rewrap(el.text, to) } as TextEl;
  });
  return changed ? { ...story, pages: story.pages.map((p, i) => (i === 0 ? { ...p, elements } : p)) } : story;
}

export const newSeed = (): number => Math.floor(Math.random() * 2 ** 31);

/** Photo ids used by elements, in page order, without duplicates. */
export function usedPhotoIds(story: Story): string[] {
  const seen = new Set<string>();
  for (const p of story.pages) for (const e of p.elements) if (e.kind === 'photo' && e.photoId) seen.add(e.photoId);
  return [...seen];
}

/** True when some text element carries the title role. */
export const hasTitleEl = (story: Story): boolean => story.pages.some((p) => p.elements.some((e) => e.kind === 'text' && e.role === 'title'));

/**
 * Set the text of every element with `role`. An empty value keeps the element (it renders nothing)
 * so typing again restores it.
 */
export function setRoleText(story: Story, role: 'title' | 'subtitle', text: string): Story {
  let changed = false;
  const pages = story.pages.map((p) => {
    if (!p.elements.some((e) => e.kind === 'text' && e.role === role && e.text !== text)) return p;
    changed = true;
    return { ...p, elements: p.elements.map((e) => (e.kind === 'text' && e.role === role ? ({ ...e, text: rewrap(e.text, text) } as TextEl) : e)) };
  });
  return changed ? { ...story, pages } : story;
}

/** Insert a new first page with the style's cover (photo used again is fine). Returns the story and the new page's index (0). */
export function addTitlePage(story: Story, seed: number): Story {
  const title = story.title.trim();
  const subtitle = story.subtitle?.trim() || undefined;
  const leadId = story.pages[0]?.elements.find((e): e is PhotoEl => e.kind === 'photo' && !!e.photoId)?.photoId;
  const photo = story.photos.find((p) => p.id === leadId) ?? story.photos[0];
  const tid = !photo ? 'title-card' : story.style === 'stylized' ? 'cover-sans' : 'cover';
  const rng = makeRng(seed);
  const [pg] = buildPages(getTemplate(tid)!, story.aspect, photo ? [photo] : [], { title, subtitle }, rng);
  return addPage(story, pg, 0);
}

/** True when a photo element spans the page width over the top quarter. */
function photoCoversTop(els: El[]): boolean {
  const limit = 0.25;
  return els.some((e) => e.kind === 'photo' && e.y <= 0.005 && e.y + e.h >= limit && e.x <= 0.05 && e.x + e.w >= 0.95);
}

/** Put the title (and subtitle) at the top of a page. Returns the story and the new title element's id. */
export function addTitleToPage(story: Story, pageIndex: number): { story: Story; titleId: string | null } {
  const pg = story.pages[pageIndex];
  const title = story.title.trim();
  if (!pg || !title) return { story, titleId: null };
  const onPhoto = photoCoversTop(pg.elements);
  const els = titleElements(story.aspect, title, story.subtitle, { color: onPhoto ? '#ffffff' : '#111111', shadow: onPhoto });
  const top = pg.elements.reduce((m, e) => Math.max(m, e.z), -1);
  const added = els.map((e, i) => ({ ...e, z: top + 1 + i }));
  const pages = story.pages.map((p, i) => (i === pageIndex ? { ...p, elements: [...p.elements, ...added] } : p));
  return { story: { ...story, pages }, titleId: added[0].id };
}
