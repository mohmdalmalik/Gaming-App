# Build one DRESS guest from its spec with guest_kit + dress_kit (Eleanor, Clara, Beatrice).
#   python3 tools/char-pipeline/make_dress_guest.py eleanor          -> assets/characters/eleanor.glb
#   GUEST_OUT=tools/char-pipeline/shots/x.glb python3 tools/char-pipeline/make_dress_guest.py eleanor
# Same as make_guest.py, but finishes with dress_kit.finish (writes ONE eye centre as `eyeCentre` for portraits).
import sys, os, importlib
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(HERE / 'guests'))
import guest_kit as GK
import dress_kit as DK

name = (sys.argv[1] if len(sys.argv) > 1 else 'eleanor').lower()
GK.reset_scene()
spec = importlib.import_module(name)
g = GK.Guest(name, spec.CFG, spec.COLOURS, H=getattr(spec, 'H', 1.66))
spec.build(g)
out = os.environ.get('GUEST_OUT') or (GK.REPO / 'assets' / 'characters' / f'{name}.glb')
DK.finish(g, spec.RIG, out)
