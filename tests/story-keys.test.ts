import { describe, expect, it } from 'vitest';
import { zMoveFor } from '../src/story/useStoryKeys';

describe('z-order shortcuts', () => {
  it('maps bracket keys, including Shift where key becomes { or }', () => {
    expect(zMoveFor({ key: ']', code: 'BracketRight', shiftKey: false })).toBe('forward');
    expect(zMoveFor({ key: '[', code: 'BracketLeft', shiftKey: false })).toBe('backward');
    expect(zMoveFor({ key: '}', code: 'BracketRight', shiftKey: true })).toBe('front');
    expect(zMoveFor({ key: '{', code: 'BracketLeft', shiftKey: true })).toBe('back');
    expect(zMoveFor({ key: '}', code: '', shiftKey: true })).toBe('front');
    expect(zMoveFor({ key: 'a', code: 'KeyA', shiftKey: true })).toBeNull();
  });
});
