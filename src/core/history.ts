import { useCallback, useRef, useState } from 'react';

const COALESCE_MS = 500;
export const MAX_UNDO_STEPS = 200;

type Stack<T> = { past: T[]; present: T; future: T[] };

export type History<T> = {
  state: T;
  /** Commit a change. Calls with the same `key` within 500 ms merge into one undo step. */
  set: (next: T | ((prev: T) => T), key?: string) => void;
  /** Replace the present without creating an undo step. */
  replace: (next: T | ((prev: T) => T)) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Drop all history and set a new present. */
  reset: (next: T) => void;
};

/** `past` with `state` added, dropping the oldest entries beyond MAX_UNDO_STEPS. */
export function pushPast<T>(past: T[], state: T, max = MAX_UNDO_STEPS): T[] {
  const next = [...past, state];
  return next.length > max ? next.slice(next.length - max) : next;
}

export function useHistory<T>(initial: T | (() => T)): History<T> {
  const [stack, setStack] = useState<Stack<T>>(() => ({
    past: [],
    present: typeof initial === 'function' ? (initial as () => T)() : initial,
    future: [],
  }));
  const last = useRef<{ key: string; at: number } | null>(null);
  const resolve = (next: T | ((prev: T) => T), prev: T) => (typeof next === 'function' ? (next as (p: T) => T)(prev) : next);

  const set = useCallback((next: T | ((prev: T) => T), key?: string) => {
    const now = Date.now();
    const merge = key !== undefined && last.current?.key === key && now - last.current.at < COALESCE_MS;
    last.current = key !== undefined ? { key, at: now } : null;
    setStack((s) => {
      const present = resolve(next, s.present);
      if (Object.is(present, s.present)) return s;
      return { past: merge ? s.past : pushPast(s.past, s.present), present, future: [] };
    });
  }, []);

  const replace = useCallback((next: T | ((prev: T) => T)) => {
    setStack((s) => ({ ...s, present: resolve(next, s.present) }));
  }, []);

  const undo = useCallback(() => {
    last.current = null;
    setStack((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s));
  }, []);

  const redo = useCallback(() => {
    last.current = null;
    setStack((s) => (s.future.length ? { past: pushPast(s.past, s.present), present: s.future[0], future: s.future.slice(1) } : s));
  }, []);

  const reset = useCallback((next: T) => {
    last.current = null;
    setStack({ past: [], present: next, future: [] });
  }, []);

  return { state: stack.present, set, replace, undo, redo, canUndo: stack.past.length > 0, canRedo: stack.future.length > 0, reset };
}
