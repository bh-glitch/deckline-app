import type { SampleName } from '../types';

export const SAMPLE_NAMES: SampleName[] = [
  'airhorn', 'siren', 'rocket', 'laser', 'riser', 'impact', 'scratch', 'rewind',
  'kick', 'snare', 'clap', 'hat', 'subdrop', 'vox', 'zap', 'bell',
];

type OC = OfflineAudioContext;
type Recipe = (oc: OC) => number; // builds the graph into oc.destination, returns nothing useful (duration set by caller)

const SR = 44100;
const DURATIONS: Record<SampleName, number> = {
  airhorn: 1.9, siren: 3.2, rocket: 2.6, laser: 0.55, riser: 4.2, impact: 3.2, scratch: 1.1, rewind: 1.3,
  kick: 0.55, snare: 0.4, clap: 0.45, hat: 0.25, subdrop: 1.8, vox: 0.7, zap: 0.45, bell: 2.4,
};

// ---------- tiny synth helpers ----------
function noise(oc: OC, dur: number): AudioBufferSourceNode {
  const b = oc.createBuffer(1, Math.ceil(oc.sampleRate * dur), oc.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const s = oc.createBufferSource();
  s.buffer = b;
  return s;
}
function osc(oc: OC, type: OscillatorType, f: number, detune = 0): OscillatorNode {
  const o = oc.createOscillator();
  o.type = type; o.frequency.value = f; o.detune.value = detune;
  return o;
}
function gainNode(oc: OC, v = 1): GainNode { const g = oc.createGain(); g.gain.value = v; return g; }
function filt(oc: OC, type: BiquadFilterType, f: number, q = 0.707): BiquadFilterNode {
  const b = oc.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b;
}
/** Linear attack then exponential decay envelope on a gain param. */
function ad(p: AudioParam, t: number, peak: number, atk: number, decayEnd: number): void {
  p.setValueAtTime(0.0001, t);
  p.linearRampToValueAtTime(peak, t + atk);
  p.exponentialRampToValueAtTime(0.0001, t + decayEnd);
}
function sat(oc: OC, amount: number): WaveShaperNode {
  const w = oc.createWaveShaper();
  const n = 2048; const c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * amount) / Math.tanh(amount); }
  w.curve = c; w.oversample = '2x';
  return w;
}
function chain(...nodes: AudioNode[]): AudioNode {
  for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]);
  return nodes[nodes.length - 1];
}
/** Simple feedback echo send into destination. */
function addEcho(oc: OC, src: AudioNode, time: number, fb: number, mix: number): void {
  const d = oc.createDelay(1); d.delayTime.value = time;
  const f = gainNode(oc, fb); const lp = filt(oc, 'lowpass', 3500); const m = gainNode(oc, mix);
  src.connect(d); d.connect(lp).connect(f).connect(d); lp.connect(m).connect(oc.destination);
}

// ---------- recipes ----------
const recipes: Record<SampleName, Recipe> = {
  kick(oc) {
    const o = osc(oc, 'sine', 160), g = gainNode(oc, 0);
    o.frequency.setValueAtTime(190, 0);
    o.frequency.exponentialRampToValueAtTime(52, 0.09);
    o.frequency.exponentialRampToValueAtTime(40, 0.4);
    ad(g.gain, 0, 1, 0.002, 0.5);
    chain(o, g, sat(oc, 2.2), oc.destination);
    const n = noise(oc, 0.05), ng = gainNode(oc, 0), nf = filt(oc, 'highpass', 2500);
    ad(ng.gain, 0, 0.35, 0.001, 0.02);
    chain(n, nf, ng, oc.destination);
    o.start(0); n.start(0);
    return 0;
  },
  snare(oc) {
    const n = noise(oc, 0.4), nf = filt(oc, 'highpass', 1500), nb = filt(oc, 'peaking', 5000, 0.8); nb.gain.value = 5;
    const ng = gainNode(oc, 0); ad(ng.gain, 0, 0.9, 0.001, 0.22);
    chain(n, nf, nb, ng, sat(oc, 1.5), oc.destination);
    const o = osc(oc, 'triangle', 220), og = gainNode(oc, 0);
    o.frequency.setValueAtTime(260, 0); o.frequency.exponentialRampToValueAtTime(170, 0.08);
    ad(og.gain, 0, 0.8, 0.001, 0.12);
    chain(o, og, oc.destination);
    n.start(0); o.start(0);
    return 0;
  },
  clap(oc) {
    const n = noise(oc, 0.45), bp = filt(oc, 'bandpass', 1300, 1.2), g = gainNode(oc, 0);
    const t = [0, 0.011, 0.024, 0.038];
    t.forEach((s, i) => {
      g.gain.setValueAtTime(0.0001, s);
      g.gain.linearRampToValueAtTime(0.9, s + 0.0015);
      if (i < t.length - 1) g.gain.exponentialRampToValueAtTime(0.15, s + 0.009);
    });
    g.gain.exponentialRampToValueAtTime(0.0001, 0.38);
    chain(n, bp, g, sat(oc, 1.8), oc.destination);
    n.start(0);
    return 0;
  },
  hat(oc) {
    const g = gainNode(oc, 0), hp = filt(oc, 'highpass', 7000), bp = filt(oc, 'bandpass', 10000, 0.8);
    ad(g.gain, 0, 0.6, 0.001, 0.07);
    [263, 400, 421, 474, 587, 845].forEach((f) => { const o = osc(oc, 'square', f * 1.5); o.connect(bp); o.start(0); });
    const n = noise(oc, 0.25), ng = gainNode(oc, 0.5); n.connect(ng).connect(bp); n.start(0);
    chain(bp, hp, g, oc.destination);
    return 0;
  },
  subdrop(oc) {
    const o = osc(oc, 'sine', 90), g = gainNode(oc, 0);
    o.frequency.setValueAtTime(110, 0); o.frequency.exponentialRampToValueAtTime(26, 1.5);
    g.gain.setValueAtTime(0.0001, 0); g.gain.linearRampToValueAtTime(1, 0.01);
    g.gain.setValueAtTime(1, 0.3); g.gain.exponentialRampToValueAtTime(0.0001, 1.7);
    chain(o, g, sat(oc, 2), oc.destination);
    o.start(0);
    return 0;
  },
  impact(oc) {
    const o = osc(oc, 'sine', 70), g = gainNode(oc, 0);
    o.frequency.setValueAtTime(95, 0); o.frequency.exponentialRampToValueAtTime(30, 1.4);
    ad(g.gain, 0, 1, 0.004, 2.6);
    chain(o, g, sat(oc, 1.8), oc.destination);
    const n = noise(oc, 3.2), nf = filt(oc, 'lowpass', 9000, 0.7), ng = gainNode(oc, 0);
    nf.frequency.setValueAtTime(10000, 0); nf.frequency.exponentialRampToValueAtTime(350, 2.8);
    ad(ng.gain, 0, 0.8, 0.002, 2.9);
    chain(n, nf, ng, oc.destination);
    addEcho(oc, ng, 0.09, 0.45, 0.3);
    o.start(0); n.start(0);
    return 0;
  },
  airhorn(oc) {
    // Three stacked, detuned saws on a major triad with a "baa-ba-baaa" gate and a pitch scoop per note.
    const out = gainNode(oc, 0), bp = filt(oc, 'bandpass', 1200, 0.5), pk = filt(oc, 'peaking', 2400, 1.2);
    pk.gain.value = 6;
    const notes: [number, number][] = [[0.0, 0.3], [0.38, 0.22], [0.68, 1.05]];
    const base = [440, 554.37, 659.25];
    for (const f of base) {
      for (const det of [-9, 0, 9]) {
        const o = osc(oc, 'sawtooth', f, det);
        for (const [t] of notes) {
          o.frequency.setValueAtTime(f * 0.9, t);
          o.frequency.exponentialRampToValueAtTime(f, t + 0.045);
        }
        const last = notes[2][0] + 0.2;
        const lfo = osc(oc, 'sine', 5.5), lg = gainNode(oc, 0);
        lg.gain.setValueAtTime(0, last); lg.gain.linearRampToValueAtTime(f * 0.006, last + 0.5);
        lfo.connect(lg).connect(o.frequency); lfo.start(0);
        o.connect(out); o.start(0);
      }
    }
    const peak = 0.16;
    out.gain.setValueAtTime(0, 0);
    notes.forEach(([t, len], i) => {
      out.gain.setValueAtTime(0, t - 0.001 < 0 ? 0 : t - 0.001);
      out.gain.linearRampToValueAtTime(peak, t + 0.012);
      if (i === 2) {
        out.gain.setValueAtTime(peak, t + len - 0.3);
        out.gain.exponentialRampToValueAtTime(0.0005, t + len + 0.05);
      } else {
        out.gain.setValueAtTime(peak, t + len - 0.02);
        out.gain.linearRampToValueAtTime(0, t + len);
      }
    });
    chain(out, sat(oc, 2.5), bp, pk, oc.destination);
    addEcho(oc, pk, 0.18, 0.28, 0.18);
    return 0;
  },
  siren(oc) {
    const o = osc(oc, 'square', 800), lfo = osc(oc, 'triangle', 0.9), lg = gainNode(oc, 420);
    lfo.connect(lg).connect(o.frequency);
    o.frequency.setValueAtTime(300, 0); o.frequency.linearRampToValueAtTime(900, 0.4);
    const lfo2 = osc(oc, 'sine', 7), lg2 = gainNode(oc, 12); lfo2.connect(lg2).connect(o.detune);
    const g = gainNode(oc, 0), lp = filt(oc, 'lowpass', 2600, 1.4);
    g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.5, 0.05);
    g.gain.setValueAtTime(0.5, 2.0); g.gain.exponentialRampToValueAtTime(0.0005, 3.1);
    chain(o, lp, g, oc.destination);
    addEcho(oc, g, 0.33, 0.5, 0.4);
    o.start(0); lfo.start(0); lfo2.start(0);
    return 0;
  },
  rocket(oc) {
    // Rising alarm whoops over a noise launch roar.
    const o = osc(oc, 'sawtooth', 400), g = gainNode(oc, 0), lp = filt(oc, 'lowpass', 3500, 1);
    for (let i = 0; i < 3; i++) {
      const t = i * 0.42;
      o.frequency.setValueAtTime(380 + i * 60, t);
      o.frequency.exponentialRampToValueAtTime(1500 + i * 250, t + 0.38);
    }
    o.frequency.setValueAtTime(1000, 1.3); o.frequency.exponentialRampToValueAtTime(5200, 2.3);
    g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(0.35, 0.03);
    g.gain.setValueAtTime(0.35, 1.9); g.gain.exponentialRampToValueAtTime(0.0005, 2.5);
    chain(o, lp, g, oc.destination);
    const n = noise(oc, 2.6), bp = filt(oc, 'bandpass', 300, 0.8), ng = gainNode(oc, 0);
    bp.frequency.setValueAtTime(300, 0); bp.frequency.exponentialRampToValueAtTime(4000, 2.2);
    ng.gain.setValueAtTime(0.0001, 0); ng.gain.exponentialRampToValueAtTime(0.9, 1.6);
    ng.gain.exponentialRampToValueAtTime(0.0005, 2.55);
    chain(n, bp, ng, oc.destination);
    o.start(0); n.start(0);
    return 0;
  },
  laser(oc) {
    const o = osc(oc, 'sawtooth', 4000), o2 = osc(oc, 'square', 2000), g = gainNode(oc, 0);
    o.frequency.setValueAtTime(5000, 0); o.frequency.exponentialRampToValueAtTime(110, 0.3);
    o2.frequency.setValueAtTime(2500, 0); o2.frequency.exponentialRampToValueAtTime(55, 0.3);
    const m = osc(oc, 'sine', 90), mg = gainNode(oc, 600);
    mg.gain.setValueAtTime(900, 0); mg.gain.exponentialRampToValueAtTime(10, 0.3);
    m.connect(mg).connect(o.frequency);
    const g2 = gainNode(oc, 0.5); o2.connect(g2);
    ad(g.gain, 0, 0.7, 0.002, 0.42);
    const lp = filt(oc, 'lowpass', 7000);
    o.connect(g); g2.connect(g); chain(g, lp, oc.destination);
    o.start(0); o2.start(0); m.start(0);
    return 0;
  },
  zap(oc) {
    // Ring-modulated saw dive plus a crackle of band-swept noise.
    const car = osc(oc, 'sawtooth', 900), mod = osc(oc, 'square', 130), rm = gainNode(oc, 0);
    car.frequency.setValueAtTime(1600, 0); car.frequency.exponentialRampToValueAtTime(70, 0.3);
    mod.frequency.setValueAtTime(260, 0); mod.frequency.exponentialRampToValueAtTime(40, 0.3);
    mod.connect(rm.gain);
    const g = gainNode(oc, 0); ad(g.gain, 0, 0.8, 0.001, 0.36);
    chain(car, rm, g, sat(oc, 2), oc.destination);
    const n = noise(oc, 0.3), bp = filt(oc, 'bandpass', 6000, 2), ng = gainNode(oc, 0);
    bp.frequency.setValueAtTime(7000, 0); bp.frequency.exponentialRampToValueAtTime(500, 0.22);
    ad(ng.gain, 0, 0.6, 0.001, 0.2);
    chain(n, bp, ng, oc.destination);
    car.start(0); mod.start(0); n.start(0);
    return 0;
  },
  riser(oc) {
    const n = noise(oc, 4.2), hp = filt(oc, 'highpass', 200, 1.5), ng = gainNode(oc, 0);
    hp.frequency.setValueAtTime(200, 0); hp.frequency.exponentialRampToValueAtTime(9000, 3.9);
    ng.gain.setValueAtTime(0.02, 0); ng.gain.exponentialRampToValueAtTime(1, 3.9);
    ng.gain.linearRampToValueAtTime(0, 4.0);
    chain(n, hp, ng, oc.destination);
    const o = osc(oc, 'sawtooth', 110), o2 = osc(oc, 'sawtooth', 110, 14), lp = filt(oc, 'lowpass', 600, 2), og = gainNode(oc, 0);
    for (const x of [o, o2]) { x.frequency.setValueAtTime(110, 0); x.frequency.exponentialRampToValueAtTime(1100, 3.9); x.connect(lp); x.start(0); }
    lp.frequency.setValueAtTime(400, 0); lp.frequency.exponentialRampToValueAtTime(9000, 3.9);
    og.gain.setValueAtTime(0.02, 0); og.gain.exponentialRampToValueAtTime(0.4, 3.9); og.gain.linearRampToValueAtTime(0, 4.0);
    chain(lp, og, oc.destination);
    n.start(0);
    return 0;
  },
  scratch(oc) {
    // Back-and-forth platter motion: pitch and level follow |velocity|, dipping to silence at each turnaround.
    const rate = 2000, N = Math.floor(rate * 1.0);
    const strokes: [number, number][] = [[0.0, 0.16], [0.16, 0.13], [0.29, 0.09], [0.38, 0.09], [0.47, 0.34], [0.81, 0.19]];
    const fr = new Float32Array(N), am = new Float32Array(N);
    for (const [t0, len] of strokes) {
      const peak = 0.9 + Math.random() * 0.4;
      for (let i = Math.floor(t0 * rate); i < Math.min(N, Math.floor((t0 + len) * rate)); i++) {
        const u = (i / rate - t0) / len;
        const v = Math.sin(Math.PI * u) * peak;
        fr[i] = 70 + 650 * v; am[i] = Math.min(1, v * 1.6);
      }
    }
    const a = osc(oc, 'sawtooth', 200), b = osc(oc, 'sawtooth', 200, 18), g = gainNode(oc, 0);
    a.frequency.setValueCurveAtTime(fr, 0, 1.0); b.frequency.setValueCurveAtTime(fr, 0, 1.0);
    g.gain.setValueCurveAtTime(am, 0, 1.0);
    const bp = filt(oc, 'bandpass', 1500, 1.1), hs = filt(oc, 'highshelf', 4000); hs.gain.value = 5;
    const mix = gainNode(oc, 0.5); a.connect(mix); b.connect(mix);
    const n = noise(oc, 1.1), nf = filt(oc, 'bandpass', 3000, 0.8), ng = gainNode(oc, 0.15); chain(n, nf, ng, mix);
    chain(mix, g, bp, sat(oc, 1.6), hs, oc.destination);
    a.start(0); b.start(0); n.start(0);
    return 0;
  },
  rewind(oc) {
    // Tape spooling backwards: filtered noise whoosh + whining pitch rise with flutter, then a quick stop.
    const n = noise(oc, 1.3), bp = filt(oc, 'bandpass', 400, 3), ng = gainNode(oc, 0);
    bp.frequency.setValueAtTime(400, 0); bp.frequency.exponentialRampToValueAtTime(6500, 1.0);
    ng.gain.setValueAtTime(0, 0); ng.gain.linearRampToValueAtTime(0.8, 0.9); ng.gain.linearRampToValueAtTime(0, 1.05);
    chain(n, bp, ng, oc.destination);
    const o = osc(oc, 'sawtooth', 200), lp = filt(oc, 'lowpass', 3000, 2), og = gainNode(oc, 0);
    o.frequency.setValueAtTime(180, 0); o.frequency.exponentialRampToValueAtTime(2600, 1.0);
    const fl = osc(oc, 'sine', 17), fg = gainNode(oc, 40); fl.connect(fg).connect(o.detune);
    og.gain.setValueAtTime(0, 0); og.gain.linearRampToValueAtTime(0.3, 0.8); og.gain.linearRampToValueAtTime(0, 1.05);
    chain(o, lp, og, oc.destination);
    n.start(0); o.start(0); fl.start(0);
    return 0;
  },
  vox(oc) {
    // Formant "hey!": breathy h, then a voiced e->i glide through three formant filters.
    const src = osc(oc, 'sawtooth', 200), env = gainNode(oc, 0);
    src.frequency.setValueAtTime(190, 0.05); src.frequency.linearRampToValueAtTime(260, 0.22); src.frequency.linearRampToValueAtTime(215, 0.55);
    ad(env.gain, 0.05, 1, 0.025, 0.5);
    src.connect(env);
    const n = noise(oc, 0.7), nenv = gainNode(oc, 0); ad(nenv.gain, 0, 0.6, 0.01, 0.1);
    n.connect(nenv);
    const mix = gainNode(oc, 1); env.connect(mix); nenv.connect(mix);
    const fm: [number, number, number, number, number][] = [
      [600, 380, 1.0, 9, 0], [1700, 2250, 0.7, 11, 0], [2600, 3000, 0.4, 12, 0],
    ];
    const out = gainNode(oc, 1.4);
    for (const [f0, f1, gv, q] of fm) {
      const f = filt(oc, 'bandpass', f0, q); f.frequency.setValueAtTime(f0, 0.05); f.frequency.linearRampToValueAtTime(f1, 0.4);
      const g = gainNode(oc, gv); mix.connect(f); f.connect(g).connect(out);
    }
    chain(out, sat(oc, 1.5), oc.destination);
    src.start(0); n.start(0);
    return 0;
  },
  bell(oc) {
    const partials: [number, number, number][] = [[1, 1, 2.2], [2.76, 0.6, 1.5], [5.4, 0.35, 0.9], [8.93, 0.2, 0.5]];
    const f0 = 880;
    for (const [r, a, d] of partials) {
      const o = osc(oc, 'sine', f0 * r), g = gainNode(oc, 0);
      ad(g.gain, 0, a * 0.5, 0.002, d);
      chain(o, g, oc.destination); o.start(0);
    }
    const c = osc(oc, 'sine', f0), m = osc(oc, 'sine', f0 * 3.5), mg = gainNode(oc, 0), cg = gainNode(oc, 0);
    mg.gain.setValueAtTime(900, 0); mg.gain.exponentialRampToValueAtTime(1, 1.2);
    m.connect(mg).connect(c.frequency);
    ad(cg.gain, 0, 0.45, 0.001, 1.6);
    chain(c, cg, oc.destination);
    addEcho(oc, cg, 0.21, 0.35, 0.25);
    c.start(0); m.start(0);
    return 0;
  },
};

function normalize(buf: AudioBuffer, peak = 0.9): void {
  let max = 0;
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) { const a = Math.abs(d[i]); if (a > max) max = a; }
  }
  const k = max > 0 ? peak / max : 1;
  const fade = Math.floor(buf.sampleRate * 0.004);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) d[i] *= k;
    for (let i = 0; i < fade && i < d.length; i++) d[d.length - 1 - i] *= i / fade; // click-free tail
  }
}

export class Sampler {
  private ctx: AudioContext;
  private out: GainNode;
  private buffers = new Map<SampleName, AudioBuffer>();
  private voices = new Map<SampleName, { src: AudioBufferSourceNode; g: GainNode }>();
  readonly ready: Promise<void>;

  constructor(ctx: AudioContext, dest: AudioNode) {
    this.ctx = ctx;
    this.out = ctx.createGain();
    this.out.gain.value = 0.8;
    this.out.connect(dest);
    this.ready = this.renderAll();
  }

  private async renderAll(): Promise<void> {
    if (typeof OfflineAudioContext === 'undefined') return;
    for (const name of SAMPLE_NAMES) {
      try {
        const oc = new OfflineAudioContext(1, Math.ceil(SR * DURATIONS[name]), SR);
        recipes[name](oc);
        const buf = await oc.startRendering();
        normalize(buf);
        this.buffers.set(name, buf);
      } catch { /* a failed recipe just leaves that pad silent */ }
    }
  }

  setVolume(v: number): void {
    this.out.gain.setTargetAtTime(Math.min(1.5, Math.max(0, v)), this.ctx.currentTime, 0.01);
  }

  play(name: SampleName): void {
    const buf = this.buffers.get(name);
    if (!buf) return;
    const now = this.ctx.currentTime;
    const prev = this.voices.get(name);
    if (prev) { // retrigger: quick fade of the previous instance
      prev.g.gain.cancelScheduledValues(now);
      prev.g.gain.setTargetAtTime(0, now, 0.008);
      try { prev.src.stop(now + 0.05); } catch { /* ended */ }
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const g = this.ctx.createGain();
    src.connect(g).connect(this.out);
    src.onended = () => { try { src.disconnect(); g.disconnect(); } catch { /* */ } if (this.voices.get(name)?.src === src) this.voices.delete(name); };
    src.start(now);
    this.voices.set(name, { src, g });
  }
}
