import { Fragment, useState, type DragEvent } from 'react';
import { Button } from '../ui/Controls';
import { aspectRatio, type Story } from './model';

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
};

export function PageStrip({ story, pageIndex, thumbs, onSelect, onMove, onAdd, onDuplicate, onDelete }: Props) {
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
            className={`strip-item ${i === pageIndex ? 'current' : ''} ${over === i ? 'over' : ''} ${spreadWith(i, 1) ? 'link-next' : ''} ${spreadWith(i, -1) ? 'link-prev' : ''}`}
            data-testid="strip-page"
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
          </div>
          </Fragment>
        ))}
        <div className="strip-new" data-strip-at={story.pages.length} data-testid="strip-new-page" title="Drag a photo here to give it a page of its own">＋ New page</div>
      </div>
      <div className="strip-actions">
        <Button variant="soft" onClick={onAdd} title="Add a blank page after this one" data-testid="page-add">Add page</Button>
        <Button onClick={onDuplicate} title="Duplicate this page">Duplicate</Button>
        <Button onClick={onDelete} title="Delete this page" data-testid="page-delete">Delete</Button>
      </div>
    </section>
  );
}
