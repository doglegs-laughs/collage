import { useCallback, useEffect, useRef, useState } from 'react';
import type { Photo } from '../core/images';

/** Insert `id` into `selected` before the first photo that comes after it in the library. */
export function insertInLibraryOrder(selected: string[], id: string, photos: Pick<Photo, 'id'>[]): string[] {
  const rank = new Map(photos.map((p, i) => [p.id, i]));
  const r = rank.get(id) ?? Infinity;
  const at = selected.findIndex((x) => (rank.get(x) ?? Infinity) > r);
  return at < 0 ? [...selected, id] : [...selected.slice(0, at), id, ...selected.slice(at)];
}

/** `selected` re-sorted to follow the library order (ids the library does not know go last, in their current order). */
export function sortToLibrary(selected: string[], photos: Pick<Photo, 'id'>[]): string[] {
  const rank = new Map(photos.map((p, i) => [p.id, i]));
  const sorted = [...selected].sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity));
  return sorted.every((id, i) => id === selected[i]) ? selected : sorted;
}

/** True when `next` holds the same photos as `prev` in a different order (the library was reordered). */
export function isReorder(prev: Pick<Photo, 'id'>[], next: Pick<Photo, 'id'>[]): boolean {
  const ids = new Set(prev.map((p) => p.id));
  return prev.length === next.length && next.every((p) => ids.has(p.id)) && prev.some((p, i) => p.id !== next[i].id);
}

/**
 * Tray selection in click order. New library photos are selected automatically; removed ones drop out.
 * With `keepLibraryOrder`, a re-selected photo goes back to its library position instead of the end.
 * Reordering the library re-sorts the selection to match, so the numbers read in tray order.
 */
export function useTraySelection(photos: Photo[], { keepLibraryOrder = false } = {}) {
  const [selected, setSelected] = useState<string[]>([]);
  const known = useRef(new Set<string>());
  useEffect(() => {
    const present = new Set(photos.map((p) => p.id));
    const fresh = photos.filter((p) => !known.current.has(p.id)).map((p) => p.id);
    for (const id of [...known.current]) if (!present.has(id)) known.current.delete(id);
    for (const id of fresh) known.current.add(id);
    setSelected((s) => {
      const kept = s.filter((id) => present.has(id));
      return fresh.length || kept.length !== s.length ? [...kept, ...fresh.filter((id) => !kept.includes(id))] : s;
    });
  }, [photos]);
  const sortToLib = useCallback(() => setSelected((s) => sortToLibrary(s, photos)), [photos]);
  const prevPhotos = useRef(photos);
  useEffect(() => {
    if (isReorder(prevPhotos.current, photos)) sortToLib();
    prevPhotos.current = photos;
  }, [photos, sortToLib]);
  const toggle = useCallback((id: string) => setSelected((s) => {
    if (s.includes(id)) return s.filter((x) => x !== id);
    return keepLibraryOrder ? insertInLibraryOrder(s, id, photos) : [...s, id];
  }), [photos, keepLibraryOrder]);
  const all = useCallback(() => setSelected(photos.map((p) => p.id)), [photos]);
  const none = useCallback(() => setSelected([]), []);
  return { selected, set: setSelected, toggle, all, none, sortToLibrary: sortToLib };
}
