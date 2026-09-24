# Albedo textures for the lobby (flat, stylised — the lighting is baked separately):
#   floor.png  cream stone tiles, 4 m x 4 m (8 x 8 tiles of 0.5 m), repeats across the floor
#   rugs.png   two burgundy rugs with gold borders, side by side (left: seating rug, right: centre rug)
#   art.png    four paintings in quadrants (landscape, lake, portrait, still life)
# Run: python3 tools/lobby-pipeline/textures.py   (writes into tools/lobby-pipeline/build/)
import os, random
from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'build')
os.makedirs(OUT, exist_ok=True)
rnd = random.Random(7)


def hexrgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def jitter(c, k):
    return tuple(max(0, min(255, v + rnd.randint(-k, k))) for v in c)


def floor_tiles():
    S, n = 1024, 8
    tile = S // n
    im = Image.new('RGB', (S, S), hexrgb('#bea67c'))           # grout
    d = ImageDraw.Draw(im)
    base = [hexrgb(c) for c in ('#e0cda6', '#dcc8a0', '#e3d1ac', '#d9c49b')]
    g = 3                                                       # half grout width in px
    for j in range(n):
        for i in range(n):
            c = jitter(base[(i * 3 + j * 5 + rnd.randint(0, 3)) % 4], 4)
            x0, y0 = i * tile + g, j * tile + g
            d.rectangle([x0, y0, x0 + tile - 2 * g - 1, y0 + tile - 2 * g - 1], fill=c)
            # a soft bevel: lighter top-left edge, darker bottom-right edge
            d.line([x0, y0, x0 + tile - 2 * g - 1, y0], fill=jitter(tuple(min(255, v + 10) for v in c), 1), width=2)
            d.line([x0, y0, x0, y0 + tile - 2 * g - 1], fill=jitter(tuple(min(255, v + 8) for v in c), 1), width=2)
            d.line([x0, y0 + tile - 2 * g - 2, x0 + tile - 2 * g - 1, y0 + tile - 2 * g - 2], fill=tuple(v - 14 for v in c), width=2)
            d.line([x0 + tile - 2 * g - 2, y0, x0 + tile - 2 * g - 2, y0 + tile - 2 * g - 1], fill=tuple(v - 12 for v in c), width=2)
            # faint stone mottling
            for _ in range(10):
                cx, cy = x0 + rnd.randint(8, tile - 16), y0 + rnd.randint(8, tile - 16)
                r = rnd.randint(4, 14)
                d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=jitter(c, 5))
    im = im.filter(ImageFilter.GaussianBlur(0.6))
    im.save(os.path.join(OUT, 'floor.png'))


def rug(w, h, d, ox):
    """Draw one rug in the box (ox, 0, ox+w, h): dark border band, gold lines, burgundy field."""
    deep, field, gold = hexrgb('#44121a'), hexrgb('#621c24'), hexrgb('#c09650')
    d.rectangle([ox, 0, ox + w - 1, h - 1], fill=deep)
    b = int(w * 0.06)
    d.rectangle([ox + b, b, ox + w - 1 - b, h - 1 - b], outline=gold, width=10)
    d.rectangle([ox + b + 10, b + 10, ox + w - 1 - b - 10, h - 1 - b - 10], fill=field)
    b2 = b + 42
    d.rectangle([ox + b2, b2, ox + w - 1 - b2, h - 1 - b2], outline=gold, width=5)
    # small gold corner blocks on the inner line, as in the reference's bordered rugs
    for cx in (ox + b2, ox + w - 1 - b2):
        for cy in (b2, h - 1 - b2):
            d.rectangle([cx - 9, cy - 9, cx + 9, cy + 9], fill=gold)


def rugs():
    W, H = 2048, 1024
    im = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(im)
    rug(1024, 1024, d, 0)
    rug(1024, 1024, d, 1024)
    # woven texture: fine noise
    px = im.load()
    for y in range(0, H):
        for x in range(0, W):
            if (x + y) % 2 == 0:
                r, g, b = px[x, y]
                k = rnd.randint(-6, 6)
                px[x, y] = (max(0, min(255, r + k)), max(0, min(255, g + k)), max(0, min(255, b + k)))
    im = im.filter(ImageFilter.GaussianBlur(0.7))
    im.save(os.path.join(OUT, 'rugs.png'))


def painting_landscape(d, x0, y0, s):
    # dusk sky, layered mountains, dark pines, a lake — the reference's framed landscape
    sky = [hexrgb('#c9b58a'), hexrgb('#a9a27d'), hexrgb('#7f8a73')]
    for i in range(s):
        t = i / s
        c = tuple(int(sky[0][k] * (1 - t) + sky[2][k] * t) for k in range(3))
        d.line([x0, y0 + i * 0.6, x0 + s, y0 + i * 0.6], fill=c)
    d.polygon([(x0, y0 + s * .55), (x0 + s * .3, y0 + s * .28), (x0 + s * .55, y0 + s * .5), (x0 + s * .8, y0 + s * .25), (x0 + s, y0 + s * .45), (x0 + s, y0 + s), (x0, y0 + s)], fill=hexrgb('#5d6b5b'))
    d.polygon([(x0, y0 + s * .68), (x0 + s * .4, y0 + s * .5), (x0 + s * .7, y0 + s * .66), (x0 + s, y0 + s * .58), (x0 + s, y0 + s), (x0, y0 + s)], fill=hexrgb('#3f5446'))
    d.rectangle([x0, y0 + s * .78, x0 + s, y0 + s], fill=hexrgb('#6f8a86'))
    for k in range(9):
        px = x0 + s * (0.05 + 0.11 * k) + rnd.randint(-8, 8)
        base = y0 + s * (0.8 + 0.03 * (k % 2))
        hgt = s * (0.18 + 0.08 * rnd.random())
        d.polygon([(px, base - hgt), (px - s * .045, base), (px + s * .045, base)], fill=hexrgb('#243a2c'))


def painting_lake(d, x0, y0, s):
    d.rectangle([x0, y0, x0 + s, y0 + s * .5], fill=hexrgb('#d8b27a'))
    d.ellipse([x0 + s * .6, y0 + s * .18, x0 + s * .76, y0 + s * .34], fill=hexrgb('#f1d59b'))
    d.polygon([(x0, y0 + s * .5), (x0 + s * .35, y0 + s * .35), (x0 + s * .6, y0 + s * .48), (x0 + s, y0 + s * .4), (x0 + s, y0 + s * .55), (x0, y0 + s * .55)], fill=hexrgb('#8a6a4a'))
    d.rectangle([x0, y0 + s * .55, x0 + s, y0 + s], fill=hexrgb('#5f7a78'))
    for k in range(6):
        yy = y0 + s * (0.62 + 0.06 * k)
        d.line([x0 + s * .15, yy, x0 + s * .85, yy], fill=hexrgb('#7d9793'), width=3)


def painting_portrait(d, x0, y0, s):
    d.rectangle([x0, y0, x0 + s, y0 + s], fill=hexrgb('#2f3a33'))
    d.ellipse([x0 + s * .1, y0 + s * .05, x0 + s * .9, y0 + s * .95], fill=hexrgb('#3d4a40'))
    d.polygon([(x0 + s * .18, y0 + s), (x0 + s * .3, y0 + s * .7), (x0 + s * .7, y0 + s * .7), (x0 + s * .82, y0 + s)], fill=hexrgb('#1c2430'))
    d.polygon([(x0 + s * .45, y0 + s * .72), (x0 + s * .5, y0 + s * .82), (x0 + s * .55, y0 + s * .72)], fill=hexrgb('#e8e0d0'))
    d.ellipse([x0 + s * .36, y0 + s * .3, x0 + s * .64, y0 + s * .66], fill=hexrgb('#d9ab85'))
    d.chord([x0 + s * .34, y0 + s * .26, x0 + s * .66, y0 + s * .5], 180, 360, fill=hexrgb('#2b1d14'))
    d.ellipse([x0 + s * .44, y0 + s * .52, x0 + s * .56, y0 + s * .56], fill=hexrgb('#2b1d14'))


def painting_still(d, x0, y0, s):
    d.rectangle([x0, y0, x0 + s, y0 + s], fill=hexrgb('#3b2a22'))
    d.rectangle([x0, y0 + s * .7, x0 + s, y0 + s], fill=hexrgb('#5a3b28'))
    d.polygon([(x0 + s * .38, y0 + s * .72), (x0 + s * .42, y0 + s * .45), (x0 + s * .58, y0 + s * .45), (x0 + s * .62, y0 + s * .72)], fill=hexrgb('#b08a4a'))
    for (cx, cy, r, c) in ((.45, .36, .09, '#b3303a'), (.56, .33, .08, '#d8a24a'), (.5, .26, .07, '#e0d6c0'), (.38, .3, .06, '#7a8f4a')):
        d.ellipse([x0 + s * (cx - r), y0 + s * (cy - r), x0 + s * (cx + r), y0 + s * (cy + r)], fill=hexrgb(c))


def art():
    S = 1024
    im = Image.new('RGB', (S, S))
    d = ImageDraw.Draw(im)
    h = S // 2
    painting_landscape(d, 0, 0, h)
    painting_lake(d, h, 0, h)
    painting_portrait(d, 0, h, h)
    painting_still(d, h, h, h)
    im = im.filter(ImageFilter.GaussianBlur(1.2))
    im.save(os.path.join(OUT, 'art.png'))


if __name__ == '__main__':
    floor_tiles()
    rugs()
    art()
    print('textures written to', OUT)
