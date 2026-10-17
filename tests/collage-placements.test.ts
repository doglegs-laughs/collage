import { describe, expect, it } from 'vitest';
import { fillEmpty, makePlacement, type Slots } from '../src/collage/placements';

describe('collage placements', () => {
  it('fills empty boxes row-major and reports overflow', () => {
    const slots: Slots = [makePlacement('a'), null, null, makePlacement('b')];
    const r = fillEmpty(slots, ['c', 'd', 'e']);
    expect(r.slots.map((s) => s?.photoId)).toEqual(['a', 'c', 'd', 'b']);
    expect(r.placed).toBe(2);
    expect(r.overflow).toBe(1);
  });
  it('gives identical photos independent crops', () => {
    const r = fillEmpty([null, null], ['a', 'a']);
    const [x, y] = r.slots;
    expect(x!.uid).not.toBe(y!.uid);
    expect(x!.crop).not.toBe(y!.crop);
  });
});
