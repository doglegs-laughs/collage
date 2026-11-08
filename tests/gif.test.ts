// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findFfprobe } from './helpers/wav';

const require = createRequire(import.meta.url);
const gif = require('../electron/gif.cjs');
const { ffmpegPath } = require('../electron/ffmpeg-path.cjs');

const FFMPEG = ffmpegPath();
const hasFfmpeg = spawnSync(FFMPEG, ['-version']).status === 0;
const FFPROBE = findFfprobe() ?? 'ffprobe';
const hasFfprobe = spawnSync(FFPROBE, ['-version']).status === 0;

function jpeg(color: string, w = 64, h = 48): Uint8Array {
  const out = execFileSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}`, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', '-'], { maxBuffer: 1 << 24 });
  return new Uint8Array(out);
}

describe('gif validate', () => {
  const ok = () => ({ output: '/tmp/x.gif', loop: 'forever', frames: [new Uint8Array([1]), new Uint8Array([2])], durations: [0.5, 0.5] });
  it('accepts a sane job', () => {
    expect(() => gif.validate(ok())).not.toThrow();
  });
  it('rejects bad jobs', () => {
    expect(() => gif.validate(null)).toThrow();
    expect(() => gif.validate({ ...ok(), output: '' })).toThrow(/output/);
    expect(() => gif.validate({ ...ok(), loop: 'twice' })).toThrow(/loop/);
    expect(() => gif.validate({ ...ok(), frames: [new Uint8Array([1])], durations: [1] })).toThrow(/frames/);
    expect(() => gif.validate({ ...ok(), frames: Array.from({ length: 301 }, () => new Uint8Array([1])), durations: Array(301).fill(0.1) })).toThrow(/frames/);
    expect(() => gif.validate({ ...ok(), durations: [0.5] })).toThrow(/match/);
    for (const d of [0.01, 11, NaN, Infinity, -1]) expect(() => gif.validate({ ...ok(), durations: [0.5, d] })).toThrow(/seconds/);
    expect(() => gif.validate({ ...ok(), frames: [new Uint8Array([1]), new Uint8Array(0)] })).toThrow(/non-empty/);
  });
});

describe('gif args', () => {
  const paths = { list: '/t/frames.txt', palette: '/t/palette.png', output: '/t/out/animation.gif' };
  it('rounds delays to centiseconds, never under 2', () => {
    expect([gif.centis(0.5), gif.centis(0.123), gif.centis(0.001)]).toEqual([50, 12, 2]);
  });
  it('lists frames with grid-scaled durations and no duration on the last', () => {
    expect(gif.concatList(['a.jpg', 'b.jpg', 'c.jpg'], [0.5, 0.123, 1])).toBe(
      "ffconcat version 1.0\nfile 'a.jpg'\nduration 2.00\nfile 'b.jpg'\nduration 0.48\nfile 'c.jpg'\n",
    );
  });
  it('builds a palette pass that only reads local files', () => {
    const args: string[] = gif.paletteArgs(paths);
    expect(args).toContain('palettegen=stats_mode=diff');
    expect(args[args.indexOf('-protocol_whitelist') + 1]).toBe('file,pipe');
    expect(args).toContain(paths.palette);
  });
  it('builds the encode pass with sierra dithering, the right loop flag and the last delay', () => {
    const job = { loop: 'forever', durations: [0.5, 0.5, 0.3] };
    const forever: string[] = gif.encodeArgs(job, paths);
    expect(forever.join(' ')).toContain('paletteuse=dither=sierra2_4a');
    expect(forever[forever.indexOf('-loop') + 1]).toBe('0');
    expect(forever[forever.indexOf('-final_delay') + 1]).toBe('30');
    expect(forever.filter((a) => a === '-protocol_whitelist')).toHaveLength(2);
    expect(forever.at(-1)).toBe(paths.output);
    const once: string[] = gif.encodeArgs({ ...job, loop: 'once' }, paths);
    expect(once[once.indexOf('-loop') + 1]).toBe('-1');
  });
});

describe.runIf(hasFfmpeg)('gif encode', () => {
  let dir: string;
  beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'giftest-')); });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
  const job = (output: string, loop: 'forever' | 'once') => ({ output, loop, frames: [jpeg('red'), jpeg('green'), jpeg('blue')], durations: [0.5, 0.2, 0.3] });

  it('writes a GIF with the right frames and delays, and no stray files', async () => {
    const out = path.join(dir, 'a.gif');
    const seen: number[] = [];
    const r = await gif.makeGif(job(out, 'forever'), (f: number) => seen.push(f));
    expect(r).toEqual({ path: out, bytes: fs.statSync(out).size });
    expect(fs.readFileSync(out).subarray(0, 6).toString('latin1')).toBe('GIF89a');
    expect(fs.readFileSync(out).includes('NETSCAPE2.0')).toBe(true);
    expect(seen.at(-1)).toBe(1);
    expect(fs.readdirSync(dir)).toEqual(['a.gif']);
    if (hasFfprobe) {
      // ffprobe 7 dropped pkt_duration_time in favour of duration_time.
      const j = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_frames', '-show_entries', 'frame=duration_time,pkt_duration_time,width,height', '-of', 'json', out]).toString());
      expect(j.frames).toHaveLength(3);
      expect(j.frames.map((f: any) => Math.round(Number(f.duration_time ?? f.pkt_duration_time) * 100))).toEqual([50, 20, 30]);
      expect([j.frames[0].width, j.frames[0].height]).toEqual([64, 48]);
    }
  });

  it('writes no loop block when played once', async () => {
    const out = path.join(dir, 'once.gif');
    await gif.makeGif(job(out, 'once'));
    expect(fs.readFileSync(out).includes('NETSCAPE2.0')).toBe(false);
  });

  it('rejects frames of different sizes', async () => {
    const bad = { ...job(path.join(dir, 'bad.gif'), 'forever'), frames: [jpeg('red'), jpeg('green', 32, 32)], durations: [0.5, 0.5] };
    await expect(gif.makeGif(bad)).rejects.toThrow(/same size/);
    expect(fs.existsSync(path.join(dir, 'bad.gif'))).toBe(false);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('.collage-gif-'))).toEqual([]);
  });

  it('cancels a running export and cleans up', async () => {
    const out = path.join(dir, 'c.gif');
    const running = gif.makeGif(job(out, 'forever'));
    const settled = running.then(() => 'done', (e: Error) => e.name);
    await gif.cancel();
    expect(['AbortError', 'done']).toContain(await settled);
    expect(gif.isRunning()).toBe(false);
    expect(fs.readdirSync(dir).filter((f) => f.startsWith('.collage-gif-'))).toEqual([]);
  });
});
