import { useRef } from 'react';
import { FrameCanvas } from './Canvas';

const SEGS = 14;

/** Segmented level meter; size is set by the `.vu` wrapper in CSS. */
export function VuMeter({ analyser }: { analyser: AnalyserNode }) {
  const buf = useRef<Float32Array | null>(null);
  const lv = useRef([0, 0]);
  return (
    <FrameCanvas
      className="vu"
      draw={(ctx, w, h) => {
        if (!buf.current || buf.current.length !== analyser.fftSize) buf.current = new Float32Array(analyser.fftSize);
        const d = buf.current;
        analyser.getFloatTimeDomainData(d);
        let s0 = 0, s1 = 0;
        for (let i = 0; i + 1 < d.length; i += 2) { s0 += d[i] * d[i]; s1 += d[i + 1] * d[i + 1]; }
        const n = d.length / 2;
        const lvl = (ss: number) => Math.min(1, Math.max(0, (20 * Math.log10(Math.sqrt(ss / n) + 1e-6) + 54) / 54));
        lv.current[0] = Math.max(lvl(s0), lv.current[0] * 0.9);
        lv.current[1] = Math.max(lvl(s1), lv.current[1] * 0.9);
        ctx.clearRect(0, 0, w, h);
        const gap = 2, bw = (w - gap) / 2, sh = (h - gap * (SEGS - 1)) / SEGS;
        for (let b = 0; b < 2; b++) {
          const on = Math.round(lv.current[b] * SEGS);
          for (let i = 0; i < SEGS; i++) {
            ctx.fillStyle = i < on ? (i >= SEGS - 2 ? '#ff3b4e' : i >= SEGS - 5 ? '#ffc23d' : '#35d07f') : '#24252a';
            ctx.fillRect(b * (bw + gap), h - (i + 1) * sh - i * gap, bw, sh);
          }
        }
      }}
    />
  );
}
