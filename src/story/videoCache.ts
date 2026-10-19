import type { VideoJob } from '../api';
import { FONTS } from './fonts';
import { elementsVisibleOnPage, findPhoto, sortByZ, visibleIndices, type Story } from './model';

/** Bump when page rendering changes in a way the page JSON does not show (drawing code, JPEG settings). */
export const FRAME_RENDER_VERSION = 1;
export const FRAME_JPEG_QUALITY = 0.92;
export const FRAME_CACHE_BYTES = 300 * 1024 * 1024;

/**
 * Everything that decides the pixels of one rendered page: the elements drawn on it (including pieces of neighbouring pages
 * that overlap it), its background, the photos' ids and sizes, the fonts used, and the frame width.
 */
export function pageSignature(story: Story, pageIndex: number, width: number): string {
  const page = story.pages[pageIndex];
  // Ids and the neighbour a piece comes from do not change a single pixel, so they stay out of the signature.
  const elements = sortByZ(elementsVisibleOnPage(story, pageIndex));
  const drawn = elements.map(({ id: _id, ghostOf: _ghost, ...rest }) => rest);
  const photos = new Map<string, { id: string; w: number; h: number }>();
  const fonts = new Set<string>();
  for (const el of elements) {
    if (el.kind === 'photo' && el.photoId) {
      const p = findPhoto(story, el.photoId);
      photos.set(el.photoId, { id: el.photoId, w: p?.width ?? 0, h: p?.height ?? 0 });
    } else if (el.kind === 'text') fonts.add(`${el.font}:${FONTS[el.font]?.stack ?? ''}`);
  }
  return JSON.stringify([FRAME_RENDER_VERSION, FRAME_JPEG_QUALITY, story.aspect, width, page?.background ?? story.background, drawn, [...photos.values()].sort((a, b) => a.id.localeCompare(b.id)), [...fonts].sort()]);
}

/** Rendered JPEG frames kept in memory, least recently used dropped first once `maxBytes` is exceeded. */
export class FrameCache {
  private map = new Map<string, Uint8Array>();
  private total = 0;
  constructor(readonly maxBytes = FRAME_CACHE_BYTES) {}

  get bytes() { return this.total; }
  get size() { return this.map.size; }
  has(key: string) { return this.map.has(key); }

  get(key: string): Uint8Array | undefined {
    const data = this.map.get(key);
    if (data) { this.map.delete(key); this.map.set(key, data); } // most recently used goes last
    return data;
  }

  set(key: string, data: Uint8Array) {
    const old = this.map.get(key);
    if (old) { this.total -= old.byteLength; this.map.delete(key); }
    if (data.byteLength > this.maxBytes) return;
    this.map.set(key, data);
    this.total += data.byteLength;
    for (const [k, v] of this.map) {
      if (this.total <= this.maxBytes || k === key) break;
      this.map.delete(k);
      this.total -= v.byteLength;
    }
  }

  clear() { this.map.clear(); this.total = 0; }
}

export type VideoPlan = Omit<VideoJob, 'output' | 'suggestedName' | 'frames'>;

/** What the main process hashes (with file sizes, modified times, encoder and pipeline version) to find a finished video. */
export function videoCacheSpec(story: Story, width: number, plan: VideoPlan) {
  const indices = visibleIndices(story);
  const pages = indices.map((i) => pageSignature(story, i, width));
  const photoIds = new Set<string>();
  const fonts = new Set<string>();
  for (const i of indices) {
    for (const el of elementsVisibleOnPage(story, i)) {
      if (el.kind === 'photo' && el.photoId) photoIds.add(el.photoId);
      else if (el.kind === 'text') fonts.add(`${el.font}:${FONTS[el.font]?.stack ?? ''}`);
    }
  }
  const photos = [...photoIds].sort().map((id) => {
    const p = findPhoto(story, id);
    return { id, path: p?.path, width: p?.width, height: p?.height };
  });
  return { width, aspect: story.aspect, pages, photos, fonts: [...fonts].sort(), video: plan, audioPath: plan.audioPath ?? null };
}
