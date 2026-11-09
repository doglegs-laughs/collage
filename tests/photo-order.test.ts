import { describe, expect, it } from 'vitest';
import { dropIndex, moveById } from '../src/core/order';

const lib = ['a', 'b', 'c', 'd'].map((id) => ({ id }));
const ids = (l: { id: string }[]) => l.map((x) => x.id).join('');

describe('moveById', () => {
  it('moves an item forwards and backwards', () => {
    expect(ids(moveById(lib, 'a', 2))).toBe('bcad');
    expect(ids(moveById(lib, 'd', 0))).toBe('dabc');
    expect(ids(moveById(lib, 'b', 2))).toBe('acbd');
  });
  it('clamps to the ends', () => {
    expect(ids(moveById(lib, 'b', -5))).toBe('bacd');
    expect(ids(moveById(lib, 'b', 99))).toBe('acdb');
  });
  it('returns the same array for a no-op, an unknown id or a bad index', () => {
    expect(moveById(lib, 'c', 2)).toBe(lib);
    expect(moveById(lib, 'z', 0)).toBe(lib);
    expect(moveById(lib, 'a', NaN)).toBe(lib);
    expect(moveById([], 'a', 0)).toEqual([]);
  });
  it('does not mutate its input', () => {
    moveById(lib, 'd', 0);
    expect(ids(lib)).toBe('abcd');
  });
});

describe('dropIndex', () => {
  it('turns an insertion gap into the final index', () => {
    expect(dropIndex(0, 3)).toBe(2); // before d
    expect(dropIndex(3, 0)).toBe(0); // before a
    expect(dropIndex(1, 1)).toBe(1); // before itself: stays
    expect(dropIndex(1, 2)).toBe(1); // after itself: stays
    expect(dropIndex(0, 4)).toBe(3); // after the last
  });
});
