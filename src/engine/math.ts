// Pure math helpers for the audio engine (no Web Audio dependency, unit-tested).

export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

export interface LoopRegion { start: number; end: number }

/**
 * Integrate playhead position from an anchor (time, position, rate).
 * If a loop is active and the playhead was before the loop end when anchored,
 * the position wraps exactly as an AudioBufferSourceNode with loop=true would.
 */
export function integratePosition(
  anchorPos: number,
  anchorTime: number,
  rate: number,
  now: number,
  duration: number,
  loop?: LoopRegion | null,
): number {
  let p = anchorPos + Math.max(0, now - anchorTime) * rate;
  if (loop && loop.end > loop.start && anchorPos < loop.end && p >= loop.end) {
    const len = loop.end - loop.start;
    p = loop.start + ((p - loop.start) % len);
  }
  if (duration > 0) p = clamp(p, 0, duration);
  else p = Math.max(0, p);
  return p;
}

/** Snap time `t` to the nearest beat of a grid (bpm, firstBeat). Never returns < 0. */
export function snapToBeat(t: number, bpm: number, firstBeat: number): number {
  if (!(bpm > 0)) return t;
  const period = 60 / bpm;
  const n = Math.round((t - firstBeat) / period);
  return Math.max(0, firstBeat + n * period);
}

/** Fractional beat phase 0..1 at position `pos`. */
export function beatPhase(pos: number, bpm: number, firstBeat: number): number {
  const x = ((pos - firstBeat) * bpm) / 60;
  return x - Math.floor(x);
}

/** Absolute (fractional) beat count at position. */
export function beatCount(pos: number, bpm: number, firstBeat: number): number {
  return ((pos - firstBeat) * bpm) / 60;
}

/** Equal-power ('smooth') or cut ('sharp') crossfader gains. x in -1 (A) .. 1 (B). */
export function crossfaderGains(x: number, curve: 'smooth' | 'sharp'): { a: number; b: number } {
  const v = clamp(x, -1, 1);
  if (curve === 'smooth') {
    const p = ((v + 1) / 2) * (Math.PI / 2);
    return { a: Math.cos(p), b: Math.sin(p) };
  }
  // Cut curve: both full until the last ~20% of travel, then fast cut.
  const slope = 5;
  return { a: clamp((1 - v) * slope, 0, 1), b: clamp((1 + v) * slope, 0, 1) };
}

/** EQ knob -1..1 → dB. -1 = -45dB (kill), 0 = flat, +1 = +6dB. */
export function eqDb(v: number): number {
  const x = clamp(v, -1, 1);
  return x < 0 ? x * 45 : x * 6;
}

/** Single-knob filter mapping. */
export function filterParams(v: number): { lpFreq: number; hpFreq: number; q: number } {
  const x = clamp(v, -1, 1);
  if (Math.abs(x) < 0.005) return { lpFreq: 20000, hpFreq: 20, q: 0.707 };
  const q = 0.707 + Math.abs(x) * 1.8;
  if (x < 0) return { lpFreq: 20000 * Math.pow(100 / 20000, -x), hpFreq: 20, q };
  return { lpFreq: 20000, hpFreq: 20 * Math.pow(8000 / 20, x), q };
}

/**
 * Rate for a deck with `selfBpm` so that it matches `otherEffBpm`, trying
 * half/double-time of the other deck and choosing the multiplier closest to 1x.
 */
export function syncRate(selfBpm: number, otherEffBpm: number): { rate: number; k: number } {
  let best = { rate: otherEffBpm / selfBpm, k: 1 };
  for (const k of [0.5, 1, 2]) {
    const rate = (otherEffBpm * k) / selfBpm;
    if (Math.abs(Math.log(rate)) < Math.abs(Math.log(best.rate)) - 1e-9) best = { rate, k };
  }
  return best;
}

/**
 * Beat-phase error (in beats, -0.5..0.5) to add to the follower so that its beat
 * grid lines up with the master's. `k` = follower tempo / master tempo multiplier.
 * Positive → follower is behind.
 */
export function phaseErrorBeats(
  selfPos: number, selfBpm: number, selfFirstBeat: number,
  otherPos: number, otherBpm: number, otherFirstBeat: number,
  k = 1,
): number {
  const desiredRaw = beatCount(otherPos, otherBpm, otherFirstBeat) * k;
  const desired = desiredRaw - Math.floor(desiredRaw);
  let d = desired - beatPhase(selfPos, selfBpm, selfFirstBeat);
  d -= Math.round(d);
  return d;
}

export const LOOP_MIN_BEATS = 1 / 32;
export const LOOP_MAX_BEATS = 32;
export const clampLoopBeats = (b: number): number => clamp(b, LOOP_MIN_BEATS, LOOP_MAX_BEATS);

/** Echo beat divisions selectable by param 0..1. */
export const ECHO_DIVISIONS = [0.125, 0.25, 0.5, 0.75, 1, 2];
export function pickIndex(param: number, n: number): number {
  return Math.min(n - 1, Math.max(0, Math.floor(clamp(param, 0, 1) * n)));
}

// ---------- vinyl brake ----------
/** Final/initial playback-rate ratio reached at the end of a brake. */
export const BRAKE_K = 0.01;

/** Playback rate `tau` seconds into an exponential brake from `r0` lasting `T`. */
export function brakeRate(r0: number, T: number, tau: number, k = BRAKE_K): number {
  return r0 * Math.pow(k, clamp(tau, 0, T) / T);
}

/** Track seconds travelled `tau` seconds into the brake (analytic integral of brakeRate). */
export function brakeDistance(r0: number, T: number, tau: number, k = BRAKE_K): number {
  const t = clamp(tau, 0, T);
  return (r0 * T * (1 - Math.pow(k, t / T))) / -Math.log(k);
}

// ---------- transitions ----------
/**
 * Seconds from now until the next bar line (every `barBeats` beats of the grid) of a deck
 * at `pos`, playing at `rate`. Always >= `minLead` (rolls over to the following bar).
 */
export function nextBarDelay(
  pos: number, bpm: number, firstBeat: number, rate: number, minLead = 0.1, barBeats = 4,
): number {
  const secPerBeat = 60 / (bpm * rate);
  const beats = beatCount(pos, bpm, firstBeat);
  let target = Math.ceil(beats / barBeats - 1e-9) * barBeats;
  while ((target - beats) * secPerBeat < minLead) target += barBeats;
  return (target - beats) * secPerBeat;
}

export type TransitionKind = 'fade' | 'bassSwap' | 'echoOut' | 'filter' | 'cut';
export interface XfSegment { u0: number; u1: number; x0: number; x1: number }
export interface TransitionFrame { x: number; fromLow: number; toLow: number; fromFilter: number; toFilter: number }

export const smooth01 = (u: number): number => { const t = clamp(u, 0, 1); return t * t * (3 - 2 * t); };

/** Beat-aligned (0..1) point at which a bass swap flips the low EQs. */
export function bassSwapPoint(beats: number): number {
  return beats >= 4 ? Math.round(beats / 2) / beats : 0.5;
}

/** Crossfader movement segments in normalised transition time. fromX is -1 (A) or 1 (B). */
export function transitionSegments(style: TransitionKind, beats: number, fromX: number): XfSegment[] {
  const toX = -fromX;
  switch (style) {
    case 'bassSwap': return [{ u0: 0, u1: 0.25, x0: fromX, x1: 0 }, { u0: bassSwapPoint(beats), u1: 1, x0: 0, x1: toX }];
    case 'echoOut': return [{ u0: 0, u1: Math.min(1, 1 / Math.max(1, beats)), x0: fromX, x1: toX }];
    case 'cut': return [];
    default: return [{ u0: 0, u1: 1, x0: fromX, x1: toX }];
  }
}

/** Analytic state of a transition at normalised time u (0..1). */
export function transitionFrame(style: TransitionKind, u: number, beats: number, fromX: number): TransitionFrame {
  let x = fromX;
  if (style === 'cut') x = u > 0 ? -fromX : fromX;
  else {
    for (const s of transitionSegments(style, beats, fromX)) {
      if (u >= s.u1) x = s.x1;
      else { if (u > s.u0) x = s.x0 + (s.x1 - s.x0) * smooth01((u - s.u0) / (s.u1 - s.u0)); break; }
    }
  }
  const f: TransitionFrame = { x, fromLow: 0, toLow: 0, fromFilter: 0, toFilter: 0 };
  if (style === 'bassSwap') {
    const swapped = u >= bassSwapPoint(beats);
    f.fromLow = swapped ? -1 : 0; f.toLow = swapped ? 0 : -1;
  } else if (style === 'filter') {
    f.fromFilter = 0.95 * u; f.toFilter = -0.9 * (1 - u);
  }
  return f;
}
