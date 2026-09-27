# The ONE albedo texture every room shares (flat, stylised — the light is baked separately):
# a 4 x 4 grid of 512 px cells, 2048 px in all. Cell index = row * 4 + col (row 0 at the top).
# Matched to the owner's room references (tools/room-pipeline/ref/): cream stone, herringbone,
# plank, checker, sage and slate floors; gilt-framed landscapes; chunky book spines.
#
#   0 cream stone tiles, 3 x 3 (2 m)     1 herringbone parquet (2 m)       2 beige + taupe checker, 4 x 4 (2 m)
#   3 sage-green clinic tiles, 4 x 4     4 burgundy carpet (2 m)           5 dark slate tiles, 2 x 2 (2 m)
#   6 warm wooden planks (2 m)           7 cream wall tiles (1 m)          8 beige plaster, mottled (1 m)
#   9 four pictures: still life | white flowers | botanical print | sea
#  10 four landscape paintings (quadrants)                                11 green-grey plaster (1 m)
#  12 dark wainscot boards (1 m)        13 book spines (a shelf row)      14 cream plaster (1 m)
#  15 signs, quadrants: switchboard jack field | EXIT | red cross | night window
#
# Run: python3 tools/room-pipeline/textures_rooms.py
#   -> tools/room-pipeline/build/albedo.png  and  assets/models/rooms/albedo.jpg (what the game loads)
import os, random, math
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
BUILD = os.path.join(HERE, 'build')
OUT = os.path.join(REPO, 'assets', 'models', 'rooms')
os.makedirs(BUILD, exist_ok=True)
os.makedirs(OUT, exist_ok=True)
rnd = random.Random(11)
S = 512


def rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def jit(c, k):
    return tuple(max(0, min(255, v + rnd.randint(-k, k))) for v in c)


def shade(c, k):
    return tuple(max(0, min(255, v + k)) for v in c)


def mix(a, b, t):
    return tuple(int(a[i] + (b[i] - a[i]) * t) for i in range(3))


def speckle(im, n, k, blur=0.6):
    px = im.load()
    for _ in range(n):
        x, y = rnd.randrange(S), rnd.randrange(S)
        px[x, y] = jit(px[x, y], k)
    return im.filter(ImageFilter.GaussianBlur(blur))


def clouds(im, base, amp, scale=64, seed=1):
    """Soft mottling (plaster, stone): a few blurred random blobs over the base colour."""
    r = random.Random(seed)
    lay = Image.new('L', (S, S), 128)
    d = ImageDraw.Draw(lay)
    for _ in range(90):
        x, y, rr = r.randrange(-40, S + 40), r.randrange(-40, S + 40), r.randrange(scale // 2, scale * 2)
        d.ellipse([x - rr, y - rr, x + rr, y + rr], fill=r.randrange(90, 170))
    lay = lay.filter(ImageFilter.GaussianBlur(scale / 2))
    px, lp = im.load(), lay.load()
    for y in range(S):
        for x in range(S):
            k = (lp[x, y] - 128) / 128 * amp
            c = px[x, y]
            px[x, y] = tuple(max(0, min(255, int(v + k))) for v in c)
    return im


def tiles(n, col, grout, var=5, bevel=True, seed=3, mottle=6):
    """n x n square tiles over the cell, thin grout, a faint top-left highlight per tile."""
    im = Image.new('RGB', (S, S), rgb(grout))
    d = ImageDraw.Draw(im)
    t = S / n
    g = 2
    r = random.Random(seed)
    for i in range(n):
        for j in range(n):
            k = r.randint(-var, var)
            c = tuple(max(0, min(255, v + k)) for v in rgb(col))
            x0, y0, x1, y1 = int(i * t) + g, int(j * t) + g, int((i + 1) * t) - g, int((j + 1) * t) - g
            d.rectangle([x0, y0, x1, y1], fill=c)
            if bevel:
                d.line([x0, y0, x1, y0], fill=shade(c, 8), width=2)
                d.line([x0, y0, x0, y1], fill=shade(c, 8), width=2)
                d.line([x0, y1, x1, y1], fill=shade(c, -8), width=2)
                d.line([x1, y0, x1, y1], fill=shade(c, -8), width=2)
    if mottle:
        clouds(im, None, mottle, 40, seed)
    return speckle(im, 6000, 4, 0.5)


def stone():
    return tiles(3, '#dfb48a', '#c49a70', var=5, seed=3, mottle=4)


def herringbone():
    """Herringbone in warm oak, planks 0.5 m x 0.125 m, repeating seamlessly every 2 m (512 px): the
    lattice is t1 = (W, W), t2 = (L, -L) with one horizontal and one vertical plank per cell."""
    tones = [rgb(c) for c in ('#94603e', '#9c6844', '#8a5a3a', '#a06c46', '#905e3c', '#966240')]
    im = Image.new('RGB', (S, S), rgb('#6a4226'))
    d = ImageDraw.Draw(im)
    r = random.Random(4)
    L, Wd = 128, 32
    for a in range(-20, 36):
        for b in range(-8, 8):
            ox, oy = a * Wd + b * L, a * Wd - b * L
            for (px, py, w, h) in ((ox, oy, L, Wd), (ox + L, oy + Wd - L, Wd, L)):
                c = jit(tones[r.randrange(len(tones))], 5)
                for sx in (-S, 0, S):
                    for sy in (-S, 0, S):
                        x0, y0 = px + sx, py + sy
                        if x0 >= S or y0 >= S or x0 + w <= 0 or y0 + h <= 0:
                            continue
                        d.rectangle([x0 + 1, y0 + 1, x0 + w - 2, y0 + h - 2], fill=c)
    return speckle(im, 9000, 5, 0.6)


def checker():
    im = Image.new('RGB', (S, S), rgb('#b7aa94'))
    d = ImageDraw.Draw(im)
    n = 4                                             # 0.5 m tiles
    t = S // n
    for i in range(n):
        for j in range(n):
            c = jit(rgb('#e6dcc8') if (i + j) % 2 == 0 else rgb('#b8ac98'), 3)
            d.rectangle([i * t + 2, j * t + 2, i * t + t - 3, j * t + t - 3], fill=c)
    clouds(im, None, 5, 40, 7)
    return speckle(im, 6000, 4, 0.5)


def clinic():
    return tiles(4, '#b3b793', '#9a9f7c', var=4, seed=5, mottle=5)


def carpet():
    im = Image.new('RGB', (S, S), rgb('#7a2430'))
    clouds(im, None, 8, 50, 9)
    return speckle(im, 20000, 8, 0.8)


def slate():
    im = tiles(2, '#6e7480', '#50545e', var=6, seed=8, mottle=10)
    return im


def planks():
    im = Image.new('RGB', (S, S), rgb('#5a3620'))
    d = ImageDraw.Draw(im)
    n = 10                                            # 0.2 m boards
    w = S / n
    r = random.Random(6)
    for k in range(n):
        x0 = int(k * w)
        x1 = int((k + 1) * w)
        y = -r.randint(0, S)
        while y < S:
            L = r.randint(S // 3, S)
            c = jit(rgb(r.choice(['#744430', '#6c3f2a', '#7a4832', '#663a26'])), 5)
            for oy in (0, S):
                d.rectangle([x0 + 1, y + 1 - oy, x1 - 2, y + L - 2 - oy], fill=c)
                for _ in range(4):                       # grain
                    gx = x0 + r.randint(4, max(5, x1 - x0 - 5))
                    d.line([gx, y + 4 - oy, gx + r.randint(-2, 2), y + L - 4 - oy], fill=shade(c, -7), width=1)
            y += L
    return speckle(im, 6000, 4, 0.6)


def wall_tiles():
    """Cream glazed wall tiles, brick bond (the kitchen): 1 m = 512 px, tiles 0.25 x 0.125 m."""
    im = Image.new('RGB', (S, S), rgb('#c8bca4'))
    d = ImageDraw.Draw(im)
    tw, th = 128, 64
    for row in range(S // th):
        off = (row % 2) * tw // 2
        for k in range(-1, S // tw + 1):
            x0, y0 = k * tw + off, row * th
            c = jit(rgb('#eee6d4'), 3)
            d.rectangle([x0 + 2, y0 + 2, x0 + tw - 3, y0 + th - 3], fill=c)
            d.line([x0 + 5, y0 + 5, x0 + tw - 12, y0 + 5], fill=(250, 246, 236), width=2)
    return speckle(im, 3000, 3, 0.5)


def plaster(col, amp=9, seed=2):
    im = Image.new('RGB', (S, S), rgb(col))
    clouds(im, None, amp, 70, seed)
    return speckle(im, 12000, 5, 1.0)


def landscape(d, x0, y0, w, h, v):
    """A small stylised landscape (the references' gilt-framed mountain/lake paintings)."""
    r = random.Random(20 + v)
    skies = [('#e8c89a', '#a8b8c0'), ('#f0d2a0', '#b8c4c0'), ('#d8b890', '#9fb0b8'), ('#e6cfa8', '#a4b4b0')]
    top, bot = skies[v % 4]
    for k in range(h):
        d.line([x0, y0 + k, x0 + w, y0 + k], fill=mix(rgb(bot), rgb(top), k / h))
    # far mountains
    for layer, (col, base, amp) in enumerate((('#8a98a8', 0.55, 0.35), ('#6f8494', 0.62, 0.25))):
        pts = [(x0, y0 + h)]
        n = 5
        for i in range(n + 1):
            px = x0 + w * i / n
            py = y0 + h * (base - amp * (0.4 + 0.6 * r.random()) * (1 if i % 2 else 0.4))
            pts.append((px, py))
        pts.append((x0 + w, y0 + h))
        d.polygon(pts, fill=rgb(col))
    # lake
    d.rectangle([x0, y0 + h * 0.68, x0 + w, y0 + h * 0.8], fill=rgb('#5a86a0'))
    d.line([x0 + w * 0.2, y0 + h * 0.72, x0 + w * 0.6, y0 + h * 0.72], fill=rgb('#9ec0d0'), width=2)
    # green hills in front
    pts = [(x0, y0 + h)]
    for i in range(7):
        pts.append((x0 + w * i / 6, y0 + h * (0.78 + 0.08 * math.sin(i * 1.7 + v))))
    pts.append((x0 + w, y0 + h))
    d.polygon(pts, fill=rgb('#4e7a44'))
    # trees
    for i in range(3 + v % 3):
        tx = x0 + w * (0.08 + 0.84 * r.random())
        ty = y0 + h * (0.7 + 0.12 * r.random())
        s = h * (0.12 + 0.1 * r.random())
        d.polygon([(tx, ty - s * 1.6), (tx + s * 0.55, ty), (tx - s * 0.55, ty)], fill=rgb(r.choice(['#2f5a34', '#3a6a3a', '#284c2c'])))
        d.rectangle([tx - 2, ty, tx + 2, ty + s * 0.3], fill=rgb('#4a3424'))


def paintings():
    im = Image.new('RGB', (S, S), rgb('#2a2a24'))
    d = ImageDraw.Draw(im)
    h = S // 2
    for q in range(4):
        x0, y0 = (q % 2) * h, (q // 2) * h
        landscape(d, x0, y0, h, h, q)
    return im.filter(ImageFilter.GaussianBlur(0.8))


def pictures():
    im = Image.new('RGB', (S, S), rgb('#2a2a24'))
    d = ImageDraw.Draw(im)
    h = S // 2
    # 0: still life — a fruit bowl and a bottle on a dark green ground
    d.rectangle([0, 0, h, h], fill=rgb('#3c4a36'))
    d.rectangle([0, int(h * 0.62), h, h], fill=rgb('#5a3e2a'))
    d.polygon([(h * 0.62, h * 0.2), (h * 0.62, h * 0.0), (h * 1.0, h * 0.0), (h * 1.0, h * 0.62), (h * 0.8, h * 0.62)], fill=rgb('#2c3828'))
    d.rectangle([h * 0.18, h * 0.3, h * 0.28, h * 0.62], fill=rgb('#5a2a1a'))
    d.rectangle([h * 0.21, h * 0.2, h * 0.25, h * 0.3], fill=rgb('#5a2a1a'))
    d.chord([h * 0.36, h * 0.42, h * 0.86, h * 0.78], 0, 180, fill=rgb('#e8e0cc'))
    for (cx, cy, c) in ((0.47, 0.5, '#c83a2a'), (0.58, 0.47, '#e0a030'), (0.69, 0.5, '#c83a2a'), (0.62, 0.42, '#8aa040'), (0.53, 0.43, '#e0a030')):
        d.ellipse([h * cx - 16, h * cy - 16, h * cx + 16, h * cy + 16], fill=rgb(c))
    # 1: white flowers on dark green
    d.rectangle([h, 0, S, h], fill=rgb('#2e4632'))
    r = random.Random(3)
    for k in range(9):
        cx, cy = h + h * (0.2 + 0.6 * r.random()), h * (0.18 + 0.6 * r.random())
        for a in range(5):
            ang = a * 2 * math.pi / 5
            d.ellipse([cx + 16 * math.cos(ang) - 11, cy + 16 * math.sin(ang) - 11, cx + 16 * math.cos(ang) + 11, cy + 16 * math.sin(ang) + 11], fill=rgb('#f2ecdc'))
        d.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], fill=rgb('#e0b040'))
    # 2: botanical print — a green sprig on cream
    d.rectangle([0, h, h, S], fill=rgb('#ece2c8'))
    cx = h * 0.5
    d.line([cx, h + h * 0.85, cx, h + h * 0.15], fill=rgb('#3e6a3a'), width=5)
    for k in range(5):
        y = h + h * (0.25 + k * 0.13)
        for s_ in (-1, 1):
            d.ellipse([cx + s_ * 8 - (46 if s_ < 0 else 0), y - 14, cx + s_ * 8 + (46 if s_ > 0 else 0), y + 14], fill=rgb('#4e7e46'))
    # 3: a sea view
    for k in range(h):
        d.line([h, h + k, S, h + k], fill=mix(rgb('#e8d2a8'), rgb('#9ab4c0'), k / h))
    d.rectangle([h, h + h * 0.6, S, S], fill=rgb('#46708a'))
    d.polygon([(h + h * 0.3, h + h * 0.58), (h + h * 0.42, h + h * 0.3), (h + h * 0.46, h + h * 0.58)], fill=rgb('#f0ead8'))
    return im.filter(ImageFilter.GaussianBlur(0.8))


def books():
    im = Image.new('RGB', (S, S), rgb('#2a180e'))
    d = ImageDraw.Draw(im)
    cols = ['#8a2a2c', '#2f5a5a', '#3a5a3a', '#b08a58', '#7a2226', '#2a4a5a', '#9a6a3a', '#4a6a4a', '#8a3a2a', '#c09a64']
    x = 0
    r = random.Random(13)
    while x < S:
        w = r.randint(22, 40)
        h = r.randint(int(S * 0.74), S - 8)
        c = rgb(r.choice(cols))
        d.rectangle([x, S - h, x + w - 3, S - 1], fill=jit(c, 8))
        d.rectangle([x, S - h, x + 3, S - 1], fill=shade(c, 14))
        for yy in (S - h + 26, S - 40):               # gilt bands on the spine
            d.rectangle([x + 3, yy, x + w - 6, yy + 5], fill=rgb('#caa050'))
        if r.random() < 0.08:                         # the odd gap
            x += r.randint(8, 20)
        x += w
    return im


def signs():
    im = Image.new('RGB', (S, S), rgb('#1a120c'))
    d = ImageDraw.Draw(im)
    h = S // 2
    # top-left: switchboard jack field — walnut board with rows of brass jacks and lamp caps
    d.rectangle([0, 0, h - 1, h - 1], fill=rgb('#4a2e1c'))
    for r_ in range(6):
        for c in range(7):
            x, y = 22 + c * 35, 24 + r_ * 40
            d.ellipse([x - 11, y - 11, x + 11, y + 11], fill=rgb('#d0a850'))
            d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=rgb('#1a120c'))
            if r_ % 2 == 0:
                d.rectangle([x - 6, y + 13, x + 6, y + 18], fill=rgb(rnd.choice(['#e8d8a0', '#c04030', '#e8d8a0', '#30a060'])))
    # top-right: EXIT sign, white on green
    d.rectangle([h, 0, S - 1, h - 1], fill=rgb('#0e4a2a'))
    d.rectangle([h + 16, 70, S - 17, h - 71], fill=rgb('#1f9a52'))
    try:
        f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 58)
    except OSError:
        f = ImageFont.load_default()
    d.text((h + h // 2, h // 2), 'EXIT', fill=(240, 255, 240), font=f, anchor='mm')
    # bottom-left: red cross on white
    d.rectangle([0, h, h - 1, S - 1], fill=rgb('#f2f0ea'))
    c = h // 2
    d.rectangle([c - 30, h + c - 90, c + 30, h + c + 90], fill=rgb('#c0282a'))
    d.rectangle([c - 90, h + c - 30, c + 90, h + c + 30], fill=rgb('#c0282a'))
    # bottom-right: a window at night — deep blue panes, glazing bars
    d.rectangle([h, h, S - 1, S - 1], fill=rgb('#1b2a44'))
    for k in range(40):
        y = h + k * (h // 40)
        d.rectangle([h, y, S - 1, y + h // 40], fill=(24 + k // 3, 38 + k // 2, 66 + k))
    for x in (h + h // 2,):
        d.rectangle([x - 5, h, x + 5, S - 1], fill=rgb('#3a2616'))
    for y in (h + h // 3, h + 2 * h // 3):
        d.rectangle([h, y - 4, S - 1, y + 4], fill=rgb('#3a2616'))
    return im


def boards():
    """Dark tongue-and-groove wainscot boards, vertical, 0.125 m (1 m = 512 px)."""
    im = Image.new('RGB', (S, S), rgb('#2c1a10'))
    d = ImageDraw.Draw(im)
    r = random.Random(12)
    for k in range(8):
        c = jit(rgb(r.choice(['#4e2e1c', '#54321e', '#4a2c1a'])), 3)
        d.rectangle([k * 64 + 3, 0, k * 64 + 60, S], fill=c)
        d.line([k * 64 + 5, 0, k * 64 + 5, S], fill=shade(c, 12), width=2)
    return speckle(im, 4000, 4, 0.6)


def plain(col):
    return lambda: Image.new('RGB', (S, S), rgb(col))


CELLS = [stone, herringbone, checker, clinic, carpet, slate, planks, wall_tiles,
         lambda: plaster('#d4b48c', 10, 2), pictures, paintings, lambda: plaster('#8a9480', 8, 5),
         boards, books, lambda: plaster('#dcc6a2', 7, 9), signs]

atlas = Image.new('RGB', (S * 4, S * 4))
for i, fn in enumerate(CELLS):
    atlas.paste(fn(), ((i % 4) * S, (i // 4) * S))
atlas.save(os.path.join(BUILD, 'albedo.png'))
atlas.save(os.path.join(OUT, 'albedo.jpg'), quality=88)
print('albedo', atlas.size, os.path.getsize(os.path.join(OUT, 'albedo.jpg')), 'bytes')
