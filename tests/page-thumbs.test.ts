import { describe, expect, it } from 'vitest';
import { defaultPhotoEl, emptyPage, emptyStory, type Story } from '../src/story/model';
import { pageKey } from '../src/story/usePageThumbs';

const story = (): Story => ({
  ...emptyStory(),
  pages: [{ ...emptyPage(), elements: [{ ...defaultPhotoEl(), photoId: 'a' }] }, { ...emptyPage(), elements: [{ ...defaultPhotoEl(), photoId: 'b' }] }],
  photos: [{ id: 'a', name: 'a.jpg', width: 100, height: 100 }, { id: 'b', name: 'b.jpg', width: 100, height: 100 }],
});

describe('page thumbnail keys', () => {
  it('ignore photos a page does not use', () => {
    const s = story();
    const more = { ...s, photos: [...s.photos, { id: 'c', name: 'c.jpg', width: 50, height: 50 }] };
    expect(pageKey(more, 0)).toBe(pageKey(s, 0));
    expect(pageKey(more, 1)).toBe(pageKey(s, 1));
  });
  it('change when a used photo changes', () => {
    const s = story();
    const resized = { ...s, photos: [{ ...s.photos[0], width: 200 }, s.photos[1]] };
    expect(pageKey(resized, 0)).not.toBe(pageKey(s, 0));
    expect(pageKey(resized, 1)).toBe(pageKey(s, 1));
  });
});
