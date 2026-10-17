import { describe, expect, it } from 'vitest';
import {
  addElement, addPage, aspectRatio, crossesBoundary, defaultPhotoEl, defaultRectEl, defaultTextEl, deserializeStory, duplicateElements, elementsVisibleOnPage, emptyPage,
  emptyStory, evenPageSize, movePage, newId, owningPage, pageSize, removeElements, reorderZ, replacePhoto, serializeStory, sortByZ, updateElement, StoryFormatError, type Story,
} from '../src/story/model';

function twoPageStory(): Story {
  const s = emptyStory('4:5', 'stylized');
  const pano = defaultPhotoEl({ id: 'pano', x: 0.025, y: 0.2, w: 1.95, h: 0.5, photoId: 'a' });
  const inside = defaultPhotoEl({ id: 'in', x: 0.1, y: 0.1, w: 0.3, h: 0.3 });
  const left = defaultPhotoEl({ id: 'left', x: -0.4, y: 0, w: 0.9, h: 1, photoId: 'b' });
  return { ...s, photos: [{ id: 'a', name: 'a.jpg', path: '/x/a.jpg', width: 100, height: 50 }], pages: [{ ...emptyPage(), id: 'p0', elements: [pano, inside] }, { ...emptyPage(), id: 'p1', elements: [left] }] };
}

describe('geometry of pages', () => {
  it('aspect ratios and sizes', () => {
    expect(aspectRatio('4:5')).toBeCloseTo(0.8);
    expect(aspectRatio('16:9')).toBeCloseTo(16 / 9);
    expect(pageSize('4:5', 1080)).toEqual({ width: 1080, height: 1350 });
    expect(pageSize('9:16', 1080)).toEqual({ width: 1080, height: 1920 });
    expect(evenPageSize('3:2', 1001)).toEqual({ width: 1002, height: 668 });
  });
  it('ids are unique', () => {
    expect(new Set(Array.from({ length: 500 }, newId)).size).toBe(500);
  });
});

describe('overflow', () => {
  it('shows neighbour overflow shifted by a page width, flagged ghostOf', () => {
    const s = twoPageStory();
    const v1 = elementsVisibleOnPage(s, 1);
    const ghost = v1.find((e) => e.id === 'pano')!;
    expect(ghost.ghostOf).toBe(0);
    expect(ghost.x).toBeCloseTo(-0.975);
    expect(v1.find((e) => e.id === 'in')).toBeUndefined();
    const v0 = elementsVisibleOnPage(s, 0);
    const g2 = v0.find((e) => e.id === 'left')!;
    expect(g2.ghostOf).toBe(1);
    expect(g2.x).toBeCloseTo(0.6);
    expect(v0.filter((e) => e.ghostOf === undefined).map((e) => e.id)).toEqual(['pano', 'in']);
  });
  it('does not show elements that merely touch the seam', () => {
    const s = twoPageStory();
    s.pages[0].elements = [defaultPhotoEl({ id: 'edge', x: 0.5, w: 0.5 })];
    s.pages[1].elements = [];
    expect(elementsVisibleOnPage(s, 1)).toHaveLength(0);
  });
  it('owningPage and crossesBoundary', () => {
    const s = twoPageStory();
    expect(owningPage(s, 'pano')).toBe(0);
    expect(owningPage(s, 'left')).toBe(1);
    expect(owningPage(s, 'nope')).toBe(-1);
    expect(crossesBoundary(s, 0)).toBe(true);
    expect(crossesBoundary(s, 1)).toBe(false);
    expect(crossesBoundary(s, -1)).toBe(false);
    const flat = { ...s, pages: s.pages.map((p) => ({ ...p, elements: p.elements.filter((e) => e.id === 'in') })) };
    expect(crossesBoundary(flat, 0)).toBe(false);
    const onlyLeft = { ...s, pages: [{ ...s.pages[0], elements: [] }, s.pages[1]] };
    expect(crossesBoundary(onlyLeft, 0)).toBe(true);
  });
});

describe('immutable helpers', () => {
  it('updateElement / removeElements / addElement do not mutate', () => {
    const s = twoPageStory();
    const s2 = updateElement(s, 0, 'in', { rotation: 5 });
    expect(s.pages[0].elements[1].rotation).toBe(0);
    expect(s2.pages[0].elements[1].rotation).toBe(5);
    expect(removeElements(s, 0, ['in']).pages[0].elements).toHaveLength(1);
    const s3 = addElement(s, 0, defaultTextEl({ id: 't' }));
    expect(s3.pages[0].elements.at(-1)!.z).toBeGreaterThan(Math.max(...s.pages[0].elements.map((e) => e.z)));
  });
  it('duplicateElements gives new ids on top', () => {
    const s = twoPageStory();
    const { story, newIds } = duplicateElements(s, 0, ['in']);
    expect(newIds).toHaveLength(1);
    expect(newIds[0]).not.toBe('in');
    const copy = story.pages[0].elements.find((e) => e.id === newIds[0])!;
    expect(copy.x).toBeCloseTo(0.12);
  });
  it('reorderZ moves and renumbers', () => {
    let s = emptyStory();
    s = addPage(s, { ...emptyPage(), elements: [defaultRectEl({ id: 'a', z: 0 }), defaultRectEl({ id: 'b', z: 1 }), defaultRectEl({ id: 'c', z: 2 })] });
    const order = (st: Story) => sortByZ(st.pages[0].elements).map((e) => e.id).join('');
    expect(order(reorderZ(s, 0, ['a'], 'forward'))).toBe('bac');
    expect(order(reorderZ(s, 0, ['a'], 'front'))).toBe('bca');
    expect(order(reorderZ(s, 0, ['c'], 'back'))).toBe('cab');
    expect(order(reorderZ(s, 0, ['c'], 'backward'))).toBe('acb');
    expect(order(reorderZ(s, 0, ['c'], 'forward'))).toBe('abc');
    expect(reorderZ(s, 0, ['a'], 'front').pages[0].elements.map((e) => e.z).sort()).toEqual([0, 1, 2]);
  });
  it('movePage and replacePhoto', () => {
    const s = twoPageStory();
    expect(movePage(s, 0, 1).pages.map((p) => p.id)).toEqual(['p1', 'p0']);
    const r = replacePhoto(updateElement(s, 0, 'pano', { crop: { zoom: 3, cx: 0.2, cy: 0.2 } }), 0, 'pano', 'z');
    const el = r.pages[0].elements[0];
    expect(el.kind === 'photo' && el.photoId).toBe('z');
    expect(el.kind === 'photo' && el.crop.zoom).toBe(1);
  });
});

describe('serialization', () => {
  it('round-trips and strips File objects', () => {
    const s = twoPageStory();
    s.photos[0] = { ...s.photos[0], file: {} as File };
    const json = serializeStory(s);
    expect(json).not.toContain('"file"');
    const back = deserializeStory(json);
    expect(back.photos[0]).toEqual({ id: 'a', name: 'a.jpg', path: '/x/a.jpg', width: 100, height: 50 });
    expect(back.pages).toEqual(s.pages);
    expect(back.aspect).toBe('4:5');
    expect(back.style).toBe('stylized');
  });
  it('rejects bad input', () => {
    expect(() => deserializeStory('nope')).toThrow(StoryFormatError);
    expect(() => deserializeStory(JSON.stringify({ version: 2 }))).toThrow(/version/);
    expect(() => deserializeStory(JSON.stringify({ version: 1, aspect: '7:7', pages: [], photos: [] }))).toThrow(/aspect/);
    const bad = JSON.parse(serializeStory(twoPageStory()));
    bad.pages[0].elements[0].kind = 'blob';
    expect(() => deserializeStory(JSON.stringify(bad))).toThrow(/kind/);
    bad.pages[0].elements[0].kind = 'photo';
    bad.pages[0].elements[0].x = 'left';
    expect(() => deserializeStory(JSON.stringify(bad))).toThrow(StoryFormatError);
  });
});
