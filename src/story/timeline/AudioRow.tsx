import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { BeatAnalysis } from '../../api';
import { Button } from '../../ui/Controls';
import { beatClock } from '../beatTiming';
import { snapToBeat } from './math';
import type { MusicAnalysis } from './useMusicAnalysis';

type Props = {
  music: MusicAnalysis;
  analysis?: BeatAnalysis;
  beatsPerPage: number;
  /** Seconds into the song where the video starts. */
  offset: number;
  pxPerSecond: number;
  /** Width of the whole time axis in px, and of the visible part. */
  axisWidth: number;
  viewWidth: number;
  scrollLeft: number;
  /** Video length: music past it is drawn faded because it is not used. */
  total: number;
  fileName: string;
  /** Called while dragging with the offset the drag would give. */
  onDrag: (offset: number) => void;
  /** Called once at the end of a drag that moved the audio. */
  onCommit: (offset: number) => void;
};

const HEIGHT = 50;

function AudioRowBase({ music, analysis, beatsPerPage, offset, pxPerSecond, axisWidth, viewWidth, scrollLeft, total, fileName, onDrag, onCommit }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ x: number; offset: number; latest: number; moved: boolean } | null>(null);

  const beats = useMemo(() => {
    if (!analysis) return [];
    try { return beatClock(analysis, beatsPerPage, offset).upTo(axisWidth / pxPerSecond); } catch { return []; }
  }, [analysis, beatsPerPage, offset, axisWidth, pxPerSecond]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.max(1, Math.round(viewWidth * dpr));
    c.height = Math.round(HEIGHT * dpr);
    const g = c.getContext('2d');
    if (!g) return;
    g.scale(dpr, dpr);
    const css = getComputedStyle(c);
    const wave = css.getPropertyValue('--tl-wave').trim() || '#8b5cf6';
    const tick = css.getPropertyValue('--tl-tick').trim() || '#94a3b8';
    const strong = css.getPropertyValue('--tl-tick-strong').trim() || '#f59e0b';
    const mid = HEIGHT / 2;
    const peaks = analysis?.peaks;
    if (analysis && peaks?.length) {
      const per = peaks.length / analysis.duration; // buckets per second
      g.fillStyle = wave;
      for (let x = 0; x < viewWidth; x++) {
        const t0 = (scrollLeft + x) / pxPerSecond, t1 = (scrollLeft + x + 1) / pxPerSecond;
        const m0 = (t0 + offset) % analysis.duration, m1 = m0 + (t1 - t0);
        const from = Math.floor(m0 * per), to = Math.max(from + 1, Math.ceil(m1 * per));
        let peak = 0;
        for (let i = from; i < to; i++) peak = Math.max(peak, peaks[i % peaks.length]);
        const h = Math.max(1, peak * (HEIGHT - 12));
        g.globalAlpha = t0 > total ? 0.3 : 0.85;
        g.fillRect(x, mid - h / 2, 1, h);
      }
      g.globalAlpha = 1;
    }
    for (const { time, index } of beats) {
      const x = Math.round(time * pxPerSecond - scrollLeft) + 0.5;
      if (x < -1 || x > viewWidth + 1) continue;
      const accent = index % 4 === 0;
      g.strokeStyle = accent ? strong : tick;
      g.globalAlpha = time > total ? 0.4 : 1;
      g.lineWidth = accent ? 1.5 : 1;
      g.beginPath();
      g.moveTo(x, HEIGHT);
      g.lineTo(x, HEIGHT - (accent ? 22 : 12));
      g.stroke();
    }
    g.globalAlpha = 1;
  }, [analysis, beats, offset, pxPerSecond, scrollLeft, viewWidth, total]);

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!analysis || e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, offset, latest: offset, moved: false };
    setDragging(true);
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || !analysis) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 2) return;
    d.moved = true;
    // Dragging the music right brings earlier music under the start of the video: a smaller offset.
    const raw = Math.min(analysis.duration, Math.max(0, d.offset - dx / pxPerSecond));
    // Magnet: a beat (or the very start of the song) lands exactly on time 0.
    const snap = snapToBeat(raw, [0, ...analysis.beats], pxPerSecond, !e.altKey);
    d.latest = snap.time;
    onDrag(snap.time);
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    setDragging(false);
    if (d?.moved) onCommit(d.latest);
  };

  const label = music.status === 'busy' ? 'Analyzing music…' : music.status === 'error' ? music.error : 'Analyze the music to see its waveform and beats.';
  return (
    <div
      className={`tl-audio ${analysis ? 'ready' : ''} ${dragging ? 'dragging' : ''}`} style={{ width: axisWidth, height: HEIGHT }} data-testid="tl-audio"
      data-offset={offset.toFixed(3)} data-beats={beats.length}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
      title={analysis ? 'Drag sideways to choose where in the song the video starts. Hold Alt to skip snapping.' : undefined}
    >
      <canvas ref={canvas} className="tl-audio-canvas" style={{ width: viewWidth, height: HEIGHT }} />
      {!analysis && (
        <div className="tl-audio-empty" style={{ width: viewWidth }}>
          <span>{label}</span>
          <Button variant="soft" busy={music.status === 'busy'} onClick={music.analyze} data-testid="tl-analyze">{music.status === 'error' ? 'Try again' : 'Analyze music'}</Button>
        </div>
      )}
      {analysis && <span className="tl-audio-name" title={fileName}>{fileName}</span>}
    </div>
  );
}

export const AudioRow = memo(AudioRowBase);
