import { api, type VideoJob } from '../api';
import { toJpeg } from '../core/canvas';
import { getBitmapForSize } from '../core/images';
import { crossesBoundary, evenPageSize, type Story } from './model';
import { renderPage, type GetBitmap, type PageCanvas } from './render';

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
  for (let i = 0; i < story.pages.length; i++) {
    check(signal);
    onProgress?.(i, story.pages.length);
    const canvas = await renderPage(story, i, width, getBitmapForSize as GetBitmap, { closeAfterDraw: true });
    check(signal);
    await sink(canvas, i);
    if ('width' in canvas) { canvas.width = 0; canvas.height = 0; }
  }
  onProgress?.(story.pages.length, story.pages.length);
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
  const digits = Math.max(2, String(story.pages.length).length);
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
  signal?: AbortSignal;
  onProgress?: Progress;
};
export const DEFAULT_PAGE_SECONDS = 3;

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
  const d = story.pages.map((p) => (Math.abs(p.duration - DEFAULT_PAGE_SECONDS) < 1e-6 ? pageSeconds : p.duration));
  return musicSeconds && musicSeconds > 0 && d.length ? fitDurations(d, musicSeconds) : d;
}

/** Transitions: 'slide' where an element crosses the seam, else the chosen one; Ken Burns off beside a slide. */
export function videoTransitions(story: Story): { transitions: ('none' | 'crossfade' | 'slide')[]; kenBurnsPages: boolean[] } {
  const n = story.pages.length;
  const transitions = Array.from({ length: Math.max(0, n - 1) }, (_, i) => (crossesBoundary(story, i) ? ('slide' as const) : story.video.transition));
  const kenBurnsPages = story.pages.map((_, i) => story.video.kenBurns && transitions[i - 1] !== 'slide' && transitions[i] !== 'slide');
  return { transitions, kenBurnsPages };
}

export async function exportVideo(story: Story, o: VideoOptions): Promise<string> {
  const { width } = evenPageSize(story.aspect, o.width);
  const frames: Uint8Array[] = [];
  await renderAll(story, width, o.signal, o.onProgress, async (canvas) => {
    frames.push(await toJpeg(canvas, 0.92));
  });
  check(o.signal);
  const durations = videoDurations(story, o.pageSeconds, o.fitToMusicSeconds);
  const v = story.video;
  const { transitions, kenBurnsPages } = videoTransitions(story);
  const shortest = Math.min(...durations);
  const job: VideoJob = {
    output: '',
    suggestedName: `${storyBaseName(story)}.mp4`,
    frames,
    durations,
    transition: v.transition,
    transitions,
    transitionSeconds: Math.min(v.transitionSeconds, shortest * 0.8),
    kenBurns: v.kenBurns,
    kenBurnsPages,
    fps: 30,
    ...(v.audioPath ? { audioPath: v.audioPath } : {}),
  };
  return api.makeVideo(job);
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

