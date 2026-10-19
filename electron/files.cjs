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

// Writes next to the target then renames, so a crash never leaves a half-written file.
// Without overwrite, an existing target is never replaced. Filesystems without
// hard links use an exclusive copy instead (which cannot provide atomic visibility).
async function atomicWrite(target, data, { overwrite = true } = {}) {
  const tmp = path.join(path.dirname(target), `.${path.basename(target)}.${randomUUID().slice(0, 8)}.tmp`);
  try {
    await fs.writeFile(tmp, toBuffer(data));
    if (overwrite) {
      await fs.rename(tmp, target);
      return;
    }
    try {
      await fs.link(tmp, target);
    } catch (error) {
      if (error.code === 'EEXIST') throw new Error(`${path.basename(target)} already exists`);
      if (!['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'EXDEV', 'ENOSYS'].includes(error.code)) throw error;
      try {
        await fs.copyFile(tmp, target, constants.COPYFILE_EXCL);
      } catch (copyError) {
        if (copyError.code === 'EEXIST') throw new Error(`${path.basename(target)} already exists`);
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

// HEIC and TIFF cannot be decoded by Chromium; macOS converts them to JPEG with sips.
async function readImage(file) {
  const raw = await fs.readFile(file);
  const kind = convertibleKind(raw);
  if (!kind) return raw;
  if (process.platform !== 'darwin') {
    throw new Error(`${path.basename(file)} is ${kind === 'heic' ? 'HEIC' : 'TIFF'}, which can only be opened on macOS. Convert it to JPEG first.`);
  }
  const tmp = path.join(os.tmpdir(), `collage-${randomUUID()}.jpg`);
  try {
    await run('sips', ['-s', 'format', 'jpeg', file, '--out', tmp]);
    return await fs.readFile(tmp);
  } finally {
    await fs.rm(tmp, { force: true });
  }
}

const UNSAFE_NAME = /[\\/:*?"<>|\u0000-\u001f]/g;

/**
 * Writes photos that have no file of their own into `<project name> Photos/` beside the project file and returns the
 * project JSON with each of those photos' `path` set to the relative path (forward slashes). Existing files are replaced.
 */
async function writeSidecar(projectPath, jsonText, items) {
  const dir = path.dirname(projectPath);
  const folder = `${path.basename(projectPath, path.extname(projectPath))} Photos`;
  await fs.mkdir(path.join(dir, folder), { recursive: true });
  const project = JSON.parse(jsonText);
  const used = new Set();
  const relById = new Map();
  for (const item of items) {
    let name = path.basename(String(item.name || 'photo.jpg')).replace(UNSAFE_NAME, '_').replace(/^\.+/, '_') || 'photo.jpg';
    for (let n = 2; used.has(name.toLowerCase()); n++) {
      const ext = path.extname(name);
      name = `${path.basename(name, ext)} ${n}${ext}`;
    }
    used.add(name.toLowerCase());
    await atomicWrite(path.join(dir, folder, name), item.data);
    relById.set(item.id, `${folder}/${name}`);
  }
  if (Array.isArray(project.photos)) {
    for (const p of project.photos) if (relById.has(p.id)) p.path = relById.get(p.id);
  }
  return JSON.stringify(project, null, 2);
}

module.exports = { atomicWrite, readImage, exists, convertibleKind, writeSidecar };
