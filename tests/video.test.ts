// @vitest-environment node
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findFfprobe } from './helpers/wav';

const require = createRequire(import.meta.url);
const video = require('../electron/video.cjs');
const { ffmpegPath } = require('../electron/ffmpeg-path.cjs');

const FFMPEG = ffmpegPath();
const hasFfmpeg = spawnSync(FFMPEG, ['-version']).status === 0;
const FFPROBE = findFfprobe() ?? 'ffprobe';

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

  it('picks encoder args: x264 veryfast by default, bitrate-scaled VideoToolbox on request', () => {
    const paths = { frames: ['a', 'b', 'c'], output: 'o.mp4' };
    const soft: string[] = video.buildArgs(base(), { width: 320, height: 400 }, paths);
    expect(soft.join(' ')).toContain('-c:v libx264 -preset veryfast -crf 20 -tune stillimage -threads 0');
    expect(soft.join(' ')).toContain('scale=480:600'); // 1.5x Ken Burns pre-upscale
    const hw: string[] = video.buildArgs(base(), { width: 1080, height: 1350 }, paths, 'h264_videotoolbox');
    expect(hw).toContain('h264_videotoolbox');
    expect(hw).not.toContain('libx264');
    expect(hw[hw.indexOf('-b:v') + 1]).toBe('9622800');
    expect(hw).toContain('-allow_sw');
    expect(video.encoderArgs('h264_videotoolbox', { width: 1080, height: 1350 }, 30)[3]).toBe('12028500');
  });

  it('uses libx264 off macOS', async () => {
    if (process.platform !== 'darwin') expect(await video.pickEncoder()).toBe('libx264');
  });

  // Runs on the macOS CI runner: proves the bundled ffmpeg's VideoToolbox path encodes without falling back.
  it.runIf(process.platform === 'darwin')('encodes with VideoToolbox on macOS', async () => {
    expect(await video.pickEncoder()).toBe('h264_videotoolbox');
    const out = path.join(dir, 'vt.mp4');
    const tried: string[] = [];
    await video.makeVideo({ ...base(), output: out }, () => {}, { onAttempt: (e: string) => tried.push(e) });
    expect(tried).toEqual(['h264_videotoolbox']);
    expect(probe(out).codecs).toContain('h264');
  }, 60000);

  it('retries once with libx264 when the first encoder fails', async () => {
    const out = path.join(dir, 'fallback.mp4');
    const tried: string[] = [];
    await video.makeVideo({ ...base(), kenBurns: false, durations: [1, 1, 1], output: out }, () => {}, { encoder: 'h264_nonexistent', onAttempt: (e: string) => tried.push(e) });
    expect(tried).toEqual(['h264_nonexistent', 'libx264']);
    expect(probe(out).codecs).toContain('h264');
    expect(fs.readdirSync(dir).filter((f) => f.includes('partial'))).toEqual([]);
    // a failing software encode is not retried
    const tried2: string[] = [];
    await expect(video.makeVideo({ ...base(), frames: [new Uint8Array([1, 2, 3])], durations: [1], output: path.join(dir, 'x2.mp4') }, () => {}, { onAttempt: (e: string) => tried2.push(e) })).rejects.toThrow();
    expect(tried2.length).toBeLessThanOrEqual(1);
  }, 60000);

  it('centres fades on the beat when beatSync is set, keeping the total length', () => {
    const args = (job: object): string => {
      const a: string[] = video.buildArgs(job, { width: 320, height: 400 }, { frames: ['a', 'b', 'c'], output: 'o.mp4' });
      return a[a.indexOf('-filter_complex') + 1];
    };
    const fc = args({ ...base(), kenBurns: false, beatSync: true });
    expect(fc).toContain('offset=1.25');
    expect(fc).toContain('offset=2.75');
    const per = args({ ...base(), kenBurns: false, beatSync: true, transitionDurations: [0.2, 1] });
    expect(per).toContain('duration=0.2:offset=1.4');
    expect(per).toContain('duration=1:offset=2.5');
    expect(args({ ...base(), kenBurns: false })).toContain('offset=1.5');
    const none = args({ ...base(), kenBurns: false, beatSync: true, transitions: ['none', 'slide'] });
    expect(none).toContain('concat=n=2');
    expect(none).toContain('xfade=transition=slideleft:duration=0.5:offset=2.75');
  });

  it('validates per-boundary fade lengths against the neighbouring pages', async () => {
    const bad = (extra: object) => video.makeVideo({ ...base(), output: path.join(dir, 'bad.mp4'), ...extra }, () => {});
    await expect(bad({ durations: [4, 0.5, 4], transitionDurations: [0.4, 0.5] })).rejects.toThrow(/shorter than both/);
    await expect(bad({ transitionDurations: [0.4] })).rejects.toThrow(/length/);
  });

  it('exports a centred beat-synced video with the exact total length and looped audio', async () => {
    const out = path.join(dir, 'beat.mp4');
    await video.makeVideo({ ...base(), durations: [1, 1.5, 1], transitionSeconds: 0.5, transitionDurations: [0.4, 0.5], kenBurns: false, beatSync: true, audioPath: audio, audioLoopSeconds: 1.2, output: out }, () => {});
    const p = probe(out);
    expect(Math.abs(p.duration - 3.5)).toBeLessThan(0.15);
    expect(p.codecs).toContain('aac');
    const pixel = (time: number) => execFileSync(FFMPEG, ['-v', 'error', '-ss', String(time), '-i', out, '-frames:v', '1', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
    expect(pixel(0.7)[0]).toBeGreaterThan(200); // still the first photo before the fade begins at 0.8
    const mid = pixel(1.0); // the beat itself: half way between red and green
    expect(mid[0]).toBeGreaterThan(80); expect(mid[0]).toBeLessThan(180);
    expect(mid[1]).toBeGreaterThan(60); expect(mid[1]).toBeLessThan(180);
    expect(pixel(1.4)[1]).toBeGreaterThan(100); expect(pixel(1.4)[0]).toBeLessThan(30);
  }, 60000);

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
