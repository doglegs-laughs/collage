import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Photo } from '../core/images';
import { usePhotoLibrary } from '../core/library';
import { usePasteImages } from '../core/usePasteImages';
import { api } from '../api';
import { PhotoTray } from '../ui/PhotoTray';
import { Button } from '../ui/Controls';
import { useToast } from '../ui/Toast';
import { useVisible } from '../collage/useVisible';
import { ElementInspector } from './ElementInspector';
import { ExportStatus, ImagesDialog, VideoDialog } from './ExportDialogs';
import { LayoutControl } from './LayoutControl';
import { PageStrip } from './PageStrip';
import { photoIdsInUse, removePhotos, updatePage, type El, type Story } from './model';
import { StoryEmpty, type MakeOpts } from './StoryEmpty';
import { StoryInspector } from './StoryInspector';
import { StoryStage, type DropHit } from './StoryStage';
import { StoryTopbar } from './StoryTopbar';
import { useEditor } from './useEditor';
import { useExporter } from './useExporter';
import { usePageThumbs } from './usePageThumbs';
import { useProject } from './useProject';
import { useStory } from './useStory';
import { useStoryKeys } from './useStoryKeys';
import { useTraySelection } from './useTraySelection';

export function StoryView() {
  const root = useRef<HTMLDivElement>(null);
  const visible = useVisible(root);
  const toast = useToast();
  const lib = usePhotoLibrary();
  const tray = useTraySelection(lib.photos);
  const st = useStory();
  const { story, history } = st;
  const ed = useEditor(story, st.mutate);
  const thumbs = usePageThumbs(story);
  const getStory = useCallback(() => st.live.current, [st.live]);
  const exporter = useExporter(getStory);
  const dirtyRef = useRef(st.dirty);
  dirtyRef.current = st.dirty;
  const isDirty = useCallback(() => dirtyRef.current, []);
  const project = useProject(getStory, lib, useCallback((s: Story) => { st.load(s); ed.goTo(0); }, [st.load, ed.goTo]), { isDirty, onSaved: st.markSaved }); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { api.setDirty(st.dirty); }, [st.dirty]);
  usePasteImages(visible, (files) => void lib.addFiles(files));
  const [panel, setPanel] = useState<null | 'images' | 'video'>(null);
  const [making, setMaking] = useState(false);
  const hasPages = story.pages.length > 0;
  const { page, pageIndex, selection } = ed;

  /** Photos to build from: the tray selection in click order (all photos when none are selected). */
  const chosen = useCallback((): Photo[] => {
    const byId = new Map(lib.photos.map((p) => [p.id, p]));
    const sel = tray.selected.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
    return sel.length ? sel : lib.photos;
  }, [lib.photos, tray.selected]);

  const make = async (o: MakeOpts) => {
    setMaking(true);
    try {
      let photos = chosen();
      if (!photos.length) photos = await lib.pick();
      if (!photos.length) return;
      const n = st.generate(photos, o);
      ed.goTo(0);
      if (!n) toast('Nothing to lay out yet. Add a title or some photos.', 'error');
    } finally {
      setMaking(false);
    }
  };
  const shuffle = () => {
    const photos = chosen();
    st.generate(photos.length ? photos : story.photos);
    ed.goTo(0);
  };
  const recreate = (c: { style?: MakeOpts['style']; aspect?: MakeOpts['aspect'] }) => {
    st.generate(story.photos.length ? story.photos : chosen(), { ...c, seed: st.seed });
    ed.goTo(0);
  };

  const dropPhoto = (photoId: string, hit: DropHit) => {
    const photo = lib.get(photoId);
    if (photo) ed.dropPhoto(photo, hit);
  };
  const replacePhoto = async () => {
    const [photo] = await lib.pick();
    if (photo) ed.replaceSelectedPhoto(photo);
  };
  const removeFromTray = (id: string) => {
    lib.remove(id);
    st.mutate((s) => removePhotos(s, [id]));
  };
  // Undoing a remove or Clear all brings photos back into the story; keep the tray in step.
  useEffect(() => {
    const missing = story.photos.filter((p) => !lib.get(p.id));
    if (missing.length) lib.adopt(missing);
  }, [story.photos, lib.photos]); // eslint-disable-line react-hooks/exhaustive-deps
  const clearTray = () => {
    const ids = lib.photos.map((p) => p.id);
    lib.clear();
    st.mutate((s) => removePhotos(s, ids));
  };
  const onScale = useCallback((w: number) => { ed.pxPerPage.current = w; }, [ed.pxPerPage]);

  useStoryKeys({
    enabled: visible && panel === null, hasSelection: selection.length > 0, cropping: !!ed.cropId, pageCount: story.pages.length, pageIndex,
    remove: ed.remove, nudge: ed.nudge, duplicate: ed.duplicate, undo: history.undo, redo: history.redo, zOrder: ed.zOrder,
    deselect: () => ed.select([]), selectAll: () => ed.select(page?.elements.map((e) => e.id) ?? []),
    exitCrop: () => ed.setCropId(null), goTo: ed.goTo, save: project.save, open: project.open, cycleLayout: ed.cycleLayout,
  });

  /** Tray-selected photos that are on no page yet, in selection order: they fill extra slots when a layout wants more photos. */
  const extraPhotos = useMemo<Photo[]>(() => {
    const used = photoIdsInUse(story);
    const byId = new Map(lib.photos.map((p) => [p.id, p]));
    return tray.selected.flatMap((id) => (byId.has(id) && !used.has(id) ? [byId.get(id)!] : []));
  }, [story, lib.photos, tray.selected]);

  const selectedEls = useMemo<El[]>(() => (page ? page.elements.filter((e) => selection.includes(e.id)) : []), [page, selection]);

  return (
    <div ref={root} className={`story-view ${hasPages ? '' : 'empty'}`} data-testid="view-story">
      <aside className="sidebar story-tray">
        <div className="section">
          <PhotoTray
            photos={lib.photos} selected={tray.selected} onToggle={tray.toggle} onRemove={removeFromTray} onClearAll={clearTray}
            clearNote="Photos used in the story become empty slots."
            onImport={() => void lib.pick()} onDropFiles={(f) => void lib.addFiles(f)} onSelectAll={tray.all} onSelectNone={tray.none}
          />
          {hasPages && <p className="hint">Drag a photo onto a photo on the page to replace it, or onto empty space to add it.</p>}
        </div>
      </aside>
      {hasPages && page ? (
        <>
          <div className="story-main">
            <div className="story-toolbar">
              <Button variant="soft" onClick={shuffle} title="Lay the whole story out again with a new random arrangement" data-testid="story-shuffle">Shuffle</Button>
              <LayoutControl story={story} pageIndex={pageIndex} extraPhotos={extraPhotos} onApply={(o) => ed.pageLayout(o, extraPhotos)} onCycle={ed.cycleLayout} />
              <Button onClick={history.undo} disabled={!history.canUndo} title="Undo (⌘Z)" data-testid="story-undo">Undo</Button>
              <Button onClick={history.redo} disabled={!history.canRedo} title="Redo (⇧⌘Z)" data-testid="story-redo">Redo</Button>
              <span className="story-pagelabel" data-testid="page-label">Page {pageIndex + 1} of {story.pages.length}</span>
            </div>
            <StoryStage
              story={story} pageIndex={pageIndex} selection={selection} cropId={ed.cropId} editingId={ed.editingId}
              onSelect={ed.select} onJump={ed.jump} onCommit={ed.commitOverrides}
              onCrop={(id, crop) => ed.patch([id], { crop } as Partial<El>, `crop-${id}`)}
              onText={(id, text) => ed.patch([id], { text } as Partial<El>)}
              setCropId={ed.setCropId} setEditingId={ed.setEditingId} onDropPhoto={dropPhoto} onScale={onScale}
            />
            <PageStrip story={story} pageIndex={pageIndex} thumbs={thumbs} onSelect={ed.goTo} onMove={ed.pageMove} onAdd={ed.pageAdd} onDuplicate={ed.pageDuplicate} onDelete={ed.pageDelete} />
          </div>
          <aside className="sidebar story-insp" data-testid="story-inspector">
            <ElementInspector
              els={selectedEls} patch={(p, key) => ed.patchSelected(p, key)}
              onReplace={() => void replacePhoto()} onRemove={ed.remove} onDuplicate={ed.duplicate}
            />
            <StoryInspector
              story={story} subtitle={st.subtitle} page={page} pageIndex={pageIndex} extraPhotos={extraPhotos} onLayout={(o) => ed.pageLayout(o, extraPhotos)}
              onPage={(p, key) => st.mutate((s) => updatePage(s, pageIndex, p), key)}
              onTitle={st.setTitle} onSubtitle={st.setSubtitle} onRecreate={recreate}
              onAddText={ed.addText} onAddSlot={ed.addSlot} onAddRect={ed.addRect}
            />
          </aside>
        </>
      ) : (
        <StoryEmpty photoCount={lib.photos.length} busy={making} onMake={(o) => void make(o)} />
      )}
      <StoryTopbar
        visible={visible} hasPages={hasPages} busy={!!exporter.job}
        onOpen={() => void project.open()} onSave={() => void project.save()} onImages={() => setPanel('images')} onVideo={() => setPanel('video')}
      />
      {panel === 'images' && <ImagesDialog story={story} onExport={(w) => void exporter.images(w)} onClose={() => setPanel(null)} />}
      {panel === 'video' && (
        <VideoDialog
          story={story} onClose={() => setPanel(null)} onExport={(r) => void exporter.video(r)}
          onVideo={(patch) => st.mutate((s) => ({ ...s, video: { ...s.video, ...patch } }), 'video-settings')}
        />
      )}
      <ExportStatus job={exporter.job} done={exporter.done} onCancel={exporter.cancel} onClear={exporter.clearDone} />
    </div>
  );
}
