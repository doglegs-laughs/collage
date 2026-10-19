// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyPage, defaultPhotoEl, emptyStory, type Story } from '../src/story/model';
import { videoCacheSpec } from '../src/story/videoCache';
import { videoPlan } from '../src/story/exportStory';

const require = createRequire(import.meta.url);
const { computeKey, planEviction, createVideoCache, stableStringify, VIDEO_PIPELINE_VERSION } = require('../electron/video-cache.cjs');
type PhotoEl = ReturnType<typeof defaultPhotoEl>;

let dir: string;
let audio: string;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'video-cache-'));
  audio = path.join(dir, 'music.wav');
  fs.writeFileSync(audio, 'abcdef');
  fs.utimesSync(audio, 1_700_000_000, 1_700_000_000);
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const story = (): Story => {
  const s = emptyStory();
  s.photos = [{ id: 'p1', name: 'p1.jpg', width: 400, height: 300 }];
  s.pages = [{ ...emptyPage(), elements: [defaultPhotoEl({ photoId: 'p1' })] }, { ...emptyPage('#ff0000'), duration: 4 }];
  s.video = { ...s.video, audioPath: audio };
  return s;
};
const specOf = (s: Story, width = 1080) => videoCacheSpec(s, width, videoPlan(s, { pageSeconds: 3 }));
const keyOf = (s: Story, encoder = 'libx264', width = 1080) => computeKey(specOf(s, width), encoder) as Promise<string | null>;

describe('video cache key', () => {
  it('is a stable SHA-256 for the same inputs', async () => {
    const a = await keyOf(story());
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await keyOf(story())).toBe(a);
  });
  it('changes when a crop, a duration, the width or the transition changes', async () => {
    const base = await keyOf(story());
    const crop = story(); (crop.pages[0].elements[0] as PhotoEl).crop = { zoom: 1.5, cx: 0.5, cy: 0.5 };
    expect(await keyOf(crop)).not.toBe(base);
    const dur = story(); dur.pages[1].duration = 5;
    expect(await keyOf(dur)).not.toBe(base);
    const bg = story(); bg.pages[1].background = '#00ff00';
    expect(await keyOf(bg)).not.toBe(base);
    expect(await keyOf(story(), 'libx264', 720)).not.toBe(base);
    const tr = story(); tr.video.transition = 'none';
    expect(await keyOf(tr)).not.toBe(base);
    const kb = story(); kb.video.kenBurns = !kb.video.kenBurns;
    expect(await keyOf(kb)).not.toBe(base);
  });
  it('changes with the encoder, the pipeline version and the music file', async () => {
    const base = await keyOf(story());
    expect(await keyOf(story(), 'h264_videotoolbox')).not.toBe(base);
    expect(await computeKey(specOf(story()), 'libx264', VIDEO_PIPELINE_VERSION + 1)).not.toBe(base);
    fs.utimesSync(audio, 1_700_000_100, 1_700_000_100);
    const touched = await keyOf(story());
    expect(touched).not.toBe(base);
    fs.writeFileSync(audio, 'abcdefg');
    fs.utimesSync(audio, 1_700_000_100, 1_700_000_100);
    expect(await keyOf(story())).not.toBe(touched);
    fs.writeFileSync(audio, 'abcdef');
    fs.utimesSync(audio, 1_700_000_000, 1_700_000_000);
    expect(await keyOf(story())).toBe(base);
  });
  it('changes with a photo file on disk and is null when the music is missing', async () => {
    const photo = path.join(dir, 'photo.jpg');
    fs.writeFileSync(photo, 'one');
    const withPath = () => { const s = story(); s.photos[0].path = photo; return s; };
    const a = await keyOf(withPath());
    fs.writeFileSync(photo, 'longer');
    expect(await keyOf(withPath())).not.toBe(a);
    const gone = story(); gone.video.audioPath = path.join(dir, 'nope.wav');
    expect(await keyOf(gone)).toBeNull();
  });
  it('serializes objects independent of key order', () => {
    expect(stableStringify({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(stableStringify({ a: [2, { c: 2, d: 1 }], b: 1 }));
  });
});

describe('planEviction', () => {
  const e = (key: string, size: number, used: number) => ({ key, size, used });
  it('drops the least recently used beyond the file limit', () => {
    expect(planEviction([e('a', 1, 1), e('b', 1, 2), e('c', 1, 3), e('d', 1, 4)], { maxFiles: 3, maxBytes: 100 })).toEqual(['a']);
  });
  it('drops until the byte total fits', () => {
    expect(planEviction([e('a', 60, 1), e('b', 60, 2), e('c', 60, 3)], { maxFiles: 9, maxBytes: 130 })).toEqual(['a']);
  });
  it('never drops the entry just stored', () => {
    expect(planEviction([e('new', 90, 1), e('x', 5, 9)], { maxFiles: 1, maxBytes: 100 }, 'new')).toEqual(['x']);
  });
});

describe('video cache files', () => {
  const key = (n: number) => String(n).repeat(64);
  const source = (name: string, text: string) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, text);
    return f;
  };
  const pause = () => new Promise((r) => setTimeout(r, 20));
  it('stores, finds, copies and evicts least recently used', async () => {
    const cache = createVideoCache(path.join(dir, 'cache'), { maxFiles: 2, maxBytes: 1000 });
    expect(await cache.find(key(1))).toBeNull();
    expect(await cache.store(key(1), source('v1.mp4', 'video one'))).toBe(true);
    await pause();
    expect(await cache.store(key(2), source('v2.mp4', 'video two'))).toBe(true);
    await pause();
    const hit = await cache.find(key(1)); // 1 is now more recent than 2
    expect(hit && fs.readFileSync(hit, 'utf8')).toBe('video one');
    await pause();
    expect(await cache.store(key(3), source('v3.mp4', 'video three'))).toBe(true);
    expect(await cache.find(key(2))).toBeNull();
    expect(await cache.find(key(1))).not.toBeNull();
    const kept = await cache.find(key(3));
    expect(kept).not.toBeNull();

    const out = path.join(dir, 'copy.mp4');
    await cache.copyTo(kept, out);
    expect(fs.readFileSync(out, 'utf8')).toBe('video three');
    expect(fs.statSync(out).ino).not.toBe(fs.statSync(kept).ino);
    expect(fs.readdirSync(dir).filter((n) => n.endsWith('.tmp'))).toEqual([]);
  });
  it('treats a cached file changed in place as a miss', async () => {
    const cache = createVideoCache(path.join(dir, 'cache2'));
    const src = source('v4.mp4', 'original');
    await cache.store(key(4), src);
    expect(await cache.find(key(4))).not.toBeNull();
    fs.appendFileSync(src, ' edited'); // the cached file may share the inode with the user's copy
    expect(await cache.find(key(4))).toBeNull();
  });
  it('skips files larger than the byte limit and bad keys', async () => {
    const cache = createVideoCache(path.join(dir, 'cache3'), { maxFiles: 3, maxBytes: 5 });
    expect(await cache.store(key(5), source('v5.mp4', 'too large'))).toBe(false);
    expect(await cache.find('../etc/passwd')).toBeNull();
  });
});
