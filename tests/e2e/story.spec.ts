import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { FONT_KEYS, FONT_LABELS, FONT_STACKS } from '../../src/story/fonts';

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

let userData: string;
async function launch() {
  app = await electron.launch({ executablePath: electronPath, args: [root, '--no-sandbox'], env: { ...process.env, COLLAGE_NO_SANDBOX: '1', COLLAGE_USER_DATA: userData } });
  page = await app.firstWindow();
  await page.waitForSelector('.topbar');
  await page.setViewportSize({ width: 1500, height: 950 });
  await page.getByRole('tab', { name: 'Story' }).click();
}
/** Close the window the normal way (autosave flushes, no prompt) and start the app again on the same user data. */
async function relaunch() {
  await app.close();
  await launch();
}
test.beforeEach(async () => {
  userData = fs.mkdtempSync(path.join(os.tmpdir(), 'story-userdata-'));
  await launch();
});
test.afterEach(async () => {
  // Unsaved edits make the app ask before quitting; answer "Discard" so the test can end.
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = (() => 1) as never; }).catch(() => {});
  await app.close().catch(() => {});
  fs.rmSync(userData, { recursive: true, force: true });
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

test('closing the window with unsaved changes autosaves instead of asking', async () => {
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
      return null;
    });
  await page.getByTestId('page-add').click();
  await page.waitForTimeout(500);
  const closed = app.waitForEvent('close');
  await close();
  await closed;
  expect(fs.existsSync(path.join(userData, 'autosave', 'current.story.json'))).toBe(true);
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

  // Open the picker: the group holding the current layout is open, the others are collapsed headers.
  await page.getByTestId('layout-button').click();
  const pop = page.getByTestId('layout-popover');
  await expect(pop).toBeVisible();
  const tiles = pop.getByTestId('layout-option');
  await expect(pop.locator('[data-testid="layout-group"][data-group="single"]')).toHaveAttribute('data-open', 'true');
  await expect(pop.locator('[data-testid="layout-group"][data-group="special"]')).toHaveAttribute('data-open', 'false');
  await expect(tiles.first()).toHaveAttribute('data-option-id', 'single');
  await expect(pop.locator('[data-testid="layout-option"][data-current="true"]')).toHaveCount(1);
  // Opening the other groups shows more arrangements.
  for (const t of await pop.getByTestId('layout-group-toggle').all()) if ((await t.getAttribute('aria-expanded')) === 'false') await t.click();
  expect(await tiles.count()).toBeGreaterThanOrEqual(3);
  // Thumbnails render progressively.
  await expect.poll(() => pop.locator('.lp-thumb img').count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(3);
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(shots, 'layout-picker.png') });

  // The Full bleed finish chip applies at once and keeps the picker open and the arrangement.
  const chips = pop.getByTestId('finish-chip');
  await expect(chips).toHaveText(['Plain', 'Black borders', 'Thick frame', 'Shadow', 'Print mat', 'Full bleed']);
  await chips.filter({ hasText: 'Full bleed' }).click();
  await expect(pop).toBeVisible();
  await expect(name).toHaveText('Full screen photo');
  await expect(photoEls).toHaveCount(1);
  const box = await page.getByTestId('story-page').boundingBox();
  const el = await photoEls.first().locator('.se-photo').boundingBox();
  expect(Math.abs(el!.width - box!.width)).toBeLessThan(3);
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);

  // Cycle with the arrows; the name changes and wraps. A full-bleed single has no counterpart elsewhere, so the finish falls back to the default.
  await page.getByTestId('layout-next').click();
  expect(await name.textContent()).not.toBe('Full screen photo');
  await page.getByTestId('layout-prev').click();
  await expect(name).toHaveText('Single');
  await page.getByTestId('layout-prev').click();
  expect(await name.textContent()).not.toBe('Single');
  // Bracket keys cycle arrangements too when nothing is selected; the braces step the finish.
  await page.keyboard.press(']');
  await expect(name).toHaveText('Single');
  await page.keyboard.press('}');
  await expect(name).toHaveText('Single · Black borders');
  await page.keyboard.press('{');
  await expect(name).toHaveText('Single');

  // Escape closes the picker without changing anything; Enter applies the focused tile.
  await page.getByTestId('layout-button').click();
  await expect(pop).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);
  await expect(name).toHaveText('Single');
  await page.getByTestId('layout-button').click();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(pop).toHaveCount(0);
  await expect(name).not.toHaveText('Single');

  // The Page panel shows the same picker with the current layout marked.
  const section = page.getByTestId('layout-section');
  await expect(section.locator('[data-testid="layout-option"][data-current="true"]')).toHaveCount(1);

  // Undo steps back one layout at a time, all the way to the original.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(name).toHaveText('Single');
  for (let i = 0; i < 12 && (await name.textContent()) !== original; i++) await page.keyboard.press('ControlOrMeta+z');
  await expect(name).toHaveText(original);
});

test('layout picker: finish chips and arrangements are separate axes', async () => {
  test.setTimeout(180_000);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'story-out-'));
  await stubDialogs({ photos, folder, video: path.join(folder, 'x.mp4') });
  await page.getByRole('button', { name: 'Add photos' }).click();
  await expect(page.getByTestId('view-story').locator('.tray-item')).toHaveCount(7, { timeout: 60_000 });
  // Three landscapes (photos 1, 3 and 7) make one stack page.
  await page.getByTestId('view-story').getByRole('button', { name: 'None', exact: true }).click();
  for (const i of [0, 2, 6]) await page.getByTestId('view-story').locator('.tray-pick').nth(i).click();
  await page.getByTestId('make-story').click();
  await expect(page.getByTestId('page-strip')).toBeVisible({ timeout: 60_000 });
  await imagesLoaded().catch(() => {});
  const name = page.getByTestId('layout-name');
  const photoEls = page.locator('.story-page [data-testid="story-el-photo"]:not([data-ghost])');
  const frames = () => photoEls.locator('.se-photo').evaluateAll((els) => els.map((e) => ({ bg: getComputedStyle(e).backgroundColor, r: e.getBoundingClientRect().toJSON() })));
  const pop = page.getByTestId('layout-popover');
  const chip = (label: string) => pop.getByTestId('finish-chip').filter({ hasText: label });

  await page.getByTestId('layout-button').click();
  await expect(pop).toBeVisible();
  await expect(pop.getByTestId('finish-chips')).toBeVisible();
  await expect(pop.getByTestId('finish-chip')).toHaveText(['Plain', 'Tight', 'Black borders', 'Print mat']);
  await chip('Plain').click();
  await expect(name).toHaveText(/^Stack 3$/);
  await expect(photoEls).toHaveCount(3);
  const plain = await frames();

  // Black borders: same boxes, black frames, label updates, picker stays open on the same arrangement.
  await chip('Black borders').click();
  await expect(name).toHaveText('Stack 3 · Black borders');
  await expect(pop).toBeVisible();
  await expect(chip('Black borders')).toHaveAttribute('aria-checked', 'true');
  const black = await frames();
  expect(black.map((f) => f.bg)).toEqual(['rgb(0, 0, 0)', 'rgb(0, 0, 0)', 'rgb(0, 0, 0)']);
  black.forEach((f, i) => { for (const k of ['x', 'y', 'width', 'height'] as const) expect(Math.abs(f.r[k] - plain[i].r[k])).toBeLessThan(1.5); });
  await expect(pop.locator('[data-testid="layout-option"][data-current="true"]')).toHaveAttribute('data-option-id', 'stack-3');
  await expect(pop.locator('[data-testid="layout-option"][data-current="true"]')).toHaveAttribute('data-finish', 'black');

  // Print mat: photos sit inside a paper rectangle.
  await chip('Print mat').click();
  await expect(name).toHaveText('Stack 3 · Print mat');
  const paper = await page.locator('.story-page [data-testid="story-el-rect"] .se-rect').first().boundingBox();
  const matted = await frames();
  expect(paper).not.toBeNull();
  for (const f of matted) {
    expect(f.r.x).toBeGreaterThan(paper!.x);
    expect(f.r.x + f.r.width).toBeLessThan(paper!.x + paper!.width);
    expect(f.r.y).toBeGreaterThan(paper!.y);
    expect(f.r.y + f.r.height).toBeLessThan(paper!.y + paper!.height);
  }
  // Thumbnails of the arrangements are drawn in the current finish.
  await expect.poll(() => pop.locator('.lp-thumb img').count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(shots, 'layout-two-axis.png') });

  // Keyboard: Tab from the chips reaches the tiles, arrows stay inside each row.
  await chip('Print mat').focus();
  await page.keyboard.press('ArrowLeft');
  await expect(chip('Black borders')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(pop.locator('[data-layout-tile][tabindex="0"], .lp-toggle').first()).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(pop).toHaveCount(0);

  // Cycling arrangements keeps the finish.
  await page.getByTestId('layout-next').click();
  await expect(name).toHaveText(/ · Print mat$/);
  expect(await name.textContent()).not.toBe('Stack 3 · Print mat');
  await page.getByTestId('layout-prev').click();
  await expect(name).toHaveText('Stack 3 · Print mat');

  // Undo: one step per change.
  await page.keyboard.press('ControlOrMeta+z');
  await expect(name).toHaveText(/ · Print mat$/);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(name).toHaveText('Stack 3 · Print mat');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(name).toHaveText('Stack 3 · Black borders');
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

async function makeEditedStory(project: string) {
  await page.getByRole('button', { name: 'Add photos' }).click();
  await expect(page.getByTestId('view-story').locator('.tray-item')).toHaveCount(7, { timeout: 60_000 });
  await page.getByTestId('story-title').fill('Round trip');
  await page.getByTestId('make-story').click();
  await expect(page.getByTestId('page-strip')).toBeVisible({ timeout: 60_000 });
  // Edit: nudge a photo on page 2, hide page 3, retitle.
  await page.getByTestId('strip-page').nth(1).click();
  await imagesLoaded().catch(() => {});
  const el = page.locator('.story-page [data-testid="story-el-photo"] .se-photo').first();
  await el.click();
  await page.keyboard.press('Shift+ArrowRight');
  const item = page.getByTestId('strip-page').nth(2);
  await item.hover();
  await item.getByTestId('strip-eye').click();
  await expect(item).toHaveAttribute('data-hidden', 'true');
  await page.getByLabel('Story title').fill('Round trip 2');
  await page.getByTestId('strip-page').nth(1).click();
  const box = await page.locator('.story-page [data-testid="story-el-photo"] .se-photo').first().boundingBox();
  await page.keyboard.press('ControlOrMeta+s');
  await expect.poll(() => fs.existsSync(project)).toBe(true);
  return box!;
}

test('save, relaunch, open: pages, title, hidden flags and photos come back', async () => {
  test.setTimeout(180_000);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'story-out-'));
  const project = path.join(folder, 'trip.collage');
  await stubDialogs({ photos, folder, video: project });
  const total0 = await (async () => { await makeEditedStory(project); return stripCount(); })();
  const saved = JSON.parse(fs.readFileSync(project, 'utf8'));
  expect(saved.title).toBe('Round trip 2');
  expect(saved.pages.filter((p: { hidden?: boolean }) => p.hidden)).toHaveLength(1);
  expect(saved.pages.some((p: { elements: { crop?: unknown }[] }) => p.elements.some((e) => e.crop))).toBe(true);
  const savedBox = await page.locator('.story-page [data-testid="story-el-photo"] .se-photo').first().boundingBox();

  await relaunch();
  await stubDialogs({ photos: [project], folder, video: project });
  await page.keyboard.press('ControlOrMeta+o');
  await expect(page.getByTestId('page-strip')).toBeVisible({ timeout: 60_000 });
  expect(await stripCount()).toBe(total0);
  await expect(page.getByLabel('Story title')).toHaveValue('Round trip 2');
  await expect(page.getByTestId('strip-page').nth(2)).toHaveAttribute('data-hidden', 'true');
  await page.getByTestId('strip-page').nth(1).click();
  await imagesLoaded();
  const box = await page.locator('.story-page [data-testid="story-el-photo"] .se-photo').first().boundingBox();
  expect(Math.abs(box!.x - savedBox!.x)).toBeLessThan(2);
  expect(Math.abs(box!.y - savedBox!.y)).toBeLessThan(2);
});

test('autosave: relaunch offers Continue and restores the story', async () => {
  test.setTimeout(180_000);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'story-out-'));
  await stubDialogs({ photos, folder, video: path.join(folder, 'x.mp4') });
  await page.getByRole('button', { name: 'Add photos' }).click();
  await expect(page.getByTestId('view-story').locator('.tray-item')).toHaveCount(7, { timeout: 60_000 });
  await page.getByTestId('story-title').fill('Left off');
  await page.getByTestId('make-story').click();
  await expect(page.getByTestId('page-strip')).toBeVisible({ timeout: 60_000 });
  const n = await stripCount();
  await page.getByTestId('page-add').click(); // an edit after generation
  // Closing flushes the autosave and does not ask about unsaved changes (the dialog is not stubbed).
  await relaunch();
  await expect(page.getByTestId('resume-card')).toContainText('Left off');
  await expect(page.getByTestId('resume-card')).toContainText(`${n + 1} pages`);
  await page.getByTestId('resume-continue').click();
  await expect(page.getByTestId('page-strip')).toBeVisible({ timeout: 60_000 });
  expect(await stripCount()).toBe(n + 1);
  await expect(page.getByLabel('Story title')).toHaveValue('Left off');
  await imagesLoaded();
});

test('Open Recent lists saved stories and marks missing files', async () => {
  test.setTimeout(180_000);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'story-out-'));
  const project = path.join(folder, 'recent.collage');
  await stubDialogs({ photos, folder, video: project });
  await makeEditedStory(project);
  await relaunch();
  await page.getByTestId('resume-new').click();
  await page.getByTestId('recent-story').first().click();
  await expect(page.getByTestId('page-strip')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByLabel('Story title')).toHaveValue('Round trip 2');
  fs.rmSync(project);
  await relaunch();
  await expect(page.getByTestId('recent-story').first()).toBeDisabled();
  await expect(page.getByTestId('recent-stories')).toContainText('Not found');
  await page.getByTestId('recent-stories').getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByTestId('recent-story')).toHaveCount(0);
});

test('fonts: Italiana loads, inspector font change re-renders thumbnails, story title font, visual checks', async () => {
  test.setTimeout(240_000);
  const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'story-out-'));
  await stubDialogs({ photos, folder, video: path.join(folder, 'x.mp4') });
  await page.getByRole('button', { name: 'Add photos' }).click();
  await expect(page.getByTestId('view-story').locator('.tray-item')).toHaveCount(7, { timeout: 60_000 });
  // One portrait photo (photo2 is 3000x4000) and a title give the Faroes cover.
  const pick = page.getByTestId('view-story').locator('.tray-pick').nth(1);
  await page.getByTestId('view-story').getByRole('button', { name: 'None', exact: true }).click();
  await pick.click({ timeout: 90_000 });
  await page.getByTestId('story-title').fill('The Faroes');
  await page.getByTestId('story-subtitle').fill('June 2025');
  await page.getByRole('button', { name: 'Clean', exact: true }).click();
  await page.getByTestId('make-story').click();
  await expect(page.getByTestId('page-strip')).toBeVisible({ timeout: 60_000 });
  await imagesLoaded().catch(() => {});

  const titleEl = page.locator('.story-page [data-testid="story-el-text"] .se-text').first();
  await expect(titleEl).toHaveCSS('font-family', /Italiana/);
  await expect.poll(() => page.evaluate(() => document.fonts.check('400 32px "Italiana"')), { timeout: 15_000 }).toBe(true);
  const thumb = () => page.getByTestId('strip-page').first().locator('img').getAttribute('src');
  await expect.poll(thumb, { timeout: 15_000 }).toBeTruthy();
  const before = await thumb();
  await imagesLoaded().catch(() => {});
  await page.waitForTimeout(400);
  await page.locator('.story-stage').screenshot({ path: path.join(shots, 'fonts-cover.png') });

  // Change the font through the inspector: the thumbnail (canvas) pixels change.
  await titleEl.click();
  const fontSel = page.getByLabel('Font', { exact: true });
  await expect(fontSel).toHaveValue('italiana');
  await fontSel.selectOption('bebas');
  await expect(titleEl).toHaveCSS('font-family', /Bebas Neue/);
  await expect.poll(async () => (await thumb()) !== before, { timeout: 15_000 }).toBe(true);
  await expect.poll(() => page.evaluate(() => document.fonts.check('400 32px "Bebas Neue"'))).toBe(true);
  // Weight choices follow the family (Bebas Neue has one).
  await expect(page.getByRole('radio', { name: /Regular/ }).or(page.getByRole('button', { name: 'Regular' })).first()).toBeVisible();

  // Story section: title font applies to every title element in a single undo step.
  await page.getByLabel('Title font', { exact: true }).selectOption('playfair');
  await expect(titleEl).toHaveCSS('font-family', /Playfair Display/);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(titleEl).toHaveCSS('font-family', /Bebas Neue/);
  await page.getByLabel('Title font', { exact: true }).selectOption('italiana');
  await page.getByLabel('Subtitle font', { exact: true }).selectOption('josefin');
  await expect(titleEl).toHaveCSS('font-family', /Italiana/);

  // Cover variants and black-bordered stacks, each shot then tiled into covers.png.
  const tiles: string[] = [];
  const shootLayout = async (id: string) => {
    await page.getByTestId('layout-button').click();
    const pop = page.getByTestId('layout-popover');
    const group = pop.locator('[data-testid="layout-group"][data-group="cover"] [data-testid="layout-group-toggle"]');
    if ((await group.getAttribute('aria-expanded')) === 'false') await group.click();
    await pop.locator(`[data-option-id="${id}"]`).click();
    await page.keyboard.press('Escape').catch(() => {});
    await imagesLoaded().catch(() => {});
    await page.waitForTimeout(500);
    const f = path.join(shots, `covers-${id}.png`);
    await page.locator('.story-page').first().screenshot({ path: f });
    tiles.push(f);
  };
  await shootLayout('cover');
  await shootLayout('cover-border');
  await shootLayout('cover-border-below');
  await shootLayout('cover-mat');
  const inputs = tiles.flatMap((f) => ['-i', f]);
  const filter = tiles.map((_, i) => `[${i}:v]scale=-2:640[v${i}]`).join(';') + ';' + tiles.map((_, i) => `[v${i}]`).join('') + `hstack=inputs=${tiles.length}`;
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', filter, path.join(shots, 'covers.png')]);

  // Font sampler: every font name drawn in its own face.
  const faces = FONT_KEYS.map((k) => ({ label: FONT_LABELS[k], family: FONT_STACKS[k] }));
  await page.evaluate(async (opts) => {
    const box = document.createElement('div');
    box.id = 'font-sampler';
    box.style.cssText = 'position:fixed;left:20px;top:20px;width:760px;padding:24px;background:#fff;color:#111;z-index:99999;border:1px solid #ccc';
    for (const o of opts) {
      const row = document.createElement('div');
      row.textContent = `${o.label} — THE FAROES 0123`;
      row.style.cssText = `font-family:${o.family};font-size:30px;line-height:1.5;font-weight:400;letter-spacing:0.04em`;
      box.appendChild(row);
    }
    document.body.appendChild(box);
    await Promise.all(opts.map((o) => document.fonts.load(`400 30px ${o.family}`, 'THE FAROES')));
  }, faces);
  await page.waitForTimeout(500);
  await page.locator('#font-sampler').screenshot({ path: path.join(shots, 'fonts-sampler.png') });
  await page.evaluate(() => document.getElementById('font-sampler')?.remove());
});
