import { useMemo, useRef, useState } from 'react';
import { useVisible } from '../collage/useVisible';
import { usePasteImages } from '../core/usePasteImages';
import { useWindowFileDrop } from '../core/useWindowFileDrop';
import { DropOverlay } from '../ui/DropOverlay';
import { revealLabel } from '../ui/revealLabel';
import { api } from '../api';
import { usePhotoLibrary } from '../core/library';
import { useToast } from '../ui/Toast';
import { PhotoTray } from '../ui/PhotoTray';
import { useTraySelection } from '../story/useTraySelection';
import { GifControls } from './GifControls';
import { GifPreview } from './GifPreview';
import { GifTopbar } from './GifTopbar';
import { formatBytes } from './format';
import { MAX_FRAMES, planGif } from './plan';
import { renderFrames } from './render';
import { DEFAULT_SETTINGS, planOptions, type GifSettings } from './settings';
import { gifSize } from './shape';

const PREVIEW_MAX_WIDTH = 540;
const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function GifView() {
  const root = useRef<HTMLDivElement>(null);
  const visible = useVisible(root);
  const library = usePhotoLibrary();
  const toast = useToast();
  const [settings, setSettings] = useState<GifSettings>(DEFAULT_SETTINGS);
  const [progress, setProgress] = useState<number | null>(null);
  const busy = useRef(false);
  const cancelRequested = useRef(false);

  usePasteImages(visible, (files) => void library.addFiles(files));
  const fileDrag = useWindowFileDrop(visible, (files) => void library.addFiles(files));

  const { photos } = library;
  const { selected, toggle, all, none } = useTraySelection(photos);
  /** The frames, in the order the tray's numbers show. */
  const chosen = useMemo(() => selected.map((id) => photos.find((p) => p.id === id)).filter((p) => !!p), [selected, photos]);
  const plan = useMemo(() => planGif(chosen.length, planOptions(settings)), [chosen.length, settings]);
  const first = chosen[0] ?? null;
  const outSize = useMemo(() => gifSize(first, settings.shape, settings.width), [first, settings.shape, settings.width]);
  const previewSize = useMemo(() => gifSize(first, settings.shape, Math.min(settings.width, PREVIEW_MAX_WIDTH)), [first, settings.shape, settings.width]);

  const update = (patch: Partial<GifSettings>) => setSettings((s) => ({ ...s, ...patch }));
  const disabledReason = chosen.length < 2 ? 'Select at least 2 photos' : `Too many frames (${plan.frames.length}); the limit is ${MAX_FRAMES}`;
  const canExport = chosen.length >= 2 && plan.frames.length <= MAX_FRAMES;

  const exportGif = async () => {
    if (!canExport || busy.current) return;
    busy.current = true;
    cancelRequested.current = false;
    setProgress(0);
    const off = api.onGifProgress((f) => setProgress(50 + Math.round(f * 50)));
    try {
      const frames = await renderFrames(
        chosen,
        plan.frames,
        { size: outSize, fit: settings.fit, background: settings.background },
        { cancelled: () => cancelRequested.current, onProgress: (done, total) => setProgress(Math.round((done / total) * 50)) },
      );
      if (!frames || cancelRequested.current) return;
      const stem = first!.name.replace(/\.[^.]+$/, '');
      const result = await api.makeGif({
        frames,
        durations: plan.frames.map((f) => f.duration),
        loop: settings.loop,
        suggestedName: `${stem || 'animation'}.gif`,
      });
      if (!result) return;
      toast(`Saved GIF (${formatBytes(result.bytes)})`, 'success', { label: revealLabel(), onClick: () => api.revealInFolder(result.path) });
    } catch (error) {
      if (!/cancel/i.test(messageOf(error))) toast(messageOf(error), 'error');
    } finally {
      off();
      setProgress(null);
      busy.current = false;
    }
  };
  const cancel = () => {
    cancelRequested.current = true;
    void api.cancelGif();
  };

  return (
    <div ref={root} className="workspace gif-workspace" data-testid="view-gif">
      <DropOverlay show={fileDrag} />
      <GifTopbar visible={visible} canExport={canExport} disabledReason={disabledReason} progress={progress} onExport={() => void exportGif()} onCancel={cancel} />
      <aside className="sidebar borders-side">
        <PhotoTray
          className="section"
          photos={photos}
          selected={selected}
          onToggle={toggle}
          onRemove={library.remove}
          onClearAll={library.clear}
          clearNote="GIFs already saved are not affected."
          onImport={() => void library.pick()}
          onDropFiles={(files) => void library.addFiles(files)}
          onSelectAll={all}
          onSelectNone={none}
        />
      </aside>

      <section className="stage borders-stage">
        {chosen.length >= 2 ? (
          <GifPreview photos={chosen} plan={plan} size={previewSize} fit={settings.fit} background={settings.background} loop={settings.loop} active={visible} />
        ) : (
          <p className="hint">Select at least two photos to see the animation. The numbers show the order.</p>
        )}
      </section>

      <GifControls value={settings} onChange={update} frameCount={plan.frames.length} duration={plan.duration} selected={chosen.length} />
    </div>
  );
}
