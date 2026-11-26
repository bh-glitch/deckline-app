import { useRef, useState } from 'react';
import type { DeckEngine, DeckId, MixerEngine } from '../types';
import { useLib, useTrack } from './context';
import { cueDown, cueUp, loadTrack, notify, toggleSync, useAnalyzing } from './core';
import { useDeckState } from './hooks';
import { useFrame } from './frameLoop';
import { Fader } from './Fader';
import { Turntable } from './Turntable';
import { DECK_COLOR, HOT_COLORS, TRACK_MIME, cleanName, fmtTime, imageToDataUrl } from './format';

const LOOP_SIZES = [1, 2, 4, 8, 16];
const RANGES = [0.08, 0.16, 0.5];

export function DeckPanel({ mixer, deck, onFocus }: { mixer: MixerEngine; deck: DeckEngine; onFocus: () => void }) {
  const id: DeckId = deck.id;
  const lib = useLib();
  const st = useDeckState(deck);
  const meta = useTrack(st.trackId);
  const analyzing = useAnalyzing(id);
  const [over, setOver] = useState(false);
  const [loopIdx, setLoopIdx] = useState(2);
  const imgIn = useRef<HTMLInputElement>(null);
  const timeRef = useRef<HTMLSpanElement>(null);
  const stRef = useRef(st);
  stRef.current = st;
  const color = DECK_COLOR[id];

  useFrame(() => {
    const el = timeRef.current;
    if (!el) return;
    const s = stRef.current;
    const pos = deck.getPosition();
    el.textContent = s.loaded ? `${fmtTime(pos)}  /  -${fmtTime(Math.max(0, s.duration - pos))}` : '--:--';
  });

  const playBpm = st.bpm ? st.bpm * st.rate : null;
  const setBpm = (b: number) => { if (st.bpm) deck.setRate(Math.min(1 + st.pitchRange, Math.max(1 - st.pitchRange, b / st.bpm))); };
  const range = st.pitchRange;
  const pct = (st.rate - 1) * 100;

  const pickImage = async (f: File | undefined) => {
    if (!f || !meta) return;
    try { await lib.updateTrack(meta.id, { artwork: await imageToDataUrl(f) }); }
    catch { notify('Could not read that image'); }
  };

  return (
    <section
      className={`deck-panel ${over ? 'dropping' : ''}`}
      style={{ ['--dc' as string]: color }}
      onPointerDown={onFocus}
      onDragOver={(e) => { if (e.dataTransfer.types.includes(TRACK_MIME)) { e.preventDefault(); setOver(true); } }}
      onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false); }}
      onDrop={(e) => {
        setOver(false);
        const tid = e.dataTransfer.getData(TRACK_MIME);
        if (tid) { e.preventDefault(); loadTrack(lib, tid, id); }
      }}
    >
      <div className="dp-head">
        <span className="chip big" style={{ background: color }}>{id}</span>
        <div className="dp-titles">
          <div className="dp-title">{st.loaded ? cleanName(meta?.title ?? '') : 'Drag a track here'}</div>
          <div className="dp-artist">{analyzing ? 'Analyzing…' : meta ? cleanName(meta.artist) || ' ' : ' '}</div>
        </div>
        <div className="dp-bpmbox">
          <div className="dp-bpm">{playBpm ? playBpm.toFixed(1) : '--'}<small>BPM</small></div>
          {meta?.key && <span className="keychip">{meta.key}</span>}
        </div>
      </div>

      <div className="dp-top">
        <button className="art" title="Click to set artwork" disabled={!meta} onClick={() => imgIn.current?.click()}
          style={meta?.artwork ? { backgroundImage: `url(${meta.artwork})` } : undefined}>
          {!meta?.artwork && <span className="art-note">♪</span>}
          <span className="art-hint">{meta ? 'Change art' : ''}</span>
        </button>
        <input ref={imgIn} type="file" accept="image/*" hidden onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ''; }} />
        <div className="plat-box"><Turntable deck={deck} state={st} /></div>
        <div className="tempo">
          <button className="btn small" title="Pitch range" onClick={() => deck.setPitchRange(RANGES[(RANGES.indexOf(range) + 1) % RANGES.length])}>±{Math.round(range * 100)}%</button>
          <div className="tempo-slider">
            <Fader vertical value={st.rate} min={1 - range} max={1 + range} def={1} onChange={(v) => deck.setRate(Math.abs(v - 1) < range * 0.02 ? 1 : v)} title="Tempo (double-click to reset)" />
          </div>
          <div className="tempo-pct">{pct >= 0 ? '+' : ''}{pct.toFixed(1)}%</div>
          <div className="tempo-btns">
            <button className="btn small" onClick={() => playBpm && setBpm(playBpm - 0.1)} title="-0.1 BPM">−</button>
            <button className="btn small" onClick={() => playBpm && setBpm(playBpm + 0.1)} title="+0.1 BPM">+</button>
          </div>
          <button className="btn small" onClick={() => deck.setRate(1)}>Reset</button>
        </div>
      </div>

      <div className="dp-time"><span ref={timeRef} /></div>

      <div className="dp-transport">
        <button className={`btn big play ${st.playing ? 'on' : ''}`} onClick={() => { mixer.resume().catch(() => {}); deck.togglePlay(); }}>{st.playing ? 'PAUSE' : 'PLAY'}</button>
        <button className="btn big" title="Hold to preview from cue" onPointerDown={() => cueDown(deck)} onPointerUp={() => cueUp(deck)} onPointerLeave={() => cueUp(deck)}>CUE</button>
        <button className={`btn big ${st.synced ? 'on' : ''}`} onClick={() => toggleSync(mixer, id)}>SYNC</button>
        <button className="btn big" onClick={() => deck.brake()} title="Vinyl brake">BRAKE</button>
        <button className="btn small setcue" onClick={() => deck.setCuePoint()} title="Set cue point here">Set cue</button>
      </div>

      <div className="dp-loop">
        <button className={`btn ${st.loop?.active ? 'on' : ''}`} onClick={() => (st.loop?.active ? deck.exitLoop() : deck.setLoop(LOOP_SIZES[loopIdx]))}>LOOP</button>
        <button className="btn small" onClick={() => { const i = Math.max(0, loopIdx - 1); setLoopIdx(i); if (st.loop?.active) deck.setLoop(LOOP_SIZES[i]); }}>−</button>
        <span className="loop-size">{LOOP_SIZES[loopIdx]} beat{LOOP_SIZES[loopIdx] > 1 ? 's' : ''}</span>
        <button className="btn small" onClick={() => { const i = Math.min(LOOP_SIZES.length - 1, loopIdx + 1); setLoopIdx(i); if (st.loop?.active) deck.setLoop(LOOP_SIZES[i]); }}>+</button>
      </div>

      <div className="dp-hot">
        {[0, 1, 2, 3].map((i) => {
          const set = st.hotCues[i] != null;
          return (
            <button
              key={i} className={`hot ${set ? 'set' : ''}`} style={set ? { background: HOT_COLORS[i] } : { borderColor: HOT_COLORS[i] }}
              title="Click: set / jump. Right-click or Shift-click: delete"
              onClick={(e) => { if (e.shiftKey && set) deck.deleteHotCue(i); else if (set) deck.triggerHotCue(i); else deck.setHotCue(i); }}
              onContextMenu={(e) => { e.preventDefault(); if (set) deck.deleteHotCue(i); }}
            >{i + 1}</button>
          );
        })}
      </div>
    </section>
  );
}
