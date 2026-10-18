import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { getPreviewBitmap, type Photo } from '../core/images';
import { GROUP_LABELS, GROUP_ORDER, type Group } from './arrangements';
import { finishLabel, FINISH_INFO, type FinishId } from './finishes';
import { applyLayout, currentOf, layoutOptions, layoutSignature, pageSeed, type LayoutOption, type LayoutTarget } from './layouts';
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
  const keyOf = (o: LayoutOption) => `${o.id}|${o.finish ?? ''}|${sig}`;

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      for (const o of options) {
        if (cancelled) return;
        const key = keyOf(o);
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
  }, [sig, options, pageIndex, extra]); // eslint-disable-line react-hooks/exhaustive-deps

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
  /** An arrangement tile or a finish chip was chosen. Chips keep the picker open (`keepOpen`). */
  onApply: (target: LayoutTarget, how?: { keepOpen?: boolean }) => void;
  /** Escape closes (popover use). */
  onClose?: () => void;
  autoFocus?: boolean;
  testId?: string;
  /** Leaves out the options it rejects (a one-page editor hides multi-page layouts). */
  filter?: (option: LayoutOption) => boolean;
};

type GroupKey = Group | 'more';
/** Sections the user opened or closed, kept for the session (a section holding the current layout is open until the user says otherwise). */
const toggled = new Map<GroupKey, boolean>();

/** Finish chips for the current arrangement, then arrangement tiles in collapsible groups. Tab moves between the chips and the tiles, arrows move within, Enter applies, Esc closes. */
export function LayoutPicker({ story, pageIndex, extraPhotos, onApply, onClose, autoFocus, testId = 'layout-picker', filter }: Props) {
  const options = useMemo(() => (filter ? layoutOptions(story, pageIndex).filter(filter) : layoutOptions(story, pageIndex)), [story, pageIndex, filter]);
  const cur = useMemo(() => currentOf(story, pageIndex), [story, pageIndex]);
  const [ver, rerender] = useState(0);
  const isOpen = (key: GroupKey, items: LayoutOption[]) => toggled.get(key) ?? items.some((o) => o.current);
  const sections = useMemo(() => [
    ...GROUP_ORDER.map((g) => ({ key: g as GroupKey, label: GROUP_LABELS[g], items: options.filter((o) => !o.slotsDiffer && o.group === g) })),
    { key: 'more' as GroupKey, label: 'More or fewer photos', items: options.filter((o) => o.slotsDiffer) },
  ].filter((x) => x.items.length > 0), [options]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const shown = useMemo(() => sections.filter((x) => isOpen(x.key, x.items)).flatMap((x) => x.items), [sections, ver]);
  const thumbs = useOptionThumbs(story, pageIndex, shown, extraPhotos);
  const root = useRef<HTMLDivElement>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [chipFocus, setChipFocus] = useState<FinishId | null>(null);
  const activeTile = shown.find((o) => o.id === activeId) ?? shown.find((o) => o.current) ?? shown[0];
  const ar = aspectRatio(story.aspect);
  const finishes = cur?.arrangement.finishes.length && cur.arrangement.finishes.length > 1 ? cur.arrangement.finishes : [];

  useEffect(() => {
    if (autoFocus) root.current?.querySelector<HTMLElement>('[data-layout-tile][tabindex="0"]')?.focus({ preventScroll: true });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const tilesEl = () => [...(root.current?.querySelectorAll<HTMLElement>('[data-layout-tile]') ?? [])];
  const focusTile = (el: HTMLElement | undefined) => {
    if (!el) return;
    setActiveId(el.dataset.optionId ?? null);
    el.focus();
    el.scrollIntoView({ block: 'nearest' });
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && onClose) { e.preventDefault(); e.stopPropagation(); onClose(); return; }
    const t = e.target as HTMLElement;
    if (t.dataset.finishChip !== undefined) {
      const chips = [...(root.current?.querySelectorAll<HTMLElement>('[data-finish-chip]') ?? [])];
      const at = chips.indexOf(t);
      const to = e.key === 'ArrowRight' ? Math.min(chips.length - 1, at + 1) : e.key === 'ArrowLeft' ? Math.max(0, at - 1) : e.key === 'Home' ? 0 : e.key === 'End' ? chips.length - 1 : -1;
      if (to >= 0) { e.preventDefault(); e.stopPropagation(); chips[to].focus(); }
      return;
    }
    const tiles = tilesEl();
    const at = tiles.indexOf(document.activeElement as HTMLElement);
    if (!e.key.startsWith('Arrow') || at < 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'ArrowRight') return focusTile(tiles[Math.min(tiles.length - 1, at + 1)]);
    if (e.key === 'ArrowLeft') return focusTile(tiles[Math.max(0, at - 1)]);
    const down = e.key === 'ArrowDown';
    const curR = tiles[at].getBoundingClientRect();
    const rects = tiles.map((x) => x.getBoundingClientRect());
    const rows = rects.map((r, i) => ({ r, i })).filter(({ r }) => (down ? r.top > curR.top + 4 : r.top < curR.top - 4));
    if (!rows.length) return;
    const rowTop = down ? Math.min(...rows.map(({ r }) => r.top)) : Math.max(...rows.map(({ r }) => r.top));
    const inRow = rows.filter(({ r }) => Math.abs(r.top - rowTop) < 4);
    inRow.sort((a, b) => Math.abs(a.r.left - curR.left) - Math.abs(b.r.left - curR.left));
    focusTile(tiles[inRow[0].i]);
  };

  if (options.length === 0) return <p className="hint lp-empty">This page has no photos to lay out.</p>;
  const tile = (o: LayoutOption) => {
    const sh = Math.min(o.pages, MAX_SHOWN_PAGES);
    const url = thumbs.get(o.id);
    return (
      <button
        key={o.id} type="button" className={`lp-tile ${o.current ? 'current' : ''} ${sh > 1 ? 'wide' : ''}`}
        data-layout-tile data-testid="layout-option" data-option-id={o.id} data-current={o.current} data-finish={o.finish ?? ''} title={o.name}
        tabIndex={o.id === activeTile?.id ? 0 : -1} aria-pressed={o.current} aria-label={o.name}
        onFocus={() => setActiveId(o.id)} onClick={() => onApply({ arrangement: o.arrangement, finish: o.finish })}
      >
        <span className="lp-thumb" style={{ aspectRatio: String(sh * ar) }}>
          {url ? <img src={url} alt="" draggable={false} /> : <span className="lp-wait" />}
        </span>
        <span className="lp-name">{o.name}</span>
        {o.pages > 1 && <span className="lp-pages">{o.pages} pages</span>}
      </button>
    );
  };
  return (
    <div ref={root} className="lp" data-testid={testId} role="group" aria-label="Page layouts" onKeyDown={onKeyDown}>
      {cur && (
        <div className="lp-finish">
          <h3 className="lp-head">Finish</h3>
          {finishes.length > 0 ? (
            <div className="lp-chips" role="radiogroup" aria-label="Finish" data-testid="finish-chips">
              {finishes.map((f: FinishId) => (
                <button
                  key={f} type="button" role="radio" className={`lp-chip ${cur.finish === f ? 'on' : ''}`} aria-checked={cur.finish === f} title={FINISH_INFO[f].hint}
                  data-finish-chip data-testid="finish-chip" data-finish={f} tabIndex={(chipFocus && finishes.includes(chipFocus) ? chipFocus : cur.finish ?? finishes[0]) === f ? 0 : -1} onFocus={() => setChipFocus(f)}
                  onClick={() => onApply({ arrangement: cur.arrangement.id, finish: f }, { keepOpen: true })}
                >{finishLabel(f)}</button>
              ))}
            </div>
          ) : (
            <p className="hint lp-own">{cur.arrangement.name} has its own look.</p>
          )}
        </div>
      )}
      {sections.map((x) => {
        const open = isOpen(x.key, x.items);
        return (
          <section key={x.key} className="lp-group" data-testid="layout-group" data-group={x.key} data-open={open}>
            <h3 className="lp-head lp-group-head">
              <button
                type="button" className="lp-toggle" aria-expanded={open} data-testid="layout-group-toggle"
                onClick={() => { toggled.set(x.key, !open); rerender((n) => n + 1); }}
              >
                <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m7 5 5 5-5 5" /></svg>
                <span>{x.label}</span>
                <span className="lp-count">{x.items.length}</span>
              </button>
            </h3>
            {open && <div className="lp-grid">{x.items.map(tile)}</div>}
          </section>
        );
      })}
    </div>
  );
}
