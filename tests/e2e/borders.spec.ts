import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { finishLayout } from '../../src/borders/borderMath';

const require = createRequire(import.meta.url);
const electronPath = require('electron') as string;
const ffmpeg = fs.existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : (require('ffmpeg-static') as string);
const root = path.resolve(import.meta.dirname, '..', '..');
const shots = path.join(root, 'test-results');

const SIZES = [
  { name: 'mat1.jpg', w: 1200, h: 800 },
  { name: 'mat2.jpg', w: 800, h: 1200 },
];

let dir: string;
let userData: string;
let photos: string[];
let app: ElectronApplication;
let page: Page;

test.beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'borders-e2e-'));
  photos = SIZES.map((s, i) => {
    const out = path.join(dir, s.name);
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${s.w}x${s.h}`, '-vf', `hue=h=${i * 60}`, '-frames:v', '1', out]);
    return out;
  });
  fs.mkdirSync(shots, { recursive: true });
});
test.afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

test.beforeEach(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'borders-userdata-'));
  app = await electron.launch({ executablePath: electronPath, args: [root, '--no-sandbox'], env: { ...process.env, COLLAGE_NO_SANDBOX: '1', COLLAGE_USER_DATA: userData } });
  page = await app.firstWindow();
  await page.waitForSelector('.topbar');
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.getByRole('tab', { name: 'Borders' }).click();
});
test.afterEach(async () => {
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
});

const stubDialogs = (args: { photos: string[]; folder: string }) =>
  app.evaluate(({ dialog }, a) => {
    dialog.showOpenDialog = (async (...params: unknown[]) => {
      const opts = params[params.length - 1] as { properties?: string[] };
      return { canceled: false, filePaths: opts.properties?.includes('openDirectory') ? [a.folder] : a.photos };
    }) as never;
  }, args);

/** Width and height from a JPEG's start-of-frame marker. */
function jpegSize(file: string): { w: number; h: number } {
  const b = fs.readFileSync(file);
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) throw new Error('bad jpeg');
    const marker = b[i + 1];
    const len = b.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { h: b.readUInt16BE(i + 5), w: b.readUInt16BE(i + 7) };
    i += 2 + len;
  }
  throw new Error('no SOF');
}

/** RGB of one pixel, decoded by ffmpeg. */
function pixel(file: string, x: number, y: number): [number, number, number] {
  const out = execFileSync(ffmpeg, ['-loglevel', 'error', '-i', file, '-vf', `crop=2:2:${x}:${y}`, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
  return [out[0], out[1], out[2]];
}

const settle = () => page.evaluate(() => new Promise((r) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(r)), 350)));
const previewData = () => page.locator('.borders-canvas').evaluate((c) => (c as HTMLCanvasElement).toDataURL('image/png'));

test('print mat + 4:5 exports two JPEGs with a visible paper edge; previews of every finish', async () => {
  test.setTimeout(120_000);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'borders-out-'));
  try {
    await stubDialogs({ photos, folder });
    await page.getByRole('button', { name: 'Add photos' }).click();
    await expect(page.getByTestId('view-borders').locator('.tray-item')).toHaveCount(2, { timeout: 30_000 });
    await expect(page.locator('.borders-canvas')).toBeVisible();

    // One preview per finish (composited into a single screenshot).
    await page.getByRole('group', { name: 'Canvas shape' }).getByRole('button', { name: '4:5' }).click();
    const previews: string[] = [];
    for (const label of ['White border', 'Black border', 'Print mat', 'Framed', 'Polaroid']) {
      const btn = page.getByRole('group', { name: 'Finish' }).getByRole('button', { name: label });
      await btn.click();
      await expect(btn).toHaveAttribute('aria-pressed', 'true');
      if (label === 'Polaroid') await page.getByRole('textbox', { name: 'Caption' }).fill('Faroe Islands');
      await settle();
      previews.push(await previewData());
    }
    const sheet = await page.evaluate(async (urls) => {
      const imgs = await Promise.all(urls.map((u) => new Promise<HTMLImageElement>((res) => { const im = new Image(); im.onload = () => res(im); im.src = u; })));
      const h = 400;
      const widths = imgs.map((im) => Math.round((im.width / im.height) * h));
      const gap = 16;
      const c = document.createElement('canvas');
      c.width = widths.reduce((a, b) => a + b, 0) + gap * (imgs.length + 1);
      c.height = h + 2 * gap;
      const ctx = c.getContext('2d')!;
      ctx.fillStyle = '#8a8a8a';
      ctx.fillRect(0, 0, c.width, c.height);
      let x = gap;
      imgs.forEach((im, i) => { ctx.drawImage(im, x, gap, widths[i], h); x += widths[i] + gap; });
      return c.toDataURL('image/png');
    }, previews);
    fs.writeFileSync(path.join(shots, 'borders-finishes.png'), Buffer.from(sheet.split(',')[1], 'base64'));

    // Print mat on 4:5, export both photos.
    await page.getByRole('group', { name: 'Finish' }).getByRole('button', { name: 'Print mat' }).click();
    await page.getByRole('button', { name: 'Export all' }).click();
    await expect(page.locator('.borders-done')).toContainText('Exported 2 photos', { timeout: 60_000 });

    const files = fs.readdirSync(folder).filter((f) => f.endsWith('.jpg')).sort();
    expect(files).toEqual(['mat1-border.jpg', 'mat2-border.jpg']);
    for (const [i, f] of files.entries()) {
      const file = path.join(folder, f);
      const { w, h } = jpegSize(file);
      expect(Math.abs(w / h - 0.8)).toBeLessThan(0.002);

      // Just below the paper's bottom edge is the soft shadow on the white page: grey, not pure white; the far corner stays white.
      const l = finishLayout({ width: SIZES[i].w, height: SIZES[i].h }, { finish: 'mat', shape: '4:5', longEdge: 'original', borderPct: 5, framePct: 0.6, matPct: 4 });
      expect([l.canvasW, l.canvasH]).toEqual([w, h]);
      const [r, g, b] = pixel(file, Math.round(w / 2), l.outer.y + l.outer.h + 3);
      expect(r).toBeLessThan(250);
      expect(r).toBeGreaterThan(60);
      expect(Math.abs(r - g)).toBeLessThan(6);
      expect(Math.abs(g - b)).toBeLessThan(6);
      const corner = pixel(file, 2, 2);
      expect(Math.min(...corner)).toBeGreaterThanOrEqual(250);
      // Inside the paper but outside the photo is the paper white.
      const paper = pixel(file, Math.round(w / 2), l.outer.y + 6);
      expect(Math.min(...paper)).toBeGreaterThanOrEqual(245);
    }
  } finally {
    fs.rmSync(folder, { recursive: true, force: true });
  }
});
