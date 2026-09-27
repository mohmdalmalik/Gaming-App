# Lock Pick has no owner design yet, so its card face is assembled in the owner's style from the owner's
# own parts: the black-and-gold frame of the Espresso card (its interior repainted with that card's own
# background tones), the existing Lock Pick illustration lifted off its green backdrop, and the title
# spelled from letters cut out of the owner's card titles (L from LANTERN, O and P from POSSESSION, C and
# I from BARRICADE/KNIFE, K from KNIFE), so the lettering matches exactly.
#   python3 tools/card-pipeline/make_lockpick_face.py   -> assets/cards/face/lockPick.jpg
from pathlib import Path
from PIL import Image, ImageFilter
import numpy as np
HERE = Path(__file__).resolve().parent; REPO = HERE.parents[1]; O = HERE / 'owner'

def card(n):
    im = Image.open(O / f'{n}.jpg').convert('RGB'); a = np.asarray(im).astype(int)
    bg = np.median(np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3)]), axis=0)
    m = np.abs(a - bg).sum(2) > 170; ys = np.where(m.sum(1) > a.shape[1] * 0.4)[0]; xs = np.where(m.sum(0) > a.shape[0] * 0.4)[0]
    return im.crop((xs[0], ys[0], xs[-1] + 1, ys[-1] + 1)).resize((898, 1345), Image.LANCZOS)

def letters(n):
    c = np.asarray(card(n)).astype(int); h, w = c.shape[:2]
    cream = (c[..., 0] > 170) & (c[..., 1] > 150) & (c[..., 2] > 110) & (np.abs(c[..., 0] - c[..., 2]) < 90)
    y0, y1, x0 = int(h * 0.83), int(h * 0.93), int(w * 0.08)
    band = cream[y0:y1, x0:int(w * 0.92)]; cols = band.sum(0) > 0
    segs, inn = [], False
    for x, v in enumerate(cols):
        if v and not inn: s = x; inn = True
        if not v and inn: segs.append((s, x)); inn = False
    img = card(n)
    return [img.crop((x0 + a - 3, y0, x0 + b + 3, y1)) for a, b in segs], [segs[i + 1][0] - segs[i][1] for i in range(len(segs) - 1)]

L = {}
for n, word in (('lantern', 'LANTERN'), ('knife', 'KNIFE'), ('possession', 'POSSESSION'), ('barricade', 'BARRICADE')):
    gl, gaps = letters(n)
    for ch, g in zip(word, gl): L.setdefault(ch, g)
    if n == 'lantern': GAP = int(np.median(gaps))

base = card('espresso'); A = np.asarray(base).astype(float); h, w = A.shape[:2]
# repaint the interior (illustration + title) with the card's own background: each row takes the tone of
# the clean strip just inside the frame, plus the soft warm glow the owner's cards have behind the object
x0, x1, y0, y1 = int(w * 0.075), int(w * 0.925), int(h * 0.075), int(h * 0.948)   # inside the inner gold line (0.957 h)
strip = np.median(A[:, int(w * 0.05):int(w * 0.07)], axis=1)          # the clean band inside the frame's side line
low = int(h * 0.915)                                                    # below the title the corner ornaments sit in that band:
strip[low:] = np.median(A[low:, int(w * 0.2):int(w * 0.8)], axis=1)     # take the tone from the middle of the card there
yy, xx = np.mgrid[0:h, 0:w]
glow = np.exp(-(((xx - w / 2) / (w * 0.32)) ** 2 + ((yy - h * 0.42) / (h * 0.26)) ** 2))[..., None] * np.array([22, 15, 6])
fill = strip[:, None, :] + glow
A[y0:y1, x0:x1] = fill[y0:y1, x0:x1]
face = Image.fromarray(np.clip(A, 0, 255).astype(np.uint8))

# the illustration, lifted off its dark green backdrop (backdrop: green-leaning and dark)
art = Image.open(REPO / 'assets' / 'cards' / 'lockPick.jpg').convert('RGB'); a = np.asarray(art).astype(float)
r, g, b = a[..., 0], a[..., 1], a[..., 2]; v = a.max(2)
bgness = np.clip(((g - r) + 6) / 14, 0, 1) * np.clip((120 - v) / 50, 0, 1)
alpha = Image.fromarray(((1 - bgness) * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(1.2))
art.putalpha(alpha); bb = alpha.point(lambda p: 255 if p > 90 else 0).getbbox(); art = art.crop(bb)
s = min(w * 0.70 / art.width, h * 0.62 / art.height); art = art.resize((int(art.width * s), int(art.height * s)), Image.LANCZOS)
face.paste(art, ((w - art.width) // 2, int(h * 0.44 - art.height / 2)), art)

# the title from the owner's own letters, centred on the same baseline band
word = 'LOCK PICK'; step = GAP - 6; space = int(GAP * 2.6)
glyphs = [None if c == ' ' else L[c] for c in word]
tw = sum(g.width + step for g in glyphs if g) - step + space - step
x = (w - tw) // 2; ty = int(h * 0.83)
for g in glyphs:
    if g is None: x += space - step; continue
    ga = np.asarray(g).astype(int)
    m = Image.fromarray((np.clip((ga.mean(2) - 60) / 120, 0, 1) * 255).astype(np.uint8))     # cream on black -> alpha
    face.paste(g, (x, ty), m); x += g.width + step
face = face.resize((512, 768), Image.LANCZOS)
face.save(REPO / 'assets' / 'cards' / 'face' / 'lockPick.jpg', quality=88)
print('lockPick face written')
