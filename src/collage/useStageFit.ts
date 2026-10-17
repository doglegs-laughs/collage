import { useLayoutEffect, useState, type RefObject } from 'react';

/** Width in px of the grid so the whole collage (aspect w/h) fits inside the stage's padding box. */
export function useStageFit(stage: RefObject<HTMLElement>, aspect: number): number {
  const [width, setWidth] = useState(400);
  useLayoutEffect(() => {
    const el = stage.current;
    if (!el) return;
    const fit = () => {
      const s = getComputedStyle(el);
      const w = el.clientWidth - parseFloat(s.paddingLeft) - parseFloat(s.paddingRight);
      const h = el.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom);
      if (w > 0 && h > 0) setWidth(Math.max(120, Math.min(w, h * aspect)));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [stage, aspect]);
  return width;
}
