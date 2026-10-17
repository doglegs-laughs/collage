import { useEffect, useState, type DragEvent } from 'react';
import { getThumbnailUrl, isImageFile, type Photo } from '../core/images';
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

function Thumb({ photo, order, onToggle, onRemove }: { photo: Photo; order: number; onToggle: () => void; onRemove: () => void }) {
  const url = usePhotoThumb(photo);
  const selected = order > 0;
  return (
    <div className="tray-item">
      <button
        type="button"
        className={`tray-pick ${selected ? 'selected' : ''}`}
        aria-pressed={selected}
        title={photo.name}
        draggable
        onDragStart={(e) => { e.dataTransfer.setData(PHOTO_DRAG_TYPE, photo.id); e.dataTransfer.effectAllowed = 'copy'; }}
        onClick={onToggle}
      >
        {url ? <img src={url} alt={photo.name} draggable={false} /> : null}
        <span className="tray-check">{selected ? order : ''}</span>
      </button>
      <button type="button" className="tray-remove" aria-label={`Remove ${photo.name}`} title="Remove" onClick={onRemove}>×</button>
    </div>
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
  title?: string;
  className?: string;
};

export function PhotoTray({ photos, selected, onToggle, onRemove, onImport, onDropFiles, onSelectAll, onSelectNone, title = 'Photos', className = '' }: Props) {
  const [over, setOver] = useState(false);
  const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
  return (
    <section
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
      {photos.length > 0 && (onSelectAll || onSelectNone) && (
        <div className="tray-actions">
          {onSelectAll && <button type="button" className="link" onClick={onSelectAll}>Select all</button>}
          {onSelectNone && <button type="button" className="link" onClick={onSelectNone}>None</button>}
        </div>
      )}
      {photos.length === 0 ? (
        <p className="hint">Drop photos here, or paste with ⌘V / Ctrl+V.</p>
      ) : (
        <div className="tray-grid">
          {photos.map((p) => (
            <Thumb key={p.id} photo={p} order={selected.indexOf(p.id) + 1} onToggle={() => onToggle(p.id)} onRemove={() => onRemove(p.id)} />
          ))}
        </div>
      )}
    </section>
  );
}
