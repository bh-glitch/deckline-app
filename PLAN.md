# Deckline: build plan

An original two-deck DJ app for the browser (Vite + React + TypeScript + Web Audio API).
It plays music files you own (MP3/AAC/WAV/FLAC/OGG). It takes ideas from the features common
to pro DJ software but uses no code, assets or branding from any existing product.

## Feature map (what pro DJ apps offer → our phase)

| Area | Features | Phase |
|---|---|---|
| Decks | 2 decks, play/pause, CDJ cue, 8 hot cues, tempo slider (±8/16/50%), pitch bend, jog wheel (bend + scratch), beat jump | 1 |
| Loops | Auto loop 1/8–32 beats, loop in/out, halve/double, beat-quantized | 1 |
| Mixer | Trim, 3-band EQ with kill, filter knob (LP/HP), channel faders, crossfader + curve, master, VU meters | 1 |
| Sync | BPM match + beat-phase align | 1 |
| Analysis | BPM, beat grid, key (Camelot), 3-band colored waveform | 1 |
| Waveforms | Scrolling zoomed waveform with beat grid + cue markers, overview with click-to-seek | 1 |
| Library | Import files/folders, drag-drop, ID3 tags + artwork, IndexedDB persistence, search, sort, load to deck | 1 |
| FX | 3 FX slots (echo, reverb, flanger, phaser, bitcrush, gate), wet/param, target deck/master | 1 |
| Recording | Record master output to file | 1 |
| Playlist import | Paste/CSV a Spotify playlist export (titles only) → match against your local library, list missing tracks | 2 |
| Key lock | Time-stretch that keeps pitch while tempo changes | 2 |
| Automix | Auto-transition between queued tracks | 2 |
| MIDI | Web MIDI controller mapping | 2 |
| Stems | Vocal/drum/instrument separation (needs an ML model) | 3 |
| Desktop app | Electron/Tauri wrapper | 3 |

Not included: downloading or ripping audio from Spotify or any other streaming service.

## Architecture & ownership

- `src/types.ts`: shared contracts (planner/Opus)
- `src/engine/`: Web Audio engine: decks, mixer, FX, sync, recording (Sonnet agent)
- `src/analysis/`: BPM/beat/key/waveform in a Web Worker (Sonnet agent)
- `src/library/`: IndexedDB library, tag parsing, import (Haiku agent)
- `src/ui/`: all React components, waveform rendering, keyboard shortcuts (Sonnet agent)
- Integration, review, fixes: planner (Opus)
