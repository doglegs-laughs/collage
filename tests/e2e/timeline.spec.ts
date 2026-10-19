import { _electron as electron, expect, test, type Page } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clicks, findFfprobe, wav } from '../helpers/wav';
import { defaultPhotoEl, emptyPage, emptyStory, serializeStory } from '../../src/story/model';

const require = createRequire(import.meta.url);
const electronPath = require('electron') as string;
const ffmpeg = fs.existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : require('ffmpeg-static') as string;
const ffprobe = findFfprobe();
const root = path.resolve(import.meta.dirname, '..', '..');

test('edits clip lengths against the beats, changes a transition, undoes, and exports the timeline length with the music offset', async () => {
  test.skip(!ffprobe, 'ffprobe was not found (looked at /usr/bin/ffprobe and on PATH); install FFmpeg to run this test.');
  test.setTimeout(150_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'timeline-e2e-'));
  const music = path.join(dir, 'click track.wav');
  const output = path.join(dir, 'timeline.mp4');
  fs.writeFileSync(music, wav(clicks(120, 8, 0.2)));
  const sizes = ['1200x1500', '1500x1200', '1200x1500'];
  const photos = sizes.map((size, i) => {
    const file = path.join(dir, `photo${i + 1}.jpg`);
    execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', `testsrc2=size=${size}`, '-vf', `hue=h=${i * 90}`, '-frames:v', '1', file]);
    const [width, height] = size.split('x').map(Number);
    return { id: `p${i + 1}`, name: `photo${i + 1}.jpg`, path: file, width, height };
  });
  const app = await electron.launch({ executablePath: electronPath, args: [root, '--no-sandbox'], env: { ...process.env, COLLAGE_NO_SANDBOX: '1', COLLAGE_USER_DATA: path.join(dir, 'user') } });
  try {
    const page: Page = await app.firstWindow();
    await page.waitForSelector('.topbar');
    await page.getByRole('tab', { name: 'Story' }).click();
    const story = emptyStory('4:5');
    story.title = 'Timeline test';
    story.photos = photos;
    story.pages = photos.map((p) => ({ ...emptyPage('#222222'), elements: [defaultPhotoEl({ photoId: p.id, x: 0, y: 0, w: 1, h: 1 })] }));
    story.video = { ...story.video, transition: 'crossfade', transitionSeconds: 0.6, kenBurns: false };
    await app.evaluate(({ BrowserWindow }, json) => {
      BrowserWindow.getAllWindows()[0].webContents.send('project:open-recent', { path: '/timeline-test.collage', json });
    }, serializeStory(story));
    const view = page.getByTestId('view-story');
    await expect(view.getByTestId('strip-page')).toHaveCount(3);
    await app.evaluate(({ dialog }, a) => {
      dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [a.music] })) as never;
      dialog.showSaveDialog = (async () => ({ canceled: false, filePath: a.output })) as never;
    }, { music, output });

    // Opening the timeline swaps the page strip for the panel; nothing changes until something is edited.
    await view.getByTestId('story-timeline').click();
    const panel = page.getByTestId('timeline-panel');
    await expect(panel).toBeVisible();
    await expect(view.getByTestId('page-strip')).toHaveCount(0);
    const clips = panel.getByTestId('tl-clip');
    await expect(clips).toHaveCount(3);
    await expect(panel.getByTestId('tl-total')).toHaveAttribute('data-seconds', '9.000');
    await expect(view.getByTestId('story-undo')).toBeDisabled();
    await expect(panel.getByTestId('tl-audio')).toHaveCount(0);

    // Music: choose it, analyze it, see the beats.
    await panel.getByTestId('tl-music').click();
    await expect(panel.getByTestId('tl-audio')).toBeVisible();
    await panel.getByTestId('tl-analyze').click();
    await expect(panel.getByTestId('tl-status')).toContainText('120 BPM');
    expect(Number(await panel.getByTestId('tl-audio').getAttribute('data-beats'))).toBeGreaterThan(10);
    const analysis = await page.evaluate((p) => window.api!.analyzeAudio(p), music);
    expect(analysis.peaks!.length).toBeGreaterThan(100);

    // Zoom so one second is 60 px, then drag the first clip's right edge from 3.0 s to about the beat at 3.7 s (a few px off: it snaps).
    const zoom = panel.getByRole('slider', { name: 'Timeline zoom' });
    await zoom.fill('50');
    const PPS = Number(await zoom.inputValue()); // px per second (beats 0.5 s apart are then about 25 px apart; snapping reaches 8 px)
    await panel.getByTestId('tl-scroll').evaluate((el) => { el.scrollLeft = 0; });
    const target = analysis.beats.find((b) => b > 3.5)!;
    const first = clips.nth(0);
    await expect(first).toHaveAttribute('data-locked', 'false');
    const edge = await first.getByTestId('tl-edge').boundingBox();
    const x0 = edge!.x + edge!.width / 2, y0 = edge!.y + edge!.height / 2;
    await page.mouse.move(x0, y0);
    await page.mouse.down();
    await page.mouse.move(x0 + (target - 3) * PPS + 3, y0, { steps: 8 });
    await expect(panel.getByTestId('tl-snapline')).toBeVisible();
    await page.mouse.up();
    await expect(first).toHaveAttribute('data-locked', 'true');
    expect(Math.abs(Number(await first.getAttribute('data-duration')) - target)).toBeLessThan(0.002); // landed exactly on the beat
    await expect(first.getByTestId('tl-lock')).toBeVisible();
    await expect(clips.nth(1)).toHaveAttribute('data-locked', 'false');
    const total = 9 - 3 + target;
    await expect(panel.getByTestId('tl-total')).toHaveAttribute('data-seconds', (Math.round(total * 1000) / 1000).toFixed(3));

    // A boundary transition: crossfade -> slide.
    const boundary = panel.getByTestId('tl-boundary').first();
    await expect(boundary).toHaveAttribute('data-transition', 'crossfade');
    await boundary.click();
    await expect(boundary).toHaveAttribute('data-transition', 'slide');

    // Undo the transition, then the stretch (each edit is one step); redo both.
    await view.getByTestId('story-undo').click();
    await expect(boundary).toHaveAttribute('data-transition', 'crossfade');
    await view.getByTestId('story-undo').click();
    await expect(first).toHaveAttribute('data-locked', 'false');
    await expect(panel.getByTestId('tl-total')).toHaveAttribute('data-seconds', '9.000');
    await view.getByTestId('story-redo').click();
    await view.getByTestId('story-redo').click();
    await expect(boundary).toHaveAttribute('data-transition', 'slide');
    await expect(first).toHaveAttribute('data-locked', 'true');

    // Typing an exact length on the second clip; clicking a clip selects its page and moves the playhead.
    await clips.nth(1).click();
    await expect(view.getByTestId('page-label')).toContainText('Page 2 of 3');
    await expect(panel.getByTestId('tl-total')).toHaveAttribute('data-time', Number(await clips.nth(1).getAttribute('data-start')).toFixed(3));
    await clips.nth(1).dblclick();
    await panel.getByTestId('tl-duration-input').fill('2.5');
    await panel.getByTestId('tl-duration-input').press('Enter');
    await expect(clips.nth(1)).toHaveAttribute('data-duration', '2.500');
    await expect(clips.nth(1).getByTestId('tl-lock')).toBeVisible();
    await panel.getByTestId('tl-unlock').click();
    await expect(clips.nth(1)).toHaveAttribute('data-duration', '3.000');
    await panel.getByTestId('tl-resync').isDisabled(); // nothing locked from page 2 onward

    // Drag the music so its first beat lands on time 0 (the magnet), then the video starts on the beat.
    const audio = panel.getByTestId('tl-audio');
    const box = (await audio.boundingBox())!;
    await page.mouse.move(box.x + 300, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 300 - (analysis.beats[0] * PPS + 3), box.y + box.height / 2, { steps: 6 });
    await page.mouse.up();
    expect(Math.abs(Number(await audio.getAttribute('data-offset')) - analysis.beats[0])).toBeLessThan(0.002);

    // The playhead scrubs and the preview follows it.
    const ruler = (await panel.getByTestId('tl-ruler').boundingBox())!;
    await page.mouse.click(ruler.x + 4.5 * PPS, ruler.y + 10);
    const pageIds = await clips.evaluateAll((els) => els.map((el) => el.getAttribute('data-page')));
    await expect(panel.getByTestId('tl-preview')).toHaveAttribute('data-clip', pageIds[1]!);
    await page.mouse.click(ruler.x + 7.5 * PPS, ruler.y + 10);
    await expect(panel.getByTestId('tl-preview')).toHaveAttribute('data-clip', pageIds[2]!);
    await page.mouse.click(ruler.x + 5, ruler.y + 10);
    await panel.getByTestId('tl-play').click();
    await expect.poll(async () => Number(await panel.getByTestId('tl-total').getAttribute('data-time')), { timeout: 5000 }).toBeGreaterThan(0.3);
    await panel.getByTestId('tl-play').click();

    await expect(page.locator('.toast.show')).toHaveCount(0); // let the toast go so it does not cover the music row
    await page.screenshot({ path: path.join(root, 'test-results', 'timeline.png') });

    // The video dialog points here and notes the custom timing; the export is as long as the timeline and starts on the first beat.
    const timelineTotal = Number(await panel.getByTestId('tl-total').getAttribute('data-seconds'));
    await page.getByTestId('story-export').click();
    await page.getByTestId('export-video-item').click();
    await expect(page.getByTestId('video-timing-note')).toContainText('Custom timing');
    await page.getByRole('button', { name: '720 px', exact: true }).click();
    await page.getByTestId('video-go').click();
    await expect(page.getByTestId('export-status')).toContainText('Video saved', { timeout: 90_000 });
    const info = JSON.parse(execFileSync(ffprobe!, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', output]).toString());
    expect(Math.abs(Number(info.format.duration) - timelineTotal)).toBeLessThan(0.15);
    expect(info.streams.some((s: { codec_name: string }) => s.codec_name === 'aac')).toBe(true);
    // Without the offset the first 50 ms of the music would be silence (the first click is at 0.2 s in the file).
    const probe = spawnSync(ffmpeg, ['-v', 'info', '-ss', '0', '-t', '0.05', '-i', output, '-vn', '-af', 'volumedetect', '-f', 'null', '-'], { encoding: 'utf8' });
    const max = /max_volume: (-?[\d.]+) dB/.exec(probe.stderr)?.[1];
    expect(Number(max)).toBeGreaterThan(-30);

    // Closing the timeline brings the page strip back, and the edits stay in the story.
    await panel.getByTestId('tl-close').click();
    await expect(view.getByTestId('page-strip')).toBeVisible();
    await expect(panel).toHaveCount(0);
    await view.getByTestId('story-timeline').click();
    await expect(page.getByTestId('timeline-panel').getByTestId('tl-total')).toHaveAttribute('data-seconds', timelineTotal.toFixed(3));
  } finally {
    await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = (() => 1) as never; }).catch(() => {});
    await app.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
