import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

type Sidecar = { id: string; name: string; data: Uint8Array };
const { createAutosaveStore } = createRequire(import.meta.url)('../electron/store.cjs') as {
  createAutosaveStore(dir: string, options?: { timeoutMs?: number }): {
    write(json: string, sidecar: Sidecar[], meta: object): Promise<void>;
    read(): Promise<{ json: string; meta: { title: string } } | null>;
    clear(): Promise<void>;
  };
};
const project = (title: string) => JSON.stringify({ title, photos: [{ id: 'x' }] });
const sidecar = [{ id: 'x', name: 'photo.jpg', data: new Uint8Array([1, 2, 3]) }];
let dir: string;
beforeEach(async () => { dir = await fs.mkdtemp(path.join(os.tmpdir(), 'autosave-queue-')); });
afterEach(async () => { vi.restoreAllMocks(); await fs.rm(dir, { recursive: true, force: true }); });

function pauseFirstWrite() {
  const original = fs.writeFile;
  let resume!: () => void;
  let started!: () => void;
  const gate = new Promise<void>((r) => { resume = r; });
  const ready = new Promise<void>((r) => { started = r; });
  vi.spyOn(fs, 'writeFile').mockImplementationOnce(async (file, ...args) => {
    started();
    await gate;
    return original(file, ...args);
  });
  return { ready, resume };
}

it('keeps the latest story, metadata and sidecar paths when a first save is slow', async () => {
  const store = createAutosaveStore(dir);
  const pause = pauseFirstWrite();
  const first = store.write(project('older'), sidecar, { title: 'older' });
  await pause.ready;
  const second = store.write(project('newer'), [], { title: 'newer' });
  pause.resume();
  await Promise.all([first, second]);
  const saved = (await store.read())!;
  expect(JSON.parse(saved.json).title).toBe('newer');
  expect(saved.meta.title).toBe('newer');
  const photoPath = JSON.parse(saved.json).photos[0].path;
  expect([...await fs.readFile(photoPath)]).toEqual([1, 2, 3]);
});

it('clears after an in-flight write and resets sidecar paths for subsequent saves', async () => {
  const store = createAutosaveStore(dir);
  const pause = pauseFirstWrite();
  const write = store.write(project('old'), sidecar, {});
  await pause.ready;
  const clear = store.clear();
  pause.resume();
  await Promise.all([write, clear]);
  expect(await store.read()).toBeNull();
  expect(await fs.readdir(dir)).toEqual([]);
  await store.write(project('new'), [], {});
  expect(JSON.parse((await store.read())!.json).photos[0].path).toBeUndefined();
});

it('recovers after a failed save', async () => {
  const store = createAutosaveStore(dir);
  await expect(store.write('invalid json', [], {})).rejects.toThrow();
  await store.write(project('recovered'), sidecar, { title: 'recovered' });
  expect(JSON.parse((await store.read())!.json).title).toBe('recovered');
});

it('reads the last committed autosave while a write is still running', async () => {
  const store = createAutosaveStore(dir);
  await store.write(project('committed'), [], { title: 'committed' });
  const pause = pauseFirstWrite();
  const slow = store.write(project('slow'), [], { title: 'slow' });
  await pause.ready;
  expect(JSON.parse((await store.read())!.json).title).toBe('committed');
  pause.resume();
  await slow;
});

it('abandons a hung write so later operations still run', async () => {
  const store = createAutosaveStore(dir, { timeoutMs: 50 });
  vi.spyOn(fs, 'writeFile').mockImplementationOnce(() => new Promise<void>(() => {}));
  await expect(store.write(project('hung'), [], {})).rejects.toThrow('timed out');
  await store.write(project('next'), [], { title: 'next' });
  expect(JSON.parse((await store.read())!.json).title).toBe('next');
  await store.clear();
  expect(await store.read()).toBeNull();
});

it('prevents a timed-out write from replacing a newer autosave when it resumes', async () => {
  const store = createAutosaveStore(dir, { timeoutMs: 50 });
  const pause = pauseFirstWrite();
  const first = store.write(project('stale'), [], { title: 'stale' });
  await pause.ready;
  await expect(first).rejects.toThrow('timed out');
  await store.write(project('latest'), [], { title: 'latest' });
  pause.resume();
  await vi.waitFor(async () => expect((await fs.readdir(path.join(dir, 'autosave'))).filter((p) => p.endsWith('.tmp'))).toEqual([]));
  const saved = (await store.read())!;
  expect(JSON.parse(saved.json).title).toBe('latest');
  expect(saved.meta.title).toBe('latest');
});

it('does not resurrect a cleared autosave when a timed-out write resumes', async () => {
  const store = createAutosaveStore(dir, { timeoutMs: 50 });
  const pause = pauseFirstWrite();
  const first = store.write(project('stale'), [], {});
  await pause.ready;
  await expect(first).rejects.toThrow('timed out');
  await store.clear();
  pause.resume();
  // The resumed temporary write fails because clear removed the containing directory.
  await new Promise((r) => setImmediate(r));
  expect(await store.read()).toBeNull();
});

const withPhotos = (...ids: string[]) => JSON.stringify({ title: 't', photos: ids.map((id) => ({ id })) });
const item = (id: string) => ({ id, name: `${id}.jpg`, data: new Uint8Array([1]) });
const stored = () => fs.readdir(path.join(dir, 'Autosave Photos')).catch(() => [] as string[]);

it('deletes stored photos the saved project no longer references, and only those', async () => {
  const store = createAutosaveStore(dir);
  await store.write(withPhotos('a', 'b'), [item('a'), item('b')], {});
  expect(await stored()).toEqual(['a-a.jpg', 'b-b.jpg']);
  await store.write(withPhotos('b'), [], {});
  expect(await stored()).toEqual(['b-b.jpg']);
  const saved = JSON.parse((await store.read())!.json);
  expect(saved.photos[0].path).toBe(path.join(dir, 'Autosave Photos', 'b-b.jpg'));
  // A photo that comes back is written again rather than pointing at the deleted file.
  await store.write(withPhotos('a', 'b'), [item('a')], {});
  expect(await stored()).toEqual(['a-a.jpg', 'b-b.jpg']);
});

it('keeps photos referenced by path in the written project and never touches files outside the folder', async () => {
  const store = createAutosaveStore(dir);
  const outside = path.join(dir, 'other.jpg');
  await fs.writeFile(outside, 'x');
  await store.write(withPhotos('a'), [item('a')], {});
  const keptPath = path.join(dir, 'Autosave Photos', 'a-a.jpg');
  // A resumed project carries the stored path itself.
  await store.write(JSON.stringify({ title: 't', photos: [{ id: 'a', path: keptPath }] }), [], {});
  expect(await stored()).toEqual(['a-a.jpg']);
  await store.write(withPhotos(), [], {});
  expect(await stored()).toEqual([]);
  expect(await fs.readFile(outside, 'utf8')).toBe('x');
});

it('removes the stored photos when the autosave is cleared', async () => {
  const store = createAutosaveStore(dir);
  await store.write(withPhotos('a'), [item('a')], {});
  await store.clear();
  expect(await stored()).toEqual([]);
});
