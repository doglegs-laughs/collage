import { useRef, useState } from 'react';
import { useVisible } from '../collage/useVisible';
import { usePasteImages } from '../core/usePasteImages';
import { api } from '../api';
import { usePhotoLibrary } from '../core/library';
import { useToast } from '../ui/Toast';
import { PhotoTray } from '../ui/PhotoTray';
import { Button } from '../ui/Controls';
import { BorderControls, DEFAULT_SETTINGS, type BorderSettings } from './BorderControls';
import { BorderPreview } from './BorderPreview';
import { exportBorders, messageOf, type ExportResult } from './exportBorders';
import { fillFor } from './render';

export function BordersView() {
  const root = useRef<HTMLDivElement>(null);
  const visible = useVisible(root);
  const library = usePhotoLibrary();
  const toast = useToast();
  const [settings, setSettings] = useState<BorderSettings>(DEFAULT_SETTINGS);
  /** Photos are selected by default; this holds the ones the user turned off. */
  const [deselected, setDeselected] = useState<ReadonlySet<string>>(() => new Set());
  const [focusId, setFocusId] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const busy = useRef(false);
  const cancelRequested = useRef(false);

  usePasteImages(visible, (files) => void library.addFiles(files));

  const { photos } = library;
  const batch = photos.filter((p) => !deselected.has(p.id));
  const focusIndex = photos.findIndex((p) => p.id === focusId);
  const shownIndex = focusIndex >= 0 ? focusIndex : 0;
  const current = photos[shownIndex] ?? null;
  const fill = fillFor(settings.color, settings.customColor);

  const update = (patch: Partial<BorderSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const step = (delta: number) => {
    if (!photos.length) return;
    setFocusId(photos[(shownIndex + delta + photos.length) % photos.length].id);
  };
  const toggle = (id: string) => {
    if (deselected.has(id)) setFocusId(id);
    setDeselected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const remove = (id: string) => {
    library.remove(id);
    setDeselected((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  const exportAll = async () => {
    if (!batch.length || busy.current) return;
    busy.current = true;
    try {
      let folder: string | null;
      try {
        folder = await api.chooseFolder();
      } catch (error) {
        toast(messageOf(error), 'error');
        return;
      }
      if (!folder) return;
      cancelRequested.current = false;
      setResult(null);
      setProgress({ done: 0, total: batch.length });
      const out = await exportBorders(batch, {
        options: settings,
        fill,
        folder,
        cancelled: () => cancelRequested.current,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      setResult(out);
      if (!out.written.length && !out.cancelled) toast('No photos could be exported.', 'error');
    } finally {
      setProgress(null);
      busy.current = false;
    }
  };

  const allSelected = batch.length === photos.length;

  return (
    <div ref={root} className="workspace" data-testid="view-borders">
      <aside className="sidebar borders-side">
        <PhotoTray
          className="section"
          photos={photos}
          selected={batch.map((p) => p.id)}
          onToggle={toggle}
          onRemove={remove}
          onImport={() => void library.pick()}
          onDropFiles={(files) => void library.addFiles(files)}
          onSelectAll={() => setDeselected(new Set())}
          onSelectNone={() => setDeselected(new Set(photos.map((p) => p.id)))}
        />
        <BorderControls value={settings} onChange={update} />
        <div className="borders-footer">
          {progress ? (
            <>
              <div className="borders-progress" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
                <span style={{ width: `${(progress.done / progress.total) * 100}%` }} />
              </div>
              <div className="borders-footer-note">
                <span>{progress.done} / {progress.total}</span>
                <button type="button" className="link" onClick={() => { cancelRequested.current = true; }}>Cancel</button>
              </div>
            </>
          ) : (
            <Button variant="primary" block disabled={!batch.length} title="Save a bordered JPEG per selected photo" onClick={() => void exportAll()}>
              {allSelected ? 'Export all' : `Export ${batch.length} selected`}
            </Button>
          )}
        </div>
      </aside>

      <section className="stage borders-stage">
        {current ? (
          <BorderPreview photo={current} index={shownIndex} count={photos.length} settings={settings} fill={fill} onStep={step} />
        ) : (
          <p className="hint">Add photos to see a live preview of the border.</p>
        )}
      </section>

      {result && <DoneBanner result={result} onClose={() => setResult(null)} />}
    </div>
  );
}

function DoneBanner({ result, onClose }: { result: ExportResult; onClose: () => void }) {
  const written = result.written.length;
  const failed = result.failed.length;
  const text = result.cancelled
    ? `Cancelled: ${written} of ${result.total} exported`
    : failed
      ? `Exported ${written} of ${result.total}, ${failed} failed`
      : `Exported ${written} photo${written === 1 ? '' : 's'}`;
  const details = result.failed.map((f) => `${f.name}: ${f.error}`).join('\n');
  return (
    <div className={`borders-done ${failed ? 'warn' : ''}`} role="status" title={details || undefined}>
      <span>{text}</span>
      {written > 0 && (
        <button type="button" className="link" onClick={() => api.revealInFolder(result.written[0])}>Reveal in folder</button>
      )}
      <button type="button" className="borders-x" aria-label="Dismiss" onClick={onClose}>×</button>
    </div>
  );
}
