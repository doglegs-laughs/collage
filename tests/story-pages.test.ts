import { describe, expect, it } from 'vitest';
import {
  addPage, clipStrayOverflow, defaultPhotoEl, duplicatePage, emptyPage, emptyStory, groupOf, movePage, movePageTo, removePage, elementsVisibleOnPage,
  type El, type Page, type Story,
} from '../src/story/model';
import { getTemplate } from '../src/story/templates';
import { makePhotos } from './story-helpers';

/** Pages from a multi-page template, tagged as one spread the way autofill does. */
function spreadPages(templateId: string, prefix: string, photoCount: number): Page[] {
  const t = getTemplate(templateId)!;
  const res = t.layout('4:5', makePhotos(photoCount, 1, [[3000, 4000]]), {});
  return res.pages.map((els, i) => ({
    ...emptyPage(),
    id: `${prefix}${i}`,
    templateId,
    elements: els.map((e, k) => ({ ...e, id: `${prefix}${i}e${k}` }) as El),
    spread: { index: i, count: t.pageCount },
  }));
}
const plain = (id: string): Page => ({ ...emptyPage(), id, elements: [defaultPhotoEl({ id: `${id}e`, x: 0.1, w: 0.5 })] });
const build = (pages: Page[]): Story => ({ ...emptyStory(), pages });
const ids = (s: Story) => s.pages.map((p) => p.id);

describe('spread groups', () => {
  const pano = () => spreadPages('pano-2', 'a', 1);
  const split = () => spreadPages('seamless-split', 'b', 3);

  it('groupOf finds the whole group from any page, and singletons for plain pages', () => {
    const s = build([plain('x'), ...pano(), plain('y')]);
    expect(groupOf(s, 0)).toEqual({ start: 0, end: 1 });
    expect(groupOf(s, 1)).toEqual({ start: 1, end: 3 });
    expect(groupOf(s, 2)).toEqual({ start: 1, end: 3 });
    expect(groupOf(s, 3)).toEqual({ start: 3, end: 4 });
    const two = build([...pano(), ...spreadPages('pano-2', 'c', 1)]);
    expect(groupOf(two, 1)).toEqual({ start: 0, end: 2 });
    expect(groupOf(two, 2)).toEqual({ start: 2, end: 4 });
    expect(groupOf(s, 99)).toEqual({ start: 99, end: 100 });
  });

  it('addPage inside a group lands after the group', () => {
    const s = build([plain('x'), ...pano(), plain('y')]);
    expect(ids(addPage(s, plain('n'), 2))).toEqual(['x', 'a0', 'a1', 'n', 'y']);
    expect(ids(addPage(s, plain('n'), 1))).toEqual(['x', 'n', 'a0', 'a1', 'y']);
    expect(ids(addPage(s, plain('n'), 3))).toEqual(['x', 'a0', 'a1', 'n', 'y']);
  });

  it('removePage on any page of a group removes the whole group', () => {
    const s = build([plain('x'), ...split(), plain('y')]);
    const n = groupOf(s, 1).end - 1;
    for (let i = 1; i <= n; i++) expect(ids(removePage(s, i))).toEqual(['x', 'y']);
    expect(ids(removePage(s, 0))).toEqual([...ids(s).slice(1)]);
  });

  it('duplicatePage copies the whole group with new ids and keeps it a group', () => {
    const s = build([plain('x'), ...pano(), plain('y')]);
    const d = duplicatePage(s, 2);
    expect(d.pages).toHaveLength(6);
    expect(ids(d).slice(0, 3)).toEqual(['x', 'a0', 'a1']);
    expect(ids(d)[5]).toBe('y');
    const copies = d.pages.slice(3, 5);
    expect(new Set([...ids(d)]).size).toBe(6);
    expect(copies[0].elements[0].id).not.toBe(s.pages[1].elements[0].id);
    expect(copies.map((p) => p.spread)).toEqual([{ index: 0, count: 2 }, { index: 1, count: 2 }]);
    expect(groupOf(d, 4)).toEqual({ start: 3, end: 5 });
    expect(ids(duplicatePage(s, 0))).toEqual(['x', expect.not.stringMatching(/^x$/), 'a0', 'a1', 'y']);
  });

  it('movePage moves a group together, and drops inside a group land after it', () => {
    const s = build([plain('x'), ...pano(), plain('y'), plain('z')]); // x a0 a1 y z
    expect(ids(movePage(s, 1, 3))).toEqual(['x', 'y', 'a0', 'a1', 'z']);
    expect(ids(movePage(s, 2, 3))).toEqual(['x', 'y', 'a0', 'a1', 'z']);
    expect(ids(movePage(s, 1, 4))).toEqual(['x', 'y', 'z', 'a0', 'a1']);
    expect(ids(movePage(s, 3, 0))).toEqual(['y', 'x', 'a0', 'a1', 'z']);
    expect(ids(movePage(s, 3, 1))).toEqual(['x', 'y', 'a0', 'a1', 'z']);
    expect(ids(movePage(s, 3, 2))).toEqual(['x', 'a0', 'a1', 'y', 'z']); // dropped inside the pano: after it
    expect(ids(movePage(s, 4, 2))).toEqual(['x', 'a0', 'a1', 'z', 'y']);
    expect(movePage(s, 1, 2)).toBe(s);
    const g = build([...pano(), ...split()]);
    const moved = movePageTo(g, 0, 3);
    expect(ids(moved.story)).toEqual(['b0', 'b1', 'a0', 'a1']);
    expect(moved.index).toBe(2);
    expect(movePageTo(g, 1, 3).index).toBe(3);
    const mixed = build([plain('x'), ...pano(), ...spreadPages('pano-2', 'c', 1)]);
    expect(ids(movePage(mixed, 0, 3))).toEqual(['a0', 'a1', 'c0', 'c1', 'x']);
    expect(ids(movePage(mixed, 3, 1))).toEqual(['x', 'c0', 'c1', 'a0', 'a1']);
    expect(ids(movePage(mixed, 3, 2))).toEqual(['x', 'a0', 'a1', 'c0', 'c1']);
  });

  it('never leaves a group split: every op keeps spread indexes consecutive', () => {
    const base = build([plain('x'), ...pano(), ...split(), plain('y')]);
    const ok = (s: Story) => s.pages.every((p, i) => !p.spread || groupOf(s, i).end - groupOf(s, i).start === p.spread.count);
    for (let from = 0; from < base.pages.length; from++) {
      for (let to = 0; to < base.pages.length; to++) expect(ok(movePage(base, from, to))).toBe(true);
      expect(ok(removePage(base, from))).toBe(true);
      expect(ok(duplicatePage(base, from))).toBe(true);
      expect(ok(addPage(base, plain('n'), from))).toBe(true);
    }
  });

  it('clipStrayOverflow trims elements that reach into a page outside their group', () => {
    const over = defaultPhotoEl({ id: 'o', x: 0.5, w: 1, photoId: 'p' });
    const s = build([{ ...emptyPage(), id: 'a', elements: [over] }, plain('b'), plain('c')]);
    expect(elementsVisibleOnPage(s, 1).some((e) => e.id === 'o')).toBe(true);
    const clipped = clipStrayOverflow(s);
    const el = clipped.pages[0].elements[0];
    expect(el.x).toBe(0.5);
    expect(el.x + el.w).toBeCloseTo(1);
    expect(elementsVisibleOnPage(clipped, 1).some((e) => e.id === 'o')).toBe(false);
    // inside a group the overflow stays
    const g = build(pano());
    expect(clipStrayOverflow(g)).toBe(g);
  });

  it('removing a page next to a group does not make its overflow spill onto a stranger', () => {
    const g = build([...pano(), plain('y')]);
    // y dropped between the pano's pages lands after it, so the pano stays intact
    const moved = movePage(g, 2, 1);
    expect(ids(moved)).toEqual(['a0', 'a1', 'y']);
    const wide = moved.pages[0].elements[0];
    expect(wide.x + wide.w).toBeGreaterThan(1.5);
  });
});
