// ===== SHARED CONTRACTS — owned by the planner. Do not edit without coordination. =====

export type DeckId = 'A' | 'B';

export interface TrackMeta {
  id: string;            // uuid
  title: string;
  artist: string;
  album?: string;
  genre?: string;
  duration: number;      // seconds
  bpm?: number;          // from analysis (preferred) or tags
  key?: string;          // Camelot notation e.g. "8A"
  fileName: string;
  addedAt: number;       // epoch ms
  analyzed?: boolean;
  firstBeat?: number;    // seconds, first downbeat offset
  cuePoint?: number;     // saved main cue, seconds
  hotCues?: (number | null)[]; // length 8, seconds
  playCount?: number;
  artwork?: string;      // data URL (small thumbnail) if present
}

/** Peak data for drawing a 3-band colored waveform. All arrays same length, values 0..1. */
export interface WaveformData {
  binsPerSecond: number; // e.g. 150
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
}

export interface AnalysisResult {
  bpm: number;           // 60..200, normalized to a sensible DJ range (e.g. 70..180)
  firstBeat: number;     // seconds of first beat
  key?: string;          // Camelot, e.g. "8A"
  waveform: WaveformData;
}

export interface LoopState { start: number; end: number; active: boolean; beats: number | null }

export interface DeckState {
  id: DeckId;
  trackId: string | null;
  loaded: boolean;
  playing: boolean;
  duration: number;
  rate: number;            // playback rate multiplier, 1 = original tempo
  pitchRange: number;      // 0.08 | 0.16 | 0.5 — max +/- deviation for the tempo slider
  bpm: number | null;      // original bpm of the track
  firstBeat: number;
  cuePoint: number;
  hotCues: (number | null)[]; // length 8
  loop: LoopState | null;
  gain: number;            // channel fader 0..1
  trim: number;            // pre-gain 0..2, 1 = unity
  eq: { low: number; mid: number; high: number }; // -1..1 (-1 = kill, 0 = flat, 1 = +6dB)
  filter: number;          // -1..1 (neg = lowpass sweep, pos = highpass sweep, 0 = off)
  keyLock: boolean;
  synced: boolean;
}

export type FxType = 'echo' | 'reverb' | 'flanger' | 'phaser' | 'bitcrush' | 'gate';

export interface FxSlotState { type: FxType; enabled: boolean; wet: number /*0..1*/; param: number /*0..1*/ }

export interface DeckEngine {
  readonly id: DeckId;
  load(buffer: AudioBuffer, meta: TrackMeta, analysis?: AnalysisResult): void;
  unload(): void;
  play(): void;
  pause(): void;
  togglePlay(): void;
  seek(seconds: number): void;
  /** Current playhead in track seconds; must be accurate and cheap (called every animation frame). */
  getPosition(): number;
  setRate(rate: number): void;
  setPitchRange(range: number): void;
  /** Temporary speed bend (jog wheel / nudge): amount -1..1 while held; 0 releases. */
  bend(amount: number): void;
  /** Scratch: move playhead by deltaSeconds immediately (jog wheel in scratch mode). */
  scratch(deltaSeconds: number): void;
  /** Set the main cue at `seconds` (default: current position, beat-snapped) without stopping playback. */
  setCuePoint(seconds?: number): void;
  /** Vinyl-brake stop: slows to a halt over `seconds` (default 0.8), then pauses. */
  brake(seconds?: number): void;
  cue(): void;                 // CDJ-style: if playing → jump to cue & stop; if paused → set cue at position
  cueHold(down: boolean): void; // while held from paused-at-cue, preview play; release returns to cue
  setHotCue(index: number, seconds?: number): void;
  triggerHotCue(index: number): void;
  deleteHotCue(index: number): void;
  setLoop(beats: number): void;        // beat-quantized loop from current position
  setLoopInOut(start: number, end: number): void;
  toggleLoop(): void;
  exitLoop(): void;
  halveLoop(): void;
  doubleLoop(): void;
  beatJump(beats: number): void;
  setGain(v: number): void;
  setTrim(v: number): void;
  setEq(band: 'low' | 'mid' | 'high', v: number): void;
  setFilter(v: number): void;
  setKeyLock(on: boolean): void;
  getState(): DeckState;
  subscribe(fn: (s: DeckState) => void): () => void; // fires on discrete state changes (not position)
  /** Post-fader output node — the mixer connects this to the crossfader stage. */
  readonly output: AudioNode;
  /** Pre-fader tap for cue/metering. */
  readonly analyser: AnalyserNode;
}

export interface MixerState {
  crossfader: number;      // -1 (A) .. 1 (B)
  crossfaderCurve: 'smooth' | 'sharp';
  masterGain: number;      // 0..1.5
  fx: FxSlotState[];       // 3 slots
  fxTarget: 'A' | 'B' | 'master';
  recording: boolean;
  recordingStartedAt: number | null;
  autoSync: boolean;       // auto beat-match a deck when it starts while the other is playing
  transition: TransitionState | null;
}

export type TransitionStyle = 'fade' | 'bassSwap' | 'echoOut' | 'filter' | 'cut';

export interface TransitionState { active: boolean; from: DeckId; to: DeckId; style: TransitionStyle; progress: number /*0..1*/ }

export type SampleName = 'airhorn' | 'siren' | 'rocket' | 'laser' | 'riser' | 'impact' | 'scratch' | 'rewind'
  | 'kick' | 'snare' | 'clap' | 'hat' | 'subdrop' | 'vox' | 'zap' | 'bell';

export interface MixerEngine {
  readonly ctx: AudioContext;
  readonly decks: Record<DeckId, DeckEngine>;
  readonly masterAnalyser: AnalyserNode;
  resume(): Promise<void>;                 // call on first user gesture
  decode(file: Blob): Promise<AudioBuffer>;
  setCrossfader(v: number): void;
  setCrossfaderCurve(c: 'smooth' | 'sharp'): void;
  setMasterGain(v: number): void;
  /** Match `deck`'s tempo to the other deck and align beat phase. */
  sync(deck: DeckId): void;
  unsync(deck: DeckId): void;
  setFx(slot: number, patch: Partial<FxSlotState>): void;
  setFxTarget(t: 'A' | 'B' | 'master'): void;
  startRecording(): void;
  stopRecording(): Promise<Blob>;          // webm/opus or wav
  setAutoSync(on: boolean): void;
  /** Automated mix from the playing deck to `to` over `beats` (4..32): syncs + starts `to` on a downbeat, automates crossfader/EQ/FX, then stops the outgoing deck. */
  transition(to: DeckId, style: TransitionStyle, beats: number): void;
  cancelTransition(): void;
  /** Change tempo of the playing/master deck by `deltaBpm`; synced deck follows. */
  nudgeMasterBpm(deltaBpm: number): void;
  /** One-shot sample through the master bus (gets recorded). */
  playSample(name: SampleName): void;
  setSamplerVolume(v: number): void;
  getState(): MixerState;
  subscribe(fn: (s: MixerState) => void): () => void;
}

export interface LibraryApi {
  tracks: TrackMeta[];
  loading: boolean;
  importFiles(files: File[] | FileList): Promise<void>;
  getFile(id: string): Promise<Blob | undefined>;
  updateTrack(id: string, patch: Partial<TrackMeta>): Promise<void>;
  removeTrack(id: string): Promise<void>;
}
