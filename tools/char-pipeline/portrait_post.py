# Post-process the raw portrait renders into the interface portraits (called by portrait.mjs).
#   python3 portrait_post.py <raw-normal.png> <raw-possessed.png> '[[xL,yL],[xR,yR]]' <portraits dir> <name> <shots dir> [--normal]
# normal:    crop to a 3:4 bust, 576x768, JPEG. Written to <portraits dir>/<name>.jpg ONLY with --normal;
#            otherwise to <shots dir>/portrait-check-<name>.jpg (to check the line-up, assets untouched).
# possessed: the SAME crop of the possessed render (red eyes, transparent backdrop) laid on the private
#            plum-crimson plate — a soft vertical gradient with a gentle vignette. No colour wash and
#            nothing painted on the face: the guest is exactly the normal one apart from the eyes.
#            -> <portraits dir>/<name>-possessed.jpg. The public strip never uses this file.
import sys, json, os
from PIL import Image, ImageChops

args = [a for a in sys.argv[1:] if not a.startswith('--')]
write_normal = '--normal' in sys.argv[1:]
src, src_p, eyes_json, out_dir, name, shots = args[:6]
eyes = json.loads(eyes_json)
im = Image.open(src).convert('RGB')
W, H = im.size

# --- framing: a 3:4 window centred on the eyes, head + shoulders ------------------------------
ex = (eyes[0][0] + eyes[1][0]) / 2; ey = (eyes[0][1] + eyes[1][1]) / 2
eye_gap = abs(eyes[1][0] - eyes[0][0])
cw = min(W, int(eye_gap * 3.5)); ch = min(H, int(cw * 4 / 3))
eye_frac = 0.37
# The women's hairstyles are their silhouette: frame the whole hairdo (eyes a little lower, zoomed out
# just enough that the top of the hair clears the frame). The men keep the tighter crop the owner approved.
if name in ('eleanor', 'clara', 'beatrice'):
    a = im.load(); bg = a[2, 2]
    def is_bg(p): return sum(abs(p[i] - bg[i]) for i in range(3)) < 24
    band = range(int(ex - eye_gap * 1.6), int(ex + eye_gap * 1.6), 3)
    top = next((y for y in range(0, int(ey)) if any(not is_bg(a[x, y]) for x in band if 0 <= x < W)), 0)
    eye_frac = 0.46
    need = (ey - top) / (eye_frac - 0.03)            # frame height that leaves a 3% margin above the hair
    if need > ch: ch = min(H, int(need)); cw = min(W, int(ch * 3 / 4))
cx0 = int(ex - cw / 2); cy0 = int(ey - ch * eye_frac)
cx0 = max(0, min(W - cw, cx0)); cy0 = max(0, min(H - ch, cy0))
box = (cx0, cy0, cx0 + cw, cy0 + ch)
bust = im.crop(box).resize((576, 768), Image.LANCZOS)
normal_path = f'{out_dir}/{name}.jpg' if write_normal else f'{shots}/portrait-check-{name}.jpg'
bust.save(normal_path, quality=90)
print(f'portrait normal: crop={box} -> {normal_path}')

# --- possessed variant: the same crop, on the private plum-crimson plate --------------------------
TOP, BOTTOM = (0x2b, 0x10, 0x18), (0x16, 0x09, 0x10)   # POSSESSED_COLORS.plateTop / plateBottom


def plate(w, h):
    """Vertical gradient top -> bottom, with a gentle vignette (corners about 18% darker)."""
    col = Image.new('RGB', (1, 256))
    for y in range(256):
        t = y / 255
        col.putpixel((0, y), tuple(round(TOP[i] + (BOTTOM[i] - TOP[i]) * t) for i in range(3)))
    grad = col.resize((w, h), Image.BILINEAR)
    vig = Image.radial_gradient('L').resize((w, h), Image.BILINEAR)   # 0 at the centre .. 255 at the rim
    vig = vig.point(lambda v: 255 - int(min(1.0, max(0.0, (v - 110) / 145)) ** 1.6 * 46))
    return ImageChops.multiply(grad, Image.merge('RGB', (vig, vig, vig)))


pim = Image.open(src_p).convert('RGBA')
if pim.size != im.size:
    sys.exit(f'possessed render is {pim.size}, the normal one {im.size}: not the same frame')
guest = pim.crop(box)
p = plate(cw, ch).convert('RGBA')
p.alpha_composite(guest)
p = p.convert('RGB').resize((576, 768), Image.LANCZOS)
p.save(f'{out_dir}/{name}-possessed.jpg', quality=90)

# Check: inside the guest (fully opaque), only the eyes may differ from the normal render.
a = guest.getchannel('A').point(lambda v: 255 if v == 255 else 0)
diff = ImageChops.difference(im.crop(box), guest.convert('RGB')).convert('L').point(lambda v: 255 if v > 24 else 0)
diff = ImageChops.multiply(diff, a)
bb = diff.getbbox()
sx = 576 / cw
bb = tuple(round(v * sx) for v in bb) if bb else None
size = os.path.getsize(f'{out_dir}/{name}-possessed.jpg')
print(f'portrait possessed: changed pixels on the guest within {bb} (576x768 px) -> {out_dir}/{name}-possessed.jpg ({size // 1024} KB)')
