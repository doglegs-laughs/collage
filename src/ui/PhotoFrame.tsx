import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { clamp, cropBox, DEFAULT_CROP, MAX_ZOOM, panBy, zoomAt, type Crop } from '../core/geometry';
import { getObjectUrl, type Photo } from '../core/images';

export function usePhotoUrl(photo: Photo | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setUrl(null);
    if (photo) getObjectUrl(photo).then((u) => live && setUrl(u), () => {});
    return () => { live = false; };
  }, [photo?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  return url;
}

type Props = {
  photo: Photo;
  crop?: Crop;
  /** Frame aspect (w/h). Measured from the element when omitted. */
  aspect?: number;
  interactive?: boolean;
  onCropChange?: (crop: Crop) => void;
  className?: string;
  style?: CSSProperties;
  children?: React.ReactNode;
};

/** Shows `photo` cropped to its box with the same cropBox math the exporter uses. */
export function PhotoFrame({ photo, crop = DEFAULT_CROP, aspect, interactive, onCropChange, className = '', style, children }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const url = usePhotoUrl(photo);
  const [measured, setMeasured] = useState({ w: 1, h: 1 });
  const [panning, setPanning] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setMeasured({ w: el.clientWidth || 1, h: el.clientHeight || 1 });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const frameAspect = aspect ?? measured.w / measured.h;
  const box = cropBox(photo, crop, frameAspect);

  const live = useRef({ photo, crop, frameAspect, onCropChange, measured });
  live.current = { photo, crop, frameAspect, onCropChange, measured };

  useEffect(() => {
    const el = ref.current;
    if (!el || !interactive) return;
    const emit = (c: Crop) => live.current.onCropChange?.(c);
    const pointers = new Map<number, { x: number; y: number }>();
    let last = { x: 0, y: 0 };
    let pinch: { dist: number; zoom: number } | null = null;
    const distance = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
    const midpoint = () => { const [a, b] = [...pointers.values()]; return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; };
    const fractions = (x: number, y: number) => {
      const r = el.getBoundingClientRect();
      return { ax: clamp((x - r.left) / r.width, 0, 1), ay: clamp((y - r.top) / r.height, 0, 1) };
    };

    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest('[data-no-pan]')) return;
      el.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      last = { x: e.clientX, y: e.clientY };
      pinch = pointers.size === 2 ? { dist: distance(), zoom: live.current.crop.zoom } : null;
      setPanning(true);
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const { photo: p, crop: c, frameAspect: a, measured: m } = live.current;
      if (pointers.size === 2 && pinch) {
        const mid = midpoint();
        const { ax, ay } = fractions(mid.x, mid.y);
        emit(zoomAt(p, c, a, (pinch.zoom * distance()) / pinch.dist, ax, ay));
        return;
      }
      if (pointers.size !== 1) return;
      const b = cropBox(p, c, a);
      emit(panBy(p, c, a, (-(e.clientX - last.x) * b.w) / m.w, (-(e.clientY - last.y) * b.h) / m.h));
      last = { x: e.clientX, y: e.clientY };
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
      pinch = null;
      if (pointers.size === 1) { const [rest] = [...pointers.values()]; last = rest; }
      if (!pointers.size) setPanning(false);
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const { photo: p, crop: c, frameAspect: a } = live.current;
      const { ax, ay } = fractions(e.clientX, e.clientY);
      const rate = e.ctrlKey ? 0.01 : 0.0015;
      emit(zoomAt(p, c, a, clamp(c.zoom * Math.exp(-e.deltaY * rate), 1, MAX_ZOOM), ax, ay));
    };
    const onDouble = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest('[data-no-pan]')) return;
      emit({ ...DEFAULT_CROP });
    };

    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('dblclick', onDouble);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('dblclick', onDouble);
    };
  }, [interactive]);

  return (
    <div ref={ref} className={`photo-frame ${interactive ? 'interactive' : ''} ${panning ? 'panning' : ''} ${className}`} style={style}>
      {url && (
        <img
          src={url}
          alt={photo.name}
          draggable={false}
          style={{
            width: `${(photo.width / box.w) * 100}%`,
            height: `${(photo.height / box.h) * 100}%`,
            left: `${(-box.left / box.w) * 100}%`,
            top: `${(-box.top / box.h) * 100}%`,
          }}
        />
      )}
      {children}
    </div>
  );
}
