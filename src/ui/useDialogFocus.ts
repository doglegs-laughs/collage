import { useEffect, useRef, type KeyboardEvent } from 'react';

const FOCUSABLE = 'button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/** The controls inside `root` that Tab can reach, in document order. */
export function focusableIn(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.hidden && el.getAttribute('aria-hidden') !== 'true');
}

/**
 * Modal dialog focus: moves focus to the first control on open, keeps Tab / Shift+Tab inside, and gives focus back to
 * whatever had it before when the dialog closes. Attach `ref` and `onKeyDown` to the dialog element (give it tabIndex={-1}).
 */
export function useDialogFocus<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    const root = ref.current;
    if (root) (focusableIn(root)[0] ?? root).focus();
    return () => { if (before?.isConnected) before.focus(); };
  }, []);
  const onKeyDown = (e: KeyboardEvent<T>) => {
    if (e.key !== 'Tab' || !ref.current) return;
    const items = focusableIn(ref.current);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || active === ref.current)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
  };
  return { ref, onKeyDown };
}
