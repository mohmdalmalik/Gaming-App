# Post-processing shared by every card: the painted backdrop (dark mottled green, or purple/black
# for the evil card), the render composited over it with its contact shadow, a warm glow under the
# object, bloom on bright highlights, a soft vignette and fine grain. Pure numpy/PIL/scipy.
import numpy as np
from PIL import Image
from scipy import ndimage

SIZE = 640

PALETTES = {
    # centre (behind the object), mid, edge  — sampled from assets/cards/lantern.jpg
    'green':  ((31, 63, 45), (15, 37, 28), (8, 19, 16)),
    'purple': ((50, 26, 66), (24, 12, 34), (9, 5, 14)),
}

def fbm(size, seed, octaves=((5, 1.0), (10, 0.6), (22, 0.4), (48, 0.25), (110, 0.12))):
    """Smooth multi-scale value noise in 0..1 (the painted, mottled texture)."""
    rng = np.random.default_rng(seed)
    acc = np.zeros((size, size)); tot = 0
    for cells, w in octaves:
        g = rng.random((cells + 3, cells + 3))
        z = ndimage.zoom(g, (size + 2 * size / cells) / (cells + 3), order=3)
        o = int(size / cells)
        acc += w * z[o:o + size, o:o + size]; tot += w
    acc /= tot
    return (acc - acc.min()) / (acc.max() - acc.min())

def smooth(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)

def backdrop(kind='green', size=SIZE, seed=7, glow_center=(0.5, 0.44)):
    c0, c1, c2 = [np.array(c, float) for c in PALETTES[kind]]
    yy, xx = np.mgrid[0:size, 0:size] / size
    r = np.hypot(xx - glow_center[0], (yy - glow_center[1]) * 0.95)
    t1 = smooth(0.0, 0.42, r)[..., None]; t2 = smooth(0.35, 0.8, r)[..., None]
    base = c0 * (1 - t1) + c1 * t1
    base = base * (1 - t2) + c2 * t2
    n = fbm(size, seed)[..., None]
    n2 = fbm(size, seed + 11, ((3, 1.0), (7, 0.5)))[..., None]
    fine = fbm(size, seed + 23, ((90, 1.0), (200, 0.6)))[..., None]
    img = base * (0.82 + 0.36 * n) * (0.9 + 0.2 * n2) * (0.94 + 0.12 * fine)
    return img

def load_render(path):
    im = Image.open(path)
    a = np.asarray(im).astype(np.float64)
    a /= 65535.0 if a.max() > 255 else 255.0
    return a[..., :3] * 255.0, a[..., 3]

def composite(render_path, out_path, kind='green', seed=7, glow=(1.0, 0.72, 0.38), glow_amt=26.0,
              bloom=1.0, floor_glow=True, glow_center=(0.5, 0.44), extra=None, quality=88, pool=None,
              sat=1.12, gamma=1.08, tint=(1.03, 1.0, 0.95)):
    rgb, a = load_render(render_path)
    size = rgb.shape[0]
    bg = backdrop(kind, size, seed, glow_center)
    # the object's footprint: pixels that are opaque and not just shadow
    lum = rgb.mean(-1)
    solid = (a > 0.5) & (lum > 2)
    ys, xs = np.nonzero(solid)
    yy, xx = np.mgrid[0:size, 0:size]
    if len(ys):
        # warm light pool around the base of the object (as under the lamp in the Lantern card)
        cx = (xs.min() + xs.max()) / 2; by = ys.max() if pool is None else pool[1] * size
        if pool is not None: cx = pool[0] * size
        w = (xs.max() - xs.min()) * 0.75 + 60
        e = np.exp(-(((xx - cx) / w) ** 2 + ((yy - by) / (w * 0.28)) ** 2))
        if floor_glow: bg += e[..., None] * np.array(glow) * glow_amt
        # and a soft halo behind the object
        e2 = np.exp(-(((xx - cx) / (w * 1.1)) ** 2 + ((yy - (ys.min() + ys.max()) / 2) / (w * 1.1)) ** 2))
        bg += e2[..., None] * np.array(glow) * glow_amt * 0.35
    # a painter's grade on the object: a little more contrast and warmth, richer colour
    g = rgb / 255.0
    lum = g.mean(-1, keepdims=True)
    g = lum + (g - lum) * sat
    g = np.clip(g, 0, None) ** gamma
    rgb = np.clip(g, 0, 1.2) * 255.0 * np.array(tint)
    out = bg * (1 - a[..., None]) + rgb * a[..., None]
    if extra is not None:
        out = extra(out, a, size)
    # bloom: bright highlights bleed a warm glow
    if bloom:
        L = out.mean(-1)
        hi = np.clip((L - 170) / 85, 0, 1)[..., None] * out
        b1 = ndimage.gaussian_filter(hi, (6, 6, 0)); b2 = ndimage.gaussian_filter(hi, (24, 24, 0))
        out = out + bloom * (0.35 * b1 + 0.3 * b2)
    # gentle painterly softening of the render's CG crispness, then a light sharpen for detail
    soft = ndimage.gaussian_filter(out, (0.7, 0.7, 0))
    out = soft + 0.35 * (soft - ndimage.gaussian_filter(soft, (2.0, 2.0, 0)))
    # vignette
    r = np.hypot(xx / size - 0.5, yy / size - 0.5)
    out *= (1 - 0.42 * smooth(0.32, 0.78, r))[..., None]
    # fine grain
    rng = np.random.default_rng(seed + 99)
    g = ndimage.gaussian_filter(rng.normal(0, 1, (size, size)), 0.6)
    out += (g * 3.2)[..., None]
    out = np.clip(out, 0, 255).astype(np.uint8)
    im = Image.fromarray(out)
    if size != SIZE: im = im.resize((SIZE, SIZE), Image.LANCZOS)
    im.save(out_path, 'JPEG', quality=quality, optimize=True, progressive=True, subsampling='4:2:0')
    return im
