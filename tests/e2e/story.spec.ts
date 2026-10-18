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
  await el.dblclick(); // move-frame mode: a plain drag now moves the frame
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

  // Double-click enters "move frame" mode; Escape exits.
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

test('layout picker: choose, cycle with arrows, undo', async () => {
  test.setTimeout(180_000);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'story-out-'));
  await stubDialogs({ photos, folder, video: path.join(folder, 'x.mp4') });
  await page.getByRole('button', { name: 'Add photos' }).click();
  await expect(page.getByTestId('view-story').locator('.tray-item')).toHaveCount(7, { timeout: 60_000 });
  // One selected photo makes a one-page story.
  const pick = page.getByTestId('view-story').locator('.tray-pick').first();
  await page.getByTestId('view-story').getByRole('button', { name: 'None', exact: true }).click();
  await pick.click();
  await expect(pick).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('make-story').click();
  await expect(page.getByTestId('page-strip')).toBeVisible({ timeout: 60_000 });
  expect(await stripCount()).toBe(1);
  await imagesLoaded().catch(() => {});

  const name = page.getByTestId('layout-name');
  const original = (await name.textContent())!;
  const photoEls = page.locator('.story-page [data-testid="story-el-photo"]');

  // Open the picker: several options, Full screen photo first.
  await page.getByTestId('layout-button').click();
  const pop = page.getByTestId('layout-popover');
  await expect(pop).toBeVisible();
  const tiles = pop.getByTestId('layout-option');
  expect(await tiles.count()).toBeGreaterThanOrEqual(3);
  await expect(tiles.first()).toHaveAttribute('data-option-id', 'single-bleed');
  await expect(tiles.first()).toContainText('Full screen photo');
  // Thumbnails render progressively.
  await expect.poll(() => pop.locator('.lp-thumb img').count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(shots, 'layout-picker.png') });

  // Apply Full screen.
  await tiles.first().click();
  await expect(pop).toHaveCount(0);
  await expect(name).toHaveText('Full screen photo');
  await expect(photoEls).toHaveCount(1);
  const box = await page.getByTestId('story-page').boundingBox();
  const el = await photoEls.first().locator('.se-photo').boundingBox();
  expect(Math.abs(el!.width - box!.width)).toBeLessThan(3);

  // Cycle with the arrows; the name changes and wraps.
  await page.getByTestId('layout-next').click();
  expect(await name.textContent()).not.toBe('Full screen photo');
  await page.getByTestId('layout-prev').click();
  await expect(name).toHaveText('Full screen photo');
  await page.getByTestId('layout-prev').click();
  expect(await name.textContent()).not.toBe('Full screen photo');
  // Bracket keys cycle too when nothing is selected.
  await page.keyboard.press(']');
  await expect(name).toHaveText('Full screen photo');

  // Escape closes the picker without changing anything; Enter applies the focused tile.
  await page.getByTestId('layout-button').click();
  await expect(pop).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(name).toHaveText('Full screen photo');
  await page.getByTestId('layout-button').click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(pop).toHaveCount(0);
  await expect(name).not.toHaveText('Full screen photo');

  // The Page panel shows the same picker with the current layout marked.
  const section = page.getByTestId('layout-section');
  await expect(section.locator('[data-testid="layout-option"][data-current="true"]')).toHaveCount(1);

  // Undo steps back one layout at a time, all the way to the original.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(name).toHaveText('Full screen photo');
  for (let i = 0; i < 8 && (await name.textContent()) !== original; i++) await page.keyboard.press('ControlOrMeta+z');
  await expect(name).toHaveText(original);
});

test('move a photo to its own page: inspector, undo, context menu, shortcut', async () => {
  test.setTimeout(180_000);
  const land = Array.from({ length: 6 }, (_, i) => {
    const out = path.join(dir, `land${i + 1}.jpg`);
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=3000x2000', '-vf', `hue=h=${i * 40}`, '-frames:v', '1', out]);
    return out;
  });
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'story-out-'));
  await stubDialogs({ photos: land, folder, video: path.join(folder, 'x.mp4') });
  await page.getByRole('button', { name: 'Add photos' }).click();
  await expect(page.getByTestId('view-story').locator('.tray-item')).toHaveCount(6, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Clean', exact: true }).click();
  await page.getByTestId('make-story').click();
  await expect(page.getByTestId('page-strip')).toBeVisible({ timeout: 60_000 });

  const photoEls = page.locator('.story-page [data-testid="story-el-photo"]:not([data-ghost])');
  const total = await stripCount();
  let multi = -1;
  for (let i = 0; i < total && multi < 0; i++) {
    await page.getByTestId('strip-page').nth(i).click();
    await expect(page.getByTestId('page-label')).toContainText(`Page ${i + 1} of`);
    if ((await photoEls.count()) >= 2) multi = i;
  }
  expect(multi).toBeGreaterThanOrEqual(0);
  await imagesLoaded().catch(() => {});

  // The inspector lists Page, then the element, then Story.
  await photoEls.first().locator('.se-photo').click();
  const order = await page.getByTestId('story-inspector').locator('[data-testid^="inspector-"]').evaluateAll((n) => n.map((x) => x.getAttribute('data-testid')));
  expect(order).toEqual(['inspector-page', 'inspector-element', 'inspector-story']);

  const label = await page.getByTestId('page-label').textContent();
  await page.getByTestId('move-own-page').click();
  await expect(page.getByTestId('page-label')).toContainText(`Page ${multi + 2} of ${total + 1}`);
  expect(await page.getByTestId('page-label').textContent()).not.toBe(label);
  expect(await stripCount()).toBe(total + 1);
  await expect(photoEls).toHaveCount(1);
  await expect(page.locator('.toast.show')).toContainText(`Moved to page ${multi + 2}`);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(stripCount).toBe(total);

  // Right-click shows the menu; Escape closes it.
  await page.getByTestId('strip-page').nth(multi).click();
  await photoEls.first().locator('.se-photo').click({ button: 'right' });
  const menu = page.getByTestId('context-menu');
  await expect(menu.getByRole('menuitem', { name: 'Move to its own page' })).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: path.join(shots, 'own-page-menu.png') });
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // Context menu action, then the keyboard shortcut.
  await photoEls.first().locator('.se-photo').click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Move to its own page' }).click();
  await expect.poll(stripCount).toBe(total + 1);
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(stripCount).toBe(total);
  await page.getByTestId('strip-page').nth(multi).click();
  await photoEls.first().locator('.se-photo').click();
  await page.keyboard.press('ControlOrMeta+Shift+n');
  await expect.poll(stripCount).toBe(total + 1);

  // Drag a photo from the stage onto the "New page" zone at the end of the strip.
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(stripCount).toBe(total);
  await page.getByTestId('strip-page').nth(multi).click();
  await expect(page.getByTestId('page-label')).toContainText(`Page ${multi + 1} of`);
  await photoEls.first().locator('.se-photo').dblclick(); // frame-move mode
  const from = await photoEls.first().locator('.se-photo').boundingBox();
  const to = await page.getByTestId('strip-new-page').boundingBox();
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(from!.x + from!.width / 2 + 20, from!.y + from!.height / 2 + 20, { steps: 4 });
  await page.mouse.move(to!.x + to!.width / 2, to!.y + to!.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(stripCount).toBe(total + 1);
  await expect(page.getByTestId('page-label')).toContainText(`Page ${total + 1} of ${total + 1}`);
  await expect(photoEls).toHaveCount(1);
});

test('drag pans the photo in its frame; double-click moves the frame', async () => {
  test.setTimeout(120_000);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'story-out-'));
  await stubDialogs({ photos, folder, video: path.join(folder, 'x.mp4') });
  await page.getByRole('button', { name: 'Add photos' }).click();
  await expect(page.getByTestId('view-story').locator('.tray-item')).toHaveCount(7, { timeout: 60_000 });
  await page.getByTestId('make-story').click();
  await expect(page.getByTestId('page-strip')).toBeVisible({ timeout: 60_000 });
  await imagesLoaded().catch(() => {});

  const el = page.locator('.story-page [data-testid="story-el-photo"]:not([data-ghost])').first();
  const body = el.locator('.se-photo');
  const sel = page.getByTestId('selection-box');
  const crop = async () => (await el.getAttribute('data-crop'))!.split(',').map(Number);
  const frame = async () => { const b = (await sel.boundingBox())!; return [Math.round(b.x), Math.round(b.y)]; };
  const drag = async (dx: number, dy: number) => {
    const b = (await body.boundingBox())!;
    const x = b.x + b.width / 2;
    const y = b.y + b.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 });
    await page.mouse.move(x + dx, y + dy, { steps: 4 });
    await page.mouse.up();
  };
  const zoom = page.getByRole('slider', { name: 'Zoom' });

  // Zoom in with the wheel over the selected photo, then pan: crop changes, the frame does not.
  await body.click();
  await expect(sel).toHaveCount(1);
  const f0 = await frame();
  const b0 = (await body.boundingBox())!;
  await page.mouse.move(b0.x + b0.width / 2, b0.y + b0.height / 2);
  await page.mouse.wheel(0, -600);
  await expect.poll(async () => (await crop())[0]).toBeGreaterThan(1.2);
  expect(Number(await zoom.inputValue())).toBeGreaterThan(1.2);
  const c0 = await crop();
  await drag(-40, -30);
  await expect.poll(async () => (await crop()).join()).not.toBe(c0.join());
  expect(await frame()).toEqual(f0);

  // One pan = one undo step.
  const c1 = await crop();
  await page.keyboard.press('ControlOrMeta+z');
  await expect.poll(async () => (await crop()).join()).toBe(c0.join());
  expect(c1.join()).not.toBe(c0.join());

  // Double-click: now a drag moves the frame and leaves the crop alone.
  await body.dblclick();
  await expect(page.locator('.crop-hint')).toBeVisible();
  const c2 = await crop();
  await drag(30, 25);
  await expect.poll(async () => (await frame()).join()).not.toBe(f0.join());
  expect((await crop()).join()).toBe(c2.join());
  await page.keyboard.press('Escape');
  await expect(page.locator('.crop-hint')).toHaveCount(0);
});

test('hide a page: dimmed in the strip, skipped by export, undo/redo', async () => {
  test.setTimeout(180_000);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'story-out-'));
  await stubDialogs({ photos, folder, video: path.join(folder, 'x.mp4') });
  await page.getByRole('button', { name: 'Add photos' }).click();
  await expect(page.getByTestId('view-story').locator('.tray-item')).toHaveCount(7, { timeout: 60_000 });
  await page.getByTestId('make-story').click();
  await expect(page.getByTestId('page-strip')).toBeVisible({ timeout: 60_000 });
  const total = await stripCount();
  expect(total).toBeGreaterThanOrEqual(3);
  const item = page.getByTestId('strip-page').nth(1);
  const count = page.getByTestId('strip-count');
  await expect(count).toHaveText(`${total} pages`);

  await item.hover();
  await item.getByTestId('strip-eye').click();
  await expect(item).toHaveAttribute('data-hidden', 'true');
  await expect(count).toHaveText(`${total} pages · 1 hidden`);
  await expect.poll(() => item.locator('.strip-thumb').evaluate((n) => Number(getComputedStyle(n).opacity))).toBeLessThan(0.5);

  // The hidden page can still be opened; the stage says so.
  await item.click();
  await expect(page.getByTestId('hidden-banner')).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Hide page' })).toBeChecked();

  // Export skips it.
  await page.getByTestId('story-export').click();
  await page.getByTestId('export-images-item').click();
  await page.getByTestId('images-go').click();
  await expect(page.getByTestId('export-reveal')).toBeVisible({ timeout: 240_000 });
  expect(fs.readdirSync(folder).filter((f) => f.endsWith('.jpg')).length).toBe(total - 1);

  // Show it again with the banner, then undo / redo.
  await page.getByTestId('hidden-banner').getByRole('button', { name: 'Show page' }).click();
  await expect(item).toHaveAttribute('data-hidden', 'false');
  await expect(count).toHaveText(`${total} pages`);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(item).toHaveAttribute('data-hidden', 'true');
  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expect(item).toHaveAttribute('data-hidden', 'false');

  // Shortcut toggles the current page, and the strip context menu offers the same.
  await page.keyboard.press('ControlOrMeta+Shift+h');
  await expect(item).toHaveAttribute('data-hidden', 'true');
  await item.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Show page' }).click();
  await expect(item).toHaveAttribute('data-hidden', 'false');
});

test('add a title page or put the title on a page after making a story without one', async () => {
  test.setTimeout(180_000);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'story-out-'));
  await stubDialogs({ photos, folder, video: path.join(folder, 'x.mp4') });
  await page.getByRole('button', { name: 'Add photos' }).click();
  await expect(page.getByTestId('view-story').locator('.tray-item')).toHaveCount(7, { timeout: 60_000 });
  await page.getByTestId('make-story').click();
  await expect(page.getByTestId('page-strip')).toBeVisible({ timeout: 60_000 });
  const n = await stripCount();
  const stageText = page.locator('.story-stage [data-testid="story-el-text"]');
  await expect(stageText).toHaveCount(0);

  await page.getByLabel('Story title').fill('Midsummer');
  await page.getByRole('button', { name: 'Add title page' }).first().click();
  expect(await stripCount()).toBe(n + 1);
  await expect(page.getByTestId('page-label')).toContainText('Page 1 of');
  await expect(stageText.first()).toContainText(/midsummer/i);
  await expect(page.getByTestId('title-missing')).toHaveCount(0);

  await page.keyboard.press('ControlOrMeta+z');
  expect(await stripCount()).toBe(n);
  await expect(stageText).toHaveCount(0);
  await expect(page.getByTestId('title-missing')).toBeVisible();

  await page.getByRole('button', { name: 'Add to this page' }).first().click();
  expect(await stripCount()).toBe(n);
  await expect(stageText.first()).toContainText(/midsummer/i);
  await expect(page.getByTestId('selection-box')).toHaveCount(1);
});
