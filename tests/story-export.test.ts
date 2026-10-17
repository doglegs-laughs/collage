import { describe, expect, it } from 'vitest';
import { fitDurations, videoDurations } from '../src/story/exportStory';
import { addPage, deserializeStory, emptyPage, emptyStory, serializeStory } from '../src/story/model';
import { convertedName, isHeicBytes, isTiffBytes, sizeForEdge, storedName } from '../src/core/images';
import { photosNeedingSidecar, resolvePhotoPath } from '../src/story/useProject';

const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe('fit to music', () => {
  it('makes the video exactly as long as the song (never longer)', () => {
    const d = fitDurations([3, 3, 3, 3], 20);
    expect(sum(d)).toBeLessThanOrEqual(20 + 1e-9);
    expect(sum(d)).toBeGreaterThan(19.9);
    expect(d).toEqual([5, 5, 5, 5]);
  });
  it('shrinks pages below one second instead of overshooting', () => {
    const d = fitDurations(Array(30).fill(3), 12);
    expect(sum(d)).toBeLessThanOrEqual(12 + 1e-9);
    expect(Math.min(...d)).toBeGreaterThan(0);
  });
  it('keeps the ratio between pages and ignores nonsense', () => {
    const d = fitDurations([2, 6], 4);
    expect(d[1] / d[0]).toBeCloseTo(3);
    expect(fitDurations([3, 3], 0)).toEqual([3, 3]);
  });
  it('videoDurations uses the helper regardless of transition settings', () => {
    let s = emptyStory();
    for (let i = 0; i < 5; i++) s = addPage(s, emptyPage());
    s.video = { ...s.video, transition: 'crossfade', transitionSeconds: 1 };
    expect(sum(videoDurations(s, 3, 10))).toBeLessThanOrEqual(10 + 1e-9);
    expect(videoDurations(s, 4)).toEqual([4, 4, 4, 4, 4]);
  });
});

describe('image sniffing', () => {
  const ftyp = (brand: string) => new Uint8Array([0, 0, 0, 24, ...[...'ftyp' + brand].map((c) => c.charCodeAt(0)), 0, 0, 0, 0]);
  it('detects HEIC by brand, not by name', () => {
    for (const b of ['heic', 'heix', 'mif1', 'msf1']) expect(isHeicBytes(ftyp(b))).toBe(true);
    expect(isHeicBytes(ftyp('avif'))).toBe(false);
    expect(isHeicBytes(ftyp('isom'))).toBe(false);
    expect(isHeicBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]))).toBe(false);
    expect(isHeicBytes(new Uint8Array(5))).toBe(false);
  });
  it('detects TIFF', () => {
    expect(isTiffBytes(new Uint8Array([0x49, 0x49, 0x2a, 0]))).toBe(true);
    expect(isTiffBytes(new Uint8Array([0x4d, 0x4d, 0, 0x2a]))).toBe(true);
    expect(isTiffBytes(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
  });
  it('stores converted recents under a .jpg name only when the bytes are already decodable', async () => {
    expect(convertedName('IMG_1.HEIC')).toBe('IMG_1.jpg');
    expect(convertedName('photo.png')).toBe('photo.png');
    const jpeg = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1])]);
    expect(await storedName('IMG_1.heic', jpeg)).toBe('IMG_1.jpg');
    expect(await storedName('scan.tif', jpeg)).toBe('scan.jpg');
    expect(await storedName('a.png', jpeg)).toBe('a.png');
    expect(await storedName('IMG_1.heic', new Blob([ftyp('heic')]))).toBe('IMG_1.heic');
  });
  it('sizeForEdge keeps aspect and never upscales', () => {
    expect(sizeForEdge(4000, 3000, 1000)).toEqual({ width: 1000, height: 750 });
    expect(sizeForEdge(3000, 4000, 1000)).toEqual({ width: 750, height: 1000 });
    expect(sizeForEdge(800, 600, 2000)).toEqual({ width: 800, height: 600 });
    expect(sizeForEdge(4000, 10, 100)).toEqual({ width: 100, height: 1 });
  });
});

describe('project files', () => {
  it('resolves sidecar paths against the project file, leaving absolute ones alone', () => {
    expect(resolvePhotoPath('/home/me/Trip.collage', 'Trip Photos/a.png')).toBe('/home/me/Trip Photos/a.png');
    expect(resolvePhotoPath('C:\\Users\\me\\Trip.collage', 'Trip Photos/a.png')).toBe('C:\\Users\\me\\Trip Photos\\a.png');
    expect(resolvePhotoPath('/home/me/Trip.collage', '/pics/a.jpg')).toBe('/pics/a.jpg');
    expect(resolvePhotoPath('/home/me/Trip.collage', 'C:\\pics\\a.jpg')).toBe('C:\\pics\\a.jpg');
  });
  it('finds photos with no path, split by whether their bytes are still available', () => {
    const s = emptyStory();
    s.photos = [
      { id: 'a', name: 'a.jpg', path: '/a.jpg', width: 1, height: 1 },
      { id: 'b', name: 'b.png', file: new File([new Uint8Array(1)], 'b.png'), width: 1, height: 1 },
      { id: 'c', name: 'c.png', width: 1, height: 1 },
    ];
    const r = photosNeedingSidecar(s);
    expect(r.withBytes.map((p) => p.id)).toEqual(['b']);
    expect(r.lost.map((p) => p.id)).toEqual(['c']);
  });
  it('clamps page durations to 0.5..60 and defaults to 3', () => {
    const s = emptyStory();
    s.pages = [0.1, 100, 7, NaN].map((duration, i) => ({ ...emptyPage(), id: `p${i}`, duration }));
    const back = deserializeStory(serializeStory(s).replace('"duration": null', '"duration": "x"'));
    expect(back.pages.map((p) => p.duration)).toEqual([0.5, 60, 7, 3]);
  });
});
