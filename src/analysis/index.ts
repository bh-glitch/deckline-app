import type { AnalysisResult } from '../types';
import { analyzeSamples } from './analyze';

let worker: Worker | null = null;
let nextId = 1;
let chain: Promise<unknown> = Promise.resolve();

function downmix(buf: AudioBuffer): Float32Array {
  const n = buf.length, ch = buf.numberOfChannels;
  const out = new Float32Array(n);
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += d[i];
  }
  if (ch > 1) for (let i = 0; i < n; i++) out[i] /= ch;
  return out;
}

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined') return null;
  try {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  } catch {
    worker = null;
  }
  return worker;
}

function run(samples: Float32Array, sampleRate: number): Promise<AnalysisResult> {
  const w = getWorker();
  if (!w) return Promise.resolve().then(() => analyzeSamples(samples, sampleRate));
  const id = nextId++;
  return new Promise<AnalysisResult>((resolve, reject) => {
    const onMsg = (ev: MessageEvent) => {
      if (ev.data.id !== id) return;
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onErr);
      if (ev.data.error) reject(new Error(ev.data.error));
      else resolve(ev.data.result as AnalysisResult);
    };
    const onErr = (ev: ErrorEvent) => {
      w.removeEventListener('message', onMsg);
      w.removeEventListener('error', onErr);
      worker = null;
      w.terminate();
      reject(new Error(ev.message || 'analysis worker failed'));
    };
    w.addEventListener('message', onMsg);
    w.addEventListener('error', onErr);
    w.postMessage({ id, samples, sampleRate }, [samples.buffer]);
  });
}

/** Analyze a decoded track (BPM, first beat, Camelot key, 3-band waveform). One at a time. */
export function analyzeBuffer(buf: AudioBuffer): Promise<AnalysisResult> {
  const samples = downmix(buf);
  const sr = buf.sampleRate;
  const p = chain.then(() => run(samples, sr));
  chain = p.catch(() => undefined);
  return p;
}
