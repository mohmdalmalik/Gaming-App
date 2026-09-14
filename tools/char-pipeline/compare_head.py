# Head-shape comparison: a sheet face panel vs a 'face' render, both classified into skin / hair /
# dark features, normalised by head height (hair top -> chin), widths per 5 % band and feature blobs.
#   python3 tools/char-pipeline/compare_head.py front|side ref/panels/face-front.png shots/v5-face-0.png
import sys, numpy as np
from PIL import Image
from scipy import ndimage
def classes(a):
    r, g, b = a[..., 0], a[..., 1], a[..., 2]; lum = (r + g + b) / 3
    bg = (abs(r - g) < 14) & (abs(g - b) < 14) & (lum > 150)
    dark = lum < 60
    hair = (~dark) & (lum < 115) & (r >= g) & (g >= b - 6)
    skin = (r > 165) & (g > 105) & (b > 65) & (r - b > 48) & ~dark
    return dict(bg=bg, dark=dark, hair=hair, skin=skin)
def analyse(path, edge=8):
    a = np.asarray(Image.open(path).convert('RGB')).astype(int)[edge:-edge, edge:-edge]
    c = classes(a); head = c['skin'] | c['hair'] | c['dark']
    hrows = np.where((c['hair'] | c['dark']).sum(1) > 5)[0]; top = hrows[0]
    cx = a.shape[1] // 2
    col = c['skin'][:, cx - 20:cx + 20].sum(1) > 8
    runs = []; s = None
    for i, v in enumerate(col):
        if v and s is None: s = i
        if not v and s is not None: runs.append((s, i - 1)); s = None
    if s is not None: runs.append((s, len(col) - 1))
    chin = runs[-1][1]; Hh = chin - top
    lab, n = ndimage.label(c['dark']); blobs = []
    for i, sl in enumerate(ndimage.find_objects(lab)):
        sz = (lab[sl] == i + 1).sum()
        if sz < 30: continue
        y0, y1, x0, x1 = sl[0].start, sl[0].stop, sl[1].start, sl[1].stop
        if y0 > chin + 5 or (y1 - y0) > 0.5 * Hh: continue
        blobs.append(((y0 + y1) / 2, (x0 + x1) / 2, x1 - x0, y1 - y0))
    return a, c, head, top, chin, Hh, blobs
mode, refp, renp = sys.argv[1], sys.argv[2], sys.argv[3]
R = analyse(refp); S = analyse(renp, edge=2)
def origin(res):
    a, c, head, top, chin, Hh, blobs = res
    if mode == 'front':
        eyes = sorted([b for b in blobs if 0.44 * Hh < b[0] - top < 0.66 * Hh and b[3] > b[2]], key=lambda b: -b[2] * b[3])[:2]
        if len(eyes) == 2: return (eyes[0][1] + eyes[1][1]) / 2
        xs = np.where(head[top + int(Hh * 0.65)])[0]; return (xs[0] + xs[-1]) / 2
    y = top + int(Hh * 0.45); xs = np.where(c['skin'][y])[0]; return xs[-1]      # side: the brow-level forehead
oR, oS = origin(R), origin(S)
print(f'{"band":>5} {"ref[L,R] w":>22} {"render[L,R] w":>22}   (x relative to the ' + ('eye midline' if mode == 'front' else 'forehead') + ', / head height)')
for p in range(0, 101, 5):
    row = []
    for res, o in ((R, oR), (S, oS)):
        a, c, head, top, chin, Hh, blobs = res
        y = min(a.shape[0] - 1, top + int(Hh * p / 100)); xs = np.where(head[y])[0]
        row.append(f'[{(xs[0]-o)/Hh:+.3f},{(xs[-1]-o)/Hh:+.3f}] {((xs[-1]-xs[0]+1)/Hh if len(xs) else 0):.3f}' if len(xs) else '-')
    print(f'{p:4d}% {row[0]:>22} {row[1]:>22}')
for tag, res, o in (('ref', R, oR), ('render', S, oS)):
    a, c, head, top, chin, Hh, blobs = res
    print(tag, 'head px', Hh, 'blobs (cy%, cx, w, h as /Hh):', ' '.join(f'({(cy-top)/Hh*100:.0f}%,{(cx-o)/Hh:+.2f},{w/Hh:.3f},{h/Hh:.3f})' for cy, cx, w, h in sorted(blobs)))
