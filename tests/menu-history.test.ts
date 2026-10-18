import { describe, expect, it, vi } from 'vitest';
import { handleMenuCommand } from '../src/core/menuHistory';

const history = () => ({ undo: vi.fn(), redo: vi.fn() });
// Minimal stand-ins for DOM elements (the tests run in node).
const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, isContentEditable: false, ...extra }) as unknown as Element;

describe('menu undo/redo dispatch', () => {
  it('sends undo and redo to the history when focus is not in a text field', () => {
    const h = history();
    const native = vi.fn();
    expect(handleMenuCommand('undo', el('DIV'), native, h)).toBe('history');
    expect(handleMenuCommand('redo', el('BODY'), native, h)).toBe('history');
    expect(handleMenuCommand('undo', null, native, h)).toBe('history');
    expect(h.undo).toHaveBeenCalledTimes(2);
    expect(h.redo).toHaveBeenCalledTimes(1);
    expect(native).not.toHaveBeenCalled();
  });

  it('runs the native text undo in text fields and leaves the history alone', () => {
    const h = history();
    const native = vi.fn();
    expect(handleMenuCommand('undo', el('INPUT', { type: 'text' }), native, h)).toBe('text');
    expect(handleMenuCommand('redo', el('TEXTAREA'), native, h)).toBe('text');
    expect(handleMenuCommand('undo', el('DIV', { isContentEditable: true }), native, h)).toBe('text');
    expect(native.mock.calls).toEqual([['undo'], ['redo'], ['undo']]);
    expect(h.undo).not.toHaveBeenCalled();
    expect(h.redo).not.toHaveBeenCalled();
  });

  it('treats checkboxes and sliders as non-text', () => {
    const h = history();
    expect(handleMenuCommand('undo', el('INPUT', { type: 'checkbox' }), vi.fn(), h)).toBe('history');
    expect(handleMenuCommand('undo', el('INPUT', { type: 'range' }), vi.fn(), h)).toBe('history');
  });

  it('is a no-op when the visible mode has no history', () => {
    const native = vi.fn();
    expect(handleMenuCommand('undo', el('DIV'), native, null)).toBe('none');
    expect(native).not.toHaveBeenCalled();
  });
});
