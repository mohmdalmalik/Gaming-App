# The room kit: everything make_room.py needs to build ONE room tile as a baked, stylised model in
# the lobby's style (tools/lobby-pipeline/make_lobby.py is the original; this is its generalisation).
#
#   geometry     Target accumulators, softly bevelled boxes, turned boxes, discs, leaves, textured quads
#   floors/rugs  the floor from the atlas; rugs, runners and border bands as flat shapes with gold lines
#   walls        each game wall segment -> a lower part (in "static", with a cut cap) and an upper part
#                W_<side>_<k>_up (origin on the cut) that the game folds down (cutaway); mahogany panels,
#                wall tiles or plaster over a wainscot; pilasters with brass plinths at doorways and
#                corners (their foot stays standing as a post when the wall is lowered)
#   doorways     a lining, an architrave, the lintel wall, a threshold and warm light spilling in
#   lighting     sky + key + point lights; bake (diffuse x ambient occlusion), denoise, save
#   export       one .glb: "static", "floor" and the W_*_up parts; two light maps
#
# Coordinates: game (x right, y up, z south) -> Blender (x, -z, y). All geometry is built in GAME
# space in the tile's DEFAULT orientation, centred on (0, 0); the game turns the model with the tile.
import bpy, bmesh, json, math, os, random, time
from mathutils import Matrix, Vector

H_TOP = 2.40            # every wall is cut at this height (the architectural-model look)
SPLIT = 0.64            # cutaway: the upper part folds down onto this cut
CAP_LO = 0.66           # the dark cut cap on the lower part, 0.64 -> 0.66
DOOR_H = 2.06           # doorway openings
PROUD_CAP_IN, PROUD_CAP_OUT = 0.09, 0.04
LM_SCALE = 4.0          # light maps store light / LM_SCALE (must match src/render/bakedRoom.js)
CASING_W, CASING_P = 0.15, 0.05

# ---- palette (sRGB) ------------------------------------------------------------------------------
C = dict(
    wall='#43261a', panel='#52301f', rail='#5e3824', cap='#26150c', skirting='#2b180e',
    brass='#d0a24a', brassDark='#9c7a34', gold='#c89a45', steel='#9aa0a8', steelDark='#5d636b', iron='#2c2d31',
    velvet='#6b2029', velvetDeep='#4e161d', velvetHi='#782530',
    green='#1f4a3c', greenDeep='#16362c', greenHi='#285a49',
    walnut='#5a3520', walnutDark='#3b2314', walnutTop='#6b4128', oak='#8a6038', oakDark='#6a4526',
    planter='#34211a', soil='#2a1d14', leaf1='#3d7a34', leaf2='#4f9440', leaf3='#2e6630',
    shade='#f6e3b8', canvas='#2c2a24', threshold='#3a2416',
    linen='#efe9dc', linen2='#e4dccb', linenBlue='#c9d8e0', white='#f1efe8', cream='#e6d9bd', creamDark='#cdbb95',
    red='#b02a2c', black='#1c1a19', paper='#ede3c8', wicker='#a07a44', crate='#8a6a42', crateDark='#6a4e2e',
)

def lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c) + (1.0,)

def srgb_hex(c):
    return '#%02x%02x%02x' % tuple(int(round(255 * min(1.0, max(0.0, (12.92 * v if v <= 0.0031308 else 1.055 * v ** (1 / 2.4) - 0.055))))) for v in c)

def shown(h, L=0.7):
    """The albedo that SHOWS as colour `h` in the game under baked light of about `L` (linear). The game
    renders with Khronos neutral tone mapping, which takes up to 0.04 off every channel of a dark colour
    (the least channel most), so dark browns and burgundies need a greyer, lighter albedo than they look."""
    out = lin(h)[:3]
    m = min(out)
    off = (math.sqrt(m / 6.25) - m) if m < 0.04 else 0.04
    return srgb_hex([(o + off) / L for o in out])

MATS = ['vc', 'tex', 'glow']
MI = {m: i for i, m in enumerate(MATS)}

def G(x, y, z):
    return Vector((x, -z, y))

# ---- the shared albedo atlas (tools/room-pipeline/textures_rooms.py) --------------------------------
CELL = dict(stone=0, parquet=1, checker=2, clinic=3, carpet=4, slate=5, planks=6, walltiles=7, plaster=8,
            pictures=9, art=10, sage=11, boards=12, books=13, cream=14, signs=15)

def cell_uv(idx, fu, fv, quad=None):
    """UV inside atlas cell `idx` (fu, fv in 0..1, fv up). `quad` 0..3 picks a quarter of the cell
    (0 TL, 1 TR, 2 BL, 3 BR) for the paintings and signs cells."""
    fu = min(max(fu, 0.0), 1.0); fv = min(max(fv, 0.0), 1.0)
    if quad is not None:
        fu = (quad % 2) * 0.5 + fu * 0.5
        fv = (1 - quad // 2) * 0.5 + fv * 0.5
    fu = 0.006 + fu * 0.988; fv = 0.006 + fv * 0.988        # stay clear of the neighbouring cells
    col, row = idx % 4, idx // 4
    return ((col + fu) / 4.0, 1.0 - (row + 1) / 4.0 + fv / 4.0)

# ---- geometry accumulation ----------------------------------------------------------------------
class Target:
    """Raw geometry for one output object (verts in game space until built)."""
    def __init__(self, name, origin=(0.0, 0.0, 0.0)):
        self.name, self.origin = name, origin
        self.V, self.F, self.FM, self.LC, self.LUV = [], [], [], [], []

    def add_bm(self, bm, color, mat='vc', uvfn=None, face_mat=None):
        base = len(self.V)
        bm.verts.index_update()
        for v in bm.verts:
            self.V.append(tuple(v.co))
        for f in bm.faces:
            self.F.append(tuple(base + v.index for v in f.verts))
            m = face_mat(f) if face_mat else mat
            self.FM.append(MI[m])
            col = lin(color) if isinstance(color, str) else color
            for l in f.loops:
                self.LC.append(col)
                self.LUV.append(uvfn(f, l) if (uvfn and m == 'tex') else (0.0, 0.0))
        bm.free()

T = {}
def target(name, origin=(0.0, 0.0, 0.0)):
    if name not in T:
        T[name] = Target(name, origin)
    return T[name]

def _bevel(bm, amount, segs):
    if amount <= 0:
        return
    bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=amount, offset_type='OFFSET',
                    segments=segs, profile=0.5, affect='EDGES', clamp_overlap=True)

DIRS = {'down': Vector((0, 0, -1)), 'up': Vector((0, 0, 1)), 'n': Vector((0, 1, 0)), 's': Vector((0, -1, 0)),
        'e': Vector((1, 0, 0)), 'w': Vector((-1, 0, 0))}

def box(t, x0, x1, y0, y1, z0, z1, color, bevel=0.012, segs=1, mat='vc', uvfn=None, face_mat=None, drop=()):
    """Axis-aligned box in GAME space with softened edges. Faces that can never be seen are left out
    (`drop`: down/up/n/s/e/w); a box standing on the floor loses its bottom automatically."""
    if x0 > x1: x0, x1 = x1, x0
    if z0 > z1: z0, z1 = z1, z0
    sx, sy, sz = x1 - x0, y1 - y0, z1 - z0
    if min(sx, sy, sz) <= 1e-5:
        return
    bm = bmesh.new()
    c = G((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2)
    M = Matrix.Translation(c) @ Matrix.Diagonal((sx, sz, sy, 1.0))
    bmesh.ops.create_cube(bm, size=1.0, matrix=M)
    _bevel(bm, min(bevel, sx * 0.45, sy * 0.45, sz * 0.45), segs)
    drop = set(drop)
    if y0 <= 1e-4:
        drop.add('down')
    if drop:
        half = Vector((sx / 2, sz / 2, sy / 2))
        dead = []
        for f in bm.faces:
            n = f.normal
            for k in drop:
                d = DIRS[k]
                if n.dot(d) > 0.999:
                    ext = abs(d.x) * half.x + abs(d.y) * half.y + abs(d.z) * half.z
                    if abs((f.calc_center_median() - c).dot(d) - ext) < 1e-4:
                        dead.append(f)
                        break
        if dead:
            bmesh.ops.delete(bm, geom=dead, context='FACES_ONLY')
    t.add_bm(bm, color, mat, uvfn, face_mat)

def plane(t, x0, x1, z0, z1, y, mat, uvfn, color='#ffffff'):
    """One upward-facing quad (floor, rugs)."""
    bm = bmesh.new()
    vs = [bm.verts.new(G(x, y, z)) for (x, z) in ((x0, z1), (x1, z1), (x1, z0), (x0, z0))]
    f = bm.faces.new(vs)
    f.normal_update()
    if f.normal.z < 0:            # always facing up (recalculating normals on a lone quad can flip it)
        f.normal_flip()
    t.add_bm(bm, color, mat, uvfn)

def cyl(t, x, z, y0, y1, r0, r1=None, color='#ffffff', segs=20, bevel=0.0, mat='vc', caps=True):
    r1 = r0 if r1 is None else r1
    bm = bmesh.new()
    M = Matrix.Translation(G(x, (y0 + y1) / 2, z))
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r0, radius2=r1, depth=y1 - y0, matrix=M)
    if bevel > 0:
        edges = [e for e in bm.edges if all(abs(v.co.z - M.translation.z) > (y1 - y0) / 2 - 1e-4 for v in e.verts)]
        bmesh.ops.bevel(bm, geom=edges, offset=min(bevel, (y1 - y0) * 0.45), offset_type='OFFSET', segments=2, profile=0.5, affect='EDGES', clamp_overlap=True)
    if y0 <= 1e-4 and caps:                 # standing on the floor: its underside is never seen
        bm.faces.ensure_lookup_table()
        dead = [f for f in bm.faces if f.normal.z < -0.999 and abs(f.calc_center_median().z) < 1e-4]
        if dead:
            bmesh.ops.delete(bm, geom=dead, context='FACES_ONLY')
    t.add_bm(bm, color, mat)

def rod(t, a, b, r, color, segs=8):
    """A cylinder between two GAME-space points (rails, legs at an angle, cords)."""
    pa, pb = G(*a), G(*b)
    d = pb - pa
    L = d.length
    if L < 1e-5:
        return
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=r, radius2=r, depth=L)
    rot = Vector((0, 0, 1)).rotation_difference(d.normalized()).to_matrix().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation((pa + pb) / 2) @ rot, verts=bm.verts)
    t.add_bm(bm, color)

def sphere(t, x, y, z, r, color, mat='vc', segs=12):
    if isinstance(mat, int):            # sphere(..., color, segs)
        mat, segs = 'vc', mat
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=max(6, segs // 2), radius=r, matrix=Matrix.Translation(G(x, y, z)))
    t.add_bm(bm, color, mat)

def leaf(t, x, z, y, yaw, pitch, length, width, color):
    bm = bmesh.new()
    th = width * 0.18
    pts = [(0, 0, 0), (length, 0, 0), (length * 0.45, width / 2, 0), (length * 0.45, -width / 2, 0),
           (length * 0.45, 0, th), (length * 0.45, 0, -th)]
    vs = [bm.verts.new(p) for p in pts]
    b, tip, l, r, up, dn = vs
    for tri in ((b, l, up), (b, up, r), (b, r, dn), (b, dn, l), (tip, up, l), (tip, r, up), (tip, dn, r), (tip, l, dn)):
        bm.faces.new(tri)
    R = Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(-pitch, 4, 'Y')
    bmesh.ops.transform(bm, matrix=Matrix.Translation(G(x, y, z)) @ R, verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    t.add_bm(bm, color)

def quad_uv_game(x0, x1, z0, z1, idx, long_v=False, quad=None):
    """uvfn for an upward quad spanning (x0..x1, z0..z1) mapped onto a whole atlas cell."""
    def uv(f, l):
        p = l.vert.co
        gx, gz = p.x, -p.y
        u = (gx - x0) / (x1 - x0)
        v = 1 - (gz - z0) / (z1 - z0)
        if long_v:
            u, v = (gz - z0) / (z1 - z0), (gx - x0) / (x1 - x0)
        return cell_uv(idx, u, v, quad)
    return uv

def obox(t, cx, cy, cz, sx, sy, sz, color, yaw=0.0, tilt=0.0, bevel=0.0, mat='vc'):
    """A box centred on (cx, cy, cz) in GAME space, sx wide (x), sy tall, sz deep (z), turned `yaw`
    radians about the vertical (counter-clockwise seen from above) after tilting it `tilt` about its
    own x axis. For crate braces, leaning mops, angled bookcases."""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector((sx, sz, sy)), verts=bm.verts)
    _bevel(bm, min(bevel, sx * 0.45, sy * 0.45, sz * 0.45), 1)
    M = Matrix.Translation(G(cx, cy, cz)) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(tilt, 4, 'X')
    bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
    t.add_bm(bm, color, mat)

def disc(t, center, axis_u, axis_v, normal, ru, rv, d0, d1, color, segs=24, mat='vc'):
    """An elliptical slab: radii ru along `axis_u`, rv along `axis_v` (Blender vectors), from d0 to d1
    along `normal`, centred on `center` (a Blender point). Oval mirrors, plates on edge, clock faces."""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segs, radius1=1.0, radius2=1.0, depth=1.0)
    bmesh.ops.translate(bm, vec=Vector((0, 0, 0.5)), verts=bm.verts)
    bmesh.ops.scale(bm, vec=Vector((ru, rv, d1 - d0)), verts=bm.verts)
    bmesh.ops.translate(bm, vec=Vector((0, 0, d0)), verts=bm.verts)
    M = Matrix((axis_u.normalized(), axis_v.normalized(), normal.normalized())).transposed().to_4x4()
    bmesh.ops.transform(bm, matrix=Matrix.Translation(center) @ M, verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    t.add_bm(bm, color, mat)

# ---- floors and rugs ---------------------------------------------------------------------------
def build_floor(R, cell, cuts, repeat=2.0):
    """The floor (atlas cell `cell`, repeating every `repeat` metres) cut into pieces around the rugs
    (`cuts`: [(x0, x1, z0, z1)]), so no floor texel hides under a rug."""
    FL = target('floor')
    lo, hi = R['min'][0] + 0.15, R['max'][0] - 0.15
    cuts = [(max(lo, a), min(hi, b), max(lo, c), min(hi, d)) for (a, b, c, d) in cuts]
    cuts = [r for r in cuts if r[1] - r[0] > 1e-4 and r[3] - r[2] > 1e-4]
    g = [lo + repeat * k for k in range(int((hi - lo) / repeat) + 2)]
    xs = sorted({lo, hi} | {v for v in g if lo < v < hi} | {r[0] for r in cuts} | {r[1] for r in cuts})
    zs = sorted({lo, hi} | {v for v in g if lo < v < hi} | {r[2] for r in cuts} | {r[3] for r in cuts})
    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            cx, cz = (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
            if any(r[0] < cx < r[1] and r[2] < cz < r[3] for r in cuts):
                continue
            gx0 = lo + math.floor((cx - lo) / repeat) * repeat
            gz0 = lo + math.floor((cz - lo) / repeat) * repeat
            def uv(f, l, gx0=gx0, gz0=gz0):
                p = l.vert.co
                return cell_uv(cell, (p.x - gx0) / repeat, 1 - ((-p.y) - gz0) / repeat)
            plane(FL, xs[i], xs[i + 1], zs[j], zs[j + 1], 0.0, 'tex', uv)

RUG_RES = 0.01
def _mask_rects(mask, ox, oz, res):
    """Split a boolean grid (rows = z, columns = x) into non-overlapping rectangles (run merging)."""
    import numpy as np
    out, active = [], {}
    nz = mask.shape[0]
    for r in range(nz + 1):
        runs = set()
        if r < nz:
            row = mask[r].astype(np.int8)
            d = np.diff(np.concatenate(([0], row, [0])))
            starts, ends = np.where(d == 1)[0], np.where(d == -1)[0]
            runs = set(zip(starts.tolist(), ends.tolist()))
        for key in list(active):
            if key not in runs:
                r0 = active.pop(key)
                out.append((ox + key[0] * res, ox + key[1] * res, oz + r0 * res, oz + r * res))
        for key in runs:
            if key not in active:
                active[key] = r
    return out

def _erode(m, k):
    import numpy as np
    e = m.copy()
    for _ in range(k):
        s = e.copy()
        s[1:, :] &= e[:-1, :]; s[:-1, :] &= e[1:, :]; s[:, 1:] &= e[:, :-1]; s[:, :-1] &= e[:, 1:]
        s[1:, 1:] &= e[:-1, :-1]; s[:-1, :-1] &= e[1:, 1:]; s[1:, :-1] &= e[:-1, 1:]; s[:-1, 1:] &= e[1:, :-1]
        s[0, :] = s[-1, :] = False; s[:, 0] = s[:, -1] = False
        e = s
    return e

def rug(rects, fill, lines=((0.16, 0.05, None),), virt=(), y=0.008, gold=None):
    """A flat rug (or runner, or border band) made of the union of `rects` [(x0, x1, z0, z1)] in `fill`,
    with thin lines inset from its outline: `lines` [(inset, width, colour or None = gold)]. `virt` rects
    count as rug for the outline but are not drawn (a runner leaving through a doorway has no line across
    its end). Returns the drawn rectangles (the floor is cut around them)."""
    import numpy as np
    gold = gold or shown('#b89050', 0.86)
    FL = target('floor')
    res = RUG_RES
    ox, oz = -4.3, -4.3
    n = int(8.6 / res)
    def paint(rs):
        m = np.zeros((n, n), bool)
        for (x0, x1, z0, z1) in rs:
            m[int(round((z0 - oz) / res)):int(round((z1 - oz) / res)), int(round((x0 - ox) / res)):int(round((x1 - ox) / res))] = True
        return m
    D = paint(rects)
    M = D | paint(virt)
    fills = _mask_rects(D, ox, oz, res)
    for (x0, x1, z0, z1) in fills:
        plane(FL, x0, x1, z0, z1, y, 'vc', None, fill)
    for (inset, width, col) in lines:
        a, b = int(round(inset / res)), int(round((inset + width) / res))
        L = _erode(M, a) & ~_erode(M, b) & D
        for (x0, x1, z0, z1) in _mask_rects(L, ox, oz, res):
            plane(FL, x0, x1, z0, z1, y + 0.002, 'vc', None, col or gold)
    return fills

# ---- walls -------------------------------------------------------------------------------------
IN = {'north': (0, 1), 'south': (0, -1), 'west': (1, 0), 'east': (-1, 0)}   # into the room

class Seg:
    """One game wall segment (as the game has it) and its two model parts."""
    def __init__(self, w, R, door_sides, T_W):
        self.id = w['id']
        side = self.side = w['side']
        self.axis = 'x' if side in ('north', 'south') else 'z'
        mn, mx = w['min'], w['max']
        self.nx, self.nz = IN[side]
        if self.axis == 'x':
            self.s0, self.s1 = mn[0], mx[0]
            self.face = mx[1] if side == 'north' else mn[1]
            self.outer = mn[1] if side == 'north' else mx[1]
        else:
            self.s0, self.s1 = mn[1], mx[1]
            self.face = mx[0] if side == 'west' else mn[0]
            self.outer = mn[0] if side == 'west' else mx[0]
        self.cx, self.cz = (mn[0] + mx[0]) / 2, (mn[1] + mx[1]) / 2
        mid = (self.s0 + self.s1) / 2
        self.k = (0 if mid < 0 else 1) if side in door_sides else 0
        self.key = '%s_%d' % (side, self.k)
        self.lo = target('static')
        self.up = target('W_%s_up' % self.key, (self.cx, SPLIT, self.cz))
        self.caplo = target('caps')
        self.gaps = []
        self.into_wall = {(0, 1): 'n', (0, -1): 's', (1, 0): 'w', (-1, 0): 'e'}[(self.nx, self.nz)]
        self.door = None
        self.R, self.T_W = R, T_W

    def n_off(self, d):
        return self.face + (self.nz if self.axis == 'x' else self.nx) * d

    def rect(self, s0, s1, d0, d1):
        a, b = sorted((self.n_off(d0), self.n_off(d1)))
        return (s0, s1, a, b) if self.axis == 'x' else (a, b, s0, s1)

    def point(self, s, y, d):
        """A Blender point on this wall: `s` along it, `y` up, `d` out from its face into the room."""
        x0, x1, z0, z1 = self.rect(s, s, d, d)
        return G(x0, y, z0)

    def axes(self):
        """(along, up, into the room) as Blender vectors."""
        a = G(1, 0, 0) if self.axis == 'x' else G(0, 0, 1)
        return Vector(a), Vector((0, 0, 1)), Vector(G(self.nx, 0, self.nz))

    def put(self, s0, s1, y0, y1, d0, d1, color, bevel=0.008, where=None, **kw):
        """A box on this wall; split across the cut when it spans it (unless `where` is given)."""
        x0, x1, z0, z1 = self.rect(s0, s1, d0, d1)
        if abs(d0) < 1e-6 and 'drop' not in kw:
            kw['drop'] = (self.into_wall,)
        if where is not None:
            box(where, x0, x1, y0, y1, z0, z1, color, bevel, **kw)
            return
        if y1 <= SPLIT + 1e-6:
            box(self.lo, x0, x1, y0, y1, z0, z1, color, bevel, **kw)
        elif y0 >= SPLIT - 1e-6:
            box(self.up, x0, x1, y0, y1, z0, z1, color, bevel, **kw)
        else:
            box(self.lo, x0, x1, y0, SPLIT, z0, z1, color, bevel, **kw)
            box(self.up, x0, x1, SPLIT, y1, z0, z1, color, bevel, **kw)

    def trim_ranges(self, s0, s1, gaps=None):
        out, cur = [], s0
        for g0, g1 in sorted(self.gaps if gaps is None else gaps):
            if g1 <= cur or g0 >= s1:
                continue
            if g0 > cur:
                out.append((cur, g0))
            cur = max(cur, g1)
        if cur < s1:
            out.append((cur, s1))
        return [(a, b) for a, b in out if b - a > 0.02]

    def inner_range(self, proud=0.0):
        R, T_W = self.R, self.T_W
        if self.axis == 'x':
            return max(self.s0, R['min'][0] + T_W), min(self.s1, R['max'][0] - T_W)
        return max(self.s0, R['min'][1] + T_W + proud), min(self.s1, R['max'][1] - T_W - proud)

    def textured(self, s0, s1, y0, y1, depth, idx, repeat=1.0, where=None, gaps=None):
        """A thin textured facing (wallpaper, wall tiles, plaster) on the room side, cut into pieces of
        at most `repeat` metres so each maps onto the whole atlas cell."""
        for a, b in self.trim_ranges(s0, s1, gaps):
            ga = math.floor(a / repeat) * repeat
            xs = sorted({a, b} | {ga + repeat * k for k in range(1, int((b - ga) / repeat) + 1) if a < ga + repeat * k < b})
            gy0 = math.floor(y0 / repeat) * repeat
            ys = sorted({y0, y1} | {gy0 + repeat * k for k in range(1, int((y1 - gy0) / repeat) + 1) if y0 < gy0 + repeat * k < y1})
            if SPLIT > y0 + 1e-6 and SPLIT < y1 - 1e-6 and where is None:
                ys = sorted(set(ys) | {SPLIT})
            for i in range(len(xs) - 1):
                for j in range(len(ys) - 1):
                    s_a, s_b, ya, yb = xs[i], xs[i + 1], ys[j], ys[j + 1]
                    gs = math.floor(((s_a + s_b) / 2) / repeat) * repeat
                    gy = math.floor(((ya + yb) / 2) / repeat) * repeat
                    flip = self.side in ('south', 'west')
                    def uv(f, l, gs=gs, gy=gy, flip=flip):
                        p = l.vert.co
                        gx, gz, gyy = p.x, -p.y, p.z
                        along = gx if self.axis == 'x' else gz
                        u = (along - gs) / repeat
                        if flip:
                            u = 1 - u
                        return cell_uv(idx, u, (gyy - gy) / repeat)
                    def fm(f):
                        n = f.normal
                        into = (-n.y) * self.nz if self.axis == 'x' else n.x * self.nx
                        return 'tex' if into > 0.9 else 'vc'
                    self.put(s_a, s_b, ya, yb, 0.0, depth, C['wall'], 0.0, where=where, uvfn=uv, face_mat=fm)

# ---- wall styles ---------------------------------------------------------------------------------
# The references' architecture: dark mahogany walls in tall moulded panels, square pilasters with brass
# plinths at every doorway and corner (and between bays on long plain walls), a heavy cap, a frieze
# rail. Variants keep the pilasters and cap but change the field: glazed tiles (kitchen), plaster over a
# wooden wainscot (service rooms, infirmary).
PIL_W, PIL_D = 0.32, 0.14      # pilaster width, how far it stands out of the wall
CORNER_W = 0.40                # corner posts, square
POST_H = 1.05                  # doorway and corner posts keep this much when their wall is lowered
# Colours are given as they should SHOW in the game (picked from the references) and turned into
# albedo by shown() for the light they get: walls ~0.66, rugs ~0.86, furniture ~0.7 (linear).
MAHOGANY = dict(kind='panel', wall=shown('#422818', 0.66), panel=shown('#56341f', 0.66), field=shown('#462a19', 0.66),
                rail=shown('#50301e', 0.66), cap=shown('#5e4232', 0.8), skirting=shown('#2c1b10', 0.6),
                pil=shown('#4a2c1a', 0.66), pilPanel=shown('#5a3722', 0.66), brass=C['brass'], capLo=shown('#5a3c2a', 0.8),
                lining=shown('#2e1c12', 0.6))

def style(**kw):
    s = dict(MAHOGANY)
    s.update(kw)
    return s

class Walls:
    """Every wall of the room and where its pilasters stand (set up by make_room.py)."""
    def __init__(self, segs, R, st, extra=None):
        self.segs, self.R, self.st = segs, R, st
        self.lo_edge = R['min'][0] + segs[0].T_W       # -3.85
        self.hi_edge = R['max'][0] - segs[0].T_W       # +3.85
        self.pil = {}                                  # side -> [s centres]
        extra = extra or {}
        for side in ('north', 'south', 'east', 'west'):
            ss = []
            for sg in segs:
                if sg.side == side and sg.door:
                    d = sg.door
                    dc = d['center'][0] if sg.axis == 'x' else d['center'][1]
                    hw = d['width'] / 2
                    ss += [dc - hw - PIL_W / 2, dc + hw + PIL_W / 2]
            if side in extra:
                ss += list(extra[side])
            elif not any(sg.door for sg in segs if sg.side == side):
                ss += [-1.33, 1.33]
            self.pil[side] = sorted(set(round(v, 4) for v in ss))

    def stops(self, side):
        """Bays along a side between corner posts, pilasters and doorways: [(a, b)]."""
        lo, hi = self.lo_edge + CORNER_W, self.hi_edge - CORNER_W
        cuts = [(p - PIL_W / 2, p + PIL_W / 2) for p in self.pil[side]]
        for sg in self.segs:
            if sg.side == side and sg.door:
                d = sg.door
                dc = d['center'][0] if sg.axis == 'x' else d['center'][1]
                cuts.append((dc - d['width'] / 2, dc + d['width'] / 2))
        out, cur = [], lo
        for a, b in sorted(cuts):
            if a > cur + 0.05:
                out.append((cur, a))
            cur = max(cur, b)
        if hi > cur + 0.05:
            out.append((cur, hi))
        return out

def seg_of(segs, side, s):
    return next(o for o in segs if o.side == side and o.s0 - 1e-6 <= s <= o.s1 + 1e-6)

def pilaster(sg, s, st, w=PIL_W, d=PIL_D, post=POST_H, top=H_TOP):
    """A square pilaster: brass plinth, shaft (the part below `post` stays when the wall is lowered),
    a sunk panel on its face, and a capital that rises a little above the wall cap."""
    col, br = st.get('pil', st['wall']), st.get('brass', C['brass'])
    sg.put(s - w / 2 - 0.02, s + w / 2 + 0.02, 0.0, 0.2, 0.0, d + 0.025, br, 0.01, where=sg.lo)
    sg.put(s - w / 2 + 0.003, s + w / 2 - 0.003, 0.2, SPLIT, 0.0, d - 0.003, col, 0.0, where=sg.lo)
    # the post above the cut is only seen with the wall lowered: it is baked with the cut caps
    sg.put(s - w / 2 + 0.003, s + w / 2 - 0.003, SPLIT, post, -0.03, d - 0.003, col, 0.01, where=sg.caplo)
    sg.put(s - w / 2, s + w / 2, max(SPLIT, 0.2), top - 0.12, 0.0, d, col, 0.01, where=sg.up)
    sg.put(s - w / 2 + 0.06, s + w / 2 - 0.06, 0.42, top - 0.34, 0.0, d + 0.012, st.get('pilPanel', col), 0.01)
    sg.put(s - w / 2 - 0.03, s + w / 2 + 0.03, top - 0.16, top + 0.06, -0.02, d + 0.035, st.get('cap', col), 0.015, where=sg.up)

def corner_post(walls, sg, end, st):
    """The square post in a corner (built by the north and south walls)."""
    col, br = st.get('pil', st['wall']), st.get('brass', C['brass'])
    a = walls.lo_edge if end < 0 else walls.hi_edge - CORNER_W
    b = a + CORNER_W
    sg.put(a - 0.0, b + 0.0, 0.0, 0.2, 0.0, CORNER_W + 0.025, br, 0.01, where=sg.lo)
    sg.put(a + 0.003, b - 0.003, 0.2, SPLIT, 0.0, CORNER_W - 0.003, col, 0.0, where=sg.lo)
    sg.put(a + 0.003, b - 0.003, SPLIT, POST_H, -0.03, CORNER_W - 0.003, col, 0.012, where=sg.caplo)
    sg.put(a, b, SPLIT, H_TOP - 0.12, 0.0, CORNER_W, col, 0.012, where=sg.up)
    sg.put(a - 0.02, b + 0.02, H_TOP - 0.16, H_TOP + 0.08, -0.03, CORNER_W + 0.03, st.get('cap', col), 0.02, where=sg.up)

def wall_run(sg, walls, st):
    """One wall segment: slab, cut caps, cap, skirting, frieze and the chosen field."""
    th = abs(sg.outer - sg.face)
    body = st.get('wall', C['wall'])
    cap = st.get('cap', C['cap'])
    rail = st.get('rail', C['rail'])
    sg.put(sg.s0, sg.s1, 0.0, SPLIT, -th, 0.0, body, bevel=0.0, drop=('up', 'down'))
    sg.put(sg.s0, sg.s1, CAP_LO, H_TOP - 0.1, -th, 0.0, st.get('upper', body), bevel=0.0, drop=('up', 'down'))
    # the cut cap on the lower part (seen only when the upper part is folded away)
    x0, x1, z0, z1 = sg.rect(sg.s0, sg.s1, -th - 0.03, 0.0)
    box(sg.caplo, x0, x1, SPLIT, CAP_LO, z0, z1, st.get('capLo', cap), 0.004)
    for ra, rb in sg.trim_ranges(*sg.inner_range(0.03)):
        sg.put(ra, rb, SPLIT, CAP_LO, 0.0, 0.03, st.get('capLo', cap), 0.004, where=sg.caplo)
    # the top cap: heavy, proud on both sides
    R = sg.R
    x0, x1, z0, z1 = sg.rect(sg.s0, sg.s1, -th - PROUD_CAP_OUT, PROUD_CAP_IN)
    lift_y = 0.0 if sg.axis == 'x' else 0.003
    if sg.axis == 'z':
        if abs(sg.s0 - (R['min'][1] + sg.T_W)) < 1e-3: z0 = R['min'][1] - PROUD_CAP_OUT
        if abs(sg.s1 - (R['max'][1] - sg.T_W)) < 1e-3: z1 = R['max'][1] + PROUD_CAP_OUT
    else:
        if abs(sg.s0 - R['min'][0]) < 1e-3: x0 = R['min'][0] - PROUD_CAP_OUT
        if abs(sg.s1 - R['max'][0]) < 1e-3: x1 = R['max'][0] + PROUD_CAP_OUT
    box(sg.up, x0, x1, H_TOP - 0.14 + lift_y, H_TOP + lift_y, z0, z1, cap, 0.02)

    def run(y0, y1, proud, color, bevel=0.0):
        for a, b in sg.trim_ranges(*sg.inner_range(proud)):
            sg.put(a, b, y0, y1, 0.0, proud, color, bevel)

    kind = st['kind']
    run(0.0, 0.13, 0.03, st.get('skirting', C['skirting']))
    run(2.1, 2.16, 0.03, rail, 0.008)                                  # frieze rail
    # the bays between posts, pilasters and doorways that belong to this segment
    lo, hi = sg.inner_range(0.0)
    bays = [(max(a, lo), min(b, hi)) for (a, b) in walls.stops(sg.side)]
    bays = [(a, b) for (a, b) in bays if b - a > 0.2 and a >= sg.s0 - 1e-6 and b <= sg.s1 + 1e-6]
    if kind == 'panel':
        run(0.13, 0.2, 0.02, rail, 0.006)
        panel, field = st['panel'], st['field']
        for a, b in bays:
            L = b - a
            n = max(1, round(L / st.get('panelW', 1.45)))
            w = L / n
            for i in range(n):
                p0, p1 = a + i * w + 0.1, a + (i + 1) * w - 0.1
                if p1 - p0 < 0.15:
                    continue
                y0, y1 = st.get('panelY', (0.34, 1.98))
                fw = 0.05
                sg.put(p0, p1, y0, y0 + fw, 0.0, 0.022, panel, 0.0)
                sg.put(p0, p1, y1 - fw, y1, 0.0, 0.022, panel, 0.0)
                sg.put(p0, p0 + fw, y0 + fw, y1 - fw, 0.0, 0.022, panel, 0.0)
                sg.put(p1 - fw, p1, y0 + fw, y1 - fw, 0.0, 0.022, panel, 0.0)
                if field != body:
                    sg.put(p0 + fw, p1 - fw, y0 + fw, y1 - fw, 0.0, 0.006, field, 0.0)
    elif kind == 'tiles':
        for a, b in bays:
            sg.textured(a, b, 0.13, 2.1, 0.008, st.get('cell', CELL['walltiles']), 1.0, gaps=[])
    elif kind == 'plaster':
        wh = st.get('wainH', 0.9)
        run(wh, wh + 0.07, 0.035, rail, 0.008)                           # dado rail
        for a, b in bays:
            if st.get('boards') is not None:
                sg.textured(a, b, 0.13, wh, 0.01, st['boards'], 1.0, gaps=[])
            else:
                sg.put(a + 0.06, b - 0.06, 0.24, wh - 0.1, 0.0, 0.02, st.get('wainPanel', st['panel']), 0.008)
            sg.textured(a, b, wh + 0.07, 2.1, 0.004, st['cell'], 1.0, gaps=[])
    # pilasters and corner posts on this segment
    for s in walls.pil[sg.side]:
        if sg.s0 + PIL_W / 2 - 1e-6 <= s <= sg.s1 - PIL_W / 2 + 1e-6:
            pilaster(sg, s, st)
    if sg.axis == 'x':
        for end, s in ((-1, walls.lo_edge + CORNER_W / 2), (1, walls.hi_edge - CORNER_W / 2)):
            if sg.s0 - 1e-6 <= s <= sg.s1 + 1e-6:
                corner_post(walls, sg, end, st)
    # the outer face: a plain rail under the cap so the back of the wall reads as finished
    x0, x1, z0, z1 = sg.rect(sg.s0, sg.s1, -th - 0.02, -th)
    box(sg.up, x0, x1, 2.12, 2.18, z0, z1, rail, 0.006)

LIGHTS = []   # (x, y, z, watts, radius, rgb)

def door_frame(sg, st, covered=False, spill=True):
    """The doorway: a dark lining in the opening, an architrave over it, the lintel wall, the cap; a
    threshold (unless a rug runs through); and a warm glow from the next room (the references' light
    spilling in at every doorway)."""
    d = sg.door
    dc = d['center'][0] if sg.axis == 'x' else d['center'][1]
    hw = d['width'] / 2
    th = abs(sg.outer - sg.face)
    near = sg.s1 <= dc
    body = st.get('upper', st.get('wall', C['wall'])); cap = st.get('cap', C['cap'])
    lining = st.get('lining', '#3a2216')
    rv = (dc - hw - 0.03, dc - hw) if near else (dc + hw, dc + hw + 0.03)
    sg.put(rv[0], rv[1], 0.0, DOOR_H, -th, 0.0, lining, 0.004)
    if not near:
        return
    up = sg.up
    x0, x1, z0, z1 = sg.rect(dc - hw, dc + hw, -th, 0.0)
    box(up, x0, x1, DOOR_H, H_TOP - 0.1, z0, z1, body, 0.0)
    box(up, x0, x1, DOOR_H - 0.02, DOOR_H, z0, z1, lining, 0.0)
    x0, x1, z0, z1 = sg.rect(dc - hw - 0.01, dc + hw + 0.01, 0.0, 0.05)
    box(up, x0, x1, DOOR_H, DOOR_H + 0.16, z0, z1, st.get('pil', body), 0.012)                 # architrave
    x0, x1, z0, z1 = sg.rect(dc - hw - 0.001, dc + hw + 0.001, -th - PROUD_CAP_OUT, PROUD_CAP_IN)
    box(up, x0, x1, H_TOP - 0.14, H_TOP, z0, z1, cap, 0.02)
    x0, x1, z0, z1 = sg.rect(dc - hw, dc + hw, 0.0, 0.03)
    box(up, x0, x1, 2.1, 2.16, z0, z1, st.get('rail', C['rail']), 0.006)
    if not covered:
        x0, x1, z0, z1 = sg.rect(dc - hw, dc + hw, -th, 0.0)
        box(target('floor'), x0, x1, 0.0, 0.004, z0, z1, st.get('threshold', '#e4cda8'), 0.0)
    if spill:
        x0, x1, z0, z1 = sg.rect(dc, dc, -th - 0.8, -th - 0.8)
        LIGHTS.append((x0, 0.55, z0, st.get('spillW', 60.0), 0.4, (1.0, 0.9, 0.78)))

def sconce(sg, s, y=1.55, light=True, watts=24.0, color=(1.0, 0.9, 0.78), d0=0.0):
    """The references' wall light: an upright glowing block on a brass back plate, brass top and foot."""
    sg.put(s - 0.07, s + 0.07, y - 0.22, y + 0.2, d0, d0 + 0.02, C['brassDark'], 0.008, where=sg.up)
    sg.put(s - 0.09, s + 0.09, y - 0.16, y + 0.22, d0 + 0.02, d0 + 0.16, '#fff4d8', 0.03, where=sg.up, mat='glow')
    sg.put(s - 0.095, s + 0.095, y - 0.25, y - 0.15, d0 + 0.015, d0 + 0.17, C['brass'], 0.014, where=sg.up)
    if light:
        x0, x1, z0, z1 = sg.rect(s, s, d0 + 0.25, d0 + 0.25)
        LIGHTS.append((x0, y, z0, watts, 0.08, color))

def lantern(sg, s, y=1.7, watts=24.0, color=(1.0, 0.8, 0.55), glass='#fff3d0'):
    """A caged brass lantern on a bracket (the storage room and the stairs)."""
    sg.put(s - 0.06, s + 0.06, y - 0.16, y + 0.16, 0.0, 0.02, C['brassDark'], 0.006, where=sg.up)
    x0, x1, z0, z1 = sg.rect(s, s, 0.13, 0.13)
    cyl(sg.up, x0, z0, y - 0.13, y + 0.12, 0.085, 0.085, glass, segs=12, mat='glow')
    cyl(sg.up, x0, z0, y - 0.17, y - 0.12, 0.1, 0.1, C['brass'], segs=12)
    cyl(sg.up, x0, z0, y + 0.11, y + 0.16, 0.1, 0.07, C['brass'], segs=12)
    for a in range(4):
        ang = a * math.pi / 2 + math.pi / 4
        rod(sg.up, (x0 + 0.088 * math.cos(ang), y - 0.12, z0 + 0.088 * math.sin(ang)),
            (x0 + 0.088 * math.cos(ang), y + 0.12, z0 + 0.088 * math.sin(ang)), 0.008, C['brassDark'], 4)
    LIGHTS.append((x0, y, z0 + 0.0, watts, 0.06, color))

def strip_light(sg, s, y=2.0, w=0.62, watts=40.0, color=(0.9, 0.95, 1.0)):
    """A flat fluorescent box light (the service corridor)."""
    sg.put(s - w / 2, s + w / 2, y - 0.09, y + 0.09, 0.0, 0.06, C['brassDark'], 0.01, where=sg.up)
    sg.put(s - w / 2 + 0.04, s + w / 2 - 0.04, y - 0.06, y + 0.06, 0.06, 0.08, '#f4f6f2', 0.006, where=sg.up, mat='glow')
    x0, x1, z0, z1 = sg.rect(s, s, 0.3, 0.3)
    LIGHTS.append((x0, y - 0.1, z0, watts, 0.2, color))

def painting(sg, s, y, w, h, quad, cell=CELL['art'], frame=None, light=False):
    frame = frame or C['gold']
    sg.put(s - w / 2 - 0.07, s + w / 2 + 0.07, y - h / 2 - 0.07, y + h / 2 + 0.07, 0.0, 0.045, frame, 0.015, where=sg.up)
    sg.put(s - w / 2 - 0.02, s + w / 2 + 0.02, y - h / 2 - 0.02, y + h / 2 + 0.02, 0.0, 0.052, C['brassDark'], 0.006, where=sg.up)
    x0, x1, z0, z1 = sg.rect(s - w / 2, s + w / 2, 0.0, 0.058)
    def uvfn(f, l):
        p = l.vert.co
        gx, gz, gy = p.x, -p.y, p.z
        along = gx if sg.axis == 'x' else gz
        a = (along - (s - w / 2)) / w
        if sg.side in ('south', 'west'):
            a = 1 - a
        b = (gy - (y - h / 2)) / h
        asp = w / h
        if asp >= 1: b = 0.5 + (b - 0.5) / asp
        else: a = 0.5 + (a - 0.5) * asp
        return cell_uv(cell, a, b, quad)
    def fm(f):
        n = f.normal
        into = (-n.y) * sg.nz if sg.axis == 'x' else n.x * sg.nx
        return 'tex' if into > 0.9 else 'vc'
    box(sg.up, x0, x1, y - h / 2, y + h / 2, z0, z1, C['canvas'], 0.0, uvfn=uvfn, face_mat=fm)
    if light:                                          # a brass picture light over it
        sg.put(s - w * 0.3, s + w * 0.3, y + h / 2 + 0.1, y + h / 2 + 0.15, 0.03, 0.14, C['brass'], 0.01, where=sg.up)
        sg.put(s - 0.02, s + 0.02, y + h / 2 + 0.07, y + h / 2 + 0.14, 0.0, 0.05, C['brass'], 0.004, where=sg.up)

def sign(sg, s, y, w, h, quad, glow=False):
    """A flat sign on the wall from the signs cell (EXIT, red cross, a night window…)."""
    x0, x1, z0, z1 = sg.rect(s - w / 2, s + w / 2, 0.0, 0.03)
    def uvfn(f, l):
        p = l.vert.co
        gx, gz, gy = p.x, -p.y, p.z
        along = gx if sg.axis == 'x' else gz
        a = (along - (s - w / 2)) / w
        if sg.side in ('south', 'west'):
            a = 1 - a
        return cell_uv(CELL['signs'], a, (gy - (y - h / 2)) / h, quad)
    def fm(f):
        n = f.normal
        into = (-n.y) * sg.nz if sg.axis == 'x' else n.x * sg.nx
        return 'tex' if into > 0.9 else 'vc'
    box(sg.up if y - h / 2 >= SPLIT else sg.lo, x0, x1, y - h / 2, y + h / 2, z0, z1, '#1a1a1a', 0.004, uvfn=uvfn, face_mat=fm)

def oval_mirror(sg, s, y, rw, rh):
    """A gilt oval mirror (the west corridor)."""
    a, u, n = sg.axes()
    disc(sg.up, sg.point(s, y, 0.0), a, u, n, rw, rh, 0.0, 0.045, C['gold'], 32)
    disc(sg.up, sg.point(s, y, 0.0), a, u, n, rw - 0.06, rh - 0.06, 0.0, 0.052, '#6a7072', 32)
    disc(sg.up, sg.point(s - rw * 0.3, y + rh * 0.1, 0.0), a, u, n, rw * 0.12, rh * 0.5, 0.0, 0.054, '#8a9294', 12)

def window(sg, s, y=1.4, w=0.8, h=1.2, drape=None, drapeDeep=None, pelmet=True):
    """A tall night window in a walnut frame, with burgundy drapes, gold tie-backs and a pelmet."""
    drape = drape or shown('#6e2430', 0.72); drapeDeep = drapeDeep or shown('#521a24', 0.72)
    sg.put(s - w / 2 - 0.07, s + w / 2 + 0.07, y - h / 2 - 0.07, y + h / 2 + 0.07, 0.0, 0.035, C['walnut'], 0.012, where=sg.up)
    sign(sg, s, y, w, h, 3)
    sg.put(s - w / 2 - 0.1, s + w / 2 + 0.1, y - h / 2 - 0.11, y - h / 2 - 0.06, 0.0, 0.09, C['walnutTop'], 0.01, where=sg.up)
    for side in (-1, 1):
        a = s + side * (w / 2 - 0.08)
        b = s + side * (w / 2 + 0.2)
        sg.put(min(a, b), max(a, b), max(SPLIT + 0.02, y - h / 2 - 0.35), y + h / 2 + 0.22, 0.03, 0.13, drape, 0.04, where=sg.up)
        m = (a + b) / 2
        sg.put(m - 0.1, m + 0.1, y - 0.12, y - 0.06, 0.1, 0.15, C['gold'], 0.02, where=sg.up)
    if pelmet:
        sg.put(s - w / 2 - 0.26, s + w / 2 + 0.26, y + h / 2 + 0.12, y + h / 2 + 0.36, 0.0, 0.16, drapeDeep, 0.04, where=sg.up)
        sg.put(s - w / 2 - 0.27, s + w / 2 + 0.27, y + h / 2 + 0.12, y + h / 2 + 0.15, 0.0, 0.17, C['gold'], 0.008, where=sg.up)

def wall_clock(sg, s, y=1.78):
    a, u, n = sg.axes()
    disc(sg.up, sg.point(s, y, 0.0), a, u, n, 0.18, 0.18, 0.0, 0.05, C['walnutDark'], 20)
    disc(sg.up, sg.point(s, y, 0.0), a, u, n, 0.15, 0.15, 0.0, 0.06, C['cream'], 20)
    sg.put(s - 0.006, s + 0.006, y, y + 0.11, 0.06, 0.07, C['black'], 0.002, where=sg.up)
    sg.put(s, s + 0.08, y - 0.006, y + 0.006, 0.06, 0.07, C['black'], 0.002, where=sg.up)

def wall_shelf(sg, s0, s1, y, depth=0.24, color=None, brackets=C['brass']):
    """A plain wall shelf on brackets; returns a function to put things on it at `s` (Fr-like)."""
    sg.put(s0, s1, y - 0.04, y, 0.0, depth, color or C['walnutTop'], 0.008, where=sg.up)
    for a in (s0 + 0.12, s1 - 0.12):
        sg.put(a - 0.015, a + 0.015, y - 0.2, y - 0.04, 0.0, depth - 0.04, brackets, 0.004, where=sg.up)

# ---- lighting and baking -------------------------------------------------------------------------
def setup_lighting(scene, sky=(0.72, 0.66, 0.58), sky_strength=0.22, key=1100.0, key_color=(1.0, 0.93, 0.84)):
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.max_bounces = 4
    scene.cycles.diffuse_bounces = 3
    world = bpy.data.worlds.new('sky'); scene.world = world
    world.use_nodes = True
    world.light_settings.distance = 0.6
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = tuple(sky) + (1,)
    bg.inputs['Strength'].default_value = sky_strength
    if key > 0:
        ld = bpy.data.lights.new('key', 'AREA'); ld.size = 3.0; ld.energy = key; ld.color = key_color
        lo = bpy.data.objects.new('key', ld); lo.location = G(-2.2, 7.0, 3.0); scene.collection.objects.link(lo)
        lo.rotation_euler = (math.radians(-18), math.radians(-10), 0)
    for (x, y, z, w, r, col) in LIGHTS:
        pd = bpy.data.lights.new('lamp', 'POINT'); pd.energy = w; pd.shadow_soft_size = r; pd.color = col
        po = bpy.data.objects.new('lamp', pd); po.location = G(x, y, z); scene.collection.objects.link(po)

def make_material(name, albedo_path):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.85
    if name in ('vc', 'glow'):
        a = nt.nodes.new('ShaderNodeVertexColor'); a.layer_name = 'Col'
        nt.links.new(a.outputs['Color'], bsdf.inputs['Base Color'])
        if name == 'glow':
            nt.links.new(a.outputs['Color'], bsdf.inputs['Emission Color'])
            bsdf.inputs['Emission Strength'].default_value = 2.0
    elif name == 'tex':
        img = bpy.data.images.load(albedo_path)
        tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = img; tx.name = 'albedo'
        uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'
        nt.links.new(uvn.outputs['UV'], tx.inputs['Vector'])
        nt.links.new(tx.outputs['Color'], bsdf.inputs['Base Color'])
    return m

def build_objects(scene, materials):
    objs = {}
    for name, t in T.items():
        if not t.V:
            continue
        ox, oy, oz = t.origin
        o = G(ox, oy, oz)
        verts = [(v[0] - o.x, v[1] - o.y, v[2] - o.z) for v in t.V]
        me = bpy.data.meshes.new(t.name)
        me.from_pydata(verts, [], t.F)
        me.update()
        for m in materials:
            me.materials.append(m)
        me.polygons.foreach_set('material_index', t.FM)
        ca = me.color_attributes.new('Col', 'FLOAT_COLOR', 'CORNER')
        ca.data.foreach_set('color', [c for col in t.LC for c in col])
        uv = me.uv_layers.new(name='UVMap')
        uv.data.foreach_set('uv', [c for p in t.LUV for c in p])
        me.uv_layers.new(name='Light')
        me.validate()
        ob = bpy.data.objects.new(t.name, me)
        ob.location = o
        scene.collection.objects.link(ob)
        objs[name] = ob
    return objs

def lightmap_uvs(objs, R):
    fl = objs['floor']
    uvl = fl.data.uv_layers['Light']
    mn, mx = R['min'], R['max']
    for poly in fl.data.polygons:
        for li in poly.loop_indices:
            co = fl.data.vertices[fl.data.loops[li].vertex_index].co
            uvl.data[li].uv = ((co.x - mn[0]) / (mx[0] - mn[0]), (co.y + mx[1]) / (mx[1] - mn[1]))
    atlas = [o for n, o in objs.items() if n != 'floor']
    for ob in objs.values():
        ob.data.uv_layers.active = ob.data.uv_layers['Light']
    bpy.ops.object.select_all(action='DESELECT')
    for ob in atlas:
        ob.select_set(True)
    bpy.context.view_layer.objects.active = objs['static']
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.003, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, margin=0.006)
    bpy.ops.object.mode_set(mode='OBJECT')

def bake_pass(objs, materials, kind, images, clear):
    """(1) everything but the cut caps, the room as it stands; (2) the cut caps with the upper
    walls folded away (the only time they are seen)."""
    for m in materials:
        n = m.node_tree.nodes.get('bake') or m.node_tree.nodes.new('ShaderNodeTexImage')
        n.name = 'bake'
        n.select = True; m.node_tree.nodes.active = n
    extra = dict(pass_filter={'DIRECT', 'INDIRECT'}) if kind == 'DIFFUSE' else {}
    def run(selected, hidden, clear_now, img_for):
        for m in materials:
            m.node_tree.nodes['bake'].image = img_for(m)
        for n, o in objs.items(): o.hide_render = hidden(n)
        bpy.ops.object.select_all(action='DESELECT')
        chosen = [o for n, o in objs.items() if selected(n)]
        if not chosen:
            return
        for o in chosen: o.select_set(True)
        bpy.context.view_layer.objects.active = chosen[0]
        bpy.ops.object.bake(type=kind, use_clear=clear_now, margin=3, **extra)
    run(lambda n: n == 'floor', lambda n: False, clear, lambda m: images['floor'])
    run(lambda n: n not in ('floor', 'caps'), lambda n: False, clear, lambda m: images['atlas'])
    run(lambda n: n == 'caps', lambda n: n.endswith('_up'), False, lambda m: images['atlas'])
    for o in objs.values(): o.hide_render = False

def denoise(img, size, build):
    import numpy as np
    sc = bpy.data.scenes.get('denoise') or bpy.data.scenes.new('denoise')
    sc.render.engine = 'BLENDER_WORKBENCH'
    sc.render.resolution_x = sc.render.resolution_y = size
    sc.render.resolution_percentage = 100
    sc.use_nodes = True
    nt = sc.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    i = nt.nodes.new('CompositorNodeImage'); i.image = img
    d = nt.nodes.new('CompositorNodeDenoise'); d.use_hdr = True; d.prefilter = 'NONE'
    c = nt.nodes.new('CompositorNodeComposite')
    nt.links.new(i.outputs['Image'], d.inputs['Image']); nt.links.new(d.outputs['Image'], c.inputs['Image'])
    sc.render.filepath = os.path.join(build, 'denoised-%s.exr' % img.name)
    sc.render.image_settings.file_format = 'OPEN_EXR'
    sc.view_settings.view_transform = 'Standard'
    bpy.ops.render.render(write_still=True, scene=sc.name)
    r = bpy.data.images.load(sc.render.filepath)
    px = np.array(r.pixels[:], np.float32).reshape(size, size, 4)[:, :, :3]
    bpy.data.images.remove(r)
    try: os.remove(sc.render.filepath)
    except OSError: pass
    return px

def save_lightmap(light, ao, size, path, build, ao_strength=0.85, sat=0.4):
    """Denoise, darken the creases (ambient occlusion) and save. `sat` tames the colour of the baked
    light (bounce light off the brown walls and warm lamps turns it orange; the game's neutral tone
    mapping then crushes the blue out of every dark surface), so colours read like the references."""
    import numpy as np
    from PIL import Image
    px = denoise(light, size, build)
    occ = denoise(ao, size, build).mean(axis=2, keepdims=True)
    px = px * (1 - ao_strength + ao_strength * np.clip(occ, 0, 1))
    lum = (px * np.array([0.2126, 0.7152, 0.0722])).sum(axis=2, keepdims=True)
    px = np.maximum(0.0, lum + (px - lum) * sat)
    v = np.clip(px / LM_SCALE, 0, 1)
    s = np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)
    Image.fromarray((s * 255 + 0.5).astype(np.uint8)[::-1], 'RGB').save(path, quality=90)
    used = px[px.max(axis=2) > 0.001]
    print('%s: %dpx used %.0f%% mean %.3f p10 %.3f p90 %.3f' % (os.path.basename(path), size, 100 * len(used) / (size * size),
          used.mean() if len(used) else 0, np.percentile(used, 10) if len(used) else 0, np.percentile(used, 90) if len(used) else 0))
