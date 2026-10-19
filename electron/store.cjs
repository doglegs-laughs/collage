const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { atomicWrite } = require('./files.cjs');

const MAX_RECENT_STORIES = 10;
const UNSAFE = /[\\/:*?"<>|\u0000-\u001f]/g;

/** Put `file` first in the list of recent project paths (no duplicates, at most `max`). */
function addRecent(list, file, max = MAX_RECENT_STORIES) {
  return [file, ...list.filter((p) => p !== file)].slice(0, max);
}
function removeRecent(list, file) {
  return list.filter((p) => p !== file);
}

const recentsFile = (dir) => path.join(dir, 'recent-stories.json');
async function loadRecents(dir) {
  try {
    const list = JSON.parse(await fs.readFile(recentsFile(dir), 'utf8'));
    return Array.isArray(list) ? list.filter((p) => typeof p === 'string').slice(0, MAX_RECENT_STORIES) : [];
  } catch {
    return [];
  }
}
async function saveRecents(dir, list) {
  await fs.mkdir(dir, { recursive: true });
  await atomicWrite(recentsFile(dir), Buffer.from(JSON.stringify(list, null, 2), 'utf8'));
}
/** Recent paths with whether each file still exists. */
async function describeRecents(dir) {
  const list = await loadRecents(dir);
  return list.map((p) => ({ path: p, name: path.basename(p), exists: fsSync.existsSync(p) }));
}

const autosaveFile = (dir) => path.join(dir, 'autosave', 'current.story.json');
const autosaveMeta = (dir) => path.join(dir, 'autosave', 'current.meta.json');
const photosDir = (dir) => path.join(dir, 'Autosave Photos');

/**
 * Write the autosave. `sidecar` photos (no file on disk) are stored under "Autosave Photos";
 * `known` maps photo id to the stored path for photos written earlier. Returns the id to path map.
 */
async function writeAutosave(dir, json, sidecar, known, meta) {
  await fs.mkdir(path.dirname(autosaveFile(dir)), { recursive: true });
  const paths = { ...known };
  if (Array.isArray(sidecar) && sidecar.length) {
    await fs.mkdir(photosDir(dir), { recursive: true });
    for (const item of sidecar) {
      const name = `${String(item.id).replace(UNSAFE, '_')}-${path.basename(String(item.name || 'photo.jpg')).replace(UNSAFE, '_')}`;
      const target = path.join(photosDir(dir), name);
      await atomicWrite(target, item.data);
      paths[item.id] = target;
    }
  }
  const project = JSON.parse(String(json));
  if (Array.isArray(project.photos)) for (const p of project.photos) if (!p.path && paths[p.id]) p.path = paths[p.id];
  await atomicWrite(autosaveFile(dir), Buffer.from(JSON.stringify(project), 'utf8'));
  await atomicWrite(autosaveMeta(dir), Buffer.from(JSON.stringify({ ...(meta && typeof meta === 'object' ? meta : {}), savedAt: Date.now() }), 'utf8'));
  return paths;
}
async function readAutosave(dir) {
  try {
    const json = await fs.readFile(autosaveFile(dir), 'utf8');
    let meta = {};
    try { meta = JSON.parse(await fs.readFile(autosaveMeta(dir), 'utf8')); } catch { /* no meta */ }
    return { path: autosaveFile(dir), json, meta };
  } catch {
    return null;
  }
}
async function clearAutosave(dir) {
  await fs.rm(path.join(dir, 'autosave'), { recursive: true, force: true });
  await fs.rm(photosDir(dir), { recursive: true, force: true });
}

const OPERATION_TIMEOUT_MS = 20_000;

/**
 * Serialize writes and clears, including the sidecar path bookkeeping. Reads skip the queue: every file is replaced
 * atomically, so they see the last committed autosave. An operation that hangs is abandoned after `timeoutMs` so it
 * cannot block the ones behind it.
 */
function createAutosaveStore(dir, { timeoutMs = OPERATION_TIMEOUT_MS } = {}) {
  let paths = {};
  let pending = Promise.resolve();
  const withTimeout = (operation) => {
    let timer;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Autosave operation timed out after ${timeoutMs} ms`)), timeoutMs);
    });
    return Promise.race([operation(), timeout]).finally(() => clearTimeout(timer));
  };
  const enqueue = (operation) => {
    const result = pending.then(() => withTimeout(operation));
    // A failed save must not prevent the next save or a clear from running.
    pending = result.catch(() => {});
    return result;
  };
  return {
    write: (json, sidecar, meta) => enqueue(async () => {
      paths = await writeAutosave(dir, json, sidecar, paths, meta);
    }),
    read: () => readAutosave(dir),
    clear: () => enqueue(async () => {
      await clearAutosave(dir);
      paths = {};
    }),
  };
}

module.exports = { MAX_RECENT_STORIES, addRecent, removeRecent, loadRecents, saveRecents, describeRecents, writeAutosave, readAutosave, clearAutosave, createAutosaveStore };
