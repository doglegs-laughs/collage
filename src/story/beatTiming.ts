import type { BeatAnalysis } from '../api';

export const MIN_BEAT_PAGE_SECONDS = 0.5;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * The beat grid the video follows, plus the length of one music repeat.
 *
 * Repeats: the audio is looped by FFmpeg, and the video job passes `loopSeconds` so the loop restarts
 * one median beat interval after the last detected beat, not at the file's raw duration. A raw
 * duration is unreliable as a loop point: decoders add encoder padding (MP3/AAC priming and trailing
 * samples) and a long silent tail would otherwise land between two repeats. The repeat never exceeds
 * the real duration.
 *
 * Gaps: where two detected beats are further apart than a page of `beatsPerPage` beats could
 * reasonably last (median interval x beatsPerPage x 1.5), extrapolated beats are inserted at the
 * median interval so no single page spans a break or silence.
 */
export function beatGrid(analysis: BeatAnalysis, beatsPerPage: number): { beats: number[]; loopSeconds: number } {
  const { beats, duration } = analysis;
  const interval = median(beats.slice(1).map((t, i) => t - beats[i]));
  const cap = interval * beatsPerPage * 1.5;
  const filled: number[] = [];
  beats.forEach((t, i) => {
    if (i > 0 && t - beats[i - 1] > cap) {
      for (let x = beats[i - 1] + interval; x < t - interval * 0.5; x += interval) filled.push(x);
    }
    filled.push(t);
  });
  return { beats: filled, loopSeconds: Math.min(duration, beats[beats.length - 1] + interval) };
}

/**
 * Page boundaries follow detected music beats; music repeats as `beatGrid` describes.
 * A page shorter than `minSeconds` is merged into the next one by moving its end to a later beat.
 */
export function beatDurations(count: number, analysis: BeatAnalysis, beatsPerPage: number, fps = 30, minSeconds = MIN_BEAT_PAGE_SECONDS): number[] {
  const { beats, duration } = analysis;
  if (![1, 2, 4, 8].includes(beatsPerPage) || !Number.isFinite(duration) || !(duration > 0) || beats.length < 2 ||
    beats.some((t, i) => !Number.isFinite(t) || t < 0 || t >= duration || (i > 0 && t <= beats[i - 1]))) {
    throw new Error('Beat timing is unavailable. Analyze the music again.');
  }
  const grid = beatGrid(analysis, beatsPerPage);
  const frameAt = (index: number) => Math.round((Math.floor(index / grid.beats.length) * grid.loopSeconds + grid.beats[index % grid.beats.length]) * fps);
  const minFrames = Math.max(1, Math.ceil(minSeconds * fps - 1e-9));
  let previousFrame = 0, index = 0;
  return Array.from({ length: count }, () => {
    index += beatsPerPage;
    let frame = frameAt(index);
    while (frame - previousFrame < minFrames) frame = frameAt(++index);
    const seconds = (frame - previousFrame) / fps;
    previousFrame = frame;
    return seconds;
  });
}

/** Music repeat length for the video job, matching `beatDurations`. */
export function beatLoopSeconds(analysis: BeatAnalysis, beatsPerPage: number): number {
  return beatGrid(analysis, beatsPerPage).loopSeconds;
}
