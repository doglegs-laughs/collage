import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import type { BeatAnalysis } from '../src/api';
import { beatClock, beatDurations, beatLoopSeconds } from '../src/story/beatTiming';
import { videoDurations, videoPlan, videoTransitions } from '../src/story/exportStory';
import { deserializeStory, emptyPage, emptyStory, normalizeTimeline, removePage, serializeStory, type Story } from '../src/story/model';
import { clipAtTime, computeTimeline, editTimeline, fitToMusicApplies, lockClip, musicLoopSeconds, patchVideo, resetTimeline, resyncFrom, setAudioOffset, setBoundaryTransition, snapToFrames, timelineOptions, unlockClip } from '../src/story/timeline';
import { videoCacheSpec } from '../src/story/videoCache';
import { clicks, RATE } from './helpers/wav';

const require = createRequire(import.meta.url);
const { detectBeats, computePeaks } = require('../electron/beats.cjs') as {
  detectBeats(samples: Float32Array): BeatAnalysis;
  computePeaks(samples: Float32Array, buckets?: number): number[];
};

const make = (n = 4, transition: 'none' | 'crossfade' = 'crossfade'): Story => {
  const s = emptyStory('1:1');
  s.pages = Array.from({ length: n }, () => emptyPage());
  s.video = { ...s.video, transition, audioPath: '/music.wav' };
  return s;
};
// 120 BPM: a beat every 0.5 s starting at 0.2 s, 8 s long.
const analysis: BeatAnalysis = { beats: Array.from({ length: 16 }, (_, i) => 0.2 + i * 0.5), bpm: 120, duration: 8 };
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
const durations = (s: Story, o = {}) => computeTimeline(s, o).clips.map((c) => c.duration);

describe('computeTimeline', () => {
  it('without a timeline matches the existing page durations and beat durations', () => {
    const s = make();
    s.pages[1].duration = 5;
    expect(durations(s)).toEqual(videoDurations(s, 3));
    expect(durations(s, { pageSeconds: 4 })).toEqual(videoDurations(s, 4));
    expect(durations(s, { analysis, beatsPerPage: 2 })).toEqual(beatDurations(4, analysis, 2));
    expect(computeTimeline(s).total).toBeCloseTo(sum(videoDurations(s, 3)));
  });

  it('keeps locked clips and lays unlocked ones end to end', () => {
    let s = make();
    s = lockClip(s, s.pages[1].id, 6);
    const tl = computeTimeline(s);
    expect(tl.clips.map((c) => c.duration)).toEqual([3, 6, 3, 3]);
    expect(tl.clips.map((c) => c.start)).toEqual([0, 3, 9, 12]);
    expect(tl.clips.map((c) => c.locked)).toEqual([false, true, false, false]);
    expect(tl.total).toBe(15);
  });

  it('clamps locked lengths to 0.2-60 s', () => {
    let s = make(2);
    s = lockClip(s, s.pages[0].id, 0.01);
    s = lockClip(s, s.pages[1].id, 500);
    expect(durations(s)).toEqual([0.2, 60]);
  });

  it('skips hidden pages', () => {
    const s = make(3);
    s.pages[1].hidden = true;
    const tl = computeTimeline(lockClip(s, s.pages[1].id, 9));
    expect(tl.clips.map((c) => c.pageId)).toEqual([s.pages[0].id, s.pages[2].id]);
    expect(tl.total).toBe(6);
  });

  it('beat sync: an unlocked clip after a locked one ends on a beat', () => {
    let s = make();
    const base = durations(s, { analysis, beatsPerPage: 2 });
    s = lockClip(s, s.pages[0].id, 1.7); // ends exactly on the beat at 1.7 s
    const tl = computeTimeline(s, { analysis, beatsPerPage: 2 });
    expect(tl.clips[0].duration).toBe(1.7);
    expect(tl.clips[1].duration).toBeCloseTo(1, 1); // two beats from 1.7 s
    const ends = tl.clips.map((c) => c.start + c.duration);
    for (const end of ends.slice(1)) expect(analysis.beats.some((b) => Math.abs(b - end) <= 1 / 60 + 1e-9)).toBe(true);
    expect(base[0]).toBeCloseTo(1.2, 1);
  });

  it('shifts beats by the audio offset and ignores beats before it', () => {
    let s = make(3);
    s = setAudioOffset(s, 0.7); // video starts on the second beat
    const tl = computeTimeline(s, { analysis, beatsPerPage: 2 });
    expect(tl.clips.map((c) => c.duration)).toEqual([1, 1, 1]);
    const clock = beatClock(analysis, 2, 0.7);
    expect(clock.at(0)).toBeCloseTo(0);
    expect(clock.upTo(1.1).map((b) => Math.round(b.time * 100) / 100)).toEqual([0, 0.5, 1]);
    // An offset between beats starts the first page at the next beat: lead-in plus two beats.
    const mid = computeTimeline(setAudioOffset(make(2), 1), { analysis, beatsPerPage: 2 });
    expect(mid.clips[0].duration).toBeCloseTo(0.2 + 1, 1);
  });

  it('wraps around when the offset passes the end of a repeating track', () => {
    const clock = beatClock(analysis, 4, 9);
    expect(clock.at(0)).toBeGreaterThanOrEqual(0);
    expect(clock.at(0)).toBeLessThan(0.6);
    expect(clock.at(1) - clock.at(0)).toBeCloseTo(0.5, 2);
  });

  it('re-sync from here unlocks that page and the ones after it', () => {
    let s = make(4);
    for (const p of s.pages) s = lockClip(s, p.id, 2);
    s = resyncFrom(s, s.pages[2].id);
    expect(Object.keys(s.video.timeline!.locked)).toEqual([s.pages[0].id, s.pages[1].id]);
    expect(durations(s)).toEqual([2, 2, 3, 3]);
    s = unlockClip(resyncFrom(s, s.pages[1].id), s.pages[0].id);
    expect(s.video.timeline).toBeUndefined(); // nothing left to remember
  });

  it('transition overrides apply after the page they belong to; defaults are kept elsewhere', () => {
    let s = make(4);
    s = setBoundaryTransition(s, s.pages[1].id, 'slide');
    s = setBoundaryTransition(s, s.pages[0].id, 'none');
    const tl = computeTimeline(s);
    expect(tl.boundaries.map((b) => b.transition)).toEqual(['none', 'slide', 'crossfade']);
    expect(tl.boundaries.map((b) => b.overridden)).toEqual([true, true, false]);
    expect(tl.boundaries.map((b) => b.afterPageId)).toEqual(s.pages.slice(0, 3).map((p) => p.id));
    // Setting the default again removes the override.
    s = setBoundaryTransition(s, s.pages[1].id, 'crossfade', 'crossfade');
    expect(s.video.timeline!.transitions[s.pages[1].id]).toBeUndefined();
  });

  it('defaults to cuts with beat sync and no transition, and fades are capped by short neighbours', () => {
    expect(computeTimeline(make(3, 'none'), { analysis }).boundaries.map((b) => b.transition)).toEqual(['none', 'none']);
    let c = make(3);
    c = lockClip(c, c.pages[1].id, 0.5);
    expect(computeTimeline(c).boundaries.map((b) => b.seconds)).toEqual([0.4, 0.4]);
  });

  it('clipAtTime finds the playing clip', () => {
    const tl = computeTimeline(make(3));
    expect([0, 2.99, 3, 8.9, 9, 20].map((t) => clipAtTime(tl, t))).toEqual([0, 0, 1, 2, 2, 2]);
  });
});

describe('export uses the timeline', () => {
  it('video plan durations, transitions and total equal the timeline', () => {
    let s = make(4);
    s = lockClip(s, s.pages[1].id, 5.5);
    s = setBoundaryTransition(s, s.pages[2].id, 'none');
    s = setAudioOffset(s, 1.25);
    const tl = computeTimeline(s);
    const plan = videoPlan(s, { pageSeconds: 3 });
    expect(plan.durations).toEqual(tl.clips.map((c) => c.duration));
    expect(sum(plan.durations)).toBeCloseTo(tl.total, 9);
    expect(plan.transitions).toEqual(['crossfade', 'crossfade', 'none']);
    expect(plan.audioStartSeconds).toBe(1.25);
    expect(plan.beatSync).toBeUndefined();
  });

  it('beat-synced export with a timeline: total equals the timeline total', () => {
    let s = make(4, 'none');
    s = setAudioOffset(lockClip(s, s.pages[0].id, 1.7), 0.2);
    const beatSync = { analysis, beatsPerPage: 2 as const };
    const plan = videoPlan(s, { pageSeconds: 3, beatSync });
    const tl = computeTimeline(s, { analysis, beatsPerPage: 2 });
    expect(plan.durations).toEqual(tl.clips.map((c) => c.duration));
    expect(sum(plan.durations)).toBeCloseTo(tl.total, 9);
    expect(plan.beatSync).toBe(true);
    expect(plan.audioStartSeconds).toBe(0.2);
  });

  it('without a timeline the plan is the old one', () => {
    const s = make(3);
    const plan = videoPlan(s, { pageSeconds: 3 });
    expect(plan.durations).toEqual(videoDurations(s, 3));
    expect(plan.transitions).toEqual(videoTransitions(s).transitions);
    expect('audioStartSeconds' in plan).toBe(false);
  });

  it('the video cache key changes with the timeline and the audio start', () => {
    const base = make(3);
    const key = (s: Story) => JSON.stringify(videoCacheSpec(s, 720, videoPlan(s, { pageSeconds: 3 })));
    const a = key(base);
    const b = key(lockClip(base, base.pages[0].id, 4));
    const c = key(setAudioOffset(base, 2));
    const d = key(setAudioOffset(base, 3));
    expect(new Set([a, b, c, d]).size).toBe(4);
    expect(c).toContain('"audioStartSeconds":2');
  });
});

describe('timeline serialization', () => {
  it('round-trips', () => {
    let s = make(3);
    s = setAudioOffset(lockClip(setBoundaryTransition(s, s.pages[0].id, 'slide'), s.pages[1].id, 4.5), 1.5);
    const back = deserializeStory(serializeStory(s));
    expect(back.video.timeline).toEqual(s.video.timeline);
  });

  it('is absent when the story has none', () => {
    expect('timeline' in deserializeStory(serializeStory(make(2))).video).toBe(false);
  });

  it('clamps, drops unknown pages and bad values', () => {
    const s = make(2);
    const json = JSON.parse(serializeStory(s));
    json.video.timeline = {
      audioOffset: -4,
      locked: { [s.pages[0].id]: 0.01, [s.pages[1].id]: 900, gone: 3, bad: 'x' },
      transitions: { [s.pages[0].id]: 'spin', [s.pages[1].id]: 'slide', gone: 'none' },
    };
    const t = deserializeStory(JSON.stringify(json)).video.timeline!;
    expect(t.audioOffset).toBe(0);
    expect(t.locked).toEqual({ [s.pages[0].id]: 0.2, [s.pages[1].id]: 60 });
    expect(t.transitions).toEqual({ [s.pages[1].id]: 'slide' });
    json.video.timeline = 'nope';
    expect(deserializeStory(JSON.stringify(json)).video.timeline).toBeUndefined();
  });

  it('editTimeline prunes an empty timeline', () => {
    expect(editTimeline(make(1), (t) => t).video.timeline).toBeUndefined();
  });
});

describe('waveform peaks', () => {
  it('detectBeats returns normalized peaks', () => {
    const result = detectBeats(clicks(120, 8, 0.2));
    const peaks = result.peaks!;
    expect(peaks.length).toBe(400); // 50 per second
    expect(Math.max(...peaks)).toBe(1);
    expect(Math.min(...peaks)).toBeGreaterThanOrEqual(0);
    // The click at 0.2 s is loud; the gap just before it is silent.
    expect(peaks[Math.floor(0.22 * 50)]).toBeGreaterThan(0.3);
    expect(peaks[Math.floor(0.1 * 50)]).toBe(0);
  });

  it('computePeaks handles silence and explicit bucket counts', () => {
    expect(computePeaks(new Float32Array(RATE), 10)).toEqual(new Array(10).fill(0));
    expect(computePeaks(Float32Array.from([0.5, -1, 0.25, 0]), 2)).toEqual([1, 0.25]);
    expect(computePeaks(new Float32Array(RATE * 400)).length).toBe(12000);
  });
});

describe('changing the music', () => {
  it('resets the music start and drops a timeline that becomes empty', () => {
    let s = setAudioOffset(make(3), 2.5);
    expect(s.video.timeline!.audioOffset).toBe(2.5);
    const changed = patchVideo(s, { audioPath: '/other.wav' });
    expect(changed.video.audioPath).toBe('/other.wav');
    expect(changed.video.timeline).toBeUndefined();
    expect(patchVideo(s, { audioPath: null, fitToMusic: false }).video.timeline).toBeUndefined();
    // Manual lengths survive; only the start is forgotten.
    s = lockClip(s, s.pages[0].id, 4);
    expect(patchVideo(s, { audioPath: '/other.wav' }).video.timeline).toEqual({ audioOffset: 0, locked: { [s.pages[0].id]: 4 }, transitions: {} });
  });

  it('keeps the music start when the music does not change, and for other settings', () => {
    const s = setAudioOffset(make(2), 1.5);
    expect(patchVideo(s, { audioPath: '/music.wav' }).video.timeline!.audioOffset).toBe(1.5);
    expect(patchVideo(s, { kenBurns: true }).video.timeline!.audioOffset).toBe(1.5);
  });
});

describe('one set of timeline options for panel and export', () => {
  it('panel and export totals match for the dialog seconds per page, with and without beat sync', () => {
    let s = make(4);
    s.video.pageSeconds = 4.5;
    s.pages[1].duration = 7; // an own duration stays
    const panel = computeTimeline(s, timelineOptions(s));
    expect(panel.total).toBeCloseTo(4.5 * 3 + 7);
    expect(sum(videoPlan(s, { pageSeconds: 4.5 }).durations)).toBeCloseTo(panel.total, 9);
    s = lockClip(s, s.pages[2].id, 2);
    const withLock = computeTimeline(s, timelineOptions(s));
    expect(sum(videoPlan(s, { pageSeconds: 4.5 }).durations)).toBeCloseTo(withLock.total, 9);
    const beatSync = { analysis, beatsPerPage: 2 };
    const panelBeats = computeTimeline(s, timelineOptions(s, { beatSync }));
    expect(videoPlan(s, { pageSeconds: 4.5, beatSync }).durations).toEqual(panelBeats.clips.map((c) => c.duration));
  });

  it('the story-level seconds per page is the default; an explicit dialog value wins', () => {
    const s = make(2);
    expect(timelineOptions(s).pageSeconds).toBe(3);
    s.video.pageSeconds = 5;
    expect(timelineOptions(s).pageSeconds).toBe(5);
    expect(timelineOptions(s, { pageSeconds: 6 }).pageSeconds).toBe(6);
  });

  it('seconds per page survives saving and is validated on load', () => {
    const s = make(2);
    s.video.pageSeconds = 4;
    expect(deserializeStory(serializeStory(s)).video.pageSeconds).toBe(4);
    const json = JSON.parse(serializeStory(s));
    json.video.pageSeconds = 'x';
    expect(deserializeStory(JSON.stringify(json)).video.pageSeconds).toBeUndefined();
    json.video.pageSeconds = 99;
    expect(deserializeStory(JSON.stringify(json)).video.pageSeconds).toBe(10);
  });
});

describe('an empty timeline is no timeline', () => {
  it('is absent after loading one that says nothing', () => {
    const s = make(2);
    const json = JSON.parse(serializeStory(s));
    json.video.timeline = { audioOffset: 0, locked: {}, transitions: {} };
    expect('timeline' in deserializeStory(JSON.stringify(json)).video).toBe(false);
    json.video.timeline = { audioOffset: 0, locked: { gone: 3 }, transitions: { gone: 'none' } };
    expect('timeline' in deserializeStory(JSON.stringify(json)).video).toBe(false);
  });

  it('deleting a page drops its stale entries at once, and the whole timeline when nothing is left', () => {
    let s = make(3);
    s = setBoundaryTransition(lockClip(s, s.pages[1].id, 4), s.pages[2].id, 'none');
    const gone = removePage(s, 1);
    expect(gone.video.timeline).toEqual({ audioOffset: 0, locked: {}, transitions: { [s.pages[2].id]: 'none' } });
    const only = lockClip(make(2), 'placeholder', 3); // unknown id: nothing real to keep
    expect(normalizeTimeline(only).video.timeline).toBeUndefined();
    const two = make(2);
    expect(removePage(lockClip(two, two.pages[1].id, 3), 1).video.timeline).toBeUndefined();
  });

  it('normalizeTimeline drops unknown pages, removes an empty timeline, and returns the same story when nothing changes', () => {
    const other = make(2);
    const fresh = make(2); // other page ids, as after shuffling the whole story
    const stale = { ...fresh, video: { ...fresh.video, timeline: lockClip(other, other.pages[0].id, 3).video.timeline } };
    expect(normalizeTimeline(stale).video.timeline).toBeUndefined();
    const ok = lockClip(fresh, fresh.pages[0].id, 3);
    expect(normalizeTimeline(ok)).toBe(ok);
    const keepOffset = { ...ok, video: { ...ok.video, timeline: { audioOffset: 1, locked: { nope: 2 }, transitions: {} } } };
    expect(normalizeTimeline(keepOffset).video.timeline).toEqual({ audioOffset: 1, locked: {}, transitions: {} });
    expect(normalizeTimeline(fresh)).toBe(fresh);
  });

  it('resetTimeline removes everything', () => {
    const s = make(2);
    expect(resetTimeline(setAudioOffset(lockClip(s, s.pages[0].id, 3), 1)).video.timeline).toBeUndefined();
  });
});

describe('whole frames', () => {
  const frames = (d: number[], fps = 30) => d.map((x) => Math.round(x * fps));

  it('locked lengths snap to whole frames', () => {
    expect(snapToFrames(1.234)).toBeCloseTo(37 / 30, 12);
    const p = make(3);
    const locked = lockClip(lockClip(p, p.pages[0].id, 1.234), p.pages[1].id, 2.718);
    for (const c of computeTimeline(locked).clips.slice(0, 2)) expect(Math.abs(c.duration * 30 - Math.round(c.duration * 30))).toBeLessThan(1e-9);
    // Loaded values that are not on a frame are snapped by the engine as well.
    const raw = make(2);
    raw.video.timeline = { audioOffset: 0, locked: { [raw.pages[0].id]: 1.2345 }, transitions: {} };
    expect(computeTimeline(raw).clips[0].duration).toBeCloseTo(37 / 30, 12);
  });

  it('per-page frame counts add up to round(total * fps)', () => {
    let s = make(6);
    [1.234, 2.718, 0.777, 3.333, 1.111].forEach((x, i) => { s = lockClip(s, s.pages[i].id, x); });
    const beatSync = { analysis, beatsPerPage: 2 };
    for (const sync of [undefined, beatSync]) {
      const tl = computeTimeline(s, sync ? { analysis, beatsPerPage: 2 } : {});
      const perPage = sum(frames(tl.clips.map((c) => c.duration)));
      expect(perPage).toBe(Math.round(tl.total * 30));
      expect(sum(frames(videoPlan(s, { pageSeconds: 3, beatSync: sync }).durations))).toBe(perPage);
    }
  });

  it('with beat sync, the boundary after an unlocked clip stays on a beat to within half a frame', () => {
    let s = make(6, 'none');
    s = lockClip(s, s.pages[1].id, 1.27);
    s = lockClip(s, s.pages[3].id, 0.83);
    const tl = computeTimeline(s, { analysis, beatsPerPage: 2 });
    let checked = 0;
    tl.clips.forEach((c) => {
      if (c.locked) return;
      checked++;
      expect(analysis.beats.some((b) => Math.abs(b - (c.start + c.duration)) <= 0.5 / 30 + 1e-9)).toBe(true);
    });
    expect(checked).toBeGreaterThan(2);
    expect(sum(frames(tl.clips.map((c) => c.duration)))).toBe(Math.round(tl.total * 30));
  });
});

describe('fit to music', () => {
  const fit = (s: Story, music: number) => videoPlan(s, { pageSeconds: 3, fitToMusicSeconds: music });

  it('is one rule: on, with music, not beat synced', () => {
    expect(fitToMusicApplies({ fitToMusic: true, audioPath: '/a.wav' }, false)).toBe(true);
    expect(fitToMusicApplies({ fitToMusic: true, audioPath: '/a.wav' }, true)).toBe(false);
    expect(fitToMusicApplies({ fitToMusic: true, audioPath: null }, false)).toBe(false);
    expect(fitToMusicApplies({ fitToMusic: false, audioPath: '/a.wav' }, false)).toBe(false);
  });

  it('stretches pages to the song, and a timeline of transition overrides does not switch it off', () => {
    const s = make(4);
    s.video.fitToMusic = true;
    const plain = fit(s, 20);
    const total = sum(plain.durations);
    expect(total).toBeLessThanOrEqual(20);
    expect(total).toBeGreaterThan(19.8);
    const withTransitions = setBoundaryTransition(s, s.pages[1].id, 'none');
    expect(withTransitions.video.timeline).toBeDefined();
    expect(fit(withTransitions, 20).durations).toEqual(plain.durations);
    expect(fit(withTransitions, 20).transitions?.[1]).toBe('none');
  });

  it('with locked clips only the unlocked ones are scaled', () => {
    let s = make(4);
    s.video.fitToMusic = true;
    s = lockClip(s, s.pages[0].id, 5);
    const plan = fit(s, 20);
    expect(plan.durations[0]).toBe(5);
    const rest = plan.durations.slice(1);
    expect(rest[0]).toBe(rest[1]);
    expect(sum(plan.durations)).toBeLessThanOrEqual(20);
    expect(sum(plan.durations)).toBeGreaterThan(19.8);
    expect(computeTimeline(s, timelineOptions(s, { fitToMusicSeconds: 20 })).total).toBeCloseTo(sum(plan.durations), 9);
    // Locked clips that already fill the song leave the others alone.
    const tight = lockClip(s, s.pages[1].id, 30);
    expect(fit(tight, 20).durations.slice(2)).toEqual([3, 3]);
  });

  it('is off when the story does not ask for it', () => {
    expect(sum(fit(make(4), 20).durations)).toBe(12);
  });
});

describe('music loop point', () => {
  it('is the beat grid loop with beat sync, else the length of the file', () => {
    expect(musicLoopSeconds(analysis, 2, true)).toBeCloseTo(beatLoopSeconds(analysis, 2));
    expect(musicLoopSeconds(analysis, 2, false)).toBe(8);
    expect(musicLoopSeconds(undefined, 2, true)).toBeNull();
    expect(musicLoopSeconds({ beats: [], bpm: 0, duration: 6, noBeats: true }, 2, true)).toBe(6);
  });
});
