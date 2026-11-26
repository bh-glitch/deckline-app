import type { DeckId, FxSlotState, MixerEngine, MixerState, SampleName, TransitionStyle } from '../types';
import { Deck } from './deck';
import { FxBus } from './fx';
import { Sampler } from './sampler';
import {
  bassSwapPoint, clamp, crossfaderGains, nextBarDelay, phaseErrorBeats, smooth01, snapToBeat, syncRate,
  transitionFrame, transitionSegments,
} from './math';

const TC = 0.015;
type FxTarget = 'A' | 'B' | 'master';
const other = (id: DeckId): DeckId => (id === 'A' ? 'B' : 'A');

type Holdable = AudioParam & { cancelAndHoldAtTime?: (t: number) => AudioParam };
function hold(p: AudioParam, t: number): void {
  const h = p as Holdable;
  if (typeof h.cancelAndHoldAtTime === 'function') h.cancelAndHoldAtTime(t); else p.cancelScheduledValues(t);
}

interface EchoSend { send: GainNode; delay: DelayNode; fb: GainNode; ret: GainNode }
interface TrRun {
  from: DeckId; to: DeckId; style: TransitionStyle; beats: number; fromX: number;
  t0: number; dur: number; toWasPlaying: boolean; timer: ReturnType<typeof setInterval>;
}

const DEFAULT_FX: FxSlotState[] = [
  { type: 'echo', enabled: false, wet: 0.5, param: 0.5 },
  { type: 'reverb', enabled: false, wet: 0.4, param: 0.5 },
  { type: 'flanger', enabled: false, wet: 0.5, param: 0.5 },
];

export class Mixer implements MixerEngine {
  readonly ctx: AudioContext;
  readonly decks: Record<DeckId, Deck>;
  readonly masterAnalyser: AnalyserNode;

  private xf: Record<DeckId, GainNode>;
  private route: Record<FxTarget, { dry: GainNode; send: GainNode; ret: GainNode }>;
  private fxBus: FxBus;
  private masterGain: GainNode;
  private comp: DynamicsCompressorNode;
  private recDest: MediaStreamAudioDestinationNode;
  private recorder: MediaRecorder | null = null;
  private recChunks: Blob[] = [];

  private s: MixerState;
  private snap: MixerState;
  private listeners = new Set<(s: MixerState) => void>();
  private syncK: Record<DeckId, number> = { A: 1, B: 1 };
  private lastFxBpm = 0;
  private sampler: Sampler;
  private echo!: Record<DeckId, EchoSend>;
  private tr: TrRun | null = null;
  private prevPlaying: Record<DeckId, boolean> = { A: false, B: false };
  private lastTrack: Record<DeckId, string | null> = { A: null, B: null };

  constructor() {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new Ctor({ latencyHint: 'interactive' });
    this.ctx = ctx;
    const A = new Deck(ctx, 'A');
    const B = new Deck(ctx, 'B');
    this.decks = { A, B };

    const mixSum = ctx.createGain();
    this.xf = { A: ctx.createGain(), B: ctx.createGain() };
    this.fxBus = new FxBus(ctx, 3);
    const postFx = ctx.createGain();
    const mk = () => ({ dry: ctx.createGain(), send: ctx.createGain(), ret: ctx.createGain() });
    this.route = { A: mk(), B: mk(), master: mk() };

    for (const id of ['A', 'B'] as DeckId[]) {
      const r = this.route[id];
      const d = this.decks[id];
      d.output.connect(r.dry).connect(this.xf[id]);
      d.output.connect(r.send).connect(this.fxBus.input);
      this.fxBus.output.connect(r.ret).connect(this.xf[id]);
      this.xf[id].connect(mixSum);
    }
    // Internal per-deck echo send (used by echoOut transitions; independent of user FX slots).
    const mkEcho = (id: DeckId): EchoSend => {
      const send = ctx.createGain(); send.gain.value = 0;
      const delay = ctx.createDelay(2); delay.delayTime.value = 0.25;
      const fb = ctx.createGain(); fb.gain.value = 0;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 5000;
      const ret = ctx.createGain(); ret.gain.value = 1;
      this.decks[id].output.connect(send).connect(delay);
      delay.connect(lp).connect(fb).connect(delay);
      lp.connect(ret).connect(mixSum);
      return { send, delay, fb, ret };
    };
    this.echo = { A: mkEcho('A'), B: mkEcho('B') };
    const rm = this.route.master;
    mixSum.connect(rm.dry).connect(postFx);
    mixSum.connect(rm.send).connect(this.fxBus.input);
    this.fxBus.output.connect(rm.ret).connect(postFx);

    this.masterGain = ctx.createGain();
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -2;
    this.comp.knee.value = 4;
    this.comp.ratio.value = 12;
    this.comp.attack.value = 0.003;
    this.comp.release.value = 0.12;
    this.masterAnalyser = ctx.createAnalyser();
    this.masterAnalyser.fftSize = 2048;
    this.masterAnalyser.smoothingTimeConstant = 0.5;
    this.recDest = ctx.createMediaStreamDestination();

    postFx.connect(this.masterGain).connect(this.comp);
    this.comp.connect(ctx.destination);
    this.comp.connect(this.masterAnalyser);
    this.comp.connect(this.recDest);
    this.sampler = new Sampler(ctx, this.masterGain); // pre-limiter => recorded

    this.s = {
      crossfader: 0, crossfaderCurve: 'smooth', masterGain: 1,
      fx: DEFAULT_FX.map((f) => ({ ...f })), fxTarget: 'master',
      recording: false, recordingStartedAt: null, autoSync: true, transition: null,
    };
    this.snap = this.makeSnap();
    this.masterGain.gain.value = 1;
    this.applyCrossfader(true);
    this.applyRouting(true);
    this.s.fx.forEach((f, i) => this.fxBus.slots[i].apply(f));

    // Keep synced decks following their master's tempo.
    (['A', 'B'] as DeckId[]).forEach((id) => this.decks[id].subscribe(() => { this.followSync(id); this.onDeck(id); }));
    setInterval(() => this.tick(), 100);
  }

  // ---------- state ----------
  private makeSnap(): MixerState {
    return { ...this.s, fx: this.s.fx.map((f) => ({ ...f })), transition: this.s.transition ? { ...this.s.transition } : null };
  }
  private emit(): void {
    this.snap = this.makeSnap();
    this.listeners.forEach((fn) => fn(this.snap));
  }
  getState(): MixerState { return this.snap; }
  subscribe(fn: (s: MixerState) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  async resume(): Promise<void> {
    if (this.ctx.state !== 'running') await this.ctx.resume();
  }

  async decode(file: Blob): Promise<AudioBuffer> {
    const ab = await file.arrayBuffer();
    return this.ctx.decodeAudioData(ab);
  }

  // ---------- crossfader / master ----------
  private applyCrossfader(immediate = false): void {
    const { a, b } = crossfaderGains(this.s.crossfader, this.s.crossfaderCurve);
    const now = this.ctx.currentTime;
    if (immediate) { this.xf.A.gain.value = a; this.xf.B.gain.value = b; return; }
    this.xf.A.gain.setTargetAtTime(a, now, 0.008);
    this.xf.B.gain.setTargetAtTime(b, now, 0.008);
  }
  setCrossfader(v: number): void {
    if (this.tr) this.cancelTransition(); // user grabbed the crossfader
    this.s.crossfader = clamp(v, -1, 1);
    this.applyCrossfader();
    this.emit();
  }
  setCrossfaderCurve(c: 'smooth' | 'sharp'): void {
    this.s.crossfaderCurve = c;
    this.applyCrossfader();
    this.emit();
  }
  setMasterGain(v: number): void {
    this.s.masterGain = clamp(v, 0, 1.5);
    this.masterGain.gain.setTargetAtTime(this.s.masterGain, this.ctx.currentTime, TC);
    this.emit();
  }

  // ---------- FX ----------
  private applyRouting(immediate = false): void {
    const now = this.ctx.currentTime;
    (Object.keys(this.route) as FxTarget[]).forEach((t) => {
      const on = t === this.s.fxTarget;
      const r = this.route[t];
      const set = (p: AudioParam, v: number) => (immediate ? (p.value = v) : p.setTargetAtTime(v, now, 0.02));
      set(r.send.gain, on ? 1 : 0);
      set(r.ret.gain, on ? 1 : 0);
      set(r.dry.gain, on ? 0 : 1);
    });
  }
  setFx(slot: number, patch: Partial<FxSlotState>): void {
    if (slot < 0 || slot >= this.s.fx.length) return;
    const cur = { ...this.s.fx[slot], ...patch };
    cur.wet = clamp(cur.wet, 0, 1);
    cur.param = clamp(cur.param, 0, 1);
    this.s.fx[slot] = cur;
    this.fxBus.slots[slot].apply(cur);
    this.emit();
  }
  setFxTarget(t: FxTarget): void {
    if (t === this.s.fxTarget) return;
    this.s.fxTarget = t;
    this.applyRouting();
    this.lastFxBpm = 0;
    this.updateFxBpm();
    this.emit();
  }

  private fxBpm(): number {
    const t = this.s.fxTarget;
    const eff = (id: DeckId) => this.decks[id].getEffectiveBpm();
    if (t !== 'master') return eff(t) ?? eff(other(t)) ?? 120;
    const playing = (['A', 'B'] as DeckId[]).filter((id) => this.decks[id].getState().playing && eff(id));
    if (playing.length === 2) return eff(this.s.crossfader <= 0 ? 'A' : 'B') as number;
    if (playing.length === 1) return eff(playing[0]) as number;
    return eff('A') ?? eff('B') ?? 120;
  }
  private updateFxBpm(): void {
    const b = this.fxBpm();
    if (Math.abs(b - this.lastFxBpm) > 0.05) { this.lastFxBpm = b; this.fxBus.setBpm(b); }
  }

  // ---------- sync ----------
  /** Compute and apply follower rate from its master. Returns false if impossible. */
  private applySyncRate(follower: DeckId): boolean {
    const f = this.decks[follower];
    const m = this.decks[other(follower)];
    const fb = f.getState().bpm;
    const mb = m.getEffectiveBpm();
    if (!fb || !mb) return false;
    const { rate, k } = syncRate(fb, mb);
    this.syncK[follower] = k;
    if (Math.abs(rate - f.getState().rate) > 1e-6) f.setSyncRate(rate);
    return true;
  }

  private alignPhase(follower: DeckId): void {
    const f = this.decks[follower];
    const m = this.decks[other(follower)];
    const fs = f.getState(); const ms = m.getState();
    if (!fs.bpm || !ms.bpm || !ms.playing || !fs.loaded) return;
    const d = phaseErrorBeats(f.getPosition(), fs.bpm, fs.firstBeat, m.getPosition(), ms.bpm, ms.firstBeat, this.syncK[follower]);
    if (Math.abs(d) < 0.002) return;
    f.seek(f.getPosition() + (d * 60) / fs.bpm);
  }

  sync(deck: DeckId): void {
    const f = this.decks[deck];
    const o = other(deck);
    if (!f.getState().bpm || !this.decks[o].getEffectiveBpm()) return;
    this.decks[o].setSynced(false); // single follower to avoid feedback
    if (!this.applySyncRate(deck)) return;
    f.setSynced(true);
    this.alignPhase(deck);
  }
  unsync(deck: DeckId): void {
    this.decks[deck].setNudge(0);
    this.decks[deck].setSynced(false);
  }

  private lastMasterKey: Record<DeckId, string> = { A: '', B: '' };
  /** Called whenever deck `id` emits: if the other deck follows it, track its tempo. */
  private followSync(id: DeckId): void {
    const follower = other(id);
    const fs = this.decks[follower].getState();
    if (!fs.synced) return;
    const ms = this.decks[id].getState();
    const key = `${ms.bpm}|${ms.rate}|${ms.trackId}`;
    if (key === this.lastMasterKey[follower]) return;
    this.lastMasterKey[follower] = key;
    this.applySyncRate(follower);
  }

  private tick(): void {
    this.updateFxBpm();
    // Gentle phase lock for synced followers (disabled while the user is bending).
    for (const id of ['A', 'B'] as DeckId[]) {
      const f = this.decks[id];
      const m = this.decks[other(id)];
      const fs = f.getState(); const ms = m.getState();
      if (!fs.synced || !fs.playing || !ms.playing || !fs.bpm || !ms.bpm || f.isBending()) { f.setNudge(0); continue; }
      const d = phaseErrorBeats(f.getPosition(), fs.bpm, fs.firstBeat, m.getPosition(), ms.bpm, ms.firstBeat, this.syncK[id]);
      if (Math.abs(d) > 0.3 || Math.abs(d) < 0.004) { f.setNudge(0); continue; }
      f.setNudge(clamp(d * 0.1, -0.03, 0.03));
    }
  }

  // ---------- auto sync ----------
  setAutoSync(on: boolean): void { this.s.autoSync = on; this.emit(); }

  /** React to deck state changes: auto-sync on start, tempo pre-set on load. */
  private onDeck(id: DeckId): void {
    const st = this.decks[id].getState();
    const o = other(id);
    const os = this.decks[o].getState();
    const started = st.playing && !this.prevPlaying[id];
    this.prevPlaying[id] = st.playing;
    const loadedNew = st.trackId !== this.lastTrack[id];
    this.lastTrack[id] = st.trackId;
    if (!this.s.autoSync || this.tr) return;
    if (started && os.playing && st.bpm && os.bpm && !st.synced) this.sync(id);
    else if (loadedNew && st.trackId && !st.playing && os.playing && st.bpm) {
      const eff = this.decks[o].getEffectiveBpm();
      if (eff) this.decks[id].setSyncRate(syncRate(st.bpm, eff).rate);
    }
  }

  // ---------- master tempo ----------
  nudgeMasterBpm(deltaBpm: number): void {
    const eff = (id: DeckId) => this.decks[id].getState();
    const playing = (['A', 'B'] as DeckId[]).filter((id) => eff(id).playing && eff(id).bpm);
    let m: DeckId;
    if (playing.length === 1) m = playing[0];
    else m = this.s.crossfader <= 0 ? 'A' : 'B';
    if (!eff(m).bpm) m = other(m);
    const d = this.decks[m];
    const st = d.getState();
    if (!st.bpm) return;
    const rate = Math.max(0.2, ((st.bpm * st.rate) + deltaBpm) / st.bpm);
    const dev = Math.abs(rate - 1);
    const need = [0.08, 0.16, 0.5].find((r) => dev <= r + 1e-9) ?? 0.5;
    if (need > st.pitchRange) d.setPitchRange(need);
    d.setRate(rate); // followers track via followSync
  }

  // ---------- sampler ----------
  playSample(name: SampleName): void { this.sampler.play(name); }
  setSamplerVolume(v: number): void { this.sampler.setVolume(v); }

  // ---------- transitions ----------
  private xfCurves(x0: number, x1: number, n = 96): { a: Float32Array; b: Float32Array } {
    const a = new Float32Array(n), b = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const g = crossfaderGains(x0 + (x1 - x0) * smooth01(i / (n - 1)), this.s.crossfaderCurve);
      a[i] = g.a; b[i] = g.b;
    }
    return { a, b };
  }

  transition(to: DeckId, style: TransitionStyle, beats: number): void {
    this.cancelTransition();
    const from = other(to);
    const F = this.decks[from], T = this.decks[to];
    if (!T.getState().loaded) return;
    const fromX = from === 'A' ? -1 : 1;
    if (!F.getState().playing) {
      if (!T.getState().playing) T.play();
      this.setCrossfader(-fromX);
      return;
    }
    const nb = clamp(Math.round(beats), 1, 64);
    const fs = F.getState();
    const ts = T.getState();
    const fEff = F.getEffectiveBpm();
    const bd = 60 / (fEff ?? 120);
    const ctx = this.ctx;
    const now = ctx.currentTime;

    let p0 = T.getPosition();
    if (ts.bpm) p0 = snapToBeat(p0, ts.bpm, ts.firstBeat);
    const toWasPlaying = ts.playing;
    if (ts.bpm && fEff) this.sync(to); // tempo (+ coarse phase); exact start phase comes from scheduling below
    const delay = fs.bpm ? nextBarDelay(F.getPosition(), fs.bpm, fs.firstBeat, fs.rate, 0.12) : 0.06;
    const t0 = now + delay;
    const dur = style === 'cut' ? 0.1 : nb * bd;

    // Pre-condition the incoming deck.
    if (style === 'bassSwap') T.setEq('low', -1);
    if (style === 'filter') T.setFilter(-0.9);

    const run: TrRun = {
      from, to, style, beats: nb, fromX, t0, dur, toWasPlaying,
      timer: setInterval(() => this.trTick(), 100),
    };
    this.tr = run;
    if (!toWasPlaying) { T.seek(p0); T.playAt(t0); }

    // Crossfader automation.
    const xfs = [this.xf.A.gain, this.xf.B.gain];
    xfs.forEach((g) => hold(g, now));
    if (style === 'cut') {
      const g = crossfaderGains(-fromX, this.s.crossfaderCurve);
      this.xf.A.gain.setValueAtTime(g.a, t0);
      this.xf.B.gain.setValueAtTime(g.b, t0);
    } else {
      for (const seg of transitionSegments(style, nb, fromX)) {
        if (seg.x0 === seg.x1) continue;
        const c = this.xfCurves(seg.x0, seg.x1);
        this.xf.A.gain.setValueCurveAtTime(c.a, t0 + seg.u0 * dur, (seg.u1 - seg.u0) * dur);
        this.xf.B.gain.setValueCurveAtTime(c.b, t0 + seg.u0 * dur, (seg.u1 - seg.u0) * dur);
      }
    }
    // Per-style extras.
    if (style === 'bassSwap') {
      const tm = t0 + bassSwapPoint(nb) * dur;
      T.rampEq('low', 0, tm, 0.02);
      F.rampEq('low', -1, tm, 0.02);
    } else if (style === 'filter') {
      F.rampFilter(0.95, t0, dur);
      T.rampFilter(0, t0, dur);
    } else if (style === 'echoOut') {
      const e = this.echo[from];
      e.delay.delayTime.setValueAtTime(bd / 2, now);
      hold(e.fb.gain, now); e.fb.gain.setValueAtTime(0.55, now);
      hold(e.send.gain, now);
      e.send.gain.setValueAtTime(0, now);
      e.send.gain.setValueAtTime(0, Math.max(now, t0 - 0.01));
      e.send.gain.linearRampToValueAtTime(1, t0);
      e.send.gain.setValueAtTime(1, t0 + bd);          // input cut after 1 beat: tail decays naturally
      e.send.gain.linearRampToValueAtTime(0, t0 + bd + 0.02);
    }
    this.trTick();
  }

  private trTick(): void {
    const r = this.tr;
    if (!r) return;
    const now = this.ctx.currentTime;
    if (now >= r.t0 + r.dur) { this.finishTransition(); return; }
    this.applyFrame(r, now);
  }

  private applyFrame(r: TrRun, now: number): void {
    const started = now >= r.t0;
    const u = started ? clamp((now - r.t0) / r.dur, 1e-6, 1) : 0;
    const f = transitionFrame(r.style, u, r.beats, r.fromX);
    this.s.crossfader = f.x;
    this.decks[r.from].mirror({ eqLow: f.fromLow, filter: f.fromFilter });
    this.decks[r.to].mirror({ eqLow: f.toLow, filter: f.toFilter });
    this.s.transition = { active: true, from: r.from, to: r.to, style: r.style, progress: started ? u : 0 };
    this.emit();
  }

  private stopEcho(id: DeckId): void {
    const e = this.echo[id];
    const now = this.ctx.currentTime;
    hold(e.send.gain, now); e.send.gain.setValueAtTime(0, now);
    hold(e.fb.gain, now); e.fb.gain.setValueAtTime(0, now);
    hold(e.ret.gain, now); e.ret.gain.setValueAtTime(e.ret.gain.value, now);
    e.ret.gain.linearRampToValueAtTime(0, now + 0.05);
    e.ret.gain.setValueAtTime(1, now + 0.6);
  }

  private releaseXf(x: number): void {
    this.xf.A.gain.cancelScheduledValues(0);
    this.xf.B.gain.cancelScheduledValues(0);
    this.s.crossfader = x;
    this.applyCrossfader(true);
  }

  private finishTransition(): void {
    const r = this.tr;
    if (!r) return;
    clearInterval(r.timer);
    this.tr = null;
    const F = this.decks[r.from], T = this.decks[r.to];
    this.releaseXf(-r.fromX);
    this.s.transition = null;
    F.pause();
    for (const d of [F, T]) { d.releaseAuto(); d.setEq('low', 0); d.setFilter(0); }
    this.unsync(r.from);
    this.unsync(r.to);
    this.stopEcho(r.from);
    this.emit();
  }

  cancelTransition(): void {
    const r = this.tr;
    if (!r) return;
    clearInterval(r.timer);
    this.tr = null;
    const now = this.ctx.currentTime;
    const started = now >= r.t0;
    const u = started ? clamp((now - r.t0) / r.dur, 1e-6, 1) : 0;
    const f = transitionFrame(r.style, u, r.beats, r.fromX);
    this.releaseXf(f.x);
    const F = this.decks[r.from], T = this.decks[r.to];
    if (!started && !r.toWasPlaying) T.pause(); // scheduled start never happened
    F.releaseAuto(); T.releaseAuto();
    F.setEq('low', f.fromLow); F.setFilter(f.fromFilter);
    T.setEq('low', f.toLow); T.setFilter(f.toFilter);
    this.stopEcho(r.from);
    this.s.transition = null;
    this.emit();
  }

  // ---------- recording ----------
  startRecording(): void {
    if (this.recorder) return;
    const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    const mimeType = types.find((t) => typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t));
    this.recChunks = [];
    const rec = new MediaRecorder(this.recDest.stream, mimeType ? { mimeType } : undefined);
    rec.ondataavailable = (e) => { if (e.data.size > 0) this.recChunks.push(e.data); };
    rec.start(1000);
    this.recorder = rec;
    this.s.recording = true;
    this.s.recordingStartedAt = Date.now();
    this.emit();
  }

  stopRecording(): Promise<Blob> {
    const rec = this.recorder;
    if (!rec) return Promise.resolve(new Blob([], { type: 'audio/webm' }));
    return new Promise<Blob>((resolve) => {
      rec.onstop = () => {
        const blob = new Blob(this.recChunks, { type: rec.mimeType || 'audio/webm' });
        this.recChunks = [];
        this.recorder = null;
        this.s.recording = false;
        this.s.recordingStartedAt = null;
        this.emit();
        resolve(blob);
      };
      rec.stop();
    });
  }
}
