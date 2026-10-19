import { describe, expect, it } from 'vitest';
import { FrameCache, pageSignature } from '../src/story/videoCache';
import { defaultPhotoEl, defaultTextEl, emptyPage, emptyStory, type Story } from '../src/story/model';

const bytes = (n: number) => new Uint8Array(n);
type PhotoEl = ReturnType<typeof defaultPhotoEl>;
type TextEl = ReturnType<typeof defaultTextEl>;

describe('FrameCache', () => {
  it('returns what was stored and counts bytes', () => {
    const c = new FrameCache(100);
    c.set('a', bytes(40));
    expect(c.get('a')?.byteLength).toBe(40);
    expect(c.bytes).toBe(40);
    c.set('a', bytes(10));
    expect(c.bytes).toBe(10);
    expect(c.size).toBe(1);
  });
  it('evicts the least recently used frames when over the byte limit', () => {
    const c = new FrameCache(100);
    c.set('a', bytes(40)); c.set('b', bytes(40));
    c.get('a'); // b is now the oldest
    c.set('c', bytes(40));
    expect(c.has('b')).toBe(false);
    expect(c.has('a') && c.has('c')).toBe(true);
    expect(c.bytes).toBe(80);
  });
  it('does not keep a frame larger than the whole cache', () => {
    const c = new FrameCache(100);
    c.set('a', bytes(40));
    c.set('big', bytes(101));
    expect(c.has('big')).toBe(false);
    expect(c.has('a')).toBe(true);
  });
});

describe('pageSignature', () => {
  const story = (): Story => {
    const s = emptyStory();
    s.photos = [{ id: 'p1', name: 'p1.jpg', width: 400, height: 300 }, { id: 'p2', name: 'p2.jpg', width: 300, height: 400 }];
    s.pages = [
      { ...emptyPage(), elements: [defaultPhotoEl({ photoId: 'p1' }), defaultTextEl({ text: 'Hi' })] },
      { ...emptyPage(), elements: [defaultPhotoEl({ photoId: 'p2' })] },
    ];
    return s;
  };
  it('is stable and only changes for the page that changed', () => {
    const a = story(), b = story();
    expect(pageSignature(a, 0, 1080)).toBe(pageSignature(b, 0, 1080));
    (b.pages[1].elements[0] as PhotoEl).crop = { zoom: 2, cx: 0.4, cy: 0.5 };
    expect(pageSignature(a, 0, 1080)).toBe(pageSignature(b, 0, 1080));
    expect(pageSignature(a, 1, 1080)).not.toBe(pageSignature(b, 1, 1080));
  });
  it('depends on width, photo, background and font', () => {
    const a = story();
    const base = pageSignature(a, 0, 1080);
    expect(pageSignature(a, 0, 720)).not.toBe(base);
    const c = story(); c.pages[0].background = '#123456';
    expect(pageSignature(c, 0, 1080)).not.toBe(base);
    const d = story(); (d.pages[0].elements[0] as PhotoEl).photoId = 'p2';
    expect(pageSignature(d, 0, 1080)).not.toBe(base);
    const e = story(); (e.pages[0].elements[1] as TextEl).font = 'serif';
    expect(pageSignature(e, 0, 1080)).not.toBe(base);
  });
  it('ignores the page duration, which does not change pixels', () => {
    const a = story(), b = story();
    b.pages[0].duration = 9;
    expect(pageSignature(a, 0, 1080)).toBe(pageSignature(b, 0, 1080));
  });
  it('includes parts of neighbouring pages that overlap it', () => {
    const a = story(), b = story();
    a.pages[1].elements = [defaultPhotoEl({ photoId: 'p2', x: -0.5, w: 1 })];
    b.pages[1].elements = [defaultPhotoEl({ photoId: 'p2', x: -0.5, w: 1 })];
    expect(pageSignature(a, 0, 1080)).toBe(pageSignature(b, 0, 1080));
    (b.pages[1].elements[0] as PhotoEl).crop = { zoom: 3, cx: 0.5, cy: 0.5 };
    expect(pageSignature(a, 0, 1080)).not.toBe(pageSignature(b, 0, 1080));
  });
});
