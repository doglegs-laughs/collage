import { DEFAULT_CROP, type Crop } from '../core/geometry';

/** One photo placed in one box. Crops live here (not per photo) so the same photo twice keeps independent framing. */
export type Placement = { uid: string; photoId: string; crop: Crop };
export type Slots = (Placement | null)[];

let counter = 0;
const newUid = () => `p${++counter}${Math.random().toString(36).slice(2, 7)}`;

export const makePlacement = (photoId: string, crop: Crop = DEFAULT_CROP): Placement => ({ uid: newUid(), photoId, crop: { ...crop } });

/** Put photos into empty boxes in row-major order. `overflow` counts photos that did not fit. */
export function fillEmpty(slots: Slots, photoIds: readonly string[]): { slots: Slots; placed: number; overflow: number } {
  const next = slots.slice();
  let placed = 0;
  for (const photoId of photoIds) {
    const free = next.indexOf(null);
    if (free < 0) break;
    next[free] = makePlacement(photoId);
    placed++;
  }
  return { slots: next, placed, overflow: photoIds.length - placed };
}

export const overflowMessage = (placed: number, overflow: number) =>
  placed
    ? `Added ${placed}; the other ${overflow} didn’t fit. Add rows or columns for more.`
    : 'Every box is full. Remove a photo or add rows or columns.';
