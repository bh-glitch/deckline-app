import { useSyncExternalStore } from 'react';
import { createMixer } from '../engine';
import { analyzeBuffer } from '../analysis';
import type { TransitionStyle, AnalysisResult, DeckEngine, DeckId, LibraryApi, MixerEngine, TrackMeta, WaveformData } from '../types';

let mixer: MixerEngine | null = null;
export function getMixer(): MixerEngine {
  if (!mixer) mixer = createMixer();
  return mixer;
}

// ---- analysis cache (in memory, by track id) ----
const analysisCache = new Map<string, AnalysisResult>();
export const getWaveform = (id: string | null): WaveformData | null => (id ? analysisCache.get(id)?.waveform ?? null : null);

// ---- tiny stores: analyzing flags + toast ----
function makeStore<T>(initial: T) {
  let value = initial;
  const subs = new Set<() => void>();
  return {
    get: () => value,
    set: (v: T) => { value = v; subs.forEach((f) => f()); },
    subscribe: (f: () => void) => { subs.add(f); return () => { subs.delete(f); }; },
  };
}
const analyzingStore = { A: makeStore(false), B: makeStore(false) };
export const useAnalyzing = (id: DeckId) => useSyncExternalStore(analyzingStore[id].subscribe, analyzingStore[id].get);
const toastStore = makeStore<string | null>(null);
export const useToast = () => useSyncExternalStore(toastStore.subscribe, toastStore.get);
let toastTimer = 0;
export function notify(msg: string) {
  toastStore.set(msg);
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastStore.set(null), 4000);
}

const loadToken: Record<DeckId, number> = { A: 0, B: 0 };

/** Library -> decode -> deck.load immediately -> analyze -> reload with analysis (position kept). */
export async function loadTrack(lib: LibraryApi, id: string, deckId: DeckId): Promise<void> {
  const m = getMixer();
  const meta = lib.tracks.find((t) => t.id === id);
  if (!meta) return;
  const token = ++loadToken[deckId];
  try {
    const blob = await lib.getFile(id);
    if (!blob) { notify('Audio file for this track is not available'); return; }
    m.resume().catch(() => {});
    const buf = await m.decode(blob);
    if (token !== loadToken[deckId]) return;
    const deck = m.decks[deckId];
    const cached = analysisCache.get(id);
    deck.load(buf, meta, cached);
    if (cached) return;

    analyzingStore[deckId].set(true);
    try {
      const res = await analyzeBuffer(buf);
      analysisCache.set(id, res);
      if (token === loadToken[deckId] && deck.getState().trackId === id) {
        const wasPlaying = deck.getState().playing;
        const pos = deck.getPosition();
        const newMeta: TrackMeta = { ...meta, bpm: res.bpm, key: res.key ?? meta.key, firstBeat: res.firstBeat, analyzed: true };
        deck.load(buf, newMeta, res);
        if (pos > 0.05) deck.seek(pos);
        if (wasPlaying) deck.play();
      }
      lib.updateTrack(id, { bpm: res.bpm, key: res.key ?? meta.key, firstBeat: res.firstBeat, analyzed: true }).catch(() => {});
    } finally {
      if (token === loadToken[deckId]) analyzingStore[deckId].set(false);
    }
  } catch (e) {
    console.error(e);
    analyzingStore[deckId].set(false);
    notify('Could not load track: ' + (e instanceof Error ? e.message : String(e)));
  }
}

/** Pick the deck a double-click should load into: one that is not playing (prefer empty). */
export function pickFreeDeck(m: MixerEngine): DeckId {
  const a = m.decks.A.getState(), b = m.decks.B.getState();
  if (!a.playing && !a.loaded) return 'A';
  if (!b.playing && !b.loaded) return 'B';
  if (!a.playing) return 'A';
  if (!b.playing) return 'B';
  return 'B';
}

// ---- CDJ-style cue button semantics shared by button + keyboard ----
const cueHeld: Record<DeckId, boolean> = { A: false, B: false };
export function cueDown(d: DeckEngine) {
  const s = d.getState();
  if (!s.playing && Math.abs(d.getPosition() - s.cuePoint) < 0.06) { cueHeld[d.id] = true; d.cueHold(true); }
  else d.cue();
}
export function cueUp(d: DeckEngine) {
  if (cueHeld[d.id]) { cueHeld[d.id] = false; d.cueHold(false); }
}

export function toggleSync(m: MixerEngine, id: DeckId) {
  if (m.decks[id].getState().synced) m.unsync(id); else m.sync(id);
}

// ---- transition settings (shared by panel + keyboard) ----
export const txStore = makeStore<{ style: TransitionStyle; beats: number }>({ style: 'fade', beats: 16 });
export const useTxSettings = () => useSyncExternalStore(txStore.subscribe, txStore.get);

/** The deck that is NOT currently audible (the one to mix into). */
export function transitionTarget(m: MixerEngine): DeckId {
  const a = m.decks.A.getState().playing, b = m.decks.B.getState().playing;
  if (a && !b) return 'B';
  if (b && !a) return 'A';
  return m.getState().crossfader <= 0 ? 'B' : 'A';
}
export function startTransition(m: MixerEngine) {
  const { style, beats } = txStore.get();
  const to = transitionTarget(m);
  if (!m.decks[to].getState().loaded) { notify(`Load a track on deck ${to} first`); return; }
  m.resume().catch(() => {});
  m.transition(to, style, beats);
}
