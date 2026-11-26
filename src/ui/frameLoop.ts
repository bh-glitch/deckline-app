import { useEffect, useRef } from 'react';

type FrameFn = (t: number) => void;
const fns = new Set<FrameFn>();
let raf = 0;

function tick(t: number) {
  raf = 0;
  fns.forEach((fn) => {
    try { fn(t); } catch (e) { console.error(e); }
  });
  if (fns.size) raf = requestAnimationFrame(tick);
}

/** Register a callback on the single shared requestAnimationFrame loop. */
export function onFrame(fn: FrameFn): () => void {
  fns.add(fn);
  if (!raf) raf = requestAnimationFrame(tick);
  return () => { fns.delete(fn); };
}

/** Hook: run `fn` every frame while mounted (latest closure is always used). */
export function useFrame(fn: FrameFn) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => onFrame((t) => ref.current(t)), []);
}

/** Hook: DPR-aware canvas redrawn every frame. The canvas MUST sit absolutely inside a sized wrapper (see FrameCanvas). */
export function useCanvasFrame(draw: (ctx: CanvasRenderingContext2D, w: number, h: number, dpr: number, t: number) => void) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => onFrame((t) => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const box = c.parentElement;
    if (!box) return;
    const w = box.clientWidth, h = box.clientHeight; // measure the WRAPPER, never the canvas
    if (w === 0 || h === 0) return;
    const pw = Math.round(w * dpr), ph = Math.round(h * dpr);
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawRef.current(ctx, w, h, dpr, t);
  }), []);
  return ref;
}
