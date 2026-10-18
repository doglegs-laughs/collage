import { api } from '../api';
import { makeCanvas, toJpeg } from '../core/canvas';
import { getFullBitmap, type Photo } from '../core/images';
import { borderStem, finishLayout, uniqueName, type FinishOptions } from './borderMath';
import { drawBorder, prepareFonts } from './render';

export type ExportResult = {
  folder: string;
  total: number;
  written: string[];
  failed: { name: string; error: string }[];
  cancelled: boolean;
};

export type ExportRequest = {
  options: FinishOptions;
  fill: string;
  caption?: string;
  folder: string;
  cancelled: () => boolean;
  onProgress: (done: number, total: number) => void;
};

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** Sequentially renders each photo at full resolution, one bitmap and canvas at a time, and writes a JPEG per photo. */
export async function exportBorders(photos: Photo[], req: ExportRequest): Promise<ExportResult> {
  const sep = api.platform === 'win32' ? '\\' : '/';
  const base = req.folder.replace(/[\\/]$/, '');
  const join = (name: string) => `${base}${sep}${name}`;
  const used = new Set<string>();
  const written: string[] = [];
  const failed: { name: string; error: string }[] = [];
  let cancelled = false;
  await prepareFonts();

  const exportOne = async (photo: Photo): Promise<string> => {
    const bitmap = await getFullBitmap(photo);
    try {
      const layout = finishLayout({ width: bitmap.width, height: bitmap.height }, req.options);
      const canvas = makeCanvas(layout.canvasW, layout.canvasH);
      if (!canvas) throw new Error('This size is too large for this computer. Try 2160 or 1080.');
      drawBorder(canvas.getContext('2d')!, bitmap, layout, { finish: req.options.finish, fill: req.fill, caption: req.caption });
      const bytes = await toJpeg(canvas, 0.95);
      canvas.width = canvas.height = 0;
      const name = await uniqueName(borderStem(photo.name), async (n) => used.has(n) || (await api.exists(join(n))));
      used.add(name);
      const path = join(name);
      await api.writeFile(path, bytes, { overwrite: false });
      return path;
    } finally {
      bitmap.close();
    }
  };

  for (let i = 0; i < photos.length; i++) {
    if (req.cancelled()) {
      cancelled = true;
      break;
    }
    const photo = photos[i];
    try {
      written.push(await exportOne(photo));
    } catch (error) {
      failed.push({ name: photo.name, error: messageOf(error) });
    }
    req.onProgress(i + 1, photos.length);
  }
  return { folder: req.folder, total: photos.length, written, failed, cancelled };
}

export { messageOf };
