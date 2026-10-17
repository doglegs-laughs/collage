import { useEffect, useState } from 'react';
import type { RecentItem } from '../core/recents';

export function RecentsStrip({ items, usedIds, onToggle, onForget }: {
  items: RecentItem[];
  usedIds: ReadonlySet<string>;
  onToggle: (item: RecentItem) => void;
  onForget: (item: RecentItem) => void;
}) {
  const [urls, setUrls] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    const made = new Map(items.map((i) => [i.id, URL.createObjectURL(i.thumb)]));
    setUrls(made);
    return () => made.forEach((u) => URL.revokeObjectURL(u));
  }, [items]);

  return (
    <div data-testid="recents">
      <div className="section-head" style={{ margin: '18px 0 0' }}>
        <h2 className="section-title">Recent</h2>
        <span className="section-note">{items.length || ''}</span>
      </div>
      <div className="tray-grid">
        {items.map((item) => {
          const used = usedIds.has(item.id);
          return (
            <div className="tray-item" key={item.id}>
              <button type="button" className={`tray-pick ${used ? 'selected' : ''}`} title={item.name} aria-pressed={used} onClick={() => onToggle(item)}>
                {urls.get(item.id) && <img src={urls.get(item.id)} alt={item.name} />}
                <span className="tray-check">✓</span>
              </button>
              <button type="button" className="tray-remove" aria-label={`Remove ${item.name} from recents`} title="Remove from recents" onClick={() => onForget(item)}>×</button>
            </div>
          );
        })}
      </div>
      {!items.length && <p className="hint">Photos you add show up here next time.</p>}
    </div>
  );
}
