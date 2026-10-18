import { useCallback, useRef, useState, type RefObject } from 'react';
import { clampCrop, cropBox, panBy } from '../core/geometry';
import type { El, Photo } from './model';
import { layoutElementPx } from './render';
import { boxXs, boxYs, NO_GUIDES, normalizeAngle, resizeBox, snapAxis, snapTargets, unionBox, type Guides, type Handle } from './snap';

export type Overrides = Record<string, Partial<El>>;
export const SNAP_PX = 6;
const MIN_PX = 14;
const START_PX = 3;

type Inputs = {
  pageRef: RefObject<HTMLElement>;
  W: number;
  H: number;
  /** Elements of the current page (own, selectable). */
  elements: El[];
  /** Everything drawn on the page, used as snap targets. */
  visible: El[];
  getPhoto: (id: string | null) => Photo | undefined;
  commit: (patches: Overrides) => void;
  /** Called when a move ends; return true when the drop was handled elsewhere (the move is then discarded). */
  dropOut?: (at: { clientX: number; clientY: number }, ids: readonly string[]) => boolean;
};

type Compute = (dx: number, dy: number, ev: PointerEvent) => { patches: Overrides; guides?: Guides };

/**
 * Pointer-driven move / resize / rotate. While dragging, results live in `overrides`
 * (applied by the stage on top of the story); the story is only touched on pointer-up.
 */
export function useCanvasDrag(inputs: Inputs) {
  const [overrides, setOverrides] = useState<Overrides>({});
  const [guides, setGuides] = useState<Guides>(NO_GUIDES);
  const [panning, setPanning] = useState(false);
  const live = useRef(inputs);
  live.current = inputs;

  const run = useCallback((e: { clientX: number; clientY: number }, compute: Compute, handled?: (up: PointerEvent) => boolean, finished?: () => void) => {
    const sx = e.clientX;
    const sy = e.clientY;
    let moved = false;
    let last: Overrides = {};
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      if (!moved && Math.hypot(dx, dy) < START_PX) return;
      moved = true;
      const r = compute(dx, dy, ev);
      last = r.patches;
      setOverrides(last);
      setGuides(r.guides ?? NO_GUIDES);
    };
    const onUp = (up: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      setOverrides({});
      setGuides(NO_GUIDES);
      finished?.();
      if (moved && !(up.type === 'pointerup' && handled?.(up))) live.current.commit(last);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  }, []);

  const startMove = useCallback((e: { clientX: number; clientY: number }, ids: readonly string[]) => {
    const { elements, visible, W, H } = live.current;
    const sel = elements.filter((el) => ids.includes(el.id));
    if (!sel.length) return;
    const bb = unionBox(sel.map((el) => layoutElementPx(el, W, H).outer));
    const others = visible.filter((v) => !ids.includes(v.id)).map((v) => layoutElementPx(v, W, H).outer);
    const t = snapTargets(W, H, others);
    run(e, (dx, dy, ev) => {
      let mx = dx;
      let my = dy;
      let guides = NO_GUIDES;
      if (!ev.altKey) {
        const sxr = snapAxis(boxXs({ ...bb, x: bb.x + dx }), t.xs, SNAP_PX);
        const syr = snapAxis(boxYs({ ...bb, y: bb.y + dy }), t.ys, SNAP_PX);
        mx += sxr.delta;
        my += syr.delta;
        guides = { x: sxr.hits, y: syr.hits };
      }
      const patches: Overrides = {};
      for (const el of sel) patches[el.id] = { x: el.x + mx / W, y: el.y + my / H };
      return { patches, guides };
    }, (up) => live.current.dropOut?.(up, ids) ?? false);
  }, [run]);

  /** Pan the photo inside its frame (no whitespace is ever revealed). The frame stays put; one gesture is one commit. */
  const startPan = useCallback((e: { clientX: number; clientY: number }, id: string) => {
    const { elements, W, H, getPhoto } = live.current;
    const el = elements.find((x) => x.id === id);
    if (!el || el.kind !== 'photo') return;
    const photo = getPhoto(el.photoId);
    const { inner } = layoutElementPx(el, W, H);
    if (!photo || inner.w <= 0 || inner.h <= 0) return;
    const aspect = inner.w / inner.h;
    const box = cropBox(photo, el.crop, aspect);
    const rad = (-el.rotation * Math.PI) / 180;
    setPanning(true);
    run(e, (dx, dy) => {
      const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
      const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
      return { patches: { [id]: { crop: panBy(photo, el.crop, aspect, (-lx * box.w) / inner.w, (-ly * box.h) / inner.h) } as Partial<El> } };
    }, undefined, () => setPanning(false));
  }, [run]);

  const startResize = useCallback((e: { clientX: number; clientY: number }, id: string, handle: Handle) => {
    const { elements, visible, W, H, getPhoto } = live.current;
    const el = elements.find((x) => x.id === id);
    if (!el) return;
    const L = layoutElementPx(el, W, H);
    const start = { cx: L.cx, cy: L.cy, w: L.outer.w, h: L.outer.h, rotation: el.rotation };
    const corner = handle.length === 2;
    const others = visible.filter((v) => v.id !== id).map((v) => layoutElementPx(v, W, H).outer);
    const t = snapTargets(W, H, others);
    run(e, (dx, dy, ev) => {
      const lock = corner && !ev.shiftKey;
      let r = resizeBox(start, handle, dx, dy, { lockAspect: lock, min: MIN_PX });
      let guides = NO_GUIDES;
      if (!lock && !el.rotation && !ev.altKey) {
        // Snap the moving edges of an unrotated box.
        const box = { x: r.cx - r.w / 2, y: r.cy - r.h / 2, w: r.w, h: r.h };
        const west = handle.includes('w');
        const east = handle.includes('e');
        const north = handle.includes('n');
        const south = handle.includes('s');
        const sxr = east || west ? snapAxis([west ? box.x : box.x + box.w], t.xs, SNAP_PX) : { delta: 0, hits: [] };
        const syr = north || south ? snapAxis([north ? box.y : box.y + box.h], t.ys, SNAP_PX) : { delta: 0, hits: [] };
        const nx = box.x + (west ? sxr.delta : 0);
        const nw = box.w + (west ? -sxr.delta : east ? sxr.delta : 0);
        const ny = box.y + (north ? syr.delta : 0);
        const nh = box.h + (north ? -syr.delta : south ? syr.delta : 0);
        if (nw >= MIN_PX && nh >= MIN_PX) r = { cx: nx + nw / 2, cy: ny + nh / 2, w: nw, h: nh };
        guides = { x: sxr.hits, y: syr.hits };
      }
      const patch: Partial<El> = { x: (r.cx - r.w / 2) / W, y: (r.cy - r.h / 2) / H, w: r.w / W, h: r.h / H };
      if (el.kind === 'text' && lock) (patch as { size: number }).size = el.size * (r.w / start.w);
      if (el.kind === 'photo') {
        const photo = getPhoto(el.photoId);
        const innerW = r.w - 2 * L.frame;
        const innerH = r.h - 2 * L.frame - L.frameBottom;
        if (photo && innerW > 0 && innerH > 0) (patch as { crop: typeof el.crop }).crop = clampCrop(photo, el.crop, innerW / innerH);
      }
      return { patches: { [id]: patch }, guides };
    });
  }, [run]);

  const startRotate = useCallback((e: { clientX: number; clientY: number }, id: string) => {
    const { elements, W, H, pageRef } = live.current;
    const el = elements.find((x) => x.id === id);
    const rect = pageRef.current?.getBoundingClientRect();
    if (!el || !rect) return;
    const L = layoutElementPx(el, W, H);
    const angleAt = (cx: number, cy: number) => (Math.atan2(cy - (rect.top + L.cy), cx - (rect.left + L.cx)) * 180) / Math.PI + 90;
    const offset = angleAt(e.clientX, e.clientY) - el.rotation;
    run(e, (dx, dy, ev) => {
      let a = angleAt(e.clientX + dx, e.clientY + dy) - offset;
      if (ev.shiftKey) a = Math.round(a / 15) * 15;
      return { patches: { [id]: { rotation: Math.round(normalizeAngle(a) * 10) / 10 } } };
    });
  }, [run]);

  return { overrides, guides, panning, startMove, startPan, startResize, startRotate };
}
