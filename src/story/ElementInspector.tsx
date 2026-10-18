import { DEFAULT_CROP } from '../core/geometry';
import { Button, Segmented, Slider } from '../ui/Controls';
import { Check, ColorInput, Field, deg, pct } from './fields';
import { FONT_KEYS, FONT_LABELS } from './fonts';
import type { El, FontKey, PhotoEl, RectEl, TextEl } from './model';

type Common = { patch: (p: Partial<El>, key: string) => void; id: string };
const K = (id: string, field: string) => `insp-${field}-${id}`;

function Rotation({ el, patch }: Common & { el: El }) {
  return (
    <Field label="Rotation">
      <Slider label="Rotation" value={el.rotation} min={-180} max={180} step={1} format={deg} onChange={(v) => patch({ rotation: v }, K(el.id, 'rot'))} />
    </Field>
  );
}

function PhotoInspector({ el, patch, onReplace, onRemove, onMoveOwn, canMoveOwn }: Common & { el: PhotoEl; onReplace: () => void; onRemove: () => void; onMoveOwn: () => void; canMoveOwn: boolean }) {
  const preset = el.frameColor.toLowerCase() === '#ffffff' ? 'white' : el.frameColor.toLowerCase() === '#000000' ? 'black' : 'custom';
  return (
    <>
      <Field label="Frame width">
        <Slider label="Frame width" value={el.frame} min={0} max={0.08} step={0.001} format={pct()} onChange={(v) => patch({ frame: v }, K(el.id, 'frame'))} />
      </Field>
      <Field label="Frame color">
        <div className="color-row">
          <Segmented
            label="Frame color"
            value={preset}
            options={[{ value: 'white', label: 'White' }, { value: 'black', label: 'Black' }, { value: 'custom', label: 'Custom' }]}
            onChange={(v) => v !== 'custom' && patch({ frameColor: v === 'white' ? '#ffffff' : '#000000' }, K(el.id, 'fc'))}
          />
          <ColorInput label="Custom frame color" value={el.frameColor} onChange={(v) => patch({ frameColor: v }, K(el.id, 'fc'))} />
        </div>
      </Field>
      <Field label="Bottom band (polaroid)">
        <Slider label="Bottom band" value={el.frameBottom} min={0} max={0.2} step={0.002} format={pct()} onChange={(v) => patch({ frameBottom: v }, K(el.id, 'fb'))} />
      </Field>
      <Field label="Blur">
        <Slider label="Blur" value={el.blur} min={0} max={1} step={0.01} format={pct(0)} onChange={(v) => patch({ blur: v }, K(el.id, 'blur'))} />
      </Field>
      <Check label="Drop shadow" checked={el.shadow} onChange={(v) => patch({ shadow: v }, K(el.id, 'shadow'))} />
      <Rotation el={el} patch={patch} id={el.id} />
      <div className="btn-row">
        <Button variant="soft" disabled={!el.photoId} onClick={() => patch({ crop: { ...DEFAULT_CROP } }, K(el.id, 'crop'))}>Reset crop</Button>
        <Button variant="soft" onClick={onReplace}>Replace photo</Button>
        <Button onClick={onRemove}>Remove</Button>
      </div>
      <div className="btn-row">
        <Button
          variant="soft" disabled={!canMoveOwn} onClick={onMoveOwn} data-testid="move-own-page"
          title={canMoveOwn ? 'Give this photo a page of its own (⇧⌘N)' : 'This page has only one photo'}
        >
          Move to its own page
        </Button>
      </div>
      <p className="hint">Double-click the photo to pan and zoom inside its frame.</p>
    </>
  );
}

function TextInspector({ el, patch }: Common & { el: TextEl }) {
  return (
    <>
      <Field label="Text">
        <textarea className="text-input" aria-label="Text content" rows={3} value={el.text} onChange={(e) => patch({ text: e.target.value }, K(el.id, 'text'))} />
      </Field>
      <Field label="Font">
        <select className="select" aria-label="Font" value={el.font} onChange={(e) => patch({ font: e.target.value as FontKey }, K(el.id, 'font'))}>
          {FONT_KEYS.map((k) => <option key={k} value={k}>{FONT_LABELS[k]}</option>)}
        </select>
      </Field>
      <Field label="Size">
        <Slider label="Size" value={el.size} min={0.01} max={0.25} step={0.001} format={pct()} onChange={(v) => patch({ size: v }, K(el.id, 'size'))} />
      </Field>
      <Field label="Weight">
        <Segmented
          label="Weight"
          value={String(el.weight)}
          options={[{ value: '300', label: 'Thin' }, { value: '400', label: 'Regular' }, { value: '600', label: 'Semi' }, { value: '800', label: 'Bold' }]}
          onChange={(v) => patch({ weight: Number(v) as TextEl['weight'] }, K(el.id, 'weight'))}
        />
      </Field>
      <Field label="Align">
        <Segmented
          label="Align"
          value={el.align}
          options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]}
          onChange={(v) => patch({ align: v }, K(el.id, 'align'))}
        />
      </Field>
      <Field label="Color">
        <ColorInput label="Text color" value={el.color} onChange={(v) => patch({ color: v }, K(el.id, 'color'))} />
      </Field>
      <Field label="Letter spacing">
        <Slider label="Letter spacing" value={el.letterSpacing} min={-0.05} max={0.6} step={0.01} format={(v) => `${v.toFixed(2)} em`} onChange={(v) => patch({ letterSpacing: v }, K(el.id, 'ls'))} />
      </Field>
      <Check label="Uppercase" checked={el.uppercase} onChange={(v) => patch({ uppercase: v }, K(el.id, 'upper'))} />
      <Check label="Shadow" checked={el.shadow} onChange={(v) => patch({ shadow: v }, K(el.id, 'shadow'))} />
      <Rotation el={el} patch={patch} id={el.id} />
      <p className="hint">Double-click the text on the page to edit it in place.</p>
    </>
  );
}

function RectInspector({ el, patch }: Common & { el: RectEl }) {
  const hasStroke = !!el.stroke && el.stroke !== 'transparent';
  return (
    <>
      <Field label="Fill">
        <ColorInput label="Fill color" value={el.fill} onChange={(v) => patch({ fill: v }, K(el.id, 'fill'))} />
      </Field>
      <Field label="Outline">
        <div className="color-row">
          <ColorInput label="Outline color" value={hasStroke ? el.stroke : '#000000'} onChange={(v) => patch({ stroke: v, strokeWidth: el.strokeWidth || 0.004 }, K(el.id, 'stroke'))} />
          <Button variant="soft" disabled={!hasStroke} onClick={() => patch({ stroke: 'transparent' }, K(el.id, 'stroke'))}>None</Button>
        </div>
      </Field>
      <Field label="Outline width">
        <Slider label="Outline width" value={el.strokeWidth} min={0} max={0.03} step={0.001} format={pct()} onChange={(v) => patch({ strokeWidth: v }, K(el.id, 'sw'))} />
      </Field>
      <Field label="Corner radius">
        <Slider label="Corner radius" value={el.radius} min={0} max={0.2} step={0.002} format={pct()} onChange={(v) => patch({ radius: v }, K(el.id, 'radius'))} />
      </Field>
      <Check label="Drop shadow" checked={el.shadow} onChange={(v) => patch({ shadow: v }, K(el.id, 'shadow'))} />
      <Rotation el={el} patch={patch} id={el.id} />
    </>
  );
}

type Props = {
  els: El[];
  patch: (p: Partial<El>, key: string) => void;
  onReplace: () => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMoveOwn: () => void;
  canMoveOwn: boolean;
};

export function ElementInspector({ els, patch, onReplace, onRemove, onDuplicate, onMoveOwn, canMoveOwn }: Props) {
  if (els.length === 0) return null;
  if (els.length > 1) {
    return (
      <section className="section" data-testid="inspector-element">
        <div className="section-head"><h2 className="section-title">{els.length} selected</h2></div>
        <div className="btn-row">
          <Button variant="soft" onClick={onDuplicate}>Duplicate</Button>
          <Button onClick={onRemove}>Delete</Button>
        </div>
      </section>
    );
  }
  const [el] = els;
  const common = { patch, id: el.id };
  return (
    <section className="section" data-testid="inspector-element">
      <div className="section-head">
        <h2 className="section-title">{el.kind === 'photo' ? 'Photo' : el.kind === 'text' ? 'Text' : 'Shape'}</h2>
        <button type="button" className="link" onClick={onDuplicate}>Duplicate</button>
      </div>
      {el.kind === 'photo' ? <PhotoInspector {...common} el={el} onReplace={onReplace} onRemove={onRemove} onMoveOwn={onMoveOwn} canMoveOwn={canMoveOwn} /> : el.kind === 'text' ? <TextInspector {...common} el={el} /> : <RectInspector {...common} el={el} />}
      {el.kind !== 'photo' && (
        <div className="btn-row"><Button onClick={onRemove}>Remove</Button></div>
      )}
    </section>
  );
}
