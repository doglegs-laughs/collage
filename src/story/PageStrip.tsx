import { Fragment, useState, type DragEvent } from 'react';
import { Button } from '../ui/Controls';
import { aspectRatio, hiddenCount, type Story } from './model';

const PAGE_DRAG = 'application/x-story-page';

type Props = {
  story: Story;
  pageIndex: number;
  thumbs: (string | null)[];
  onSelect: (i: number) => void;
  onMove: (from: number, to: number) => void;
  onAdd: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleHidden: (i: number) => void;
  onMenu: (i: number, x: number, y: number) => void;
};

export function PageStrip({ story, pageIndex, thumbs, onSelect, onMove, onAdd, onDuplicate, onDelete, onToggleHidden, onMenu }: Props) {
  const [over, setOver] = useState<number | null>(null);
  const ratio = aspectRatio(story.aspect);
  const spreadWith = (i: number, d: number) => {
    const a = story.pages[i]?.spread;
    const b = story.pages[i + d]?.spread;
    return !!a && !!b && a.count === b.count && b.index === a.index + d;
  };
  const onDrop = (e: DragEvent, to: number) => {
    setOver(null);
    const from = Number(e.dataTransfer.getData(PAGE_DRAG));
    if (e.dataTransfer.types.includes(PAGE_DRAG) && Number.isFinite(from)) {
      e.preventDefault();
      onMove(from, to);
    }
  };
  return (
    <section className="story-strip" aria-label="Pages" data-testid="page-strip">
      <div className="strip-scroll">
        {story.pages.map((p, i) => (
          <Fragment key={p.id}>
          {i > 0 && !spreadWith(i - 1, 1) && <i className="strip-gap" aria-hidden="true"><span data-strip-at={i} /></i>}
          <div
            className={`strip-item ${i === pageIndex ? 'current' : ''} ${over === i ? 'over' : ''} ${spreadWith(i, 1) ? 'link-next' : ''} ${spreadWith(i, -1) ? 'link-prev' : ''} ${p.hidden ? 'is-hidden' : ''}`}
            data-testid="strip-page" data-hidden={p.hidden ? 'true' : 'false'}
            onContextMenu={(e) => { e.preventDefault(); onMenu(i, e.clientX, e.clientY); }}
            draggable
            title={p.spread ? `Page ${i + 1} (spread ${p.spread.index + 1} of ${p.spread.count})` : `Page ${i + 1}`}
            onClick={() => onSelect(i)}
            onDragStart={(e) => { e.dataTransfer.setData(PAGE_DRAG, String(i)); e.dataTransfer.effectAllowed = 'move'; }}
            onDragOver={(e) => { if (e.dataTransfer.types.includes(PAGE_DRAG)) { e.preventDefault(); setOver(i); } }}
            onDragLeave={() => setOver((o) => (o === i ? null : o))}
            onDrop={(e) => onDrop(e, i)}
          >
            <div className="strip-thumb" style={{ aspectRatio: String(ratio), background: p.background }}>
              {thumbs[i] && <img src={thumbs[i]!} alt={`Page ${i + 1}`} draggable={false} />}
            </div>
            <span className="strip-num">{i + 1}</span>
            <button
              type="button" className="strip-eye" data-testid="strip-eye" draggable={false}
              aria-label={p.hidden ? `Show page ${i + 1}` : `Hide page ${i + 1}`} aria-pressed={!!p.hidden}
              title={p.hidden ? 'Hidden from exports. Click to show this page' : 'Hide this page from exports'}
              onClick={(e) => { e.stopPropagation(); onToggleHidden(i); }}
            >
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M1.8 10S5 4.5 10 4.5 18.2 10 18.2 10 15 15.5 10 15.5 1.8 10 1.8 10Z" /><circle cx="10" cy="10" r="2.4" />
                {p.hidden && <path d="M3.5 16.5 16.5 3.5" />}
              </svg>
            </button>
          </div>
          </Fragment>
        ))}
        <div className="strip-new" data-strip-at={story.pages.length} data-testid="strip-new-page" title="Drag a photo here to give it a page of its own">＋ New page</div>
      </div>
      <div className="strip-actions">
        <span className="strip-count" data-testid="strip-count">{story.pages.length} {story.pages.length === 1 ? 'page' : 'pages'}{hiddenCount(story) ? ` · ${hiddenCount(story)} hidden` : ''}</span>
        <Button variant="soft" onClick={onAdd} title="Add a blank page after this one" data-testid="page-add">Add page</Button>
        <Button onClick={onDuplicate} title="Duplicate this page">Duplicate</Button>
        <Button onClick={onDelete} title="Delete this page" data-testid="page-delete">Delete</Button>
      </div>
    </section>
  );
}
