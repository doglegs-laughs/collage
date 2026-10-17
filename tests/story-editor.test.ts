import { describe, expect, it } from 'vitest';
import { snapAxis, resizeBox, normalizeAngle } from '../src/story/snap';
import { replaceCoverText } from '../src/story/storyOps';
import { defaultTextEl, emptyPage, emptyStory } from '../src/story/model';
import { relinkPhotos } from '../src/story/useProject';
import { videoDurations, videoTransitions } from '../src/story/exportStory';
import { defaultPhotoEl } from '../src/story/model';

describe('snapAxis', () => {
  it('snaps to the nearest target within the threshold and reports guides', () => {
    expect(snapAxis([97, 150, 203], [0, 100, 200], 6)).toEqual({ delta: 3, hits: [100] });
    expect(snapAxis([50], [100], 6)).toEqual({ delta: 0, hits: [] });
  });
});
describe('resizeBox', () => {
  it('keeps the opposite corner fixed for rotated boxes', () => {
    const start = { cx: 100, cy: 100, w: 80, h: 40, rotation: 90 };
    const r = resizeBox(start, 'e', 0, 20, { lockAspect: false, min: 10 });
    // A 90deg rotation maps local +x to screen +y, so dragging down by 20 grows the width by 20.
    expect(r.w).toBeCloseTo(100);
    expect(r.h).toBeCloseTo(40);
    expect(r.cx).toBeCloseTo(100);
    expect(r.cy).toBeCloseTo(110);
  });
  it('locks aspect on corners', () => {
    const r = resizeBox({ cx: 50, cy: 50, w: 100, h: 50, rotation: 0 }, 'se', 20, 0, { lockAspect: true, min: 10 });
    expect(r.w / r.h).toBeCloseTo(2);
  });
});
it('normalizes angles', () => {
  expect(normalizeAngle(190)).toBe(-170);
  expect(normalizeAngle(-180)).toBe(180);
});
describe('replaceCoverText', () => {
  it('rewrites matching text on page 0 only', () => {
    const s = { ...emptyStory(), pages: [{ ...emptyPage(), elements: [defaultTextEl({ text: 'THE\nFAROES' }), defaultTextEl({ text: 'other' })] }, emptyPage()] };
    const out = replaceCoverText(s, 'the faroes', 'Iceland');
    expect(out.pages[0].elements.map((e) => (e.kind === 'text' ? e.text : ''))).toEqual(['Iceland', 'other']);
    expect(replaceCoverText(s, 'nothing', 'x')).toBe(s);
  });
});
describe('relinkPhotos', () => {
  it('maps by id then path and nulls missing photos', () => {
    const photo = (id: string, path: string) => ({ id, name: id, path, width: 10, height: 10 });
    const story = { ...emptyStory(), photos: [photo('a', '/a'), photo('b', '/b')], pages: [{ ...emptyPage(), elements: [defaultPhotoEl({ photoId: 'a' }), defaultPhotoEl({ photoId: 'b' })] }] };
    const r = relinkPhotos(story, [photo('a2', '/a')]);
    expect(r.missing).toEqual(['b']);
    expect(r.story.photos.map((p) => p.id)).toEqual(['a2']);
    expect(r.story.pages[0].elements.map((e) => (e.kind === 'photo' ? e.photoId : 0))).toEqual(['a2', null]);
  });
});
describe('video job helpers', () => {
  const story = () => {
    const s = emptyStory();
    return {
      ...s,
      video: { ...s.video, kenBurns: true },
      pages: [
        { ...emptyPage(), elements: [defaultPhotoEl({ x: 0.2, w: 1.0 })] },
        { ...emptyPage(), duration: 5 },
        emptyPage(),
        emptyPage(),
      ],
    };
  };
  it('uses slide across crossed seams and disables Ken Burns beside them', () => {
    const { transitions, kenBurnsPages } = videoTransitions(story());
    expect(transitions).toEqual(['slide', 'crossfade', 'crossfade']);
    expect(kenBurnsPages).toEqual([false, false, true, true]);
  });
  it('keeps per-page overrides and can fit to music', () => {
    expect(videoDurations(story(), 4)).toEqual([4, 5, 4, 4]);
    const fit = videoDurations(story(), 3, 30);
    // pages are laid end to end (transitions overlap inside a page's own time), so the video is the plain sum
    const total = fit.reduce((a, b) => a + b, 0);
    expect(total).toBeLessThanOrEqual(30 + 1e-9);
    expect(total).toBeGreaterThan(29.9);
  });
});
