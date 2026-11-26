import { useRef, useState } from 'react';
import type { DeckEngine, MixerEngine, MixerState } from '../../types';
import { useDeckState } from '../hooks';
import { Fader } from '../Fader';
import { Knob } from '../Knob';
import { FxRack } from '../FxRack';
import { TransitionPanel, eqFmt, pctFmt } from '../Mixer';
import { DECK_COLOR } from '../format';

function EqKnob({ deck, band, label }: { deck: DeckEngine; band: 'low' | 'mid' | 'high'; label: string }) {
  const st = useDeckState(deck);
  const prev = useRef(0);
  const v = st.eq[band];
  const killed = v <= -0.99;
  return (
    <div className="m-eq">
      <Knob label={label} value={v} min={-1} max={1} def={0} size={52} color={DECK_COLOR[deck.id]} fmt={eqFmt} onChange={(x) => deck.setEq(band, x)} />
      <button className={`m-kill ${killed ? 'on' : ''}`}
        onClick={() => { if (killed) deck.setEq(band, prev.current > -0.99 ? prev.current : 0); else { prev.current = v; deck.setEq(band, -1); } }}>KILL</button>
    </div>
  );
}

function MChan({ deck }: { deck: DeckEngine }) {
  const st = useDeckState(deck);
  const color = DECK_COLOR[deck.id];
  return (
    <div className="m-chan" style={{ ['--dc' as string]: color }}>
      <div className="m-chead"><span className="m-cid" style={{ background: color }}>{deck.id}</span>
        <button className="m-btn sm" onClick={() => { deck.setEq('low', 0); deck.setEq('mid', 0); deck.setEq('high', 0); deck.setFilter(0); deck.setTrim(1); }}>RESET</button>
      </div>
      <div className="m-knobs">
        <div className="m-eq"><Knob label="FILTER" value={st.filter} min={-1} max={1} def={0} size={52} color={color} fmt={pctFmt} onChange={(v) => deck.setFilter(v)} /><span className="m-kill-sp" /></div>
        <EqKnob deck={deck} band="high" label="HIGH" />
        <EqKnob deck={deck} band="mid" label="MID" />
        <EqKnob deck={deck} band="low" label="LOW" />
      </div>
      <div className="m-vol"><span className="lbl">VOL</span><Fader vertical={false} value={st.gain} min={0} max={1} def={1} className="m-vfader" onChange={(v) => deck.setGain(v)} title="Channel fader" /></div>
    </div>
  );
}

export function MCrossfader({ mixer, state }: { mixer: MixerEngine; state: MixerState }) {
  return (
    <div className="m-xf">
      <span style={{ color: DECK_COLOR.A }}>A</span>
      <Fader vertical={false} value={state.crossfader} min={-1} max={1} def={0} className="m-xfader" onChange={(v) => mixer.setCrossfader(Math.abs(v) < 0.03 ? 0 : v)} title="Crossfader" />
      <span style={{ color: DECK_COLOR.B }}>B</span>
    </div>
  );
}

export function MMixer({ mixer, state }: { mixer: MixerEngine; state: MixerState }) {
  const [fx, setFx] = useState(false);
  return (
    <div className="m-mixer">
      <div className="m-chans"><MChan deck={mixer.decks.A} /><MChan deck={mixer.decks.B} /></div>
      <div className="m-side">
        <MCrossfader mixer={mixer} state={state} />
        <TransitionPanel mixer={mixer} state={state} />
        <div className="m-opts">
          <button className={`m-btn ${state.autoSync ? 'on' : ''}`} onClick={() => mixer.setAutoSync(!state.autoSync)}>AUTO BEATMATCH {state.autoSync ? 'ON' : 'OFF'}</button>
          <div className="m-mbpm"><span className="lbl">MASTER BPM</span>
            <button className="m-btn sm" onClick={() => mixer.nudgeMasterBpm(-1)}>−1</button>
            <button className="m-btn sm" onClick={() => mixer.nudgeMasterBpm(1)}>+1</button></div>
        </div>
        <div className="m-master"><span className="lbl">MASTER</span>
          <input type="range" min={0} max={1.5} step={0.01} value={state.masterGain} onChange={(e) => mixer.setMasterGain(Number(e.target.value))} />
        </div>
        <button className={`m-fxhead ${fx ? 'open' : ''}`} onClick={() => setFx((v) => !v)}><span>FX RACK</span><span>{fx ? '▾' : '▸'}</span></button>
        {fx && <FxRack mixer={mixer} state={state} />}
      </div>
    </div>
  );
}
