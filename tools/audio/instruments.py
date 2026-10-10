"""Synthesised instruments for the hotel's music (all made from scratch, no samples).

  piano()      an old hotel upright: additive partials with string inharmonicity, 2-3 slightly
               detuned strings per note (the slow beating of an instrument a little out of tune),
               a two-stage decay, a felt hammer thump and dampers.
  strings()    a section: a bank of detuned band-limited saws per note, slow bow attack, delayed
               vibrato, bow-pressure wander, a low-pass "body"; optional bowed tremolo.
  celesta()    two-operator FM (a warm body plus a bright, quickly fading strike).
  music_box()  comb tines: the inharmonic cantilever partials (1 : 6.27 : 17.55) and a pluck tick.
  bell()       a cast bell (hum, prime, minor-third tierce, quint, nominal...), each partial a
               slightly split doublet so it warbles as real bells do.
  pluck_bass() an upright bass pizzicato (Karplus-Strong).
  timpani(), heartbeat(), clock_tick(), wind(), crackle()  - the rest of the palette.
Every function returns a mono numpy array at dsp.SR unless it says otherwise.
"""
import numpy as np
from scipy import signal
from dsp import (SR, TAU, midi_hz, samples, lp, hp, bp, reson, white, pink, colored, smooth_noise,
                 saw_blep, env_ar, env_exp, fade, peq, shelf)


def _rng(seed):
    return np.random.default_rng(seed)


# --- piano --------------------------------------------------------------------------------------
def piano(midi, dur, vel=0.6, seed=0, bright=1.0, tune=0.0, damper=True, max_len=None):
    """One piano note: key held for `dur` s, then the damper falls (unless damper=False)."""
    rng = _rng(seed)
    f0 = float(midi_hz(midi)) * 2 ** ((tune + rng.normal(0, 1.0)) / 1200)
    B = float(np.clip(0.00028 * 2 ** ((midi - 48) / 13), 6e-5, 0.02))       # inharmonicity
    tau1 = float(np.clip(7.5 * 2 ** (-(midi - 40) / 16), 0.45, 14.0))       # sustain of the fundamental
    damp_tau = 0.07 + 0.08 * np.clip((60 - midi) / 30, 0, 1) if (damper and midi < 89) else None
    ring = dur + (6 * damp_tau if damp_tau else 3.2 * tau1)
    if max_len:
        ring = min(ring, max_len)
    n = samples(ring)
    t = np.arange(n) / SR
    out = np.zeros(n)
    x0 = 1 / 7.6 + rng.normal(0, 0.004)                                     # hammer strike point
    fc = (700 + 3400 * vel ** 1.6) * bright                                 # felt: softer = darker
    nstr = 1 if midi < 33 else 2 if midi < 46 else 3
    detunes = [0.0] if nstr == 1 else list(rng.normal(0, 0.9, nstr))       # cents between unison strings
    norm = 0.0
    for k in range(1, 60):
        fk = k * f0 * np.sqrt(1 + B * k * k)
        if fk > 12500:
            break
        a = (1 / k ** 0.85) * abs(np.sin(np.pi * k * x0)) / (1 + (fk / fc) ** 2)
        if k == 1:
            a *= 0.9 + 0.2 * np.clip((midi - 40) / 40, 0, 1)
        norm += a
        if a < 1e-4:
            continue
        tk = tau1 / (1 + ((fk - f0) / 1500) ** 1.05)
        # prompt sound then aftersound (the two polarisations of the string)
        m = min(n, samples(min(ring, tk * 9.5)))
        tt = t[:m]
        e = 0.62 * np.exp(-tt / (tk * 0.22)) + 0.38 * np.exp(-tt / tk)
        osc = np.zeros(m)
        for d in detunes:
            osc += np.sin(TAU * fk * 2 ** (d / 1200) * tt + rng.uniform(0, TAU))
        out[:m] += a * e * osc / len(detunes)
    out /= max(norm, 1e-9)
    # the felt hammer: a soft thump, a little louder in the bass
    h = samples(0.03)
    thump = bp(white(h, rng), max(60, f0 * 0.8), min(9000, f0 * 9 + 600), 1) * np.exp(-np.arange(h) / SR / 0.005)
    out[:h] += thump * 0.05 * (0.4 + vel)
    # attack ramp (no click) and the damper
    out[:samples(0.0015)] *= np.linspace(0, 1, samples(0.0015))
    if damp_tau:
        k0 = samples(dur)
        if k0 < n:
            out[k0:] *= np.exp(-(t[k0:] - dur) / damp_tau)
    out = fade(out, 0, min(0.05, ring / 4))
    return out * vel ** 1.35


# --- strings ------------------------------------------------------------------------------------
def strings(midi, dur, vel=0.5, seed=0, attack=0.6, release=0.9, voices=3, detune=7.0,
            vib=9.0, vib_rate=5.4, bright=1.0, tremolo=0.0, trem_rate=12.0, ponticello=0.0,
            swell=None):
    """A string section note -> (2, n) stereo (voices spread across the field).
    swell: optional (n,) gain curve over the held part (a crescendo/diminuendo)."""
    rng = _rng(seed)
    f0 = float(midi_hz(midi))
    total = dur + release
    n = samples(total)
    t = np.arange(n) / SR
    outL = np.zeros(n)
    outR = np.zeros(n)
    for v in range(voices):
        spread = (v - (voices - 1) / 2) / max(1, (voices - 1) / 2)
        cents = detune * spread + rng.normal(0, 1.2)
        vr = vib_rate * rng.uniform(0.9, 1.1)
        ramp = np.clip((t - 0.25 - rng.uniform(0, 0.3)) / 0.7, 0, 1)
        vibrato = vib * np.sin(TAU * vr * t + rng.uniform(0, TAU)) * ramp
        drift = 3.0 * smooth_noise(n, rng, 0.7)
        f = f0 * 2 ** ((cents + vibrato + drift) / 1200)
        x = saw_blep(f, phase0=rng.uniform())
        bow = 1 + 0.10 * smooth_noise(n, rng, 2.5)
        if tremolo > 0:
            # bowed tremolo: rapid strokes with a little jitter
            rate = trem_rate * rng.uniform(0.92, 1.08) * (1 + 0.04 * smooth_noise(n, rng, 1.5))
            ph = np.cumsum(rate / SR)
            stroke = 0.5 - 0.5 * np.cos(TAU * ph)
            bow *= (1 - tremolo) + tremolo * (0.25 + 0.75 * stroke ** 0.6)
        x *= bow
        p = 0.5 + 0.42 * spread
        outL += x * np.cos(p * np.pi / 2)
        outR += x * np.sin(p * np.pi / 2)
    # bow attack, held until `dur`, then released
    rel = np.where(t > dur, np.exp(-(t - dur) / (release / 3.2)), 1.0)
    e = np.clip(t / max(attack, 1e-3), 0, 1)
    e = np.sin(e * np.pi / 2) ** 1.6
    env = e * rel * fade(np.ones(n), 0, 0.03)
    if swell is not None:
        sw = np.ones(n)
        k = min(n, len(swell))
        sw[:k] = swell[:k]
        sw[k:] = swell[k - 1] if k else 1
        env *= sw
    fc = (900 + 2600 * vel) * bright * (1 + 1.6 * ponticello)
    out = np.vstack([outL, outR]) * env / voices
    out = lp(out, fc, 2)
    out = hp(out, 55, 2)
    if ponticello > 0:
        out = out + ponticello * 0.5 * bp(out, 2500, 6500, 1)
    # bow noise
    bn = bp(white(n, rng), 1500, 5000, 1) * env * 0.012 * vel
    out = out + np.vstack([bn, bn]) * 0.7
    return out * (0.35 + 0.65 * vel)


# --- celesta / music box / bells ----------------------------------------------------------------
def celesta(midi, vel=0.6, seed=0, length=None):
    rng = _rng(seed)
    f = float(midi_hz(midi)) * 2 ** (rng.normal(0, 1.5) / 1200)
    tau = float(np.clip(1.5 * 2 ** (-(midi - 72) / 22), 0.35, 3.0))
    L = length or tau * 4.5
    n = samples(L)
    t = np.arange(n) / SR
    i1 = 0.85 * np.exp(-t / 0.22) + 0.15
    body = np.sin(TAU * f * t + i1 * np.sin(TAU * f * t))
    strike = np.sin(TAU * f * 4.07 * t + 1.2 * np.exp(-t / 0.02) * np.sin(TAU * f * 7.0 * t)) * np.exp(-t / 0.045)
    x = body * np.exp(-t / tau) + 0.22 * strike * vel
    x += 0.12 * np.sin(TAU * 2 * f * t) * np.exp(-t / (tau * 0.35))
    x[:samples(0.001)] *= np.linspace(0, 1, samples(0.001))
    return fade(x, 0, 0.05) * vel


def music_box(midi, vel=0.6, seed=0, detune_cents=None):
    rng = _rng(seed)
    dc = rng.normal(0, 5.0) if detune_cents is None else detune_cents   # an old comb, a little out
    f = float(midi_hz(midi)) * 2 ** (dc / 1200)
    tau = float(np.clip(2.2 * 2 ** (-(midi - 72) / 18), 0.4, 4.0))
    n = samples(tau * 4.0)
    t = np.arange(n) / SR
    x = np.sin(TAU * f * t) * np.exp(-t / tau)
    x += 0.32 * np.sin(TAU * f * 6.267 * t + 0.3) * np.exp(-t / 0.18) * (f * 6.267 < 18000)
    x += 0.10 * np.sin(TAU * f * 17.55 * t) * np.exp(-t / 0.035) * (f * 17.55 < 19000)
    x += 0.10 * np.sin(TAU * 2 * f * t) * np.exp(-t / (tau * 0.4))
    # beating of the tine with its neighbour on the comb
    x *= 1 + 0.04 * np.sin(TAU * rng.uniform(0.6, 1.8) * t)
    k = samples(0.004)
    x[:k] += hp(white(k, rng), 3000, 2) * np.exp(-np.arange(k) / SR / 0.0008) * 0.35
    x[:samples(0.0008)] *= np.linspace(0, 1, samples(0.0008))
    return fade(x, 0, 0.05) * vel


BELL_PARTIALS = [  # ratio to the prime, amplitude, decay (s, scaled by size)
    (0.5, 0.55, 1.0), (1.0, 0.8, 0.7), (1.19, 0.55, 0.55), (1.5, 0.25, 0.4), (2.0, 0.85, 0.42),
    (2.52, 0.2, 0.28), (2.67, 0.18, 0.25), (3.01, 0.3, 0.2), (4.1, 0.15, 0.12), (5.4, 0.07, 0.08)]


def bell(f_prime, vel=0.7, seed=0, size=6.0, length=None, partials=BELL_PARTIALS, strike=0.3):
    rng = _rng(seed)
    L = length or size * 1.3
    n = samples(L)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for r, a, d in partials:
        f = f_prime * r
        if f > 16000:
            continue
        split = rng.uniform(0.4, 1.6) * (f / 400) ** 0.5   # Hz between the doublet's two modes
        tau = size * d
        x += a * np.exp(-t / tau) * (np.sin(TAU * f * t + rng.uniform(0, TAU)) +
                                     0.6 * np.sin(TAU * (f + split) * t + rng.uniform(0, TAU)))
    k = samples(0.03)
    x[:k] += strike * bp(white(k, rng), 800, 6000, 1) * np.exp(-np.arange(k) / SR / 0.004)
    x[:samples(0.002)] *= np.linspace(0, 1, samples(0.002))
    return fade(x / 3.0, 0, 0.2) * vel


def small_bell(f, vel=0.6, seed=0, decay=1.4, ratios=(1.0, 2.32, 4.25, 6.63), amps=(1.0, 0.45, 0.22, 0.1)):
    """A small struck brass bell (desk bell, lift bell): a few inharmonic modes."""
    rng = _rng(seed)
    n = samples(decay * 4.5)
    t = np.arange(n) / SR
    x = np.zeros(n)
    for i, (r, a) in enumerate(zip(ratios, amps)):
        tau = decay / (1 + i * 1.3)
        sp = rng.uniform(0.5, 2.0)
        x += a * np.exp(-t / tau) * (np.sin(TAU * f * r * t) + 0.5 * np.sin(TAU * (f * r + sp) * t + 1.0))
    k = samples(0.006)
    x[:k] += 0.2 * hp(white(k, rng), 2500, 2) * np.exp(-np.arange(k) / SR / 0.001)
    x[:samples(0.001)] *= np.linspace(0, 1, samples(0.001))
    return fade(x / 1.6, 0, 0.1) * vel


# --- bass, drums, pulse -------------------------------------------------------------------------
def pluck_bass(midi, dur=1.2, vel=0.6, seed=0, decay=1.1, bright=0.35):
    """Upright bass pizzicato: Karplus-Strong with a soft fingertip excitation."""
    rng = _rng(seed)
    f = float(midi_hz(midi))
    D = SR / f - 0.5
    L = int(np.floor(D))
    fr = D - L
    g = np.exp(-1.0 / (f * decay))
    n = samples(dur + 0.4)
    exc = np.zeros(n)
    k = L
    burst = lp(white(k, rng), 300 + 2500 * bright, 2)
    burst *= np.hanning(k)
    exc[:k] = burst
    a = np.zeros(L + 2)
    a[0] = 1
    a[L] -= g * (1 - fr)
    a[L + 1] -= g * fr
    y = signal.lfilter([1.0], a, exc)
    y = lp(y, 1400, 2)
    thump = np.sin(TAU * f * np.arange(samples(0.08)) / SR) * np.exp(-np.arange(samples(0.08)) / SR / 0.02)
    y[:len(thump)] += thump * 0.3 * np.max(np.abs(y))
    t = np.arange(n) / SR
    y *= np.where(t > dur, np.exp(-(t - dur) / 0.08), 1.0)
    y = fade(y, 0.001, 0.03)
    return y / (np.max(np.abs(y)) + 1e-9) * vel


def timpani(midi, vel=0.6, seed=0, length=3.0):
    rng = _rng(seed)
    f = float(midi_hz(midi))
    n = samples(length)
    t = np.arange(n) / SR
    bend = 1 + 0.025 * np.exp(-t / 0.05)
    x = np.zeros(n)
    for r, a, d in [(1.0, 1.0, 1.0), (1.5, 0.55, 0.7), (1.98, 0.35, 0.55), (2.44, 0.2, 0.4), (2.9, 0.1, 0.3)]:
        x += a * np.sin(TAU * np.cumsum(f * r * bend) / SR) * np.exp(-t / (d * length * 0.35))
    k = samples(0.04)
    x[:k] += 0.5 * lp(white(k, rng), 1800, 2) * np.exp(-np.arange(k) / SR / 0.008)
    x[:samples(0.002)] *= np.linspace(0, 1, samples(0.002))
    return fade(x / 2.0, 0, 0.1) * vel


def timpani_roll(midi, length=2.0, v0=0.1, v1=0.7, seed=0, rate=16.0):
    rng = _rng(seed)
    n = samples(length + 2.0)
    out = np.zeros(n)
    tt = 0.0
    i = 0
    while tt < length:
        v = v0 + (v1 - v0) * (tt / length) ** 1.5
        hit = timpani(midi, v * rng.uniform(0.85, 1.0), seed + i, 1.6)
        s = samples(tt)
        e = min(n, s + len(hit))
        out[s:e] += hit[:e - s]
        tt += 1 / rate * rng.uniform(0.85, 1.15)
        i += 1
    return out * 0.45


def heartbeat(vel=0.8, seed=0, gap=0.2):
    """'lub-dub': two low, soft thumps; a touch of 2nd harmonic so small speakers can hear it."""
    rng = _rng(seed)
    n = samples(0.75)
    t = np.arange(n) / SR

    def thump(f0, f1, tau, amp, t0):
        tt = np.clip(t - t0, 0, None)
        f = f1 + (f0 - f1) * np.exp(-tt / 0.03)
        ph = np.cumsum(f) / SR
        e = (tt > 0) * (1 - np.exp(-tt / 0.004)) * np.exp(-tt / tau)
        return amp * np.sin(TAU * ph) * e

    x = thump(78, 46, 0.055, 1.0, 0.0) + thump(92, 52, 0.045, 0.7, gap)
    # the body of each beat (what a small speaker can play): a soft knock round 150-200 Hz
    x += thump(170, 140, 0.028, 0.38, 0.0) + thump(195, 160, 0.024, 0.28, gap)
    x += 0.15 * lp(white(n, rng), 260, 2) * (np.exp(-t / 0.03) + 0.7 * np.exp(-np.clip(t - gap, 0, None) / 0.025) * (t > gap))
    x = np.tanh(x * 2.0) / np.tanh(2.0)
    return fade(x, 0, 0.05) * vel


def clock_tick(vel=0.5, seed=0, tock=False, muffle=2600):
    """A clock escapement: a sharp wooden click and its case ringing; `tock` is the lower one."""
    rng = _rng(seed)
    n = samples(0.18)
    t = np.arange(n) / SR
    exc = np.zeros(n)
    exc[0] = 1.0
    exc[samples(0.0012)] = -0.6
    exc[:samples(0.002)] += 0.3 * white(samples(0.002), rng)
    modes = [(1850, 22), (3150, 30), (4700, 35), (720, 9)] if not tock else [(1450, 20), (2600, 26), (3900, 30), (560, 8)]
    x = np.zeros(n)
    for f, q in modes:
        x += reson(exc, f * rng.uniform(0.97, 1.03), q)
    x = lp(x, muffle, 2)
    x *= np.exp(-t / 0.03)
    return fade(x / (np.max(np.abs(x)) + 1e-9), 0, 0.02) * vel


# --- air and surface noise ------------------------------------------------------------------------
def _fspec(n):
    f = np.fft.rfftfreq(n, 1 / SR)
    f[0] = 1e-3
    return f


def fft_band(x, fc, q):
    """Zero-phase, CIRCULAR band-pass (a resonance curve applied in the frequency domain)."""
    n = len(x)
    f = _fspec(n)
    return np.fft.irfft(np.fft.rfft(x) / np.sqrt(1 + q * q * (f / fc - fc / f) ** 2), n)


def fft_lp(x, fc, order=2):
    n = len(x)
    f = _fspec(n)
    return np.fft.irfft(np.fft.rfft(x) / np.sqrt(1 + (f / fc) ** (2 * order)), n)


def fft_hp(x, fc, order=2):
    n = len(x)
    f = _fspec(n)
    return np.fft.irfft(np.fft.rfft(x) / np.sqrt(1 + (fc / f) ** (2 * order)), n)


def fft_noise(n, rng, slope_db_oct=-3.0):
    """Circular coloured noise of exactly n samples (it loops without a seam)."""
    f = _fspec(n)
    X = np.fft.rfft(rng.standard_normal(n)) * (np.maximum(f, 20) / 1000.0) ** (slope_db_oct / 6.0206)
    x = np.fft.irfft(X, n)
    return x / (np.std(x) + 1e-12)


def wind(length, seed=0, cycles=(3, 5), level=1.0, howl=0.5, centres=(220, 360, 580, 900, 1400)):
    """Wind round the building -> stereo. Built circularly, and every slow movement makes a whole
    number of cycles over `length`, so it loops with no seam."""
    rng = _rng(seed)
    n = samples(length)
    u = np.arange(n) / n                         # 0..1 over the piece
    out = np.zeros((2, n))
    c1, c2 = cycles
    for ch in range(2):
        base = fft_noise(n, rng, -3.0)
        mix = np.zeros(n)
        for i, fc in enumerate(centres):
            g = (0.5 + 0.5 * np.sin(TAU * (c1 + i) * u + rng.uniform(0, TAU))) * \
                (0.55 + 0.45 * np.sin(TAU * (c2 + 2 * i) * u + rng.uniform(0, TAU)))
            mix += fft_band(base, fc, 2.2) * g ** 1.5 / (1 + i * 0.45)
        # thin whistling howls (narrow resonances that come and go)
        for j, fw in enumerate((520, 690, 880)):
            gw = np.clip(np.sin(TAU * (c1 + j + 1) * u + rng.uniform(0, TAU)), 0, 1) ** 3
            mix += howl * 0.9 * fft_band(base, fw * (1 + 0.01 * ch), 28.0) * gw
        out[ch] = mix + 0.8 * fft_lp(base, 110, 2)
    return out / (np.std(out) + 1e-9) * 0.1 * level


def crackle(length, seed=0, rate=7.0, level=1.0, hiss=1.0):
    """Gramophone surface: sparse clicks of uneven size, a few soft pops, and a band-limited hiss.
    Circular, so it loops with no seam."""
    rng = _rng(seed)
    n = samples(length)
    x = np.zeros(n)
    count = rng.poisson(rate * length)
    pos = rng.integers(0, n, count)
    amp = rng.lognormal(-1.2, 0.8, count)
    for p, a in zip(pos, amp):
        L = int(rng.integers(8, 60))
        click = rng.standard_normal(L) * np.exp(-np.arange(L) / (L / 4))
        x[(p + np.arange(L)) % n] += click * min(a, 3.0)
    for p in rng.integers(0, n, max(1, int(length / 9))):
        L = 600
        pop = lp(rng.standard_normal(L), 900, 1) * np.exp(-np.arange(L) / 120) * 1.2
        x[(p + np.arange(L)) % n] += pop
    x = fft_lp(fft_hp(x, 900, 2), 7000, 2)
    hs = fft_band(fft_noise(n, rng, 0.0), 3500, 0.6) * 0.05 * hiss
    return (x * 0.08 + hs) * level
