import { useRef } from 'react';
import type { DeckEngine, DeckId, DeckState, WaveformData } from '../types';
import { useTrack } from './context';
import { getWaveform } from './core';
import { FrameCanvas } from './Canvas';
import { useDeckState } from './hooks';
import { DECK_COLOR, HOT_COLORS, cleanName } from './format';

const VISIBLE = 8; // wall-clock seconds across the width

function rgba(hex: string, a: number) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
}

export function ScrollRow({ deck, state }: { deck: DeckEngine; state: DeckState }) {
  const id = deck.id;
  const color = DECK_COLOR[id];
  const stRef = useRef(state);
  stRef.current = state;
  return (
    <FrameCanvas
      className="scroll-wf"
      draw={(ctx, w, h) => {
        const st = stRef.current;
        ctx.fillStyle = '#0d0e11'; ctx.fillRect(0, 0, w, h);
        const rate = st.rate || 1;
        const pos = deck.getPosition();
        const tSpan = VISIBLE * rate;           // track-seconds visible: beats of synced decks line up
        const t0 = pos - tSpan / 2;
        const pps = w / tSpan;
        const T = (t: number) => (t - t0) * pps;
        const mid = h / 2;
        const wf: WaveformData | null = getWaveform(st.trackId);
        if (wf) {
          const bps = wf.binsPerSecond, n = wf.low.length, step = 2;
          const cLo = rgba(color, 0.55), cMid = rgba(color, 0.95);
          for (let x = 0; x < w; x += step) {
            const i = Math.floor((t0 + (x / w) * tSpan) * bps);
            if (i < 0 || i >= n) continue;
            const lo = wf.low[i], mi = wf.mid[i], hi = wf.high[i];
            ctx.fillStyle = cLo; ctx.fillRect(x, mid - lo * mid, step, lo * h);
            ctx.fillStyle = cMid; ctx.fillRect(x, mid - mi * mid * 0.7, step, mi * h * 0.7);
            ctx.fillStyle = '#fff'; ctx.fillRect(x, mid - hi * mid * 0.4, step, hi * h * 0.4);
          }
        } else if (st.loaded) { ctx.fillStyle = '#3a3b42'; ctx.fillRect(0, mid - 0.5, w, 1); }
        if (st.loaded) {
          if (st.bpm && st.bpm > 0) {
            const period = 60 / st.bpm;
            const first = Math.ceil((t0 - st.firstBeat) / period);
            for (let k = first; ; k++) {
              const t = st.firstBeat + k * period;
              if (t > t0 + tSpan) break;
              const x = Math.round(T(t)) + 0.5, down = k % 4 === 0;
              ctx.strokeStyle = down ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.22)';
              ctx.beginPath(); ctx.moveTo(x, down ? 0 : h * 0.7); ctx.lineTo(x, h); ctx.stroke();
              if (!down) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h * 0.3); ctx.stroke(); }
            }
          }
          if (st.loop) {
            ctx.fillStyle = st.loop.active ? rgba(color, 0.25) : 'rgba(255,255,255,0.07)';
            ctx.fillRect(T(st.loop.start), 0, T(st.loop.end) - T(st.loop.start), h);
          }
          const marker = (t: number, c: string, label: string) => {
            const x = T(t);
            if (x < -10 || x > w + 10) return;
            ctx.fillStyle = c; ctx.fillRect(x - 1, 0, 2, h); ctx.fillRect(x - 1, 0, 12, 12);
            ctx.fillStyle = '#000'; ctx.font = '9px system-ui'; ctx.fillText(label, x + 2, 9);
          };
          marker(st.cuePoint, '#ffb02e', 'C');
          st.hotCues.slice(0, 4).forEach((t, i) => { if (t != null) marker(t, HOT_COLORS[i], String(i + 1)); });
        }
        ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(0, 0, w / 2, h);
        ctx.fillStyle = '#fff'; ctx.fillRect(w / 2 - 1, 0, 2, h);
      }}
    />
  );
}

function Overview({ deck, state }: { deck: DeckEngine; state: DeckState }) {
  const color = DECK_COLOR[deck.id];
  const stRef = useRef(state);
  stRef.current = state;
  const cache = useRef<{ wf: WaveformData; w: number; h: number; cv: HTMLCanvasElement } | null>(null);
  const seekFrom = (e: { clientX: number }, el: HTMLElement) => {
    const st = stRef.current;
    if (!st.loaded) return;
    const r = el.getBoundingClientRect();
    deck.seek(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * st.duration);
  };
  return (
    <FrameCanvas
      className="overview"
      onPointerDown={(e) => {
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        seekFrom(e, el);
        const mv = (ev: PointerEvent) => seekFrom(ev, el);
        const up = () => { el.removeEventListener('pointermove', mv); el.removeEventListener('pointerup', up); };
        el.addEventListener('pointermove', mv); el.addEventListener('pointerup', up);
      }}
      draw={(ctx, w, h, dpr) => {
        const st = stRef.current;
        ctx.clearRect(0, 0, w, h);
        const wf = getWaveform(st.trackId);
        if (wf) {
          let c = cache.current;
          if (!c || c.wf !== wf || c.w !== w || c.h !== h) {
            const cv = document.createElement('canvas');
            const W = Math.round(w * dpr), H = Math.round(h * dpr);
            cv.width = W; cv.height = H;
            const g = cv.getContext('2d')!;
            const n = wf.low.length;
            g.fillStyle = rgba(color, 0.8);
            for (let x = 0; x < W; x++) {
              const a = Math.floor((x / W) * n), b = Math.max(a + 1, Math.floor(((x + 1) / W) * n));
              let m = 0;
              for (let i = a; i < b && i < n; i++) m = Math.max(m, wf.low[i], wf.mid[i]);
              g.fillRect(x, H / 2 - (m * H) / 2, 1, Math.max(1, m * H));
            }
            c = cache.current = { wf, w, h, cv };
          }
          ctx.drawImage(c.cv, 0, 0, w, h);
        } else { ctx.fillStyle = '#2a2b30'; ctx.fillRect(0, h / 2 - 0.5, w, 1); }
        if (!st.loaded || st.duration <= 0) return;
        const X = (t: number) => (t / st.duration) * w;
        const px = X(deck.getPosition());
        ctx.fillStyle = 'rgba(10,10,12,0.5)'; ctx.fillRect(0, 0, px, h);
        ctx.fillStyle = '#ffb02e'; ctx.fillRect(X(st.cuePoint) - 1, 0, 2, h);
        st.hotCues.slice(0, 4).forEach((t, i) => { if (t != null) { ctx.fillStyle = HOT_COLORS[i]; ctx.fillRect(X(t) - 1, 0, 2, h); } });
        ctx.fillStyle = '#fff'; ctx.fillRect(px - 1, 0, 2, h);
      }}
    />
  );
}

function Row({ deck }: { deck: DeckEngine }) {
  const st = useDeckState(deck);
  const meta = useTrack(st.trackId);
  const id: DeckId = deck.id;
  return (
    <div className="mv-row">
      <div className="mv-head">
        <span className="chip" style={{ background: DECK_COLOR[id] }}>{id}</span>
        <span className="mv-title">{st.loaded ? cleanName(meta?.title ?? '') : 'Drop a track here'}</span>
      </div>
      <ScrollRow deck={deck} state={st} />
      <Overview deck={deck} state={st} />
    </div>
  );
}

export function MixView({ decks }: { decks: Record<DeckId, DeckEngine> }) {
  return (
    <section className="mixview">
      <Row deck={decks.A} />
      <Row deck={decks.B} />
    </section>
  );
}
