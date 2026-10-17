import { useCallback, useEffect, useState } from 'react';
import { listRecents, type RecentItem } from '../core/recents';

/** Recents from IndexedDB; `items` is null when storage is unavailable (the strip then hides). */
export function useRecents() {
  const [items, setItems] = useState<RecentItem[] | null>(null);
  const reload = useCallback(async () => {
    try {
      setItems(await listRecents());
    } catch {
      setItems(null);
    }
  }, []);
  useEffect(() => { void reload(); }, [reload]);
  return { items, reload };
}
