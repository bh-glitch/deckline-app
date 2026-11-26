import type { FxType, MixerEngine, MixerState } from '../types';
import { Knob } from './Knob';

const TYPES: FxType[] = ['echo', 'reverb', 'flanger', 'phaser', 'bitcrush', 'gate'];
const TARGETS: { id: 'A' | 'B' | 'master'; label: string }[] = [
  { id: 'A', label: 'A' }, { id: 'B', label: 'B' }, { id: 'master', label: 'Master' },
];

export function FxRack({ mixer, state }: { mixer: MixerEngine; state: MixerState }) {
  return (
    <div className="fxrack">
      <div className="fx-target">
        <label className="lbl">TARGET</label>
        <div className="seg">
          {TARGETS.map((t) => (
            <button key={t.id} className={`btn small ${state.fxTarget === t.id ? 'on' : ''}`} onClick={() => mixer.setFxTarget(t.id)}>{t.label}</button>
          ))}
        </div>
      </div>
      {state.fx.map((slot, i) => (
        <div key={i} className={`fx-slot ${slot.enabled ? 'on' : ''}`}>
          <div className="fx-head">
            <span className="fx-n">{i + 1}</span>
            <select value={slot.type} onChange={(e) => mixer.setFx(i, { type: e.target.value as FxType })}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
            <button className={`btn small ${slot.enabled ? 'on' : ''}`} onClick={() => mixer.setFx(i, { enabled: !slot.enabled })}>{slot.enabled ? 'ON' : 'OFF'}</button>
          </div>
          <div className="fx-knobs">
            <Knob label="WET" value={slot.wet} min={0} max={1} def={0.5} onChange={(v) => mixer.setFx(i, { wet: v })} />
            <Knob label="PARAM" value={slot.param} min={0} max={1} def={0.5} onChange={(v) => mixer.setFx(i, { param: v })} />
          </div>
        </div>
      ))}
    </div>
  );
}
