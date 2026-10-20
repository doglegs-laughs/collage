'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { atomicCopy } = require('./files.cjs');

/** Bump when anything that changes the encoded bytes changes (filters, codec arguments, frame rendering, ffmpeg build). */
const VIDEO_PIPELINE_VERSION = 1;
const DEFAULT_LIMITS = { maxFiles: 3, maxBytes: 2 * 1024 ** 3 };
const KEY_RE = /^[0-9a-f]{64}$/;

/** JSON with object keys sorted, so equal values always serialize to the same text. */
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : stableStringify(v))).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

async function fileStamp(file) {
  try {
    const st = await fs.stat(file);
    return { size: st.size, mtimeMs: Math.round(st.mtimeMs) };
  } catch {
    return null;
  }
}

/**
 * Cache key over everything that affects the encoded file: the renderer's spec (pages, photo ids, fonts, video settings,
 * timing), the size and modified time of every photo and the music file on disk, the encoder and the pipeline version.
 * Returns null when the music cannot be read (nothing sensible to cache).
 */
async function computeKey(spec, encoder, version = VIDEO_PIPELINE_VERSION) {
  if (!spec || typeof spec !== 'object') return null;
  let audio = null;
  if (spec.audioPath) {
    audio = await fileStamp(spec.audioPath);
    if (!audio) return null;
  }
  const photos = [];
  for (const p of Array.isArray(spec.photos) ? spec.photos : []) {
    // Photo ids are content hashes already; the stamp also catches a changed file for photos that still point at one.
    photos.push({ id: p.id, stamp: p.path ? await fileStamp(p.path) : null });
  }
  return sha256(stableStringify({ version, encoder, spec, audio, photos }));
}

/** Which keys to delete so at most `maxFiles` entries and `maxBytes` remain, least recently used first. `keep` is never chosen. */
function planEviction(entries, limits = DEFAULT_LIMITS, keep = null) {
  const sorted = [...entries].sort((a, b) => (a.key === keep ? -1 : b.key === keep ? 1 : b.used - a.used));
  const drop = [];
  let files = 0;
  let bytes = 0;
  for (const e of sorted) {
    const fits = files + 1 <= limits.maxFiles && bytes + e.size <= limits.maxBytes;
    if (fits || e.key === keep) { files++; bytes += e.size; } else drop.push(e.key);
  }
  return drop;
}

function createVideoCache(dir, limits = DEFAULT_LIMITS) {
  const video = (key) => path.join(dir, `${key}.mp4`);
  const meta = (key) => path.join(dir, `${key}.json`);
  const rmQuiet = (p) => fs.rm(p, { force: true }).catch(() => {});
  const drop = (key) => Promise.all([rmQuiet(video(key)), rmQuiet(meta(key))]);

  /** Path of the cached file for `key`, or null. A file whose size or modified time no longer matches what was stored is dropped. */
  async function find(key) {
    if (!KEY_RE.test(key)) return null;
    try {
      const info = JSON.parse(await fs.readFile(meta(key), 'utf8'));
      const stamp = await fileStamp(video(key));
      if (stamp && info.size === stamp.size && info.mtimeMs === stamp.mtimeMs && stamp.size > 0) {
        const now = new Date();
        await fs.utimes(meta(key), now, now).catch(() => {}); // the sidecar carries recency: the video may share an inode with the user's copy
        return video(key);
      }
    } catch { /* missing or unreadable: a miss */ }
    await drop(key);
    return null;
  }

  async function entries() {
    const out = [];
    let names = [];
    try { names = await fs.readdir(dir); } catch { return out; }
    for (const name of names) {
      const key = name.endsWith('.json') ? name.slice(0, -5) : null;
      if (!key || !KEY_RE.test(key)) continue;
      try {
        const [info, st] = await Promise.all([fs.readFile(meta(key), 'utf8').then(JSON.parse), fs.stat(meta(key))]);
        out.push({ key, size: Number(info.size) || 0, used: st.mtimeMs });
      } catch { await drop(key); }
    }
    return out;
  }

  async function prune(keep) {
    for (const key of planEviction(await entries(), limits, keep)) await drop(key);
  }

  /** Keeps a copy of `source` (a finished video): a hard link when the volumes allow it, else a copy. Best effort. */
  async function store(key, source) {
    if (!KEY_RE.test(key)) return false;
    const stamp = await fileStamp(source);
    if (!stamp || stamp.size === 0 || stamp.size > limits.maxBytes) return false;
    await fs.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.${key}.${randomUUID().slice(0, 8)}.tmp`);
    try {
      await rmQuiet(meta(key));
      try {
        await fs.link(source, tmp);
      } catch {
        await fs.copyFile(source, tmp);
      }
      await fs.rename(tmp, video(key));
      const final = await fileStamp(video(key));
      await fs.writeFile(meta(key), JSON.stringify({ size: final.size, mtimeMs: final.mtimeMs, version: VIDEO_PIPELINE_VERSION }));
    } catch {
      await rmQuiet(tmp);
      await drop(key);
      return false;
    }
    await prune(key);
    return true;
  }

  /** Atomically puts a fresh copy of the cached video at `output`, replacing a file there as a normal export does. */
  const copyTo = (cached, output, options = {}) => atomicCopy(cached, output, { ...options, overwrite: true });

  return { find, store, prune, copyTo, dir };
}

module.exports = { VIDEO_PIPELINE_VERSION, DEFAULT_LIMITS, stableStringify, computeKey, planEviction, createVideoCache };
