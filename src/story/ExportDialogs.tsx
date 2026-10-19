import { useEffect, useState, type ReactNode } from 'react';
import { api, type BeatAnalysis } from '../api';
import { beatDurations } from './beatTiming';
import { Button, Segmented, Slider } from '../ui/Controls';
import { useToast } from '../ui/Toast';
import { Check, Field } from './fields';
import { evenPageSize, pageSize, visibleIndices, type Story, type VideoSettings } from './model';
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
      <p className="hint">{visibleIndices(story).length} JPEG files, {size.width} × {size.height} px each, saved to a folder you choose. Existing files are never replaced.</p>
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
  const [analysis, setAnalysis] = useState<{ path: string; result?: BeatAnalysis; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const sync = v.syncToBeats && !!v.audioPath;
  const detected = analysis?.path === v.audioPath ? analysis.result : undefined;
  const error = analysis?.path === v.audioPath ? analysis.error : undefined;
  useEffect(() => {
    const path = v.audioPath;
    if (!v.syncToBeats || !path) { setAnalysis(null); return; }
    let active = true;
    setAnalysis({ path });
    // Debounced: quick toggling or re-picking must not start a decode each time (main also caches and cancels).
    const timer = window.setTimeout(() => {
      api.analyzeAudio(path).then(
        (result) => { if (active) setAnalysis({ path, result }); },
        (e: unknown) => { if (active) setAnalysis({ path, error: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '') : 'Could not detect beats. Try another track.' }); },
      );
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [v.syncToBeats, v.audioPath, retry]);
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
      {!sync && <Field label="Seconds per page" className="gap-top">
        <Slider label="Seconds per page" value={pageSeconds} min={1} max={10} step={0.5} format={(x) => `${x.toFixed(1)} s`} onChange={setPageSeconds} />
      </Field>}
      <Field label="Music (optional)">
        <div className="music-row">
          <Button variant="soft" onClick={pick}>{music ? 'Change…' : 'Choose music…'}</Button>
          {music && <span className="music-name" title={v.audioPath ?? ''}>{music}</span>}
          {music && <button type="button" className="link" onClick={() => onVideo({ audioPath: null, fitToMusic: false, syncToBeats: false })}>Clear</button>}
        </div>
      </Field>
      <Check label="Sync photo changes to beats" checked={sync} disabled={!music} onChange={(enabled) => onVideo({ syncToBeats: enabled, ...(enabled ? { fitToMusic: false } : {}) })} />
      {sync && <>
        <Field label="Beats per page">
          <Segmented<'1' | '2' | '4' | '8'> label="Beats per page" value={String(v.beatsPerPage) as '1' | '2' | '4' | '8'} options={[1, 2, 4, 8].map((n) => ({ value: String(n) as '1' | '2' | '4' | '8', label: `${n} ${n === 1 ? 'beat' : 'beats'}` }))} onChange={(n) => onVideo({ beatsPerPage: Number(n) as VideoSettings['beatsPerPage'] })} />
        </Field>
        <p className="hint" role="status" data-testid="beat-status">
          {error ? <>{error} <button type="button" className="link" onClick={() => setRetry((r) => r + 1)}>Retry</button></>
            : detected ? `${detected.bpm} BPM · ${detected.beats.length} beats detected · ${beatDurations(visibleIndices(story).length, detected, v.beatsPerPage).reduce((a, b) => a + b, 0).toFixed(1)} s video`
              : 'Detecting music beats…'}
        </p>
        <p className="hint">Each page stays for {v.beatsPerPage} beats. Beat timing replaces manual page durations. Short tracks repeat with the video.</p>
      </>}
      <Check label="Fit to music length" checked={v.fitToMusic && !!music && !sync} disabled={!music || sync} onChange={(f) => onVideo({ fitToMusic: f })} />
      <Field label="Size" className="gap-top">
        <Segmented<'720' | '1080'> label="Video width" value={width} options={[{ value: '720', label: '720 px' }, { value: '1080', label: '1080 px' }]} onChange={setWidth} />
      </Field>
      <p className="hint">{visibleIndices(story).length} pages, {size.width} × {size.height} px, 30 fps. {!sync && 'Pages whose duration you changed keep it. '}Seams crossed by a panorama or split photo slide as one move.</p>
      <div className="btn-row end">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" data-testid="video-go" disabled={sync && !detected} onClick={() => { onClose(); onExport({ width: Number(width), pageSeconds, fitToMusic: v.fitToMusic && !!music && !sync, ...(sync && detected && v.audioPath ? { beatSync: { analysis: detected, beatsPerPage: v.beatsPerPage, audioPath: v.audioPath } } : {}) }); }}>Make video…</Button>
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
