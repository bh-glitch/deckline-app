// Offline DJ-mix renderer: decode -> analyze -> pick phrase points -> OfflineAudioContext mix -> WAV.
import { analyzeBuffer } from '../analysis';

const SR = 44100;
const logLines: string[] = [];
const log = (s: string) => { logLines.push(s); console.log(s); const el = document.getElementById('log'); if (el) el.textContent = logLines.join('\n'); };
const fmt = (t: number) => `${Math.floor(t / 60)}:${(t % 60).toFixed(2).padStart(5, '0')}`;

interface Track { phase: number; name: string; buf: AudioBuffer; bpm: number; firstBeat: number; key?: string; beat: number; bar: number; full: Float32Array; low: Float32Array }
const mean = (a: ArrayLike<number>, s: number, e: number) => { let t = 0, n = 0; for (let i = Math.max(0, s); i < Math.min(a.length, e); i++) { t += a[i]; n++; } return n ? t / n : 0; };

function barEnergy(buf: AudioBuffer, first: number, bar: number) {
  const d = buf.getChannelData(0), d2 = buf.numberOfChannels > 1 ? buf.getChannelData(1) : d;
  const nb = Math.floor((buf.duration - first) / bar);
  const full = new Float32Array(nb), low = new Float32Array(nb);
  const a = 1 - Math.exp(-2 * Math.PI * 150 / SR); let lp = 0;
  const start = Math.floor(first * SR), len = Math.round(bar * SR);
  // run LP from the beginning for continuity
  const lpArr = new Float32Array(d.length);
  for (let i = 0; i < d.length; i++) { lp += a * ((d[i] + d2[i]) * 0.5 - lp); lpArr[i] = lp; }
  for (let b = 0; b < nb; b++) {
    let f = 0, l = 0; const s = start + Math.round(b * bar * SR);
    for (let i = s; i < Math.min(s + len, d.length); i++) { const m = (d[i] + d2[i]) * 0.5; f += m * m; l += lpArr[i] * lpArr[i]; }
    full[b] = Math.sqrt(f / len); low[b] = Math.sqrt(l / len);
  }
  return { full, low };
}

/** snap time t to the strongest low-band onset within +-win seconds */
function snapOnset(buf: AudioBuffer, t: number, win = 0.07): number {
  const d = buf.getChannelData(0), a = 1 - Math.exp(-2 * Math.PI * 120 / SR);
  const s0 = Math.max(0, Math.floor((t - win - 0.02) * SR)), s1 = Math.min(d.length, Math.floor((t + win + 0.02) * SR));
  const hop = 64; const env: number[] = []; let lp = 0;
  for (let i = s0; i < s1; i += hop) { let e = 0; for (let j = i; j < Math.min(i + hop, s1); j++) { lp += a * (d[j] - lp); e += lp * lp; } env.push(Math.sqrt(e / hop)); }
  let best = -1, bi = 0;
  for (let i = 1; i < env.length - 1; i++) { const tt = (s0 + i * hop) / SR; if (Math.abs(tt - t) > win) continue; const df = env[i + 1] - env[i - 1]; if (df > best) { best = df; bi = i; } }
  return (s0 + bi * hop) / SR - 0.004;
}

/** phrase downbeats: bar index mod 8 where energy most consistently jumps up (breaks end right before) */
function detectPhase(full: Float32Array): number {
  let best = 0, bs = -1e9;
  for (let p = 0; p < 8; p++) { let s = 0; for (let k = p + 8; k < full.length; k += 8) s += (full[k] - full[k - 1]) / (full[k] + full[k - 1] + 1e-6); if (s > bs) { bs = s; best = p; } }
  return best;
}
function findHook(tr: Track, minBar: number, maxTime: number) {
  const p90 = [...tr.full].sort((a, b) => a - b)[Math.floor(tr.full.length * 0.9)];
  let best = { k: -1, ratio: 0, score: 0 };
  for (let k = tr.phase + 8 * Math.ceil(Math.max(8, minBar) / 8); k * tr.bar + tr.firstBeat < maxTime && k + 8 < tr.full.length; k += 8) {
    if (k < 8) continue;
    const pre = mean(tr.full, k - 8, k), post = mean(tr.full, k, k + 8);
    if (post < 0.7 * p90) continue;
    const ratio = post / Math.max(pre, 1e-6), score = ratio * post / p90;
    if (score > best.score) best = { k, ratio, score };
  }
  return best;
}

// ---------- synthesized sound design ----------
function noiseBuf(ctx: BaseAudioContext, sec: number) { const b = ctx.createBuffer(2, Math.ceil(sec * SR), SR); for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; } return b; }
function reverbIR(ctx: BaseAudioContext, sec = 1.4) { const b = ctx.createBuffer(2, Math.ceil(sec * SR), SR); for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3.2); } return b; }

function riser(ctx: BaseAudioContext, dest: AudioNode, t0: number, dur: number, level: number) {
  const n = ctx.createBufferSource(); n.buffer = noiseBuf(ctx, dur + 0.5);
  const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.Q.value = 3;
  hp.frequency.setValueAtTime(300, t0); hp.frequency.exponentialRampToValueAtTime(7000, t0 + dur);
  const g = ctx.createGain(); g.gain.setValueAtTime(0, t0); g.gain.exponentialRampToValueAtTime(level, t0 + dur * 0.97); g.gain.linearRampToValueAtTime(0, t0 + dur + 0.02);
  n.connect(hp).connect(g).connect(dest); n.start(t0); n.stop(t0 + dur + 0.05);
  const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(110, t0); o.frequency.exponentialRampToValueAtTime(1760, t0 + dur);
  const of = ctx.createBiquadFilter(); of.type = 'highpass'; of.frequency.value = 400;
  const og = ctx.createGain(); og.gain.setValueAtTime(0, t0); og.gain.exponentialRampToValueAtTime(level * 0.35, t0 + dur * 0.97); og.gain.linearRampToValueAtTime(0, t0 + dur + 0.02);
  o.connect(of).connect(og).connect(dest); o.start(t0); o.stop(t0 + dur + 0.05);
}
function impact(ctx: BaseAudioContext, dest: AudioNode, t0: number, level: number) {
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(130, t0); o.frequency.exponentialRampToValueAtTime(38, t0 + 0.5);
  const g = ctx.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.linearRampToValueAtTime(level, t0 + 0.006); g.gain.exponentialRampToValueAtTime(0.001, t0 + 1.6);
  o.connect(g).connect(dest); o.start(t0); o.stop(t0 + 1.7);
  const n = ctx.createBufferSource(); n.buffer = noiseBuf(ctx, 1.2);
  const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.setValueAtTime(3000, t0); f.frequency.exponentialRampToValueAtTime(400, t0 + 0.9); f.Q.value = 0.6;
  const ng = ctx.createGain(); ng.gain.setValueAtTime(0.0001, t0); ng.gain.linearRampToValueAtTime(level * 0.8, t0 + 0.004); ng.gain.exponentialRampToValueAtTime(0.001, t0 + 1.0);
  n.connect(f).connect(ng).connect(dest); n.start(t0); n.stop(t0 + 1.2);
}

interface Chain { src: AudioBufferSourceNode; low: BiquadFilterNode; filt: BiquadFilterNode; gain: GainNode; tap: BiquadFilterNode }
function makeChain(ctx: BaseAudioContext, tr: Track, master: AudioNode): Chain {
  const src = ctx.createBufferSource(); src.buffer = tr.buf;
  const low = ctx.createBiquadFilter(); low.type = 'lowshelf'; low.frequency.value = 200;
  const mid = ctx.createBiquadFilter(); mid.type = 'peaking'; mid.frequency.value = 1000; mid.Q.value = 0.7;
  const hi = ctx.createBiquadFilter(); hi.type = 'highshelf'; hi.frequency.value = 4000;
  const filt = ctx.createBiquadFilter(); filt.type = 'highpass'; filt.frequency.value = 10; filt.Q.value = 0.8;
  const gain = ctx.createGain(); gain.gain.value = 0;
  src.connect(low).connect(mid).connect(hi).connect(filt).connect(gain).connect(master);
  return { src, low, filt, gain, tap: filt };
}
/** Echo out over 16 beats starting at time t (mix time). Dry fades, low is killed, HP sweeps, 1/2-beat feedback delay with its input cut so the tail decays. */
function echoOut(ctx: BaseAudioContext, c: Chain, master: AudioNode, t: number, beat: number, opts: { lp?: boolean } = {}) {
  const send = ctx.createGain(); send.gain.setValueAtTime(0, t);
  send.gain.linearRampToValueAtTime(0.9, t + 0.01);
  send.gain.setValueAtTime(0.9, t + 12 * beat); send.gain.linearRampToValueAtTime(0, t + 12 * beat + 0.02);
  const dl = ctx.createDelay(2); dl.delayTime.value = beat / 2;
  const fb = ctx.createGain(); fb.gain.value = 0.55;
  const tone = ctx.createBiquadFilter(); tone.type = 'lowpass'; tone.frequency.value = 5500;
  const wet = ctx.createGain(); wet.gain.value = 0.9;
  c.tap.connect(send); send.connect(dl); dl.connect(tone); tone.connect(fb); fb.connect(dl); tone.connect(wet); wet.connect(master);
  // low kill
  c.low.gain.setValueAtTime(0, t + 2 * beat); c.low.gain.linearRampToValueAtTime(-40, t + 8 * beat);
  // HP sweep (or LP sweep)
  if (opts.lp) { c.filt.type = 'lowpass'; c.filt.frequency.setValueAtTime(18000, 0); c.filt.frequency.setValueAtTime(18000, t); c.filt.frequency.exponentialRampToValueAtTime(500, t + 14 * beat); }
  else { c.filt.frequency.setValueAtTime(10, t); c.filt.frequency.setValueAtTime(10, t + 2 * beat); c.filt.frequency.exponentialRampToValueAtTime(900, t + 14 * beat); }
  // dry out
  c.gain.gain.setValueAtTime(1, t + 6 * beat); c.gain.gain.linearRampToValueAtTime(0, t + 14 * beat);
  return wet;
}

// ---------- state ----------
const W: any = window; let tracks: Track[] = []; let meme: AudioBuffer;
let plan: any = null; let pcm: Int16Array | null = null; let wavBytes: Uint8Array | null = null;

W.mix = {
  async prepare() {
    const files = Array.from((document.getElementById('files') as HTMLInputElement).files || []);
    const ac = new AudioContext({ sampleRate: SR });
    const bufs: AudioBuffer[] = [];
    for (const f of files) bufs.push(await ac.decodeAudioData(await f.arrayBuffer()));
    const names = files.map(f => f.name);
    log('decoded: ' + names.map((n, i) => `${n.slice(0, 30)} ${bufs[i].duration.toFixed(1)}s ${bufs[i].sampleRate}Hz`).join(' | '));
    meme = bufs[1];
    tracks = [];
    for (const i of [0, 2]) {
      const a = await analyzeBuffer(bufs[i]);
      const beat = 60 / a.bpm, bar = beat * 4;
      const e = barEnergy(bufs[i], a.firstBeat, bar);
      tracks.push({ phase: 0, name: names[i], buf: bufs[i], bpm: a.bpm, firstBeat: a.firstBeat, key: a.key, beat, bar, full: e.full, low: e.low });
      tracks[tracks.length - 1].phase = detectPhase(e.full);
      log(`analysis ${i === 0 ? 'Party' : 'Saturday'}: bpm ${a.bpm.toFixed(2)} firstBeat ${a.firstBeat.toFixed(3)} key ${a.key} bars ${e.full.length} phrasePhase ${tracks[tracks.length - 1].phase} (bar index mod 8)`);
    }
    return tracks.map(t => ({ bpm: t.bpm, firstBeat: t.firstBeat, key: t.key, dur: t.buf.duration, full: Array.from(t.full).map(x => +x.toFixed(3)) }));
  },

  async render(over: any = {}) {
    const [P, S] = tracks; const o = over;
    // ---- Party: first beat, phrase picks
    const pBar = (k: number) => P.firstBeat + k * P.bar;
    const pHook = findHook(P, 4, 60);
    let riserOn = pHook.k > 0 && pHook.ratio > 1.2 && pHook.k >= 4;
    // echo-out phrase boundary: multiple of 16 bars, nearest 2:10 (window 2:00-2:20), prefers energetic bar before
    const medP = [...P.full].sort((a, b) => a - b)[P.full.length >> 1];
    let cand: any[] = [];
    for (let k = P.phase + 8; pBar(k) < P.buf.duration - 12; k += 8) cand.push({ k, t: pBar(k), e: mean(P.full, k - 4, k) });
    let pick = cand.filter(c => c.t >= 118 && c.t <= 140 && c.e >= medP).sort((a, b) => Math.abs(a.t - 130) - Math.abs(b.t - 130))[0]
      || cand.sort((a, b) => Math.abs(a.t - 130) - Math.abs(b.t - 130))[0];
    if (o.partyEchoBar) pick = { k: o.partyEchoBar, t: pBar(o.partyEchoBar) };
    const tEchoSrc = snapOnset(P.buf, pick.t);
    const beatP = P.beat;
    // ---- mix timeline (mix time 0 = Party firstBeat)
    const T0 = 0, srcOff = P.firstBeat;
    const mixT = (srcT: number) => srcT - srcOff;
    const tEcho = mixT(tEchoSrc);
    const echoEnd = tEcho + 16 * beatP;
    const memeStart = tEcho + 20 * beatP; // 5 bars after phrase start: bar-aligned, echo tail gone
    const memeEnd = memeStart + meme.duration;
    const tSlam = memeStart + Math.ceil((meme.duration + 0.35) / P.bar) * P.bar;
    // ---- Saturday entry
    const sHook = findHook(S, 8, 75);
    const useHook = sHook.k > 0 && sHook.ratio > 1.15;
    let sEntrySrc = useHook ? snapOnset(S.buf, S.firstBeat + sHook.k * S.bar) : S.firstBeat;
    if (o.satEntry != null) sEntrySrc = o.satEntry;
    // Saturday exit: 8-bar boundary ~105 s after entry, echo-out LP over 16 beats
    let kExit = S.phase + Math.round((sEntrySrc + 125 - S.firstBeat) / S.bar / 8 - S.phase / 8) * 8;
    const maxK = S.phase + Math.floor((S.buf.duration - 9 - S.firstBeat) / S.bar / 8 - S.phase / 8) * 8;
    kExit = Math.min(kExit, maxK);
    const sExitSrc = snapOnset(S.buf, S.firstBeat + kExit * S.bar);
    const tExit = tSlam + (sExitSrc - sEntrySrc);
    const exitEnd = tExit + 16 * S.beat;
    const total = exitEnd + 2.5;
    plan = { partyBpm: P.bpm, satBpm: S.bpm, partyKey: P.key, satKey: S.key, riserOn, pHook, tEcho, memeStart, memeEnd, tSlam, useHook, sHook, sEntrySrc, tExit, exitEnd, total, pickBar: pick.k, kExit };
    log('PLAN ' + JSON.stringify(plan));
    log(`CUES: Party start 0:00 | riser ${riserOn ? fmt(mixT(pBar(pHook.k)) - 4 * P.bar) : 'none'} -> hook ${fmt(mixT(pBar(pHook.k)))} (bar ${pHook.k}, ratio ${pHook.ratio.toFixed(2)}) | echo-out ${fmt(tEcho)} (Party bar ${pick.k}, src ${fmt(tEchoSrc)}) | meme ${fmt(memeStart)}-${fmt(memeEnd)} | Saturday slam ${fmt(tSlam)} from src ${fmt(sEntrySrc)} (${useHook ? 'hook bar ' + sHook.k + ' ratio ' + sHook.ratio.toFixed(2) : 'intro'}) | sat echo-out ${fmt(tExit)}-${fmt(exitEnd)} | end ${fmt(total)}`);

    const ctx = new OfflineAudioContext(2, Math.ceil(total * SR), SR);
    const master = ctx.createGain(); master.gain.value = 0.9;
    const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.knee.value = 12; comp.ratio.value = 2.2; comp.attack.value = 0.015; comp.release.value = 0.25;
    master.connect(comp).connect(ctx.destination);

    // Party
    const cp = makeChain(ctx, P, master);
    cp.gain.gain.setValueAtTime(0, 0); cp.gain.gain.linearRampToValueAtTime(1, 0.012);
    cp.src.start(T0, srcOff, tEchoSrc - srcOff + 16 * beatP + 0.1);
    const pWet = echoOut(ctx, cp, master, tEcho, beatP);
    if (riserOn) { const hookT = mixT(pBar(pHook.k)); riser(ctx, master, hookT - 4 * P.bar, 4 * P.bar, 0.13); }

    // Meme (alone, light reverb)
    const ms = ctx.createBufferSource(); ms.buffer = meme;
    const d = meme.getChannelData(0); let pk = 0, e2 = 0, n2 = 0; for (let i = 0; i < d.length; i++) { pk = Math.max(pk, Math.abs(d[i])); if (Math.abs(d[i]) > 0.02) { e2 += d[i] * d[i]; n2++; } }
    const memeRms = Math.sqrt(e2 / Math.max(1, n2)); const pRms = mean(P.full, 8, P.full.length - 8);
    const memeGain = o.memeGain ?? 2.0; // pre-compressor trim; makeup below
    log(`meme peak ${pk.toFixed(3)} activeRMS ${memeRms.toFixed(3)} partyRMS ${pRms.toFixed(3)} gain ${memeGain.toFixed(2)}`);
    const mg = ctx.createGain(); mg.gain.setValueAtTime(0, memeStart - 0.01); mg.gain.linearRampToValueAtTime(memeGain, memeStart + 0.005);
    const conv = ctx.createConvolver(); conv.buffer = reverbIR(ctx); const rg = ctx.createGain(); rg.gain.value = 0.22;
    const mc = ctx.createDynamicsCompressor(); mc.threshold.value = -26; mc.knee.value = 4; mc.ratio.value = 4; mc.attack.value = 0.001; mc.release.value = 0.1;
    const mk = ctx.createGain(); mk.gain.value = o.memeMakeup ?? 3.0;
    const ml = ctx.createDynamicsCompressor(); ml.threshold.value = -6; ml.knee.value = 0; ml.ratio.value = 20; ml.attack.value = 0.001; ml.release.value = 0.05;
    pWet.gain.setValueAtTime(0.9, memeStart - 0.05); pWet.gain.linearRampToValueAtTime(0.9 * 0.63, memeStart); // duck echo tail 4 dB
    ms.connect(mg); mg.connect(mc).connect(mk).connect(ml).connect(master); ml.connect(conv).connect(rg).connect(master); ms.start(memeStart);

    // Saturday
    const cs = makeChain(ctx, S, master);
    cs.gain.gain.setValueAtTime(0, tSlam - 0.01); cs.gain.gain.linearRampToValueAtTime(1, tSlam + 0.006); // short cut, ramped >=5ms
    cs.src.start(tSlam - 0.0, sEntrySrc, (sExitSrc - sEntrySrc) + 16 * S.beat + 0.1);
    echoOut(ctx, cs, master, tExit, S.beat, { lp: true });
    impact(ctx, master, tSlam, 0.6);

    const out = await ctx.startRendering();
    // ---- post: loudness + limiter (lookahead)
    const L = out.getChannelData(0), R = out.getChannelData(1), n = L.length;
    let ss = 0, cnt = 0; for (let i = 0; i < n; i += 1) { const m = L[i] * L[i] + R[i] * R[i]; if (m > 1e-6) { ss += m / 2; cnt++; } }
    const rms = Math.sqrt(ss / cnt);
    const targetRms = Math.pow(10, (o.targetDb ?? -12.5) / 20);
    const g = targetRms / rms; const ceil = Math.pow(10, -1.2 / 20);
    // lookahead peak limiter: gain curve = min over window, smoothed
    const look = Math.round(0.005 * SR); const need = new Float32Array(n);
    for (let i = 0; i < n; i++) { const p = Math.max(Math.abs(L[i]), Math.abs(R[i])) * g; need[i] = p > ceil ? ceil / p : 1; }
    const minw = new Float32Array(n); // sliding min over [i-look, i+look]
    const dq: number[] = [];
    // simple: block min with look window via monotonic deque
    let head = 0; const q: number[] = [];
    for (let i = 0; i < n + look; i++) {
      if (i < n) { while (q.length > head && need[q[q.length - 1]] >= need[i]) q.pop(); q.push(i); }
      const c = i - look; if (c >= 0) { while (q[head] < c - look) head++; minw[c] = need[q[head]]; }
    }
    let sm = 1; const rel = Math.exp(-1 / (0.08 * SR)); const atk = Math.exp(-1 / (0.002 * SR)); let maxGR = 1;
    pcm = new Int16Array(n * 2);
    for (let i = 0; i < n; i++) {
      const t = minw[i]; sm = t < sm ? t + (sm - t) * atk : t + (sm - t) * rel; if (sm > t) sm = Math.min(sm, Math.max(t, sm));
      const gg = Math.min(sm, t === 1 ? sm : t) ; maxGR = Math.min(maxGR, gg);
      const l = Math.max(-ceil, Math.min(ceil, L[i] * g * gg)), r = Math.max(-ceil, Math.min(ceil, R[i] * g * gg));
      pcm[2 * i] = Math.round(l * 32767); pcm[2 * i + 1] = Math.round(r * 32767);
    }
    log(`premaster rms ${(20 * Math.log10(rms)).toFixed(1)} dB, gain +${(20 * Math.log10(g)).toFixed(1)} dB, max limiter reduction ${(20 * Math.log10(maxGR)).toFixed(1)} dB`);
    // WAV
    const bytes = new Uint8Array(44 + pcm.length * 2); const dv = new DataView(bytes.buffer);
    const ws = (o2: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o2 + i, s.charCodeAt(i)); };
    ws(0, 'RIFF'); dv.setUint32(4, 36 + pcm.length * 2, true); ws(8, 'WAVE'); ws(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 2, true);
    dv.setUint32(24, SR, true); dv.setUint32(28, SR * 4, true); dv.setUint16(32, 4, true); dv.setUint16(34, 16, true); ws(36, 'data'); dv.setUint32(40, pcm.length * 2, true);
    new Uint8Array(bytes.buffer, 44).set(new Uint8Array(pcm.buffer));
    wavBytes = bytes;
    W.mix.drawOverview();
    return { plan, bytes: bytes.length, log: logLines };
  },

  chunk(i: number, size = 6 * 1024 * 1024) {
    const s = wavBytes!.subarray(i * size, (i + 1) * size); let bin = '';
    for (let j = 0; j < s.length; j += 0x8000) bin += String.fromCharCode.apply(null, s.subarray(j, j + 0x8000) as any);
    return btoa(bin);
  },
  chunks(size = 6 * 1024 * 1024) { return Math.ceil(wavBytes!.length / size); },

  drawOverview() {
    const cv = document.getElementById('w') as HTMLCanvasElement; const c = cv.getContext('2d')!; const n = pcm!.length / 2, W2 = cv.width, H = cv.height;
    c.fillStyle = '#0b0d12'; c.fillRect(0, 0, W2, H);
    const total = n / SR; c.fillStyle = '#5ab0ff'; const mid = H / 2 + 10;
    for (let x = 0; x < W2; x++) { const s = Math.floor(x / W2 * n), e = Math.floor((x + 1) / W2 * n); let mx = 0; for (let i = s; i < e; i += 8) mx = Math.max(mx, Math.abs(pcm![2 * i]) / 32768); c.fillRect(x, mid - mx * (H / 2 - 30), 1, Math.max(1, mx * (H - 60))); }
    const mk = (t: number, label: string, col: string) => { const x = t / total * W2; c.fillStyle = col; c.fillRect(x, 0, 2, H); c.save(); c.translate(x + 4, 14); c.fillStyle = '#fff'; c.font = '12px system-ui'; c.fillText(`${label} ${fmt(t)}`, 0, 0); c.restore(); };
    const p = plan; mk(0, 'Party', '#3c6'); mk(p.tEcho, 'echo-out', '#fc3'); mk(p.memeStart, 'meme', '#f6c'); mk(p.tSlam, 'SLAM Saturday', '#f33'); mk(p.tExit, 'sat echo-out', '#fc3'); mk(p.exitEnd, 'end', '#999');
    c.fillStyle = '#9ab'; c.font = '12px system-ui'; for (let t = 0; t < total; t += 30) c.fillText(fmt(t), t / total * W2 + 3, H - 6);
  },
};
