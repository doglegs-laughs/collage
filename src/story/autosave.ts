import { api, isDesktop, type SidecarPhoto } from '../api';
import { serializeStory, type Story } from './model';

/** Serialize photo reads as well as IPC, so slow older snapshots cannot arrive last. */
export function createAutosaveWriter(snapshot: () => { story: Story; thumb: string | null }) {
  const sent = new Set<string>();
  let pending = Promise.resolve(true);
  return (): Promise<boolean> => {
    pending = pending.then(async () => {
      const { story, thumb } = snapshot();
      if (!story.pages.length) return true;
      try {
        const sidecar: SidecarPhoto[] = [];
        const ids: string[] = [];
        if (isDesktop()) {
          for (const p of story.photos) {
            if (p.path || !p.file || sent.has(p.id)) continue;
            sidecar.push({ id: p.id, name: p.name, data: new Uint8Array(await p.file.arrayBuffer()) });
            ids.push(p.id);
          }
        }
        const ok = await api.autosaveWrite(serializeStory(story), sidecar, { title: story.title, pageCount: story.pages.length, thumb });
        if (ok) ids.forEach((id) => sent.add(id));
        return ok;
      } catch {
        return false;
      }
    });
    return pending;
  };
}
