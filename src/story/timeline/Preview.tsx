import type { CSSProperties } from 'react';
import { aspectRatio, type Story } from '../model';
import type { ComputedTimeline } from '../timeline';
import { previewAt } from './math';

const MAX_W = 128;
const MAX_H = 104;

/** A small preview of the picture at the playhead, with the transition (crossfade or slide) drawn while it runs. Uses the page strip's thumbnails. */
export function Preview({ story, tl, time, thumbs, centred }: { story: Story; tl: ComputedTimeline; time: number; thumbs: (string | null)[]; centred: boolean }) {
  const ratio = aspectRatio(story.aspect);
  const width = Math.min(MAX_W, MAX_H * ratio);
  const state = previewAt(tl, time, centred);
  const layer = (clipIndex: number, style: CSSProperties, key: string) => {
    const clip = tl.clips[clipIndex];
    if (!clip) return null;
    const src = thumbs[clip.pageIndex];
    return (
      <div key={key} className="tl-preview-layer" style={{ background: story.pages[clip.pageIndex]?.background, ...style }}>
        {src && <img src={src} alt="" draggable={false} />}
      </div>
    );
  };
  const p = state.progress;
  const top = state.to === null ? null
    : state.kind === 'slide' ? layer(state.to, { transform: `translateX(${(1 - p) * 100}%)` }, 'to')
      : layer(state.to, { opacity: p }, 'to');
  return (
    <div className="tl-preview" data-testid="tl-preview" data-clip={tl.clips[state.from]?.pageId ?? ''} data-transition={state.to === null ? 'none' : state.kind}>
      <div className="tl-preview-frame" style={{ width, height: width / ratio }}>
        {layer(state.from, state.kind === 'slide' && state.to !== null ? { transform: `translateX(${-p * 100}%)` } : {}, 'from')}
        {top}
      </div>
    </div>
  );
}
