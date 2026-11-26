import { analyzeSamples } from './analyze';

interface Req { id: number; samples: Float32Array; sampleRate: number }

self.onmessage = (ev: MessageEvent<Req>) => {
  const { id, samples, sampleRate } = ev.data;
  try {
    const r = analyzeSamples(samples, sampleRate);
    (self as unknown as Worker).postMessage(
      { id, result: r },
      [r.waveform.low.buffer, r.waveform.mid.buffer, r.waveform.high.buffer],
    );
  } catch (e) {
    (self as unknown as Worker).postMessage({ id, error: String(e) });
  }
};
