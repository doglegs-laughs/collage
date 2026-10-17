import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../ui/Controls';

type Props = {
  visible: boolean;
  outputLabel: string;
  canExport: boolean;
  disabledReason: string;
  busy: null | 'export' | 'story';
  progress: string;
  onExport: () => void;
  onSendToStory: () => void;
};

/** Export controls rendered into the shared top bar, only while the Collage tab is showing. */
export function TopbarActions(p: Props) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => setHost(document.getElementById('topbar-actions')), []);
  if (!host || !p.visible) return null;
  const working = p.busy !== null;
  return createPortal(
    <>
      <span className="collage-chip" data-testid="output-chip" title="Size of the exported image">{p.outputLabel}</span>
      <Button disabled={!p.canExport || working} busy={p.busy === 'story'} onClick={p.onSendToStory} title={p.canExport ? 'Add the collage to the Story photos' : p.disabledReason} data-testid="send-to-story">
        Send to Story
      </Button>
      <Button variant="primary" disabled={!p.canExport || working} busy={p.busy === 'export'} onClick={p.onExport} title={p.canExport ? 'Save the collage as a JPEG' : p.disabledReason} data-testid="export-button">
        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M10 3v10M5.5 8.5 10 13l4.5-4.5M4 16.5h12" /></svg>
        <span>{p.busy && p.progress ? p.progress : 'Export'}</span>
      </Button>
    </>,
    host,
  );
}
