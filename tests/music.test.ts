import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { BuiltinTrack } from '../src/api';
import { isAudioFile, musicFromDrop } from '../src/core/audio';
import { deserializeStory, emptyPage, emptyStory, serializeStory } from '../src/story/model';
import { addRecentMusic, formatDuration, musicLabel, parseRecentMusic, removeRecentMusic, resolveBuiltinMusic, tracksByMood } from '../src/story/music';
import { patchVideo } from '../src/story/timeline';

const story = () => ({ ...emptyStory('1:1'), pages: [emptyPage('#ffffff')] });
const { readTrack, readManifest, loadBuiltinMusic } = createRequire(import.meta.url)('../electron/music.cjs');

const good = { id: 'sunny-day', file: 'sunny-day.m4a', title: 'Sunny Day', artist: 'Someone', mood: 'happy', durationSec: 95, bpm: 112, license: 'CC0', source: 'https://example.com/sunny' };
const track = (over: Partial<BuiltinTrack> = {}): BuiltinTrack => ({ ...good, mood: 'happy', path: '/app/music/sunny-day.m4a', ...over });

describe('built-in music manifest', () => {
  it('accepts a complete entry', () => {
    expect(readTrack(good)).toEqual(good);
  });

  it.each([
    ['unknown mood', { mood: 'angry' }],
    ['uppercase id', { id: 'Sunny' }],
    ['path in file', { file: '../secret.m4a' }],
    ['folder in file', { file: 'sub/a.m4a' }],
    ['non-audio file', { file: 'a.exe' }],
    ['empty title', { title: ' ' }],
    ['missing artist', { artist: undefined }],
    ['zero duration', { durationSec: 0 }],
    ['text bpm', { bpm: '120' }],
    ['missing license', { license: undefined }],
  ])('ignores an entry with %s', (_name, over) => {
    expect(readTrack({ ...good, ...over })).toBeNull();
  });

  it('keeps the good entries, drops bad ones and repeated ids, and survives junk', () => {
    expect(readManifest([good, null, 7, { ...good, id: 'bad id' }, { ...good, title: 'Copy' }, { ...good, id: 'other', file: 'other.m4a' }]).map((t: BuiltinTrack) => t.id)).toEqual(['sunny-day', 'other']);
    expect(readManifest({ tracks: [good] })).toEqual([]);
    expect(readManifest('nope')).toEqual([]);
  });

  it('lists only tracks whose file exists, with absolute paths', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-test-'));
    try {
      expect(await loadBuiltinMusic(dir)).toEqual([]); // no manifest
      fs.writeFileSync(path.join(dir, 'tracks.json'), JSON.stringify([good, { ...good, id: 'no-file', file: 'missing.m4a' }]));
      expect(await loadBuiltinMusic(dir)).toEqual([]); // audio file missing
      fs.writeFileSync(path.join(dir, 'sunny-day.m4a'), 'x');
      expect(await loadBuiltinMusic(dir)).toEqual([{ ...good, path: path.join(dir, 'sunny-day.m4a') }]);
      fs.writeFileSync(path.join(dir, 'tracks.json'), '{broken');
      expect(await loadBuiltinMusic(dir)).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('the shipped starter pack is valid and has the three moods', async () => {
    const tracks = await loadBuiltinMusic(path.join(import.meta.dirname, '..', 'resources', 'music'));
    expect(tracks.length).toBeGreaterThan(0);
    expect(new Set(tracks.map((t: BuiltinTrack) => t.mood))).toEqual(new Set(['upbeat', 'happy', 'nostalgic']));
  });
});

describe('built-in music in a story', () => {
  const withBuiltin = () => patchVideo(story(), { audioPath: '/old/app/music/sunny-day.m4a', audioBuiltin: 'sunny-day' });

  it('is saved by id and read back strictly', () => {
    expect(deserializeStory(serializeStory(withBuiltin())).video.audioBuiltin).toBe('sunny-day');
    for (const bad of ['Sunny Day', '../x', '', 7, null]) {
      const raw = JSON.parse(serializeStory(withBuiltin()));
      raw.video.audioBuiltin = bad;
      expect(deserializeStory(JSON.stringify(raw)).video.audioBuiltin).toBeUndefined();
    }
  });

  it('is looked up again by id, replacing the old app path', () => {
    const { story: resolved, missing } = resolveBuiltinMusic(withBuiltin(), [track({ path: '/new/app/music/sunny-day.m4a' })]);
    expect(missing).toBeUndefined();
    expect(resolved.video).toMatchObject({ audioPath: '/new/app/music/sunny-day.m4a', audioBuiltin: 'sunny-day' });
  });

  it('fills in the path when only the id was saved', () => {
    const s = story();
    s.video = { ...s.video, audioBuiltin: 'sunny-day' };
    expect(resolveBuiltinMusic(s, [track()]).story.video.audioPath).toBe('/app/music/sunny-day.m4a');
  });

  it('clears the music when the id is not in the manifest', () => {
    const s = patchVideo(withBuiltin(), { syncToBeats: true });
    const { story: resolved, missing } = resolveBuiltinMusic(s, [track({ id: 'other' })]);
    expect(missing).toBe('sunny-day');
    expect(resolved.video).toMatchObject({ audioPath: null, syncToBeats: false, fitToMusic: false });
    expect(resolved.video.audioBuiltin).toBeUndefined();
  });

  it('leaves stories with their own music alone', () => {
    const s = patchVideo(story(), { audioPath: '/home/me/song.mp3' });
    expect(resolveBuiltinMusic(s, [])).toEqual({ story: s });
  });

  it('forgets the built-in id when other music is chosen or the music is cleared', () => {
    expect(patchVideo(withBuiltin(), { audioPath: '/home/me/song.mp3' }).video.audioBuiltin).toBeUndefined();
    expect(patchVideo(withBuiltin(), { audioPath: null }).video.audioBuiltin).toBeUndefined();
    expect(patchVideo(withBuiltin(), { kenBurns: true }).video.audioBuiltin).toBe('sunny-day');
  });

  it('labels built-in music by title and other music by file name', () => {
    expect(musicLabel(withBuiltin().video, [track()])).toBe('Sunny Day');
    expect(musicLabel({ audioPath: 'C:\\Music\\My Song.mp3' }, [track()])).toBe('My Song.mp3');
    expect(musicLabel({ audioPath: null }, [track()])).toBeNull();
  });

  it('groups tracks by mood in a fixed order, skipping empty moods', () => {
    const groups = tracksByMood([track({ id: 'a', mood: 'nostalgic' }), track({ id: 'b', mood: 'upbeat' }), track({ id: 'c', mood: 'upbeat' })]);
    expect(groups.map((g) => [g.label, g.tracks.map((t) => t.id)])).toEqual([['Upbeat', ['b', 'c']], ['Nostalgic', ['a']]]);
  });

  it('formats durations', () => {
    expect([formatDuration(9), formatDuration(75), formatDuration(600)]).toEqual(['0:09', '1:15', '10:00']);
  });
});

describe('recent music list', () => {
  it('puts the newest first, moves repeats up, and keeps eight', () => {
    expect(addRecentMusic(['/a', '/b'], '/b')).toEqual(['/b', '/a']);
    const many = Array.from({ length: 8 }, (_, i) => `/m${i}`);
    const next = addRecentMusic(many, '/new');
    expect(next).toHaveLength(8);
    expect(next[0]).toBe('/new');
    expect(next).not.toContain('/m7');
  });

  it('removes an entry', () => {
    expect(removeRecentMusic(['/a', '/b'], '/a')).toEqual(['/b']);
  });

  it('reads stored data defensively', () => {
    expect(parseRecentMusic(null)).toEqual([]);
    expect(parseRecentMusic('{oops')).toEqual([]);
    expect(parseRecentMusic('{"a":1}')).toEqual([]);
    expect(parseRecentMusic(JSON.stringify(['/a', 3, '', '/a', '/b']))).toEqual(['/a', '/b']);
  });
});

describe('dropped music', () => {
  it('recognises the audio types the music dialog offers', () => {
    expect(['a.MP3', 'b.m4a', 'c.aac', 'd.wav', 'e.aiff', 'f.flac', 'g.ogg'].every((name) => isAudioFile({ name }))).toBe(true);
    expect(['a.jpg', 'notes.txt', 'mp3'].some((name) => isAudioFile({ name }))).toBe(false);
  });

  it('uses the first audio file with its real path', () => {
    const files = [{ name: 'photo.jpg' }, { name: 'Party.mp3' }, { name: 'other.wav' }];
    expect(musicFromDrop(files, (f) => `/Users/me/Music/${f.name}`)).toEqual({ path: '/Users/me/Music/Party.mp3', name: 'Party.mp3' });
  });

  it('is an error when the file has no real path, and nothing when there is no audio', () => {
    expect(musicFromDrop([{ name: 'Party.mp3' }], () => '')).toEqual({ error: expect.stringContaining('Party.mp3') });
    expect(musicFromDrop([{ name: 'photo.jpg' }], () => '/x')).toBeNull();
  });
});
