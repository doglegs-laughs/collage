const fs = require('node:fs/promises');
const path = require('node:path');

const MOODS = ['upbeat', 'happy', 'nostalgic'];
const ID = /^[a-z0-9][a-z0-9-]{0,63}$/;
const FILE = /^[^\\/\0]+\.(m4a|mp3|aac|wav|ogg|flac)$/i;
const text = (v, max = 200) => typeof v === 'string' && v.trim() !== '' && v.length <= max && !v.includes('\0');
const number = (v, max) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max;

/**
 * Validates one tracks.json entry; null for a bad one. `file` must be a plain file name (no folders), so an entry can
 * never point outside the music folder.
 */
function readTrack(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const { id, file, title, artist, mood, durationSec, bpm, license, source } = raw;
  if (typeof id !== 'string' || !ID.test(id) || typeof file !== 'string' || !FILE.test(file) || file === '.' || file === '..') return null;
  if (!text(title) || !text(artist) || !MOODS.includes(mood) || !number(durationSec, 3600) || !number(bpm, 400) || !text(license) || !text(source, 500)) return null;
  return { id, file, title: title.trim(), artist: artist.trim(), mood, durationSec, bpm, license: license.trim(), source: source.trim() };
}

/** The valid entries of a parsed tracks.json (duplicate ids keep the first); anything that is not an array gives []. */
function readManifest(json) {
  if (!Array.isArray(json)) return [];
  const seen = new Set();
  const tracks = [];
  for (const raw of json) {
    const track = readTrack(raw);
    if (!track || seen.has(track.id)) continue;
    seen.add(track.id);
    tracks.push(track);
  }
  return tracks;
}

/** The built-in tracks in `dir` whose audio file exists, each with its absolute `path`. A missing or broken manifest gives []. */
async function loadBuiltinMusic(dir) {
  let json;
  try { json = JSON.parse(await fs.readFile(path.join(dir, 'tracks.json'), 'utf8')); } catch { return []; }
  const found = await Promise.all(readManifest(json).map(async (track) => {
    const file = path.join(dir, track.file);
    try { return (await fs.stat(file)).isFile() ? { ...track, path: file } : null; } catch { return null; }
  }));
  return found.filter(Boolean);
}

module.exports = { readTrack, readManifest, loadBuiltinMusic };
