import { describe, expect, it } from 'vitest';
import { addPhotoToStory, moveToOwnPage, photoSpot, removePhotoFromPages } from '../src/story/split';
import { getTemplate } from '../src/story/templates';
import { defaultTextEl, emptyStory, type Page, type PhotoEl, type Story } from '../src/story/model';
import { photoIdsOf } from './story-helpers';
import type { Photo } from '../src/core/images';

const L = (id: string): Photo => ({ id, name: id, width: 3000, height: 2000 });
const P = (id: string): Photo => ({ id, name: id, width: 2000, height: 3000 });

function storyWith(tid: string, photos: Photo[], more: Page[] = [], style: Story['style'] = 'clean'): Story {
  const t = getTemplate(tid)!;
  const res = t.layout('4:5', photos, {});
  const pages: Page[] = res.pages.map((els, i) => ({
    id: `pg${i}`, templateId: tid, background: '#fafafa', elements: els, duration: 5,
    ...(t.pageCount > 1 ? { spread: { index: i, count: t.pageCount } } : {}),
  }));
  return { ...emptyStory('4:5', style), pages: [...pages, ...more], photos };
}
const all = (s: Story) => s.pages.flatMap((p) => photoIdsOf(p.elements)).sort();
const firstPhoto = (s: Story, page = 0) => s.pages[page].elements.find((e): e is PhotoEl => e.kind === 'photo')!;

describe('moveToOwnPage', () => {
  it('stack-3 becomes stack-2 plus a new single page', () => {
    const s = storyWith('stack-3', [L('a'), L('b'), L('c')]);
    const el = firstPhoto(s);
    const r = moveToOwnPage(s, 0, el.id, { seed: 3 })!;
    expect(r.pageIndex).toBe(1);
    expect(r.story.pages).toHaveLength(2);
    expect(r.story.pages[0]).toMatchObject({ id: 'pg0', templateId: 'stack-2', background: '#fafafa', duration: 5 });
    expect(r.story.pages[1]).toMatchObject({ templateId: 'single', finish: 'plain', duration: 5, background: '#fafafa' });
    expect(photoIdsOf(r.story.pages[1].elements)).toEqual(['a']);
    expect(all(r.story)).toEqual(all(s));
  });
  it('is deterministic for a seed', () => {
    const s = storyWith('stack-3', [L('a'), L('b'), L('c')]);
    const id = firstPhoto(s).id;
    const strip = (x: Story) => JSON.stringify(x.pages).replace(/"id":"[^"]*"/g, '"id":0');
    expect(strip(moveToOwnPage(s, 0, id, { seed: 9 })!.story)).toEqual(strip(moveToOwnPage(s, 0, id, { seed: 9 })!.story));
  });
  it('splits a pair into two singles, using the clean style singles', () => {
    const s = storyWith('pair-side', [P('a'), P('b')]);
    const r = moveToOwnPage(s, 0, firstPhoto(s).id)!;
    expect(r.story.pages.map((p) => p.templateId)).toEqual(['inset-single', 'inset-single']);
    expect(all(r.story)).toEqual(['a', 'b']);
  });
  it('uses stylized singles', () => {
    const s = storyWith('pair-side', [P('a'), L('b')], [], 'stylized');
    const r = moveToOwnPage(s, 0, firstPhoto(s).id)!;
    expect(r.story.pages.map((p) => [p.templateId, p.finish])).toEqual([['single', 'frame'], ['single', 'shadow']]);
  });
  it('turns grid-2x2 into a 3-photo layout', () => {
    const s = storyWith('grid-2x2', [L('a'), L('b'), L('c'), P('d')]);
    const r = moveToOwnPage(s, 0, firstPhoto(s).id)!;
    expect(getTemplate(r.story.pages[0].templateId)!.slots).toBe(3);
    expect(photoIdsOf(r.story.pages[0].elements)).toHaveLength(3);
    expect(all(r.story)).toEqual(all(s));
  });
  it('inserts after a spread group and at insertAt', () => {
    const tail: Page = { id: 'tail', templateId: null, background: '#fff', elements: [], duration: 3 };
    const s = storyWith('seamless-split', [P('a'), L('b'), P('c')], [tail]);
    const r = moveToOwnPage(s, 1, s.pages[0].elements.filter((e) => e.kind === 'photo')[0].id)!;
    expect(r.story.pages[r.pageIndex].id).not.toBe('tail');
    expect(r.story.pages[r.story.pages.length - 1].id).toBe('tail');
    expect(r.pageIndex).toBe(r.story.pages.length - 2);
    expect(all(r.story)).toEqual(['a', 'b', 'c']);
    const t = storyWith('stack-2', [L('a'), L('b')], [tail]);
    const r2 = moveToOwnPage(t, 0, firstPhoto(t).id, { insertAt: 0 })!;
    expect(r2.pageIndex).toBe(0);
    expect(r2.story.pages.map((p) => p.id)[1]).toBe('pg0');
    const r3 = moveToOwnPage(t, 0, firstPhoto(t).id, { insertAt: 2 })!;
    expect(r3.pageIndex).toBe(2);
    expect(r3.story.pages[1].id).toBe('tail');
  });
  it('returns null for a one-photo page, text, or missing ids', () => {
    const s = storyWith('single-border', [L('a')]);
    expect(moveToOwnPage(s, 0, firstPhoto(s).id)).toBeNull();
    const p = storyWith('pair-side', [P('a'), P('b')]);
    const text = defaultTextEl({ text: 'Hi' });
    const withText = { ...p, pages: [{ ...p.pages[0], elements: [...p.pages[0].elements, text] }] };
    expect(moveToOwnPage(withText, 0, text.id)).toBeNull();
    expect(moveToOwnPage(withText, 0, 'nope')).toBeNull();
    expect(moveToOwnPage(withText, 5, text.id)).toBeNull();
  });
  it('keeps user text on the source page', () => {
    const s = storyWith('stack-3', [L('a'), L('b'), L('c')]);
    const text = defaultTextEl({ text: 'Keep me' });
    const withText = { ...s, pages: [{ ...s.pages[0], elements: [...s.pages[0].elements, text] }] };
    const r = moveToOwnPage(withText, 0, firstPhoto(withText).id)!;
    expect(r.story.pages[0].elements.some((e) => e.kind === 'text' && e.text === 'Keep me')).toBe(true);
    expect(r.story.pages[1].elements.some((e) => e.kind === 'text')).toBe(false);
  });
  it('keeps the crop when the new frame is about the same shape', () => {
    const s = storyWith('pair-side', [P('a'), P('b')]);
    const el = firstPhoto(s);
    const crop = { zoom: 1.5, cx: 0.3, cy: 0.6 };
    const t = { ...s, pages: [{ ...s.pages[0], elements: s.pages[0].elements.map((e) => (e.id === el.id ? { ...e, w: 0.8, h: 0.8 * 0.8 * 1.5 } as PhotoEl : e)) }] };
    const moved = firstPhoto(moveToOwnPage({ ...t, pages: [{ ...t.pages[0], elements: t.pages[0].elements.map((e) => (e.id === el.id ? { ...e, crop } as PhotoEl : e)) }] }, 0, el.id)!.story, 1);
    expect([moved.crop.zoom === 1 || moved.crop.zoom === 1.5]).toEqual([true]);
  });
});

describe('moveToOwnPage without an exact template', () => {
  it('9 photos in grid-3x3 become 8 + 1 with no empty slots and every photo once', () => {
    const photos = Array.from({ length: 9 }, (_, i) => (i % 3 === 0 ? P(`p${i}`) : L(`p${i}`)));
    const s = storyWith('grid-3x3', photos);
    const text = defaultTextEl({ text: 'Keep me' });
    const withText = { ...s, pages: [{ ...s.pages[0], elements: [...s.pages[0].elements, text] }] };
    const r = moveToOwnPage(withText, 0, firstPhoto(withText).id)!;
    const els = r.story.pages.flatMap((p) => p.elements);
    expect(els.filter((e) => e.kind === 'photo' && !e.photoId)).toHaveLength(0);
    expect(all(r.story)).toEqual(all(s));
    expect(r.story.pages[0]).toMatchObject({ id: 'pg0', duration: 5 });
    expect(r.story.pages[0].elements.some((e) => e.kind === 'text' && e.text === 'Keep me')).toBe(true);
    expect(r.story.pages[r.pageIndex].elements.filter((e) => e.kind === 'photo')).toHaveLength(1);
    expect(r.pageIndex).toBe(r.story.pages.length - 1);
  });
});

describe('removePhotoFromPages', () => {
  it('lays the page out again with the other photos', () => {
    const s = storyWith('stack-3', [L('a'), L('b'), L('c')]);
    const r = removePhotoFromPages(s, 'b');
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0].templateId).toBe('stack-2');
    expect(all(r)).toEqual(['a', 'c']);
    expect(r.photos.map((p) => p.id)).toEqual(['a', 'b', 'c']);
  });
  it('deletes a page left without photos, and every page that showed the photo is updated', () => {
    const single = storyWith('inset-single', [L('a')]).pages[0];
    const s = storyWith('stack-2', [L('a'), L('b')], [{ ...single, id: 'solo' }]);
    const r = removePhotoFromPages(s, 'a');
    expect(r.pages.map((p) => p.id)).toEqual(['pg0']);
    expect(all(r)).toEqual(['b']);
  });
  it('keeps a page with a title, emptying the slot', () => {
    const s = storyWith('inset-single', [L('a')]);
    s.pages[0].elements.push(defaultTextEl({ text: 'Title', role: 'title' }));
    const r = removePhotoFromPages(s, 'a');
    expect(r.pages).toHaveLength(1);
    expect(firstPhoto(r).photoId).toBeNull();
  });
  it('leaves a story that does not show the photo unchanged', () => {
    const s = storyWith('stack-2', [L('a'), L('b')]);
    expect(removePhotoFromPages(s, 'z')).toBe(s);
  });
});

describe('addPhotoToStory', () => {
  it('stack-2 plus a photo becomes stack-3 on the same page, user text kept', () => {
    const s = storyWith('stack-2', [L('a'), L('b')]);
    s.photos.push(L('c'));
    const text = defaultTextEl({ text: 'Keep me' });
    const withText = { ...s, pages: [{ ...s.pages[0], elements: [...s.pages[0].elements, text] }] };
    const r = addPhotoToStory(withText, L('c'), { pageId: 'pg0', index: 0 });
    expect(r).toMatchObject({ pageIndex: 0, back: true });
    expect(r.story.pages).toHaveLength(1);
    expect(r.story.pages[0]).toMatchObject({ id: 'pg0', templateId: 'stack-3', duration: 5 });
    expect(all(r.story)).toEqual(['a', 'b', 'c']);
    expect(r.story.pages[0].elements.some((e) => e.kind === 'text' && e.text === 'Keep me')).toBe(true);
  });
  it('a single page plus a photo becomes a pair', () => {
    const s = storyWith('inset-single', [P('a')]);
    const r = addPhotoToStory(s, P('b'), { pageId: 'pg0', index: 0 });
    expect(getTemplate(r.story.pages[0].templateId)!.slots).toBe(2);
    expect(all(r.story)).toEqual(['a', 'b']);
    expect(r.story.photos.map((p) => p.id)).toEqual(['a', 'b']);
  });
  it('takes a photo off and puts it back on the same page', () => {
    const s = storyWith('stack-3', [L('a'), L('b'), L('c')]);
    const r = addPhotoToStory(removePhotoFromPages(s, 'b'), L('b'), photoSpot(s, 'b'));
    expect(r.story.pages).toHaveLength(1);
    expect(r.story.pages[0].templateId).toBe('stack-3');
    expect(all(r.story)).toEqual(['a', 'b', 'c']);
  });
  it('a deleted page comes back as a single page at its old position', () => {
    const single = storyWith('inset-single', [L('a')]).pages[0];
    const last = storyWith('inset-single', [L('d')]).pages[0];
    const s = storyWith('stack-2', [L('b'), L('c')], [{ ...single, id: 'solo' }, { ...last, id: 'last' }]);
    const spot = photoSpot(s, 'a')!;
    expect(spot).toEqual({ pageId: 'solo', index: 1 });
    const gone = removePhotoFromPages(s, 'a');
    expect(gone.pages.map((p) => p.id)).toEqual(['pg0', 'last']);
    const r = addPhotoToStory(gone, L('a'), spot);
    expect(r).toMatchObject({ pageIndex: 1, back: true });
    expect(r.story.pages).toHaveLength(3);
    expect(photoIdsOf(r.story.pages[1].elements)).toEqual(['a']);
    expect(r.story.pages[2].id).toBe('last');
    expect(r.story.photos.map((p) => p.id)).toContain('a');
  });
  it('refills the emptied slot on a title page', () => {
    const s = storyWith('inset-single', [L('a')]);
    s.pages[0].elements.push(defaultTextEl({ text: 'Title', role: 'title' }));
    const r = addPhotoToStory(removePhotoFromPages(s, 'a'), L('a'), photoSpot(s, 'a'));
    expect(r.story.pages).toHaveLength(1);
    expect(firstPhoto(r.story).photoId).toBe('a');
  });
  it('a photo never in the story is a new page at the end', () => {
    const s = storyWith('stack-2', [L('a'), L('b')]);
    const r = addPhotoToStory(s, L('z'));
    expect(r).toMatchObject({ pageIndex: 1, back: false });
    expect(r.story.pages).toHaveLength(2);
    expect(photoIdsOf(r.story.pages[1].elements)).toEqual(['z']);
    expect(r.story.photos.map((p) => p.id)).toEqual(['a', 'b', 'z']);
  });
});
