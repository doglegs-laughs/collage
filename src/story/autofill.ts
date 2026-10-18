import { aspectRatio, makeRng, setPages, type Aspect, type El, type Page, type Photo, type PhotoEl, type StyleId, type Story, type TextEl } from './model';
import { getArrangement, scoreOf, W } from './arrangements';
import type { Orient } from './layoutKit';
import { getTemplate, orientationOf, templateFor, WIDE_RATIO, type LayoutOpts, type Template } from './templates';
import type { FinishId } from './templateAliases';

export type AutofillOpts = { style: StyleId; aspect: Aspect; title?: string; subtitle?: string; seed: number; gap?: number; margin?: number };

const PAGE_SECONDS = 3;
const MAX_WINDOW = 4;
/** An arrangement with a finish, and how well it suits the next photos (default: the arrangement's own score). */
type Choice = { arrangement: string; finish: FinishId | null; fit?: (o: Orient[], aspect?: Aspect) => number };
const pick = (arrangement: string, finish: FinishId | null = null, fit?: Choice['fit']): Choice => ({ arrangement, finish, fit });
const scaled = (arr: string, k: number): Choice['fit'] => (o, a) => k * getArrangement(arr)!.fits(o, a);
const allOf = (o: Orient[], n: number, x: Orient) => o.length >= n && o.slice(0, n).every((v) => v === x);

/**
 * What auto-fill may pick per style, as weighted (arrangement, finish) choices.
 * Clean stays white and restrained; Stylized adds black borders, print mats, shadows and tight stacks.
 */
export const STYLE_CHOICES: Record<StyleId, Choice[]> = {
  clean: [pick('inset-single', 'plain'), pick('single', 'plain', scoreOf(W(0.6, 0.55, 0.7), 1)), pick('stack-2', 'plain'), pick('stack-3', 'plain'), pick('stack-2', 'black', scaled('stack-2', 0.95)), pick('stack-3', 'black', scaled('stack-3', 0.95)), pick('pair-side', 'plain')],
  stylized: [
    pick('single', 'frame', scoreOf(W(0.45, 1, 0.7), 1)), pick('single', 'shadow', scoreOf(W(1, 0.2, 0.6), 1)),
    pick('stack-2', 'mat'), pick('stack-3', 'mat'), pick('triptych', 'mat', (o) => (allOf(o, 3, 'p') ? 1 : 0)),
    pick('grid-2x2', 'mat', (o) => (o.length < 4 ? 0 : new Set(o.slice(0, 4)).size > 1 ? 0.3 : o[0] === 's' ? 0.6 : 1)),
    pick('stack-2', 'black', scaled('stack-2', 0.95)), pick('stack-3', 'black', scaled('stack-3', 0.95)),
    pick('polaroid-on-photo'), pick('seamless-split'), pick('stack-2', 'tight'), pick('stack-3', 'tight'), pick('polaroid-scatter'),
  ],
  carousel: [pick('stack-2', 'plain'), pick('stack-3', 'plain'), pick('single', 'frame', scoreOf(W(0.45, 1, 0.7), 1)), pick('seamless-split'), pick('single', 'plain', scoreOf(W(0.6, 0.55, 0.7), 1)), pick('inset-single', 'plain')],
  gallery: [pick('pair-stacked', 'plain'), pick('pair-side', 'plain'), pick('trio', 'plain'), pick('triptych', 'plain'), pick('grid-2x2', 'plain'), pick('inset-single', 'plain'), pick('single', 'plain', scoreOf(W(0.6, 0.55, 0.7), 1))],
  film: [pick('film-strip'), pick('film-strip-4'), pick('single', 'plain', scoreOf(W(0.6, 0.55, 0.7), 1)), pick('single', 'frame', scoreOf(W(0.45, 1, 0.7), 1))],
  polaroid: [pick('polaroid-scatter'), pick('polaroid-scatter-2'), pick('polaroid-on-photo'), pick('single', 'plain', scoreOf(W(0.6, 0.55, 0.7), 1)), pick('single', 'frame', scoreOf(W(0.45, 1, 0.7), 1))],
  magazine: [pick('magazine'), pick('inset-single', 'plain'), pick('single', 'plain', scoreOf(W(0.6, 0.55, 0.7), 1))],
};
/** Template plus its fit function for a choice. */
const resolveChoice = (c: Choice) => ({ t: templateFor(getArrangement(c.arrangement)!, c.finish), fit: c.fit ?? getArrangement(c.arrangement)!.fits });
/** Identity for the no-three-in-a-row rule: arrangement and finish together. */
export const templateKey = (t: { id: string; finish: FinishId | null }) => `${t.id}/${t.finish ?? ''}`;

const isWide = (p: Photo) => p.width / p.height > WIDE_RATIO;

function makeId(rng: () => number): string {
  return 'x' + Math.floor(rng() * 0x7fffffff).toString(36) + Math.floor(rng() * 0x7fffffff).toString(36);
}

/** Lay a template out into pages; ids are drawn from `rng` so output is deterministic per seed. */
export function buildPages(t: Template, aspect: Aspect, photos: Photo[], opts: LayoutOpts, rng: () => number): Page[] {
  const res = t.layout(aspect, photos, { ...opts, seed: Math.floor(rng() * 1e9) });
  return res.pages.map((els, i) => ({
    id: makeId(rng),
    templateId: t.id,
    ...(t.finish ? { finish: t.finish } : {}),
    background: res.backgrounds[i],
    elements: els.map((e): El => ({ ...e, id: makeId(rng) })),
    duration: PAGE_SECONDS,
    ...(t.pageCount > 1 ? { spread: { index: i, count: t.pageCount } } : {}),
  }));
}

/**
 * Distribute photos (in order, each exactly once) over pages for a style.
 * 0 photos gives a title card when a title is set, otherwise no pages.
 */
export function makeStory(photos: Photo[], o: AutofillOpts): Page[] {
  const rng = makeRng(o.seed);
  const A = aspectRatio(o.aspect);
  const base: LayoutOpts = { gap: o.gap, margin: o.margin };
  const title = o.title?.trim() || undefined;
  const subtitle = o.subtitle?.trim() || undefined;
  const out: Page[] = [];
  const hist: string[] = [];
  const emit = (t: Template, ps: Photo[], extra: LayoutOpts = {}) => {
    out.push(...buildPages(t, o.aspect, ps, { ...base, ...extra }, rng));
    hist.push(templateKey(t));
  };
  const T = (id: string) => getTemplate(id)!;

  if (photos.length === 0) {
    if (title) emit(T('title-card'), [], { title, subtitle });
    return out;
  }

  let i = 0;
  if (title) {
    if (o.style === 'stylized' && photos.length >= 2 && rng() < 0.4) {
      emit(T('polaroid-on-photo'), photos.slice(0, 2), { caption: title });
      i = 2;
    } else {
      emit(T(o.style === 'stylized' ? 'cover-sans' : orientationOf(photos[0]) === 'l' ? 'cover-border' : 'cover'), [photos[0]], { title, subtitle });
      i = 1;
    }
  }

  // Only when enough photos remain for real pages before the contents slide (7 photos + title must not collapse to 2 pages).
  const overview = o.style === 'clean' && photos.length - i >= 9;
  const end = overview ? photos.length - 6 : photos.length;
  const usePano = (o.style === 'clean' || o.style === 'carousel') && A < 1.3;
  const candidates = STYLE_CHOICES[o.style].map(resolveChoice);
  const blocked = (t: Template) => hist.length >= 2 && hist[hist.length - 1] === templateKey(t) && hist[hist.length - 2] === templateKey(t);

  while (i < end) {
    if (usePano && isWide(photos[i])) {
      const pano = T(photos[i].width / photos[i].height > 3.2 ? 'pano-3' : 'pano-2');
      if (!blocked(pano)) {
        emit(pano, [photos[i]]);
        i += 1;
        continue;
      }
    }
    let n = 1;
    while (n < Math.min(MAX_WINDOW, end - i) && !(usePano && isWide(photos[i + n]))) n++;
    const win = photos.slice(i, i + n);
    const orient = win.map(orientationOf);
    let best: Template | null = null;
    let bestScore = -1;
    for (const { t, fit } of candidates) {
      if (t.slots > win.length || blocked(t)) continue;
      const s = fit(orient, o.aspect);
      if (s <= 0) continue;
      const bonus = o.style === 'clean' && s >= 0.9 && t.slots >= 2 ? 0.2 * t.slots : 0.02 * t.slots;
      const total = s + rng() * (o.style === 'clean' ? 0.15 : 0.3) + bonus;
      if (total > bestScore) {
        best = t;
        bestScore = total;
      }
    }
    if (!best) best = candidates.find(({ t }) => t.slots === 1 && !blocked(t))?.t ?? T('single-border');
    emit(best, win.slice(0, best.slots));
    i += best.slots;
  }
  if (overview) emit(T('overview-grid'), photos.slice(end));
  return out;
}
export const autofill = makeStory;

/** Replace one single-page layout with another template that takes the same number of photos. Returns the story unchanged when none applies. */
export function shuffleLayout(story: Story, pageIndex: number, seed: number): Story {
  const page = story.pages[pageIndex];
  if (!page || page.spread) return story;
  const cur = getTemplate(page.templateId, page.finish);
  if (cur && cur.pageCount > 1) return story;
  const byId = new Map(story.photos.map((p) => [p.id, p]));
  const photos = page.elements
    .filter((e): e is PhotoEl => e.kind === 'photo')
    .map((e) => (e.photoId ? byId.get(e.photoId) : undefined))
    .filter((p): p is Photo => !!p);
  const texts = page.elements.filter((e): e is TextEl => e.kind === 'text' && !!e.text);
  const title = texts[0]?.text;
  const subtitle = texts[1]?.text;
  if (photos.length === 0) return story;
  const rng = makeRng(seed);
  const orient = photos.map(orientationOf);
  const extras: Choice[] = [
    pick('cover'), pick('cover-sans'), pick('cover-border'), pick('cover-border-below'), pick('cover-mat'), pick('single', 'bleed'), pick('magazine'),
    pick('pair-stacked', 'plain'), pick('trio', 'plain'), pick('triptych', 'plain'), pick('grid-2x2', 'plain'), pick('grid-3x3', 'plain'),
    pick('polaroid-scatter-2'), pick('film-strip'), pick('film-strip-4'),
  ];
  const all = [...STYLE_CHOICES.clean, ...STYLE_CHOICES.stylized, ...extras].map(resolveChoice);
  const unique = [...new Map(all.map((x) => [templateKey(x.t), x])).values()].filter(({ t }) => t.pageCount === 1 && t.slots === photos.length && (title || !t.id.startsWith('cover')));
  // A different arrangement when there is one; otherwise the same arrangement in another finish.
  const other = unique.filter(({ t }) => t.id !== cur?.id);
  const pool = other.length ? other : unique.filter(({ t }) => templateKey(t) !== (cur ? templateKey(cur) : ''));
  let best: Template | null = null;
  let bestScore = -1;
  for (const { t, fit } of pool) {
    const s = fit(orient, story.aspect);
    if (s <= 0) continue;
    const total = s + rng() * 0.6;
    if (total > bestScore) {
      best = t;
      bestScore = total;
    }
  }
  if (!best) return story;
  const [fresh] = buildPages(best, story.aspect, photos, { title, subtitle, caption: title }, rng);
  return setPages(story, story.pages.map((p, k) => (k === pageIndex ? { ...withoutFinish(p), templateId: best!.id, ...(best!.finish ? { finish: best!.finish } : {}), background: fresh.background, elements: fresh.elements } : p)));
}

const withoutFinish = ({ finish: _f, ...p }: Page): Page => p;
