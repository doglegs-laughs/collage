// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const video = require('../electron/video.cjs');
const { ffmpegPath } = require('../electron/ffmpeg-path.cjs');

const FFMPEG = ffmpegPath();
const hasFfmpeg = spawnSync(FFMPEG, ['-version']).status === 0;
const FFPROBE = fs.existsSync('/usr/bin/ffprobe') ? '/usr/bin/ffprobe' : 'ffprobe';

let dir: string;
let frames: Uint8Array[];
let audio: string;

function jpeg(color: string, w = 320, h = 400): Uint8Array {
  const out = execFileSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', `color=c=${color}:s=${w}x${h}`, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', '-'], { maxBuffer: 1 << 24 });
  return new Uint8Array(out);
}
function probe(file: string) {
  const j = JSON.parse(execFileSync(FFPROBE, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]).toString());
  return { duration: Number(j.format.duration), codecs: j.streams.map((s: any) => s.codec_name) as string[], streams: j.streams };
}
const base = () => ({ frames, durations: [1.5, 1.5, 1.5], transition: 'crossfade' as const, transitionSeconds: 0.5, kenBurns: true, fps: 24 });

describe('ffmpeg-path', () => {
  it('resolves outside electron', () => {
    expect(typeof FFMPEG).toBe('string');
    expect(hasFfmpeg).toBe(true);
  });
});

describe('video', () => {
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vidtest-'));
    frames = [jpeg('red'), jpeg('green'), jpeg('blue')];
    audio = path.join(dir, 'a.wav');
    execFileSync(FFMPEG, ['-v', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', audio]);
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('probes jpeg size', () => {
    expect(video.probeJpegSize(Buffer.from(frames[0]))).toEqual({ width: 320, height: 400 });
  });

  it('builds crossfade args with accumulated offsets', () => {
    const args: string[] = video.buildArgs({ ...base(), audioPath: audio }, { width: 320, height: 400 }, { frames: ['a', 'b', 'c'], output: 'o.mp4' });
    const fc = args[args.indexOf('-filter_complex') + 1];
    expect(fc).toContain('offset=1.5');
    expect(fc).toContain('offset=3');
    expect(fc).toContain('zoompan');
    expect(args).toContain('-stream_loop');
  });

  it('makes crossfade + kenBurns + looped audio video', async () => {
    const out = path.join(dir, 'x.mp4');
    const prog: number[] = [];
    const r = await video.makeVideo({ ...base(), audioPath: audio, output: out }, (f: number) => prog.push(f));
    expect(r).toBe(out);
    expect(fs.existsSync(out)).toBe(true);
    const p = probe(out);
    expect(Math.abs(p.duration - 4.5)).toBeLessThan(0.15);
    expect(p.codecs).toContain('h264');
    expect(p.codecs).toContain('aac');
    expect(Math.max(...prog)).toBeGreaterThanOrEqual(0.95);
    for (let i = 1; i < prog.length; i++) expect(prog[i]).toBeGreaterThanOrEqual(prog[i - 1]);
    expect(fs.readdirSync(dir).filter((f) => f.includes('partial'))).toEqual([]);
  }, 60000);

  it('makes transition none without audio', async () => {
    const out = path.join(dir, 'n.mp4');
    await video.makeVideo({ ...base(), transition: 'none', kenBurns: false, durations: [1, 1, 1], output: out }, () => {});
    const p = probe(out);
    expect(Math.abs(p.duration - 3)).toBeLessThan(0.15);
    expect(p.codecs).toEqual(['h264']);
  }, 60000);

  it('handles mixed slide/crossfade/none boundaries', async () => {
    const out = path.join(dir, 'm.mp4');
    const fr = [jpeg('red'), jpeg('green'), jpeg('blue'), jpeg('yellow')];
    await video.makeVideo({
      ...base(), frames: fr, durations: [1, 1, 1, 1], transitions: ['slide', 'crossfade', 'none'],
      kenBurnsPages: [false, false, true, true], output: out,
    }, () => {});
    expect(Math.abs(probe(out).duration - 4)).toBeLessThan(0.15);
  }, 60000);

  it('concat followed by xfade keeps timebases compatible', async () => {
    expect(video.buildArgs({ ...base(), transitions: ['none', 'crossfade'] }, { width: 320, height: 400 }, { frames: ['a', 'b', 'c'], output: 'o.mp4' })
      .join(' ')).toContain('concat=n=2:v=1:a=0,settb=1/24');
    const fr = [jpeg('red'), jpeg('green'), jpeg('blue'), jpeg('yellow')];
    for (const transitions of [['none', 'slide', 'none'], ['crossfade', 'none', 'slide']]) {
      const out = path.join(dir, `tb-${transitions.join('-')}.mp4`);
      await video.makeVideo({ ...base(), frames: fr, durations: [1, 1, 1, 1], transitions, kenBurns: false, output: out }, () => {});
      expect(Math.abs(probe(out).duration - 4)).toBeLessThan(0.15);
    }
  }, 120000);

  it('cancel() resolves after cleanup', async () => {
    expect(await video.cancel()).toBeUndefined();
    const out = path.join(dir, 'cc.mp4');
    let started: () => void;
    const gotProgress = new Promise<void>((r) => (started = r));
    const p = video.makeVideo({ ...base(), durations: [20, 20, 20], output: out }, () => started());
    const settled = p.then(() => null, (e: Error) => e);
    await Promise.race([gotProgress, new Promise((r) => setTimeout(r, 15000))]);
    expect(video.isRunning()).toBe(true);
    await video.cancel();
    expect(video.isRunning()).toBe(false);
    expect(fs.readdirSync(dir).filter((f) => f.includes('partial'))).toEqual([]);
    expect((await settled).name).toBe('AbortError');
  }, 60000);

  it('rejects bad per-boundary arrays', async () => {
    const out = path.join(dir, 'b.mp4');
    await expect(video.makeVideo({ ...base(), transitions: ['slide'], output: out }, () => {})).rejects.toThrow(/transitions/);
    await expect(video.makeVideo({ ...base(), kenBurnsPages: [true], output: out }, () => {})).rejects.toThrow(/kenBurnsPages/);
  });

  it('cancels mid-way and cleans up', async () => {
    const out = path.join(dir, 'c.mp4');
    let started: () => void;
    const gotProgress = new Promise<void>((r) => (started = r));
    const job = { ...base(), durations: [20, 20, 20], output: out };
    const p = video.makeVideo(job, () => started());
    const settled = p.then(() => null, (e: Error) => e);
    await Promise.race([gotProgress, new Promise((r) => setTimeout(r, 15000))]);
    await expect(video.makeVideo(job, () => {})).rejects.toThrow(/already running/);
    video.cancel();
    const err = await settled;
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('AbortError');
    expect(fs.existsSync(out)).toBe(false);
    expect(fs.readdirSync(dir).filter((f) => f.includes('partial'))).toEqual([]);
    // can run again afterwards
    await video.makeVideo({ ...base(), transition: 'none', kenBurns: false, durations: [1, 1, 1], output: path.join(dir, 'after.mp4') }, () => {});
  }, 60000);

  it('validates jobs', async () => {
    const out = path.join(dir, 'v.mp4');
    const bad = (o: object) => video.makeVideo({ ...base(), output: out, ...o }, () => {});
    await expect(bad({ frames: [] , durations: []})).rejects.toThrow(/frame/i);
    await expect(bad({ durations: [1, 1] })).rejects.toThrow(/match/i);
    await expect(bad({ durations: [1, 0, 1] })).rejects.toThrow(/duration/i);
    await expect(bad({ durations: [1, 1, 1], transitionSeconds: 1 })).rejects.toThrow(/transitionSeconds/);
    await expect(bad({ fps: 10 })).rejects.toThrow(/fps/);
    await expect(bad({ fps: 120 })).rejects.toThrow(/fps/);
    expect(fs.existsSync(out)).toBe(false);
  });
});
