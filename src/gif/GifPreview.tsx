import { useEffect, useRef, useState } from 'react';
import type { Size } from '../core/geometry';
import { getBitmapForSize, type Photo } from '../core/images';
import { Button } from '../ui/Controls';
import { frameAt, type GifLoop, type GifPlan } from './plan';
import { createFrameDrawer, decodeEdge, type Bitmap } from './render';
import type { GifFit } from './shape';

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

type Props = {
  photos: Photo[];
  plan: GifPlan;
  size: Size;
  fit: GifFit;
  background: string;
  loop: GifLoop;
  /** False while another tab is showing: the animation stops. */
  active: boolean;
};

/** Plays the animation on a canvas with the same drawing code the export uses. */
export function GifPreview({ photos, plan, size, fit, background, loop, active }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loaded, setLoaded] = useState<{ photos: Photo[]; size: Size; fit: GifFit; list: ImageBitmap[] } | null>(null);
  const [playing, setPlaying] = useState(() => !reducedMotion());
  const [error, setError] = useState<string | null>(null);

  // Photos decoded at preview size, so drawing a frame is a plain copy.
  useEffect(() => {
    let live = true;
    const made: ImageBitmap[] = [];
    setError(null);
    Promise.all(photos.map(async (p) => { const b = await getBitmapForSize(p, decodeEdge(p, size, fit)); made.push(b); return b; }))
      .then((list) => { if (live) setLoaded({ photos, size, fit, list }); else list.forEach((b) => b.close()); })
      .catch((e: unknown) => { if (live) setError(e instanceof Error ? e.message : String(e)); made.forEach((b) => b.close()); });
    return () => { live = false; };
  }, [photos, size, fit]);
  // Only frames made for the current photos and size are drawn.
  const bitmaps = loaded && loaded.photos === photos && loaded.size === size && loaded.fit === fit ? loaded.list : null;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !bitmaps || !plan.frames.length) return;
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d')!;
    const drawer = createFrameDrawer({ size, fit, background });
    const show = (i: number) => {
      ctx.fillStyle = background;
      ctx.fillRect(0, 0, size.width, size.height);
      drawer.draw(ctx, bitmaps as Bitmap[], plan.frames[i]);
    };
    show(0);
    if (!active || !playing) return drawer.dispose;
    let raf = 0;
    let shown = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = (now - start) / 1000;
      if (loop === 'once' && t >= plan.duration) {
        show(plan.frames.length - 1);
        setPlaying(false);
        return;
      }
      const i = frameAt(plan, t, loop);
      if (i !== shown) { show(i); shown = i; }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); drawer.dispose(); };
  }, [bitmaps, plan, size, fit, background, loop, active, playing]);
  // Declared after the drawing effect: on a change its cleanup stops the animation before these bitmaps are closed.
  useEffect(() => () => loaded?.list.forEach((b) => b.close()), [loaded]);

  return (
    <>
      <div className="borders-canvas-wrap">
        <canvas ref={canvasRef} className="gif-canvas" data-testid="gif-canvas" aria-label="Animated preview" />
        {error && <p className="borders-error">{error}</p>}
      </div>
      <div className="gif-transport">
        <Button onClick={() => setPlaying((p) => !p)} data-testid="gif-play">{playing ? 'Pause' : 'Play'}</Button>
      </div>
    </>
  );
}
