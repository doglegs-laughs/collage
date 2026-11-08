import { Segmented, Slider } from '../ui/Controls';
import { Check } from '../story/fields';
import { formatSeconds } from './format';
import { MAX_FRAMES, type GifLoop } from './plan';
import { GIF_WIDTHS, type GifFit, type GifShape } from './shape';
import type { GifSettings } from './settings';

const LOOPS: { value: GifLoop; label: string; title: string }[] = [
  { value: 'forever', label: 'Forever', title: 'Keep repeating' },
  { value: 'once', label: 'Play once', title: 'Stop on the last frame' },
];
const SHAPES: { value: GifShape; label: string; title: string }[] = [
  { value: 'original', label: 'Original', title: 'Shape of the first photo' },
  { value: '1:1', label: '1:1', title: 'Square' },
  { value: '4:5', label: '4:5', title: 'Portrait 4:5' },
  { value: '9:16', label: '9:16', title: 'Tall 9:16' },
  { value: '16:9', label: '16:9', title: 'Wide 16:9' },
];
const FITS: { value: GifFit; label: string; title: string }[] = [
  { value: 'fill', label: 'Fill', title: 'Crop each photo to cover the frame' },
  { value: 'fit', label: 'Fit', title: 'Show the whole photo on a background colour' },
];
const WIDTHS = GIF_WIDTHS.map((w) => ({ value: String(w), label: String(w), title: `${w} px wide` }));

type Props = {
  value: GifSettings;
  onChange: (patch: Partial<GifSettings>) => void;
  /** Frames the animation will have, and how long it plays once through. */
  frameCount: number;
  duration: number;
  selected: number;
};

export function GifControls({ value, onChange, frameCount, duration, selected }: Props) {
  return (
    <aside className="sidebar gif-settings" aria-label="GIF settings">
      <section className="section">
        <div className="section-head"><h2 className="section-title">Timing</h2></div>
        <span className="field-label">Seconds per photo</span>
        <Slider label="Seconds per photo" min={0.1} max={2} step={0.1} value={value.secondsPerFrame} format={(v) => `${v.toFixed(1)} s`} onChange={(secondsPerFrame) => onChange({ secondsPerFrame })} />
        <Check checked={value.holdEnds} onChange={(holdEnds) => onChange({ holdEnds })} label="Hold first and last frame" />
        <Check checked={value.boomerang} onChange={(boomerang) => onChange({ boomerang })} label="Boomerang (forward, then back)" />
        <Check checked={value.crossfade} onChange={(crossfade) => onChange({ crossfade })} label="Crossfade between photos" />
        <span className="field-label">Loop</span>
        <Segmented label="Loop" options={LOOPS} value={value.loop} onChange={(loop) => onChange({ loop })} />
      </section>
      <section className="section">
        <div className="section-head"><h2 className="section-title">Picture</h2></div>
        <span className="field-label">Shape</span>
        <div className="finish-row"><Segmented label="Shape" options={SHAPES} value={value.shape} onChange={(shape) => onChange({ shape })} /></div>
        <span className="field-label">Photos</span>
        <Segmented label="Fit" options={FITS} value={value.fit} onChange={(fit) => onChange({ fit })} />
        {value.fit === 'fit' && (
          <div className="color-row">
            <span className="field-label">Background</span>
            <input type="color" className="borders-swatch" aria-label="Background colour" value={value.background} onChange={(e) => onChange({ background: e.target.value })} />
          </div>
        )}
        <span className="field-label">Width, px</span>
        <Segmented label="Width" options={WIDTHS} value={String(value.width)} onChange={(w) => onChange({ width: Number(w) })} />
      </section>
      <section className="section">
        <p className="gif-estimate" data-testid="gif-estimate" role="status">
          {selected < 2
            ? 'Select at least 2 photos.'
            : `${frameCount} frames · ${formatSeconds(duration)}${frameCount > MAX_FRAMES ? ` (over the ${MAX_FRAMES}-frame limit)` : ''}`}
        </p>
      </section>
    </aside>
  );
}
