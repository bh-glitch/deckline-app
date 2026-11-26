/** Small in-place radix-2 FFT (no DOM). */
const cache = new Map<number, { cos: Float64Array; sin: Float64Array; rev: Uint32Array }>();

function tables(n: number) {
  let t = cache.get(n);
  if (t) return t;
  const cos = new Float64Array(n / 2);
  const sin = new Float64Array(n / 2);
  for (let i = 0; i < n / 2; i++) {
    cos[i] = Math.cos((2 * Math.PI * i) / n);
    sin[i] = -Math.sin((2 * Math.PI * i) / n);
  }
  const rev = new Uint32Array(n);
  const bits = Math.log2(n) | 0;
  for (let i = 0; i < n; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) if (i & (1 << b)) r |= 1 << (bits - 1 - b);
    rev[i] = r;
  }
  t = { cos, sin, rev };
  cache.set(n, t);
  return t;
}

/** Forward FFT in place. re/im length must be a power of two. */
export function fft(re: Float32Array | Float64Array, im: Float32Array | Float64Array): void {
  const n = re.length;
  if (n < 2 || (n & (n - 1)) !== 0) throw new Error('fft size must be a power of two');
  const { cos, sin, rev } = tables(n);
  for (let i = 0; i < n; i++) {
    const j = rev[i];
    if (j > i) {
      let t = re[i]; re[i] = re[j]; re[j] = t;
      t = im[i]; im[i] = im[j]; im[j] = t;
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const step = n / size;
    for (let start = 0; start < n; start += size) {
      for (let k = 0, w = 0; k < half; k++, w += step) {
        const a = start + k, b = a + half;
        const wr = cos[w], wi = sin[w];
        const xr = re[b] * wr - im[b] * wi;
        const xi = re[b] * wi + im[b] * wr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
}

export function hann(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

/** Box-average decimation (cascaded twice for a bit more alias rejection). */
export function decimate(x: Float32Array, d: number): Float32Array {
  if (d <= 1) return x;
  const n = Math.floor(x.length / d);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const base = i * d;
    for (let k = 0; k < d; k++) s += x[base + k];
    out[i] = s / d;
  }
  return out;
}
