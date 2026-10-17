import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron') as string;
const ffmpeg = fs.existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : (require('ffmpeg-static') as string);
const root = path.resolve(import.meta.dirname, '..', '..');

/** Pixel size from the first JPEG start-of-frame marker. */
function jpegSize(file: string) {
  const b = fs.readFileSync(file);
  expect(b[0]).toBe(0xff);
  expect(b[1]).toBe(0xd8);
  let i = 2;
  while (i < b.length) {
    if (b[i] !== 0xff) { i++; continue; }
    const marker = b[i + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: b.readUInt16BE(i + 5), width: b.readUInt16BE(i + 7) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  throw new Error('no SOF marker');
}

let dir: string;
let photos: string[];
let app: ElectronApplication;
let page: Page;

test.beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'collage-e2e-'));
  const sizes = ['4000x3000', '3000x2000', '2000x3000', '1600x1600'];
  photos = sizes.map((size, i) => {
    const out = path.join(dir, `photo${i + 1}.jpg`);
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc=size=${size}`, '-vf', `hue=h=${i * 70}`, '-frames:v', '1', out]);
    return out;
  });
});
test.afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

test.beforeEach(async () => {
  app = await electron.launch({ executablePath: electronPath, args: [root, '--no-sandbox'], env: { ...process.env, COLLAGE_NO_SANDBOX: '1' } });
  page = await app.firstWindow();
  await page.waitForSelector('.topbar');
  await page.getByRole('tab', { name: 'Collage' }).click(); // the last-used tab is remembered between launches
});
test.afterEach(async () => { await app.close(); });

const addPhotos = async (files: string[]) => page.getByTestId('collage-file-input').setInputFiles(files);

test('imports four photos, exports the collage at the reference size', async () => {
  test.setTimeout(180_000);
  const exportButton = page.getByTestId('export-button');
  await expect(exportButton).toBeDisabled();
  await expect(page.getByTestId('output-chip')).toHaveText('Add photos to begin');

  await addPhotos(photos);
  await expect(page.getByTestId('fill-count')).toHaveText('4 of 4');
  await expect(page.getByTestId('slot-filled')).toHaveCount(4);
  await expect(page.getByTestId('output-chip')).toHaveText(/8,378\s*×\s*6,378 px/);
  await expect(exportButton).toBeEnabled();

  const target = path.join(dir, 'out.jpg');
  await app.evaluate(({ dialog }, p) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: p }) as never;
  }, target);
  await exportButton.click();
  await expect.poll(() => fs.existsSync(target), { timeout: 120_000 }).toBe(true);
  await expect(page.locator('.toast.success')).toContainText('Saved', { timeout: 30_000 });
  expect(jpegSize(target)).toEqual({ width: 8378, height: 6378 });
});

test('removing a photo disables export, grid resize keeps photos, Send to Story works', async () => {
  test.setTimeout(120_000);
  await addPhotos(photos);
  await expect(page.getByTestId('fill-count')).toHaveText('4 of 4');

  const first = page.getByTestId('slot-filled').first();
  await first.focus();
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('fill-count')).toHaveText('3 of 4');
  await expect(page.getByTestId('export-button')).toBeDisabled();
  await expect(page.getByTestId('slot-empty')).toHaveCount(1);

  // A drop of one more photo fills the empty box.
  await addPhotos([photos[0]]);
  await expect(page.getByTestId('fill-count')).toHaveText('4 of 4');

  await page.getByRole('button', { name: 'Increase Columns' }).click();
  await expect(page.getByTestId('fill-count')).toHaveText('4 of 6');

  await page.getByRole('button', { name: 'Decrease Columns' }).click();
  await expect(page.getByTestId('fill-count')).toHaveText('4 of 4');
  await page.getByRole('button', { name: 'Send to Story' }).click();
  await expect(page.locator('.toast.success')).toContainText('Story', { timeout: 90_000 });
});
