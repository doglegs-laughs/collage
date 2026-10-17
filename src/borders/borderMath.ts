/** Pure border geometry for batch border export. No DOM access, so it runs under Vitest in node. */

export type BorderShape = 'original' | '1:1' | '4:5' | '9:16';
export type LongEdge = 'original' | 2160 | 1080;

export type BorderOptions = {
  /** Border width as a percentage of the photo's long edge (0..20). */
  borderPct: number;
  /** 'original' keeps an even border on all sides; the others fit the photo into that aspect (width:height). */
  shape: BorderShape;
  /** Output canvas long edge in px, or 'original' for the size the border implies at native resolution. */
  longEdge: LongEdge;
};

export type Size = { width: number; height: number };

/** Canvas size plus the photo rectangle inside it, all integers. */
export type BorderLayout = { canvasW: number; canvasH: number; x: number; y: number; w: number; h: number };

const RATIO: Record<Exclude<BorderShape, 'original'>, [number, number]> = {
  '1:1': [1, 1],
  '4:5': [4, 5],
  '9:16': [9, 16],
};

export function borderLayout(photo: Size, opts: BorderOptions): BorderLayout {
  const pw = Math.max(1, Math.round(photo.width));
  const ph = Math.max(1, Math.round(photo.height));
  const b = Math.round((Math.max(0, opts.borderPct) / 100) * Math.max(pw, ph));

  // Canvas before scaling, in source pixels.
  let W: number;
  let H: number;
  if (opts.shape === 'original') {
    W = pw + 2 * b;
    H = ph + 2 * b;
  } else {
    // Smallest canvas of this aspect that holds the photo plus b on every side.
    const [rw, rh] = RATIO[opts.shape];
    const k = Math.max((pw + 2 * b) / rw, (ph + 2 * b) / rh);
    W = Math.ceil(k * rw - 1e-9);
    H = Math.ceil(k * rh - 1e-9);
  }
  const x = Math.floor((W - pw) / 2);
  const y = Math.floor((H - ph) / 2);

  // Uniform scale so the long edge hits the target. 'original' never rescales.
  const target = opts.longEdge === 'original' ? Math.max(W, H) : opts.longEdge;
  const s = target / Math.max(W, H);
  const canvasW = Math.round(W * s);
  const canvasH = Math.round(H * s);
  const ox = Math.round(x * s);
  const oy = Math.round(y * s);
  const w = Math.max(1, Math.min(Math.round(pw * s), canvasW - ox));
  const h = Math.max(1, Math.min(Math.round(ph * s), canvasH - oy));
  return { canvasW, canvasH, x: ox, y: oy, w, h };
}

/** Output base name for a source file: `IMG_1.heic` gives `IMG_1-border`. */
export function borderStem(fileName: string): string {
  const stem = fileName.replace(/\.[^./\\]+$/, '') || fileName;
  return `${stem}-border`;
}

/**
 * First free `<stem>.jpg`, then `<stem> 2.jpg`, `<stem> 3.jpg`, ...
 * `exists` may be sync or async (for example a wrapper around api.exists).
 */
export async function uniqueName(stem: string, exists: (name: string) => boolean | Promise<boolean>): Promise<string> {
  let name = `${stem}.jpg`;
  for (let n = 2; await exists(name); n++) name = `${stem} ${n}.jpg`;
  return name;
}
