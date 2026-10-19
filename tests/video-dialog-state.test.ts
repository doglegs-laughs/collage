import { describe, expect, it } from 'vitest';
import { NO_MEMORY, pickTransition, setBeatSync } from '../src/story/videoDialogState';
import { videoTransitions } from '../src/story/exportStory';
import { defaultPhotoEl, emptyPage, emptyStory, type Story, type VideoSettings } from '../src/story/model';

type V = Pick<VideoSettings, 'transition' | 'syncToBeats'>;
const apply = (v: V, patch: Partial<VideoSettings>): V => ({ ...v, ...patch });

describe('beat sync dialog state', () => {
  it('defaults to no transition when beat sync is switched on, and restores the old one when off', () => {
    let v: V = { transition: 'crossfade', syncToBeats: false };
    let step = setBeatSync(v, NO_MEMORY, true);
    expect(step.patch).toMatchObject({ syncToBeats: true, fitToMusic: false, transition: 'none' });
    v = apply(v, step.patch);
    step = setBeatSync(v, step.memory, false);
    expect(step.patch).toEqual({ syncToBeats: false, transition: 'crossfade' });
  });
  it('keeps a crossfade the user picks while syncing, and offers it again next time in the same dialog', () => {
    let v: V = { transition: 'none', syncToBeats: false };
    let step = setBeatSync(v, NO_MEMORY, true);
    v = apply(v, step.patch);
    let mem = step.memory;
    step = pickTransition(v, mem, 'crossfade');
    v = apply(v, step.patch); mem = step.memory;
    expect(v.transition).toBe('crossfade');
    step = setBeatSync(v, mem, false);
    v = apply(v, step.patch); mem = step.memory;
    expect(v.transition).toBe('none'); // what it was before syncing
    step = setBeatSync(v, mem, true);
    expect(step.patch.transition).toBe('crossfade');
  });
  it('does not remember transition picks made while beat sync is off', () => {
    const v: V = { transition: 'none', syncToBeats: false };
    const step = pickTransition(v, NO_MEMORY, 'crossfade');
    expect(step.memory).toEqual(NO_MEMORY);
    expect(setBeatSync({ transition: 'crossfade', syncToBeats: false }, step.memory, true).patch.transition).toBe('none');
  });
  it('leaves the transition alone when sync was already on at open and is switched off', () => {
    expect(setBeatSync({ transition: 'none', syncToBeats: true }, NO_MEMORY, false).patch).toEqual({ syncToBeats: false });
  });
});

describe('beat sync spreads', () => {
  const spread = (transition: 'none' | 'crossfade'): Story => ({
    ...emptyStory(),
    pages: [0, 1].map((index) => ({ ...emptyPage(), spread: { index, count: 2 }, elements: [defaultPhotoEl(index === 0 ? { x: 0.5, w: 1 } : { x: -0.5, w: 1 })] })),
    video: { ...emptyStory().video, transition, kenBurns: true },
  });
  it('cuts at a spread seam under beat sync with no transition', () => {
    const { transitions, kenBurnsPages } = videoTransitions(spread('none'), true);
    expect(transitions).toEqual(['none']);
    expect(kenBurnsPages).toEqual([true, true]);
  });
  it('slides at the seam when a crossfade is chosen, or without beat sync', () => {
    expect(videoTransitions(spread('crossfade'), true).transitions).toEqual(['slide']);
    expect(videoTransitions(spread('none'), false).transitions).toEqual(['slide']);
  });
});
