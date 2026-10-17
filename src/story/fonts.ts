import type { FontKey, TextEl } from './model';

/** CSS font-family stacks. The DOM editor and the canvas renderer both use these. */
export const FONT_STACKS: Record<FontKey, string> = {
  sans: '-apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  serif: '"New York", Georgia, "Times New Roman", serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, "Courier New", monospace',
  display: '"Didot", "Bodoni 72", "Playfair Display", serif',
  displaySans: '"Avenir Next", "Helvetica Neue", "Segoe UI", Arial, sans-serif',
};
export const FONT_LABELS: Record<FontKey, string> = { sans: 'Sans', serif: 'Serif', mono: 'Mono', display: 'Display (thin serif)', displaySans: 'Display (thin sans)' };
export const FONT_KEYS = Object.keys(FONT_STACKS) as FontKey[];

export const fontStack = (key: FontKey): string => FONT_STACKS[key] ?? FONT_STACKS.sans;
/** Canvas/CSS `font` shorthand for a text element at the given page pixel height. */
export const fontShorthand = (el: Pick<TextEl, 'font' | 'weight' | 'size'>, pageHeightPx: number): string => `${el.weight} ${el.size * pageHeightPx}px ${fontStack(el.font)}`;
export const LINE_HEIGHT = 1.2;
