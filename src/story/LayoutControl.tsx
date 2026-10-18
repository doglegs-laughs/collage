import { useEffect, useMemo, useRef, useState } from 'react';
import type { Photo } from '../core/images';
import { LayoutPicker } from './LayoutPicker';
import { currentLayoutName, nextLayout, type LayoutTarget } from './layouts';
import type { Story } from './model';

type Props = {
  story: Story;
  pageIndex: number;
  extraPhotos: Photo[];
  onApply: (option: LayoutTarget) => void;
  onCycle: (direction: 1 | -1) => void;
};

/** Toolbar split control: previous layout, the layout name (opens the picker), next layout. */
export function LayoutControl({ story, pageIndex, extraPhotos, onApply, onCycle }: Props) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const name = currentLayoutName(story, pageIndex);
  const canCycle = useMemo(() => !!nextLayout(story, pageIndex, 1), [story, pageIndex]);

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', away);
    return () => window.removeEventListener('pointerdown', away);
  }, [open]);
  useEffect(() => setOpen(false), [pageIndex]);

  const close = () => { setOpen(false); button.current?.focus(); };
  return (
    <div className="menu-wrap layout-control" ref={wrap}>
      <div className="split" role="group" aria-label="Page layout">
        <button type="button" className="btn split-arrow" disabled={!canCycle} onClick={() => onCycle(-1)} title="Previous arrangement ([); { and } change the finish" aria-label="Previous layout" data-testid="layout-prev">‹</button>
        <button
          ref={button} type="button" className="btn split-main" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((o) => !o)}
          title="Choose a layout for this page" data-testid="layout-button"
        >
          <span className="split-label">Layout:</span> <span className="split-name" data-testid="layout-name">{name}</span>
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m5 8 5 5 5-5" /></svg>
        </button>
        <button type="button" className="btn split-arrow" disabled={!canCycle} onClick={() => onCycle(1)} title="Next arrangement (]); { and } change the finish" aria-label="Next layout" data-testid="layout-next">›</button>
      </div>
      {open && (
        <div className="layout-pop" role="dialog" aria-label="Choose a layout" data-testid="layout-popover">
          <LayoutPicker
            story={story} pageIndex={pageIndex} extraPhotos={extraPhotos} autoFocus testId="layout-popover-picker"
            onApply={(o, how) => { onApply(o); if (!how?.keepOpen) { setOpen(false); button.current?.focus(); } }} onClose={close}
          />
        </div>
      )}
    </div>
  );
}
