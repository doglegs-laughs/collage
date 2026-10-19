import { api, type BeatAnalysis } from '../api';
import { beatDurations, beatLoopSeconds } from './beatTiming';
import { boundaryTransitionSeconds, computeTimeline, defaultBoundaries, DEFAULT_PAGE_SECONDS } from './timeline';
import { toJpeg } from '../core/canvas';
import { getBitmapForSize } from '../core/images';
import { evenPageSize, visibleIndices, visiblePages, type Story } from './model';
import { renderPage, type GetBitmap, type PageCanvas } from './render';
import { FRAME_JPEG_QUALITY, FrameCache, pageSignature, videoCacheSpec, type VideoPlan } from './videoCache';

export type Progress = (done: number, total: number) => void;

export const abortError = () => new DOMException('Export cancelled', 'AbortError');
export const isAbort = (e: unknown): boolean => {
  const err = e as { name?: string; message?: string } | null;
  return err?.name === 'AbortError' || /cancel+ed/i.test(err?.message ?? '');
};
const check = (signal?: AbortSignal) => {
  if (signal?.aborted) throw abortError();
};

/** Render each page, handing it to `sink` and releasing the canvas afterwards. Photos are decoded one element at a time at the size that element needs. */
async function renderAll(story: Story, width: number, signal: AbortSignal | undefined, onProgress: Progress | undefined, sink: (canvas: PageCanvas, i: number) => Promise<void>) {
  const indices = visibleIndices(story); // hidden pages are skipped; `sink` gets the position in the exported sequence
  for (let k = 0; k < indices.length; k++) {
    check(signal);
    onProgress?.(k, indices.length);
    const canvas = await renderPage(story, indices[k], width, getBitmapForSize as GetBitmap, { closeAfterDraw: true });
    check(signal);
    await sink(canvas, k);
    if ('width' in canvas) { canvas.width = 0; canvas.height = 0; }
  }
  onProgress?.(indices.length, indices.length);
}

const sanitize = (s: string) => s.replace(/[\\/:*?"<>|\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim();
export const storyBaseName = (story: Story) => sanitize(story.title) || 'Story';
const joinPath = (dir: string, name: string) => `${dir}${dir.includes('\\') && !dir.includes('/') ? '\\' : '/'}${name}`;

/** `<Title> 01.jpg`, or `<Title> 01 2.jpg`, `... 3.jpg` when taken. */
export async function freeName(dir: string, base: string, ext: string): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const path = joinPath(dir, n === 1 ? `${base}.${ext}` : `${base} ${n}.${ext}`);
    if (!(await api.exists(path))) return path;
  }
  throw new Error('Could not find a free file name.');
}

export type ImagesResult = { folder: string; files: string[] };
export async function exportImages(story: Story, o: { folder: string; width: number; signal?: AbortSignal; onProgress?: Progress }): Promise<ImagesResult> {
  const digits = Math.max(2, String(visibleIndices(story).length).length);
  const base = storyBaseName(story);
  const files: string[] = [];
  await renderAll(story, o.width, o.signal, o.onProgress, async (canvas, i) => {
    const data = await toJpeg(canvas, 0.95);
    const path = await freeName(o.folder, `${base} ${String(i + 1).padStart(digits, '0')}`, 'jpg');
    await api.writeFile(path, data);
    files.push(path);
  });
  return { folder: o.folder, files };
}

export type VideoOptions = {
  width: number;
  /** Seconds applied to pages whose own duration is still the default (3 s). */
  pageSeconds: number;
  fitToMusicSeconds?: number | null;
  beatSync?: { analysis: BeatAnalysis; beatsPerPage: number };
  signal?: AbortSignal;
  onProgress?: Progress;
  /** Called when an identical video was already made, so nothing is rendered or encoded. */
  onCached?: () => void;
};
export { boundaryTransitionSeconds, DEFAULT_PAGE_SECONDS };

/**
 * Scale page durations so they add up to at most `musicSeconds`. Pages are laid end to end
 * (transitions overlap inside a page's own time), so the video length is exactly the sum of the durations.
 * Rounded down to 10 ms so rounding can never push the video past the song.
 */
export function fitDurations(durations: number[], musicSeconds: number): number[] {
  const sum = durations.reduce((a, b) => a + b, 0);
  if (!(musicSeconds > 0) || !(sum > 0)) return durations;
  const scale = musicSeconds / sum;
  return durations.map((x) => Math.max(0.01, Math.floor(x * scale * 100 + 1e-9) / 100));
}

/** Per-page durations: individual overrides win, the rest take `pageSeconds`; optionally stretched to fill the music. */
export function videoDurations(story: Story, pageSeconds: number, musicSeconds?: number | null): number[] {
  const d = visiblePages(story).map((p) => (Math.abs(p.duration - DEFAULT_PAGE_SECONDS) < 1e-6 ? pageSeconds : p.duration));
  return musicSeconds && musicSeconds > 0 && d.length ? fitDurations(d, musicSeconds) : d;
}

/**
 * Transitions: 'slide' where an element crosses the seam, else the chosen one; Ken Burns off beside a slide.
 * With beat sync and no transition chosen, seams cut like every other boundary (the slide only returns when the user picks crossfade).
 */
export function videoTransitions(story: Story, beatSync = false): { transitions: ('none' | 'crossfade' | 'slide')[]; kenBurnsPages: boolean[] } {
  return transitionPlan(story, defaultBoundaries(story, beatSync));
}

/** Ken Burns is off for a page beside a slide, whatever the transitions came from. */
function transitionPlan(story: Story, transitions: ('none' | 'crossfade' | 'slide')[]) {
  const kenBurnsPages = visibleIndices(story).map((_, i) => story.video.kenBurns && transitions[i - 1] !== 'slide' && transitions[i] !== 'slide');
  return { transitions, kenBurnsPages };
}

/** Frames of the pages for a video, reusing the ones rendered before for a page that has not changed since. */
export const frameCache = new FrameCache();

async function renderFrames(story: Story, width: number, signal: AbortSignal | undefined, onProgress: Progress | undefined): Promise<Uint8Array[]> {
  const indices = visibleIndices(story);
  const frames: Uint8Array[] = [];
  for (let k = 0; k < indices.length; k++) {
    check(signal);
    onProgress?.(k, indices.length);
    const sig = pageSignature(story, indices[k], width);
    let frame = frameCache.get(sig);
    if (!frame) {
      const canvas = await renderPage(story, indices[k], width, getBitmapForSize as GetBitmap, { closeAfterDraw: true });
      check(signal);
      frame = await toJpeg(canvas, FRAME_JPEG_QUALITY);
      if ('width' in canvas) { canvas.width = 0; canvas.height = 0; }
      frameCache.set(sig, frame);
    }
    frames.push(frame);
  }
  onProgress?.(indices.length, indices.length);
  return frames;
}

/** Everything about the video except its frames: timing, transitions, Ken Burns, music. */
export function videoPlan(story: Story, o: Pick<VideoOptions, 'pageSeconds' | 'fitToMusicSeconds' | 'beatSync'>): VideoPlan {
  const v = story.video;
  const beatSync = o.beatSync;
  // With a timeline (manual lengths, transition overrides, audio start) the timeline engine decides everything about timing.
  const tl = v.timeline ? computeTimeline(story, { analysis: beatSync?.analysis, beatsPerPage: beatSync?.beatsPerPage, pageSeconds: o.pageSeconds }) : null;
  const durations = tl
    ? tl.clips.map((c) => c.duration)
    : beatSync ? beatDurations(visibleIndices(story).length, beatSync.analysis, beatSync.beatsPerPage) : videoDurations(story, o.pageSeconds, o.fitToMusicSeconds);
  const { transitions, kenBurnsPages } = tl ? transitionPlan(story, tl.boundaries.map((b) => b.transition)) : videoTransitions(story, !!beatSync);
  const perBoundary = boundaryTransitionSeconds(durations, v.transitionSeconds);
  const audioStart = v.audioPath && v.timeline ? v.timeline.audioOffset : 0;
  return {
    durations,
    transition: v.transition,
    transitions,
    transitionSeconds: Math.min(v.transitionSeconds, ...perBoundary),
    transitionDurations: perBoundary,
    kenBurns: v.kenBurns,
    kenBurnsPages,
    fps: 30,
    ...(v.audioPath ? { audioPath: v.audioPath } : {}),
    ...(audioStart > 0 ? { audioStartSeconds: audioStart } : {}),
    ...(beatSync ? { beatSync: true, audioLoopSeconds: beatLoopSeconds(beatSync.analysis, beatSync.beatsPerPage) } : {}),
  };
}

/** Resolves to where the video was saved ('' when the user cancelled) and whether an earlier identical video was reused. */
export async function exportVideo(story: Story, o: VideoOptions): Promise<{ path: string; cached: boolean }> {
  const { width } = evenPageSize(story.aspect, o.width);
  const plan = videoPlan(story, o);
  const suggestedName = `${storyBaseName(story)}.mp4`;
  let lookup: { key: string | null; hit: boolean } = { key: null, hit: false };
  try { lookup = await api.videoCacheLookup(videoCacheSpec(story, width, plan)); } catch { /* the cache is optional */ }
  if (lookup.key && lookup.hit) {
    o.onCached?.();
    try {
      return { path: await api.makeVideo({ ...plan, output: '', suggestedName, frames: [], cacheKey: lookup.key }), cached: true };
    } catch (e) {
      if (!/VIDEO_CACHE_MISS/.test(e instanceof Error ? e.message : '')) throw e; // evicted since the lookup: render it after all
    }
  }
  const frames = await renderFrames(story, width, o.signal, o.onProgress);
  check(o.signal);
  return { path: await api.makeVideo({ ...plan, output: '', suggestedName, frames, ...(lookup.key ? { cacheKey: lookup.key } : {}) }), cached: false };
}

/** Duration of an audio file in seconds, or null when it cannot be read. */
export function audioDuration(path: string): Promise<number | null> {
  return new Promise((resolve) => {
    const url = encodeURI(`file://${path.startsWith('/') ? '' : '/'}${path.replace(/\\/g, '/')}`).replace(/#/g, '%23').replace(/\?/g, '%3F');
    const audio = new Audio();
    const done = (v: number | null) => {
      window.clearTimeout(timer);
      audio.removeAttribute('src');
      audio.load();
      resolve(v);
    };
    const timer = window.setTimeout(() => done(null), 5000);
    audio.preload = 'metadata';
    audio.onloadedmetadata = () => done(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    audio.onerror = () => done(null);
    audio.src = url;
  });
}

