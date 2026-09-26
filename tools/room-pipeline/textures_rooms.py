# The ONE albedo texture every room shares (flat, stylised — the light is baked separately):
# a 4 x 4 grid of 512 px cells, 2048 px in all. Cell index = row * 4 + col (row 0 at the top).
#
#   0 cream stone tiles (2 m repeat)     1 herringbone parquet (2 m)     2 black & white checker (2 m)
#   3 small white clinic tiles (2 m)     4 burgundy hotel carpet (2 m)    5 service linoleum (2 m)
#   6 wide wooden planks (2 m)           7 square rug, burgundy + gold    8 runner rug, burgundy + gold
#   9 square rug, bottle green + gold   10 four paintings (quadrants)    11 damask wallpaper, burgundy
#  12 striped wallpaper, green          13 book spines (a shelf row)     14 glazed white wall tiles (1 m)
#  15 signs, quadrants: switchboard jack field | EXIT | red cross | night window
#
# Run: python3 tools/room-pipeline/textures_rooms.py
#   -> tools/room-pipeline/build/albedo.png  and  assets/models/rooms/albedo.jpg (what the game loads)
import os, random, math
from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
BUILD = os.path.join(HERE, 'build')
LOBBY_BUILD = os.path.join(REPO, 'tools', 'lobby-pipeline', 'build')
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


def cell():
    return Image.new('RGB', (S, S))


def stone():
    src = Image.open(os.path.join(LOBBY_BUILD, 'floor.png')).convert('RGB')     # 4 m, 8 x 8 tiles
    return src.crop((0, 0, src.width // 2, src.height // 2)).resize((S, S), Image.LANCZOS)   # 2 m


def parquet():
    tones = [rgb(c) for c in ('#8a5a34', '#7d5030', '#93633a', '#845632', '#9a6a3e')]
    # herringbone: diagonal staggered planks drawn on a 2x canvas, then cropped (2 m = 512 px)
    big = Image.new('RGB', (S * 2, S * 2), rgb('#4a2c18'))
    d = ImageDraw.Draw(big)
    pl, pw = 96, 24
    for row in range(-4, 40):
        for k in range(-4, 24):
            x = k * pl * 2 + (row % 2) * pl
            y = row * pw * 2
            c1 = jit(tones[(row * 3 + k) % len(tones)], 8)
            c2 = jit(tones[(row * 5 + k * 2 + 1) % len(tones)], 8)
            d.polygon([(x, y), (x + pl, y + pl), (x + pl - pw, y + pl + pw), (x - pw, y + pw)], fill=c1, outline=rgb('#3e2414'))
            d.polygon([(x + pl, y + pl), (x + 2 * pl, y), (x + 2 * pl + pw, y + pw), (x + pl + pw, y + pl + pw)], fill=c2, outline=rgb('#3e2414'))
    return big.crop((S // 2, S // 2, S // 2 + S, S // 2 + S)).filter(ImageFilter.GaussianBlur(0.5))


def checker():
    im = Image.new('RGB', (S, S))
    d = ImageDraw.Draw(im)
    n = 8                                             # 0.25 m tiles
    t = S // n
    for i in range(n):
        for j in range(n):
            c = jit(rgb('#e8e2d4') if (i + j) % 2 == 0 else rgb('#23211f'), 4)
            d.rectangle([i * t, j * t, i * t + t - 1, j * t + t - 1], fill=c)
            d.rectangle([i * t, j * t, i * t + t - 1, j * t + t - 1], outline=shade(c, -18), width=2)
    return im.filter(ImageFilter.GaussianBlur(0.5))


def clinic():
    im = Image.new('RGB', (S, S), rgb('#b9c2c0'))
    d = ImageDraw.Draw(im)
    n = 16
    t = S // n
    for i in range(n):
        for j in range(n):
            c = jit(rgb('#eef2f0') if rnd.random() > 0.08 else rgb('#d7e6e2'), 3)
            d.rectangle([i * t + 1, j * t + 1, i * t + t - 2, j * t + t - 2], fill=c)
    return im.filter(ImageFilter.GaussianBlur(0.4))


def carpet():
    im = Image.new('RGB', (S, S), rgb('#5c1a22'))
    d = ImageDraw.Draw(im)
    step = 64
    for i in range(0, S, step):
        for j in range(0, S, step):
            cx, cy = i + step // 2, j + step // 2
            d.polygon([(cx, cy - 12), (cx + 12, cy), (cx, cy + 12), (cx - 12, cy)], outline=rgb('#a47a3c'), width=2)
            d.ellipse([cx - 3, cy - 3, cx + 3, cy + 3], fill=rgb('#7a2830'))
            d.point([(i, j)], fill=rgb('#a47a3c'))
    px = im.load()
    for _ in range(9000):
        x, y = rnd.randrange(S), rnd.randrange(S)
        px[x, y] = jit(px[x, y], 10)
    return im.filter(ImageFilter.GaussianBlur(0.7))


def linoleum():
    im = Image.new('RGB', (S, S), rgb('#6d7466'))
    d = ImageDraw.Draw(im)
    n = 4
    t = S // n
    for i in range(n):
        for j in range(n):
            c = jit(rgb('#737b6b') if (i + j) % 2 == 0 else rgb('#676f60'), 4)
            d.rectangle([i * t + 1, j * t + 1, i * t + t - 2, j * t + t - 2], fill=c)
    px = im.load()
    for _ in range(14000):
        x, y = rnd.randrange(S), rnd.randrange(S)
        px[x, y] = jit(px[x, y], 12)
    # a few scuffs
    for _ in range(14):
        x, y = rnd.randrange(S), rnd.randrange(S)
        d.line([x, y, x + rnd.randint(-60, 60), y + rnd.randint(-20, 20)], fill=rgb('#5a6154'), width=2)
    return im.filter(ImageFilter.GaussianBlur(0.8))


def planks():
    im = Image.new('RGB', (S, S), rgb('#3c2616'))
    d = ImageDraw.Draw(im)
    w = S // 8                                        # 0.25 m boards
    for k in range(8):
        x0 = k * w
        y = -rnd.randint(0, S)
        while y < S:
            L = rnd.randint(S // 2, S)
            c = jit(rgb(rnd.choice(['#6e4a2c', '#65432a', '#76502f', '#5f3f26'])), 6)
            d.rectangle([x0 + 1, y + 1, x0 + w - 2, y + L - 2], fill=c)
            for _ in range(5):                        # grain
                gx = x0 + rnd.randint(4, w - 5)
                d.line([gx, y + 4, gx + rnd.randint(-3, 3), y + L - 4], fill=shade(c, -10), width=1)
            y += L
    return im.filter(ImageFilter.GaussianBlur(0.6))


def rug_square(field, deep, gold):
    im = Image.new('RGB', (S, S), rgb(deep))
    d = ImageDraw.Draw(im)
    b = 26
    d.rectangle([b, b, S - 1 - b, S - 1 - b], outline=rgb(gold), width=6)
    d.rectangle([b + 6, b + 6, S - 1 - b - 6, S - 1 - b - 6], fill=rgb(field))
    b2 = b + 34
    d.rectangle([b2, b2, S - 1 - b2, S - 1 - b2], outline=rgb(gold), width=3)
    for cx in (b2, S - 1 - b2):
        for cy in (b2, S - 1 - b2):
            d.rectangle([cx - 7, cy - 7, cx + 7, cy + 7], fill=rgb(gold))
    c = S // 2
    d.polygon([(c, c - 70), (c + 70, c), (c, c + 70), (c - 70, c)], outline=rgb(gold), width=3)
    d.polygon([(c, c - 34), (c + 34, c), (c, c + 34), (c - 34, c)], fill=shade(rgb(field), 12))
    px = im.load()
    for _ in range(12000):
        x, y = rnd.randrange(S), rnd.randrange(S)
        px[x, y] = jit(px[x, y], 7)
    return im.filter(ImageFilter.GaussianBlur(0.6))


def rug_runner():
    """Mapped onto long runners (about 1.2 m x 4-6 m): the long axis is V, so borders along it are
    drawn thinner to look even once stretched."""
    im = Image.new('RGB', (S, S), rgb('#44121a'))
    d = ImageDraw.Draw(im)
    bx, by = 40, 9
    d.rectangle([bx, by, S - 1 - bx, S - 1 - by], outline=rgb('#c09650'), width=0)
    d.rectangle([bx, by, bx + 8, S - 1 - by], fill=rgb('#c09650'))
    d.rectangle([S - 1 - bx - 8, by, S - 1 - bx, S - 1 - by], fill=rgb('#c09650'))
    d.rectangle([bx, by, S - 1 - bx, by + 2], fill=rgb('#c09650'))
    d.rectangle([bx, S - 1 - by - 2, S - 1 - bx, S - 1 - by], fill=rgb('#c09650'))
    d.rectangle([bx + 8, by + 3, S - 1 - bx - 8, S - 1 - by - 3], fill=rgb('#621c24'))
    ix = bx + 56
    d.rectangle([ix, by + 12, ix + 4, S - 1 - by - 12], fill=rgb('#c09650'))
    d.rectangle([S - 1 - ix - 4, by + 12, S - 1 - ix, S - 1 - by - 12], fill=rgb('#c09650'))
    for y in range(40, S - 20, 64):                    # a row of small lozenges down the middle
        c = S // 2
        d.polygon([(c, y - 10), (c + 40, y), (c, y + 10), (c - 40, y)], outline=rgb('#b08848'), width=2)
    px = im.load()
    for _ in range(12000):
        x, y = rnd.randrange(S), rnd.randrange(S)
        px[x, y] = jit(px[x, y], 7)
    return im.filter(ImageFilter.GaussianBlur(0.6))


def paintings():
    src = Image.open(os.path.join(LOBBY_BUILD, 'art.png')).convert('RGB')
    return src.resize((S, S), Image.LANCZOS)


def damask(bg, fg):
    im = Image.new('RGB', (S, S), rgb(bg))
    d = ImageDraw.Draw(im)
    step = 128                                        # 1 m = 512 px -> a motif every 0.25 m
    for i in range(0, S + step, step):
        for j in range(0, S + step, step):
            for (cx, cy) in ((i, j), (i + step // 2, j + step // 2)):
                d.ellipse([cx - 18, cy - 30, cx + 18, cy + 30], outline=rgb(fg), width=3)
                d.polygon([(cx, cy - 22), (cx + 10, cy), (cx, cy + 22), (cx - 10, cy)], fill=rgb(fg))
                d.line([cx - 26, cy, cx + 26, cy], fill=rgb(fg), width=2)
    px = im.load()
    for _ in range(8000):
        x, y = rnd.randrange(S), rnd.randrange(S)
        px[x, y] = jit(px[x, y], 5)
    return im.filter(ImageFilter.GaussianBlur(0.8))


def stripes():
    im = Image.new('RGB', (S, S), rgb('#2f4a3a'))
    d = ImageDraw.Draw(im)
    for x in range(0, S, 64):
        d.rectangle([x, 0, x + 26, S], fill=rgb('#35523f'))
        d.rectangle([x + 30, 0, x + 32, S], fill=rgb('#a88a4c'))
    return im.filter(ImageFilter.GaussianBlur(0.6))


def books():
    im = Image.new('RGB', (S, S), rgb('#1c120b'))
    d = ImageDraw.Draw(im)
    cols = ['#6b1f26', '#2f4a5c', '#3d5a36', '#7a5a2a', '#5a2a4a', '#2a2a32', '#8a3a24', '#4a3a24', '#285048', '#7a6a48']
    x = 0
    while x < S:
        w = rnd.randint(10, 24)
        h = rnd.randint(int(S * 0.72), S - 6)
        c = rgb(rnd.choice(cols))
        d.rectangle([x, S - h, x + w - 2, S - 1], fill=jit(c, 10))
        for yy in (S - h + 16, S - 22):               # gilt bands on the spine
            d.rectangle([x + 1, yy, x + w - 3, yy + 3], fill=rgb('#b8924a'))
        if rnd.random() < 0.06:                       # the odd leaning gap
            x += rnd.randint(6, 16)
        x += w
    return im


def wall_tiles():
    im = Image.new('RGB', (S, S), rgb('#b8bcb4'))
    d = ImageDraw.Draw(im)
    n = 8                                             # 1 m = 512 px -> 12.5 cm tiles
    t = S // n
    for i in range(n):
        for j in range(n):
            c = jit(rgb('#f0efe8'), 3)
            d.rectangle([i * t + 2, j * t + 2, i * t + t - 3, j * t + t - 3], fill=c)
            d.line([i * t + 4, j * t + 4, i * t + t - 8, j * t + 4], fill=(255, 255, 252), width=2)
    return im.filter(ImageFilter.GaussianBlur(0.5))


def signs():
    im = Image.new('RGB', (S, S), rgb('#1a120c'))
    d = ImageDraw.Draw(im)
    h = S // 2
    # top-left: switchboard jack field — walnut board with rows of brass jacks and lamp caps
    d.rectangle([0, 0, h - 1, h - 1], fill=rgb('#4a2e1c'))
    for r in range(8):
        for c in range(9):
            x, y = 18 + c * 27, 20 + r * 29
            d.ellipse([x - 7, y - 7, x + 7, y + 7], fill=rgb('#c9a24e'))
            d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=rgb('#1a120c'))
            if r % 2 == 0:
                d.rectangle([x - 5, y + 9, x + 5, y + 13], fill=rgb(rnd.choice(['#e8d8a0', '#c04030', '#e8d8a0', '#30a060'])))
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
    # bottom-right: a window at night — deep blue panes, a moon glow, glazing bars
    d.rectangle([h, h, S - 1, S - 1], fill=rgb('#1b2a44'))
    for k in range(40):
        y = h + k * (h // 40)
        d.rectangle([h, y, S - 1, y + h // 40], fill=(27 + k // 3, 42 + k // 2, 68 + k))
    d.ellipse([S - 90, h + 30, S - 40, h + 80], fill=rgb('#e8e2c0'))
    for x in (h + h // 3, h + 2 * h // 3):
        d.rectangle([x - 4, h, x + 4, S - 1], fill=rgb('#2a1c12'))
    d.rectangle([h, h + h // 2 - 4, S - 1, h + h // 2 + 4], fill=rgb('#2a1c12'))
    return im


CELLS = [stone, parquet, checker, clinic, carpet, linoleum, planks,
         lambda: rug_square('#621c24', '#44121a', '#c09650'), rug_runner,
         lambda: rug_square('#23422f', '#16291d', '#c09650'), paintings,
         lambda: damask('#5a1c24', '#6e2a30'), stripes, books, wall_tiles, signs]

atlas = Image.new('RGB', (S * 4, S * 4))
for i, fn in enumerate(CELLS):
    atlas.paste(fn(), ((i % 4) * S, (i // 4) * S))
atlas.save(os.path.join(BUILD, 'albedo.png'))
atlas.save(os.path.join(OUT, 'albedo.jpg'), quality=88)
print('albedo', atlas.size, os.path.getsize(os.path.join(OUT, 'albedo.jpg')), 'bytes')
