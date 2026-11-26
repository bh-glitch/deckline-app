import { useCallback, useEffect, useRef, useState } from 'react';
import './mobile.css';
import type { DeckId, MixerEngine } from '../../types';
import { useToast, startTransition, transitionTarget } from '../core';
import { useDeckState, useMixerState } from '../hooks';
import { useShortcuts } from '../shortcuts';
import { useTrack } from '../context';
import { Toolbar } from '../Toolbar';
import { ScrollRow } from '../MixView';
import { Sampler } from '../Sampler';
import { MDeck } from './MDeck';
import { MMixer, MCrossfader } from './MMixer';
import { MLibrary } from './MLibrary';
import { DECK_COLOR, cleanName } from '../format';
import type { DeckEngine } from '../../types';

type Tab = 'decks' | 'mixer' | 'library' | 'sampler';

const ICONS: Record<Tab, JSX.Element> = {
  decks: <svg viewBox="0 0 24 24"><circle cx="8" cy="12" r="5.5" /><circle cx="8" cy="12" r="1.2" /><circle cx="17" cy="12" r="3.5" /><circle cx="17" cy="12" r=".8" /></svg>,
  mixer: <svg viewBox="0 0 24 24"><path d="M6 4v16M12 4v16M18 4v16" /><rect x="3.5" y="13" width="5" height="3" rx="1" /><rect x="9.5" y="7" width="5" height="3" rx="1" /><rect x="15.5" y="11" width="5" height="3" rx="1" /></svg>,
  library: <svg viewBox="0 0 24 24"><path d="M4 6h16M4 12h16M4 18h10" /><circle cx="18" cy="17.5" r="2.2" /></svg>,
  sampler: <svg viewBox="0 0 24 24"><rect x="3.5" y="3.5" width="7" height="7" rx="1.8" /><rect x="13.5" y="3.5" width="7" height="7" rx="1.8" /><rect x="3.5" y="13.5" width="7" height="7" rx="1.8" /><rect x="13.5" y="13.5" width="7" height="7" rx="1.8" /></svg>,
};
const TABS: [Tab, string][] = [['decks', 'Decks'], ['mixer', 'Mixer'], ['library', 'Library'], ['sampler', 'Sampler']];

function WaveRow({ deck }: { deck: DeckEngine }) {
  const st = useDeckState(deck);
  const meta = useTrack(st.trackId);
  const id: DeckId = deck.id;
  return (
    <div className="m-wf">
      <ScrollRow deck={deck} state={st} />
      <div className="m-wf-t">
        <span className="chip" style={{ background: DECK_COLOR[id] }}>{id}</span>
        <span className="m-wf-name">{st.loaded ? cleanName(meta?.title ?? '') : 'Empty'}</span>
      </div>
    </div>
  );
}

/** Landscape-only strip under the decks: crossfader + big MIX button. */
function DecksXf({ mixer }: { mixer: MixerEngine }) {
  const state = useMixerState(mixer);
  const active = !!state.transition?.active;
  const target = active ? state.transition!.to : transitionTarget(mixer);
  return (
    <div className="m-decks-xf">
      <MCrossfader mixer={mixer} state={state} />
      {active
        ? <button className="m-btn mixgo" onClick={() => mixer.cancelTransition()}>CANCEL {Math.round((state.transition?.progress ?? 0) * 100)}%</button>
        : <button className="m-btn mixgo" style={{ background: DECK_COLOR[target] }} onClick={() => startTransition(mixer)}>MIX → {target}</button>}
    </div>
  );
}

export function MobileShell({ mixer }: { mixer: MixerEngine }) {
  const mstate = useMixerState(mixer);
  const stA = useDeckState(mixer.decks.A);
  const stB = useDeckState(mixer.decks.B);
  const [tab, setTab] = useState<Tab>('decks');
  const focus = useRef<DeckId>('A');
  const getFocus = useCallback(() => focus.current, []);
  const setFocus = useCallback((d: DeckId) => { focus.current = d; }, []);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const samplerOpen = useCallback(() => tabRef.current === 'sampler', []);
  const toast = useToast();
  useShortcuts(mixer, getFocus, setFocus, samplerOpen);

  // iOS only treats touchend/click as audio-unlocking gestures; listen to all of them.
  useEffect(() => {
    const go = () => { mixer.resume().catch(() => {}); };
    const evs = ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown'] as const;
    evs.forEach((e) => window.addEventListener(e, go, { passive: true }));
    return () => evs.forEach((e) => window.removeEventListener(e, go));
  }, [mixer]);

  if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) (window as unknown as Record<string, unknown>).__deckline = { mixer };
  const { A, B } = mixer.decks;
  const pane = (t: Tab) => `m-pane m-p-${t} ${tab === t ? 'on' : ''}`;
  return (
    <div className="m-app">
      <div className="m-top">
        <Toolbar mixer={mixer} state={mstate} mobile />
        <div className="m-waves"><WaveRow deck={A} /><WaveRow deck={B} /></div>
      </div>
      <main className="m-body">
        <div className={pane('decks')}>
          <div className="m-decks">
            <MDeck mixer={mixer} deck={A} onFocus={() => setFocus('A')} />
            <MDeck mixer={mixer} deck={B} onFocus={() => setFocus('B')} />
          </div>
          <DecksXf mixer={mixer} />
        </div>
        <div className={pane('mixer')}><MMixer mixer={mixer} state={mstate} /></div>
        <div className={pane('library')}><MLibrary mixer={mixer} loaded={{ A: stA.trackId, B: stB.trackId }} /></div>
        <div className={pane('sampler')}><Sampler mixer={mixer} /></div>
      </main>
      <nav className="m-tabs">
        {TABS.map(([id, label]) => (
          <button key={id} className={`m-tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>{ICONS[id]}<span>{label}</span></button>
        ))}
      </nav>
      {toast && <div className="toast m-toast">{toast}</div>}
    </div>
  );
}
