import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { defaultTextEl, emptyPage, emptyStory, serializeStory } from '../../src/story/model';

const root = path.resolve(import.meta.dirname, '../..');
const electronPath = createRequire(import.meta.url)('electron') as string;
let dir: string, app: ElectronApplication, page: Page;

test.beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'collage-review-'));
  app = await electron.launch({ executablePath: electronPath, args: [root, '--no-sandbox'], env: { ...process.env, COLLAGE_NO_SANDBOX: '1', COLLAGE_USER_DATA: path.join(dir, 'userdata') } });
  page = await app.firstWindow();
  await page.waitForSelector('.topbar');
});

test.afterEach(async () => {
  await app?.close();
  await fs.rm(dir, { recursive: true, force: true });
});

test('production renderer blocks inline scripts and other renderers cannot invoke file IPC', async () => {
  const result = await page.evaluate(() => {
    const script = document.createElement('script');
    script.textContent = 'window.inlineSecurityProbe = true';
    document.head.append(script);
    return 'inlineSecurityProbe' in window;
  });
  expect(result).toBe(false);
  expect(await page.evaluate(() => window.api!.exists('/does-not-exist'))).toBe(false);

  const denied = await app.evaluate(async ({ BrowserWindow }, preload) => {
    const other = new BrowserWindow({ show: false, webPreferences: { preload, contextIsolation: true, sandbox: true, nodeIntegration: false } });
    try {
      await other.loadURL('data:text/html,<p>Untrusted document</p>');
      return await other.webContents.executeJavaScript(`window.api.exists('/does-not-exist').then(() => 'allowed', (e) => e.message)`);
    } finally { other.destroy(); }
  }, path.join(root, 'electron/preload.cjs'));
  expect(denied).toContain('Untrusted IPC sender');
});

test('right-click duplicate and delete affect the clicked page without changing the selected page first', async () => {
  const file = path.join(dir, 'three-pages.collage');
  await fs.writeFile(file, serializeStory({ ...emptyStory(), pages: ['First', 'Second', 'Third'].map((text) => ({ ...emptyPage(), elements: [defaultTextEl({ text })] })) }));
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as never;
  }, file);
  await page.getByRole('tab', { name: 'Story' }).click();
  await page.getByTestId('story-open').click();
  const story = page.getByTestId('view-story');
  const pages = story.getByTestId('strip-page');
  await expect(pages).toHaveCount(3);
  await expect(story.getByTestId('page-label')).toContainText('Page 1 of 3');
  await pages.nth(2).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Duplicate page' }).click();
  await expect(pages).toHaveCount(4);
  await expect(story.locator('.story-page .se-text')).toHaveText('Third');
  await pages.first().click();
  await pages.nth(1).click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Delete page' }).click();
  await expect(pages).toHaveCount(3);
  await pages.nth(1).click();
  await expect(story.locator('.story-page .se-text')).toHaveText('Third');
});

test('cancelling video while its save dialog is open prevents encoding and output', async () => {
  const output = path.join(dir, 'cancelled.mp4');
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = (() => new Promise((resolve) => {
      (globalThis as any).releaseVideoDialog = () => resolve({ canceled: false, filePath });
    })) as never;
  }, output);
  await page.evaluate(() => {
    (window as any).pendingVideo = window.api!.makeVideo({ output: '', frames: [new Uint8Array([1])], durations: [1], transition: 'none', transitionSeconds: 0, kenBurns: false, fps: 30 })
      .then(() => 'completed', (e: Error) => e.message);
  });
  await expect.poll(() => app.evaluate(() => typeof (globalThis as any).releaseVideoDialog)).toBe('function');
  await page.evaluate(() => window.api!.cancelVideo());
  await app.evaluate(() => (globalThis as any).releaseVideoDialog());
  expect(await page.evaluate(() => (window as any).pendingVideo)).toContain('cancelled');
  await expect(fs.stat(output)).rejects.toMatchObject({ code: 'ENOENT' });
});

test('closing a freshly generated story before its debounce expires still saves it', async () => {
  const photo = path.join(dir, 'photo.png');
  await fs.writeFile(photo, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==', 'base64'));
  await app.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [filePath] })) as never;
  }, photo);
  await page.getByRole('tab', { name: 'Story' }).click();
  await page.getByRole('button', { name: 'Add photos', exact: true }).click();
  await expect(page.getByTestId('view-story').locator('.tray-item')).toHaveCount(1);
  await page.getByTestId('make-story').click();
  await expect(page.getByTestId('page-strip')).toBeVisible();
  await app.close();
  const saved = JSON.parse(await fs.readFile(path.join(dir, 'userdata/autosave/current.story.json'), 'utf8'));
  expect(saved.pages.length).toBeGreaterThan(0);
});
