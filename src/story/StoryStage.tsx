import { useCallback, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent as ReactPointerEvent } from 'react';
import type { Crop } from '../core/geometry';
import { PHOTO_DRAG_TYPE } from '../ui/PhotoTray';
import { ElementView } from './ElementView';
import { aspectRatio, elementsVisibleOnPage, findPhoto, sortByZ, type El, type Story, type VisibleEl } from './model';
import { layoutElementPx } from './render';
import { HANDLES, type Handle } from './snap';
import { useCanvasDrag, type Overrides } from './useCanvasDrag';

const GHOST_MARGIN = 0.14;

export type DropHit = { elementId: string | null; x: number; y: number };
export type StageProps = {
  story: Story;
  pageIndex: number;
  selection: string[];
  cropId: string | null;
  editingId: string | null;
  onSelect: (ids: string[]) => void;
  onJump: (page: number, elementId: string) => void;
  onCommit: (patches: Overrides) => void;
  onCrop: (id: string, crop: Crop) => void;
  onText: (id: string, text: string) => void;
  setCropId: (id: string | null) => void;
  setEditingId: (id: string | null) => void;
  onDropPhoto: (photoId: string, hit: DropHit) => void;
  onScale: (pageWidthPx: number) => void;
};

/** Elements that stick out of their own page: drawn faintly beyond the page edges. */
function overflowing(story: Story, pageIndex: number): VisibleEl[] {
  const out: VisibleEl[] = [];
  story.pages.forEach((page, j) => {
    if (Math.abs(j - pageIndex) > 3) return;
    const shift = j - pageIndex;
    for (const el of page.elements) {
      if (el.x < -1e-9 || el.x + el.w > 1 + 1e-9) out.push({ ...el, x: el.x + shift, ghostOf: j });
    }
  });
  return sortByZ(out);
}

export function StoryStage(p: StageProps) {
  const { story, pageIndex, selection } = p;
  const stage = useRef<HTMLDivElement>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 800, h: 600 });
  const [hot, setHot] = useState<string | null>(null);

  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const read = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const ratio = aspectRatio(story.aspect);
  const W = Math.max(120, Math.min(box.w / (1 + 2 * GHOST_MARGIN), (box.h - 24) * ratio));
  const H = W / ratio;
  const { onScale } = p;
  useLayoutEffect(() => onScale(W), [W, onScale]);

  const page = story.pages[pageIndex];
  const visible = useMemo(() => sortByZ(elementsVisibleOnPage(story, pageIndex)), [story, pageIndex]);
  const ghosts = useMemo(() => overflowing(story, pageIndex), [story, pageIndex]);
  const getPhoto = useCallback((id: string | null) => findPhoto(story, id), [story]);

  const drag = useCanvasDrag({ pageRef, W, H, elements: page?.elements ?? [], visible, getPhoto, commit: p.onCommit });
  const { overrides } = drag;
  const show = useCallback((el: El): El => (overrides[el.id] ? ({ ...el, ...overrides[el.id] } as El) : el), [overrides]);

  if (!page) return <div className="story-stage" ref={stage} />;

  const selectedEls = page.elements.filter((e) => selection.includes(e.id)).map(show);
  const single = selectedEls.length === 1 && !p.cropId && !p.editingId ? selectedEls[0] : null;

  const onPageDown = (e: ReactPointerEvent) => {
    if (e.button !== 0) return;
    (document.activeElement as HTMLElement | null)?.blur?.();
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-el-id]');
    const id = target?.dataset.elId ?? null;
    if (p.cropId && id !== p.cropId) p.setCropId(null);
    if (p.editingId && id !== p.editingId) p.setEditingId(null);
    if (!target || !id) {
      if (!e.shiftKey) p.onSelect([]);
      return;
    }
    if (target.dataset.ghost !== undefined) {
      p.onJump(Number(target.dataset.ghost), id);
      return;
    }
    if (id === p.cropId || id === p.editingId) return;
    if (e.shiftKey) {
      p.onSelect(selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id]);
      return;
    }
    const ids = selection.includes(id) ? selection : [id];
    if (!selection.includes(id)) p.onSelect(ids);
    drag.startMove(e, ids);
  };

  const onDouble = (e: React.MouseEvent) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('[data-el-id]');
    if (!target || target.dataset.ghost !== undefined) return;
    const id = target.dataset.elId!;
    p.onSelect([id]);
    if (target.dataset.kind === 'photo' && page.elements.find((x) => x.id === id && x.kind === 'photo' && x.photoId)) p.setCropId(id);
    else if (target.dataset.kind === 'text') p.setEditingId(id);
  };

  const dropAt = (e: DragEvent): DropHit | null => {
    const rect = pageRef.current?.getBoundingClientRect();
    if (!rect) return null;
    const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-el-id][data-kind="photo"]');
    return { elementId: hit && hit.dataset.ghost === undefined ? hit.dataset.elId ?? null : null, x: (e.clientX - rect.left) / W, y: (e.clientY - rect.top) / H };
  };
  const hasPhoto = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes(PHOTO_DRAG_TYPE);

  return (
    <div
      className="story-stage"
      ref={stage}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) {
          p.onSelect([]);
          p.setCropId(null);
          p.setEditingId(null);
        }
      }}
    >
      <div className="story-page-wrap" style={{ width: W, height: H }}>
        <div className="story-ghost" aria-hidden="true">
          {ghosts.map((el) => <ElementView key={`${el.ghostOf}-${el.id}`} el={el} W={W} H={H} photo={getPhoto(el.kind === 'photo' ? el.photoId : null)} />)}
        </div>
        <div
          ref={pageRef}
          className="story-page"
          data-testid="story-page"
          style={{ background: page.background }}
          onPointerDown={onPageDown}
          onDoubleClick={onDouble}
          onDragOver={(e) => {
            if (!hasPhoto(e)) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'copy';
            const h = dropAt(e);
            setHot(h?.elementId ?? null);
          }}
          onDragLeave={(e) => { if (e.currentTarget === e.target) setHot(null); }}
          onDrop={(e) => {
            setHot(null);
            if (!hasPhoto(e)) return;
            e.preventDefault();
            const hit = dropAt(e);
            const id = e.dataTransfer.getData(PHOTO_DRAG_TYPE);
            if (hit && id) p.onDropPhoto(id, hit);
          }}
        >
          {visible.map((v) => {
            const el = show(v);
            return (
              <ElementView
                key={`${v.ghostOf ?? 'own'}-${v.id}`}
                el={el} W={W} H={H} ghostOf={v.ghostOf}
                photo={getPhoto(el.kind === 'photo' ? el.photoId : null)}
                cropping={p.cropId === v.id}
                editing={p.editingId === v.id}
                hot={hot === v.id}
                onCrop={p.onCrop}
                onText={p.onText}
                onEditEnd={() => p.setEditingId(null)}
              />
            );
          })}
        </div>
        <div className="story-overlay">
          {selectedEls.map((el) => {
            const L = layoutElementPx(el, W, H);
            return (
              <div
                key={el.id}
                className={`sel-box ${single ? 'single' : ''} ${p.cropId === el.id ? 'cropping' : ''}`}
                data-testid="selection-box"
                style={{ left: L.outer.x, top: L.outer.y, width: L.outer.w, height: L.outer.h, transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined }}
              >
                {single && (
                  <>
                    {HANDLES.map((h: Handle) => (
                      <i
                        key={h}
                        className={`handle h-${h}`}
                        data-handle={h}
                        onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); drag.startResize(e, el.id, h); }}
                      />
                    ))}
                    <i className="rot-line" />
                    <i className="handle rotate" data-handle="rotate" title="Rotate (Shift snaps to 15°)" onPointerDown={(e) => { e.stopPropagation(); e.preventDefault(); drag.startRotate(e, el.id); }} />
                  </>
                )}
              </div>
            );
          })}
          {drag.guides.x.map((x) => <i key={`gx${x}`} className="guide v" style={{ left: x }} />)}
          {drag.guides.y.map((y) => <i key={`gy${y}`} className="guide h" style={{ top: y }} />)}
          {p.cropId && <div className="crop-hint">Drag to pan, scroll to zoom. Enter to finish.</div>}
        </div>
      </div>
    </div>
  );
}
