import { describe, expect, it } from 'vitest';
import { FONT_ADVANCE, FONT_KEYS, FONT_LABELS, FONT_STACKS, FONTS, fontShorthand, fontWeights, snapWeight } from '../src/story/fonts';
import { ASPECTS, aspectRatio, deserializeStory, emptyStory, serializeStory, type FontKey, type TextEl } from '../src/story/model';
import { getTemplate, titleElements } from '../src/story/templates';

describe('fonts', () => {
  it('has the new keys and every key has stack, label, weights and advance', () => {
    for (const k of ['italiana', 'poiret', 'josefin', 'cormorant', 'playfair', 'montserrat', 'bebas', 'caveat', 'dmmono', 'marcellus', 'sans', 'serif', 'mono', 'display', 'displaySans']) expect(FONT_KEYS).toContain(k);
    expect(FONT_LABELS.italiana).toBe('Italiana — Faroes');
    for (const k of FONT_KEYS) {
      expect(FONT_STACKS[k].length).toBeGreaterThan(5);
      expect(/serif|cursive|monospace/.test(FONT_STACKS[k])).toBe(true);
      expect(FONT_LABELS[k]).toBeTruthy();
      expect(fontWeights(k).length).toBeGreaterThan(0);
      expect(FONT_ADVANCE[k]).toBeGreaterThan(0.2);
      expect(FONT_ADVANCE[k]).toBeLessThan(1);
    }
  });
  it('snaps weights to the nearest available one', () => {
    expect(snapWeight('italiana', 800)).toBe(400);
    expect(snapWeight('josefin', 400)).toBe(300);
    expect(snapWeight('josefin', 500)).toBe(600);
    expect(snapWeight('montserrat', 800)).toBe(700);
    expect(snapWeight('playfair', 300)).toBe(400);
    expect(snapWeight('sans', 600)).toBe(600);
    for (const k of FONT_KEYS) expect(FONTS[k].weights).toContain(snapWeight(k, 450));
    expect(fontShorthand({ font: 'montserrat', weight: 400, size: 0.1 }, 1000)).toMatch(/^300 100px "Montserrat"/);
  });
  it('round-trips new font keys and falls back to sans for unknown ones', () => {
    const s = emptyStory('4:5');
    const el = titleElements('4:5', 'Hello', undefined, { font: 'italiana' })[0];
    const story = { ...s, pages: [{ id: 'p', templateId: null, background: '#fff', duration: 3, elements: [el, { ...el, id: 'b', font: 'bogus' as FontKey }] }] };
    const back = deserializeStory(serializeStory(story));
    const [a, b] = back.pages[0].elements as TextEl[];
    expect(a.font).toBe('italiana');
    expect(b.font).toBe('sans');
  });
  it('titles in Italiana stay within the page for all aspects and lengths', () => {
    for (const aspect of ASPECTS) {
      const H = 1 / aspectRatio(aspect);
      for (const title of ['Faroes', 'The Faroes', 'A very long summer trip around the Faroe Islands and Iceland']) {
        const [t] = getTemplate('cover')!.layout(aspect, [{ id: 'a', name: 'a', width: 3000, height: 4000 }], { title }).pages[0].filter((e): e is TextEl => e.kind === 'text');
        expect(t.font).toBe('italiana');
        expect(t.uppercase).toBe(true);
        expect(t.letterSpacing).toBeCloseTo(0.12, 6);
        expect(t.size).toBeGreaterThanOrEqual(0.05 - 1e-9);
        expect(t.size).toBeLessThanOrEqual(0.13 + 1e-9);
        const longest = Math.max(...t.text.split('\n').map((l) => l.length));
        const widthUnits = longest * (FONT_ADVANCE.italiana + t.letterSpacing) * t.size * H;
        expect(widthUnits).toBeLessThan(0.95);
        expect(t.x).toBeGreaterThanOrEqual(0);
        expect(t.x + t.w).toBeLessThanOrEqual(1 + 1e-9);
      }
    }
  });
});
