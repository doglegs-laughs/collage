import { describe, expect, it } from 'vitest';
import { insertInLibraryOrder, isReorder, sortToLibrary } from '../src/story/useTraySelection';

const lib = ['a', 'b', 'c', 'd'].map((id) => ({ id }));

describe('insertInLibraryOrder', () => {
  it('puts a re-selected photo back at its library position', () => {
    expect(insertInLibraryOrder(['a', 'c', 'd'], 'b', lib)).toEqual(['a', 'b', 'c', 'd']);
    expect(insertInLibraryOrder(['b', 'c', 'd'], 'a', lib)).toEqual(['a', 'b', 'c', 'd']);
    expect(insertInLibraryOrder(['a', 'b', 'c'], 'd', lib)).toEqual(['a', 'b', 'c', 'd']);
  });
  it('appends a photo the library does not know', () => {
    expect(insertInLibraryOrder(['a', 'b'], 'z', lib)).toEqual(['a', 'b', 'z']);
  });
});

describe('sortToLibrary', () => {
  it('re-sorts the selection to the library order, keeping which photos are selected', () => {
    const reordered = ['d', 'a', 'c', 'b'].map((id) => ({ id }));
    expect(sortToLibrary(['a', 'c', 'd'], reordered)).toEqual(['d', 'a', 'c']);
    expect(sortToLibrary([], reordered)).toEqual([]);
  });
  it('returns the same array when already in order, and puts unknown ids last', () => {
    const s = ['a', 'b'];
    expect(sortToLibrary(s, lib)).toBe(s);
    expect(sortToLibrary(['z', 'b', 'a'], lib)).toEqual(['a', 'b', 'z']);
  });
});

describe('isReorder', () => {
  it('is true only for the same photos in a different order', () => {
    expect(isReorder(lib, [lib[1], lib[0], lib[2], lib[3]])).toBe(true);
    expect(isReorder(lib, lib)).toBe(false);
    expect(isReorder(lib, lib.slice(1))).toBe(false);
    expect(isReorder(lib, [...lib.slice(1), { id: 'z' }])).toBe(false);
  });
});
