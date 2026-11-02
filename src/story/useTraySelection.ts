import { useCallback, useEffect, useRef, useState } from 'react';
import type { Photo } from '../core/images';

/**
 * Tray selection in click order. New library photos are selected automatically; removed ones drop out.
 * With `keepLibraryOrder`, a re-selected photo goes back to its library position instead of the end.
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
      return fresh.length || kept.length !== s.length ? [...kept, ...fresh] : s;
    });
  }, [photos]);
  const toggle = useCallback((id: string) => setSelected((s) => {
    if (s.includes(id)) return s.filter((x) => x !== id);
    if (!keepLibraryOrder) return [...s, id];
    const rank = new Map(photos.map((p, i) => [p.id, i]));
    const r = rank.get(id) ?? Infinity;
    const at = s.findIndex((x) => (rank.get(x) ?? Infinity) > r);
    return at < 0 ? [...s, id] : [...s.slice(0, at), id, ...s.slice(at)];
  }), [photos, keepLibraryOrder]);
  const all = useCallback(() => setSelected(photos.map((p) => p.id)), [photos]);
  const none = useCallback(() => setSelected([]), []);
  return { selected, toggle, all, none };
}
