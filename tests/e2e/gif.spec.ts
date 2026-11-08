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

let dir: string;
let userData: string;
let photos: string[];
let app: ElectronApplication;
let page: Page;

test.beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gif-e2e-'));
  photos = ['1200x800', '800x1200', '1000x1000'].map((size, i) => {
    const out = path.join(dir, `frame${i + 1}.jpg`);
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}`, '-vf', `hue=h=${i * 90}`, '-frames:v', '1', out]);
    return out;
  });
});
test.afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

test.beforeEach(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'gif-userdata-'));
  app = await electron.launch({ executablePath: electronPath, args: [root, '--no-sandbox'], env: { ...process.env, COLLAGE_NO_SANDBOX: '1', COLLAGE_USER_DATA: userData } });
  page = await app.firstWindow();
  await page.waitForSelector('.topbar');
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.getByRole('tab', { name: 'GIF' }).click();
});
test.afterEach(async () => {
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
});

const gifView = () => page.getByTestId('view-gif');

test('three photos become a GIF with the chosen speed and shape', async () => {
  test.setTimeout(120_000);
  const output = path.join(dir, 'out', 'result.gif');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  await app.evaluate(({ dialog }, a) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: a.photos })) as never;
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: a.output })) as never;
  }, { photos, output });

  await expect(page.getByTestId('gif-export')).toBeDisabled();
  await gifView().getByRole('button', { name: 'Add photos' }).click();
  await expect(gifView().locator('.tray-item')).toHaveCount(3, { timeout: 30_000 });
  await expect(page.getByTestId('gif-canvas')).toBeVisible();
  // Defaults: 0.5 s per photo, 3 photos, looping forever.
  await expect(page.getByTestId('gif-estimate')).toHaveText('3 frames · 1.5 s');

  // Slower, square.
  await page.getByRole('slider', { name: 'Seconds per photo' }).fill('1');
  await expect(page.getByTestId('gif-estimate')).toHaveText('3 frames · 3.0 s');
  await page.getByRole('group', { name: 'Shape' }).getByRole('button', { name: '1:1' }).click();
  await page.getByRole('group', { name: 'Width' }).getByRole('button', { name: '480' }).click();
  await expect.poll(() => page.getByTestId('gif-canvas').evaluate((c) => [(c as HTMLCanvasElement).width, (c as HTMLCanvasElement).height])).toEqual([480, 480]);

  await page.getByTestId('gif-export').click();
  const toast = page.locator('.toast.show');
  await expect(toast).toContainText('Saved GIF', { timeout: 60_000 });
  await expect(toast.getByRole('button', { name: 'Show in folder' })).toBeVisible();

  const bytes = fs.readFileSync(output);
  expect(bytes.subarray(0, 6).toString('latin1')).toBe('GIF89a');
  expect([bytes.readUInt16LE(6), bytes.readUInt16LE(8)]).toEqual([480, 480]);
  const frames = execFileSync(ffmpeg, ['-v', 'error', '-i', output, '-f', 'null', '-', '-progress', 'pipe:1'], { encoding: 'utf8' });
  expect(frames).toMatch(/frame=3\b/);
  expect(fs.readdirSync(path.dirname(output))).toEqual(['result.gif']);
});

test('photos are numbered in selection order and fewer than two cannot be exported', async () => {
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: files })) as never;
  }, photos);
  await gifView().getByRole('button', { name: 'Add photos' }).click();
  await expect(gifView().locator('.tray-item')).toHaveCount(3, { timeout: 30_000 });
  await gifView().getByRole('button', { name: 'None', exact: true }).click();
  await expect(page.getByTestId('gif-estimate')).toHaveText('Select at least 2 photos.');
  await expect(page.getByTestId('gif-export')).toBeDisabled();
  const picks = gifView().locator('.tray-pick');
  await picks.nth(2).click();
  await picks.nth(0).click();
  await expect(picks.nth(2).locator('.tray-check')).toHaveText('1');
  await expect(picks.nth(0).locator('.tray-check')).toHaveText('2');
  await expect(page.getByTestId('gif-export')).toBeEnabled();
});
