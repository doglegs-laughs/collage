import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { importFromFiles, importFromPaths, releasePhoto, type ImportResult, type Photo } from './images';
import { api, isDesktop } from '../api';
import { moveById } from './order';
import { useToast } from '../ui/Toast';

export type PhotoLibrary = {
  photos: Photo[];
  /** Imports files, de-duplicating by content. Resolves to the photos for these inputs (including ones already present). */
  addFiles: (files: File[]) => Promise<Photo[]>;
  addPaths: (paths: string[]) => Promise<Photo[]>;
  /** Makes the library exactly the photos at these paths, in this order: the others are removed and their bitmaps and URLs freed. Resolves to the photos found. */
  replacePaths: (paths: string[]) => Promise<Photo[]>;
  /** Opens the native picker (or a file input in a browser) and imports the choice. */
  pick: () => Promise<Photo[]>;
  /** Puts already-imported photos back (e.g. when an undo brings them back). Ones already present are ignored. */
  adopt: (photos: Photo[]) => void;
  remove: (id: string) => void;
  /** Moves a photo to index `to` of the library; the order is shared by every tab. */
  move: (id: string, to: number) => void;
  /** Removes every photo and frees their cached bitmaps and URLs. */
  clear: () => void;
  get: (id: string) => Photo | undefined;
};

export const PhotoLibraryContext = createContext<PhotoLibrary | null>(null);

export function usePhotoLibrary(): PhotoLibrary {
  const ctx = useContext(PhotoLibraryContext);
  if (!ctx) throw new Error('usePhotoLibrary must be used inside <PhotoLibraryProvider>');
  return ctx;
}

export function PhotoLibraryProvider({ children }: { children: ReactNode }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const byId = useRef(new Map<string, Photo>());
  const toast = useToast();

  const reportFailed = useCallback(
    (result: ImportResult) => {
      if (!result.failed.length) return;
      const [first] = result.failed;
      toast(result.failed.length === 1 ? `${first.name}: ${first.error}` : `${result.failed.length} photos could not be opened (${first.name}: ${first.error})`, 'error');
    },
    [toast],
  );

  const ingest = useCallback(
    (result: ImportResult): Photo[] => {
      const out: Photo[] = [];
      const fresh: Photo[] = [];
      for (const photo of result.photos) {
        const known = byId.current.get(photo.id);
        if (known) out.push(known);
        else {
          byId.current.set(photo.id, photo);
          fresh.push(photo);
          out.push(photo);
        }
      }
      if (fresh.length) setPhotos((p) => [...p, ...fresh]);
      reportFailed(result);
      return out;
    },
    [reportFailed],
  );

  const addFiles = useCallback((files: File[]) => importFromFiles(files).then(ingest), [ingest]);
  const addPaths = useCallback((paths: string[]) => importFromPaths(paths).then(ingest), [ingest]);
  const replacePaths = useCallback(async (paths: string[]) => {
    const result = paths.length ? await importFromPaths(paths) : { photos: [], failed: [] };
    const next = new Map<string, Photo>();
    for (const photo of result.photos) if (!next.has(photo.id)) next.set(photo.id, byId.current.get(photo.id) ?? photo);
    for (const id of [...byId.current.keys()]) if (!next.has(id)) releasePhoto(id);
    byId.current = next;
    setPhotos([...next.values()]);
    reportFailed(result);
    return [...next.values()];
  }, [reportFailed]);
  const pick = useCallback(async () => {
    if (isDesktop()) return addPaths(await api.openImages());
    const files = await new Promise<File[]>((resolve) => {
      const input = Object.assign(document.createElement('input'), { type: 'file', accept: 'image/*', multiple: true });
      input.onchange = () => resolve([...(input.files ?? [])]);
      input.oncancel = () => resolve([]);
      input.click();
    });
    return addFiles(files);
  }, [addFiles, addPaths]);
  const remove = useCallback((id: string) => {
    byId.current.delete(id);
    releasePhoto(id);
    setPhotos((p) => p.filter((x) => x.id !== id));
  }, []);
  const move = useCallback((id: string, to: number) => setPhotos((p) => moveById(p, id, to)), []);
  const adopt = useCallback((list: Photo[]) => { ingest({ photos: list, failed: [] }); }, [ingest]);
  const clear = useCallback(() => {
    for (const id of byId.current.keys()) releasePhoto(id);
    byId.current.clear();
    setPhotos([]);
  }, []);
  const get = useCallback((id: string) => byId.current.get(id), []);

  const value = useMemo(() => ({ photos, addFiles, addPaths, replacePaths, pick, remove, move, adopt, clear, get }), [photos, addFiles, addPaths, replacePaths, pick, remove, move, adopt, clear, get]);
  return <PhotoLibraryContext.Provider value={value}>{children}</PhotoLibraryContext.Provider>;
}
