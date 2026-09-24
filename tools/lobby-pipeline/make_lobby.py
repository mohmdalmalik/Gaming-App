# Build the starting room ("Fourth Floor Landing") as one baked, stylised model.
#
#   node    tools/lobby-pipeline/dump_lobby.mjs > tools/lobby-pipeline/lobby.json
#   python3 tools/lobby-pipeline/textures.py
#   python3 tools/lobby-pipeline/make_lobby.py [--samples 256] [--size 2048] [--nobake]
#
# Output (assets/models/lobby/):
#   lobby.glb        geometry + albedo (vertex colours, tile/rug/painting textures), two UV sets:
#                    UV0 for the albedo textures, UV1 for the baked light
#   lobby-light.jpg  the baked light (soft sky light from the open top, ambient occlusion,
#                    furniture shadows and the warm pools under lamps and sconces), stored as
#                    light / LM_SCALE in sRGB. The game multiplies it back (src/render/bakedRoom.js).
#
# The room is built on the game's own data (lobby.json is dumped from src/data/floor1.js), so the
# walls, doorways and furniture footprints line up exactly with collision and pathfinding.
#
# Every wall segment of the game (room.walls) becomes two objects so the dollhouse cutaway can
# lower it like a cut architectural model:  W_<side>_<i>_lo (skirting, lower panels, a dark cut
# cap at SPLIT) and W_<side>_<i>_up (upper panels, paintings, sconces, crown and the dark top cap,
# with its origin at SPLIT so the game can scale it down onto the cut). Everything else is one
# object, "static". Coordinates: game (x, y up, z south) -> Blender (x, -z, y).
import bpy, bmesh, json, math, os, sys, time
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(REPO, 'assets', 'models', 'lobby')
BUILD = os.path.join(HERE, 'build')
os.makedirs(OUT, exist_ok=True)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def arg(k, d):
    return type(d)(argv[argv.index(k) + 1]) if k in argv else d
SAMPLES = arg('--samples', 256)
SIZE = arg('--size', 2048)
NOBAKE = '--nobake' in argv
LM_SCALE = 4.0          # the JPEG stores light / LM_SCALE (must match bakedRoom.js)

J = json.load(open(os.path.join(HERE, 'lobby.json')))
T_W = J['wallThickness']

# ---- heights (metres) ------------------------------------------------------------------------
H_TOP = 2.40            # the lobby's walls are cut at this consistent height (architectural model)
SPLIT = 0.64            # cutaway: the upper part folds down onto this cut
CAP_LO = 0.66           # the dark cut cap on the lower part, 0.64 -> 0.66
DOOR_H = 2.06           # doorway openings
PROUD_CAP_IN, PROUD_CAP_OUT = 0.09, 0.04

# ---- palette (sRGB) --------------------------------------------------------------------------
C = dict(
    wall='#43261a', panel='#52301f', rail='#5e3824', cap='#26150c', skirting='#2b180e',
    brass='#caa14c', brassDark='#9c7a34', gold='#bf9645',
    velvet='#6b2029', velvetDeep='#4e161d', velvetHi='#782530',
    walnut='#5a3520', walnutDark='#3b2314', walnutTop='#6b4128',
    planter='#34211a', soil='#2a1d14', leaf1='#2e6b36', leaf2='#3d8040', leaf3='#255a2c',
    shade='#f6e3b8', rugDeep='#4d1015', canvas='#2c2a24', threshold='#3a2416',
)

def lin(h):
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c) + (1.0,)

MATS = ['vc', 'floor', 'rug', 'art', 'glow']
MI = {m: i for i, m in enumerate(MATS)}

def G(x, y, z):
    return Vector((x, -z, y))

# ---- geometry accumulation -------------------------------------------------------------------
class Target:
    """Raw geometry for one output object (verts in game space until built)."""
    def __init__(self, name, origin=(0.0, 0.0, 0.0)):
        self.name, self.origin = name, origin
        self.V, self.F, self.FM, self.LC, self.LUV = [], [], [], [], []

    def add_bm(self, bm, color, mat='vc', uvfn=None, face_mat=None):
        """Append a primitive's bmesh. uvfn(face, loop) -> uv for textured faces; face_mat(face) ->
        material name override per face (e.g. only the top of a rug is textured)."""
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
                self.LUV.append(uvfn(f, l) if (uvfn and m != 'vc') else (0.0, 0.0))
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

def box(t, x0, x1, y0, y1, z0, z1, color, bevel=0.012, segs=2, mat='vc', uvfn=None, face_mat=None, drop=()):
    """Axis-aligned box in GAME space (x right, y up, z south), with softened edges. Faces that can
    never be seen are left out (`drop` names outward directions: down/up/n/s/e/w); a box standing on
    the floor loses its bottom automatically. Fewer hidden faces = more light-map texels for the rest."""
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

def plane(t, x0, x1, z0, z1, y, mat, uvfn):
    """One upward-facing quad (floor, rugs)."""
    bm = bmesh.new()
    vs = [bm.verts.new(G(x, y, z)) for (x, z) in ((x0, z1), (x1, z1), (x1, z0), (x0, z0))]
    bm.faces.new(vs)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    t.add_bm(bm, '#ffffff', mat, uvfn)

def cyl(t, x, z, y0, y1, r0, r1=None, color='#ffffff', segs=24, bevel=0.0, mat='vc', caps=True):
    r1 = r0 if r1 is None else r1
    bm = bmesh.new()
    M = Matrix.Translation(G(x, (y0 + y1) / 2, z))
    bmesh.ops.create_cone(bm, cap_ends=caps, cap_tris=False, segments=segs, radius1=r0, radius2=r1, depth=y1 - y0, matrix=M)
    if bevel > 0:
        caps = [e for e in bm.edges if all(abs(v.co.z - M.translation.z) > (y1 - y0) / 2 - 1e-4 for v in e.verts)]
        bmesh.ops.bevel(bm, geom=caps, offset=min(bevel, (y1 - y0) * 0.45), offset_type='OFFSET', segments=2, profile=0.5, affect='EDGES', clamp_overlap=True)
    t.add_bm(bm, color, mat)

def leaf(t, x, z, y, yaw, pitch, length, width, color):
    """A faceted broad leaf (flattened bipyramid) rising from (x, y, z) toward yaw at `pitch`."""
    bm = bmesh.new()
    th = width * 0.18
    pts = [(0, 0, 0), (length, 0, 0), (length * 0.45, width / 2, 0), (length * 0.45, -width / 2, 0),
           (length * 0.45, 0, th), (length * 0.45, 0, -th)]
    vs = [bm.verts.new(p) for p in pts]
    b, tip, l, r, up, dn = vs
    for tri in ((b, l, up), (b, up, r), (b, r, dn), (b, dn, l), (tip, up, l), (tip, r, up), (tip, dn, r), (tip, l, dn)):
        bm.faces.new(tri)
    # local: +X along the leaf, +Z up (Blender). Pitch up, then yaw about the vertical.
    R = Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(-pitch, 4, 'Y')
    bmesh.ops.transform(bm, matrix=Matrix.Translation(G(x, y, z)) @ R, verts=bm.verts)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    t.add_bm(bm, color)

def cone_shade(t, x, z, y0, y1, r0, r1):
    cyl(t, x, z, y0, y1, r0, r1, C['shade'], segs=20, mat='glow')

# ---- walls -----------------------------------------------------------------------------------
IN = {'north': (0, 1), 'south': (0, -1), 'west': (1, 0), 'east': (-1, 0)}   # into the room
R_MIN, R_MAX = J['min'], J['max']

class Seg:
    def __init__(self, w):
        self.id = w['id']
        side = self.side = w['side']
        self.key = '%s_%s' % (side, self.id.split(':')[-1])
        self.neighbour = w['neighbour']
        self.axis = 'x' if side in ('north', 'south') else 'z'
        mn, mx = w['min'], w['max']
        self.nx, self.nz = IN[side]
        if self.axis == 'x':
            self.s0, self.s1 = mn[0], mx[0]
            self.face = mx[1] if side == 'north' else mn[1]           # inner face
            self.outer = mn[1] if side == 'north' else mx[1]
        else:
            self.s0, self.s1 = mn[1], mx[1]
            self.face = mx[0] if side == 'west' else mn[0]
            self.outer = mn[0] if side == 'west' else mx[0]
        self.cx = (mn[0] + mx[0]) / 2
        self.cz = (mn[1] + mx[1]) / 2
        self.lo = target('W_%s_lo' % self.key, (self.cx, 0.0, self.cz))
        self.up = target('W_%s_up' % self.key, (self.cx, SPLIT, self.cz))
        self.caplo = target('W_%s_cap' % self.key, (self.cx, 0.0, self.cz))   # joined into _lo after the bake
        self.gaps = []                                                     # along-ranges with no wall trim
        self.into_wall = {(0, 1): 'n', (0, -1): 's', (1, 0): 'w', (-1, 0): 'e'}[(self.nx, self.nz)]

    def n_off(self, d):
        """Coordinate across the wall, `d` metres from the inner face into the room."""
        return self.face + (self.nz if self.axis == 'x' else self.nx) * d

    def rect(self, s0, s1, d0, d1):
        """(x0, x1, z0, z1) for an along-range and a depth range measured from the inner face."""
        a, b = sorted((self.n_off(d0), self.n_off(d1)))
        return (s0, s1, a, b) if self.axis == 'x' else (a, b, s0, s1)

    def put(self, s0, s1, y0, y1, d0, d1, color, bevel=0.008, where=None, **kw):
        """A box on this wall; split across the cut when it spans it (unless `where` is given).
        A box starting on the wall face loses its (invisible) back face."""
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
        """Split an along-range around the gaps (lift, door casing)."""
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

segs = [Seg(w) for w in J['walls']]
by_side = {}
for s in segs:
    by_side.setdefault(s.side, []).append(s)

# Inner-face along-range: north/south trims run corner to corner (inner faces); east/west trims stop
# short of the corner by their own projection, so two mouldings never overlap in an inner corner.
INNER_MIN = R_MIN[0] + T_W, R_MIN[1] + T_W
INNER_MAX = R_MAX[0] - T_W, R_MAX[1] - T_W

def inner_range(sg, proud):
    if sg.axis == 'x':
        return max(sg.s0, INNER_MIN[0]), min(sg.s1, INNER_MAX[0])
    return max(sg.s0, INNER_MIN[1] + proud), min(sg.s1, INNER_MAX[1] - proud)

doors = J['doorways']
def door_of(sg):
    for d in doors:
        dc = d['center'][0] if sg.axis == 'x' else d['center'][1]
        other = d['center'][1] if sg.axis == 'x' else d['center'][0]
        if (d['axis'] == sg.axis) and abs(other - (sg.outer + sg.face) / 2) < 0.2:
            if abs(sg.s0 - (dc + d['width'] / 2)) < 1e-3 or abs(sg.s1 - (dc - d['width'] / 2)) < 1e-3:
                return d
    return None

CASING_W, CASING_P = 0.15, 0.05
for sg in segs:
    d = door_of(sg)
    sg.door = d
    if d:
        dc = d['center'][0] if sg.axis == 'x' else d['center'][1]
        hw = d['width'] / 2
        sg.gaps.append((dc - hw - CASING_W, dc + hw + CASING_W))

# The lift sits in the north wall (its collision footprint is room furniture).
lift = next(f for f in J['furniture'] if f['kind'] == 'lift')
LIFT_X, LIFT_W = lift['center'][0], lift['size'][0]
lift_seg = next(s for s in segs if s.side == 'north' and s.s0 - 1e-6 <= LIFT_X <= s.s1 + 1e-6)
lift_seg.gaps.append((LIFT_X - LIFT_W / 2 - 0.02, LIFT_X + LIFT_W / 2 + 0.02))

LIGHTS = []   # (x, y, z, watts, radius, colour) point lights for the bake

def wall_run(sg):
    # 1. the solid slab, lower and upper, through the whole thickness
    th = abs(sg.outer - sg.face)
    sg.put(sg.s0, sg.s1, 0.0, SPLIT, -th, 0.0, C['wall'], bevel=0.0, drop=('up', 'down'))
    sg.put(sg.s0, sg.s1, CAP_LO, H_TOP - 0.1, -th, 0.0, C['wall'], bevel=0.0, drop=('up', 'down'))
    # the cut cap on the lower part: dark wood over the whole thickness, proud on both faces
    for a, b in [(sg.s0, sg.s1)]:
        box_in = PROUD_CAP_IN * 0.5
        x0, x1, z0, z1 = sg.rect(a, b, -th - 0.012, 0.0)
        box(sg.caplo, x0, x1, SPLIT, CAP_LO, z0, z1, C['cap'], 0.004)
        for ra, rb in sg.trim_ranges(*inner_range(sg, box_in)):
            sg.put(ra, rb, SPLIT, CAP_LO, 0.0, box_in, C['cap'], 0.004, where=sg.caplo)
    # the top cap: the defining "cut model" line, dark wood proud on both sides
    ext = 0.0 if sg.axis == 'x' else 0.0
    x0, x1, z0, z1 = sg.rect(sg.s0, sg.s1, -th - PROUD_CAP_OUT, PROUD_CAP_IN)
    lift_y = 0.0 if sg.axis == 'x' else 0.003     # east/west caps sit 3 mm higher: no coplanar overlap
    if sg.axis == 'z':   # stretch the east/west caps over the corner so no slab top is ever bare
        if abs(sg.s0 - INNER_MIN[1]) < 1e-3: z0 = R_MIN[1] - PROUD_CAP_OUT
        if abs(sg.s1 - INNER_MAX[1]) < 1e-3: z1 = R_MAX[1] + PROUD_CAP_OUT
    else:
        if abs(sg.s0 - R_MIN[0]) < 1e-3: x0 = R_MIN[0] - PROUD_CAP_OUT
        if abs(sg.s1 - R_MAX[0]) < 1e-3: x1 = R_MAX[0] + PROUD_CAP_OUT
    box(sg.up, x0, x1, H_TOP - 0.1 + lift_y, H_TOP + lift_y, z0, z1, C['cap'], 0.02)

    # 2. room-side trim, split around the gaps
    def run(y0, y1, proud, color, bevel=0.006):
        for a, b in sg.trim_ranges(*inner_range(sg, proud)):
            sg.put(a, b, y0, y1, 0.0, proud, color, bevel)
    run(0.0, 0.14, 0.03, C['skirting'])                      # skirting
    run(0.53, SPLIT, 0.035, C['rail'])                       # dado rail (under the cut cap)
    run(0.575, 0.588, 0.041, C['brass'], 0.002)              # brass inlay line
    run(2.02, 2.08, 0.03, C['rail'])                         # crown, stepped out
    run(2.08, 2.10, 0.036, C['brass'], 0.003)
    run(2.10, 2.20, 0.05, C['rail'])
    run(2.20, H_TOP - 0.1, 0.07, C['cap'])

    # 3. raised panels, lower (0.2 - 0.47) and upper (0.76 - 1.95)
    for a, b in sg.trim_ranges(*inner_range(sg, 0.03)):
        L = b - a
        n = max(1, round(L / 0.75))
        w = L / n
        for i in range(n):
            p0, p1 = a + i * w + 0.07, a + (i + 1) * w - 0.07
            if p1 - p0 < 0.12:
                continue
            sg.put(p0, p1, 0.20, 0.47, 0.0, 0.016, C['panel'], 0.01)
            sg.put(p0, p1, 0.76, 1.95, 0.0, 0.016, C['panel'], 0.012)
            sg.put(p0 + 0.05, p1 - 0.05, 0.81, 1.90, 0.0, 0.022, C['wall'], 0.01)   # recessed field

    # 4. the outer face: a plain rail under the cap so the back of the wall reads as finished
    x0, x1, z0, z1 = sg.rect(sg.s0, sg.s1, -th - 0.02, -th)
    box(sg.up, x0, x1, 2.14, 2.20, z0, z1, C['rail'], 0.006)

for sg in segs:
    wall_run(sg)

# ---- doorways: walnut casings with brass plinths, a lintel wall over the opening, threshold ----
def door_frame(sg):
    d = sg.door
    dc = d['center'][0] if sg.axis == 'x' else d['center'][1]
    hw = d['width'] / 2
    th = abs(sg.outer - sg.face)
    near = sg.s1 <= dc      # this segment is on the low side of the opening
    j0, j1 = (dc - hw - CASING_W, dc - hw) if near else (dc + hw, dc + hw + CASING_W)
    sg.put(j0, j1, 0.0, DOOR_H + 0.1, 0.0, CASING_P, C['rail'], 0.012)                  # casing
    sg.put(j0 + 0.03, j1 - 0.03, 0.2, DOOR_H + 0.04, 0.0, CASING_P + 0.012, C['walnut'], 0.008)   # fluting
    sg.put(j0 - 0.01, j1 + 0.01, 0.0, 0.22, 0.0, CASING_P + 0.018, C['brass'], 0.01)     # brass plinth
    # the reveal: line the opening's side with walnut through the thickness
    rv = (dc - hw - 0.02, dc - hw) if near else (dc + hw, dc + hw + 0.02)
    sg.put(rv[0], rv[1], 0.0, DOOR_H, -th, 0.0, C['walnut'], 0.004)
    if not near:
        return
    # over the opening (owned by the low-side segment; both door segments always move together)
    up = sg.up
    x0, x1, z0, z1 = sg.rect(dc - hw, dc + hw, -th, 0.0)
    box(up, x0, x1, DOOR_H, H_TOP - 0.1, z0, z1, C['wall'], 0.0)
    x0, x1, z0, z1 = sg.rect(dc - hw - CASING_W, dc + hw + CASING_W, 0.0, CASING_P)
    box(up, x0, x1, DOOR_H, DOOR_H + 0.12, z0, z1, C['rail'], 0.012)                    # casing head
    x0, x1, z0, z1 = sg.rect(dc - hw - CASING_W - 0.02, dc + hw + CASING_W + 0.02, 0.0, CASING_P + 0.02)
    box(up, x0, x1, DOOR_H + 0.12, DOOR_H + 0.15, z0, z1, C['brass'], 0.006)             # brass cornice line
    x0, x1, z0, z1 = sg.rect(dc - hw - 0.001, dc + hw + 0.001, -th - PROUD_CAP_OUT, PROUD_CAP_IN)
    box(up, x0, x1, H_TOP - 0.1, H_TOP, z0, z1, C['cap'], 0.02)                          # cap over the opening
    x0, x1, z0, z1 = sg.rect(dc - hw, dc + hw, 0.0, 0.07)
    box(up, x0, x1, 2.20, H_TOP - 0.1, z0, z1, C['cap'], 0.006)
    # threshold in the opening (lobby half): walnut saddle with a brass nosing on the room edge
    x0, x1, z0, z1 = sg.rect(dc - hw, dc + hw, -th, 0.0)
    box(target('static'), x0, x1, 0.0, 0.014, z0, z1, C['threshold'], 0.004)
    x0, x1, z0, z1 = sg.rect(dc - hw, dc + hw, -0.02, 0.025)
    box(target('static'), x0, x1, 0.0, 0.018, z0, z1, C['brass'], 0.005)
    # a sconce either side of every doorway, as in the reference
    for s in (dc - hw - CASING_W - 0.28, dc + hw + CASING_W + 0.28):
        seg = sg if (sg.s0 <= s <= sg.s1) else next(o for o in by_side[sg.side] if o.s0 <= s <= o.s1)
        sconce(seg, s, 1.62)

def sconce(sg, s, y):
    sg.put(s - 0.05, s + 0.05, y - 0.13, y + 0.13, 0.0, 0.02, C['brass'], 0.01, where=sg.up)
    sg.put(s - 0.015, s + 0.015, y - 0.03, y + 0.0, 0.0, 0.07, C['brass'], 0.006, where=sg.up)
    sg.put(s - 0.05, s + 0.05, y - 0.12, y + 0.12, 0.05, 0.15, C['shade'], 0.02, where=sg.up, mat='glow')
    sg.put(s - 0.055, s + 0.055, y + 0.12, y + 0.15, 0.045, 0.155, C['brass'], 0.008, where=sg.up)
    sg.put(s - 0.055, s + 0.055, y - 0.15, y - 0.12, 0.045, 0.155, C['brass'], 0.008, where=sg.up)
    x0, x1, z0, z1 = sg.rect(s, s, 0.22, 0.22)
    LIGHTS.append((x0, y, z0, 22.0, 0.06, (1.0, 0.72, 0.42)))

def painting(sg, s, y, w, h, quad):
    """A gilt-framed painting; `quad` picks the art.png quadrant (0 TL, 1 TR, 2 BL, 3 BR)."""
    sg.put(s - w / 2 - 0.07, s + w / 2 + 0.07, y - h / 2 - 0.07, y + h / 2 + 0.07, 0.0, 0.045, C['gold'], 0.015, where=sg.up)
    sg.put(s - w / 2 - 0.02, s + w / 2 + 0.02, y - h / 2 - 0.02, y + h / 2 + 0.02, 0.0, 0.052, C['brassDark'], 0.006, where=sg.up)
    u0, v0 = (quad % 2) * 0.5, 0.5 - (quad // 2) * 0.5     # Blender UV origin is bottom-left
    x0, x1, z0, z1 = sg.rect(s - w / 2, s + w / 2, 0.0, 0.058)
    def uvfn(f, l, sg=sg):
        p = l.vert.co    # Blender coords
        gx, gz, gy = p.x, -p.y, p.z
        along = gx if sg.axis == 'x' else gz
        a = (along - (s - w / 2)) / w
        if sg.side in ('south', 'west'):
            a = 1 - a                      # the viewer faces the wall from inside the room
        b = (gy - (y - h / 2)) / h
        # crop to the painting's aspect inside its square quadrant
        asp = w / h
        if asp >= 1:
            b = 0.5 + (b - 0.5) / asp
        else:
            a = 0.5 + (a - 0.5) * asp
        return (u0 + 0.5 * min(max(a, 0), 1), v0 + 0.5 * min(max(b, 0), 1))
    def fm(f, sg=sg):
        n = f.normal     # Blender normal -> game (x, z) = (n.x, -n.y); the canvas faces the room
        into = (-n.y) * sg.nz if sg.axis == 'x' else n.x * sg.nx
        return 'art' if into > 0.9 else 'vc'
    box(sg.up, x0, x1, y - h / 2, y + h / 2, z0, z1, C['canvas'], 0.0, uvfn=uvfn, face_mat=fm)

for sg in segs:
    if sg.door:
        door_frame(sg)

# ---- the lift (north wall): walnut double doors in a brass frame, brass handles ---------------
def build_lift():
    sg = lift_seg
    a, b = LIFT_X - LIFT_W / 2, LIFT_X + LIFT_W / 2
    sg.put(a, a + 0.12, 0.0, 2.02, 0.0, 0.09, C['brass'], 0.015)
    sg.put(b - 0.12, b, 0.0, 2.02, 0.0, 0.09, C['brass'], 0.015)
    sg.put(a, b, 1.92, 2.02, 0.0, 0.09, C['brass'], 0.015, where=sg.up)
    mid = (a + b) / 2
    for l0, l1 in ((a + 0.12, mid - 0.008), (mid + 0.008, b - 0.12)):
        sg.put(l0, l1, 0.0, 1.92, 0.0, 0.035, C['walnut'], 0.01)
        sg.put(l0 + 0.08, l1 - 0.08, 0.12, 0.54, 0.0, 0.05, C['walnutTop'], 0.015)
        sg.put(l0 + 0.08, l1 - 0.08, 0.78, 1.8, 0.0, 0.05, C['walnutTop'], 0.015, where=sg.up)
    for s in (mid - 0.06, mid + 0.06):
        sg.put(s - 0.018, s + 0.018, 0.86, 1.3, 0.0, 0.085, C['brass'], 0.012, where=sg.up)
    # a brass floor dial above the doors
    x0, x1, z0, z1 = sg.rect(mid - 0.2, mid + 0.2, 0.0, 0.03)
    box(sg.up, x0, x1, 2.02, 2.1, z0, z1, C['brassDark'], 0.01)
    # a warm call-button lantern beside the doors
    sg.put(b + 0.1, b + 0.2, 1.05, 1.2, 0.0, 0.04, C['brass'], 0.01, where=sg.up)

build_lift()

# ---- paintings and sconces on the long walls -------------------------------------------------
segd = {s.key: s for s in segs}
def seg_at(side, s):
    return next(o for o in by_side[side] if o.s0 - 1e-6 <= s <= o.s1 + 1e-6)

# north (east of the doorway): the big landscape, as in the reference, between two sconces
painting(seg_at('north', 2.6), 2.6, 1.42, 1.15, 0.8, 0)
sconce(seg_at('north', 3.5), 3.5, 1.62)
# west wall: the lake above the armchair, a portrait by the lift corner
painting(seg_at('west', 2.1), 2.1, 1.45, 0.9, 0.62, 1)
painting(seg_at('west', -2.55), -2.55, 1.42, 0.62, 0.82, 2)
# east wall: still life above the console, landscape to the north
painting(seg_at('east', 2.0), 2.0, 1.5, 0.62, 0.78, 3)
painting(seg_at('east', -2.55), -2.55, 1.42, 1.0, 0.7, 0)
# south wall (the camera side): a landscape behind the sofa, a sconce to its east
painting(seg_at('south', -2.2), -2.2, 1.5, 1.1, 0.62, 1)

# ---- floor, rugs -----------------------------------------------------------------------------
ST = target('static')
FL = target('floor')      # floor + rugs: their own light map, mapped straight down (sharpest shadows)
TILE_M = 4.0              # floor.png covers 4 m
RUGS = [((-3.72, -0.75, 1.05, 3.8), 0),     # the seating group
        ((-0.55, 2.75, -2.75, 0.55), 1)]    # the landing's centre, where the guests gather

def floor_uv(f, l):
    p = l.vert.co
    return (p.x / TILE_M, p.y / TILE_M)

def rug_uv(rect, half):
    x0, x1, z0, z1 = rect
    def uv(f, l):
        p = l.vert.co
        u = (p.x - x0) / (x1 - x0)
        v = 1 - (-p.y - z0) / (z1 - z0)
        return (half * 0.5 + 0.5 * min(max(u, 0), 1), min(max(v, 0), 1))
    return uv

# the floor is cut into cells around the rugs, so no floor texel ever hides under a rug
xs = sorted({R_MIN[0], R_MAX[0]} | {r[0][0] for r in RUGS} | {r[0][1] for r in RUGS})
zs = sorted({R_MIN[1], R_MAX[1]} | {r[0][2] for r in RUGS} | {r[0][3] for r in RUGS})
for i in range(len(xs) - 1):
    for j in range(len(zs) - 1):
        cx, cz = (xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2
        if any(r[0] < cx < r[1] and r[2] < cz < r[3] for r, _ in RUGS):
            continue
        plane(FL, xs[i], xs[i + 1], zs[j], zs[j + 1], 0.0, 'floor', floor_uv)
for rect, half in RUGS:
    plane(FL, rect[0], rect[1], rect[2], rect[3], 0.008, 'rug', rug_uv(rect, half))

# ---- furniture: one chunky, softly bevelled style --------------------------------------------
def F(kind):
    return [f for f in J['furniture'] if f['kind'] == kind]

def sofa(cx, cz, facing, width, depth, seats):
    """Red velvet sofa/armchair. `facing` is the direction the sitter looks: 'n', 'e'."""
    # local frame: u along the back, w toward the front
    def at(u0, u1, w0, w1):
        if facing == 'n':   # front toward -z
            return (cx + u0, cx + u1, cz - w1, cz - w0)
        return (cx + w0, cx + w1, cz + u0, cz + u1)   # 'e': front toward +x
    hw, hd = width / 2, depth / 2
    arm = 0.2
    def bx(u0, u1, w0, w1, y0, y1, col, bev):
        x0, x1, z0, z1 = at(u0, u1, w0, w1)
        box(ST, x0, x1, y0, y1, z0, z1, C[col], bev)
    for u in (-hw + 0.08, hw - 0.08):
        for w in (-hd + 0.08, hd - 0.1):
            bx(u - 0.04, u + 0.04, w - 0.04, w + 0.04, 0.0, 0.1, 'walnutDark', 0.01)   # feet
    bx(-hw, hw, -hd, hd, 0.08, 0.36, 'velvetDeep', 0.05)                                # base
    bx(-hw + 0.02, hw - 0.02, hd - 0.28, hd, 0.3, 0.92, 'velvet', 0.08)                 # back
    for s in (-1, 1):
        bx(s * hw - (arm if s > 0 else 0), s * hw + (arm if s < 0 else 0), -hd, hd, 0.3, 0.68, 'velvet', 0.08)   # arms
    inner = width - 2 * arm
    cw = inner / seats
    for i in range(seats):
        u0 = -hw + arm + i * cw + 0.01
        bx(u0, u0 + cw - 0.02, -hd + 0.02, hd - 0.26, 0.34, 0.5, 'velvetHi', 0.07)      # seat cushion
        bx(u0 + 0.02, u0 + cw - 0.04, hd - 0.42, hd - 0.2, 0.46, 0.84, 'velvetHi', 0.08)   # back cushion

s = F('sofa')[0]
sofa(s['center'][0] + 0.2, s['center'][1] + 0.02, 'n', 2.0, 0.94, 2)
c = F('chair')[0]
sofa(c['center'][0] - 0.02, c['center'][1], 'e', 1.0, 0.92, 1)

# round walnut coffee table on four legs
t = F('coffeeTable')[0]
tx, tz = t['center']
cyl(ST, tx, tz, 0.4, 0.47, 0.46, color=C['walnutTop'], segs=40, bevel=0.02)
cyl(ST, tx, tz, 0.34, 0.4, 0.41, color=C['walnut'], segs=40, bevel=0.01)
for a in range(4):
    ang = math.pi / 4 + a * math.pi / 2
    lx, lz = tx + 0.3 * math.cos(ang), tz + 0.3 * math.sin(ang)
    box(ST, lx - 0.035, lx + 0.035, 0.0, 0.36, lz - 0.035, lz + 0.035, C['walnutDark'], 0.012)
# a brass tray and two books on the table
cyl(ST, tx + 0.1, tz - 0.05, 0.47, 0.49, 0.14, color=C['brass'], segs=24, bevel=0.006)
box(ST, tx - 0.28, tx - 0.02, 0.47, 0.5, tz + 0.02, tz + 0.2, '#2f4a5c', 0.008)
box(ST, tx - 0.26, tx - 0.04, 0.5, 0.525, tz + 0.04, tz + 0.18, '#7e2632', 0.008)

def table_lamp(x, z, y, h=0.6, shade_r=0.15):
    cyl(ST, x, z, y, y + 0.03, 0.09, color=C['brass'], segs=20, bevel=0.01)
    cyl(ST, x, z, y + 0.03, y + h * 0.42, 0.07, 0.05, color=C['brass'], segs=20)
    cyl(ST, x, z, y + h * 0.42, y + h * 0.62, 0.015, color=C['brassDark'], segs=10)
    cone_shade(ST, x, z, y + h * 0.58, y + h, shade_r, shade_r * 0.7)
    # the bulb: a pool of warm light below the shade, and a softer glow above it
    LIGHTS.append((x, y + h * 0.5, z, 70.0, 0.1, (1.0, 0.72, 0.44)))
    LIGHTS.append((x, y + h + 0.08, z, 12.0, 0.1, (1.0, 0.76, 0.5)))

# side table + lamp at the sofa's west end (inside the sofa's footprint and the wall margin)
sx, sz = -3.47, 3.4
box(ST, sx - 0.24, sx + 0.24, 0.0, 0.56, sz - 0.24, sz + 0.24, C['walnut'], 0.02)
box(ST, sx - 0.26, sx + 0.26, 0.56, 0.6, sz - 0.26, sz + 0.26, C['walnutTop'], 0.015)
box(ST, sx - 0.18, sx + 0.18, 0.3, 0.46, sz - 0.25, sz - 0.24, C['walnutTop'], 0.004)
table_lamp(sx, sz + 0.02, 0.6)

# console (east wall) with drawers, brass pulls, a lamp and a vase
k = F('console')[0]
kx, kz = k['center']
x0, x1 = R_MAX[0] - T_W - 0.5, R_MAX[0] - T_W - 0.01
z0, z1 = kz - 0.6, kz + 0.6
for zz in (z0 + 0.06, z1 - 0.06):
    for xx in (x0 + 0.06, x1 - 0.06):
        box(ST, xx - 0.04, xx + 0.04, 0.0, 0.12, zz - 0.04, zz + 0.04, C['walnutDark'], 0.01)
box(ST, x0, x1, 0.1, 0.84, z0, z1, C['walnut'], 0.02)
box(ST, x0 - 0.02, x1, 0.84, 0.89, z0 - 0.03, z1 + 0.03, C['walnutTop'], 0.015)
for row in range(3):
    y0 = 0.16 + row * 0.225
    for col in range(2):
        d0 = z0 + 0.05 + col * 0.56
        box(ST, x0 - 0.012, x0 + 0.02, y0, y0 + 0.2, d0, d0 + 0.53, C['walnutTop'], 0.008)
        box(ST, x0 - 0.035, x0 - 0.01, y0 + 0.085, y0 + 0.115, d0 + 0.2, d0 + 0.33, C['brass'], 0.006)
table_lamp(kx + 0.05, kz + 0.33, 0.89, 0.62, 0.16)
cyl(ST, kx + 0.05, kz - 0.3, 0.89, 1.12, 0.07, 0.05, color='#2f5a50', segs=16)
cyl(ST, kx + 0.05, kz - 0.3, 1.12, 1.16, 0.045, color='#2f5a50', segs=16)

# plants in brass-trimmed planters
def plant(x, z, seed):
    import random
    r = random.Random(seed)
    box(ST, x - 0.24, x + 0.24, 0.0, 0.5, z - 0.24, z + 0.24, C['planter'], 0.03)
    box(ST, x - 0.255, x + 0.255, 0.44, 0.52, z - 0.255, z + 0.255, C['brass'], 0.012)
    box(ST, x - 0.25, x + 0.25, 0.0, 0.05, z - 0.25, z + 0.25, C['brass'], 0.01)
    box(ST, x - 0.2, x + 0.2, 0.5, 0.53, z - 0.2, z + 0.2, C['soil'], 0.0)
    n = 13
    for i in range(n):
        yaw = i * (2 * math.pi / n) * 2.618 + r.uniform(-0.2, 0.2)
        tier = i % 3
        pitch = (0.35, 0.75, 1.1)[tier] + r.uniform(-0.1, 0.1)
        length = (0.62, 0.58, 0.48)[tier] + r.uniform(-0.05, 0.05)
        col = (C['leaf1'], C['leaf2'], C['leaf3'])[i % 3]
        leaf(ST, x, z, 0.52 + tier * 0.12, yaw, pitch, length, 0.2, col)
    cyl(ST, x, z, 0.5, 0.95, 0.025, color=C['leaf3'], segs=6)

for i, p in enumerate(F('plant')):
    plant(p['center'][0], p['center'][1], i + 3)

# ---- build Blender objects -------------------------------------------------------------------
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

def make_material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = 0.85
    if name == 'vc':
        a = nt.nodes.new('ShaderNodeVertexColor'); a.layer_name = 'Col'
        nt.links.new(a.outputs['Color'], bsdf.inputs['Base Color'])
    elif name in ('floor', 'rug', 'art'):
        img = bpy.data.images.load(os.path.join(BUILD, {'floor': 'floor.png', 'rug': 'rugs.png', 'art': 'art.png'}[name]))
        tx = nt.nodes.new('ShaderNodeTexImage'); tx.image = img
        uvn = nt.nodes.new('ShaderNodeUVMap'); uvn.uv_map = 'UVMap'
        nt.links.new(uvn.outputs['UV'], tx.inputs['Vector'])
        nt.links.new(tx.outputs['Color'], bsdf.inputs['Base Color'])
    elif name == 'glow':
        bsdf.inputs['Base Color'].default_value = lin(C['shade'])
        bsdf.inputs['Emission Color'].default_value = lin(C['shade'])
        bsdf.inputs['Emission Strength'].default_value = 2.0
    return m

materials = [make_material(n) for n in MATS]

def build(t):
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
    flat = [c for col in t.LC for c in col]
    ca.data.foreach_set('color', flat)
    uv = me.uv_layers.new(name='UVMap')
    uv.data.foreach_set('uv', [c for p in t.LUV for c in p])
    me.uv_layers.new(name='Light')
    me.validate()
    ob = bpy.data.objects.new(t.name, me)
    ob.location = o
    scene.collection.objects.link(ob)
    return ob

objs = {name: build(t) for name, t in T.items() if t.V}
tri = sum(len(o.data.polygons) for o in objs.values())
print('objects', len(objs), 'faces', tri)

# ---- light-map UVs ---------------------------------------------------------------------------
# The floor (+ rugs) is mapped straight down onto its own light map; everything else shares one
# atlas, unwrapped together so every surface gets the same texel density.
fl = objs['floor']
uvl = fl.data.uv_layers['Light']
for poly in fl.data.polygons:
    for li in poly.loop_indices:
        co = fl.data.vertices[fl.data.loops[li].vertex_index].co
        uvl.data[li].uv = ((co.x - R_MIN[0]) / (R_MAX[0] - R_MIN[0]), (co.y + R_MAX[1]) / (R_MAX[1] - R_MIN[1]))
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
bpy.ops.uv.pack_islands(rotate=True, margin=0.001)
bpy.ops.object.mode_set(mode='OBJECT')

# ---- bake -------------------------------------------------------------------------------------
FLOOR_SIZE = SIZE // 2 if SIZE >= 2048 else SIZE

def setup_lighting():
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = SAMPLES
    scene.cycles.max_bounces = 4
    scene.cycles.diffuse_bounces = 3
    world = bpy.data.worlds.new('sky'); scene.world = world
    world.use_nodes = True
    world.light_settings.distance = 0.6          # ambient-occlusion reach (the AO pass)
    bg = world.node_tree.nodes['Background']
    bg.inputs['Color'].default_value = (0.72, 0.66, 0.58, 1)      # warm, soft light from the open top
    bg.inputs['Strength'].default_value = 0.22
    # a soft key light high above the camera side: gentle shadows fall behind the furniture
    ld = bpy.data.lights.new('key', 'AREA'); ld.size = 3.0; ld.energy = 1100; ld.color = (1.0, 0.93, 0.84)
    lo = bpy.data.objects.new('key', ld); lo.location = G(-2.2, 7.0, 3.0); scene.collection.objects.link(lo)
    lo.rotation_euler = (math.radians(-18), math.radians(-10), 0)
    for (x, y, z, w, r, col) in LIGHTS:
        pd = bpy.data.lights.new('lamp', 'POINT'); pd.energy = w; pd.shadow_soft_size = r; pd.color = col
        po = bpy.data.objects.new('lamp', pd); po.location = G(x, y, z); scene.collection.objects.link(po)

def bake_pass(kind, images, clear):
    """Bake `kind` ('DIFFUSE' light or 'AO') for the atlas objects and the floor into `images`
    ({'atlas': img, 'floor': img}); the cut caps are baked again with the upper walls hidden."""
    for m in materials:
        n = m.node_tree.nodes.get('bake') or m.node_tree.nodes.new('ShaderNodeTexImage')
        n.name = 'bake'
        n.image = images['floor'] if m.name in ('floor', 'rug') else images['atlas']
        n.select = True; m.node_tree.nodes.active = n
    caps = [o for n, o in objs.items() if n.endswith('_cap')]
    others = [o for n, o in objs.items() if not n.endswith('_cap')]
    ups = [o for n, o in objs.items() if n.endswith('_up')]
    extra = dict(pass_filter={'DIRECT', 'INDIRECT'}) if kind == 'DIFFUSE' else {}
    bpy.ops.object.select_all(action='DESELECT')
    for o in others: o.select_set(True)
    bpy.context.view_layer.objects.active = others[0]
    bpy.ops.object.bake(type=kind, use_clear=clear, margin=6, **extra)
    for o in ups: o.hide_render = True
    bpy.ops.object.select_all(action='DESELECT')
    for o in caps: o.select_set(True)
    bpy.context.view_layer.objects.active = caps[0]
    bpy.ops.object.bake(type=kind, use_clear=False, margin=6, **extra)
    for o in ups: o.hide_render = False

def bake():
    setup_lighting()
    rb = scene.render.bake
    rb.use_pass_direct = True; rb.use_pass_indirect = True; rb.use_pass_color = False
    rb.margin = 6; rb.margin_type = 'EXTEND'
    light = {'atlas': bpy.data.images.new('light_atlas', SIZE, SIZE, float_buffer=True),
             'floor': bpy.data.images.new('light_floor', FLOOR_SIZE, FLOOR_SIZE, float_buffer=True)}
    ao = {'atlas': bpy.data.images.new('ao_atlas', SIZE, SIZE, float_buffer=True),
          'floor': bpy.data.images.new('ao_floor', FLOOR_SIZE, FLOOR_SIZE, float_buffer=True)}
    t0 = time.time()
    bake_pass('DIFFUSE', light, True)
    print('bake light: %.1fs' % (time.time() - t0))
    samples = scene.cycles.samples
    scene.cycles.samples = max(32, samples // 2)
    bake_pass('AO', ao, True)
    scene.cycles.samples = samples
    print('bake ao: %.1fs' % (time.time() - t0))
    return light, ao

def denoise(img, size):
    """Run a baked image through Blender's compositor denoiser (Open Image Denoise)."""
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
    sc.render.filepath = os.path.join(BUILD, 'denoised-%s.exr' % img.name)
    sc.render.image_settings.file_format = 'OPEN_EXR'
    sc.view_settings.view_transform = 'Standard'
    bpy.ops.render.render(write_still=True, scene=sc.name)
    r = bpy.data.images.load(sc.render.filepath)
    return np.array(r.pixels[:], np.float32).reshape(size, size, 4)[:, :, :3]

AO_STRENGTH = 0.85   # how much of the contact-shadow pass is multiplied into the light

def save_lightmap(light, ao, key, size, name):
    import numpy as np
    from PIL import Image
    px = denoise(light[key], size)
    occ = denoise(ao[key], size).mean(axis=2, keepdims=True)
    px = px * (1 - AO_STRENGTH + AO_STRENGTH * np.clip(occ, 0, 1))
    np.save(os.path.join(BUILD, name + '.npy'), px)
    v = np.clip(px / LM_SCALE, 0, 1)
    s = np.where(v <= 0.0031308, v * 12.92, 1.055 * np.power(v, 1 / 2.4) - 0.055)
    Image.fromarray((s * 255 + 0.5).astype(np.uint8)[::-1], 'RGB').save(os.path.join(OUT, name + '.jpg'), quality=92)
    used = px[px.max(axis=2) > 0.001]
    print('%s: %dpx  used %.0f%%  mean %.3f  p10 %.3f  p90 %.3f' % (name, size, 100 * len(used) / (size * size), used.mean(), np.percentile(used, 10), np.percentile(used, 90)))

if not NOBAKE:
    light, ao = bake()
    save_lightmap(light, ao, 'atlas', SIZE, 'lobby-light')
    save_lightmap(light, ao, 'floor', FLOOR_SIZE, 'lobby-floor-light')

# join each wall's cut cap into its lower part (UVs and the baked islands come along)
for n in list(objs):
    if n.endswith('_cap'):
        lo = objs[n.replace('_cap', '_lo')]
        bpy.ops.object.select_all(action='DESELECT')
        objs[n].select_set(True); lo.select_set(True)
        bpy.context.view_layer.objects.active = lo
        bpy.ops.object.join()
        del objs[n]

# remove the bake image nodes so the exporter ignores them
for m in materials:
    n = m.node_tree.nodes.get('bake')
    if n:
        m.node_tree.nodes.remove(n)

bpy.ops.object.select_all(action='DESELECT')
for o in objs.values():
    o.select_set(True)
bpy.ops.export_scene.gltf(
    filepath=os.path.join(OUT, 'lobby.glb'), export_format='GLB', use_selection=True,
    export_texcoords=True, export_normals=False, export_vertex_color='MATERIAL',
    export_image_format='JPEG', export_jpeg_quality=88, export_lights=False, export_cameras=False,
    export_apply=False, export_yup=True)
print('exported', os.path.join(OUT, 'lobby.glb'), os.path.getsize(os.path.join(OUT, 'lobby.glb')), 'bytes')
