# Shrink the shipped light maps to the size the game uses (run after a bake; build_all.sh does it).
#   python3 tools/room-pipeline/shrink_maps.py
# The rooms are baked at 1024 (better quality: the shrink averages it), then saved at 512: on the iPad a
# room is a few hundred points across and the baked light is soft, so 512 looks the same (checked side
# by side at the iPad's 2x density) while a fully explored hotel's 48 room maps take a quarter of the
# graphics memory (~64 MB instead of ~256 MB). The lobby's wall-and-furniture atlas goes 2048 -> 1024 the
# same way. A map already at (or under) its size is left alone, so running this twice changes nothing.
import glob
import os
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'assets', 'models')
TARGETS = [(os.path.join(ROOT, 'rooms', '*-light.jpg'), 512), (os.path.join(ROOT, 'rooms', '*-floor.jpg'), 512),
           (os.path.join(ROOT, 'lobby', 'lobby-light.jpg'), 1024)]

for pattern, size in TARGETS:
    for path in sorted(glob.glob(pattern)):
        im = Image.open(path)
        if max(im.size) <= size:
            continue
        before = os.path.getsize(path)
        im.convert('RGB').resize((size, size), Image.LANCZOS).save(path, quality=90, optimize=True)
        print(f'{os.path.relpath(path, ROOT)}: {im.size[0]} -> {size} px, {before // 1024} -> {os.path.getsize(path) // 1024} KB')
