import type { BeatAnalysis } from '../api';
import { beatClock, MIN_BEAT_PAGE_SECONDS } from './beatTiming';
import { crossesBoundary, MAX_CLIP_SECONDS, MIN_CLIP_SECONDS, visibleIndices, type BoundaryTransition, type Story, type Timeline } from './model';

export const DEFAULT_PAGE_SECONDS = 3;
export const TIMELINE_FPS = 30;

export type TimelineClip = { pageId: string; /** Index in `story.pages`. */ pageIndex: number; start: number; duration: number; locked: boolean };
export type TimelineBoundary = {
  afterPageId: string;
  transition: BoundaryTransition;
  /** Fade length if this boundary fades: the story's transition length, capped at 80% of the shorter neighbour. Also set (and unused) for cuts. */
  seconds: number;
  /** True when `Timeline.transitions` overrides the default for this boundary. */
  overridden: boolean;
};
export type ComputedTimeline = { clips: TimelineClip[]; boundaries: TimelineBoundary[]; total: number };
export type TimelineOptions = {
  /** Beat analysis of the music; when present, unlocked clips follow the beats. */
  analysis?: BeatAnalysis;
  beatsPerPage?: number;
  /** Seconds for pages whose own duration is still the default (3 s), as in the video dialog. */
  pageSeconds?: number;
  /** Used where a boundary has no override. Defaults to the story's own transition. */
  defaultTransition?: 'none' | 'crossfade';
  fps?: number;
};

/**
 * Transition at each boundary of the visible pages when nothing overrides it: 'slide' where an element crosses the seam,
 * else the chosen one. With beat sync and no transition chosen, seams cut like every other boundary.
 */
export function defaultBoundaries(story: Story, beatSync = false, chosen: 'none' | 'crossfade' = story.video.transition): BoundaryTransition[] {
  const idx = visibleIndices(story);
  const cuts = beatSync && chosen === 'none';
  // A seam only slides when its two pages are neighbours in the story; a hidden page between them makes it an ordinary cut.
  return Array.from({ length: Math.max(0, idx.length - 1) }, (_, k) => (!cuts && idx[k + 1] === idx[k] + 1 && crossesBoundary(story, idx[k]) ? 'slide' : chosen));
}

/** Crossfade length for each page boundary: the chosen length, capped by 80% of the shorter adjacent page. */
export function boundaryTransitionSeconds(durations: number[], seconds: number): number[] {
  return durations.slice(1).map((d, i) => Math.min(seconds, Math.min(durations[i], d) * 0.8));
}

const clampClip = (s: number) => Math.min(MAX_CLIP_SECONDS, Math.max(MIN_CLIP_SECONDS, s));

/**
 * Where every visible page starts and how long it lasts.
 * Locked clips keep their manual length. Unlocked clips follow the beats (when `analysis` is given, honouring the audio offset:
 * beats before it are ignored and the rest shift to start at 0), otherwise they take the page's own duration.
 * Hidden pages are skipped. The video is exactly `total` seconds long.
 */
export function computeTimeline(story: Story, o: TimelineOptions = {}): ComputedTimeline {
  const tl = story.video.timeline;
  const fps = o.fps ?? TIMELINE_FPS;
  const idx = visibleIndices(story);
  const bpp = o.beatsPerPage ?? story.video.beatsPerPage;
  const clock = o.analysis ? beatClock(o.analysis, bpp, tl?.audioOffset ?? 0) : null;
  const minFrames = Math.max(1, Math.ceil(MIN_BEAT_PAGE_SECONDS * fps - 1e-9));
  const clips: TimelineClip[] = [];
  let t = 0;
  for (const pageIndex of idx) {
    const page = story.pages[pageIndex];
    const lock = tl?.locked[page.id];
    let duration: number;
    if (lock !== undefined) duration = clampClip(lock);
    else if (clock) {
      let beat = clock.indexAtOrAfter(t, 0.5 / fps) + bpp;
      let end = Math.round(clock.at(beat) * fps);
      while (end - t * fps < minFrames - 1e-9) end = Math.round(clock.at(++beat) * fps);
      duration = Math.round((end / fps - t) * 1e9) / 1e9; // undo float drift from the running sum
    } else duration = Math.abs(page.duration - DEFAULT_PAGE_SECONDS) < 1e-6 && o.pageSeconds !== undefined ? o.pageSeconds : page.duration;
    clips.push({ pageId: page.id, pageIndex, start: t, duration, locked: lock !== undefined });
    t += duration;
  }
  const chosen = o.defaultTransition ?? story.video.transition;
  const defaults = defaultBoundaries(story, !!clock, chosen);
  const fades = boundaryTransitionSeconds(clips.map((c) => c.duration), story.video.transitionSeconds);
  const boundaries: TimelineBoundary[] = fades.map((seconds, k) => {
    const id = clips[k].pageId;
    const override = tl?.transitions[id];
    return { afterPageId: id, transition: override ?? defaults[k], seconds, overridden: override !== undefined };
  });
  return { clips, boundaries, total: t };
}

/** Index of the clip playing at video time `t` (the last one at or past the end). */
export function clipAtTime(tl: ComputedTimeline, t: number): number {
  for (let i = 0; i < tl.clips.length; i++) if (t < tl.clips[i].start + tl.clips[i].duration - 1e-9) return i;
  return Math.max(0, tl.clips.length - 1);
}

/* ---------- editing (pure; every function returns a new story) ---------- */

const isEmpty = (t: Timeline) => t.audioOffset === 0 && !Object.keys(t.locked).length && !Object.keys(t.transitions).length;

/** Apply `fn` to the story's timeline (created on demand); a timeline left with nothing in it is removed again. */
export function editTimeline(story: Story, fn: (t: Timeline) => Timeline): Story {
  const next = fn({ audioOffset: 0, locked: {}, transitions: {}, ...story.video.timeline });
  const { timeline: _old, ...video } = story.video;
  void _old;
  return { ...story, video: isEmpty(next) ? video : { ...video, timeline: next } };
}

export const lockClip = (story: Story, pageId: string, seconds: number): Story =>
  editTimeline(story, (t) => ({ ...t, locked: { ...t.locked, [pageId]: Math.round(clampClip(seconds) * 1000) / 1000 } }));

export const unlockClip = (story: Story, pageId: string): Story =>
  editTimeline(story, (t) => {
    const { [pageId]: _gone, ...locked } = t.locked;
    void _gone;
    return { ...t, locked };
  });

/** Unlock the clip of `pageId` and every later page so they follow the beats (or page durations) again. */
export function resyncFrom(story: Story, pageId: string): Story {
  const from = story.pages.findIndex((p) => p.id === pageId);
  if (from < 0) return story;
  const later = new Set(story.pages.slice(from).map((p) => p.id));
  return editTimeline(story, (t) => ({ ...t, locked: Object.fromEntries(Object.entries(t.locked).filter(([id]) => !later.has(id))) }));
}

/** Override the transition after `pageId`; passing the default (or null) removes the override. */
export function setBoundaryTransition(story: Story, pageId: string, kind: BoundaryTransition | null, defaultKind?: BoundaryTransition): Story {
  return editTimeline(story, (t) => {
    const { [pageId]: _gone, ...rest } = t.transitions;
    void _gone;
    return { ...t, transitions: kind === null || kind === defaultKind ? rest : { ...rest, [pageId]: kind } };
  });
}

export const setAudioOffset = (story: Story, seconds: number): Story =>
  editTimeline(story, (t) => ({ ...t, audioOffset: Math.max(0, Math.round(seconds * 1000) / 1000) }));
