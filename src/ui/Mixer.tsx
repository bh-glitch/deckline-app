import { useRef } from 'react';
import type { DeckEngine, DeckId, MixerEngine, MixerState, TransitionStyle } from '../types';
import { startTransition, transitionTarget, txStore, useTxSettings } from './core';
import { useDeckState } from './hooks';
import { useFrame } from './frameLoop';
import { Fader } from './Fader';
import { Knob } from './Knob';
import { VuMeter } from './VuMeter';
import { DECK_COLOR } from './format';

const pctFmt = (v: number) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;
const eqFmt = (v: number) => (v <= -0.99 ? 'KILL' : `${v > 0 ? '+' : ''}${(v > 0 ? v * 6 : v * 24).toFixed(1)}dB`);

function EqKnob({ deck, band, label }: { deck: DeckEngine; band: 'low' | 'mid' | 'high'; label: string }) {
  const st = useDeckState(deck);
  const prev = useRef(0);
  const v = st.eq[band];
  const killed = v <= -0.99;
  const color = DECK_COLOR[deck.id];
  return (
    <div className="eq-cell">
      <Knob label={label} value={v} min={-1} max={1} def={0} size={40} color={color} fmt={eqFmt} onChange={(x) => deck.setEq(band, x)} />
      <button className={`kill ${killed ? 'on' : ''}`} title="Kill this band"
        onClick={() => { if (killed) deck.setEq(band, prev.current > -0.99 ? prev.current : 0); else { prev.current = v; deck.setEq(band, -1); } }}>KILL</button>
    </div>
  );
}

function Channel({ deck }: { deck: DeckEngine }) {
  const id: DeckId = deck.id;
  const st = useDeckState(deck);
  const color = DECK_COLOR[id];
  return (
    <div className="chan" style={{ ['--dc' as string]: color }}>
      <div className="chan-head" style={{ background: color }}>{id}</div>
      <Knob label="FILTER" value={st.filter} min={-1} max={1} def={0} size={40} color={color} fmt={pctFmt} onChange={(v) => deck.setFilter(v)} />
      <EqKnob deck={deck} band="high" label="HIGH" />
      <EqKnob deck={deck} band="mid" label="MID" />
      <EqKnob deck={deck} band="low" label="LOW" />
      <button className="btn small reset" title="Reset EQ, filter and trim"
        onClick={() => { deck.setEq('low', 0); deck.setEq('mid', 0); deck.setEq('high', 0); deck.setFilter(0); deck.setTrim(1); }}>RESET</button>
      <div className="chan-fv">
        <Fader vertical value={st.gain} min={0} max={1} def={1} onChange={(v) => deck.setGain(v)} className="chan-fader" title="Channel fader" />
        <VuMeter analyser={deck.analyser} />
      </div>
    </div>
  );
}

const STYLES: { id: TransitionStyle; label: string }[] = [
  { id: 'fade', label: 'Fade' }, { id: 'bassSwap', label: 'Bass Swap' }, { id: 'echoOut', label: 'Echo Out' },
  { id: 'filter', label: 'Filter' }, { id: 'cut', label: 'Cut' },
];

function TransitionPanel({ mixer, state }: { mixer: MixerEngine; state: MixerState }) {
  const tx = useTxSettings();
  const bar = useRef<HTMLDivElement>(null);
  const active = !!state.transition?.active;
  const target = state.transition?.active ? state.transition.to : transitionTarget(mixer);
  const color = DECK_COLOR[target];
  useFrame(() => {
    const t = mixer.getState().transition;
    if (bar.current) bar.current.style.width = t?.active ? `${Math.round(t.progress * 100)}%` : '0%';
  });
  return (
    <div className="tx">
      <div className="tx-title">TRANSITION · LENGTH IN BEATS</div>
      <div className="seg wrap">
        {STYLES.map((s) => (
          <button key={s.id} className={`btn small ${tx.style === s.id ? 'on' : ''}`} onClick={() => txStore.set({ ...tx, style: s.id })}>{s.label}</button>
        ))}
      </div>
      {active ? (
        <div className="tx-run">
          <div className="tx-bar"><div ref={bar} style={{ background: color }} /></div>
          <button className="btn" onClick={() => mixer.cancelTransition()}>Cancel</button>
        </div>
      ) : (
        <div className="tx-go">
          <select className="tx-beats" value={tx.beats} onChange={(e) => txStore.set({ ...tx, beats: Number(e.target.value) })} title="Transition length">
            {[4, 8, 16, 32].map((b) => <option key={b} value={b}>{b} beats</option>)}
          </select>
          <button className="btn mix-btn" style={{ background: color }} onClick={() => startTransition(mixer)} title="Shortcut: T">MIX → {target}</button>
        </div>
      )}
    </div>
  );
}

export function Mixer({ mixer, state }: { mixer: MixerEngine; state: MixerState }) {
  return (
    <section className="mixer">
      <div className="chans">
        <Channel deck={mixer.decks.A} />
        <Channel deck={mixer.decks.B} />
      </div>
      <div className="xf">
        <span style={{ color: DECK_COLOR.A }}>A</span>
        <Fader vertical={false} value={state.crossfader} min={-1} max={1} def={0} className="xfader" onChange={(v) => mixer.setCrossfader(Math.abs(v) < 0.03 ? 0 : v)} title="Crossfader (double-click to center)" />
        <span style={{ color: DECK_COLOR.B }}>B</span>
      </div>
      <TransitionPanel mixer={mixer} state={state} />
      <div className="mix-opts">
        <button className={`btn small ${state.autoSync ? 'on' : ''}`} onClick={() => mixer.setAutoSync(!state.autoSync)}
          title="Automatically keeps beats aligned: when a deck starts while the other is playing, it matches tempo and phase.">
          AUTO BEATMATCH {state.autoSync ? 'ON' : 'OFF'}
        </button>
        <div className="master-bpm">
          <span>MASTER BPM</span>
          <button className="btn small" onClick={() => mixer.nudgeMasterBpm(-1)}>−1</button>
          <button className="btn small" onClick={() => mixer.nudgeMasterBpm(1)}>+1</button>
        </div>
      </div>
    </section>
  );
}
