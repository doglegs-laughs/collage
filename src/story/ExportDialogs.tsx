import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../api';
import { Button, Segmented, Slider } from '../ui/Controls';
import { useToast } from '../ui/Toast';
import { Check, Field } from './fields';
import { evenPageSize, pageSize, type Story, type VideoSettings } from './model';
import type { ExportJob, ExportDone, VideoRequest } from './useExporter';

function Modal({ title, onClose, children, testid }: { title: string; onClose: () => void; children: ReactNode; testid: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="story-modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="story-modal" role="dialog" aria-label={title} data-testid={testid}>
        <h2 className="section-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function ImagesDialog({ story, onExport, onClose }: { story: Story; onExport: (width: number) => void; onClose: () => void }) {
  const [width, setWidth] = useState<'1080' | '2160'>('2160');
  const size = pageSize(story.aspect, Number(width));
  return (
    <Modal title="Export images" onClose={onClose} testid="images-dialog">
      <Field label="Width">
        <Segmented<'1080' | '2160'> label="Image width" value={width} options={[{ value: '1080', label: '1080 px' }, { value: '2160', label: '2160 px' }]} onChange={setWidth} />
      </Field>
      <p className="hint">{story.pages.length} JPEG files, {size.width} × {size.height} px each, saved to a folder you choose. Existing files are never replaced.</p>
      <div className="btn-row end">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" onClick={() => { onClose(); onExport(Number(width)); }} data-testid="images-go">Choose folder…</Button>
      </div>
    </Modal>
  );
}

type VideoProps = {
  story: Story;
  onVideo: (patch: Partial<VideoSettings>) => void;
  onExport: (req: VideoRequest) => void;
  onClose: () => void;
};

export function VideoDialog({ story, onVideo, onExport, onClose }: VideoProps) {
  const toast = useToast();
  const v = story.video;
  const [pageSeconds, setPageSeconds] = useState(3);
  const [width, setWidth] = useState<'720' | '1080'>('1080');
  const size = evenPageSize(story.aspect, Number(width));
  const music = v.audioPath?.split(/[\\/]/).pop() ?? null;
  const pick = async () => {
    try {
      const path = await api.openAudio();
      if (path) onVideo({ audioPath: path });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not choose music.', 'error');
    }
  };
  return (
    <Modal title="Export video" onClose={onClose} testid="video-dialog">
      <Field label="Transition between pages">
        <Segmented<'crossfade' | 'none'> label="Transition" value={v.transition} options={[{ value: 'crossfade', label: 'Crossfade' }, { value: 'none', label: 'None' }]} onChange={(t) => onVideo({ transition: t })} />
      </Field>
      {v.transition === 'crossfade' && (
        <Field label="Transition length">
          <Slider label="Transition seconds" value={v.transitionSeconds} min={0.2} max={1.5} step={0.1} format={(x) => `${x.toFixed(1)} s`} onChange={(x) => onVideo({ transitionSeconds: x })} />
        </Field>
      )}
      <Check label="Slow zoom (Ken Burns)" checked={v.kenBurns} onChange={(k) => onVideo({ kenBurns: k })} />
      <Field label="Seconds per page" className="gap-top">
        <Slider label="Seconds per page" value={pageSeconds} min={1} max={10} step={0.5} format={(x) => `${x.toFixed(1)} s`} onChange={setPageSeconds} />
      </Field>
      <Field label="Music (optional)">
        <div className="music-row">
          <Button variant="soft" onClick={pick}>{music ? 'Change…' : 'Choose music…'}</Button>
          {music && <span className="music-name" title={v.audioPath ?? ''}>{music}</span>}
          {music && <button type="button" className="link" onClick={() => onVideo({ audioPath: null, fitToMusic: false })}>Clear</button>}
        </div>
      </Field>
      <Check label="Fit to music length" checked={v.fitToMusic && !!music} onChange={(f) => onVideo({ fitToMusic: f })} />
      <Field label="Size" className="gap-top">
        <Segmented<'720' | '1080'> label="Video width" value={width} options={[{ value: '720', label: '720 px' }, { value: '1080', label: '1080 px' }]} onChange={setWidth} />
      </Field>
      <p className="hint">{story.pages.length} pages, {size.width} × {size.height} px, 30 fps. Pages whose duration you changed keep it. Seams crossed by a panorama or split photo slide as one move.</p>
      <div className="btn-row end">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" data-testid="video-go" onClick={() => { onClose(); onExport({ width: Number(width), pageSeconds, fitToMusic: v.fitToMusic && !!music }); }}>Make video…</Button>
      </div>
    </Modal>
  );
}

export function ExportStatus({ job, done, onCancel, onClear }: { job: ExportJob | null; done: ExportDone | null; onCancel: () => void; onClear: () => void }) {
  if (!job && !done) return null;
  return (
    <div className="story-status" role="status" data-testid="export-status">
      {job ? (
        <>
          <span>{job.label}</span>
          <span className="status-bar"><span style={{ width: job.fraction === null ? '30%' : `${Math.round(job.fraction * 100)}%` }} className={job.fraction === null ? 'indeterminate' : ''} /></span>
          <button type="button" className="link" onClick={onCancel} data-testid="export-cancel">Cancel</button>
        </>
      ) : done ? (
        <>
          <span>{done.message}</span>
          <button type="button" className="link" onClick={() => api.revealInFolder(done.reveal)} data-testid="export-reveal">Reveal</button>
          <button type="button" className="borders-x" aria-label="Dismiss" onClick={onClear}>×</button>
        </>
      ) : null}
    </div>
  );
}
