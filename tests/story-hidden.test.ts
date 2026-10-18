import { describe, expect, it } from 'vitest';
import { videoDurations, videoTransitions } from '../src/story/exportStory';
import { deserializeStory, emptyPage, emptyStory, hiddenCount, serializeStory, setPageHidden, visibleIndices, visiblePages, defaultPhotoEl, type Page, type Story } from '../src/story/model';

const spreadPages = (): Page[] => [0, 1].map((index) => ({
  ...emptyPage(), spread: { index, count: 2 },
  // an element crossing the seam makes the boundary a slide
  elements: index === 0 ? [defaultPhotoEl({ x: 0.5, w: 1 })] : [defaultPhotoEl({ x: -0.5, w: 1 })],
}));
const story = (pages: Page[]): Story => ({ ...emptyStory(), pages, video: { ...emptyStory().video, kenBurns: true, transition: 'crossfade' } });

describe('hidden pages', () => {
  it('lists the visible sequence', () => {
    let s = story([emptyPage(), emptyPage(), emptyPage()]);
    s = setPageHidden(s, 1, true);
    expect(visibleIndices(s)).toEqual([0, 2]);
    expect(visiblePages(s)).toHaveLength(2);
    expect(hiddenCount(s)).toBe(1);
    expect(visibleIndices(setPageHidden(s, 1, false))).toEqual([0, 1, 2]);
    expect('hidden' in setPageHidden(s, 1, false).pages[1]).toBe(false);
  });
  it('computes durations, transitions and Ken Burns on the visible sequence', () => {
    const pages = [emptyPage(), { ...emptyPage(), duration: 5 }, emptyPage(), emptyPage()];
    const s = setPageHidden(story(pages), 1, true);
    expect(videoDurations(s, 4)).toEqual([4, 4, 4]);
    const { transitions, kenBurnsPages } = videoTransitions(s);
    expect(transitions).toEqual(['crossfade', 'crossfade']);
    expect(kenBurnsPages).toEqual([true, true, true]);
  });
  it('treats a seam as an ordinary boundary when a hidden page sits between its pages', () => {
    const [a, b] = spreadPages();
    const s = story([a, b]);
    expect(videoTransitions(s).transitions).toEqual(['slide']);
    // hide a middle page between two formerly adjacent pages
    const t = story([a, emptyPage(), b]);
    const hid = setPageHidden(t, 1, true);
    expect(videoTransitions(hid).transitions).toEqual(['crossfade']);
  });
  it('hides and shows a whole spread group, and skips it in the sequence', () => {
    const s = story([emptyPage(), ...spreadPages(), emptyPage()]);
    const h = setPageHidden(s, 2, true);
    expect(h.pages.map((p) => !!p.hidden)).toEqual([false, true, true, false]);
    expect(visibleIndices(h)).toEqual([0, 3]);
    expect(videoTransitions(h).transitions).toEqual(['crossfade']);
    expect(setPageHidden(h, 1, false).pages.some((p) => p.hidden)).toBe(false);
  });
  it('round-trips through serialization', () => {
    const s = setPageHidden(story([emptyPage(), emptyPage()]), 1, true);
    const back = deserializeStory(serializeStory(s));
    expect(back.pages.map((p) => !!p.hidden)).toEqual([false, true]);
    expect('hidden' in back.pages[0]).toBe(false);
  });
});
