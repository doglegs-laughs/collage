import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const store = createRequire(import.meta.url)('../electron/store.cjs') as {
  addRecent(list: string[], file: string, max?: number): string[];
  removeRecent(list: string[], file: string): string[];
  loadRecents(dir: string): Promise<string[]>;
  saveRecents(dir: string, list: string[]): Promise<void>;
  describeRecents(dir: string): Promise<{ path: string; name: string; exists: boolean }[]>;
  writeAutosave(dir: string, json: string, sidecar: { id: string; name: string; data: Uint8Array }[], known: Record<string, string>, meta: object): Promise<Record<string, string>>;
  readAutosave(dir: string): Promise<{ json: string; meta: { title?: string; savedAt?: number } } | null>;
  clearAutosave(dir: string): Promise<void>;
};

describe('recent stories', () => {
  it('moves repeats to the front and caps at 10', () => {
    let l: string[] = [];
    for (let i = 0; i < 12; i++) l = store.addRecent(l, `/p/${i}.collage`);
    expect(l).toHaveLength(10);
    expect(l[0]).toBe('/p/11.collage');
    l = store.addRecent(l, '/p/5.collage');
    expect(l[0]).toBe('/p/5.collage');
    expect(l.filter((p) => p === '/p/5.collage')).toHaveLength(1);
    expect(store.removeRecent(l, '/p/5.collage')).not.toContain('/p/5.collage');
  });
  it('persists and flags missing files', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'recents-'));
    const real = path.join(dir, 'a.collage');
    fs.writeFileSync(real, '{}');
    await store.saveRecents(dir, [real, path.join(dir, 'gone.collage')]);
    const d = await store.describeRecents(dir);
    expect(d.map((r) => r.exists)).toEqual([true, false]);
    expect(d[0].name).toBe('a.collage');
  });
  it('autosave round-trips with sidecar photos and clears', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autosave-'));
    const json = JSON.stringify({ title: 'T', photos: [{ id: 'x', name: 'x.jpg' }] });
    const paths = await store.writeAutosave(dir, json, [{ id: 'x', name: 'x.jpg', data: new Uint8Array([1, 2, 3]) }], {}, { title: 'T' });
    const back = await store.readAutosave(dir);
    expect(JSON.parse(back!.json).photos[0].path).toBe(paths.x);
    expect(fs.readFileSync(paths.x)).toHaveLength(3);
    expect(back!.meta.title).toBe('T');
    expect(back!.meta.savedAt).toBeGreaterThan(0);
    await store.clearAutosave(dir);
    expect(await store.readAutosave(dir)).toBeNull();
  });
});
