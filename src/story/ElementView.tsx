import { memo, useLayoutEffect, useRef, type CSSProperties } from 'react';
import type { Crop } from '../core/geometry';
import { PhotoFrame } from '../ui/PhotoFrame';
import { fontStack, LINE_HEIGHT } from './fonts';
import type { El, Photo, PhotoEl, RectEl, TextEl } from './model';
import { blurPx, layoutElementPx, shadowPx } from './render';

export type ElementViewProps = {
  el: El;
  /** Page size in on-screen px. */
  W: number;
  H: number;
  photo?: Photo;
  ghostOf?: number;
  cropping?: boolean;
  editing?: boolean;
  hot?: boolean;
  onCrop?: (id: string, crop: Crop) => void;
  onText?: (id: string, text: string) => void;
  onEditEnd?: () => void;
};

const shadowCss = (W: number) => {
  const s = shadowPx(W);
  return `0 ${s.offsetY}px ${s.blur}px ${s.color}`;
};

function PhotoBody({ el, W, H, photo, cropping, onCrop }: ElementViewProps & { el: PhotoEl }) {
  const L = layoutElementPx(el, W, H);
  const { inner } = L;
  const framed = L.frame > 0 || L.frameBottom > 0;
  const pad = el.blur > 0 ? 2 * blurPx(el.blur, W) : 0;
  return (
    <div
      className="se-photo"
      style={{
        left: L.outer.x, top: L.outer.y, width: L.outer.w, height: L.outer.h,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
        background: framed ? el.frameColor : undefined,
        boxShadow: el.shadow ? shadowCss(W) : undefined,
      }}
    >
      <div className="se-photo-inner" style={{ left: L.frame, top: L.frame, width: inner.w, height: inner.h }}>
        {photo ? (
          <PhotoFrame
            photo={photo}
            crop={el.crop}
            aspect={(inner.w + 2 * pad) / Math.max(1, inner.h + 2 * pad)}
            interactive={cropping}
            onCropChange={(c) => onCrop?.(el.id, c)}
            style={{ position: 'absolute', left: -pad, top: -pad, width: inner.w + 2 * pad, height: inner.h + 2 * pad, filter: pad ? `blur(${pad / 2}px)` : undefined, background: 'transparent' }}
          />
        ) : (
          <div className="se-slot">{el.photoId ? 'Missing photo' : 'Drop a photo'}</div>
        )}
      </div>
    </div>
  );
}

function textStyle(el: TextEl, W: number, H: number): CSSProperties {
  const L = layoutElementPx(el, W, H);
  const fontPx = el.size * H;
  const ls = el.letterSpacing * fontPx;
  return {
    left: L.outer.x, top: L.outer.y,
    // Trailing letter-spacing is not ink; widen the box so centred/right text lines up like the canvas renderer.
    width: L.outer.w + (el.align === 'left' ? 0 : ls), height: L.outer.h,
    transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
    transformOrigin: `${(L.outer.w / 2)}px ${L.outer.h / 2}px`,
    fontFamily: fontStack(el.font), fontSize: fontPx, fontWeight: el.weight, lineHeight: LINE_HEIGHT, letterSpacing: `${ls}px`,
    textAlign: el.align, color: el.color, whiteSpace: 'pre',
    textShadow: el.shadow ? `0 ${fontPx * 0.04}px ${fontPx * 0.18}px rgba(0,0,0,0.45)` : undefined,
  };
}

function TextBody({ el, W, H, editing, onText, onEditEnd }: ElementViewProps & { el: TextEl }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!editing || !node) return;
    node.focus();
    const range = document.createRange();
    range.selectNodeContents(node);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [editing]);
  const style = textStyle(el, W, H);
  if (editing) {
    return (
      <div
        ref={ref}
        className="se-text editing"
        data-testid="text-editor"
        contentEditable="plaintext-only"
        suppressContentEditableWarning
        spellCheck={false}
        style={{ ...style, textTransform: el.uppercase ? 'uppercase' : undefined }}
        onBlur={(e) => {
          onText?.(el.id, e.currentTarget.textContent ?? '');
          onEditEnd?.();
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.preventDefault();
            e.currentTarget.blur();
          }
        }}
      >
        {el.text}
      </div>
    );
  }
  return <div className="se-text" style={style}>{el.uppercase ? el.text.toUpperCase() : el.text}</div>;
}

function RectBody({ el, W, H }: { el: RectEl; W: number; H: number }) {
  const L = layoutElementPx(el, W, H);
  const sw = el.strokeWidth > 0 && el.stroke && el.stroke !== 'transparent' ? Math.max(1, el.strokeWidth * W) : 0;
  const radius = (el.radius || 0) * W;
  return (
    <div
      className="se-rect"
      style={{
        left: L.outer.x, top: L.outer.y, width: L.outer.w, height: L.outer.h, background: el.fill, borderRadius: radius,
        transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
        boxShadow: el.shadow ? shadowCss(W) : undefined,
      }}
    >
      {sw > 0 && <div style={{ position: 'absolute', inset: -sw / 2, border: `${sw}px solid ${el.stroke}`, borderRadius: radius + sw / 2 }} />}
    </div>
  );
}

/** One element of the page, positioned from page fractions exactly like render.ts. Pure and memoised. */
export const ElementView = memo(function ElementView(props: ElementViewProps) {
  const { el, ghostOf, hot } = props;
  return (
    <div className={`se ${hot ? 'hot' : ''}`} data-el-id={el.id} data-kind={el.kind} data-ghost={ghostOf ?? undefined} data-testid={`story-el-${el.kind}`}>
      {el.kind === 'photo' ? <PhotoBody {...props} el={el} /> : el.kind === 'text' ? <TextBody {...props} el={el} /> : <RectBody el={el} W={props.W} H={props.H} />}
    </div>
  );
});
