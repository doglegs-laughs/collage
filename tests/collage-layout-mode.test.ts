import { describe, expect, it } from 'vitest';
import { applyTarget, aspectFor, bestArrangementId, buildLayoutStory, chooseTarget, exportSize, originalLongEdge, targetOf, unusedPhotos } from '../src/collage/layoutModeState';
import { getArrangement } from '../src/story/arrangements';
import { photoIdsInUse } from '../src/story/model';
import { makePhotos } from './story-helpers';

const L = [4000, 3000] as [number, number];
const P = [3000, 4000] as [number, number];
const look = { background: '#ffffff' };

describe('collage layout mode: default arrangement', () => {
  it('uses one arrangement per photo count, with exactly that many slots', () => {
    for (let n = 1; n <= 9; n++) {
      const photos = makePhotos(n, n, [L, P]);
      const id = bestArrangementId(photos, '4:5')!;
      const a = getArrangement(id)!;
      expect(a.pages).toBe(1);
      expect(a.slots).toBeLessThanOrEqual(n);
    }
  });
  it('picks a stack for three landscapes on a tall page, a row of portraits otherwise', () => {
    expect(bestArrangementId(makePhotos(3, 1, [L]), '4:5')).toBe('stack-3');
    expect(['triptych', 'trio']).toContain(bestArrangementId(makePhotos(3, 1, [P]), '4:5'));
  });
  it('shows a single photo as Single and nothing for an empty selection', () => {
    expect(bestArrangementId(makePhotos(1, 1), '1:1')).toBe('single');
    expect(bestArrangementId([], '1:1')).toBeNull();
    expect(chooseTarget([], '1:1', null, 0)).toBeNull();
  });
  it('never picks covers or text layouts and caps at nine photos', () => {
    const id = bestArrangementId(makePhotos(14, 3), '4:5')!;
    expect(getArrangement(id)!.slots).toBeLessThanOrEqual(9);
    expect(id).not.toMatch(/cover|magazine|polaroid-on-photo/);
  });
  it('starts with the plain finish', () => {
    const t = chooseTarget(makePhotos(3, 1, [L]), '4:5', null, 0)!;
    expect(t).toEqual({ arrangement: 'stack-3', finish: 'plain' });
  });
});

describe('collage layout mode: selection changes', () => {
  const three = makePhotos(3, 1, [L]);
  it('keeps the current arrangement and finish when the count is unchanged', () => {
    const t = chooseTarget(makePhotos(3, 9, [P]), '4:5', { arrangement: 'stack-3', finish: 'black' }, 3)!;
    expect(t).toEqual({ arrangement: 'stack-3', finish: 'black' });
  });
  it('falls back to the best fit when the count changes, keeping the finish where allowed', () => {
    const t = chooseTarget(makePhotos(4, 1, [L, P]), '4:5', { arrangement: 'stack-3', finish: 'black' }, 3)!;
    expect(getArrangement(t.arrangement)!.slots).toBeLessThanOrEqual(4);
    expect(t.arrangement).not.toBe('stack-3');
    expect(t.finish).toBe('black');
  });
  it('keeps an arrangement that shows fewer photos than are selected while the count stays', () => {
    const four = makePhotos(4, 1, [L]);
    expect(chooseTarget(four, '4:5', { arrangement: 'stack-2', finish: 'plain' }, 4)!.arrangement).toBe('stack-2');
    expect(chooseTarget(four.concat(makePhotos(1, 5, [L])), '4:5', { arrangement: 'stack-2', finish: 'plain' }, 4)!.arrangement).not.toBe('stack-2');
  });
  it('builds a one-page story in selection order and rebuilds it for a new selection', () => {
    const s1 = buildLayoutStory(null, three, '4:5', chooseTarget(three, '4:5', null, 0), look);
    expect(s1.pages).toHaveLength(1);
    expect(targetOf(s1)).toEqual({ arrangement: 'stack-3', finish: 'plain' });
    const ids = s1.pages[0].elements.flatMap((e) => (e.kind === 'photo' && e.photoId ? [e.photoId] : []));
    expect(ids).toEqual(three.map((p) => p.id));

    const two = [three[2], three[0]];
    const s2 = buildLayoutStory(s1, two, '4:5', chooseTarget(two, '4:5', targetOf(s1), 3), look);
    expect(s2.pages).toHaveLength(1);
    const ids2 = s2.pages[0].elements.flatMap((e) => (e.kind === 'photo' && e.photoId ? [e.photoId] : []));
    expect(ids2).toEqual([three[2].id, three[0].id]);
    expect(s2.pages[0].id).toBe(s1.pages[0].id);
  });
  it('lets a layout with more slots use the selected photos that are not on the page', () => {
    const four = makePhotos(4, 2, [L]);
    const s = buildLayoutStory(null, four, '4:5', { arrangement: 'stack-2', finish: 'plain' }, look);
    expect(photoIdsInUse(s).size).toBe(2);
    const extra = unusedPhotos(s, four);
    expect(extra.map((p) => p.id)).toEqual([four[2].id, four[3].id]);
    const more = applyTarget(s, extra, { arrangement: 'grid-2x2', finish: 'plain' }, {});
    expect([...photoIdsInUse(more)]).toHaveLength(4);
    expect(more.pages).toHaveLength(1);
  });
  it('applies the background and spacing', () => {
    const tight = buildLayoutStory(null, three, '4:5', { arrangement: 'stack-3', finish: 'plain' }, { background: '#000000', gap: 0, margin: 0 });
    const loose = buildLayoutStory(null, three, '4:5', { arrangement: 'stack-3', finish: 'plain' }, { background: '#000000', gap: 0.06, margin: 0.06 });
    expect(tight.pages[0].background).toBe('#000000');
    expect(tight.pages[0].elements[0].x).toBeLessThan(loose.pages[0].elements[0].x);
  });
});

describe('collage layout mode: page shape and export size', () => {
  it('matches the first photo', () => {
    const [a] = makePhotos(1, 1, [[3000, 2000]]);
    expect(aspectFor('match', [a])).toBe('3000:2000');
    expect(aspectFor('match', [])).toBe('1:1');
    expect(aspectFor('16:9', [a])).toBe('16:9');
  });
  it('sizes the export by long edge', () => {
    const photos = makePhotos(1, 1, [L]);
    const s = buildLayoutStory(null, photos, '4:5', { arrangement: 'single', finish: 'plain' }, look);
    expect(exportSize(s, 2160)).toEqual({ width: 1728, height: 2160 });
    const w = buildLayoutStory(s, photos, '3:2', { arrangement: 'single', finish: 'plain' }, look);
    expect(exportSize(w, 4096)).toEqual({ width: 4096, height: 2731 });
  });
  it('original size never upscales a photo and is capped at 8192', () => {
    const small = makePhotos(1, 1, [[1000, 750]]);
    const s = buildLayoutStory(null, small, '4:5', { arrangement: 'single', finish: 'bleed' }, look);
    const edge = originalLongEdge(s);
    expect(edge).toBeLessThan(2160);
    expect(edge).toBeGreaterThan(500);
    const huge = makePhotos(1, 1, [[20000, 15000]]);
    expect(originalLongEdge(buildLayoutStory(null, huge, '3:2', { arrangement: 'single', finish: 'bleed' }, look))).toBe(8192);
  });
});
