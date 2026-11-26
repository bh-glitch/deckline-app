import { useEffect, useState } from 'react';
import type { DeckEngine, DeckState, MixerEngine, MixerState } from '../types';

export function useDeckState(deck: DeckEngine): DeckState {
  const [s, set] = useState<DeckState>(() => deck.getState());
  useEffect(() => {
    set(deck.getState());
    return deck.subscribe((n) => set(n));
  }, [deck]);
  return s;
}

export function useMixerState(mixer: MixerEngine): MixerState {
  const [s, set] = useState<MixerState>(() => mixer.getState());
  useEffect(() => {
    set(mixer.getState());
    return mixer.subscribe((n) => set(n));
  }, [mixer]);
  return s;
}

/** True below the desktop breakpoint (phones / small tablets). */
export function useIsMobile(): boolean {
  const q = '(max-width: 899px)';
  const [m, set] = useState<boolean>(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => set(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}
