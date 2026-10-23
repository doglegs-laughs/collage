const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const run = promisify(execFile);

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

const LINK_UNSUPPORTED = ['ENOTSUP', 'EOPNOTSUPP', 'EXDEV', 'ENOSYS'];
// EPERM means "no hard links" on Windows/FAT-style filesystems, but on POSIX it is a real permission error.
function linkUnsupported(error) {
  return LINK_UNSUPPORTED.includes(error.code) || (error.code === 'EPERM' && process.platform === 'win32');
}

// Writes next to the target then renames, so a crash never leaves a half-written file.
// Without overwrite, an existing target is never replaced. Filesystems without
// hard links use an exclusive copy instead (which cannot provide atomic visibility).
async function atomicWrite(target, data, options = {}) {
  const buffer = toBuffer(data);
  return atomicPlace(target, (tmp) => fs.writeFile(tmp, buffer), options);
}

// Like atomicWrite, for a file that is already on disk (large videos are never read into memory).
// The target always gets its own bytes, never a link to `source`.
function atomicCopy(source, target, options = {}) {
  return atomicPlace(target, (tmp) => fs.copyFile(source, tmp), options);
}

async function atomicPlace(target, fill, { overwrite = true, signal } = {}) {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID().slice(0, 8)}.tmp`);
  try {
    signal?.throwIfAborted();
    await fill(tmp);
    signal?.throwIfAborted();
    if (overwrite) {
      await fs.rename(tmp, target);
      return;
    }
    try {
      await fs.link(tmp, target);
    } catch (error) {
      if (error.code === 'EEXIST') throw Object.assign(new Error(`${path.basename(target)} already exists`), { code: 'EEXIST' });
      if (!linkUnsupported(error)) throw error;
      try {
        await fs.copyFile(tmp, target, constants.COPYFILE_EXCL);
      } catch (copyError) {
        if (copyError.code === 'EEXIST') throw Object.assign(new Error(`${path.basename(target)} already exists`), { code: 'EEXIST' });
        // The exclusive copy created the target, so a failure part-way leaves a truncated file behind.
        await fs.rm(target, { force: true });
        throw copyError;
      }
    }
    await fs.unlink(tmp);
  } catch (error) {
    await fs.rm(tmp, { force: true });
    throw error;
  }
}

const HEIC_BRANDS = ['heic', 'heix', 'mif1', 'msf1'];
/** 'heic' / 'tiff' when the bytes (not the file name) say Chromium cannot decode them, else null. */
function convertibleKind(buf) {
  if (buf.length >= 12 && buf.toString('latin1', 4, 8) === 'ftyp' && HEIC_BRANDS.includes(buf.toString('latin1', 8, 12))) return 'heic';
  if (buf.length >= 4 && ((buf[0] === 0x49 && buf[1] === 0x49 && buf[2] === 0x2a && buf[3] === 0) || (buf[0] === 0x4d && buf[1] === 0x4d && buf[2] === 0 && buf[3] === 0x2a))) return 'tiff';
  return null;
}

const MAX_IMAGE_BYTES = 200 * 1024 * 1024;
const SIPS_TIMEOUT_MS = 30_000;
const SIPS_MAX_BUFFER = 1024 * 1024;

// HEIC and TIFF cannot be decoded by Chromium; macOS converts them to JPEG with sips.
// The path may come from a project file, so only a regular file of a sane size is read (not /dev/zero or a FIFO).
async function readImage(file) {
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
  let raw;
  try {
    const st = await handle.stat();
    if (!st.isFile()) throw new Error(`${path.basename(file)} is not a regular file`);
    if (st.size > MAX_IMAGE_BYTES) throw new Error(`${path.basename(file)} is too large to open`);
    raw = await handle.readFile();
  } finally {
    await handle.close();
  }
  const kind = convertibleKind(raw);
  if (!kind) return raw;
  if (process.platform !== 'darwin') {
    throw new Error(`${path.basename(file)} is ${kind === 'heic' ? 'HEIC' : 'TIFF'}, which can only be opened on macOS. Convert it to JPEG first.`);
  }
  const tmp = path.join(os.tmpdir(), `collage-${randomUUID()}.jpg`);
  try {
    await run('sips', ['-s', 'format', 'jpeg', file, '--out', tmp], { timeout: SIPS_TIMEOUT_MS, maxBuffer: SIPS_MAX_BUFFER });
    const out = await fs.stat(tmp);
    if (out.size > MAX_IMAGE_BYTES) throw new Error(`${path.basename(file)} is too large to open`);
    return await fs.readFile(tmp);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

const UNSAFE_NAME = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * Writes photos that have no file of their own into `<project name> Photos/` beside the project file and returns the
 * project JSON with each of those photos' `path` set to the relative path (forward slashes).
 * Existing identical photos are reused; different bytes get a fresh name so older project snapshots stay valid.
 */
async function writeSidecar(projectPath, jsonText, items) {
  const project = JSON.parse(jsonText);
  const dir = path.dirname(projectPath);
  const folder = `${path.basename(projectPath, path.extname(projectPath))} Photos`;
  await fs.mkdir(path.join(dir, folder), { recursive: true });
  const used = new Set();
  const relById = new Map();
  for (const item of items) {
    const original = path.basename(String(item.name || 'photo.jpg')).replace(UNSAFE_NAME, '_').replace(/^\.+/, '_') || 'photo.jpg';
    const ext = path.extname(original);
    let name;
    for (let n = 1; ; n++) {
      name = n === 1 ? original : `${path.basename(original, ext)} ${n}${ext}`;
      if (used.has(name.toLowerCase())) continue;
      const target = path.join(dir, folder, name);
      try {
        const existing = await fs.readFile(target);
        if (existing.equals(toBuffer(item.data))) break;
        continue;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      try { await atomicWrite(target, item.data, { overwrite: false }); break; }
      catch (error) { if (error.code !== 'EEXIST') throw error; }
    }
    used.add(name.toLowerCase());
    relById.set(item.id, `${folder}/${name}`);
  }
  if (Array.isArray(project.photos)) {
    for (const p of project.photos) if (relById.has(p.id)) p.path = relById.get(p.id);
  }
  return JSON.stringify(project, null, 2);
}

module.exports = { MAX_IMAGE_BYTES, atomicWrite, atomicCopy, readImage, exists, convertibleKind, writeSidecar };
