import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clicks, findFfprobe, wav } from '../helpers/wav';
import { emptyPage, emptyStory, serializeStory } from '../../src/story/model';

const require = createRequire(import.meta.url);
const electronPath = require('electron') as string;
const root = path.resolve(import.meta.dirname, '..', '..');
const ffprobe = findFfprobe();

let dir: string;
test.beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'music-e2e-')); });
test.afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

async function launch(): Promise<{ app: ElectronApplication; page: Page }> {
  const app = await electron.launch({ executablePath: electronPath, args: [root, '--no-sandbox'], env: { ...process.env, COLLAGE_NO_SANDBOX: '1', COLLAGE_USER_DATA: path.join(dir, 'user') } });
  const page = await app.firstWindow();
  await page.waitForSelector('.topbar');
  await page.getByRole('tab', { name: 'Story' }).click();
  return { app, page };
}

async function openStory(app: ElectronApplication, page: Page, video: object = {}) {
  const story = emptyStory('1:1');
  story.title = 'Music test';
  story.pages = [emptyPage('#ff0000'), emptyPage('#0000ff')];
  story.video = { ...story.video, transition: 'none', kenBurns: false, ...video };
  await app.evaluate(({ BrowserWindow }, json) => {
    BrowserWindow.getAllWindows()[0].webContents.send('project:open-recent', { path: '/music-test.collage', json });
  }, serializeStory(story));
  await expect(page.getByTestId('view-story').getByTestId('strip-page')).toHaveCount(2);
}

async function openVideoDialog(page: Page) {
  await page.getByTestId('story-export').click();
  await page.getByTestId('export-video-item').click();
}

/** Fire a synthetic external file drag at the window (a File made in the page has no path on disk). */
const dropFile = (page: Page, name: string, type: string, phase: 'over' | 'drop') =>
  page.evaluate(({ name, type, phase }) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(16)], name, { type }));
    const fire = (t: string) => document.querySelector('.topbar')!.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: dt }));
    fire('dragenter');
    fire('dragover');
    if (phase === 'drop') fire('drop');
  }, { name, type, phase });

test('built-in music is picked by mood, exported with the video, and remembered for your own files', async () => {
  test.skip(!ffprobe, 'ffprobe was not found (looked at /usr/bin/ffprobe and on PATH); install FFmpeg to run this test.');
  test.setTimeout(120_000);
  const mine = path.join(dir, 'my song.wav');
  const output = path.join(dir, 'with-music.mp4');
  fs.writeFileSync(mine, wav(clicks(120, 4, 0.2)));
  const { app, page } = await launch();
  try {
    await openStory(app, page);
    await app.evaluate(({ dialog }, a) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [a.mine] })) as never;
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: a.output })) as never;
    }, { mine, output });

    await openVideoDialog(page);
    const dialog = page.getByTestId('video-dialog');
    await dialog.getByRole('button', { name: 'Choose music…' }).click();
    const picker = page.getByTestId('music-picker');
    await expect(picker).toBeVisible();
    await expect(picker).toHaveAttribute('aria-modal', 'true');
    // Escape closes only the picker; the dialog under it stays.
    await page.keyboard.press('Escape');
    await expect(picker).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Choose music…' }).click();

    // The three placeholder tracks, one per mood group.
    for (const [mood, title] of [['Upbeat', 'Placeholder Upbeat'], ['Happy', 'Placeholder Happy'], ['Nostalgic', 'Placeholder Nostalgic']]) {
      const group = picker.getByRole('region', { name: mood });
      await expect(group.getByTestId('music-builtin')).toHaveCount(1);
      await expect(group.getByTestId('music-builtin')).toContainText(title);
    }
    await expect(picker.getByTestId('music-builtin').first()).toContainText('0:12 · 128 BPM');
    await picker.getByRole('button', { name: 'Credits' }).click();
    await expect(picker.getByTestId('music-credits')).toContainText('Placeholder Happy by Collage test tones');

    // Preview toggles; only one row plays at a time.
    const happyPlay = picker.getByRole('button', { name: 'Preview Placeholder Happy' });
    await happyPlay.click();
    await picker.getByRole('button', { name: /Preview Placeholder Upbeat/ }).click();
    await expect(picker.getByRole('button', { name: /Stop preview of/ })).toHaveCount(1);

    await picker.getByRole('button', { name: 'Use Placeholder Happy' }).click();
    await expect(picker).toHaveCount(0);
    await expect(dialog.locator('.music-name')).toHaveText('Placeholder Happy');

    // Export a short video with it.
    await dialog.getByRole('button', { name: '720 px', exact: true }).click();
    await page.getByTestId('video-go').click();
    await expect(page.getByTestId('export-status')).toContainText('Video saved', { timeout: 90_000 });
    const info = JSON.parse(execFileSync(ffprobe!, ['-v', 'error', '-show_streams', '-of', 'json', output]).toString());
    expect(info.streams.some((s: { codec_type: string }) => s.codec_type === 'audio')).toBe(true);

    // Your own file goes to Recent (via the native dialog), is highlighted, and can be removed.
    await openVideoDialog(page);
    await dialog.getByRole('button', { name: 'Change…' }).click();
    await expect(picker.getByTestId('music-recent')).toHaveCount(0);
    await expect(picker.getByTestId('music-builtin').filter({ hasText: 'Placeholder Happy' })).toHaveAttribute('aria-current', 'true');
    await picker.getByTestId('music-browse').click();
    await expect(picker).toHaveCount(0);
    await expect(dialog.locator('.music-name')).toHaveText('my song.wav');
    await dialog.getByRole('button', { name: 'Change…' }).click();
    const recent = picker.getByTestId('music-recent');
    await expect(recent).toHaveCount(1);
    await expect(recent).toContainText('my song.wav');
    await expect(recent).toHaveAttribute('aria-current', 'true');
    await recent.getByRole('button', { name: /Remove my song.wav/ }).click();
    await expect(recent).toHaveCount(0);

    // "No music" clears it.
    await picker.getByTestId('music-none').click();
    await expect(dialog.locator('.music-name')).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Choose music…' })).toBeVisible();

    // A recent file that no longer exists is not offered.
    await dialog.getByRole('button', { name: 'Choose music…' }).click();
    await picker.getByTestId('music-browse').click();
    fs.rmSync(mine);
    await dialog.getByRole('button', { name: 'Change…' }).click();
    await expect(picker.getByTestId('music-builtin')).toHaveCount(3);
    await expect(picker.getByTestId('music-recent')).toHaveCount(0);
  } finally {
    await app.close();
  }
});

test('built-in music is found again by id when the saved path is stale', async () => {
  const { app, page } = await launch();
  try {
    await openStory(app, page, { audioPath: '/old/Collage.app/Contents/Resources/music/placeholder-nostalgic.m4a', audioBuiltin: 'placeholder-nostalgic' });
    await openVideoDialog(page);
    const name = page.getByTestId('video-dialog').locator('.music-name');
    await expect(name).toHaveText('Placeholder Nostalgic');
    const resolved = (await name.getAttribute('title'))!;
    expect(resolved).not.toContain('/old/');
    expect(fs.existsSync(resolved)).toBe(true);
  } finally {
    await app.close();
  }
});

test('dropping a song on the Story tab needs a real file path; other tabs stay photos-only', async () => {
  const { app, page } = await launch();
  try {
    await openStory(app, page);
    await dropFile(page, 'party.mp3', 'audio/mpeg', 'over');
    await expect(page.locator('.drop-overlay')).toHaveText('Drop photos or music');
    // A File made inside the page has no path, so the app cannot use it as music (a real drop from the OS does).
    await dropFile(page, 'party.mp3', 'audio/mpeg', 'drop');
    await expect(page.locator('.toast.error')).toContainText('Could not find "party.mp3"');
    await expect(page.getByTestId('view-story').getByTestId('story-undo')).toBeDisabled();

    await page.getByRole('tab', { name: 'Collage' }).click();
    await dropFile(page, 'party.mp3', 'audio/mpeg', 'over');
    await expect(page.locator('.drop-overlay')).toHaveText('Drop photos to add them');
  } finally {
    await app.close();
  }
});
