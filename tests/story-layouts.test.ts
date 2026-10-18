import { describe, expect, it } from 'vitest';
import { applyLayout, currentFinish, currentLayoutName, layoutOptions, nextLayout, FULL_EACH, type LayoutOption } from '../src/story/layouts';
import { getTemplate } from '../src/story/templates';
import { defaultTextEl, emptyStory, groupOf, type Page, type PhotoEl, type Story } from '../src/story/model';
import { makePhotos, photoIdsOf } from './story-helpers';
import type { Photo } from '../src/core/images';

const L = (id: string): Photo => ({ id, name: id, width: 3000, height: 2000 });
const P = (id: string): Photo => ({ id, name: id, width: 2000, height: 3000 });

/** A story whose single group is laid out with template `tid` from `photos`. */
function storyWith(tid: string, photos: Photo[], extraLib: Photo[] = []): Story {
  const t = getTemplate(tid)!;
  const res = t.layout('4:5', photos, { title: 'Hello', subtitle: 'Sub' });
  const pages: Page[] = res.pages.map((els, i) => ({
    id: `pg${i}`, templateId: t.id, ...(t.finish ? { finish: t.finish } : {}), background: res.backgrounds[i], elements: els, duration: 4,
    ...(t.pageCount > 1 ? { spread: { index: i, count: t.pageCount } } : {}),
  }));
  return { ...emptyStory('4:5'), title: 'Hello', pages, photos: [...photos, ...extraLib] };
}
const opt = (s: Story, i: number, id: string): LayoutOption => layoutOptions(s, i).find((o) => o.id === id)!;
const photoSet = (s: Story) => new Set(s.pages.flatMap((p) => photoIdsOf(p.elements)));

describe('layoutOptions', () => {
  it('offers Single (with a Full bleed finish) for a single photo, plus several more arrangements', () => {
    const s = storyWith('single-border', [L('a')]);
    const o = layoutOptions(s, 0).filter((x) => !x.id.startsWith('cover'));
    expect(o[0]).toMatchObject({ id: 'single', name: 'Single', slots: 1, pages: 1, group: 'single', finish: 'plain' });
    expect(o[0].finishes).toContain('bleed');
    expect(o.filter((x) => !x.slotsDiffer).length).toBeGreaterThanOrEqual(4);
    expect(o.filter((x) => x.current).map((x) => x.id)).toEqual(['single']);
    expect(new Set(o.map((x) => x.id)).size).toBe(o.length);
  });
  it('lists spreads only when they fit, and keeps a stable order', () => {
    expect(layoutOptions(storyWith('single-border', [P('a')]), 0).some((o) => o.pages > 1 && !o.slotsDiffer)).toBe(false);
    const land = storyWith('single-border', [L('a')]);
    expect(layoutOptions(land, 0).some((o) => o.arrangement === 'pano-2')).toBe(true);
    expect(layoutOptions(land, 0).map((o) => o.id)).toEqual(layoutOptions(land, 0).map((o) => o.id));
  });
  it('offers one-per-page for several photos and flags other photo counts', () => {
    const s = storyWith('pair-side', [P('a'), P('b')]);
    const o = layoutOptions(s, 0);
    expect(o.find((x) => x.arrangement === FULL_EACH)).toMatchObject({ slots: 2, pages: 2, group: 'single' });
    expect(o.filter((x) => !x.slotsDiffer && x.arrangement !== FULL_EACH).every((x) => x.slots === 2)).toBe(true);
    const d = o.filter((x) => x.slotsDiffer);
    expect(d.length).toBeGreaterThan(0);
    expect(d.every((x) => x.slots !== 2 && x.slots <= 9)).toBe(true);
    expect(o.indexOf(d[0])).toBeGreaterThan(o.findIndex((x) => x.id === 'pair-side'));
  });
  it('hides cover layouts unless there is a title, and is empty for a page without photos', () => {
    const s = storyWith('single-border', [L('a')]);
    expect(layoutOptions(s, 0).some((o) => o.id === 'cover')).toBe(true);
    expect(layoutOptions({ ...s, title: '' }, 0).some((o) => o.id === 'cover')).toBe(false);
    expect(layoutOptions({ ...s, pages: [{ ...s.pages[0], elements: [] }] }, 0)).toEqual([]);
  });
  it('treats a spread group as one unit', () => {
    const s = storyWith('seamless-split', [P('a'), L('b'), P('c')]);
    const a = layoutOptions(s, 0);
    expect(layoutOptions(s, 1)).toEqual(a);
    expect(a.find((o) => o.current)).toMatchObject({ id: 'seamless-split', pages: 2 });
  });
});

describe('nextLayout', () => {
  it('cycles through the same-slot options in a stable order and wraps both ways', () => {
    let s = storyWith('single-border', [L('a')]);
    const n = layoutOptions(s, 0).filter((o) => !o.slotsDiffer).length;
    const seen: string[] = [];
    for (let k = 0; k < n; k++) {
      const o = nextLayout(s, 0, 1)!;
      seen.push(o.id);
      s = applyLayout(s, 0, o, { seed: 1 }).story;
      expect(s.pages).toHaveLength(o.pages); // spreads add pages, the next step collapses them again
      expect(s.pages[0].id).toBe('pg0');
      expect(photoSet(s)).toEqual(new Set(['a']));
    }
    expect(new Set(seen).size).toBe(n);
    expect(seen[n - 1]).toBe('single'); // wrapped all the way round
    const back = nextLayout(s, 0, -1)!;
    expect(nextLayout(applyLayout(s, 0, back, { seed: 1 }).story, 0, 1)!.id).toBe('single');
  });
  it('steps to a neighbouring arrangement from a full-bleed single', () => {
    const s = storyWith('single-bleed', [L('a')]);
    expect(layoutOptions(s, 0).find((o) => o.current)!.id).toBe('single');
    expect(currentFinish(s, 0)).toBe('bleed');
    expect(nextLayout(s, 0, 1)!.id).not.toBe('single');
    expect(nextLayout(s, 0, -1)!.id).not.toBe('single');
  });
  it('never offers one-per-page in the cycle', () => {
    let s = storyWith('pair-side', [P('a'), P('b')]);
    for (let k = 0; k < 12; k++) {
      const o = nextLayout(s, 0, 1)!;
      expect(o.arrangement).not.toBe(FULL_EACH);
      s = applyLayout(s, 0, o, { seed: 2 }).story;
      expect(s.pages).toHaveLength(1);
    }
  });
  it('returns null when nothing else fits', () => {
    expect(nextLayout({ ...emptyStory(), pages: [] }, 0, 1)).toBeNull();
  });
});

describe('applyLayout', () => {
  it('Full screen puts the photo over the whole page and keeps id, duration and background', () => {
    const s = { ...storyWith('single-border', [L('a')]) };
    s.pages = [{ ...s.pages[0], background: '#123456', duration: 7 }];
    const r = applyLayout(s, 0, { arrangement: 'single', finish: 'bleed' }, { seed: 1 });
    const el = r.story.pages[0].elements[0] as PhotoEl;
    expect(el).toMatchObject({ photoId: 'a', x: 0, y: 0, w: 1 });
    expect(r.story.pages[0]).toMatchObject({ id: 'pg0', duration: 7, background: '#123456', templateId: 'single', finish: 'bleed' });
    expect(r.pageIndex).toBe(0);
  });
  it('keeps a crop when the frame has a similar shape, resets it otherwise', () => {
    const s = storyWith('single-border', [L('a')]);
    const crop = { zoom: 2, cx: 0.3, cy: 0.6 };
    s.pages = [{ ...s.pages[0], elements: s.pages[0].elements.map((e) => (e.kind === 'photo' ? { ...e, crop } : e)) }];
    const like = applyLayout(s, 0, opt(s, 0, 'single'), { seed: 1 }); // same shape
    expect((like.story.pages[0].elements[0] as PhotoEl).crop).toEqual(crop);
    const wide = applyLayout(s, 0, { arrangement: 'single', finish: 'bleed' }, { seed: 1 }); // 4:5 bleed vs 3:2 frame
    expect((wide.story.pages[0].elements[0] as PhotoEl).crop).toEqual({ zoom: 1, cx: 0.5, cy: 0.5 });
  });
  it('one-per-page makes N full-bleed pages, reusing page ids first', () => {
    const photos = [L('a'), P('b'), L('c')];
    const s = storyWith('trio', photos);
    const tail = storyWith('single-border', [L('z')]).pages[0];
    s.pages = [...s.pages, { ...tail, id: 'after' }];
    s.photos = [...photos, L('z')];
    const r = applyLayout(s, 0, opt(s, 0, FULL_EACH), { seed: 1 });
    expect(r.story.pages).toHaveLength(4);
    expect(r.story.pages.slice(0, 3).map((p) => photoIdsOf(p.elements))).toEqual([['a'], ['b'], ['c']]);
    expect(r.story.pages.every((p, i) => i === 3 || (p.templateId === 'single' && p.finish === 'bleed'))).toBe(true);
    expect(r.story.pages[0].id).toBe('pg0');
    expect(r.story.pages[3].id).toBe('after');
    expect(new Set(r.story.pages.map((p) => p.id)).size).toBe(4);
  });
  it('applies a spread, then collapsing it removes the other pages without losing photos', () => {
    const s = storyWith('single-border', [L('a')]);
    const spread = applyLayout(s, 0, opt(s, 0, 'pano-2'), { seed: 1 });
    expect(spread.story.pages).toHaveLength(2);
    expect(spread.story.pages.map((p) => p.spread)).toEqual([{ index: 0, count: 2 }, { index: 1, count: 2 }]);
    expect(spread.story.pages[0].id).toBe('pg0');
    expect(groupOf(spread.story, 1)).toEqual({ start: 0, end: 2 });
    const three = applyLayout(spread.story, 1, opt(spread.story, 1, 'pano-3'), { seed: 1 });
    expect(three.story.pages).toHaveLength(3);
    expect(three.pageIndex).toBe(1);
    const back = applyLayout(three.story, 1, { arrangement: 'single', finish: 'bleed' }, { seed: 1 });
    expect(back.story.pages).toHaveLength(1);
    expect(back.pageIndex).toBe(0);
    expect(photoSet(back.story)).toEqual(new Set(['a']));
    expect(back.story.pages[0].spread).toBeUndefined();
  });
  it('a 3-photo spread collapses to a trio keeping all three photos in order', () => {
    const s = storyWith('seamless-split', [P('a'), L('b'), P('c')]);
    const r = applyLayout(s, 1, opt(s, 1, 'trio'), { seed: 3 });
    expect(r.story.pages).toHaveLength(1);
    expect(photoIdsOf(r.story.pages[0].elements)).toEqual(['a', 'b', 'c']);
  });
  it('fewer slots drops trailing photos from the page but not the library', () => {
    const s = storyWith('trio', [L('a'), L('b'), L('c')]);
    const r = applyLayout(s, 0, opt(s, 0, 'pair-stacked'), { seed: 1 });
    expect(photoIdsOf(r.story.pages[0].elements)).toEqual(['a', 'b']);
    expect(r.story.photos.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
  it('more slots take extra photos in order, skip duplicates, then leave placeholders', () => {
    const s = storyWith('pair-side', [P('a'), P('b')], [L('x'), L('y')]);
    const o = opt(s, 0, 'grid-2x2');
    expect(o.slotsDiffer).toBe(true);
    const filled = applyLayout(s, 0, o, { seed: 1, extraPhotoIds: ['a', 'x', 'nope', 'y'] });
    expect(photoIdsOf(filled.story.pages[0].elements)).toEqual(['a', 'b', 'x', 'y']);
    const part = applyLayout(s, 0, o, { seed: 1, extraPhotoIds: ['x'] });
    const els = part.story.pages[0].elements as PhotoEl[];
    expect(els.map((e) => e.photoId)).toEqual(['a', 'b', 'x', null]);
  });
  it('keeps text the user added on the first page, and regenerates template text', () => {
    const s = storyWith('single-border', [L('a')]);
    const note = defaultTextEl({ text: 'my note' });
    s.pages = [{ ...s.pages[0], elements: [...s.pages[0].elements, note] }];
    const r = applyLayout(s, 0, opt(s, 0, 'cover'), { seed: 1 });
    const texts = r.story.pages[0].elements.filter((e) => e.kind === 'text').map((e) => (e.kind === 'text' ? e.text : ''));
    expect(texts).toContain('my note');
    expect(texts.some((t) => /hello/i.test(t))).toBe(true);
    // Switching away from the cover keeps its title as plain text; switching back does not duplicate it.
    const bleed = applyLayout(r.story, 0, { arrangement: 'single', finish: 'bleed' }, { seed: 1 });
    expect(bleed.story.pages[0].elements.filter((e) => e.kind === 'text').length).toBe(texts.length);
    const again = applyLayout(bleed.story, 0, opt(bleed.story, 0, 'cover'), { seed: 1 });
    expect(again.story.pages[0].elements.filter((e) => e.kind === 'text').length).toBe(texts.length);
  });
  it('leaves the film strip background behind when switching away', () => {
    const s = storyWith('film-strip', [L('a'), L('b'), L('c')]);
    expect(s.pages[0].background).toBe('#0b0b0b');
    const r = applyLayout(s, 0, opt(s, 0, 'trio'), { seed: 1 });
    expect(r.story.pages[0].background).toBe(s.background);
    const f = applyLayout(r.story, 0, opt(r.story, 0, 'film-strip'), { seed: 1 });
    expect(f.story.pages[0].background).toBe('#0b0b0b');
  });
  it('leaves other pages untouched and works on a later page of a longer story', () => {
    const photos = makePhotos(4, 5);
    const a = storyWith('single-border', [photos[0]]);
    const b = storyWith('pair-side', [photos[1], photos[2]]);
    const s: Story = { ...a, pages: [a.pages[0], { ...b.pages[0], id: 'second' }], photos: photos.slice(0, 3) };
    const r = applyLayout(s, 1, opt(s, 1, FULL_EACH), { seed: 1 });
    expect(r.story.pages).toHaveLength(3);
    expect(r.story.pages[0]).toBe(s.pages[0]);
    expect(r.story.pages[1].id).toBe('second');
    expect(r.pageIndex).toBe(1);
  });
  it('names the current layout', () => {
    expect(currentLayoutName(storyWith('single-bleed', [L('a')]), 0)).toBe('Full screen photo');
    expect(currentLayoutName(storyWith('stack-3-black', [L('a'), L('b'), L('c')]), 0)).toBe('Stack 3 · Black borders');
    expect(currentLayoutName(storyWith('stack-3', [L('a'), L('b'), L('c')]), 0)).toBe('Stack 3');
    expect(currentLayoutName(storyWith('trio', [L('a'), L('b'), L('c')]), 0)).toBe('Trio');
  });
});
