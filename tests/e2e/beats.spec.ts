import { _electron as electron, expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptyPage, emptyStory, serializeStory } from '../../src/story/model';

const require = createRequire(import.meta.url);
const electronPath = require('electron') as string;
const ffmpeg = fs.existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : require('ffmpeg-static') as string;
const root = path.resolve(import.meta.dirname, '..', '..');

function writeMusic(file: string, silent = false) {
  const rate = 11025;
  const samples = new Int16Array(rate * 8);
  if (!silent) for (let t = 0.2; t < 8; t += 0.5) {
    for (let i = 0; i < rate * 0.07; i++) {
      samples[Math.floor(t * rate) + i] = Math.round(26000 * Math.sin(2 * Math.PI * 90 * i / rate) * Math.exp(-i / (rate * 0.015)));
    }
  }
  const out = Buffer.alloc(44 + samples.byteLength);
  out.write('RIFF'); out.writeUInt32LE(out.length - 8, 4); out.write('WAVEfmt ', 8);
  out.writeUInt32LE(16, 16); out.writeUInt16LE(1, 20); out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24); out.writeUInt32LE(rate * 2, 28); out.writeUInt16LE(2, 32); out.writeUInt16LE(16, 34);
  out.write('data', 36); out.writeUInt32LE(samples.byteLength, 40);
  Buffer.from(samples.buffer).copy(out, 44);
  fs.writeFileSync(file, out);
}

test('detects music beats, changes pace, and exports frame-aligned photo changes with music', async () => {
  test.setTimeout(120_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'beat-e2e-'));
  const music = path.join(dir, 'beat track.wav');
  const silent = path.join(dir, 'silence.wav');
  const output = path.join(dir, 'beats.mp4');
  writeMusic(music); writeMusic(silent, true);
  const app = await electron.launch({ executablePath: electronPath, args: [root, '--no-sandbox'], env: { ...process.env, COLLAGE_NO_SANDBOX: '1', COLLAGE_USER_DATA: path.join(dir, 'user') } });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.topbar');
    await page.getByRole('tab', { name: 'Story' }).click();
    const story = emptyStory('1:1');
    story.title = 'Beat test';
    story.pages = [emptyPage('#ff0000'), { ...emptyPage('#ff00ff'), hidden: true }, emptyPage('#00ff00'), emptyPage('#0000ff')];
    story.pages[0].duration = 9; // Beat sync must override this manual duration.
    await app.evaluate(({ BrowserWindow }, json) => {
      BrowserWindow.getAllWindows()[0].webContents.send('project:open-recent', { path: '/beat-test.collage', json });
    }, serializeStory(story));
    await expect(page.getByTestId('view-story').getByTestId('strip-page')).toHaveCount(4);
    await app.evaluate(({ dialog }, a) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [a.music] })) as never;
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: a.output })) as never;
    }, { music, output });

    await page.getByTestId('story-export').click();
    await page.getByTestId('export-video-item').click();
    const sync = page.getByRole('checkbox', { name: 'Sync photo changes to beats' });
    await expect(sync).toBeDisabled();
    await page.getByRole('button', { name: 'Choose music…' }).click();
    await sync.check();
    await expect(page.getByTestId('beat-status')).toContainText('120 BPM');
    await expect(page.getByRole('checkbox', { name: 'Fit to music length' })).toBeDisabled();
    await page.getByRole('group', { name: 'Beats per page', exact: true }).getByRole('button', { name: '2 beats', exact: true }).click();
    await expect(page.getByTestId('beat-status')).toContainText('3.2 s video');
    await page.getByRole('group', { name: 'Transition', exact: true }).getByRole('button', { name: 'None', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Slow zoom (Ken Burns)' }).uncheck();
    await page.getByRole('button', { name: '720 px', exact: true }).click();
    await page.getByTestId('video-dialog').screenshot({ path: path.join(root, 'test-results', 'beat-sync-dialog.png') });
    await page.getByTestId('video-go').click();
    await expect(page.getByTestId('export-status')).toContainText('Video saved', { timeout: 60_000 });
    const info = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', output]).toString());
    expect(Number(info.format.duration)).toBeCloseTo(3.2, 1);
    expect(info.streams.some((s: { codec_name: string }) => s.codec_name === 'aac')).toBe(true);
    for (const [time, channel] of [[0.9, 0], [1.4, 1], [2.4, 2]]) {
      const pixel = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(time), '-i', output, '-frames:v', '1', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', 'pipe:1']);
      expect(pixel[channel]).toBeGreaterThan(200);
      expect(pixel[(channel + 1) % 3]).toBeLessThan(30);
    }

    // Settings survive reopening; analysis errors block beat export without trapping the user.
    await page.getByTestId('story-export').click();
    await page.getByTestId('export-video-item').click();
    await expect(sync).toBeChecked();
    await expect(page.getByRole('button', { name: '2 beats', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as never;
    }, silent);
    await page.getByRole('button', { name: 'Change…', exact: true }).click();
    await expect(page.getByTestId('beat-status')).toContainText('No clear beats');
    await expect(page.getByTestId('video-go')).toBeDisabled();
    await sync.uncheck();
    await expect(page.getByTestId('video-go')).toBeEnabled();
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = (() => 1) as never; }).catch(() => {});
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
