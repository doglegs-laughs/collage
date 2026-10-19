import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BeatAnalysis } from '../src/api';
import { beatDurations, beatLoopSeconds } from '../src/story/beatTiming';
import { boundaryTransitionSeconds } from '../src/story/exportStory';
import { clicks, RATE, wav } from './helpers/wav';
import { deserializeStory, emptyStory, serializeStory } from '../src/story/model';

const require = createRequire(import.meta.url);
const { detectBeats, analyzeAudio } = require('../electron/beats.cjs') as {
  detectBeats(samples: Float32Array, sampleRate?: number): BeatAnalysis;
  analyzeAudio(file: string): Promise<BeatAnalysis>;
};
describe('local beat detection', () => {
  it.each([60, 75, 90, 110, 120, 150, 180, 195])('finds a %i BPM rhythm and its actual onset times', (bpm) => {
    const result = detectBeats(clicks(bpm));
    expect(Math.abs(result.bpm - bpm)).toBeLessThanOrEqual(2);
    expect(result.duration).toBe(12);
    expect(result.beats.length).toBeGreaterThanOrEqual(Math.floor((12 - 0.2) * bpm / 60) - 1);
    for (const time of result.beats) {
      const nearest = 0.2 + Math.round((time - 0.2) / (60 / bpm)) * (60 / bpm);
      expect(Math.abs(time - nearest)).toBeLessThan(0.04);
    }
  });

  it('finds a beat at the very start of the music, to within one analysis frame', () => {
    const result = detectBeats(clicks(120, 6, 0));
    expect(result.beats[0]).toBeLessThan(0.08);
    expect(result.beats.length).toBeGreaterThanOrEqual(11);
  });

  it('does not invent a beat at 0 s for a track that already has sound at the start', () => {
    const samples = clicks(120, 8, 0.3).map((s, i) => s + 0.2 * Math.sin(2 * Math.PI * 440 * i / RATE));
    const result = detectBeats(samples);
    expect(Math.min(...result.beats)).toBeGreaterThanOrEqual(0.25);
    expect(result.beats[0]).toBeCloseTo(0.3, 1);
  });

  it('follows gradual tempo changes without skipping beats or trimming the intro', () => {
    const samples = new Float32Array(RATE * 30);
    const expected: number[] = [];
    for (let t = 0.2; t < 30; t += 60 / (90 + 60 * t / 30)) {
      expected.push(t);
      for (let i = 0; i < RATE * 0.07; i++) {
        const at = Math.floor(t * RATE) + i;
        if (at < samples.length) samples[at] += 0.8 * Math.sin(2 * Math.PI * 90 * i / RATE) * Math.exp(-i / (RATE * 0.015));
      }
    }
    const result = detectBeats(samples);
    expect(result.beats).toHaveLength(expected.length);
    result.beats.forEach((beat, i) => expect(Math.abs(beat - expected[i])).toBeLessThan(0.04));
  });

  it('does not mistake silence or a sustained note for a rhythm', () => {
    expect(() => detectBeats(new Float32Array(RATE * 6))).toThrow(/beats/);
    const tone = Float32Array.from({ length: RATE * 6 }, (_, i) => 0.3 * Math.sin(2 * Math.PI * 440 * i / RATE));
    expect(() => detectBeats(tone)).toThrow(/beats|steady beat/);
    expect(() => detectBeats(new Float32Array(100))).toThrow(/too short/);
  });

  it('runs the analysis worker from inline source, so a path inside app.asar cannot break it', async () => {
    const fs2 = await import('node:fs');
    const real = require.resolve('../electron/beats.cjs');
    const source = fs2.readFileSync(real, 'utf8');
    const fakeModule = { exports: {} as { analyzeAudio(file: string): Promise<BeatAnalysis>; workerSource(): string } };
    const localRequire = createRequire(real);
    new Function('require', 'module', 'exports', '__filename', '__dirname', source)(
      localRequire, fakeModule, fakeModule.exports, '/Applications/Collage.app/Contents/Resources/app.asar/electron/beats.cjs', '/Applications/Collage.app/Contents/Resources/app.asar/electron');
    expect(fakeModule.exports.workerSource()).not.toContain('__filename');
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'beats-asar-'));
    try {
      const file = path.join(dir, 'rhythm.wav');
      await fs.writeFile(file, wav(clicks(120, 6)));
      expect((await fakeModule.exports.analyzeAudio(file)).bpm).toBe(120);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('caches results by file, shares in-flight runs and cancels the previous track', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'beats-cache-'));
    try {
      const a = path.join(dir, 'a.wav'), b = path.join(dir, 'file:b.wav');
      await fs.writeFile(a, wav(clicks(120, 8)));
      await fs.writeFile(b, wav(clicks(100, 8)));
      const first = analyzeAudio(a);
      const twin = analyzeAudio(a); // shares the same in-flight run
      const settled = Promise.allSettled([first, twin]);
      const second = analyzeAudio(b); // a different track stops the first run
      expect(Math.abs((await second).bpm - 100)).toBeLessThanOrEqual(2);
      expect((await settled).map((r) => r.status === 'rejected' && r.reason.name)).toEqual(['AbortError', 'AbortError']);
      const cached = await analyzeAudio(b);
      expect(await analyzeAudio(b)).toBe(cached); // served from the cache
      expect((await analyzeAudio(a)).bpm).toBe(120); // protocol-like names are read as files too
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('keeps the newest track when file checks finish out of order', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'beats-race-'));
    const nodeFs = require('node:fs/promises') as typeof fs;
    const stat = nodeFs.stat;
    try {
      const a = path.join(dir, 'slow.wav'), b = path.join(dir, 'fast.wav');
      await fs.writeFile(a, wav(clicks(120, 8)));
      await fs.writeFile(b, wav(clicks(100, 8)));
      // The older request's file check finishes last, after the newer track has started.
      nodeFs.stat = (async (p: string, ...rest: []) => {
        if (p === a) await new Promise((r) => setTimeout(r, 200));
        return stat(p, ...rest);
      }) as typeof stat;
      const older = analyzeAudio(a).then(() => 'done', (e: Error) => e.name);
      const newer = analyzeAudio(b);
      expect(Math.abs((await newer).bpm - 100)).toBeLessThanOrEqual(2);
      expect(await older).toBe('AbortError');
    } finally {
      nodeFs.stat = stat;
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it('decodes a real music file with FFmpeg and analyzes it in a worker', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'beats-'));
    try {
      const file = path.join(dir, 'rhythm.wav');
      await fs.writeFile(file, wav(clicks(120, 8)));
      const result = await analyzeAudio(file);
      expect(result.bpm).toBe(120);
      expect(result.beats.length).toBeGreaterThanOrEqual(15);
      expect(result.duration).toBeCloseTo(8);
      await expect(analyzeAudio(path.join(dir, 'missing.mp3'))).rejects.toThrow(/music|audio/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});

describe('beat-based photo timing', () => {
  const analysis: BeatAnalysis = { beats: Array.from({ length: 16 }, (_, i) => 0.2 + i * 0.5), duration: 8, bpm: 120 };
  it.each([1, 2, 4, 8])('places changes every %i beats, within half a video frame', (pace) => {
    let boundary = 0;
    const durations = beatDurations(12, analysis, pace);
    for (let i = 0; i < durations.length; i++) {
      boundary += durations[i];
      const index = (i + 1) * pace;
      const beat = Math.floor(index / analysis.beats.length) * analysis.duration + analysis.beats[index % analysis.beats.length];
      expect(Math.abs(boundary - beat)).toBeLessThanOrEqual(1 / 60 + 1e-9);
      expect(durations[i]).toBeGreaterThan(0);
    }
  });

  it('uses irregular detected times rather than inventing cuts from the BPM', () => {
    const result = beatDurations(3, { beats: [0.1, 0.53, 1.06, 1.55], bpm: 120, duration: 2.1 }, 1);
    expect(result.map((_, i) => result.slice(0, i + 1).reduce((a, b) => a + b, 0))).toEqual([16 / 30, 32 / 30, 47 / 30]);
  });

  it('merges pages that would be shorter than the minimum into the next beat', () => {
    // Beats 0.2 s apart for the first second, then 0.5 s apart.
    const beats = [0.1, 0.3, 0.5, 0.7, 0.9, 1.4, 1.9, 2.4, 2.9];
    const durations = beatDurations(4, { beats, bpm: 120, duration: 3.4 }, 1);
    expect(Math.min(...durations)).toBeGreaterThanOrEqual(0.5 - 1e-9);
    const ends = durations.map((_, i) => durations.slice(0, i + 1).reduce((a, b) => a + b, 0));
    for (const end of ends) expect(beats.some((t) => Math.abs(t - end) <= 1 / 60 + 1e-9)).toBe(true);
  });

  it('keeps one short page from shrinking every crossfade', () => {
    expect(boundaryTransitionSeconds([4, 0.5, 4, 4], 1)).toEqual([0.4, 0.4, 1]);
    expect(boundaryTransitionSeconds([2], 1)).toEqual([]);
  });

  it('repeats short music from the last beat plus one beat interval, not the file length', () => {
    // 4 beats at 0.5 s and 5 s of silence: the file is 7.2 s long but the pulse repeats every 2.2 s.
    const analysis: BeatAnalysis = { beats: [0.2, 0.7, 1.2, 1.7], bpm: 120, duration: 7.2 };
    expect(beatLoopSeconds(analysis, 4)).toBeCloseTo(2.2);
    const durations = beatDurations(6, analysis, 4);
    expect(Math.max(...durations)).toBeLessThanOrEqual(0.5 * 4 * 1.5 + 1e-9);
    durations.slice(0, 3).forEach((d, i) => expect(d).toBeCloseTo(i === 0 ? 2.4 : 2.2, 1));
  });

  it('inserts extrapolated beats across a long silent gap in the middle of a track', () => {
    const analysis: BeatAnalysis = { beats: [0.2, 0.7, 1.2, 1.7, 6.7, 7.2, 7.7, 8.2], bpm: 120, duration: 9 };
    const durations = beatDurations(8, analysis, 1);
    expect(Math.max(...durations)).toBeLessThanOrEqual(0.5 * 1.5 + 1 / 30);
  });

  it('detects a track that ends in five seconds of silence and times pages without a huge one', () => {
    const track = new Float32Array(RATE * 12);
    track.set(clicks(120, 7, 0.2));
    const analysis = detectBeats(track);
    expect(analysis.duration).toBe(12);
    const durations = beatDurations(12, analysis, 4);
    expect(Math.max(...durations)).toBeLessThanOrEqual(60 / analysis.bpm * 4 * 1.5 + 1 / 15);
  });

  it('rejects invalid or out-of-order beats and unsupported pacing', () => {
    expect(() => beatDurations(2, analysis, 3)).toThrow(/timing/);
    expect(() => beatDurations(2, { ...analysis, beats: [1, 0] }, 1)).toThrow(/timing/);
    expect(() => beatDurations(2, { ...analysis, beats: [0, NaN] }, 1)).toThrow(/timing/);
  });

  it('persists beat settings and opens older projects with beat sync off', () => {
    const story = emptyStory();
    story.video.syncToBeats = true;
    story.video.beatsPerPage = 2;
    expect(deserializeStory(serializeStory(story)).video).toMatchObject({ syncToBeats: true, beatsPerPage: 2 });
    const legacy = JSON.parse(serializeStory(story));
    delete legacy.video.syncToBeats; delete legacy.video.beatsPerPage;
    expect(deserializeStory(JSON.stringify(legacy)).video).toMatchObject({ syncToBeats: false, beatsPerPage: 4 });
    legacy.video.beatsPerPage = 3;
    expect(deserializeStory(JSON.stringify(legacy)).video.beatsPerPage).toBe(4);
  });
});
