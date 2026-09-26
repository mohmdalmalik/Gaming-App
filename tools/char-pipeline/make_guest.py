# Build one hotel guest from its spec with the shared guest kit.
#   python3 tools/char-pipeline/make_guest.py marcus          -> assets/characters/marcus.glb
#   GUEST_OUT=/tmp/x.glb python3 tools/char-pipeline/make_guest.py marcus   (build elsewhere)
# The spec lives in tools/char-pipeline/guests/<name>.py and provides CFG, COLOURS, RIG and build(g).
import sys, os, importlib
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE)); sys.path.insert(0, str(HERE / 'guests'))
import guest_kit as GK

name = (sys.argv[1] if len(sys.argv) > 1 else 'marcus').lower()
GK.reset_scene()
spec = importlib.import_module(name)
g = GK.Guest(name, spec.CFG, spec.COLOURS, H=getattr(spec, 'H', 1.66))
spec.build(g)
out = os.environ.get('GUEST_OUT') or (GK.REPO / 'assets' / 'characters' / f'{name}.glb')
GK.finish(g, spec.RIG, out)
