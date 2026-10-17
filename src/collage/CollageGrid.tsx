import { useRef, type CSSProperties } from 'react';
import type { Size } from '../core/geometry';
import type { Photo } from '../core/images';
import { Slot } from './Slot';
import type { Slots } from './placements';
import { useStageFit } from './useStageFit';
import type { Crop } from '../core/geometry';

type Props = {
  slots: Slots;
  rows: number;
  columns: number;
  tileAspect: number;
  border: number;
  output: Size | null;
  dropping: boolean;
  getPhoto: (id: string) => Photo | undefined;
  onCrop: (index: number, crop: Crop) => void;
  onRemove: (index: number) => void;
  onSwap: (from: number, to: number) => void;
  onPickEmpty: (index: number) => void;
  onDropFiles: (index: number, files: File[]) => void;
};

export function CollageGrid(p: Props) {
  const stage = useRef<HTMLElement>(null);
  const aspect = p.output ? p.output.width / p.output.height : (p.columns * p.tileAspect) / p.rows;
  const width = useStageFit(stage, aspect);
  const gap = p.output ? (p.border * width) / p.output.width : 0;
  const style = { width, '--columns': p.columns, '--tile-aspect': p.tileAspect, '--gap': `${gap}px` } as CSSProperties;

  return (
    <main ref={stage} className={`stage ${p.dropping ? 'dropping' : ''}`} aria-label="Collage preview">
      <div className="collage-grid" data-testid="collage-grid" style={style}>
        {p.slots.map((placement, i) => (
          <Slot
            key={i}
            index={i}
            placement={placement}
            photo={placement ? p.getPhoto(placement.photoId) : undefined}
            aspect={p.tileAspect}
            onCrop={p.onCrop}
            onRemove={p.onRemove}
            onSwap={p.onSwap}
            onPickEmpty={p.onPickEmpty}
            onDropFiles={p.onDropFiles}
          />
        ))}
      </div>
    </main>
  );
}
