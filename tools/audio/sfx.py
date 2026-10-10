"""Hotel Escape's sound effects, synthesised from scratch (no recordings).

Each effect is a function returning a mono or stereo array; EFFECTS lists them with how they are
finished (room, loudness, mono/stereo). The materials of a 1920s-30s grand hotel at night: walnut
and oak doors and floors, brass fittings, porcelain, paper playing cards, an electro-mechanical
telephone, a small reception bell, a clock. Modal synthesis (decaying resonances) for things that
are struck, filtered noise for friction and air, a stick-slip model for creaking hinges.
"""
import zlib

import numpy as np
from dsp import (SR, TAU, Canvas, nm, samples, undb, db, lp, hp, bp, reson, white, pink, fade, pan, stereo,
                 mono, tv_bandpass, tv_lowpass, hall_ir, convolve, loudness, limiter, smooth_noise, env_exp)
from instruments import (celesta, small_bell, bell, strings, piano, clock_tick, wind, music_box, fft_lp)

R = np.random.default_rng


# --- pieces -------------------------------------------------------------------------------------
def add(*xs):
    """Sum mono signals of different lengths (each starting at 0)."""
    n = max(len(x) for x in xs)
    out = np.zeros(n)
    for x in xs:
        out[:len(x)] += x
    return out


def modes(spec, length, rng, phase=True):
    """Struck resonances: spec = [(freq, decay_s, amp), ...]."""
    n = samples(length)
    t = np.arange(n) / SR
    y = np.zeros(n)
    for f, tau, a in spec:
        if f >= SR * 0.47:
            continue
        y += a * np.sin(TAU * f * t + (rng.uniform(0, TAU) if phase else 0)) * np.exp(-t / tau)
    y[:samples(0.0007)] *= np.linspace(0, 1, samples(0.0007))
    return y


def burst(length, lo, hi, rng, attack=0.001, tau=0.01, order=2):
    n = samples(length)
    t = np.arange(n) / SR
    e = np.clip(t / max(attack, 1e-4), 0, 1) * np.exp(-np.clip(t - attack, 0, None) / tau)
    return bp(white(n, rng), lo, hi, order) * e


def grain(length, lo, hi, rng, shape='hann'):
    n = max(8, samples(length))
    w = np.hanning(n) if shape == 'hann' else np.exp(-np.arange(n) / (n / 5))
    return bp(white(n, rng), lo, hi, 2) * w


def thump(f0, f1, tau, length, rng=None, drop=0.03):
    n = samples(length)
    t = np.arange(n) / SR
    f = f1 + (f0 - f1) * np.exp(-t / drop)
    y = np.sin(TAU * np.cumsum(f) / SR) * np.exp(-t / tau) * (1 - np.exp(-t / 0.002))
    return y


def wood_knock(rng, f=1.0, heavy=0.5, length=0.25):
    spec = [(190 * f, 0.05 + 0.03 * heavy, 0.9), (410 * f, 0.03, 0.6), (780 * f, 0.02, 0.4), (1430 * f, 0.012, 0.25), (2450 * f, 0.008, 0.12)]
    y = modes(spec, length, rng)
    y += 0.5 * burst(length, 300, 4000, rng, tau=0.004)
    y += heavy * thump(110 * f, 70 * f, 0.05, length)
    return y


def metal_clack(rng, f=1.0, length=0.3, ring=1.0):
    spec = [(820 * f, 0.03 * ring, 0.5), (1730 * f, 0.05 * ring, 0.7), (2890 * f, 0.04 * ring, 0.5),
            (4210 * f, 0.03 * ring, 0.35), (6120 * f, 0.02 * ring, 0.2)]
    y = modes(spec, length, rng)
    y += 0.6 * burst(length, 1500, 9000, rng, tau=0.003)
    return y


def creak(length, rng, rate=(35, 120, 60), body=(380, 820, 1450, 2350), q=14, rough=0.25, jitter=0.03, jerks=3.0):
    """A hinge creaking: stick-slip pulses - a buzzing pitch that glides through `rate` (Hz, any number
    of points), a little irregular - ringing the door's wooden body; pushed in uneven jerks."""
    n = samples(length)
    t = np.arange(n) / SR
    u = t / length
    pts = np.linspace(0, 1, len(rate))
    rr = np.interp(u, pts, rate) * (1 + 0.12 * smooth_noise(n, rng, 5.0))
    # one pulse per stick-slip cycle, each period a little uneven
    imp = np.zeros(n)
    pos = 0.0
    while True:
        k = int(pos * SR)
        if k >= n:
            break
        imp[k] = rng.uniform(0.55, 1.0)
        pos += (1.0 / rr[k]) * (1 + jitter * rng.standard_normal())
    exc = imp + rough * 0.05 * white(n, rng)
    y = np.zeros(n)
    for i, f in enumerate(body):
        y += reson(exc, f * rng.uniform(0.97, 1.03), q) / (1 + i * 0.3)
    y += 0.25 * hp(exc, 1500, 1)
    env = np.sin(np.clip(u, 0, 1) * np.pi) ** 0.5
    env *= np.clip(0.55 + 0.6 * smooth_noise(n, rng, jerks), 0.05, 1.0)
    return y * env


def swish(length, lo0, hi0, lo1, hi1, rng, peak=0.5):
    """Air past something: band-limited noise whose band slides from (lo0, hi0) to (lo1, hi1)."""
    n = samples(length)
    u = np.arange(n) / n
    fc = np.exp(np.interp(u, [0, 1], [np.log((lo0 * hi0) ** 0.5), np.log((lo1 * hi1) ** 0.5)]))
    x = tv_bandpass(white(n, rng), fc, 1.6)
    env = np.where(u < peak, (u / peak) ** 1.5, ((1 - u) / (1 - peak)) ** 2)
    return x * env


def whisper(length, rng, rate=6.0, breath=0.4, voiced=0.0):
    """Unvoiced speech-like murmur: noise through moving vowel formants, in syllables, with 's'."""
    n = samples(length)
    t = np.arange(n) / SR
    vowels = [(700, 1220, 2600), (390, 2300, 3000), (450, 900, 2500), (300, 870, 2240), (520, 1700, 2500), (640, 1190, 2390)]
    seg = []
    tt = 0.0
    while tt < length:
        d = rng.uniform(0.07, 0.22) * 6.0 / rate
        seg.append((tt, d, vowels[rng.integers(len(vowels))], rng.random() < 0.22))
        tt += d
    times = [s[0] for s in seg] + [length]
    F = [np.interp(t, times, [s[2][k] for s in seg] + [seg[-1][2][k]]) for k in range(3)]
    src = white(n, rng)
    y = tv_bandpass(src, F[0], 6) + 0.7 * tv_bandpass(src, F[1], 9) + 0.35 * tv_bandpass(src, F[2], 12)
    amp = np.zeros(n)
    fric = np.zeros(n)
    for s0, d, _, sib in seg:
        a = samples(s0)
        b = min(n, samples(s0 + d))
        if b <= a:
            continue
        w = np.hanning(b - a) ** 0.7 * rng.uniform(0.4, 1.0)
        if sib:
            fric[a:b] += w
        else:
            amp[a:b] += w
    sss = hp(white(n, rng), 4200, 2) * fric * 0.5
    y = y * amp + sss
    y += breath * 0.3 * bp(white(n, rng), 300, 1500, 1) * amp
    return y


def reverse_swell(sig, ir_rt=2.5, seed=1):
    """A reversed reverb: the sound's echo arrives before it (a classic dark swell)."""
    ir = hall_ir(ir_rt, seed=seed, early=False)
    wet = convolve(stereo(sig), ir)
    return wet[:, ::-1]


def room(x, rt60=0.5, wet=0.18, seed=7, predelay=0.006, dark=1.0):
    ir = hall_ir(rt60, predelay=predelay, seed=seed, dark=dark)
    y = stereo(x)
    w = convolve(y, ir)
    out = np.zeros_like(w)
    out[:, :y.shape[1]] += y
    out += w * wet
    return out


def mix(length, *items):
    """items: (signal, time, pan, gain). The canvas grows to hold every item whole (never cut)."""
    need = max([it[1] + np.shape(it[0])[-1] / SR for it in items] + [length])
    c = Canvas(need, loop=False)
    for it in items:
        sig, t = it[0], it[1]
        p = it[2] if len(it) > 2 else 0.0
        g = it[3] if len(it) > 3 else 1.0
        c.add(fade(sig, 0, 0.012), t, p, g)      # (an item never ends with a step)
    return c.buf


# --- interface ----------------------------------------------------------------------------------
def fx_click():
    rng = R(101)
    y = modes([(1650, 0.010, 0.6), (2950, 0.006, 0.45), (520, 0.016, 0.5), (3900, 0.004, 0.2)], 0.09, rng)
    y += 0.35 * burst(0.09, 1500, 6000, rng, tau=0.0015)
    y += 0.25 * modes([(3320, 0.03, 1.0), (7650, 0.012, 0.3)], 0.09, rng)   # the brass in it
    return y


def fx_open():
    rng = R(102)
    s = swish(0.20, 700, 1600, 2400, 5200, rng, peak=0.7) * 0.5
    a = celesta(nm('A5'), 0.35, seed=1021, length=0.7)
    b = celesta(nm('D6'), 0.35, seed=1022, length=0.8)
    return mono(mix(0.9, (s, 0.0), (a, 0.06, 0, 0.6), (b, 0.13, 0, 0.6)))


def fx_close():
    rng = R(103)
    s = swish(0.18, 2400, 5200, 700, 1600, rng, peak=0.3) * 0.5
    a = celesta(nm('D6'), 0.3, seed=1031, length=0.6)
    b = celesta(nm('A5'), 0.3, seed=1032, length=0.7)
    return mono(mix(0.8, (s, 0.0), (a, 0.02, 0, 0.55), (b, 0.09, 0, 0.55)))


def fx_select():
    rng = R(104)
    tick = add(modes([(2100, 0.008, 0.5), (3700, 0.005, 0.3)], 0.05, rng), 0.2 * burst(0.05, 2000, 7000, rng, tau=0.001))
    c = celesta(nm('E6'), 0.32, seed=1041, length=0.6)
    return mono(mix(0.6, (tick, 0.0, 0, 0.7), (c, 0.004, 0, 0.6)))


def fx_deny():
    rng = R(105)
    k1 = wood_knock(rng, 0.85, 0.35, 0.18)
    k2 = wood_knock(rng, 0.76, 0.35, 0.2)
    return mono(mix(0.35, (lp(k1, 2500), 0.0), (lp(k2, 2300), 0.11, 0, 0.8)))


# --- menu / lift --------------------------------------------------------------------------------
def fx_joined():
    # the little brass bell on the reception desk
    return small_bell(1318.5, 0.55, seed=106, decay=0.9, ratios=(1.0, 2.71, 5.15, 8.4), amps=(1.0, 0.35, 0.16, 0.06))


def fx_liftDing():
    rng = R(107)
    b = small_bell(830.6, 0.8, seed=107, decay=2.2, ratios=(1.0, 2.0, 2.76, 5.4), amps=(1.0, 0.25, 0.3, 0.08))
    lowb = small_bell(415.3, 0.35, seed=1071, decay=2.6, ratios=(1.0, 2.0, 3.0), amps=(1.0, 0.2, 0.1))
    return mix(5.0, (b, 0.0), (lowb, 0.0, 0, 0.5))[0] * 1.0


def fx_liftDoors():
    rng = R(108)
    L = 1.5
    n = samples(L)
    t = np.arange(n) / SR
    roll = lp(white(n, rng), 260, 2) * (1 + 0.6 * np.sin(TAU * 23 * t + 3 * smooth_noise(n, rng, 3)))
    env = np.clip(t / 0.15, 0, 1) * np.clip((1.15 - t) / 0.2, 0, 1)
    roll *= env
    rattle = np.zeros(n)
    for k in range(int(L * 30)):
        tt = rng.uniform(0.05, 1.05)
        g = metal_clack(rng, rng.uniform(1.4, 2.2), 0.05, 0.3) * 0.08
        s = samples(tt)
        rattle[s:s + len(g)] += g[:n - s]
    squeal = tv_bandpass(white(n, rng), 2100 + 250 * smooth_noise(n, rng, 2), 40) * env * 0.8
    clunk = add(metal_clack(rng, 0.55, 0.5, 1.6) * 0.6, wood_knock(rng, 0.6, 1.0, 0.5) * 0.7)
    out = roll * 0.9 + rattle + squeal * 0.25
    s = samples(1.12)
    out[s:s + len(clunk)] += clunk[:n - s]
    return out


def fx_fadeIn():
    rng = R(109)
    sw = reverse_swell(stereo(piano(nm('D2'), 0.4, 0.5, seed=1091, damper=True)), 2.2, seed=1092)
    sw = sw[:, -samples(1.8):]
    strs = sum(strings(nm(n), 1.2, 0.25, seed=1093 + i, attack=1.0, release=0.9, voices=2, bright=0.6) for i, n in enumerate(('D3', 'A3', 'D4')))
    air = stereo(swish(1.8, 200, 600, 800, 2400, rng, peak=0.8)) * 0.15
    return mix(2.6, (sw * 0.6, 0.0), (strs, 0.5), (air, 0.0))


# --- turn ---------------------------------------------------------------------------------------
def fx_yourTurn():
    # a small mantel-clock chime, D5 then A5, with a celesta inside it
    ratios = (1.0, 2.0, 3.01, 4.2)
    amps = (1.0, 0.35, 0.12, 0.06)
    a = small_bell(587.3, 0.6, seed=110, decay=1.4, ratios=ratios, amps=amps)
    b = small_bell(880.0, 0.65, seed=1101, decay=1.6, ratios=ratios, amps=amps)
    ca = celesta(nm('D6'), 0.3, seed=1102)
    cb = celesta(nm('A6'), 0.3, seed=1103)
    return mix(3.0, (a, 0.0, -0.15), (ca, 0.0, -0.15, 0.4), (b, 0.24, 0.15), (cb, 0.24, 0.15, 0.4))


def fx_tick():
    return clock_tick(0.9, seed=111, tock=False, muffle=7000)


def fx_timeUp():
    rng = R(112)
    clunk = metal_clack(rng, 0.7, 0.2, 0.5) * 0.35
    dong = small_bell(392.0, 0.9, seed=1121, decay=2.0, ratios=(1.0, 2.0, 2.98, 4.1, 5.4), amps=(1.0, 0.5, 0.25, 0.12, 0.05))
    hum = small_bell(196.0, 0.4, seed=1122, decay=2.5, ratios=(1.0, 2.0), amps=(1.0, 0.2))
    return mix(4.0, (clunk, 0.0), (dong, 0.03), (hum, 0.03, 0, 0.6))[0]


# --- doors --------------------------------------------------------------------------------------
def fx_doorOpen():
    """A heavy old door: the latch, a long groaning creak of the hinges (rising, then easing off), a
    short squeak near the end, the air of the room beyond, and the door settling against its stop."""
    rng = R(113)
    latch = metal_clack(rng, 0.9, 0.2, 0.6) * 0.5
    latch2 = metal_clack(rng, 1.1, 0.15, 0.4) * 0.3
    groan = creak(1.25, rng, rate=(95, 150, 240, 300, 210, 140), body=(420, 960, 1650, 2700), q=9, jitter=0.025, jerks=2.5) * 1.4
    squeak = creak(0.32, rng, rate=(520, 690, 610), body=(1400, 2300, 3400), q=12, jitter=0.015, jerks=1.0) * 0.45
    air = swish(1.0, 120, 300, 200, 600, rng, peak=0.5) * 0.12
    thud = wood_knock(rng, 0.55, 1.0, 0.5) * 0.25
    return mix(2.2, (latch, 0.0), (latch2, 0.07), (groan, 0.12), (squeak, 0.85), (air, 0.3), (thud, 1.42))[0]


def fx_doorJammed():
    rng = R(114)
    items = []
    tt = 0.0
    for i in range(3):
        items.append((metal_clack(rng, rng.uniform(0.85, 1.05), 0.12, 0.5) * 0.45, tt))
        items.append((metal_clack(rng, rng.uniform(1.0, 1.2), 0.1, 0.4) * 0.3, tt + 0.045))
        tt += rng.uniform(0.11, 0.15)
    items.append((wood_knock(rng, 0.62, 1.0, 0.45) * 0.9, 0.48))
    items.append((wood_knock(rng, 0.6, 0.8, 0.45) * 0.6, 0.72))
    items.append((creak(0.25, rng, rate=(120, 170, 130), q=10) * 0.25, 0.5))
    return mix(1.3, *items)[0]


def fx_doorLocked():
    rng = R(115)
    a = add(metal_clack(rng, 0.95, 0.14, 0.5) * 0.5, wood_knock(rng, 0.9, 0.3, 0.14) * 0.3)
    b = add(metal_clack(rng, 1.05, 0.14, 0.5) * 0.45, wood_knock(rng, 0.9, 0.3, 0.14) * 0.25)
    return mix(0.5, (a, 0.0), (b, 0.13))[0]


def fx_unlock():
    rng = R(116)
    scrape = burst(0.22, 2000, 7000, rng, attack=0.08, tau=0.08) * 0.35
    scrape *= 1 + 0.6 * np.sin(TAU * 38 * np.arange(len(scrape)) / SR)
    c1 = metal_clack(rng, 1.5, 0.1, 0.3) * 0.4
    c2 = metal_clack(rng, 1.4, 0.1, 0.3) * 0.45
    bolt = add(metal_clack(rng, 0.65, 0.35, 1.2) * 0.7, wood_knock(rng, 0.8, 0.5, 0.3) * 0.35)
    return mix(1.1, (scrape, 0.0), (c1, 0.26), (c2, 0.38), (bolt, 0.52))[0]


def fx_lockFail():
    rng = R(117)
    items = []
    for i in range(5):
        items.append((burst(0.05, 3000, 9000, rng, attack=0.01, tau=0.015) * 0.3, 0.02 + i * 0.07 + rng.uniform(0, 0.02)))
    snap = add(modes([(4200, 0.12, 0.6), (6900, 0.05, 0.35), (2600, 0.04, 0.3)], 0.5, rng), 0.8 * burst(0.03, 2500, 10000, rng, tau=0.002))
    items.append((snap * 0.8, 0.42))
    for j, (f, tt) in enumerate(((5600, 0.62), (4800, 0.74), (6200, 0.8))):
        items.append((modes([(f, 0.05, 1.0), (f * 2.3, 0.02, 0.3)], 0.2, rng) * 0.18, tt))
    return mix(1.1, *items)[0]


def fx_barricade():
    rng = R(118)
    n = samples(0.5)
    drag = bp(white(n, rng), 300, 2500, 1) * (1 + 0.5 * smooth_noise(n, rng, 30)) * np.hanning(n) * 0.3
    drop = wood_knock(rng, 0.7, 1.0, 0.4) * 0.8
    items = [(drag, 0.0), (drop, 0.45)]
    for k, tt in enumerate((0.78, 1.08, 1.36)):
        blow = add(wood_knock(rng, 0.9 + 0.05 * k, 0.6, 0.35) * 0.9,
                   modes([(2780 + 120 * k, 0.09, 0.4), (5210, 0.04, 0.2)], 0.35, rng) * 0.5,      # the nail rings
                   0.5 * burst(0.03, 1000, 8000, rng, tau=0.003))
        items.append((blow, tt))
    return mix(2.0, *items)[0]


# --- finding ------------------------------------------------------------------------------------
def fx_search():
    rng = R(119)
    items = []
    for i in range(16):
        tt = rng.uniform(0.0, 1.1)
        d = rng.uniform(0.03, 0.12)
        lo = rng.uniform(800, 2500)
        items.append((grain(d, lo, lo * rng.uniform(2.0, 4.0), rng) * rng.uniform(0.15, 0.4), tt, rng.uniform(-0.4, 0.4)))
    n = samples(0.28)
    slide = bp(white(n, rng), 200, 1800, 1) * (1 + 0.8 * smooth_noise(n, rng, 50)) * np.hanning(n) * 0.25
    items.append((slide, 0.35, 0.1))
    items.append((wood_knock(rng, 1.2, 0.3, 0.2) * 0.35, 0.66, -0.2))
    items.append((wood_knock(rng, 1.35, 0.2, 0.2) * 0.25, 0.98, 0.2))
    return mono(mix(1.45, *items))


def _paper(rng, length=0.09, lo=1800, hi=8000):
    return grain(length, lo, hi, rng, 'exp')


def fx_cardFound():
    rng = R(120)
    flick = add(_paper(rng, 0.08) * 0.6, _paper(rng, 0.04, 3000, 10000) * 0.4)
    items = [(flick, 0.0)]
    for j, n in enumerate(('D6', 'F6', 'A6')):
        items.append((celesta(nm(n), 0.32, seed=1201 + j, length=0.9), 0.05 + j * 0.065, -0.2 + 0.2 * j, 0.55))
    return mono(mix(1.2, *items))


def fx_cardFlip():
    rng = R(121)
    a = swish(0.07, 1500, 4000, 3000, 9000, rng, peak=0.6) * 0.5
    b = _paper(rng, 0.03, 2500, 9000) * 0.7
    return mono(mix(0.15, (a, 0.0), (b, 0.055)))


# --- cards --------------------------------------------------------------------------------------
def fx_bandage():
    rng = R(122)
    n = samples(0.42)
    t = np.arange(n) / SR
    rate = 90 + 120 * t / 0.42
    ph = np.cumsum(rate / SR)
    imp = (np.diff(np.floor(ph), prepend=0) > 0).astype(float) * rng.uniform(0.3, 1.0, n)
    rip = bp(imp + 0.2 * white(n, rng), 1200, 7000, 2) * np.sin(np.pi * t / 0.42) ** 0.5
    n2 = samples(0.4)
    wrap = bp(white(n2, rng), 600, 3500, 1) * np.hanning(n2) * (1 + 0.5 * smooth_noise(n2, rng, 20)) * 0.25
    return mono(mix(0.95, (rip * 0.6, 0.0), (wrap, 0.45)))


def fx_espresso():
    rng = R(123)
    cup = [(2380, 0.25, 1.0), (3920, 0.16, 0.6), (5650, 0.10, 0.4), (7230, 0.07, 0.25), (1210, 0.12, 0.2)]
    a = add(modes(cup, 0.9, rng), 0.4 * burst(0.01, 2000, 9000, rng, tau=0.001))
    b = modes([(f * 1.004, d * 0.6, a_ * 0.5) for f, d, a_ in cup], 0.6, rng)
    saucer = modes([(1730, 0.18, 0.6), (3140, 0.12, 0.4), (4890, 0.08, 0.2)], 0.7, rng) * 0.6
    return room(mix(1.2, (a * 0.5, 0.0), (saucer * 0.5, 0.004), (b * 0.35, 0.075))[0], 0.4, 0.12)[0]


def fx_mirror():
    rng = R(124)
    L = 1.8
    n = samples(L)
    t = np.arange(n) / SR
    out = np.zeros((2, n))
    for i, f in enumerate((2637, 3136, 3951, 4699, 5274, 6272)):
        for ch in range(2):
            f2 = f * (1 + 0.0025 * (ch - 0.5)) * (1 + 0.002 * np.sin(TAU * (3 + i) * t))
            e = np.clip(t / (0.05 + 0.04 * i), 0, 1) * np.exp(-t / (0.8 - 0.06 * i))
            out[ch] += np.sin(TAU * np.cumsum(f2) / SR + i) * e * 0.12
    sparkle = mix(L, *[(celesta(nm(nn), 0.28, seed=1241 + j, length=1.2), 0.03 + 0.07 * j, -0.4 + 0.27 * j, 0.5)
                       for j, nn in enumerate(('E6', 'G#6', 'B6', 'E7'))])
    air = swish(L, 3000, 8000, 5000, 12000, rng, peak=0.25) * 0.05
    out = out + sparkle[:, :n] + stereo(air)
    return room(out, 1.2, 0.3)


def fx_tradeSwap():
    rng = R(125)
    L = 0.75
    a = swish(0.32, 900, 2500, 2500, 7000, rng, peak=0.55) * 0.6
    b = swish(0.32, 900, 2500, 2500, 7000, R(1251), peak=0.55) * 0.6
    n = len(a)
    pa = np.linspace(-0.7, 0.7, n)
    pb = -pa
    sa = np.vstack([a * np.cos((pa + 1) * np.pi / 4), a * np.sin((pa + 1) * np.pi / 4)])
    sb = np.vstack([b * np.cos((pb + 1) * np.pi / 4), b * np.sin((pb + 1) * np.pi / 4)])
    tapA = add(_paper(rng, 0.03, 1500, 7000) * 0.6, wood_knock(rng, 2.0, 0.1, 0.06) * 0.15)
    tapB = add(_paper(rng, 0.03, 1500, 7000) * 0.55, wood_knock(rng, 2.1, 0.1, 0.06) * 0.15)
    return mix(L, (sa, 0.0), (sb, 0.04), (tapA, 0.33, 0.6), (tapB, 0.37, -0.6))


def fx_lanternBlock():
    """A Possession card burns in a Lantern's light: the flare catches (a bright 'fssh' and a soft
    'whoomp'), then the card crackles, curls and hisses away to nothing; a thin ring of the light."""
    rng = R(126)
    L = 2.6
    n = samples(L)
    t = np.arange(n) / SR
    # the flare: a quick rising hiss
    fn_ = samples(0.22)
    u = np.arange(fn_) / fn_
    flare = tv_bandpass(white(fn_, rng), np.geomspace(900, 5200, fn_), 1.4) * (np.sin(np.pi * u) ** 0.6) * (1 - u) ** 0.5
    # the flame catching: a soft low swell and a thump
    wn = samples(0.6)
    tw = np.arange(wn) / SR
    whoomp = lp(white(wn, rng), 650, 2) * (tw / 0.12) * np.exp(-tw / 0.12) * 0.9 + thump(130, 60, 0.09, 0.6) * 0.45
    # burning: roar and hiss die away; crackles thin out
    burn_env = np.clip(t / 0.12, 0, 1) * np.exp(-np.clip(t - 0.12, 0, None) / 0.5)
    roar = hp(lp(pink(n, rng), 600, 2), 50, 2) * burn_env * 0.35      # (pink noise: no sub-bass drift)
    hiss = bp(white(n, rng), 2600, 8500, 2) * np.clip(t / 0.08, 0, 1) * np.exp(-np.clip(t - 0.1, 0, None) / 0.42) * 0.3
    cr = np.zeros(n)
    tt = 0.08
    while tt < L - 0.2:
        g = grain(rng.uniform(0.002, 0.010), 1400, 9500, rng, 'exp') * rng.uniform(0.3, 1.0) * np.exp(-tt / 0.65)
        s_ = samples(tt)
        cr[s_:s_ + len(g)] += g[:n - s_]
        tt += rng.exponential(0.018 + 0.09 * tt)        # dense at first, then the odd last pop
    curl = bp(white(n, rng), 1200, 3000, 1) * (1 + 0.8 * smooth_noise(n, rng, 25)) * np.exp(-t / 0.35) * 0.08
    light = mono(mix(L, *[(celesta(nm(x), 0.25, seed=1261 + j, length=1.5), 0.05 + 0.06 * j, 0, 0.32) for j, x in enumerate(('A6', 'E7'))]))
    out = mix(L, (flare, 0.0, -0.15, 0.9), (whoomp, 0.03, 0, 1.0), (roar, 0.0, 0.1, 1.0), (hiss, 0.0, 0.25, 1.0),
              (cr, 0.0, -0.25, 1.4), (curl, 0.1, 0.2, 1.0), (light, 0.0, 0.2, 0.7))
    return room(fade(out, 0, 0.5), 0.9, 0.2)


def fx_possessed():
    """You are possessed: a whispering swell rising out of the dark, a low drone under it."""
    rng = R(127)
    L = 3.2
    n = samples(L)
    t = np.arange(n) / SR
    hit = stereo(piano(nm('D1'), 0.6, 0.8, seed=1271, damper=False, max_len=1.0)) + stereo(piano(nm('Eb2'), 0.6, 0.5, seed=1272, damper=False, max_len=1.0))
    sw = reverse_swell(hit, 2.6, seed=1273)
    sw = sw[:, -samples(1.9):]
    w1 = whisper(2.4, rng, rate=6.5)
    w2 = whisper(2.4, R(1274), rate=5.5)
    wenv = np.clip(np.arange(len(w1)) / SR / 1.0, 0, 1) ** 1.5 * np.exp(-np.clip(np.arange(len(w1)) / SR - 1.6, 0, None) / 0.4)
    sub = np.sin(TAU * 36.7 * t) * np.sin(np.pi * np.clip(t / 2.8, 0, 1)) ** 1.2 * 0.35
    sub += np.sin(TAU * 73.4 * t + 1) * np.sin(np.pi * np.clip(t / 2.8, 0, 1)) ** 1.5 * 0.2
    clus = sum(strings(nm(x), 1.6, 0.3, seed=1275 + i, attack=1.3, release=1.0, voices=3, detune=12, tremolo=0.5, trem_rate=9.0,
                       ponticello=0.4, bright=0.8) for i, x in enumerate(('D3', 'Eb3', 'A3')))
    wenv = fade(wenv, 0, 0.35)
    out = mix(L, (sw * 0.9, 0.0), (w1 * wenv * 0.5, 0.2, -0.6), (w2 * wenv * 0.45, 0.35, 0.6), (fade(sub, 0, 0.3), 0.0), (clus * 0.7, 0.3))
    return room(out, 1.6, 0.35, seed=1276)


def fx_possessOther():
    """Your card possessed them: a low, satisfied breath and a dark string stab."""
    rng = R(128)
    L = 2.2
    br = whisper(0.9, rng, rate=3.0, breath=1.0)
    br *= np.sin(np.pi * np.clip(np.arange(len(br)) / len(br), 0, 1)) ** 0.8
    stab = sum(strings(nm(x), 0.5, 0.45, seed=1281 + i, attack=0.06, release=1.0, voices=3, detune=10, bright=0.7) for i, x in enumerate(('D2', 'A2', 'Eb3')))
    low = stereo(piano(nm('D1'), 1.2, 0.7, seed=1284, damper=False, max_len=2.0))
    mb = music_box(nm('D6'), 0.4, seed=1285, detune_cents=-35)
    out = mix(L, (br * 0.5, 0.0, 0.0), (stab * 0.8, 0.25), (low * 0.6, 0.25), (mb, 0.45, 0.3, 0.35))
    return room(out, 1.4, 0.3, seed=1286)


def fx_noTrade():
    rng = R(129)
    a = add(_paper(rng, 0.04, 1200, 6000) * 0.5, wood_knock(rng, 1.6, 0.15, 0.12) * 0.4)
    b = add(_paper(rng, 0.04, 1000, 5000) * 0.45, wood_knock(rng, 1.45, 0.15, 0.12) * 0.35)
    c1 = celesta(nm('A5'), 0.22, seed=1291, length=0.7)
    c2 = celesta(nm('F#5'), 0.22, seed=1292, length=0.8)
    return mono(mix(1.0, (a, 0.0), (b, 0.12), (c1, 0.16, 0, 0.5), (c2, 0.28, 0, 0.5)))


# --- combat -------------------------------------------------------------------------------------
def fx_knife():
    rng = R(130)
    sw = swish(0.16, 1200, 3500, 4000, 11000, rng, peak=0.7) * 0.8
    stab = thump(160, 70, 0.05, 0.25) * 0.8 + bp(white(samples(0.25), rng), 200, 1500, 1) * env_exp(samples(0.25), 0.025) * 0.5
    glint = modes([(5100, 0.08, 1.0), (7900, 0.04, 0.4)], 0.3, rng) * 0.12
    return mono(mix(0.7, (glint, 0.0), (sw, 0.02), (stab, 0.16)))


def fx_revolver():
    rng = R(131)
    cock = metal_clack(rng, 1.3, 0.08, 0.3) * 0.35
    cock2 = metal_clack(rng, 1.6, 0.06, 0.3) * 0.3
    n = samples(0.6)
    t = np.arange(n) / SR
    crack = white(n, rng) * np.exp(-t / 0.006)
    crack = lp(crack, 9000, 2) * 0.9
    boom = thump(150, 48, 0.12, 0.6, drop=0.02) * 0.6
    body = bp(white(n, rng), 400, 2500, 1) * np.exp(-t / 0.03) * 0.6
    # the crack a tablet's small speakers can carry (1.5-5 kHz, ~5 ms) and the corridor's first
    # reflections (800-1500 Hz): without them the shot is nearly all boom and comes out softer than
    # the knife on an iPad
    snap = bp(white(n, rng), 1500, 5000, 2) * np.exp(-t / 0.005) * 3.5
    refl = np.zeros(n)
    for d, g in ((0.009, 1.0), (0.016, 0.7), (0.027, 0.45)):
        k = samples(d)
        refl[k:] += bp(white(n - k, rng), 800, 1500, 2) * np.exp(-np.arange(n - k) / SR / 0.02) * g * 2.0
    shot = crack + boom + body + snap + refl
    shot = np.tanh(shot * 1.5) / 1.2
    out = mix(1.6, (cock, 0.0), (cock2, 0.05), (shot, 0.22))
    return room(out, 1.5, 0.45, seed=1311, predelay=0.012)


def fx_hurt():
    rng = R(132)
    hit = thump(130, 60, 0.07, 0.4) * 0.8 + bp(white(samples(0.4), rng), 150, 1200, 1) * env_exp(samples(0.4), 0.03) * 0.5
    gasp = whisper(0.32, rng, rate=12, breath=1.2) * np.hanning(samples(0.32)) ** 0.5 * 0.35
    sting = sum(strings(nm(x), 0.25, 0.4, seed=1321 + i, attack=0.03, release=0.5, voices=3, detune=14, bright=0.8) for i, x in enumerate(('E4', 'F4')))
    return mix(1.0, (hit, 0.0), (gasp, 0.05, 0.1), (sting * 0.5, 0.02))


def fx_death():
    rng = R(133)
    fall = add(thump(90, 40, 0.15, 0.8) * 0.6 + lp(white(samples(0.8), rng), 600, 2) * env_exp(samples(0.8), 0.06) * 0.6,
               wood_knock(rng, 0.5, 1.0, 0.6) * 0.6)
    bounce = wood_knock(rng, 0.55, 0.6, 0.4) * 0.35
    low = stereo(piano(nm('D1'), 2.5, 0.5, seed=1331, damper=False, max_len=3.5)) + stereo(piano(nm('D2'), 2.5, 0.55, seed=1332, damper=False, max_len=3.5))
    clus = sum(strings(nm(x), 1.6, 0.35, seed=1333 + i, attack=0.5, release=1.2, voices=3, detune=10, bright=0.6) for i, x in enumerate(('D2', 'Eb2', 'A2')))
    up = sum(strings(nm(x), 1.6, 0.3, seed=1343 + i, attack=0.6, release=1.2, voices=3, detune=10, bright=0.5) for i, x in enumerate(('D3', 'Eb3')))
    # the body meeting the floorboards in the middle of the range (what a tablet's speakers carry):
    # the knees, then the body, a slump of cloth on wood; the low strike and the dark cluster an
    # octave up as well
    r2 = R(1337)
    knees = wood_knock(r2, 1.05, 0.2, 0.3) * 0.65
    hit = wood_knock(r2, 0.9, 0.3, 0.4) * 0.85
    n = samples(0.45)
    tt = np.arange(n) / SR
    slump = bp(white(n, r2), 250, 1200, 2) * np.clip(tt / 0.015, 0, 1) * np.exp(-tt / 0.12) * 1.2
    mid = stereo(piano(nm('D3'), 2.0, 0.5, seed=1338, damper=False, max_len=3.0)) * 0.8
    out = mix(3.4, (knees, 0.0), (fall, 0.06), (hit, 0.06), (slump, 0.07), (bounce, 0.27), (low * 0.6, 0.08), (mid, 0.08),
              (clus * 0.8, 0.11), (up * 0.6, 0.11))
    return room(out, 1.6, 0.3, seed=1336)


# --- rooms --------------------------------------------------------------------------------------
def fx_infirmary():
    rng = R(134)
    glass = [(1830, 0.2, 1.0), (3110, 0.14, 0.6), (4920, 0.09, 0.4), (6840, 0.05, 0.2)]
    a = add(modes(glass, 0.6, rng) * 0.4, 0.2 * burst(0.01, 2000, 9000, rng, tau=0.001))
    b = modes([(f * 1.12, d, x) for f, d, x in glass], 0.5, rng) * 0.3
    items = [(a, 0.0), (b, 0.12)]
    for j, nn in enumerate(('F#5', 'A5', 'D6')):
        items.append((celesta(nm(nn), 0.3, seed=1341 + j, length=1.4), 0.3 + 0.09 * j, -0.2 + 0.2 * j, 0.6))
    return room(mix(1.9, *items), 0.5, 0.15)


def fx_switchboard():
    """An old electro-mechanical telephone bell: a striker between two bells, about 20 strokes a
    second, ring... ring."""
    rng = R(135)
    L = 2.3
    bellA = [(1180, 0.18, 1.0), (3020, 0.1, 0.5), (5150, 0.06, 0.3)]
    bellB = [(1395, 0.18, 1.0), (3540, 0.1, 0.5), (6010, 0.06, 0.25)]
    out = np.zeros(samples(L) + samples(0.5))
    plug = metal_clack(rng, 0.9, 0.12, 0.4) * 0.4
    out[:len(plug)] += plug
    for start, dur in ((0.12, 0.85), (1.25, 0.8)):
        k = 0
        tt = start
        while tt < start + dur:
            spec = bellA if k % 2 == 0 else bellB
            s = modes(spec, 0.35, rng) * (0.5 + 0.1 * rng.random())
            i = samples(tt)
            out[i:i + len(s)] += s[:len(out) - i]
            tt += 1 / 21.0
            k += 1
    return room(out, 0.5, 0.15)


def fx_escape():
    rng = R(136)
    bar = add(metal_clack(rng, 0.6, 0.4, 1.4) * 0.6, wood_knock(rng, 0.7, 0.6, 0.3) * 0.3)
    cr = creak(0.6, rng, rate=(110, 180, 130), body=(300, 640, 1200), q=10) * 0.5
    w = wind(2.4, seed=1361, cycles=(1, 2), level=1.0, howl=0.6)
    n = w.shape[1]
    t = np.arange(n) / SR
    gust = np.clip((t - 0.1) / 0.6, 0, 1) ** 1.5 * np.exp(-np.clip(t - 1.0, 0, None) / 0.7)
    rush = stereo(swish(1.6, 200, 800, 600, 3000, rng, peak=0.35)) * 0.4
    # (the night air's own rumble below ~50 Hz is felt, not heard, and only eats headroom)
    out = mix(2.8, (bar, 0.0), (cr, 0.1), (fade(hp(w * gust, 50, 2), 0, 0.7) * 4.0, 0.2), (fade(rush, 0, 0.3), 0.25))
    return out


# --- footsteps (a sprite: several steps on three floors) -----------------------------------------
STEP_SLOT = 0.42


def _step(kind, rng):
    if kind == 'carpet':
        heel = lp(white(samples(0.09), rng), 380, 2) * env_exp(samples(0.09), 0.025, 0.004) * 0.9
        heel += thump(95, 60, 0.03, 0.09) * 0.5
        scuff = bp(white(samples(0.12), rng), 800, 2800, 1) * np.hanning(samples(0.12)) * 0.08
        return mix(0.3, (heel, 0.0), (scuff, 0.03), (heel * 0.5, 0.075))[0]
    if kind == 'wood':
        heel = wood_knock(rng, rng.uniform(0.85, 1.05), 0.6, 0.16) * 0.6
        toe = wood_knock(rng, rng.uniform(1.1, 1.3), 0.2, 0.1) * 0.25
        out = mix(0.34, (lp(heel, 2600), 0.0), (lp(toe, 3000), 0.07))[0]
        if rng.random() < 0.35:
            cr = creak(0.18, rng, rate=(140, 220, 170), body=(420, 900), q=10) * 0.06
            out = out + mix(0.34, (cr, 0.05))[0]
        return out
    # marble / tile: a hard heel and a quick toe, with the room answering
    heel = modes([(1180, 0.015, 0.6), (2390, 0.010, 0.4), (3610, 0.006, 0.25), (520, 0.02, 0.3)], 0.12, rng)
    heel = add(heel, 0.5 * burst(0.05, 1200, 8000, rng, tau=0.002))
    toe = add(modes([(1350, 0.01, 0.4), (2800, 0.006, 0.2)], 0.08, rng) * 0.4, 0.2 * burst(0.03, 1500, 7000, rng, tau=0.0015))
    return mix(0.34, (heel * 0.6, 0.0), (toe, 0.06))[0]


def fx_steps():
    rng = R(140)
    kinds = ('carpet', 'wood', 'marble')
    per = 4
    out = np.zeros(samples(STEP_SLOT * per * len(kinds)) + samples(0.1))
    for i, k in enumerate(kinds):
        for j in range(per):
            s = _step(k, rng)
            if k == 'marble':
                s = mono(room(s, 0.7, 0.22, seed=1401 + j))
            s = s / (np.max(np.abs(s)) + 1e-9) * (0.8 if k != 'carpet' else 0.9)
            at = samples((i * per + j) * STEP_SLOT + 0.06)
            seg = s[:samples(STEP_SLOT - 0.08)]
            seg = fade(seg, 0, 0.03)
            out[at:at + len(seg)] += seg
    return out


STEP_SLICES = {k: [[round((i * 4 + j) * STEP_SLOT + 0.04, 3), round(STEP_SLOT - 0.06, 3)] for j in range(4)]
               for i, k in enumerate(('carpet', 'wood', 'marble'))}


# --- the table ------------------------------------------------------------------------------------
# lufs: target MOMENTARY maximum (400 ms window) - how loud the sound is at its loudest moment.
# room: (rt60, wet) of a small room added at the end; stereo: keep it stereo.
EFFECTS = {
    'click': dict(fn=fx_click, lufs=-23.0),
    'open': dict(fn=fx_open, lufs=-22.0, max_len=0.9),
    'close': dict(fn=fx_close, lufs=-23.0, max_len=0.8),
    'select': dict(fn=fx_select, lufs=-23.0, max_len=0.7),
    'deny': dict(fn=fx_deny, lufs=-21.0),
    'joined': dict(fn=fx_joined, lufs=-21.0, room=(0.9, 0.2), max_len=2.2),
    'liftDing': dict(fn=fx_liftDing, lufs=-17.0, room=(1.8, 0.35), stereo=True, max_len=4.5),
    'liftDoors': dict(fn=fx_liftDoors, lufs=-18.0, room=(1.4, 0.25), stereo=True),
    'fadeIn': dict(fn=fx_fadeIn, lufs=-22.0, stereo=True, max_len=2.8),
    'yourTurn': dict(fn=fx_yourTurn, lufs=-17.0, room=(0.8, 0.2), stereo=True, max_len=2.6),
    'tick': dict(fn=fx_tick, lufs=-19.0),
    'timeUp': dict(fn=fx_timeUp, lufs=-15.5, room=(0.9, 0.2), max_len=3.2),
    'doorOpen': dict(fn=fx_doorOpen, lufs=-16.0, room=(0.7, 0.18)),
    'doorJammed': dict(fn=fx_doorJammed, lufs=-16.0, room=(0.6, 0.15)),
    'doorLocked': dict(fn=fx_doorLocked, lufs=-17.0, room=(0.6, 0.15)),
    'unlock': dict(fn=fx_unlock, lufs=-17.0, room=(0.6, 0.12)),
    'lockFail': dict(fn=fx_lockFail, lufs=-17.0, room=(0.6, 0.12)),
    'barricade': dict(fn=fx_barricade, lufs=-15.0, room=(0.7, 0.18)),
    'search': dict(fn=fx_search, lufs=-18.0, room=(0.5, 0.1)),
    'cardFound': dict(fn=fx_cardFound, lufs=-17.0, max_len=1.4),
    'cardFlip': dict(fn=fx_cardFlip, lufs=-21.0),
    'bandage': dict(fn=fx_bandage, lufs=-18.0, room=(0.4, 0.1)),
    'espresso': dict(fn=fx_espresso, lufs=-18.0),
    'mirror': dict(fn=fx_mirror, lufs=-18.0, stereo=True, max_len=2.6),
    'tradeSwap': dict(fn=fx_tradeSwap, lufs=-17.0, room=(0.5, 0.12), stereo=True),
    'lanternBlock': dict(fn=fx_lanternBlock, lufs=-14.0, stereo=True, bitrate='112k', max_len=3.0),
    'possessed': dict(fn=fx_possessed, lufs=-15.0, stereo=True, bitrate='112k', max_len=4.2),
    'possessOther': dict(fn=fx_possessOther, lufs=-15.5, stereo=True, max_len=3.2),
    'noTrade': dict(fn=fx_noTrade, lufs=-20.0, max_len=1.2),
    'knife': dict(fn=fx_knife, lufs=-15.5, room=(0.6, 0.15)),
    'revolver': dict(fn=fx_revolver, lufs=-13.5, stereo=True, max_len=2.4),
    'hurt': dict(fn=fx_hurt, lufs=-16.0, stereo=True),
    'death': dict(fn=fx_death, lufs=-14.5, stereo=True, max_len=4.0),
    'infirmary': dict(fn=fx_infirmary, lufs=-18.0, stereo=True, max_len=2.2),
    'switchboard': dict(fn=fx_switchboard, lufs=-16.0, stereo=True),
    'escape': dict(fn=fx_escape, lufs=-15.0, stereo=True, bitrate='112k', max_len=3.4),
    'steps': dict(fn=fx_steps, lufs=-22.0, slices=STEP_SLICES, peak=True),
}


def finish(x, spec, stereo_out=False):
    """Room, trim, fades, loudness (momentary max) and a -1 dBFS ceiling."""
    if spec.get('room'):
        rt, wet = spec['room']
        x = room(x, rt, wet, seed=zlib.crc32(spec['fn'].__name__.encode()) % 1000)   # (stable from build to build)
    x = stereo(x) if stereo_out else mono(x)
    x = hp(x, 30, 2)          # no rumble below hearing or slow drift (it only eats headroom)
    xs = stereo(x)
    # trim leading silence (keep 1 ms) and the tail once it has died away (-58 dB)
    env = np.max(np.abs(xs), axis=0)
    thr = np.max(env) * undb(-58)
    nz = np.nonzero(env > thr)[0]
    if len(nz) and not spec.get('slices'):
        a = max(0, nz[0] - samples(0.001))
        b = min(xs.shape[1], nz[-1] + samples(0.02))
        x = x[..., a:b]
    # a long ring is shortened with a gentle fade (never a cut)
    ml = spec.get('max_len')
    if ml and x.shape[-1] > samples(ml):
        x = fade(x[..., :samples(ml)], 0, min(0.8, ml * 0.35))
    x = fade(x, 0.0005, min(0.06, x.shape[-1] / SR / 6))
    if spec.get('peak'):
        m = np.max(np.abs(x))
        y = x * undb(-6.0) / max(m, 1e-9)
    else:
        lev = loudness(x)['momentaryMax']
        y = x * undb(spec['lufs'] - lev)
    y = limiter(y, -1.0)
    return y if stereo_out else mono(y)
