import { Segmented, Slider } from '../ui/Controls';
import { DEFAULT_FRAME_PCT, DEFAULT_MAT_PCT, FRAME_RANGE, MAT_RANGE, type BorderShape, type FinishId, type FinishOptions } from './borderMath';
import type { ColorChoice } from './render';

export type BorderSettings = FinishOptions & { color: ColorChoice; customColor: string; caption: string };

export const DEFAULT_SETTINGS: BorderSettings = {
  finish: 'white',
  framePct: DEFAULT_FRAME_PCT.black,
  matPct: DEFAULT_MAT_PCT,
  caption: '',
  borderPct: 5,
  shape: 'original',
  longEdge: 'original',
  color: 'white',
  customColor: '#808080',
};

const FINISHES: { value: FinishId; label: string; title: string }[] = [
  { value: 'white', label: 'White border', title: 'Plain border around the photo' },
  { value: 'black', label: 'Black border', title: 'Thin black frame around the photo inside the border' },
  { value: 'mat', label: 'Print mat', title: 'Photo on a paper mat with a hairline outline and soft shadow' },
  { value: 'framed', label: 'Framed', title: 'Black frame with a soft drop shadow' },
  { value: 'polaroid', label: 'Polaroid', title: 'Off-white card with a thick bottom band' },
];
const COLORS: { value: ColorChoice; label: string }[] = [
  { value: 'white', label: 'White' },
  { value: 'black', label: 'Black' },
  { value: 'custom', label: 'Custom' },
];
const SHAPES: { value: BorderShape; label: string; title: string }[] = [
  { value: 'original', label: 'Original', title: 'Even border on all sides' },
  { value: '1:1', label: '1:1', title: 'Square canvas' },
  { value: '4:5', label: '4:5', title: 'Portrait 4:5 canvas' },
  { value: '9:16', label: '9:16', title: 'Tall 9:16 canvas' },
];
type SizeKey = 'original' | '2160' | '1080';
const SIZES: { value: SizeKey; label: string; title: string }[] = [
  { value: 'original', label: 'Original', title: 'Native resolution' },
  { value: '2160', label: '2160', title: 'Long edge 2160 px' },
  { value: '1080', label: '1080', title: 'Long edge 1080 px' },
];

export function BorderControls({ value, onChange }: { value: BorderSettings; onChange: (patch: Partial<BorderSettings>) => void }) {
  return (
    <section className="section borders-options" aria-label="Border options">
      <div className="section-head">
        <h2 className="section-title">Border</h2>
      </div>
      <span className="field-label">Finish</span>
      <div className="finish-row">
        <Segmented
          label="Finish"
          options={FINISHES}
          value={value.finish}
          onChange={(finish) => onChange({ finish, ...(finish === 'black' || finish === 'framed' ? { framePct: DEFAULT_FRAME_PCT[finish] } : {}) })}
        />
      </div>
      {(value.finish === 'black' || value.finish === 'framed') && (
        <>
          <span className="field-label">Frame thickness, % of long edge</span>
          <Slider label="Frame thickness" {...FRAME_RANGE} value={value.framePct} format={(v) => `${v}%`} onChange={(framePct) => onChange({ framePct })} />
        </>
      )}
      {value.finish === 'mat' && (
        <>
          <span className="field-label">Mat padding, % of long edge</span>
          <Slider label="Mat padding" {...MAT_RANGE} value={value.matPct} format={(v) => `${v}%`} onChange={(matPct) => onChange({ matPct })} />
        </>
      )}
      {value.finish === 'polaroid' && (
        <>
          <span className="field-label">Caption</span>
          <input type="text" className="text-input" aria-label="Caption" placeholder="Optional caption" maxLength={80} value={value.caption} onChange={(e) => onChange({ caption: e.target.value })} />
        </>
      )}
      <span className="field-label">{value.finish === 'mat' ? 'Space around the paper, % of long edge' : 'Size, % of long edge'}</span>
      <Slider
        label="Border size"
        min={0}
        max={20}
        step={0.5}
        value={value.borderPct}
        format={(v) => `${v}%`}
        onChange={(borderPct) => onChange({ borderPct })}
      />
      <span className="field-label">{value.finish === 'mat' ? 'Page color' : 'Color'}</span>
      <div className="color-row">
        <Segmented label="Border color" options={COLORS} value={value.color} onChange={(color) => onChange({ color })} />
        <input
          type="color"
          className="borders-swatch"
          aria-label="Custom color"
          title="Pick a custom color"
          value={value.customColor}
          onChange={(e) => onChange({ customColor: e.target.value, color: 'custom' })}
        />
      </div>
      <span className="field-label">Canvas shape</span>
      <Segmented label="Canvas shape" options={SHAPES} value={value.shape} onChange={(shape) => onChange({ shape })} />
      <span className="field-label">Output long edge, px</span>
      <Segmented
        label="Output size"
        options={SIZES}
        value={String(value.longEdge) as SizeKey}
        onChange={(k) => onChange({ longEdge: k === 'original' ? 'original' : k === '2160' ? 2160 : 1080 })}
      />
    </section>
  );
}
