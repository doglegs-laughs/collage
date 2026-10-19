import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

export const RATE = 11025;

/** A short low-frequency thump starting at `time` seconds, added into `samples`. */
export function addClick(samples: Float32Array, time: number, level: number, rate = RATE) {
  for (let i = 0; i < rate * 0.07; i++) {
    const at = Math.floor(time * rate) + i;
    if (at < samples.length) samples[at] += level * Math.sin(2 * Math.PI * 90 * i / rate) * Math.exp(-i / (rate * 0.015));
  }
}

/** Click track with an accented downbeat every four beats. */
export function clicks(bpm: number, duration = 12, offset = 0.2, rate = RATE): Float32Array {
  const samples = new Float32Array(rate * duration);
  for (let t = offset, beat = 0; t < duration; t += 60 / bpm, beat++) addClick(samples, t, beat % 4 === 0 ? 0.9 : 0.65, rate);
  return samples;
}

/** 16-bit mono WAV file bytes. */
export function wav(samples: Float32Array, rate = RATE): Buffer {
  const out = Buffer.alloc(44 + samples.length * 2);
  out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((s, i) => out.writeInt16LE(Math.round(Math.max(-1, Math.min(1, s)) * 32767), 44 + i * 2));
  return out;
}

/** ffprobe location (system install first, then PATH), or null when there is none. */
export function findFfprobe(): string | null {
  if (fs.existsSync('/usr/bin/ffprobe')) return '/usr/bin/ffprobe';
  return spawnSync('ffprobe', ['-version']).status === 0 ? 'ffprobe' : null;
}
