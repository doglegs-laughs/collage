export type Guides = { x: number[]; y: number[] };
export const NO_GUIDES: Guides = { x: [], y: [] };

/**
 * Snap a set of moving points (e.g. left/centre/right of a box) to the nearest target within `threshold`.
 * Returns the offset to add and the target positions that now line up (for drawing guides).
 */
export function snapAxis(points: readonly number[], targets: readonly number[], threshold: number): { delta: number; hits: number[] } {
  let best: number | null = null;
  for (const p of points) {
    for (const t of targets) {
      const d = t - p;
      if (Math.abs(d) <= threshold && (best === null || Math.abs(d) < Math.abs(best))) best = d;
    }
  }
  if (best === null) return { delta: 0, hits: [] };
  const hits = new Set<number>();
  for (const p of points) for (const t of targets) if (Math.abs(t - (p + best)) < 0.5) hits.add(t);
  return { delta: best, hits: [...hits] };
}

export type Box = { x: number; y: number; w: number; h: number };
export const boxXs = (b: Box): number[] => [b.x, b.x + b.w / 2, b.x + b.w];
export const boxYs = (b: Box): number[] => [b.y, b.y + b.h / 2, b.y + b.h];
export const unionBox = (boxes: readonly Box[]): Box => {
  const l = Math.min(...boxes.map((b) => b.x));
  const t = Math.min(...boxes.map((b) => b.y));
  const r = Math.max(...boxes.map((b) => b.x + b.w));
  const bt = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: l, y: t, w: r - l, h: bt - t };
};

/** Snap targets in page px: page centre and edges plus the edges/centres of other boxes. */
export function snapTargets(pageW: number, pageH: number, others: readonly Box[]): { xs: number[]; ys: number[] } {
  return {
    xs: [0, pageW / 2, pageW, ...others.flatMap(boxXs)],
    ys: [0, pageH / 2, pageH, ...others.flatMap(boxYs)],
  };
}

/** Local-axis resize of a rotated box. Returns the new centre and size (px). */
export type Handle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export const HANDLES: readonly Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
export const handleDir = (h: Handle): { sx: -1 | 0 | 1; sy: -1 | 0 | 1 } => ({
  sx: h.includes('e') ? 1 : h.includes('w') ? -1 : 0,
  sy: h.includes('s') ? 1 : h.includes('n') ? -1 : 0,
});

export function resizeBox(
  start: { cx: number; cy: number; w: number; h: number; rotation: number },
  handle: Handle,
  dx: number,
  dy: number,
  opts: { lockAspect: boolean; min: number },
): { cx: number; cy: number; w: number; h: number } {
  const { sx, sy } = handleDir(handle);
  const r = (start.rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const lx = dx * cos + dy * sin;
  const ly = -dx * sin + dy * cos;
  let w = sx ? start.w + sx * lx : start.w;
  let h = sy ? start.h + sy * ly : start.h;
  if (opts.lockAspect && sx && sy) {
    const s = Math.max(w / start.w, h / start.h);
    w = start.w * s;
    h = start.h * s;
  }
  const floor = Math.max(opts.min, 1);
  if (opts.lockAspect && sx && sy) {
    const s = Math.max(floor / start.w, floor / start.h, w / start.w);
    w = start.w * s;
    h = start.h * s;
  } else {
    w = Math.max(floor, w);
    h = Math.max(floor, h);
  }
  const ox = (sx * (w - start.w)) / 2;
  const oy = (sy * (h - start.h)) / 2;
  return { cx: start.cx + ox * cos - oy * sin, cy: start.cy + ox * sin + oy * cos, w, h };
}

export const normalizeAngle = (deg: number): number => {
  const a = ((((deg + 180) % 360) + 360) % 360) - 180;
  return a === -180 ? 180 : a;
};
