import { breakLines } from './templates';
import type { Story, TextEl } from './model';

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
