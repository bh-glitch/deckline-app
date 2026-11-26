import { fft, hann, decimate } from './fft';

const MAJOR = [6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88];
const MINOR = [6.33, 2.68, 3.52, 5.38, 2.6, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17];

export function chromagram(x: Float32Array, sr: number): Float64Array {
  const d = Math.max(1, Math.round(sr / 11025));
  const y = decimate(decimate(x, d >= 4 ? 2 : 1), d >= 4 ? d / 2 : d);
  const fs = sr / d;
  const N = 4096, hop = 2048;
  const win = hann(N);
  const re = new Float32Array(N), im = new Float32Array(N);
  const chroma = new Float64Array(12);
  // bin -> pitch class
  const lo = Math.ceil((65 * N) / fs), hi = Math.min(N / 2 - 1, Math.floor((2000 * N) / fs));
  const pc = new Int8Array(hi + 1).fill(-1);
  for (let k = lo; k <= hi; k++) {
    const f = (k * fs) / N;
    pc[k] = ((Math.round(12 * Math.log2(f / 440)) + 69) % 12 + 12) % 12;
  }
  for (let s = 0; s + N <= y.length; s += hop) {
    for (let i = 0; i < N; i++) { re[i] = y[s + i] * win[i]; im[i] = 0; }
    fft(re, im);
    for (let k = lo; k <= hi; k++) {
      const m = Math.sqrt(re[k] * re[k] + im[k] * im[k]);
      chroma[pc[k]] += m;
    }
  }
  return chroma;
}

function corr(a: ArrayLike<number>, b: ArrayLike<number>): number {
  let ma = 0, mb = 0;
  for (let i = 0; i < 12; i++) { ma += a[i]; mb += b[i]; }
  ma /= 12; mb /= 12;
  let n = 0, da = 0, db = 0;
  for (let i = 0; i < 12; i++) {
    const x = a[i] - ma, y = b[i] - mb;
    n += x * y; da += x * x; db += y * y;
  }
  return da > 0 && db > 0 ? n / Math.sqrt(da * db) : 0;
}

/** Camelot code for tonic pitch class (C=0). */
export function camelot(pc: number, minor: boolean): string {
  const majorPc = minor ? (pc + 3) % 12 : pc;
  const num = ((majorPc * 7) % 12 + 7) % 12 + 1;
  return `${num}${minor ? 'A' : 'B'}`;
}

export function detectKey(x: Float32Array, sr: number): string | undefined {
  const chroma = chromagram(x, sr);
  let total = 0;
  for (let i = 0; i < 12; i++) total += chroma[i];
  if (!(total > 0)) return undefined;
  let best = -2, bestKey: string | undefined;
  const rot = new Float64Array(12);
  for (let t = 0; t < 12; t++) {
    for (const minor of [false, true]) {
      const prof = minor ? MINOR : MAJOR;
      for (let i = 0; i < 12; i++) rot[i] = prof[(i - t + 12) % 12];
      const c = corr(chroma, rot);
      if (c > best) { best = c; bestKey = camelot(t, minor); }
    }
  }
  return bestKey;
}
