'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { ffmpegPath } = require('./ffmpeg-path.cjs');

let current = null; // { proc, cancelled, killTimer, done }

function abortError() {
  const e = new Error('Video export cancelled');
  e.name = 'AbortError';
  return e;
}

function validate(job) {
  if (!job || typeof job !== 'object') throw new Error('Invalid video job');
  const { frames, durations, transition, transitionSeconds, fps, output } = job;
  if (!output || typeof output !== 'string') throw new Error('Video job needs an output path');
  if (!Array.isArray(frames) || frames.length === 0) throw new Error('Video job needs at least one frame');
  if (!Array.isArray(durations) || durations.length !== frames.length) {
    throw new Error('Video job durations must match frames in count');
  }
  for (const d of durations) {
    if (typeof d !== 'number' || !Number.isFinite(d) || d <= 0) throw new Error('Every page duration must be greater than 0');
  }
  for (const f of frames) {
    if (!f || typeof f.length !== 'number' || f.length === 0) throw new Error('Every frame must be non-empty JPEG bytes');
  }
  if (transition !== 'none' && transition !== 'crossfade') throw new Error('Unknown transition');
  const { transitions, kenBurnsPages } = job;
  if (transitions !== undefined) {
    if (!Array.isArray(transitions) || transitions.length !== frames.length - 1) throw new Error('transitions must have length frames-1');
    for (const t of transitions) if (t !== 'none' && t !== 'crossfade' && t !== 'slide') throw new Error('Unknown transition');
  }
  if (kenBurnsPages !== undefined && (!Array.isArray(kenBurnsPages) || kenBurnsPages.length !== frames.length)) {
    throw new Error('kenBurnsPages must have the same length as frames');
  }
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps < 24 || fps > 60) throw new Error('fps must be between 24 and 60');
  const kinds = boundaryKinds(job);
  if (kinds.some((k) => k !== 'none')) {
    if (typeof transitionSeconds !== 'number' || !Number.isFinite(transitionSeconds) || transitionSeconds <= 0) {
      throw new Error('transitionSeconds must be greater than 0');
    }
    if (transitionSeconds >= Math.min(...durations)) throw new Error('transitionSeconds must be shorter than every page duration');
  }
}

function boundaryKinds(job) {
  const out = [];
  for (let i = 0; i < job.frames.length - 1; i++) out.push((job.transitions && job.transitions[i]) || job.transition);
  return out;
}

/** Read width/height from the first SOF marker of a JPEG. */
function probeJpegSize(buf) {
  if (!buf || buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('Frame is not a JPEG');
  let i = 2;
  while (i + 9 < buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    let m = buf[i + 1];
    if (m === 0xff) { i++; continue; }
    if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0x00) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    const isSof = m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
    if (isSof) {
      const height = buf.readUInt16BE(i + 5);
      const width = buf.readUInt16BE(i + 7);
      if (!width || !height) throw new Error('JPEG has invalid dimensions');
      return { width, height };
    }
    i += 2 + len;
  }
  throw new Error('Could not read JPEG dimensions');
}

const num = (n) => String(Math.round(n * 1e4) / 1e4);

/**
 * Build ffmpeg args. size = {width,height} (will be forced even).
 * paths = { frames: string[], output: string }.
 */
function buildArgs(job, size, paths) {
  const W = Math.floor(size.width / 2) * 2;
  const H = Math.floor(size.height / 2) * 2;
  const n = job.frames.length;
  const fps = job.fps;
  const durations = job.durations;
  const T = job.transitionSeconds || 0;
  const kinds = boundaryKinds(job);
  const total = durations.reduce((a, b) => a + b, 0);
  const lens = durations.map((d, i) => (i < n - 1 && kinds[i] !== 'none' ? d + T : d));
  const useKb = (i) => (job.kenBurnsPages ? !!job.kenBurnsPages[i] : !!job.kenBurns);

  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  const filters = [];
  for (let i = 0; i < n; i++) {
    const frameCount = Math.max(1, Math.round(lens[i] * fps));
    if (useKb(i)) {
      // single-frame input; zoompan generates all frames
      args.push('-i', paths.frames[i]);
      filters.push(
        `[${i}:v]scale=${W * 2}:${H * 2},setsar=1,` +
          `zoompan=z='1+0.06*on/${Math.max(1, frameCount - 1)}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${frameCount}:s=${W}x${H}:fps=${fps},` +
          `format=yuv420p,setsar=1,fps=${fps}[v${i}]`
      );
    } else {
      args.push('-loop', '1', '-framerate', String(fps), '-t', num(lens[i]), '-i', paths.frames[i]);
      filters.push(`[${i}:v]scale=${W}:${H},format=yuv420p,setsar=1,fps=${fps}[v${i}]`);
    }
  }

  let last = 'v0';
  if (n > 1) {
    let acc = 'v0';
    let offset = 0;
    for (let i = 1; i < n; i++) {
      offset += durations[i - 1];
      const out = i === n - 1 ? 'vout' : `x${i}`;
      const kind = kinds[i - 1];
      if (kind === 'none') filters.push(`[${acc}][v${i}]concat=n=2:v=1:a=0,settb=1/${fps}[${out}]`);
      else {
        const name = kind === 'slide' ? 'slideleft' : 'fade';
        filters.push(`[${acc}][v${i}]xfade=transition=${name}:duration=${num(T)}:offset=${num(offset)}[${out}]`);
      }
      acc = out;
    }
    last = 'vout';
  }

  if (job.audioPath) {
    args.push('-stream_loop', '-1', '-i', job.audioPath);
    const fade = Math.min(1.5, total);
    filters.push(`[${n}:a]atrim=0:${num(total)},asetpts=PTS-STARTPTS,afade=t=out:st=${num(Math.max(0, total - fade))}:d=${num(fade)}[aout]`);
  }

  args.push('-filter_complex', filters.join(';'));
  args.push('-map', `[${last}]`);
  if (job.audioPath) args.push('-map', '[aout]');
  args.push('-c:v', 'libx264', '-crf', '18', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
  if (job.audioPath) args.push('-c:a', 'aac', '-b:a', '192k');
  args.push('-t', num(total), '-progress', 'pipe:1', '-nostats', '-f', 'mp4', paths.output);
  return args;
}

async function rmQuiet(p, opts) {
  try { await fs.promises.rm(p, { force: true, recursive: true, ...opts }); } catch { /* ignore */ }
}

async function makeVideo(job, onProgress) {
  if (current) throw new Error('A video export is already running');
  const state = { proc: null, cancelled: false, killTimer: null, done: null, finish: null };
  state.done = new Promise((resolve) => { state.finish = resolve; });
  current = state;
  let tmpDir = null;
  let partial = null;
  try {
    validate(job);
    const bufs = job.frames.map((f) => (Buffer.isBuffer(f) ? f : Buffer.from(f.buffer, f.byteOffset, f.byteLength)));
    const first = probeJpegSize(bufs[0]);
    const size = { width: Math.floor(first.width / 2) * 2, height: Math.floor(first.height / 2) * 2 };
    if (size.width < 2 || size.height < 2) throw new Error('Frame is too small');

    const outDir = path.dirname(path.resolve(job.output));
    partial = path.join(outDir, `.${path.basename(job.output)}.partial.mp4`);
    tmpDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'collage-video-'));
    const framePaths = [];
    for (let i = 0; i < bufs.length; i++) {
      const p = path.join(tmpDir, `frame_${i}.jpg`);
      await fs.promises.writeFile(p, bufs[i]);
      framePaths.push(p);
    }
    if (state.cancelled) throw abortError();

    const args = buildArgs(job, size, { frames: framePaths, output: partial });
    const total = job.durations.reduce((a, b) => a + b, 0);

    await new Promise((resolve, reject) => {
      let proc;
      try {
        proc = spawn(ffmpegPath(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
      } catch (e) { reject(e); return; }
      state.proc = proc;
      if (state.cancelled) { try { proc.kill('SIGKILL'); } catch { /* ignore */ } }
      let errTail = '';
      let buf = '';
      let lastEmit = 0;
      let lastFrac = -1;
      const emit = (frac, force) => {
        frac = Math.max(0, Math.min(1, frac));
        const now = Date.now();
        if (typeof onProgress !== 'function' || frac < lastFrac) return;
        if (!force && now - lastEmit < 100) return;
        lastEmit = now; lastFrac = frac;
        try { onProgress(frac); } catch { /* ignore */ }
      };
      proc.stdout.on('data', (d) => {
        buf += d.toString();
        let idx;
        while ((idx = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, idx).trim();
          buf = buf.slice(idx + 1);
          const m = /^out_time(?:_us|_ms)=(\d+)/.exec(line);
          if (m) emit(Number(m[1]) / 1e6 / total, false);
        }
      });
      proc.stderr.on('data', (d) => { errTail = (errTail + d.toString()).slice(-4096); });
      proc.on('error', (e) => reject(new Error(`Could not start ffmpeg: ${e.message}`)));
      proc.on('close', (code, signal) => {
        if (state.killTimer) clearTimeout(state.killTimer);
        if (state.cancelled) return reject(abortError());
        if (code === 0) { emit(1, true); return resolve(); }
        reject(new Error(`ffmpeg failed (${code ?? signal}): ${errTail.trim()}`));
      });
    });

    await fs.promises.rename(partial, job.output);
    partial = null;
    return job.output;
  } finally {
    if (state.killTimer) clearTimeout(state.killTimer);
    if (partial) await rmQuiet(partial);
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

module.exports = { makeVideo, cancel, isRunning, buildArgs, probeJpegSize, validate };
