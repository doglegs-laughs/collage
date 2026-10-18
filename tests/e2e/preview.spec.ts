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
const shots = path.join(root, 'test-results');

let dir: string;
let photos: string[];
let app: ElectronApplication;
let page: Page;

/** Edit > Undo / Redo through the real application menu (synthesized keys never reach the menu, and in the app the menu owns the accelerators). */
const menu = async (id: 'undo' | 'redo') => {
  await app.evaluate(({ Menu }, i) => { Menu.getApplicationMenu()!.getMenuItemById(i)!.click(); }, id);
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
};
const undo = () => menu('undo');

test.beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-e2e-'));
  photos = ['3000x2000', '2000x3000', '2400x1600'].map((size, i) => {
    const out = path.join(dir, `photo${i + 1}.jpg`);
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}`, '-vf', `hue=h=${i * 60}`, '-frames:v', '1', out]);
    return out;
  });
  fs.mkdirSync(shots, { recursive: true });
});
test.afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

test.beforeEach(async () => {
  app = await electron.launch({ executablePath: electronPath, args: [root, '--no-sandbox'], env: { ...process.env, COLLAGE_NO_SANDBOX: '1' } });
  page = await app.firstWindow();
  await page.waitForSelector('.topbar');
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.getByRole('tab', { name: 'Story' }).click();
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: files })) as never;
  }, photos);
});
test.afterEach(async () => {
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = (() => 1) as never; });
  await app.close();
});

test('preview a photo, step through, toggle include, close; clear all', async () => {
  const view = page.getByTestId('view-story');
  await page.getByRole('button', { name: 'Add photos' }).click();
  const items = view.locator('.tray-item');
  await expect(items).toHaveCount(3, { timeout: 60_000 });
  await expect(view.getByText('3 of 3 selected')).toBeVisible();

  await items.nth(1).locator('.tray-pick').dblclick();
  const overlay = page.getByTestId('photo-preview');
  await expect(overlay).toBeVisible();
  await expect(page.getByTestId('preview-position')).toHaveText('2 / 3');
  // dblclick toggles the photo twice, so it is still included
  await expect(overlay.getByRole('checkbox')).toHaveText(/Included/);
  await page.waitForFunction(() => {
    const img = document.querySelector('.lightbox-img.ready') as HTMLImageElement | null;
    return !!img && img.naturalWidth > 0;
  });

  await page.keyboard.press('ArrowRight');
  await expect(page.getByTestId('preview-position')).toHaveText('3 / 3');
  await page.waitForFunction(() => !!document.querySelector('.lightbox-img.ready'));
  await page.waitForTimeout(300);
  // Exactly one image is visible in the overlay and no hover preview is showing.
  const visibleImgs = await overlay.locator('img').evaluateAll((els) => els.filter((e) => getComputedStyle(e).opacity !== '0' && e.getBoundingClientRect().width > 0).map((e) => e.className));
  expect(visibleImgs).toEqual(['lightbox-img ready']);
  await expect(page.locator('.hover-preview')).toHaveCount(0);
  await page.screenshot({ path: path.join(shots, 'photo-preview.png') });

  await overlay.getByRole('checkbox').click();
  await expect(overlay.getByRole('checkbox')).toHaveText(/Not included/);
  await expect(view.getByText('2 of 3 selected')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(overlay).toBeHidden();
  await expect(items.nth(2).locator('.tray-pick')).toBeFocused();

  // Keyboard: arrows move focus, Space opens.
  await page.keyboard.press('ArrowLeft');
  await expect(items.nth(1).locator('.tray-pick')).toBeFocused();
  await page.keyboard.press('Space');
  await expect(page.getByTestId('preview-position')).toHaveText('2 / 3');
  await page.keyboard.press('Space');
  await expect(overlay).toBeHidden();

  // Clear all, with confirmation.
  await view.getByRole('button', { name: 'Clear all' }).click();
  await expect(view.getByText(/Remove all 3 photos from this pane\?/)).toBeVisible();
  await view.getByRole('button', { name: 'Cancel' }).click();
  await expect(items).toHaveCount(3);
  await view.getByRole('button', { name: 'Clear all' }).click();
  await view.getByRole('button', { name: 'Remove all' }).click();
  await expect(items).toHaveCount(0);
  await expect(view.getByText('0 of 0 selected')).toBeVisible();
});

test('Clear all in Story can be undone and the images render again', async () => {
  test.setTimeout(120_000);
  const view = page.getByTestId('view-story');
  await page.getByRole('button', { name: 'Add photos' }).click();
  const items = view.locator('.tray-item');
  await expect(items).toHaveCount(3, { timeout: 60_000 });
  await page.getByTestId('make-story').click();
  await expect(page.getByTestId('page-strip')).toBeVisible({ timeout: 60_000 });
  const stageImages = () =>
    page.waitForFunction(() => {
      const imgs = [...document.querySelectorAll('[data-testid="view-story"] .story-stage img')] as HTMLImageElement[];
      return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
    }, undefined, { timeout: 30_000 });
  await stageImages();

  await view.getByRole('button', { name: 'Clear all' }).click();
  await view.getByRole('button', { name: 'Remove all' }).click();
  await expect(items).toHaveCount(0);

  await page.locator('body').click({ position: { x: 700, y: 20 } });
  await undo();
  await expect(items).toHaveCount(3);
  await expect(view.getByText(/of 3 selected/)).toBeVisible();
  await expect.poll(() => view.locator('.story-stage img').count()).toBeGreaterThan(0);
  await stageImages();
});
