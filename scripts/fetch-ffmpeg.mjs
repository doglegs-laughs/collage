// Downloads macOS ffmpeg binaries (same releases ffmpeg-static uses) into resources/ffmpeg/darwin-<arch>/ffmpeg.
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'node_modules/ffmpeg-static/package.json'), 'utf8'));
const release = process.env.FFMPEG_BINARY_RELEASE || pkg['ffmpeg-static']['binary-release-tag'];
const base = process.env.FFMPEG_BINARIES_URL || 'https://github.com/eugeneware/ffmpeg-static/releases/download';
const archs = ['arm64'];

async function download(arch) {
  const dir = path.join(root, 'resources/ffmpeg', `darwin-${arch}`);
  const target = path.join(dir, 'ffmpeg');
  try {
    if ((await stat(target)).size > 1_000_000) {
      console.log(`darwin-${arch}: already present`);
      return;
    }
  } catch { /* download below */ }
  await mkdir(dir, { recursive: true });
  const url = `${base}/${release}/ffmpeg-darwin-${arch}.gz`;
  console.log(`darwin-${arch}: ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed for darwin-${arch}: HTTP ${res.status}`);
  const tmp = `${target}.part`;
  try {
    await pipeline(Readable.fromWeb(res.body), createGunzip(), createWriteStream(tmp));
    await chmod(tmp, 0o755);
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
  console.log(`darwin-${arch}: ${((await stat(target)).size / 1e6).toFixed(1)} MB`);
}

for (const arch of archs) await download(arch);
