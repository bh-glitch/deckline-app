# Deckline

A two-deck DJ app that runs in the browser (React, TypeScript and the Web Audio API). It plays music files you own.

**Features**
- Automatic BPM, key and 3-band waveform analysis
- Auto beatmatch
- One-button transitions: Fade, Bass Swap, Echo Out, Filter and Cut
- 3-band EQ with kills and a filter
- Loops and hot cues
- Brake
- 16-pad sampler and FX rack
- Mix recording
- Library stored in your browser (IndexedDB)

## Run locally
```bash
npm install
npm run dev        # http://localhost:5173
```

## Tests and tools
```bash
npm test                                   # unit tests
SONGS_DIR=~/Music/set node tools/e2e.mjs   # browser end-to-end test (dev server must be running)
SONGS_DIR=~/Music/set node tools/render-mix.mjs   # render the scripted mix to "mixed song.wav"
```

Pushing to `main` deploys the app to GitHub Pages through `.github/workflows/pages.yml`.
