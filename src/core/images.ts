import { api } from '../api';
import { drawSmooth } from './canvas';

export type Photo = {
  id: string;
  name: string;
  path?: string;
  file?: File;
  /** Oriented (EXIF applied) pixel size. */
  width: number;
  height: number;
};

export type ImportResult = { photos: Photo[]; failed: { name: string; error: string }[] };

export const PREVIEW_EDGE = 2048;
const THUMB_EDGE = 240;
const CACHE_LIMIT = 24;
const IMAGE_NAME = /\.(jpe?g|png|webp|gif|tiff?|heic|heif|avif|bmp)$/i;
const HEIC_NAME = /\.(heic|heif)$/i;

export const isImageFile = (file: { name: string; type?: string }) => !!file.type?.startsWith('image/') || IMAGE_NAME.test(file.name);
const baseName = (p: string) => p.split(/[\\/]/).pop() || p;

async function contentId(bytes: ArrayBuffer): Promise<string> {
  if (globalThis.crypto?.subtle) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    return [...digest.slice(0, 8)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let hash = 0x811c9dc5;
  const view = new Uint8Array(bytes);
  for (let i = 0; i < view.length; i += Math.max(1, view.length >> 16)) hash = Math.imul(hash ^ view[i], 0x01000193) >>> 0;
  return `k${hash.toString(16).padStart(8, '0')}${view.length.toString(16)}`;
}

const decode = (blob: Blob) => createImageBitmap(blob, { imageOrientation: 'from-image' });

async function sourceBlob(photo: Photo): Promise<Blob> {
  // Chromium cannot decode HEIC; the desktop app converts it on read.
  if (photo.file && !(photo.path && HEIC_NAME.test(photo.name))) return photo.file;
  if (!photo.path) throw new Error(`${photo.name} is no longer available.`);
  return new Blob([(await api.readFile(photo.path)) as BlobPart], { type: 'image/jpeg' });
}

async function describe(blob: Blob, name: string, path?: string, file?: File): Promise<Photo> {
  const bytes = await blob.arrayBuffer();
  const bitmap = await decode(blob);
  try {
    return { id: await contentId(bytes), name, path, file, width: bitmap.width, height: bitmap.height };
  } finally {
    bitmap.close();
  }
}

export async function importFromFiles(files: File[]): Promise<ImportResult> {
  const result: ImportResult = { photos: [], failed: [] };
  for (const file of files.filter(isImageFile)) {
    try {
      const path = api.pathForFile(file) || undefined;
      const heic = HEIC_NAME.test(file.name);
      if (heic && !path) throw new Error('HEIC photos can only be opened in the desktop app.');
      const blob = heic && path ? new Blob([(await api.readFile(path)) as BlobPart], { type: 'image/jpeg' }) : file;
      const photo = await describe(blob, file.name, path, file);
      if (heic) delete photo.file;
      result.photos.push(photo);
    } catch (error) {
      result.failed.push({ name: file.name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

export async function importFromPaths(paths: string[]): Promise<ImportResult> {
  const result: ImportResult = { photos: [], failed: [] };
  for (const path of paths) {
    const name = baseName(path);
    try {
      result.photos.push(await describe(new Blob([(await api.readFile(path)) as BlobPart]), name, path));
    } catch (error) {
      result.failed.push({ name, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}

/* Preview bitmaps: bounded LRU, long edge <= PREVIEW_EDGE. */
const previews = new Map<string, ImageBitmap>();
const pending = new Map<string, Promise<ImageBitmap>>();

async function downscale(full: ImageBitmap, edge: number): Promise<ImageBitmap> {
  const long = Math.max(full.width, full.height);
  if (long <= edge) return full;
  const k = edge / long;
  const w = Math.max(1, Math.round(full.width * k));
  const h = Math.max(1, Math.round(full.height * k));
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h });
  drawSmooth(canvas.getContext('2d')!, full, { left: 0, top: 0, w: full.width, h: full.height }, 0, 0, w, h);
  full.close();
  const out = await createImageBitmap(canvas);
  canvas.width = canvas.height = 0;
  return out;
}

/** Bitmap for on-screen drawing; do not close it, the cache owns it. Its size may be smaller than photo.width x height. */
export function getPreviewBitmap(photo: Photo): Promise<ImageBitmap> {
  const hit = previews.get(photo.id);
  if (hit) {
    previews.delete(photo.id);
    previews.set(photo.id, hit);
    return Promise.resolve(hit);
  }
  let job = pending.get(photo.id);
  if (!job) {
    job = (async () => {
      const bitmap = await downscale(await decode(await sourceBlob(photo)), PREVIEW_EDGE);
      previews.set(photo.id, bitmap);
      while (previews.size > CACHE_LIMIT) {
        const [oldest] = previews.keys();
        previews.get(oldest)?.close();
        previews.delete(oldest);
      }
      return bitmap;
    })().finally(() => pending.delete(photo.id));
    pending.set(photo.id, job);
  }
  return job;
}

/** Full-resolution oriented bitmap for export. The caller must close() it. */
export async function getFullBitmap(photo: Photo): Promise<ImageBitmap> {
  return decode(await sourceBlob(photo));
}

/* Thumbnails: long edge 240, kept as object URLs for the life of the page. */
const thumbs = new Map<string, Promise<string>>();

export function getThumbnailUrl(photo: Photo): Promise<string> {
  let job = thumbs.get(photo.id);
  if (!job) {
    job = (async () => {
      const full = await decode(await sourceBlob(photo));
      const bitmap = await downscale(full, THUMB_EDGE);
      const canvas = Object.assign(document.createElement('canvas'), { width: bitmap.width, height: bitmap.height });
      canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
      bitmap.close();
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.82));
      if (!blob) throw new Error('Thumbnail failed');
      return URL.createObjectURL(blob);
    })();
    job.catch(() => thumbs.delete(photo.id));
    thumbs.set(photo.id, job);
  }
  return job;
}

/* Object URL of the original (EXIF-aware when shown in <img>), for large on-screen display. */
const objectUrls = new Map<string, Promise<string>>();

export function getObjectUrl(photo: Photo): Promise<string> {
  let job = objectUrls.get(photo.id);
  if (!job) {
    job = sourceBlob(photo).then((b) => URL.createObjectURL(b));
    job.catch(() => objectUrls.delete(photo.id));
    objectUrls.set(photo.id, job);
  }
  return job;
}

/** Free cached bitmaps and URLs for a photo that has left the library. */
export function releasePhoto(id: string) {
  previews.get(id)?.close();
  previews.delete(id);
  for (const cache of [thumbs, objectUrls]) {
    cache.get(id)?.then((url) => URL.revokeObjectURL(url), () => {});
    cache.delete(id);
  }
}
