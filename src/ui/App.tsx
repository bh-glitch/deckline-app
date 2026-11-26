import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './styles.css';
import type { DeckId, MixerEngine } from '../types';
import { LibraryContext } from './context';
import { getMixer, useToast } from './core';
import { useDeckState, useMixerState } from './hooks';
import { useShortcuts } from './shortcuts';
import { useLibrary } from '../library';
import { Toolbar } from './Toolbar';
import { MixView } from './MixView';
import { DeckPanel } from './DeckPanel';
import { Mixer } from './Mixer';
import { Sampler } from './Sampler';
import { FxRack } from './FxRack';
import { Library } from './Library';

type Tab = 'library' | 'sampler' | 'fx';

function Shell({ mixer }: { mixer: MixerEngine }) {
  const mstate = useMixerState(mixer);
  const stA = useDeckState(mixer.decks.A);
  const stB = useDeckState(mixer.decks.B);
  const [tab, setTab] = useState<Tab>('library');
  const [libMax, setLibMax] = useState<boolean>(() => { try { return localStorage.getItem('deckline.libMax') === '1'; } catch { return false; } });
  useEffect(() => { try { localStorage.setItem('deckline.libMax', libMax ? '1' : '0'); } catch { /* ignore */ } }, [libMax]);
  // "/" focuses library search; "L" toggles the expanded library.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '/') { e.preventDefault(); setTab('library'); setTimeout(() => (document.querySelector('.search') as HTMLInputElement | null)?.focus(), 0); }
      if (e.key === 'l' || e.key === 'L') { setTab('library'); setLibMax((v) => !v); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const tabRef = useRef(tab);
  tabRef.current = tab;
  const focus = useRef<DeckId>('A');
  const getFocus = useCallback(() => focus.current, []);
  const setFocus = useCallback((d: DeckId) => { focus.current = d; }, []);
  const samplerOpen = useCallback(() => tabRef.current === 'sampler', []);
  const toast = useToast();

  useShortcuts(mixer, getFocus, setFocus, samplerOpen);

  useEffect(() => {
    const go = () => { mixer.resume().catch(() => {}); };
    window.addEventListener('pointerdown', go, { once: true });
    window.addEventListener('keydown', go, { once: true });
    return () => { window.removeEventListener('pointerdown', go); window.removeEventListener('keydown', go); };
  }, [mixer]);

  if ((import.meta as unknown as { env?: { DEV?: boolean } }).env?.DEV) (window as unknown as Record<string, unknown>).__deckline = { mixer };
  const { A, B } = mixer.decks;
  return (
    <div className={`app ${libMax ? 'lib-max' : ''}`}>
      <Toolbar mixer={mixer} state={mstate} />
      <MixView decks={mixer.decks} />
      <div className="main-row">
        <DeckPanel mixer={mixer} deck={A} onFocus={() => setFocus('A')} />
        <Mixer mixer={mixer} state={mstate} />
        <DeckPanel mixer={mixer} deck={B} onFocus={() => setFocus('B')} />
      </div>
      <section className="bottom">
        <nav className="tabs">
          {([['library', 'Library'], ['sampler', 'Sampler'], ['fx', 'FX']] as [Tab, string][]).map(([id, label]) => (
            <button key={id} className={`tab ${tab === id ? 'on' : ''}`} onClick={() => setTab(id)}>{label}</button>
          ))}
          <button className="btn small lib-expand" onClick={() => { setTab('library'); setLibMax((v) => !v); }} title="Shortcut: L">
            {libMax ? '⤡ Show decks' : '⤢ Expand library'}
          </button>
        </nav>
        <div className="tab-body">
          {tab === 'library' && <Library mixer={mixer} loaded={{ A: stA.trackId, B: stB.trackId }} />}
          {tab === 'sampler' && <Sampler mixer={mixer} />}
          {tab === 'fx' && <FxRack mixer={mixer} state={mstate} />}
        </div>
      </section>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}

export default function App() {
  const lib = useLibrary();
  const boot = useMemo(() => {
    try { return { mixer: getMixer(), error: null as string | null }; }
    catch (e) { return { mixer: null, error: e instanceof Error ? e.message : String(e) }; }
  }, []);
  if (!boot.mixer) return <div className="fatal">Deckline could not start the audio engine: {boot.error}</div>;
  return (
    <LibraryContext.Provider value={lib}>
      <Shell mixer={boot.mixer} />
    </LibraryContext.Provider>
  );
}
