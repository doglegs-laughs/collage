import { memo, useEffect, useRef, useState } from 'react';
import { MAX_CLIP_SECONDS, MIN_CLIP_SECONDS } from '../model';
import { clampClip, type ComputedTimeline } from '../timeline';
import { LockIcon, TRANSITION_LABEL, TransitionIcon } from './icons';
import { snapToBeat } from './math';

export type EdgeDrag = { pageId: string; duration: number; /** Where the edge snapped to, in video seconds, or null. */ snapTime: number | null };

type Props = {
  tl: ComputedTimeline;
  pxPerSecond: number;
  axisWidth: number;
  /** 1-based page numbers by story page index, and thumbnails by the same index. */
  thumbs: (string | null)[];
  backgrounds: string[];
  currentPageId: string | null;
  /** Video-time beats the edges snap to (sorted). */
  beats: number[];
  onSelect: (pageId: string, pageIndex: number) => void;
  onDrag: (drag: EdgeDrag) => void;
  onCommit: (pageId: string, duration: number) => void;
  onCancelDrag: () => void;
  onType: (pageId: string, duration: number) => void;
  onCycle: (boundaryIndex: number) => void;
  onMenu: (pageId: string, x: number, y: number) => void;
};

function DurationInput({ value, onDone }: { value: number; onDone: (seconds: number | null) => void }) {
  const [text, setText] = useState(value.toFixed(2));
  const done = useRef(false);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    const n = Number(text);
    onDone(commit && Number.isFinite(n) && n > 0 ? n : null);
  };
  return (
    <input
      className="tl-duration-input" type="number" step="0.1" min={MIN_CLIP_SECONDS} max={MAX_CLIP_SECONDS} autoFocus value={text} aria-label="Clip duration in seconds"
      data-testid="tl-duration-input"
      onChange={(e) => setText(e.target.value)} onFocus={(e) => e.target.select()}
      onBlur={() => finish(true)}
      onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()} onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') { e.preventDefault(); finish(true); } else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      }}
    />
  );
}

function ClipsRowBase({ tl, pxPerSecond: pps, axisWidth, thumbs, backgrounds, currentPageId, beats, onSelect, onDrag, onCommit, onCancelDrag, onType, onCycle, onMenu }: Props) {
  const lane = useRef<HTMLDivElement>(null);
  const edge = useRef<{ pageId: string; start: number; x: number; moved: boolean; latest: number } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  useEffect(() => { if (editing && !tl.clips.some((c) => c.pageId === editing)) setEditing(null); }, [editing, tl.clips]);

  const down = (e: React.PointerEvent<HTMLDivElement>, pageId: string, start: number) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    edge.current = { pageId, start, x: e.clientX, moved: false, latest: 0 };
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = edge.current;
    const left = lane.current?.getBoundingClientRect().left;
    if (!d || left === undefined) return;
    if (!d.moved && Math.abs(e.clientX - d.x) < 2) return;
    d.moved = true;
    const t = (e.clientX - left) / pps;
    const snap = snapToBeat(t, beats, pps, !e.altKey);
    const duration = clampClip(snap.time - d.start);
    d.latest = duration;
    onDrag({ pageId: d.pageId, duration, snapTime: snap.snapped && Math.abs(snap.time - d.start - duration) < 1e-9 ? snap.time : null });
  };
  const up = () => {
    const d = edge.current;
    edge.current = null;
    if (d?.moved) onCommit(d.pageId, d.latest); else onCancelDrag();
  };

  return (
    <div className="tl-lanes" style={{ width: axisWidth }} ref={lane}>
      <div className="tl-transitions">
        {tl.boundaries.map((b, k) => {
          const next = tl.clips[k + 1];
          const page = tl.clips[k].pageIndex + 1;
          return (
            <button
              key={b.afterPageId} type="button" className={`tl-boundary ${b.overridden ? 'custom' : ''}`} style={{ left: next.start * pps }}
              data-testid="tl-boundary" data-transition={b.transition} data-after={b.afterPageId}
              aria-label={`Transition after page ${page}: ${TRANSITION_LABEL[b.transition]}. Click to change`}
              title={`After page ${page}: ${TRANSITION_LABEL[b.transition]}. Click to change`}
              onClick={() => onCycle(k)}
            >
              <TransitionIcon kind={b.transition} />
            </button>
          );
        })}
      </div>
      <div className="tl-clips">
        {tl.clips.map((c) => {
          const w = Math.max(2, c.duration * pps);
          const current = c.pageId === currentPageId;
          return (
            <div
              key={c.pageId} role="button" tabIndex={0}
              className={`tl-clip ${current ? 'current' : ''} ${c.locked ? 'locked' : ''}`}
              style={{ left: c.start * pps, width: w, background: backgrounds[c.pageIndex] }}
              data-testid="tl-clip" data-page={c.pageId} data-duration={c.duration.toFixed(3)} data-start={c.start.toFixed(3)} data-locked={c.locked ? 'true' : 'false'}
              aria-label={`Page ${c.pageIndex + 1}, ${c.duration.toFixed(2)} seconds${c.locked ? ', locked' : ''}`}
              aria-pressed={current}
              onClick={() => onSelect(c.pageId, c.pageIndex)}
              onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) onSelect(c.pageId, c.pageIndex); }}
              onDoubleClick={() => setEditing(c.pageId)}
              onContextMenu={(e) => { e.preventDefault(); onSelect(c.pageId, c.pageIndex); onMenu(c.pageId, e.clientX, e.clientY); }}
              title="Click to select. Double-click to type a length. Drag the right edge to stretch (Alt skips snapping)."
            >
              {thumbs[c.pageIndex] && <img src={thumbs[c.pageIndex]!} alt="" draggable={false} />}
              {w >= 34 && <span className="tl-clip-num">{c.pageIndex + 1}</span>}
              {c.locked && <span className="tl-lock" data-testid="tl-lock" title="Length set by hand"><LockIcon /></span>}
              {w >= 30 && (editing === c.pageId
                ? <DurationInput value={c.duration} onDone={(s) => { setEditing(null); if (s !== null) onType(c.pageId, s); }} />
                : <span className="tl-clip-dur" data-testid="tl-clip-duration">{c.duration.toFixed(2)} s</span>)}
              <div
                className="tl-edge" data-testid="tl-edge" role="separator" aria-label={`Resize page ${c.pageIndex + 1}`} aria-orientation="vertical"
                onPointerDown={(e) => down(e, c.pageId, c.start)} onPointerMove={move} onPointerUp={up} onPointerCancel={up}
                onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const ClipsRow = memo(ClipsRowBase);
