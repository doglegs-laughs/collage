const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);
const HEIC = /\.(heic|heif)$/i;

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function toBuffer(data) {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
}

// Writes next to the target then renames, so a crash never leaves a half-written file.
// Without overwrite, an existing target is never replaced (hard link fails with EEXIST).
async function atomicWrite(target, data, { overwrite = true } = {}) {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID().slice(0, 8)}.tmp`);
  await fs.writeFile(tmp, toBuffer(data));
  try {
    if (overwrite) {
      await fs.rename(tmp, target);
      return;
    }
    try {
      await fs.link(tmp, target);
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`${path.basename(target)} already exists`);
      if (await exists(target)) throw new Error(`${path.basename(target)} already exists`);
      await fs.rename(tmp, target);
      return;
    }
    await fs.unlink(tmp);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
}

async function readImage(file) {
  if (!HEIC.test(file)) return fs.readFile(file);
  if (process.platform !== 'darwin') {
    throw new Error(`${path.basename(file)} is HEIC, which can only be opened on macOS. Convert it to JPEG first.`);
  }
  const tmp = path.join(os.tmpdir(), `collage-${randomUUID()}.jpg`);
  try {
    await run('sips', ['-s', 'format', 'jpeg', file, '--out', tmp]);
    return await fs.readFile(tmp);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

module.exports = { atomicWrite, readImage, exists };
