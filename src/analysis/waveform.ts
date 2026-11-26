import type { WaveformData } from '../types';

interface Biquad { b0: number; b1: number; b2: number; a1: number; a2: number }

function design(type: 'lp' | 'hp', fc: number, sr: number, q = Math.SQRT1_2): Biquad {
  const w = (2 * Math.PI * Math.min(fc, sr * 0.45)) / sr;
  const cw = Math.cos(w), alpha = Math.sin(w) / (2 * q);
  const a0 = 1 + alpha;
  let b0: number, b1: number, b2: number;
  if (type === 'lp') { b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = b0; }
  else { b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = b0; }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: (-2 * cw) / a0, a2: (1 - alpha) / a0 };
}

/** 3-band peak waveform. bands: low <250Hz, mid 250-4k, high >4k (4th-order-ish slopes). */
export function computeWaveform(x: Float32Array, sr: number, binsPerSecond = 150): WaveformData {
  const nBins = Math.max(1, Math.ceil((x.length * binsPerSecond) / sr));
  const low = new Float32Array(nBins);
  const mid = new Float32Array(nBins);
  const high = new Float32Array(nBins);

  const lp250 = design('lp', 250, sr), hp250 = design('hp', 250, sr);
  const lp4k = design('lp', 4000, sr), hp4k = design('hp', 4000, sr);
  // state: [z1, z2] per biquad. Chains: low = lp250 x2; mid = hp250 x2 -> lp4k x2; high = hp4k x2
  const chains: { f: Biquad; z: Float64Array }[][] = [
    [lp250, lp250], [hp250, hp250, lp4k, lp4k], [hp4k, hp4k],
  ].map((c) => c.map((f) => ({ f, z: new Float64Array(2) })));

  const outs = [low, mid, high];
  const samplesPerBin = sr / binsPerSecond;
  let bin = 0, nextEdge = samplesPerBin;
  const peaks = [0, 0, 0];
  for (let i = 0; i < x.length; i++) {
    if (i >= nextEdge) {
      for (let c = 0; c < 3; c++) { outs[c][bin] = peaks[c]; peaks[c] = 0; }
      bin++; nextEdge += samplesPerBin;
      if (bin >= nBins) bin = nBins - 1;
    }
    const s = x[i];
    for (let c = 0; c < 3; c++) {
      let v = s;
      const chain = chains[c];
      for (let k = 0; k < chain.length; k++) {
        const { f, z } = chain[k];
        const y = f.b0 * v + z[0];
        z[0] = f.b1 * v - f.a1 * y + z[1];
        z[1] = f.b2 * v - f.a2 * y;
        v = y;
      }
      const a = v < 0 ? -v : v;
      if (a > peaks[c]) peaks[c] = a;
    }
  }
  for (let c = 0; c < 3; c++) if (peaks[c] > outs[c][bin]) outs[c][bin] = peaks[c];

  let max = 0;
  for (const o of outs) for (let i = 0; i < o.length; i++) if (o[i] > max) max = o[i];
  if (max > 0) for (const o of outs) for (let i = 0; i < o.length; i++) o[i] /= max;
  return { binsPerSecond, low, mid, high };
}
