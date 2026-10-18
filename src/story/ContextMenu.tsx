import { useEffect, useRef, useState } from 'react';

export type MenuItem = { label: string; onSelect: () => void; disabled?: boolean; title?: string; separator?: boolean };
type Props = { x: number; y: number; items: MenuItem[]; onClose: () => void; label?: string };

/** Small right-click menu: arrow keys move, Enter/Space picks, Esc or a click elsewhere closes. */
export function ContextMenu({ x, y, items, onClose, label = 'Element actions' }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const enabled = items.map((it, i) => (it.disabled ? -1 : i)).filter((i) => i >= 0);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({ left: Math.max(4, Math.min(x, window.innerWidth - r.width - 4)), top: Math.max(4, Math.min(y, window.innerHeight - r.height - 4)) });
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [x, y]);

  useEffect(() => {
    const away = (e: Event) => { if (!ref.current?.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); } };
    window.addEventListener('pointerdown', away, true);
    window.addEventListener('contextmenu', away, true);
    window.addEventListener('keydown', key, true);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      window.removeEventListener('pointerdown', away, true);
      window.removeEventListener('contextmenu', away, true);
      window.removeEventListener('keydown', key, true);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
    if (!btns.length) return;
    const at = btns.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? btns.length - 1 : (at + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length;
    btns[next].focus();
  };

  return (
    <div ref={ref} className="ctx-menu" role="menu" aria-label={label} data-testid="context-menu" style={pos} onKeyDown={onKeyDown} onContextMenu={(e) => e.preventDefault()}>
      {items.map((it, i) => (
        <div key={it.label} role="none">
          {it.separator && i > 0 && <hr className="ctx-sep" />}
          <button
            type="button" role="menuitem" disabled={it.disabled} title={it.title} tabIndex={enabled.length && enabled[0] === i ? 0 : -1}
            onClick={() => { onClose(); it.onSelect(); }}
          >
            {it.label}
          </button>
        </div>
      ))}
    </div>
  );
}
