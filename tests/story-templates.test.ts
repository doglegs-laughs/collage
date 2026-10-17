import { describe, expect, it } from 'vitest';
import { ASPECTS, aspectRatio, type Aspect, type El, type PhotoEl } from '../src/story/model';
import { layoutElementPx } from '../src/story/render';
import { getTemplate, orientationOf, TEMPLATES, type Template } from '../src/story/templates';
import { makePhotos } from './story-helpers';

type R = { x: number; y: number; w: number; h: number; el: PhotoEl };
const EPS = 1e-9;

/** Photo rects in width units, x offset by page index (global spread coordinates). */
function rects(t: Template, aspect: Aspect, opts = {}): R[] {
  const H = 1 / aspectRatio(aspect);
  const res = t.layout(aspect, makePhotos(Math.max(t.slots, 1), 3), { title: 'Faroe Islands', subtitle: 'June', caption: 'x', ...opts });
  return res.pages.flatMap((els, pi) => els.filter((e): e is PhotoEl => e.kind === 'photo').map((el) => ({ x: el.x + pi, y: el.y * H, w: el.w, h: el.h * H, el })));
}
const bbox = (r: R) => {
  const th = (Math.abs(r.el.rotation) * Math.PI) / 180;
  const bw = r.w * Math.cos(th) + r.h * Math.sin(th);
  const bh = r.w * Math.sin(th) + r.h * Math.cos(th);
  return { l: r.x + r.w / 2 - bw / 2, r: r.x + r.w / 2 + bw / 2, t: r.y + r.h / 2 - bh / 2, b: r.y + r.h / 2 + bh / 2 };
};

describe('every template, every aspect', () => {
  for (const t of TEMPLATES) {
    for (const aspect of ASPECTS) {
      it(`${t.id} @ ${aspect}: shape and bounds`, () => {
        const H = 1 / aspectRatio(aspect);
        const res = t.layout(aspect, makePhotos(t.slots, 5), { title: 'A title', caption: 'cap' });
        expect(res.pages).toHaveLength(t.pageCount);
        expect(res.backgrounds).toHaveLength(t.pageCount);
        const used = res.pages.flat().filter((e) => e.kind === 'photo').length;
        expect(used).toBe(t.slots);
        for (const r of rects(t, aspect, { title: 'A title' })) {
          const b = bbox(r);
          expect(b.l).toBeGreaterThanOrEqual(-EPS);
          expect(b.t).toBeGreaterThanOrEqual(-EPS);
          expect(b.r).toBeLessThanOrEqual(t.pageCount + EPS);
          expect(b.b).toBeLessThanOrEqual(H + EPS);
          expect(r.w).toBeGreaterThan(0);
          expect(r.h).toBeGreaterThan(0);
        }
        for (const e of res.pages.flat()) {
          for (const v of [e.x, e.y, e.w, e.h]) expect(Number.isFinite(v)).toBe(true);
        }
        expect(res.pages.flat().map((e) => e.id).length).toBe(new Set(res.pages.flat().map((e) => e.id)).size);
      });
    }
  }
  it('fits is 0 with too few photos and within 0..1', () => {
    for (const t of TEMPLATES) {
      if (t.slots > 0) expect(t.fits(Array(t.slots - 1).fill('l'), '4:5')).toBe(0);
      for (const o of ['p', 'l', 's'] as const) {
        const s = t.fits(Array(Math.max(t.slots, 1)).fill(o), '4:5');
        expect(s).toBeGreaterThanOrEqual(0);
        expect(s).toBeLessThanOrEqual(1);
      }
    }
    expect(getTemplate('stack-3')!.fits(['l', 'l', 'l'], '4:5')).toBeGreaterThan(getTemplate('stack-3')!.fits(['p', 'p', 'p'], '4:5'));
    expect(getTemplate('pair-side')!.fits(['p', 'p'])).toBeGreaterThan(getTemplate('pair-side')!.fits(['l', 'l']));
  });
  it('orientationOf', () => {
    expect(orientationOf({ width: 4000, height: 3000 })).toBe('l');
    expect(orientationOf({ width: 3000, height: 4000 })).toBe('p');
    expect(orientationOf({ width: 100, height: 100 })).toBe('s');
  });
});

describe('no overlaps in non-stylized layouts', () => {
  const skip = new Set(['polaroid-scatter', 'polaroid-scatter-2', 'polaroid-on-photo']);
  for (const t of TEMPLATES.filter((x) => x.slots > 1 && !skip.has(x.id))) {
    for (const aspect of ASPECTS) {
      it(`${t.id} @ ${aspect}`, () => {
        const rs = rects(t, aspect);
        for (let i = 0; i < rs.length; i++) {
          for (let j = i + 1; j < rs.length; j++) {
            const a = rs[i];
            const b = rs[j];
            const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
            const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
            expect(ox <= EPS || oy <= EPS).toBe(true);
          }
        }
      });
    }
  }
});

describe('uniform gutters', () => {
  const cases: [string, number, boolean][] = [
    ['stack-2', 0.025, true], ['stack-3', 0.025, true], ['stack-2-tight', 0.005, false], ['stack-3-tight', 0.005, false],
    ['grid-2x2', 0.025, true], ['grid-3x3', 0.025, true], ['overview-grid', 0.025, true], ['trio', 0.025, true],
  ];
  for (const [id, gap, margins] of cases) {
    for (const aspect of ASPECTS) {
      it(`${id} @ ${aspect}`, () => {
        const t = getTemplate(id)!;
        const H = 1 / aspectRatio(aspect);
        const rs = rects(t, aspect);
        const gaps: number[] = [];
        for (const a of rs) {
          let right = Infinity;
          let below = Infinity;
          for (const b of rs) {
            if (a === b) continue;
            if (Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > EPS && b.x >= a.x + a.w - EPS) right = Math.min(right, b.x - (a.x + a.w));
            if (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > EPS && b.y >= a.y + a.h - EPS) below = Math.min(below, b.y - (a.y + a.h));
          }
          if (right < Infinity) gaps.push(right);
          if (below < Infinity) gaps.push(below);
        }
        expect(gaps.length).toBeGreaterThan(0);
        for (const g of gaps) expect(Math.abs(g - gap)).toBeLessThan(EPS);
        if (margins) {
          expect(Math.abs(Math.min(...rs.map((r) => r.x)) - gap)).toBeLessThan(EPS);
          expect(Math.abs(1 - Math.max(...rs.map((r) => r.x + r.w)) - gap)).toBeLessThan(EPS);
          expect(Math.abs(Math.min(...rs.map((r) => r.y)) - gap)).toBeLessThan(EPS);
          expect(Math.abs(H - Math.max(...rs.map((r) => r.y + r.h)) - gap)).toBeLessThan(EPS);
        }
      });
    }
  }
  it('custom gap and margin are honoured', () => {
    const rs = rects(getTemplate('grid-2x2')!, '4:5', { gap: 0.04, margin: 0.06 });
    expect(Math.min(...rs.map((r) => r.x))).toBeCloseTo(0.06, 12);
    expect(rs[1].x - (rs[0].x + rs[0].w)).toBeCloseTo(0.04, 12);
  });
});

describe('aspect preservation and centring', () => {
  const photosOf = (n: number, sizes: [number, number][]) => makePhotos(n, 9, sizes);
  const innerAspect = (el: PhotoEl, aspect: Aspect) => {
    const H = 1 / aspectRatio(aspect);
    const { inner } = layoutElementPx(el, 1, H);
    return inner.w / inner.h;
  };
  it('white-border, matted and framed singles keep the photo aspect and are centred', () => {
    for (const id of ['single-border', 'matted-single', 'framed-portrait']) {
      for (const aspect of ASPECTS) {
        for (const size of [[4000, 3000], [3000, 4000]] as [number, number][]) {
          const [p] = photosOf(1, [size]);
          const [el] = getTemplate(id)!.layout(aspect, [p]).pages[0] as PhotoEl[];
          expect(innerAspect(el, aspect)).toBeCloseTo(size[0] / size[1], 9);
          expect(el.x + el.w / 2).toBeCloseTo(0.5, 12);
          expect(el.y + el.h / 2).toBeCloseTo(0.5, 12);
        }
      }
    }
  });
  it('matted single is black-framed at 1.7%', () => {
    const [el] = getTemplate('matted-single')!.layout('4:5', photosOf(1, [[4000, 3000]])).pages[0] as PhotoEl[];
    expect(el.frame).toBeCloseTo(0.017);
    expect(el.frameColor).toBe('#0a0a0a');
  });
  it('pairs keep both aspects and centre the group', () => {
    for (const aspect of ASPECTS) {
      const ph = photosOf(2, [[4000, 3000], [6000, 2400]]);
      const els = getTemplate('pair-stacked')!.layout(aspect, ph).pages[0] as PhotoEl[];
      ph.forEach((p, i) => expect(innerAspect(els[i], aspect)).toBeCloseTo(p.width / p.height, 9));
      const H = 1 / aspectRatio(aspect);
      const top = els[0].y * H;
      const bottom = (els[1].y + els[1].h) * H;
      expect(top).toBeCloseTo(H - bottom, 9);
      const side = getTemplate('pair-side')!.layout(aspect, photosOf(2, [[3000, 4000], [2000, 3000]])).pages[0] as PhotoEl[];
      expect(side[0].x).toBeCloseTo(1 - (side[1].x + side[1].w), 9);
      expect(side[0].y * H + (side[0].h * H) / 2).toBeCloseTo(H / 2, 9);
    }
  });
  it('panorama spans pages with margins only on the outer edges', () => {
    const t = getTemplate('pano-2')!;
    const res = t.layout('4:5', makePhotos(1, 1, [[6000, 2400]]), { gap: 0.025 });
    expect(res.pages[1]).toEqual([]);
    const el = res.pages[0][0] as PhotoEl;
    expect(el.x).toBeCloseTo(0.025);
    expect(el.x + el.w).toBeCloseTo(2 - 0.025);
    expect(innerAspect(el, '4:5')).toBeCloseTo(2.5, 9);
  });
  it('seamless split crosses the seam and insets the neighbours', () => {
    const res = getTemplate('seamless-split')!.layout('4:5', makePhotos(3, 1, [[3000, 4000]]));
    const span = res.pages[0].find((e) => e.x + e.w > 1) as PhotoEl;
    expect(span.x).toBeCloseTo(0.55);
    expect(span.x + span.w).toBeCloseTo(1.45);
    expect(span.y).toBe(0);
    expect(span.h).toBeCloseTo(1);
  });
  it('polaroid on photo: blurred background and mono caption, card rotated within +-3 degrees', () => {
    const res = getTemplate('polaroid-on-photo')!.layout('4:5', makePhotos(2), { caption: 'JUN 2025', seed: 4 });
    const [bg, card, cap] = res.pages[0];
    expect(bg.kind === 'photo' && bg.blur).toBeGreaterThan(0);
    expect(card.kind === 'photo' && card.frameBottom).toBeGreaterThan(0);
    expect(Math.abs(card.rotation)).toBeLessThanOrEqual(3);
    expect(cap.kind === 'text' && cap.font).toBe('mono');
    expect(cap.rotation).toBe(card.rotation);
    expect(getTemplate('polaroid-on-photo')!.layout('4:5', makePhotos(2)).pages[0]).toHaveLength(2);
  });
  it('scatter is deterministic per seed', () => {
    const t = getTemplate('polaroid-scatter')!;
    const run = (seed: number) => JSON.stringify(t.layout('4:5', makePhotos(3), { seed }).pages.map((p) => p.map((e) => e.rotation)));
    expect(run(3)).toBe(run(3));
    expect(run(3)).not.toBe(run(4));
  });
  it('cover has a thin uppercase light title near the top; no title means photo only', () => {
    const els = getTemplate('cover')!.layout('4:5', makePhotos(1), { title: 'Faroe Islands' }).pages[0];
    const text = els.find((e) => e.kind === 'text')!;
    expect(text.kind === 'text' && text.uppercase).toBe(true);
    expect(text.kind === 'text' && text.weight).toBe(400);
    expect(text.y).toBeLessThan(0.2);
    expect(getTemplate('cover')!.layout('4:5', makePhotos(1)).pages[0]).toHaveLength(1);
  });
  it('film strip is on black with sprockets', () => {
    const res = getTemplate('film-strip')!.layout('4:5', makePhotos(3, 1, [[4000, 3000]]));
    expect(res.backgrounds[0]).toBe('#0b0b0b');
    expect(res.pages[0].filter((e: El) => e.kind === 'rect').length).toBeGreaterThan(6);
  });
  it('layouts tolerate missing photos', () => {
    for (const t of TEMPLATES) expect(() => t.layout('4:5', [])).not.toThrow();
  });
});

describe('reference sizing', () => {
  it('cover title spans about 80% of the width and is big', () => {
    for (const aspect of ['4:5', '1:1', '9:16'] as Aspect[]) {
      const H = 1 / aspectRatio(aspect);
      const t = getTemplate('cover')!.layout(aspect, makePhotos(1), { title: 'The Faroes', subtitle: 'June 2025' }).pages[0].filter((e) => e.kind === 'text');
      const title = t[0] as import('../src/story/model').TextEl;
      const widthUnits = 'THE FAROES'.length * (0.58 + title.letterSpacing) * title.size * H;
      expect(widthUnits).toBeGreaterThan(0.7);
      expect(widthUnits).toBeLessThan(0.86);
      expect(title.size).toBeGreaterThanOrEqual(0.05);
      expect(title.size).toBeLessThanOrEqual(0.13);
      expect(title.y).toBeCloseTo(0.09, 6);
      const sub = t[1] as import('../src/story/model').TextEl;
      expect(sub.size).toBeCloseTo(0.022, 6);
      expect(sub.letterSpacing).toBe(0.3);
    }
  });
  it('long titles wrap rather than shrink below 5% of the height', () => {
    const t = getTemplate('cover')!.layout('4:5', makePhotos(1), { title: 'A very long journey through the Faroe Islands' }).pages[0].find((e) => e.kind === 'text') as import('../src/story/model').TextEl;
    expect(t.size).toBeGreaterThanOrEqual(0.05 - 1e-9);
    expect(t.text.includes('\n')).toBe(true);
  });
  it('matted landscape is ~88% wide; portrait matted/framed ~86% tall', () => {
    const [m] = getTemplate('matted-single')!.layout('4:5', makePhotos(1, 1, [[4000, 3000]])).pages[0] as PhotoEl[];
    expect(m.w).toBeCloseTo(0.88, 9);
    const [p] = getTemplate('matted-single')!.layout('4:5', makePhotos(1, 1, [[3000, 4000]])).pages[0] as PhotoEl[];
    expect(p.h).toBeCloseTo(0.86, 9);
    const [f] = getTemplate('framed-portrait')!.layout('4:5', makePhotos(1, 1, [[3000, 4000]])).pages[0] as PhotoEl[];
    expect(f.h).toBeCloseTo(0.86, 9);
  });
});
