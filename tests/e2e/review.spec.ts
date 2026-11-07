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
/** The Story view root. Collage "Layout mode" keeps a second StoryStage mounted (hidden), so Story locators must not be page-wide. */
const story = () => page.getByTestId('view-story');

test.beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-e2e-'));
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


const overlay = () => page.getByTestId('photo-preview');
const position = () => page.getByTestId('preview-position');
const counts = () => page.getByTestId('review-counts');
/** No window manager under xvfb, so a real requestFullscreen never resolves there. Stand in for the Fullscreen API, with the same fullscreenchange events. */
const fakeFullscreen = () => page.evaluate(() => {
  let el: Element | null = null;
  const set = (v: Element | null) => { el = v; document.dispatchEvent(new Event('fullscreenchange')); };
  Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => el });
  document.documentElement.requestFullscreen = async () => set(document.documentElement);
  document.exitFullscreen = async () => set(null);
});
const addPhotos = async () => {
  await page.getByRole('button', { name: 'Add photos' }).click();
  await expect(story().locator('.tray-item')).toHaveCount(3, { timeout: 60_000 });
  await expect(story().getByText('3 of 3 selected')).toBeVisible();
};

test('Review opens at photo 1; K keeps, X rejects, Esc finishes', async () => {
  const view = story();
  await addPhotos();
  await view.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(overlay()).toBeVisible();
  await expect(overlay()).toHaveAttribute('data-review', 'true');
  await expect(position()).toHaveText('1 / 3');
  await expect(counts()).toHaveText('3 kept · 0 rejected');
  await expect(overlay().getByRole('button', { name: 'Keep', exact: true })).toHaveAttribute('aria-pressed', 'true');

  // K on an included photo only advances
  await page.keyboard.press('k');
  await expect(position()).toHaveText('2 / 3');
  await expect(counts()).toHaveText('3 kept · 0 rejected');

  // X rejects (stays in the library) and advances
  await page.keyboard.press('x');
  await expect(position()).toHaveText('3 / 3');
  await expect(counts()).toHaveText('2 kept · 1 rejected');
  await expect(view.locator('.tray-item')).toHaveCount(3);
  await expect(view.getByText('2 of 3 selected')).toBeVisible();

  // Last photo: stays, shows the end note; ArrowDown rejects it
  await page.keyboard.press('ArrowDown');
  await expect(position()).toHaveText('3 / 3');
  await expect(counts()).toHaveText('1 kept · 2 rejected');
  await expect(overlay().getByRole('button', { name: 'Reject', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(overlay().getByText('End of photos — Esc to finish')).toBeVisible();

  // Go back, ArrowUp keeps photo 2 again and advances
  await page.keyboard.press('ArrowLeft');
  await page.keyboard.press('ArrowUp');
  await expect(position()).toHaveText('3 / 3');
  await expect(counts()).toHaveText('2 kept · 1 rejected');

  await page.keyboard.press('Escape');
  await expect(overlay()).toBeHidden();
  await expect(view.locator('.tray-item')).toHaveCount(3);
  await expect(view.getByText('2 of 3 selected')).toBeVisible();
  const state = await view.locator('.tray-pick').evaluateAll((els) => els.map((e) => e.getAttribute('aria-pressed')));
  expect(state).toEqual(['true', 'true', 'false']);
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
});

test('F toggles full screen in a normal preview', async () => {
  const view = story();
  await addPhotos();
  await fakeFullscreen();
  await view.locator('.tray-item').nth(0).locator('.tray-zoom').click();
  await expect(overlay()).toHaveAttribute('data-review', 'false');
  await expect(overlay()).toHaveAttribute('data-fullscreen', 'false');
  await page.keyboard.press('f');
  await expect(overlay()).toHaveAttribute('data-fullscreen', 'true', { timeout: 10_000 });
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.keyboard.press('f');
  await expect(overlay()).toHaveAttribute('data-fullscreen', 'false', { timeout: 10_000 });
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(false);
  await expect(overlay()).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(overlay()).toBeHidden();
});

test('leaving full screen closes a review', async () => {
  await addPhotos();
  await fakeFullscreen();
  await story().getByRole('button', { name: 'Review', exact: true }).click();
  await expect(overlay()).toHaveAttribute('data-fullscreen', 'true', { timeout: 10_000 });
  expect(await page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  await page.evaluate(() => document.exitFullscreen());
  await expect(overlay()).toBeHidden();
});

test('Story: rejecting in Review takes the photo off its page', async () => {
  test.setTimeout(120_000);
  const view = story();
  await addPhotos();
  await view.getByTestId('make-story').click();
  await expect(view.getByTestId('page-strip')).toBeVisible({ timeout: 60_000 });
  const stageImgs = () => view.locator('.story-stage img').count();
  await expect.poll(stageImgs).toBeGreaterThan(0);
  const before = await view.locator('.story-stage img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src));

  await view.getByRole('button', { name: 'Review', exact: true }).click();
  await expect(position()).toHaveText('1 / 3');
  const shown = await page.evaluate(() => document.querySelectorAll('[data-testid="view-story"] .story-stage img').length);
  expect(shown).toBeGreaterThan(0);
  await page.keyboard.press('x');
  await expect(counts()).toHaveText('2 kept · 1 rejected');
  await page.keyboard.press('Escape');
  await expect(overlay()).toBeHidden();
  await expect(view.getByText('2 of 3 selected')).toBeVisible();
  await expect(view.locator('.tray-item')).toHaveCount(3);
  // The story now shows fewer photos across its pages.
  const pageText = await view.getByTestId('page-label').innerText();
  expect(pageText).toMatch(/Page \d+ of \d+/);
  await expect.poll(async () => (await view.locator('.story-stage img').evaluateAll((els) => els.map((e) => (e as HTMLImageElement).src))).join('|')).not.toBe(before.join('|'));
});
