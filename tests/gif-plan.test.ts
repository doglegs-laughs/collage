import { describe, it, expect } from 'vitest';
import { FADE_STEPS, frameAt, planGif, playOrder, type PlanOptions } from '../src/gif/plan';
import { gifSize, placePhoto } from '../src/gif/shape';

const base: PlanOptions = { secondsPerFrame: 0.5, holdEnds: false, loop: 'forever', boomerang: false, crossfade: false };
const photos = (plan: ReturnType<typeof planGif>) => plan.frames.map((f) => f.a);

describe('playOrder', () => {
  it('plays in selection order', () => {
    expect(playOrder(4, base)).toEqual([0, 1, 2, 3]);
  });
  it('turns a boomerang around without repeating the turnaround photo', () => {
    expect(playOrder(4, { ...base, boomerang: true, loop: 'once' })).toEqual([0, 1, 2, 3, 2, 1, 0]);
  });
  it('stops a looping boomerang before the first photo, which the loop shows next', () => {
    expect(playOrder(4, { ...base, boomerang: true })).toEqual([0, 1, 2, 3, 2, 1]);
    expect(playOrder(2, { ...base, boomerang: true })).toEqual([0, 1]);
  });
});

describe('planGif', () => {
  it('gives each photo the chosen time', () => {
    const plan = planGif(3, base);
    expect(plan.frames).toEqual([0, 1, 2].map((a) => ({ a, b: a, mix: 0, duration: 0.5 })));
    expect(plan.duration).toBe(1.5);
  });
  it('doubles the first and last photo when held', () => {
    const plan = planGif(3, { ...base, holdEnds: true });
    expect(plan.frames.map((f) => f.duration)).toEqual([1, 0.5, 1]);
    expect(plan.duration).toBe(2.5);
  });
  it('holds both ends of a boomerang that plays once', () => {
    const plan = planGif(3, { ...base, holdEnds: true, boomerang: true, loop: 'once' });
    expect(photos(plan)).toEqual([0, 1, 2, 1, 0]);
    expect(plan.frames.map((f) => f.duration)).toEqual([1, 0.5, 1, 0.5, 1]);
  });
  it('adds blended frames that take their time from the photo before, so the total stays the same', () => {
    const plain = planGif(3, { ...base, loop: 'once' });
    const faded = planGif(3, { ...base, loop: 'once', crossfade: true });
    // 2 transitions, each with FADE_STEPS blends
    expect(faded.frames).toHaveLength(3 + 2 * FADE_STEPS);
    expect(faded.duration).toBeCloseTo(plain.duration, 5);
    const blends = faded.frames.filter((f) => f.mix > 0);
    expect(blends).toHaveLength(2 * FADE_STEPS);
    expect(blends.slice(0, FADE_STEPS).map((f) => f.mix)).toEqual(Array.from({ length: FADE_STEPS }, (_, k) => (k + 1) / (FADE_STEPS + 1)));
    expect(blends.every((f) => f.duration >= 0.04)).toBe(true);
    expect(faded.frames[0]).toMatchObject({ a: 0, mix: 0 });
    expect(faded.frames[1]).toMatchObject({ a: 0, b: 1 });
  });
  it('fades from the last photo back to the first when looping', () => {
    const plan = planGif(3, { ...base, crossfade: true });
    expect(plan.frames).toHaveLength(3 + 3 * FADE_STEPS);
    expect(plan.frames.at(-1)).toMatchObject({ a: 2, b: 0 });
  });
  it('uses fewer blends when photos are very short', () => {
    const plan = planGif(3, { ...base, secondsPerFrame: 0.1, loop: 'once', crossfade: true });
    const blends = plan.frames.filter((f) => f.mix > 0);
    expect(blends.length).toBeGreaterThan(0);
    expect(blends.length).toBeLessThan(2 * FADE_STEPS);
    expect(plan.frames.every((f) => f.duration >= 0.02)).toBe(true);
    expect(plan.duration).toBeCloseTo(0.3, 5);
  });
  it('keeps every delay a whole number of centiseconds', () => {
    const plan = planGif(5, { ...base, secondsPerFrame: 0.7, holdEnds: true, boomerang: true, crossfade: true });
    for (const f of plan.frames) expect(Math.abs(f.duration * 100 - Math.round(f.duration * 100))).toBeLessThan(1e-6);
  });
  it('plans nothing without photos', () => {
    expect(planGif(0, base)).toEqual({ frames: [], duration: 0 });
  });
});

describe('frameAt', () => {
  const plan = planGif(3, base);
  it('finds the frame showing at a time', () => {
    expect([0, 0.49, 0.5, 1.2].map((t) => frameAt(plan, t, 'once'))).toEqual([0, 0, 1, 2]);
  });
  it('wraps when looping and holds the last frame when played once', () => {
    expect(frameAt(plan, 1.6, 'forever')).toBe(0);
    expect(frameAt(plan, 9, 'once')).toBe(2);
  });
});

describe('gifSize / placePhoto', () => {
  it('follows the first photo for Original, within limits', () => {
    expect(gifSize({ width: 3000, height: 2000 }, 'original', 720)).toEqual({ width: 720, height: 480 });
    expect(gifSize({ width: 100, height: 2000 }, 'original', 720)).toEqual({ width: 720, height: 2160 });
    expect(gifSize(null, 'original', 720)).toEqual({ width: 720, height: 720 });
  });
  it('uses the chosen shape', () => {
    expect(gifSize(null, '4:5', 720)).toEqual({ width: 720, height: 900 });
    expect(gifSize(null, '9:16', 720)).toEqual({ width: 720, height: 1280 });
    expect(gifSize(null, '16:9', 1080)).toEqual({ width: 1080, height: 608 });
  });
  it('fills by centre crop and fits by letterbox', () => {
    expect(placePhoto({ width: 400, height: 200 }, { width: 100, height: 100 }, 'fill')).toMatchObject({ sx: 100, sy: 0, sw: 200, sh: 200, dx: 0, dy: 0, dw: 100, dh: 100 });
    expect(placePhoto({ width: 400, height: 200 }, { width: 100, height: 100 }, 'fit')).toMatchObject({ sx: 0, sw: 400, dx: 0, dy: 25, dw: 100, dh: 50 });
  });
});
