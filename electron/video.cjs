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
  const { audioStartSeconds } = job;
  if (audioStartSeconds !== undefined && (typeof audioStartSeconds !== 'number' || !Number.isFinite(audioStartSeconds) || audioStartSeconds < 0)) throw new Error('audioStartSeconds must be 0 or more');
  if (typeof fps !== 'number' || !Number.isFinite(fps) || fps < 24 || fps > 60) throw new Error('fps must be between 24 and 60');
  const kinds = boundaryKinds(job);
  if (kinds.some((k) => k !== 'none')) {
    if (typeof transitionSeconds !== 'number' || !Number.isFinite(transitionSeconds) || transitionSeconds <= 0) {
      throw new Error('transitionSeconds must be greater than 0');
    }
    const { transitionDurations } = job;
    if (transitionDurations !== undefined) {
      if (!Array.isArray(transitionDurations) || transitionDurations.length !== frames.length - 1) throw new Error('transitionDurations must have length frames-1');
      kinds.forEach((kind, i) => {
        if (kind === 'none') return;
        const t = transitionDurations[i];
        if (typeof t !== 'number' || !Number.isFinite(t) || t <= 0) throw new Error('transitionDurations must be greater than 0');
        if (t >= Math.min(durations[i], durations[i + 1])) throw new Error('transitionDurations must be shorter than both neighbouring page durations');
      });
    } else if (transitionSeconds >= Math.min(...durations)) throw new Error('transitionSeconds must be shorter than every page duration');
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

const SOFTWARE_ENCODER = 'libx264';
const HARDWARE_ENCODER = 'h264_videotoolbox';

/** Encoder names the bundled ffmpeg reports, probed once per process (the answer cannot change while we run). */
let encoderProbe = null;
function listEncoders() {
  if (!encoderProbe) {
    encoderProbe = new Promise((resolve) => {
      let out = '';
      let proc;
      try { proc = spawn(ffmpegPath(), ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'ignore'] }); } catch { resolve(''); return; }
      proc.stdout.on('data', (d) => { out += d.toString(); });
      proc.on('error', () => resolve(''));
      proc.on('close', () => resolve(out));
    });
  }
  return encoderProbe;
}

/** Apple's hardware H.264 encoder on macOS when this ffmpeg build has it, libx264 everywhere else. */
async function pickEncoder() {
  if (process.platform !== 'darwin') return SOFTWARE_ENCODER;
  return /\bh264_videotoolbox\b/.test(await listEncoders()) ? HARDWARE_ENCODER : SOFTWARE_ENCODER;
}

/**
 * Video codec arguments. libx264 veryfast + stillimage is ~2x faster than medium for slideshow content at
 * a similar size (stillimage suits mostly-static frames); crf 20 is visually the same for photos.
 * VideoToolbox has no CRF, so the bitrate scales with pixels x fps (~12 Mbps for 1080x1350 at 30 fps).
 */
function encoderArgs(encoder, size, fps) {
  if (encoder === SOFTWARE_ENCODER) {
    return ['-c:v', SOFTWARE_ENCODER, '-preset', 'veryfast', '-crf', '20', '-tune', 'stillimage', '-threads', '0'];
  }
  const bps = Math.max(2e6, Math.min(40e6, Math.round(size.width * size.height * fps * 0.275)));
  return ['-c:v', encoder, '-b:v', String(bps), '-maxrate', String(Math.round(bps * 1.5)), '-allow_sw', '1', '-profile:v', 'high'];
}

/**
 * Build ffmpeg args. size = {width,height} (will be forced even).
 * paths = { frames: string[], output: string }. encoder = ffmpeg H.264 encoder name.
 */
function buildArgs(job, size, paths, encoder = SOFTWARE_ENCODER) {
  const W = Math.floor(size.width / 2) * 2;
  const H = Math.floor(size.height / 2) * 2;
  const n = job.frames.length;
  const fps = job.fps;
  const durations = job.durations;
  const kinds = boundaryKinds(job);
  const fade = (i) => (kinds[i] === 'none' ? 0 : (job.transitionDurations && job.transitionDurations[i]) || job.transitionSeconds || 0);
  // Beat sync centres each fade on the beat (boundary), so the new photo is fully in by boundary + T/2.
  // Otherwise a fade starts at the boundary. Either way the total length is the sum of the durations.
  const centred = !!job.beatSync;
  const total = durations.reduce((a, b) => a + b, 0);
  const lens = durations.map((d, i) => {
    const before = i > 0 ? fade(i - 1) : 0, after = i < n - 1 ? fade(i) : 0;
    return centred ? d + before / 2 + after / 2 : d + after;
  });
  const useKb = (i) => (job.kenBurnsPages ? !!job.kenBurnsPages[i] : !!job.kenBurns);

  const args = ['-y', '-hide_banner', '-loglevel', 'error'];
  const filters = [];
  for (let i = 0; i < n; i++) {
    const frameCount = Math.max(1, Math.round(lens[i] * fps));
    if (useKb(i)) {
      // Single-frame input; zoompan generates all frames. The pre-upscale hides zoompan's whole-pixel crop
      // steps. Measured on 1080x1350 (10 pages, filter graph only): 2x 5.1 s, 1.5x 4.3 s, 1x 2.4 s but 1x
      // repeats frames (visible stepping), and scale(eval=frame)+crop is slower (8.8 s) and steppier. 1.5x
      // has no repeated frames and is within noise of 2x for smoothness, so it is the cheapest safe choice.
      args.push('-i', paths.frames[i]);
      filters.push(
        `[${i}:v]scale=${Math.round((W * 1.5) / 2) * 2}:${Math.round((H * 1.5) / 2) * 2},setsar=1,` +
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
      const T = fade(i - 1);
      const out = i === n - 1 ? 'vout' : `x${i}`;
      const kind = kinds[i - 1];
      if (kind === 'none') filters.push(`[${acc}][v${i}]concat=n=2:v=1:a=0,settb=1/${fps}[${out}]`);
      else {
        const name = kind === 'slide' ? 'slideleft' : 'fade';
        filters.push(`[${acc}][v${i}]xfade=transition=${name}:duration=${num(T)}:offset=${num(centred ? offset - T / 2 : offset)}[${out}]`);
      }
      acc = out;
    }
    last = 'vout';
  }

  if (job.audioPath) {
    // A loop shorter than the file (it ends in silence) is cut and repeated in the filter graph.
    const loop = job.audioLoopSeconds;
    // The music starts `start` seconds into the (looped) file, so the loop is needed whenever start + total passes its end.
    const start = job.audioStartSeconds > 0 ? job.audioStartSeconds : 0;
    const trimLoop = typeof loop === 'number' && loop > 0 && loop < total + start;
    if (!trimLoop) args.push('-stream_loop', '-1');
    args.push('-i', job.audioPath);
    const out = Math.min(1.5, total);
    const source = trimLoop
      ? `aresample=48000,atrim=0:${num(loop)},asetpts=PTS-STARTPTS,aloop=loop=-1:size=${Math.round(loop * 48000)}:start=0,`
      : '';
    filters.push(`[${n}:a]${source}atrim=${num(start)}:${num(start + total)},asetpts=PTS-STARTPTS,afade=t=out:st=${num(Math.max(0, total - out))}:d=${num(out)}[aout]`);
  }

  args.push('-filter_complex', filters.join(';'));
  args.push('-map', `[${last}]`);
  if (job.audioPath) args.push('-map', '[aout]');
  args.push(...encoderArgs(encoder, { width: W, height: H }, fps), '-pix_fmt', 'yuv420p', '-movflags', '+faststart');
  if (job.audioPath) args.push('-c:a', 'aac', '-b:a', '192k');
  args.push('-t', num(total), '-progress', 'pipe:1', '-nostats', '-f', 'mp4', paths.output);
  return args;
}

async function rmQuiet(p, opts) {
  try { await fs.promises.rm(p, { force: true, recursive: true, ...opts }); } catch { /* ignore */ }
}

function runFfmpeg(state, args, total, onProgress) {
  return new Promise((resolve, reject) => {
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
    // out_time is the encoded position in the output, so the fraction tracks real encoding work.
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
}

/**
 * opts (for tests): encoder = force an encoder name, onAttempt(encoder) = called before every ffmpeg run.
 * A hardware encoder that fails is retried once with libx264, so the user never sees the failure.
 */
async function makeVideo(job, onProgress, opts = {}) {
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

    const total = job.durations.reduce((a, b) => a + b, 0);
    const encoder = opts.encoder || (await pickEncoder());
    if (state.cancelled) throw abortError();
    const attempt = (enc) => {
      if (typeof opts.onAttempt === 'function') opts.onAttempt(enc);
      return runFfmpeg(state, buildArgs(job, size, { frames: framePaths, output: partial }, enc), total, onProgress);
    };
    try {
      await attempt(encoder);
    } catch (e) {
      if (encoder === SOFTWARE_ENCODER || state.cancelled || e.name === 'AbortError') throw e;
      await rmQuiet(partial);
      await attempt(SOFTWARE_ENCODER);
    }

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

module.exports = { makeVideo, cancel, isRunning, buildArgs, encoderArgs, pickEncoder, listEncoders, probeJpegSize, validate };
