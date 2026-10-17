import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../ui/Controls';

type Props = {
  visible: boolean;
  hasPages: boolean;
  busy: boolean;
  onOpen: () => void;
  onSave: () => void;
  onImages: () => void;
  onVideo: () => void;
};

/** Open / Save / Export controls, rendered into the shared top bar only while the Story tab shows. */
export function StoryTopbar(p: Props) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => setHost(document.getElementById('topbar-actions')), []);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [open]);
  if (!host || !p.visible) return null;
  const pick = (fn: () => void) => () => { setOpen(false); fn(); };
  return createPortal(
    <>
      <Button onClick={p.onOpen} title="Open a story project (⌘O)" data-testid="story-open">Open</Button>
      <Button onClick={p.onSave} disabled={!p.hasPages} title="Save the story project (⌘S)" data-testid="story-save">Save</Button>
      <div className="menu-wrap" ref={wrap}>
        <Button variant="primary" disabled={!p.hasPages || p.busy} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} data-testid="story-export">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 3v10M5.5 8.5 10 13l4.5-4.5M4 16.5h12" /></svg>
          <span>Export</span>
        </Button>
        {open && (
          <div className="menu" role="menu">
            <button type="button" role="menuitem" onClick={pick(p.onImages)} data-testid="export-images-item">Export images…</button>
            <button type="button" role="menuitem" onClick={pick(p.onVideo)} data-testid="export-video-item">Export video…</button>
          </div>
        )}
      </div>
    </>,
    host,
  );
}
