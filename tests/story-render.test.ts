import { describe, expect, it } from 'vitest';
import { FONT_STACKS, fontShorthand } from '../src/story/fonts';
import { addPhotos, defaultPhotoEl, defaultRectEl, defaultTextEl, emptyPage, emptyStory, setPages } from '../src/story/model';
import { layoutElementPx, neededPhotoEdge, renderPage } from '../src/story/render';

type Call = [string, ...unknown[]];
function fakeCanvas(w: number, h: number) {
  const calls: Call[] = [];
  const state: Record<string, unknown> = {};
  const ctx = new Proxy(state, {
    get: (t, k: string) => {
      if (k === 'measureText') return (s: string) => ({ width: s.length * 10 });
      if (k in t) return t[k];
      return (...a: unknown[]) => void calls.push([k, ...a]);
    },
    set: (t, k: string, v) => {
      t[k] = v;
      calls.push(['set:' + k, v]);
      return true;
    },
    has: (_t, k) => k === 'filter' || k === 'letterSpacing' || k === 'roundRect',
  });
  return { canvas: { width: w, height: h, getContext: () => ctx } as unknown as HTMLCanvasElement, calls };
}

describe('layoutElementPx', () => {
  it('frames sit inside the outer box', () => {
    const el = defaultPhotoEl({ x: 0.1, y: 0.2, w: 0.5, h: 0.4, frame: 0.02, frameBottom: 0.1, rotation: 10 });
    const r = layoutElementPx(el, 1000, 1250);
    expect(r.outer).toEqual({ x: 100, y: 250, w: 500, h: 500 });
    expect(r.inner).toEqual({ x: 120, y: 270, w: 460, h: 500 - 40 - 100 });
    expect(r.cx).toBe(350);
    expect(r.cy).toBe(500);
    expect(r.rotation).toBe(10);
  });
  it('text and rect have no frame', () => {
    const r = layoutElementPx(defaultRectEl({ x: 0, y: 0, w: 1, h: 1 }), 100, 200);
    expect(r.inner).toEqual(r.outer);
  });
});

describe('renderPage', () => {
  const photo = { id: 'a', name: 'a', width: 200, height: 100 };
  const bitmap = { width: 200, height: 100 } as ImageBitmap;
  const make = () => {
    let s = addPhotos(emptyStory('1:1'), [photo]);
    s = setPages(s, [
      { ...emptyPage('#112233'), elements: [
        { ...defaultRectEl({ x: 0, y: 0, w: 0.2, h: 0.2, fill: '#f00' }), z: 0 },
        { ...defaultPhotoEl({ x: 0.025, y: 0.2, w: 1.95, h: 0.5, photoId: 'a' }), z: 1 },
        { ...defaultTextEl({ text: 'hello\nworld', uppercase: true, letterSpacing: 0.2, font: 'display', weight: 400, size: 0.1 }), z: 2 },
      ] },
      emptyPage('#fff'),
    ]);
    return s;
  };
  it('draws background, rect, photo and text in z order', async () => {
    const f = fakeCanvas(0, 0);
    const out = await renderPage(make(), 0, 400, () => bitmap, { createCanvas: () => f.canvas });
    expect(out).toBe(f.canvas);
    const names = f.calls.map((c) => c[0]);
    expect(f.calls[0]).toEqual(['set:fillStyle', '#112233']);
    expect(names.indexOf('fill')).toBeLessThan(names.indexOf('drawImage'));
    expect(names.indexOf('drawImage')).toBeLessThan(names.indexOf('fillText'));
    const texts = f.calls.filter((c) => c[0] === 'fillText').map((c) => c[1]);
    expect(texts).toEqual(['HELLO', 'WORLD']);
    expect(f.calls.some((c) => c[0] === 'set:font' && c[1] === fontShorthand({ font: 'display', weight: 400, size: 0.1 }, 400))).toBe(true);
    expect(FONT_STACKS.display).toMatch(/Didot/);
  });
  it('draws neighbour overflow on the next page, shifted left', async () => {
    const f = fakeCanvas(0, 0);
    await renderPage(make(), 1, 400, () => bitmap, { createCanvas: () => f.canvas });
    const draw = f.calls.find((c) => c[0] === 'drawImage')!;
    expect(draw[6]).toBeCloseTo((0.025 - 1) * 400);
    expect(draw[8]).toBeCloseTo(1.95 * 400);
    expect(f.calls.some((c) => c[0] === 'fillText')).toBe(false);
  });
  it('draws a placeholder when the bitmap is missing', async () => {
    const f = fakeCanvas(0, 0);
    await renderPage(make(), 0, 400, () => null, { createCanvas: () => f.canvas });
    expect(f.calls.some((c) => c[0] === 'drawImage')).toBe(false);
    expect(f.calls.some((c) => c[0] === 'set:fillStyle' && c[1] === '#e4e4e7')).toBe(true);
  });
  it('sizes the canvas from the aspect', async () => {
    let size: number[] = [];
    const s = { ...make(), aspect: '4:5' as const };
    await renderPage(s, 0, 1080, () => bitmap, { createCanvas: (w, h) => ((size = [w, h]), fakeCanvas(w, h).canvas) });
    expect(size).toEqual([1080, 1350]);
  });
});

describe('export decode sizing', () => {
  const photo = { id: 'a', name: 'a', width: 4000, height: 3000 };
  const page = (els: ReturnType<typeof defaultPhotoEl>[]) => setPages(addPhotos(emptyStory('1:1'), [photo]), [{ ...emptyPage(), elements: els }]);

  it('needs only as many pixels as the box shows, more when zoomed in, never more than the original', () => {
    const half = defaultPhotoEl({ x: 0, y: 0, w: 0.5, h: 0.5, photoId: 'a' });
    // 1000 px page: a 500 px square shows the 3000x3000 centre of the photo -> 500/3000 px per source px.
    expect(neededPhotoEdge(half, photo, 1000, 1000)).toBe(Math.ceil(4000 * (500 / 3000)));
    const zoomed = { ...half, crop: { zoom: 4, cx: 0.5, cy: 0.5 } };
    expect(neededPhotoEdge(zoomed, photo, 1000, 1000)).toBeCloseTo(4000 * (500 / 750), -1);
    expect(neededPhotoEdge({ ...zoomed, crop: { zoom: 8, cx: 0.5, cy: 0.5 } }, photo, 4000, 4000)).toBe(4000);
    const tiny = { id: 'b', name: 'b', width: 100, height: 100 };
    expect(neededPhotoEdge(half, tiny, 4000, 4000)).toBe(100);
  });

  it('closeAfterDraw asks per element with its size and closes each bitmap right after drawing it', async () => {
    const a = defaultPhotoEl({ id: 'e1', x: 0, y: 0, w: 0.5, h: 0.5, photoId: 'a', z: 0 });
    const b = defaultPhotoEl({ id: 'e2', x: 0.5, y: 0.5, w: 0.5, h: 0.5, photoId: 'a', z: 1 });
    const s = page([a, b]);
    const f = fakeCanvas(0, 0);
    const log: string[] = [];
    let alive = 0;
    const edges: (number | undefined)[] = [];
    await renderPage(s, 0, 1000, async (_p, edge) => {
      edges.push(edge);
      alive++;
      log.push('get');
      expect(alive).toBe(1);
      return { width: 1000, height: 750, close: () => { alive--; log.push('close'); } } as unknown as ImageBitmap;
    }, { createCanvas: () => f.canvas, closeAfterDraw: true });
    expect(log).toEqual(['get', 'close', 'get', 'close']);
    expect(edges.every((e) => typeof e === 'number' && e > 0 && e <= 4000)).toBe(true);
    expect(f.calls.filter((c) => c[0] === 'drawImage')).toHaveLength(2);
  });

  it('without closeAfterDraw one bitmap per photo is requested with the largest need and never closed', async () => {
    const small = defaultPhotoEl({ x: 0, y: 0, w: 0.2, h: 0.2, photoId: 'a' });
    const big = defaultPhotoEl({ x: 0, y: 0.3, w: 0.8, h: 0.6, photoId: 'a' });
    const f = fakeCanvas(0, 0);
    const calls: (number | undefined)[] = [];
    await renderPage(page([small, big]), 0, 1000, (_p, edge) => { calls.push(edge); return { width: 10, height: 10, close: () => { throw new Error('closed'); } } as unknown as ImageBitmap; }, { createCanvas: () => f.canvas });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe(neededPhotoEdge(big, photo, 1000, 1000));
  });
});
