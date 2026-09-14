# Geometry diagnosis of an exported GLB, per material primitive: triangle count, normals present,
# how many triangles' winding disagrees with their vertex normals (flipped orientation), how many
# face normals point INTO the primitive's centroid, bounding box. No Blender needed.
#   python3 tools/char-pipeline/glb_inspect.py assets/characters/victor.glb
import sys, json, struct, numpy as np
path = sys.argv[1] if len(sys.argv) > 1 else 'assets/characters/victor.glb'
data = open(path, 'rb').read()
magic, ver, length = struct.unpack_from('<III', data, 0); assert magic == 0x46546C67
off = 12; chunks = []
while off < length:
    clen, ctype = struct.unpack_from('<II', data, off); chunks.append((ctype, data[off + 8: off + 8 + clen])); off += 8 + clen
gltf = json.loads(chunks[0][1]); bin_ = chunks[1][1]
def accessor(idx):
    a = gltf['accessors'][idx]; bv = gltf['bufferViews'][a['bufferView']]
    comp = {5126: np.float32, 5123: np.uint16, 5125: np.uint32, 5121: np.uint8}[a['componentType']]
    n = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4}[a['type']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    arr = np.frombuffer(bin_, dtype=comp, count=a['count'] * n, offset=start)
    return arr.reshape(a['count'], n) if n > 1 else arr
mats = [m['name'] for m in gltf['materials']]
print(f'{path}: {len(gltf["meshes"])} meshes, materials {mats}')
for mesh in gltf['meshes']:
    for prim in mesh['primitives']:
        P = accessor(prim['attributes']['POSITION']).astype(np.float64); N = accessor(prim['attributes']['NORMAL']).astype(np.float64) if 'NORMAL' in prim['attributes'] else None
        I = accessor(prim['indices']).astype(np.int64).reshape(-1, 3)
        tri = P[I]; e1 = tri[:, 1] - tri[:, 0]; e2 = tri[:, 2] - tri[:, 0]; fn = np.cross(e1, e2)
        area = np.linalg.norm(fn, axis=1); ok = area > 1e-12; fn = fn[ok] / area[ok][:, None]
        vn = N[I][ok].mean(axis=1) if N is not None else None
        agree = (fn * vn).sum(axis=1) if vn is not None else None
        centroid = P.mean(axis=0); cen = tri[ok].mean(axis=1); toward_in = ((cen - centroid) * fn).sum(axis=1) < 0
        name = mats[prim['material']]
        print(f'  {name:7s} tris={len(I):6d} degenerate={int((~ok).sum()):3d} normals={"yes" if N is not None else "NO "} '
              f'winding_vs_normal_disagree={(agree < 0).mean() * 100 if agree is not None else float("nan"):5.1f}%  '
              f'face_normal_inward={toward_in.mean() * 100:5.1f}%  bbox y[{P[:, 1].min():.3f},{P[:, 1].max():.3f}] x[{P[:, 0].min():.3f},{P[:, 0].max():.3f}] z[{P[:, 2].min():.3f},{P[:, 2].max():.3f}]')
        if name == 'Hair':
            top = P[:, 1] > P[:, 1].max() - 0.03
            print(f'          hair top 3 cm: {top.sum()} verts, normals there mean = {N[top].mean(axis=0).round(3) if N is not None else "-"}')
        if name == 'Skin':
            top = P[:, 1] > 1.55
            print(f'          skin above y=1.55: {top.sum()} verts, max y {P[:, 1].max():.3f}')
