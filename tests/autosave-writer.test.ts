import { afterEach, expect, it, vi } from 'vitest';
import { createAutosaveWriter } from '../src/story/autosave';
import { emptyPage, emptyStory } from '../src/story/model';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('orders saves before slow photo reads and sends successful sidecars only once', async () => {
  let finish!: (bytes: ArrayBuffer) => void;
  const file = new File(['photo'], 'photo.jpg');
  const read = vi.spyOn(file, 'arrayBuffer').mockReturnValueOnce(new Promise<ArrayBuffer>((r) => { finish = r; }));
  const autosaveWrite = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('window', { api: { autosaveWrite } });
  let story = { ...emptyStory(), title: 'older', pages: [emptyPage()], photos: [{ id: 'a', name: 'photo.jpg', width: 1, height: 1, file }] };
  const write = createAutosaveWriter(() => ({ story, thumb: null }));
  const first = write();
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce());
  story = { ...story, title: 'newer' };
  const flush = write();
  expect(autosaveWrite).not.toHaveBeenCalled();
  finish(new ArrayBuffer(3));
  expect(await first).toBe(true);
  expect(await flush).toBe(true);
  expect(autosaveWrite.mock.calls.map(([json]) => JSON.parse(json).title)).toEqual(['older', 'newer']);
  expect(autosaveWrite.mock.calls[0][1]).toHaveLength(1);
  expect(autosaveWrite.mock.calls[1][1]).toEqual([]);
  expect(read).toHaveBeenCalledOnce();
});

it('retries photo bytes after a rejected or unsuccessful save', async () => {
  const autosaveWrite = vi.fn().mockRejectedValueOnce(new Error('IPC failure')).mockResolvedValueOnce(false).mockResolvedValue(true);
  vi.stubGlobal('window', { api: { autosaveWrite } });
  const story = { ...emptyStory(), pages: [emptyPage()], photos: [{ id: 'a', name: 'photo.jpg', width: 1, height: 1, file: new File(['photo'], 'photo.jpg') }] };
  const write = createAutosaveWriter(() => ({ story, thumb: null }));
  expect(await write()).toBe(false);
  expect(await write()).toBe(false);
  expect(await write()).toBe(true);
  expect(autosaveWrite.mock.calls.map(([, sidecar]) => sidecar.length)).toEqual([1, 1, 1]);
});

it('coalesces writes queued behind a slow one into a single write of the latest state', async () => {
  let release!: (ok: boolean) => void;
  const autosaveWrite = vi.fn()
    .mockReturnValueOnce(new Promise<boolean>((r) => { release = r; }))
    .mockResolvedValue(true);
  vi.stubGlobal('window', { api: { autosaveWrite } });
  let story = { ...emptyStory(), title: 'v1', pages: [emptyPage()] };
  const write = createAutosaveWriter(() => ({ story, thumb: null }));
  const first = write();
  await vi.waitFor(() => expect(autosaveWrite).toHaveBeenCalledOnce());
  story = { ...story, title: 'v2' };
  const debounced = write();
  story = { ...story, title: 'v3' };
  const flush = write();
  expect(flush).toBe(debounced);
  release(true);
  expect(await first).toBe(true);
  expect(await flush).toBe(true);
  expect(autosaveWrite.mock.calls.map(([json]) => JSON.parse(json).title)).toEqual(['v1', 'v3']);
});

it('abandons a hung write after the timeout and keeps writing', async () => {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  try {
    const autosaveWrite = vi.fn().mockReturnValueOnce(new Promise<boolean>(() => {})).mockResolvedValue(true);
    vi.stubGlobal('window', { api: { autosaveWrite } });
    const story = { ...emptyStory(), pages: [emptyPage()] };
    const write = createAutosaveWriter(() => ({ story, thumb: null }), 1000);
    const hung = write();
    const next = write();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await hung).toBe(false);
    expect(await next).toBe(true);
    expect(autosaveWrite).toHaveBeenCalledTimes(2);
  } finally {
    vi.useRealTimers();
  }
});

it('does not send a stale IPC write after a timed-out photo read resumes', async () => {
  let release!: (bytes: ArrayBuffer) => void;
  const file = new File(['photo'], 'photo.jpg');
  vi.spyOn(file, 'arrayBuffer').mockReturnValueOnce(new Promise((r) => { release = r; }));
  const autosaveWrite = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('window', { api: { autosaveWrite } });
  let story = { ...emptyStory(), title: 'stale', pages: [emptyPage()], photos: [{ id: 'a', name: 'photo.jpg', width: 1, height: 1, file }] };
  const write = createAutosaveWriter(() => ({ story, thumb: null }), 50);
  expect(await write()).toBe(false);
  story = { ...story, title: 'latest' };
  expect(await write()).toBe(true);
  release(new ArrayBuffer(3));
  await new Promise((r) => setImmediate(r));
  expect(autosaveWrite.mock.calls.map(([json]) => JSON.parse(json).title)).toEqual(['latest']);
});

it('preserves startup recovery, then saves the deletion of the last page', async () => {
  const autosaveWrite = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('window', { api: { autosaveWrite } });
  let story = emptyStory();
  const write = createAutosaveWriter(() => ({ story, thumb: null }));
  expect(await write()).toBe(true);
  expect(autosaveWrite).not.toHaveBeenCalled();
  story = { ...story, pages: [emptyPage()] };
  await write();
  story = { ...story, pages: [] };
  await write();
  expect(autosaveWrite.mock.calls.map(([json]) => JSON.parse(json).pages.length)).toEqual([1, 0]);
});

it('sends a photo again after a save that did not include it', async () => {
  const autosaveWrite = vi.fn().mockResolvedValue(true);
  vi.stubGlobal('window', { api: { autosaveWrite } });
  const photo = { id: 'a', name: 'photo.jpg', width: 1, height: 1, file: new File(['photo'], 'photo.jpg') };
  let story = { ...emptyStory(), pages: [emptyPage()], photos: [photo] };
  const write = createAutosaveWriter(() => ({ story, thumb: null }));
  await write();
  story = { ...story, photos: [] };
  await write();
  story = { ...story, photos: [photo] };
  await write();
  expect(autosaveWrite.mock.calls.map(([, sidecar]) => sidecar.length)).toEqual([1, 0, 1]);
});
