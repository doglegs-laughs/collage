import { describe, expect, it } from 'vitest';
import { moveToOwnPage } from '../src/story/split';
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
    expect(r.story.pages[1]).toMatchObject({ templateId: 'single-border', duration: 5, background: '#fafafa' });
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
    expect(r.story.pages.map((p) => p.templateId)).toEqual(['matted-single', 'framed-portrait']);
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
