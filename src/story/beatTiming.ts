import type { BeatAnalysis } from '../api';

/** Page boundaries follow detected music beats; music repeats exactly as it does in FFmpeg. */
export function beatDurations(count: number, analysis: BeatAnalysis, beatsPerPage: number, fps = 30): number[] {
  const { beats, duration } = analysis;
  if (![1, 2, 4, 8].includes(beatsPerPage) || !Number.isFinite(duration) || !(duration > 0) || beats.length < 2 ||
    beats.some((t, i) => !Number.isFinite(t) || t < 0 || t >= duration || (i > 0 && t <= beats[i - 1]))) {
    throw new Error('Beat timing is unavailable. Analyze the music again.');
  }
  let previousFrame = 0;
  return Array.from({ length: count }, (_, i) => {
    const index = (i + 1) * beatsPerPage;
    const time = Math.floor(index / beats.length) * duration + beats[index % beats.length];
    const frame = Math.max(previousFrame + 1, Math.round(time * fps));
    const seconds = (frame - previousFrame) / fps;
    previousFrame = frame;
    return seconds;
  });
}
