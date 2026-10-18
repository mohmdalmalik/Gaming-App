# Write a test result into a piece's scene extras (no Blender): positions are untouched, so the piece's hash and every
# shadow patch baked against it stay valid. manifest.py copies `redEyeMin` and `poke` into the manifest.
#   python3 tools/char-pipeline/parts/record.py assets/characters/parts/m/hairStyle_swept.glb redEyeMin 0.998
#   python3 tools/char-pipeline/parts/record.py <file.glb> poke '{"pokes": 0, "pass": true}'
import sys, json
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parent))
import glb as G

def record(path, key, value):
    gltf, binb = G.read(path)
    before = G.piece_hash(gltf, binb)
    gltf['scenes'][0].setdefault('extras', {})[key] = value
    G.write(path, gltf, binb)
    assert G.piece_hash(*G.read(path)) == before

if __name__ == '__main__':
    path, key, raw = sys.argv[1], sys.argv[2], sys.argv[3]
    try: value = json.loads(raw)
    except json.JSONDecodeError: value = raw
    record(path, key, value)
