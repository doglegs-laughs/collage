import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { getObjectUrl, getThumbnailUrl, isImageFile, type Photo } from '../core/images';
import { Button } from './Controls';

export const PHOTO_DRAG_TYPE = 'application/x-collage-photo';

function usePhotoThumb(photo: Photo): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    getThumbnailUrl(photo).then((u) => live && setUrl(u), () => {});
    return () => { live = false; };
  }, [photo]);
  return url;
}

function useFullUrl(photo: Photo | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    setUrl(null);
    if (!photo) return;
    let live = true;
    getObjectUrl(photo).then((u) => live && setUrl(u), () => {});
    return () => { live = false; };
  }, [photo]);
  return url;
}

const HOVER_DELAY = 600;
const HOVER_SIZE = 320;

function HoverPreview({ photo, x, y }: { photo: Photo; x: number; y: number }) {
  const thumb = usePhotoThumb(photo);
  const full = useFullUrl(photo);
  const left = Math.min(Math.max(8, x + 18), window.innerWidth - HOVER_SIZE - 8);
  const top = Math.min(Math.max(8, y + 18), window.innerHeight - HOVER_SIZE - 8);
  return createPortal(
    <div className="hover-preview" style={{ left, top, width: HOVER_SIZE, height: HOVER_SIZE }} aria-hidden="true">
      {(full ?? thumb) && <img src={full ?? thumb ?? ''} alt="" draggable={false} />}
    </div>,
    document.body,
  );
}

/** Number of grid columns, read from the laid-out positions of the thumbnails. */
function gridColumns(picks: HTMLElement[]): number {
  const top = picks[0]?.getBoundingClientRect().top ?? 0;
  const next = picks.findIndex((p) => p.getBoundingClientRect().top > top + 2);
  return next < 0 ? Math.max(1, picks.length) : next;
}

function Thumb({ photo, order, onToggle, onRemove, onPreview, hoverEnabled }: {
  photo: Photo; order: number; onToggle: () => void; onRemove: () => void; onPreview: () => void; hoverEnabled: boolean;
}) {
  const url = usePhotoThumb(photo);
  const selected = order > 0;
  const [hover, setHover] = useState<{ x: number; y: number } | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const pos = useRef({ x: 0, y: 0 });
  const cancelHover = useCallback(() => { window.clearTimeout(timer.current); setHover(null); }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => { if (!hoverEnabled) cancelHover(); }, [hoverEnabled, cancelHover]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === ' ') { e.preventDefault(); cancelHover(); onPreview(); return; }
    if (!['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp'].includes(e.key)) return;
    const picks = [...(e.currentTarget.closest('.tray-grid')?.querySelectorAll<HTMLButtonElement>('.tray-pick') ?? [])];
    const cols = gridColumns(picks);
    const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols, ArrowUp: -cols }[e.key] ?? 0;
    e.preventDefault();
    picks[picks.indexOf(e.currentTarget) + delta]?.focus();
  };

  return (
    <div className="tray-item">
      <button
        type="button"
        className={`tray-pick ${selected ? 'selected' : ''}`}
        data-photo-id={photo.id}
        aria-pressed={selected}
        title={photo.name}
        draggable
        onDragStart={(e) => { cancelHover(); e.dataTransfer.setData(PHOTO_DRAG_TYPE, photo.id); e.dataTransfer.effectAllowed = 'copy'; }}
        onClick={onToggle}
        onDoubleClick={() => { cancelHover(); onPreview(); }}
        onKeyDown={onKeyDown}
        onKeyUp={(e) => { if (e.key === ' ') e.preventDefault(); }}
        onMouseMove={(e) => {
          pos.current = { x: e.clientX, y: e.clientY };
          if (hover) setHover(pos.current);
        }}
        onMouseEnter={() => {
          if (!hoverEnabled) return;
          window.clearTimeout(timer.current);
          timer.current = window.setTimeout(() => setHover(pos.current), HOVER_DELAY);
        }}
        onMouseLeave={cancelHover}
      >
        {url ? <img src={url} alt={photo.name} draggable={false} /> : null}
        <span className="tray-check">{selected ? order : ''}</span>
      </button>
      <button type="button" className="tray-zoom" aria-label={`Preview ${photo.name}`} title="Preview (Space)" onClick={() => { cancelHover(); onPreview(); }}>
        <svg viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
          <circle cx="6.8" cy="6.8" r="4.3" /><path d="M10 10l3.5 3.5" />
        </svg>
      </button>
      <button type="button" className="tray-remove" aria-label={`Remove ${photo.name}`} title="Remove" onClick={onRemove}>×</button>
      {hover && hoverEnabled && <HoverPreview photo={photo} x={hover.x} y={hover.y} />}
    </div>
  );
}

type LightboxProps = {
  photos: Photo[];
  index: number;
  selected: string[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onGo: (index: number) => void;
  onClose: () => void;
};

function Lightbox({ photos, index, selected, onToggle, onRemove, onGo, onClose }: LightboxProps) {
  const photo = photos[index];
  const root = useRef<HTMLDivElement>(null);
  const thumb = usePhotoThumb(photo);
  const full = useFullUrl(photo);
  const included = selected.includes(photo.id);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const fullReady = !!full && loadedFor === full;

  useEffect(() => { root.current?.focus(); }, []);

  const go = (d: number) => { const n = index + d; if (n >= 0 && n < photos.length) onGo(n); };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const onButton = (e.target as HTMLElement).tagName === 'BUTTON';
    switch (e.key) {
      case 'Escape': case ' ': e.preventDefault(); e.stopPropagation(); onClose(); break;
      case 'ArrowLeft': e.preventDefault(); go(-1); break;
      case 'ArrowRight': e.preventDefault(); go(1); break;
      case 'i': case 'I': e.preventDefault(); onToggle(photo.id); break;
      case 'Enter': if (!onButton) { e.preventDefault(); onToggle(photo.id); } break;
      case 'Tab': {
        const items = [...(root.current?.querySelectorAll<HTMLElement>('button:not([disabled])') ?? [])];
        if (!items.length) break;
        const first = items[0], last = items[items.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === root.current)) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
        break;
      }
      default: return;
    }
  };

  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={`Preview of ${photo.name}`} ref={root} tabIndex={-1} onKeyDown={onKeyDown} data-testid="photo-preview">
      <div className="lightbox-backdrop" onMouseDown={onClose} />
      <div className="lightbox-stage">
        {thumb && !fullReady && <img className="lightbox-img lightbox-low" src={thumb} alt="" draggable={false} />}
        {full && <img className={`lightbox-img ${fullReady ? 'ready' : ''}`} src={full} alt={photo.name} draggable={false} onLoad={() => setLoadedFor(full)} />}
      </div>
      <button type="button" className="lightbox-nav prev" aria-label="Previous photo" disabled={index === 0} onClick={() => go(-1)}>‹</button>
      <button type="button" className="lightbox-nav next" aria-label="Next photo" disabled={index === photos.length - 1} onClick={() => go(1)}>›</button>
      <div className="lightbox-bar">
        <div className="lightbox-meta">
          <strong title={photo.name}>{photo.name}</strong>
          <span>{photo.width} × {photo.height} px</span>
          <span className="lightbox-pos" data-testid="preview-position">{index + 1} / {photos.length}</span>
        </div>
        <div className="lightbox-actions">
          <button type="button" className={`lightbox-include ${included ? 'on' : ''}`} role="checkbox" aria-checked={included} onClick={() => onToggle(photo.id)}>
            <span className="lightbox-box" aria-hidden="true">{included ? '✓' : ''}</span>
            {included ? 'Included' : 'Not included'}
          </button>
          <button type="button" className="lightbox-remove" onClick={() => onRemove(photo.id)}>Remove from library</button>
          <button type="button" className="lightbox-close" aria-label="Close preview" onClick={onClose}>×</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

type Props = {
  photos: Photo[];
  /** Selected photo ids in selection order. */
  selected: string[];
  onToggle: (id: string) => void;
  onRemove: (id: string) => void;
  onImport: () => void;
  onDropFiles: (files: File[]) => void;
  onSelectAll?: () => void;
  onSelectNone?: () => void;
  /** Removes every photo; shown with a confirmation. */
  onClearAll?: () => void;
  /** Extra sentence for the clear-all confirmation. */
  clearNote?: string;
  title?: string;
  className?: string;
};

export function PhotoTray({ photos, selected, onToggle, onRemove, onImport, onDropFiles, onSelectAll, onSelectNone, onClearAll, clearNote, title = 'Photos', className = '' }: Props) {
  const [over, setOver] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const restoreFocus = useRef<string | null>(null);
  const section = useRef<HTMLElement>(null);
  const previewIndex = previewId ? photos.findIndex((p) => p.id === previewId) : -1;
  const open = previewIndex >= 0;
  useEffect(() => { if (previewId && previewIndex < 0) setPreviewId(null); }, [previewId, previewIndex]);
  useEffect(() => { if (photos.length === 0) setConfirmClear(false); }, [photos.length]);
  const closePreview = () => {
    restoreFocus.current = previewId;
    setPreviewId(null);
  };
  useEffect(() => {
    if (previewId || !restoreFocus.current) return;
    const id = restoreFocus.current;
    restoreFocus.current = null;
    [...(section.current?.querySelectorAll<HTMLElement>('.tray-pick') ?? [])].find((el) => el.dataset.photoId === id)?.focus();
  }, [previewId]);
  const removeFromPreview = (id: string) => {
    const i = photos.findIndex((p) => p.id === id);
    const neighbour = photos[i + 1] ?? photos[i - 1];
    onRemove(id);
    setPreviewId(neighbour ? neighbour.id : null);
  };
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  return (
    <section
      ref={section}
      className={`tray ${over ? 'dropping' : ''} ${className}`}
      aria-label={title}
      onDragOver={(e) => { if (hasFiles(e)) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setOver(false); }}
      onDrop={(e) => {
        setOver(false);
        if (!hasFiles(e)) return;
        e.preventDefault();
        const files = [...e.dataTransfer.files].filter(isImageFile);
        if (files.length) onDropFiles(files);
      }}
    >
      <div className="section-head">
        <h2 className="section-title">{title}</h2>
        <span className="section-note">{selected.length} of {photos.length} selected</span>
      </div>
      <Button variant="soft" block onClick={onImport}>Add photos</Button>
      {photos.length > 0 && !confirmClear && (onSelectAll || onSelectNone || onClearAll) && (
        <div className="tray-actions">
          {onSelectAll && <button type="button" className="link" onClick={onSelectAll}>Select all</button>}
          {onSelectNone && <button type="button" className="link" onClick={onSelectNone}>None</button>}
          {onClearAll && <button type="button" className="link danger tray-clear" onClick={() => setConfirmClear(true)}>Clear all</button>}
        </div>
      )}
      {photos.length > 0 && confirmClear && onClearAll && (
        <div className="tray-confirm" role="alertdialog" aria-label="Confirm clear all">
          <p>Remove all {photos.length} photo{photos.length === 1 ? '' : 's'} from this pane?{clearNote ? ` ${clearNote}` : ''}</p>
          <div className="tray-confirm-actions">
            <button type="button" className="link danger" autoFocus onClick={() => { setConfirmClear(false); setPreviewId(null); onClearAll(); }}>Remove all</button>
            <button type="button" className="link" onClick={() => setConfirmClear(false)}>Cancel</button>
          </div>
        </div>
      )}
      {photos.length === 0 ? (
        <p className="hint">Drop photos here, or paste with ⌘V / Ctrl+V.</p>
      ) : (
        <div className="tray-grid">
          {photos.map((p) => (
            <Thumb key={p.id} photo={p} order={selected.indexOf(p.id) + 1} onToggle={() => onToggle(p.id)} onRemove={() => onRemove(p.id)} onPreview={() => setPreviewId(p.id)} hoverEnabled={!open} />
          ))}
        </div>
      )}
      {open && (
        <Lightbox photos={photos} index={previewIndex} selected={selected} onToggle={onToggle} onRemove={removeFromPreview}
          onGo={(i) => setPreviewId(photos[i].id)} onClose={closePreview} />
      )}
    </section>
  );
}
