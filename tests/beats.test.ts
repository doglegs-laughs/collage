import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BeatAnalysis } from '../src/api';
import { beatDurations } from '../src/story/beatTiming';
import { deserializeStory, emptyStory, serializeStory } from '../src/story/model';

const { detectBeats, analyzeAudio } = createRequire(import.meta.url)('../electron/beats.cjs') as {
  detectBeats(samples: Float32Array, sampleRate?: number): BeatAnalysis;
  analyzeAudio(file: string): Promise<BeatAnalysis>;
};
const RATE = 11025;

function clicks(bpm: number, duration = 12, offset = 0.2): Float32Array {
  const samples = new Float32Array(RATE * duration);
  for (let t = offset, beat = 0; t < duration; t += 60 / bpm, beat++) {
    const level = beat % 4 === 0 ? 0.9 : 0.65;
    for (let i = 0; i < RATE * 0.07; i++) {
      const at = Math.floor(t * RATE) + i;
      if (at < samples.length) samples[at] += level * Math.sin(2 * Math.PI * 90 * i / RATE) * Math.exp(-i / (RATE * 0.015));
    }
  }
  return samples;
}

function wav(samples: Float32Array): Buffer {
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(RATE, 24); out.writeUInt32LE(RATE * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => out.writeInt16LE(Math.round(s * 32767), 44 + i * 2));
  return out;
}

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

  it('keeps the first beat when music starts on a beat', () => {
    const result = detectBeats(clicks(120, 6, 0));
    expect(result.beats[0]).toBe(0);
    expect(result.beats).toHaveLength(12);
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
