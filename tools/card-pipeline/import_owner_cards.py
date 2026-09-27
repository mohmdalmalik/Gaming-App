# Import the owner's finished card designs (tools/card-pipeline/owner/<type>.jpg, full cards with frame
# and name on a light backdrop) into the game: crop each to the card's own edge (the gold border,
# leaving out the backdrop and drop shadow), square the rounded corners onto the dark card colour
# so the page's rounded clip shows no light fringe, and save
#   assets/cards/face/<type>.jpg   512 x 768 card faces (the hand sheet, encounters, prompts)
#   assets/cards/back.jpg          the card back (face-down cards), 256 x 384
#   python3 tools/card-pipeline/import_owner_cards.py
from pathlib import Path
from PIL import Image
import numpy as np
HERE = Path(__file__).resolve().parent; REPO = HERE.parents[1]
OUT = REPO / 'assets' / 'cards' / 'face'; OUT.mkdir(parents=True, exist_ok=True)

def card_box(a):
    bg = np.median(np.concatenate([a[:8].reshape(-1, 3), a[-8:].reshape(-1, 3)]), axis=0)
    m = np.abs(a - bg).sum(2) > 170                    # border + card; the soft shadow stays below this
    ys = np.where(m.sum(1) > a.shape[1] * 0.4)[0]; xs = np.where(m.sum(0) > a.shape[0] * 0.4)[0]
    return xs[0], ys[0], xs[-1] + 1, ys[-1] + 1

for f in sorted((HERE / 'owner').glob('*.jpg')):
    im = Image.open(f).convert('RGB'); a = np.asarray(im).astype(int)
    x0, y0, x1, y1 = card_box(a)
    card = im.crop((x0, y0, x1, y1))
    # corners: the backdrop shows in the rounded corners; fill them with the gold rim colour
    c = np.asarray(card).copy(); h, w = c.shape[:2]; r = int(w * 0.045)
    rim = c[h // 2, 3].copy()
    for (cx, cy) in ((r, r), (w - r - 1, r), (r, h - r - 1), (w - r - 1, h - r - 1)):
        ys, xs = np.ogrid[:h, :w]
        corner = ((xs < r) if cx == r else (xs > w - r - 1)) & ((ys < r) if cy == r else (ys > h - r - 1))
        outside = corner & ((xs - cx) ** 2 + (ys - cy) ** 2 > r * r)
        c[outside] = rim
    card = Image.fromarray(c)
    name = f.stem
    if name == 'back':
        card.resize((256, 384), Image.LANCZOS).save(REPO / 'assets' / 'cards' / 'back.jpg', quality=88)
    else:
        card.resize((512, 768), Image.LANCZOS).save(OUT / f'{name}.jpg', quality=88)
    print(f'{name}: card {x1 - x0}x{y1 - y0} at ({x0},{y0})')
