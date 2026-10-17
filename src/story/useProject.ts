import { useCallback } from 'react';
import { api } from '../api';
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

export function useProject(getStory: () => Story, lib: PhotoLibrary, onLoad: (s: Story) => void) {
  const toast = useToast();

  const save = useCallback(async () => {
    const story = getStory();
    if (!story.pages.length) return;
    try {
      const path = await api.saveProject(serializeStory(story), `${storyBaseName(story)}.collage`);
      if (path) toast(`Saved ${path.split(/[\\/]/).pop()}`, 'success');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the project.', 'error');
    }
  }, [getStory, toast]);

  const open = useCallback(async () => {
    try {
      const file = await api.openProject();
      if (!file) return;
      const loaded = deserializeStory(file.json);
      const paths = loaded.photos.flatMap((p) => (p.path ? [p.path] : []));
      const found = paths.length ? await lib.addPaths(paths) : [];
      const { story, missing } = relinkPhotos(loaded, found);
      onLoad(story);
      toast(
        missing.length ? `Opened, but ${missing.length} photo${missing.length === 1 ? ' is' : 's are'} missing: ${missing.slice(0, 3).join(', ')}${missing.length > 3 ? '…' : ''}` : 'Project opened',
        missing.length ? 'error' : 'success',
      );
    } catch (e) {
      toast(e instanceof StoryFormatError || e instanceof Error ? e.message : 'Could not open the project.', 'error');
    }
  }, [lib, onLoad, toast]);

  return { save, open };
}
