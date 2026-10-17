import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { cellSizeFor, defaultBorder, outputSize, type Size } from '../core/geometry';
import { isImageFile } from '../core/images';
import { usePhotoLibrary } from '../core/library';
import { recentToFile, removeRecent, saveRecent, touchRecent, type RecentItem } from '../core/recents';
import { useToast } from '../ui/Toast';
import { CollageGrid } from './CollageGrid';
import { Sidebar } from './Sidebar';
import { TopbarActions } from './TopbarActions';
import { overflowMessage } from './placements';
import { collageFileName, renderCollage, type Rendered } from './renderCollage';
import { useCollage } from './useCollage';
import { useRecents } from './useRecents';
import { useVisible } from './useVisible';

const hasFiles = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');

export function CollageView() {
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const pickTarget = useRef<number | null>(null);
  const visible = useVisible(root);
  const toast = useToast();
  const lib = usePhotoLibrary();
  const collage = useCollage();
  const { rows, columns, shape, slots } = collage.state;
  const recents = useRecents();
  const [dropping, setDropping] = useState(false);
  const [busy, setBusy] = useState<null | 'export' | 'story'>(null);
  const [progress, setProgress] = useState('');

  const getPhoto = lib.get;
  // Slot zero drives the tile size. `lib.photos` is a dependency so sizes refresh once photos land.
  const firstPhoto = slots[0] ? getPhoto(slots[0].photoId) : undefined;
  const firstSize: Size | null = firstPhoto ? { width: firstPhoto.width, height: firstPhoto.height } : null;
  const cell = useMemo(() => (firstSize ? cellSizeFor(firstSize, shape) : null), [firstSize?.width, firstSize?.height, shape]); // eslint-disable-line react-hooks/exhaustive-deps
  const border = collage.state.border ?? (cell ? defaultBorder(cell.width, columns) : 0);
  const output = cell ? outputSize(cell, rows, columns, border) : null;
  const tileAspect = cell ? cell.width / cell.height : shape ? shape[0] / shape[1] : 4 / 3;
  const capacity = rows * columns;
  const filled = slots.filter((s) => s && getPhoto(s.photoId)).length;
  const canExport = !!cell && filled === capacity;

  /* ---- adding photos ---- */
  const addToEmpty = useCallback(async (files: File[]) => {
    const images = files.filter(isImageFile);
    if (!images.length) return;
    const photos = await lib.addFiles(images);
    if (!photos.length) return;
    const { placed, overflow } = collage.fill(photos.map((p) => p.id));
    if (overflow) toast(overflowMessage(placed, overflow), 'error');
  }, [lib, collage, toast]);

  const replaceAt = useCallback(async (index: number, files: File[]) => {
    const image = files.find(isImageFile);
    if (!image) return;
    const [photo] = await lib.addFiles([image]);
    if (photo) collage.put(index, photo.id);
  }, [lib, collage]);

  const addRef = useRef(addToEmpty);
  addRef.current = addToEmpty;

  // Global drop and paste add into empty boxes, but only while this tab is showing.
  useEffect(() => {
    if (!visible) return;
    let depth = 0;
    const enter = (e: DragEvent) => { if (hasFiles(e)) { depth++; setDropping(true); } };
    const leave = (e: DragEvent) => { if (hasFiles(e) && --depth <= 0) { depth = 0; setDropping(false); } };
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      depth = 0;
      setDropping(false);
      void addRef.current([...(e.dataTransfer?.files ?? [])]);
    };
    const paste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter(isImageFile);
      if (files.length) { e.preventDefault(); void addRef.current(files); }
    };
    window.addEventListener('dragenter', enter);
    window.addEventListener('dragleave', leave);
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    document.addEventListener('paste', paste);
    return () => {
      window.removeEventListener('dragenter', enter);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
      document.removeEventListener('paste', paste);
      setDropping(false);
    };
  }, [visible]);

  const onInputChange = () => {
    const files = [...(input.current?.files ?? [])];
    const target = pickTarget.current;
    pickTarget.current = null;
    if (input.current) input.current.value = '';
    if (target !== null) void replaceAt(target, files);
    else void addToEmpty(files);
  };
  const pickFor = (target: number | null) => { pickTarget.current = target; input.current?.click(); };

  /* ---- recents ---- */
  const saved = useRef(new Set<string>());
  useEffect(() => {
    for (const s of slots) {
      if (!s || saved.current.has(s.photoId)) continue;
      const photo = getPhoto(s.photoId);
      if (!photo) continue;
      saved.current.add(s.photoId);
      void (async () => {
        const blob = photo.file ?? new Blob([(await api.readFile(photo.path!)) as BlobPart], { type: 'image/jpeg' });
        await saveRecent(photo, blob);
        await recents.reload();
      })().catch((error: unknown) => {
        saved.current.delete(s.photoId);
        if (error instanceof DOMException && error.name === 'QuotaExceededError') toast('Recents are full for this storage. Remove a few to make room.', 'error');
      });
    }
  }, [slots, getPhoto, recents, toast]);

  const usedIds = useMemo(() => new Set(slots.flatMap((s) => (s ? [s.photoId] : []))), [slots]);

  const toggleRecent = async (item: RecentItem) => {
    const at = collage.live.current.slots.findIndex((s) => s?.photoId === item.id);
    if (at >= 0) { collage.remove(at); return; }
    if (!collage.live.current.slots.includes(null)) { toast(overflowMessage(0, 1), 'error'); return; }
    await addToEmpty([recentToFile(item)]);
    touchRecent(item).catch(() => {});
  };
  const forgetRecent = async (item: RecentItem) => {
    try { await removeRecent(item.id); } catch { toast(`Couldn’t remove ${item.name} from recents.`, 'error'); }
    await recents.reload();
  };

  /* ---- export ---- */
  const render = async (): Promise<Rendered> => {
    const live = collage.live.current;
    return renderCollage({ slots: live.slots, getPhoto, rows: live.rows, columns: live.columns, cell: cell!, border }, (done, total) => setProgress(`${done} / ${total}`));
  };
  const run = async (kind: 'export' | 'story', job: () => Promise<void>) => {
    setBusy(kind);
    setProgress('');
    try { await job(); } catch (error) { toast(error instanceof Error ? error.message : 'Something went wrong while exporting.', 'error'); }
    finally { setBusy(null); setProgress(''); }
  };
  const doExport = () => run('export', async () => {
    const r = await render();
    const saved = await api.saveFile({ defaultName: collageFileName(), filters: [{ name: 'JPEG image', extensions: ['jpg', 'jpeg'] }], data: r.data });
    if (!saved) return;
    const name = saved.split(/[\\/]/).pop();
    toast(r.scaled ? `Saved at ${r.width} × ${r.height}, reduced to fit this computer’s limit.` : `Saved ${name}`, 'success');
  });
  const doSendToStory = () => run('story', async () => {
    const r = await render();
    const file = new File([r.data as BlobPart], collageFileName(), { type: 'image/jpeg' });
    const added = await lib.addFiles([file]);
    if (added.length) toast(r.scaled ? `Added to Story photos, reduced to ${r.width} × ${r.height}.` : 'Added the collage to your Story photos.', 'success');
  });

  return (
    <div ref={root} className="workspace" data-testid="view-collage">
      <input ref={input} type="file" accept="image/*" multiple hidden data-testid="collage-file-input" onChange={onInputChange} />
      <Sidebar
        rows={rows} columns={columns} shape={shape} border={border} cell={cell} firstSize={firstSize}
        filled={filled} capacity={capacity}
        onRows={collage.setRows} onColumns={collage.setColumns} onShape={collage.setShape} onBorder={collage.setBorder}
        onAdd={() => pickFor(null)}
        recents={recents.items} usedIds={usedIds} onToggleRecent={toggleRecent} onForgetRecent={forgetRecent}
      />
      <CollageGrid
        slots={slots} rows={rows} columns={columns} tileAspect={tileAspect} border={border} output={output} dropping={dropping}
        getPhoto={getPhoto}
        onCrop={collage.setCrop} onRemove={collage.remove} onSwap={collage.swapSlots}
        onPickEmpty={pickFor} onDropFiles={replaceAt}
      />
      <TopbarActions
        visible={visible}
        outputLabel={output ? `${output.width.toLocaleString()} × ${output.height.toLocaleString()} px` : 'Add photos to begin'}
        canExport={canExport}
        disabledReason={`Fill all ${capacity} boxes to export`}
        busy={busy}
        progress={progress}
        onExport={doExport}
        onSendToStory={doSendToStory}
      />
    </div>
  );
}
