import { describe, expect, it } from 'vitest';
import { insertInLibraryOrder } from '../src/story/useTraySelection';

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
