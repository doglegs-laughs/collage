import { describe, expect, it } from 'vitest';
import {
  borderLayout, finishLayout,
  type BorderShape, type FinishId, type FinishLayout, type FinishOptions, type LongEdge, type Size,
} from '../src/borders/borderMath';

const LANDSCAPE: Size = { width: 4000, height: 3000 };
const PORTRAIT: Size = { width: 3000, height: 4000 };
const SQUARE: Size = { width: 2000, height: 2000 };
const PHOTOS: Size[] = [LANDSCAPE, PORTRAIT, SQUARE];
const SHAPES: BorderShape[] = ['original', '1:1', '4:5', '9:16'];
const EDGES: LongEdge[] = ['original', 2160, 1080];
const FINISHES: FinishId[] = ['white', 'black', 'mat', 'framed', 'polaroid'];
const RATIO: Record<Exclude<BorderShape, 'original'>, number> = { '1:1': 1, '4:5': 0.8, '9:16': 9 / 16 };

const fo = (finish: FinishId, shape: BorderShape, longEdge: LongEdge, extra: Partial<FinishOptions> = {}): FinishOptions => ({
  borderPct: 5, framePct: 0.6, matPct: 4, finish, shape, longEdge, ...extra,
});
const rects = (l: FinishLayout) => [l.photo, l.outer];
const long = (p: Size) => Math.max(p.width, p.height);

describe('finishLayout', () => {
  it('every finish x shape x edge x orientation: integer rects, inside the canvas, photo inside outer', () => {
    for (const photo of PHOTOS) for (const finish of FINISHES) for (const shape of SHAPES) for (const edge of EDGES) {
      const l = finishLayout(photo, fo(finish, shape, edge));
      expect(Number.isInteger(l.canvasW) && Number.isInteger(l.canvasH)).toBe(true);
      for (const r of rects(l)) {
        for (const v of Object.values(r)) expect(Number.isInteger(v)).toBe(true);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.w).toBeGreaterThan(0);
        expect(r.h).toBeGreaterThan(0);
        expect(r.x + r.w).toBeLessThanOrEqual(l.canvasW);
        expect(r.y + r.h).toBeLessThanOrEqual(l.canvasH);
      }
      expect(l.photo.x).toBeGreaterThanOrEqual(l.outer.x);
      expect(l.photo.y).toBeGreaterThanOrEqual(l.outer.y);
      expect(l.photo.x + l.photo.w).toBeLessThanOrEqual(l.outer.x + l.outer.w);
      expect(l.photo.y + l.photo.h).toBeLessThanOrEqual(l.outer.y + l.outer.h);
      if (edge !== 'original') expect(Math.max(l.canvasW, l.canvasH)).toBe(edge);
      if (shape !== 'original') expect(l.canvasW / l.canvasH).toBeCloseTo(RATIO[shape], 2);
    }
  });

  it('never upscales the photo at the original long edge', () => {
    for (const photo of PHOTOS) for (const finish of FINISHES) for (const shape of SHAPES) {
      const l = finishLayout(photo, fo(finish, shape, 'original'));
      expect(l.photo.w).toBe(photo.width);
      expect(l.photo.h).toBe(photo.height);
    }
  });

  it('the piece (outer rect, or photo for white) is centred with at least the border on its tight sides', () => {
    for (const photo of PHOTOS) for (const finish of ['white', 'mat', 'framed', 'polaroid'] as FinishId[]) for (const shape of SHAPES) {
      const l = finishLayout(photo, fo(finish, shape, 'original'));
      const o = l.outer;
      const b = Math.round(0.05 * long(photo));
      const margins = [o.x, o.y, l.canvasW - o.x - o.w, l.canvasH - o.y - o.h];
      expect(Math.min(...margins)).toBeGreaterThanOrEqual(b);
      expect(Math.abs(margins[0] - margins[2])).toBeLessThanOrEqual(1);
      expect(Math.abs(margins[1] - margins[3])).toBeLessThanOrEqual(1);
      if (shape === 'original') expect(margins.every((m) => m === b)).toBe(true);
    }
  });

  it('white matches borderLayout exactly', () => {
    for (const photo of PHOTOS) for (const shape of SHAPES) for (const edge of EDGES) {
      const w = borderLayout(photo, { borderPct: 5, shape, longEdge: edge });
      const l = finishLayout(photo, fo('white', shape, edge));
      expect(l.photo).toEqual({ x: w.x, y: w.y, w: w.w, h: w.h });
      expect([l.canvasW, l.canvasH]).toEqual([w.canvasW, w.canvasH]);
    }
  });

  it('black border has the same outer geometry as the white border, with the frame inside the margin', () => {
    for (const photo of PHOTOS) for (const shape of SHAPES) for (const edge of EDGES) {
      const w = finishLayout(photo, fo('white', shape, edge));
      const k = finishLayout(photo, fo('black', shape, edge));
      expect(k.canvasW).toBe(w.canvasW);
      expect(k.canvasH).toBe(w.canvasH);
      expect(k.photo).toEqual(w.photo);
      expect(k.outer.x).toBeLessThan(k.photo.x);
      expect(k.outer.y).toBeLessThan(k.photo.y);
    }
  });

  it('frame thickness is proportional to the long edge and the slider', () => {
    const thin = finishLayout(LANDSCAPE, fo('black', 'original', 'original', { framePct: 0.6 }));
    expect(thin.photo.x - thin.outer.x).toBe(24);
    const thick = finishLayout(LANDSCAPE, fo('black', 'original', 'original', { framePct: 3 }));
    expect(thick.photo.x - thick.outer.x).toBe(120);
    const framed = finishLayout(PORTRAIT, fo('framed', 'original', 'original', { framePct: 1.7 }));
    expect(framed.photo.y - framed.outer.y).toBe(68);
    expect(framed.outer.w).toBe(3000 + 2 * 68);
    const small = finishLayout(PORTRAIT, fo('framed', 'original', 1080, { framePct: 1.7 }));
    expect(Math.abs(small.photo.y - small.outer.y - (68 * 1080) / framed.canvasH)).toBeLessThanOrEqual(1);
  });

  it('mat padding is even and proportional, and the border is the space around the paper', () => {
    const l = finishLayout(LANDSCAPE, fo('mat', 'original', 'original', { matPct: 4, borderPct: 5 }));
    expect(l.outer).toEqual({ x: 200, y: 200, w: 4320, h: 3320 });
    expect(l.photo).toEqual({ x: 360, y: 360, w: 4000, h: 3000 });
    expect(l.canvasW).toBe(4720);
    const wide = finishLayout(LANDSCAPE, fo('mat', 'original', 'original', { matPct: 8 }));
    expect(wide.photo.x - wide.outer.x).toBe(320);
  });

  it('polaroid has equal side/top bands and a thicker bottom band in Story proportions', () => {
    const l = finishLayout(LANDSCAPE, fo('polaroid', 'original', 'original'));
    const side = l.photo.x - l.outer.x;
    expect(l.photo.y - l.outer.y).toBe(side);
    const bottom = l.outer.y + l.outer.h - (l.photo.y + l.photo.h);
    expect(bottom).toBeGreaterThan(2 * side);
    expect(side / l.outer.w).toBeCloseTo(0.06, 2);
    expect(bottom / l.outer.w).toBeCloseTo(0.16, 2);
  });
});
