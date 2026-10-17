import { api, type VideoJob } from '../api';
import { toJpeg } from '../core/canvas';
import { getFullBitmap, type Photo } from '../core/images';
import { crossesBoundary, evenPageSize, type Story } from './model';
import { renderPage, type PageCanvas } from './render';

export type Progress = (done: number, total: number) => void;

export const abortError = () => new DOMException('Export cancelled', 'AbortError');
export const isAbort = (e: unknown): boolean => {
  const err = e as { name?: string; message?: string } | null;
  return err?.name === 'AbortError' || /cancel+ed/i.test(err?.message ?? '');
};
const check = (signal?: AbortSignal) => {
  if (signal?.aborted) throw abortError();
};

const photoIdsOnPage = (story: Story, i: number): Set<string> => {
  const ids = new Set<string>();
  const here = story.pages[i];
  if (!here) return ids;
  story.pages.forEach((p, j) => {
    for (const el of p.elements) {
      if (el.kind !== 'photo' || !el.photoId) continue;
      const x = el.x + (j - i);
      if (j === i || (x < 1 && x + el.w > 0)) ids.add(el.photoId);
    }
  });
  return ids;
};

/** Full-resolution bitmaps for export, kept only while the next page still needs them. */
export function makeBitmapCache() {
  const bitmaps = new Map<string, Promise<ImageBitmap>>();
  return {
    get: (photo: Photo) => {
      let b = bitmaps.get(photo.id);
      if (!b) {
        b = getFullBitmap(photo);
        bitmaps.set(photo.id, b);
      }
      return b;
    },
    /** Close every bitmap not in `keep`. */
    async prune(keep: Set<string>) {
      for (const [id, b] of [...bitmaps]) {
        if (keep.has(id)) continue;
        bitmaps.delete(id);
        (await b.catch(() => null))?.close();
      }
    },
    closeAll: () => (async function () {
      for (const b of bitmaps.values()) (await b.catch(() => null))?.close();
      bitmaps.clear();
    })(),
  };
}

/** Render each page, handing it to `sink` and releasing the canvas and unneeded bitmaps afterwards. */
async function renderAll(story: Story, width: number, signal: AbortSignal | undefined, onProgress: Progress | undefined, sink: (canvas: PageCanvas, i: number) => Promise<void>) {
  const cache = makeBitmapCache();
  try {
    for (let i = 0; i < story.pages.length; i++) {
      check(signal);
      onProgress?.(i, story.pages.length);
      const canvas = await renderPage(story, i, width, cache.get);
      check(signal);
      await sink(canvas, i);
      if ('width' in canvas) { canvas.width = 0; canvas.height = 0; }
      await cache.prune(photoIdsOnPage(story, i + 1));
    }
    onProgress?.(story.pages.length, story.pages.length);
  } finally {
    await cache.closeAll();
  }
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

/** Per-page durations: individual overrides win, the rest take `pageSeconds`; optionally stretched to fill the music. */
export function videoDurations(story: Story, pageSeconds: number, musicSeconds?: number | null): number[] {
  const { transition, transitionSeconds } = story.video;
  let d = story.pages.map((p) => (Math.abs(p.duration - DEFAULT_PAGE_SECONDS) < 1e-6 ? pageSeconds : p.duration));
  if (musicSeconds && musicSeconds > 0 && d.length) {
    const boundaries = d.length - 1;
    const overlap = boundaries * (transition === 'none' ? 0 : transitionSeconds);
    const sum = d.reduce((a, b) => a + b, 0);
    const scale = (musicSeconds + overlap) / sum;
    d = d.map((x) => Math.max(1, Math.round(x * scale * 100) / 100));
  }
  return d;
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
    frames,
    durations,
    transition: v.transition,
    transitions,
    transitionSeconds: Math.max(0.1, Math.min(v.transitionSeconds, shortest * 0.8)),
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

