import type { FontKey, TextEl } from './model';

export type Weight = TextEl['weight'];
type FontDef = {
  label: string;
  /** CSS font-family stack (web font first for bundled families, then fallbacks). */
  stack: string;
  /** Weights the family offers; a text's weight snaps to the nearest. */
  weights: Weight[];
  /** Bundled web font family name (undefined for system stacks). */
  family?: string;
  /** Average advance per character of uppercase text in em, measured with canvas measureText (title auto-sizing). Includes word spaces. */
  advance: number;
};

const SYS_WEIGHTS: Weight[] = [300, 400, 600, 800];

export const FONTS: Record<FontKey, FontDef> = {
  sans: { label: 'Sans', stack: '-apple-system, system-ui, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif', weights: SYS_WEIGHTS, advance: 0.54 },
  serif: { label: 'Serif', stack: '"New York", Georgia, "Times New Roman", serif', weights: SYS_WEIGHTS, advance: 0.55 },
  mono: { label: 'Mono', stack: 'ui-monospace, "SF Mono", Menlo, Consolas, "Courier New", monospace', weights: SYS_WEIGHTS, advance: 0.6 },
  display: { label: 'Display (thin serif)', stack: '"Didot", "Bodoni 72", "Playfair Display", serif', weights: SYS_WEIGHTS, advance: 0.58 },
  displaySans: { label: 'Display (thin sans)', stack: '"Avenir Next", "Helvetica Neue", "Segoe UI", Arial, sans-serif', weights: SYS_WEIGHTS, advance: 0.56 },
  italiana: { label: 'Italiana — Faroes', family: 'Italiana', stack: '"Italiana", "Didot", "Bodoni 72", "Playfair Display", Georgia, serif', weights: [400], advance: 0.523 },
  poiret: { label: 'Poiret One — Art deco', family: 'Poiret One', stack: '"Poiret One", "Avenir Next", "Helvetica Neue", Arial, sans-serif', weights: [400], advance: 0.541 },
  josefin: { label: 'Josefin Sans — Geometric', family: 'Josefin Sans', stack: '"Josefin Sans", "Avenir Next", "Helvetica Neue", Arial, sans-serif', weights: [100, 300, 600], advance: 0.606 },
  cormorant: { label: 'Cormorant — Classic serif', family: 'Cormorant Garamond', stack: '"Cormorant Garamond", Garamond, "New York", Georgia, serif', weights: [300, 500, 600], advance: 0.561 },
  playfair: { label: 'Playfair — Editorial', family: 'Playfair Display', stack: '"Playfair Display", "Didot", "Bodoni 72", Georgia, serif', weights: [400, 700], advance: 0.571 },
  montserrat: { label: 'Montserrat — Modern', family: 'Montserrat', stack: '"Montserrat", "Avenir Next", "Helvetica Neue", Arial, sans-serif', weights: [300, 500, 700], advance: 0.63 },
  bebas: { label: 'Bebas Neue — Bold caps', family: 'Bebas Neue', stack: '"Bebas Neue", Impact, "Arial Narrow", sans-serif', weights: [400], advance: 0.355 },
  caveat: { label: 'Caveat — Handwritten', family: 'Caveat', stack: '"Caveat", "Bradley Hand", "Segoe Print", cursive', weights: [400, 600], advance: 0.469 },
  dmmono: { label: 'DM Mono — Typewriter', family: 'DM Mono', stack: '"DM Mono", ui-monospace, "SF Mono", Menlo, Consolas, "Courier New", monospace', weights: [300, 400], advance: 0.6 },
  marcellus: { label: 'Marcellus — Roman caps', family: 'Marcellus', stack: '"Marcellus", "Trajan Pro", "Times New Roman", serif', weights: [400], advance: 0.575 },
};

export const FONT_KEYS = Object.keys(FONTS) as FontKey[];
/** CSS font-family stacks. The DOM editor and the canvas renderer both use these. */
export const FONT_STACKS = Object.fromEntries(FONT_KEYS.map((k) => [k, FONTS[k].stack])) as Record<FontKey, string>;
export const FONT_LABELS = Object.fromEntries(FONT_KEYS.map((k) => [k, FONTS[k].label])) as Record<FontKey, string>;
export const FONT_ADVANCE = Object.fromEntries(FONT_KEYS.map((k) => [k, FONTS[k].advance])) as Record<FontKey, number>;

export const isFontKey = (v: unknown): v is FontKey => typeof v === 'string' && Object.prototype.hasOwnProperty.call(FONTS, v);
export const fontStack = (key: FontKey): string => FONTS[key]?.stack ?? FONTS.sans.stack;
export const fontWeights = (key: FontKey): Weight[] => (FONTS[key] ?? FONTS.sans).weights;
/** The family's available weight nearest to `w` (ties go to the lighter one). */
export function snapWeight(key: FontKey, w: number): Weight {
  const list = fontWeights(key);
  return list.reduce((best, x) => (Math.abs(x - w) < Math.abs(best - w) ? x : best), list[0]);
}
export const WEIGHT_NAMES: Record<number, string> = { 100: 'Hairline', 200: 'Extra light', 300: 'Light', 400: 'Regular', 500: 'Medium', 600: 'Semi', 700: 'Bold', 800: 'Heavy', 900: 'Black' };

/** Canvas/CSS `font` shorthand for a text element at the given page pixel height. */
export const fontShorthand = (el: Pick<TextEl, 'font' | 'weight' | 'size'>, pageHeightPx: number): string => `${snapWeight(el.font, el.weight)} ${el.size * pageHeightPx}px ${fontStack(el.font)}`;
export const LINE_HEIGHT = 1.2;

/* ---------- loading ---------- */

const loads = new Map<string, Promise<unknown>>();
/**
 * Make sure the bundled web fonts for these (font, weight) pairs are loaded before text is drawn on a canvas.
 * Cached per family/weight; resolves quietly (system fallback) when the font API is unavailable or a load fails.
 */
export function ensureFonts(items: Iterable<{ font: FontKey; weight: number }>): Promise<void> {
  if (typeof document === 'undefined' || !document.fonts?.load) return Promise.resolve();
  const jobs: Promise<unknown>[] = [];
  for (const { font, weight } of items) {
    const def = FONTS[font];
    if (!def?.family) continue;
    const spec = `${snapWeight(font, weight)} 32px "${def.family}"`;
    let p = loads.get(spec);
    if (!p) {
      p = document.fonts.load(spec, 'AaBbCc THE FAROES 0123').catch(() => []);
      loads.set(spec, p);
    }
    jobs.push(p);
  }
  return Promise.all(jobs).then(() => undefined);
}
