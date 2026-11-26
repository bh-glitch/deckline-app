import type { AnalysisResult, DeckEngine, DeckId, DeckState, TrackMeta } from '../types';
import {
  BRAKE_K, brakeDistance, clamp, clampLoopBeats, eqDb, filterParams, integratePosition, snapToBeat,
} from './math';

const FADE = 0.005;     // click-free jump / play / pause fade (s)
const TC = 0.015;       // param smoothing time constant (s)
const BEND_DEPTH = 0.1;
const FALLBACK_BPM = 120;

interface Voice { src: AudioBufferSourceNode; gain: GainNode }

type HoldableParam = AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
function hold(p: AudioParam, t: number): void {
  const h = p as HoldableParam;
  if (typeof h.cancelAndHoldAtTime === 'function') h.cancelAndHoldAtTime(t);
  else p.cancelScheduledValues(t);
}

export class Deck implements DeckEngine {
  readonly id: DeckId;
  readonly output: GainNode;
  readonly analyser: AnalyserNode;

  private ctx: AudioContext;
  private input: GainNode;      // trim
  private eqLow: BiquadFilterNode;
  private eqMid: BiquadFilterNode;
  private eqHigh: BiquadFilterNode;
  private lp: BiquadFilterNode;
  private hp: BiquadFilterNode;
  private fbypass: GainNode;  // true bypass path around the lp/hp filter
  private fwet: GainNode;
  private post: GainNode;
  private filtActive = false;
  private braking: { t0: number; T: number; r0: number; pos0: number } | null = null;
  private brakeTimer: ReturnType<typeof setTimeout> | null = null;

  private buffer: AudioBuffer | null = null;
  private voice: Voice | null = null;
  private anchor = { time: 0, pos: 0, rate: 1 };
  private bendAmt = 0;
  private nudge = 0;
  private previewing = false;
  private scratchAcc = 0;
  private scratchLast = 0;
  private scratchTimer: ReturnType<typeof setTimeout> | null = null;

  private s: DeckState;
  private snap: DeckState;
  private listeners = new Set<(s: DeckState) => void>();

  constructor(ctx: AudioContext, id: DeckId) {
    this.ctx = ctx;
    this.id = id;
    this.input = ctx.createGain();
    this.eqLow = ctx.createBiquadFilter();
    this.eqMid = ctx.createBiquadFilter();
    this.eqHigh = ctx.createBiquadFilter();
    this.lp = ctx.createBiquadFilter();
    this.hp = ctx.createBiquadFilter();
    this.fbypass = ctx.createGain();
    this.fwet = ctx.createGain();
    this.post = ctx.createGain();
    this.output = ctx.createGain();
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.3;

    this.eqLow.type = 'lowshelf'; this.eqLow.frequency.value = 200;
    this.eqMid.type = 'peaking'; this.eqMid.frequency.value = 1000; this.eqMid.Q.value = 0.6;
    this.eqHigh.type = 'highshelf'; this.eqHigh.frequency.value = 4000;
    this.lp.type = 'lowpass'; this.lp.frequency.value = 20000; this.lp.Q.value = 0.707;
    this.hp.type = 'highpass'; this.hp.frequency.value = 20; this.hp.Q.value = 0.707;

    // trim -> eq low -> mid -> high -> (bypass | lp -> hp -> wet) -> post -> fader(output)
    this.input.connect(this.eqLow).connect(this.eqMid).connect(this.eqHigh);
    this.eqHigh.connect(this.fbypass).connect(this.post);
    this.eqHigh.connect(this.lp).connect(this.hp).connect(this.fwet).connect(this.post);
    this.fbypass.gain.value = 1;
    this.fwet.gain.value = 0;
    this.post.connect(this.output);
    this.post.connect(this.analyser); // pre-fader tap
    this.output.gain.value = 1;

    this.s = {
      id, trackId: null, loaded: false, playing: false, duration: 0, rate: 1, pitchRange: 0.08,
      bpm: null, firstBeat: 0, cuePoint: 0, hotCues: new Array(8).fill(null), loop: null,
      gain: 1, trim: 1, eq: { low: 0, mid: 0, high: 0 }, filter: 0, keyLock: false, synced: false,
    };
    this.snap = this.makeSnap();
  }

  // ---------- state / subscription ----------
  private makeSnap(): DeckState {
    const s = this.s;
    return { ...s, eq: { ...s.eq }, hotCues: s.hotCues.slice(), loop: s.loop ? { ...s.loop } : null };
  }
  private emit(): void {
    this.snap = this.makeSnap();
    this.listeners.forEach((fn) => fn(this.snap));
  }
  getState(): DeckState { return this.snap; }
  subscribe(fn: (s: DeckState) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  // ---------- helpers ----------
  private get loaded(): boolean { return this.buffer !== null; }
  private effRate(): number { return this.s.rate * (1 + BEND_DEPTH * this.bendAmt) * (1 + this.nudge); }
  private activeLoop() { return this.s.loop && this.s.loop.active ? this.s.loop : null; }
  private beatLen(): number { return 60 / (this.s.bpm ?? FALLBACK_BPM); }
  private snapPos(t: number): number {
    return this.s.bpm ? snapToBeat(t, this.s.bpm, this.s.firstBeat) : t;
  }

  /** Effective bpm (bpm * rate), or null if unknown. */
  getEffectiveBpm(): number | null { return this.s.bpm ? this.s.bpm * this.s.rate : null; }
  isBending(): boolean { return this.bendAmt !== 0; }

  getPosition(): number {
    if (this.braking) {
      const b = this.braking;
      const tau = clamp(this.ctx.currentTime - b.t0, 0, b.T);
      return clamp(b.pos0 + brakeDistance(b.r0, b.T, tau), 0, this.s.duration);
    }
    if (!this.voice) return this.anchor.pos;
    const a = this.anchor;
    return integratePosition(a.pos, a.time, a.rate, this.ctx.currentTime, this.s.duration, this.activeLoop());
  }

  // ---------- voice management ----------
  private startVoice(pos: number, when?: number): void {
    const ctx = this.ctx;
    const now = Math.max(when ?? 0, ctx.currentTime);
    const src = ctx.createBufferSource();
    src.buffer = this.buffer;
    const rate = this.effRate();
    src.playbackRate.value = rate;
    const lp = this.activeLoop();
    if (lp) { src.loopStart = lp.start; src.loopEnd = lp.end; src.loop = true; }
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + FADE);
    src.connect(gain).connect(this.input);
    const voice: Voice = { src, gain };
    src.onended = () => this.handleEnded(voice);
    src.start(now, clamp(pos, 0, Math.max(0, this.s.duration - 0.001)));
    this.voice = voice;
    this.anchor = { time: now, pos, rate };
  }

  private stopVoice(v: Voice | null): void {
    if (!v) return;
    const now = this.ctx.currentTime;
    v.src.onended = null;
    hold(v.gain.gain, now);
    v.gain.gain.setTargetAtTime(0, now, FADE / 3);
    try { v.src.stop(now + FADE * 3); } catch { /* already stopped */ }
    setTimeout(() => { try { v.src.disconnect(); v.gain.disconnect(); } catch { /* */ } }, 100);
  }

  private handleEnded(v: Voice): void {
    if (v !== this.voice) return;
    this.clearBrake();
    this.voice = null;
    this.anchor = { time: this.ctx.currentTime, pos: this.s.duration, rate: 1 };
    this.previewing = false;
    this.s.playing = false;
    this.emit();
  }

  /** Re-anchor to "now" with the current effective rate (call before changing rate or loop). */
  private reanchor(): void {
    const pos = this.getPosition();
    this.anchor = { time: this.ctx.currentTime, pos, rate: this.effRate() };
  }

  private applyRate(): void {
    if (!this.voice) return;
    if (this.braking) this.endBrakeRestore();
    this.reanchor();
    this.voice.src.playbackRate.setValueAtTime(this.anchor.rate, this.ctx.currentTime);
  }

  // ---------- transport ----------
  load(buffer: AudioBuffer, meta: TrackMeta, analysis?: AnalysisResult): void {
    this.clearBrake();
    this.stopVoice(this.voice);
    this.voice = null;
    this.buffer = buffer;
    this.bendAmt = 0; this.nudge = 0; this.previewing = false;
    const s = this.s;
    s.trackId = meta.id;
    s.loaded = true;
    s.playing = false;
    s.duration = buffer.duration;
    s.rate = 1;
    s.bpm = analysis?.bpm ?? meta.bpm ?? null;
    s.firstBeat = analysis?.firstBeat ?? meta.firstBeat ?? 0;
    s.cuePoint = clamp(meta.cuePoint ?? 0, 0, buffer.duration);
    const hc = meta.hotCues ?? [];
    s.hotCues = Array.from({ length: 8 }, (_, i) => (typeof hc[i] === 'number' ? (hc[i] as number) : null));
    s.loop = null;
    s.synced = false;
    this.anchor = { time: this.ctx.currentTime, pos: s.cuePoint, rate: 1 };
    this.emit();
  }

  unload(): void {
    this.clearBrake();
    this.stopVoice(this.voice);
    this.voice = null;
    this.buffer = null;
    this.bendAmt = 0; this.nudge = 0; this.previewing = false;
    const s = this.s;
    s.trackId = null; s.loaded = false; s.playing = false; s.duration = 0; s.rate = 1;
    s.bpm = null; s.firstBeat = 0; s.cuePoint = 0; s.hotCues = new Array(8).fill(null);
    s.loop = null; s.synced = false;
    this.anchor = { time: this.ctx.currentTime, pos: 0, rate: 1 };
    this.emit();
  }

  play(): void {
    this.previewing = false;
    if (!this.loaded || this.s.playing) return;
    this.startPlayback();
  }

  /** Start playback at audio-clock time `when` from the current (parked) position. */
  playAt(when: number): void {
    this.previewing = false;
    if (!this.loaded || this.s.playing) return;
    this.startPlayback(when);
  }

  private startPlayback(when?: number): void {
    let pos = this.anchor.pos;
    if (pos >= this.s.duration - 0.01) pos = 0;
    this.startVoice(pos, when);
    this.s.playing = true;
    this.emit();
  }

  pause(): void {
    this.previewing = false;
    this.pauseInternal();
  }

  private pauseInternal(): void {
    if (!this.loaded || !this.s.playing) return;
    const pos = this.getPosition();
    this.stopVoice(this.voice);
    this.voice = null;
    this.clearBrake();
    this.anchor = { time: this.ctx.currentTime, pos, rate: this.effRate() };
    this.s.playing = false;
    this.emit();
  }

  togglePlay(): void {
    if (this.previewing) { this.previewing = false; return; } // latch preview into play
    if (this.s.playing) this.pause(); else this.play();
  }

  seek(seconds: number): void {
    if (!this.loaded) return;
    const t = clamp(seconds, 0, this.s.duration);
    this.clearBrake();
    if (this.voice) {
      const old = this.voice;
      this.startVoice(t);      // sets this.voice to the new voice
      this.stopVoice(old);     // 5ms crossfade between voices
    } else {
      this.anchor = { time: this.ctx.currentTime, pos: t, rate: this.effRate() };
    }
  }

  // ---------- tempo ----------
  setRate(rate: number): void {
    if (this.s.synced) this.s.synced = false;
    this.setRateInternal(rate, false);
  }

  /** Used by the mixer for sync; may exceed pitchRange (auto-widens range). */
  setSyncRate(rate: number): void {
    const dev = Math.abs(rate - 1);
    for (const r of [0.08, 0.16, 0.5]) {
      if (dev <= r + 1e-9) { if (r > this.s.pitchRange) this.s.pitchRange = r; break; }
    }
    this.setRateInternal(rate, true);
  }

  private setRateInternal(rate: number, _forced: boolean): void {
    const r = clamp(rate, 1 - this.s.pitchRange, 1 + this.s.pitchRange);
    this.s.rate = r;
    this.applyRate();
    this.emit();
  }

  setSynced(on: boolean): void {
    if (this.s.synced === on) return;
    this.s.synced = on;
    this.emit();
  }

  /** Tiny phase-lock rate trim from the mixer (not part of state). */
  setNudge(n: number): void {
    if (this.braking) return;
    if (Math.abs(n - this.nudge) < 1e-6) return;
    this.nudge = n;
    this.applyRate();
  }

  setPitchRange(range: number): void {
    this.s.pitchRange = range;
    this.s.rate = clamp(this.s.rate, 1 - range, 1 + range);
    this.applyRate();
    this.emit();
  }

  bend(amount: number): void {
    this.bendAmt = clamp(amount, -1, 1);
    this.applyRate();
  }

  scratch(deltaSeconds: number): void {
    if (!this.loaded) return;
    if (!this.voice) {
      this.anchor.pos = clamp(this.anchor.pos + deltaSeconds, 0, this.s.duration);
      return;
    }
    this.scratchAcc += deltaSeconds;
    const since = performance.now() - this.scratchLast;
    if (since >= 12) this.flushScratch();
    else if (!this.scratchTimer) this.scratchTimer = setTimeout(() => this.flushScratch(), 12 - since);
  }
  private flushScratch(): void {
    if (this.scratchTimer) { clearTimeout(this.scratchTimer); this.scratchTimer = null; }
    this.scratchLast = performance.now();
    const d = this.scratchAcc;
    this.scratchAcc = 0;
    if (d !== 0 && this.loaded) this.seek(this.getPosition() + d);
  }

  // ---------- cues ----------
  private setCue(t: number): void {
    this.s.cuePoint = clamp(t, 0, this.s.duration);
    this.emit();
  }

  setCuePoint(seconds?: number): void {
    if (!this.loaded) return;
    this.setCue(seconds === undefined ? this.snapPos(this.getPosition()) : seconds);
  }

  // ---------- vinyl brake ----------
  brake(seconds = 0.8): void {
    if (!this.loaded || !this.s.playing || !this.voice || this.braking) return;
    this.previewing = false;
    const T = Math.max(0.05, seconds);
    const now = this.ctx.currentTime;
    const r0 = this.effRate();
    const pos0 = this.getPosition();
    const v = this.voice;
    hold(v.src.playbackRate, now);
    v.src.playbackRate.setValueAtTime(r0, now);
    v.src.playbackRate.exponentialRampToValueAtTime(r0 * BRAKE_K, now + T);
    hold(v.gain.gain, now);
    v.gain.gain.setValueAtTime(1, now);
    v.gain.gain.setValueAtTime(1, now + T * 0.8);
    v.gain.gain.linearRampToValueAtTime(0, now + T);
    this.braking = { t0: now, T, r0, pos0 };
    this.brakeTimer = setTimeout(() => {
      this.brakeTimer = null;
      if (this.braking) this.pauseInternal();
    }, T * 1000 + 25);
  }

  private clearBrake(): void {
    this.braking = null;
    if (this.brakeTimer) { clearTimeout(this.brakeTimer); this.brakeTimer = null; }
  }

  /** Abort a brake in progress (user touched the tempo/bend): restore speed and level. */
  private endBrakeRestore(): void {
    const pos = this.getPosition();
    this.clearBrake();
    const v = this.voice;
    if (!v) return;
    const now = this.ctx.currentTime;
    hold(v.src.playbackRate, now);
    hold(v.gain.gain, now);
    v.gain.gain.linearRampToValueAtTime(1, now + 0.01);
    this.anchor = { time: now, pos, rate: this.effRate() };
  }

  cue(): void {
    if (!this.loaded) return;
    if (this.s.playing) {
      this.pause();
      this.seek(this.s.cuePoint);
    } else {
      this.setCue(this.snapPos(this.getPosition()));
      this.seek(this.s.cuePoint);
    }
  }

  cueHold(down: boolean): void {
    if (!this.loaded) return;
    if (down) {
      if (this.s.playing) { this.cue(); return; }
      if (Math.abs(this.getPosition() - this.s.cuePoint) > 0.02) {
        this.setCue(this.snapPos(this.getPosition()));
        this.seek(this.s.cuePoint);
      }
      this.previewing = true;
      this.startPlayback();
    } else if (this.previewing) {
      this.previewing = false;
      this.pauseInternal();
      this.seek(this.s.cuePoint);
    }
  }

  setHotCue(index: number, seconds?: number): void {
    if (!this.loaded || index < 0 || index > 7) return;
    this.s.hotCues[index] = clamp(seconds ?? this.getPosition(), 0, this.s.duration);
    this.emit();
  }

  triggerHotCue(index: number): void {
    if (!this.loaded || index < 0 || index > 7) return;
    const t = this.s.hotCues[index];
    if (t == null) { this.setHotCue(index); return; } // empty pad: set at playhead
    this.seek(t);
    if (!this.s.playing) this.play();
  }

  deleteHotCue(index: number): void {
    if (index < 0 || index > 7) return;
    this.s.hotCues[index] = null;
    this.emit();
  }

  // ---------- loops ----------
  /** Commit loop region; applies to the live node without recreating it when possible. */
  private commitLoop(start: number, end: number, beats: number | null, active: boolean): void {
    const dur = this.s.duration;
    start = clamp(start, 0, dur);
    end = Math.min(end, dur);
    if (end - start < 0.004) return;
    if (this.voice) this.reanchor(); // freeze position under the OLD loop first
    this.s.loop = { start, end, active, beats };
    if (this.voice) {
      const src = this.voice.src;
      if (active) {
        src.loopStart = start; src.loopEnd = end; src.loop = true;
        const pos = this.anchor.pos;
        if (pos >= end) {
          // Playhead is past the new loop: wrap it into the loop keeping phase.
          this.seek(start + ((pos - start) % (end - start)));
        }
      } else {
        src.loop = false;
      }
    }
    this.emit();
  }

  setLoop(beats: number): void {
    if (!this.loaded) return;
    const b = clampLoopBeats(beats);
    const pos = this.getPosition();
    const start = this.snapPos(pos);
    this.commitLoop(start, start + b * this.beatLen(), b, true);
  }

  setLoopInOut(start: number, end: number): void {
    if (!this.loaded) return;
    if (end < start) [start, end] = [end, start];
    this.commitLoop(start, end, null, true);
  }

  toggleLoop(): void {
    if (!this.loaded) return;
    const l = this.s.loop;
    if (!l) { this.setLoop(4); return; }
    this.commitLoop(l.start, l.end, l.beats, !l.active);
  }

  exitLoop(): void {
    const l = this.s.loop;
    if (!l || !l.active) return;
    this.commitLoop(l.start, l.end, l.beats, false);
  }

  private scaleLoop(factor: number): void {
    const l = this.s.loop;
    if (!l) return;
    const len = (l.end - l.start) * factor;
    const beats = l.beats !== null ? clampLoopBeats(l.beats * factor) : null;
    const newLen = beats !== null ? beats * this.beatLen() : len;
    if (beats !== null && beats === l.beats) return; // at min/max
    this.commitLoop(l.start, l.start + newLen, beats, l.active);
  }
  halveLoop(): void { this.scaleLoop(0.5); }
  doubleLoop(): void { this.scaleLoop(2); }

  beatJump(beats: number): void {
    if (!this.loaded) return;
    const delta = beats * this.beatLen();
    const pos = this.getPosition();
    const l = this.activeLoop();
    if (l) {
      // Move the loop along with the jump (CDJ behaviour).
      const len = l.end - l.start;
      const ns = clamp(l.start + delta, 0, Math.max(0, this.s.duration - len));
      const shift = ns - l.start;
      this.commitLoop(ns, ns + len, l.beats, true);
      this.seek(pos + shift);
      return;
    }
    this.seek(pos + delta);
  }

  // ---------- channel strip ----------
  setGain(v: number): void {
    this.s.gain = clamp(v, 0, 1);
    this.output.gain.setTargetAtTime(this.s.gain, this.ctx.currentTime, TC);
    this.emit();
  }
  setTrim(v: number): void {
    this.s.trim = clamp(v, 0, 2);
    this.input.gain.setTargetAtTime(this.s.trim, this.ctx.currentTime, TC);
    this.emit();
  }
  private eqNode(band: 'low' | 'mid' | 'high'): BiquadFilterNode {
    return band === 'low' ? this.eqLow : band === 'mid' ? this.eqMid : this.eqHigh;
  }
  setEq(band: 'low' | 'mid' | 'high', v: number): void {
    const x = clamp(v, -1, 1);
    this.s.eq[band] = x;
    const g = this.eqNode(band).gain;
    const now = this.ctx.currentTime;
    hold(g, now);
    g.setTargetAtTime(eqDb(x), now, TC);
    this.emit();
  }

  private setFilterChain(active: boolean): void {
    if (active === this.filtActive) return;
    this.filtActive = active;
    const now = this.ctx.currentTime;
    this.fwet.gain.setTargetAtTime(active ? 1 : 0, now, TC);
    this.fbypass.gain.setTargetAtTime(active ? 0 : 1, now, TC);
  }

  setFilter(v: number): void {
    const x = clamp(v, -1, 1);
    this.s.filter = x;
    const { lpFreq, hpFreq, q } = filterParams(x);
    const now = this.ctx.currentTime;
    for (const [p, val] of [[this.lp.frequency, lpFreq], [this.hp.frequency, hpFreq], [this.lp.Q, q], [this.hp.Q, q]] as [AudioParam, number][]) {
      hold(p, now);
      p.setTargetAtTime(val, now, TC);
    }
    this.setFilterChain(Math.abs(x) >= 0.005); // |x|~0 => true bypass
    this.emit();
  }

  // ---------- automation hooks for mixer transitions ----------
  /** Schedule a smooth EQ ramp (audio only; mirror state with `mirror`). */
  rampEq(band: 'low' | 'mid' | 'high', v: number, when: number, dur: number): void {
    const g = this.eqNode(band).gain;
    const now = this.ctx.currentTime;
    const t = Math.max(when, now);
    hold(g, now);
    g.setValueAtTime(g.value, t);
    g.linearRampToValueAtTime(eqDb(clamp(v, -1, 1)), t + Math.max(0.005, dur));
  }

  /** Schedule a smooth filter-knob ramp (exponential in frequency). */
  rampFilter(v: number, when: number, dur: number): void {
    const { lpFreq, hpFreq, q } = filterParams(clamp(v, -1, 1));
    const now = this.ctx.currentTime;
    const t = Math.max(when, now);
    const end = t + Math.max(0.005, dur);
    this.setFilterChain(true);
    for (const [p, val, expo] of [[this.lp.frequency, lpFreq, true], [this.hp.frequency, hpFreq, true], [this.lp.Q, q, false], [this.hp.Q, q, false]] as [AudioParam, number, boolean][]) {
      hold(p, now);
      p.setValueAtTime(p.value, t);
      if (expo) p.exponentialRampToValueAtTime(val, end); else p.linearRampToValueAtTime(val, end);
    }
  }

  /** Freeze EQ/filter automation at the current audio values. */
  releaseAuto(): void {
    const now = this.ctx.currentTime;
    for (const p of [this.eqLow.gain, this.eqMid.gain, this.eqHigh.gain, this.lp.frequency, this.hp.frequency, this.lp.Q, this.hp.Q]) hold(p, now);
  }

  /** Update EQ-low / filter state values to match automation (no audio change). */
  mirror(patch: { eqLow?: number; filter?: number }): void {
    let ch = false;
    if (patch.eqLow !== undefined && Math.abs(patch.eqLow - this.s.eq.low) > 0.002) { this.s.eq.low = patch.eqLow; ch = true; }
    if (patch.filter !== undefined && Math.abs(patch.filter - this.s.filter) > 0.002) { this.s.filter = patch.filter; ch = true; }
    if (ch) this.emit();
  }

  setKeyLock(on: boolean): void {
    // TODO: pitch-preserving time-stretch (e.g. granular/phase-vocoder AudioWorklet).
    // Currently state only: Web Audio playbackRate shifts pitch with tempo.
    this.s.keyLock = on;
    this.emit();
  }
}
