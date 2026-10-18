import { describe, expect, it } from 'vitest';
import { makeStory } from '../src/story/autofill';
import { ASPECTS, aspectRatio, type El, type TextEl } from '../src/story/model';
import { moveToOwnPage } from '../src/story/split';
import { getTemplate, TEMPLATES } from '../src/story/templates';
import { layoutOptions } from '../src/story/layouts';
import { emptyStory } from '../src/story/model';
import { makePhotos } from './story-helpers';

const IDS = ['cover-border', 'cover-border-below', 'cover-mat'];
const SHAPES: [number, number][] = [[3000, 4000], [4000, 3000], [4000, 4000], [6000, 2400]];
const inBounds = (e: El, A: number) => e.x >= -1e-6 && e.y >= -1e-6 && e.x + e.w <= 1 + 1e-6 && e.y + e.h <= 1 + 1e-6 && A > 0;

describe('cover variants', () => {
  it('are registered', () => {
    for (const id of IDS) expect(TEMPLATES.some((t) => t.id === id)).toBe(true);
    expect(getTemplate('cover-border')!.name).toBe('Cover — white border');
    expect(getTemplate('cover-mat')!.name).toBe('Cover — print mat');
  });
  for (const id of IDS) {
    it(`${id}: bounds, centring and roles for all aspects and orientations`, () => {
      for (const aspect of ASPECTS) {
        for (const [w, h] of SHAPES) {
          const photos = makePhotos(1, 1, [[w, h]]);
          const [els] = getTemplate(id)!.layout(aspect, photos, { title: 'The Faroes', subtitle: 'June 2025' }).pages;
          const A = aspectRatio(aspect);
          for (const e of els) expect(inBounds(e, A), `${id} ${aspect} ${w}x${h} ${e.kind}`).toBe(true);
          const texts = els.filter((e): e is TextEl => e.kind === 'text');
          expect(texts.map((t) => t.role)).toEqual(['title', 'subtitle']);
          expect(texts[0].font).toBe('italiana');
          const photo = els.find((e) => e.kind === 'photo')!;
          expect(photo.x + photo.w / 2).toBeCloseTo(0.5, 5);
          // Text never overlaps the photo unless it is meant to sit on it.
          if (id !== 'cover-border') expect(texts[0].y >= photo.y + photo.h - 1e-6 || texts[0].y + texts[0].h <= photo.y + 1e-6).toBe(true);
          else {
            expect(texts[0].x).toBeGreaterThanOrEqual(photo.x - 1e-6);
            expect(texts[0].x + texts[0].w).toBeLessThanOrEqual(photo.x + photo.w + 1e-6);
            expect(texts[1].y + texts[1].h).toBeLessThanOrEqual(photo.y + photo.h + 1e-6);
          }
        }
      }
    });
  }
  it('are offered first for page 1 when the story has a title', () => {
    const photos = makePhotos(1, 1, [[3000, 4000]]);
    const pages = makeStory(photos, { style: 'clean', aspect: '4:5', seed: 1, title: 'Faroes' });
    const story = { ...emptyStory('4:5'), title: 'Faroes', pages, photos };
    const o = layoutOptions(story, 0);
    expect(o.slice(0, 5).map((x) => x.id)).toEqual(expect.arrayContaining(['cover', 'cover-border', 'cover-border-below', 'cover-mat']));
    expect(o.filter((x) => x.arrangement.startsWith('cover')).length).toBeGreaterThanOrEqual(5);
    const noTitle = layoutOptions({ ...story, title: '', pages: makeStory(photos, { style: 'clean', aspect: '4:5', seed: 1 }) }, 0);
    expect(noTitle.some((x) => x.id.startsWith('cover'))).toBe(false);
  });
  it('clean autofill uses cover-border for a landscape first photo and cover for a portrait one', () => {
    const land = makePhotos(2, 1, [[4000, 3000]]);
    expect(makeStory(land, { style: 'clean', aspect: '4:5', seed: 1, title: 'Faroes' })[0].templateId).toBe('cover-border');
    const port = makePhotos(2, 1, [[3000, 4000]]);
    expect(makeStory(port, { style: 'clean', aspect: '4:5', seed: 1, title: 'Faroes' })[0].templateId).toBe('cover');
  });
});

describe('black-bordered stacks', () => {
  for (const n of [2, 3]) {
    it(`stack-${n}-black matches stack-${n} geometry with a thin black frame`, () => {
      const photos = makePhotos(n, 2, [[4000, 3000]]);
      for (const aspect of ASPECTS) {
        const plain = getTemplate(`stack-${n}`)!.layout(aspect, photos).pages[0];
        const black = getTemplate(`stack-${n}-black`)!.layout(aspect, photos);
        expect(black.backgrounds[0].toLowerCase()).toBe('#ffffff');
        black.pages[0].forEach((e, i) => {
          expect([e.x, e.y, e.w, e.h]).toEqual([plain[i].x, plain[i].y, plain[i].w, plain[i].h]);
          expect(e.kind === 'photo' && e.frameColor).toBe('#000000');
          expect(e.kind === 'photo' && e.frame).toBeCloseTo(0.006, 6);
        });
      }
    });
  }
  it('moving a photo off a stack-3-black page gives a stack-2-black page', () => {
    const photos = makePhotos(3, 2, [[4000, 3000]]);
    const t = getTemplate('stack-3-black')!;
    const els = t.layout('4:5', photos).pages[0].map((e, i) => ({ ...e, id: `e${i}` }));
    const story = { ...emptyStory('4:5'), photos, pages: [{ id: 'p0', templateId: 'stack-3', finish: 'black' as const, background: '#ffffff', duration: 3, elements: els }] };
    const r = moveToOwnPage(story, 0, 'e0')!;
    expect(r).not.toBeNull();
    expect(r.story.pages.map((p) => [p.templateId, p.finish])).toContainEqual(['stack-2', 'black']);
  });
});
