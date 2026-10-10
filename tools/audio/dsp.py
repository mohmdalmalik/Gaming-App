"""DSP building blocks for Hotel Escape's generated music and sound effects.

Everything here is plain numpy/scipy, 44.1 kHz, float64. Signals are 1-D (mono) or shaped (2, n)
(stereo). Nothing is downloaded: every sound in assets/audio/ is made from these pieces by
tools/audio/build.py.

Loops: a looping piece is mixed on a `Canvas(loop=True)`; anything that runs past the end of the
loop (a ringing note, a reverb tail) wraps round onto the start, and the reverb / limiter / filters
are applied circularly, so the finished loop is exactly periodic - no seam to hide.
"""
import numpy as np
from scipy import signal
from scipy.ndimage import minimum_filter1d, uniform_filter1d

SR = 44100
TAU = 2 * np.pi


# --- units --------------------------------------------------------------------------------------
def midi_hz(m):
    return 440.0 * 2.0 ** ((np.asarray(m, dtype=float) - 69.0) / 12.0)


NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def nm(name):
    """'C#4' / 'Bb3' / 'D5' -> MIDI number (C4 = 60)."""
    if isinstance(name, (int, float, np.integer)):
        return int(name)
    s = name.strip()
    pc = NOTE[s[0].upper()]
    i = 1
    while i < len(s) and s[i] in '#b':
        pc += 1 if s[i] == '#' else -1
        i += 1
    return pc + 12 * (int(s[i:]) + 1)


def undb(d):
    return 10.0 ** (d / 20.0)


def db(x):
    return 20.0 * np.log10(max(float(x), 1e-12))


def secs(n):
    return n / SR


def samples(t):
    return int(round(t * SR))


# --- noise --------------------------------------------------------------------------------------
def white(n, rng):
    return rng.standard_normal(int(n))


def colored(n, rng, slope_db_oct=-3.0, lo=20.0):
    """Noise with a spectral slope (dB per octave): -3 = pink, -6 = brown, +3 = blue."""
    n = int(n)
    m = 1 << int(np.ceil(np.log2(max(n, 16))))
    spec = np.fft.rfft(rng.standard_normal(m))
    f = np.fft.rfftfreq(m, 1 / SR)
    f[0] = f[1]
    shape = (np.maximum(f, lo) / 1000.0) ** (slope_db_oct / 6.0206)
    x = np.fft.irfft(spec * shape, m)[:n]
    return x / (np.std(x) + 1e-12)


def pink(n, rng):
    return colored(n, rng, -3.0)


def brown(n, rng):
    return colored(n, rng, -6.0)


def smooth_noise(n, rng, rate_hz):
    """A slowly wandering control signal in about [-1, 1] (low-passed noise)."""
    n = int(n)
    k = max(4, int(n * rate_hz / SR) + 4)
    pts = rng.uniform(-1, 1, k)
    x = np.linspace(0, k - 1, n)
    i = np.floor(x).astype(int)
    fr = x - i
    i2 = np.minimum(i + 1, k - 1)
    w = (1 - np.cos(np.pi * fr)) / 2
    return pts[i] * (1 - w) + pts[i2] * w


# --- filters ------------------------------------------------------------------------------------
def _sos(kind, f, order=2):
    nyq = SR / 2
    if kind in ('band', 'bandstop'):
        lo, hi = f
        lo = max(5.0, min(lo, nyq * 0.95))
        hi = max(lo * 1.01, min(hi, nyq * 0.98))
        return signal.butter(order, [lo, hi], btype=kind, fs=SR, output='sos')
    f = max(5.0, min(f, nyq * 0.98))
    return signal.butter(order, f, btype=kind, fs=SR, output='sos')


def lp(x, f, order=2):
    return signal.sosfilt(_sos('low', f, order), x, axis=-1)


def hp(x, f, order=2):
    return signal.sosfilt(_sos('high', f, order), x, axis=-1)


def bp(x, lo, hi, order=2):
    return signal.sosfilt(_sos('band', (lo, hi), order), x, axis=-1)


def _biquad(b, a):
    b = np.asarray(b, float) / a[0]
    a = np.asarray(a, float) / a[0]
    return np.concatenate([b, a])[None, :]


def peq_sos(f, gain_db, q=1.0):
    A = 10 ** (gain_db / 40)
    w0 = TAU * min(f, SR * 0.49) / SR
    al = np.sin(w0) / (2 * q)
    c = np.cos(w0)
    return _biquad([1 + al * A, -2 * c, 1 - al * A], [1 + al / A, -2 * c, 1 - al / A])


def shelf_sos(f, gain_db, kind='high', q=0.7071):
    A = 10 ** (gain_db / 40)
    w0 = TAU * min(f, SR * 0.49) / SR
    al = np.sin(w0) / (2 * q)
    c = np.cos(w0)
    sA = 2 * np.sqrt(A) * al
    if kind == 'high':
        b = [A * ((A + 1) + (A - 1) * c + sA), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sA)]
        a = [(A + 1) - (A - 1) * c + sA, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sA]
    else:
        b = [A * ((A + 1) - (A - 1) * c + sA), 2 * A * ((A - 1) - (A + 1) * c), A * ((A + 1) - (A - 1) * c - sA)]
        a = [(A + 1) + (A - 1) * c + sA, -2 * ((A - 1) + (A + 1) * c), (A + 1) + (A - 1) * c - sA]
    return _biquad(b, a)


def reson_sos(f, q):
    """A resonant band-pass (constant 0 dB peak) - one mode of a body."""
    w0 = TAU * min(f, SR * 0.49) / SR
    al = np.sin(w0) / (2 * q)
    return _biquad([al, 0, -al], [1 + al, -2 * np.cos(w0), 1 - al])


def peq(x, f, gain_db, q=1.0):
    return signal.sosfilt(peq_sos(f, gain_db, q), x, axis=-1)


def shelf(x, f, gain_db, kind='high'):
    return signal.sosfilt(shelf_sos(f, gain_db, kind), x, axis=-1)


def reson(x, f, q):
    return signal.sosfilt(reson_sos(f, q), x, axis=-1)


def chain(x, *sos_list):
    if not sos_list:
        return x
    return signal.sosfilt(np.vstack(sos_list), x, axis=-1)


def circular(fn, x, warm_s=3.0):
    """Run a causal process (filter, compressor) on a LOOP so its start sees the loop's own end:
    the last `warm_s` seconds are fed in first and dropped. The result is periodic."""
    n = x.shape[-1]
    w = min(n, samples(warm_s))
    xx = np.concatenate([x[..., n - w:], x], axis=-1)
    return fn(xx)[..., w:]


def tv_lowpass(x, fc_curve, q=0.707):
    """A time-varying 2-pole low-pass (cut-off per sample, updated in 64-sample blocks)."""
    n = len(x)
    y = np.zeros(n)
    zi = np.zeros((1, 2))
    block = 64
    for s in range(0, n, block):
        e = min(n, s + block)
        fc = float(np.clip(fc_curve[s], 30, SR * 0.45))
        w0 = TAU * fc / SR
        al = np.sin(w0) / (2 * q)
        c = np.cos(w0)
        sos = _biquad([(1 - c) / 2, 1 - c, (1 - c) / 2], [1 + al, -2 * c, 1 - al])
        y[s:e], zi = signal.sosfilt(sos, x[s:e], zi=zi)
    return y


def tv_bandpass(x, fc_curve, q=4.0):
    n = len(x)
    y = np.zeros(n)
    zi = np.zeros((1, 2))
    block = 64
    for s in range(0, n, block):
        e = min(n, s + block)
        y[s:e], zi = signal.sosfilt(reson_sos(float(np.clip(fc_curve[s], 30, SR * 0.45)), q), x[s:e], zi=zi)
    return y


# --- envelopes ----------------------------------------------------------------------------------
def env_ar(n, attack, release, hold=None, curve=3.0):
    """Attack (s) up, held, then released over `release` s at the end."""
    n = int(n)
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    a = (1 - np.exp(-curve * a)) / (1 - np.exp(-curve)) if curve else a
    total = n / SR
    r = np.clip((total - t) / max(release, 1e-4), 0, 1)
    r = np.sin(r * np.pi / 2) ** 2
    return a * r


def env_exp(n, tau, attack=0.002):
    t = np.arange(int(n)) / SR
    e = np.exp(-t / tau)
    if attack > 0:
        e *= np.clip(t / attack, 0, 1)
    return e


def fade(x, fin=0.0, fout=0.0):
    x = np.array(x, dtype=float, copy=True)
    n = x.shape[-1]
    if fin > 0:
        k = min(n, samples(fin))
        x[..., :k] *= np.sin(np.linspace(0, np.pi / 2, k)) ** 2
    if fout > 0:
        k = min(n, samples(fout))
        x[..., n - k:] *= np.cos(np.linspace(0, np.pi / 2, k)) ** 2
    return x


def adsr(n, a, d, s, r, gate):
    """Classic ADSR: gate = note length (s); total length n samples includes the release."""
    t = np.arange(int(n)) / SR
    e = np.where(t < a, t / max(a, 1e-4), s + (1 - s) * np.exp(-(t - a) / max(d, 1e-4)))
    rel = np.where(t > gate, np.exp(-(t - gate) / max(r, 1e-4)), 1.0)
    if a > 0:
        e = np.where(t < a, (np.sin(np.clip(t / a, 0, 1) * np.pi / 2)) ** 2, e)
    return e * rel


# --- oscillators --------------------------------------------------------------------------------
def phase_of(freq, phase0=0.0):
    """Cycles (not radians) of a sine/saw whose frequency is `freq` (scalar or per-sample array)."""
    return phase0 + np.cumsum(np.broadcast_to(freq, np.shape(freq)) / SR)


def sine(freq, n=None, phase0=0.0):
    if np.isscalar(freq):
        t = np.arange(int(n)) / SR
        return np.sin(TAU * (freq * t + phase0))
    return np.sin(TAU * phase_of(freq, phase0))


def saw_blep(freq, n=None, phase0=0.0):
    """Band-limited sawtooth (polyBLEP) for a per-sample frequency array (or scalar + n)."""
    if np.isscalar(freq):
        freq = np.full(int(n), float(freq))
    dt = np.clip(freq / SR, 1e-6, 0.45)
    ph = (phase0 + np.cumsum(dt)) % 1.0
    y = 2 * ph - 1
    m = ph < dt
    t = ph[m] / dt[m]
    y[m] -= t + t - t * t - 1
    m = ph > 1 - dt
    t = (ph[m] - 1) / dt[m]
    y[m] -= t * t + t + t + 1
    return y


def pulse_blep(freq, n=None, width=0.5, phase0=0.0):
    a = saw_blep(freq, n, phase0)
    b = saw_blep(freq, n, phase0 + width)
    return (a - b) * 0.5


# --- stereo -------------------------------------------------------------------------------------
def pan(x, p=0.0):
    """Mono -> stereo, constant power; p in [-1, 1]. A stereo input is balanced instead."""
    th = (np.clip(p, -1, 1) + 1) * np.pi / 4
    if x.ndim == 1:
        return np.vstack([x * np.cos(th), x * np.sin(th)])
    return np.vstack([x[0] * np.cos(th) * np.sqrt(2), x[1] * np.sin(th) * np.sqrt(2)])


def stereo(x):
    return x if x.ndim == 2 else np.vstack([x, x])


def mono(x):
    return x if x.ndim == 1 else x.mean(axis=0)


def widen(x, amount=1.2):
    m = (x[0] + x[1]) / 2
    s = (x[0] - x[1]) / 2 * amount
    return np.vstack([m + s, m - s])


# --- the mixing canvas ----------------------------------------------------------------------------
class Canvas:
    """A stereo buffer that sounds are dropped onto at a time (s). loop=True wraps overflow round."""

    def __init__(self, length_s, loop=False, tail_s=0.0):
        self.loop = loop
        self.n = samples(length_s)
        self.buf = np.zeros((2, self.n if loop else self.n + samples(tail_s)))

    def add(self, sig, t, p=0.0, gain=1.0):
        s = np.asarray(sig, float)
        if s.ndim == 1 or p:
            s = pan(s, p)
        s = s * gain
        start = samples(t)
        L = s.shape[1]
        if self.loop:
            start %= self.n
            pos = 0
            while pos < L:
                k = min(L - pos, self.n - start)
                self.buf[:, start:start + k] += s[:, pos:pos + k]
                pos += k
                start = 0
        else:
            if start < 0:
                s = s[:, -start:]
                start = 0
                L = s.shape[1]
            end = min(self.buf.shape[1], start + L)
            if end > start:
                self.buf[:, start:end] += s[:, :end - start]
        return self


# --- reverb -------------------------------------------------------------------------------------
def hall_ir(rt60=2.2, length=None, predelay=0.018, seed=1, bands=None, early=True, width=1.0,
            density_ms=1.2, dark=1.0):
    """A synthetic stereo hall impulse response: early reflections, then a decaying diffuse tail
    whose highs die sooner than its lows. `bands`: [(lo, hi, rt60), ...] (defaults from rt60)."""
    rng = np.random.default_rng(seed)
    length = length or rt60 * 1.15 + predelay + 0.1
    n = samples(length)
    t = np.arange(n) / SR
    if bands is None:
        bands = [(20, 250, rt60 * 1.2), (250, 1200, rt60), (1200, 4000, rt60 * 0.72 / dark),
                 (4000, 9000, rt60 * 0.45 / dark), (9000, 20000, rt60 * 0.25 / dark)]
    ir = np.zeros((2, n))
    pre = samples(predelay)
    for ch in range(2):
        tail = np.zeros(n)
        for lo, hi, rt in bands:
            nz = rng.standard_normal(n)
            nz = bp(nz, lo, hi, 2) if lo > 20 else lp(nz, hi, 2)
            tail += nz * np.exp(-6.9078 * t / rt)
        # the diffuse field builds up over the first ~80 ms
        build = 1 - np.exp(-t / 0.03)
        tail *= build
        tail = np.concatenate([np.zeros(pre), tail[:n - pre]])
        ir[ch] = tail
    # decorrelate / width
    m = (ir[0] + ir[1]) / 2
    s = (ir[0] - ir[1]) / 2
    ir = np.vstack([m + s * width, m - s * width])
    ir /= np.sqrt(np.sum(ir ** 2) / 2) + 1e-12
    if early:
        taps = rng.uniform(0.006, 0.075, 14)
        for i, d in enumerate(sorted(taps)):
            k = pre // 3 + samples(d)
            if k < n:
                g = 0.55 * np.exp(-d / 0.05) * rng.uniform(0.5, 1.0)
                ch = i % 2
                ir[ch, k] += g
                ir[1 - ch, min(n - 1, k + rng.integers(5, 40))] += g * 0.6
    return ir


def convolve(x, ir, circular_n=None):
    """Stereo convolution. circular_n: wrap the tail round (for a loop of that many samples)."""
    x = stereo(x)
    ir = stereo(ir)
    if circular_n:
        N = circular_n
        assert ir.shape[1] < N, 'IR longer than the loop'
        out = np.zeros((2, N))
        for ch in range(2):
            X = np.fft.rfft(x[ch, :N], N)
            H = np.fft.rfft(ir[ch], N)
            out[ch] = np.fft.irfft(X * H, N)
        return out
    out = np.zeros((2, x.shape[1] + ir.shape[1] - 1))
    for ch in range(2):
        out[ch] = signal.oaconvolve(x[ch], ir[ch])
    return out


# --- dynamics -----------------------------------------------------------------------------------
def _release_hold(g, rel_samples):
    """Gain that falls at once and recovers with a one-pole release (sequential, but cheap)."""
    out = np.empty_like(g)
    a = np.exp(-1.0 / max(1.0, rel_samples))
    y = 1.0
    gl = g.tolist()
    for i, v in enumerate(gl):
        y = v if v < y else v + (y - v) * a
        out[i] = y
    return out


def limiter(x, ceiling_db=-1.5, lookahead_ms=3.0, release_ms=120.0, loop=False):
    """Brick-wall look-ahead limiter (offline, zero-latency: the gain is computed around each
    sample). With loop=True the windows wrap round, so the loop stays periodic."""
    x = stereo(x).copy()
    ceil = undb(ceiling_db)
    peak = np.max(np.abs(x), axis=0)
    need = np.minimum(1.0, ceil / np.maximum(peak, 1e-12))
    if need.min() >= 1.0:
        return x
    W = max(3, samples(lookahead_ms / 1000) * 2 + 1)
    pad = W + samples(release_ms / 1000) * 6
    if loop:
        g = np.concatenate([need[-pad:], need, need[:pad]])
    else:
        g = np.concatenate([np.ones(pad), need, np.ones(pad)])
    g1 = minimum_filter1d(g, size=W, mode='nearest')
    g1 = _release_hold(g1, samples(release_ms / 1000))
    # (a reversed pass smooths the onset too, so the gain never steps)
    g1 = np.minimum(g1, _release_hold(g1[::-1], samples(lookahead_ms / 1000))[::-1])
    g2 = uniform_filter1d(g1, size=max(3, W // 2), mode='nearest')
    g2 = g2[pad:pad + x.shape[1]]
    y = x * g2
    # safety: anything still over (rounding) is clipped softly
    return np.clip(y, -ceil, ceil)


def compressor(x, thr_db=-20, ratio=2.0, attack=0.02, release=0.25, knee_db=6, loop=False):
    """A gentle RMS compressor (stereo-linked)."""
    x = stereo(x)

    def run(xx):
        p = np.mean(xx ** 2, axis=0)
        a_att = 1 - np.exp(-1 / (attack * SR))
        a_rel = 1 - np.exp(-1 / (release * SR))
        # one smoothing pass with the release time (lfilter), then attack: cheap approximation
        env = signal.lfilter([a_rel], [1, -(1 - a_rel)], p)
        env = signal.lfilter([a_att], [1, -(1 - a_att)], np.maximum(env, p * 0))
        lev = 10 * np.log10(env + 1e-12)
        over = lev - thr_db
        gr = np.where(over <= -knee_db / 2, 0.0,
                      np.where(over >= knee_db / 2, over * (1 - 1 / ratio),
                               (1 - 1 / ratio) * (over + knee_db / 2) ** 2 / (2 * knee_db)))
        return xx * undb(-gr)[None, :]

    return circular(run, x, 4.0) if loop else run(x)


def remove_dc(x, loop=False):
    if loop:
        return x - x.mean(axis=-1, keepdims=True)
    return hp(x, 18.0, 2)


def soft_clip(x, drive=1.0):
    return np.tanh(x * drive) / np.tanh(drive)


# --- measurement --------------------------------------------------------------------------------
def k_weight(x):
    """ITU-R BS.1770 K-weighting at 44.1 kHz (pre-filter shelf + RLB high-pass)."""
    G, Q1, f1 = 3.99984385397, 0.7071752369554193, 1681.9744509555319
    Q2, f2 = 0.5003270373253953, 38.13547087613982
    A = 10 ** (G / 40)
    w0 = TAU * f1 / SR
    al = np.sin(w0) / (2 * Q1)
    c = np.cos(w0)
    sA = 2 * np.sqrt(A) * al
    s1 = _biquad([A * ((A + 1) + (A - 1) * c + sA), -2 * A * ((A - 1) + (A + 1) * c), A * ((A + 1) + (A - 1) * c - sA)],
                 [(A + 1) - (A - 1) * c + sA, 2 * ((A - 1) - (A + 1) * c), (A + 1) - (A - 1) * c - sA])
    w0 = TAU * f2 / SR
    al = np.sin(w0) / (2 * Q2)
    c = np.cos(w0)
    s2 = _biquad([(1 + c) / 2, -(1 + c), (1 + c) / 2], [1 + al, -2 * c, 1 - al])
    return signal.sosfilt(np.vstack([s1, s2]), x, axis=-1)


def loudness(x):
    """Integrated loudness (LUFS, BS.1770-4 gating), short-term max (3 s) and momentary max (0.4 s)."""
    x = stereo(x)
    y = k_weight(x)
    p = np.sum(y ** 2, axis=0)            # channel weights 1.0 (L, R)
    cs = np.concatenate([[0.0], np.cumsum(p)])

    def blocks(win, hop):
        w = samples(win)
        h = samples(hop)
        if len(p) < w:
            return np.array([np.sum(p) / max(1, len(p))])
        starts = np.arange(0, len(p) - w + 1, h)
        return (cs[starts + w] - cs[starts]) / w

    mz = blocks(0.4, 0.1)
    lk = -0.691 + 10 * np.log10(mz + 1e-15)
    g = mz[lk > -70]
    if not len(g):
        return {'integrated': -99.0, 'shortMax': -99.0, 'momentaryMax': -99.0}
    rel = -0.691 + 10 * np.log10(np.mean(g)) - 10
    g2 = g[(-0.691 + 10 * np.log10(g + 1e-15)) > rel]
    integ = -0.691 + 10 * np.log10(np.mean(g2)) if len(g2) else -99.0
    st = blocks(3.0, 0.1)
    return {'integrated': float(integ), 'shortMax': float(-0.691 + 10 * np.log10(st.max() + 1e-15)),
            'momentaryMax': float(lk.max())}


def true_peak_db(x):
    x = stereo(x)
    up = signal.resample_poly(x, 4, 1, axis=-1)
    return db(np.max(np.abs(up)))


def normalize_lufs(x, target, ceiling_db=-1.5, loop=False, max_gain_db=30):
    L = loudness(x)['integrated']
    g = np.clip(target - L, -40, max_gain_db)
    y = stereo(x) * undb(g)
    return limiter(y, ceiling_db, loop=loop)


def normalize_peak(x, peak_db=-1.0):
    m = np.max(np.abs(x))
    return x * (undb(peak_db) / max(m, 1e-12))


def click_score(x):
    """How click-like the worst moment is: the largest 2nd difference relative to the local level
    (1-3 is normal music; a discontinuity shows as 10+)."""
    x = mono(stereo(x))
    d2 = np.abs(np.diff(x, 2))
    w = samples(0.01)
    loc = uniform_filter1d(d2, size=w * 8, mode='wrap') + 1e-6
    return float(np.max(d2 / loc))
