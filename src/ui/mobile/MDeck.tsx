import { useRef, useState } from 'react';
import type { DeckEngine, DeckId, MixerEngine } from '../../types';
import { useTrack } from '../context';
import { cueDown, cueUp, toggleSync, useAnalyzing } from '../core';
import { useDeckState } from '../hooks';
import { useFrame } from '../frameLoop';
import { Fader } from '../Fader';
import { Turntable } from '../Turntable';
import { DECK_COLOR, HOT_COLORS, cleanName, fmtTime } from '../format';

const LOOP_SIZES = [1, 2, 4, 8, 16];
const RANGES = [0.08, 0.16, 0.5];

function HotCue({ deck, i, set }: { deck: DeckEngine; i: number; set: boolean }) {
  const timer = useRef(0);
  const long = useRef(false);
  return (
    <button
      className={`m-hot ${set ? 'set' : ''}`} style={set ? { background: HOT_COLORS[i] } : { borderColor: HOT_COLORS[i] }}
      onPointerDown={() => { long.current = false; window.clearTimeout(timer.current); if (set) timer.current = window.setTimeout(() => { long.current = true; deck.deleteHotCue(i); }, 600); }}
      onPointerUp={() => window.clearTimeout(timer.current)}
      onPointerCancel={() => window.clearTimeout(timer.current)}
      onContextMenu={(e) => e.preventDefault()}
      onClick={() => { if (long.current) { long.current = false; return; } if (set) deck.triggerHotCue(i); else deck.setHotCue(i); }}
    >{i + 1}</button>
  );
}

export function MDeck({ mixer, deck, onFocus }: { mixer: MixerEngine; deck: DeckEngine; onFocus: () => void }) {
  const id: DeckId = deck.id;
  const st = useDeckState(deck);
  const meta = useTrack(st.trackId);
  const analyzing = useAnalyzing(id);
  const [loopIdx, setLoopIdx] = useState(2);
  const timeRef = useRef<HTMLSpanElement>(null);
  const stRef = useRef(st);
  stRef.current = st;
  useFrame(() => {
    const el = timeRef.current;
    if (!el) return;
    const s = stRef.current;
    el.textContent = s.loaded ? `-${fmtTime(Math.max(0, s.duration - deck.getPosition()))}` : '';
  });
  const range = st.pitchRange;
  const playBpm = st.bpm ? st.bpm * st.rate : null;
  const pct = (st.rate - 1) * 100;
  const step = (d: number) => { if (st.bpm && playBpm) deck.setRate(Math.min(1 + range, Math.max(1 - range, (playBpm + d) / st.bpm))); };
  const loopSet = (i: number) => { setLoopIdx(i); if (st.loop?.active) deck.setLoop(LOOP_SIZES[i]); };

  return (
    <section className="m-deck" style={{ ['--dc' as string]: DECK_COLOR[id] }} onPointerDown={onFocus}>
      <div className="m-dhead">
        <div className="m-plat"><Turntable deck={deck} state={st} /><span className="m-did">{id}</span></div>
        <div className="m-dtitles">
          <div className="m-dtitle">{st.loaded ? cleanName(meta?.title ?? '') : 'No track loaded'}</div>
          <div className="m-dsub"><span>{analyzing ? 'Analyzing…' : cleanName(meta?.artist ?? '') || (st.loaded ? '' : 'Pick one in Library')}</span><span ref={timeRef} className="m-dtime" /></div>
        </div>
        <div className="m-dbpm">
          <div className="m-bpm">{playBpm ? playBpm.toFixed(1) : '--'}</div>
          <div className="m-bpm-sub"><small>BPM</small>{meta?.key && <span className="keychip">{meta.key}</span>}</div>
        </div>
      </div>

      <div className="m-trans">
        <button className={`m-btn play ${st.playing ? 'on' : ''}`} onClick={() => { mixer.resume().catch(() => {}); deck.togglePlay(); }}>{st.playing ? 'PAUSE' : 'PLAY'}</button>
        <button className="m-btn" onPointerDown={() => cueDown(deck)} onPointerUp={() => cueUp(deck)} onPointerCancel={() => cueUp(deck)} onContextMenu={(e) => e.preventDefault()}>CUE</button>
        <button className={`m-btn ${st.synced ? 'on' : ''}`} onClick={() => toggleSync(mixer, id)}>SYNC</button>
        <button className="m-btn" onClick={() => deck.brake()}>BRAKE</button>
      </div>

      <div className="m-tempo">
        <button className="m-btn sm" onClick={() => step(-0.1)} aria-label="Tempo down">−</button>
        <Fader vertical={false} value={st.rate} min={1 - range} max={1 + range} def={1} className="m-tfader" onChange={(v) => deck.setRate(Math.abs(v - 1) < range * 0.02 ? 1 : v)} title="Tempo" />
        <button className="m-btn sm" onClick={() => step(0.1)} aria-label="Tempo up">+</button>
        <button className="m-btn sm pct" onClick={() => deck.setRate(1)} title="Reset tempo">{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</button>
        <button className="m-btn sm rng" onClick={() => deck.setPitchRange(RANGES[(RANGES.indexOf(range) + 1) % RANGES.length])} title="Pitch range">±{Math.round(range * 100)}</button>
      </div>

      <div className="m-loop">
        <button className={`m-btn sm loopb ${st.loop?.active ? 'on' : ''}`} onClick={() => (st.loop?.active ? deck.exitLoop() : deck.setLoop(LOOP_SIZES[loopIdx]))}>LOOP</button>
        <button className="m-btn sm" onClick={() => loopSet(Math.max(0, loopIdx - 1))} aria-label="Shorter loop">−</button>
        <span className="m-loopsz">{LOOP_SIZES[loopIdx]} {LOOP_SIZES[loopIdx] > 1 ? 'beats' : 'beat'}</span>
        <button className="m-btn sm" onClick={() => loopSet(Math.min(LOOP_SIZES.length - 1, loopIdx + 1))} aria-label="Longer loop">+</button>
        <button className="m-btn sm setcue" onClick={() => deck.setCuePoint()}>SET CUE</button>
      </div>

      <div className="m-hots">
        {[0, 1, 2, 3].map((i) => <HotCue key={i} deck={deck} i={i} set={st.hotCues[i] != null} />)}
      </div>
    </section>
  );
}
