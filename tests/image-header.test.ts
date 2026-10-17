// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readOrientedSize } from '../src/core/imageHeader';

const FFMPEG = '/usr/bin/ffmpeg';
let dir: string;
const file = (n: string) => new Uint8Array(fs.readFileSync(path.join(dir, n)));

function make(name: string, w: number, h: number, extra: string[] = []) {
  execFileSync(FFMPEG, ['-v', 'error', '-y', '-f', 'lavfi', '-i', `testsrc=size=${w}x${h}:rate=1`, '-frames:v', '1', ...extra, path.join(dir, name)]);
}

/** APP1 Exif segment with a single Orientation entry. */
function exifSegment(orientation: number, little: boolean): Uint8Array {
  const tiff = new Uint8Array(8 + 2 + 12 + 4);
  const v = new DataView(tiff.buffer);
  v.setUint16(0, little ? 0x4949 : 0x4d4d);
  v.setUint16(2, 42, little);
  v.setUint32(4, 8, little);
  v.setUint16(8, 1, little);
  v.setUint16(10, 0x0112, little);
  v.setUint16(12, 3, little);
  v.setUint32(14, 1, little);
  v.setUint16(18, orientation, little);
  const body = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]);
  const seg = new Uint8Array(4 + body.length);
  seg.set([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff]);
  seg.set(body, 4);
  return seg;
}
const withExif = (jpg: Uint8Array, seg: Uint8Array) => Uint8Array.from([...jpg.subarray(0, 2), ...seg, ...jpg.subarray(2)]);

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'imgheader-'));
  make('a.jpg', 64, 40);
  make('a.png', 50, 30);
  make('a.webp', 48, 36);
  make('lossless.webp', 33, 21, ['-lossless', '1']);
  make('a.gif', 20, 12);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe('readOrientedSize', () => {
  it('reads jpeg, png, webp (lossy and lossless) and gif', () => {
    expect(readOrientedSize(file('a.jpg'))).toEqual({ width: 64, height: 40 });
    expect(readOrientedSize(file('a.png'))).toEqual({ width: 50, height: 30 });
    expect(readOrientedSize(file('a.webp'))).toEqual({ width: 48, height: 36 });
    expect(readOrientedSize(file('lossless.webp'))).toEqual({ width: 33, height: 21 });
    expect(readOrientedSize(file('a.gif'))).toEqual({ width: 20, height: 12 });
  });

  for (const little of [true, false]) {
    it(`applies EXIF orientation (${little ? 'II' : 'MM'})`, () => {
      const jpg = file('a.jpg');
      for (const o of [1, 2, 3, 4]) expect(readOrientedSize(withExif(jpg, exifSegment(o, little)))).toEqual({ width: 64, height: 40 });
      for (const o of [5, 6, 7, 8]) expect(readOrientedSize(withExif(jpg, exifSegment(o, little)))).toEqual({ width: 40, height: 64 });
    });
  }

  it('returns null for unknown or truncated data', () => {
    expect(readOrientedSize(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]))).toBeNull();
    expect(readOrientedSize(new Uint8Array())).toBeNull();
    expect(readOrientedSize(file('a.jpg').subarray(0, 10))).toBeNull();
    expect(readOrientedSize(file('a.png').subarray(0, 18))).toBeNull();
  });
});
