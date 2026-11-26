import type { MixerEngine } from '../types';
import { Mixer } from './mixer';

let instance: Mixer | null = null;

/** Returns the singleton mixer (created lazily). */
export function getMixer(): MixerEngine {
  if (!instance) instance = new Mixer();
  return instance;
}

export function createMixer(): MixerEngine {
  return getMixer();
}
