import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { getPreviewBitmap, type Photo } from '../core/images';
import { applyLayout, layoutOptions, layoutSignature, pageSeed, type LayoutOption } from './layouts';
import { addPhotos, aspectRatio, groupOf, type Story } from './model';
import { renderPage } from './render';

/** Width of one page in a thumbnail, CSS px (rendered at 2x). */
const TILE_W = 96;
const MAX_SHOWN_PAGES = 3;
const CACHE_MAX = 400;

const cache = new Map<string, string>();
const inflight = new Map<string, Promise<string | null>>();

/** Draw the option as it would look on the page: the page(s) of the offscreen story that applyLayout makes. */
async function renderOption(story: Story, pageIndex: number, option: LayoutOption, extra: Photo[]): Promise<string | null> {
  const seed = pageSeed(story, pageIndex);
  const base = addPhotos(story, extra);
  const r = applyLayout(base, pageIndex, option, { seed, extraPhotoIds: extra.map((p) => p.id) });
  const start = groupOf(base, pageIndex).start;
  const count = Math.min(option.pages, MAX_SHOWN_PAGES);
  const mini: Story = { ...r.story, pages: r.story.pages.slice(start, start + count) };
  const w = TILE_W * 2;
  const gap = 4;
  const shown = mini.pages.length;
  let out: HTMLCanvasElement | null = null;
  for (let i = 0; i < shown; i++) {
    const c = (await renderPage(mini, i, w, getPreviewBitmap)) as HTMLCanvasElement;
    if (!out) {
      out = document.createElement('canvas');
      out.width = shown * c.width + (shown - 1) * gap;
      out.height = c.height;
      const g = out.getContext('2d')!;
      g.fillStyle = '#d3d9e3';
      g.fillRect(0, 0, out.width, out.height);
    }
    out.getContext('2d')!.drawImage(c, i * (c.width + gap), 0);
  }
  return out ? out.toDataURL('image/jpeg', 0.82) : null;
}

/** Thumbnails (data URLs) for each option, rendered one at a time so the picker opens at once and fills in. */
function useOptionThumbs(story: Story, pageIndex: number, options: LayoutOption[], extra: Photo[]): Map<string, string> {
  const [, bump] = useState(0);
  const latest = useRef(story);
  latest.current = story;
  const sig = useMemo(() => layoutSignature(story, pageIndex) + '|' + extra.map((p) => p.id).join(','), [story, pageIndex, extra]);
  const keyOf = (o: LayoutOption) => `${o.id}|${sig}`;

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      for (const o of options) {
        if (cancelled) return;
        const key = `${o.id}|${sig}`;
        if (cache.has(key)) continue;
        let job = inflight.get(key);
        if (!job) {
          job = renderOption(latest.current, pageIndex, o, extra).catch(() => null);
          inflight.set(key, job);
        }
        const url = await job;
        inflight.delete(key);
        if (url) {
          cache.set(key, url);
          if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
        }
        if (cancelled) return;
        bump((n) => n + 1);
        await new Promise((res) => window.setTimeout(res, 0));
      }
    }, 30);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [sig, options, pageIndex, extra]);

  const out = new Map<string, string>();
  for (const o of options) {
    const url = cache.get(keyOf(o));
    if (url) out.set(o.id, url);
  }
  return out;
}

type Props = {
  story: Story;
  pageIndex: number;
  /** Library photos not on any page yet; used to fill extra slots in "more photos" layouts. */
  extraPhotos: Photo[];
  onApply: (option: LayoutOption) => void;
  /** Escape closes (popover use). */
  onClose?: () => void;
  autoFocus?: boolean;
  testId?: string;
};

/** Grid of layout thumbnails for the page. Arrows move, Enter applies, Esc closes. */
export function LayoutPicker({ story, pageIndex, extraPhotos, onApply, onClose, autoFocus, testId = 'layout-picker' }: Props) {
  const options = useMemo(() => layoutOptions(story, pageIndex), [story, pageIndex]);
  const thumbs = useOptionThumbs(story, pageIndex, options, extraPhotos);
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.current)));
  const ar = aspectRatio(story.aspect);
  const same = options.filter((o) => !o.slotsDiffer);
  const differ = options.filter((o) => o.slotsDiffer);

  useEffect(() => {
    // Opens scrolled to the top (the best fits); the current layout is marked wherever it sits.
    if (autoFocus) root.current?.querySelectorAll<HTMLElement>('[data-layout-tile]')[Math.max(0, options.findIndex((o) => o.current))]?.focus({ preventScroll: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const focusTile = (i: number) => {
    setActive(i);
    const el = root.current?.querySelectorAll<HTMLElement>('[data-layout-tile]')[i];
    el?.focus();
    el?.scrollIntoView({ block: 'nearest' });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    const tiles = [...(root.current?.querySelectorAll<HTMLElement>('[data-layout-tile]') ?? [])];
    const at = tiles.findIndex((t) => t === document.activeElement);
    if (e.key === 'Escape' && onClose) { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    if (!e.key.startsWith('Arrow') || at < 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'ArrowRight') return focusTile(Math.min(tiles.length - 1, at + 1));
    if (e.key === 'ArrowLeft') return focusTile(Math.max(0, at - 1));
    const down = e.key === 'ArrowDown';
    const cur = tiles[at].getBoundingClientRect();
    const rects = tiles.map((t) => t.getBoundingClientRect());
    const rows = rects.map((r, i) => ({ r, i })).filter(({ r }) => (down ? r.top > cur.top + 4 : r.top < cur.top - 4));
    if (!rows.length) return;
    const rowTop = down ? Math.min(...rows.map(({ r }) => r.top)) : Math.max(...rows.map(({ r }) => r.top));
    const inRow = rows.filter(({ r }) => Math.abs(r.top - rowTop) < 4);
    inRow.sort((a, b) => Math.abs(a.r.left - cur.left) - Math.abs(b.r.left - cur.left));
    focusTile(inRow[0].i);
  };

  if (options.length === 0) return <p className="hint lp-empty">This page has no photos to lay out.</p>;
  const tile = (o: LayoutOption) => {
    const i = options.indexOf(o);
    const shown = Math.min(o.pages, MAX_SHOWN_PAGES);
    const url = thumbs.get(o.id);
    return (
      <button
        key={o.id} type="button" className={`lp-tile ${o.current ? 'current' : ''} ${shown > 1 ? 'wide' : ''}`}
        data-layout-tile data-testid="layout-option" data-option-id={o.id} data-current={o.current} title={o.name}
        tabIndex={i === active ? 0 : -1} aria-pressed={o.current} aria-label={o.name}
        onFocus={() => setActive(i)} onClick={() => onApply(o)}
      >
        <span className="lp-thumb" style={{ aspectRatio: String(shown * ar) }}>
          {url ? <img src={url} alt="" draggable={false} /> : <span className="lp-wait" />}
        </span>
        <span className="lp-name">{o.name}</span>
        {o.pages > 1 && <span className="lp-pages">{o.pages} pages</span>}
      </button>
    );
  };
  return (
    <div ref={root} className="lp" data-testid={testId} role="group" aria-label="Page layouts" onKeyDown={onKeyDown}>
      <h3 className="lp-head">Same photos</h3>
      <div className="lp-grid">{same.map(tile)}</div>
      {differ.length > 0 && (
        <>
          <h3 className="lp-head">More or fewer photos</h3>
          <div className="lp-grid">{differ.map(tile)}</div>
        </>
      )}
    </div>
  );
}
