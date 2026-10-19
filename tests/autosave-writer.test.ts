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
