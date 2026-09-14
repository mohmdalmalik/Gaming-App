# Post-process the raw portrait render into the two interface portraits.
#   python3 portrait_post.py shots/portrait-raw.png '[[xL,yL],[xR,yR]]' assets/portraits
# normal:    crop to a 3:4 bust, 576x768, JPEG
# possessed: the same crop with a cold violet wash, a faint vignette and one altered "weird" eye
#            (red iris, slit pupil, violet ring) drawn over the RIGHT eye as rendered — the private
#            possessed tell. The public strip never uses this file.
import sys, json, math
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance, ImageOps

src, eyes_json, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
eyes = json.loads(eyes_json)
im = Image.open(src).convert('RGB')
W, H = im.size

# --- framing: a 3:4 window centred on the eyes, head + shoulders ------------------------------
ex = (eyes[0][0] + eyes[1][0]) / 2; ey = (eyes[0][1] + eyes[1][1]) / 2
eye_gap = abs(eyes[1][0] - eyes[0][0])
cw = min(W, int(eye_gap * 3.5)); ch = min(H, int(cw * 4 / 3))
cx0 = int(ex - cw / 2); cy0 = int(ey - ch * 0.37)
cx0 = max(0, min(W - cw, cx0)); cy0 = max(0, min(H - ch, cy0))
box = (cx0, cy0, cx0 + cw, cy0 + ch)
bust = im.crop(box).resize((576, 768), Image.LANCZOS)
bust.save(f'{out_dir}/victor.jpg', quality=90)
print(f'portrait normal: crop={box} -> {out_dir}/victor.jpg')

# --- possessed variant ----------------------------------------------------------------------
p = bust.copy()
# cold, slightly desaturated wash shifted toward violet
p = ImageEnhance.Color(p).enhance(0.72)
p = ImageEnhance.Brightness(p).enhance(0.9)
r, g, b = p.split()
r = r.point(lambda v: min(255, int(v * 0.97 + 4)))
g = g.point(lambda v: int(v * 0.90))
b = b.point(lambda v: min(255, int(v * 1.08 + 10)))
p = Image.merge('RGB', (r, g, b))
# vignette
vig = Image.new('L', p.size, 0)
vd = ImageDraw.Draw(vig)
vd.ellipse((-140, -120, p.width + 140, p.height + 200), fill=255)
vig = vig.filter(ImageFilter.GaussianBlur(120))
violet = Image.new('RGB', p.size, (52, 22, 84))
p = Image.composite(p, Image.blend(p, violet, 0.55), vig)
# the altered eye: over the eye on the viewer's right, sized from the eye gap
sx = 576 / cw; sy = 768 / ch
exr = (eyes[1][0] - cx0) * sx; eyr = (eyes[1][1] - cy0) * sy
rad = eye_gap * sx * 0.19
d = ImageDraw.Draw(p, 'RGBA')
d.ellipse((exr - rad * 1.35, eyr - rad * 1.35, exr + rad * 1.35, eyr + rad * 1.35), fill=(255, 226, 226, 255))   # pale sclera
d.ellipse((exr - rad * 1.05, eyr - rad * 1.05, exr + rad * 1.05, eyr + rad * 1.05), fill=(214, 46, 46, 255))    # red iris
d.ellipse((exr - rad * 0.28, eyr - rad * 1.0, exr + rad * 0.28, eyr + rad * 1.0), fill=(28, 3, 8, 255))          # slit pupil
d.ellipse((exr - rad * 1.45, eyr - rad * 1.45, exr + rad * 1.45, eyr + rad * 1.45), outline=(180, 107, 255, 230), width=max(2, int(rad * 0.16)))
glow = Image.new('RGBA', p.size, (0, 0, 0, 0))
gd = ImageDraw.Draw(glow)
gd.ellipse((exr - rad * 2.4, eyr - rad * 2.4, exr + rad * 2.4, eyr + rad * 2.4), fill=(180, 107, 255, 110))
glow = glow.filter(ImageFilter.GaussianBlur(rad * 0.9))
p = Image.alpha_composite(p.convert('RGBA'), glow).convert('RGB')
p.save(f'{out_dir}/victor-possessed.jpg', quality=90)
print(f'portrait possessed: eye at ({exr:.0f},{eyr:.0f}) r={rad:.0f} -> {out_dir}/victor-possessed.jpg')
