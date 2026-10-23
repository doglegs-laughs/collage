import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api, type BeatAnalysis } from '../api';
import { computeTimeline, fitToMusicApplies, timelineOptions } from './timeline';
import { Button, Segmented, Slider } from '../ui/Controls';
import { useDialogFocus } from '../ui/useDialogFocus';
import { useToast } from '../ui/Toast';
import { Check, Field } from './fields';
import { NO_MEMORY, pickTransition, setBeatSync, type SyncMemory, type SyncStep } from './videoDialogState';
import { evenPageSize, pageSize, visibleIndices, type Story, type VideoSettings } from './model';
import type { ExportJob, ExportDone, VideoRequest } from './useExporter';

function Modal({ title, onClose, children, testid }: { title: string; onClose: () => void; children: ReactNode; testid: string }) {
  const focus = useDialogFocus<HTMLDivElement>();
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
      <div className="story-modal" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} data-testid={testid} {...focus}>
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
  /** Close the dialog and open the Timeline editor. */
  onEditTiming?: () => void;
};

export function VideoDialog({ story, onVideo, onExport, onClose, onEditTiming }: VideoProps) {
  const toast = useToast();
  const v = story.video;
  const pageSeconds = v.pageSeconds ?? 3; // kept in the story, so the Timeline panel and the export use the same value
  const [width, setWidth] = useState<'720' | '1080'>('1080');
  const size = evenPageSize(story.aspect, Number(width));
  const music = v.audioPath?.split(/[\\/]/).pop() ?? null;
  const [analysis, setAnalysis] = useState<{ path: string; result?: BeatAnalysis; error?: string } | null>(null);
  const [retry, setRetry] = useState(0);
  const sync = v.syncToBeats && !!v.audioPath;
  const memory = useRef<SyncMemory>(NO_MEMORY);
  const apply = (step: SyncStep, extra: Partial<VideoSettings> = {}) => { memory.current = step.memory; onVideo({ ...step.patch, ...extra }); };
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
        <Segmented<'crossfade' | 'none'> label="Transition" value={v.transition} options={[{ value: 'crossfade', label: 'Crossfade' }, { value: 'none', label: 'None' }]} onChange={(t) => apply(pickTransition(v, memory.current, t))} />
      </Field>
      {v.transition === 'crossfade' && (
        <Field label="Transition length">
          <Slider label="Transition seconds" value={v.transitionSeconds} min={0.2} max={1.5} step={0.1} format={(x) => `${x.toFixed(1)} s`} onChange={(x) => onVideo({ transitionSeconds: x })} />
        </Field>
      )}
      <Check label="Slow zoom (Ken Burns)" checked={v.kenBurns} onChange={(k) => onVideo({ kenBurns: k })} />
      {!sync && <Field label="Seconds per page" className="gap-top">
        <Slider label="Seconds per page" value={pageSeconds} min={1} max={10} step={0.5} format={(x) => `${x.toFixed(1)} s`} onChange={(x) => onVideo({ pageSeconds: x })} />
      </Field>}
      <Field label="Music (optional)">
        <div className="music-row">
          <Button variant="soft" onClick={pick}>{music ? 'Change…' : 'Choose music…'}</Button>
          {music && <span className="music-name" title={v.audioPath ?? ''}>{music}</span>}
          {music && <button type="button" className="link" onClick={() => apply(setBeatSync(v, memory.current, false), { audioPath: null, fitToMusic: false })}>Clear</button>}
        </div>
      </Field>
      <Check label="Sync photo changes to beats" checked={sync} disabled={!music} onChange={(enabled) => apply(setBeatSync(v, memory.current, enabled))} />
      {sync && <>
        <Field label="Beats per page">
          <Segmented<'1' | '2' | '4' | '8'> label="Beats per page" value={String(v.beatsPerPage) as '1' | '2' | '4' | '8'} options={[1, 2, 4, 8].map((n) => ({ value: String(n) as '1' | '2' | '4' | '8', label: `${n} ${n === 1 ? 'beat' : 'beats'}` }))} onChange={(n) => onVideo({ beatsPerPage: Number(n) as VideoSettings['beatsPerPage'] })} />
        </Field>
        <p className="hint" role="status" data-testid="beat-status">
          {error ? <>{error} <button type="button" className="link" onClick={() => setRetry((r) => r + 1)}>Retry</button></>
            : detected ? `${detected.bpm} BPM · ${detected.beats.length} beats detected · ${computeTimeline(story, timelineOptions(story, { pageSeconds, beatSync: { analysis: detected, beatsPerPage: v.beatsPerPage } })).total.toFixed(1)} s video`
              : 'Detecting music beats…'}
        </p>
        <p className="hint">Each page stays for {v.beatsPerPage} beats. Beat timing replaces manual page durations. Short tracks repeat with the video.</p>
      </>}
      <Check label="Fit to music length" checked={fitToMusicApplies(v, sync)} disabled={!music || sync} onChange={(f) => onVideo({ fitToMusic: f })} />
      {onEditTiming && (
        <p className="hint" data-testid="video-timing-note">
          {v.timeline ? 'Custom timing from the Timeline is used; fit to music only stretches pages whose length you did not set. ' : 'Want to stretch some pages or line cuts up with the beat by hand? '}
          <button type="button" className="link" onClick={onEditTiming} data-testid="video-edit-timing">Edit timing…</button>
        </p>
      )}
      <Field label="Size" className="gap-top">
        <Segmented<'720' | '1080'> label="Video width" value={width} options={[{ value: '720', label: '720 px' }, { value: '1080', label: '1080 px' }]} onChange={setWidth} />
      </Field>
      <p className="hint">{visibleIndices(story).length} pages, {size.width} × {size.height} px, 30 fps. {!sync && 'Pages whose duration you changed keep it. '}Seams crossed by a panorama or split photo slide as one move.</p>
      <div className="btn-row end">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" data-testid="video-go" disabled={sync && !detected} onClick={() => { onClose(); onExport({ width: Number(width), pageSeconds, fitToMusic: fitToMusicApplies(v, sync), ...(sync && detected && v.audioPath ? { beatSync: { analysis: detected, beatsPerPage: v.beatsPerPage, audioPath: v.audioPath } } : {}) }); }}>Make video…</Button>
      </div>
    </Modal>
  );
}

function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Time since the export began, refreshed every second. */
function Elapsed({ since }: { since: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [since]);
  return <span className="elapsed" data-testid="export-elapsed">{formatElapsed(now - since)}</span>;
}

export function ExportStatus({ job, done, onCancel, onClear }: { job: ExportJob | null; done: ExportDone | null; onCancel: () => void; onClear: () => void }) {
  if (!job && !done) return null;
  return (
    <div className="story-status" role="status" data-testid="export-status">
      {job ? (
        <>
          <span>{job.label}</span>
          <Elapsed since={job.startedAt} />
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
