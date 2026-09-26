# The room kit: everything make_room.py needs to build ONE room tile as a baked, stylised model in
# the lobby's style (tools/lobby-pipeline/make_lobby.py is the original; this is its generalisation).
#
#   geometry     Target accumulators, softly bevelled boxes, cylinders, leaves, textured quads
#   walls        each game wall segment -> a lower part (in "static", with a dark cut cap) and an
#                upper part W_<side>_<k>_up (origin on the cut) that the game folds down (cutaway)
#   doorways     walnut casings with brass plinths, a lintel wall, a threshold, sconces
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
    brass='#caa14c', brassDark='#9c7a34', gold='#bf9645', steel='#9aa0a8', steelDark='#5d636b', iron='#2c2d31',
    velvet='#6b2029', velvetDeep='#4e161d', velvetHi='#782530',
    green='#1f4a3c', greenDeep='#16362c', greenHi='#285a49',
    walnut='#5a3520', walnutDark='#3b2314', walnutTop='#6b4128', oak='#8a6038', oakDark='#6a4526',
    planter='#34211a', soil='#2a1d14', leaf1='#2e6b36', leaf2='#3d8040', leaf3='#255a2c',
    shade='#f6e3b8', canvas='#2c2a24', threshold='#3a2416',
    linen='#efe9dc', linen2='#e4dccb', linenBlue='#c9d8e0', white='#f1efe8', cream='#e6d9bd', creamDark='#cdbb95',
    red='#b02a2c', black='#1c1a19', paper='#ede3c8', wicker='#a07a44', crate='#8a6a42', crateDark='#6a4e2e',
)

def lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c) + (1.0,)

MATS = ['vc', 'tex', 'glow']
MI = {m: i for i, m in enumerate(MATS)}

def G(x, y, z):
    return Vector((x, -z, y))

# ---- the shared albedo atlas (tools/room-pipeline/textures_rooms.py) --------------------------------
CELL = dict(stone=0, parquet=1, checker=2, clinic=3, carpet=4, lino=5, planks=6, rug=7, runner=8,
            rugGreen=9, art=10, damask=11, stripes=12, books=13, tiles=14, signs=15)

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
    bm.faces.new(vs)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    t.add_bm(bm, color, mat, uvfn)

def cyl(t, x, z, y0, y1, r0, r1=None, color='#ffffff', segs=20, bevel=0.0, mat='vc', caps=True):
    r1 = r0 if r1 is None else r1
    bm = bmesh.new()
    M = Matrix.Translation(G(x, (y0 + y1) / 2, z))
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r0, radius2=r1, depth=y1 - y0, matrix=M)
    if bevel > 0:
        edges = [e for e in bm.edges if all(abs(v.co.z - M.translation.z) > (y1 - y0) / 2 - 1e-4 for v in e.verts)]
        bmesh.ops.bevel(bm, geom=edges, offset=min(bevel, (y1 - y0) * 0.45), offset_type='OFFSET', segments=2, profile=0.5, affect='EDGES', clamp_overlap=True)
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

# ---- floors and rugs ---------------------------------------------------------------------------
def build_floor(R, cell, rugs, repeat=2.0):
    """The floor (atlas cell `cell`, repeating every `repeat` metres) cut into pieces around the rugs,
    so no floor texel hides under a rug. `rugs`: [(x0, x1, z0, z1, cell)] — a runner (long in one
    direction) maps the long way onto the cell's V axis."""
    FL = target('floor')
    lo, hi = R['min'][0] + 0.15, R['max'][0] - 0.15
    g = [lo + repeat * k for k in range(int((hi - lo) / repeat) + 2)]
    xs = sorted({lo, hi} | {v for v in g if lo < v < hi} | {r[0] for r in rugs} | {r[1] for r in rugs})
    zs = sorted({lo, hi} | {v for v in g if lo < v < hi} | {r[2] for r in rugs} | {r[3] for r in rugs})
    for i in range(len(xs) - 1):
        for j in range(len(zs) - 1):
            cx, cz = (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
            if any(r[0] < cx < r[1] and r[2] < cz < r[3] for r in rugs):
                continue
            gx0 = lo + math.floor((cx - lo) / repeat) * repeat
            gz0 = lo + math.floor((cz - lo) / repeat) * repeat
            def uv(f, l, gx0=gx0, gz0=gz0):
                p = l.vert.co
                return cell_uv(cell, (p.x - gx0) / repeat, 1 - ((-p.y) - gz0) / repeat)
            plane(FL, xs[i], xs[i + 1], zs[j], zs[j + 1], 0.0, 'tex', uv)
    for (x0, x1, z0, z1, c) in rugs:
        plane(FL, x0, x1, z0, z1, 0.008, 'tex', quad_uv_game(x0, x1, z0, z1, c, long_v=(x1 - x0) > (z1 - z0) * 1.6))

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

    def trim_ranges(self, s0, s1):
        out, cur = [], s0
        for g0, g1 in sorted(self.gaps):
            if g1 <= cur or g0 >= s1:
                continue
            if g0 > cur:
                out.append((cur, g0))
            cur = max(cur, g1)
        if cur < s1:
            out.append((cur, s1))
        return [(a, b) for a, b in out if b - a > 0.02]

    def inner_range(self, proud):
        R, T_W = self.R, self.T_W
        if self.axis == 'x':
            return max(self.s0, R['min'][0] + T_W), min(self.s1, R['max'][0] - T_W)
        return max(self.s0, R['min'][1] + T_W + proud), min(self.s1, R['max'][1] - T_W - proud)

    def textured(self, s0, s1, y0, y1, depth, idx, repeat=1.0, where=None):
        """A thin textured facing (wallpaper, wall tiles) on the room side, cut into pieces of at most
        `repeat` metres so each maps onto the whole atlas cell."""
        for a, b in self.trim_ranges(s0, s1):
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
# A style is a dict: 'kind' walnut | wallpaper | tiles | plaster | cream, plus colours and cells.
WALNUT = dict(kind='walnut', wall=C['wall'], panel=C['panel'], rail=C['rail'], cap=C['cap'], skirting=C['skirting'], trim=C['brass'])

def wall_run(sg, st):
    """The lobby's wall, generalised: slab, cut caps, trims and panels in the chosen style."""
    th = abs(sg.outer - sg.face)
    body = st.get('wall', C['wall'])
    cap = st.get('cap', C['cap'])
    rail = st.get('rail', C['rail'])
    trim = st.get('trim', C['brass'])
    sg.put(sg.s0, sg.s1, 0.0, SPLIT, -th, 0.0, body, bevel=0.0, drop=('up', 'down'))
    sg.put(sg.s0, sg.s1, CAP_LO, H_TOP - 0.1, -th, 0.0, st.get('upper', body), bevel=0.0, drop=('up', 'down'))
    # the cut cap on the lower part (seen only when the upper part is folded away)
    x0, x1, z0, z1 = sg.rect(sg.s0, sg.s1, -th - 0.012, 0.0)
    box(sg.caplo, x0, x1, SPLIT, CAP_LO, z0, z1, cap, 0.004)
    for ra, rb in sg.trim_ranges(*sg.inner_range(PROUD_CAP_IN * 0.5)):
        sg.put(ra, rb, SPLIT, CAP_LO, 0.0, PROUD_CAP_IN * 0.5, cap, 0.004, where=sg.caplo)
    # the top cap: the defining "cut model" line, dark wood proud on both sides
    R = sg.R
    x0, x1, z0, z1 = sg.rect(sg.s0, sg.s1, -th - PROUD_CAP_OUT, PROUD_CAP_IN)
    lift_y = 0.0 if sg.axis == 'x' else 0.003
    if sg.axis == 'z':
        if abs(sg.s0 - (R['min'][1] + sg.T_W)) < 1e-3: z0 = R['min'][1] - PROUD_CAP_OUT
        if abs(sg.s1 - (R['max'][1] - sg.T_W)) < 1e-3: z1 = R['max'][1] + PROUD_CAP_OUT
    else:
        if abs(sg.s0 - R['min'][0]) < 1e-3: x0 = R['min'][0] - PROUD_CAP_OUT
        if abs(sg.s1 - R['max'][0]) < 1e-3: x1 = R['max'][0] + PROUD_CAP_OUT
    box(sg.up, x0, x1, H_TOP - 0.1 + lift_y, H_TOP + lift_y, z0, z1, cap, 0.02)

    def run(y0, y1, proud, color, bevel=0.006):
        for a, b in sg.trim_ranges(*sg.inner_range(proud)):
            sg.put(a, b, y0, y1, 0.0, proud, color, bevel)

    kind = st['kind']
    run(0.0, 0.14, 0.03, st.get('skirting', C['skirting']))
    if kind in ('walnut', 'cream'):
        run(0.53, SPLIT, 0.035, rail)
        run(0.575, 0.588, 0.041, trim, 0.002)
        run(2.02, 2.08, 0.03, rail); run(2.08, 2.10, 0.036, trim, 0.003); run(2.10, 2.20, 0.05, rail)
        run(2.20, H_TOP - 0.1, 0.07, cap)
        panel, field = st.get('panel', C['panel']), st.get('field', body)
        for a, b in sg.trim_ranges(*sg.inner_range(0.03)):
            L = b - a
            n = max(1, round(L / 0.75))
            w = L / n
            for i in range(n):
                p0, p1 = a + i * w + 0.07, a + (i + 1) * w - 0.07
                if p1 - p0 < 0.12:
                    continue
                sg.put(p0, p1, 0.20, 0.47, 0.0, 0.016, panel, 0.01)
                sg.put(p0, p1, 0.76, 1.95, 0.0, 0.016, panel, 0.012)
                sg.put(p0 + 0.05, p1 - 0.05, 0.81, 1.90, 0.0, 0.022, field, 0.01)
                if kind == 'cream':            # gilt lines in the ballroom's panels
                    sg.put(p0 + 0.03, p1 - 0.03, 0.785, 0.795, 0.0, 0.024, trim, 0.002)
                    sg.put(p0 + 0.03, p1 - 0.03, 1.915, 1.925, 0.0, 0.024, trim, 0.002)
    elif kind == 'wallpaper':
        panel = st.get('panel', C['panel'])
        for a, b in sg.trim_ranges(*sg.inner_range(0.03)):          # walnut wainscot to 0.9 m
            L = b - a
            n = max(1, round(L / 0.75)); w = L / n
            for i in range(n):
                p0, p1 = a + i * w + 0.07, a + (i + 1) * w - 0.07
                if p1 - p0 < 0.12:
                    continue
                sg.put(p0, p1, 0.2, 0.78, 0.0, 0.016, panel, 0.01)
        run(0.84, 0.93, 0.035, rail)                                  # chair rail
        run(0.87, 0.882, 0.041, trim, 0.002)
        sg.textured(*sg.inner_range(0.0), 0.93, 1.93, 0.006, st['cell'], 1.0)
        run(1.93, 2.02, 0.03, rail); run(2.02, 2.04, 0.036, trim, 0.003); run(2.04, 2.20, 0.05, rail)
        run(2.20, H_TOP - 0.1, 0.07, cap)
    elif kind == 'tiles':
        sg.textured(*sg.inner_range(0.0), 0.14, 1.14, 0.008, CELL['tiles'], 1.0)
        run(1.14, 1.20, 0.022, st.get('band', '#2f5a52'))             # a coloured tile band
        run(2.10, 2.20, 0.03, st.get('cornice', '#d8d4c8'))
        run(2.20, H_TOP - 0.1, 0.05, cap)
    elif kind == 'plaster':
        run(0.14, 0.95, 0.004, st.get('lower', '#4f5a4c'), 0.0)       # a darker painted dado band
        run(0.95, 0.99, 0.02, rail)
        run(2.14, 2.20, 0.03, rail)
        run(2.20, H_TOP - 0.1, 0.05, cap)
        # an exposed pipe run along the top, a detail of the back-of-house rooms
        if st.get('pipes'):
            for a, b in sg.trim_ranges(*sg.inner_range(0.06)):
                x0, x1, z0, z1 = sg.rect(a, b, 0.04, 0.10)
                if sg.axis == 'x':
                    rod(sg.up, (a, 2.0, (z0 + z1) / 2), (b, 2.0, (z0 + z1) / 2), 0.03, '#5a5e58')
                else:
                    rod(sg.up, ((x0 + x1) / 2, 2.0, a), ((x0 + x1) / 2, 2.0, b), 0.03, '#5a5e58')
    # the outer face: a plain rail under the cap so the back of the wall reads as finished
    x0, x1, z0, z1 = sg.rect(sg.s0, sg.s1, -th - 0.02, -th)
    box(sg.up, x0, x1, 2.14, 2.20, z0, z1, rail, 0.006)

LIGHTS = []   # (x, y, z, watts, radius, rgb)

def door_frame(sg, st, sconces=True):
    d = sg.door
    dc = d['center'][0] if sg.axis == 'x' else d['center'][1]
    hw = d['width'] / 2
    th = abs(sg.outer - sg.face)
    near = sg.s1 <= dc
    rail = st.get('rail', C['rail']); body = st.get('upper', st.get('wall', C['wall'])); cap = st.get('cap', C['cap'])
    j0, j1 = (dc - hw - CASING_W, dc - hw) if near else (dc + hw, dc + hw + CASING_W)
    sg.put(j0, j1, 0.0, DOOR_H + 0.1, 0.0, CASING_P, st.get('casing', C['rail']), 0.012)
    sg.put(j0 + 0.03, j1 - 0.03, 0.2, DOOR_H + 0.04, 0.0, CASING_P + 0.012, st.get('casingField', C['walnut']), 0.008)
    sg.put(j0 - 0.01, j1 + 0.01, 0.0, 0.22, 0.0, CASING_P + 0.018, C['brass'], 0.01)
    rv = (dc - hw - 0.02, dc - hw) if near else (dc + hw, dc + hw + 0.02)
    sg.put(rv[0], rv[1], 0.0, DOOR_H, -th, 0.0, C['walnut'], 0.004)
    if not near:
        return
    up = sg.up
    x0, x1, z0, z1 = sg.rect(dc - hw, dc + hw, -th, 0.0)
    box(up, x0, x1, DOOR_H, H_TOP - 0.1, z0, z1, body, 0.0)
    x0, x1, z0, z1 = sg.rect(dc - hw - CASING_W, dc + hw + CASING_W, 0.0, CASING_P)
    box(up, x0, x1, DOOR_H, DOOR_H + 0.12, z0, z1, st.get('casing', rail), 0.012)
    x0, x1, z0, z1 = sg.rect(dc - hw - CASING_W - 0.02, dc + hw + CASING_W + 0.02, 0.0, CASING_P + 0.02)
    box(up, x0, x1, DOOR_H + 0.12, DOOR_H + 0.15, z0, z1, C['brass'], 0.006)
    x0, x1, z0, z1 = sg.rect(dc - hw - 0.001, dc + hw + 0.001, -th - PROUD_CAP_OUT, PROUD_CAP_IN)
    box(up, x0, x1, H_TOP - 0.1, H_TOP, z0, z1, cap, 0.02)
    x0, x1, z0, z1 = sg.rect(dc - hw, dc + hw, 0.0, 0.07)
    box(up, x0, x1, 2.20, H_TOP - 0.1, z0, z1, cap, 0.006)
    x0, x1, z0, z1 = sg.rect(dc - hw, dc + hw, -th, 0.0)
    box(target('static'), x0, x1, 0.0, 0.014, z0, z1, C['threshold'], 0.004)
    x0, x1, z0, z1 = sg.rect(dc - hw, dc + hw, -0.02, 0.025)
    box(target('static'), x0, x1, 0.0, 0.018, z0, z1, C['brass'], 0.005)

def sconce(sg, s, y=1.62, light=True, watts=22.0, color=(1.0, 0.72, 0.42)):
    sg.put(s - 0.05, s + 0.05, y - 0.13, y + 0.13, 0.0, 0.02, C['brass'], 0.01, where=sg.up)
    sg.put(s - 0.015, s + 0.015, y - 0.03, y + 0.0, 0.0, 0.07, C['brass'], 0.006, where=sg.up)
    sg.put(s - 0.05, s + 0.05, y - 0.12, y + 0.12, 0.05, 0.15, C['shade'], 0.02, where=sg.up, mat='glow')
    sg.put(s - 0.055, s + 0.055, y + 0.12, y + 0.15, 0.045, 0.155, C['brass'], 0.008, where=sg.up)
    sg.put(s - 0.055, s + 0.055, y - 0.15, y - 0.12, 0.045, 0.155, C['brass'], 0.008, where=sg.up)
    if light:
        x0, x1, z0, z1 = sg.rect(s, s, 0.22, 0.22)
        LIGHTS.append((x0, y, z0, watts, 0.06, color))

def caged_bulb(sg, s, y=1.9, watts=26.0, color=(1.0, 0.8, 0.55)):
    """A bare bulb in a wire cage on a bracket: the back-of-house light."""
    sg.put(s - 0.05, s + 0.05, y - 0.05, y + 0.05, 0.0, 0.02, C['iron'], 0.006, where=sg.up)
    sg.put(s - 0.012, s + 0.012, y - 0.012, y + 0.012, 0.0, 0.12, C['iron'], 0.004, where=sg.up)
    x0, x1, z0, z1 = sg.rect(s, s, 0.16, 0.16)
    sphere(sg.up, x0, y - 0.04, z0, 0.05, '#fff1c8', mat='glow')
    for a in range(4):
        ang = a * math.pi / 2
        rod(sg.up, (x0 + 0.065 * math.cos(ang), y - 0.12, z0 + 0.065 * math.sin(ang)),
            (x0 + 0.065 * math.cos(ang), y + 0.03, z0 + 0.065 * math.sin(ang)), 0.005, C['iron'], 4)
    LIGHTS.append((x0, y - 0.1, z0, watts, 0.05, color))

def painting(sg, s, y, w, h, quad, cell=CELL['art'], frame=None):
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
        if cell == CELL['art']:
            if asp >= 1: b = 0.5 + (b - 0.5) / asp
            else: a = 0.5 + (a - 0.5) * asp
        return cell_uv(cell, a, b, quad)
    def fm(f):
        n = f.normal
        into = (-n.y) * sg.nz if sg.axis == 'x' else n.x * sg.nx
        return 'tex' if into > 0.9 else 'vc'
    box(sg.up, x0, x1, y - h / 2, y + h / 2, z0, z1, C['canvas'], 0.0, uvfn=uvfn, face_mat=fm)

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

def mirror(sg, s, y, w, h):
    sg.put(s - w / 2 - 0.06, s + w / 2 + 0.06, y - h / 2 - 0.06, y + h / 2 + 0.06, 0.0, 0.04, C['gold'], 0.015, where=sg.up)
    sg.put(s - w / 2, s + w / 2, y - h / 2, y + h / 2, 0.0, 0.046, '#a9b8bc', 0.004, where=sg.up)

def window(sg, s, y=1.45, w=0.95, h=1.05):
    """A night window with walnut frame, sill and velvet curtains (the signs cell's window)."""
    sg.put(s - w / 2 - 0.08, s + w / 2 + 0.08, y - h / 2 - 0.08, y + h / 2 + 0.08, 0.0, 0.035, C['walnut'], 0.012, where=sg.up)
    sign(sg, s, y, w, h, 3)
    sg.put(s - w / 2 - 0.12, s + w / 2 + 0.12, y - h / 2 - 0.12, y - h / 2 - 0.08, 0.0, 0.1, C['walnutTop'], 0.01, where=sg.up)
    for side in (-1, 1):
        a = s + side * (w / 2 + 0.02)
        sg.put(min(a, a + side * 0.2), max(a, a + side * 0.2), y - h / 2 - 0.05, y + h / 2 + 0.16, 0.02, 0.09, C['velvet'], 0.03, where=sg.up)
    sg.put(s - w / 2 - 0.26, s + w / 2 + 0.26, y + h / 2 + 0.16, y + h / 2 + 0.2, 0.0, 0.1, C['brass'], 0.01, where=sg.up)

def radiator(sg, s, w=0.8):
    for i in range(int(w / 0.08)):
        a = s - w / 2 + i * 0.08
        sg.put(a + 0.01, a + 0.07, 0.12, 0.62, 0.02, 0.11, '#8c8a80', 0.012)
    sg.put(s - w / 2 - 0.03, s + w / 2 + 0.03, 0.1, 0.14, 0.03, 0.1, '#6e6c64', 0.01)

def wall_clock(sg, s, y=1.78):
    x0, x1, z0, z1 = sg.rect(s, s, 0.03, 0.03)
    # a flat round face: a short cylinder lying against the wall
    bm_r = 0.18
    if sg.axis == 'x':
        rod(sg.up, (s, y, sg.n_off(0.0)), (s, y, sg.n_off(0.05)), bm_r, C['walnutDark'], 20)
        rod(sg.up, (s, y, sg.n_off(0.05)), (s, y, sg.n_off(0.06)), bm_r * 0.82, C['cream'], 20)
    else:
        rod(sg.up, (sg.n_off(0.0), y, s), (sg.n_off(0.05), y, s), bm_r, C['walnutDark'], 20)
        rod(sg.up, (sg.n_off(0.05), y, s), (sg.n_off(0.06), y, s), bm_r * 0.82, C['cream'], 20)
    sg.put(s - 0.006, s + 0.006, y, y + 0.11, 0.06, 0.07, C['black'], 0.002, where=sg.up)
    sg.put(s, s + 0.08, y - 0.006, y + 0.006, 0.06, 0.07, C['black'], 0.002, where=sg.up)

def wall_shelf(sg, s0, s1, y, items):
    """A wall shelf on brackets with small things on it (`items`: a list of (colour, w, h))."""
    sg.put(s0, s1, y - 0.03, y, 0.0, 0.22, C['walnutTop'], 0.006, where=sg.up)
    for a in (s0 + 0.08, s1 - 0.08):
        sg.put(a - 0.015, a + 0.015, y - 0.16, y - 0.03, 0.0, 0.18, C['iron'], 0.004, where=sg.up)
    a = s0 + 0.06
    for col, w, h in items:
        if a + w > s1 - 0.04:
            break
        sg.put(a, a + w, y, y + h, 0.04, 0.18, col, 0.01, where=sg.up)
        a += w + 0.04

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
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.001, area_weight=0.0, correct_aspect=True, scale_to_bounds=False)
    bpy.ops.uv.pack_islands(rotate=True, margin=0.002)
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
        bpy.ops.object.bake(type=kind, use_clear=clear_now, margin=6, **extra)
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

def save_lightmap(light, ao, size, path, build, ao_strength=0.85):
    import numpy as np
    from PIL import Image
    px = denoise(light, size, build)
    occ = denoise(ao, size, build).mean(axis=2, keepdims=True)
    px = px * (1 - ao_strength + ao_strength * np.clip(occ, 0, 1))
    v = np.clip(px / LM_SCALE, 0, 1)
    s = np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)
    Image.fromarray((s * 255 + 0.5).astype(np.uint8)[::-1], 'RGB').save(path, quality=90)
    used = px[px.max(axis=2) > 0.001]
    print('%s: %dpx used %.0f%% mean %.3f p10 %.3f p90 %.3f' % (os.path.basename(path), size, 100 * len(used) / (size * size),
          used.mean() if len(used) else 0, np.percentile(used, 10) if len(used) else 0, np.percentile(used, 90) if len(used) else 0))
