import { useCallback, useEffect } from 'react';
import { api, isDesktop, type SidecarPhoto } from '../api';
import type { PhotoLibrary } from '../core/library';
import { useToast } from '../ui/Toast';
import { storyBaseName } from './exportStory';
import { deserializeStory, serializeStory, StoryFormatError, type Photo, type Story } from './model';

/** Replace project photos by library photos (matched by content id, then by path); the rest become empty slots. */
export function relinkPhotos(story: Story, found: Photo[]): { story: Story; missing: string[] } {
  const byId = new Map(found.map((p) => [p.id, p]));
  const byPath = new Map(found.filter((p) => p.path).map((p) => [p.path!, p]));
  const map = new Map<string, Photo>();
  const missing: string[] = [];
  for (const s of story.photos) {
    const hit = byId.get(s.id) ?? (s.path ? byPath.get(s.path) : undefined);
    if (hit) map.set(s.id, hit);
    else missing.push(s.name);
  }
  const pages = story.pages.map((pg) => ({
    ...pg,
    elements: pg.elements.map((e) => (e.kind === 'photo' && e.photoId ? { ...e, photoId: map.get(e.photoId)?.id ?? null } : e)),
  }));
  return { story: { ...story, pages, photos: [...new Set(map.values())] }, missing };
}

const isAbsolute = (p: string) => /^([\\/]|[A-Za-z]:[\\/])/.test(p);
/** Photo paths saved relative to the project file (the sidecar folder) are resolved against the file's folder. */
export function resolvePhotoPath(projectPath: string, photoPath: string): string {
  if (isAbsolute(photoPath)) return photoPath;
  const cut = Math.max(projectPath.lastIndexOf('/'), projectPath.lastIndexOf('\\'));
  if (cut < 0) return photoPath;
  const sep = projectPath.includes('\\') && !projectPath.includes('/') ? '\\' : '/';
  return projectPath.slice(0, cut + 1) + (sep === '\\' ? photoPath.replace(/\//g, '\\') : photoPath);
}

/** Photos with no file on disk, whose bytes must travel with the project. */
export function photosNeedingSidecar(story: Story): { withBytes: Photo[]; lost: Photo[] } {
  const loose = story.photos.filter((p) => !p.path);
  return { withBytes: loose.filter((p) => p.file), lost: loose.filter((p) => !p.file) };
}

export function useProject(getStory: () => Story, lib: PhotoLibrary, onLoad: (s: Story) => void, opts: { isDirty?: () => boolean; onSaved?: (s: Story) => void } = {}) {
  const toast = useToast();
  const { isDirty, onSaved } = opts;

  const save = useCallback(async () => {
    const story = getStory();
    if (!story.pages.length) return;
    try {
      const { withBytes, lost } = photosNeedingSidecar(story);
      const sidecar: SidecarPhoto[] = [];
      if (isDesktop()) for (const p of withBytes) sidecar.push({ id: p.id, name: p.name, data: new Uint8Array(await p.file!.arrayBuffer()) });
      const path = await api.saveProject(serializeStory(story), `${storyBaseName(story)}.collage`, sidecar);
      if (!path) return;
      onSaved?.(story);
      const unsaved = [...lost, ...(isDesktop() ? [] : withBytes)];
      if (unsaved.length) {
        const names = unsaved.slice(0, 3).map((p) => p.name).join(', ');
        toast(`Saved ${path.split(/[\\/]/).pop()}, but ${unsaved.length} photo${unsaved.length === 1 ? ' has' : 's have'} no file on disk and ${unsaved.length === 1 ? 'is' : 'are'} not stored in it: ${names}${unsaved.length > 3 ? '…' : ''}`, 'error');
      } else {
        toast(`Saved ${path.split(/[\\/]/).pop()}${sidecar.length ? ` with ${sidecar.length} photo${sidecar.length === 1 ? '' : 's'} in a Photos folder beside it` : ''}`, 'success');
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the project.', 'error');
    }
  }, [getStory, toast, onSaved]);

  /** Load a project file's contents (from the Open dialog, a recent entry or the autosave). */
  const openFile = useCallback(async (file: { path: string; json: string }, label = 'Project opened') => {
    try {
      if (isDirty?.() && !window.confirm('Opening a project replaces the story you are editing, and its unsaved changes will be lost. Open anyway?')) return;
      const parsed = deserializeStory(file.json);
      const loaded = { ...parsed,
        video: { ...parsed.video, audioPath: parsed.video.audioPath ? resolvePhotoPath(file.path, parsed.video.audioPath) : null },
        photos: parsed.photos.map((p) => (p.path ? { ...p, path: resolvePhotoPath(file.path, p.path) } : p)),
      };
      const paths = loaded.photos.flatMap((p) => (p.path ? [p.path] : []));
      const found = paths.length ? await lib.addPaths(paths) : [];
      const { story, missing } = relinkPhotos(loaded, found);
      onLoad(story);
      toast(
        missing.length ? `Opened, but ${missing.length} photo${missing.length === 1 ? ' is' : 's are'} missing: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}` : label,
        missing.length ? 'error' : 'success',
      );
    } catch (e) {
      toast(e instanceof StoryFormatError || e instanceof Error ? e.message : 'Could not open the project.', 'error');
    }
  }, [lib, onLoad, toast, isDirty]);

  const open = useCallback(async () => {
    try {
      const file = await api.openProject();
      if (file) await openFile(file);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not open the project.', 'error');
    }
  }, [openFile, toast]);

  const openRecent = useCallback(async (path: string) => {
    const file = await api.openRecentStory(path);
    if (file) await openFile(file);
    else toast('That file was not found.', 'error');
  }, [openFile, toast]);

  useEffect(() => api.onOpenRecent((file) => void openFile(file)), [openFile]);

  return { save, open, openFile, openRecent };
}
