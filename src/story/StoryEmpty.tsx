import { useState } from 'react';
import { Button, Segmented } from '../ui/Controls';
import { ASPECTS, type Aspect, type StyleId } from './model';

export type MakeOpts = { style: StyleId; aspect: Aspect; title: string; subtitle: string };

/** The one-click start: pick a look, optionally add a title, press Make story. */
export function StoryEmpty({ photoCount, busy, onMake }: { photoCount: number; busy: boolean; onMake: (o: MakeOpts) => void }) {
  const [style, setStyle] = useState<'clean' | 'stylized'>('clean');
  const [aspect, setAspect] = useState<Aspect>('4:5');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const submit = () => onMake({ style, aspect, title: title.trim(), subtitle: subtitle.trim() });
  return (
    <div className="story-empty" data-testid="story-empty">
      <div className="story-empty-card">
        <h1>Make a story</h1>
        <p className="lede">{photoCount ? `${photoCount} photo${photoCount === 1 ? '' : 's'} ready. One click lays them all out as swipeable pages.` : 'Add photos, then make a finished story in one click.'}</p>
        <Segmented<'clean' | 'stylized'> label="Style" value={style} options={[{ value: 'clean', label: 'Clean', title: 'White borders, matted singles, panoramas across pages' }, { value: 'stylized', label: 'Stylized', title: 'Polaroids, film strips and big type' }]} onChange={setStyle} />
        <div className="story-empty-fields">
          <input className="text-input" aria-label="Title" placeholder="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} data-testid="story-title" />
          <input className="text-input" aria-label="Subtitle" placeholder="Subtitle (optional)" value={subtitle} onChange={(e) => setSubtitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} data-testid="story-subtitle" />
        </div>
        <div>
          <span className="field-label">Page shape</span>
          <Segmented<Aspect> label="Aspect" value={aspect} options={ASPECTS.map((a) => ({ value: a, label: a }))} onChange={setAspect} />
        </div>
        <Button variant="primary" className="make-btn" busy={busy} onClick={submit} data-testid="make-story">
          {photoCount ? 'Make story' : 'Choose photos & make story'}
        </Button>
      </div>
    </div>
  );
}
