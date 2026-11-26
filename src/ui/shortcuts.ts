import { useEffect } from 'react';
import type { DeckId, MixerEngine } from '../types';
import { cueDown, cueUp, startTransition, toggleSync } from './core';
import { PADS } from './Sampler';

const NON_TEXT = new Set(['range', 'checkbox', 'radio', 'button', 'file']);

function isTyping(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') return !NON_TEXT.has((el as HTMLInputElement).type);
  return false;
}

const HOT: Record<string, [DeckId, number]> = {
  Digit1: ['A', 0], Digit2: ['A', 1], Digit3: ['A', 2], Digit4: ['A', 3],
  Digit7: ['B', 0], Digit8: ['B', 1], Digit9: ['B', 2], Digit0: ['B', 3],
};

export function useShortcuts(mixer: MixerEngine, getFocus: () => DeckId, setFocus: (d: DeckId) => void, samplerOpen: () => boolean) {
  useEffect(() => {
    const kd = (e: KeyboardEvent) => {
      if (isTyping(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      const decks = mixer.decks;
      const code = e.code;
      if (code === 'Space') {
        e.preventDefault();
        if (!e.repeat) decks[getFocus()].togglePlay();
        return;
      }
      if (code === 'ArrowLeft' || code === 'ArrowRight') {
        e.preventDefault();
        const v = mixer.getState().crossfader + (code === 'ArrowLeft' ? -0.08 : 0.08);
        mixer.setCrossfader(Math.max(-1, Math.min(1, v)));
        return;
      }
      if (samplerOpen() && !e.shiftKey) {
        const pad = PADS.find((p) => e.key.toLowerCase() === p.key);
        if (pad) { e.preventDefault(); if (!e.repeat) { mixer.resume().catch(() => {}); mixer.playSample(pad.name); } return; }
      }
      if (e.repeat) return;
      const hot = HOT[code];
      if (hot) {
        const [id, i] = hot;
        const d = decks[id];
        setFocus(id);
        if (e.shiftKey || d.getState().hotCues[i] == null) d.setHotCue(i);
        else d.triggerHotCue(i);
        return;
      }
      switch (code) {
        case 'KeyQ': setFocus('A'); decks.A.togglePlay(); break;
        case 'KeyP': setFocus('B'); decks.B.togglePlay(); break;
        case 'KeyW': setFocus('A'); cueDown(decks.A); break;
        case 'KeyO': setFocus('B'); cueDown(decks.B); break;
        case 'KeyZ': setFocus('A'); toggleSync(mixer, 'A'); break;
        case 'KeyT': startTransition(mixer); break;
        case 'KeyM': setFocus('B'); toggleSync(mixer, 'B'); break;
      }
    };
    const ku = (e: KeyboardEvent) => {
      if (e.code === 'KeyW') cueUp(mixer.decks.A);
      else if (e.code === 'KeyO') cueUp(mixer.decks.B);
    };
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    return () => { window.removeEventListener('keydown', kd); window.removeEventListener('keyup', ku); };
  }, [mixer, getFocus, setFocus, samplerOpen]);
}
