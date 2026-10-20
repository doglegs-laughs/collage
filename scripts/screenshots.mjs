// Regenerates the README screenshots from the real, built app.
//   npm run build
//   xvfb-run -a node scripts/screenshots.mjs <photos-folder> [out-folder]
// <photos-folder> holds ~14 JPEGs (landscape, portrait, one ~3:1 panorama). Default out-folder: docs/screenshots.
// Writes story-*.jpg, timeline.jpg, layout-picker.jpg, photo-preview.jpg, collage-*.jpg, borders.jpg and icon.png.
// Set SHOTS_DEBUG=<dir> to also dump every Story page of both styles for inspection.
import { _electron as electron } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electronPath = require('electron');
const ffmpeg = fs.existsSync('/usr/bin/ffmpeg') ? '/usr/bin/ffmpeg' : require('ffmpeg-static');
const root = path.resolve(import.meta.dirname, '..');
const photoDir = path.resolve(process.argv[2] ?? '');
const outDir = path.resolve(process.argv[3] ?? path.join(root, 'docs', 'screenshots'));
if (!process.argv[2] || !fs.existsSync(photoDir)) {
  console.error('usage: node scripts/screenshots.mjs <photos-folder> [out-folder]');
  process.exit(1);
}
const photos = fs.readdirSync(photoDir).filter((f) => /\.jpe?g$/i.test(f)).sort().map((f) => path.join(photoDir, f));
fs.mkdirSync(outDir, { recursive: true });

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'collage-shots-'));
const app = await electron.launch({
  executablePath: electronPath,
  args: [root, '--no-sandbox'],
  env: { ...process.env, COLLAGE_NO_SANDBOX: '1', COLLAGE_USER_DATA: userData },
});
const page = await app.firstWindow();
await app.evaluate(({ nativeTheme, BrowserWindow }) => {
  nativeTheme.themeSource = 'light';
  const w = BrowserWindow.getAllWindows()[0];
  w.setContentSize(1440, 900);
  w.center();
});
await page.waitForSelector('.topbar');
await page.setViewportSize({ width: 1440, height: 900 });
await page.emulateMedia({ colorScheme: 'light' });
await app.evaluate(({ dialog }, files) => {
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
  dialog.showMessageBoxSync = () => 1;
}, photos);

const story = page.getByTestId('view-story');
const sleep = (ms) => page.waitForTimeout(ms);

/** Wait until every image in the given scope has decoded, web fonts are ready and layout has settled. */
async function settle(scope = 'body') {
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction((s) => {
    const imgs = [...document.querySelectorAll(`${s} img`)].filter((i) => i.getBoundingClientRect().width > 0);
    return imgs.every((i) => i.complete && i.naturalWidth > 0);
  }, scope, { timeout: 60_000 });
  await sleep(700);
}
/** Park the pointer somewhere neutral and drop focus rings/selection. */
async function tidy() {
  await page.mouse.move(1430, 890);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    document.querySelectorAll('.sidebar, .story-insp').forEach((el) => { el.scrollTop = 0; });
  });
  await sleep(250);
}
async function shot(name, opts = {}) {
  await tidy();
  const png = path.join(outDir, name);
  await page.screenshot({ path: png });
  console.log('saved', name);
}
const clickStrip = async (i) => {
  await story.getByTestId('strip-page').nth(i).click();
  await settle('[data-testid="view-story"] .story-stage');
};
const deselect = async () => {
  await page.keyboard.press('Escape');
  await page.mouse.click(1000, 880); // empty canvas margin
  await page.keyboard.press('Escape');
};

// ---- Story ----------------------------------------------------------------
await page.getByRole('tab', { name: 'Story' }).click();
await page.getByRole('button', { name: 'Add photos' }).click();
await story.locator('.tray-item').nth(photos.length - 1).waitFor({ timeout: 90_000 });
await settle('[data-testid="view-story"] .story-tray');
await story.getByTestId('story-title').fill('Title');
await story.getByTestId('story-subtitle').fill('June 2026');
await page.getByRole('button', { name: 'Clean', exact: true }).click();
await shot('story-start.png');

await story.getByTestId('make-story').click();
await story.getByTestId('page-strip').waitFor({ timeout: 90_000 });
await sleep(1500);
await settle();

async function dumpPages(tag) {
  const dir = process.env.SHOTS_DEBUG;
  if (!dir) return;
  fs.mkdirSync(dir, { recursive: true });
  const n = await story.getByTestId('strip-page').count();
  for (let i = 0; i < n; i++) {
    await clickStrip(i);
    await story.getByTestId('layout-name').textContent().then((t) => console.log(tag, i + 1, t));
    await page.screenshot({ path: path.join(dir, `${tag}-${String(i + 1).padStart(2, '0')}.png`) });
  }
}
await dumpPages('clean');

await clickStrip(0);
await deselect();
await shot('story-clean.png');

await gotoPage(/^Panorama spread/);
await deselect();
await shot('story-spread.png');

// ---- Story: timeline ----------------------------------------------------------
// A 60 s, 120 BPM kick/hat/pad track so the waveform and beat marks read clearly.
const music = path.join(userData, 'music.wav');
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i',
  "aevalsrc='0.8*sin(2*PI*55*t)*exp(-14*mod(t,0.5))+0.25*sin(2*PI*7000*t)*exp(-60*mod(t+0.25,0.5))+0.12*sin(2*PI*220*t)*(0.6+0.4*sin(2*PI*t/8))':s=44100:d=60", music]);
await app.evaluate(({ dialog }, file) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] }); }, music);
await clickStrip(0);
await deselect();
await story.getByTestId('story-timeline').click();
const tl = page.getByTestId('timeline-panel');
await tl.getByTestId('tl-music').click();
await tl.getByTestId('tl-analyze').click();
await tl.getByTestId('tl-status').filter({ hasText: 'BPM' }).waitFor({ timeout: 60_000 });
await tl.getByTestId('tl-scroll').evaluate((el) => { el.scrollLeft = 0; });
// Stretch the second page by about two beats so a locked clip shows.
const edge = await tl.getByTestId('tl-clip').nth(1).getByTestId('tl-edge').boundingBox();
await page.mouse.move(edge.x + edge.width / 2, edge.y + edge.height / 2);
await page.mouse.down();
await page.mouse.move(edge.x + edge.width / 2 + 60, edge.y + edge.height / 2, { steps: 8 });
await page.mouse.up();
await settle();
await shot('timeline.png');
await story.getByTestId('story-timeline').click();
await story.getByTestId('page-strip').waitFor();

// Stylized: switch style in the inspector (confirms the re-create).
await page.getByRole('button', { name: 'Stylized', exact: true }).click();
await page.getByRole('button', { name: 'Re-create' }).click();
await sleep(1500);
await settle();
await dumpPages('stylized');

/** Click through the page strip until the current layout name matches; shuffle (new random story) and retry if it is missing. */
async function gotoPage(re) {
  for (let attempt = 0; attempt < 8; attempt++) {
    const n = await story.getByTestId('strip-page').count();
    for (let i = 0; i < n; i++) {
      await clickStrip(i);
      if (re.test((await story.getByTestId('layout-name').textContent()) ?? '')) return;
    }
    await story.getByTestId('story-shuffle').click();
    await sleep(1500);
    await settle();
  }
  throw new Error(`no page matching ${re}`);
}
const pick = (names) => photos.filter((f) => names.some((n) => path.basename(f).includes(n)));
const stubPick = (files) => app.evaluate(({ dialog }, f) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: f }); }, files);

await gotoPage(/^Polaroid on photo/);
await deselect();
await shot('story-stylized.png');

// Layout picker open on a stack page, finish chips visible.
await gotoPage(/^Stack 2/);
await deselect();
await story.getByTestId('layout-button').click();
await page.getByTestId('layout-popover').waitFor();
await page.getByTestId('layout-popover').locator('[data-finish-chip][data-finish="mat"]').click();
await settle('[data-testid="layout-popover"]');
await settle('[data-testid="view-story"] .story-stage');
await shot('layout-picker.png');
await page.keyboard.press('Escape');
await sleep(300);

// Large photo preview.
await story.locator('.tray-item').nth(2).locator('.tray-pick').dblclick();
await page.getByTestId('photo-preview').waitFor();
await page.waitForFunction(() => {
  const img = document.querySelector('.lightbox-img.ready');
  return !!img && img.naturalWidth > 0;
});
await sleep(800);
await shot('photo-preview.png');
await page.getByRole('button', { name: 'Close preview' }).click();
await page.getByTestId('photo-preview').waitFor({ state: 'detached' });
await sleep(300);

// ---- Collage: grid ----------------------------------------------------------
await page.getByRole('tab', { name: 'Collage' }).click();
await page.getByTestId('collage-mode').getByRole('button', { name: 'Grid' }).click();
await page.getByTestId('collage-file-input').setInputFiles(pick(['03-pier', '06-cliffs', '04-valley', '11-coast']));
await page.getByTestId('slot-filled').nth(3).waitFor({ timeout: 60_000 });
await page.getByRole('slider', { name: 'White border width' }).evaluate((el) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  set.call(el, String(Math.round(Number(el.max) * 0.35)));
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
});
await settle('[data-testid="view-collage"]');
await shot('collage-grid.png');

// ---- Collage: layout ----------------------------------------------------------
await page.getByTestId('collage-mode').getByRole('button', { name: 'Layout' }).click();
const layout = page.getByTestId('view-collage-layout');
// The photo library is shared with Story, so choose three of its photos in order.
await layout.getByRole('button', { name: 'None', exact: true }).click();
for (const n of ['07-river', '01-fjord', '09-snow']) await layout.locator('.tray-pick').nth(photos.findIndex((f) => f.includes(n))).click();
const picker = page.getByTestId('layout-picker');
await picker.locator('[data-option-id="stack-3"]').click();
await picker.locator('[data-finish-chip][data-finish="mat"]').click();
await settle('[data-testid="view-collage-layout"] .story-stage');
await settle('[data-testid="layout-picker"]');
await shot('collage-layout.png');

// ---- Borders ------------------------------------------------------------------
await page.getByRole('tab', { name: 'Borders' }).click();
const borders = page.getByTestId('view-borders');
// Library is shared with the other tabs: pick three photos, coast first.
await borders.getByRole('button', { name: 'None', exact: true }).click();
for (const n of ['11-coast', '04-valley', '02-waterfall']) await borders.locator('.tray-pick').nth(photos.findIndex((f) => f.includes(n))).click();
await page.getByRole('group', { name: 'Canvas shape' }).getByRole('button', { name: '4:5' }).click();
await page.getByRole('group', { name: 'Finish' }).getByRole('button', { name: 'Print mat' }).click();
await settle('[data-testid="view-borders"]');
await shot('borders.png');

await app.evaluate(({ dialog }) => { dialog.showMessageBoxSync = () => 1; });
await app.close().catch(() => {});
fs.rmSync(userData, { recursive: true, force: true });

// ---- Icon + JPEG output (photo-heavy PNGs are 1-2 MB; q85-ish JPEG stays well under 700 KB) ----
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', path.join(root, 'build', 'icon.png'), '-vf', 'scale=256:256:flags=lanczos', path.join(outDir, 'icon.png')]);
for (const f of fs.readdirSync(outDir).filter((f) => f.endsWith('.png') && f !== 'icon.png')) {
  const file = path.join(outDir, f);
  const jpg = file.replace(/\.png$/, '.jpg');
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-i', file, '-vf', 'scale=1440:-1:flags=lanczos', '-q:v', '2', '-pix_fmt', 'yuvj420p', jpg]);
  fs.rmSync(file);
  console.log(path.basename(jpg), `${Math.round(fs.statSync(jpg).size / 1024)} KB`);
}
