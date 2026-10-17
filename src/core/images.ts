import { api } from '../api';
import { readOrientedSize } from './imageHeader';

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
const CONVERTED_NAME = /\.(heic|heif|tiff?)$/i;

const HEIC_BRANDS = ['heic', 'heix', 'mif1', 'msf1'];
const ascii = (b: Uint8Array, from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
/** HEIC/HEIF by content: an `ftyp` box at offset 4 whose brand is heic, heix, mif1 or msf1. Pass at least the first 12 bytes. */
export function isHeicBytes(head: Uint8Array): boolean {
  return head.length >= 12 && ascii(head, 4, 8) === 'ftyp' && HEIC_BRANDS.includes(ascii(head, 8, 12));
}
/** TIFF by content (II*\0 or MM\0*), which Chromium cannot decode either. */
export function isTiffBytes(head: Uint8Array): boolean {
  return head.length >= 4 && ((head[0] === 0x49 && head[1] === 0x49 && head[2] === 0x2a && head[3] === 0) || (head[0] === 0x4d && head[1] === 0x4d && head[2] === 0 && head[3] === 0x2a));
}
/** Name for a photo whose bytes were converted to JPEG on read (HEIC, TIFF): same name with a .jpg extension. */
export const convertedName = (name: string): string => name.replace(CONVERTED_NAME, '.jpg');
/** Whether a stored blob's name must change: it is named like a converted format but holds browser-decodable bytes. */
export async function storedName(name: string, blob: Blob): Promise<string> {
  if (!CONVERTED_NAME.test(name)) return name;
  const head = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  return isHeicBytes(head) || isTiffBytes(head) ? name : convertedName(name);
}

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
  // Photos that Chromium cannot decode (HEIC, TIFF) drop `file` on import and are converted on read by the desktop app.
  if (photo.file) return photo.file;
  if (!photo.path) throw new Error(`${photo.name} is no longer available.`);
  return new Blob([(await api.readFile(photo.path)) as BlobPart], { type: 'image/jpeg' });
}

const HEAD_BYTES = 262144;
const IMPORT_CONCURRENCY = 4;

async function describe(blob: Blob, name: string, path?: string, file?: File): Promise<Photo> {
  const [bytes, head] = await Promise.all([blob.arrayBuffer(), blob.slice(0, HEAD_BYTES).arrayBuffer()]);
  let size = readOrientedSize(new Uint8Array(head));
  if (!size) {
    const bitmap = await decode(blob);
    size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
  }
  return { id: await contentId(bytes), name, path, file, width: size.width, height: size.height };
}

/** Run `fn` over items with at most `limit` in flight; results keep input order. */
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

async function collect(items: { name: string; run: () => Promise<Photo> }[]): Promise<ImportResult> {
  const settled = await mapLimit(items, IMPORT_CONCURRENCY, async (item) => {
    try {
      return { photo: await item.run(), failed: undefined };
    } catch (error) {
      return { photo: undefined, failed: { name: item.name, error: errorText(error) } };
    }
  });
  const result: ImportResult = { photos: [], failed: [] };
  for (const s of settled) {
    if (s.photo) result.photos.push(s.photo);
    else if (s.failed) result.failed.push(s.failed);
  }
  return result;
}

export function importFromFiles(files: File[]): Promise<ImportResult> {
  return collect(
    files.filter(isImageFile).map((file) => ({
      name: file.name,
      run: async () => {
        const path = api.pathForFile(file) || undefined;
        const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
        const convert = isHeicBytes(head) || isTiffBytes(head);
        if (convert && !path) throw new Error('HEIC and TIFF photos can only be opened in the desktop app.');
        const blob = convert && path ? new Blob([(await api.readFile(path)) as BlobPart], { type: 'image/jpeg' }) : file;
        const photo = await describe(blob, file.name, path, file);
        if (convert) delete photo.file;
        return photo;
      },
    })),
  );
}

export function importFromPaths(paths: string[]): Promise<ImportResult> {
  return collect(
    paths.map((path) => ({
      name: baseName(path),
      run: async () => describe(new Blob([(await api.readFile(path)) as BlobPart]), baseName(path), path),
    })),
  );
}

/* Preview bitmaps: bounded LRU, long edge <= PREVIEW_EDGE. */
const previews = new Map<string, ImageBitmap>();
const pending = new Map<string, Promise<ImageBitmap>>();

/** Oriented bitmap at most `edge` on the long edge, decoded straight to that size (never upscaled). */
async function decodeAtEdge(photo: Photo, edge: number): Promise<ImageBitmap> {
  const blob = await sourceBlob(photo);
  const size = sizeForEdge(photo.width, photo.height, edge);
  if (size.width === photo.width && size.height === photo.height) return decode(blob);
  return createImageBitmap(blob, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high', imageOrientation: 'from-image' });
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
      const bitmap = await decodeAtEdge(photo, PREVIEW_EDGE);
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

/** Size to decode a photo at so its long edge is `maxEdge`: aspect kept, never upscaled. */
export function sizeForEdge(width: number, height: number, maxEdge: number): { width: number; height: number } {
  const long = Math.max(width, height);
  if (!(maxEdge > 0) || maxEdge >= long) return { width, height };
  const k = maxEdge / long;
  return { width: Math.max(1, Math.round(width * k)), height: Math.max(1, Math.round(height * k)) };
}

/** Oriented bitmap whose long edge is at most `maxEdge` px (decoded straight to that size, so a big original is never held in full). The caller must close() it. */
export const getBitmapForSize = decodeAtEdge;

/* Thumbnails: long edge 240, kept as object URLs for the life of the page. */
const thumbs = new Map<string, Promise<string>>();

export function getThumbnailUrl(photo: Photo): Promise<string> {
  let job = thumbs.get(photo.id);
  if (!job) {
    job = (async () => {
      const bitmap = await decodeAtEdge(photo, THUMB_EDGE);
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
