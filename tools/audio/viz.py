"""Look at a sound without listening: a log-frequency spectrogram (PNG) and a chroma read-out.

  python3 tools/audio/viz.py assets/audio/music-lobby.mp3 [out.png] [--start S --len S --chroma BAR_S]

The picture: time left to right, 30 Hz - 12 kHz bottom to top (log), brightness = level (a 70 dB
range). --chroma BAR_S prints, for each BAR_S-second slice, the three strongest pitch classes, to
check that the harmony is what the score says.
"""
import sys
import os
import numpy as np
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from dsp import SR, mono  # noqa: E402
from build import decode  # noqa: E402

NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'G#', 'A', 'Bb', 'B']


def spectrogram(x, px_per_s=40, height=360, fmin=30, fmax=12000, nfft=4096):
    x = mono(x)
    hop = int(SR / px_per_s)
    win = np.hanning(nfft)
    frames = max(1, (len(x) - nfft) // hop)
    freqs = np.fft.rfftfreq(nfft, 1 / SR)
    rows = np.geomspace(fmin, fmax, height)
    idx = np.clip(np.searchsorted(freqs, rows), 1, len(freqs) - 1)
    img = np.zeros((height, frames))
    for i in range(frames):
        seg = x[i * hop: i * hop + nfft] * win
        mag = np.abs(np.fft.rfft(seg))
        img[:, i] = mag[idx]
    img = 20 * np.log10(img + 1e-9)
    img -= img.max()
    img = np.clip((img + 70) / 70, 0, 1)
    rgb = np.stack([img ** 0.8 * 255, img ** 1.4 * 220, img ** 3 * 160], axis=-1).astype(np.uint8)
    return Image.fromarray(rgb[::-1])


def chroma(x, slice_s):
    x = mono(x)
    n = int(slice_s * SR)
    out = []
    for s in range(0, len(x) - n + 1, n):
        seg = x[s:s + n] * np.hanning(n)
        mag = np.abs(np.fft.rfft(seg)) ** 2
        f = np.fft.rfftfreq(n, 1 / SR)
        sel = (f > 60) & (f < 2000)
        midi = 69 + 12 * np.log2(f[sel] / 440)
        pc = np.mod(np.round(midi), 12).astype(int)
        c = np.bincount(pc, weights=mag[sel], minlength=12)
        c /= c.max() + 1e-12
        top = np.argsort(c)[::-1][:4]
        out.append(' '.join(f'{NAMES[k]}{c[k]:.2f}' for k in top))
    return out


if __name__ == '__main__':
    args = sys.argv[1:]
    path = args[0]
    outp = args[1] if len(args) > 1 and not args[1].startswith('--') else os.path.splitext(path)[0] + '.png'
    start = float(args[args.index('--start') + 1]) if '--start' in args else 0.0
    length = float(args[args.index('--len') + 1]) if '--len' in args else None
    x = decode(path)
    x = x[:, int(start * SR): int((start + length) * SR) if length else None]
    spectrogram(x).save(outp)
    print('wrote', outp)
    if '--chroma' in args:
        for i, line in enumerate(chroma(x, float(args[args.index('--chroma') + 1]))):
            print(f'{i + 1:3d}  {line}')
