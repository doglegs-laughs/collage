import { useEffect, useRef, useState } from 'react';
import { getPreviewBitmap, type Photo } from '../core/images';
import { finishLayout } from './borderMath';
import type { BorderSettings } from './BorderControls';
import { drawBorder, prepareFonts } from './render';
import { messageOf } from './exportBorders';

/** The preview is drawn at this long edge; proportions match the export at any size. */
const PREVIEW_LONG_EDGE = 1080;

type Props = {
  photo: Photo;
  index: number;
  count: number;
  settings: BorderSettings;
  fill: string;
  onStep: (delta: number) => void;
};

export function BorderPreview({ photo, index, count, settings, fill, onStep }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const { finish, framePct, matPct, borderPct, shape, caption } = settings;

  useEffect(() => {
    let live = true;
    setError(null);
    Promise.all([getPreviewBitmap(photo), prepareFonts()])
      .then(([bitmap]) => {
        const canvas = canvasRef.current;
        if (!live || !canvas) return;
        const layout = finishLayout({ width: photo.width, height: photo.height }, { finish, framePct, matPct, borderPct, shape, longEdge: PREVIEW_LONG_EDGE });
        canvas.width = layout.canvasW;
        canvas.height = layout.canvasH;
        drawBorder(canvas.getContext('2d')!, bitmap, layout, { finish, fill, caption });
      })
      .catch((e: unknown) => {
        // A photo released mid-decode is not an error the person can act on.
        if (live && !(e instanceof DOMException && e.name === 'AbortError')) setError(messageOf(e));
      });
    return () => {
      live = false;
    };
  }, [photo, finish, framePct, matPct, borderPct, shape, fill, caption]);

  const output = finishLayout({ width: photo.width, height: photo.height }, settings);

  return (
    <>
      <div className="borders-head">
        <button type="button" className="borders-nav" aria-label="Previous photo" disabled={count < 2} onClick={() => onStep(-1)}>‹</button>
        <strong title={photo.name}>{photo.name}</strong>
        <span>{index + 1} / {count}</span>
        <button type="button" className="borders-nav" aria-label="Next photo" disabled={count < 2} onClick={() => onStep(1)}>›</button>
      </div>
      <div className="borders-canvas-wrap">
        <canvas ref={canvasRef} className="borders-canvas" aria-label={`Preview of ${photo.name} with border`} />
        {error && <p className="borders-error">{error}</p>}
      </div>
      <p className="borders-meta">
        Source {photo.width} × {photo.height} · output {output.canvasW} × {output.canvasH} px
      </p>
    </>
  );
}
