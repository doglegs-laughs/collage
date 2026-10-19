import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../../api';
import { Button, Segmented, Slider } from '../../ui/Controls';
import { useToast } from '../../ui/Toast';
import { beatClock } from '../beatTiming';
import { ContextMenu, type MenuItem } from '../ContextMenu';
import { Check } from '../fields';
import type { BoundaryTransition, Story, VideoSettings } from '../model';
import { computeTimeline, defaultBoundaries, lockClip, resyncFrom, setAudioOffset, setBoundaryTransition, unlockClip, type ComputedTimeline } from '../timeline';
import { NO_MEMORY, setBeatSync, type SyncMemory, type SyncStep } from '../videoDialogState';
import { AudioRow } from './AudioRow';
import { ClipsRow, type EdgeDrag } from './ClipsRow';
import { PauseIcon, PlayIcon } from './icons';
import { formatClock, MAX_PX_PER_SECOND, rulerStep } from './math';
import { Preview } from './Preview';
import { useMusicAnalysis } from './useMusicAnalysis';
import { usePlayback } from './usePlayback';

type Props = {
  story: Story;
  mutate: (fn: (s: Story) => Story, key?: string) => void;
  pageIndex: number;
  thumbs: (string | null)[];
  onSelectPage: (index: number) => void;
  onClose: () => void;
};

type Drag = ({ kind: 'clip' } & EdgeDrag) | { kind: 'audio'; offset: number };
const GUTTER = 28;
const NEXT: Record<BoundaryTransition, BoundaryTransition> = { none: 'crossfade', crossfade: 'slide', slide: 'none' };
const NAME: Record<BoundaryTransition, string> = { none: 'Cut', crossfade: 'Crossfade', slide: 'Slide' };

/** Always calls the latest `fn`, through an identity that never changes, so memoized rows are not redrawn by playback ticks. */
function useStable<A extends unknown[], R>(fn: (...a: A) => R): (...a: A) => R {
  const ref = useRef(fn);
  ref.current = fn;
  return useCallback((...a: A) => ref.current(...a), []);
}

/** The timeline editor that replaces the page strip: clips sized by duration, transitions between them, and the music with its beats underneath. */
export function TimelinePanel({ story, mutate, pageIndex, thumbs, onSelectPage, onClose }: Props) {
  const toast = useToast();
  const v = story.video;
  const root = useRef<HTMLElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLDivElement>(null);
  const memory = useRef<SyncMemory>(NO_MEMORY);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [menu, setMenu] = useState<{ pageId: string; x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState<number | null>(null);
  const [view, setView] = useState({ width: 800, left: 0 });
  const [scrubbing, setScrubbing] = useState(false);

  const music = useMusicAnalysis(v.audioPath, v.syncToBeats);
  const analysis = music.result;
  const syncOn = v.syncToBeats && !!analysis;
  const offsetNow = v.timeline?.audioOffset ?? 0;

  const shown = useMemo(() => {
    if (drag?.kind === 'clip') return lockClip(story, drag.pageId, drag.duration);
    if (drag?.kind === 'audio') return setAudioOffset(story, drag.offset);
    return story;
  }, [story, drag]);
  const options = useMemo(() => ({ analysis: syncOn ? analysis : undefined, beatsPerPage: v.beatsPerPage }), [syncOn, analysis, v.beatsPerPage]);
  const tl: ComputedTimeline = useMemo(() => {
    try { return computeTimeline(shown, options); } catch { return computeTimeline(shown, {}); } // a broken analysis falls back to page durations
  }, [shown, options]);
  const shownOffset = shown.video.timeline?.audioOffset ?? 0;

  /* ----- time axis ----- */
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setView((s) => (s.width === el.clientWidth ? s : { ...s, width: el.clientWidth }));
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => setView((s) => ({ ...s, left: e.currentTarget.scrollLeft })), []);
  // "Fit" is measured on the video as it was before a drag started, so stretching a clip does not rescale the view under the pointer.
  const fitTotal = useRef(tl.total);
  if (!drag) fitTotal.current = tl.total;
  const fit = Math.max(1, (view.width - GUTTER) / Math.max(fitTotal.current, 1));
  const minZoom = Math.min(fit, MAX_PX_PER_SECOND);
  const pps = Math.min(MAX_PX_PER_SECOND, Math.max(minZoom, zoom ?? fit));
  const axisWidth = Math.max(view.width, Math.ceil(tl.total * pps) + GUTTER);

  /* ----- playback ----- */
  const pb = usePlayback(tl.total, v.audioPath, shownOffset);
  useEffect(() => {
    const el = scroller.current;
    if (!el || !pb.playing) return;
    const x = pb.time * pps;
    if (x > el.scrollLeft + el.clientWidth - 30 || x < el.scrollLeft) el.scrollLeft = Math.max(0, x - 40);
  }, [pb.time, pb.playing, pps]);

  /* ----- snapping targets: beats in video time ----- */
  const reach = Math.ceil((tl.total + 60) / 60) * 60;
  const beatTimes = useMemo(() => {
    if (!analysis) return [];
    try { return beatClock(analysis, v.beatsPerPage, offsetNow).upTo(reach).map((b) => b.time); } catch { return []; }
  }, [analysis, v.beatsPerPage, offsetNow, reach]);

  /* ----- selection ----- */
  const currentId = story.pages[pageIndex]?.id ?? null;
  const currentClip = tl.clips.find((c) => c.pageId === currentId) ?? null;
  const currentPos = currentClip ? tl.clips.indexOf(currentClip) : -1;
  const canResync = currentPos >= 0 && tl.clips.slice(currentPos).some((c) => c.locked);
  const backgrounds = useMemo(() => story.pages.map((p) => p.background), [story.pages]);

  /* ----- edits (each one undo step) ----- */
  const defaults = () => defaultBoundaries(story, syncOn, v.transition);
  const select = useStable((pageId: string, index: number) => {
    onSelectPage(index);
    const clip = tl.clips.find((c) => c.pageId === pageId);
    if (clip) pb.seek(clip.start);
  });
  const dragClip = useStable((d: EdgeDrag) => setDrag({ kind: 'clip', ...d }));
  const stopDrag = useStable(() => setDrag(null));
  const commitClip = useStable((pageId: string, seconds: number) => { setDrag(null); mutate((s) => lockClip(s, pageId, seconds)); });
  const typeClip = useStable((pageId: string, seconds: number) => mutate((s) => lockClip(s, pageId, seconds)));
  const cycle = useStable((k: number) => {
    const b = tl.boundaries[k];
    if (b) mutate((s) => setBoundaryTransition(s, b.afterPageId, NEXT[b.transition], defaults()[k]));
  });
  const openMenu = useStable((pageId: string, x: number, y: number) => setMenu({ pageId, x, y }));
  const dragAudio = useCallback((offset: number) => setDrag({ kind: 'audio', offset }), []);
  const commitAudio = useCallback((offset: number) => { setDrag(null); mutate((s) => setAudioOffset(s, offset)); }, [mutate]);
  const setVideo = (patch: Partial<VideoSettings>) => mutate((s) => ({ ...s, video: { ...s.video, ...patch } }), 'video-settings');
  const applySync = (step: SyncStep, extra: Partial<VideoSettings> = {}) => { memory.current = step.memory; setVideo({ ...step.patch, ...extra }); };
  const pickMusic = async () => {
    try {
      const path = await api.openAudio();
      if (path) setVideo({ audioPath: path });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not choose music.', 'error');
    }
  };

  const menuItems = (pageId: string): MenuItem[] => {
    const k = tl.clips.findIndex((c) => c.pageId === pageId);
    const clip = tl.clips[k];
    if (!clip) return [];
    const items: MenuItem[] = [
      { label: 'Unlock length', onSelect: () => mutate((s) => unlockClip(s, pageId)), disabled: !clip.locked },
      { label: 'Re-sync from here', onSelect: () => mutate((s) => resyncFrom(s, pageId)), disabled: !tl.clips.slice(k).some((c) => c.locked) },
    ];
    const b = tl.boundaries[k];
    if (b) {
      (['none', 'crossfade', 'slide'] as const).forEach((kind, i) => items.push({
        label: `${NAME[kind]} after this page${b.transition === kind ? ' ✓' : ''}`, separator: i === 0,
        onSelect: () => mutate((s) => setBoundaryTransition(s, pageId, kind, defaults()[k])),
      }));
    }
    return items;
  };

  /* ----- scrubbing ----- */
  const scrubTo = (clientX: number) => {
    const left = canvas.current?.getBoundingClientRect().left;
    if (left !== undefined) pb.seek((clientX - left) / pps);
  };
  const keys = (e: React.KeyboardEvent) => {
    if ((e.target as HTMLElement).closest('input, textarea, select, button')) return;
    if (e.key === ' ') { e.preventDefault(); e.stopPropagation(); pb.toggle(); }
  };
  useEffect(() => { root.current?.focus({ preventScroll: true }); }, []);

  /* ----- ruler ticks (only those in view) ----- */
  const step = rulerStep(pps);
  const first = Math.max(0, Math.floor(view.left / pps / step));
  const last = Math.ceil((view.left + view.width) / pps / step);
  const ticks = Array.from({ length: Math.max(0, last - first + 1) }, (_, i) => (first + i) * step);

  const fileName = v.audioPath?.split(/[\\/]/).pop() ?? '';
  const status = music.status === 'busy' ? 'Analyzing…' : music.status === 'error' ? (music.error ?? 'Could not analyze') : analysis ? `${analysis.bpm} BPM · ${analysis.beats.length} beats` : '';

  return (
    <section ref={root} className="tl-panel" aria-label="Timeline" data-testid="timeline-panel" tabIndex={0} onKeyDown={keys}>
      <div className="tl-bar">
        <div className="tl-group">
          <button type="button" className="tl-play" onClick={pb.toggle} disabled={!(tl.total > 0)} aria-label={pb.playing ? 'Pause' : 'Play'} title="Play or pause (Space)" data-testid="tl-play">
            {pb.playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <span className="tl-clock" data-testid="tl-total" data-seconds={tl.total.toFixed(3)} data-time={pb.time.toFixed(3)} title="Playhead / video length">
            {formatClock(pb.time)} / {formatClock(tl.total)}
          </span>
        </div>
        <div className="tl-group">
          <Button onClick={() => currentClip && mutate((s) => unlockClip(s, currentClip.pageId))} disabled={!currentClip?.locked} title="Give this page back its automatic length" data-testid="tl-unlock">Unlock</Button>
          <Button onClick={() => currentClip && mutate((s) => resyncFrom(s, currentClip.pageId))} disabled={!canResync} title="Unlock this page and every page after it" data-testid="tl-resync">Re-sync from here</Button>
          <Button onClick={() => mutate((s) => { const { timeline: _t, ...video } = s.video; void _t; return { ...s, video }; })} disabled={!v.timeline} title="Remove every manual length, transition change and music start" data-testid="tl-reset">Reset timing</Button>
        </div>
        <div className="tl-group tl-zoom">
          {/* The left end of the slider is "fit all": the whole video in view, kept fitted when the window is resized. */}
          <Slider label="Timeline zoom" value={Math.round(pps)} min={Math.max(1, Math.floor(minZoom))} max={MAX_PX_PER_SECOND} onChange={(x) => setZoom(x <= minZoom + 0.5 ? null : x)} format={(x) => `${x} px/s`} />
        </div>
        <div className="tl-group tl-music">
          <Button variant="soft" onClick={pickMusic} data-testid="tl-music">{v.audioPath ? 'Change music…' : 'Choose music…'}</Button>
          {v.audioPath && <button type="button" className="link" onClick={() => applySync(setBeatSync(v, memory.current, false), { audioPath: null, fitToMusic: false })}>Clear</button>}
          {v.audioPath && <Check label="Sync to beats" checked={v.syncToBeats} onChange={(on) => applySync(setBeatSync(v, memory.current, on))} />}
          {v.audioPath && (
            <Segmented<'1' | '2' | '4' | '8'>
              label="Beats per page" value={String(v.beatsPerPage) as '1' | '2' | '4' | '8'}
              options={[1, 2, 4, 8].map((n) => ({ value: String(n) as '1' | '2' | '4' | '8', label: String(n), title: `${n} ${n === 1 ? 'beat' : 'beats'} per page when synced` }))}
              onChange={(n) => setVideo({ beatsPerPage: Number(n) as VideoSettings['beatsPerPage'] })}
            />
          )}
          {v.audioPath && status && <span className="tl-status" role="status" data-testid="tl-status">{status}</span>}
        </div>
        <button type="button" className="borders-x tl-close" onClick={onClose} aria-label="Close timeline" title="Back to the page strip" data-testid="tl-close">×</button>
      </div>
      <div className="tl-body">
        <Preview story={story} tl={tl} time={pb.time} thumbs={thumbs} centred={syncOn} />
        <div className="tl-tracks">
          <div className="tl-labels" aria-hidden="true">
            <span className="tl-label tl-label-ruler">Time</span>
            <span className="tl-label tl-label-clips">Pages</span>
            {v.audioPath && <span className="tl-label tl-label-audio">Music</span>}
          </div>
          <div className="tl-scroll" ref={scroller} onScroll={onScroll} data-testid="tl-scroll">
            <div className="tl-canvas" ref={canvas} style={{ width: axisWidth }}>
              <div
                className="tl-ruler" style={{ width: axisWidth }} data-testid="tl-ruler"
                onPointerDown={(e) => { if (e.button !== 0) return; e.currentTarget.setPointerCapture(e.pointerId); setScrubbing(true); scrubTo(e.clientX); }}
                onPointerMove={(e) => { if (scrubbing) scrubTo(e.clientX); }}
                onPointerUp={() => setScrubbing(false)} onPointerCancel={() => setScrubbing(false)}
                title="Click or drag to move the playhead"
              >
                {ticks.map((t) => <span key={t} className="tl-tick" style={{ left: t * pps }}>{formatClock(t, step < 1)}</span>)}
              </div>
              <ClipsRow
                tl={tl} pxPerSecond={pps} axisWidth={axisWidth} thumbs={thumbs} backgrounds={backgrounds} currentPageId={currentId} beats={beatTimes}
                onSelect={select} onDrag={dragClip} onCommit={commitClip} onCancelDrag={stopDrag} onType={typeClip} onCycle={cycle} onMenu={openMenu}
              />
              {v.audioPath && (
                <AudioRow
                  music={music} analysis={analysis} beatsPerPage={v.beatsPerPage} offset={shownOffset} pxPerSecond={pps}
                  axisWidth={axisWidth} viewWidth={view.width} scrollLeft={view.left} total={tl.total} fileName={fileName}
                  onDrag={dragAudio} onCommit={commitAudio}
                />
              )}
              {drag?.kind === 'clip' && drag.snapTime !== null && <div className="tl-snapline" style={{ left: drag.snapTime * pps }} data-testid="tl-snapline" />}
              <div className="tl-playhead" style={{ transform: `translateX(${pb.time * pps}px)` }} data-testid="tl-playhead" aria-hidden="true"><i /></div>
            </div>
          </div>
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} label="Clip actions" items={menuItems(menu.pageId)} onClose={() => setMenu(null)} />}
    </section>
  );
}
