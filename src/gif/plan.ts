export type GifLoop = 'forever' | 'once';

export type PlanOptions = {
  /** Seconds each photo is shown. */
  secondsPerFrame: number;
  /** The first and last photo stay twice as long. */
  holdEnds: boolean;
  loop: GifLoop;
  /** Play forward, then back again. */
  boomerang: boolean;
  crossfade: boolean;
};

/** One output frame: photo `a`, or `a` blended with photo `b` (`mix` 0..1 is how much of `b` shows). Indexes are into the selected photos. */
export type PlanFrame = { a: number; b: number; mix: number; duration: number };

export type GifPlan = { frames: PlanFrame[]; duration: number };

/** Blended frames per transition, at most; fewer when the fade is too short to give each one a visible delay. */
export const FADE_STEPS = 6;
/** A fade never takes longer than this, nor more than half of a photo's time. */
export const MAX_FADE_SECONDS = 0.6;
/** Shortest delay of a blended frame (below this GIF players run slow). */
export const MIN_BLEND_SECONDS = 0.04;
/** Longest animation the export accepts (matches electron/gif.cjs). */
export const MAX_FRAMES = 300;

/** GIF delays are whole centiseconds. */
const cs = (seconds: number) => Math.round(seconds * 100) / 100;

/**
 * Order the photos are shown in. A boomerang turns around without repeating the turnaround photo, and when
 * the animation loops forever it also stops before the first photo, since the loop shows it next.
 */
export function playOrder(count: number, { boomerang, loop }: Pick<PlanOptions, 'boomerang' | 'loop'>): number[] {
  const forward = Array.from({ length: count }, (_, i) => i);
  if (!boomerang || count < 2) return forward;
  const back = forward.slice(0, -1).reverse(); // n-2 .. 0
  return loop === 'forever' ? [...forward, ...back.slice(0, -1)] : [...forward, ...back];
}

/** Frames, with their delays, for `count` selected photos. The result's total never depends on crossfade: a fade takes its time from the photo before it. */
export function planGif(count: number, o: PlanOptions): GifPlan {
  if (count < 1) return { frames: [], duration: 0 };
  const order = playOrder(count, o);
  const hold = (photo: number) => (o.holdEnds && (photo === 0 || photo === count - 1) ? 2 : 1);
  const shown = order.map((photo) => cs(o.secondsPerFrame * hold(photo)));
  const frames: PlanFrame[] = [];
  for (const [i, a] of order.entries()) {
    const next = i + 1 < order.length ? i + 1 : o.loop === 'forever' ? 0 : -1;
    let rest = shown[i];
    if (o.crossfade && next >= 0 && next !== i) {
      const b = order[next];
      const fade = Math.min(MAX_FADE_SECONDS, shown[i] / 2, shown[next] / 2);
      const steps = Math.min(FADE_STEPS, Math.floor(fade / MIN_BLEND_SECONDS));
      const blends: PlanFrame[] = [];
      for (let k = 1; k <= steps; k++) blends.push({ a, b, mix: k / (steps + 1), duration: cs(fade / steps) });
      rest = cs(shown[i] - blends.reduce((sum, f) => sum + f.duration, 0));
      frames.push({ a, b: a, mix: 0, duration: rest }, ...blends);
      continue;
    }
    frames.push({ a, b: a, mix: 0, duration: rest });
  }
  return { frames, duration: cs(frames.reduce((sum, f) => sum + f.duration, 0)) };
}

/** Where the preview is `time` seconds into the animation (wraps when it loops; stays on the last frame when it plays once). */
export function frameAt(plan: GifPlan, time: number, loop: GifLoop): number {
  if (!plan.frames.length) return -1;
  let t = loop === 'forever' && plan.duration > 0 ? time % plan.duration : time;
  for (let i = 0; i < plan.frames.length; i++) {
    t -= plan.frames[i].duration;
    if (t < 0) return i;
  }
  return plan.frames.length - 1;
}
