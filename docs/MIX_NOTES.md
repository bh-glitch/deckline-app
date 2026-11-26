# Mix notes: "mixed song.wav"

Rendered by `node tools/render-mix.mjs` (drives `mix.html` + `src/mix/render.ts` in headless Chrome via `tools/cdp.mjs`, OfflineAudioContext, 44.1 kHz stereo, 16-bit WAV). Plan follows `docs/BOLLYWOOD_DJ_GUIDE.md` section 6.

## Tracklist
| # | Track | Detected BPM | Detected key (Camelot) |
|---|-------|--------------|------------------------|
| 1 | Abhi Toh Party Shuru Hui Hai | 135.42 | 6B |
| 2 | Meme sound bite (4.2 s) | n/a | n/a |
| 3 | Saturday Saturday | 135.42 | 10A |

Both songs are analysed at the same tempo, so no stretching is used and keys are not blended (cut + echo transitions only). The analyzer's keys differ from the guide's web look-ups (2A / 3A); treat key as unverified.

## Cue sheet (mix time)
| Time | Event |
|------|-------|
| 0:00 | Party starts on its first beat (lead-in trimmed, 12 ms fade-in) |
| 0:46 | Synthesized riser (noise + saw, HP sweep, 4 bars, low level) |
| 0:53 | Party first big hook (bar 30, 2.4x energy jump after a verse) |
| 2:04.1 | Echo Out begins on a phrase boundary (Party bar 70), 16 beats |
| 2:12.9 | Meme drop, bar-aligned 5 bars after echo start, alone, light reverb |
| 2:18.25 | Saturday slams in on the next downbeat of the grid after the meme + impact hit (sub boom + noise) |
| 4:25.9 | Saturday echo-out (LP sweep, 16 beats) on an 8-bar boundary |
| 4:35.4 | End (about 275 s total) |

Saturday enters at its first hook (source 0:21.55, bar 12, 1.6x energy jump after the intro), per guide 6.D option 2.

## Techniques and why
- Phrase finding: per-bar RMS (full + low band) on the analyzer's beat grid; the phrase phase (bar index mod 8) is the one where energy most consistently jumps up after a break. Cut points are snapped to the nearest low-band onset (within 70 ms) to absorb tempo-grid drift. (Guide section 2, phrasing.)
- Echo Out (guide 6.B): 1/2-beat feedback delay (fb 0.55), send cut at beat 12 so the tail decays, low shelf killed to -40 dB, high-pass sweep 10 Hz to 900 Hz, dry faded beats 6 to 14. Avoids two basslines and muddy tail (guide section 5).
- Meme (6.C) fires into the near-silent gap, alone; own chain: 4:1 compressor (1 ms attack), +9.5 dB makeup, brickwall limiter, 22% reverb tail; Party's echo tail ducked 4 dB while it plays.
- Slam (6.D): 6 ms gain ramp (no clicks) plus synthesized impact. No beatmatch needed.
- Ending (6.E): same echo-out with a low-pass sweep instead of high-pass.
- Master: gentle compressor (2.2:1), then makeup toward about -12.5 dB RMS and a 5 ms lookahead limiter with a -1.2 dBFS ceiling.

## Verification
Peak -1.2 dBFS, RMS -13.0 dBFS overall (loud sections around -10 to -11). Longest silence 1.8 s is the file's end fade; no internal gaps over 1.5 s. Overview canvas in `mix.html`.

## Imperfections
- Beat/phase detection is automatic and unverified by ear; Party's phrases look slightly irregular (about 6-bar sections near the start), so the "phrase" grid is a best fit.
- Meme RMS (-11.6 dBFS over its window) is now within 1 dB of Party's loud sections (-12.5).
