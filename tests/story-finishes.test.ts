import { describe, expect, it } from 'vitest';
import { ARRANGEMENTS, getArrangement, layoutArrangement, pickableFinishes } from '../src/story/arrangements';
import { makeStory, STYLE_CHOICES, templateKey } from '../src/story/autofill';
import { MAT_PAD } from '../src/story/layoutKit';
import { applyLayout, currentFinish, layoutOptions, nextFinish, nextLayout } from '../src/story/layouts';
import { ASPECTS, aspectRatio, emptyStory, deserializeStory, serializeStory, type Aspect, type Page, type PhotoEl, type RectEl, type Story } from '../src/story/model';
import { layoutElementPx } from '../src/story/render';
import { getTemplate, TEMPLATE_ALIASES } from '../src/story/templates';
import { migrateTemplate } from '../src/story/templateAliases';
import { makePhotos } from './story-helpers';

const EPS = 1e-9;
const L: [number, number][] = [[4000, 3000]];
const P: [number, number][] = [[3000, 4000]];
const MIXED: [number, number][] = [[4000, 3000], [3000, 4000], [4000, 4000], [6000, 2400]];
const photosFor = (slots: number, orient: 'l' | 'p' | 'x') => makePhotos(Math.max(slots, 1), 4, orient === 'l' ? L : orient === 'p' ? P : MIXED);

type R = { x: number; y: number; w: number; h: number; el: PhotoEl };
function rects(arrId: string, finish: Parameters<typeof layoutArrangement>[1], aspect: Aspect, orient: 'l' | 'p' | 'x'): R[] {
  const a = getArrangement(arrId)!;
  const H = 1 / aspectRatio(aspect);
  const res = layoutArrangement(a, finish, aspect, photosFor(a.slots, orient), { title: 'T', caption: 'c' });
  return res.pages.flatMap((els, pi) => els.filter((e): e is PhotoEl => e.kind === 'photo').map((el) => ({ x: el.x + pi, y: el.y * H, w: el.w, h: el.h * H, el })));
}

describe('arrangement x finish', () => {
  for (const a of ARRANGEMENTS.filter((x) => x.slots > 0)) {
    const finishes = a.finishes.length ? a.finishes : [null];
    for (const f of finishes) {
      for (const aspect of ASPECTS) {
        for (const orient of ['l', 'p', 'x'] as const) {
          it(`${a.id}/${f ?? 'built-in'} @ ${aspect} ${orient}: inside the page, no overlaps, equal gutters`, () => {
            const H = 1 / aspectRatio(aspect);
            const rs = rects(a.id, f, aspect, orient);
            expect(rs).toHaveLength(a.slots);
            for (const r of rs) {
              if (a.pages === 1 && !['polaroid-scatter', 'polaroid-scatter-2', 'polaroid-on-photo'].includes(a.id)) {
                expect(r.x).toBeGreaterThanOrEqual(-EPS);
                expect(r.x + r.w).toBeLessThanOrEqual(1 + EPS);
                expect(r.y).toBeGreaterThanOrEqual(-EPS);
                expect(r.y + r.h).toBeLessThanOrEqual(H + EPS);
              }
              expect(r.w).toBeGreaterThan(0);
              expect(r.h).toBeGreaterThan(0);
            }
            if (a.group === 'multi' && rs.length > 1) {
              for (let i = 0; i < rs.length; i++) for (let j = i + 1; j < rs.length; j++) {
                const ox = Math.min(rs[i].x + rs[i].w, rs[j].x + rs[j].w) - Math.max(rs[i].x, rs[j].x);
                const oy = Math.min(rs[i].y + rs[i].h, rs[j].y + rs[j].h) - Math.max(rs[i].y, rs[j].y);
                expect(ox <= EPS || oy <= EPS).toBe(true);
              }
              // Gutters between neighbours are all the same (a stack/grid with equal cells; pairs of mixed aspects share one gap too).
              const gap = f === 'tight' ? 0.005 : 0.025;
              for (const r of rs) {
                let right = Infinity;
                let below = Infinity;
                for (const q of rs) {
                  if (r === q) continue;
                  if (Math.min(r.y + r.h, q.y + q.h) - Math.max(r.y, q.y) > EPS && q.x >= r.x + r.w - EPS) right = Math.min(right, q.x - (r.x + r.w));
                  if (Math.min(r.x + r.w, q.x + q.w) - Math.max(r.x, q.x) > EPS && q.y >= r.y + r.h - EPS) below = Math.min(below, q.y - (r.y + r.h));
                }
                if (right < Infinity) expect(Math.abs(right - gap)).toBeLessThan(EPS);
                if (below < Infinity) expect(Math.abs(below - gap)).toBeLessThan(EPS);
              }
            }
          });
        }
      }
    }
  }

  it('every arrangement names an allowed default finish; covers have one look, spreads and specials none', () => {
    for (const a of ARRANGEMENTS) {
      if (a.finishes.length === 0) expect(a.defaultFinish).toBeNull();
      else expect(a.finishes).toContain(a.defaultFinish);
      if (a.group === 'cover') expect(a.finishes).toHaveLength(1);
      if (a.group === 'spread' || a.group === 'special') expect(pickableFinishes(a)).toEqual([]);
    }
    for (const id of ['stack-2', 'stack-3', 'pair-stacked', 'pair-side', 'trio', 'triptych', 'grid-2x2', 'grid-3x3', 'overview-grid']) {
      expect(getArrangement(id)!.finishes).toEqual(['plain', 'tight', 'black', 'mat']);
    }
  });

  it('black keeps the outer geometry of plain and only adds a thin black frame', () => {
    for (const a of ARRANGEMENTS.filter((x) => x.finishes.includes('black'))) {
      for (const aspect of ASPECTS) {
        const plain = rects(a.id, 'plain', aspect, 'x');
        const black = rects(a.id, 'black', aspect, 'x');
        black.forEach((r, i) => {
          expect([r.x, r.y, r.w, r.h]).toEqual([plain[i].x, plain[i].y, plain[i].w, plain[i].h]);
          expect(r.el.frameColor).toBe('#000000');
          expect(r.el.frame).toBeCloseTo(0.006, 9);
        });
      }
    }
  });

  it('mat puts the whole group on a hairline paper inside the page, centred, with the photos inside it', () => {
    for (const a of ARRANGEMENTS.filter((x) => x.finishes.includes('mat') && x.group !== 'cover')) {
      for (const aspect of ASPECTS) {
        const H = 1 / aspectRatio(aspect);
        const res = layoutArrangement(a, 'mat', aspect, photosFor(a.slots, 'x'));
        const paper = res.pages[0][0] as RectEl;
        expect(paper.kind).toBe('rect');
        expect(paper.stroke.toLowerCase()).toBe('#d6d6d6');
        expect(paper.shadow).toBe(true);
        const ph = res.pages[0].filter((e): e is PhotoEl => e.kind === 'photo');
        expect(ph).toHaveLength(a.slots);
        for (const e of ph) {
          expect(e.x).toBeGreaterThanOrEqual(paper.x + MAT_PAD - EPS);
          expect(e.x + e.w).toBeLessThanOrEqual(paper.x + paper.w - MAT_PAD + EPS);
          expect(e.y).toBeGreaterThanOrEqual(paper.y + MAT_PAD * aspectRatio(aspect) - EPS);
          expect(e.y + e.h).toBeLessThanOrEqual(paper.y + paper.h - MAT_PAD * aspectRatio(aspect) + EPS);
        }
        expect(paper.x).toBeGreaterThanOrEqual(0.05 - EPS);
        expect(paper.x + paper.w).toBeLessThanOrEqual(0.95 + EPS);
        expect(paper.x + paper.w / 2).toBeCloseTo(0.5, 9);
        expect((paper.y + paper.h / 2) / aspectRatio(aspect)).toBeCloseTo(H / 2, 9);
      }
    }
  });

  it('tight narrows the gutter only; singles get frame, shadow and bleed', () => {
    const a = getArrangement('single')!;
    const [bleed] = layoutArrangement(a, 'bleed', '4:5', photosFor(1, 'l')).pages[0] as PhotoEl[];
    expect([bleed.x, bleed.y, bleed.w, bleed.h]).toEqual([0, 0, 1, 1]);
    const [shadow] = layoutArrangement(a, 'shadow', '4:5', photosFor(1, 'l')).pages[0] as PhotoEl[];
    expect(shadow).toMatchObject({ frame: 0.017, frameColor: '#0a0a0a', shadow: true });
    const { inner } = layoutElementPx(shadow, 1, 1.25);
    expect(inner.w / inner.h).toBeCloseTo(4 / 3, 9);
    const [frame] = layoutArrangement(a, 'frame', '4:5', photosFor(1, 'l')).pages[0] as PhotoEl[];
    expect(frame.shadow).toBe(false);
  });
});

describe('old template ids', () => {
  const oldIds = Object.keys(TEMPLATE_ALIASES);
  it('every old id resolves to an existing arrangement and an allowed finish', () => {
    for (const id of oldIds) {
      const t = getTemplate(id);
      expect(t, id).toBeDefined();
      const alias = TEMPLATE_ALIASES[id];
      expect(getArrangement(alias.arrangement), id).toBeDefined();
      if (alias.portrait) expect(getArrangement(alias.portrait)).toBeDefined();
      if (alias.finish) expect(getArrangement(alias.arrangement)!.finishes).toContain(alias.finish);
    }
    expect(migrateTemplate('stack-3-tight')).toEqual({ templateId: 'stack-3', finish: 'tight' });
    expect(migrateTemplate('stack-2-black')).toEqual({ templateId: 'stack-2', finish: 'black' });
    expect(migrateTemplate('print-mat')).toEqual({ templateId: 'stack-2', finish: 'mat' });
    expect(migrateTemplate('print-mat-3', true)).toEqual({ templateId: 'triptych', finish: 'mat' });
    expect(migrateTemplate('print-mat-3', false)).toEqual({ templateId: 'stack-3', finish: 'mat' });
    expect(migrateTemplate('print-mat-4')).toEqual({ templateId: 'grid-2x2', finish: 'mat' });
    expect(migrateTemplate('single-bleed')).toEqual({ templateId: 'single', finish: 'bleed' });
    expect(migrateTemplate('matted-single')).toEqual({ templateId: 'single', finish: 'frame' });
    expect(migrateTemplate('mystery')).toEqual({ templateId: 'mystery' });
    expect(migrateTemplate(null)).toEqual({ templateId: null });
  });

  // Frozen geometry of the old catalog (x, y, w, h of each photo element at 4:5 with three 3:2 landscapes).
  const EXACT: Record<string, string> = {
    'stack-3-tight': 'stack-3/tight', 'stack-2-tight': 'stack-2/tight', 'stack-2-black': 'stack-2/black', 'stack-3-black': 'stack-3/black',
    'stack-2': 'stack-2/plain', 'single-border': 'single/plain', 'matted-single': 'single/frame', 'pair-side': 'pair-side/plain', 'grid-2x2': 'grid-2x2/plain',
  };
  it('an old id and its (arrangement, finish) lay out the same boxes', () => {
    for (const [oldId, pair] of Object.entries(EXACT)) {
      const [arr, fin] = pair.split('/');
      for (const aspect of ASPECTS) {
        const photos = makePhotos(4, 3, L);
        const a = getTemplate(oldId)!.layout(aspect, photos).pages[0];
        const b = layoutArrangement(getArrangement(arr)!, fin as never, aspect, photos).pages[0];
        expect(b).toHaveLength(a.length);
        a.forEach((e, i) => ['x', 'y', 'w', 'h'].forEach((k) => expect(Math.abs((e as never)[k] - (b[i] as never)[k]), `${oldId} ${aspect} ${k}`).toBeLessThan(EPS)));
      }
    }
  });
  it('matches boxes frozen from the old catalog', () => {
    const photos = makePhotos(3, 5, L);
    const first = (id: string) => getTemplate(id)!.layout('4:5', photos).pages[0].map((e) => [e.x, e.y, e.w, e.h]);
    const h = (1.25 - 0.05 - 0.01) / 3;
    const tight = first('stack-3-tight');
    [0.025, 0.025 * 0.8, 0.95, h * 0.8].forEach((v, k) => expect(Math.abs(tight[0][k] - v)).toBeLessThan(EPS));
    [0.025, (0.025 + 2 * (h + 0.005)) * 0.8, 0.95, h * 0.8].forEach((v, k) => expect(Math.abs(tight[2][k] - v)).toBeLessThan(EPS));
  });

  it('deserializing a story saved with old ids migrates the label and keeps every element box', () => {
    const photos = makePhotos(3, 6, L);
    const pageOf = (tid: string, id: string): Page => {
      const t = getTemplate(tid)!;
      return { id, templateId: tid, background: '#ffffff', duration: 3, elements: t.layout('4:5', photos.slice(0, t.slots)).pages[0] };
    };
    const old: Story = { ...emptyStory('4:5'), photos, pages: [pageOf('stack-3-tight', 'a'), pageOf('stack-2-black', 'b'), pageOf('single-bleed', 'c'), pageOf('print-mat-3', 'd')] };
    const parsed = deserializeStory(serializeStory(old));
    expect(parsed.pages.map((p) => [p.templateId, p.finish])).toEqual([['stack-3', 'tight'], ['stack-2', 'black'], ['single', 'bleed'], ['stack-3', 'mat']]);
    parsed.pages.forEach((p, i) => expect(p.elements).toEqual(old.pages[i].elements));
    // And a new-style page round-trips untouched.
    const again = deserializeStory(serializeStory(parsed));
    expect(again.pages.map((p) => [p.templateId, p.finish])).toEqual(parsed.pages.map((p) => [p.templateId, p.finish]));
  });
});

describe('finish stepping', () => {
  const stackStory = (): Story => {
    const photos = makePhotos(3, 2, L);
    const t = getTemplate('stack-3')!;
    const pages: Page[] = [{ id: 'p0', templateId: 'stack-3', finish: 'plain', background: '#fff', duration: 3, elements: t.layout('4:5', photos).pages[0] }];
    return { ...emptyStory('4:5'), photos, pages };
  };
  it('nextFinish cycles the arrangement finishes and wraps', () => {
    let s = stackStory();
    const seen: string[] = [];
    for (let k = 0; k < 4; k++) {
      const t = nextFinish(s, 0, 1)!;
      seen.push(t.finish);
      s = applyLayout(s, 0, t, { seed: 1 }).story;
      expect(s.pages[0]).toMatchObject({ templateId: 'stack-3', finish: t.finish });
    }
    expect(seen).toEqual(['tight', 'black', 'mat', 'plain']);
    expect(nextFinish(s, 0, -1)!.finish).toBe('mat');
  });
  it('a finish change keeps the photos and the arrangement; nextLayout keeps the finish when allowed', () => {
    let s = applyLayout(stackStory(), 0, { arrangement: 'stack-3', finish: 'black' }, { seed: 1 }).story;
    expect(currentFinish(s, 0)).toBe('black');
    expect(s.pages[0].elements.filter((e) => e.kind === 'photo').map((e) => (e as PhotoEl).frameColor)).toEqual(['#000000', '#000000', '#000000']);
    const first = nextLayout(s, 0, 1)!;
    expect(first.finish).toBe(getArrangement(first.arrangement)!.finishes.includes('black') ? 'black' : getArrangement(first.arrangement)!.defaultFinish);
    for (let k = 0; k < 12; k++) {
      const o = nextLayout(s, 0, 1)!;
      const a = getArrangement(o.arrangement)!;
      const before = currentFinish(s, 0);
      expect(o.finish).toBe(before && a.finishes.includes(before) && a.finishes.length > 1 ? before : a.defaultFinish);
      s = applyLayout(s, 0, o, { seed: 1 }).story;
    }
    const opts = layoutOptions(s, 0);
    expect(opts.find((o) => o.current)).toBeDefined();
  });
  it('arrangements with a single look have nothing to step', () => {
    const s = applyLayout(stackStory(), 0, { arrangement: 'film-strip' }, { seed: 1 }).story;
    expect(nextFinish(s, 0, 1)).toBeNull();
    expect(s.pages[0].finish).toBeUndefined();
  });
});

describe('autofill finishes', () => {
  it('uses only allowed finishes, deterministic per seed, never the same pair three times running', () => {
    for (const style of ['clean', 'stylized'] as const) {
      for (const seed of [1, 2, 3, 4]) {
        const photos = makePhotos(40, seed, MIXED);
        const a = makeStory(photos, { style, aspect: '4:5', seed, title: 'T' });
        expect(JSON.stringify(makeStory(photos, { style, aspect: '4:5', seed, title: 'T' }))).toBe(JSON.stringify(a));
        for (const p of a) {
          const arr = getArrangement(p.templateId)!;
          if (arr.finishes.length) expect(arr.finishes).toContain(p.finish);
          else expect(p.finish).toBeUndefined();
        }
        const keys = a.filter((p) => !p.spread || p.spread.index === 0).map((p) => `${p.templateId}/${p.finish ?? ''}`);
        for (let i = 2; i < keys.length; i++) expect(keys[i] === keys[i - 1] && keys[i] === keys[i - 2]).toBe(false);
      }
    }
  });
  it('style choices only name real arrangement/finish pairs', () => {
    for (const choices of Object.values(STYLE_CHOICES)) {
      for (const c of choices) {
        const a = getArrangement(c.arrangement)!;
        expect(a).toBeDefined();
        if (c.finish) expect(a.finishes).toContain(c.finish);
        expect(templateKey({ id: a.id, finish: c.finish })).toContain(a.id);
      }
    }
  });
  it('stylized favours black, mat, shadow and tight; clean stays plain', () => {
    const seen = { clean: new Set<string>(), stylized: new Set<string>() };
    for (let seed = 0; seed < 25; seed++) {
      for (const style of ['clean', 'stylized'] as const) {
        for (const p of makeStory(makePhotos(16, seed, MIXED), { style, aspect: '4:5', seed })) if (p.finish) seen[style].add(p.finish);
      }
    }
    expect([...seen.clean].filter((f) => ['mat', 'shadow', 'frame', 'tight'].includes(f))).toEqual([]);
    for (const f of ['black', 'mat', 'tight']) expect(seen.stylized.has(f)).toBe(true);
  });
});
