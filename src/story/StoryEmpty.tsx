import { useState } from 'react';
import { Button, Segmented } from '../ui/Controls';
import type { AutosaveFile, RecentStory } from '../api';
import { ASPECTS, type Aspect, type StyleId } from './model';

export function relativeTime(then: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'} ago`;
}

export type ResumeProps = {
  resume: AutosaveFile | null;
  recents: RecentStory[];
  onContinue: () => void;
  onDismiss: () => void;
  onOpenRecent: (path: string) => void;
  onRemoveRecent: (path: string) => void;
};

export type MakeOpts = { style: StyleId; aspect: Aspect; title: string; subtitle: string };

/** The one-click start: pick a look, optionally add a title, press Make story. */
export function StoryEmpty({ photoCount, busy, onMake, resumeProps }: { photoCount: number; busy: boolean; onMake: (o: MakeOpts) => void; resumeProps?: ResumeProps }) {
  const [style, setStyle] = useState<'clean' | 'stylized'>('clean');
  const [aspect, setAspect] = useState<Aspect>('4:5');
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const submit = () => onMake({ style, aspect, title: title.trim(), subtitle: subtitle.trim() });
  return (
    <div className="story-empty" data-testid="story-empty">
      <div className="story-empty-stack">
      {resumeProps?.resume && (
        <div className="story-empty-card resume-card" data-testid="resume-card">
          {resumeProps.resume.meta.thumb && <img className="resume-thumb" src={resumeProps.resume.meta.thumb} alt="First page of your last story" />}
          <div className="resume-body">
            <h2>Continue where you left off</h2>
            <p className="lede">
              {resumeProps.resume.meta.title?.trim() || 'Untitled story'}, {resumeProps.resume.meta.pageCount ?? '?'} page{resumeProps.resume.meta.pageCount === 1 ? '' : 's'}
              {resumeProps.resume.meta.savedAt ? `, edited ${relativeTime(resumeProps.resume.meta.savedAt)}` : ''}
            </p>
            <div className="btn-row">
              <Button variant="primary" onClick={resumeProps.onContinue} data-testid="resume-continue">Continue</Button>
              <Button onClick={resumeProps.onDismiss} data-testid="resume-new">Start new</Button>
            </div>
          </div>
        </div>
      )}
      {!!resumeProps?.recents.length && (
        <div className="story-empty-card recent-stories" data-testid="recent-stories">
          <h2>Recent stories</h2>
          <ul>
            {resumeProps.recents.map((r) => (
              <li key={r.path}>
                <button type="button" className="link" disabled={!r.exists} title={r.path} onClick={() => resumeProps.onOpenRecent(r.path)} data-testid="recent-story">{r.name}</button>
                {!r.exists && <span className="muted"> Not found <button type="button" className="link" onClick={() => resumeProps.onRemoveRecent(r.path)}>Remove</button></span>}
              </li>
            ))}
          </ul>
        </div>
      )}
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
    </div>
  );
}
