import { describe, expect, it } from 'vitest';
import { makeStory, shuffleLayout } from '../src/story/autofill';
import { addPhotos, crossesBoundary, emptyStory, setPages, type Aspect, type Page, type StyleId } from '../src/story/model';
import { makePhotos, photoIdsOf } from './story-helpers';

const styles: StyleId[] = ['clean', 'stylized'];
const aspects: Aspect[] = ['4:5', '16:9', '9:16'];

const templateRuns = (pages: Page[]) => pages.filter((p) => !p.spread || p.spread.index === 0).map((p) => p.templateId);

describe('makeStory', () => {
  for (const style of styles) {
    for (const aspect of aspects) {
      for (const n of [0, 1, 2, 7, 50]) {
        it(`${style} ${aspect} n=${n}: every photo once, in order, valid pages`, () => {
          const photos = makePhotos(n, n + 11);
          const pages = makeStory(photos, { style, aspect, title: n % 2 ? 'My Trip' : undefined, seed: 5 });
          const ids = pages.flatMap((p) => photoIdsOf(p.elements));
          expect(ids).toEqual(photos.map((p) => p.id));
          const runs = templateRuns(pages);
          for (let i = 2; i < runs.length; i++) expect(runs[i] === runs[i - 1] && runs[i] === runs[i - 2]).toBe(false);
          const all = pages.flatMap((p) => p.elements.map((e) => e.id));
          expect(new Set(all).size).toBe(all.length);
          expect(new Set(pages.map((p) => p.id)).size).toBe(pages.length);
          pages.forEach((p) => {
            if (p.spread && p.spread.index > 0) return;
            expect(p.elements.length + (p.spread ? 1 : 0)).toBeGreaterThan(0);
          });
        });
      }
    }
  }

  it('0 photos: title card only if a title', () => {
    expect(makeStory([], { style: 'clean', aspect: '4:5', seed: 1 })).toEqual([]);
    const pages = makeStory([], { style: 'stylized', aspect: '4:5', seed: 1, title: 'Hello', subtitle: 'Sub' });
    expect(pages).toHaveLength(1);
    expect(pages[0].templateId).toBe('title-card');
    expect(pages[0].elements.every((e) => e.kind === 'text')).toBe(true);
  });

  it('is deterministic per seed and varies across seeds', () => {
    const photos = makePhotos(50, 2);
    for (const style of styles) {
      const a = JSON.stringify(makeStory(photos, { style, aspect: '4:5', seed: 9, title: 'T' }));
      expect(JSON.stringify(makeStory(photos, { style, aspect: '4:5', seed: 9, title: 'T' }))).toBe(a);
      expect(JSON.stringify(makeStory(photos, { style, aspect: '4:5', seed: 10, title: 'T' }))).not.toBe(a);
    }
  });

  it('never repeats a template 3 times for uniform inputs', () => {
    for (const sizes of [[[4000, 3000]], [[3000, 4000]], [[6000, 2400]], [[3000, 3000]]] as [number, number][][]) {
      for (const style of styles) {
        for (let seed = 0; seed < 12; seed++) {
          const photos = makePhotos(40, seed, sizes);
          const pages = makeStory(photos, { style, aspect: '4:5', seed });
          expect(pages.flatMap((p) => photoIdsOf(p.elements))).toEqual(photos.map((p) => p.id));
          const runs = templateRuns(pages);
          for (let i = 2; i < runs.length; i++) expect(runs[i] === runs[i - 1] && runs[i] === runs[i - 2]).toBe(false);
        }
      }
    }
  });

  it('clean: cover with title, panorama for wide photos, overview grid near the end', () => {
    const wide = makePhotos(1, 1, [[6000, 2400]]);
    const rest = makePhotos(9, 4, [[3000, 4000], [4000, 3000]]).map((p, i) => ({ ...p, id: `r${i}` }));
    const photos = [rest[0], ...wide.map((p) => ({ ...p, id: 'wide' })), ...rest.slice(1)];
    const pages = makeStory(photos, { style: 'clean', aspect: '4:5', seed: 3, title: 'Faroe' });
    expect(pages[0].templateId).toBe('cover');
    expect(pages.at(-1)!.templateId).toBe('overview-grid');
    expect(photoIdsOf(pages.at(-1)!.elements)).toHaveLength(6);
    const pano = pages.findIndex((p) => p.templateId === 'pano-2');
    expect(pano).toBeGreaterThan(0);
    expect(pages[pano].spread).toEqual({ index: 0, count: 2 });
    expect(pages[pano + 1].spread).toEqual({ index: 1, count: 2 });
    const story = setPages(addPhotos(emptyStory('4:5', 'clean'), photos), pages);
    expect(crossesBoundary(story, pano)).toBe(true);
    expect(crossesBoundary(story, 0)).toBe(false);
  });

  it('clean uses no frames, shadows or rotation', () => {
    const pages = makeStory(makePhotos(30, 6), { style: 'clean', aspect: '4:5', seed: 2, title: 'T' });
    for (const e of pages.flatMap((p) => p.elements)) {
      expect(e.rotation).toBe(0);
      if (e.kind === 'photo') {
        expect(e.frame).toBe(0);
        expect(e.shadow).toBe(false);
      }
    }
  });

  it('stylized: title is a text overlay or a polaroid caption', () => {
    const outcomes = new Set<string>();
    for (let seed = 0; seed < 30; seed++) {
      const pages = makeStory(makePhotos(5, 1), { style: 'stylized', aspect: '4:5', seed, title: 'Autumn' });
      outcomes.add(pages[0].templateId!);
      expect(pages[0].elements.some((e) => e.kind === 'text' && e.text.toLowerCase().includes('autumn'))).toBe(true);
    }
    expect([...outcomes].sort()).toEqual(['cover-sans', 'polaroid-on-photo']);
  });

  it('polaroid-on-photo always uses two distinct photos', () => {
    for (let seed = 0; seed < 40; seed++) {
      for (const p of makeStory(makePhotos(12, seed), { style: 'stylized', aspect: '4:5', seed })) {
        if (p.templateId !== 'polaroid-on-photo') continue;
        const ids = photoIdsOf(p.elements);
        expect(new Set(ids).size).toBe(2);
      }
    }
  });
});

describe('shuffleLayout', () => {
  it('swaps the template, keeps the photos and the page id', () => {
    const photos = makePhotos(8, 3, [[4000, 3000]]);
    const pages = makeStory(photos, { style: 'clean', aspect: '4:5', seed: 1 });
    const story = setPages(addPhotos(emptyStory('4:5', 'clean'), photos), pages);
    const idx = pages.findIndex((p) => photoIdsOf(p.elements).length === 2);
    expect(idx).toBeGreaterThanOrEqual(0);
    const next = shuffleLayout(story, idx, 77);
    expect(next.pages[idx].id).toBe(pages[idx].id);
    expect(next.pages[idx].templateId).not.toBe(pages[idx].templateId);
    expect(photoIdsOf(next.pages[idx].elements)).toEqual(photoIdsOf(pages[idx].elements));
    expect(JSON.stringify(shuffleLayout(story, idx, 77))).toBe(JSON.stringify(next));
    expect(story.pages[idx].templateId).toBe(pages[idx].templateId);
  });
  it('leaves spreads and empty pages alone', () => {
    const photos = makePhotos(1, 1, [[6000, 2400]]);
    const pages = makeStory(photos, { style: 'clean', aspect: '4:5', seed: 1 });
    const story = setPages(addPhotos(emptyStory(), photos), pages);
    expect(shuffleLayout(story, 0, 1)).toBe(story);
    expect(shuffleLayout(story, 9, 1)).toBe(story);
  });
});

describe('style rules', () => {
  const L: [number, number][] = [[4000, 3000]];
  it('clean: pair-side only for portraits/squares; stacks for landscape runs; mixed gives singles', () => {
    for (let seed = 0; seed < 20; seed++) {
      const photos = makePhotos(24, seed);
      const pages = makeStory(photos, { style: 'clean', aspect: '4:5', seed });
      const byId = new Map(photos.map((p) => [p.id, p]));
      for (const p of pages) {
        const ps = photoIdsOf(p.elements).map((id) => byId.get(id)!);
        if (p.templateId === 'pair-side') expect(ps.every((x) => x.width <= x.height * 1.15)).toBe(true);
        if (p.templateId?.startsWith('stack')) expect(ps.every((x) => x.width > x.height * 1.15)).toBe(true);
      }
    }
    const three = makeStory(makePhotos(3, 1, L), { style: 'clean', aspect: '4:5', seed: 2 });
    expect(three.map((p) => p.templateId)).toEqual(['stack-3']);
    const two = makeStory(makePhotos(2, 1, L), { style: 'clean', aspect: '4:5', seed: 2 });
    expect(two.map((p) => p.templateId)).toEqual(['stack-2']);
    const mixed = makeStory(makePhotos(2, 1, [[4000, 3000]]).map((p, i) => (i ? { ...p, width: 3000, height: 4000 } : p)), { style: 'clean', aspect: '4:5', seed: 2 });
    expect(mixed).toHaveLength(2);
  });
  it('stylized: landscape runs can use the tight stacks', () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 20; seed++) for (const p of makeStory(makePhotos(14, seed, L), { style: 'stylized', aspect: '4:5', seed })) seen.add(p.templateId!);
    expect(seen.has('stack-2-tight') || seen.has('stack-3-tight')).toBe(true);
    expect(seen.has('stack-2-tight') && seen.has('stack-3-tight')).toBe(true);
  });
});
