# Paste each in-game shot next to its reference, and build the contact sheet of every room.
#   python3 tools/room-pipeline/vsref_sheet.py <game shots dir> <out dir> room:ref [room:ref ...]
# (vsref.mjs calls this.) Writes <room>-vs-ref.png (reference | game) and rooms-vs-refs.png, as 256-colour
# PNGs so they stay small enough to keep in the repository.
import os, sys
from PIL import Image, ImageDraw, ImageFont

HERE = os.path.dirname(os.path.abspath(__file__))
RAW, OUT = sys.argv[1], sys.argv[2]
ORDER = ['ballroom', 'lounge', 'grandCorridor', 'switchboard', 'dining', 'library', 'kitchen', 'serviceCorridor',
         'storage', 'corridorE', 'corridorW', 'corridorN', 'corridorS', 'stairs', 'infirmary2', 'infirmary1',
         'cloakroom', 'backCorridor', 'cornerCorridor', 'linenStore1', 'linenStore2', 'suite416', 'housekeeping', 'exit']
REF = {}
for p in sys.argv[3:]:
    room, ref = p.split(':')
    REF[room] = ref or None
try:
    FONT = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 30)
except OSError:
    FONT = ImageFont.load_default()

PW, PH = 960, 720

def small(im):
    return im.quantize(256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG)
def pair(room, ref):
    game = Image.open(os.path.join(RAW, room + '-game.png')).convert('RGB').resize((PW, PH), Image.LANCZOS)
    im = Image.new('RGB', (PW * 2 + 12, PH + 48), (40, 36, 34))
    if ref:
        im.paste(Image.open(os.path.join(HERE, 'ref', ref + '.jpg')).convert('RGB').resize((PW, PH), Image.LANCZOS), (0, 48))
    im.paste(game, (PW + 12, 48))
    d = ImageDraw.Draw(im)
    d.text((12, 8), 'reference: %s' % (ref + '.jpg' if ref else '(none - restyled to match)'), fill=(235, 225, 205), font=FONT)
    d.text((PW + 24, 8), 'in game: %s' % room, fill=(235, 225, 205), font=FONT)
    small(im).save(os.path.join(OUT, room + '-vs-ref.png'), optimize=True)

for room, ref in REF.items():
    if os.path.exists(os.path.join(RAW, room + '-game.png')):
        pair(room, ref)

tiles = [r for r in ORDER if os.path.exists(os.path.join(OUT, r + '-vs-ref.png'))]
if tiles:
    tw = 960
    th = int(tw * (PH + 48) / (PW * 2 + 12))
    cols = 2
    rows = (len(tiles) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * tw + (cols + 1) * 8, rows * th + (rows + 1) * 8), (24, 22, 21))
    for i, r in enumerate(tiles):
        im = Image.open(os.path.join(OUT, r + '-vs-ref.png')).convert('RGB').resize((tw, th), Image.LANCZOS)
        sheet.paste(im, (8 + (i % cols) * (tw + 8), 8 + (i // cols) * (th + 8)))
    small(sheet).save(os.path.join(OUT, 'rooms-vs-refs.png'), optimize=True)
    print('sheet', len(tiles), 'rooms ->', os.path.join(OUT, 'rooms-vs-refs.png'))
