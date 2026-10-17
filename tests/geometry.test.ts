import { describe, expect, it } from 'vitest';
import { cellSizeFor, clampCrop, cropBox, defaultBorder, outputSize, resizeGrid, round, swap, tileEdges, zoomAt } from '../src/core/geometry';

const photo = { width: 4000, height: 3000 };

describe('collage math', () => {
  it('2x2 match-photo: border 126, output 8378x6378', () => {
    const tile = cellSizeFor(photo, null);
    const border = defaultBorder(tile.width, 2);
    expect(border).toBe(126);
    expect(outputSize(tile, 2, 2, border)).toEqual({ width: 8378, height: 6378 });
  });

  it('20x20 caps border at 400 and outputs 88400x68400', () => {
    const tile = cellSizeFor(photo, null);
    const border = defaultBorder(tile.width, 20);
    expect(border).toBe(400);
    expect(outputSize(tile, 20, 20, border)).toEqual({ width: 88400, height: 68400 });
  });

  it('1x1 1px photo: border 0, output 1x1', () => {
    const tile = cellSizeFor({ width: 1, height: 1 }, null);
    const border = defaultBorder(tile.width, 1);
    expect(border).toBe(0);
    expect(outputSize(tile, 1, 1, border)).toEqual({ width: 1, height: 1 });
  });

  it('cellSizeFor fits the shape inside the photo', () => {
    expect(cellSizeFor(photo, [1, 1])).toEqual({ width: 3000, height: 3000 });
    expect(cellSizeFor(photo, [16, 9])).toEqual({ width: 4000, height: 2250 });
    expect(cellSizeFor({ width: 1, height: 1 }, [9, 16])).toEqual({ width: 1, height: 1 });
  });

  it('round is floor(x + 0.5)', () => {
    expect(round(2.5)).toBe(3);
    expect(round(-2.5)).toBe(-2);
    expect(round(0.49999)).toBe(0);
  });

  it('zoom 1 to 2 anchored at (.25,.75) on a square crop', () => {
    const start = { zoom: 1, cx: 0.5, cy: 0.5 };
    const next = zoomAt(photo, start, 1, 2, 0.25, 0.75);
    expect(next.zoom).toBe(2);
    expect(next.cx).toBeCloseTo(0.40625, 10);
    expect(next.cy).toBeCloseTo(0.625, 10);
    const box = cropBox(photo, next, 1);
    expect(box.left).toBeCloseTo(875, 6);
    expect(box.top).toBeCloseTo(1125, 6);
    expect(box.w).toBeCloseTo(1500, 6);
    expect(box.h).toBeCloseTo(1500, 6);
  });

  it('zoom is clamped to 1..8 and the center is clamped inside the photo', () => {
    expect(zoomAt(photo, { zoom: 1, cx: 0.5, cy: 0.5 }, 1, 99).zoom).toBe(8);
    const c = clampCrop(photo, { zoom: 2, cx: -1, cy: 5 }, 1);
    const box = cropBox(photo, c, 1);
    expect(box.left).toBe(0);
    expect(box.top + box.h).toBeCloseTo(3000, 6);
  });

  it('cropBox supports arbitrary aspects', () => {
    const box = cropBox(photo, { zoom: 1, cx: 0.5, cy: 0.5 }, 2);
    expect(box).toEqual({ left: 0, top: 500, w: 4000, h: 2000 });
  });

  it('tileEdges rounds each edge so scaled tiles abut', () => {
    const grid = { rows: 2, columns: 2 };
    const tile = { width: 4000, height: 3000 };
    const a = tileEdges(0, grid, tile, 126);
    expect(a).toMatchObject({ x0: 126, y0: 126, x1: 4126, y1: 3126 });
    const scale = 0.37;
    const left = tileEdges(0, grid, tile, 126, scale);
    const right = tileEdges(1, grid, tile, 126, scale);
    expect(right.x0 - left.x1).toBe(round(4252 * scale) - round(4126 * scale));
    for (let i = 0; i < 4; i++) {
      const e = tileEdges(i, grid, tile, 126, scale);
      expect(e.w).toBe(e.x1 - e.x0);
    }
  });
});

describe('grid helpers', () => {
  const A = 'A', B = 'B', C = 'C', D = 'D', E = 'E';
  const items = [A, null, B, C, D, E];

  it('2x3 to 3x2 keeps positions then fills gaps', () => {
    expect(resizeGrid(items, 2, 3, 3, 2)).toEqual([A, B, C, D, E, null]);
  });

  it('2x3 to 1x2 keeps the first two in order', () => {
    expect(resizeGrid(items, 2, 3, 1, 2)).toEqual([A, B]);
  });

  it('same size is identity', () => {
    expect(resizeGrid(items, 2, 3, 2, 3)).toEqual(items);
  });

  it('swap preserves identity', () => {
    const obj = [{ id: 1 }, { id: 2 }, { id: 3 }];
    const out = swap(obj, 0, 2);
    expect(out[0]).toBe(obj[2]);
    expect(out[2]).toBe(obj[0]);
    expect(out[1]).toBe(obj[1]);
    expect(obj[0].id).toBe(1);
    expect(out.length).toBe(3);
  });
});
