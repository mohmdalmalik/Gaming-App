# Silhouette comparison: reference panel vs a render of the same view, at equal displayed height.
#   python3 tools/char-pipeline/compare.py ref/panels/front.png shots/v3-body-0.png shots/cmp-front.png
# Prints IoU and the width of each silhouette in height bands (as a fraction of height), writes an
# overlay (reference = red, render = blue, overlap = purple) side by side with both masks.
import sys, numpy as np
from PIL import Image
def mask_of(path, edge=10, thr=60):
    a = np.asarray(Image.open(path).convert('RGB')).astype(int)
    if edge: a = a[edge:-edge, edge:-edge]
    bg = np.median(np.concatenate([a[:6].reshape(-1,3), a[-6:].reshape(-1,3), a[:, :6].reshape(-1,3), a[:, -6:].reshape(-1,3)]), axis=0)
    m = np.abs(a - bg).sum(axis=2) > thr
    rows = np.where(m.sum(axis=1) >= 3)[0]; cols = np.where(m.sum(axis=0) >= 3)[0]
    return m[rows[0]:rows[-1]+1, cols[0]:cols[-1]+1]
def norm(m, H=600):
    im = Image.fromarray((m*255).astype(np.uint8)); w = int(round(im.width * H / im.height))
    return np.asarray(im.resize((w, H), Image.BILINEAR)) > 127
def widths(m, bands):
    H = m.shape[0]; out = []
    for p in bands:
        y = min(H-1, int(H*p/100)); xs = np.where(m[y])[0]; out.append((xs[-1]-xs[0]+1)/H if len(xs) else 0.0)
    return out
ref, ren, out = sys.argv[1], sys.argv[2], sys.argv[3]
A, B = norm(mask_of(ref, edge=14)), norm(mask_of(ren, edge=2))
W = max(A.shape[1], B.shape[1]); H = A.shape[0]
def centre(m):
    c = np.zeros((H, W), bool); x0 = (W - m.shape[1]) // 2; c[:, x0:x0+m.shape[1]] = m; return c
A, B = centre(A), centre(B)
iou = (A & B).sum() / max(1, (A | B).sum())
bands = list(range(2, 100, 4))
wa, wb = widths(A, bands), widths(B, bands)
print(f'IoU={iou:.3f}  (height-normalised, bottom-aligned, centred)')
print('band%  ref_w  render_w  ratio')
for p, a, b in zip(bands, wa, wb): print(f'{p:4d}   {a:.3f}   {b:.3f}   {(b/a if a else 0):.2f}')
rgb = np.zeros((H, W, 3), np.uint8); rgb[..., :] = 235
rgb[A & ~B] = (220, 60, 60); rgb[B & ~A] = (60, 90, 220); rgb[A & B] = (140, 60, 160)
Image.fromarray(rgb).save(out); print('overlay ->', out)
