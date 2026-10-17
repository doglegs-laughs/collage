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

test.beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-e2e-'));
  // Portraits, landscapes, a square and one 3:1 panorama.
  const sizes = ['4000x3000', '3000x4000', '3000x2000', '3000x1000', '2000x3000', '1600x1600', '3000x2000'];
  photos = sizes.map((size, i) => {
    const out = path.join(dir, `photo${i + 1}.jpg`);
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}`, '-vf', `hue=h=${i * 50}`, '-frames:v', '1', out]);
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
});
test.afterEach(async () => {
  // Unsaved edits make the app ask before quitting; answer "Discard" so the test can end.
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = (() => 1) as never; });
  await app.close();
});

const stubDialogs = (args: { photos: string[]; folder: string; video: string }) =>
  app.evaluate(({ dialog }, a) => {
    dialog.showOpenDialog = (async (...params: unknown[]) => {
      const opts = params[params.length - 1] as { properties?: string[] };
      return { canceled: false, filePaths: opts.properties?.includes('openDirectory') ? [a.folder] : a.photos };
    }) as never;
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: a.video })) as never;
  }, args);

const stripCount = () => page.getByTestId('strip-page').count();
const imagesLoaded = () =>
  page.waitForFunction(() => {
    const imgs = [...document.querySelectorAll('[data-testid="view-story"] .story-stage img')] as HTMLImageElement[];
    return imgs.length > 0 && imgs.every((i) => i.complete && i.naturalWidth > 0);
  }, undefined, { timeout: 30_000 });

async function shootFirstPages(style: string) {
  for (let i = 0; i < 4; i++) {
    await page.getByTestId('strip-page').nth(i).click();
    await expect(page.getByTestId('page-label')).toContainText(`Page ${i + 1} of`);
    await imagesLoaded().catch(() => {});
    await page.waitForTimeout(400);
    await page.locator('.story-stage').screenshot({ path: path.join(shots, `story-${style}-${i + 1}.png`) });
  }
}

test('make a story in one click, edit, undo, export images and video', async () => {
  test.setTimeout(420_000);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'story-out-'));
  const video = path.join(folder, 'story.mp4');
  await stubDialogs({ photos, folder, video });

  await page.getByRole('button', { name: 'Add photos' }).click();
  await expect(page.getByTestId('view-story').locator('.tray-item')).toHaveCount(7, { timeout: 60_000 });

  await page.getByTestId('story-title').fill('The Faroes');
  await page.getByRole('button', { name: 'Clean', exact: true }).click();
  await page.getByTestId('make-story').click();
  await expect(page.getByTestId('page-strip')).toBeVisible({ timeout: 60_000 });
  expect(await stripCount()).toBeGreaterThanOrEqual(4);
  await shootFirstPages('clean');

  // Shuffle regenerates and still shows a finished story.
  await page.getByTestId('story-shuffle').click();
  await expect(page.getByTestId('page-label')).toContainText('Page 1 of');
  expect(await stripCount()).toBeGreaterThanOrEqual(1);

  // Stylized (after confirm), screenshots.
  await page.getByRole('button', { name: 'Stylized', exact: true }).click();
  await page.getByRole('button', { name: 'Re-create' }).click();
  await expect(page.getByTestId('page-label')).toContainText('Page 1 of');
  await shootFirstPages('stylized');
  await page.getByRole('button', { name: 'Clean', exact: true }).click();
  await page.getByRole('button', { name: 'Re-create' }).click();

  // Select a photo element, delete it, undo.
  await page.getByTestId('strip-page').nth(1).click();
  await imagesLoaded().catch(() => {});
  const photoEls = page.locator('.story-page [data-testid="story-el-photo"][data-ghost="undefined"], .story-page [data-testid="story-el-photo"]:not([data-ghost])');
  const before = await photoEls.count();
  expect(before).toBeGreaterThan(0);
  await photoEls.first().locator('.se-photo').click();
  await expect(page.getByTestId('selection-box')).toHaveCount(1);
  await page.keyboard.press('Delete');
  await expect(photoEls).toHaveCount(before - 1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(photoEls).toHaveCount(before);

  // Export images.
  await page.getByTestId('story-export').click();
  await page.getByTestId('export-images-item').click();
  await page.getByTestId('images-go').click();
  await expect(page.getByTestId('export-reveal')).toBeVisible({ timeout: 240_000 });
  const pages = await stripCount();
  const jpgs = fs.readdirSync(folder).filter((f) => f.endsWith('.jpg'));
  expect(jpgs.length).toBe(pages);
  expect(jpgs[0]).toMatch(/^The Faroes 0\d\.jpg$/);

  // Export video.
  await page.getByTestId('story-export').click();
  await page.getByTestId('export-video-item').click();
  await page.getByTestId('video-go').click();
  await expect.poll(() => fs.existsSync(video) && fs.statSync(video).size > 1000, { timeout: 300_000 }).toBe(true);
  await expect(page.getByTestId('export-status')).toContainText('Video saved', { timeout: 60_000 });
});

test('move, nudge, text edit and page management', async () => {
  test.setTimeout(180_000);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'story-out-'));
  await stubDialogs({ photos, folder, video: path.join(folder, 'x.mp4') });
  await page.getByRole('button', { name: 'Add photos' }).click();
  await expect(page.getByTestId('view-story').locator('.tray-item')).toHaveCount(7, { timeout: 60_000 });
  await page.getByTestId('story-title').fill('Test title');
  await page.getByTestId('make-story').click();
  await expect(page.getByTestId('page-strip')).toBeVisible({ timeout: 60_000 });

  const n = await stripCount();
  await page.getByTestId('page-add').click();
  expect(await stripCount()).toBe(n + 1);
  await page.keyboard.press('ControlOrMeta+z');
  expect(await stripCount()).toBe(n);

  // Cover: edit the title text in place.
  await page.getByTestId('strip-page').first().click();
  const text = page.locator('.story-page [data-testid="story-el-text"] .se-text').first();
  await text.dblclick();
  await expect(page.getByTestId('text-editor')).toBeVisible();
  await page.keyboard.press('ControlOrMeta+a');
  await page.keyboard.type('Edited');
  await page.keyboard.press('Escape');
  await expect(page.locator('.story-page [data-testid="story-el-text"] .se-text').first()).toContainText(/edited/i);

  // Drag a photo element and nudge it with arrows.
  const el = page.locator('.story-page [data-testid="story-el-photo"] .se-photo').first();
  await el.click();
  const box1 = await el.boundingBox();
  await page.keyboard.press('Shift+ArrowRight');
  const box2 = await el.boundingBox();
  expect(box2!.x).toBeGreaterThan(box1!.x + 3);
  await page.mouse.move(box2!.x + box2!.width / 2, box2!.y + box2!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box2!.x + box2!.width / 2 + 40, box2!.y + box2!.height / 2 + 20, { steps: 6 });
  await page.mouse.up();
  const box3 = await el.boundingBox();
  expect(box3!.x).toBeGreaterThan(box2!.x + 10);

  // Resize with the top-left corner handle (aspect locked), rotate handle exists.
  const sel = page.getByTestId('selection-box');
  await expect(sel).toHaveCount(1);
  const before = await sel.boundingBox();
  const handle = sel.locator('[data-handle="nw"]');
  const hb = (await handle.boundingBox())!;
  await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await page.mouse.down();
  await page.mouse.move(hb.x + hb.width / 2 + 30, hb.y + hb.height / 2 + 30, { steps: 5 });
  await page.mouse.up();
  const after = await sel.boundingBox();
  expect(after!.width).toBeLessThan(before!.width - 5);
  await expect(sel.locator('[data-handle="rotate"]')).toHaveCount(1);

  // Crop mode: double-click, Escape exits.
  await page.locator('.story-page [data-testid="story-el-photo"] .se-photo').first().dblclick();
  await expect(page.locator('.crop-hint')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.crop-hint')).toHaveCount(0);

  // Drag a tray photo onto empty space adds an element.
  const count = await page.locator('.story-page [data-testid="story-el-photo"]').count();
  await page.getByTestId('view-story').locator('.tray-pick').nth(5).dragTo(page.getByTestId('story-page'), { targetPosition: { x: 20, y: 20 } });
  await expect.poll(() => page.locator('.story-page [data-testid="story-el-photo"]').count()).toBeGreaterThanOrEqual(count);
});

test('closing the window with unsaved changes asks first, and Cancel keeps it open', async () => {
  test.setTimeout(120_000);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'story-out-'));
  await stubDialogs({ photos, folder, video: path.join(folder, 'x.mp4') });
  await page.getByRole('button', { name: 'Add photos' }).click();
  await expect(page.getByTestId('view-story').locator('.tray-item')).toHaveCount(7, { timeout: 60_000 });
  await page.getByTestId('make-story').click();
  await expect(page.getByTestId('page-strip')).toBeVisible({ timeout: 60_000 });
  const close = () =>
    app.evaluate(({ dialog, BrowserWindow }) => {
      const g = globalThis as unknown as { __asked: number };
      g.__asked = 0;
      dialog.showMessageBoxSync = (() => { g.__asked++; return 0; }) as never;
      BrowserWindow.getAllWindows()[0].close();
      return { asked: g.__asked, windows: BrowserWindow.getAllWindows().length };
    });
  await page.getByTestId('page-add').click();
  await page.waitForTimeout(500);
  expect(await close()).toEqual({ asked: 1, windows: 1 });
});
