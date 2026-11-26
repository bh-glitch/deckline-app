import type { AnalysisResult } from '../types';
import { computeWaveform } from './waveform';
import { onsetEnvelope, estimateTempo, foldBpm, refinePhase } from './bpm';
import { detectKey } from './key';

/** Pure analysis of a mono signal. */
export function analyzeSamples(x: Float32Array, sr: number): AnalysisResult {
  const waveform = computeWaveform(x, sr, 150);
  let bpm = 120, firstBeat = 0;
  const tempo = estimateTempo(onsetEnvelope(x, sr));
  if (tempo) {
    bpm = foldBpm(tempo.bpm);
    const nearest = Math.round(bpm);
    if (Math.abs(bpm - nearest) <= 0.05) bpm = nearest;
    firstBeat = refinePhase(x, sr, bpm, tempo.phaseSec);
  }
  let key: string | undefined;
  try { key = detectKey(x, sr); } catch { key = undefined; }
  return { bpm, firstBeat, key, waveform };
}
