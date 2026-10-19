const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const { Worker } = require('node:worker_threads');
const { ffmpegPath } = require('./ffmpeg-path.cjs');

const SAMPLE_RATE = 11025;
const FFT_SIZE = 512;
const HOP = 256;

/** In-place radix-2 FFT; only magnitudes are used for spectral flux. */
function fft(real, imag) {
  const n = real.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) [real[i], real[j]] = [real[j], real[i]];
  }
  for (let len = 2; len <= n; len *= 2) {
    const angle = -2 * Math.PI / len;
    const wr = Math.cos(angle), wi = Math.sin(angle);
    for (let start = 0; start < n; start += len) {
      let r = 1, im = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = start + j, b = a + len / 2;
        const tr = r * real[b] - im * imag[b], ti = r * imag[b] + im * real[b];
        real[b] = real[a] - tr; imag[b] = imag[a] - ti;
        real[a] += tr; imag[a] += ti;
        [r, im] = [r * wr - im * wi, r * wi + im * wr];
      }
    }
  }
}

/**
 * Loudness envelope for drawing the waveform: the largest |sample| in each of `buckets` equal slices, scaled so the loudest is 1.
 * About 50 buckets per second (200 to 12000); silence gives all zeros. Self-contained: it also runs inside the analysis worker.
 */
function computePeaks(samples, buckets) {
  const n = buckets || Math.min(12000, Math.max(200, Math.round(samples.length / 11025 * 50)));
  const peaks = new Array(n).fill(0);
  let top = 0;
  for (let b = 0; b < n; b++) {
    const from = Math.floor(b * samples.length / n), to = Math.max(from + 1, Math.floor((b + 1) * samples.length / n));
    let m = 0;
    for (let i = from; i < to && i < samples.length; i++) { const v = Math.abs(samples[i]); if (v > m) m = v; }
    peaks[b] = m;
    if (m > top) top = m;
  }
  return top > 0 ? peaks.map((v) => Math.round(v / top * 1000) / 1000) : peaks;
}

/** Detect percussive onsets, estimate tempo, then follow actual beats as tempo drifts. */
function detectBeats(samples, sampleRate = SAMPLE_RATE) {
  const duration = samples.length / sampleRate;
  const count = Math.floor((samples.length - FFT_SIZE) / HOP) + 1;
  if (count < 4) throw new Error('This music is too short to detect beats. Choose a longer track.');
  const envelope = new Float64Array(count);
  const real = new Float64Array(FFT_SIZE), imag = new Float64Array(FFT_SIZE);
  const previous = new Float64Array(FFT_SIZE / 2);
  const window = Float64Array.from({ length: FFT_SIZE }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (FFT_SIZE - 1)));
  for (let frame = 0; frame < count; frame++) {
    for (let i = 0; i < FFT_SIZE; i++) real[i] = samples[frame * HOP + i] * window[i];
    imag.fill(0);
    fft(real, imag);
    for (let bin = 2; bin < previous.length; bin++) {
      const magnitude = Math.log1p(10 * Math.hypot(real[bin], imag[bin]));
      // Bass onsets get more weight than high-frequency subdivisions such as hi-hats.
      // Frame 0 has no earlier spectrum to compare with; comparing against zeros would report a fake onset at t=0.
      if (frame > 0) envelope[frame] += Math.max(0, magnitude - previous[bin]) / Math.sqrt(bin);
      previous[bin] = magnitude;
    }
  }
  const maximum = envelope.reduce((a, b) => Math.max(a, b), 0);
  // Raw flux: a steady tone peaks near 0.06, a faint click track above 7. Normalising below would turn noise into "beats".
  if (maximum < 0.5) throw new Error('No clear beats found. Choose music with a stronger rhythm, or turn off beat sync.');
  for (let i = 0; i < count; i++) envelope[i] /= maximum;
  const frameSeconds = HOP / sampleRate;
  const peaks = [];
  for (let i = 0; i < count - 1; i++) {
    if (envelope[i] < 0.08 || envelope[i] <= (envelope[i - 1] ?? 0) || envelope[i] < envelope[i + 1]) continue;
    let sum = 0, n = 0;
    for (let j = Math.max(0, i - 12); j <= Math.min(count - 1, i + 12); j++) { sum += envelope[j]; n++; }
    if (envelope[i] < sum / n * 1.4) continue;
    const peak = { time: i === 0 ? 0 : (i * HOP + FFT_SIZE / 2) / sampleRate, strength: envelope[i] };
    const last = peaks.at(-1);
    if (last && peak.time - last.time < 0.18) {
      if (peak.strength > last.strength) peaks[peaks.length - 1] = peak;
    } else peaks.push(peak);
  }
  if (peaks.length < 4) throw new Error('No clear beats found. Choose music with a stronger rhythm, or turn off beat sync.');

  let lag = 0, best = 0;
  // Smooth by one frame so fractional-period beats do not lose to an exact
  // integer-frame half/third-tempo alias in the autocorrelation.
  const smooth = Float64Array.from(envelope, (v, i) => (envelope[i - 1] ?? 0) * 0.25 + v * 0.5 + (envelope[i + 1] ?? 0) * 0.25);
  // Prefer plausible musical tempos without forcing a fixed BPM on detected onsets.
  for (let k = Math.ceil(60 / 200 / frameSeconds); k <= Math.floor(60 / 60 / frameSeconds); k++) {
    let correlation = 0, a = 0, b = 0;
    for (let i = k; i < count; i++) {
      correlation += smooth[i] * smooth[i - k];
      a += smooth[i] ** 2; b += smooth[i - k] ** 2;
    }
    const bpm = 60 / (k * frameSeconds);
    const score = correlation / Math.sqrt(a * b || 1) * (1 - 0.2 * Math.abs(Math.log2(bpm / 120)));
    if (score > best) { best = score; lag = k; }
  }
  if (best < 0.1 || !lag) throw new Error('Could not find a steady beat. Try another track or turn off beat sync.');
  let period = lag * frameSeconds;
  // Refine the frame-quantized period using actual onset intervals near that lag.
  const gaps = peaks.slice(1).map((p, i) => p.time - peaks[i].time).sort((a, b) => a - b);
  const median = gaps[Math.floor(gaps.length / 2)];
  const regular = gaps.filter((d) => Math.abs(d / median - 1) < 0.15);
  // Resolve half-time aliases when the onsets themselves have a regular pulse.
  if (regular.length >= gaps.length * 0.6 && median >= 60 / 200 && median <= 1.02) {
    period = regular.reduce((a, b) => a + b, 0) / regular.length;
  } else {
    const intervals = gaps.filter((d) => Math.abs(d / period - 1) < 0.2);
    if (intervals.length) period = intervals.reduce((a, b) => a + b, 0) / intervals.length;
  }
  const anchors = [...peaks].sort((a, b) => b.strength - a.strength).slice(0, 64);
  let anchor = anchors[0].time, support = -1;
  for (const candidate of anchors) {
    const score = peaks.reduce((s, p) => {
      const distance = Math.abs((p.time - candidate.time) / period - Math.round((p.time - candidate.time) / period));
      return s + p.strength * Math.exp(-distance * distance / 0.02);
    }, 0);
    if (score > support) { support = score; anchor = candidate.time; }
  }
  const anchorIndex = peaks.findIndex((p) => p.time === anchor);
  const follow = (direction) => {
    const found = [];
    let index = anchorIndex, localPeriod = period;
    while (index + direction >= 0 && index + direction < peaks.length) {
      let next = -1, bestScore = -1;
      for (let i = index + direction; i >= 0 && i < peaks.length; i += direction) {
        const gap = Math.abs(peaks[i].time - peaks[index].time);
        if (gap < localPeriod * 0.5) continue;
        if (gap > localPeriod * 1.7) {
          // Resume at a real onset after a rest; never invent beats in silence.
          if (next === -1) next = i;
          break;
        }
        const score = peaks[i].strength * Math.exp(-6 * (gap / localPeriod - 1) ** 2);
        if (score > bestScore) { bestScore = score; next = i; }
      }
      if (next === -1) break;
      const gap = Math.abs(peaks[next].time - peaks[index].time);
      if (gap >= localPeriod * 0.6 && gap <= localPeriod * 1.5) localPeriod = localPeriod * 0.8 + gap * 0.2;
      found.push(peaks[next].time);
      index = next;
    }
    return found;
  };
  const beats = [...follow(-1).reverse(), anchor, ...follow(1)];
  if (beats.length < 4) throw new Error('Not enough clear beats found. Try another track or turn off beat sync.');
  return { beats, duration, bpm: Math.round(60 / period), peaks: computePeaks(samples) };
}

/**
 * Source for the analysis worker. It is built from the functions above and run with `eval`, so the worker
 * never loads a file: `new Worker(__filename)` can fail inside app.asar in a packaged build.
 */
function workerSource() {
  return [
    "const { parentPort, workerData } = require('node:worker_threads');",
    `const SAMPLE_RATE = ${SAMPLE_RATE}, FFT_SIZE = ${FFT_SIZE}, HOP = ${HOP};`,
    fft.toString(),
    computePeaks.toString(),
    detectBeats.toString(),
    'parentPort.postMessage(detectBeats(new Float32Array(workerData.samples)));',
  ].join('\n');
}

const CACHE_SIZE = 4;
const cache = new Map(); // key -> BeatAnalysis, least recently used first
const inflight = new Map(); // key -> { promise, abort() }
let latestFile = null; // the most recently requested track, set before any await so request order wins

function abortError() {
  const e = new Error('Music analysis cancelled');
  e.name = 'AbortError';
  return e;
}

function decodeAndAnalyze(file) {
  const controller = new AbortController();
  let worker = null;
  const promise = new Promise((resolve, reject) => {
    // `file:` stops FFmpeg reading a name such as "http:x.mp3" or "pipe:1" as a protocol.
    execFile(ffmpegPath(), ['-v', 'error', '-nostdin', '-i', `file:${file}`, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 60_000, signal: controller.signal }, (error, pcm) => {
        if (controller.signal.aborted) { reject(abortError()); return; }
        if (error) { reject(new Error('Could not analyze this music. Choose a playable audio file under 25 minutes.')); return; }
        const samples = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);
        worker = new Worker(workerSource(), { eval: true, workerData: { samples }, transferList: [samples] });
        worker.once('message', resolve);
        worker.once('error', (e) => reject(controller.signal.aborted ? abortError() : e));
        worker.once('exit', (code) => { if (code !== 0) reject(controller.signal.aborted ? abortError() : new Error('Music analysis did not finish. Try another track.')); });
      });
  });
  return { promise, abort() { controller.abort(); worker?.terminate(); } };
}

/**
 * Decode locally with the same bundled FFmpeg as video export; analyze off the main thread.
 * Results are cached by path, mtime and size, identical requests share one run, and asking for a
 * different track stops any analysis still running for an earlier one.
 */
async function analyzeAudio(file) {
  if (typeof file !== 'string' || !file) throw new Error('Choose a music file first.');
  latestFile = file;
  const stat = await fs.stat(file).catch(() => null);
  // File checks can finish out of order: a request overtaken by a different track cancels itself
  // rather than cancelling the newer one.
  if (latestFile !== file) throw abortError();
  if (!stat?.isFile()) throw new Error('This music file is unavailable. Choose a local audio file again.');
  const key = `${file}\0${stat.mtimeMs}\0${stat.size}`;
  const hit = cache.get(key);
  if (hit) { cache.delete(key); cache.set(key, hit); return hit; }
  const running = inflight.get(key);
  if (running) return running.promise;
  for (const [otherKey, other] of inflight) if (otherKey !== key) other.abort();
  const job = decodeAndAnalyze(file);
  inflight.set(key, job);
  const result = job.promise.then((analysis) => {
    cache.set(key, analysis);
    while (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value);
    return analysis;
  });
  const done = () => { if (inflight.get(key) === job) inflight.delete(key); };
  result.then(done, done);
  job.promise = result;
  return result;
}

module.exports = { detectBeats, computePeaks, analyzeAudio, workerSource };
