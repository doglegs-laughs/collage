import { api, isDesktop, type SidecarPhoto } from '../api';
import { serializeStory, type Story } from './model';

export const AUTOSAVE_WRITE_TIMEOUT_MS = 20_000;

/**
 * Writes the autosave with at most one write in flight plus one queued. Callers that arrive while a write runs share
 * the queued write, which reads the latest snapshot only when it starts, so superseded states are never written and a
 * close-time flush waits for at most one write besides its own. A write that hangs is abandoned after `timeoutMs`.
 */
export function createAutosaveWriter(snapshot: () => { story: Story; thumb: string | null }, timeoutMs = AUTOSAVE_WRITE_TIMEOUT_MS) {
  const sent = new Set<string>();
  let started = snapshot().story.pages.length > 0;
  let queued: Promise<boolean> | null = null;

  async function writeOnce(abandoned: { value: boolean }): Promise<boolean> {
    const { story, thumb } = snapshot();
    // Leave the startup recovery copy alone until the user has had a story in this session.
    if (!story.pages.length && !started) return true;
    started = true;
    try {
      const sidecar: SidecarPhoto[] = [];
      const ids: string[] = [];
      // The desktop app deletes stored copies of photos a saved story no longer uses, so a photo that comes back must be sent again.
      const used = new Set(story.photos.map((p) => p.id));
      for (const id of sent) if (!used.has(id)) sent.delete(id);
      if (isDesktop()) {
        for (const p of story.photos) {
          if (p.path || !p.file || sent.has(p.id)) continue;
          sidecar.push({ id: p.id, name: p.name, data: new Uint8Array(await p.file.arrayBuffer()) });
          if (abandoned.value) return false;
          ids.push(p.id);
        }
      }
      if (abandoned.value) return false;
      const ok = await api.autosaveWrite(serializeStory(story), sidecar, { title: story.title, pageCount: story.pages.length, thumb });
      if (ok && !abandoned.value) ids.forEach((id) => sent.add(id));
      return ok;
    } catch {
      return false;
    }
  }

  function withTimeout(): Promise<boolean> {
    const abandoned = { value: false };
    let timer: ReturnType<typeof setTimeout>;
    const timeout = new Promise<boolean>((resolve) => {
      timer = setTimeout(() => {
        abandoned.value = true;
        console.warn(`Autosave write abandoned after ${timeoutMs} ms`);
        resolve(false);
      }, timeoutMs);
    });
    return Promise.race([writeOnce(abandoned), timeout]).finally(() => clearTimeout(timer));
  }

  let current: Promise<boolean> | null = null;
  const start = () => {
    const p = withTimeout();
    current = p;
    void p.then(() => { if (current === p) current = null; });
    return p;
  };

  return (): Promise<boolean> => {
    if (!current) return start();
    queued ??= current.then(() => {
      queued = null;
      return start();
    });
    return queued;
  };
}
