import { useEffect, useRef } from 'react';
import { api } from '../api';
import type { Story } from './model';
import { createAutosaveWriter } from './autosave';

export const AUTOSAVE_DELAY_MS = 2000;

/** Writes the story to the autosave 2 s after it changes, and immediately when the app is about to close. */
export function useAutosave(story: Story, thumb: string | null) {
  const latest = useRef({ story, thumb });
  latest.current = { story, thumb };
  const timer = useRef<number | undefined>(undefined);
  const writer = useRef<ReturnType<typeof createAutosaveWriter> | null>(null);
  const hadPages = useRef(false);
  if (story.pages.length) hadPages.current = true;
  if (story.pages.length && !writer.current) writer.current = createAutosaveWriter(() => latest.current);
  const write = (): Promise<boolean> => (writer.current ??= createAutosaveWriter(() => latest.current))();

  useEffect(() => {
    if (!hadPages.current) return;
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void write(), AUTOSAVE_DELAY_MS);
    return () => window.clearTimeout(timer.current);
  }, [story]);

  useEffect(() => api.onAutosaveFlush(() => {
    window.clearTimeout(timer.current);
    return write();
  }), []);
}
