import type { FxSlotState, FxType } from '../types';
import { ECHO_DIVISIONS, clamp, pickIndex } from './math';

const TC = 0.02;

export interface FxUnit {
  input: AudioNode;
  output: AudioNode;
  /** 'additive': wet is added on top of dry. 'blend': dry is crossfaded with wet. */
  mode: 'additive' | 'blend';
  setParam(p: number): void;
  setBpm(bpm: number): void;
  dispose(): void;
}

function createEcho(ctx: AudioContext): FxUnit {
  const input = ctx.createGain();
  const delay = ctx.createDelay(4);
  const fb = ctx.createGain();
  const tone = ctx.createBiquadFilter();
  const out = ctx.createGain();
  tone.type = 'lowpass';
  tone.frequency.value = 4500;
  fb.gain.value = 0.48;
  input.connect(delay);
  delay.connect(out);
  delay.connect(tone);
  tone.connect(fb);
  fb.connect(delay);
  let beats = ECHO_DIVISIONS[2];
  let bpm = 120;
  let lastT = -1;
  const update = (immediate: boolean) => {
    const t = Math.min(3.9, (beats * 60) / bpm);
    if (Math.abs(t - lastT) < 1e-4) return;
    lastT = t;
    if (immediate) delay.delayTime.value = t;
    else delay.delayTime.setTargetAtTime(t, ctx.currentTime, 0.08);
  };
  update(true);
  return {
    input, output: out, mode: 'additive',
    setParam(p) { beats = ECHO_DIVISIONS[pickIndex(p, ECHO_DIVISIONS.length)]; update(false); },
    setBpm(b) { if (b > 0) { bpm = b; update(false); } },
    dispose() { [input, delay, fb, tone, out].forEach((n) => n.disconnect()); },
  };
}

function makeImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.floor(sr * seconds));
  const buf = ctx.createBuffer(2, len, sr);
  for (let c = 0; c < 2; c++) {
    const d = buf.getChannelData(c);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / len;
      const env = Math.exp(-6.9 * t) * Math.min(1, i / (sr * 0.004));
      const n = Math.random() * 2 - 1;
      // progressively darker tail
      const a = 0.65 - 0.5 * t;
      lp += (n - lp) * a;
      d[i] = lp * env;
    }
  }
  return buf;
}

const REVERB_STEPS = 12;
function createReverb(ctx: AudioContext): FxUnit {
  const input = ctx.createGain();
  const out = ctx.createGain();
  const convs = [ctx.createConvolver(), ctx.createConvolver()];
  const gains = [ctx.createGain(), ctx.createGain()];
  const cache = new Map<number, AudioBuffer>();
  const impulse = (step: number) => {
    let b = cache.get(step);
    if (!b) { b = makeImpulse(ctx, 0.4 + (step / (REVERB_STEPS - 1)) * 3.6); cache.set(step, b); }
    return b;
  };
  convs.forEach((c, i) => { input.connect(c); c.connect(gains[i]); gains[i].connect(out); });
  let active = 0;
  let step = Math.round(0.5 * (REVERB_STEPS - 1));
  convs[0].buffer = impulse(step);
  gains[0].gain.value = 1;
  gains[1].gain.value = 0;
  return {
    input, output: out, mode: 'additive',
    setParam(p) {
      const s = Math.round(clamp(p, 0, 1) * (REVERB_STEPS - 1));
      if (s === step) return;
      step = s;
      const idle = 1 - active;
      convs[idle].buffer = impulse(s);
      const now = ctx.currentTime;
      gains[idle].gain.setTargetAtTime(1, now, 0.04);
      gains[active].gain.setTargetAtTime(0, now, 0.04);
      active = idle;
    },
    setBpm() { /* not tempo-synced */ },
    dispose() { [input, out, ...convs, ...gains].forEach((n) => n.disconnect()); },
  };
}

function createFlanger(ctx: AudioContext): FxUnit {
  const input = ctx.createGain();
  const out = ctx.createGain();
  const direct = ctx.createGain();
  const wetG = ctx.createGain();
  const delay = ctx.createDelay(0.05);
  const fb = ctx.createGain();
  const lfo = ctx.createOscillator();
  const depth = ctx.createGain();
  direct.gain.value = 0.7; wetG.gain.value = 0.7; fb.gain.value = 0.55;
  delay.delayTime.value = 0.004;
  depth.gain.value = 0.003;
  lfo.type = 'sine';
  lfo.frequency.value = 0.4;
  input.connect(direct).connect(out);
  input.connect(delay);
  delay.connect(wetG).connect(out);
  delay.connect(fb).connect(delay);
  lfo.connect(depth).connect(delay.delayTime);
  lfo.start();
  return {
    input, output: out, mode: 'blend',
    setParam(p) { lfo.frequency.setTargetAtTime(0.1 * Math.pow(40, clamp(p, 0, 1)), ctx.currentTime, 0.05); },
    setBpm() {},
    dispose() { try { lfo.stop(); } catch { /* */ } [input, out, direct, wetG, delay, fb, lfo, depth].forEach((n) => n.disconnect()); },
  };
}

function createPhaser(ctx: AudioContext): FxUnit {
  const input = ctx.createGain();
  const out = ctx.createGain();
  const direct = ctx.createGain();
  const wetG = ctx.createGain();
  const lfo = ctx.createOscillator();
  const depth = ctx.createGain();
  direct.gain.value = 0.7; wetG.gain.value = 0.7;
  depth.gain.value = 600;
  lfo.type = 'sine';
  lfo.frequency.value = 0.4;
  const aps: BiquadFilterNode[] = [];
  let prev: AudioNode = input;
  for (let i = 0; i < 4; i++) {
    const ap = ctx.createBiquadFilter();
    ap.type = 'allpass';
    ap.frequency.value = 900;
    ap.Q.value = 0.8;
    depth.connect(ap.frequency);
    prev.connect(ap);
    prev = ap;
    aps.push(ap);
  }
  input.connect(direct).connect(out);
  prev.connect(wetG).connect(out);
  lfo.connect(depth);
  lfo.start();
  return {
    input, output: out, mode: 'blend',
    setParam(p) { lfo.frequency.setTargetAtTime(0.1 * Math.pow(40, clamp(p, 0, 1)), ctx.currentTime, 0.05); },
    setBpm() {},
    dispose() { try { lfo.stop(); } catch { /* */ } [input, out, direct, wetG, lfo, depth, ...aps].forEach((n) => n.disconnect()); },
  };
}

function bitCurve(bits: number): Float32Array {
  const N = 65537;
  const levels = Math.pow(2, bits - 1);
  const c = new Float32Array(N);
  for (let i = 0; i < N; i++) {
    const x = (i / (N - 1)) * 2 - 1;
    c[i] = Math.round(x * levels) / levels;
  }
  return c;
}
function createBitcrush(ctx: AudioContext): FxUnit {
  const input = ctx.createGain();
  const shaper = ctx.createWaveShaper();
  const out = ctx.createGain();
  out.gain.value = 0.9;
  input.connect(shaper).connect(out);
  let bits = -1;
  const set = (p: number) => {
    const b = Math.round(8 - clamp(p, 0, 1) * 6);
    if (b === bits) return;
    bits = b;
    shaper.curve = bitCurve(b);
  };
  set(0.5);
  return {
    input, output: out, mode: 'blend',
    setParam: set,
    setBpm() {},
    dispose() { [input, shaper, out].forEach((n) => n.disconnect()); },
  };
}

const GATE_PULSES = [1, 2, 4, 8];
function createGate(ctx: AudioContext): FxUnit {
  const input = ctx.createGain();
  const amp = ctx.createGain();
  const lfo = ctx.createOscillator();
  const smooth = ctx.createBiquadFilter();
  const lfoGain = ctx.createGain();
  amp.gain.value = 0.5;
  lfoGain.gain.value = 0.5;
  lfo.type = 'square';
  smooth.type = 'lowpass';
  smooth.frequency.value = 250;
  smooth.Q.value = 0.5;
  lfo.connect(smooth).connect(lfoGain).connect(amp.gain);
  input.connect(amp);
  let pulses = GATE_PULSES[1];
  let bpm = 120;
  // one square cycle (on+off) per pulse
  const updateFreq = () => lfo.frequency.setTargetAtTime((bpm / 60) * pulses, ctx.currentTime, 0.05);
  lfo.frequency.value = (bpm / 60) * pulses;
  lfo.start();
  return {
    input, output: amp, mode: 'blend',
    setParam(p) { pulses = GATE_PULSES[pickIndex(p, GATE_PULSES.length)]; updateFreq(); },
    setBpm(b) { if (b > 0) { bpm = b; updateFreq(); } },
    dispose() { try { lfo.stop(); } catch { /* */ } [input, amp, lfo, smooth, lfoGain].forEach((n) => n.disconnect()); },
  };
}

export function createFxUnit(ctx: AudioContext, type: FxType): FxUnit {
  switch (type) {
    case 'echo': return createEcho(ctx);
    case 'reverb': return createReverb(ctx);
    case 'flanger': return createFlanger(ctx);
    case 'phaser': return createPhaser(ctx);
    case 'bitcrush': return createBitcrush(ctx);
    case 'gate': return createGate(ctx);
  }
}

/** One FX slot: input → (dry | unit → wet) → output. Always connected; bypass = wet 0. */
export class FxSlot {
  readonly input: GainNode;
  readonly output: GainNode;
  private dry: GainNode;
  private wetG: GainNode;
  private cur: { type: FxType; unit: FxUnit; fade: GainNode } | null = null;
  private bpm = 120;

  constructor(private ctx: AudioContext) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.dry = ctx.createGain();
    this.wetG = ctx.createGain();
    this.wetG.gain.value = 0;
    this.input.connect(this.dry).connect(this.output);
    this.wetG.connect(this.output);
  }

  setBpm(bpm: number): void {
    this.bpm = bpm;
    this.cur?.unit.setBpm(bpm);
  }

  apply(s: FxSlotState): void {
    const ctx = this.ctx;
    const now = ctx.currentTime;
    if (!this.cur || this.cur.type !== s.type) {
      const old = this.cur;
      const unit = createFxUnit(ctx, s.type);
      const fade = ctx.createGain();
      fade.gain.value = 0;
      this.input.connect(unit.input);
      unit.output.connect(fade).connect(this.wetG);
      fade.gain.setTargetAtTime(1, now, 0.01);
      unit.setBpm(this.bpm);
      this.cur = { type: s.type, unit, fade };
      if (old) {
        old.fade.gain.setTargetAtTime(0, now, 0.01);
        setTimeout(() => {
          try { this.input.disconnect(old.unit.input); } catch { /* */ }
          old.unit.dispose();
          old.fade.disconnect();
        }, 200);
      }
    }
    const unit = this.cur.unit;
    unit.setParam(s.param);
    const w = s.enabled ? clamp(s.wet, 0, 1) : 0;
    const dry = unit.mode === 'additive' ? 1 : 1 - w;
    this.dry.gain.setTargetAtTime(dry, now, TC);
    this.wetG.gain.setTargetAtTime(w, now, TC);
  }
}

/** Three slots in series. */
export class FxBus {
  readonly input: GainNode;
  readonly output: GainNode;
  readonly slots: FxSlot[];
  constructor(ctx: AudioContext, n = 3) {
    this.input = ctx.createGain();
    this.output = ctx.createGain();
    this.slots = Array.from({ length: n }, () => new FxSlot(ctx));
    let prev: AudioNode = this.input;
    for (const s of this.slots) { prev.connect(s.input); prev = s.output; }
    prev.connect(this.output);
  }
  setBpm(bpm: number): void { this.slots.forEach((s) => s.setBpm(bpm)); }
}
