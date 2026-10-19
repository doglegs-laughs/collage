import { _electron as electron, expect, test } from '@playwright/test';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyPage, emptyStory, serializeStory, type Story } from '../../src/story/model';

const require = createRequire(import.meta.url);
const electronPath = require('electron') as string;
const root = path.resolve(import.meta.dirname, '..', '..');

const colors = ['#ff0000', '#00ff00', '#0000ff', '#ffff00', '#00ffff', '#ff00ff'];
const makeStory = (lastColor?: string): Story => {
  const story = emptyStory('1:1');
  story.title = 'Cache test';
  story.pages = colors.map((c, i) => emptyPage(i === colors.length - 1 && lastColor ? lastColor : c));
  story.video = { ...story.video, kenBurns: true, transition: 'crossfade' };
  return story;
};

test('saving the same video again reuses the earlier render; an edit renders again', async () => {
  test.setTimeout(240_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vcache-e2e-'));
  const user = path.join(dir, 'user');
  const outputs = ['first.mp4', 'second.mp4', 'third.mp4'].map((n) => path.join(dir, n));
  const app = await electron.launch({ executablePath: electronPath, args: [root, '--no-sandbox'], env: { ...process.env, COLLAGE_NO_SANDBOX: '1', COLLAGE_USER_DATA: user } });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.topbar');
    await page.getByRole('tab', { name: 'Story' }).click();
    const open = async (story: Story) => {
      await app.evaluate(({ BrowserWindow }, json) => {
        BrowserWindow.getAllWindows()[0].webContents.send('project:open-recent', { path: '/cache-test.collage', json });
      }, serializeStory(story));
      await expect(page.getByTestId('view-story').getByTestId('strip-page')).toHaveCount(colors.length);
    };
    const exportTo = async (output: string) => {
      await app.evaluate(({ dialog }, file) => {
        dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as never;
      }, output);
      await page.getByTestId('story-export').click();
      await page.getByTestId('export-video-item').click();
      await page.getByRole('button', { name: '720 px', exact: true }).click();
      const started = Date.now();
      await page.getByTestId('video-go').click();
      await expect(page.getByTestId('export-status')).toContainText('Video saved', { timeout: 120_000 });
      await expect(page.getByTestId('export-status')).toContainText(path.basename(output));
      return Date.now() - started;
    };

    await open(makeStory());
    const first = await exportTo(outputs[0]);
    const second = await exportTo(outputs[1]);
    console.log(`video-cache timings: first ${first} ms, cached ${second} ms`);

    const a = fs.readFileSync(outputs[0]);
    const b = fs.readFileSync(outputs[1]);
    expect(a.length).toBeGreaterThan(1000);
    expect(b.equals(a)).toBe(true);
    expect(second).toBeLessThan(first / 2);
    expect(fs.readdirSync(path.join(user, 'video-cache')).filter((n) => n.endsWith('.mp4'))).toHaveLength(1);

    // Editing one page changes the output (and only that page is rendered again).
    await open(makeStory('#808080'));
    await exportTo(outputs[2]);
    expect(fs.readFileSync(outputs[2]).equals(a)).toBe(false);
    expect(fs.readdirSync(path.join(user, 'video-cache')).filter((n) => n.endsWith('.mp4'))).toHaveLength(2);
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = (() => 1) as never; }).catch(() => {});
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
