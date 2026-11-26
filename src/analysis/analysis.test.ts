import { describe, it, expect } from 'vitest';
import { analyzeSamples } from './analyze';
import { computeWaveform } from './waveform';
import { detectKey, camelot } from './key';

const SR = 44100;

function kick(buf: Float32Array, at: number, amp = 0.8) {
  const s = Math.round(at * SR);
  for (let i = 0; i < 0.12 * SR && s + i < buf.length; i++) {
    const t = i / SR;
    buf[s + i] += amp * Math.sin(2 * Math.PI * (50 + 100 * Math.exp(-t * 40)) * t) * Math.exp(-t * 25);
  }
}
function hat(buf: Float32Array, at: number, amp = 0.2) {
  const s = Math.round(at * SR);
  let seed = s | 1;
  for (let i = 0; i < 0.03 * SR && s + i < buf.length; i++) {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    buf[s + i] += amp * ((seed / 2 ** 32) * 2 - 1) * Math.exp(-i / (0.008 * SR));
  }
}

describe('tempo', () => {
  it('click track at 128 BPM', () => {
    const buf = new Float32Array(SR * 30);
    const T = 60 / 128, off = 0.25;
    for (let t = off; t < 29.9; t += T) buf[Math.round(t * SR)] = 1;
    const r = analyzeSamples(buf, SR);
    expect(Math.abs(r.bpm - 128)).toBeLessThan(0.5);
    expect(Math.abs(r.firstBeat - off)).toBeLessThan(0.02);
  });
  it('house pattern at 124 BPM with offbeat hats', () => {
    const buf = new Float32Array(SR * 40);
    const T = 60 / 124, off = 0.12;
    for (let i = 0; off + i * T < 39.5; i++) {
      kick(buf, off + i * T);
      hat(buf, off + (i + 0.5) * T);
    }
    const r = analyzeSamples(buf, SR);
    expect(Math.abs(r.bpm - 124)).toBeLessThan(0.5);
    expect(Math.abs(r.firstBeat - off)).toBeLessThan(0.04);
  });
  it('hiphop-ish 90 BPM', () => {
    const buf = new Float32Array(SR * 40);
    const T = 60 / 90;
    for (let i = 0; i * T < 39; i++) {
      if (i % 4 === 0 || i % 4 === 2) kick(buf, i * T);
      if (i % 4 === 1 || i % 4 === 3) hat(buf, i * T, 0.5);
      hat(buf, i * T + T / 2, 0.15);
    }
    const r = analyzeSamples(buf, SR);
    expect(Math.abs(r.bpm - 90)).toBeLessThan(0.5);
  });
});

describe('key', () => {
  function chord(freqs: number[], secs = 8) {
    const b = new Float32Array(SR * secs);
    for (const f of freqs) for (let i = 0; i < b.length; i++) b[i] += 0.2 * Math.sin((2 * Math.PI * f * i) / SR);
    return b;
  }
  it('A minor chord -> 8A', () => {
    expect(detectKey(chord([110, 220, 261.63, 329.63]), SR)).toBe('8A');
  });
  it('C major chord -> 8B', () => {
    expect(detectKey(chord([130.81, 261.63, 329.63, 392]), SR)).toBe('8B');
  });
  it('camelot mapping', () => {
    expect(camelot(9, true)).toBe('8A');
    expect(camelot(0, false)).toBe('8B');
    expect(camelot(7, false)).toBe('9B');
    expect(camelot(11, false)).toBe('1B');
  });
});

describe('waveform', () => {
  it('separates bands and has 150 bins/sec', () => {
    const n = SR * 2;
    const lo = new Float32Array(n), hi = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      lo[i] = 0.8 * Math.sin((2 * Math.PI * 80 * i) / SR);
      hi[i] = 0.8 * Math.sin((2 * Math.PI * 9000 * i) / SR);
    }
    const a = computeWaveform(lo, SR), b = computeWaveform(hi, SR);
    expect(a.low.length).toBe(300);
    const mx = (x: Float32Array) => Math.max(...x);
    expect(mx(a.low)).toBeGreaterThan(5 * mx(a.high));
    expect(mx(a.low)).toBeGreaterThan(5 * mx(a.mid));
    expect(mx(b.high)).toBeGreaterThan(5 * mx(b.low));
    expect(mx(a.low)).toBeLessThanOrEqual(1);
  });
  it('analysis speed: 5 min track < 3s', () => {
    const buf = new Float32Array(SR * 300);
    const T = 60 / 126;
    for (let i = 0; i * T < 299; i++) { kick(buf, i * T); hat(buf, (i + 0.5) * T); }
    const t = performance.now();
    const r = analyzeSamples(buf, SR);
    const dt = performance.now() - t;
    console.log('5min analysis ms', dt, r.bpm, r.firstBeat, r.key);
    expect(dt).toBeLessThan(3000);
    expect(Math.abs(r.bpm - 126)).toBeLessThan(0.5);
  });
});
