import { describe, expect, it } from 'vitest';
import { borderLayout, borderStem, uniqueName, type BorderLayout, type BorderOptions, type BorderShape, type LongEdge, type Size } from '../src/borders/borderMath';

const LANDSCAPE: Size = { width: 4000, height: 3000 };
const PORTRAIT: Size = { width: 3000, height: 4000 };
const SQUARE: Size = { width: 2000, height: 2000 };
const SHAPES: BorderShape[] = ['original', '1:1', '4:5', '9:16'];
const EDGES: LongEdge[] = ['original', 2160, 1080];
const RATIO: Record<Exclude<BorderShape, 'original'>, number> = { '1:1': 1, '4:5': 0.8, '9:16': 9 / 16 };

const opts = (shape: BorderShape, longEdge: LongEdge, borderPct = 5): BorderOptions => ({ borderPct, shape, longEdge });

/** Shared invariants: integers, photo inside, border on every side at least the scaled border, photo not clipped. */
function expectValid(photo: Size, layout: BorderLayout, shape: BorderShape, longEdge: LongEdge, borderPct: number) {
  for (const v of Object.values(layout)) expect(Number.isInteger(v)).toBe(true);
  expect(layout.x).toBeGreaterThanOrEqual(0);
  expect(layout.y).toBeGreaterThanOrEqual(0);
  expect(layout.x + layout.w).toBeLessThanOrEqual(layout.canvasW);
  expect(layout.y + layout.h).toBeLessThanOrEqual(layout.canvasH);
  // Scale of the photo inside the canvas (1 when 'original' keeps native size).
  const s = layout.w / photo.width;
  const minBorder = Math.floor((borderPct / 100) * Math.max(photo.width, photo.height) * s) - 1;
  expect(layout.x).toBeGreaterThanOrEqual(minBorder);
  expect(layout.y).toBeGreaterThanOrEqual(minBorder);
  expect(layout.canvasW - layout.x - layout.w).toBeGreaterThanOrEqual(minBorder);
  expect(layout.canvasH - layout.y - layout.h).toBeGreaterThanOrEqual(minBorder);
  if (longEdge !== 'original') expect(Math.max(layout.canvasW, layout.canvasH)).toBe(longEdge);
  if (shape !== 'original') {
    // Photo is centered (within a pixel) and the canvas has the requested aspect.
    expect(Math.abs(layout.x - (layout.canvasW - layout.x - layout.w))).toBeLessThanOrEqual(1);
    expect(Math.abs(layout.y - (layout.canvasH - layout.y - layout.h))).toBeLessThanOrEqual(1);
    expect(layout.canvasW / layout.canvasH).toBeCloseTo(RATIO[shape], 2);
  }
}

describe('borderLayout', () => {
  it('original shape, original size: even 5% border on all sides at native resolution', () => {
    expect(borderLayout(LANDSCAPE, opts('original', 'original'))).toEqual({ canvasW: 4400, canvasH: 3400, x: 200, y: 200, w: 4000, h: 3000 });
  });

  it('original shape uses the portrait long edge for the border', () => {
    expect(borderLayout(PORTRAIT, opts('original', 'original'))).toEqual({ canvasW: 3400, canvasH: 4400, x: 200, y: 200, w: 3000, h: 4000 });
  });

  it('original shape scales uniformly to 1080 and 2160 long edges', () => {
    const at1080 = borderLayout(LANDSCAPE, opts('original', 1080));
    expect(at1080.canvasW).toBe(1080);
    expect(at1080.canvasH).toBe(Math.round(3400 * (1080 / 4400)));
    const at2160 = borderLayout(PORTRAIT, opts('original', 2160));
    expect(at2160.canvasH).toBe(2160);
    expect(at2160.canvasW).toBe(Math.round(3400 * (2160 / 4400)));
    // Border stays the same share of the long edge.
    expect(at2160.x).toBe(Math.round(200 * (2160 / 4400)));
  });

  it('square 1:1 for landscape fits the photo with the border on the tight sides', () => {
    expect(borderLayout(LANDSCAPE, opts('1:1', 'original'))).toEqual({ canvasW: 4400, canvasH: 4400, x: 200, y: 700, w: 4000, h: 3000 });
  });

  it('4:5 for landscape is the smallest portrait canvas holding the photo plus border', () => {
    expect(borderLayout(LANDSCAPE, opts('4:5', 'original'))).toEqual({ canvasW: 4400, canvasH: 5500, x: 200, y: 1250, w: 4000, h: 3000 });
  });

  it('9:16 for portrait needs no border on the tall side when the border is 0', () => {
    const layout = borderLayout(PORTRAIT, opts('9:16', 'original', 0));
    expect(layout.w).toBe(3000);
    expect(layout.h).toBe(4000);
    expect(layout.canvasW / layout.canvasH).toBeCloseTo(9 / 16, 3);
    expect(layout.canvasW).toBeGreaterThanOrEqual(3000);
    expect(layout.canvasH).toBeGreaterThanOrEqual(4000);
  });

  it('keeps the photo at native size for original output, even when the border is 0', () => {
    expect(borderLayout({ width: 1, height: 1 }, opts('original', 'original', 0))).toEqual({ canvasW: 1, canvasH: 1, x: 0, y: 0, w: 1, h: 1 });
  });

  it('every orientation, shape and long edge is valid', () => {
    for (const photo of [LANDSCAPE, PORTRAIT, SQUARE]) {
      for (const shape of SHAPES) {
        for (const edge of EDGES) {
          const layout = borderLayout(photo, opts(shape, edge));
          expectValid(photo, layout, shape, edge, 5);
        }
      }
    }
  });

  it('a 20% border on a square photo still fits and stays valid for every shape', () => {
    for (const shape of SHAPES) {
      for (const edge of EDGES) expectValid(SQUARE, borderLayout(SQUARE, opts(shape, edge, 20)), shape, edge, 20);
    }
  });

  it('a 0% border leaves the photo flush with the canvas for shaped canvases', () => {
    const layout = borderLayout(LANDSCAPE, opts('1:1', 'original', 0));
    expect(layout.canvasW).toBe(4000);
    expect(layout.canvasH).toBe(4000);
    expect(layout.y).toBe(500);
  });
});

describe('borderStem', () => {
  it('drops the extension and adds -border', () => {
    expect(borderStem('IMG_1.heic')).toBe('IMG_1-border');
    expect(borderStem('holiday.final.JPG')).toBe('holiday.final-border');
    expect(borderStem('noext')).toBe('noext-border');
  });
});

describe('uniqueName', () => {
  const taken = (names: string[]) => (n: string) => names.includes(n);

  it('uses the plain name when free', async () => {
    expect(await uniqueName('name-border', taken([]))).toBe('name-border.jpg');
  });

  it('appends 2, 3, ... when names are taken', async () => {
    expect(await uniqueName('name-border', taken(['name-border.jpg']))).toBe('name-border 2.jpg');
    expect(await uniqueName('name-border', taken(['name-border.jpg', 'name-border 2.jpg']))).toBe('name-border 3.jpg');
  });

  it('skips gaps only if they are taken', async () => {
    expect(await uniqueName('name-border', taken(['name-border.jpg', 'name-border 3.jpg']))).toBe('name-border 2.jpg');
  });

  it('accepts an async existence check', async () => {
    const exists = async (n: string) => n === 'a-border.jpg';
    expect(await uniqueName('a-border', exists)).toBe('a-border 2.jpg');
  });
});
