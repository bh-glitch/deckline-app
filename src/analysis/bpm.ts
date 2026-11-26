import { fft, hann, decimate } from './fft';

export interface Envelope { env: Float32Array; low: Float32Array; rate: number; t0: number }

/** Onset strength envelope (~100 Hz) from low-emphasised log-spectral flux. */
export function onsetEnvelope(x: Float32Array, sr: number): Envelope {
  const d = Math.max(1, Math.floor(sr / 22050));
  const y = decimate(x, d);
  const fs = sr / d;
  const W = 512;
  const hop = Math.max(1, Math.round(fs / 100));
  const rate = fs / hop;
  const win = hann(W);
  const re = new Float32Array(W), im = new Float32Array(W);
  const K = W / 2;
  const prev = new Float32Array(K);
  const wts = new Float32Array(K);
  for (let k = 0; k < K; k++) wts[k] = (k * fs) / W < 300 ? 2 : 1;
  const nFrames = Math.max(0, Math.floor((y.length - W) / hop) + 1);
  const env = new Float32Array(nFrames);
  const lowRaw = new Float32Array(nFrames);
  const norm = 4 / W;
  for (let i = 0; i < nFrames; i++) {
    const s = i * hop;
    for (let j = 0; j < W; j++) { re[j] = y[s + j] * win[j]; im[j] = 0; }
    fft(re, im);
    let flux = 0, lf = 0;
    for (let k = 1; k < K; k++) {
      const v = Math.log(1 + 1000 * norm * Math.sqrt(re[k] * re[k] + im[k] * im[k]));
      const df = v - prev[k];
      if (df > 0 && i > 0) { flux += df * wts[k]; if (k * fs < 200 * W) lf += df; }
      prev[k] = v;
    }
    env[i] = flux; lowRaw[i] = lf;
  }
  const half = Math.round(rate * 0.25);
  const post = (src: Float32Array): Float32Array => {
    const cs = new Float64Array(nFrames + 1);
    for (let i = 0; i < nFrames; i++) cs[i + 1] = cs[i] + src[i];
    const out = new Float32Array(nFrames);
    for (let i = 0; i < nFrames; i++) {
      const a = Math.max(0, i - half), b = Math.min(nFrames, i + half + 1);
      out[i] = Math.max(0, src[i] - (cs[b] - cs[a]) / (b - a));
    }
    const sm = new Float32Array(nFrames);
    for (let i = 0; i < nFrames; i++) {
      sm[i] = (2 * out[i] + (i > 0 ? out[i - 1] : 0) + (i < nFrames - 1 ? out[i + 1] : 0)) / 4;
    }
    return sm;
  };
  return { env: post(env), low: post(lowRaw), rate, t0: (W * 0.6) / fs };
}

function prior(bpm: number): number {
  const o = Math.log2(bpm / 120) / 0.7;
  return Math.exp(-0.5 * o * o);
}

/** Phase-folded concentration of the envelope at a given tempo. */
function fold(env: Float32Array, periodFrames: number, M: number, prof: Float64Array) {
  prof.fill(0);
  const inv = M / periodFrames;
  for (let i = 0; i < env.length; i++) {
    const e = env[i];
    if (e === 0) continue;
    const ph = (i * inv) % M;
    prof[ph | 0] += e;
  }
  let best = -1, bi = 0;
  for (let b = 0; b < M; b++) {
    const s = prof[(b + M - 1) % M] + prof[b] + prof[(b + 1) % M];
    if (s > best) { best = s; bi = b; }
  }
  return { score: best, bin: bi };
}

export interface TempoResult { bpm: number; phaseSec: number }

export function estimateTempo(e: Envelope): TempoResult | null {
  const { env, rate, t0 } = e;
  const N = env.length;
  if (N < rate * 4) return null;
  let sum = 0;
  for (let i = 0; i < N; i++) sum += env[i];
  if (!(sum > 0)) return null;

  // autocorrelation up to 4 beats of the slowest tempo
  const maxLag = Math.ceil((rate * 60) / 60) * 4 + 2;
  const ac = new Float64Array(maxLag + 1);
  for (let l = 1; l <= maxLag && l < N; l++) {
    let s = 0;
    for (let i = 0; i + l < N; i++) s += env[i] * env[i + l];
    ac[l] = s / (N - l);
  }
  const acAt = (l: number) => {
    if (l >= maxLag) return 0;
    const i = Math.floor(l), f = l - i;
    return ac[i] * (1 - f) + ac[i + 1] * f;
  };
  let bestBpm = 120, bestScore = -1;
  for (let bpm = 60; bpm <= 200; bpm += 0.25) {
    const L = (rate * 60) / bpm;
    const s = (acAt(L) + 0.5 * acAt(2 * L) + 0.25 * acAt(4 * L)) * prior(bpm);
    if (s > bestScore) { bestScore = s; bestBpm = bpm; }
  }

  // fine search by phase-folding the whole envelope
  const lo = bestBpm - 1.2, hi = bestBpm + 1.2, step = 0.01;
  const cands: number[] = [], scores: number[] = [], bins: number[] = [], Ms: number[] = [];
  const prof = new Float64Array(512);
  for (let bpm = lo; bpm <= hi + 1e-9; bpm += step) {
    const T = (rate * 60) / bpm;
    const M = Math.min(512, Math.max(16, Math.ceil(T * 3)));
    const r = fold(env, T, M, prof);
    cands.push(bpm); scores.push(r.score); bins.push(r.bin); Ms.push(M);
  }
  let bi = 0, bs = -1;
  for (let i = 0; i < cands.length; i++) {
    let s = 0, c = 0;
    for (let j = Math.max(0, i - 2); j <= Math.min(cands.length - 1, i + 2); j++) { s += scores[j]; c++; }
    s /= c;
    if (s > bs) { bs = s; bi = i; }
  }
  let bpm = Math.round(cands[bi] * 100) / 100;
  const nearest = Math.round(bpm);
  if (Math.abs(bpm - nearest) <= 0.05) bpm = nearest;

  // phase at the final tempo: favour the low band (kicks) over broadband hats
  let ls = 0, fs = 0;
  for (let i = 0; i < N; i++) { ls += e.low[i]; fs += env[i]; }
  const pe = new Float32Array(N);
  if (ls > 0 && fs > 0) for (let i = 0; i < N; i++) pe[i] = env[i] / fs + (2 * e.low[i]) / ls;
  else pe.set(env);
  const T = (rate * 60) / bpm;
  const M = Math.min(512, Math.max(16, Math.ceil(T * 3)));
  const r = fold(pe, T, M, prof);
  const phaseFrames = ((r.bin + 0.5) / M) * T;
  return { bpm, phaseSec: t0 + phaseFrames / rate };
}

export function foldBpm(bpm: number): number {
  while (bpm < 70) bpm *= 2;
  while (bpm > 180) bpm /= 2;
  return Math.round(bpm * 100) / 100;
}

/** Refine beat phase on the raw signal: snap grid to the actual transient onsets. */
export function refinePhase(x: Float32Array, sr: number, bpm: number, phaseSec: number): number {
  const T = 60 / bpm;
  let t0 = phaseSec - Math.floor(phaseSec / T) * T;
  const w = Math.round(0.04 * sr);
  let gmax = 0;
  const stride = 7;
  for (let i = 0; i < x.length; i += stride) { const a = Math.abs(x[i]); if (a > gmax) gmax = a; }
  const offs: number[] = [];
  for (let k = 0; k < 400; k++) {
    const c = Math.round((t0 + k * T) * sr);
    if (c + w >= x.length) break;
    if (c - w < 0) continue;
    let m = 0;
    for (let j = c - w; j <= c + w; j++) { const a = Math.abs(x[j]); if (a > m) m = a; }
    if (m < 0.1 * gmax) continue;
    const thr = 0.4 * m;
    let j = c - w;
    while (j <= c + w && Math.abs(x[j]) < thr) j++;
    offs.push((j - c) / sr);
  }
  if (offs.length >= 4) {
    offs.sort((a, b) => a - b);
    const med = offs[offs.length >> 1];
    if (Math.abs(med) <= 0.03) t0 += med;
  }
  t0 -= Math.floor(t0 / T) * T;
  return t0 < 0 ? 0 : t0;
}
