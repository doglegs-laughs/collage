/** Leaf module (no imports from the story code) so the model can migrate old template ids when it reads a story. */

/** How a group of photos is presented, independent of where they go. */
export const FINISH_IDS = ['plain', 'tight', 'black', 'frame', 'mat', 'shadow', 'bleed'] as const;
export type FinishId = (typeof FINISH_IDS)[number];
export const isFinishId = (v: unknown): v is FinishId => typeof v === 'string' && (FINISH_IDS as readonly string[]).includes(v);

export type TemplateAlias = {
  arrangement: string;
  finish?: FinishId;
  /** Arrangement to use instead when the page's first photo frame is portrait (print-mat-3 was two layouts in one). */
  portrait?: string;
};

/**
 * Every id a page's `templateId` could hold before the two-axis picker, mapped to (arrangement, finish).
 * Ids that are still arrangement ids map to themselves with their default finish.
 */
export const TEMPLATE_ALIASES: Record<string, TemplateAlias> = {
  cover: { arrangement: 'cover', finish: 'bleed' },
  'cover-sans': { arrangement: 'cover-sans', finish: 'bleed' },
  'cover-border': { arrangement: 'cover-border', finish: 'plain' },
  'cover-border-below': { arrangement: 'cover-border-below', finish: 'plain' },
  'cover-mat': { arrangement: 'cover-mat', finish: 'mat' },
  'title-card': { arrangement: 'title-card' },
  'single-bleed': { arrangement: 'single', finish: 'bleed' },
  'single-border': { arrangement: 'single', finish: 'plain' },
  'inset-single': { arrangement: 'inset-single', finish: 'plain' },
  'matted-single': { arrangement: 'single', finish: 'frame' },
  'framed-portrait': { arrangement: 'single', finish: 'shadow' },
  'pano-2': { arrangement: 'pano-2' },
  'pano-3': { arrangement: 'pano-3' },
  'stack-2': { arrangement: 'stack-2', finish: 'plain' },
  'stack-3': { arrangement: 'stack-3', finish: 'plain' },
  'stack-2-black': { arrangement: 'stack-2', finish: 'black' },
  'stack-3-black': { arrangement: 'stack-3', finish: 'black' },
  'stack-2-tight': { arrangement: 'stack-2', finish: 'tight' },
  'stack-3-tight': { arrangement: 'stack-3', finish: 'tight' },
  'pair-stacked': { arrangement: 'pair-stacked', finish: 'plain' },
  'pair-side': { arrangement: 'pair-side', finish: 'plain' },
  trio: { arrangement: 'trio', finish: 'plain' },
  triptych: { arrangement: 'triptych', finish: 'plain' },
  'grid-2x2': { arrangement: 'grid-2x2', finish: 'plain' },
  'grid-3x3': { arrangement: 'grid-3x3', finish: 'plain' },
  'overview-grid': { arrangement: 'overview-grid', finish: 'plain' },
  'film-strip': { arrangement: 'film-strip' },
  'film-strip-4': { arrangement: 'film-strip-4' },
  'polaroid-scatter': { arrangement: 'polaroid-scatter' },
  'polaroid-scatter-2': { arrangement: 'polaroid-scatter-2' },
  magazine: { arrangement: 'magazine' },
  'polaroid-on-photo': { arrangement: 'polaroid-on-photo' },
  'seamless-split': { arrangement: 'seamless-split' },
  'print-mat': { arrangement: 'stack-2', finish: 'mat' },
  'print-mat-3': { arrangement: 'stack-3', finish: 'mat', portrait: 'triptych' },
  'print-mat-4': { arrangement: 'grid-2x2', finish: 'mat' },
};

/**
 * (arrangement, finish) for a stored template id. Unknown ids come back unchanged with no finish (a page that matches no template).
 * `portrait` says whether the page's photos are portrait frames (only print-mat-3 cares).
 */
export function migrateTemplate(id: string | null, portrait = false): { templateId: string | null; finish?: FinishId } {
  if (!id) return { templateId: id };
  const a = TEMPLATE_ALIASES[id];
  if (!a) return { templateId: id };
  return { templateId: portrait && a.portrait ? a.portrait : a.arrangement, ...(a.finish ? { finish: a.finish } : {}) };
}
