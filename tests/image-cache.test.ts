import { afterEach, expect, it, vi } from 'vitest';
import { getObjectUrl, getPreviewBitmap, releasePhoto, type Photo } from '../src/core/images';

const photo: Photo = { id: 'cache-test', name: 'photo.jpg', width: 10, height: 10, file: new File(['image'], 'photo.jpg') };
afterEach(() => { releasePhoto(photo.id); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const bitmap = () => ({ width: 10, height: 10, close: vi.fn() }) as unknown as ImageBitmap;

it('closes a pending bitmap on release without evicting a newer decode', async () => {
  let finishOld!: (b: ImageBitmap) => void;
  let finishNew!: (b: ImageBitmap) => void;
  const decode = vi.fn()
    .mockReturnValueOnce(new Promise<ImageBitmap>((r) => { finishOld = r; }))
    .mockReturnValueOnce(new Promise<ImageBitmap>((r) => { finishNew = r; }));
  vi.stubGlobal('createImageBitmap', decode);
  const first = getPreviewBitmap(photo);
  const rejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
  releasePhoto(photo.id);
  const second = getPreviewBitmap(photo);
  await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(2));
  const old = bitmap();
  finishOld(old);
  await rejected;
  expect(old.close).toHaveBeenCalledOnce();
  expect(getPreviewBitmap(photo)).toBe(second);
  const current = bitmap();
  finishNew(current);
  expect(await second).toBe(current);
  expect(await getPreviewBitmap(photo)).toBe(current);
  expect(current.close).not.toHaveBeenCalled();
  releasePhoto(photo.id);
  expect(current.close).toHaveBeenCalledOnce();
});

it('does not let an old failed object URL request evict a newer cached request', async () => {
  let fail!: (error: Error) => void;
  const broken = { ...photo, file: undefined, path: '/unavailable.jpg' };
  // Read through the public API so the old request can fail after release/reimport.
  const readFile = vi.fn().mockReturnValueOnce(new Promise((_resolve, reject) => { fail = reject; }));
  vi.stubGlobal('window', { api: { readFile } });
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:current');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const first = getObjectUrl(broken);
  const rejected = expect(first).rejects.toThrow('missing');
  releasePhoto(photo.id);
  const second = getObjectUrl(photo);
  fail(new Error('missing'));
  await rejected;
  expect(await second).toBe('blob:current');
  expect(getObjectUrl(photo)).toBe(second);
});
