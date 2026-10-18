import { useCallback, useMemo, useRef, useState } from 'react';
import { clamp } from '../core/geometry';
import type { Photo } from '../core/images';
import {
  addElement, addPage, addPhotos, aspectRatio, defaultPhotoEl, defaultRectEl, defaultTextEl, duplicatePage, duplicateElements, emptyPage, groupOf, movePageTo, photoIdsInUse, removeElements, setPageHidden,
  removePage, reorderZ, replacePhoto, updateElements, type El, type Page, type Story, type ZMove,
} from './model';
import { moveToOwnPage } from './split';
import { applyLayout, nextLayout, pageSeed, type LayoutOption } from './layouts';
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
    const { story: s, pageIndex: pi } = live.current;
    const at = groupOf(s, pi).end;
    mutate((st) => addPage(st, emptyPage(st.background), at));
    goTo(at);
  }, [mutate, goTo]);
  const pageDuplicate = useCallback(() => {
    const { story: s, pageIndex: pi } = live.current;
    const at = groupOf(s, pi).end;
    mutate((st) => duplicatePage(st, pi));
    goTo(at);
  }, [mutate, goTo]);
  const pageDelete = useCallback(() => {
    const { story: s, pageIndex: pi } = live.current;
    const { start, end } = groupOf(s, pi);
    if (end - start > 1 && typeof window !== 'undefined' && !window.confirm(`Delete this spread (${end - start} pages)?`)) return;
    mutate((st) => removePage(st, pi));
    goTo(Math.max(0, start - 1));
  }, [mutate, goTo]);
  const pageMove = useCallback((from: number, to: number) => {
    const r = movePageTo(live.current.story, from, to);
    mutate((s) => movePageTo(s, from, to).story);
    goTo(r.index);
  }, [mutate, goTo]);
  /** Hide or show a page (with its spread group) in exports: one undo step. */
  const toggleHidden = useCallback((index?: number) => {
    const { story: s, pageIndex: pi } = live.current;
    const at = index ?? pi;
    const page = s.pages[at];
    if (!page) return;
    mutate((st) => setPageHidden(st, at, !page.hidden));
  }, [mutate]);
  /** Send a photo (default: the selected one) to a page of its own, as one undo step. Returns the new page's index, or null when not possible. */
  const moveOwn = useCallback((elementId?: string, insertAt?: number): number | null => {
    const { story: s, pageIndex: pi, selection: sel } = live.current;
    const id = elementId ?? (sel.length === 1 ? sel[0] : undefined);
    if (!id) return null;
    const r = moveToOwnPage(s, pi, id, { seed: pageSeed(s, pi), insertAt });
    if (!r) return null;
    mutate(() => r.story);
    goTo(r.pageIndex);
    return r.pageIndex;
  }, [mutate, goTo]);
  /** Switch the current page (or spread) to a layout: one undo step. `extra` are library photos that may fill additional slots. */
  const pageLayout = useCallback((option: LayoutOption, extra: Photo[] = []) => {
    const { story: s, pageIndex: pi } = live.current;
    const base = addPhotos(s, extra);
    const r = applyLayout(base, pi, option, { seed: pageSeed(s, pi), extraPhotoIds: extra.map((p) => p.id) });
    if (r.story === base) return;
    // Library photos that ended up on no page do not belong in the story's photo list.
    const used = photoIdsInUse(r.story);
    const skip = new Set(extra.filter((p) => !used.has(p.id) && !s.photos.some((q) => q.id === p.id)).map((p) => p.id));
    const next = skip.size ? { ...r.story, photos: r.story.photos.filter((p) => !skip.has(p.id)) } : r.story;
    mutate(() => next);
    goTo(r.pageIndex);
  }, [mutate, goTo]);
  /** Step to the previous / next layout with the same photos. */
  const cycleLayout = useCallback((direction: 1 | -1) => {
    const { story: s, pageIndex: pi } = live.current;
    const option = nextLayout(s, pi, direction);
    if (option) pageLayout(option);
  }, [pageLayout]);

  return {
    pageIndex, page, selection, cropId, editingId, setCropId, setEditingId, goTo, select, jump, patch, patchSelected, commitOverrides,
    remove, duplicate, nudge, zOrder, addText, addRect, addSlot, dropPhoto, replaceSelectedPhoto,
    pageAdd, pageDuplicate, pageDelete, pageMove, toggleHidden, moveOwn, pageLayout, cycleLayout, pxPerPage,
  };
}
export type Editor = ReturnType<typeof useEditor>;
