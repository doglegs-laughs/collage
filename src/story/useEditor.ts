import { useCallback, useMemo, useRef, useState } from 'react';
import { clamp } from '../core/geometry';
import type { Photo } from '../core/images';
import {
  addElement, addPage, addPhotos, aspectRatio, defaultPhotoEl, defaultRectEl, defaultTextEl, duplicatePage, duplicateElements, emptyPage, movePage, removeElements,
  removePage, reorderZ, replacePhoto, updateElements, type El, type Page, type Story, type ZMove,
} from './model';
import { shuffleLayout } from './autofill';
import { newSeed } from './storyOps';
import type { Overrides } from './useCanvasDrag';

type Mutate = (fn: (s: Story) => Story, key?: string) => void;

/** Current page, selection, crop/text edit modes and all element-level actions. */
export function useEditor(story: Story, mutate: Mutate) {
  const [pageRaw, setPageRaw] = useState(0);
  const [selRaw, setSelRaw] = useState<string[]>([]);
  const [cropId, setCropId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const pageIndex = clamp(pageRaw, 0, Math.max(0, story.pages.length - 1));
  const page: Page | undefined = story.pages[pageIndex];
  const selection = useMemo(() => (page ? selRaw.filter((id) => page.elements.some((e) => e.id === id)) : []), [selRaw, page]);
  const live = useRef({ story, pageIndex, selection });
  live.current = { story, pageIndex, selection };
  const pxPerPage = useRef(800);

  const goTo = useCallback((i: number) => {
    setPageRaw(i);
    setSelRaw([]);
    setCropId(null);
    setEditingId(null);
  }, []);
  const select = useCallback((ids: string[]) => setSelRaw(ids), []);
  const jump = useCallback((i: number, elementId: string) => {
    goTo(i);
    setSelRaw([elementId]);
  }, [goTo]);

  const patch = useCallback((ids: readonly string[], p: Partial<El>, key?: string) => {
    const { pageIndex: pi } = live.current;
    mutate((s) => updateElements(s, pi, ids, (el) => ({ ...el, ...p }) as El), key);
  }, [mutate]);
  const patchSelected = useCallback((p: Partial<El>, key?: string) => patch(live.current.selection, p, key), [patch]);
  const commitOverrides = useCallback((o: Overrides) => {
    const { pageIndex: pi } = live.current;
    mutate((s) => updateElements(s, pi, Object.keys(o), (el) => ({ ...el, ...o[el.id] }) as El));
  }, [mutate]);

  const remove = useCallback(() => {
    const { pageIndex: pi, selection: ids } = live.current;
    if (!ids.length) return;
    mutate((s) => removeElements(s, pi, ids));
    setSelRaw([]);
    setCropId(null);
  }, [mutate]);
  const duplicate = useCallback(() => {
    const { story: s, pageIndex: pi, selection: ids } = live.current;
    if (!ids.length) return;
    const r = duplicateElements(s, pi, ids);
    mutate(() => r.story);
    setSelRaw(r.newIds);
  }, [mutate]);
  const nudge = useCallback((dxPx: number, dyPx: number) => {
    const { story: s, selection: ids } = live.current;
    if (!ids.length) return;
    const W = pxPerPage.current;
    const H = W / aspectRatio(s.aspect);
    const { pageIndex: pi } = live.current;
    mutate((st) => updateElements(st, pi, ids, (el) => ({ ...el, x: el.x + dxPx / W, y: el.y + dyPx / H })), 'nudge');
  }, [mutate]);
  const zOrder = useCallback((move: ZMove) => {
    const { pageIndex: pi, selection: ids } = live.current;
    if (ids.length) mutate((s) => reorderZ(s, pi, ids, move));
  }, [mutate]);

  const add = useCallback((el: El) => {
    const { pageIndex: pi } = live.current;
    mutate((s) => addElement(s, pi, el));
    setSelRaw([el.id]);
  }, [mutate]);
  const addText = useCallback(() => add(defaultTextEl({ text: 'Text', x: 0.1, y: 0.42, w: 0.8, h: 0.1, size: 0.05 })), [add]);
  const addRect = useCallback(() => add(defaultRectEl({ x: 0.25, y: 0.3, w: 0.5, h: 0.3, fill: '#e4e4e7' })), [add]);
  const addSlot = useCallback(() => {
    const A = aspectRatio(live.current.story.aspect);
    add(defaultPhotoEl({ x: 0.2, y: 0.5 - (0.6 * A) / 2 / 1.5, w: 0.6, h: (0.6 * A) / 1.5 }));
  }, [add]);

  /** Drop of a library photo: replace the photo under the pointer, or add a new element at the drop point. */
  const dropPhoto = useCallback((photo: Photo, hit: { elementId: string | null; x: number; y: number }) => {
    const { pageIndex: pi, story: s } = live.current;
    if (hit.elementId) {
      mutate((st) => replacePhoto(addPhotos(st, [photo]), pi, hit.elementId!, photo.id));
      setSelRaw([hit.elementId]);
      return;
    }
    const A = aspectRatio(s.aspect);
    const pa = photo.width / photo.height;
    let w = 0.46;
    let h = (w * A) / pa;
    if (h > 0.7) { h = 0.7; w = (h * pa) / A; }
    const el = defaultPhotoEl({ photoId: photo.id, w, h, x: clamp(hit.x - w / 2, 0, 1 - w), y: clamp(hit.y - h / 2, 0, 1 - h) });
    mutate((st) => addElement(addPhotos(st, [photo]), pi, el));
    setSelRaw([el.id]);
  }, [mutate]);
  const replaceSelectedPhoto = useCallback((photo: Photo) => {
    const { pageIndex: pi, selection: ids } = live.current;
    if (ids.length !== 1) return;
    mutate((s) => replacePhoto(addPhotos(s, [photo]), pi, ids[0], photo.id));
  }, [mutate]);

  /* pages */
  const pageAdd = useCallback(() => {
    const at = live.current.pageIndex + 1;
    mutate((s) => addPage(s, emptyPage(s.background), at));
    goTo(at);
  }, [mutate, goTo]);
  const pageDuplicate = useCallback(() => {
    const at = live.current.pageIndex;
    mutate((s) => duplicatePage(s, at));
    goTo(at + 1);
  }, [mutate, goTo]);
  const pageDelete = useCallback(() => {
    const at = live.current.pageIndex;
    mutate((s) => removePage(s, at));
    goTo(Math.max(0, at - 1));
  }, [mutate, goTo]);
  const pageMove = useCallback((from: number, to: number) => {
    mutate((s) => movePage(s, from, to));
    goTo(to);
  }, [mutate, goTo]);
  const pageShuffle = useCallback(() => {
    const at = live.current.pageIndex;
    mutate((s) => shuffleLayout(s, at, newSeed()));
    setSelRaw([]);
  }, [mutate]);

  return {
    pageIndex, page, selection, cropId, editingId, setCropId, setEditingId, goTo, select, jump, patch, patchSelected, commitOverrides,
    remove, duplicate, nudge, zOrder, addText, addRect, addSlot, dropPhoto, replaceSelectedPhoto,
    pageAdd, pageDuplicate, pageDelete, pageMove, pageShuffle, pxPerPage,
  };
}
export type Editor = ReturnType<typeof useEditor>;
