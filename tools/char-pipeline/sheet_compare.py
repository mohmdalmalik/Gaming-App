# Guest sheet vs renders, side by side at the same scale (one image), plus silhouette numbers.
#   node tools/char-pipeline/preview_glb.mjs --glb assets/characters/marcus.glb --out tools/char-pipeline/shots/mx \
#        --views body@0,body@30,body@90,body@180,face@0,face@30 --bg 7b716a --key left
#   python3 tools/char-pipeline/sheet_compare.py marcus tools/char-pipeline/shots/mx tools/char-pipeline/shots/marcus-vs-sheet.png
# Top row: the six sheet panels (ref/panels-<name>/); bottom row: the matching renders, each scaled so the figure
# is as tall as on the sheet (body views: hair top -> soles; face views: from the known camera, 0.30 H = the
# sheet's head height), bottom- (body) or top- (face) aligned and centred on the figure. Prints silhouette IoU
# and widths per height band for the body views. The sheets' background is a soft gradient with a floor shadow,
# so their figure mask comes from a smooth fitted background (not a flat colour).
import sys, numpy as np
from pathlib import Path
from PIL import Image, ImageDraw
from scipy import ndimage as nd
HERE = Path(__file__).resolve().parent

def bg_fit(a):
    """Fit a smooth (cubic) background colour field to the low-chroma grey pixels, iteratively dropping outliers."""
    Hh, Ww, _ = a.shape; yy, xx = np.mgrid[0:Hh, 0:Ww]; X = xx / Ww; Y = yy / Hh
    A = np.stack([np.ones_like(X), X, Y, X*X, X*Y, Y*Y, Y**3, X**3], -1).reshape(-1, 8)
    px = a.reshape(-1, 3).astype(float); lum = px.mean(1); ch = px[:, 0] - px[:, 2]
    ok = (lum > 85) & (lum < 180) & (ch > 3) & (ch < 35) & (np.abs(px[:, 1] - (px[:, 0] + px[:, 2]) / 2) < 12)
    for _ in range(4):
        coef = np.linalg.lstsq(A[ok], px[ok], rcond=None)[0]; r = np.abs(px - A @ coef).sum(1); ok &= r < 30
    return (A @ coef).reshape(Hh, Ww, 3)

def largest(m, fill=150):
    m = nd.binary_opening(m, iterations=1); lab, n = nd.label(m)
    if not n: return m
    m = lab == (1 + int(np.argmax(nd.sum(m, lab, range(1, n + 1)))))
    holes = nd.binary_fill_holes(m) & ~m; hl, hn = nd.label(holes)
    for i in range(1, hn + 1):
        if (hl == i).sum() < fill: m |= hl == i
    return m

def sheet_mask(a): return largest(np.abs(a - bg_fit(a)).sum(2) > 38)
def render_mask(a):
    bg = np.median(np.concatenate([a[:4].reshape(-1, 3), a[:, :4].reshape(-1, 3), a[:, -4:].reshape(-1, 3)]), axis=0)
    return largest(np.abs(a - bg).sum(2) > 30)

def eyes(a):
    """Centre (y, x) of the two eye ovals: the largest near-black blobs taller than wide in the panel's middle."""
    lum = a.mean(2); d = (lum < 42) & (np.abs(a[..., 0] - a[..., 2]) < 14)
    Hh, Ww = d.shape; d[:int(Hh * 0.2)] = False; d[int(Hh * 0.8):] = False; d[:, :int(Ww * 0.15)] = False; d[:, int(Ww * 0.85):] = False
    lab, n = nd.label(d); c = []
    for i in range(1, n + 1):
        ys, xs = np.where(lab == i)
        if len(ys) > 20 and (np.ptp(ys) + 1) > 1.1 * (np.ptp(xs) + 1): c.append((len(ys), ys.mean(), xs.mean()))
    c = sorted(c)[-2:]
    return (np.mean([q[1] for q in c]), np.mean([q[2] for q in c]))

def bbox(m):
    ys, xs = np.where(m); return ys.min(), ys.max(), xs.min(), xs.max()

# face camera of preview_glb.html: fov 10.5 deg at 4.4 m, 760 css px tall at dpr 2 -> px per metre
FACE_PPM = 1520 / (2 * 4.4 * np.tan(np.radians(10.5 / 2)))
SHEET_HEAD_PPM = 198 / (0.30 * 1.66)        # sheet head close-ups: hair top -> chin = 198 px = 0.30 H

def place(ref, ren, kind):
    """Scale + position the render into a canvas the size of the sheet panel."""
    A = np.asarray(ref.convert('RGB')).astype(float); B = np.asarray(ren.convert('RGB')).astype(float)
    ma, mb = sheet_mask(A), render_mask(B)
    ya0, ya1, xa0, xa1 = bbox(ma); yb0, yb1, xb0, xb1 = bbox(mb)
    if kind == 'body':
        s = (ya1 - ya0 + 1) / (yb1 - yb0 + 1)
    else:
        s = SHEET_HEAD_PPM / FACE_PPM
    im = ren.convert('RGB').resize((max(1, int(round(ren.width * s))), max(1, int(round(ren.height * s)))), Image.LANCZOS)
    mbs = np.asarray(Image.fromarray(mb.astype(np.uint8) * 255).resize(im.size, Image.BILINEAR)) > 127
    y0, y1, x0, x1 = bbox(mbs)
    if kind == 'body':
        # bottom-align, centre on the silhouette's centroid
        cxa = np.where(ma)[1].mean(); cxb = np.where(mbs)[1].mean()
        dx = int(round(cxa - cxb)); dy = int(round(ya1 - y1))
    else:
        # align the eyes (the sheet's hair top is cropped by its frame; the head there is also turned ~9 deg)
        (ea_y, ea_x), (eb_y, eb_x) = eyes(A), eyes(np.asarray(im).astype(float))
        dx = int(round(ea_x - eb_x)); dy = int(round(ea_y - eb_y))
    canvas = Image.new('RGB', ref.size, tuple(int(c) for c in np.median(A[:6].reshape(-1, 3), axis=0)))
    canvas.paste(im, (dx, dy))
    return canvas, ma

def body_numbers(name, ref, canvas):
    A = sheet_mask(np.asarray(ref.convert('RGB')).astype(float)); B = render_mask(np.asarray(canvas).astype(float))
    iou = (A & B).sum() / max(1, (A | B).sum())
    y0, y1, _, _ = bbox(A); Hp = y1 - y0 + 1; out = []
    for p in range(4, 100, 8):
        y = y0 + int(Hp * p / 100); wa = np.where(A[y])[0]; wb = np.where(B[y])[0]
        out.append(f'{p}%:{(wb[-1]-wb[0]+1)/Hp if len(wb) else 0:.3f}/{(wa[-1]-wa[0]+1)/Hp if len(wa) else 0:.3f}')
    print(f'{name:10s} IoU={iou:.3f}  width render/sheet ' + ' '.join(out))

if __name__ == '__main__':
    guest, prefix, out = sys.argv[1], sys.argv[2], sys.argv[3]
    P = HERE / 'ref' / f'panels-{guest}'
    views = [('front', 'body-0', 'body', 'FRONT'), ('tq', 'body-30', 'body', 'THREE-QUARTER'), ('side', 'body-90', 'body', 'SIDE'),
             ('back', 'body-180', 'body', 'BACK'), ('face-front', 'face-0', 'face', 'HEAD FRONT'), ('face-tq', 'face-30', 'face', 'HEAD 3/4')]
    tiles = []
    for pan, ren, kind, label in views:
        ref = Image.open(P / f'{pan}.png').convert('RGB'); rim = Image.open(f'{prefix}-{ren}.png')
        cv, _ = place(ref, rim, kind)
        if kind == 'body': body_numbers(pan, ref, cv)
        k = 2 if kind == 'face' else 1
        tiles.append((ref.resize((ref.width * k, ref.height * k), Image.LANCZOS), cv.resize((cv.width * k, cv.height * k), Image.LANCZOS), label))
    W = sum(t[0].width for t in tiles) + 10 * (len(tiles) + 1); Hh = max(t[0].height for t in tiles)
    img = Image.new('RGB', (W, 2 * Hh + 90), (40, 40, 44)); d = ImageDraw.Draw(img); x = 10
    for a, b, label in tiles:
        img.paste(a, (x, 30)); img.paste(b, (x, 60 + Hh))
        d.text((x + 4, 8), f'SHEET  {label}', fill=(235, 235, 235)); d.text((x + 4, 38 + Hh), f'RENDER  {label}', fill=(235, 235, 235))
        x += a.width + 10
    img.save(out); print('->', out)
