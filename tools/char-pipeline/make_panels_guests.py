# Cut the five guest sheets (ref/<name>-sheet.png, 1536x1024, same layout) into comparison panels:
#   ref/panels-<name>/front.png tq.png side.png back.png (full body, 380 x 578)
#   ref/panels-<name>/face-front.png face-tq.png (the two framed head close-ups, inside their frames)
# Victor's sheet has a different layout: make_panels.py.
#   python3 tools/char-pipeline/make_panels_guests.py
from pathlib import Path
from PIL import Image
HERE = Path(__file__).resolve().parent
COLS = {'front': (40, 420), 'tq': (420, 790), 'side': (775, 1110), 'back': (1125, 1505)}
ROW = (100, 678)
HEADS = {'face-front': (494, 722, 734, 956), 'face-tq': (808, 722, 1046, 956)}
for name in ('marcus', 'henry', 'eleanor', 'clara', 'beatrice'):
    sheet = Image.open(HERE / 'ref' / f'{name}-sheet.png').convert('RGB')
    out = HERE / 'ref' / f'panels-{name}'; out.mkdir(exist_ok=True)
    for k, (x0, x1) in COLS.items(): sheet.crop((x0, ROW[0], x1, ROW[1])).save(out / f'{k}.png')
    for k, box in HEADS.items(): sheet.crop(box).save(out / f'{k}.png')
    print('panels', name)
