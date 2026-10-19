# Wardrobe W1-B, the women's new pieces on the shared female body 'f' (Blender bpy 4.2, headless). Registered into the
# female specs (parts/female/spec.py: `register` at its end adds the gown, the belts' fits and the hair sources;
# `items(add)` at the end of its items() adds the rest) and built by the female driver like every other piece:
#   LD_LIBRARY_PATH=... python3 tools/char-pipeline/parts/female/build.py --only <key or id>[,...] [--out <draft dir>]
#
#   A2 Lantern charm   extra_lantern~dress_<gown>        a fine gold chain at the base of the neck and a small brass
#                                                         lantern pendant (one fit per gown: it lies on that neckline)
#   A3 Braided crown   hairStyle_lamplighter(~face_*)    hair drawn back from a centre parting and a three-strand plait
#                                                         pinned round the head like a coronet
#   A4 Evening gloves  extra_eveningGloves               long white opera gloves to above the elbow (on the body's arms:
#                                                         under every gown's sleeve)
#   A5 Black orchid    extra_blackOrchid~dress_<gown>    a corsage of two black orchids at her left shoulder (one fit
#                                                         per gown: it lies on that bodice)
#   B2 Deco beaded gown dress_decoBeaded                 a 1920s drop-waist gown: V neck, cap sleeves, Art Deco beadwork
#                                                         (chevron panels, beaded borders, a zigzag band) and a beaded
#                                                         fringe hem, on the column skirt's walk-safe weights
#   B4 Marcel waves    hairStyle_marcel(~face_*)         a sleek 1920s bob set in deep S finger waves with a mirror shine
#
# Conventions as in spec.py: heights are PERCENT OF STANDING HEIGHT FROM THE TOP (g.zp(pct) -> metres) in the body's
# frame, x/y in metres; Blender Z up, the guest faces -Y, HER right is -X; longitude u: 0 front, 0.25 her right,
# 0.5 back, 0.75 her left. The hairstyles are written against the face they are fitted to (its skull: g.zt top,
# g.zc chin, g.Y0 head axis, g.skull_at), so one description fits every face.
import sys, math
import numpy as np
import bpy, bmesh
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree
import guest_kit as GK
import dress_kit as DK
import male_extras as MX
import victor_lib as L
import clara as CL
import eleanor as EL

sm = GK.sm
def _S(): return sys.modules['spec']

# fixed colours (the same items as the men's: parts/male/spec.py W1-B) and the gold
GLOVE_HEX, ORCHID_HEX, GLASS_HEX, GOLD_HEX = '#eef2fa', '#c9b6dc', '#f3e8cc', CL.COLOURS['gold']   # (the orchid's: its throat's lavender; orchid_paint tints the rest)
GOLD_SHEEN = EL.CFG['sheen']['Gold']
DRESS_IDS = ['column', 'ballgown', 'aline', 'decoBeaded']

# =====================================================================================================================
# helpers: surfaces of pieces built earlier in this scene, weights copied from the surface under a piece, closed tubes
# =====================================================================================================================
_bvh = {}
def bvh_of(name):
    ob = bpy.data.objects.get(name)
    if ob is None: raise RuntimeError(f'{name} is not built yet (list it in the item ctx)')
    key = (ob.as_pointer(), len(ob.data.vertices))
    ent = _bvh.get(name)
    if ent is None or ent[0] != key:
        bm = bmesh.new(); bm.from_mesh(ob.data); bmesh.ops.triangulate(bm, faces=bm.faces[:]); t = BVHTree.FromBMesh(bm); bm.free()
        ent = _bvh[name] = (key, t)
    return ent[1]

def outer(names, inside, d, reach=0.6):
    """The OUTERMOST surface of the named pieces met by a ray coming from inside + d * reach back toward `inside`
    -> (point, outward normal) or (None, None)."""
    d = Vector(d).normalized(); o = Vector(inside) + d * reach; best = None
    for nm in names:
        hit = bvh_of(nm).ray_cast(o, -d, reach)
        if hit[0] is None: continue
        dist = (hit[0] - o).length
        if best is None or dist < best[0]:
            n = Vector(hit[1]).normalized()
            if n.dot(d) < 0: n = -n
            best = (dist, hit[0].copy(), n)
    return (best[1], best[2]) if best else (None, None)

def front_hit(names, x, z):
    """The outermost surface seen from the front (-Y) at (x, z)."""
    return outer(names, Vector((x, 0.0, z)), Vector((0.0, -1.0, 0.0)))

def copy_weights_from(objs, srcs, k=6):
    """Give each object the skin weights of the surface under it: an inverse-distance blend of the k nearest vertices of
    the named source pieces (the necklace on the neck and the bodice, the corsage on the bodice, the beads on the gown):
    the piece moves exactly with what it lies on, so nothing separates when walking."""
    pts, wts = [], []
    for nm in srcs:
        src = bpy.data.objects[nm]; names = {gr.index: gr.name for gr in src.vertex_groups}
        for v in src.data.vertices:
            pts.append(v.co.copy()); wts.append({names[e.group]: e.weight for e in v.groups if e.weight > 1e-4})
    tree = KDTree(len(pts))
    for i, p in enumerate(pts): tree.insert(p, i)
    tree.balance()
    for ob in objs:
        for vg in list(ob.vertex_groups): ob.vertex_groups.remove(vg)
        groups = {}
        for v in ob.data.vertices:
            acc = {}
            for co, i, d in tree.find_n(v.co, k):
                w = 1.0 / max(d, 1e-4)
                for b, x in wts[i].items(): acc[b] = acc.get(b, 0.0) + w * x
            s_ = sum(acc.values()) or 1.0
            for b, x in acc.items():
                if b not in groups: groups[b] = ob.vertex_groups.new(name=b)
                groups[b].add([v.index], x / s_, 'REPLACE')

def copy_weights_surface(objs, src):
    """(Fixer, 19 Oct, art review ART-3) Give each vertex the skin weights of the exact point of `src`'s surface
    nearest to it: the three corners of the triangle under it, blended by where it lies in that triangle. A bead line
    lying on the skirt then moves exactly as the cloth under it does (the k-nearest blend of copy_weights_from mixed in
    vertices of other rows of the skirt, so the hem's bead lines slid through the cloth and its zigzag while walking)."""
    from mathutils.geometry import barycentric_transform
    names = {gr.index: gr.name for gr in src.vertex_groups}
    wts = [{names[e.group]: e.weight for e in v.groups if e.weight > 1e-4} for v in src.data.vertices]
    bm = bmesh.new(); bm.from_mesh(src.data); bmesh.ops.triangulate(bm, faces=bm.faces[:]); bm.verts.ensure_lookup_table()
    tris = [[v.index for v in f.verts] for f in bm.faces]; co = [v.co.copy() for v in bm.verts]; bm.free()
    tree = BVHTree.FromPolygons(co, tris, all_triangles=True)
    for ob in objs:
        for vg in list(ob.vertex_groups): ob.vertex_groups.remove(vg)
        groups = {}
        for v in ob.data.vertices:
            loc, _, fi, _ = tree.find_nearest(v.co)
            a, b, c = tris[fi]
            # barycentric weights of loc in (a, b, c): map the triangle onto the unit triangle
            q = barycentric_transform(loc, co[a], co[b], co[c], Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
            bw = [max(0.0, q.x), max(0.0, q.y), max(0.0, q.z)]; sb = sum(bw) or 1.0
            acc = {}
            for k_, vi in enumerate((a, b, c)):
                for bn, x in wts[vi].items(): acc[bn] = acc.get(bn, 0.0) + x * bw[k_] / sb
            s_ = sum(acc.values()) or 1.0
            for bn, x in acc.items():
                if bn not in groups: groups[bn] = ob.vertex_groups.new(name=bn)
                groups[bn].add([v.index], x / s_, 'REPLACE')

def put(g, ob, mat):
    """Add an object with one material and no weights yet (copy_weights_from gives them)."""
    ob.data.materials.clear(); ob.data.materials.append(g.M[mat]); g.parts.append(ob); return ob

def loop_ribbon(name, pts, normals, widths, thicks, n=8, closed=True, rot=0.0):
    """guest_kit's ribbon tube (an elliptical cross-section `widths` across the surface, `thicks` along its normal),
    CLOSED into a ring with no end caps when `closed` (a strand of a plait round the head, a chain round the neck): a
    closed shell, so the manifest's hole check sees no open loop. rot turns the cross-section (a diamond chain)."""
    P = [Vector(p) for p in pts]; Nn = [Vector(v).normalized() for v in normals]; m = len(P)
    bm = bmesh.new(); rings = []
    for i in range(m):
        a = P[(i - 1) % m] if closed else P[max(0, i - 1)]; b = P[(i + 1) % m] if closed else P[min(m - 1, i + 1)]
        t = (b - a); t = t.normalized() if t.length > 1e-9 else Vector((1, 0, 0))
        nn = Nn[i] - t * Nn[i].dot(t); nn = nn.normalized() if nn.length > 1e-9 else Vector((0, 0, 1))
        bb = t.cross(nn).normalized()
        rings.append([bm.verts.new(P[i] + bb * (widths[i] * 0.5 * math.cos(rot + k / n * 2 * math.pi)) + nn * (thicks[i] * 0.5 * math.sin(rot + k / n * 2 * math.pi)))
                      for k in range(n)])
    pairs = list(zip(rings, rings[1:] + ([rings[0]] if closed else [])))
    for a_, b_ in pairs:
        for k in range(n):
            j = (k + 1) % n; bm.faces.new((a_[k], a_[j], b_[j], b_[k]))
    if not closed:
        bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return L.new_object(name, bm)

def thin_tube(name, pts, r, n=3):
    """A fine bead line (a capped tube, n sides)."""
    return L.tube(name, [tuple(p) for p in pts], [r] * len(pts), n=n)

# =====================================================================================================================
# A2 THE LANTERN CHARM (extra, attach 'neck'): a fine gold chain resting at the base of the neck (over the gown where
# the neckline is high) and a little brass lantern hanging at the front (the hotel's Lantern card in miniature). The
# chain lies on the OUTERMOST surface of the neck and that gown, with the weights of what it lies on.
# =====================================================================================================================
NECKLACE = dict(back=29.6, side=30.9, front=33.0, n=64, r=0.00105, lift=0.0005)
NECKLACE_FRONT = {'column': 33.0, 'ballgown': 33.0, 'aline': 33.0, 'decoBeaded': 33.2}   # pct of the pendant's bail

def necklace_chain(g, did):
    names = ['body', f'dress_{did}']; Nk = NECKLACE; N = Nk['n']
    front = NECKLACE_FRONT.get(did, Nk['front'])
    pts, nrm, rr = [], [], []
    for i in range(N):
        phi = 2 * math.pi * i / N; c = math.cos(phi)
        pct = Nk['side'] + (front - Nk['side']) * max(0.0, c) ** 1.7 + (Nk['back'] - Nk['side']) * max(0.0, -c) ** 1.5
        z = g.zp(pct); d = Vector((math.sin(phi), -math.cos(phi), 0.0))
        # rest on the surface: the chain's own slope down to the front follows the trapezius (a horizontal ray)
        p, n = outer(names, Vector((0.0, 0.012, z)), d)
        if p is None: raise RuntimeError(f'necklace: no surface at phi {math.degrees(phi):.0f}')
        r = Nk['r'] * (1.18 if i % 2 else 0.82)                  # alternate link sizes: a fine chain in close-ups
        pts.append(p + n * (Nk['r'] + Nk['lift'])); nrm.append(n); rr.append(r)
    chain = loop_ribbon('Chain', pts, nrm, [2 * r for r in rr], [2 * r for r in rr], n=4, rot=math.pi / 4)
    return chain, pts[0]

def lantern_pendant(g, top, names, h=0.025):
    """A brass lantern (cap, glass, four posts, base and a ring) hanging under `top`, resting against the surface."""
    w = h * 0.54
    z_ring = top.z - 0.0042; z_cap = z_ring - 0.0040; z_gt = z_cap - h * 0.24; z_gb = z_gt - h * 0.48; z_base = z_gb - h * 0.13
    x = top.x
    ys = [front_hit(names, x, zz)[0] for zz in (z_cap, z_gt, (z_gt + z_gb) / 2, z_gb, z_base)]
    yb = min(p.y for p in ys if p is not None) - w * 0.5 - 0.0012
    parts = []
    ring = [(x, top.y + (yb - top.y) * 0.5 + 0.0034 * math.cos(a), z_ring + 0.0034 * math.sin(a)) for a in [2 * math.pi * k / 10 for k in range(11)]]
    parts.append(('gold', L.tube('LRing', ring, [0.0008] * len(ring), n=4)))
    parts.append(('gold', L.tube('LBail', [(x, top.y + (yb - top.y) * 0.5, z_ring - 0.0034), (x, yb, z_cap + 0.0005)], [0.0008] * 2, n=4)))
    cap = L.loft('LCap', [dict(z=z_cap - h * 0.24, w=w * 1.10, d=w * 1.10, r=0.6), dict(z=z_cap - h * 0.15, w=w * 0.88, d=w * 0.88, r=0.7),
                          dict(z=z_cap - h * 0.03, w=w * 0.32, d=w * 0.32, r=1.0), dict(z=z_cap, w=w * 0.14, d=w * 0.14, r=1.0)], n=8)
    glass = L.loft('LGlass', [dict(z=z_gb, w=w * 0.84, d=w * 0.84, r=0.7), dict(z=(z_gb + z_gt) / 2, w=w * 0.92, d=w * 0.92, r=0.7),
                              dict(z=z_gt, w=w * 0.84, d=w * 0.84, r=0.7)], n=8)
    base = L.loft('LBase', [dict(z=z_base, w=w * 0.70, d=w * 0.70, r=0.7), dict(z=z_base + h * 0.06, w=w * 1.04, d=w * 1.04, r=0.6),
                            dict(z=z_gb + 0.0008, w=w * 0.96, d=w * 0.96, r=0.6)], n=8)
    for ob in (cap, glass, base): L.translate_verts(ob, (x, yb, 0.0))
    parts += [('gold', cap), ('glass', glass), ('gold', base)]
    for sx, sy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        px, py = x + sx * w * 0.45, yb + sy * w * 0.45
        parts.append(('gold', L.tube('LPost', [(px, py, z_gb - 0.0008), (px + sx * 0.0005, py + sy * 0.0005, (z_gb + z_gt) / 2), (px, py, z_gt + 0.0008)], [0.0009] * 3, n=4)))
    return [put(g, ob, mat) for mat, ob in parts]

def extra_lantern_on(did):
    def build(g):
        chain, low = necklace_chain(g, did)
        put(g, chain, 'gold')
        objs = [chain] + lantern_pendant(g, low, ['body', f'dress_{did}'])
        copy_weights_from(objs, ['body', f'dress_{did}'])
    return build

# =====================================================================================================================
# A5 THE BLACK ORCHID CORSAGE (extra, attach 'chest'): two near-black orchids and three buds pinned on her LEFT
# shoulder, below the neckline, facing out and a little up (the game camera looks down). The same flower as the men's
# buttonhole (parts/male/spec.py, reshaped by the fixer on 19 Oct after the art review read the first one as a bat or
# a bird: three narrow sepals, two broad petals, a broad frilled lip with a pale lavender throat, a small pale column;
# the sepals, petals and frill near-black plum, so it reads as a black orchid, never navy and never the possessed
# crimson), at a lighter mesh (the extras' 1,500-triangle cap holds two blooms and the buds), on that gown's own
# bodice surface. The shapes and tints below are copied from the men's spec: change both together.
# =====================================================================================================================
ORCHID_AT = {'column': (0.112, 35.9), 'ballgown': (0.110, 36.3), 'aline': (0.110, 35.6), 'decoBeaded': (0.112, 35.9)}   # her left breast-shoulder
# (angle deg in the flower's plane: 90 = up, length, width, cup toward the tip, kind) at size 1 (metres)
ORCHID_TEPALS = [(90, 0.023, 0.0075, 0.0030, 'sepal'), (222, 0.021, 0.0068, 0.0026, 'sepal'), (318, 0.021, 0.0068, 0.0026, 'sepal'),
                 (12, 0.022, 0.0150, 0.0030, 'petal'), (168, 0.022, 0.0150, 0.0030, 'petal')]
# the lip: a broad frilled petal hanging below the centre, cupped toward the viewer (length, width, cup, frill)
ORCHID_LIP = dict(length=0.0175, width=0.0190, cup=0.0034, frill=0.0011, scallop=0.075)
# the post-bake tints (linear RGB factors on the pale lavender base; the bake's own shading is kept under them):
# sepals and petals near-black plum (a touch lighter at the tips: the outline keeps on a dark jacket), the lip's frill
# as dark, its throat a pale lavender streak down the middle of its FRONT, the column pale
ORCHID_TINT = dict(centre=(0.0200, 0.0122, 0.0132), tip=(0.0420, 0.0240, 0.0300), rim=(0.0260, 0.0140, 0.0180),
                   throat=(0.80, 0.74, 0.84), column=(0.95, 0.93, 0.95))
def _frame(n, up_tilt):
    N = Vector(n).normalized(); U = Vector((0, 0, 1)); U = (U - N * U.dot(N)).normalized()
    t = math.radians(up_tilt); N2 = (N * math.cos(t) + U * math.sin(t)).normalized(); U2 = (U * math.cos(t) - N * math.sin(t)).normalized()
    return U2.cross(N2).normalized(), U2, N2

def _tepal(name, ang, ln, wd, cup, kind, layer, lift, uv=(10, 7)):
    """One sepal or petal from the centre along `ang`, thin, cupped toward the viewer; `lift` keeps a part that rises
    in the (tilted) frame clear of the cloth."""
    t = L.uvsphere(name, 1.0, (0, 0, 0), scale=(wd / 2, 0.0009, ln / 2), u=uv[0], v=uv[1])
    a = math.radians(ang - 90)
    for v in t.data.vertices:
        s_ = max(0.0, min(1.0, (v.co.z / (ln / 2) + 1.0) / 2.0))           # 0 at the base .. 1 at the tip
        if kind == 'petal': tt = s_ ** 0.72; xf = 1.0                      # widest nearer the tip, a round tip
        else: tt = s_ ** 1.35; xf = 1.0 - 0.55 * GK.sm((s_ - 0.55) / 0.45)  # widest a third along, pointed
        zz = tt * ln; x = v.co.x * xf
        edge = abs(v.co.x) / (wd / 2 + 1e-9)
        ruffle = (0.0009 if kind == 'petal' else 0.0003) * math.sin(s_ * math.pi * 5.0) * edge * s_
        X, Z = x * math.cos(a) - zz * math.sin(a), x * math.sin(a) + zz * math.cos(a)
        y_ = v.co.y + cup * s_ * s_ + ruffle + layer + lift * max(0.0, Z)
        v.co = Vector((X, y_, Z))
    t.data.update(); return t
def orchid_parts(tag='', lift=0.0, tepal_uv=(10, 7), lip_uv=(16, 8), column_uv=(6, 4)):
    """One orchid in its own frame (x across, z up, y out toward the viewer), size 1: [(object, part)], part in
    'tepal', 'lip', 'column', and for the lip per vertex (front face?, along 0..1, across 0..1) for its colours. The
    sepals behind, the petals a touch in front, the lip in front of them."""
    out = []
    for k, (ang, ln, wd, cup, kind) in enumerate(ORCHID_TEPALS):
        out.append((_tepal(f'Tepal{tag}{k}', ang, ln, wd, cup, kind, 0.0 if kind == 'sepal' else 0.0006, lift, tepal_uv), 'tepal', None))
    # the lip: broad and rounded, hanging down from just below the centre, its sides cupped forward round a pale throat,
    # its edge frilled
    Lp = ORCHID_LIP; ln, wd = Lp['length'], Lp['width']
    lip = L.uvsphere(f'Lip{tag}', 1.0, (0, 0, 0), scale=(wd / 2, 0.0010, ln / 2), u=lip_uv[0], v=lip_uv[1])
    meta = []
    for v in lip.data.vertices:
        s_ = max(0.0, min(1.0, (-v.co.z / (ln / 2) + 1.0) / 2.0))          # 0 at its base (top) .. 1 at its tip (bottom)
        tt = s_ ** 0.8
        xf = 0.5 + 0.5 * GK.sm(s_ / 0.5)                                    # narrow at the base, broad and round below
        x = v.co.x * xf; edge = abs(v.co.x) / (wd / 2 + 1e-9)
        meta.append((v.co.y > 0.0, s_, edge))
        rim = max(edge, GK.sm((s_ - 0.7) / 0.3))
        th = math.atan2(v.co.x, -v.co.z + 1e-9)
        frill = Lp['frill'] * math.sin(th * 8.0) * rim * rim
        y_ = v.co.y + Lp['cup'] * edge * edge + 0.0016 * s_ + frill + 0.0016
        zc = -0.0015 - 0.5 * ln; z_ = -0.0015 - tt * ln
        k = 1.0 + Lp['scallop'] * math.sin(th * 9.0) * rim * GK.sm((s_ - 0.25) / 0.3)   # a scalloped, frilled edge
        v.co = Vector((x * k, y_, zc + (z_ - zc) * k))
    lip.data.update(); out.append((lip, 'lip', meta))
    col = L.uvsphere(f'Column{tag}', 0.0021, (0.0, 0.0030, -0.0010), scale=(1.0, 1.0, 1.7), u=column_uv[0], v=column_uv[1])
    out.append((col, 'column', None))
    return out
CORSAGE_TILT = 18.0
def orchid_bloom(g, C, R, U, N, size, turn, tag, parts):
    """One bloom at C in the frame (R across, U up, N out), turned `turn` degrees in its plane; a part that rises in the
    tilted frame is lifted clear of the bodice. Records its lip and column vertices in `parts` (for the colours)."""
    ca, sa = math.cos(math.radians(turn)), math.sin(math.radians(turn))
    Rt, Ut = R * ca + U * sa, -R * sa + U * ca
    lift = math.tan(math.radians(CORSAGE_TILT))
    def place(ob):
        for v in ob.data.vertices:
            p = v.co.copy(); inplane = Rt * p.x + Ut * p.z
            v.co = C + (inplane + N * (p.y + lift * max(0.0, inplane.dot(U)))) * size
        ob.data.update(); return ob
    out = []
    for ob, part, meta in orchid_parts(tag, 0.0, tepal_uv=(8, 6), lip_uv=(12, 7), column_uv=(6, 4)):
        place(ob)
        if part == 'lip': parts['lip'] += [(v.co.copy(), *mm) for v, mm in zip(ob.data.vertices, meta)]
        if part == 'column': parts['column'] += [v.co.copy() for v in ob.data.vertices]
        out.append(ob)
    return out

def extra_orchid_on(did):
    def build(g):
        x, pct = ORCHID_AT[did]; z = g.zp(pct)
        p, n = front_hit([f'dress_{did}'], x, z)
        if p is None: raise RuntimeError(f'corsage: no dress_{did} surface at {x}, {pct}')
        R, U, N = _frame(n, CORSAGE_TILT)
        C = p + N * 0.0050
        g.corsage = getattr(g, 'corsage', {})
        blooms = [(C, 1.50, -12.0), (C - R * 0.040 - U * 0.026 - N * 0.002, 1.05, 28.0)]        # the second lower, toward the arm
        frames = []
        objs = []
        for i, (c, s, turn) in enumerate(blooms):
            parts = {'lip': [], 'column': []}
            objs += orchid_bloom(g, c, R, U, N, s, turn, i, parts)
            frames.append((c, R.copy(), U.copy(), N.copy(), s, parts))
        buds = []
        for k, (dx, dz) in enumerate(((0.030, 0.020), (0.040, 0.004), (-0.016, 0.034))):     # buds on short stems
            b = C + R * dx + U * dz + N * 0.002
            objs.append(L.uvsphere(f'Bud{k}', 1.0, (0, 0, 0), scale=(0.0042, 0.0042, 0.0075), u=6, v=5))
            M = Matrix((R, N, U)).transposed()
            for v in objs[-1].data.vertices: v.co = b + M @ v.co
            objs[-1].data.update(); buds += [v.co.copy() for v in objs[-1].data.vertices]
            st = [C + R * dx * 0.3 + U * dz * 0.3, b - U * 0.006]
            objs.append(L.tube(f'BudStem{k}', [tuple(q) for q in st], [0.0011, 0.0009], n=4))
            buds += [v.co.copy() for v in objs[-1].data.vertices]
        g.corsage[f'dress_{did}'] = (frames, buds)
        for ob in objs: put(g, ob, 'petal')
        copy_weights_from(objs, [f'dress_{did}'])
    return build

def orchid_tint(c, t):
    return (c[0] * t[0], c[1] * t[1], c[2] * t[2], c[3])
def orchid_paint(col, verts, frames):
    """Tint the baked flower(s): `frames` [(C, R, U, N, size, parts)]; a vertex of a lip or a column (matched by
    position) gets the lip's colours (a pale throat streak down the middle of its front, a dark frill) or the column's,
    every other one the sepal/petal plum (lighter at the tips). Writes col.data."""
    from mathutils import kdtree
    trees = []
    for C, R, U, N, size, parts in frames:
        kl = kdtree.KDTree(max(1, len(parts['lip'])))
        for i, (p, *_) in enumerate(parts['lip']): kl.insert(p, i)
        kl.balance()
        kc = kdtree.KDTree(max(1, len(parts['column'])))
        for i, p in enumerate(parts['column']): kc.insert(p, i)
        kc.balance()
        trees.append((C, R, U, N, size, parts, kl, kc))
    T = ORCHID_TINT
    mix = lambda a, b, k: tuple(a[j] + (b[j] - a[j]) * k for j in range(3))
    for i, v in enumerate(verts):
        best = None
        for C, R, U, N, size, parts, kl, kc in trees:
            d = (v.co - C) / size; r = math.hypot(d.dot(R), d.dot(U))
            if best is None or r < best[0]: best = (r, parts, kl, kc)
        r, parts, kl, kc = best
        c = col.data[i].color
        if kc.find(v.co)[2] < 1e-5: col.data[i].color = orchid_tint(c, T['column']); continue
        hit = kl.find(v.co)
        if hit[2] < 1e-5:
            _, front, s_, edge = parts['lip'][hit[1]]
            if not front: col.data[i].color = orchid_tint(c, T['rim']); continue
            k = max(GK.sm((edge - 0.10) / 0.35), GK.sm((s_ - 0.55) / 0.35))      # the throat: a streak down the middle
            col.data[i].color = orchid_tint(c, mix(T['throat'], T['rim'], k)); continue
        col.data[i].color = orchid_tint(c, mix(T['centre'], T['tip'], GK.sm(r / 0.024) ** 1.5))

def orchid_colours(g, mesh):
    """Post-bake: the sepals and petals near-black plum, the lips' throats pale lavender to a plum frill, the columns
    pale, the buds and their stems the darkest plum."""
    key = mesh.name.split('~')[1] if '~' in mesh.name else None
    got = getattr(g, 'corsage', {}).get(key)
    if not got: return
    frames, buds = got
    col = mesh.data.color_attributes['Col']
    kb = KDTree(max(1, len(buds)))
    for i, q in enumerate(buds): kb.insert(q, i)
    kb.balance()
    verts = mesh.data.vertices
    bud = [kb.find(v.co)[2] < 1e-5 for v in verts]
    for i in range(len(verts)):
        if bud[i]: col.data[i].color = orchid_tint(col.data[i].color, ORCHID_TINT['centre'])
    # the flowers' own vertices, painted through views of the colours that keep their indices
    flower = [i for i in range(len(verts)) if not bud[i]]
    from types import SimpleNamespace
    orchid_paint(SimpleNamespace(data=[col.data[i] for i in flower]), [verts[i] for i in flower], frames)

# =====================================================================================================================
# A4 EVENING GLOVES (extra, attach 'hands'): long white opera gloves from the fingertips to above the elbow, over the
# body's own arms and soft hands (every radius a little larger; the same skin weights: the hand, the forearm and the
# upper arm split at the elbow as the arm is), with soft gathers at the wrist. The top ends at 45.6 %, under the column
# gown's short sleeve; under the ballgown's cap sleeve it shows its full length; under the A-line's long sleeve only the
# hand shows (the rest lies inside the sleeve, which clears it).
# =====================================================================================================================
GLOVE_TOP, GLOVE_OUT, GLOVE_FINGER_OUT = 45.6, 0.0024, 0.0037
# (fixer, 19 Oct) The body's skin under the gloves is not drawn (scene extras `hidesSkin`, src/render/avatarParts.js):
# the hands and forearms whole, the upper arm below this height (metres, bind pose: the glove's top ring zp(GLOVE_TOP),
# less 0.5 mm; the rolled lip turns in below it). It closes the last skin flecks along the glove's seams and outline.
GLOVE_HIDE_BELOW = 0.9025
GLOVE_HIDES = ['hand.L', 'hand.R', 'forearm.L', 'forearm.R', {'bone': 'upperarm.L', 'below': GLOVE_HIDE_BELOW}, {'bone': 'upperarm.R', 'below': GLOVE_HIDE_BELOW}]
def glove_side(g, A, s, tag):
    zp = g.zp; Hd = A['hand']
    assert abs(zp(GLOVE_TOP) - 0.0005 - GLOVE_HIDE_BELOW) < 0.001, f'the glove top moved ({zp(GLOVE_TOP):.4f}): update GLOVE_HIDE_BELOW'
    SX, ZJ, (ex, ey, ZE), (hx, hy, ZW), xy = GK.arm_path(g, A, s)
    z_end = zp(A['sleeve_end']); z0 = zp(A['cuff_end']) + 0.012
    base = Vector((hx + s * Hd.get('out', 0.004), hy, 0.0))
    pl, pw, pt = Hd['palm_len'], Hd['palm_w'], Hd['palm_t']; o2 = 2 * GLOVE_OUT
    # the arm's stations (width x, depth y), by height
    st = []
    for zs, w, d in A['stations']:
        if zs == 'end': z = z_end
        elif isinstance(zs, tuple): continue
        else: z = zp(zs)
        st.append((z, w, d))
    st.sort()
    def arm_wd(z):
        if z <= st[0][0]: return st[0][1:]
        for (z0_, w0, d0), (z1, w1, d1) in zip(st, st[1:]):
            if z0_ <= z <= z1: t = (z - z0_) / max(1e-9, z1 - z0_); return (w0 + (w1 - w0) * t, d0 + (d1 - d0) * t)
        return st[-1][1:]
    rings = []
    # the soft palm (dress_kit.soft_hands' profile), the wrist ball and the arm's end, as one envelope by height
    PALM = [(1.00, 0.55, 0.70), (0.92, 0.80, 0.90), (0.78, 0.95, 0.98), (0.55, 1.02, 1.02), (0.30, 1.00, 0.98), (0.10, 0.86, 0.86),
            (-0.02, 0.70, 0.72), (-0.10, 0.62, 0.64)]
    def palm_wd(z):
        f = (z0 - z) / pl
        if f > 1.0 or f < -0.125: return (0.0, 0.0)
        f = max(f, -0.10)                      # (its top cap)
        fs = [q[0] for q in PALM][::-1]
        return (pt * float(np.interp(f, fs, [q[1] for q in PALM][::-1])), pw * float(np.interp(f, fs, [q[2] for q in PALM][::-1])))
    wr = A['stations'][0][1] * 0.47; wz = z0 - 0.016
    def ball_wd(z):
        t = (z - wz) / (1.25 * wr)
        if abs(t) >= 1.0: return (0.0, 0.0)
        k = math.sqrt(1.0 - t * t); return (2 * 0.95 * wr * k, 2 * wr * k)
    def env(z):
        """The bounding box (centre, width, depth) of the palm, the wrist ball and the arm's end at height z."""
        bx = []
        pw_, pd_ = palm_wd(z)
        if pw_: bx.append((base.x, base.y, pw_, pd_))
        bw_, bd_ = ball_wd(z)
        if bw_: bx.append((xy(z0 - 0.012)[0] + s * Hd.get('out', 0.004) * 0.5, xy(z0 - 0.012)[1], bw_, bd_))
        if z >= z_end - 0.002:
            aw, ad = arm_wd(z); ax, ay = xy(z); bx.append((ax, ay, aw, ad))
        x0 = min(c[0] - c[2] / 2 for c in bx); x1 = max(c[0] + c[2] / 2 for c in bx)
        y0 = min(c[1] - c[3] / 2 for c in bx); y1 = max(c[1] + c[3] / 2 for c in bx)
        return (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0
    for f in (1.00, 0.92, 0.55):                                   # the hand, bottom up (the palm's own rings)
        w, d = palm_wd(z0 - pl * f)
        rings.append(dict(z=z0 - pl * f, w=w + o2 + 0.0030, d=d + o2 + 0.0030, r=1.0, x=base.x, y=base.y))
    for zz in (z0 - 0.026, z0 - 0.012, z0 + 0.004, z0 + 0.011):   # the wrist: the palm, the wrist ball and the arm's end inside
        x, y, w, d = env(zz)
        rings.append(dict(z=zz, w=w + o2 + 0.0040, d=d + o2 + 0.0040, r=1.0, x=x, y=y))
    # the arm up to the glove's top, on the arm's own stations (52 and the elbow at 49.5: the arm bends there), with soft
    # gathers round the forearm
    for zz, extra in ((zp(57.0), 0.0034), (zp(56.0), 0.0), (zp(55.3), 0.0030), (zp(52.0), 0.0), (zp(49.5), 0.0), (zp(GLOVE_TOP), 0.0)):
        w, d = arm_wd(zz); x, y = xy(zz)
        rings.append(dict(z=zz, w=w + o2 + 2 * extra, d=d + o2 + 2 * extra, r=1.0, x=x, y=y))
    assert all(r1['z'] > r0['z'] for r0, r1 in zip(rings, rings[1:])), 'glove rings out of height order'
    # the rolled top edge: turned in to the arm (no gap to see into)
    w, d = arm_wd(zp(GLOVE_TOP) - 0.004); x, y = xy(zp(GLOVE_TOP) - 0.004)
    top = rings[-1]
    rings.append(dict(z=top['z'] + 0.0025, w=top['w'] - 0.0012, d=top['d'] - 0.0012, r=1.0, x=top['x'], y=top['y']))
    sleeve = L.loft(f'GloveArm{tag}', rings, n=12, cap_bottom=True, cap_top=False)
    bm = bmesh.new(); bm.from_mesh(sleeve.data)
    edge = [e for e in bm.edges if e.is_boundary]
    ret = bmesh.ops.extrude_edge_only(bm, edges=edge)
    for v in [q for q in ret['geom'] if isinstance(q, bmesh.types.BMVert)]:
        dv = Vector((v.co.x - x, v.co.y - y, 0.0)); k = (w * 0.5 + 0.0006) / max(1e-6, dv.length)
        v.co = Vector((x + dv.x * k, y + dv.y * k, v.co.z - 0.006))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(sleeve.data); bm.free()
    put(g, sleeve, 'glove')
    # weights: the hand below the wrist, forearm / upper arm split at the elbow (as the body's arm), blended at the wrist
    vg = {b: sleeve.vertex_groups.new(name=b) for b in (f'hand.{tag}', f'forearm.{tag}', f'upperarm.{tag}')}
    zw_lo, zw_hi = z0 - 0.020, z_end + 0.006
    for v in sleeve.data.vertices:
        z = v.co.z
        h = 1.0 - sm((z - zw_lo) / max(1e-6, zw_hi - zw_lo))
        up = sm((z - (ZE - 0.035)) / 0.07)
        if h > 1e-4: vg[f'hand.{tag}'].add([v.index], h, 'REPLACE')
        if (1 - h) * (1 - up) > 1e-4: vg[f'forearm.{tag}'].add([v.index], (1 - h) * (1 - up), 'REPLACE')
        if (1 - h) * up > 1e-4: vg[f'upperarm.{tag}'].add([v.index], (1 - h) * up, 'REPLACE')
    # fingers and thumb: the soft hand's own (dress_kit.soft_hands), a little thicker
    out = Vector((s, 0, 0)); fwd = Vector((0, -1, 0)); down = Vector((0, 0, -1)); fo = GLOVE_FINGER_OUT
    for i, (yo, r, ln, bend) in enumerate(Hd['fingers']):
        p0 = Vector((base.x + s * Hd.get('finger_out', 0.004), hy + yo, z0 - pl * 0.80))
        pts = GK._curl(p0, down, -out, ln, bend, 3)
        tip = pts[-1] + (pts[-1] - pts[-2]).normalized() * (r * 0.45 + fo * 0.6)
        rad = [r * (1.0 - 0.12 * k / 3) + fo for k in range(4)]
        pts.append(tip); rad.append(r * 0.55 + fo)
        pts.append(tip + (pts[-1] - pts[-2]).normalized() * (r * 0.35 + fo * 0.4)); rad.append(r * 0.18 + fo * 0.5)
        g.add(L.tube(f'GFinger{tag}{i}', [tuple(p) for p in pts], rad, n=7), 'glove', f'hand.{tag}')
    T = Hd['thumb']
    p0 = Vector((base.x - s * T[1], hy + T[0], z0 - T[2]))
    dirn = (down * 0.85 + fwd * 0.30 - out * 0.20).normalized(); inw = (-out * 0.8 + fwd * -0.2).normalized()
    pts = GK._curl(p0, dirn, inw, T[4], T[5], 3)
    tip = pts[-1] + (pts[-1] - pts[-2]).normalized() * (T[3] * 0.45 + fo * 0.6)
    rad = [T[3] * (1.08 - 0.15 * k / 3) + fo * 1.2 for k in range(4)] + [T[3] * 0.55 + fo, T[3] * 0.18 + fo * 0.5]
    pts += [tip, tip + (tip - pts[-1]).normalized() * (T[3] * 0.35 + fo * 0.4)]
    g.add(L.tube(f'GThumb{tag}', [tuple(p) for p in pts], rad, n=7), 'glove', f'hand.{tag}')

def extra_gloves(g):
    A = _S().A
    for s, tag in ((1, 'L'), (-1, 'R')): glove_side(g, A, s, tag)

def glove_satin(g, mesh):
    """Post-bake: soft creases in the gathers at the wrist (a little darker between the folds)."""
    A = _S().A; col = mesh.data.color_attributes['Col']
    zs = [g.zp(p) for p in (57.0, 55.3)]
    for i, v in enumerate(mesh.data.vertices):
        d = min(abs(v.co.z - z) for z in zs)
        if d < 0.004:
            f = 0.90 + 0.10 * d / 0.004; c = col.data[i].color; col.data[i].color = (c[0] * f, c[1] * f, c[2] * f, c[3])

# =====================================================================================================================
# B2 THE DECO BEADED GOWN: a 1920s drop-waist evening gown. The shared upper torso and the ballgown's cap sleeves (the
# yoke and the shoulders every gown fits), a shallow V neckline, a straight bodice to the hips (55.5 %), the column
# skirt's walk-safe weights (it moves with the legs) to mid-calf, and a beaded fringe below the hem. Art Deco beadwork
# in the metal colour: a beaded border round the neckline and the sleeve hems, a panel of nested chevrons between two
# bead lines down the front and the back, a zigzag band and a beaded band above the fringe.
# =====================================================================================================================
DECO_WAIST = 55.0           # the dropped waist (the belts sit here on this gown)
DECO_SKIRT = dict(top=54.0, hem=84.0,
                  profile=[(54.0, 0.170, 0.128, -0.008), (56.0, 0.182, 0.135, -0.005), (58.0, 0.190, 0.139, -0.002), (62.0, 0.194, 0.141, 0.0),
                           (66.0, 0.192, 0.140, 0.0), (70.0, 0.188, 0.139, 0.0), (76.0, 0.184, 0.139, 0.0), (80.0, 0.182, 0.140, 0.0),
                           (84.0, 0.182, 0.142, 0.0)],
                  folds=dict(n=10, amp=[(54.0, 0.0), (60.0, 0.002), (72.0, 0.003), (84.0, 0.004)], sharp=0.3, phase=0.0),
                  hem_wave=0.0015, nr_per_fold=7, rows=14, lip=0.009, lining=0.08,
                  weights=dict(sway=0.0, follow=0.9, top_spine=0.35))
FRINGE = dict(n=84, top=83.3, long=6.4, short=5.2, v=0.6, width=0.0068, flare=0.012, rows=3)

def deco_fringe(g, skirt, K):
    """Beaded fringe strands hanging from inside the hem (their tops hidden under it), alternately long and short,
    a little longer at the front and back, flaring out at the ends."""
    zt = g.zp(FRINGE['top']); bm = bmesh.new()
    for i in range(FRINGE['n']):
        th = 2 * math.pi * (i + 0.5) / FRINGE['n']
        ln = (FRINGE['long'] if i % 2 == 0 else FRINGE['short']) + FRINGE['v'] * abs(math.cos(th)) ** 2
        zb = g.zp(K['hem'] + ln)
        dth = FRINGE['width'] / (2 * 0.17)
        cols = []
        for a in (th - dth, th + dth):
            col = []
            for j in range(FRINGE['rows'] + 1):
                t = j / FRINGE['rows']; z = zt + (zb - zt) * t
                p = g.skirt_pt(a, max(g.zp(K['hem']), z), -0.0030 + FRINGE['flare'] * sm((t - 0.15) / 0.85))
                col.append(bm.verts.new(Vector((p.x, p.y, z))))
            cols.append(col)
        for j in range(FRINGE['rows']):
            bm.faces.new((cols[0][j], cols[1][j], cols[1][j + 1], cols[0][j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return L.new_object('Fringe', bm)

def _wsurf(g, th, z):
    """The outer of bodice and skirt at ring angle th and height z (the dropped waist where they overlap)."""
    c = Vector((0.0, -0.008, z)); p = g.bod_r(th, z) if z >= g.zp(55.6) else None
    q = g.skirt_pt(th, z) if z <= g.zp(DECO_SKIRT['top']) else None
    if p is None: return q
    if q is None: return p
    return p if (p - c).length >= (q - c).length else q

def deco_beads(g, did='decoBeaded'):
    """The beadwork (gold, the metal colour), on the surfaces built just before (bodice, sleeves, skirt)."""
    zp = g.zp; objs = []
    bod = [o for o in g.parts if o.name.startswith('Bodice')][-1]
    sk = [o for o in g.parts if o.name.startswith('Skirt')][-1]
    sleeves = [o for o in g.parts if o.name.startswith('Sleeve')]
    tree_b = DK._bvh(bod); tree_s = DK._bvh(sk)
    def on(tree, x, z, back=False, lift=0.0018):
        o = Vector((x, 1.0 if back else -1.0, z)); d = Vector((0, -1.0 if back else 1.0, 0))
        hit = tree.ray_cast(o, d, 2.0)
        if hit[0] is None: return None
        n = Vector(hit[1]).normalized()
        if (n.y > 0) != back: n = -n
        return hit[0] + n * lift
    # the neckline border: just under the rolled edge, all round
    top = DK.neckline_fn(_S().DRESSES[did]['bod'])
    pts = []
    for i in range(64):
        phi = 2 * math.pi * i / 64; z = zp(top(phi) + 0.75)
        p = g.bod_r(phi, z); n = Vector((math.sin(phi), -math.cos(phi), 0.0))
        pts.append(p + n * 0.0018)
    objs.append(loop_ribbon('BeadNeck', pts, [Vector((math.sin(2 * math.pi * i / 64), -math.cos(2 * math.pi * i / 64), 0)) for i in range(64)],
                            [0.0052] * 64, [0.0034] * 64, n=4))
    # the chevron panels, front and back: two bead lines from under the neckline to the dropped waist, nested V's
    for back in (False, True):
        z_top = zp((32.6 if back else 33.9) + 1.6); z_bot = zp(DECO_WAIST - 0.6); xb = 0.052
        for sx in (1, -1):
            line = [on(tree_b, sx * xb, z_top + (z_bot - z_top) * t / 10, back) for t in range(11)]
            objs.append(thin_tube('BeadPanel', [p for p in line if p is not None], 0.0024, n=3))
        nchev = 9
        for k in range(nchev):
            zc = z_top + (z_bot - z_top) * (k + 0.6) / nchev; dz = 0.022
            ch = [on(tree_b, x, zc + dz * abs(x) / xb, back) for x in (-xb * 0.92, -xb * 0.46, 0.0, xb * 0.46, xb * 0.92)]
            objs.append(thin_tube('BeadChevron', [p for p in ch if p is not None], 0.0022, n=3))
    # the dropped waist: a beaded zigzag between two fine lines over the seam of bodice and skirt
    zzw = []
    for i in range(48):
        th = 2 * math.pi * i / 48; z = zp(DECO_WAIST + (1.0 if i % 2 else -0.15))
        p = _wsurf(g, th, z); n = Vector((math.sin(th), -math.cos(th), 0.0)); zzw.append(p + n * 0.0016)
    objs.append(loop_ribbon('BeadWaistZig', zzw, [Vector((math.sin(2 * math.pi * i / 48), -math.cos(2 * math.pi * i / 48), 0)) for i in range(48)],
                            [0.0042] * 48, [0.0030] * 48, n=3))
    for dz in (-0.75, 1.55):
        ln = [_wsurf(g, 2 * math.pi * i / 40, zp(DECO_WAIST + dz)) + Vector((math.sin(2 * math.pi * i / 40), -math.cos(2 * math.pi * i / 40), 0)) * 0.0014 for i in range(40)]
        objs.append(loop_ribbon('BeadWaistLine', ln, [Vector((math.sin(2 * math.pi * i / 40), -math.cos(2 * math.pi * i / 40), 0)) for i in range(40)],
                                [0.0036] * 40, [0.0026] * 40, n=3))
    # above the fringe: a zigzag band between the beaded hem band and a fine line
    z_band = zp(DECO_SKIRT['hem'] - 1.0)
    zz = []
    for i in range(56):
        th = 2 * math.pi * i / 56; z = zp(DECO_SKIRT['hem'] - (3.2 if i % 2 else 1.6))
        zz.append(g.skirt_pt(th, z, 0.0016))
    objs.append(loop_ribbon('BeadZig', zz, [Vector((math.sin(2 * math.pi * i / 56), -math.cos(2 * math.pi * i / 56), 0)) for i in range(56)],
                            [0.0040] * 56, [0.0028] * 56, n=3))
    line = [g.skirt_pt(2 * math.pi * i / 56, zp(DECO_SKIRT['hem'] - 3.9), 0.0014) for i in range(56)]
    objs.append(loop_ribbon('BeadLine', line, [Vector((math.sin(2 * math.pi * i / 56), -math.cos(2 * math.pi * i / 56), 0)) for i in range(56)],
                            [0.0036] * 56, [0.0026] * 56, n=3))
    return objs

def dress_deco(g):
    S = _S(); D = S.DRESSES['decoBeaded']; K = DECO_SKIRT
    DK.bodice(g, D['bod']); bod = g.parts[-1]
    DK.sleeves(g, S.A, D['slv'])
    sk = DK.skirt(g, K, S.RIG)
    fringe = deco_fringe(g, sk, K); put(g, fringe, 'gold')
    # (the strands' tops, hidden inside the hem, follow the cloth exactly: with the k-nearest blend they showed through
    # the skirt as a row of dashes at the back while walking; fixer, 19 Oct)
    copy_weights_surface([fringe], sk)
    beads = deco_beads(g)
    srcs = [bod.name, sk.name] + [o.name for o in g.parts if o.name.startswith('Sleeve')]
    for ob in beads: put(g, ob, 'gold')
    copy_weights_from(beads, srcs)
    # (the bead lines on the skirt above the fringe: the exact weights of the cloth under them)
    copy_weights_surface([o for o in beads if o.name.startswith(('BeadZig', 'BeadLine'))], sk)
    bod_r, skirt_pt = g.bod_r, g.skirt_pt
    def waist_pt(phi, z):                    # a belt hugs whichever is further out: bodice or skirt top
        p = bod_r(phi, z); q = skirt_pt(phi, z) if z <= g.zp(K['top']) else p
        c = Vector((0.0, -0.008, z))
        return p if (p - c).length >= (q - c).length else q
    g.dress_state = getattr(g, 'dress_state', {}); g.dress_state['decoBeaded'] = dict(waist_pt=waist_pt, skirt_r=g.skirt_r)

# =====================================================================================================================
# HAIR on the current face (both styles): helpers on the target skull, placed where the hair is built (hair_builder)
# =====================================================================================================================
def skull_frame(g):
    """Heights of the current face's features as f (0 = skull top, 1 = chin) and a z <-> f map."""
    C = g.C; zt, zc = g.zt, g.zc; span = C['z_chin'] - C['z_skull_top']
    fk = lambda key: (C[key] - C['z_skull_top']) / span
    return dict(zt=zt, zc=zc, hh=zt - zc, f=lambda z: (zt - z) / (zt - zc), z=lambda f: zt - f * (zt - zc),
                f_hairline=fk('z_hairline'), f_brow=fk('z_brow'), f_eye=fk('z_eye'), f_ear=fk('z_ear'), f_mouth=fk('z_mouth'),
                ear_h=C['ear_h'] / (zt - zc), ear_y=C['ear_y'], ear_out=C['ear_out'], Y0=g.Y0)

def u_of(P, Y0):
    return (np.arctan2(-(P[:, 1] - (Y0 + 0.02)), P[:, 0]) - math.pi / 2) / (2 * math.pi) % 1.0

def table_u(keys):
    """Periodic table in u (keys [(u, value)] over 0..1, wrapping)."""
    ks = sorted(keys); us = np.array([k[0] for k in ks]); vs = np.array([k[1] for k in ks])
    us = np.concatenate([us - 1.0, us, us + 1.0]); vs = np.concatenate([vs, vs, vs])
    return lambda u: np.interp(np.asarray(u) % 1.0, us, vs)

def sd_head_ext(g, P, z_hang):
    """sd_skull with the head's section held fixed below z_hang (hair hanging straight down from there: a bob)."""
    W, DF, DB, E = (DK._np_table(t) for t in (g.W, g.DF, g.DB, g.E))
    x, y, z = P[:, 0], P[:, 1] - g.Y0, P[:, 2]
    zq = np.clip(np.maximum(z, z_hang), g.zc, g.zt)
    w = np.maximum(W(zq), 2e-3); d = np.maximum(np.where(y < 0, DF(zq), DB(zq)), 2e-3); e = E(zq)
    ax, ay = np.abs(x) / w + 1e-9, np.abs(y) / d + 1e-9
    f = (ax ** e + ay ** e) ** (1.0 / e)
    gx = f ** (1 - e) * ax ** (e - 1) / w; gy = f ** (1 - e) * ay ** (e - 1) / d
    s = (f - 1.0) / np.maximum(np.sqrt(gx * gx + gy * gy), 1e-6)
    return np.maximum(s, z - g.zt)

def radial_skull_sd(g, Fr):
    """Distance to the current skull measured radially from a point inside the head (male_extras.radial_skull): unlike
    sd_skull's horizontal slices it is right over the crown too, so a cap of even thickness has a round top."""
    c0 = np.array([0.0, g.Y0 + 0.01, Fr['z'](0.48)]); Rs = MX.radial_skull(g, c0)
    def sd(P):
        u, v, r = MX.radial_uv(c0, P); return (r - Rs(u, v)) * 0.92
    return sd

def skull_top_at(g, x, y):
    """The skull's upper surface over (x, y): bisection down a vertical line (None if the line misses the skull)."""
    lo, hi = g.zc + 0.05, g.zt + 0.01
    if not g.inside_skull(Vector((x, y, lo))): return None
    for _ in range(30):
        m = 0.5 * (lo + hi)
        if g.inside_skull(Vector((x, y, m))): lo = m
        else: hi = m
    return Vector((x, y, lo))

def parting(g, xs, ys, lift):
    """A parting line on the hair's surface: skull top points over (x, y) pairs, lifted by lift(f) (the cap there)."""
    out = []
    for x, y in zip(xs, ys):
        p = skull_top_at(g, x, y)
        if p is None: continue
        f = (g.zt - p.z) / (g.zt - g.zc)
        out.append((p.x, p.y, p.z + float(lift(f))))
    return np.array(out)

def skull_normal(g, u, z, e=0.004):
    p = g.skull_at(u, z)
    tu = g.skull_at((u + e) % 1.0, z) - g.skull_at((u - e) % 1.0, z); tz = g.skull_at(u, z + e) - g.skull_at(u, z - e)
    n = tz.cross(tu).normalized()
    if n.dot(p - Vector((0.0, g.Y0, z))) < 0: n = -n
    return p, n

def _store(g, **kw):
    g.w1b = getattr(g, 'w1b', {}); g.w1b[g._building_key] = kw

def _local(g, mesh):
    """The hair's vertices in the frame it was built in (hair_builder moved it by d onto the face)."""
    d = g.hair_state[mesh.name]['d']
    return np.array([tuple(v.co - d) for v in mesh.data.vertices])

# =====================================================================================================================
# A3 THE BRAIDED CROWN: hair drawn back smooth from a centre parting (fine comb lines), and a thick three-strand plait
# pinned round the head like a coronet: over the top behind the hairline, above the ears, round the back of the head.
# The cap covers the faces' open crown (spec.CROWN) everywhere; nothing comes near the eyes.
# =====================================================================================================================
CROWN_HAIRLINE = [(0.0, 0.215), (0.04, 0.225), (0.09, 0.26), (0.13, 0.33), (0.16, 0.43), (0.185, 0.53), (0.205, 0.56),
                  (0.23, 0.55), (0.26, 0.60), (0.30, 0.76), (0.36, 0.835), (0.42, 0.865), (0.5, 0.875)]
CROWN_THICK = [(0.0, 0.011), (0.25, 0.012), (0.5, 0.014), (0.75, 0.014), (0.95, 0.010)]
PLAIT = dict(f_front=0.105, f_side=0.40, f_back=0.53, r=0.0092, w=0.0150, depth=0.0110, cycles=13, n=150, ring=7)

def crown_hairline(Fr, u):
    a = np.abs(((np.asarray(u) + 0.5) % 1.0) - 0.5)
    ks = CROWN_HAIRLINE; return np.interp(a, [k[0] for k in ks], [k[1] for k in ks])

def hair_crown(g):
    Fr = skull_frame(g); Y0 = g.Y0; zt, zc = Fr['zt'], Fr['zc']; hh = zt - zc
    TT = lambda f: np.interp(f, [k[0] for k in CROWN_THICK], [k[1] for k in CROWN_THICK])
    ts = np.linspace(0, 1, 10)
    P_part = parting(g, 0.0 * ts, Y0 - 0.185 + 0.13 * ts, lambda f: TT(f) + 0.0012); R_part = np.full(len(P_part), 0.0030)
    sk = radial_skull_sd(g, Fr)
    def sdf(P):
        f = (zt - P[:, 2]) / hh
        s = sk(P) - TT(np.clip(f, 0, 1.1))
        cut = Fr['z'](crown_hairline(Fr, u_of(P, Y0))) - P[:, 2]          # positive below the hairline: no hair
        s = DK.smax(s, cut, 0.006)
        s = DK.smax(s, -DK.sd_tube(P, P_part, R_part), 0.0025)           # the centre parting
        return s
    lo = (-0.26, Y0 - 0.26, zc - 0.08); hi = (0.26, Y0 + 0.26, zt + 0.04)
    ob = DK.sdf_object(g, 'Hair', sdf, lo, hi, 0.0042, drop=lambda p: g.inside_skull(p, -0.004), smooth=3, target_tris=5600, post_smooth=2)
    g.add(ob, 'hair', 'head')
    # the plait: three ribbon strands round a closed path on the cap
    Pl = PLAIT; N = Pl['n']; C, Nn = [], []
    for i in range(N):
        u = i / N; c = math.cos(2 * math.pi * u)
        f = Pl['f_side'] + (Pl['f_front'] - Pl['f_side']) * max(0.0, c) ** 1.3 + (Pl['f_back'] - Pl['f_side']) * max(0.0, -c) ** 1.6
        z = zt - f * hh
        p, n = skull_normal(g, u, z)
        th = float(TT(np.clip(f, 0, 1.1)))
        C.append(p + n * (th + Pl['r'] * 0.55)); Nn.append(n)
    # arc length, a whole number of plait cycles round the loop (each strand closes on itself)
    seg = [(C[(i + 1) % N] - C[i]).length for i in range(N)]; total = sum(seg); cum = [0.0]
    for s_ in seg[:-1]: cum.append(cum[-1] + s_)
    for k in range(3):
        pts, nrm, ws, ts = [], [], [], []
        for i in range(N):
            T = (C[(i + 1) % N] - C[(i - 1) % N]).normalized(); Nv = (Nn[i] - T * Nn[i].dot(T)).normalized(); B = T.cross(Nv)
            ph = 2 * math.pi * Pl['cycles'] * cum[i] / total + 2 * math.pi * k / 3
            q = C[i] + B * (Pl['w'] * math.sin(ph)) + Nv * (Pl['depth'] * math.sin(ph) * math.cos(ph))
            pts.append(q); nrm.append(Nv)
            ws.append(Pl['r'] * 2.25 * (0.94 + 0.06 * math.cos(2 * ph))); ts.append(Pl['r'] * 1.62)
        g.add(loop_ribbon(f'Plait{k}', pts, nrm, ws, ts, n=Pl['ring']), 'hair', 'head')
    g.hair_covers = lambda p, margin=0.02: bool(p.z > Fr['z'](float(crown_hairline(Fr, u_of(np.array([[p.x, p.y, p.z]]), Y0)[0]))) + margin)
    # the bake: darker in the parting and where strands cross (the AO does most of it)
    def gam(p):
        d = float(DK.sd_tube(np.array([[p.x, p.y, p.z]]), P_part, R_part)[0])
        return 0.010 * float(np.clip(1.0 - (d - 0.001) / 0.006, 0.0, 1.0))
    g.hair_groove = gam
    _store(g, zt=zt, zc=zc, Y0=Y0, C=[tuple(c) for c in C])
    return None

def crown_post(g, mesh):
    """Post-bake: fine comb lines in the hair drawn back (along the meridians), a soft sheen band, the plait untouched."""
    st = g.w1b.get(mesh.name)
    if not st: return
    P = _local(g, mesh); Y0, zt, zc = st['Y0'], st['zt'], st['zc']
    Cl = np.array(st['C']); col = mesh.data.color_attributes['Col']
    from scipy.spatial import cKDTree
    dpl = cKDTree(Cl).query(P)[0]
    u = u_of(P, Y0); f = (zt - P[:, 2]) / (zt - zc)
    lines = 0.5 + 0.5 * np.cos(2 * np.pi * u * 84 + 0.6 * np.sin(2 * np.pi * u * 9))     # ~1 cm apart at the brow
    m = 1.0 - 0.13 * lines ** 3 * np.clip((dpl - 0.022) / 0.012, 0, 1)
    for i, k in enumerate(m):
        if k < 0.999:
            c = col.data[i].color; col.data[i].color = (c[0] * k, c[1] * k, c[2] * k, c[3])

# =====================================================================================================================
# B4 MARCEL WAVES: a sleek 1920s bob from a deep side parting (her left), set in deep S-shaped finger waves running
# round the head, with a mirror shine on every crest; the ears show, the ends tuck under at the jaw, shorter at the
# nape. Kept off the face: the front wave sits above the brows, the sides lie behind the cheekbones.
# =====================================================================================================================
MARCEL = dict(thick=[(0.0, 0.016), (0.25, 0.019), (0.45, 0.023), (0.70, 0.025), (0.80, 0.030), (0.90, 0.028), (1.0, 0.024)],
              period=0.150, amp=0.0085, crest=0.60, f0=0.10, tilt=0.060, wiggle=0.050,
              hang=0.47, ear_clear=(0.034, 0.040, 0.046), part_x=0.062)
def marcel_hairline(Fr, u):
    """Lowest f of the hair by longitude: the front wave over the forehead (deeper on her right, away from the parting),
    the temples, over the ears (they show), the curtain behind them to the jaw, shorter at the nape."""
    u = np.asarray(u) % 1.0; a = np.abs(((u + 0.5) % 1.0) - 0.5); right = u < 0.5
    fe_top = Fr['f_ear'] - 0.5 * Fr['ear_h'] - 0.03
    kr = [(0.0, 0.250), (0.05, 0.285), (0.10, 0.315), (0.14, 0.355), (0.17, 0.44), (0.195, fe_top), (0.255, fe_top + 0.02),
          (0.29, 0.86), (0.36, 0.89), (0.43, 0.84), (0.5, 0.82)]
    kl = [(0.0, 0.250), (0.05, 0.235), (0.10, 0.255), (0.14, 0.31), (0.17, 0.41), (0.195, fe_top), (0.255, fe_top + 0.02),
          (0.29, 0.86), (0.36, 0.89), (0.43, 0.84), (0.5, 0.82)]
    fr = np.interp(a, [k[0] for k in kr], [k[1] for k in kr]); fl = np.interp(a, [k[0] for k in kl], [k[1] for k in kl])
    return np.where(right, fr, fl)

def marcel_phase(Mc, u, f):
    """Lock count across the waves (crest lines run round the head, gently tilted and S-shaped)."""
    s = Mc['tilt'] * np.cos(2 * np.pi * u) + Mc['wiggle'] * np.sin(4 * np.pi * u + 0.9) + 0.35 * Mc['wiggle'] * np.sin(10 * np.pi * u + 0.3)
    return (f - Mc['f0'] - s) / Mc['period']

def marcel_profile(Mc, t):
    a = Mc['crest']; rise = np.clip(t / a, 0, 1); fall = np.clip((1 - t) / (1 - a), 0, 1)
    return np.where(t < a, np.sin(rise * np.pi / 2) ** 1.4, np.sin(fall * np.pi / 2) ** 0.6)

def hair_marcel(g):
    Fr = skull_frame(g); Y0 = g.Y0; zt, zc = Fr['zt'], Fr['zc']; hh = zt - zc; Mc = MARCEL
    TT = lambda f: np.interp(f, [k[0] for k in Mc['thick']], [k[1] for k in Mc['thick']])
    z_hang = Fr['z'](Mc['hang'])
    ze = Fr['z'](Fr['f_ear']); xe = float(g.W(ze)) + Fr['ear_out'] + 0.010; ye = Y0 + Fr['ear_y']
    ts = np.linspace(0, 1, 10)
    P_part = parting(g, Mc['part_x'] * (1.0 - 0.3 * ts), Y0 - 0.175 + 0.20 * ts, lambda f: TT(f) + 0.0010); R_part = np.full(len(P_part), 0.0032)
    def wave_disp(P):
        u = u_of(P, Y0); f = (zt - P[:, 2]) / hh
        ph = marcel_phase(Mc, u, f); t = ph - np.floor(ph)
        m = sm_np((f - 0.05) / 0.06) * sm_np((marcel_hairline(Fr, u) - 0.03 - f) / 0.04)
        return Mc['amp'] * (marcel_profile(Mc, t) - 0.45) * m
    sk = radial_skull_sd(g, Fr)
    # the front wave: a sculpted roll along the hairline from the parting over the forehead, dipping to her right temple
    roll, rr = [], []
    for k, u in enumerate(np.linspace(-0.135, 0.175, 22)):
        fh = float(marcel_hairline(Fr, u % 1.0)) - 0.034; z = Fr['z'](fh)
        p, n = skull_normal(g, u % 1.0, z)
        t = k / 21; r = 0.0045 + 0.0090 * math.sin(math.pi * min(1.0, t * 1.15)) ** 0.8
        roll.append(tuple(p + n * (float(TT(fh)) + 0.10 * r))); rr.append(r)
    P_roll, R_roll = np.array(roll), np.array(rr)
    def sdf(P):
        f = (zt - P[:, 2]) / hh
        head = np.minimum(sk(P), np.maximum(sd_head_ext(g, P, z_hang), P[:, 2] - z_hang))   # the head, and straight down from its widest
        s = head - TT(np.clip(f, 0, 1.0)) - wave_disp(P)
        s = DK.smin(s, DK.sd_tube(P, P_roll, R_roll), 0.007)
        cut = Fr['z'](marcel_hairline(Fr, u_of(P, Y0))) - P[:, 2]
        s = DK.smax(s, cut, 0.013)
        ear = np.minimum(DK.sd_ellipsoid(P, (xe, ye, ze), Mc['ear_clear']), DK.sd_ellipsoid(P, (-xe, ye, ze), Mc['ear_clear']))
        s = DK.smax(s, -ear, 0.010)
        s = DK.smax(s, -DK.sd_tube(P, P_part, R_part), 0.003)
        return s
    lo = (-0.30, Y0 - 0.28, zc - 0.10); hi = (0.30, Y0 + 0.30, zt + 0.05)
    ob = DK.sdf_object(g, 'Hair', sdf, lo, hi, 0.0036, drop=lambda p: g.inside_skull(p, -0.004), smooth=3, target_tris=11600, post_smooth=2)
    g.add(ob, 'hair', 'head')
    g.hair_covers = lambda p, margin=0.02: bool(p.z > Fr['z'](float(marcel_hairline(Fr, u_of(np.array([[p.x, p.y, p.z]]), Y0))[0])) + margin)
    def gam(p):                                        # the bake darkens the troughs between the waves and the parting
        P = np.array([[p.x, p.y, p.z]]); u = u_of(P, Y0); f = (zt - P[:, 2]) / hh
        ph = marcel_phase(Mc, u, f); t = float(ph[0] - np.floor(ph[0]))
        trough = max(0.0, 1.0 - min(t, 1.0 - t) / 0.16)
        d = float(DK.sd_tube(P, P_part, R_part)[0])
        return 0.010 * max(trough * 0.8, float(np.clip(1.0 - (d - 0.001) / 0.006, 0.0, 1.0)))
    g.hair_groove = gam
    _store(g, zt=zt, zc=zc, Y0=Y0, ear=(xe, ye, ze))
    return None

def sm_np(x):
    x = np.clip(x, 0.0, 1.0); return x * x * (3 - 2 * x)

def marcel_post(g, mesh):
    """Post-bake: the mirror shine: a bright band on the upper face of every crest, deep shade in the trough below it."""
    st = g.w1b.get(mesh.name)
    if not st: return
    Mc = MARCEL; P = _local(g, mesh); Y0, zt, zc = st['Y0'], st['zt'], st['zc']
    u = u_of(P, Y0); f = (zt - P[:, 2]) / (zt - zc)
    ph = marcel_phase(Mc, u, f); t = ph - np.floor(ph)
    a = Mc['crest']
    shine = np.exp(-((t - (a - 0.12)) / 0.10) ** 2)                 # just before the crest: the face toward the light
    shade = np.exp(-((t - (a + 0.16)) / 0.09) ** 2)                 # just past it: the steep side into the trough
    m = (0.80 + 0.20 * shine) * (1.0 - 0.28 * shade)
    m = 1.0 + (m - 1.0) * sm_np((f - 0.04) / 0.08)
    col = mesh.data.color_attributes['Col']
    for i, k in enumerate(m):
        c = col.data[i].color; col.data[i].color = (min(1.0, c[0] * k), min(1.0, c[1] * k), min(1.0, c[2] * k), c[3])

# =====================================================================================================================
# REGISTRATION into spec.py and the item list
# =====================================================================================================================
HAIR_BAKE = {
    # the braid: Clara's soft sheen; the finger waves: a glossier, tighter highlight (the mirror shine), a darker crown
    'lamplighter': dict(sheen={'Hair': (0.50, [((-0.20, -0.85, 0.45), 3.0, 1.0), ((0.5, -0.75, 0.3), 5.0, 0.35)])}, up_dark={'Hair': (0.70, 0.8, (0.94, 1.0, 1.04))},
                        groove_dark=(0.010, 0.55), ao_skip=('Brow', 'Eye', 'Lips', 'Gold', 'Pearl', 'Shine')),
    'marcel': dict(sheen={'Hair': (0.42, [((-0.15, -0.80, 0.55), 5.0, 1.0), ((0.55, -0.70, 0.40), 7.0, 0.45)])}, up_dark={'Hair': (0.62, 0.8, (0.94, 1.0, 1.04))},
                   groove_dark=(0.010, 0.62), ao_skip=('Brow', 'Eye', 'Lips', 'Gold', 'Pearl', 'Shine')),
}
HAIR_POST = {'lamplighter': crown_post, 'marcel': marcel_post}
HAIR_COLOUR = {'lamplighter': CL.COLOURS['hair'], 'marcel': '#4a3a36'}

def register(ns):
    """Called at the end of spec.py with its globals: the gown joins the gowns (so every hair shades it and both belts
    get a fit for it), the two styles join the hair sources (each is written against the face it is fitted to, built
    in Clara's frame like her own hair), the new fixed colours become materials."""
    S = ns
    S['DRESSES']['decoBeaded'] = dict(bod=_deco_bodice_ns(S), slv=EL.SLV, skirt=DECO_SKIRT, centre_y=-0.008, look='clara', mod=CL,
                                      build=dress_deco, colours=dict(Dress='#2b2a3a', Gold=GOLD_HEX), sheen=dict(Gold=GOLD_SHEEN))
    S['DRESS_ORDER'].append('decoBeaded')
    S['WAIST']['decoBeaded'] = DECO_WAIST
    S['BELTS']['sash']['spec']['decoBeaded'] = S['_belt'](CL.SASH, DECO_WAIST, S['WAIST']['column'])
    S['BELTS']['thin']['spec']['decoBeaded'] = S['_belt'](EL.BELT, DECO_WAIST, S['WAIST']['ballgown'])
    for hid, fn in (('lamplighter', hair_crown), ('marcel', hair_marcel)):
        S['HAIR_SRC'][hid] = 'clara'; S['HAIR_FN'][hid] = fn
    S['COLOURS'].update(glove=GLOVE_HEX, petal=ORCHID_HEX, glass=GLASS_HEX)

def _deco_bodice_ns(S):
    B = dict(profiles=[(55.6, 0.360, 0.268, 0.92, -0.007), (54.0, 0.350, 0.262, 0.92, -0.008), (52.0, 0.332, 0.248, 0.91, -0.010),
                       (50.0, 0.314, 0.236, 0.90, -0.012), (48.0, 0.300, 0.230, 0.90, -0.014), (46.0, 0.294, 0.232, 0.89, -0.016),
                       (44.0, 0.292, 0.240, 0.88, -0.018), (42.0, 0.294, 0.252, 0.86, -0.020), (40.0, 0.300, 0.264, 0.85, -0.021),
                       (38.0, 0.306, 0.268, 0.83, -0.019), (36.0, 0.318, 0.252, 0.80, -0.012)],
             neck=dict(kind='v', side=32.0, front=33.9, back=32.6, v_width=0.30), waist=51.0, hips_share=0.65, hips_blend=0.05,
             ncol=48, nrow=18, lip=0.006)
    return S['_bodice'](B, 36.0, {})

def items(add):
    """The new pieces after the classic ones (spec.items() calls this last): the two styles on every face, then the
    extras fitted per gown, then the gloves."""
    S = _S(); AO_SKIP = S.AO_SKIP
    dresses = [f'dress_{d}' for d in S.DRESS_ORDER]
    for F in S.FACE_ORDER:
        suffix = '' if F == S.DEFAULT_FACE else f'~face_{F}'
        own_dress = f"dress_{S.LOOK_OF_FACE[F][1]}"
        for hid in ('lamplighter', 'marcel'):
            add(key=f'hairStyle_{hid}{suffix}', slot='hairStyle', id=hid, fit=(f'face_{F}' if suffix else None), face=F, build=S.hair_builder(hid),
                ctx=['body', f'face_{F}', own_dress], casts=[(f'face_{F}', ['body']), ('body', [f'face_{F}'])] + [(dd, ['body', 'feet_pumps']) for dd in dresses],
                bake=dict(HAIR_BAKE[hid]), colours=dict(Hair=HAIR_COLOUR[hid]), post=[HAIR_POST[hid]], patch_soft={'dress_': 0.03})
    for d in S.DRESS_ORDER:
        add(key=f'extra_lantern~dress_{d}', slot='extra', id='lantern', fit=f'dress_{d}', build=extra_lantern_on(d), needs=[f'dress_{d}'],
            ctx=['body', f'dress_{d}', 'face_clara'], bake=dict(ao_skip=AO_SKIP, sheen=dict(Gold=GOLD_SHEEN)),
            colours=dict(Gold=GOLD_HEX, Glass=GLASS_HEX), extras={'attach': 'neck'})
    for d in S.DRESS_ORDER:
        add(key=f'extra_blackOrchid~dress_{d}', slot='extra', id='blackOrchid', fit=f'dress_{d}', build=extra_orchid_on(d), needs=[f'dress_{d}'],
            ctx=['body', f'dress_{d}'], bake=dict(ao_skip=AO_SKIP), colours=dict(Petal=ORCHID_HEX), post=[orchid_colours], extras={'attach': 'chest'})
    add(key='extra_eveningGloves', slot='extra', id='eveningGloves', build=extra_gloves, ctx=['body', 'dress_column'],
        bake=dict(ao_skip=AO_SKIP, sheen=dict(Glove=(0.82, [((0.0, -0.9, 0.45), 4.0, 0.6), ((0.0, 0.0, 1.0), 6.0, 0.3)]))),
        colours=dict(Glove=GLOVE_HEX), post=[glove_satin], extras={'attach': 'hands', 'hidesSkin': GLOVE_HIDES})
