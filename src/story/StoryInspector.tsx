import { useState, type ReactNode } from 'react';
import { Button, Segmented, Slider } from '../ui/Controls';
import type { Photo } from '../core/images';
import { Check, ColorInput, Field } from './fields';
import { LayoutPicker } from './LayoutPicker';
import type { LayoutOption } from './layouts';
import { ASPECTS, hiddenCount, type Aspect, type Page, type StyleId, type Story } from './model';

type Change = { style?: StyleId; aspect?: Aspect };
type Props = {
  story: Story;
  subtitle: string;
  page: Page;
  pageIndex: number;
  extraPhotos: Photo[];
  onLayout: (o: LayoutOption) => void;
  onPage: (p: Partial<Page>, key: string) => void;
  onTitle: (t: string) => void;
  onSubtitle: (t: string) => void;
  onRecreate: (c: Change) => void;
  onToggleHidden: () => void;
  onAddText: () => void;
  onAddSlot: () => void;
  onAddRect: () => void;
  /** Rendered between the Page and Story sections (the selected element's controls). */
  children?: ReactNode;
};

/** Page and story-level controls (always shown under the element section). */
export function StoryInspector(p: Props) {
  const { story, page } = p;
  const [pending, setPending] = useState<Change | null>(null);
  const request = (c: Change) => {
    if ((c.style ?? story.style) === story.style && (c.aspect ?? story.aspect) === story.aspect) return;
    setPending(c);
  };
  const what = pending ? (pending.style ? `the ${pending.style} style` : `${pending.aspect} pages`) : '';
  return (
    <>
      <section className="section" data-testid="inspector-page">
        <div className="section-head"><h2 className="section-title">Page</h2></div>
        <Field label="Layout">
          <LayoutPicker story={story} pageIndex={p.pageIndex} extraPhotos={p.extraPhotos} onApply={p.onLayout} testId="layout-section" />
        </Field>
        <Check label="Hide page" checked={!!page.hidden} onChange={p.onToggleHidden} />
        <Field label="Background">
          <ColorInput label="Page background" value={page.background} onChange={(v) => p.onPage({ background: v }, `bg-${page.id}`)} />
        </Field>
        <Field label="Duration in video">
          <Slider label="Page duration" value={page.duration} min={1} max={10} step={0.5} format={(v) => `${v.toFixed(1)} s`} onChange={(v) => p.onPage({ duration: v }, `dur-${page.id}`)} />
        </Field>
        <div className="btn-row">
          <Button variant="soft" onClick={p.onAddText}>Add text</Button>
          <Button variant="soft" onClick={p.onAddSlot}>Add photo slot</Button>
          <Button variant="soft" onClick={p.onAddRect}>Add shape</Button>
        </div>
      </section>
      {p.children}
      <section className="section" data-testid="inspector-story">
        <div className="section-head"><h2 className="section-title">Story</h2></div>
        <Field label="Title">
          <input className="text-input" aria-label="Story title" value={story.title} onChange={(e) => p.onTitle(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Subtitle">
          <input className="text-input" aria-label="Story subtitle" value={p.subtitle} onChange={(e) => p.onSubtitle(e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Style">
          <Segmented<'clean' | 'stylized'> label="Style" value={story.style === 'stylized' ? 'stylized' : 'clean'} options={[{ value: 'clean', label: 'Clean' }, { value: 'stylized', label: 'Stylized' }]} onChange={(v) => request({ style: v })} />
        </Field>
        <Field label="Page shape">
          <Segmented<Aspect> label="Aspect" value={story.aspect} options={ASPECTS.map((a) => ({ value: a, label: a }))} onChange={(v) => request({ aspect: v })} />
        </Field>
        {pending && (
          <div className="confirm" role="alertdialog" aria-label="Confirm re-create">
            <p>Re-create every page with {what}? Your edits to the pages are replaced (undo brings them back).{hiddenCount(story) > 0 && ' Hidden pages will be regenerated too.'}</p>
            <div className="btn-row">
              <Button variant="primary" onClick={() => { p.onRecreate(pending); setPending(null); }}>Re-create</Button>
              <Button onClick={() => setPending(null)}>Cancel</Button>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
