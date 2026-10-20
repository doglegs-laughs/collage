import { describe, expect, it } from 'vitest';
import { defaultPhotoEl, defaultRectEl, defaultTextEl, deserializeStory, emptyPage, emptyStory, MAX_AUDIO_OFFSET_SECONDS, serializeStory, StoryFormatError } from '../src/story/model';
import { computeTimeline, setAudioOffset } from '../src/story/timeline';

const project = () => ({ ...emptyStory(), pages: [{ ...emptyPage(), elements: [defaultPhotoEl(), defaultTextEl(), defaultRectEl()] }], photos: [{ id: 'p', name: 'p.jpg', width: 100, height: 100 }] });

describe('untrusted project validation', () => {
  it('bounds extreme music offsets before beat calculations can lose numeric precision', () => {
    const s = project();
    s.video.timeline = { audioOffset: 1e308, locked: {}, transitions: {} };
    const parsed = deserializeStory(serializeStory(s));
    expect(parsed.video.timeline?.audioOffset).toBe(MAX_AUDIO_OFFSET_SECONDS);
    const tl = computeTimeline(parsed, { analysis: { beats: [0, 0.5, 1, 1.5], duration: 2, bpm: 120 } });
    expect(Number.isFinite(tl.total)).toBe(true);
    expect(setAudioOffset(s, Infinity).video.timeline).toBeUndefined();
  });
  it.each([
    ['photo frame color', (s: any) => { s.pages[0].elements[0].frameColor = {}; }],
    ['photo frame', (s: any) => { s.pages[0].elements[0].frame = 'wide'; }],
    ['crop zoom', (s: any) => { s.pages[0].elements[0].crop.zoom = 0; }],
    ['text', (s: any) => { s.pages[0].elements[1].text = {}; }],
    ['text size', (s: any) => { s.pages[0].elements[1].size = 'large'; }],
    ['shape fill', (s: any) => { s.pages[0].elements[2].fill = []; }],
    ['photo size', (s: any) => { s.photos[0].height = 0; }],
    ['element size', (s: any) => { s.pages[0].elements[0].w = -1; }],
    ['duplicate page', (s: any) => { s.pages.push({ ...s.pages[0], elements: [] }); }],
    ['duplicate element', (s: any) => { s.pages[0].elements.push(s.pages[0].elements[0]); }],
    ['duplicate photo', (s: any) => { s.photos.push(s.photos[0]); }],
    ['reserved id', (s: any) => { s.pages[0].id = 'constructor'; }],
    ['fractional spread', (s: any) => { s.pages[0].spread = { index: 0.5, count: 2 }; }],
  ])('rejects invalid %s before it reaches the editor', (_label, change) => {
    const s = project(); change(s);
    expect(() => deserializeStory(JSON.stringify(s))).toThrow(StoryFormatError);
  });

  it('normalizes video settings and discards unknown element and video properties', () => {
    const raw = JSON.parse(serializeStory(project()));
    raw.video = { transition: 'evil', transitionSeconds: 'slow', audioPath: {}, kenBurns: 'yes', fitToMusic: [], arbitrary: true };
    raw.pages[0].elements[0].arbitrary = { bad: true };
    const story = deserializeStory(JSON.stringify(raw));
    expect(story.video).toMatchObject({ transition: 'crossfade', transitionSeconds: 0.6, audioPath: null, kenBurns: false, fitToMusic: false });
    expect(story.video).not.toHaveProperty('arbitrary');
    expect(story.pages[0].elements[0]).not.toHaveProperty('arbitrary');
  });

  it.each(['https://evil.test/music.mp3', 'concat:/tmp/a|/tmp/b', 'pipe:0'])('drops protocol audio input %s', (audioPath) => {
    const s = project(); s.video.audioPath = audioPath;
    expect(deserializeStory(serializeStory(s)).video.audioPath).toBeNull();
  });

  it.each(['/tmp/music.wav', 'C:\\Music\\track.wav', 'music/track.wav'])('keeps local audio path %s', (audioPath) => {
    const s = project(); s.video.audioPath = audioPath;
    expect(deserializeStory(serializeStory(s)).video.audioPath).toBe(audioPath);
  });
});
