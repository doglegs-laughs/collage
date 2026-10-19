import { describe, expect, it } from 'vitest';
import { emptyPage, emptyStory } from '../src/story/model';
import { computeTimeline, setBoundaryTransition } from '../src/story/timeline';
import { formatClock, previewAt, rulerStep, snapToBeat } from '../src/story/timeline/math';

describe('snapToBeat', () => {
  const beats = [0.2, 0.7, 1.2, 1.7];
  it('snaps within 8 px either side and not beyond', () => {
    expect(snapToBeat(0.72, beats, 100)).toEqual({ time: 0.7, snapped: true }); // 2 px
    expect(snapToBeat(0.65, beats, 100)).toEqual({ time: 0.7, snapped: true }); // 5 px
    expect(snapToBeat(0.6, beats, 100)).toEqual({ time: 0.6, snapped: false }); // 10 px from 0.7
    expect(snapToBeat(1.77, beats, 100)).toEqual({ time: 1.7, snapped: true }); // past the last beat
    expect(snapToBeat(0.13, beats, 100)).toEqual({ time: 0.2, snapped: true }); // before the first
  });
  it('depends on the zoom, picks the nearer beat, and can be switched off', () => {
    expect(snapToBeat(0.6, beats, 20).snapped).toBe(true); // 2 px at 20 px/s
    expect(snapToBeat(0.94, beats, 60)).toEqual({ time: 0.94, snapped: false }); // 14 px from the nearest beat
    expect(snapToBeat(0.72, beats, 100, false)).toEqual({ time: 0.72, snapped: false });
    expect(snapToBeat(1, [], 100).snapped).toBe(false);
  });
});

describe('ruler helpers', () => {
  it('spaces labels at least 64 px apart', () => {
    expect(rulerStep(200)).toBe(0.5);
    expect(rulerStep(50)).toBe(2);
    expect(rulerStep(2)).toBe(60);
    expect(formatClock(75.25)).toBe('1:15.3');
    expect(formatClock(5, false)).toBe('0:05');
  });
});

describe('previewAt', () => {
  const story = emptyStory('1:1');
  story.pages = [emptyPage(), emptyPage(), emptyPage()];
  story.video = { ...story.video, transition: 'crossfade', transitionSeconds: 1 };
  const tl = computeTimeline(story);

  it('shows one clip, or both while a fade runs (starting at the boundary)', () => {
    expect(previewAt(tl, 1, false)).toMatchObject({ from: 0, to: null });
    expect(previewAt(tl, 3.5, false)).toMatchObject({ from: 0, to: 1, progress: 0.5, kind: 'crossfade' });
    expect(previewAt(tl, 4.2, false)).toMatchObject({ from: 1, to: null });
  });
  it('centres the fade on the boundary when synced to beats', () => {
    expect(previewAt(tl, 2.6, true)).toMatchObject({ from: 0, to: 1 });
    expect(previewAt(tl, 3.4, true)).toMatchObject({ from: 0, to: 1 });
    expect(previewAt(tl, 3.6, true)).toMatchObject({ from: 1, to: null });
  });
  it('does not fade at cuts and slides at slide boundaries', () => {
    const cut = computeTimeline(setBoundaryTransition(story, story.pages[0].id, 'none'));
    expect(previewAt(cut, 3.2, false)).toMatchObject({ from: 1, to: null });
    const slide = computeTimeline(setBoundaryTransition(story, story.pages[0].id, 'slide'));
    expect(previewAt(slide, 3.5, false)).toMatchObject({ from: 0, to: 1, kind: 'slide' });
  });
});
