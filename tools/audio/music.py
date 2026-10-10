"""The hotel's music, composed as data and rendered with tools/audio/instruments.py.

  lobby   "The Last Waltz at the Grand"  D minor, 3/4, 90 bpm, 40 bars (80 s) - the main menu.
  game    "Night Corridors"              D minor (Aeolian / Phrygian colour), 40 bpm, 20 bars of 4
                                          (120 s) - under the match, for a long time.
  final   "Before Dawn"                   D minor, 72 bpm heartbeat, 16 bars of 4 (53.3 s) - round 8.
  win / winPossessed / lose / dawn       short stingers for the end screen.

Each render function returns a dict of stems {name: (2, n) array} plus the mix settings; build.py
mixes them, adds the room, masters and encodes.
"""
import numpy as np
from dsp import SR, TAU, Canvas, nm, samples, undb, lp, hp, bp, fade, pan, stereo
from instruments import (piano, strings, celesta, music_box, bell, small_bell, pluck_bass, timpani,
                         timpani_roll, heartbeat, clock_tick, wind, crackle, fft_lp)


def parse_melody(text):
    """'D5:2 E5:1 | F5:3 | r:1 ...' -> [[(midi|None, beats), ...] per bar]."""
    bars = []
    for bar in text.split('|'):
        notes = []
        for tok in bar.split():
            p, d = tok.split(':')
            notes.append((None if p == 'r' else nm(p), float(d)))
        bars.append(notes)
    return bars


def merge_sustains(per_bar, bar_times, bar_lens):
    """[[midi, ...] per bar] -> [(midi, start, dur)]: a pitch held into the next bar is one note."""
    out = []
    active = {}
    for b, notes in enumerate(per_bar):
        now = set(notes)
        for m in list(active):
            if m not in now:
                s = active.pop(m)
                out.append((m, s, bar_times[b] - s))
        for m in notes:
            if m not in active:
                active[m] = bar_times[b]
    end = bar_times[-1] + bar_lens[-1]
    for m, s in active.items():
        out.append((m, s, end - s))
    return out


# =================================================================================================
# LOBBY - "The Last Waltz at the Grand"
# =================================================================================================
# A slow, melancholy jazz-age waltz on an old hotel upright, slightly out of tune. A: the theme over
# a descending line cliche in the bass (Dm, Dm/C#, Dm/C, Dm6/B, Bbmaj7, Gm7, Em7b5, A7b9). A': the
# strings creep in under it. B: the theme passes to the strings (F major, with a Bbm6 - the minor
# iv of a 1930s ballad - before the turn home). A'': the theme again, doubled by a celesta an octave
# up. Coda: a music box remembers the tune over a Neapolitan-tinged turnaround (Eb7) back to the
# start. A gramophone crackles faintly under it all.
LOBBY_CHORDS = [  # (bass, [left-hand chord]) per bar
    # A
    ('D3', 'F3 A3 D4'), ('C#3', 'F3 A3 D4'), ('C3', 'F3 A3 D4'), ('B2', 'F3 A3 D4'),
    ('Bb2', 'F3 A3 D4'), ('G2', 'F3 Bb3 D4'), ('E2', 'G3 Bb3 D4'), ('A2', 'G3 Bb3 C#4'),
    # A'
    ('D3', 'F3 A3 D4'), ('C#3', 'F3 A3 D4'), ('C3', 'F3 A3 E4'), ('B2', 'F3 G3 D4'),
    ('G2', 'F3 Bb3 D4'), ('A2', 'G3 Bb3 C#4'), ('D3', 'F3 A3 D4'), ('C3', 'E3 G3 Bb3'),
    # B
    ('F2', 'E3 A3 C4'), ('D3', 'F3 A3 C4'), ('G2', 'F3 Bb3 D4'), ('C3', 'E3 Bb3 D4'),
    ('A2', 'G3 C4 E4'), ('D3', 'F#3 C4 Eb4'), ('Bb2', 'F3 G3 Db4'), ('A2', 'G3 Bb3 C#4'),
    # A''
    ('D3', 'F3 A3 D4'), ('C#3', 'F3 A3 D4'), ('C3', 'F3 A3 D4'), ('B2', 'F3 A3 D4'),
    ('Bb2', 'F3 A3 D4'), ('G2', 'F3 Bb3 D4'), ('A2', 'G3 Bb3 C#4'), ('D3', 'F3 A3 E4'),
    # coda
    ('Bb2', 'F3 A3 D4'), ('A2', 'G3 C#4 E4'), ('D3', 'F3 A3 D4'), ('C3', 'F3 A3 D4'),
    ('Bb2', 'E3 G3 D4'), ('Eb3', 'G3 Db4 F4'), ('E2', 'G3 Bb3 D4'), ('A2', 'G3 Bb3 C#4'),
]
LOBBY_MELODY = parse_melody(
    # A (piano)
    'D5:2 E5:1 | F5:3 | E5:1 D5:1 C5:1 | D5:2 B4:1 | A4:1 D5:1 F5:1 | A5:2 G5:1 | E5:2 D5:1 | C#5:3 |'
    # A' (piano)
    'D5:2 E5:1 | F5:3 | G5:1 F5:1 E5:1 | F5:2 D5:1 | D5:2 Bb4:1 | C#5:1 E5:1 G5:1 | A5:2 F5:1 | E5:2 C5:1 |'
    # B (strings)
    'A4:2 G4:1 | F4:3 | Bb4:2 A4:1 | G4:3 | C5:2 A4:1 | Eb5:2 D5:1 | Db5:3 | C#5:1 D5:1 E5:1 |'
    # A'' (piano + celesta)
    'D5:2 E5:1 | F5:3 | E5:1 D5:1 C5:1 | D5:2 B4:1 | A4:1 D5:1 F5:1 | A5:2 G5:1 | G5:1 F5:1 E5:1 | D5:3 |'
    # coda (music box)
    'F5:1 A5:1 D6:1 | C#6:3 | A5:1 F5:1 D5:1 | E5:3 | D5:1 E5:1 G5:1 | F5:2 Db5:1 | D5:2 Bb4:1 | C#5:2 E5:1')
# phrase dynamics (melody velocity per bar)
LOBBY_DYN = [0.50, 0.54, 0.56, 0.52, 0.56, 0.62, 0.56, 0.48,
             0.52, 0.56, 0.60, 0.56, 0.54, 0.60, 0.64, 0.54,
             0.55, 0.52, 0.58, 0.54, 0.60, 0.66, 0.62, 0.56,
             0.58, 0.62, 0.62, 0.58, 0.62, 0.70, 0.64, 0.56,
             0.48, 0.50, 0.46, 0.44, 0.46, 0.50, 0.44, 0.44]


def lobby(seed=11):
    rng = np.random.default_rng(seed)
    bpm = 90.0
    nbars = len(LOBBY_CHORDS)
    assert nbars == len(LOBBY_MELODY) == 40
    # a little breathing in the tempo: phrase ends stretch, the rest gives the time back
    w = np.ones(nbars)
    for b in (3, 7, 11, 15, 23, 31, 39):
        w[b] = 1.07
    for b in (15, 31):
        w[b] = 1.09
    bar_len = 3 * 60 / bpm * w * nbars / w.sum()
    bar_t = np.concatenate([[0], np.cumsum(bar_len)[:-1]])
    L = float(bar_len.sum())                       # exactly 80 s
    beat = lambda b, x: bar_t[b] + x * bar_len[b] / 3
    hum = lambda s=0.006: rng.normal(0, s)

    st = {k: Canvas(L, loop=True) for k in ('melody', 'lh', 'bass', 'pad', 'cello', 'smel', 'celesta', 'mbox', 'harm', 'crackle')}
    unison = 2.0                                     # cents: the old upright's strings drift apart

    def pno(canvas, m, t, d, v, p=0.0, bright=0.85, max_len=None):
        x = piano(m, d, v, seed=int(rng.integers(1 << 30)), bright=bright, tune=rng.normal(0, unison), max_len=max_len)
        canvas.add(x, t, p)

    # --- piano left hand: oom-pah-pah (beat 2 a touch early: the Viennese lilt) ------------------
    for b, (bass, chord) in enumerate(LOBBY_CHORDS):
        coda = b >= 32
        bm = nm(bass)
        ch = [nm(c) for c in chord.split()]
        endb = bar_t[b] + bar_len[b] - 0.06
        vb = 0.40 if not coda else 0.34
        pno(st['lh'], bm, bar_t[b] + hum(0.004), endb - bar_t[b], vb + hum(0.02), -0.25, 0.9)
        if b in range(24, 32) or b in (8, 14):
            pno(st['lh'], bm - 12, bar_t[b] + 0.004, endb - bar_t[b], vb * 0.55, -0.3, 0.7)
        if b in range(16, 24):
            # B: broken chords in eighths instead of the pah-pah
            seq = [ch[0], ch[1], ch[2], ch[1], ch[0]]
            for k, m in enumerate(seq):
                tt = bar_t[b] + (k + 1) * bar_len[b] / 6 + hum(0.006)
                pno(st['lh'], m, tt, endb - tt, 0.24 + 0.03 * (k == 2) + hum(0.015), -0.05 + 0.08 * k, 0.75)
            continue
        if coda and b >= 36:
            # the last bars: one soft rolled chord per bar
            for k, m in enumerate(ch):
                tt = beat(b, 1) + k * 0.05
                pno(st['lh'], m, tt, endb - tt, 0.22 + hum(0.01), 0.0, 0.7)
            continue
        for x, v in ((1, 0.27), (2, 0.22)):
            tt = beat(b, x) - (0.035 if x == 1 else 0.0) + hum(0.004)
            for k, m in enumerate(ch):
                pno(st['lh'], m, tt + k * 0.004, endb - tt, (v if not coda else v * 0.8) + hum(0.012), -0.1 + 0.1 * k, 0.88)

    # --- melody: piano (A, A', A''), strings (B), music box (coda) --------------------------------
    for b, notes in enumerate(LOBBY_MELODY):
        x = 0.0
        dyn = LOBBY_DYN[b]
        for i, (m, d) in enumerate(notes):
            t0 = beat(b, x) + 0.012 + hum(0.008)          # the tune sits just behind the beat
            dur = d * bar_len[b] / 3
            x += d
            if m is None:
                continue
            accent = 1.0 + (0.06 if i == 0 else 0.0)
            if b < 16 or 24 <= b < 32:
                # (the pedal lets each note ring a little into the next)
                pno(st['melody'], m, t0, dur + 0.22, dyn * accent * 0.95, 0.12, 1.08)
                if 24 <= b < 32 or (12 <= b < 16):
                    cv = 0.30 if b >= 24 else 0.18
                    st['celesta'].add(celesta(m + 12, cv * dyn / 0.6, seed=int(rng.integers(1 << 30))), t0 + 0.004, 0.35)
            elif b < 24:
                st['smel'].add(strings(m, dur + 0.08, 0.42 + 0.35 * (dyn - 0.5), seed=int(rng.integers(1 << 30)),
                                       attack=0.22, release=0.55, voices=4, detune=5, vib=11, vib_rate=5.6, bright=1.05),
                               t0 - 0.05, 0.05)
            else:
                st['mbox'].add(music_box(m, 0.55 + 0.4 * (dyn - 0.45), seed=int(rng.integers(1 << 30))), t0, 0.2 * np.sin(b))

    # --- strings: pad (violas) from A', cello on the bass line, a high harmonic in the coda --------
    pad_bars = [[nm(c) for c in LOBBY_CHORDS[b][1].split()] if 8 <= b < 32 else [] for b in range(nbars)]
    for m, s, d in merge_sustains(pad_bars, list(bar_t) + [L], list(bar_len) + [0]):
        b0 = int(np.searchsorted(bar_t, s + 1e-6) - 1)
        v = 0.26 if b0 < 16 else 0.22 if b0 < 24 else 0.34
        st['pad'].add(strings(m, d + 0.15, v, seed=int(rng.integers(1 << 30)), attack=0.9, release=1.2,
                              voices=3, detune=8, vib=6, vib_rate=5.0, bright=0.8), s - 0.05, 0.0)
    cello_bars = [[nm(LOBBY_CHORDS[b][0])] if b >= 4 else [] for b in range(nbars)]
    for m, s, d in merge_sustains(cello_bars, list(bar_t) + [L], list(bar_len) + [0]):
        b0 = int(np.searchsorted(bar_t, s + 1e-6) - 1)
        v = 0.30 if b0 < 8 else 0.36 if b0 < 32 else 0.28
        st['cello'].add(strings(m, d + 0.1, v, seed=int(rng.integers(1 << 30)), attack=0.45, release=0.9,
                                voices=2, detune=6, vib=7, vib_rate=5.2, bright=0.7), s - 0.04, -0.15)
    for b, (bass, _) in enumerate(LOBBY_CHORDS):
        if 8 <= b < 32:
            st['bass'].add(pluck_bass(nm(bass) - 12, bar_len[b] * 0.8, 0.5 + hum(0.03), seed=int(rng.integers(1 << 30))),
                           bar_t[b] - 0.01, -0.1)
    # high violin harmonic (A5) shimmering over the last four bars, and its echo into bar 1
    st['harm'].add(strings(nm('A5'), bar_t[39] + bar_len[39] - bar_t[36] + 0.5, 0.16, seed=5, attack=2.5, release=2.2,
                           voices=2, detune=3, vib=4, vib_rate=4.6, bright=1.2), bar_t[36], 0.3)
    st['crackle'].add(crackle(L, seed=seed + 3, rate=6.5, level=1.0), 0.0)

    stems = {k: c.buf for k, c in st.items()}
    mixdef = {  # stem: (loudness target LUFS when playing alone, reverb send)
        'melody': (-21.0, 0.30), 'lh': (-25.5, 0.26), 'bass': (-31.0, 0.12), 'pad': (-28.5, 0.42),
        'cello': (-29.0, 0.32), 'smel': (-22.5, 0.40), 'celesta': (-31.0, 0.50), 'mbox': (-23.5, 0.50),
        'harm': (-36.0, 0.6), 'crackle': (-44.0, 0.0),
    }
    return dict(stems=stems, mix=mixdef, length=L, loop=True, reverb=dict(rt60=2.3, predelay=0.022, seed=21),
                target=-16.5, vintage=True)


# =================================================================================================
# IN-GAME - "Night Corridors"
# =================================================================================================
# Sparse and quiet for a long sit: a low D pedal in the cellos and basses that never stops, violas
# moving very slowly over it (Dm, Bb/D, Gm/D, then the eerie Eb/D a semitone above the pedal, and
# an A7 that leans on the pedal before it comes home), single piano notes far down a corridor that
# half-remember the lobby waltz, a hallway clock ticking slower than a clock should, and wind.
GAME_HARMONY = [  # per 6-second bar: upper strings (over the D pedal)
    'A3 F4', 'A3 F4', 'A3 D4 F4', 'A3 D4 F4',
    'Bb3 D4 F4', 'Bb3 D4 F4', 'Bb3 F4',
    'Bb3 D4 G4', 'Bb3 D4 G4', 'Bb3 G4',
    'Bb3 Eb4 G4', 'Bb3 Eb4 G4',
    'A3 E4 F4', 'A3 E4 F4',
    'A3 Bb3 F4', 'A3 Bb3 F4',
    'Bb3 E4 G4', 'Bb3 E4 G4',
    'A3 D4 G4', 'A3 C#4 G4',
]
# far piano: (bar, beat 0-3.x, note, velocity)
GAME_PIANO = [
    (0, 0, 'D5', .42), (0, 2, 'E5', .36), (1, 0, 'F5', .44), (2, 2.5, 'A4', .30),
    (4, 0, 'D5', .38), (4, 2, 'C5', .32), (5, 0.5, 'A4', .34), (6, 0, 'D3', .40),
    (7, 1, 'Bb4', .34), (8, 0, 'G4', .36), (8, 3, 'D5', .30), (10, 0, 'Eb5', .42),
    (10, 2, 'D5', .32), (11, 0, 'Bb4', .30), (12, 0, 'F5', .40), (12, 2, 'E5', .34),
    (13, 0.5, 'A4', .36), (14, 1, 'D5', .32), (15, 0, 'A5', .26), (15, 0, 'D5', .20),
    (16, 0, 'G4', .34), (16, 2, 'E5', .30), (17, 1, 'Bb4', .30), (18, 0, 'C#5', .38),
    (19, 0, 'E5', .28), (19, 2, 'A4', .30),
]


def game(seed=23):
    rng = np.random.default_rng(seed)
    beat = 60 / 40.0                     # 1.5 s
    barL = beat * 4                      # 6 s
    nb = len(GAME_HARMONY)
    L = barL * nb                        # 120 s
    st = {k: Canvas(L, loop=True) for k in ('drone', 'violas', 'piano', 'mbox', 'harm', 'clock', 'wind')}
    # the pedal: overlapping long bows so it never breathes all at once
    for k in range(10):
        t0 = k * 12.0
        st['drone'].add(strings(nm('D2'), 15.0, 0.30, seed=100 + k, attack=4.0, release=4.0, voices=3,
                                detune=6, vib=3, vib_rate=4.4, bright=0.55), t0, -0.1)
        st['drone'].add(strings(nm('D3'), 13.0, 0.18, seed=200 + k, attack=4.5, release=4.0, voices=2,
                                detune=5, vib=3, vib_rate=4.0, bright=0.6), t0 + 6.0, 0.15)
    # a soft fifth (A2) in some stretches
    for t0, d in ((0.0, 22.0), (72.0, 24.0)):
        st['drone'].add(strings(nm('A2'), d, 0.16, seed=int(t0) + 7, attack=5.0, release=5.0, voices=2,
                                detune=6, vib=2, bright=0.55), t0, 0.2)
    # violas: the slow chords, merged where a note carries on
    bars = [[nm(n) for n in h.split()] for h in GAME_HARMONY]
    bt = [i * barL for i in range(nb)]
    for m, s, d in merge_sustains(bars, bt + [L], [barL] * nb + [0]):
        st['violas'].add(strings(m, d + 1.2, 0.20, seed=int(rng.integers(1 << 30)), attack=2.8, release=3.0,
                                 voices=3, detune=7, vib=4, vib_rate=4.8, bright=0.62), s - 0.8, rng.uniform(-0.35, 0.35))
    # the far piano
    for b, x, n, v in GAME_PIANO:
        t0 = b * barL + x * beat + rng.normal(0, 0.02)
        st['piano'].add(piano(nm(n), 2.2, v, seed=int(rng.integers(1 << 30)), bright=0.7, tune=rng.normal(0, 3), damper=False,
                              max_len=7.0), t0, rng.uniform(-0.5, 0.5))
    # a music box somewhere upstairs, remembering the coda (bars 16-17)
    for i, (n, x) in enumerate((('A5', 0), ('F5', 1.2), ('D5', 2.4), ('E5', 4.4))):
        st['mbox'].add(music_box(nm(n), 0.5, seed=300 + i), 16 * barL + x * beat * 0.9, -0.4)
    # violin harmonics: a cold glint now and then
    for t0, n in ((40.0, 'A5'), (64.0, 'Bb5'), (98.0, 'E6')):
        st['harm'].add(strings(nm(n), 7.0, 0.12, seed=int(t0), attack=3.0, release=3.0, voices=2, detune=3, vib=3,
                               bright=1.1), t0, rng.uniform(-0.6, 0.6))
    # the hallway clock: tick... tock... (slower than a clock should be), coming and going
    nticks = int(L / beat)
    for i in range(nticks):
        tt = i * beat
        u = tt / L
        presence = np.clip(0.5 + 0.8 * np.sin(TAU * 2 * u + 0.6), 0, 1)
        if presence < 0.05:
            continue
        st['clock'].add(clock_tick(0.5 * presence, seed=400 + i, tock=bool(i % 2), muffle=2200), tt + rng.normal(0, 0.003), 0.45)
    st['wind'].add(wind(L, seed=seed + 9, cycles=(3, 5), level=1.0, howl=0.6), 0.0)
    stems = {k: c.buf for k, c in st.items()}
    mixdef = {
        'drone': (-24.0, 0.30), 'violas': (-27.0, 0.45), 'piano': (-27.0, 0.85), 'mbox': (-33.0, 0.85),
        'harm': (-36.0, 0.70), 'clock': (-38.0, 0.45), 'wind': (-33.0, 0.10),
    }
    return dict(stems=stems, mix=mixdef, length=L, loop=True, reverb=dict(rt60=3.4, predelay=0.04, seed=31, dark=1.4),
                target=-18.0, wet_only={'piano', 'mbox'})


# =================================================================================================
# FINAL ROUND - "Before Dawn"
# =================================================================================================
# Round 8 of 8. The same D pedal, now bowed in tremolo; a heartbeat; a cello line that climbs a
# semitone every bar (D, Eb, E, F ... ) with the violas' tremolo chords following it, so the
# tension never lets go; a low piano bell-stroke every four bars; a timpani roll back to the top.
FINAL_LINE = ['D3', 'Eb3', 'E3', 'F3', 'F#3', 'G3', 'G#3', 'A3', 'Bb3', 'B3', 'C4', 'C#4', 'D4', 'Eb4', 'E4', 'A3']
FINAL_CHORDS = ['D4 F4 A4', 'Eb4 G4 Bb4', 'E4 G4 C#5', 'D4 F4 A4', 'D4 F#4 C5', 'D4 G4 Bb4', 'D4 F4 B4', 'C#4 E4 G4',
                'D4 F4 Bb4', 'D4 F4 B4', 'C4 E4 A4', 'C#4 E4 A4', 'D4 F4 A4', 'Eb4 G4 Bb4', 'E4 G4 C#5', 'C#4 G4 Bb4']


def final(seed=37):
    rng = np.random.default_rng(seed)
    beat = 60 / 72.0
    barL = beat * 4
    nb = 16
    L = barL * nb
    st = {k: Canvas(L, loop=True) for k in ('pulse', 'drone', 'line', 'trem', 'high', 'piano', 'timp', 'wind')}
    for i in range(nb * 4):
        acc = 1.0 if i % 4 == 0 else 0.85
        st['pulse'].add(heartbeat(0.8 * acc + rng.normal(0, 0.03), seed=500 + i, gap=0.19), i * beat + rng.normal(0, 0.004))
    for k in range(4):
        st['drone'].add(strings(nm('D2'), barL * 4 + 2.0, 0.4, seed=600 + k, attack=1.5, release=2.0, voices=3,
                                detune=6, vib=3, tremolo=0.55, trem_rate=11.5, bright=0.6), k * barL * 4, -0.1)
    for b, n in enumerate(FINAL_LINE):
        st['line'].add(strings(nm(n), barL + 0.1, 0.42 + 0.01 * b, seed=700 + b, attack=0.35, release=0.6, voices=3,
                               detune=5, vib=8, vib_rate=5.8, bright=0.85), b * barL - 0.05, -0.25)
    for b, ch in enumerate(FINAL_CHORDS):
        for j, n in enumerate(ch.split()):
            st['trem'].add(strings(nm(n), barL + 0.15, 0.30 + 0.012 * b, seed=800 + b * 5 + j, attack=0.25, release=0.5,
                                   voices=3, detune=7, vib=4, tremolo=0.85, trem_rate=12.5, ponticello=0.35, bright=0.9),
                           b * barL - 0.03, -0.4 + 0.4 * j)
    # high violins: a minor second that will not resolve (bars 9-16), growing
    swell = np.linspace(0.3, 1.0, samples(barL * 8))
    for j, n in enumerate(('A5', 'Bb5')):
        st['high'].add(strings(nm(n), barL * 8, 0.20, seed=900 + j, attack=2.5, release=1.0, voices=3, detune=4,
                               vib=5, tremolo=0.7, trem_rate=13.0, ponticello=0.5, bright=1.0, swell=swell), 8 * barL, 0.3 - 0.6 * j)
    # low piano strokes every four bars, and one high, lonely note between
    for k in range(4):
        t0 = k * 4 * barL
        for m, v in (('D1', 0.75), ('D2', 0.6), ('A2', 0.45), ('Eb3', 0.25)):
            st['piano'].add(piano(nm(m), barL * 3.5, v, seed=1000 + k * 7 + nm(m), bright=0.8, damper=False, max_len=9.0), t0 + 0.004 * nm(m) % 0.02, -0.2)
        st['piano'].add(piano(nm('A5') if k % 2 == 0 else nm('Bb5'), 1.0, 0.32, seed=1100 + k, bright=0.8, damper=False,
                              max_len=4.0), t0 + 2 * barL + 2 * beat, 0.35)
    st['timp'].add(timpani_roll(nm('D2'), length=barL * 0.95, v0=0.08, v1=0.75, seed=1200), L - barL * 0.95, 0.0)
    st['timp'].add(timpani(nm('D2'), 0.8, seed=1300), 0.0, 0.0)
    st['wind'].add(wind(L, seed=seed + 4, cycles=(2, 3), level=1.0, howl=0.4), 0.0)
    stems = {k: c.buf for k, c in st.items()}
    mixdef = {
        'pulse': (-24.0, 0.10), 'drone': (-25.0, 0.25), 'line': (-25.5, 0.30), 'trem': (-25.0, 0.35),
        'high': (-31.0, 0.45), 'piano': (-25.0, 0.45), 'timp': (-27.0, 0.25), 'wind': (-36.0, 0.05),
    }
    return dict(stems=stems, mix=mixdef, length=L, loop=True, reverb=dict(rt60=2.8, predelay=0.03, seed=41, dark=1.2),
                target=-17.0)


# =================================================================================================
# STINGERS
# =================================================================================================
def _one_shot(length, tail):
    return lambda: Canvas(length, loop=False, tail_s=tail)


def win(seed=51):
    """The clean guests escape: Gm6 -> A7sus4 -> A7 -> a D major 6/9 that opens like a window."""
    rng = np.random.default_rng(seed)
    mk = _one_shot(6.5, 2.5)
    st = {k: mk() for k in ('strings', 'piano', 'celesta', 'bell', 'bass')}
    seqs = [(0.00, 1.05, 'G2', 'D3 Bb3 E4 G4'), (1.05, 0.55, 'A2', 'D3 G3 E4 A4'), (1.60, 0.60, 'A2', 'C#3 G3 E4 A4'),
            (2.20, 4.30, 'D2', 'A2 F#3 B3 E4 A4 D5')]
    for t0, d, b, ch in seqs:
        big = t0 >= 2.2
        st['bass'].add(strings(nm(b), d + 0.1, 0.5 if big else 0.4, seed=int(rng.integers(1 << 30)), attack=0.3 if not big else 0.15,
                               release=2.2 if big else 0.4, voices=3, detune=6, vib=5, bright=0.7), t0, 0.0)
        for j, n in enumerate(ch.split()):
            st['strings'].add(strings(nm(n), d + 0.08, 0.42 if big else 0.33, seed=int(rng.integers(1 << 30)),
                                      attack=0.5 if t0 == 0 else 0.18, release=2.6 if big else 0.35, voices=3, detune=7,
                                      vib=9 if big else 6, bright=1.0 if big else 0.8), t0 - 0.02, -0.5 + 0.2 * j)
        # piano: rolled chord
        notes = [nm(b)] + [nm(n) for n in ch.split()[:4]]
        for j, m in enumerate(notes):
            st['piano'].add(piano(m, d + (1.5 if big else 0.1), 0.45 + 0.05 * big, seed=int(rng.integers(1 << 30)), bright=1.0,
                                  damper=not big, max_len=6), t0 + j * 0.035, -0.2 + 0.1 * j)
    for j, n in enumerate(('D3', 'A3', 'F#4', 'B4', 'E5', 'F#5', 'A5')):
        st['piano'].add(piano(nm(n), 3.0, 0.40, seed=1400 + j, bright=1.05, damper=False, max_len=5.0), 2.32 + j * 0.11, -0.3 + 0.1 * j)
    for j, n in enumerate(('A5', 'D6', 'F#6', 'A6', 'D7')):
        st['celesta'].add(celesta(nm(n), 0.45, seed=1500 + j), 2.5 + j * 0.13, 0.4 - 0.15 * j)
    st['bell'].add(small_bell(float(np.squeeze(440 * 2 ** ((nm('D6') - 69) / 12))), 0.35, seed=1600, decay=2.2), 2.22, 0.2)
    stems = {k: c.buf for k, c in st.items()}
    mixdef = {'strings': (-19.0, 0.40), 'piano': (-20.0, 0.32), 'celesta': (-27.0, 0.5), 'bell': (-30.0, 0.5), 'bass': (-25.0, 0.3)}
    return dict(stems=stems, mix=mixdef, length=9.0, loop=False, reverb=dict(rt60=2.4, predelay=0.02, seed=61),
                target=-16.0, fade_out=1.5)


def win_possessed(seed=53):
    """The possessed win: a dark cadence in the waltz's own key (Bbmaj7 -> A7b9 -> Dm), a low bell,
    and the music box turning the theme upside down."""
    rng = np.random.default_rng(seed)
    mk = _one_shot(6.0, 2.5)
    st = {k: mk() for k in ('strings', 'piano', 'mbox', 'bell', 'bass')}
    seqs = [(0.0, 0.9, 'Bb1', 'F3 A3 D4'), (0.9, 0.9, 'A1', 'G3 Bb3 C#4 E4'), (1.8, 4.2, 'D2', 'D3 A3 F4 D5')]
    for t0, d, b, ch in seqs:
        last = t0 >= 1.8
        st['bass'].add(strings(nm(b) + 12, d + 0.1, 0.5, seed=int(rng.integers(1 << 30)), attack=0.15, release=2.5 if last else 0.3,
                               voices=3, detune=6, vib=4, bright=0.6), t0, 0.0)
        for j, n in enumerate(ch.split()):
            st['strings'].add(strings(nm(n), d + 0.05, 0.40 if last else 0.34, seed=int(rng.integers(1 << 30)), attack=0.2,
                                      release=2.6 if last else 0.3, voices=3, detune=8, vib=7, tremolo=0.35 if last else 0.0,
                                      trem_rate=11.0, bright=0.8), t0 - 0.02, -0.45 + 0.3 * j)
        for j, m in enumerate([nm(b), nm(b) + 12] + [nm(n) for n in ch.split()]):
            st['piano'].add(piano(m, d + (2.0 if last else 0.05), 0.5 if last else 0.42, seed=int(rng.integers(1 << 30)), bright=0.85,
                                  damper=not last, max_len=6.5), t0 + 0.02 * j, -0.25 + 0.1 * j)
    for j, n in enumerate(('D6', 'A5', 'F5', 'D5', 'C#5', 'D5')):
        st['mbox'].add(music_box(nm(n), 0.55, seed=1700 + j), 2.0 + j * 0.42 + (0.25 if j >= 4 else 0), 0.3 - 0.1 * j)
    st['bell'].add(bell(float(440 * 2 ** ((nm('D3') - 69) / 12)), 0.6, seed=1800, size=5.0), 1.8, 0.0)
    stems = {k: c.buf for k, c in st.items()}
    mixdef = {'strings': (-20.0, 0.40), 'piano': (-20.0, 0.30), 'mbox': (-25.0, 0.5), 'bell': (-25.0, 0.5), 'bass': (-25.0, 0.3)}
    return dict(stems=stems, mix=mixdef, length=8.5, loop=False, reverb=dict(rt60=2.6, predelay=0.02, seed=63),
                target=-16.0, fade_out=1.5)


def lose(seed=55):
    """The hotel keeps them: a low struck octave, a cluster creeping in under it, the violins sliding
    down, and the lobby's music box winding down - slower and flatter - into the dark."""
    rng = np.random.default_rng(seed)
    mk = _one_shot(7.0, 2.0)
    st = {k: mk() for k in ('piano', 'low', 'slide', 'mbox', 'timp')}
    for m, v in (('D1', 0.8), ('D2', 0.7), ('A2', 0.4)):
        st['piano'].add(piano(nm(m), 5.0, v, seed=1900 + nm(m), bright=0.8, damper=False, max_len=8.0), 0.0, -0.1)
    st['timp'].add(timpani(nm('D2'), 0.8, seed=1950, length=4.0), 0.0, 0.0)
    for j, (n, v) in enumerate((('D2', 0.42), ('Eb2', 0.30), ('A2', 0.30), ('D3', 0.26))):
        st['low'].add(strings(nm(n), 5.6, v, seed=2000 + j, attack=1.6, release=2.5, voices=3, detune=9, vib=3, bright=0.55), 0.15, -0.3 + 0.2 * j)
    # violins sliding down a fourth, ppp
    n = samples(4.0)
    t = np.arange(n) / SR
    glide = np.clip((t - 0.6) / 2.6, 0, 1)
    sl = np.zeros((2, n))
    for v in range(4):
        from dsp import saw_blep
        cents = (v - 1.5) * 5
        f = 440 * 2 ** ((nm('D5') - 69 - 5 * (glide ** 1.4) + cents / 100) / 12) * (1 + 0.004 * np.sin(TAU * 5.3 * t + v))
        x = saw_blep(f, phase0=rng.uniform())
        sl[v % 2] += x
    sl = lp(sl, 2600, 2) * np.sin(np.clip(t / 0.8, 0, 1) * np.pi / 2) * np.exp(-np.clip(t - 2.6, 0, None) / 0.6)
    st['slide'].add(sl * 0.25, 0.7, 0.0)
    # the music box winds down: each note later and flatter than the last
    tt = 0.45
    for j, (nn, gap) in enumerate((('D6', 0.42), ('E6', 0.55), ('F6', 0.75), ('D6', 1.05), ('C#6', 1.5))):
        st['mbox'].add(music_box(nm(nn), 0.55 - 0.05 * j, seed=2100 + j, detune_cents=-12 - 30 * j ** 1.5), tt, 0.25)
        tt += gap
    for j, (m, v) in enumerate((('D2', 0.4), ('A2', 0.3), ('F3', 0.28), ('Eb4', 0.16))):
        st['piano'].add(piano(nm(m), 3.5, v, seed=2200 + j, bright=0.7, damper=False, max_len=6.0), 4.4 + 0.06 * j, -0.1 + 0.1 * j)
    stems = {k: c.buf for k, c in st.items()}
    mixdef = {'piano': (-19.5, 0.35), 'low': (-23.0, 0.35), 'slide': (-29.0, 0.5), 'mbox': (-24.0, 0.55), 'timp': (-25.0, 0.3)}
    return dict(stems=stems, mix=mixdef, length=9.0, loop=False, reverb=dict(rt60=3.0, predelay=0.025, seed=65, dark=1.2),
                target=-16.0, fade_out=2.0)


def dawn(seed=57):
    """Dawn breaks: a distant church bell tolls three times over cold open fifths and a little wind."""
    rng = np.random.default_rng(seed)
    mk = _one_shot(8.0, 2.0)
    st = {k: mk() for k in ('bell', 'strings', 'harm', 'wind')}
    f = float(440 * 2 ** ((nm('D3') - 69) / 12))
    for k, t0 in enumerate((0.0, 2.3, 4.6)):
        st['bell'].add(lp(bell(f, 0.8 - 0.12 * k, seed=2300 + k, size=6.0), 3200, 2), t0, 0.15)
    for j, (n, v) in enumerate((('D3', 0.32), ('A3', 0.30), ('E4', 0.24), ('A4', 0.2))):
        st['strings'].add(strings(nm(n), 6.5, v, seed=2400 + j, attack=2.6, release=2.8, voices=3, detune=7, vib=3, bright=0.7), 0.4, -0.4 + 0.25 * j)
    st['harm'].add(strings(nm('E6'), 5.5, 0.12, seed=2450, attack=2.5, release=2.5, voices=2, detune=3, vib=3, bright=1.1), 1.5, 0.4)
    w = wind(12.0, seed=2460, cycles=(2, 3), level=1.0, howl=0.3)
    st['wind'].add(fade(w, 1.5, 4.0), 0.0)
    stems = {k: c.buf for k, c in st.items()}
    mixdef = {'bell': (-19.0, 0.6), 'strings': (-24.0, 0.4), 'harm': (-34.0, 0.6), 'wind': (-32.0, 0.0)}
    return dict(stems=stems, mix=mixdef, length=10.0, loop=False, reverb=dict(rt60=3.6, predelay=0.05, seed=67, dark=1.3),
                target=-16.0, fade_out=2.5)


PIECES = {'lobby': lobby, 'game': game, 'final': final, 'win': win, 'winPossessed': win_possessed, 'lose': lose, 'dawn': dawn}
