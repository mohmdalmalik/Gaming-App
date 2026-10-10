# Audio pipeline — every sound of Hotel Escape, made from code

No recordings and no downloaded or licensed audio. Each piece of music and each sound effect is
synthesised by the Python in this folder, so it can be changed and rebuilt at any time.

```
python3 tools/audio/build.py                  # everything (about 6 minutes)
python3 tools/audio/build.py lobby doorOpen   # only these (music piece or effect names)
python3 tools/audio/build.py --wav            # also keep 32-bit WAV masters in tests/shots/audio/ (git-ignored)
python3 tools/audio/viz.py assets/audio/music-lobby.mp3 out.png --chroma 2   # look at a sound: spectrogram + harmony
```

Needs Python 3 with numpy and scipy (Pillow for `viz.py`) and `ffmpeg` with libmp3lame.

It writes:

- `assets/audio/music-*.mp3` — 44.1 kHz stereo, 128 kbps; `assets/audio/sfx-*.mp3` — mono 64 kbps
  (wide effects stereo 96-112 kbps).
- `src/audio/library.js` — the file table the game plays from (GENERATED: rebuild, don't edit).
- `tools/audio/report.json` — every file's duration, size, sample/true peak, loudness (our BS.1770
  meter and ffmpeg's `ebur128`), DC, and for loops the seam checks.

## Files

| file | what it holds |
|---|---|
| `dsp.py` | the toolbox: filters, noise, band-limited oscillators, envelopes, the stereo `Canvas` (a loop canvas wraps overflow round to the start), synthetic hall impulse responses, circular convolution, compressor, look-ahead limiter, a BS.1770 loudness meter, true peak, click score |
| `instruments.py` | the instruments: piano (additive, inharmonic partials, 2-3 detuned strings, two-stage decay, felt hammer, dampers), strings (detuned saw bank, bow attack, delayed vibrato, tremolo, ponticello), celesta (FM), music box (cantilever tine partials), bells (church and small brass), pizzicato bass (Karplus-Strong), timpani, heartbeat, clock, wind and gramophone crackle (both built circularly so they loop) |
| `music.py` | the compositions, as data (chords, melodies, dynamics) plus the arrangement |
| `sfx.py` | the effects: modal synthesis for struck things (wood, brass, porcelain, glass, bells), filtered noise for air and friction, a stick-slip model for hinges, formant-filtered noise for whispers; `EFFECTS` sets each one's loudness (momentary max, LUFS), room and channels |
| `build.py` | mixes each piece (stems balanced by loudness, a reverb send to one hall, gentle bus compression, loudness normalisation, -1.6 dBFS limiter), encodes with ffmpeg, measures the encoded file |
| `viz.py` | spectrogram PNG and a per-slice chroma read-out (to check harmony without listening) |

## The music

- **Lobby — "The Last Waltz at the Grand"** (`lobby`, 80 s loop). D minor, 3/4, 90 bpm with a little
  rubato at phrase ends; 40 bars: A (8) – A′ (8) – B (8) – A″ (8) – coda (8). A slow, melancholy
  jazz-age waltz on an old hotel upright piano (unison strings slightly apart, as an instrument a little
  out of tune), its left hand an oom-pah-pah with the Viennese early second beat over a descending
  line-cliché bass (Dm, Dm/C♯, Dm/C, Dm6/B, B♭maj7, Gm7, Em7♭5, A7♭9). Strings creep in under A′, take
  the tune in B (F major, with B♭m6 – the minor iv of a 1930s ballad – before the turn home), a celesta
  doubles the tune an octave up in A″, and in the coda a slightly out-of-tune music box remembers it over
  a turnaround through E♭7 (a tritone substitute, Neapolitan colour) back to the top. Pizzicato upright
  bass on the downbeats, a high violin harmonic in the last bars, a faint gramophone crackle throughout.
- **In-game — "Night Corridors"** (`game`, 120 s loop). D minor with Phrygian colour, 40 bpm, 20 bars of
  4. A low D pedal in cellos and basses that never stops (overlapping bows); violas moving very slowly
  above it (Dm, B♭/D, Gm/D, the eerie E♭/D a semitone over the pedal, A7 leaning on the pedal before it
  comes home); single piano notes far down a corridor (almost all reverb) that half-remember the lobby
  waltz; a music box somewhere upstairs; a hallway clock ticking slower than a clock should, coming and
  going; wind round the building. Quiet and sparse, made to sit under play for a long time.
- **Final round — "Before Dawn"** (`final`, 53.3 s loop, round 8 of 8). The same D pedal now in bowed
  tremolo; a heartbeat at 72 bpm; a cello line climbing a semitone every bar (D, E♭, E, F …) with the
  violas' tremolo chords following it; a high minor second in the violins that never resolves; a low
  piano bell-stroke every four bars; a timpani roll back to the top.
- **Stingers**: `win` (clean guests escape: Gm6 → A7sus4 → A7 → a D major 6/9 that opens like a window,
  piano and celesta rising), `winPossessed` (the possessed side won: a dark cadence in the waltz's key,
  B♭maj7 → A7♭9 → Dm, a low bell, the music box turning the theme upside down), `lose` (the hotel keeps
  them: a low struck octave, a creeping cluster, violins sliding down, and the lobby's music box winding
  down slower and flatter into the dark), `dawn` (a distant church bell tolls three times over cold open
  fifths and wind).

Loops are seamless by construction: notes, reverb tails and filter states that run past the end wrap
round onto the start, so the loop is exactly periodic. The MP3 also holds 4096 samples of the loop's
own end before it and of its start after it, and the game loops `[loopStart, loopEnd)` — so even a
decoder that delays the audio (MP3 encoder delay is ~1100 samples) loops without a seam. `report.json`
checks it on the decoded file (`seam_diff_db_*` is at or below the MP3 coding noise itself).

Targets: music -16.5 (lobby), -18 (game), -17 (final), -16 (stingers) LUFS integrated, peaks under
-1.6 dBFS; effects by momentary-max loudness (UI clicks around -23, big moments -14). The mix between
them in the game is in `src/audio/sounds.js` (per-cue trims, track trims) and the Settings levels in
`src/settings.js`.

## The effects

Every cue name of `src/audio/bus.js` has a sound; `src/audio/sounds.js` maps names to files. Footsteps
are one sprite (`sfx-steps.mp3`: four steps each on carpet, wooden boards and marble/tile, sliced at
play time). Effects vary a little in pitch and level every time they play (set per cue in sounds.js).
Every effect is high-passed at 30 Hz in `finish()` (no rumble or drift eating headroom), and the big
moments keep some energy in the mid range so a tablet's small speakers carry them: check a change with
a 220 Hz high-pass (4th order) on the decoded file — the revolver should stay at or above the knife.
The game also puts a safety limiter before the speakers (src/audio/index.js), so a loud effect at the top
of its random level, over the music, never clips.

## Tuning

Change a number in `music.py` / `sfx.py`, rebuild only that name, then look (`viz.py`) and measure
(`report.json`). The mix levels of the stems are loudness targets in each piece's `mixdef` (LUFS that
stem would measure on its own), so changing one instrument's level never needs a gain guess.
