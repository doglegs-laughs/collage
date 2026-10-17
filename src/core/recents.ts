import { getThumbnailUrl, type Photo } from './images';

export const MAX_RECENTS = 60;

export type RecentItem = { id: string; name: string; type: string; blob: Blob; thumb: Blob; used: number };

let dbPromise: Promise<IDBDatabase> | undefined;

function openDb(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const request = indexedDB.open('collage', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('recents', { keyPath: 'id' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  return dbPromise;
}

async function store<T>(mode: IDBTransactionMode, operation: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('recents', mode);
    const request = operation(tx.objectStore('recents'));
    tx.oncomplete = () => resolve(request.result);
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
}

/** Newest first. Rejects if storage is unavailable; callers should hide the strip in that case. */
export async function listRecents(): Promise<RecentItem[]> {
  const all = await store('readonly', (s) => s.getAll() as IDBRequest<RecentItem[]>);
  return all.sort((a, b) => b.used - a.used);
}

export async function saveRecent(photo: Photo, source: Blob): Promise<void> {
  const existing = await store('readonly', (s) => s.get(photo.id) as IDBRequest<RecentItem | undefined>);
  const record: RecentItem = existing
    ? { ...existing, used: Date.now() }
    : { id: photo.id, name: photo.name, type: source.type, blob: source, thumb: await (await fetch(await getThumbnailUrl(photo))).blob(), used: Date.now() };
  await store('readwrite', (s) => s.put(record));
  const stale = (await listRecents()).slice(MAX_RECENTS);
  if (stale.length) await store('readwrite', (s) => { stale.forEach((r) => s.delete(r.id)); return s.count(); });
}

export async function touchRecent(item: RecentItem): Promise<void> {
  await store('readwrite', (s) => s.put({ ...item, used: Date.now() }));
}

export async function removeRecent(id: string): Promise<void> {
  await store('readwrite', (s) => s.delete(id));
}

export const recentToFile = (item: RecentItem) => new File([item.blob], item.name, { type: item.type || item.blob.type });
