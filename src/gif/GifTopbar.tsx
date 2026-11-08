import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../ui/Controls';

type Props = {
  visible: boolean;
  canExport: boolean;
  disabledReason: string;
  /** Percent done while exporting, otherwise null. */
  progress: number | null;
  onExport: () => void;
  onCancel: () => void;
};

/** Export control rendered into the shared top bar, only while the GIF tab is showing. */
export function GifTopbar(p: Props) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.getElementById('topbar-actions')), []);
  if (!host || !p.visible) return null;
  const working = p.progress !== null;
  return createPortal(
    <>
      {working && <Button onClick={p.onCancel} data-testid="gif-cancel">Cancel</Button>}
      <Button variant="primary" disabled={!p.canExport || working} busy={working} onClick={p.onExport} title={p.canExport ? 'Save the animation as a GIF' : p.disabledReason} data-testid="gif-export">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 3v10M5.5 8.5 10 13l4.5-4.5M4 16.5h12" /></svg>
        <span>{working ? `${p.progress}%` : 'Export'}</span>
      </Button>
    </>,
    host,
  );
}
