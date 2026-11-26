import { useRef } from 'react';
import type { DeckEngine, DeckState } from '../types';
import { useTrack } from './context';
import { useFrame } from './frameLoop';
import { clamp } from './format';

const DEG_PER_SEC = (33.333 / 60) * 360; // 200 deg/s at rate 1

export function Turntable({ deck, state }: { deck: DeckEngine; state: DeckState }) {
  const meta = useTrack(state.trackId);
  const stRef = useRef(state);
  stRef.current = state;
  const platter = useRef<HTMLDivElement>(null);
  const disc = useRef<HTMLDivElement>(null);
  const drag = useRef<{ last: number; lastT: number; v: number; scratch: boolean } | null>(null);
  const idle = useRef(0);

  // Rotation is derived from deck position: stops when paused, reverses on scratch, scales with rate.
  useFrame(() => {
    const pos = deck.getPosition();
    if (disc.current) disc.current.style.transform = `rotate(${(pos * DEG_PER_SEC) % 360}deg)`;
  });

  const angleOf = (e: React.PointerEvent) => {
    const r = platter.current!.getBoundingClientRect();
    return (Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
  };

  const onDown = (e: React.PointerEvent) => {
    if (!stRef.current.loaded) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { last: angleOf(e), lastT: performance.now(), v: stRef.current.rate, scratch: !stRef.current.playing };
  };
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const a = angleOf(e);
    let da = a - d.last;
    if (da > 180) da -= 360;
    if (da < -180) da += 360;
    const now = performance.now();
    const dt = Math.max(0.008, (now - d.lastT) / 1000);
    d.last = a; d.lastT = now;
    if (d.scratch) {
      deck.scratch(da / DEG_PER_SEC);
    } else {
      const vrel = da / dt / DEG_PER_SEC; // 1 = normal forward speed
      d.v = d.v * 0.6 + vrel * 0.4;
      deck.bend(clamp((d.v - stRef.current.rate) * 0.5, -1, 1));
      window.clearTimeout(idle.current);
      idle.current = window.setTimeout(() => deck.bend(0), 70);
    }
  };
  const onUp = () => {
    if (drag.current && !drag.current.scratch) deck.bend(0);
    window.clearTimeout(idle.current);
    drag.current = null;
  };

  return (
    <div className="platter" ref={platter} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
      title="Drag: bend while playing, scratch while paused">
      <div className="record" ref={disc}>
        <div className="label" style={meta?.artwork ? { backgroundImage: `url(${meta.artwork})` } : undefined}>
          {!meta?.artwork && <span className="label-note">♪</span>}
        </div>
        <div className="spindle" />
      </div>
    </div>
  );
}
