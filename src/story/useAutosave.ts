import { useEffect, useRef } from 'react';
import { api, isDesktop, type SidecarPhoto } from '../api';
import { serializeStory, type Story } from './model';

export const AUTOSAVE_DELAY_MS = 2000;

/** Writes the story to the autosave 2 s after it changes, and immediately when the app is about to close. */
export function useAutosave(story: Story, thumb: string | null) {
  const latest = useRef({ story, thumb });
  latest.current = { story, thumb };
  const sent = useRef(new Set<string>());
  const timer = useRef<number | undefined>(undefined);

  const write = useRef(async (): Promise<boolean> => {
    const { story: s, thumb: t } = latest.current;
    if (!s.pages.length) return true;
    try {
      const sidecar: SidecarPhoto[] = [];
      const ids: string[] = [];
      if (isDesktop()) {
        for (const p of s.photos) {
          if (p.path || !p.file || sent.current.has(p.id)) continue;
          sidecar.push({ id: p.id, name: p.name, data: new Uint8Array(await p.file.arrayBuffer()) });
          ids.push(p.id);
        }
      }
      const ok = await api.autosaveWrite(serializeStory(s), sidecar, { title: s.title, pageCount: s.pages.length, thumb: t });
      if (ok) ids.forEach((id) => sent.current.add(id));
      return ok;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    if (!story.pages.length) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void write.current(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer.current);
  }, [story]);

  useEffect(() => api.onAutosaveFlush(() => {
    window.clearTimeout(timer.current);
    return write.current();
  }), []);
}
