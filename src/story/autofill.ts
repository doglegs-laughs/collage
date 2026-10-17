import { aspectRatio, makeRng, setPages, type Aspect, type El, type Page, type Photo, type PhotoEl, type StyleId, type Story, type TextEl } from './model';
import { getTemplate, orientationOf, templatesForStyle, WIDE_RATIO, type LayoutOpts, type Template } from './templates';

export type AutofillOpts = { style: StyleId; aspect: Aspect; title?: string; subtitle?: string; seed: number; gap?: number; margin?: number };

const PAGE_SECONDS = 3;
const MAX_WINDOW = 4;
const isWide = (p: Photo) => p.width / p.height > WIDE_RATIO;

function makeId(rng: () => number): string {
  return 'x' + Math.floor(rng() * 0x7fffffff).toString(36) + Math.floor(rng() * 0x7fffffff).toString(36);
}

/** Lay a template out into pages; ids are drawn from `rng` so output is deterministic per seed. */
function buildPages(t: Template, aspect: Aspect, photos: Photo[], opts: LayoutOpts, rng: () => number): Page[] {
  const res = t.layout(aspect, photos, { ...opts, seed: Math.floor(rng() * 1e9) });
  return res.pages.map((els, i) => ({
    id: makeId(rng),
    templateId: t.id,
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
    hist.push(t.id);
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
      emit(T(o.style === 'stylized' ? 'cover-sans' : 'cover'), [photos[0]], { title, subtitle });
      i = 1;
    }
  }

  const overview = o.style === 'clean' && photos.length - i >= 6;
  const end = overview ? photos.length - 6 : photos.length;
  const usePano = (o.style === 'clean' || o.style === 'carousel') && A < 1.3;
  const candidates = templatesForStyle(o.style);
  const blocked = (id: string) => hist.length >= 2 && hist[hist.length - 1] === id && hist[hist.length - 2] === id;

  while (i < end) {
    if (usePano && isWide(photos[i])) {
      const pano = T(photos[i].width / photos[i].height > 3.2 ? 'pano-3' : 'pano-2');
      if (!blocked(pano.id)) {
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
    for (const t of candidates) {
      if (t.slots > win.length || blocked(t.id)) continue;
      const s = t.fits(orient, o.aspect);
      if (s <= 0) continue;
      const bonus = o.style === 'clean' && s >= 0.9 && t.slots >= 2 ? 0.2 * t.slots : 0.02 * t.slots;
      const total = s + rng() * (o.style === 'clean' ? 0.15 : 0.3) + bonus;
      if (total > bestScore) {
        best = t;
        bestScore = total;
      }
    }
    if (!best) best = candidates.find((t) => t.slots === 1 && !blocked(t.id)) ?? T('single-border');
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
  const cur = getTemplate(page.templateId);
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
  const options = (getAll: Template[]) =>
    getAll.filter((t) => t.pageCount === 1 && t.slots === photos.length && t.id !== page.templateId && (title || !t.id.startsWith('cover')));
  const all = options(templatesForStyle('clean').concat(templatesForStyle('stylized'), ['cover', 'cover-sans', 'single-bleed', 'magazine', 'pair-stacked', 'trio', 'triptych', 'grid-2x2', 'grid-3x3', 'polaroid-scatter-2', 'film-strip', 'film-strip-4'].map((id) => getTemplate(id)!)));
  const unique = [...new Map(all.map((t) => [t.id, t])).values()];
  let best: Template | null = null;
  let bestScore = -1;
  for (const t of unique) {
    const s = t.fits(orient, story.aspect);
    if (s <= 0) continue;
    const total = s + rng() * 0.6;
    if (total > bestScore) {
      best = t;
      bestScore = total;
    }
  }
  if (!best) return story;
  const [fresh] = buildPages(best, story.aspect, photos, { title, subtitle, caption: title }, rng);
  return setPages(story, story.pages.map((p, k) => (k === pageIndex ? { ...p, templateId: best!.id, background: fresh.background, elements: fresh.elements } : p)));
}
