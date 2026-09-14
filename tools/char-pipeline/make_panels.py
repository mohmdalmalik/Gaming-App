# Cut the character sheet (ref/victor-sheet.png) into the panels the comparison tools use.
#   python3 tools/char-pipeline/make_panels.py
# Row 1: front, three-quarter, side, back (full body). Row 2: face front, face three-quarter,
# face side, elevated view. The 6 px margin keeps the sheet's panel borders out of the crops.
from pathlib import Path
from PIL import Image
HERE = Path(__file__).resolve().parent
sheet = Image.open(HERE / 'ref' / 'victor-sheet.png').convert('RGB')
cols = [(0, 384), (384, 768), (768, 1152), (1152, 1536)]
rows = {'r1': (90, 578), 'r2': (618, 972)}
names = {'r1': ['front', 'tq', 'side', 'back'], 'r2': ['face-front', 'face-tq', 'face-side', 'elevated']}
out = HERE / 'ref' / 'panels'; out.mkdir(exist_ok=True)
for r, (y0, y1) in rows.items():
    for (x0, x1), name in zip(cols, names[r]):
        sheet.crop((x0 + 6, y0 + 6, x1 - 6, y1 - 6)).save(out / f'{name}.png')
        print('panel', name)
