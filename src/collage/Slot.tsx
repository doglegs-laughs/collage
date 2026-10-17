import { useRef, useState, type DragEvent, type KeyboardEvent } from 'react';
import { cropBox, DEFAULT_CROP, MAX_ZOOM, panBy, zoomAt, type Crop } from '../core/geometry';
import type { Photo } from '../core/images';
import { PhotoFrame } from '../ui/PhotoFrame';
import { Slider } from '../ui/Controls';
import { startReorder } from './reorder';
import type { Placement } from './placements';

type Props = {
  index: number;
  placement: Placement | null;
  photo: Photo | undefined;
  aspect: number;
  onCrop: (index: number, crop: Crop) => void;
  onRemove: (index: number) => void;
  onSwap: (from: number, to: number) => void;
  onPickEmpty: (index: number) => void;
  onDropFiles: (index: number, files: File[]) => void;
};

const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');

export function Slot({ index, placement, photo, aspect, onCrop, onRemove, onSwap, onPickEmpty, onDropFiles }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [selected, setSelected] = useState(false);
  const filled = !!(placement && photo);

  const dropProps = {
    onDragOver: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      ref.current?.classList.add('over');
    },
    onDragLeave: () => ref.current?.classList.remove('over'),
    onDrop: (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      ref.current?.classList.remove('over');
      onDropFiles(index, [...e.dataTransfer.files]);
    },
  };

  if (!filled) {
    return (
      <div
        ref={ref}
        className="slot empty"
        data-slot={index}
        data-testid="slot-empty"
        role="button"
        tabIndex={0}
        aria-label={`Add photo to box ${index + 1}`}
        onClick={() => onPickEmpty(index)}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onPickEmpty(index))}
        {...dropProps}
      >
        <span className="overlay badge">{index + 1}</span>
        <div className="empty-cta">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="4" /><path d="M12 8v8M8 12h8" /></svg>
          <span>Add photo</span>
        </div>
      </div>
    );
  }

  const { crop } = placement;
  const setZoom = (z: number) => onCrop(index, zoomAt(photo, crop, aspect, z));

  const onKeyDown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const step = e.shiftKey ? 0.2 : 0.05;
    const pan = (dx: number, dy: number) => {
      const box = cropBox(photo, crop, aspect);
      // The picture follows the arrow, like dragging it.
      onCrop(index, panBy(photo, crop, aspect, -dx * step * box.w, -dy * step * box.h));
    };
    switch (e.key) {
      case 'Delete': case 'Backspace': onRemove(index); break;
      case 'ArrowLeft': pan(-1, 0); break;
      case 'ArrowRight': pan(1, 0); break;
      case 'ArrowUp': pan(0, -1); break;
      case 'ArrowDown': pan(0, 1); break;
      case '+': case '=': setZoom(crop.zoom * 1.1); break;
      case '-': case '_': setZoom(crop.zoom / 1.1); break;
      case '0': onCrop(index, { ...DEFAULT_CROP }); break;
      default: return;
    }
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      className={`slot filled ${selected ? 'selected' : ''}`}
      data-slot={index}
      data-testid="slot-filled"
      tabIndex={0}
      onFocus={() => setSelected(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setSelected(false)}
      onKeyDown={onKeyDown}
      {...dropProps}
    >
      <PhotoFrame photo={photo} crop={crop} aspect={aspect} interactive onCropChange={(c) => onCrop(index, c)} className="slot-frame">
        <button
          type="button"
          data-no-pan
          className="overlay badge"
          title="Drag to reorder"
          aria-label={`Photo ${index + 1}, drag to reorder`}
          onPointerDown={(e) => e.button === 0 && ref.current && startReorder(e, index, ref.current, onSwap)}
        >
          ⠿ {index + 1}
        </button>
        <button type="button" data-no-pan className="overlay remove" title="Remove" aria-label={`Remove photo ${index + 1}`} onClick={() => onRemove(index)}>×</button>
        <div data-no-pan className="overlay zoom-bar">
          <Slider value={crop.zoom} min={1} max={MAX_ZOOM} step={0.01} onChange={setZoom} label={`Zoom photo ${index + 1}`} format={() => ''} className="zoom-range" />
        </div>
      </PhotoFrame>
    </div>
  );
}
