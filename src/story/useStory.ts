import { useCallback, useRef, useState } from 'react';
import { useHistory, type History } from '../core/history';
import type { Photo } from '../core/images';
import { makeStory } from './autofill';
import { DEFAULT_VIDEO, emptyStory, type Aspect, type StyleId, type Story } from './model';
import { newSeed, replaceCoverText } from './storyOps';

export type GenerateOpts = { style?: StyleId; aspect?: Aspect; title?: string; subtitle?: string; seed?: number };
export type StoryState = {
  story: Story;
  subtitle: string;
  seed: number;
  history: History<Story>;
  /** Commit a story change (undoable). Same key within 500 ms merges into one step. */
  mutate: (fn: (s: Story) => Story, key?: string) => void;
  live: React.MutableRefObject<Story>;
  /** Build pages from `photos`; resolves with the number of pages. A fresh seed is used unless `seed` is given. */
  generate: (photos: Photo[], opts?: GenerateOpts) => number;
  setTitle: (title: string) => void;
  setSubtitle: (subtitle: string) => void;
  /** Load a whole story (project open); clears history. */
  load: (story: Story) => void;
  /** True when the story differs from the last saved / opened / freshly generated one (undoing back to it clears this). */
  dirty: boolean;
  /** Treat `story` (the snapshot that was just written to disk) as the clean state. */
  markSaved: (story: Story) => void;
};

const initialStory = (): Story => ({ ...emptyStory(), video: { ...DEFAULT_VIDEO, kenBurns: true } });

export function useStory(): StoryState {
  const history = useHistory<Story>(initialStory);
  const story = history.state;
  const live = useRef(story);
  live.current = story;
  const [subtitle, setSubtitleState] = useState('');
  const [seed, setSeed] = useState(newSeed);
  const sub = useRef(subtitle);
  sub.current = subtitle;
  const seedRef = useRef(seed);
  seedRef.current = seed;
  const { set } = history;
  const [baseline, setBaseline] = useState<Story>(story);
  const dirty = story !== baseline;

  const generate = useCallback((photos: Photo[], o: GenerateOpts = {}) => {
    const s = live.current;
    const style = o.style ?? s.style;
    const aspect = o.aspect ?? s.aspect;
    const title = o.title ?? s.title;
    const subtitleText = o.subtitle ?? sub.current;
    const nextSeed = o.seed ?? newSeed();
    if (o.subtitle !== undefined) {
      sub.current = o.subtitle;
      setSubtitleState(o.subtitle);
    }
    const pages = makeStory(photos, { style, aspect, title, subtitle: subtitleText, seed: nextSeed });
    setSeed(nextSeed);
    const next = { ...s, style, aspect, title, pages, photos };
    set(next);
    // Laying out a story from nothing is not unsaved work yet; anything after it is.
    if (!s.pages.length) setBaseline(next);
    return pages.length;
  }, [set]);

  const mutate = useCallback((fn: (s: Story) => Story, key?: string) => set(fn, key), [set]);

  const setTitle = useCallback((title: string) => {
    set((s) => ({ ...replaceCoverText(s, s.title, title), title }), 'story-title');
  }, [set]);
  const setSubtitle = useCallback((text: string) => {
    const old = sub.current;
    sub.current = text;
    set((s) => replaceCoverText(s, old, text), 'story-subtitle');
    setSubtitleState(text);
  }, [set]);
  const load = useCallback((next: Story) => {
    setSubtitleState('');
    history.reset(next);
    setBaseline(next);
  }, [history]);
  const markSaved = useCallback((saved: Story) => setBaseline(saved), []);

  return { story, subtitle, seed, history, mutate, live, generate, setTitle, setSubtitle, load, dirty, markSaved };
}
