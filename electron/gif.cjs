'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { probeJpegSize, runFfmpeg, rmQuiet } = require('./video.cjs');

const MIN_FRAMES = 2;
const MAX_FRAMES = 300;
const MIN_SECONDS = 0.02;
const MAX_SECONDS = 10;
const MIN_EDGE = 16;
const MAX_EDGE = 2048;
const MAX_FRAME_BYTES = 32 * 1024 * 1024;
/** ffmpeg's concat demuxer snaps timestamps to the 25 fps frame grid (0.04 s). Durations are listed 4x longer, which lands every centisecond delay on that grid, and divided by 4 again afterwards. */
const GRID = 4;

let current = null; // { proc, cancelled, killTimer, done }

function abortError() {
  const e = new Error('GIF export cancelled');
  e.name = 'AbortError';
  return e;
}

function validate(job) {
  if (!job || typeof job !== 'object') throw new Error('Invalid GIF job');
  const { frames, durations, loop, output } = job;
  if (!output || typeof output !== 'string') throw new Error('GIF job needs an output path');
  if (loop !== 'forever' && loop !== 'once') throw new Error('loop must be forever or once');
  if (!Array.isArray(frames) || frames.length < MIN_FRAMES || frames.length > MAX_FRAMES) {
    throw new Error(`A GIF needs ${MIN_FRAMES} to ${MAX_FRAMES} frames`);
  }
  if (!Array.isArray(durations) || durations.length !== frames.length) throw new Error('GIF job durations must match frames in count');
  for (const d of durations) {
    if (typeof d !== 'number' || !Number.isFinite(d) || d < MIN_SECONDS || d > MAX_SECONDS) {
      throw new Error(`Every frame must last ${MIN_SECONDS} to ${MAX_SECONDS} seconds`);
    }
  }
  for (const f of frames) {
    if (!f || typeof f.length !== 'number' || f.length === 0 || f.length > MAX_FRAME_BYTES) throw new Error('Every frame must be non-empty JPEG bytes');
  }
}

/** Common size of all frames (JPEG); they must agree and stay within sane bounds. */
function frameSize(bufs) {
  const first = probeJpegSize(bufs[0]);
  if (first.width < MIN_EDGE || first.height < MIN_EDGE || first.width > MAX_EDGE || first.height > MAX_EDGE) throw new Error('GIF size is out of range');
  for (const b of bufs) {
    const s = probeJpegSize(b);
    if (s.width !== first.width || s.height !== first.height) throw new Error('Every frame must have the same size');
  }
  return first;
}

/** GIF delays are whole centiseconds, and a delay under 2 is played far slower by most viewers. */
const centis = (seconds) => Math.max(2, Math.round(seconds * 100));

/**
 * ffconcat list: one entry per frame, durations in GRID-scaled seconds. The last entry carries no duration
 * (the demuxer ignores it); the GIF muxer's final_delay supplies it.
 */
function concatList(names, durations) {
  const lines = ['ffconcat version 1.0'];
  names.forEach((name, i) => {
    lines.push(`file '${name}'`);
    if (i < names.length - 1) lines.push(`duration ${(centis(durations[i]) * GRID / 100).toFixed(2)}`);
  });
  return lines.join('\n') + '\n';
}

const input = (file) => ['-protocol_whitelist', 'file,pipe', ...file];

/** Pass 1: a 256-colour palette from the whole animation. */
function paletteArgs(paths) {
  return ['-y', '-hide_banner', '-loglevel', 'error',
    ...input(['-f', 'concat', '-i', paths.list]),
    '-vf', 'palettegen=stats_mode=diff', '-frames:v', '1', '-update', '1', '-f', 'image2', paths.palette];
}

/** Pass 2: dither to that palette. -loop 0 repeats forever, -1 writes no loop block (plays once). */
function encodeArgs(job, paths) {
  const last = centis(job.durations[job.durations.length - 1]);
  return ['-y', '-hide_banner', '-loglevel', 'error',
    ...input(['-f', 'concat', '-i', paths.list]),
    ...input(['-i', paths.palette]),
    '-lavfi', `[0:v]settb=1/100,setpts=PTS/${GRID}[v];[v][1:v]paletteuse=dither=sierra2_4a`,
    '-fps_mode', 'passthrough', '-enc_time_base', '1/100', '-final_delay', String(last),
    '-loop', job.loop === 'once' ? '-1' : '0', '-progress', 'pipe:1', '-nostats', '-f', 'gif', paths.output];
}

/** Writes `job.frames` (JPEG bytes) as one GIF at `job.output`; resolves to { path, bytes }. */
async function makeGif(job, onProgress) {
  if (current) throw new Error('A GIF export is already running');
  const state = { proc: null, cancelled: false, killTimer: null, done: null, finish: null };
  state.done = new Promise((resolve) => { state.finish = resolve; });
  current = state;
  let tmpDir = null;
  let outputTmp = null;
  try {
    validate(job);
    const bufs = job.frames.map((f) => (Buffer.isBuffer(f) ? f : Buffer.from(f.buffer, f.byteOffset, f.byteLength)));
    frameSize(bufs);

    // A private directory beside the destination prevents collisions and pre-existing symlinks from redirecting ffmpeg's writes.
    outputTmp = await fs.promises.mkdtemp(path.join(path.dirname(path.resolve(job.output)), '.collage-gif-'));
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'collage-gif-'));
    const names = [];
    for (let i = 0; i < bufs.length; i++) {
      names.push(`frame_${i}.jpg`);
      await fs.promises.writeFile(path.join(tmpDir, names[i]), bufs[i]);
    }
    const paths = { list: path.join(tmpDir, 'frames.txt'), palette: path.join(tmpDir, 'palette.png'), output: path.join(outputTmp, 'animation.gif') };
    await fs.promises.writeFile(paths.list, concatList(names, job.durations));
    if (state.cancelled) throw abortError();

    const total = job.durations.reduce((a, d) => a + centis(d) / 100, 0);
    const report = (from, to) => (typeof onProgress === 'function' ? (f) => onProgress(from + (to - from) * f) : undefined);
    await runFfmpeg(state, paletteArgs(paths), total, report(0, 0.3));
    if (state.cancelled) throw abortError();
    await runFfmpeg(state, encodeArgs(job, paths), total, report(0.3, 1));
    if (state.cancelled) throw abortError();

    const bytes = (await fs.promises.stat(paths.output)).size;
    await fs.promises.rename(paths.output, job.output);
    return { path: job.output, bytes };
  } finally {
    if (state.killTimer) clearTimeout(state.killTimer);
    if (outputTmp) await rmQuiet(outputTmp);
    if (tmpDir) await rmQuiet(tmpDir);
    if (current === state) current = null;
    state.finish();
  }
}

/** Stops the running job; the promise resolves once ffmpeg has exited and temp files are removed. */
function cancel() {
  const state = current;
  if (!state) return Promise.resolve();
  state.cancelled = true;
  const proc = state.proc;
  if (proc && proc.exitCode === null && proc.signalCode === null) {
    try { proc.kill('SIGTERM'); } catch { /* ignore */ }
    state.killTimer = setTimeout(() => { try { proc.kill('SIGKILL'); } catch { /* ignore */ } }, 2000);
  }
  return state.done;
}

function isRunning() { return current !== null; }

module.exports = { makeGif, cancel, isRunning, validate, centis, concatList, paletteArgs, encodeArgs, MIN_FRAMES, MAX_FRAMES };
