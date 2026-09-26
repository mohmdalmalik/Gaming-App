# Pack a room .glb smaller without changing how it looks: vertex colours become 4 bytes (they were 12)
# and both UV sets become 2 x 16 bits (they were 2 x 8 bytes). Both are plain glTF 2.0 (normalized
# integer attributes), which three.js reads directly. Positions and indices are left as they are.
#   python3 tools/room-pipeline/pack_glb.py assets/models/rooms/lounge.glb [more.glb ...]
import json, struct, sys
import numpy as np

CT = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
NC = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}


def read_glb(path):
    b = open(path, 'rb').read()
    magic, ver, total = struct.unpack('<4sII', b[:12])
    assert magic == b'glTF'
    jl, jt = struct.unpack('<I4s', b[12:20])
    j = json.loads(b[20:20 + jl])
    off = 20 + jl
    bl, bt = struct.unpack('<I4s', b[off:off + 8])
    return j, b[off + 8:off + 8 + bl]


def accessor_array(j, binb, i):
    a = j['accessors'][i]
    bv = j['bufferViews'][a['bufferView']]
    dt = np.dtype(CT[a['componentType']])
    n = NC[a['type']]
    start = bv.get('byteOffset', 0) + a.get('byteOffset', 0)
    stride = bv.get('byteStride', 0) or dt.itemsize * n
    raw = np.frombuffer(binb, dtype=np.uint8, count=stride * (a['count'] - 1) + dt.itemsize * n, offset=start)
    out = np.lib.stride_tricks.as_strided(raw, shape=(a['count'], dt.itemsize * n), strides=(stride, 1)).copy()
    return out.view(dt).reshape(a['count'], n)


def pack(path):
    j, binb = read_glb(path)
    before = len(binb)
    usage = {}
    for m in j['meshes']:
        for p in m['primitives']:
            for k, v in p['attributes'].items():
                usage[v] = k
            if 'indices' in p:
                usage[p['indices']] = 'INDICES'
    chunks, views = [], []
    size = 0
    for i, a in enumerate(j['accessors']):
        arr = accessor_array(j, binb, i)
        role = usage.get(i, '')
        if role.startswith('COLOR') and a['componentType'] == 5126:
            rgba = np.ones((arr.shape[0], 4), np.float32)
            rgba[:, :arr.shape[1]] = arr
            arr = np.clip(np.round(rgba * 255), 0, 255).astype(np.uint8)
            a.update(componentType=5121, type='VEC4', normalized=True)
            a.pop('min', None); a.pop('max', None)
        elif role.startswith('TEXCOORD') and a['componentType'] == 5126:
            arr = np.clip(np.round(np.clip(arr, 0, 1) * 65535), 0, 65535).astype(np.uint16)
            a.update(componentType=5123, normalized=True)
            a.pop('min', None); a.pop('max', None)
        data = arr.tobytes()
        pad = (-size) % 4
        if pad:
            chunks.append(b'\0' * pad); size += pad
        view = {'buffer': 0, 'byteOffset': size, 'byteLength': len(data)}
        view['target'] = 34963 if role == 'INDICES' else 34962
        views.append(view)
        a['bufferView'] = len(views) - 1
        a.pop('byteOffset', None)
        chunks.append(data); size += len(data)
    j['bufferViews'] = views
    newbin = b''.join(chunks)
    newbin += b'\0' * ((-len(newbin)) % 4)
    j['buffers'] = [{'byteLength': len(newbin)}]
    js = json.dumps(j, separators=(',', ':')).encode()
    js += b' ' * ((-len(js)) % 4)
    out = struct.pack('<4sII', b'glTF', 2, 12 + 8 + len(js) + 8 + len(newbin))
    out += struct.pack('<I4s', len(js), b'JSON') + js + struct.pack('<I4s', len(newbin), b'BIN\0') + newbin
    open(path, 'wb').write(out)
    print('%s: %d -> %d bytes' % (path, before, len(out)))


for p in sys.argv[1:]:
    pack(p)
