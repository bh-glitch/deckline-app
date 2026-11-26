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
