import { useRef, useState } from 'react';
import type { MixerEngine, MixerState } from '../types';
import { useFrame } from './frameLoop';
import { fmtTime } from './format';
import { notify } from './core';

const SHORTCUTS: [string, string][] = [
  ['Q / P', 'Play / pause deck A / B'], ['W / O', 'Cue deck A / B (hold to preview)'], ['Z / M', 'Sync deck A / B'],
  ['1-4 / 7-0', 'Hot cues deck A / B (Shift = delete)'], ['← / →', 'Crossfader'], ['T', 'Start transition'],
  ['Space', 'Play / pause last-touched deck'], ['Sampler tab', '1234 qwer asdf zxcv = pads'],
];

const TIPS: [string, string][] = [
  ['Decks', 'Play, cue, sync, tempo, loops and hot cues'], ['Mixer', 'EQ, filter, crossfader, auto transitions, FX'],
  ['Library', 'Import audio, then load to A or B'], ['Hot cue', 'Tap to set or jump, long-press to delete'],
  ['Knobs', 'Drag up / down, double-tap to reset'],
];

interface Props { mixer: MixerEngine; state: MixerState; mobile?: boolean }

export function Toolbar({ mixer, state, mobile = false }: Props) {
  const [help, setHelp] = useState(false);
  const timeRef = useRef<HTMLSpanElement>(null);
  useFrame(() => {
    const el = timeRef.current;
    if (!el) return;
    const s = state.recordingStartedAt;
    if (!state.recording || s == null) { if (el.textContent) el.textContent = ''; return; }
    const now = s > 1e11 ? Date.now() : performance.now();
    el.textContent = fmtTime((now - s) / 1000);
  });

  const toggleRec = async () => {
    if (!state.recording) { mixer.resume().catch(() => {}); mixer.startRecording(); return; }
    try {
      const blob = await mixer.stopRecording();
      const ext = blob.type.includes('wav') ? 'wav' : 'webm';
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `deckline-mix-${new Date().toISOString().replace(/[:.]/g, '-')}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    } catch (e) { notify('Recording failed: ' + (e instanceof Error ? e.message : String(e))); }
  };

  return (
    <header className="toolbar">
      <div className="wordmark">DECKLINE</div>
      <div className="tb-right">
        <button className={`btn rec ${state.recording ? 'on' : ''}`} onClick={toggleRec} title="Record master output; click again to download">
          <span className="rec-dot" /> <span ref={timeRef} className="rec-time" />
          {!state.recording && 'REC'}
        </button>
        <div className="master-vol" title="Master volume (double-click to reset)">
          <span className="lbl">MASTER</span>
          <input type="range" min={0} max={1.5} step={0.01} value={state.masterGain} onChange={(e) => mixer.setMasterGain(Number(e.target.value))} onDoubleClick={() => mixer.setMasterGain(1)} />
        </div>
        <div className="help-wrap">
          <button className="btn small" onClick={() => setHelp((h) => !h)} aria-label="Keyboard shortcuts">?</button>
          {help && (
            <div className="help-pop" onClick={() => setHelp(false)}>
              {(mobile ? TIPS : SHORTCUTS).map(([k, d]) => <div key={k}><kbd>{k}</kbd><span>{d}</span></div>)}
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
