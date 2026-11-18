# The rooms' own floor pictures (graphics round 2): turns the originals made with Higgsfield into the files the
# game loads, assets/models/rooms/floors/<name>.jpg (1024 px square, north at the top of the picture).
#   python3 tools/room-pipeline/floor_art.py <folder holding the original <name>.png files>
# Needs Pillow only (no Blender, no re-bake: the game lays the picture over the room's baked light,
# src/render/bakedRoom.js). Which room shows which picture: FLOOR_ART in src/data/dressing.js. The prompt and the
# Higgsfield job of every picture: tools/room-pipeline/floors.md.
import os, sys
from PIL import Image, ImageEnhance

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.abspath(os.path.join(HERE, '..', '..', 'assets', 'models', 'rooms', 'floors'))
SIZE = 1024
# Per picture, where the original needs it: colour strength and brightness (1 = as made).
TONE = {
    'exit': dict(sat=0.80, bright=0.90),      # the painted green was neon next to the hotel's colours
}

def main(src):
    os.makedirs(OUT, exist_ok=True)
    total = 0
    for f in sorted(os.listdir(src)):
        name, ext = os.path.splitext(f)
        if ext.lower() not in ('.png', '.jpg', '.jpeg', '.webp'):
            continue
        im = Image.open(os.path.join(src, f)).convert('RGB')
        if im.size != (SIZE, SIZE):
            im = im.resize((SIZE, SIZE), Image.LANCZOS)
        t = TONE.get(name, {})
        if 'sat' in t:
            im = ImageEnhance.Color(im).enhance(t['sat'])
        if 'bright' in t:
            im = ImageEnhance.Brightness(im).enhance(t['bright'])
        out = os.path.join(OUT, name + '.jpg')
        im.save(out, quality=86, optimize=True, progressive=True, subsampling=0)
        total += os.path.getsize(out)
        print(f'{name:14s} {os.path.getsize(out) // 1024:4d} KB')
    print(f'total {total // 1024} KB in {OUT}')

if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit(__doc__ or 'usage: floor_art.py <folder with the original pictures>')
    main(sys.argv[1])
