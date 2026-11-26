import { useState } from 'react';
import type { MixerEngine, SampleName } from '../types';

export const PADS: { name: SampleName; label: string; icon: string; key: string }[] = [
  { name: 'airhorn', label: 'Air Horn', icon: '📯', key: '1' }, { name: 'siren', label: 'Siren', icon: '🚨', key: '2' },
  { name: 'rocket', label: 'Rocket Alarm', icon: '🚀', key: '3' }, { name: 'laser', label: 'Laser', icon: '⚡', key: '4' },
  { name: 'riser', label: 'Riser', icon: '⬆', key: 'q' }, { name: 'impact', label: 'Impact', icon: '💥', key: 'w' },
  { name: 'scratch', label: 'Scratch', icon: '💿', key: 'e' }, { name: 'rewind', label: 'Rewind', icon: '⏪', key: 'r' },
  { name: 'kick', label: 'Kick', icon: '🥁', key: 'a' }, { name: 'snare', label: 'Snare', icon: '🪘', key: 's' },
  { name: 'clap', label: 'Clap', icon: '👏', key: 'd' }, { name: 'hat', label: 'Hat', icon: '🎩', key: 'f' },
  { name: 'subdrop', label: 'Sub Drop', icon: '🔻', key: 'z' }, { name: 'vox', label: 'Hey!', icon: '🗣', key: 'x' },
  { name: 'zap', label: 'Zap', icon: '🔌', key: 'c' }, { name: 'bell', label: 'Bell', icon: '🔔', key: 'v' },
];

export function Sampler({ mixer }: { mixer: MixerEngine }) {
  const [vol, setVol] = useState(0.8);
  const [flash, setFlash] = useState<string | null>(null);
  const hit = (n: SampleName) => {
    mixer.resume().catch(() => {});
    mixer.playSample(n);
    setFlash(n);
    window.setTimeout(() => setFlash((f) => (f === n ? null : f)), 120);
  };
  return (
    <div className="sampler">
      <div className="pads">
        {PADS.map((p) => (
          <button key={p.name} className={`spad ${flash === p.name ? 'hit' : ''}`} onPointerDown={() => hit(p.name)}>
            <span className="spad-ico">{p.icon}</span>
            <span className="spad-lbl">{p.label}</span>
            <kbd>{p.key.toUpperCase()}</kbd>
          </button>
        ))}
      </div>
      <div className="samp-vol">
        <label className="lbl">VOLUME</label>
        <input type="range" min={0} max={1} step={0.01} value={vol} onChange={(e) => { const v = Number(e.target.value); setVol(v); mixer.setSamplerVolume(v); }} />
      </div>
    </div>
  );
}
