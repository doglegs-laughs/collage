import { useCallback, useRef, useState } from 'react';
import { clamp, MAX_GRID, resizeGrid, swap, type Crop, type Shape } from '../core/geometry';
import { fillEmpty, makePlacement, type Slots } from './placements';

export type CollageState = {
  rows: number;
  columns: number;
  shape: Shape;
  /** null = automatic default until the user touches the slider. */
  border: number | null;
  slots: Slots;
};

const initial: CollageState = { rows: 2, columns: 2, shape: null, border: null, slots: new Array(4).fill(null) };
const dim = (n: number) => clamp(Math.floor(n) || 1, 1, MAX_GRID);

/** Collage state with a synchronous ref mirror, so async callers (file imports) always see the latest slots. */
export function useCollage() {
  const [state, setState] = useState<CollageState>(initial);
  const ref = useRef(state);
  const commit = useCallback((fn: (s: CollageState) => CollageState) => {
    ref.current = fn(ref.current);
    setState(ref.current);
  }, []);

  const setGrid = useCallback(
    (rows: number, columns: number) =>
      commit((s) => {
        const r = dim(rows);
        const c = dim(columns);
        return { ...s, rows: r, columns: c, slots: resizeGrid(s.slots, s.rows, s.columns, r, c) };
      }),
    [commit],
  );

  return {
    state,
    live: ref,
    setRows: (n: number) => setGrid(n, ref.current.columns),
    setColumns: (n: number) => setGrid(ref.current.rows, n),
    setShape: (shape: Shape) => commit((s) => ({ ...s, shape })),
    setBorder: (border: number) => commit((s) => ({ ...s, border })),
    /** Fill empty boxes row-major; returns how many were placed and how many did not fit. */
    fill: (photoIds: readonly string[]) => {
      const result = fillEmpty(ref.current.slots, photoIds);
      commit((s) => ({ ...s, slots: result.slots }));
      return { placed: result.placed, overflow: result.overflow };
    },
    put: (index: number, photoId: string) =>
      commit((s) => ({ ...s, slots: s.slots.map((p, i) => (i === index ? makePlacement(photoId) : p)) })),
    remove: (index: number) => commit((s) => ({ ...s, slots: s.slots.map((p, i) => (i === index ? null : p)) })),
    swapSlots: (a: number, b: number) => commit((s) => ({ ...s, slots: swap(s.slots, a, b) })),
    setCrop: (index: number, crop: Crop) =>
      commit((s) => ({ ...s, slots: s.slots.map((p, i) => (i === index && p ? { ...p, crop } : p)) })),
  };
}

export type CollageApi = ReturnType<typeof useCollage>;
