# The poke-through test for parts (contract 9.4). Blender's Python is used only for its fast ray casting (mathutils).
#   LD_LIBRARY_PATH=/usr/local/lib/python3.11/dist-packages/bpy/lib python3 tools/char-pipeline/parts/poke.py \
#        --body m --item top_tux [--parts <dir>] --out <scratch dir>        (--item all: every piece of the body)
#   -> <out>/<item>.poke.json (+ <item>.poke.png marking any poke), read by review.mjs for the sheet's footer.
# Poses: Idle at 0, Walk at 0, 0.25, 0.5 and 0.75 of the clip, skinned on the CPU from body.glb's clips (the same
# 19-bone rig every piece shares). Pairs (inner -> cover) for the item under test:
#   face skull -> hairStyle (the hair's own face; bind pose, both are rigid on the head bone)
#   body neck + hands -> top        legs -> top (the trouser top under the jacket hem)       feet -> legs (the shoe
#   under the trouser hem)          top Shirt + Button -> neck (every top the neckwear is drawn on)
#   body neck -> face (the join under the chin and at the nape stays hidden in every face)
#   (women) body skin -> dress (yoke under the bodice, arms under the sleeves, legs under the skirt; not the hands)
#   dress -> belt; (men's evening gloves) body hands -> gloves, gloves -> every top (the wrist under the cuffs);
#   (women's opera gloves) body arms and hands -> gloves, gloves -> every gown's sleeves (not the hands).
#   These use the 'vis' test (seen()): gowns overlap themselves (a sleeve cap over the bodice, the
#   rolled neckline) and a belt is an open band, where ray parity misreads a covered point as outside.
# Not tested (the one exemption, reported in the JSON): feet -> legs leaves out the shoe's top rim, which sits in the
# bottom 20 mm of the closed trouser leg (its front dips over the shoe): walking, the hem can only lift off that rim (no cloth simulation), by up to
# 12 mm at toe-off, the same as today's guests (their trousers and shoes are these).
# A poke = an inner vertex that is INSIDE its cover at the bind pose (ray parity, majority of 6 directions) and
# OUTSIDE it, more than 2 mm from its surface, at a test pose. Pass = 0 pokes.
# Neckwear also gets a front check at the bind pose: no shirt or stud vertex may stand in front of the bow tie or tie
# where it covers them (that is how the tuxedo's studs once poked through the tie).
import sys, os, json, math, argparse
from pathlib import Path
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import numpy as np
import bpy                                  # (only for mathutils)
from mathutils import Vector
from mathutils.bvhtree import BVHTree
import glb as G
import tables as T

REPO = HERE.parents[2]
POSES = [('Idle', 0.0), ('Walk', 0.0), ('Walk', 0.25), ('Walk', 0.5), ('Walk', 0.75)]

# ---- the rig and its clips (glTF: Y up, the guest facing +Z) ----------------------------------------------------------
def _qmat(q):
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])
def _trs(t, r, s):
    M = np.eye(4); M[:3, :3] = _qmat(r) * np.asarray(s)[None, :]; M[:3, 3] = t; return M

class Rig:
    def __init__(self, body_glb):
        g, b = G.read(body_glb); self.g, self.b = g, b
        self.nodes = g['nodes']; self.parent = {}
        for i, n in enumerate(self.nodes):
            for c in n.get('children', []): self.parent[c] = i
        sk = g['skins'][0]; self.joints = sk['joints']
        self.ibm = G.accessor(g, b, sk['inverseBindMatrices']).astype(np.float64).reshape(-1, 4, 4).transpose(0, 2, 1)
        self.anims = {}
        for a in g.get('animations', []):
            ch = []
            for c in a['channels']:
                s = a['samplers'][c['sampler']]
                ch.append((c['target']['node'], c['target']['path'], G.accessor(g, b, s['input']).astype(np.float64).reshape(-1),
                           G.accessor(g, b, s['output']).astype(np.float64)))
            self.anims[a['name']] = (ch, max(x[2][-1] for x in ch))
    def duration(self, clip): return self.anims[clip][1]
    def skin_matrices(self, clip=None, frac=0.0):
        local = {}
        for i, n in enumerate(self.nodes):
            local[i] = [np.array(n.get('translation', [0, 0, 0]), float), np.array(n.get('rotation', [0, 0, 0, 1]), float), np.array(n.get('scale', [1, 1, 1]), float)]
        if clip is not None:
            ch, dur = self.anims[clip]; t = frac * dur
            for node, path, ts, vs in ch:
                if path not in ('translation', 'rotation', 'scale'): continue
                k = int(np.clip(np.searchsorted(ts, t) - 1, 0, len(ts) - 2)) if len(ts) > 1 else 0
                f = 0.0 if len(ts) < 2 else float(np.clip((t - ts[k]) / max(1e-9, ts[k + 1] - ts[k]), 0, 1))
                v = vs[k] * (1 - f) + vs[min(k + 1, len(vs) - 1)] * f
                if path == 'rotation':
                    if np.dot(vs[k], vs[min(k + 1, len(vs) - 1)]) < 0: v = vs[k] * (1 - f) - vs[min(k + 1, len(vs) - 1)] * f
                    v = v / np.linalg.norm(v)
                local[node][['translation', 'rotation', 'scale'].index(path)] = v
        glob = {}
        def world(i):
            if i in glob: return glob[i]
            M = _trs(*local[i]); p = self.parent.get(i)
            glob[i] = (world(p) @ M) if p is not None else M
            return glob[i]
        return np.stack([world(j) @ self.ibm[k] for k, j in enumerate(self.joints)])

class Piece:
    """One part GLB: per material, bind-pose positions, joints, weights and triangles (glTF space)."""
    def __init__(self, path):
        g, b = G.read(path); self.key = Path(path).stem; self.prims = {}
        for _, _, p, mat in G.prim_list(g):
            a = p['attributes']
            self.prims[mat] = dict(pos=G.accessor(g, b, a['POSITION']).astype(np.float64), nrm=G.accessor(g, b, a['NORMAL']).astype(np.float64),
                                   j=G.accessor(g, b, a['JOINTS_0']).astype(np.int64),
                                   w=G.accessor(g, b, a['WEIGHTS_0']).astype(np.float64) / 255.0, tri=G.accessor(g, b, p['indices']).astype(np.int64).reshape(-1, 3))
    def posed(self, S, mats=None):
        out = {}
        for m, P in self.prims.items():
            if mats and m not in mats: continue
            h = np.concatenate([P['pos'], np.ones((len(P['pos']), 1))], 1)
            acc = np.zeros((len(h), 3))
            for c in range(4):
                M = S[P['j'][:, c]]                                    # (N, 4, 4)
                acc += P['w'][:, c:c + 1] * np.einsum('nij,nj->ni', M, h)[:, :3]
            out[m] = acc
        return out
    def posed_normals(self, S, mats):
        out = []
        for m in mats:
            P = self.prims[m]; acc = np.zeros((len(P['nrm']), 3))
            for c in range(4): acc += P['w'][:, c:c + 1] * np.einsum('nij,nj->ni', S[P['j'][:, c]][:, :3, :3], P['nrm'])
            out.append(acc / np.maximum(np.linalg.norm(acc, axis=1, keepdims=True), 1e-12))
        return np.concatenate(out)
    def tree(self, posed):
        V, F, off = [], [], 0
        for m, P in self.prims.items():
            if m not in posed: continue
            V.append(posed[m]); F.append(P['tri'] + off); off += len(posed[m])
        V = np.concatenate(V); F = np.concatenate(F)
        return BVHTree.FromPolygons([tuple(v) for v in V], [tuple(f) for f in F], all_triangles=True)

DIRS = [Vector(d).normalized() for d in ((1, 0.15, 0), (-1, 0.15, 0), (0, 0.15, 1), (0, 0.15, -1), (0.7, -0.3, 0.7), (-0.7, -0.3, -0.7))]
def crossings(tree, o, d, reach=0.6):
    n, p = 0, Vector(o)
    for _ in range(12):
        hit = tree.ray_cast(p, d, reach)
        if hit[0] is None: break
        n += 1; p = hit[0] + d * 1e-5
    return n
def inside(tree, v):
    return sum(crossings(tree, v, d) % 2 for d in DIRS) >= 4

def seen(tree, v, n, reach=0.3, cone=30.0):
    """(the 'vis' mode) True when the point can be seen through the cover: along its own normal, or one of 8 directions
    `cone` degrees off it, a ray reaches open air. A point under cloth is hidden however many layers overlap there (ray
    parity calls a point inside two overlapping shells 'outside': a sleeve cap over a bodice, an arm slid into the bodice
    at the swing, a gown under an open belt band)."""
    n = Vector(n).normalized(); a = Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 1, 0))
    t1 = a.cross(n).normalized(); t2 = n.cross(t1); o = Vector(v) + n * 1e-4; c, s_ = math.cos(math.radians(cone)), math.sin(math.radians(cone))
    for k in range(9):
        d = n if k == 0 else (n * c + (t1 * math.cos(k * math.pi / 4) + t2 * math.sin(k * math.pi / 4)) * s_).normalized()
        if tree.ray_cast(o, d, reach)[0] is None: return True
    return False

def open_edges(cover, posed):
    """Points along the cover's open edges (a jacket's hem, cuffs, front opening; a hair shell's rim): edges used by
    one triangle once coincident vertices are welded (glTF splits vertices where normals or materials change)."""
    V = np.concatenate([posed[m] for m in cover.prims if m in posed]); F, off = [], 0
    for m, P in cover.prims.items():
        if m in posed: F.append(P['tri'] + off); off += len(posed[m])
    F = np.concatenate(F)
    _, weld = np.unique(np.round(V, 5), axis=0, return_inverse=True); weld = weld.reshape(-1); W = weld[F]
    E = np.sort(np.concatenate([W[:, [0, 1]], W[:, [1, 2]], W[:, [2, 0]]]), 1)
    u, c = np.unique(E, axis=0, return_counts=True)
    first = {}
    for i, w in enumerate(weld): first.setdefault(int(w), i)
    ids = sorted({int(x) for x in u[c == 1].reshape(-1)})
    return V[[first[i] for i in ids]] if ids else np.zeros((0, 3))

def test_pair(rig, inner, inner_mats, cover, poses, near=0.05, edge_gap=0.015, hem_band=None, skip_bones=(), vis=False):
    """-> dict(tested, pokes per pose, worst points). Inner vertices within edge_gap of an open edge of the cover are
    not tested: next to a hem or a cuff 'inside' has no meaning (the trousers show through a jacket's open front).
    skip_bones: inner vertices led by these bones are not tested (a gown never covers the hands). vis: a candidate is
    inside by parity AND hidden (seen() False) at the bind pose; a poke is one that can be SEEN at a test pose and has
    moved more than 2 mm further from the cover than at the bind pose (a point sliding under overlapping cloth, which
    parity misreads, is not a poke)."""
    from scipy.spatial import cKDTree
    S0 = rig.skin_matrices(None)
    pin = np.concatenate(list(inner.posed(S0, inner_mats).values())) if inner_mats else np.zeros((0, 3))
    if skip_bones:
        lead = np.concatenate([inner.prims[m]['j'][np.arange(len(inner.prims[m]['j'])), inner.prims[m]['w'].argmax(1)] for m in inner_mats])
        skip = np.isin(lead, [T.BONES.index(b) for b in skip_bones])
    else: skip = np.zeros(len(pin), bool)
    pc0 = cover.posed(S0); t0 = cover.tree(pc0); E = open_edges(cover, pc0)
    ed = cKDTree(E).query(pin)[0] if len(E) else np.full(len(pin), 1e9)
    hem = None
    if hem_band:                    # the cover's lowest height (a trouser hem): inner vertices in that band are not tested
        hem = min(P['pos'][:, 1].min() for P in cover.prims.values())
    cand = []; d0 = {}
    n0 = inner.posed_normals(S0, inner_mats) if vis else None
    for i, v in enumerate(pin):
        if ed[i] < edge_gap or skip[i]: continue
        if hem is not None and v[1] < hem + hem_band: continue
        loc, nrm, fi, dist = t0.find_nearest(Vector(v))
        if loc is None or dist > near: continue
        if inside(t0, Vector(v)) and (not vis or not seen(t0, v, n0[i])): cand.append(i); d0[i] = dist
    res = dict(tested=len(cand), pokes={}, points={})
    for clip, frac in poses:
        S = rig.skin_matrices(clip, frac)
        pv = np.concatenate(list(inner.posed(S, inner_mats).values())); pcs = cover.posed(S); tp = cover.tree(pcs)
        nv = inner.posed_normals(S, inner_mats) if vis else None
        Ep = open_edges(cover, pcs); etree = cKDTree(Ep) if len(Ep) else None
        bad = []
        for i in cand:
            v = Vector(pv[i]); loc, nrm, fi, dist = tp.find_nearest(v)
            if loc is None or dist <= 0.002 or ((not seen(tp, pv[i], nv[i]) or dist - d0[i] <= 0.002) if vis else inside(tp, v)): continue
            # out past an open edge (the seat swinging out below a jacket hem, a heel below a trouser hem) is not a
            # poke THROUGH the cloth: only count it when the nearest cloth is away from every open edge
            if etree is not None and etree.query(np.array(loc))[0] < edge_gap: continue
            bad.append(i)
        name = f'{clip} {frac:g}'; res['pokes'][name] = len(bad); res['points'][name] = pv[bad].round(4).tolist()[:200]
    return res

def front_pierce(rig, inner, inner_mats, cover):
    """Bind pose: a stud or button of the top standing in FRONT (+Z) of the neckwear where the neckwear is visible (in
    front of the top's own shirt and cloth there), in the centre band. A tie tucked behind a waistcoat is not visible
    there, so a stud in front of it is fine; a stud in front of a visible tie pokes through it."""
    S0 = rig.skin_matrices(None)
    studs = [m for m in inner_mats if m == 'Button']
    if not studs: return dict(tested=0, pierce=0, points=[])
    posed = inner.posed(S0); pin = np.concatenate([posed[m] for m in studs])
    rest = {m: v for m, v in posed.items() if m not in studs}
    t = cover.tree(cover.posed(S0)); tt = inner.tree(rest) if rest else None
    bad = []
    for v in pin:
        if abs(v[0]) > 0.03: continue        # the centre band (knot, blade, studs); a bow's wing tips tuck behind the collar points
        o, d = Vector((v[0], v[1], v[2] + 0.5)), Vector((0, 0, -1))
        hit = t.ray_cast(o, d, 0.6)
        if hit[0] is None or not (v[2] > hit[0].z + 0.0005 and v[2] - hit[0].z < 0.02): continue
        own = tt.ray_cast(o, d, 0.6) if tt else (None,)
        if own[0] is not None and own[0].z > hit[0].z + 0.001: continue      # the neckwear is behind the top's cloth here
        bad.append(v)
    return dict(tested=len(pin), pierce=len(bad), points=np.array(bad).round(4).tolist()[:200])

def picture(path, cover, posed_cover, points, title):
    """Front and side scatter of the cover with any poke in red (PIL)."""
    from PIL import Image, ImageDraw
    W, H = 900, 520; im = Image.new('RGB', (W, H), (24, 20, 18)); d = ImageDraw.Draw(im)
    V = np.concatenate(list(posed_cover.values()))
    lo, hi = V.min(0), V.max(0); sc = 480 / max(1e-6, max(hi[1] - lo[1], hi[0] - lo[0], hi[2] - lo[2]))
    for k, (ax, ox) in enumerate(((0, 20), (2, 470))):
        for v in V[:: max(1, len(V) // 6000)]:
            x = ox + (v[ax] - lo[ax]) * sc; y = 500 - (v[1] - lo[1]) * sc; d.point((x, y), fill=(150, 140, 130))
        for p in points:
            x = ox + (p[ax] - lo[ax]) * sc; y = 500 - (p[1] - lo[1]) * sc; d.ellipse((x - 3, y - 3, x + 3, y + 3), outline=(255, 40, 40))
    d.text((10, 6), title, fill=(239, 227, 204)); im.save(path)

def pairs_for(key, keys, man_parts, body):
    """(inner key, inner materials, cover key) for the item under test."""
    slot, ident, fit = T.split_key(key); out = []
    have = lambda k: k in keys
    # the body's default face / the gown a plain belt fits: from the first classic Look of the body's gender
    first = lambda s, cond=lambda L: True: next((L[s] for L in T.LOOKS.values() if L['gender'] == T.gender_of(body) and cond(L)), None)
    if slot == 'hairStyle':
        face = f'{fit[0]}_{fit[1]}' if fit else f"face_{first('face')}"
        if have(face): out.append((face, ['Skin'], key, 'bind'))
    elif slot == 'face':
        out.append(('body', ['Skin'], key, 'poses'))
    elif slot == 'top':
        out.append(('body', ['Skin'], key, 'poses'))
        for l in keys:
            if T.split_key(l)[0] == 'legs': out.append((l, ['Trouser'], key, 'poses'))
    elif slot == 'legs':
        for t in keys:
            if T.split_key(t)[0] == 'top': out.append((key, ['Trouser'], t, 'poses'))
        for f in keys:
            if T.split_key(f)[0] == 'feet': out.append((f, ['Shoe', 'Sole'], key, 'poses+hem'))
    elif slot == 'feet':
        for l in keys:
            if T.split_key(l)[0] == 'legs': out.append((key, ['Shoe', 'Sole'], l, 'poses+hem'))
    elif slot == 'neck':
        # (a neck piece fitted to a face, W1-B's Henry bows, is drawn on every top: tested on each)
        tops = [f'{fit[0]}_{fit[1]}'] if fit and fit[0] == 'top' else [t for t in keys if T.split_key(t)[0] == 'top' and not have(f"{key.split('~')[0]}~{t}")]
        for t in tops: out.append((t, ['Shirt', 'Button'], key, 'poses+front'))
    elif slot == 'dress':                       # (women) the yoke, arms and legs inside the bodice, sleeves and skirt
        out.append(('body', ['Skin'], key, 'poses+nohands+vis'))
    elif slot == 'belt':                        # (women) the gown under the belt it is fitted to
        dress = f'{fit[0]}_{fit[1]}' if fit else f"dress_{first('dress', lambda L: L.get('belt') == ident)}"
        if have(dress): out.append((dress, ['Dress'], key, 'poses+vis'))
    elif slot == 'extra' and T.gender_of(body) == 'm' and ident == 'eveningGloves':
        # (W1-B, men's gloves) the hands inside the gloves, and the glove's wrist inside every top's sleeve and cuff
        out.append(('body', ['Skin'], key, 'poses+vis'))
        for t in keys:
            if T.split_key(t)[0] == 'top' and '~' not in t: out.append((key, ['Glove'], t, 'poses+vis'))
    elif slot == 'extra' and T.gender_of(body) == 'f' and ident == 'eveningGloves':
        # (W1-B, women's opera gloves) the arms and hands inside the gloves, and the glove inside every gown's sleeves
        # (not its hands: the gowns' skirts hold the curled fingertips at rest, as they hold the bare hands)
        out.append(('body', ['Skin'], key, 'poses+vis'))
        for d in keys:
            if T.split_key(d)[0] == 'dress' and '~' not in d: out.append((key, ['Glove'], d, 'poses+nohands+vis'))
    return out

def main():
    ap = argparse.ArgumentParser(); ap.add_argument('--body', default='m'); ap.add_argument('--item', required=True)
    ap.add_argument('--parts', default=str(REPO / 'assets' / 'characters' / 'parts')); ap.add_argument('--out', required=True)
    ap.add_argument('--record', action='store_true', help="write the result into the piece's scene extras (then run manifest.py)")
    a = ap.parse_args(sys.argv[1:] if '--' not in sys.argv else sys.argv[sys.argv.index('--') + 1:])
    root = Path(a.parts); bdir = root / a.body; out = Path(a.out); out.mkdir(parents=True, exist_ok=True)
    keys = sorted(p.stem for p in bdir.glob('*.glb') if p.stem != 'body')
    rig = Rig(bdir / 'body.glb'); cache = {}
    piece = lambda k: cache.setdefault(k, Piece(bdir / f'{k}.glb'))
    items = keys if a.item == 'all' else a.item.split(',')
    summary = []
    for key in items:
        pairs = pairs_for(key, keys, None, a.body); res = dict(key=key, poses=[f'{c} {f:g}' for c, f in POSES], pairs=[], pokes=0, pierce=0)
        for inner, mats, cover, mode in pairs:
            pi, pc = piece(inner), piece(cover)
            mats = [m for m in mats if m in pi.prims]
            if not mats: continue
            poses = [POSES[0]] if mode == 'bind' else POSES
            r = test_pair(rig, pi, mats, pc, poses, hem_band=(0.020 if 'hem' in mode else None),
                          skip_bones=(('hand.L', 'hand.R') if 'nohands' in mode else ()), vis='vis' in mode)
            ent = dict(inner=f'{inner}:{"+".join(mats)}', cover=cover, tested=r['tested'], pokes=r['pokes'],
                       exempt=('the shoe rim in the hem band (20 mm)' if 'hem' in mode else 'the hands (no gown covers them)' if 'nohands' in mode else None),
                       points={k: v[:20] for k, v in r['points'].items() if v})
            n = sum(r['pokes'].values()); res['pokes'] += n
            if 'front' in mode:
                f = front_pierce(rig, pi, mats, pc); ent['frontPierce'] = f['pierce']; res['pierce'] += f['pierce']
                if f['pierce']: picture(out / f'{key}.pierce.png', pc, pc.posed(rig.skin_matrices(None)), f['points'], f'{key}: {inner} in front of it (bind)')
            if n:
                worst = max(r['pokes'], key=r['pokes'].get); c, fr = worst.split(' ')
                picture(out / f'{key}.poke.png', pc, pc.posed(rig.skin_matrices(c, float(fr))), r['points'][worst], f'{key}: pokes of {inner} at {worst}')
            res['pairs'].append(ent)
        res['pass'] = res['pokes'] == 0 and res['pierce'] == 0
        (out / f'{key}.poke.json').write_text(json.dumps(res, indent=1))
        if a.record:
            import record as R
            R.record(bdir / f'{key}.glb', 'poke', dict(pokes=res['pokes'], frontPierce=res['pierce'], pairs=len(res['pairs']), poses=len(POSES), passed=res['pass']))
        print(f"poke {key}: {res['pokes']} pokes, {res['pierce']} front pierces over {len(res['pairs'])} pairs -> {'PASS' if res['pass'] else 'FAIL'}"
              + ''.join(f"\n    {p['inner']} -> {p['cover']}: tested {p['tested']}, pokes {p['pokes']}" + (f", front {p['frontPierce']}" if 'frontPierce' in p else '') for p in res['pairs']))
        summary.append(res)
    return 0 if all(r['pass'] for r in summary) else 1

if __name__ == '__main__':
    rc = main(); sys.stdout.flush(); os._exit(rc)
