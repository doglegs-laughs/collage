import { describe, expect, it } from 'vitest';
import { MAX_UNDO_STEPS, pushPast } from '../src/core/history';

describe('undo history cap', () => {
  it('keeps the newest states and drops the oldest beyond the cap', () => {
    let past: number[] = [];
    for (let i = 0; i < MAX_UNDO_STEPS + 50; i++) past = pushPast(past, i);
    expect(past).toHaveLength(MAX_UNDO_STEPS);
    expect(past[0]).toBe(50);
    expect(past.at(-1)).toBe(MAX_UNDO_STEPS + 49);
  });
  it('does not touch short histories', () => {
    expect(pushPast([1, 2], 3)).toEqual([1, 2, 3]);
  });
});
