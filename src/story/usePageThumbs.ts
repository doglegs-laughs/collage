import { useEffect, useMemo, useRef, useState } from 'react';
import { getPreviewBitmap } from '../core/images';
import { elementsVisibleOnPage, type Story } from './model';
import { renderPage } from './render';

export const THUMB_WIDTH = 200;
const CACHE_MAX = 300;

/** Everything that affects how page `i` looks, as a string (own elements + neighbours' overflow). */
export function pageKey(story: Story, i: number): string {
  const page = story.pages[i];
  return JSON.stringify([story.aspect, page?.background, elementsVisibleOnPage(story, i), story.photos.map((p) => p.id)]);
}

/** Rendered page thumbnails (data URLs), re-rendered debounced and cached by page content. */
export function usePageThumbs(story: Story): (string | null)[] {
  const cache = useRef(new Map<string, string>());
  const shown = useRef<(string | null)[]>([]);
  const [, bump] = useState(0);
  const keys = useMemo(() => story.pages.map((_, i) => pageKey(story, i)), [story]);
  const latest = useRef(story);
  latest.current = story;

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      const s = latest.current;
      for (let i = 0; i < keys.length; i++) {
        if (cancelled) return;
        if (cache.current.has(keys[i])) continue;
        try {
          const canvas = (await renderPage(s, i, THUMB_WIDTH, getPreviewBitmap)) as HTMLCanvasElement;
          if (cancelled) return;
          cache.current.set(keys[i], canvas.toDataURL('image/jpeg', 0.82));
          if (cache.current.size > CACHE_MAX) cache.current.delete(cache.current.keys().next().value as string);
          bump((n) => n + 1);
        } catch {
          /* a photo that cannot be decoded just leaves the thumbnail blank */
        }
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [keys]);

  const urls = keys.map((k, i) => cache.current.get(k) ?? shown.current[i] ?? null);
  shown.current = urls;
  return urls;
}
