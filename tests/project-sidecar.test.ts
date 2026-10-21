// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const files = require('../electron/files.cjs');

describe('project sidecar photos', () => {
  it('keeps previous photo bytes intact when a later save reuses the same name', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-'));
    try {
      const project = path.join(dir, 'Trip.collage');
      const save = (data: number) => files.writeSidecar(project, JSON.stringify({ photos: [{ id: 'a' }] }), [{ id: 'a', name: 'photo.jpg', data: new Uint8Array([data]) }]).then(JSON.parse);
      const first = await save(1), second = await save(2), repeat = await save(2);
      expect(second.photos[0].path).not.toBe(first.photos[0].path);
      expect(repeat.photos[0].path).toBe(second.photos[0].path);
      expect([...fs.readFileSync(path.join(dir, first.photos[0].path))]).toEqual([1]);
      expect([...fs.readFileSync(path.join(dir, second.photos[0].path))]).toEqual([2]);
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  });
  it('writes loose photos beside the project and rewrites their paths relatively', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sidecar-'));
    try {
      const project = path.join(dir, 'My Trip.collage');
      const json = JSON.stringify({ photos: [{ id: 'a', name: 'a.png', width: 1, height: 1 }, { id: 'b', name: 'a.png', width: 1, height: 1 }, { id: 'c', name: 'c.jpg', path: '/x/c.jpg', width: 1, height: 1 }] });
      const out = JSON.parse(await files.writeSidecar(project, json, [
        { id: 'a', name: 'a.png', data: new Uint8Array([1, 2, 3]) },
        { id: 'b', name: '../evil/a.png', data: new Uint8Array([4]) },
      ]));
      expect(out.photos[0].path).toBe('My Trip Photos/a.png');
      expect(out.photos[1].path).toBe('My Trip Photos/a 2.png');
      expect(out.photos[2].path).toBe('/x/c.jpg');
      expect([...fs.readFileSync(path.join(dir, 'My Trip Photos', 'a.png'))]).toEqual([1, 2, 3]);
      expect([...fs.readFileSync(path.join(dir, 'My Trip Photos', 'a 2.png'))]).toEqual([4]);
      expect(fs.readdirSync(dir).sort()).toEqual(['My Trip Photos']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it('sniffs HEIC and TIFF by content for conversion', () => {
    const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic'), Buffer.alloc(8)]);
    expect(files.convertibleKind(heic)).toBe('heic');
    expect(files.convertibleKind(Buffer.from([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0]))).toBe('tiff');
    expect(files.convertibleKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBeNull();
  });
});
