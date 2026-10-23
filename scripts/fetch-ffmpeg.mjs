// Downloads macOS ffmpeg binaries (same releases ffmpeg-static uses) into resources/ffmpeg/darwin-<arch>/ffmpeg.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { chmod, mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(path.join(root, 'node_modules/ffmpeg-static/package.json'), 'utf8'));
const release = process.env.FFMPEG_BINARY_RELEASE || pkg['ffmpeg-static']['binary-release-tag'];
const base = process.env.FFMPEG_BINARIES_URL || 'https://github.com/eugeneware/ffmpeg-static/releases/download';
const archs = ['arm64'];

// SHA-256 of each downloaded .gz, per release tag and platform. A different release or a mirror (FFMPEG_BINARIES_URL) must still match.
// To bump ffmpeg-static: download the new .gz files once from the official release and add their hashes here.
const SHA256 = {
  'b6.1.1': { 'darwin-arm64': '8923876afa8db5585022d7860ec7e589af192f441c56793971276d450ed3bbfa' },
};

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
  const expected = SHA256[release]?.[`darwin-${arch}`];
  if (!expected) throw new Error(`No pinned SHA-256 for ffmpeg ${release} darwin-${arch}; add it to scripts/fetch-ffmpeg.mjs`);
  console.log(`darwin-${arch}: ${url}`);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok || !res.body) throw new Error(`Download failed for darwin-${arch}: HTTP ${res.status}`);
  const tmp = `${target}.part`;
  try {
    const hash = createHash('sha256');
    const hasher = new Transform({ transform(chunk, _encoding, done) { hash.update(chunk); done(null, chunk); } });
    await pipeline(Readable.fromWeb(res.body), hasher, createGunzip(), createWriteStream(tmp));
    const actual = hash.digest('hex');
    if (actual !== expected) throw new Error(`Checksum mismatch for darwin-${arch}: expected ${expected}, got ${actual}`);
    await chmod(tmp, 0o755);
    await rename(tmp, target);
  } catch (error) {
    await rm(tmp, { force: true });
    throw error;
  }
  console.log(`darwin-${arch}: ${((await stat(target)).size / 1e6).toFixed(1)} MB`);
}

for (const arch of archs) await download(arch);
