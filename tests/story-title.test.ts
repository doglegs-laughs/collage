import { describe, expect, it } from 'vitest';
import { ASPECTS, aspectRatio, deserializeStory, emptyStory, serializeStory, defaultTextEl, type Story, type TextEl } from '../src/story/model';
import { makeStory } from '../src/story/autofill';
import { getTemplate, titleElements } from '../src/story/templates';
import { addTitlePage, addTitleToPage, hasTitleEl, setRoleText } from '../src/story/storyOps';
import { makePhotos } from './story-helpers';

const texts = (s: Story) => s.pages.flatMap((p) => p.elements.filter((e): e is TextEl => e.kind === 'text'));
const storyOf = (title: string, subtitle = '', photos = 3, style: Story['style'] = 'clean'): Story => {
  const ph = makePhotos(photos, 2);
  return { ...emptyStory(), title, ...(subtitle ? { subtitle } : {}), style, photos: ph, pages: makeStory(ph, { style, aspect: '4:5', title, subtitle, seed: 3 }) };
};

describe('roles', () => {
  it('templates tag title, subtitle and caption text', () => {
    const ph = makePhotos(2, 1);
    for (const id of ['cover', 'cover-sans', 'title-card', 'magazine']) {
      const els = getTemplate(id)!.layout('4:5', ph.slice(0, getTemplate(id)!.slots), { title: 'Hello', subtitle: 'Sub' }).pages[0].filter((e): e is TextEl => e.kind === 'text');
      expect(els.map((e) => e.role)).toEqual(['title', 'subtitle']);
    }
    const pol = getTemplate('polaroid-on-photo')!.layout('4:5', ph, { caption: 'Hello' }).pages[0].filter((e): e is TextEl => e.kind === 'text');
    expect(pol.map((e) => e.role)).toEqual(['title']);
  });
  it('setTitle semantics: updates every role element, keeps it when empty', () => {
    let s = storyOf('Faroes', 'June');
    s = setRoleText(s, 'title', 'Iceland');
    expect(texts(s).find((t) => t.role === 'title')!.text).toBe('Iceland');
    s = setRoleText(s, 'title', '');
    expect(hasTitleEl(s)).toBe(true);
    expect(texts(s).find((t) => t.role === 'title')!.text).toBe('');
    s = setRoleText(s, 'title', 'Back');
    expect(texts(s).find((t) => t.role === 'title')!.text).toBe('Back');
    s = setRoleText(s, 'subtitle', 'July');
    expect(texts(s).find((t) => t.role === 'subtitle')!.text).toBe('July');
  });
});

describe('migration', () => {
  it('assigns roles to old stories by matching text', () => {
    const s = storyOf('The Faroes', '');
    const old = JSON.parse(serializeStory(s));
    for (const p of old.pages) for (const e of p.elements) delete e.role;
    old.pages[0].elements.push(defaultTextEl({ text: '  the  FAROES ' }), defaultTextEl({ text: 'other' }));
    const back = deserializeStory(JSON.stringify(old));
    const t = texts(back);
    expect(t.filter((e) => e.role === 'title').length).toBeGreaterThanOrEqual(2);
    expect(t.find((e) => e.text === 'other')!.role).toBeUndefined();
  });
  it('round-trips subtitle', () => {
    expect(deserializeStory(serializeStory(storyOf('A', 'B'))).subtitle).toBe('B');
  });
});

describe('titleElements', () => {
  it('fits inside the page for every aspect and title length', () => {
    for (const a of ASPECTS) {
      for (const t of ['Hi', 'The Faroe Islands', 'A very long title about a summer spent wandering coastlines and mountains']) {
        const els = titleElements(a, t, 'Sub', { y: 0.05 });
        const H = 1;
        expect(els.map((e) => e.role)).toEqual(['title', 'subtitle']);
        for (const e of els) {
          expect(e.x).toBeGreaterThanOrEqual(0);
          expect(e.x + e.w).toBeLessThanOrEqual(1 + 1e-9);
          expect(e.y).toBeGreaterThanOrEqual(0);
          expect(e.y + e.h).toBeLessThanOrEqual(H);
          expect(e.size).toBeGreaterThan(0.01);
        }
      }
    }
  });
});

describe('add title', () => {
  it('title page: cover for clean, cover-sans for stylized, title-card without photos', () => {
    const clean = addTitlePage(storyOf('', '', 3), 1);
    expect(clean.pages).toHaveLength(storyOf('', '', 3).pages.length + 1);
    expect(clean.pages[0].templateId).toBe('cover');
    const withTitle = addTitlePage({ ...storyOf('', '', 3), title: 'T', subtitle: 'S' }, 1);
    expect(withTitle.pages[0].elements.filter((e) => e.kind === 'text').map((e) => (e as TextEl).role)).toEqual(['title', 'subtitle']);
    expect(addTitlePage({ ...storyOf('', '', 3, 'stylized'), title: 'T' }, 1).pages[0].templateId).toBe('cover-sans');
    expect(addTitlePage({ ...emptyStory(), title: 'T' }, 1).pages[0].templateId).toBe('title-card');
  });
  it('this page: white with shadow over a full-bleed photo, dark otherwise', () => {
    const s = { ...storyOf('', '', 3), title: 'Hello', subtitle: 'There' };
    const photo = s.pages[0].elements.find((e) => e.kind === 'photo')!;
    const bleedPage = { ...s.pages[0], elements: [{ ...photo, x: 0, y: 0, w: 1, h: 1 / aspectRatio(s.aspect) }] };
    const r = addTitleToPage({ ...s, pages: [bleedPage] }, 0);
    expect(r.titleId).toBeTruthy();
    const added = texts(r.story).filter((t) => t.role);
    expect(added.map((t) => t.text)).toEqual(['Hello', 'There']);
    expect(added[0].color).toBe('#ffffff');
    expect(added[0].shadow).toBe(true);
    const dark = texts(addTitleToPage({ ...s, pages: [{ ...s.pages[0], elements: [] }] }, 0).story).find((t) => t.role === 'title')!;
    expect(dark.color).toBe('#111111');
    expect(dark.shadow).toBe(false);
  });
});
