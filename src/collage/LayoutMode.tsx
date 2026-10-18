import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { toJpeg } from '../core/canvas';
import { DEFAULT_CROP } from '../core/geometry';
import { useHistory } from '../core/history';
import { getBitmapForSize, type Photo } from '../core/images';
import { usePhotoLibrary } from '../core/library';
import { useHistoryTarget } from '../core/menuHistory';
import { usePasteImages } from '../core/usePasteImages';
import { PhotoTray } from '../ui/PhotoTray';
import { Button, Segmented, Slider } from '../ui/Controls';
import { useToast } from '../ui/Toast';
import { ContextMenu, type MenuItem } from '../story/ContextMenu';
import { LayoutPicker } from '../story/LayoutPicker';
import type { LayoutOption, LayoutTarget } from '../story/layouts';
import { emptyStory, type El, type Story } from '../story/model';
import { renderPage, type GetBitmap } from '../story/render';
import { StoryStage, type DropHit } from '../story/StoryStage';
import { useEditor } from '../story/useEditor';
import { useStoryKeys } from '../story/useStoryKeys';
import { useTraySelection } from '../story/useTraySelection';
import { collageFileName } from './renderCollage';
import {
  aspectFor, applyTarget, buildLayoutStory, chooseTarget, DEFAULT_SHAPE, exportLongEdge, exportSize, originalLongEdge, SHAPES, targetOf, unusedPhotos,
  type ExportChoice, type PageShape,
} from './layoutModeState';
import { TopbarActions } from './TopbarActions';
import { useVisible } from './useVisible';
import './layout.css';

const onePage = (o: LayoutOption) => o.pages === 1;
const noop = () => {};
const BACKGROUNDS = ['#ffffff', '#f4efe6', '#d9dde3', '#1f2937', '#000000'];

/** Collage "Layout" mode: the selected library photos laid out on one Story page, edited with the Story stage. */
export function LayoutMode({ active }: { active: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const paneVisible = useVisible(root);
  const visible = paneVisible && active;
  const toast = useToast();
  const lib = usePhotoLibrary();
  const tray = useTraySelection(lib.photos);
  const history = useHistory<Story>(() => emptyStory('4:5'));
  const story = history.state;
  const { set } = history;
  const live = useRef(story);
  live.current = story;
  const mutate = useCallback((fn: (s: Story) => Story, key?: string) => set(fn, key), [set]);
  const ed = useEditor(story, mutate);
  useHistoryTarget(visible, history);
  usePasteImages(visible, (files) => void lib.addFiles(files));

  const [shape, setShape] = useState<PageShape>(DEFAULT_SHAPE);
  const [background, setBackground] = useState('#ffffff');
  const [gap, setGap] = useState<number | null>(null);
  const [exportEdge, setExportEdge] = useState<ExportChoice>('2160');
  const [busy, setBusy] = useState<null | 'export' | 'story'>(null);
  const [menu, setMenu] = useState<{ id: string; x: number; y: number } | null>(null);

  /** Selected photos in selection order. */
  const photos = useMemo<Photo[]>(() => {
    const byId = new Map(lib.photos.map((p) => [p.id, p]));
    return tray.selected.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  }, [lib.photos, tray.selected]);
  const aspect = aspectFor(shape, photos);
  const spacing = useMemo(() => (gap !== null ? { gap, margin: gap } : {}), [gap]);
  const look = useMemo(() => ({ background, ...spacing }), [background, spacing]);

  // Re-apply the current arrangement and finish whenever the selection, page shape, spacing or background changes.
  const prevCount = useRef(0);
  useEffect(() => {
    const cur = live.current;
    const target = chooseTarget(photos, aspect, targetOf(cur), prevCount.current);
    prevCount.current = photos.length;
    const next = buildLayoutStory(cur, photos, aspect, target, look);
    if (next.pages[0].elements.length || cur.pages[0]?.elements.length || cur.aspect !== aspect) mutate(() => next);
  }, [photos, aspect, look, mutate]);

  const extra = useMemo(() => unusedPhotos(story, photos), [story, photos]);
  const { select, setCropId } = ed;
  const onApply = useCallback((target: LayoutTarget) => {
    const next = applyTarget(live.current, unusedPhotos(live.current, photos), target, spacing);
    if (next !== live.current) mutate(() => next);
    select([]);
    setCropId(null);
  }, [photos, spacing, mutate, select, setCropId]);

  const hasPhotos = photos.length > 0;
  const page = story.pages[0];
  const size = exportSize(story, exportLongEdge(exportEdge, story));
  const canExport = hasPhotos && !!page?.elements.some((e) => e.kind === 'photo' && e.photoId);

  const onScale = useCallback((w: number) => { ed.pxPerPage.current = w; }, [ed.pxPerPage]);
  const dropPhoto = (photoId: string, hit: DropHit) => {
    const photo = lib.get(photoId);
    if (photo && hit.elementId) ed.dropPhoto(photo, hit);
  };
  const replacePhoto = async () => {
    const [photo] = await lib.pick();
    if (photo) ed.replaceSelectedPhoto(photo);
  };
  const menuItems = (id: string): MenuItem[] => {
    const el = page?.elements.find((e) => e.id === id);
    if (!el || el.kind !== 'photo') return [];
    return [
      { label: 'Replace photo…', onSelect: () => void replacePhoto() },
      { label: 'Reset crop', onSelect: () => ed.patch([id], { crop: { ...DEFAULT_CROP } } as Partial<El>, `crop-${id}`), disabled: !el.photoId },
    ];
  };
  const closeMenu = useCallback(() => setMenu(null), []);

  useStoryKeys({
    enabled: visible, hasSelection: ed.selection.length > 0, cropping: !!ed.cropId, pageCount: 1, pageIndex: 0,
    remove: noop, nudge: ed.nudge, duplicate: noop, zOrder: noop,
    deselect: () => ed.select([]), selectAll: noop, exitCrop: () => ed.setCropId(null), goTo: noop, save: noop, open: noop,
    cycleLayout: noop, cycleFinish: noop, toggleHidden: noop, moveToOwnPage: noop,
  });

  /* ---- export ---- */
  const render = async (longEdge: number): Promise<{ data: Uint8Array }> => {
    const s = live.current;
    const canvas = await renderPage(s, 0, exportSize(s, longEdge).width, getBitmapForSize as GetBitmap, { closeAfterDraw: true });
    try {
      return { data: await toJpeg(canvas, 0.95) };
    } finally {
      if ('width' in canvas) { canvas.width = 0; canvas.height = 0; }
    }
  };
  const run = async (kind: 'export' | 'story', job: () => Promise<void>) => {
    setBusy(kind);
    try { await job(); } catch (error) { toast(error instanceof Error ? error.message : 'Something went wrong while exporting.', 'error'); }
    finally { setBusy(null); }
  };
  const doExport = () => run('export', async () => {
    const r = await render(exportLongEdge(exportEdge, live.current));
    const saved = await api.saveFile({ defaultName: collageFileName(), filters: [{ name: 'JPEG image', extensions: ['jpg', 'jpeg'] }], data: r.data });
    if (!saved) return;
    toast(`Saved ${saved.split(/[\\/]/).pop()}`, 'success');
  });
  const doSendToStory = () => run('story', async () => {
    const r = await render(exportLongEdge(exportEdge, live.current));
    const added = await lib.addFiles([new File([r.data as BlobPart], collageFileName(), { type: 'image/jpeg' })]);
    if (added.length) toast('Added the collage to your Story photos.', 'success');
  });

  return (
    <div ref={root} className="story-view layout-mode" data-testid="view-collage-layout">
      <aside className="sidebar story-tray">
        <div className="section">
          <PhotoTray
            photos={lib.photos} selected={tray.selected} onToggle={tray.toggle} onRemove={lib.remove}
            onImport={() => void lib.pick()} onDropFiles={(f) => void lib.addFiles(f)} onSelectAll={tray.all} onSelectNone={tray.none}
          />
          <p className="hint">Selected photos fill the layout in the order you select them.</p>
        </div>
      </aside>
      <div className="story-main layout-main">
        <div className="story-toolbar">
          <Button onClick={history.undo} disabled={!history.canUndo} title="Undo (⌘Z)" data-testid="layout-undo">Undo</Button>
          <Button onClick={history.redo} disabled={!history.canRedo} title="Redo (⇧⌘Z)" data-testid="layout-redo">Redo</Button>
          <span className="story-pagelabel" data-testid="layout-size">{hasPhotos ? `${size.width.toLocaleString()} × ${size.height.toLocaleString()} px` : 'Select photos to begin'}</span>
        </div>
        {hasPhotos && page ? (
          <StoryStage
            story={story} pageIndex={0} selection={ed.selection} cropId={ed.cropId} editingId={ed.editingId}
            onSelect={ed.select} onJump={noop} onCommit={ed.commitOverrides}
            onCrop={(id, crop) => ed.patch([id], { crop } as Partial<El>, `crop-${id}`)}
            onText={noop} setCropId={ed.setCropId} setEditingId={ed.setEditingId} onDropPhoto={dropPhoto} onScale={onScale}
            onContextMenu={(id, x, y) => setMenu({ id, x, y })} onDropOut={() => false}
          />
        ) : (
          <div className="story-stage layout-empty" data-testid="layout-empty">
            <p>{lib.photos.length ? 'Select one or more photos in the tray to lay them out.' : 'Add photos to the tray to lay them out on one page.'}</p>
            {!lib.photos.length && <Button variant="primary" onClick={() => void lib.pick()}>Add photos</Button>}
          </div>
        )}
      </div>
      <aside className="sidebar story-insp" data-testid="layout-inspector">
        <div className="section">
          <div className="section-head"><h2 className="section-title">Layout</h2></div>
          {hasPhotos && page?.elements.length ? (
            visible && <LayoutPicker story={story} pageIndex={0} extraPhotos={extra} onApply={onApply} filter={onePage} testId="layout-picker" />
          ) : <p className="hint">Layouts appear once photos are selected.</p>}
        </div>
        <div className="section">
          <span className="field-label">Page shape</span>
          <div data-testid="layout-shape">
            <Segmented label="Page shape" options={SHAPES} value={shape} onChange={setShape} />
            <button type="button" className="layout-match" aria-pressed={shape === 'match'} title="Match the shape of the first photo" onClick={() => setShape('match')}>Match photo 1</button>
          </div>
          <span className="field-label gap-top">Background</span>
          <div className="layout-swatches" data-testid="layout-background">
            {BACKGROUNDS.map((c) => (
              <button key={c} type="button" className={`layout-swatch ${background === c ? 'on' : ''}`} style={{ background: c }} aria-label={`Background ${c}`} aria-pressed={background === c} onClick={() => setBackground(c)} />
            ))}
            <input type="color" aria-label="Custom background colour" value={background} onChange={(e) => setBackground(e.target.value)} />
          </div>
          <span className="field-label gap-top">Gap and margin</span>
          <Slider value={Math.round((gap ?? 0.025) * 1000)} min={0} max={80} step={1} label="Gap and margin" format={(v) => `${(v / 10).toFixed(1)}%`} onChange={(v) => setGap(v / 1000)} />
          <span className="field-label gap-top">Export size</span>
          <div data-testid="layout-export-size">
            <Segmented<ExportChoice>
              label="Export size"
              options={[
                { value: '2160', label: '2160' },
                { value: '4096', label: '4096' },
                { value: 'original', label: 'Original', title: `Longest side at which no photo is enlarged (${originalLongEdge(story).toLocaleString()} px)` },
              ]}
              value={exportEdge} onChange={setExportEdge}
            />
          </div>
          <p className="hint">Long edge in pixels. Original keeps every photo at its own resolution, up to 8192.</p>
        </div>
      </aside>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.id)} onClose={closeMenu} />}
      <TopbarActions
        visible={visible}
        outputLabel={`${size.width.toLocaleString()} × ${size.height.toLocaleString()} px`}
        canExport={canExport}
        disabledReason="Select photos to export"
        busy={busy}
        progress=""
        onExport={doExport}
        onSendToStory={doSendToStory}
      />
    </div>
  );
}
