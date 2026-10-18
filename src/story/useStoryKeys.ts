import { useEffect, useRef } from 'react';
import type { ZMove } from './model';

export type KeyActions = {
  enabled: boolean;
  hasSelection: boolean;
  cropping: boolean;
  pageCount: number;
  pageIndex: number;
  remove: () => void;
  nudge: (dx: number, dy: number) => void;
  duplicate: () => void;
  undo: () => void;
  redo: () => void;
  zOrder: (m: ZMove) => void;
  deselect: () => void;
  selectAll: () => void;
  exitCrop: () => void;
  goTo: (i: number) => void;
  save: () => void;
  open: () => void;
  cycleLayout: (direction: 1 | -1) => void;
  moveToOwnPage: () => void;
  toggleHidden: () => void;
};

const isTyping = (t: EventTarget | null): boolean => {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName);
};

/** Story shortcuts. Active only while the Story tab shows and focus is not in a text field. */
export function useStoryKeys(actions: KeyActions) {
  const ref = useRef(actions);
  ref.current = actions;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const a = ref.current;
      if (!a.enabled || isTyping(e.target)) return;
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key;
      const done = () => e.preventDefault();
      if (mod) {
        const k = key.toLowerCase();
        if (k === 'n' && e.shiftKey) { done(); a.moveToOwnPage(); }
        else if (k === 'h' && e.shiftKey) { done(); a.toggleHidden(); }
        else if (k === 'z') { done(); if (e.shiftKey) a.redo(); else a.undo(); }
        else if (k === 'y') { done(); a.redo(); }
        else if (k === 'd') { done(); a.duplicate(); }
        else if (k === 's') { done(); a.save(); }
        else if (k === 'o') { done(); a.open(); }
        else if (k === 'a') { done(); a.selectAll(); }
        else if (key === ']') { done(); a.zOrder(e.shiftKey ? 'front' : 'forward'); }
        else if (key === '[') { done(); a.zOrder(e.shiftKey ? 'back' : 'backward'); }
        return;
      }
      if ((key === '[' || key === ']') && !a.hasSelection && !a.cropping) { done(); a.cycleLayout(key === ']' ? 1 : -1); return; }
      if (key === 'Escape') {
        if (a.cropping) a.exitCrop();
        else a.deselect();
        return;
      }
      if (key === 'Enter' && a.cropping) { done(); a.exitCrop(); return; }
      if (key === 'Delete' || key === 'Backspace') {
        if (a.hasSelection) { done(); a.remove(); }
        return;
      }
      if (key.startsWith('Arrow')) {
        if (a.cropping) return;
        const step = e.shiftKey ? 10 : 1;
        if (a.hasSelection) {
          done();
          a.nudge(key === 'ArrowLeft' ? -step : key === 'ArrowRight' ? step : 0, key === 'ArrowUp' ? -step : key === 'ArrowDown' ? step : 0);
        } else if (key === 'ArrowLeft' && a.pageIndex > 0) { done(); a.goTo(a.pageIndex - 1); }
        else if (key === 'ArrowRight' && a.pageIndex < a.pageCount - 1) { done(); a.goTo(a.pageIndex + 1); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
