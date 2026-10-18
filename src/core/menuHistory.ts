import { useEffect } from 'react';

export type MenuCommand = 'undo' | 'redo';
export type HistoryTarget = { undo: () => void; redo: () => void };

let target: HistoryTarget | null = null;

/** The visible mode's undo history receives Edit > Undo / Redo. A mode without history registers nothing (no-op). */
export function useHistoryTarget(active: boolean, history: HistoryTarget) {
  useEffect(() => {
    if (!active) return;
    const mine: HistoryTarget = { undo: history.undo, redo: history.redo };
    target = mine;
    return () => { if (target === mine) target = null; };
  }, [active, history.undo, history.redo]);
}

export const isEditable = (el: Element | null): boolean => {
  const h = el as HTMLElement | null;
  if (!h || !h.tagName) return false;
  if (h.isContentEditable) return true;
  if (h.tagName === 'TEXTAREA') return true;
  if (h.tagName !== 'INPUT') return false;
  return !['button', 'checkbox', 'radio', 'range', 'color', 'file', 'submit', 'reset', 'image'].includes((h as HTMLInputElement).type);
};

/** One place decides: in a text field the native text undo runs, otherwise the visible mode's history does. Never both. */
export function handleMenuCommand(
  command: MenuCommand,
  focused: Element | null,
  nativeText: (command: MenuCommand) => void,
  history: HistoryTarget | null = target,
): 'text' | 'history' | 'none' {
  if (isEditable(focused)) { nativeText(command); return 'text'; }
  if (!history) return 'none';
  history[command]();
  return 'history';
}
