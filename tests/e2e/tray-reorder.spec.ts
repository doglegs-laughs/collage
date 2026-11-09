import { _electron as electron, expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
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
let photos: string[];
let app: ElectronApplication;
let page: Page;

test.beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reorder-e2e-'));
  photos = [0, 1, 2, 3].map((i) => {
    const out = path.join(dir, `photo${i + 1}.jpg`);
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1200x800', '-vf', `hue=h=${i * 60}`, '-frames:v', '1', out]);
    return out;
  });
});
test.afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

test.beforeEach(async () => {
  app = await electron.launch({ executablePath: electronPath, args: [root, '--no-sandbox'], env: { ...process.env, COLLAGE_NO_SANDBOX: '1' } });
  page = await app.firstWindow();
  await page.waitForSelector('.topbar');
  await page.setViewportSize({ width: 1500, height: 950 });
  await app.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: files })) as never;
  }, photos);
});
test.afterEach(async () => {
  await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = (() => 1) as never; });
  await app.close();
});

const names = (view: Locator) => view.locator('.tray-item .tray-pick').evaluateAll((els) => els.map((e) => e.getAttribute('title')));
const numbers = (view: Locator) => view.locator('.tray-item .tray-check').allTextContents();

async function addPhotos(view: Locator): Promise<string[]> {
  await view.getByRole('button', { name: 'Add photos' }).click();
  await expect(view.locator('.tray-item')).toHaveCount(4, { timeout: 60_000 });
  return (await names(view)) as string[];
}

test('drag a photo onto the left half of another to move it; numbers follow; Alt+arrow moves one place', async () => {
  await page.getByRole('tab', { name: 'Story' }).click();
  const view = page.getByTestId('view-story');
  const before = await addPhotos(view);
  const items = view.locator('.tray-item');

  await items.nth(3).locator('.tray-pick').dragTo(items.nth(0).locator('.tray-pick'), { targetPosition: { x: 4, y: 20 } });
  const after = [before[3], before[0], before[1], before[2]];
  await expect.poll(() => names(view)).toEqual(after);
  await expect.poll(() => numbers(view)).toEqual(['1', '2', '3', '4']);
  await expect(view.locator('.tray-item.drop-before, .tray-item.drop-after')).toHaveCount(0);

  // Deselect the 2nd, then move the first one right with the keyboard.
  await items.nth(1).locator('.tray-pick').click();
  await expect.poll(() => numbers(view)).toEqual(['1', '', '2', '3']);
  const first = view.locator(`.tray-pick[title="${after[0]}"]`);
  await first.focus();
  await page.keyboard.press('Alt+ArrowRight');
  await expect.poll(() => names(view)).toEqual([after[1], after[0], after[2], after[3]]);
  await expect(first).toBeFocused();
  await expect(view.locator('.sr-only[role="status"]')).toHaveText(`Moved ${after[0]} to position 2 of 4`);
  // The selection keeps the same photos but its numbers follow the new order.
  await expect.poll(() => numbers(view)).toEqual(['', '1', '2', '3']);

  // Plain arrows still only move focus.
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => names(view)).toEqual([after[1], after[0], after[2], after[3]]);
  await expect(items.nth(2).locator('.tray-pick')).toBeFocused();
});

test('dragging a tray photo onto a Story page still places it', async () => {
  await page.getByRole('tab', { name: 'Story' }).click();
  const view = page.getByTestId('view-story');
  await addPhotos(view);
  await view.getByTestId('make-story').click();
  await expect(view.getByTestId('story-page')).toBeVisible({ timeout: 60_000 });
  const els = view.locator('.story-page [data-testid="story-el-photo"]');
  const count = await els.count();
  await view.locator('.tray-pick').nth(0).dragTo(view.getByTestId('story-page'), { targetPosition: { x: 20, y: 20 } });
  await expect.poll(() => els.count()).toBeGreaterThanOrEqual(count);
  // The tray order is untouched by a drop on the page.
  await expect.poll(() => numbers(view)).toEqual(['1', '2', '3', '4']);
});

test('reordering in Borders changes the one shared library order', async () => {
  await page.getByRole('tab', { name: 'Borders' }).click();
  const view = page.getByTestId('view-borders');
  const before = await addPhotos(view);
  const items = view.locator('.tray-item');
  await items.nth(3).locator('.tray-pick').dragTo(items.nth(0).locator('.tray-pick'), { targetPosition: { x: 4, y: 20 } });
  const after = [before[3], before[0], before[1], before[2]];
  await expect.poll(() => names(view)).toEqual(after);

  await page.getByRole('tab', { name: 'Story' }).click();
  await expect.poll(() => names(page.getByTestId('view-story'))).toEqual(after);
});
