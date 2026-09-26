# Contact sheet of every card illustration (for review):  python3 tools/card-pipeline/sheet.py [out.jpg] [tile]
import os, sys
from PIL import Image, ImageDraw
HERE = os.path.dirname(os.path.abspath(__file__))
CARDS = os.path.join(HERE, '..', '..', 'assets', 'cards')
ORDER = ['lantern', 'bandage', 'flashlight', 'knife', 'revolver', 'barricade', 'lockPick', 'masterKey', 'handMirror', 'espresso', 'possession']
out = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'build', 'sheet.jpg')
T = int(sys.argv[2]) if len(sys.argv) > 2 else 300
cols = 4; rows = (len(ORDER) + cols - 1) // cols; pad = 12; lab = 26
sheet = Image.new('RGB', (cols * (T + pad) + pad, rows * (T + pad + lab) + pad), (24, 18, 14))
d = ImageDraw.Draw(sheet)
for i, n in enumerate(ORDER):
    p = os.path.join(CARDS, n + '.jpg')
    if not os.path.exists(p): continue
    im = Image.open(p).convert('RGB').resize((T, T), Image.LANCZOS)
    x = pad + (i % cols) * (T + pad); y = pad + (i // cols) * (T + pad + lab)
    sheet.paste(im, (x, y))
    kb = os.path.getsize(p) // 1024
    d.text((x + 4, y + T + 6), f'{n}  ({kb} KB)', fill=(230, 210, 170))
os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
sheet.save(out, quality=90)
print(out)
