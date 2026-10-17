import { SHAPES, MAX_BORDER, type Shape, type Size } from '../core/geometry';
import type { RecentItem } from '../core/recents';
import { Button, Slider, Stepper } from '../ui/Controls';
import { RecentsStrip } from './RecentsStrip';

type Props = {
  rows: number;
  columns: number;
  shape: Shape;
  border: number;
  cell: Size | null;
  firstSize: Size | null;
  filled: number;
  capacity: number;
  onRows: (n: number) => void;
  onColumns: (n: number) => void;
  onShape: (s: Shape) => void;
  onBorder: (n: number) => void;
  onAdd: () => void;
  recents: RecentItem[] | null;
  usedIds: ReadonlySet<string>;
  onToggleRecent: (item: RecentItem) => void;
  onForgetRecent: (item: RecentItem) => void;
};

function ShapeButton({ shape, active, first, onClick }: { shape: Shape; active: boolean; first: Size | null; onClick: () => void }) {
  const [w, h] = shape ?? (first ? [first.width, first.height] : [4, 3]);
  const k = 18 / Math.max(w, h);
  return (
    <button type="button" className="shape" aria-pressed={active} title={shape ? `${w}:${h} boxes` : 'Match photo 1’s shape'} onClick={onClick}>
      <i style={{ width: Math.max(5, w * k), height: Math.max(5, h * k) }} />
      {shape ? `${w}:${h}` : 'Photo 1'}
    </button>
  );
}

export function Sidebar(p: Props) {
  return (
    <aside className="sidebar" aria-label="Collage settings">
      <section className="section">
        <div className="section-head"><h2 className="section-title">Photos</h2><span className="section-note" data-testid="fill-count">{p.filled} of {p.capacity}</span></div>
        <Button variant="soft" block onClick={p.onAdd} data-testid="add-photos">
          <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M10 4v12M4 10h12" /></svg>
          Add photos
        </Button>
        <p className="hint">Or drop photos anywhere, or paste one with ⌘V / Ctrl+V.</p>
        {p.recents && (
          <RecentsStrip items={p.recents} usedIds={p.usedIds} onToggle={p.onToggleRecent} onForget={p.onForgetRecent} />
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">Layout</h2>
          <span className="section-note">{p.cell ? `tiles ${p.cell.width} × ${p.cell.height}` : ''}</span>
        </div>
        <div className="dims">
          <div><span className="field-label">Rows</span><Stepper label="Rows" value={p.rows} onChange={p.onRows} /></div>
          <div><span className="field-label">Columns</span><Stepper label="Columns" value={p.columns} onChange={p.onColumns} /></div>
        </div>
        <span className="field-label" style={{ marginTop: 16 }}>Box shape</span>
        <div className="shapes" role="group" aria-label="Box shape">
          {SHAPES.map((s, i) => (
            <ShapeButton key={i} shape={s} active={s === p.shape} first={p.firstSize} onClick={() => p.onShape(s)} />
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">Border</h2></div>
        <Slider value={p.border} min={0} max={MAX_BORDER} onChange={p.onBorder} label="White border width" format={(v) => `${v} px`} />
        <p className="hint">White space between and around photos.</p>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">Tips</h2></div>
        <ul className="tips">
          <li><b>Zoom</b>Scroll, pinch, or the slider</li>
          <li><b>Reframe</b>Drag the photo</li>
          <li><b>Reset</b>Double-click the photo</li>
          <li><b>Reorder</b>Drag the ⠿ number badge</li>
          <li><b>Keys</b>Select a photo, then arrows, + / −, 0, Delete</li>
        </ul>
        <p className="hint">Everything happens on this device. Photos are never uploaded.</p>
      </section>
    </aside>
  );
}
