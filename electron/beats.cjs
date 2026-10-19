const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const { Worker, isMainThread, parentPort, workerData } = require('node:worker_threads');
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
      envelope[frame] += Math.max(0, magnitude - previous[bin]) / Math.sqrt(bin);
      previous[bin] = magnitude;
    }
  }
  const maximum = envelope.reduce((a, b) => Math.max(a, b), 0);
  if (maximum < 0.01) throw new Error('No clear beats found. Choose music with a stronger rhythm, or turn off beat sync.');
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
  return { beats, duration, bpm: Math.round(60 / period) };
}

/** Decode locally with the same bundled FFmpeg as video export; analyze off the main thread. */
async function analyzeAudio(file) {
  if (typeof file !== 'string' || !file) throw new Error('Choose a music file first.');
  const stat = await fs.stat(file).catch(() => null);
  if (!stat?.isFile()) throw new Error('This music file is unavailable. Choose a local audio file again.');
  return new Promise((resolve, reject) => {
    execFile(ffmpegPath(), ['-v', 'error', '-nostdin', '-i', file, '-vn', '-ac', '1', '-ar', String(SAMPLE_RATE), '-f', 'f32le', 'pipe:1'],
      { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024, timeout: 60_000 }, (error, pcm) => {
        if (error) { reject(new Error('Could not analyze this music. Choose a playable audio file under 25 minutes.')); return; }
        const samples = pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength);
        const worker = new Worker(__filename, { workerData: { type: 'collage-beat-analysis', samples }, transferList: [samples] });
        worker.once('message', resolve);
        worker.once('error', reject);
        worker.once('exit', (code) => { if (code !== 0) reject(new Error('Music analysis did not finish. Try another track.')); });
      });
  });
}

if (!isMainThread && workerData?.type === 'collage-beat-analysis') parentPort.postMessage(detectBeats(new Float32Array(workerData.samples)));
module.exports = { detectBeats, analyzeAudio };
