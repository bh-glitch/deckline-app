import { useRef, useState } from 'react';
import { clamp } from './format';

interface Props {
  value: number; min: number; max: number; def: number;
  onChange: (v: number) => void;
  label?: string; size?: number; fmt?: (v: number) => string; color?: string;
}

function pt(cx: number, cy: number, r: number, deg: number) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}
function arc(cx: number, cy: number, r: number, a0: number, a1: number) {
  if (Math.abs(a1 - a0) < 0.5) return '';
  const [x0, y0] = pt(cx, cy, r, a0), [x1, y1] = pt(cx, cy, r, a1);
  const large = Math.abs(a1 - a0) > 180 ? 1 : 0;
  return `M${x0} ${y0} A${r} ${r} 0 ${large} ${a1 > a0 ? 1 : 0} ${x1} ${y1}`;
}

/** Rotary knob: vertical drag to turn (shift = fine), double-click resets to `def`. */
export function Knob({ value, min, max, def, onChange, label, size = 42, fmt, color = '#3d8bff' }: Props) {
  const drag = useRef<{ y: number; v: number } | null>(null);
  const [active, setActive] = useState(false);
  const frac = clamp((value - min) / (max - min), 0, 1);
  const angle = -135 + frac * 270;
  const defAngle = -135 + clamp((def - min) / (max - min), 0, 1) * 270;
  const c = 24;
  return (
    <div className="knob" title="Drag to turn, double-click to reset">
      <svg
        width={size} height={size} viewBox="0 0 48 48"
        onPointerDown={(e) => { (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId); drag.current = { y: e.clientY, v: value }; setActive(true); }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dy = d.y - e.clientY;
          onChange(clamp(d.v + (dy / 160) * (max - min) * (e.shiftKey ? 0.2 : 1), min, max));
        }}
        onPointerUp={() => { drag.current = null; setActive(false); }}
        onPointerCancel={() => { drag.current = null; setActive(false); }}
        onDoubleClick={() => onChange(def)}
      >
        <defs>
          <radialGradient id="kb" cx="35%" cy="30%" r="80%">
            <stop offset="0" stopColor="#4a4c55" /><stop offset="1" stopColor="#1d1e23" />
          </radialGradient>
        </defs>
        <path d={arc(c, c, 21, -135, 135)} stroke="#2a2b30" strokeWidth="3" fill="none" strokeLinecap="round" />
        <path d={arc(c, c, 21, defAngle, angle)} stroke={color} strokeWidth="3" fill="none" strokeLinecap="round" />
        <circle cx={c} cy={c} r="15" fill="url(#kb)" stroke="#0c0c0e" strokeWidth="1.5" />
        <g transform={`rotate(${angle} ${c} ${c})`}>
          <line x1={c} y1={c - 4} x2={c} y2={c - 14} stroke="#e8eaf0" strokeWidth="2.5" strokeLinecap="round" />
        </g>
      </svg>
      <span className={`knob-label ${active ? 'rd' : ''}`}>{active && fmt ? fmt(value) : label}</span>
    </div>
  );
}
