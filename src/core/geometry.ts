export type Size = { width: number; height: number };
export type Crop = { zoom: number; cx: number; cy: number };
export type Box = { left: number; top: number; w: number; h: number };
export type Shape = readonly [number, number] | null;

export const MAX_GRID = 20;
export const MAX_ZOOM = 8;
export const MAX_BORDER = 400;
export const DEFAULT_BORDER_FRACTION = 0.015;
export const DEFAULT_CROP: Crop = { zoom: 1, cx: 0.5, cy: 0.5 };
export const SHAPES: readonly Shape[] = [null, [1, 1], [4, 5], [3, 4], [2, 3], [9, 16], [5, 4], [4, 3], [3, 2], [16, 9]];

/** Math.round with floor(x + 0.5) semantics, matching browser Math.round. */
export const round = (x: number) => Math.floor(x + 0.5);
export const clamp = (v: number, min: number, max: number) => Math.min(Math.max(v, min), max);

/** Largest box of `shape` inside `size` (shape null keeps the size). */
export function cellSizeFor({ width, height }: Size, shape: Shape): Size {
  if (!shape) return { width, height };
  const [w, h] = shape;
  if (width * h > height * w) return { width: Math.max(1, round((height * w) / h)), height };
  return { width, height: Math.max(1, round((width * h) / w)) };
}

/** Source rectangle (in photo pixels) a frame of `aspect` (w/h) shows. Zoom 1 is a centered cover crop. */
export function cropBox(size: Size, crop: Crop, aspect: number): Box {
  const { width, height } = size;
  const wide = width / height > aspect;
  const w = Math.min((wide ? height * aspect : width) / crop.zoom, width);
  const h = Math.min((wide ? height : width / aspect) / crop.zoom, height);
  const left = clamp(crop.cx * width - w / 2, 0, width - w);
  const top = clamp(crop.cy * height - h / 2, 0, height - h);
  return { left, top, w, h };
}

/** Clamp zoom and re-store the centre actually on screen, so later pans start from what is visible. */
export function clampCrop(size: Size, crop: Crop, aspect: number): Crop {
  const zoom = clamp(crop.zoom, 1, MAX_ZOOM);
  const box = cropBox(size, { ...crop, zoom }, aspect);
  return { zoom, cx: (box.left + box.w / 2) / size.width, cy: (box.top + box.h / 2) / size.height };
}

/** Zoom while keeping the photo point under (ax, ay), fractions of the frame, fixed on screen. */
export function zoomAt(size: Size, crop: Crop, aspect: number, zoom: number, ax = 0.5, ay = 0.5): Crop {
  const box = cropBox(size, crop, aspect);
  const z = clamp(zoom, 1, MAX_ZOOM);
  const w = (box.w * crop.zoom) / z;
  const h = (box.h * crop.zoom) / z;
  const x = box.left + ax * (box.w - w);
  const y = box.top + ay * (box.h - h);
  return clampCrop(size, { zoom: z, cx: (x + w / 2) / size.width, cy: (y + h / 2) / size.height }, aspect);
}

/** Pan by a fraction of the visible box (positive dx moves the window right). */
export function panBy(size: Size, crop: Crop, aspect: number, dxPhoto: number, dyPhoto: number): Crop {
  const box = cropBox(size, crop, aspect);
  return clampCrop(
    size,
    { zoom: crop.zoom, cx: (box.left + box.w / 2 + dxPhoto) / size.width, cy: (box.top + box.h / 2 + dyPhoto) / size.height },
    aspect,
  );
}

/** Border (px) where border = fraction x output width; capped at MAX_BORDER. */
export function defaultBorder(tileWidth: number, columns: number, fraction = DEFAULT_BORDER_FRACTION): number {
  return Math.min(MAX_BORDER, round((fraction * tileWidth * columns) / (1 - fraction * (columns + 1))));
}

export function outputSize(tile: Size, rows: number, columns: number, border: number): Size {
  return { width: tile.width * columns + border * (columns + 1), height: tile.height * rows + border * (rows + 1) };
}

/** Pixel edges of the tile at `index`; each edge is rounded on its own so scaled tiles abut without gaps. */
export function tileEdges(index: number, grid: { rows: number; columns: number }, tile: Size, border: number, scale = 1) {
  const row = Math.floor(index / grid.columns);
  const col = index % grid.columns;
  const left = border + col * (tile.width + border);
  const top = border + row * (tile.height + border);
  const x0 = round(left * scale);
  const y0 = round(top * scale);
  const x1 = round((left + tile.width) * scale);
  const y1 = round((top + tile.height) * scale);
  return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
}

/** Keep each item at its (row, column) when it still fits; orphans fill the first empty cells in order. */
export function resizeGrid<T>(placements: readonly (T | null)[], oldRows: number, oldCols: number, newRows: number, newCols: number): (T | null)[] {
  const next: (T | null)[] = new Array(newRows * newCols).fill(null);
  const orphans: T[] = [];
  for (let i = 0; i < oldRows * oldCols; i++) {
    const item = placements[i];
    if (item == null) continue;
    const row = Math.floor(i / oldCols);
    const col = i % oldCols;
    if (row < newRows && col < newCols) next[row * newCols + col] = item;
    else orphans.push(item);
  }
  for (const item of orphans) {
    const free = next.indexOf(null);
    if (free >= 0) next[free] = item;
  }
  return next;
}

export function swap<T>(items: readonly T[], a: number, b: number): T[] {
  const next = items.slice();
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}
