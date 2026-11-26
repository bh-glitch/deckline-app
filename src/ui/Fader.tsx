import { useRef } from 'react';
import { clamp } from './format';

interface Props {
  value: number; min: number; max: number; def: number;
  onChange: (v: number) => void;
  vertical?: boolean; className?: string; title?: string;
}

/** Generic linear fader. Vertical: max at top. Horizontal: max at right. Double-click resets. */
export function Fader({ value, min, max, def, onChange, vertical = true, className = '', title }: Props) {
  const rail = useRef<HTMLDivElement>(null);
  const active = useRef(false);
  const frac = clamp((value - min) / (max - min), 0, 1);

  const set = (e: React.PointerEvent) => {
    const r = rail.current!.getBoundingClientRect();
    const f = vertical ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width;
    onChange(min + clamp(f, 0, 1) * (max - min));
  };
  return (
    <div
      className={`fader ${vertical ? 'v' : 'h'} ${className}`} title={title}
      onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); active.current = true; set(e); }}
      onPointerMove={(e) => { if (active.current) set(e); }}
      onPointerUp={() => { active.current = false; }}
      onPointerCancel={() => { active.current = false; }}
      onDoubleClick={() => onChange(def)}
    >
      <div className="fader-rail" ref={rail}>
        <div className="fader-slot" />
        <div className="fader-thumb" style={vertical ? { bottom: `${frac * 100}%` } : { left: `${frac * 100}%` }} />
      </div>
    </div>
  );
}
