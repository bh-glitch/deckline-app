import { describe, it, expect } from 'vitest';
import {
  integratePosition, snapToBeat, beatPhase, crossfaderGains, syncRate, phaseErrorBeats,
  eqDb, filterParams, clampLoopBeats, pickIndex,
} from './math';

describe('integratePosition', () => {
  it('integrates rate over time', () => {
    expect(integratePosition(10, 5, 1.5, 7, 100)).toBeCloseTo(13);
  });
  it('clamps to duration', () => {
    expect(integratePosition(99, 0, 1, 10, 100)).toBe(100);
  });
  it('wraps inside an active loop', () => {
    const p = integratePosition(3.5, 0, 1, 1, 100, { start: 2, end: 4 });
    expect(p).toBeCloseTo(2.5);
  });
  it('does not wrap if anchored past loop end', () => {
    expect(integratePosition(5, 0, 1, 1, 100, { start: 2, end: 4 })).toBeCloseTo(6);
  });
});

describe('beat snapping', () => {
  it('snaps to nearest beat', () => {
    expect(snapToBeat(1.2, 120, 0.1)).toBeCloseTo(1.1);
    expect(snapToBeat(1.4, 120, 0.1)).toBeCloseTo(1.6);
  });
  it('never negative', () => {
    expect(snapToBeat(0, 120, 0.3)).toBeGreaterThanOrEqual(0);
  });
  it('phase is fractional beat', () => {
    expect(beatPhase(0.75, 120, 0)).toBeCloseTo(0.5);
  });
});

describe('crossfader', () => {
  it('smooth is equal power', () => {
    for (const x of [-1, -0.3, 0, 0.6, 1]) {
      const { a, b } = crossfaderGains(x, 'smooth');
      expect(a * a + b * b).toBeCloseTo(1);
    }
    expect(crossfaderGains(-1, 'smooth').b).toBeCloseTo(0);
  });
  it('sharp keeps both open at center and cuts at ends', () => {
    expect(crossfaderGains(0, 'sharp')).toEqual({ a: 1, b: 1 });
    expect(crossfaderGains(1, 'sharp').a).toBe(0);
    expect(crossfaderGains(-1, 'sharp').b).toBe(0);
  });
});

describe('sync', () => {
  it('matches bpm', () => {
    const { rate, k } = syncRate(120, 126);
    expect(rate).toBeCloseTo(1.05);
    expect(k).toBe(1);
  });
  it('uses double time when closer', () => {
    const { rate, k } = syncRate(140, 70);
    expect(k).toBe(2);
    expect(rate).toBeCloseTo(1);
  });
  it('uses half time when closer', () => {
    const { rate, k } = syncRate(70, 140);
    expect(k).toBe(0.5);
    expect(rate).toBeCloseTo(1);
  });
  it('phase error aligns grids', () => {
    // other is exactly on a beat; self is 0.1 beat late (ahead) -> negative error
    const d = phaseErrorBeats(0.05 + 0.5, 120, 0, 2, 120, 0, 1);
    expect(d).toBeCloseTo(-0.1);
    // self 0.1 beat behind
    expect(phaseErrorBeats(0.5 - 0.05, 120, 0, 2, 120, 0, 1)).toBeCloseTo(0.1);
  });
});

describe('misc', () => {
  it('eq mapping', () => {
    expect(eqDb(-1)).toBeLessThanOrEqual(-40);
    expect(eqDb(0)).toBe(0);
    expect(eqDb(1)).toBe(6);
  });
  it('filter mapping', () => {
    expect(filterParams(0).lpFreq).toBe(20000);
    expect(filterParams(-1).lpFreq).toBeCloseTo(100);
    expect(filterParams(1).hpFreq).toBeCloseTo(8000);
  });
  it('loop beats clamp & index pick', () => {
    expect(clampLoopBeats(100)).toBe(32);
    expect(clampLoopBeats(0.001)).toBeCloseTo(1 / 32);
    expect(pickIndex(1, 6)).toBe(5);
    expect(pickIndex(0, 6)).toBe(0);
  });
});

import { brakeDistance, brakeRate, nextBarDelay, transitionFrame, transitionSegments, bassSwapPoint } from './math';

describe('brake', () => {
  it('distance integrates rate', () => {
    const r0 = 1.04, T = 0.8;
    let sum = 0; const n = 20000;
    for (let i = 0; i < n; i++) sum += brakeRate(r0, T, ((i + 0.5) / n) * T) * (T / n);
    expect(brakeDistance(r0, T, T)).toBeCloseTo(sum, 4);
    expect(brakeDistance(r0, T, 0)).toBe(0);
    expect(brakeDistance(r0, T, 99)).toBeCloseTo(brakeDistance(r0, T, T), 9);
    expect(brakeRate(1, T, T)).toBeCloseTo(0.01, 9);
  });
});

describe('nextBarDelay', () => {
  it('lands on the next bar line', () => {
    // 120bpm: 0.5s/beat. pos 0.7 -> beat 1.4 -> bar at beat 4 -> 1.3s
    expect(nextBarDelay(0.7, 120, 0, 1)).toBeCloseTo(1.3, 6);
    // rate scales time
    expect(nextBarDelay(0.7, 120, 0, 2)).toBeCloseTo(0.65, 6);
  });
  it('rolls over when too close', () => {
    expect(nextBarDelay(1.99, 120, 0, 1, 0.1)).toBeCloseTo(2.01, 6);
    expect(nextBarDelay(2, 120, 0, 1, 0.1)).toBeCloseTo(2, 6);
  });
});

describe('transition frames', () => {
  it('fade moves fully across', () => {
    expect(transitionFrame('fade', 0, 8, -1).x).toBe(-1);
    expect(transitionFrame('fade', 0.5, 8, -1).x).toBeCloseTo(0, 9);
    expect(transitionFrame('fade', 1, 8, -1).x).toBe(1);
  });
  it('bassSwap centers, swaps lows at midpoint, then finishes', () => {
    expect(bassSwapPoint(16)).toBe(0.5);
    expect(transitionSegments('bassSwap', 16, -1)).toHaveLength(2);
    expect(transitionFrame('bassSwap', 0.3, 16, -1)).toMatchObject({ x: 0, fromLow: 0, toLow: -1 });
    expect(transitionFrame('bassSwap', 0.6, 16, -1)).toMatchObject({ fromLow: -1, toLow: 0 });
    expect(transitionFrame('bassSwap', 1, 16, -1).x).toBe(1);
  });
  it('echoOut cuts within first beat; cut is instant', () => {
    expect(transitionFrame('echoOut', 1 / 8, 8, 1).x).toBe(-1);
    expect(transitionFrame('cut', 0, 8, 1).x).toBe(1);
    expect(transitionFrame('cut', 0.001, 8, 1).x).toBe(-1);
  });
});
