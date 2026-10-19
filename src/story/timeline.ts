import type { BeatAnalysis } from '../api';
import { beatClock, beatLoopSeconds, hasBeats, MIN_BEAT_PAGE_SECONDS } from './beatTiming';
import { crossesBoundary, MAX_CLIP_SECONDS, MIN_CLIP_SECONDS, timelineIsEmpty, visibleIndices, type BoundaryTransition, type Story, type Timeline, type VideoSettings } from './model';

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
  /**
   * Fit to music: length of the song. Unlocked clips (without beat sync) are scaled down together so the video is at most that long;
   * locked clips keep their length. Ignored when the locked clips alone already fill the song.
   */
  fitToMusicSeconds?: number | null;
};

/** What the video dialog decides besides the story itself. Everything has a story-level default, so panel and export agree. */
export type DialogSettings = {
  /** Overrides `story.video.pageSeconds`. */
  pageSeconds?: number;
  /** Present when beat sync is on and the music was analysed. */
  beatSync?: { analysis: BeatAnalysis; beatsPerPage: number };
  /** Length of the music when fit to music is wanted and known. */
  fitToMusicSeconds?: number | null;
};

/** Fit to music applies when it is on, there is music, and photo changes are not already following the beats. */
export const fitToMusicApplies = (video: Pick<VideoSettings, 'fitToMusic' | 'audioPath'>, beatSync: boolean): boolean => video.fitToMusic && !!video.audioPath && !beatSync;

/**
 * The single place that turns a story plus the video dialog's choices into timeline options. The Timeline panel and the export
 * both call it, so they always show and make the same video (seconds per page, beat sync, fit to music).
 */
export function timelineOptions(story: Story, d: DialogSettings = {}): TimelineOptions {
  const v = story.video;
  const beat = d.beatSync;
  return {
    pageSeconds: d.pageSeconds ?? v.pageSeconds ?? DEFAULT_PAGE_SECONDS,
    ...(beat ? { analysis: beat.analysis, beatsPerPage: beat.beatsPerPage } : {}),
    ...(!beat && fitToMusicApplies(v, false) && d.fitToMusicSeconds && d.fitToMusicSeconds > 0 ? { fitToMusicSeconds: d.fitToMusicSeconds } : {}),
  };
}

/** Where the music repeats in the preview and the export: the beat grid's loop with beat sync, else the end of the file (null = ask the audio element). */
export function musicLoopSeconds(analysis: BeatAnalysis | undefined, beatsPerPage: number, beatSync: boolean): number | null {
  if (beatSync && hasBeats(analysis)) return beatLoopSeconds(analysis, beatsPerPage);
  return analysis && analysis.duration > 0 ? analysis.duration : null;
}

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

export const clampClip = (s: number) => Math.min(MAX_CLIP_SECONDS, Math.max(MIN_CLIP_SECONDS, s));
/** `seconds` rounded to a whole number of frames, so the exporter's per-page frame rounding never drifts from the timeline. */
export const snapToFrames = (seconds: number, fps = TIMELINE_FPS): number => Math.round(seconds * fps) / fps;

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
  // Fit to music: scale the unlocked clips so everything adds up to the song (locked ones keep their length).
  let fit = 1;
  if (!clock && o.fitToMusicSeconds && o.fitToMusicSeconds > 0) {
    let fixed = 0, free = 0;
    for (const pageIndex of idx) {
      const page = story.pages[pageIndex];
      const lock = tl?.locked[page.id];
      if (lock !== undefined) fixed += snapToFrames(clampClip(lock), fps);
      else free += Math.abs(page.duration - DEFAULT_PAGE_SECONDS) < 1e-6 && o.pageSeconds !== undefined ? o.pageSeconds : page.duration;
    }
    const room = o.fitToMusicSeconds - fixed;
    if (free > 0 && room > 0) fit = room / free;
  }
  let t = 0;
  for (const pageIndex of idx) {
    const page = story.pages[pageIndex];
    const lock = tl?.locked[page.id];
    let duration: number;
    if (lock !== undefined) duration = snapToFrames(clampClip(lock), fps);
    else if (clock) {
      let beat = clock.indexAtOrAfter(t, 0.5 / fps) + bpp;
      let end = Math.round(clock.at(beat) * fps);
      while (end - t * fps < minFrames - 1e-9) end = Math.round(clock.at(++beat) * fps);
      duration = Math.round((end / fps - t) * 1e9) / 1e9; // undo float drift from the running sum
    } else {
      duration = Math.abs(page.duration - DEFAULT_PAGE_SECONDS) < 1e-6 && o.pageSeconds !== undefined ? o.pageSeconds : page.duration;
      if (fit !== 1) duration = Math.max(1, Math.floor(duration * fit * fps + 1e-9)) / fps; // whole frames, rounded down so the video never outlasts the song
    }
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


/** Apply `fn` to the story's timeline (created on demand); a timeline left with nothing in it is removed again. */
export function editTimeline(story: Story, fn: (t: Timeline) => Timeline): Story {
  const next = fn({ audioOffset: 0, locked: {}, transitions: {}, ...story.video.timeline });
  const { timeline: _old, ...video } = story.video;
  void _old;
  return { ...story, video: timelineIsEmpty(next) ? video : { ...video, timeline: next } };
}

export const lockClip = (story: Story, pageId: string, seconds: number): Story =>
  editTimeline(story, (t) => ({ ...t, locked: { ...t.locked, [pageId]: snapToFrames(clampClip(seconds)) } }));

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

/** Remove every manual length, transition override and music start. */
export const resetTimeline = (story: Story): Story => editTimeline(story, () => ({ audioOffset: 0, locked: {}, transitions: {} }));

/**
 * Change video settings. Choosing different music (or none) forgets the music start, which belonged to the old song;
 * a timeline left with nothing in it is removed. One call is one undo step.
 */
export function patchVideo(story: Story, patch: Partial<VideoSettings>): Story {
  const next: Story = { ...story, video: { ...story.video, ...patch } };
  return 'audioPath' in patch && patch.audioPath !== story.video.audioPath ? editTimeline(next, (t) => ({ ...t, audioOffset: 0 })) : next;
}
