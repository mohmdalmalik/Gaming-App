# GLB helpers for the parts pipeline (pure Python + numpy, no Blender): read and write a binary glTF, pull an
# accessor out as a numpy array, repack the binary buffer (one tight buffer view per accessor), convert float skin
# weights to normalised uint8 (each vertex summing to exactly 255), the piece hash, and per-primitive positions.
# Used by core.py (after Blender's export) and by manifest.py (which must run without Blender).
import json, struct, hashlib
import numpy as np

GLB_MAGIC, JSON_CHUNK, BIN_CHUNK = 0x46546C67, 0x4E4F534A, 0x004E4942
COMP = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NCOMP = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT2': 4, 'MAT3': 9, 'MAT4': 16}

def read(path):
    """-> (gltf dict, binary chunk bytes)."""
    data = open(path, 'rb').read()
    magic, version, _ = struct.unpack_from('<III', data, 0)
    if magic != GLB_MAGIC or version != 2: raise ValueError(f'{path}: not a glTF 2.0 binary')
    off = 12; js = None; binb = b''
    while off < len(data):
        clen, ctype = struct.unpack_from('<II', data, off); body = data[off + 8: off + 8 + clen]; off += 8 + clen
        if ctype == JSON_CHUNK: js = json.loads(body)
        elif ctype == BIN_CHUNK: binb = body
    return js, binb

def write(path, gltf, binb, tmp_rename=True):
    js = json.dumps(gltf, separators=(',', ':')).encode(); js += b' ' * ((4 - len(js) % 4) % 4)
    binb = bytes(binb) + b'\0' * ((4 - len(binb) % 4) % 4)
    total = 12 + 8 + len(js) + (8 + len(binb) if binb else 0)
    out = struct.pack('<III', GLB_MAGIC, 2, total) + struct.pack('<II', len(js), JSON_CHUNK) + js
    if binb: out += struct.pack('<II', len(binb), BIN_CHUNK) + binb
    if tmp_rename:
        import os
        tmp = str(path) + '.tmp'; open(tmp, 'wb').write(out); os.replace(tmp, path)
    else: open(path, 'wb').write(out)

def accessor(gltf, binb, i):
    """Accessor i as a numpy array of shape (count, ncomp) (or (count,) for scalars), honouring byteStride."""
    a = gltf['accessors'][i]; dt = np.dtype(COMP[a['componentType']]); nc = NCOMP[a['type']]; n = a['count']
    bv = gltf['bufferViews'][a['bufferView']]; off = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', 0) or dt.itemsize * nc
    if stride == dt.itemsize * nc:
        arr = np.frombuffer(binb, dtype=dt, count=n * nc, offset=off).reshape(n, nc)
    else:
        raw = np.frombuffer(binb, dtype=np.uint8, count=stride * (n - 1) + dt.itemsize * nc, offset=off)
        arr = np.stack([raw[k * stride: k * stride + dt.itemsize * nc].view(dt) for k in range(n)])
    return arr if nc > 1 else arr.reshape(n)

def repack(gltf, binb, replace=None):
    """Rewrite the binary buffer with one tightly packed, 4-byte aligned buffer view per accessor (drops anything
    unreferenced, e.g. the float weights after a conversion). replace: {accessor index: (numpy array, componentType,
    normalized)} swaps an accessor's data. Returns the new binary bytes; gltf is changed in place."""
    replace = replace or {}
    out = bytearray(); views = []
    targets = {}
    for m in gltf.get('meshes', []):
        for p in m['primitives']:
            for k, v in p['attributes'].items(): targets[v] = 34962
            if 'indices' in p: targets[p['indices']] = 34963
    for i, a in enumerate(gltf['accessors']):
        if i in replace:
            arr, ct, norm = replace[i]; arr = np.ascontiguousarray(arr.astype(COMP[ct]))
            a['componentType'] = ct
            if norm: a['normalized'] = True
            else: a.pop('normalized', None)
        else:
            arr = np.ascontiguousarray(accessor(gltf, binb, i))
        raw = arr.tobytes()
        while len(out) % 4: out += b'\0'
        bv = {'buffer': 0, 'byteOffset': len(out), 'byteLength': len(raw)}
        if i in targets: bv['target'] = targets[i]
        views.append(bv); out += raw
        a['bufferView'] = i; a.pop('byteOffset', None)
    while len(out) % 4: out += b'\0'
    gltf['bufferViews'] = views
    gltf['buffers'] = [{'byteLength': len(out)}]
    return bytes(out)

def quantise_weights(w):
    """(N, 4) float weights -> (N, 4) uint8 that sum to exactly 255 (the rounding remainder goes on the largest)."""
    w = np.asarray(w, dtype=np.float64)
    w = w / np.maximum(w.sum(1, keepdims=True), 1e-12)
    q = np.floor(w * 255 + 0.5).astype(np.int64)
    q[np.arange(len(q)), np.argmax(w, 1)] += 255 - q.sum(1)
    if (q < 0).any() or (q > 255).any(): raise ValueError('weight quantisation out of range')
    return q.astype(np.uint8)

def prim_list(gltf):
    """[(mesh index, primitive index, primitive dict, material name)] in file order."""
    mats = [m.get('name', f'mat{i}') for i, m in enumerate(gltf.get('materials', []))]
    out = []
    for mi, m in enumerate(gltf.get('meshes', [])):
        for pi, p in enumerate(m['primitives']):
            out.append((mi, pi, p, mats[p['material']] if 'material' in p else None))
    return out

def piece_hash(gltf, binb):
    """First 12 hex of SHA-1 over the POSITION bytes of all primitives in primitive order (the piece's identity)."""
    h = hashlib.sha1()
    for _, _, p, _ in prim_list(gltf):
        h.update(np.ascontiguousarray(accessor(gltf, binb, p['attributes']['POSITION']).astype(np.float32)).tobytes())
    return h.hexdigest()[:12]

def positions_by_material(gltf, binb):
    """{material name: (N, 3) float32 positions} (glTF space)."""
    return {mat: accessor(gltf, binb, p['attributes']['POSITION']) for _, _, p, mat in prim_list(gltf)}

def tri_count(gltf):
    n = 0
    for _, _, p, _ in prim_list(gltf):
        n += (gltf['accessors'][p['indices']]['count'] if 'indices' in p else gltf['accessors'][p['attributes']['POSITION']]['count']) // 3
    return n

def vert_count(gltf):
    return sum(gltf['accessors'][p['attributes']['POSITION']]['count'] for _, _, p, _ in prim_list(gltf))
