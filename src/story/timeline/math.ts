import type { BoundaryTransition } from '../model';
import { clipAtTime, type ComputedTimeline } from '../timeline';

export const SNAP_PX = 8;
export const MAX_PX_PER_SECOND = 200;

/** `time` pulled to the nearest of the sorted `beats` when it is within `radiusPx` on screen (never when `enabled` is false). */
export function snapToBeat(time: number, beats: readonly number[], pxPerSecond: number, enabled = true, radiusPx = SNAP_PX): { time: number; snapped: boolean } {
  if (!enabled || !beats.length) return { time, snapped: false };
  let lo = 0, hi = beats.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (beats[mid] < time) lo = mid + 1; else hi = mid;
  }
  let best = beats[lo] ?? beats[lo - 1];
  if (lo > 0 && (lo >= beats.length || time - beats[lo - 1] <= beats[lo] - time)) best = beats[lo - 1];
  return Math.abs(best - time) * pxPerSecond <= radiusPx ? { time: best, snapped: true } : { time, snapped: false };
}

/** Seconds between ruler labels so labels are at least ~64 px apart. */
export function rulerStep(pxPerSecond: number): number {
  const steps = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 1800];
  return steps.find((s) => s * pxPerSecond >= 64) ?? 3600;
}

/** `m:ss.s`, or `m:ss` without tenths. */
export function formatClock(t: number, tenths = true): string {
  const v = Math.max(0, t);
  const m = Math.floor(v / 60);
  const s = v - m * 60;
  return `${m}:${tenths ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0')}`;
}

export type PreviewState = { from: number; to: number | null; progress: number; kind: BoundaryTransition };

/**
 * What the preview shows at video time `t`: one clip, or two while a transition runs.
 * A fade starts at the boundary, or is centred on it when photo changes are synced to beats.
 */
export function previewAt(tl: ComputedTimeline, t: number, centred: boolean): PreviewState {
  for (let k = 0; k < tl.boundaries.length; k++) {
    const b = tl.boundaries[k];
    if (b.transition === 'none') continue;
    const boundary = tl.clips[k + 1].start;
    const begin = boundary - (centred ? b.seconds / 2 : 0);
    if (t >= begin && t < begin + b.seconds) return { from: k, to: k + 1, progress: (t - begin) / b.seconds, kind: b.transition };
  }
  return { from: clipAtTime(tl, t), to: null, progress: 0, kind: 'none' };
}

/** Where in the music file the sound for video time `t` is: the start offset plus `t`, wrapped at the loop point (null = no known loop, no wrapping). */
export function musicPosition(offset: number, t: number, loop: number | null): number {
  const at = offset + t;
  return loop && loop > 0 ? at % loop : at;
}

/**
 * Manual loop for the preview audio (instead of `el.loop`, which would only wrap at the end of the file): where to seek the element
 * to, or null to leave it alone. At or past the loop point it goes back by one loop; an element that has run to its end restarts at 0.
 */
export function loopSeekTarget(currentTime: number, loop: number | null, ended = false): number | null {
  if (ended) return 0;
  if (loop && loop > 0 && currentTime >= loop) return currentTime % loop;
  return null;
}

/** Loudest bucket of `peaks` (spread over `duration` seconds) under the music-time span [m0, m1), where the music repeats every `loop` seconds. */
export function waveformPeak(peaks: readonly number[], duration: number, loop: number | null, m0: number, m1: number): number {
  const per = peaks.length / duration; // buckets per second
  const size = Math.max(1, Math.min(peaks.length, Math.round((loop && loop > 0 ? Math.min(loop, duration) : duration) * per)));
  const from = Math.floor(m0 * per), to = Math.max(from + 1, Math.ceil(m1 * per));
  let peak = 0;
  for (let i = from; i < to; i++) peak = Math.max(peak, peaks[i % size] ?? 0);
  return peak;
}
