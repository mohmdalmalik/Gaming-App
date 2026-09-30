# Build ONE room tile as a baked, stylised model matching the owner's reference for it
# (tools/room-pipeline/ref/<room>.jpg; see README.md).
#
#   python3 tools/room-pipeline/make_room.py --room library [--size 1024] [--samples 48] [--nobake]
#
# Output (assets/models/rooms/):
#   <room>.glb            geometry + albedo UVs (the shared atlas albedo.jpg, loaded by the game) and a
#                         second UV set for the baked light; objects "static", "floor", "W_<side>_<k>_up"
#   <room>-light.jpg      baked light for walls and furniture (light / LM_SCALE, sRGB)
#   <room>-floor.jpg      baked light for the floor and rugs (mapped straight down)
#
# Built on the game's own data (rooms.json, dumped from src/data/hotel.js): walls, doorways and the
# furniture footprints (collision) line up exactly. Everything is in the tile's DEFAULT orientation.
# Each footprint `kind` has a builder below that stays inside its footprint; decoration without
# collision (paintings, sconces, curtains, shelves on the wall) stays within the 0.3 m band along the
# walls that guests never enter.
import bpy, json, math, os, sys, random, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from roomkit import *            # noqa: E402,F401,F403
import roomkit as K              # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
BUILD = os.path.join(HERE, 'build')
argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def arg(k, d):
    return type(d)(argv[argv.index(k) + 1]) if k in argv else d
OUT = arg('--out', os.path.join(REPO, 'assets', 'models', 'rooms'))      # --out elsewhere for a trial build
os.makedirs(OUT, exist_ok=True); os.makedirs(BUILD, exist_ok=True)
ROOM = arg('--room', 'lounge')
SAMPLES = arg('--samples', 48)
SIZE = arg('--size', 1024)
FLOOR_SIZE = arg('--floorsize', 1024)
NOBAKE = '--nobake' in argv

J = json.load(open(os.path.join(HERE, 'rooms.json')))
T_W = J['wallThickness']
R = J['rooms'][ROOM]
ST = target('static')
rng = random.Random(sum(map(ord, ROOM)))

# ---- walls of this room --------------------------------------------------------------------------
SEGS = [Seg(w, R, set(R['doors']), T_W) for w in R['walls']]
for sg in SEGS:
    for d in R['doorways']:
        dc = d['center'][0] if sg.axis == 'x' else d['center'][1]
        other = d['center'][1] if sg.axis == 'x' else d['center'][0]
        if d['axis'] == sg.axis and abs(other - (sg.outer + sg.face) / 2) < 0.2:
            if abs(sg.s0 - (dc + d['width'] / 2)) < 1e-3 or abs(sg.s1 - (dc - d['width'] / 2)) < 1e-3:
                sg.door = d
                sg.gaps.append((dc - d['width'] / 2 - PIL_W, dc + d['width'] / 2 + PIL_W))

def seg_at(side, s):
    return seg_of(SEGS, side, s)

# ---- a local frame for a piece of furniture ------------------------------------------------------
INNER = 3.85
FDIR = {'n': (0, -1), 's': (0, 1), 'e': (1, 0), 'w': (-1, 0)}
FACING_OF_WALL = {'north': 's', 'south': 'n', 'west': 'e', 'east': 'w'}

class Fr:
    """A furniture footprint seen from the piece itself: u across (centred), w from its back (0) to
    its front (D), y up. `facing` is where its front looks; by default away from the nearest wall
    parallel to its longer side."""
    def __init__(self, f, facing=None):
        cx, cz = f['center']; sx, sy, sz = f['size']
        x0, x1, z0, z1 = cx - sx / 2, cx + sx / 2, cz - sz / 2, cz + sz / 2
        if facing is None:
            dist = {'n': z0 + INNER, 's': INNER - z1, 'w': x0 + INNER, 'e': INNER - x1}
            if sx > sz * 1.15: cands = ['n', 's']
            elif sz > sx * 1.15: cands = ['w', 'e']
            else: cands = ['n', 's', 'w', 'e']
            back = min(cands, key=lambda k: dist[k])
            facing = {'n': 's', 's': 'n', 'w': 'e', 'e': 'w'}[back]
        self.facing = facing
        F = FDIR[facing]
        self.F = F; self.Rv = (-F[1], F[0])
        self.W, self.D = (sx, sz) if facing in 'ns' else (sz, sx)
        self.H = sy
        self.back = (cx - F[0] * self.D / 2, cz - F[1] * self.D / 2)
        self.cx, self.cz = cx, cz
        self.yaw = {'s': 0.0, 'e': math.pi / 2, 'n': math.pi, 'w': -math.pi / 2}[facing]

    def at(self, u, w):
        return (self.back[0] + self.F[0] * w + self.Rv[0] * u, self.back[1] + self.F[1] * w + self.Rv[1] * u)

    def box(self, u0, u1, w0, w1, y0, y1, color, bevel=0.012, t=None, **kw):
        a, b = self.at(u0, w0), self.at(u1, w1)
        box(t or ST, min(a[0], b[0]), max(a[0], b[0]), y0, y1, min(a[1], b[1]), max(a[1], b[1]), color, bevel, **kw)

    def obox(self, u, w, y, su, sy, sw, color, yaw=0.0, tilt=0.0, bevel=0.0):
        x, z = self.at(u, w)
        su_, sw_ = (su, sw) if self.facing in 'ns' else (sw, su)
        obox(ST, x, y, z, su_, sy, sw_, color, yaw, tilt, bevel)

    def cyl(self, u, w, y0, y1, r0, r1=None, color='#ffffff', segs=20, bevel=0.0, mat='vc', t=None):
        x, z = self.at(u, w)
        cyl(t or ST, x, z, y0, y1, r0, r1, color, segs, bevel, mat)

    def rod(self, a, b, r, color, segs=8):
        (u0, w0, y0), (u1, w1, y1) = a, b
        p, q = self.at(u0, w0), self.at(u1, w1)
        rod(ST, (p[0], y0, p[1]), (q[0], y1, q[1]), r, color, segs)

    def sphere(self, u, w, y, r, color, segs=10, mat='vc'):
        x, z = self.at(u, w)
        sphere(ST, x, y, z, r, color, mat, segs)

    def front_tex(self, u0, u1, w0, w1, y0, y1, idx, rep_u, color='#20140c', rep_v=None, quad=None):
        """A box whose FRONT face shows atlas cell `idx`, repeating every `rep_u` metres across."""
        n = max(1, math.ceil((u1 - u0) / rep_u - 1e-6))
        step = (u1 - u0) / n
        for i in range(n):
            a0, a1 = u0 + i * step, u0 + (i + 1) * step
            def uv(f, l, a0=a0, a1=a1):
                p = l.vert.co
                gx, gz, gy = p.x, -p.y, p.z
                uu = (gx - self.back[0]) * self.Rv[0] + (gz - self.back[1]) * self.Rv[1]
                fu = (uu - a0) / (a1 - a0)
                fu = 1 - fu if self.facing in ('n', 'e') else fu
                fv = (gy - y0) / ((y1 - y0) if rep_v is None else rep_v)
                return cell_uv(idx, fu, fv, quad)
            def fm(f):
                n_ = f.normal
                return 'tex' if (n_.x * self.F[0] + (-n_.y) * self.F[1]) > 0.9 else 'vc'
            self.box(a0, a1, w0, w1, y0, y1, color, 0.004, uvfn=uv, face_mat=fm)

def wall_frame(side, s, W, D, H):
    """A footprint-like frame for decoration standing against a wall (inside the band guests never reach)."""
    sg = seg_at(side, s)
    x0, x1, z0, z1 = sg.rect(s - W / 2, s + W / 2, 0.0, D)
    return Fr({'center': [(x0 + x1) / 2, (z0 + z1) / 2], 'size': [x1 - x0, H, z1 - z0]}, FACING_OF_WALL[side])

S = lambda h, L=0.72: shown(h, L)       # a colour as it should show (see roomkit.shown)

# ---- small things --------------------------------------------------------------------------------
WOOD, WOOD_D, WOOD_T = shown('#4c2e1c', 0.7), shown('#34200f', 0.7), shown('#5c3824', 0.75)    # the references' chunky dark wood
def lamp_on(x, z, y, h=0.55, shade_r=0.15, watts=60.0):
    cyl(ST, x, z, y, y + 0.03, 0.085, color=C['brass'], segs=16, bevel=0.01)
    cyl(ST, x, z, y + 0.03, y + h * 0.45, 0.03, 0.022, color=C['brass'], segs=10)
    cyl(ST, x, z, y + h * 0.45, y + h * 0.52, 0.045, 0.045, color=C['brass'], segs=10)
    cyl(ST, x, z, y + h * 0.52, y + h, shade_r, shade_r * 0.62, '#fff0cc', segs=18, mat='glow')
    LIGHTS.append((x, y + h * 0.62, z, watts, 0.1, (1.0, 0.9, 0.78)))

def vase(x, z, y, col='#e8e0cc', flowers='#f4eee0', h=0.2):
    cyl(ST, x, z, y, y + h * 0.7, 0.05, 0.07, col, segs=12)
    cyl(ST, x, z, y + h * 0.7, y + h, 0.07, 0.035, col, segs=12)
    if flowers:
        for k in range(5):
            a = k * 2.4
            sphere(ST, x + 0.06 * math.cos(a), y + h + 0.05 + 0.03 * (k % 2), z + 0.06 * math.sin(a), 0.04, flowers, segs=8)
        for k in range(3):
            a = k * 2.1 + 0.5
            sphere(ST, x + 0.08 * math.cos(a), y + h + 0.0, z + 0.08 * math.sin(a), 0.035, C['leaf2'], segs=6)

def pot_plant(x, z, y, s=0.5):
    box(ST, x - 0.07 * s / 0.5, x + 0.07 * s / 0.5, y, y + 0.12 * s / 0.5, z - 0.07 * s / 0.5, z + 0.07 * s / 0.5, '#8a5a34', 0.01)
    for k in range(7):
        leaf(ST, x, z, y + 0.1 * s / 0.5, k * 2.4, 0.6 + 0.3 * (k % 2), 0.22 * s / 0.5, 0.1 * s / 0.5, (C['leaf1'], C['leaf2'])[k % 2])

def books_pile(x, z, y, n=2, yaw=0.0):
    for i in range(n):
        c = ['#2f5a5a', '#8a2a2c', '#3a5a3a', '#b08a58'][(i + int(x * 7)) % 4]
        obox(ST, x, y + i * 0.04 + 0.02, z, 0.26 - i * 0.03, 0.04, 0.18 - i * 0.02, c, yaw + i * 0.15, 0, 0.004)

def plant_at(x, z, scale=1.0, seed=3, planter=True):
    """The references' plant: a square dark planter with a brass rim and foot, and a big fan of broad,
    glossy leaves (a peace lily / banana palm) rising well above it."""
    r = random.Random(seed)
    s = scale
    if planter:
        box(ST, x - 0.24 * s, x + 0.24 * s, 0.0, 0.5 * s, z - 0.24 * s, z + 0.24 * s, S('#3a2418'), 0.02)
        box(ST, x - 0.26 * s, x + 0.26 * s, 0.45 * s, 0.53 * s, z - 0.26 * s, z + 0.26 * s, C['brass'], 0.012)
        box(ST, x - 0.255 * s, x + 0.255 * s, 0.0, 0.06, z - 0.255 * s, z + 0.255 * s, C['brass'], 0.01)
        box(ST, x - 0.21 * s, x + 0.21 * s, 0.5 * s, 0.54 * s, z - 0.21 * s, z + 0.21 * s, C['soil'], 0.0)
    base = 0.54 * s if planter else 0.0
    n = 13
    for i in range(n):
        yaw = i * (2 * math.pi / n) * 2.618 + r.uniform(-0.25, 0.25)
        tier = i % 3
        pitch = (0.55, 0.9, 1.2)[tier] + r.uniform(-0.12, 0.12)
        length = ((0.62, 0.6, 0.5)[tier] + r.uniform(-0.05, 0.06)) * s
        leaf(ST, x, z, base + (0.12, 0.06, 0.0)[tier] * s, yaw, pitch, length, 0.36 * s, (C['leaf1'], C['leaf2'], C['leaf3'])[i % 3])
    cyl(ST, x, z, base - 0.02, base + 0.3 * s, 0.03, color=C['leaf3'], segs=6)

# ---- seating ------------------------------------------------------------------------------------
def sofa(fr, seats=None, cols=(S('#8a2430'), S('#6a1a24'), S('#9a2c38')), legs=WOOD_D):
    """Chunky, clean upholstered sofa / armchair: box arms, a straight back, fat seat cushions."""
    W, D, hs = fr.W, fr.D, fr.H / 0.9
    main, deep, hi = cols
    seats = seats or (1 if W < 1.2 else 2 if W < 1.8 else 3)
    arm = 0.2
    for u in (-W / 2 + 0.08, W / 2 - 0.08):
        for w in (0.1, D - 0.08):
            fr.box(u - 0.04, u + 0.04, w - 0.04, w + 0.04, 0.0, 0.1, legs, 0.01)
    fr.box(-W / 2, W / 2, 0.0, D, 0.08, 0.36 * hs, deep, 0.04)
    fr.box(-W / 2 + 0.02, W / 2 - 0.02, 0.0, 0.26, 0.3, 0.88 * hs, main, 0.06)
    for s in (-1, 1):
        a = s * W / 2
        fr.box(min(a, a - s * arm), max(a, a - s * arm), 0.0, D, 0.3, 0.64 * hs, main, 0.06)
    inner = W - 2 * arm
    cw = inner / seats
    for i in range(seats):
        u0 = -W / 2 + arm + i * cw + 0.01
        fr.box(u0, u0 + cw - 0.02, 0.24, D - 0.02, 0.34, 0.5 * hs, hi, 0.06)
    if seats >= 2:                                          # a scatter cushion or two
        fr.obox(-inner / 2 + 0.25, 0.36, 0.6 * hs, 0.34, 0.3, 0.1, hi, 0.3, -0.3, 0.04)
        fr.obox(inner / 2 - 0.25, 0.36, 0.6 * hs, 0.34, 0.3, 0.1, hi, -0.3, -0.3, 0.04)

def chair(fr, seat=S('#8a2430'), wood=WOOD, back='square'):
    W, D = min(fr.W, 0.5), min(fr.D, 0.5)
    for u in (-W / 2 + 0.05, W / 2 - 0.05):
        for w in (0.05, D - 0.05):
            fr.box(u - 0.024, u + 0.024, w - 0.024, w + 0.024, 0.0, 0.44, WOOD_D, 0.006)
    fr.box(-W / 2, W / 2, 0.0, D, 0.42, 0.47, wood, 0.012)
    fr.box(-W / 2 + 0.03, W / 2 - 0.03, 0.05, D - 0.02, 0.47, 0.53, seat, 0.025)
    for u in (-W / 2 + 0.05, W / 2 - 0.05):
        fr.box(u - 0.024, u + 0.024, 0.02, 0.07, 0.44, 0.95, WOOD_D, 0.006)
    if back == 'oval':
        x, z = fr.at(0.0, 0.05)
        a = Vector(G(fr.Rv[0], 0, fr.Rv[1])); n = Vector(G(fr.F[0], 0, fr.F[1]))
        disc(ST, G(x, 0.78, z), a, Vector((0, 0, 1)), n, W / 2 - 0.02, 0.22, -0.02, 0.02, wood, 20)
        disc(ST, G(x, 0.78, z), a, Vector((0, 0, 1)), n, W / 2 - 0.07, 0.17, -0.03, 0.035, seat, 20)
    else:
        fr.box(-W / 2 + 0.04, W / 2 - 0.04, 0.02, 0.07, 0.6, 0.95, wood, 0.012)
        fr.box(-W / 2 + 0.08, W / 2 - 0.08, 0.05, 0.09, 0.64, 0.9, seat, 0.02)

def swivel_chair(x, z, yaw, seat=S('#2e5a48')):
    """An office chair: five-star base on castors, a padded seat and back."""
    for k in range(5):
        a = yaw + k * 2 * math.pi / 5
        rod(ST, (x, 0.08, z), (x + 0.26 * math.cos(a), 0.05, z + 0.26 * math.sin(a)), 0.02, WOOD_D, 5)
        sphere(ST, x + 0.26 * math.cos(a), 0.035, z + 0.26 * math.sin(a), 0.035, C['black'], 6)
    cyl(ST, x, z, 0.08, 0.42, 0.025, color=C['steelDark'], segs=8)
    cyl(ST, x, z, 0.42, 0.5, 0.23, 0.23, seat, segs=16, bevel=0.03)
    bx, bz = x - 0.2 * math.sin(yaw), z - 0.2 * math.cos(yaw)
    # obox's yaw t leans a positive tilt toward (sin t, cos t); the chair faces (sin yaw, cos yaw), so the
    # back uses yaw + pi to lean away from the seat (backward) whichever way the chair faces
    obox(ST, bx, 0.78, bz, 0.4, 0.42, 0.08, seat, yaw + math.pi, 0.12, 0.03)
    obox(ST, x - 0.17 * math.sin(yaw), 0.56, z - 0.17 * math.cos(yaw), 0.05, 0.14, 0.04, WOOD_D, yaw + math.pi, 0, 0.0)

def bench(fr, top=S('#8a2430'), tufted=False, legs=WOOD_D):
    W, D = fr.W, fr.D
    for u in (-W / 2 + 0.06, W / 2 - 0.06):
        for w in (0.06, D - 0.06):
            fr.box(u - 0.03, u + 0.03, w - 0.03, w + 0.03, 0.0, 0.3, legs, 0.008)
    fr.box(-W / 2 + 0.02, W / 2 - 0.02, 0.02, D - 0.02, 0.08, 0.11, legs, 0.006)
    fr.box(-W / 2, W / 2, 0.0, D, 0.28, 0.33, WOOD, 0.012)
    fr.box(-W / 2 + 0.01, W / 2 - 0.01, 0.01, D - 0.01, 0.33, 0.47, top, 0.05)
    if tufted:
        for i in range(1, 6):
            for j in (0.33, 0.66):
                fr.sphere(-W / 2 + i * W / 6, D * j, 0.47, 0.016, S('#4a0e16'), 6)

def slat_bench(fr):
    """A wooden settle with a slatted back and a red cushion (the service stairs)."""
    W, D = fr.W, fr.D
    for u in (-W / 2 + 0.05, W / 2 - 0.05):
        fr.box(u - 0.04, u + 0.04, 0.02, D - 0.02, 0.0, 0.62, WOOD, 0.01)
        fr.box(u - 0.045, u + 0.045, 0.0, 0.1, 0.0, 0.95, WOOD, 0.01)
    fr.box(-W / 2 + 0.04, W / 2 - 0.04, 0.05, D - 0.02, 0.36, 0.42, WOOD, 0.01)
    fr.box(-W / 2 + 0.06, W / 2 - 0.06, 0.1, D - 0.04, 0.42, 0.5, S('#8a2430'), 0.03)
    for k in range(9):
        u = -W / 2 + 0.12 + k * (W - 0.24) / 8
        fr.box(u - 0.025, u + 0.025, 0.02, 0.06, 0.45, 0.9, WOOD_T, 0.004)
    fr.box(-W / 2 + 0.04, W / 2 - 0.04, 0.0, 0.08, 0.88, 0.95, WOOD, 0.01)

# ---- tables and cabinets --------------------------------------------------------------------------
def round_table(fr, cloth=None, items='lamp', r=None, H=None):
    r = r or min(fr.W, fr.D) / 2 - 0.03
    H = H or min(fr.H, 0.76)
    x, z = fr.cx, fr.cz
    if cloth:
        cyl(ST, x, z, 0.0, H - 0.03, r + 0.06, r + 0.02, cloth, segs=28)
        cyl(ST, x, z, H - 0.03, H, r + 0.02, r + 0.02, cloth, segs=28, bevel=0.012)
    else:
        cyl(ST, x, z, H - 0.06, H, r, r, WOOD_T, segs=28, bevel=0.015)
        cyl(ST, x, z, H - 0.12, H - 0.06, r - 0.05, r - 0.05, WOOD, segs=28)
        if r > 0.35:
            for a in range(4):
                ang = math.pi / 4 + a * math.pi / 2
                px, pz = x + (r - 0.15) * math.cos(ang), z + (r - 0.15) * math.sin(ang)
                box(ST, px - 0.035, px + 0.035, 0.0, H - 0.1, pz - 0.035, pz + 0.035, WOOD_D, 0.01)
        else:
            cyl(ST, x, z, 0.0, H - 0.1, 0.035, 0.035, WOOD_D, segs=10)
            cyl(ST, x, z, 0.0, 0.03, r * 0.7, r * 0.7, WOOD_D, segs=16)
    if items == 'lamp':
        lamp_on(x, z, H, 0.5, 0.14)
    elif items == 'lampVase':
        lamp_on(x - 0.08, z - 0.05, H, 0.5, 0.14)
        vase(x + 0.16, z + 0.1, H, '#e8e0cc', '#f4eee0', 0.12)
    elif items == 'coffee':
        pot_plant(x - 0.12, z - 0.08, H, 0.55)
        books_pile(x + 0.15, z + 0.1, H, 2, 0.4)
    return H

def dining_set(fr, cloth='#efe6d2'):
    """A round clothed table with three oval-back chairs, napkins, plates, a lamp and a posy."""
    H = 0.76
    r = 0.52
    x, z = fr.cx, fr.cz
    cyl(ST, x, z, 0.0, H - 0.03, r + 0.08, r + 0.03, cloth, segs=28)
    cyl(ST, x, z, H - 0.03, H, r + 0.03, r + 0.03, cloth, segs=28, bevel=0.012)
    lamp_on(x - 0.05, z - 0.1, H, 0.42, 0.11, 45.0)
    vase(x + 0.14, z - 0.12, H, '#f0ece0', '#f4eee0', 0.1)
    for k, ang in enumerate((math.pi * 0.75, math.pi * 1.25, math.pi * 1.75, math.pi * 0.25)):
        px, pz = x + 0.36 * math.cos(ang), z + 0.36 * math.sin(ang)
        cyl(ST, px, pz, H, H + 0.012, 0.11, 0.11, '#f6f2e8', segs=16)
        obox(ST, px, H + 0.03, pz, 0.12, 0.05, 0.12, S('#8a2430'), -ang + math.pi / 4, 0, 0.0)
    for ang in (math.pi * 0.75, math.pi * 1.25, math.pi * 1.75) if fr.cz > 0 else (math.pi * 0.25, math.pi * 0.75, math.pi * 1.75):
        cx_, cz_ = x + 0.8 * math.cos(ang), z + 0.8 * math.sin(ang)
        chair_at(cx_, cz_, ang + math.pi, 'oval')

def chair_at(x, z, yaw_face, back='oval', seat=S('#8a2430')):
    """A chair centred on (x, z) whose front looks along angle `yaw_face` (radians in the x-z plane)."""
    f = math.cos(yaw_face), math.sin(yaw_face)
    rv = (-f[1], f[0])
    W, D = 0.46, 0.46
    def P(u, w):
        return x + f[0] * (w - D / 2) + rv[0] * u, z + f[1] * (w - D / 2) + rv[1] * u
    yaw = -math.atan2(f[1], f[0]) + math.pi / 2
    for u in (-W / 2 + 0.05, W / 2 - 0.05):
        for w in (0.05, D - 0.05):
            px, pz = P(u, w)
            box(ST, px - 0.022, px + 0.022, 0.0, 0.44, pz - 0.022, pz + 0.022, WOOD_D, 0.005)
    cx_, cz_ = P(0, D / 2)
    obox(ST, cx_, 0.445, cz_, W, 0.05, D, WOOD, yaw, 0, 0.01)
    obox(ST, cx_, 0.5, cz_, W - 0.04, 0.07, D - 0.04, seat, yaw, 0, 0.025)
    bx, bz = P(0, 0.04)
    a = Vector(G(rv[0], 0, rv[1])); n = Vector(G(f[0], 0, f[1]))
    for u in (-W / 2 + 0.06, W / 2 - 0.06):
        px, pz = P(u, 0.04)
        box(ST, px - 0.02, px + 0.02, 0.44, 0.7, pz - 0.02, pz + 0.02, WOOD_D, 0.004)
    disc(ST, G(bx, 0.84, bz), a, Vector((0, 0, 1)), n, 0.2, 0.25, -0.025, 0.025, WOOD, 18)
    disc(ST, G(bx, 0.84, bz), a, Vector((0, 0, 1)), n, 0.15, 0.2, -0.035, 0.04, seat, 18)

def cabinet(fr, body=WOOD, top=WOOD_T, pulls=C['brass'], rows=2, cols=None, H=None, feet=WOOD_D, doors_below=False, knobs=False):
    """A chest / sideboard / console body across the footprint: drawers (and cupboard doors) with brass pulls."""
    W, D = fr.W, fr.D
    H = H or fr.H - 0.05
    for u in (-W / 2 + 0.06, W / 2 - 0.06):
        for w in (0.06, D - 0.06):
            fr.box(u - 0.04, u + 0.04, w - 0.04, w + 0.04, 0.0, 0.12, feet, 0.008)
    fr.box(-W / 2 + 0.01, W / 2 - 0.01, 0.0, D - 0.02, 0.1, H, body, 0.02)
    fr.box(-W / 2 - 0.02, W / 2 + 0.02, -0.0, D + 0.015, H, H + 0.05, top, 0.015)
    cols = cols or max(1, round(W / 0.55))
    cw = (W - 0.06) / cols
    if doors_below:
        dh = (H - 0.16) * 0.62
        for c_ in range(cols):
            u0 = -W / 2 + 0.03 + c_ * cw
            fr.box(u0 + 0.015, u0 + cw - 0.015, D - 0.03, D + 0.0, 0.15, 0.15 + dh, top, 0.01)
            fr.box(u0 + 0.05, u0 + cw - 0.05, D - 0.005, D + 0.008, 0.2, 0.1 + dh, body, 0.01)
            um = u0 + cw / 2
            fr.box(um - 0.012, um + 0.012, D, D + 0.025, 0.1 + dh * 0.7, 0.1 + dh * 0.9, pulls, 0.004)
        y0 = 0.17 + dh
        fr.box(-W / 2 + 0.03, W / 2 - 0.03, D - 0.03, D, y0, H - 0.02, top, 0.008)
        for c_ in range(cols):
            um = -W / 2 + 0.03 + c_ * cw + cw / 2
            fr.box(um - 0.05, um + 0.05, D, D + 0.02, (y0 + H) / 2 - 0.012, (y0 + H) / 2 + 0.012, pulls, 0.004)
        return H + 0.05
    rh = (H - 0.16) / rows
    for r_ in range(rows):
        y0 = 0.15 + r_ * rh
        for c_ in range(cols):
            u0 = -W / 2 + 0.03 + c_ * cw
            fr.box(u0 + 0.012, u0 + cw - 0.012, D - 0.03, D + 0.0, y0 + 0.012, y0 + rh - 0.012, top, 0.008)
            um = u0 + cw / 2
            if knobs:
                fr.sphere(um, D + 0.012, y0 + rh / 2, 0.02, pulls, 8)
            else:
                fr.box(um - 0.06, um + 0.06, D, D + 0.022, y0 + rh / 2 - 0.013, y0 + rh / 2 + 0.013, pulls, 0.006)
    return H + 0.05

def hall_console(fr, items=('lamp', 'plant')):
    """The references' hall console: a slim top, two drawers with brass knobs, square legs, a low shelf."""
    W, D, H = fr.W, fr.D, 0.82
    for u in (-W / 2 + 0.05, W / 2 - 0.05):
        for w in (0.05, D - 0.05):
            fr.box(u - 0.035, u + 0.035, w - 0.035, w + 0.035, 0.0, H - 0.04, WOOD_D, 0.008)
    fr.box(-W / 2 + 0.03, W / 2 - 0.03, 0.03, D - 0.03, 0.14, 0.17, WOOD, 0.008)             # shelf
    fr.box(-W / 2 + 0.02, W / 2 - 0.02, 0.02, D - 0.02, H - 0.2, H - 0.04, WOOD, 0.01)        # apron
    for u in (-W / 4, W / 4):
        fr.box(u - W / 4 + 0.04, u + W / 4 - 0.04, D - 0.025, D - 0.005, H - 0.18, H - 0.06, WOOD_T, 0.006)
        fr.sphere(u, D, H - 0.12, 0.018, C['brass'], 8)
    fr.box(-W / 2 - 0.03, W / 2 + 0.03, -0.0, D + 0.03, H - 0.04, H, WOOD_T, 0.012)
    u_lamp = -W / 4 + 0.05 if 'lamp' in items else None
    for it in items:
        if it == 'lamp':
            x, z = fr.at(-W / 4 + 0.05, D / 2)
            lamp_on(x, z, H, 0.5, 0.14, 55.0)
        elif it == 'lampR':
            x, z = fr.at(W / 4, D / 2)
            lamp_on(x, z, H, 0.5, 0.14, 55.0)
        elif it == 'plant':
            x, z = fr.at(W / 2 - 0.2, D / 2)
            pot_plant(x, z, H, 0.5)
        elif it == 'flowers':
            x, z = fr.at(W / 4 + 0.05, D / 2)
            vase(x, z, H, '#d8b060', '#f4eee0', 0.1)
        elif it == 'bowl':
            x, z = fr.at(0.02, D / 2)
            cyl(ST, x, z, H, H + 0.05, 0.08, 0.13, C['brass'], segs=18)
        elif it == 'books':
            x, z = fr.at(0.05, D / 2)
            books_pile(x, z, H, 2, 0.2)

def writing_desk(fr):
    """A bureau with a raised back, pigeonholes, a lamp and books, and a chair drawn up to it."""
    W, D = fr.W, fr.D
    dd = min(0.65, D - 0.5)
    sub = Fr({'center': list(fr.at(0.0, dd / 2)), 'size': [W, 0.78, dd] if fr.facing in 'ns' else [dd, 0.78, W]}, fr.facing)
    cabinet(sub, rows=2, cols=2, H=0.74, knobs=True)
    fr.box(-W / 2, W / 2, 0.0, 0.22, 0.79, 1.05, WOOD, 0.012)
    fr.box(-W / 2 - 0.01, W / 2 + 0.01, 0.0, 0.24, 1.05, 1.08, WOOD_T, 0.01)
    for k in range(3):
        u = -W / 2 + 0.12 + k * (W - 0.24) / 2
        fr.box(u - 0.08, u + 0.08, 0.2, 0.225, 0.85, 1.0, '#2a1810', 0.004)
    x, z = fr.at(-W / 2 + 0.2, 0.36)
    lamp_on(x, z, 0.79, 0.48, 0.13, 50.0)
    x, z = fr.at(W / 2 - 0.25, 0.4)
    books_pile(x, z, 0.79, 2, 0.3)
    x, z = fr.at(W / 2 - 0.1, 0.3)
    cyl(ST, x, z, 0.79, 0.9, 0.03, 0.03, '#3a4a3a', segs=8)
    cx_, cz_ = fr.at(0.05, dd + 0.28)
    chair_at(cx_, cz_, math.atan2(-fr.F[1], -fr.F[0]), 'square')

def sideboard(fr):
    """The dining sideboard: drawers over cupboards, a tureen, a stack of plates, a lamp, a posy."""
    top = cabinet(fr, rows=2, doors_below=True)
    x, z = fr.at(-fr.W * 0.18, fr.D / 2)
    cyl(ST, x, z, top, top + 0.1, 0.12, 0.16, '#f2ece0', segs=18)
    cyl(ST, x, z, top + 0.1, top + 0.14, 0.15, 0.1, '#f2ece0', segs=18)
    sphere(ST, x, top + 0.16, z, 0.03, C['brass'], 6)
    x, z = fr.at(fr.W * 0.14, fr.D / 2)
    for k in range(5):
        cyl(ST, x, z, top + k * 0.018, top + k * 0.018 + 0.014, 0.12, 0.12, '#f4f0e6', segs=16)
    x, z = fr.at(fr.W * 0.36, fr.D / 2)
    lamp_on(x, z, top, 0.55, 0.15, 60.0)

def bookcase(fr, body=WOOD, cabinets=True, lamp=True, props=True):
    """Built-in bookcase: cupboards below, shelves of chunky books above, a brass picture light on top."""
    W, D, H = fr.W, fr.D, fr.H
    fr.box(-W / 2, -W / 2 + 0.05, 0.0, D, 0.0, H, body, 0.01)
    fr.box(W / 2 - 0.05, W / 2, 0.0, D, 0.0, H, body, 0.01)
    fr.box(-W / 2, W / 2, 0.0, 0.03, 0.0, H, WOOD_D, 0.005)
    fr.box(-W / 2 - 0.03, W / 2 + 0.03, 0.0, D + 0.04, H - 0.08, H, WOOD_T, 0.012)
    base = 0.0
    if cabinets:
        ch = 0.72
        fr.box(-W / 2, W / 2, 0.0, D + 0.02, 0.0, ch, body, 0.012)
        fr.box(-W / 2 - 0.02, W / 2 + 0.02, 0.0, D + 0.05, ch, ch + 0.05, WOOD_T, 0.01)
        n = max(2, round(W / 0.45))
        cw = (W - 0.08) / n
        for i in range(n):
            u0 = -W / 2 + 0.04 + i * cw
            fr.box(u0 + 0.015, u0 + cw - 0.015, D + 0.02, D + 0.035, 0.08, ch - 0.06, WOOD_T, 0.008)
            fr.box(u0 + 0.05, u0 + cw - 0.05, D + 0.03, D + 0.042, 0.13, ch - 0.11, body, 0.008)
            um = u0 + (cw - 0.07 if i % 2 == 0 else 0.07)
            fr.box(um - 0.012, um + 0.012, D + 0.035, D + 0.06, ch * 0.45, ch * 0.7, C['brass'], 0.004)
        base = ch + 0.05
    else:
        fr.box(-W / 2, W / 2, 0.0, D, 0.0, 0.1, WOOD_D, 0.01)
        base = 0.1
    y, shelves = base, []
    while y + 0.36 < H - 0.08:
        shelves.append(y)
        y += 0.4
    rr = random.Random(int(abs(fr.cx) * 100 + abs(fr.cz) * 7))
    for k, y0 in enumerate(shelves):
        fr.box(-W / 2 + 0.05, W / 2 - 0.05, 0.03, D, y0, y0 + 0.03, WOOD_T, 0.004)
        if props and k == len(shelves) // 2 and W > 1.0:
            a = rr.uniform(-W / 2 + 0.3, 0.0)
            fr.front_tex(-W / 2 + 0.07, a - 0.02, 0.06, D - 0.06, y0 + 0.03, y0 + 0.34, K.CELL['books'], 0.5)
            fr.front_tex(a + 0.5, W / 2 - 0.07, 0.06, D - 0.06, y0 + 0.03, y0 + 0.34, K.CELL['books'], 0.5)
            x, z = fr.at(a + 0.12, D / 2)
            cyl(ST, x, z, y0 + 0.03, y0 + 0.06, 0.05, 0.05, C['brass'], segs=10)
            sphere(ST, x, y0 + 0.16, z, 0.09, '#3a6a7a', segs=12)                   # a globe
            x, z = fr.at(a + 0.36, D / 2)
            box(ST, x - 0.1, x + 0.1, y0 + 0.03, y0 + 0.14, z - 0.07, z + 0.07, WOOD_T, 0.01)   # a box
        elif props and k == len(shelves) - 1 and W > 0.9:
            a = rr.uniform(-0.1, W / 2 - 0.45)
            fr.front_tex(-W / 2 + 0.07, a, 0.06, D - 0.06, y0 + 0.03, y0 + 0.34, K.CELL['books'], 0.5)
            x, z = fr.at(a + 0.18, D / 2)
            pot_plant(x, z, y0 + 0.03, 0.45)
            if a + 0.4 < W / 2 - 0.1:
                fr.front_tex(a + 0.38, W / 2 - 0.07, 0.06, D - 0.06, y0 + 0.03, y0 + 0.34, K.CELL['books'], 0.5)
        else:
            fr.front_tex(-W / 2 + 0.07, W / 2 - 0.07, 0.06, D - 0.06, y0 + 0.03, y0 + 0.34, K.CELL['books'], 0.5)
    if lamp:
        fr.box(-0.22, 0.22, D + 0.02, D + 0.1, H - 0.14, H - 0.1, C['brass'], 0.01)
        fr.box(-0.02, 0.02, D, D + 0.06, H - 0.12, H - 0.08, C['brass'], 0.004)

def angled_bookcase(f, corner):
    """A bookcase set across a back corner (the library's chamfered corners), inside the footprint."""
    cx, cz = f['center']; sx, sy, sz = f['size']
    ex = -1 if 'w' in corner else 1
    ez = -1 if 'n' in corner else 1
    cxw, czw = cx + ex * sx / 2, cz + ez * sz / 2                 # the wall corner itself
    W, D, H = 1.45, 0.42, sy
    back = 1.1                                                    # the back line sits this far out along each wall
    bx, bz = cxw - ex * back / 2, czw - ez * back / 2
    ux, uz = ex / math.sqrt(2), -ez / math.sqrt(2)                # across the case
    fx, fz = -ex / math.sqrt(2), -ez / math.sqrt(2)               # its front
    ffr = Fr({'center': [0, 0], 'size': [W, H, D]}, 's')
    ffr.back = (bx, bz); ffr.F = (fx, fz); ffr.Rv = (ux, uz); ffr.cx, ffr.cz = bx + fx * D / 2, bz + fz * D / 2
    yaw = math.atan2(fz, fx)
    # every box of the case is turned 45 degrees: use oriented boxes through a small adaptor
    def ob(u0, u1, w0, w1, y0, y1, col, bev=0.008):
        x, z = ffr.at((u0 + u1) / 2, (w0 + w1) / 2)
        obox(ST, x, (y0 + y1) / 2, z, u1 - u0, y1 - y0, w1 - w0, col, -yaw + math.pi / 2, 0, bev)
    ob(-W / 2, -W / 2 + 0.05, 0, D, 0, H, WOOD); ob(W / 2 - 0.05, W / 2, 0, D, 0, H, WOOD)
    ob(-W / 2, W / 2, 0, 0.03, 0, H, WOOD_D)
    ob(-W / 2 - 0.03, W / 2 + 0.03, 0, D + 0.04, H - 0.08, H, WOOD_T, 0.01)
    ob(-W / 2, W / 2, 0, D + 0.02, 0, 0.7, WOOD, 0.01)
    ob(-W / 2 - 0.02, W / 2 + 0.02, 0, D + 0.05, 0.7, 0.75, WOOD_T, 0.01)
    for i in range(3):
        u0 = -W / 2 + 0.04 + i * (W - 0.08) / 3
        ob(u0 + 0.015, u0 + (W - 0.08) / 3 - 0.015, D + 0.02, D + 0.035, 0.08, 0.64, WOOD_T)
        ob(u0 + (W - 0.08) / 6 - 0.012, u0 + (W - 0.08) / 6 + 0.012, D + 0.035, D + 0.06, 0.32, 0.46, C['brass'], 0.003)
    rr = random.Random(int(abs(cx) * 10))
    y = 0.75
    k = 0
    while y + 0.36 < H - 0.08:
        ob(-W / 2 + 0.05, W / 2 - 0.05, 0.03, D, y, y + 0.03, WOOD_T, 0.004)
        # book blocks in two or three colours per shelf (turned boxes can't take the atlas cleanly)
        u = -W / 2 + 0.08
        while u < W / 2 - 0.12:
            w_ = rr.uniform(0.05, 0.08)
            if k == 1 and abs(u) < 0.2:
                x, z = ffr.at(0.0, D / 2)
                if ROOM == 'library':
                    # a small gilt horse / a framed photo
                    box(ST, x - 0.1, x + 0.1, y + 0.03, y + 0.06, z - 0.05, z + 0.05, C['brass'], 0.005)
                    obox(ST, x, y + 0.16, z, 0.2, 0.2, 0.03, C['gold'], -yaw + math.pi / 2, -0.15, 0.005)
                u = 0.22
                continue
            h_ = rr.uniform(0.24, 0.32)
            ob(u, u + w_ - 0.006, 0.07, D - 0.05, y + 0.03, y + 0.03 + h_,
               rr.choice(['#8a2a2c', '#2f5a5a', '#3a5a3a', '#b08a58', S('#7a2226'), '#2a4a5a']), 0.004)
            u += w_
        y += 0.4
        k += 1
    x, z = ffr.at(0.0, D + 0.06)
    obox(ST, x, H - 0.12, z, 0.4, 0.04, 0.08, C['brass'], -yaw + math.pi / 2, 0, 0.01)

# ---- the ballroom -----------------------------------------------------------------------------------
def bandstand(f):
    """A round stage in the corner (two steps, brass edging) with an upright piano, its bench, a music
    stand and a potted palm; the curtains are on the walls (dec_ballroom)."""
    cx, cz = f['center']; sx, sy, sz = f['size']
    ox, oz = cx - sx / 2, cz - sz / 2                               # the NW wall corner
    Rr = min(sx, sz) - 0.04
    for (r, y0, y1, col) in ((Rr, 0.0, 0.16, WOOD), (Rr - 0.28, 0.16, 0.32, WOOD)):
        n = 22
        bm_pts = [(ox, oz)] + [(ox + r * math.cos(a), oz + r * math.sin(a)) for a in [k * (math.pi / 2) / n for k in range(n + 1)]]
        _prism(bm_pts, y0, y1, col)
        # brass edging on the riser
        for k in range(n):
            a0, a1 = k * (math.pi / 2) / n, (k + 1) * (math.pi / 2) / n
            p0 = (ox + (r + 0.005) * math.cos(a0), oz + (r + 0.005) * math.sin(a0))
            p1 = (ox + (r + 0.005) * math.cos(a1), oz + (r + 0.005) * math.sin(a1))
            rod(ST, (p0[0], y1 - 0.015, p0[1]), (p1[0], y1 - 0.015, p1[1]), 0.012, C['brass'], 4)
    top = 0.32
    # the piano, against the north wall, a little east of the corner
    px0, px1 = ox + 0.35, ox + 1.55
    pz0 = oz + 0.02
    box(ST, px0, px1, top, top + 1.2, pz0, pz0 + 0.5, '#4a2818', 0.02)
    box(ST, px0 - 0.02, px1 + 0.02, top + 1.2, top + 1.25, pz0, pz0 + 0.54, '#5a3420', 0.015)
    box(ST, px0, px1, top + 0.66, top + 0.74, pz0 + 0.5, pz0 + 0.74, '#4a2818', 0.015)
    box(ST, px0 + 0.04, px1 - 0.04, top + 0.74, top + 0.76, pz0 + 0.5, pz0 + 0.68, '#f4f0e6', 0.003)
    for k in range(18):
        u = px0 + 0.07 + k * 0.058
        if k % 7 not in (2, 6):
            box(ST, u + 0.012, u + 0.036, top + 0.76, top + 0.785, pz0 + 0.5, pz0 + 0.6, C['black'], 0.0)
    for u in (px0 + 0.04, px1 - 0.04):
        box(ST, u - 0.03, u + 0.03, top, top + 0.66, pz0 + 0.62, pz0 + 0.7, '#3a1e10', 0.008)
    box(ST, px0 + 0.1, px1 - 0.1, top + 0.8, top + 1.05, pz0 + 0.5, pz0 + 0.52, '#3a1e10', 0.006)
    # bench
    box(ST, px0 + 0.3, px1 - 0.3, top + 0.4, top + 0.5, pz0 + 0.95, pz0 + 1.3, S('#8a2430'), 0.03)
    for u in (px0 + 0.34, px1 - 0.34):
        for w in (pz0 + 0.99, pz0 + 1.26):
            box(ST, u - 0.025, u + 0.025, top, top + 0.4, w - 0.025, w + 0.025, WOOD_D, 0.004)
    # music stand and palm at the stage's east end
    mx, mz = ox + 1.95, oz + 0.75
    cyl(ST, mx, mz, top, top + 0.02, 0.12, 0.12, C['brass'], segs=12)
    rod(ST, (mx, top, mz), (mx, top + 1.0, mz), 0.012, C['brass'])
    obox(ST, mx, top + 1.1, mz, 0.34, 0.24, 0.02, '#2a2a28', 0.0, -0.35, 0.005)
    plant_at(ox + 2.0, oz + 0.3, 0.95, seed=21)

def _prism(pts, y0, y1, color, t=None):
    """A vertical prism over a convex polygon `pts` [(x, z)] from y0 to y1."""
    t = t or ST
    bm = bmesh.new()
    bot = [bm.verts.new(G(x, y0, z)) for (x, z) in pts]
    topv = [bm.verts.new(G(x, y1, z)) for (x, z) in pts]
    bm.faces.new(topv)
    n = len(pts)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((bot[i], bot[j], topv[j], topv[i]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    t.add_bm(bm, color)

def drape(side, s0, s1, y0=0.4, y1=2.3, col=S('#7a2230'), deep=S('#5c1822'), swag=True, tie=None):
    """A fall of heavy curtain against a wall between s0 and s1 (in folds), with a swag on top."""
    sg = seg_at(side, (s0 + s1) / 2)
    n = max(2, int((s1 - s0) / 0.16))
    w = (s1 - s0) / n
    for i in range(n):
        a = s0 + i * w
        d = 0.05 if i % 2 else 0.1
        sg.put(a, a + w + 0.01, y0, y1, 0.02, 0.02 + d, col if i % 2 else deep, 0.03, where=sg.up if y0 >= SPLIT else None)
    if swag:
        sg.put(s0 - 0.05, s1 + 0.05, y1 - 0.25, y1, 0.0, 0.16, deep, 0.05, where=sg.up)
        sg.put(s0 - 0.05, s1 + 0.05, y1 - 0.27, y1 - 0.24, 0.0, 0.17, C['gold'], 0.008, where=sg.up)
    if tie:
        sg.put(s0, s1, tie - 0.03, tie + 0.03, 0.12, 0.16, C['gold'], 0.01, where=sg.up)

# ---- kitchen -------------------------------------------------------------------------------------------
STEEL, STEEL_D, KGREEN, KGREEN_D = '#b4b8bc', '#7a7e84', S('#6a7a5a'), S('#55644a')
def green_cabinet(fr, sink=False, drawers=True):
    W, D, H = fr.W, fr.D, fr.H
    fr.box(-W / 2 + 0.02, W / 2 - 0.02, 0.0, D - 0.06, 0.0, 0.1, '#2e3428', 0.004)
    fr.box(-W / 2, W / 2, 0.0, D - 0.03, 0.1, H - 0.05, KGREEN, 0.012)
    n = max(1, round(W / 0.45))
    cw = (W - 0.04) / n
    for i in range(n):
        u0 = -W / 2 + 0.02 + i * cw
        if drawers:
            fr.box(u0 + 0.015, u0 + cw - 0.015, D - 0.04, D - 0.015, H - 0.24, H - 0.08, KGREEN_D, 0.008)
            fr.box(u0 + cw / 2 - 0.06, u0 + cw / 2 + 0.06, D - 0.015, D + 0.005, H - 0.17, H - 0.15, C['brass'], 0.004)
        fr.box(u0 + 0.015, u0 + cw - 0.015, D - 0.04, D - 0.015, 0.16, H - 0.28, KGREEN_D, 0.008)
        fr.box(u0 + 0.05, u0 + cw - 0.05, D - 0.018, D - 0.008, 0.21, H - 0.33, KGREEN, 0.006)
        um = u0 + (cw - 0.07 if i % 2 == 0 else 0.07)
        fr.box(um - 0.01, um + 0.01, D - 0.015, D + 0.01, H - 0.45, H - 0.33, C['brass'], 0.003)
    fr.box(-W / 2 - 0.01, W / 2 + 0.01, 0.0, D + 0.02, H - 0.05, H, STEEL, 0.008)
    if sink:
        x, z = fr.at(0.0, D * 0.5)
        box(ST, x - 0.3, x + 0.3, H - 0.01, H + 0.005, z - 0.2, z + 0.2, STEEL_D, 0.01)
        box(ST, x - 0.26, x + 0.26, H - 0.005, H + 0.007, z - 0.16, z + 0.16, '#5e6268', 0.006)
        fx, fz = fr.at(0.0, 0.08)
        cyl(ST, fx, fz, H, H + 0.3, 0.018, color=STEEL, segs=8)
        rod(ST, (fx, H + 0.3, fz), (fx + fr.F[0] * 0.18, H + 0.26, fz + fr.F[1] * 0.18), 0.016, STEEL, 6)
        # a red-striped tea towel over the front
        tx, tz = fr.at(0.35, D + 0.005)
        fr.box(0.28, 0.44, D - 0.005, D + 0.012, H - 0.36, H + 0.005, '#f4f0e6', 0.005)
        fr.box(0.28, 0.44, D + 0.012, D + 0.014, H - 0.2, H - 0.17, '#b83a2a', 0.0)

def kitchen_range(fr):
    W, D, H = fr.W, fr.D, fr.H
    fr.box(-W / 2, W / 2, 0.0, D - 0.04, 0.0, H - 0.04, '#3a3a3e', 0.014)
    fr.box(-W / 2 - 0.01, W / 2 + 0.01, 0.0, D, H - 0.05, H, '#2a2a2c', 0.01)
    for u0, u1 in ((-W / 2 + 0.05, -0.02), (0.02, W / 2 - 0.05)):
        fr.box(u0, u1, D - 0.05, D - 0.02, 0.12, H - 0.3, '#4a4a50', 0.012)
        fr.box(u0 + 0.06, u1 - 0.06, D - 0.03, D - 0.01, 0.2, H - 0.42, '#26262a', 0.006)
        fr.box(u0 + 0.05, u1 - 0.05, D - 0.02, D + 0.02, H - 0.36, H - 0.33, C['brass'], 0.006)
    for k in range(6):
        u = -W / 2 + 0.12 + k * (W - 0.24) / 5
        fr.cyl(u, D - 0.01, H - 0.2, H - 0.16, 0.025, 0.025, C['brass'], segs=8)
    for i in range(3):
        for j in range(2):
            u = -W / 2 + W * (i + 0.5) / 3
            fr.cyl(u, D * (0.28 + 0.4 * j), H, H + 0.02, 0.1, 0.1, '#1a1a1c', segs=12)
    x, z = fr.at(-W / 4, D * 0.66)
    cyl(ST, x, z, H + 0.02, H + 0.2, 0.13, 0.13, '#b86a3a', segs=16)                     # copper pot
    cyl(ST, x, z, H + 0.2, H + 0.22, 0.14, 0.14, '#9a5430', segs=16)
    x, z = fr.at(W / 4, D * 0.3)
    cyl(ST, x, z, H + 0.02, H + 0.14, 0.12, 0.12, STEEL, segs=16)
    cyl(ST, x, z, H + 0.14, H + 0.16, 0.1, 0.1, STEEL_D, segs=16)

def range_hood(side, s, W=1.2):
    """A steel hood over the range, a brass rail and copper pans hanging below it."""
    sg = seg_at(side, s)
    sg.put(s - W / 2, s + W / 2, 1.72, 1.8, 0.0, 0.62, STEEL, 0.01, where=sg.up)
    x0, x1, z0, z1 = sg.rect(s - W / 2, s + W / 2, 0.0, 0.62)
    # a sloped hood: a turned slab
    xm, zm = sg.rect(s, s, 0.34, 0.34)[0], sg.rect(s, s, 0.34, 0.34)[2]
    yaw = {'north': 0.0, 'south': math.pi, 'east': math.pi / 2, 'west': -math.pi / 2}[side]
    obox(sg.up, xm, 1.98, zm, W - 0.02, 0.06, 0.62, STEEL, yaw, 0.62 if side in ('north', 'west') else -0.62, 0.01)
    sg.put(s - W / 2 + 0.2, s + W / 2 - 0.2, 1.8, 2.3, 0.0, 0.2, STEEL, 0.01, where=sg.up)
    sg.put(s - W / 2 + 0.05, s + W / 2 - 0.05, 1.5, 1.52, 0.18, 0.2, C['brass'], 0.004, where=sg.up)
    for k, (r, c) in enumerate(((0.1, '#b86a3a'), (0.12, '#c07440'), (0.09, '#b86a3a'))):
        a = s - 0.35 + k * 0.33
        xa, _, za, _ = sg.rect(a, a, 0.24, 0.24)
        rod(sg.up, (xa, 1.5, za), (xa, 1.34, za), 0.006, C['brassDark'], 4)
        pts = sg.rect(a, a, 0.24, 0.24)
        a_, u_, n_ = sg.axes()
        disc(sg.up, sg.point(a, 1.22, 0.2), a_, u_, n_, r, r, 0.0, 0.05, c, 16)

def fridge(fr):
    W, D, H = fr.W, fr.D, fr.H
    fr.box(-W / 2, W / 2, 0.0, D - 0.02, 0.0, H, '#a8acb0', 0.02)
    fr.box(-W / 2 + 0.02, -0.005, D - 0.03, D, 0.06, H - 0.04, '#b8bcc0', 0.012)
    fr.box(0.005, W / 2 - 0.02, D - 0.03, D, 0.06, H - 0.04, '#b8bcc0', 0.012)
    for u in (-0.05, 0.05):
        fr.box(u - 0.012, u + 0.012, D, D + 0.05, H * 0.35, H * 0.75, C['brass'], 0.006)
    fr.box(-W / 2 - 0.01, W / 2 + 0.01, 0.0, D + 0.01, H - 0.06, H, '#8a8e94', 0.01)

def wire_rack(fr, trays=True, items='trays'):
    W, D, H = fr.W, fr.D, fr.H
    for u in (-W / 2 + 0.03, W / 2 - 0.03):
        for w in (0.03, D - 0.03):
            fr.box(u - 0.018, u + 0.018, w - 0.018, w + 0.018, 0.05, H, STEEL_D, 0.004)
            fr.cyl(u, w, 0.0, 0.05, 0.025, 0.025, '#2a2a2c', segs=8)
    levels = [0.15 + k * (H - 0.2) / 3 for k in range(4)]
    for k, y in enumerate(levels):
        fr.box(-W / 2 + 0.01, W / 2 - 0.01, 0.01, D - 0.01, y, y + 0.025, STEEL, 0.004)
        if items == 'trays' and k < 3:
            fr.box(-W / 2 + 0.06, W / 2 - 0.06, 0.06, D - 0.06, y + 0.025, y + 0.08, '#c8ccd0', 0.008)
        elif items == 'plates' and k < 3:
            rr = random.Random(k + 7)
            u = -W / 2 + 0.1
            while u < W / 2 - 0.15:
                if rr.random() < 0.6:
                    n = rr.randint(4, 7)
                    for j in range(n):
                        fr.cyl(u + 0.1, D / 2, y + 0.025 + j * 0.02, y + 0.04 + j * 0.02, 0.11, 0.11, '#f2eee4', segs=14)
                    u += 0.25
                else:
                    fr.cyl(u + 0.1, D / 2, y + 0.025, y + 0.16, 0.1, 0.1, rr.choice(['#b86a3a', STEEL, '#9a4a30']), segs=14)
                    u += 0.24

def island(fr):
    W, D, H = fr.W, fr.D, fr.H
    for u in (-W / 2 + 0.05, W / 2 - 0.05):
        for w in (0.05, D - 0.05):
            fr.box(u - 0.05, u + 0.05, w - 0.05, w + 0.05, 0.0, H - 0.05, KGREEN, 0.01)
    fr.box(-W / 2 + 0.04, W / 2 - 0.04, 0.04, D - 0.04, 0.12, 0.15, KGREEN_D, 0.006)            # low shelf
    fr.box(-W / 2 + 0.03, W / 2 - 0.03, 0.03, D - 0.03, H - 0.3, H - 0.05, KGREEN, 0.01)
    for side_w in (D - 0.01, 0.01):
        for u in (-W / 4, W / 4):
            a, b = (D - 0.035, D - 0.005) if side_w > D / 2 else (0.005, 0.035)
            fr.box(u - W / 4 + 0.05, u + W / 4 - 0.05, a, b, H - 0.27, H - 0.08, KGREEN_D, 0.006)
            fr.box(u - 0.06, u + 0.06, b if side_w > D / 2 else a - 0.02, (b + 0.02) if side_w > D / 2 else a, H - 0.19, H - 0.16, C['brass'], 0.004)
    fr.box(-W / 2 - 0.03, W / 2 + 0.03, -0.03, D + 0.03, H - 0.05, H, STEEL, 0.01)
    x, z = fr.at(-W / 4, D * 0.5)
    box(ST, x - 0.25, x + 0.25, H, H + 0.035, z - 0.16, z + 0.16, '#a8743e', 0.01)                 # board
    x, z = fr.at(W / 5, D * 0.5)
    for j in range(4):
        cyl(ST, x, z, H + j * 0.02, H + 0.015 + j * 0.02, 0.12, 0.12, '#f2eee4', segs=14)
    x, z = fr.at(W / 2 - 0.2, D * 0.5)
    pot_plant(x, z, H, 0.55)
    x, z = fr.at(-W / 4, D * 0.5)
    cyl(ST, x, z, 0.15, 0.33, 0.16, 0.16, '#b86a3a', segs=16)                                   # pot on the shelf
    for u in (W / 8, W / 3):
        x, z = fr.at(u, D * 0.5)
        box(ST, x - 0.17, x + 0.17, 0.15, 0.25, z - 0.2, z + 0.2, '#c8ccd0', 0.01)

def prep_table(fr):
    W, D, H = fr.W, fr.D, fr.H
    for u in (-W / 2 + 0.04, W / 2 - 0.04):
        for w in (0.04, D - 0.04):
            fr.box(u - 0.025, u + 0.025, w - 0.025, w + 0.025, 0.0, H - 0.04, STEEL_D, 0.004)
    for y in (0.2, 0.52):
        fr.box(-W / 2 + 0.02, W / 2 - 0.02, 0.02, D - 0.02, y, y + 0.025, STEEL, 0.004)
        fr.box(-W / 2 + 0.1, W / 2 - 0.1, 0.1, D - 0.1, y + 0.025, y + 0.09, '#c8ccd0', 0.008)
    fr.box(-W / 2, W / 2, 0.0, D, H - 0.05, H, STEEL, 0.01)
    x, z = fr.at(W * 0.22, D * 0.5)
    cyl(ST, x, z, H, H + 0.08, 0.1, 0.16, '#6a8a3a', segs=16)
    for k in range(5):
        sphere(ST, x + 0.07 * math.cos(k * 1.3), H + 0.09, z + 0.07 * math.sin(k * 1.3), 0.05, '#7aa040', 8)
    x, z = fr.at(-W * 0.1, D * 0.5)
    obox(ST, x, H + 0.02, z, 0.36, 0.035, 0.24, '#a8743e', 0.4, 0, 0.01)

# ---- service, storage and back-of-house --------------------------------------------------------------
def shelving(fr, variant='boxes', frame='#2a2a2e', board='#5a4030', bays=1):
    W, D, H = fr.W, fr.D, fr.H
    xs = [-W / 2 + 0.03 + k * (W - 0.06) / bays for k in range(bays + 1)]
    for u in xs:
        for w in (0.03, D - 0.03):
            fr.box(u - 0.025, u + 0.025, w - 0.025, w + 0.025, 0.0, H, frame, 0.004)
    levels = [0.1 + k * (H - 0.16) / 3 for k in range(4)]
    for y in levels:
        fr.box(-W / 2, W / 2, 0.0, D, y, y + 0.035, board, 0.005)
    rr = random.Random(int(abs(fr.cx) * 100 + abs(fr.cz) * 7))
    for li, y in enumerate(levels[:-1] if variant != 'towels' else levels):
        for b in range(bays):
            u, end = xs[b] + 0.05, xs[b + 1] - 0.05
            while u < end - 0.14:
                pick = rr.random()
                if variant in ('boxes', 'storage'):
                    if variant == 'storage' and pick < 0.2 and end - u > 0.5:
                        w_ = min(0.55, end - u)          # a suitcase lying flat
                        fr.box(u, u + w_, 0.05, D - 0.04, y + 0.035, y + 0.2, rr.choice([S('#7a2226'), '#4a5a4a']), 0.02)
                        fr.box(u + 0.02, u + w_ - 0.02, D - 0.045, D - 0.03, y + 0.1, y + 0.13, C['brass'], 0.003)
                        u += w_ + 0.04
                    elif variant == 'storage' and pick < 0.35 and end - u > 0.45:
                        w_ = min(0.45, end - u)          # something under a dust sheet
                        fr.box(u, u + w_, 0.04, D - 0.02, y + 0.035, y + 0.3, '#e0d4b8', 0.05)
                        u += w_ + 0.04
                    elif variant == 'storage' and pick < 0.55:
                        w_ = min(0.4, end - u)           # folded linen, burgundy and cream
                        for j in range(4):
                            fr.box(u, u + w_, 0.06, D - 0.04, y + 0.035 + j * 0.045, y + 0.035 + (j + 1) * 0.045 - 0.004,
                                   ('#e8dcc4', S('#7a2230'), '#e8dcc4', '#d8c8a8')[(j + li) % 4], 0.012)
                        u += w_ + 0.04
                    else:
                        w_ = min(rr.uniform(0.3, 0.45), end - u)
                        h_ = rr.uniform(0.18, 0.3)
                        col = rr.choice(['#b08a5a', '#a07e50', '#bf9a66', '#b08a5a', S('#4a5a48')])
                        fr.box(u, u + w_, 0.05, D - 0.04, y + 0.035, y + 0.035 + h_, col, 0.012)
                        fr.box(u + 0.03, u + w_ - 0.03, D - 0.045, D - 0.036, y + 0.035 + h_ * 0.5, y + 0.035 + h_ * 0.62, '#e8dcc0', 0.002)
                        u += w_ + 0.05
                elif variant == 'towels':
                    if li == 3:
                        if pick < 0.5:
                            fr.box(u, u + 0.3, 0.06, D - 0.06, y + 0.035, y + 0.25, '#7a5a3a', 0.015)
                            u += 0.36
                        else:
                            fr.cyl(u + 0.07, D / 2, y + 0.035, y + 0.24, 0.06, 0.05, rr.choice(['#3a6a9a', '#e8e4dc']), segs=10)
                            u += 0.17
                        continue
                    w_ = min(0.34, end - u)
                    for j in range(rr.randint(3, 5)):
                        fr.box(u, u + w_, 0.05, D - 0.03, y + 0.035 + j * 0.05, y + 0.035 + (j + 1) * 0.05 - 0.005, rr.choice(['#f0ece2', '#e8e2d4']), 0.015)
                    u += w_ + 0.05
                elif variant == 'linens':
                    w_ = min(rr.uniform(0.34, 0.42), end - u)
                    col = rr.choice(['#efe9dc', '#efe9dc', '#e4dccb', '#c9d8e0', '#e8dcc4'])
                    for k in range(rr.randint(6, 8)):
                        fr.box(u, u + w_, 0.03, D + 0.01, y + 0.035 + k * 0.045, y + 0.035 + (k + 1) * 0.045 - 0.003, col, 0.018)
                    u += w_ + 0.03

def crate(fr, lid=True, braces=True, s=None, H=None, u0=0.0, w0=None, y0=0.0, col='#8a5a34', dark='#6a4226'):
    """A slatted crate with X braces on its faces."""
    W, D = fr.W, fr.D
    H = H or fr.H
    s = s or min(W, D) - 0.04
    wc = D / 2 if w0 is None else w0
    a0, a1, b0, b1 = u0 - s / 2, u0 + s / 2, wc - s / 2, wc + s / 2
    fr.box(a0, a1, b0, b1, y0, y0 + H - 0.02, dark, 0.01)
    for (yy0, yy1) in ((y0, y0 + 0.08), (y0 + H - 0.1, y0 + H - 0.02)):
        fr.box(a0 - 0.012, a1 + 0.012, b0 - 0.012, b1 + 0.012, yy0, yy1, col, 0.006)
    for u in (a0, a1):
        for w in (b0, b1):
            fr.box(u - 0.035, u + 0.035, w - 0.035, w + 0.035, y0, y0 + H - 0.01, col, 0.006)
    if braces:
        L = math.hypot(s - 0.08, H - 0.2)
        ang = math.atan2(H - 0.2, s - 0.08)
        for (face_w, sgn) in ((b1 + 0.014, 1), (b0 - 0.014, -1)):
            for tilt in (ang, -ang):
                x, z = fr.at(u0, face_w)
                yaw = {'s': 0.0, 'n': 0.0, 'e': math.pi / 2, 'w': math.pi / 2}[fr.facing]
                bm = bmesh.new()
                bmesh.ops.create_cube(bm, size=1.0)
                bmesh.ops.scale(bm, vec=Vector((L, 0.02, 0.07)), verts=bm.verts)
                M = Matrix.Translation(G(x, y0 + H / 2, z)) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(tilt, 4, 'Y')
                bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
                ST.add_bm(bm, col)
        for (face_u, sgn) in ((a1 + 0.014, 1), (a0 - 0.014, -1)):
            for tilt in (ang, -ang):
                x, z = fr.at(face_u, wc)
                yaw = {'s': math.pi / 2, 'n': math.pi / 2, 'e': 0.0, 'w': 0.0}[fr.facing]
                bm = bmesh.new()
                bmesh.ops.create_cube(bm, size=1.0)
                bmesh.ops.scale(bm, vec=Vector((L, 0.02, 0.07)), verts=bm.verts)
                M = Matrix.Translation(G(x, y0 + H / 2, z)) @ Matrix.Rotation(yaw, 4, 'Z') @ Matrix.Rotation(tilt, 4, 'Y')
                bmesh.ops.transform(bm, matrix=M, verts=bm.verts)
                ST.add_bm(bm, col)
    if lid:
        fr.box(a0 - 0.02, a1 + 0.02, b0 - 0.02, b1 + 0.02, y0 + H - 0.03, y0 + H, '#9a6a3e', 0.01)
    return y0 + H

def crate_stack(fr, layout):
    """Crates stacked by `layout`: [(u, w, size, height, y0)], plus optional cloth ('cloth', ...)."""
    for item in layout:
        if item[0] == 'cloth':
            _, u, w, s, h, y0, col = item
            fr.box(u - s / 2 - 0.03, u + s / 2 + 0.03, w - s / 2 - 0.03, w + s / 2 + 0.03, y0, y0 + h, col, 0.05)
            fr.box(u - s / 2 - 0.05, u + s / 2 + 0.05, w - s / 2 - 0.05, w + s / 2 + 0.05, y0, y0 + 0.08, col, 0.03)
        else:
            u, w, s, h, y0 = item
            crate(fr, s=s, H=h, u0=u, w0=w, y0=y0)

def canvas_cart(fr):
    """The laundry cart: a canvas bin on a dark frame with castors, heaped with white linen."""
    W, D, H = fr.W, fr.D, fr.H
    for u in (-W / 2 + 0.06, W / 2 - 0.06):
        for w in (0.08, D - 0.08):
            fr.cyl(u, w, 0.0, 0.1, 0.05, 0.05, '#1c1a19', segs=12)
            fr.box(u - 0.02, u + 0.02, w - 0.02, w + 0.02, 0.1, H - 0.02, '#2e2620', 0.004)
    fr.box(-W / 2 + 0.04, W / 2 - 0.04, 0.06, D - 0.06, 0.12, 0.16, '#2e2620', 0.004)
    fr.box(-W / 2 + 0.06, W / 2 - 0.06, 0.08, D - 0.08, 0.2, H - 0.06, '#dccaa4', 0.04)
    for (a, b) in ((0.06, 0.1), (D - 0.1, D - 0.06)):
        fr.box(-W / 2 + 0.04, W / 2 - 0.04, a, b, H - 0.06, H - 0.02, '#2e2620', 0.006)
    for u in (-W / 2 + 0.06, W / 2 - 0.06):
        fr.box(u - 0.02, u + 0.02, 0.06, D - 0.06, H - 0.06, H - 0.02, '#2e2620', 0.006)
    for k in range(6):                                                    # leather straps
        u = -W / 2 + 0.15 + k * (W - 0.3) / 5
        fr.box(u - 0.02, u + 0.02, D - 0.085, D - 0.075, H - 0.18, H - 0.02, '#8a5a34', 0.003)
    rr = random.Random(5)
    for k in range(9):
        u = rr.uniform(-W / 2 + 0.2, W / 2 - 0.2); w = rr.uniform(0.25, D - 0.25)
        fr.sphere(u, w, H - 0.04, rr.uniform(0.13, 0.19), rr.choice(['#f4f0e8', '#ece6da']), 10)

def towel_crate(fr):
    top = crate(fr, H=fr.H - 0.15)
    for j in range(3):
        fr.box(-0.2, 0.2, fr.D / 2 - 0.15, fr.D / 2 + 0.15, top + j * 0.05, top + (j + 1) * 0.05 - 0.004, '#f2eee4', 0.015)

def side_cabinet(fr):
    green_cabinet(fr)
    for k, c in enumerate(('#d8c8a0', '#b86a3a', '#e8e2d0')):
        x, z = fr.at(-fr.W / 2 + 0.25 + k * 0.22, fr.D * 0.5)
        cyl(ST, x, z, fr.H, fr.H + 0.12 + 0.04 * k, 0.06, 0.06, c, segs=10)

def mop(x, z, lean=(0.12, 0.0)):
    obox(ST, x, 0.03, z, 0.34, 0.05, 0.12, '#d8cca8', 0.0, 0.0, 0.02)
    rod(ST, (x, 0.05, z), (x + lean[0], 1.45, z + lean[1]), 0.016, '#a07a44', 6)

def luggage_cart(fr, arch=True, load=True):
    """A brass bellboy's cart: a carpeted deck on castors and a brass arch."""
    W, D, H = fr.W, fr.D, fr.H
    fr.box(-W / 2, W / 2, 0.0, D, 0.12, 0.18, C['brassDark'], 0.01)
    fr.box(-W / 2 + 0.03, W / 2 - 0.03, 0.03, D - 0.03, 0.18, 0.2, S('#7a2230'), 0.01)
    for u in (-W / 2 + 0.08, W / 2 - 0.08):
        for w in (0.1, D - 0.1):
            fr.cyl(u, w, 0.0, 0.12, 0.055, 0.055, '#1c1a19', segs=12)
    if arch:
        n = 10
        for s in (-1, 1):
            u = s * (W / 2 - 0.05)
            fr.rod((u, 0.06, 0.2), (u, 0.06, H - 0.35), 0.022, C['brass'])
            fr.rod((u, D - 0.06, 0.2), (u, D - 0.06, H - 0.35), 0.022, C['brass'])
        for s in (-1, 1):
            u = s * (W / 2 - 0.05)
            pts = [(u, 0.06 + (D - 0.12) * (0.5 - 0.5 * math.cos(math.pi * k / n)), H - 0.35 + 0.3 * math.sin(math.pi * k / n)) for k in range(n + 1)]
            for a, b in zip(pts, pts[1:]):
                fr.rod(a, b, 0.022, C['brass'])
        fr.rod((-W / 2 + 0.05, D / 2, H - 0.05), (W / 2 - 0.05, D / 2, H - 0.05), 0.022, C['brass'])
        fr.sphere(0.0, D / 2, H - 0.02, 0.05, C['brass'], 10)
    if load:
        y = 0.2
        for (w0, w1, u0, u1, h, col) in ((0.1, D - 0.1, -W / 2 + 0.1, W / 2 - 0.1, 0.3, S('#7a2226')), (0.18, D - 0.3, -W / 2 + 0.14, W / 2 - 0.14, 0.26, '#e8dcc0')):
            fr.box(u0, u1, w0, w1, y, y + h, col, 0.03)
            fr.box(-0.08, 0.08, (w0 + w1) / 2 - 0.02, (w0 + w1) / 2 + 0.02, y + h, y + h + 0.04, C['brass'], 0.005)
            for w in (w0 + 0.05, w1 - 0.05):
                fr.box(u0 - 0.005, u1 + 0.005, w - 0.02, w + 0.02, y, y + h, C['brass'], 0.004)
            y += h

def platform_cart(fr, load='tarp'):
    """A flat brass-handled trolley (the back corridor) carrying a crate under a green tarpaulin."""
    W, D, H = fr.W, fr.D, fr.H
    fr.box(-W / 2 + 0.02, W / 2 - 0.02, 0.0, D, 0.1, 0.15, '#6a6a6c', 0.01)
    for u in (-W / 2 + 0.1, W / 2 - 0.1):
        for w in (0.12, D - 0.12):
            fr.cyl(u, w, 0.0, 0.1, 0.05, 0.05, '#1c1a19', segs=10)
    for u in (-W / 2 + 0.05, W / 2 - 0.05):
        fr.rod((u, D - 0.05, 0.15), (u, D - 0.05, 0.95), 0.02, C['brass'])
    fr.rod((-W / 2 + 0.05, D - 0.05, 0.95), (W / 2 - 0.05, D - 0.05, 0.95), 0.02, C['brass'])
    if load == 'tarp':
        fr.box(-W / 2 + 0.06, W / 2 - 0.06, 0.06, D - 0.18, 0.15, H - 0.05, S('#4c5440'), 0.06)
        fr.box(-W / 2 + 0.03, W / 2 - 0.03, 0.03, D - 0.15, 0.15, 0.3, S('#4c5440'), 0.04)
        fr.box(-W / 2 + 0.1, W / 2 - 0.1, 0.1, D - 0.22, H - 0.06, H, S('#565e46'), 0.04)

def room_service_trolley(fr):
    """A brass room-service trolley: two burgundy shelves, a teapot, a silver cloche, plates, a napkin."""
    W, D, H = fr.W, fr.D, fr.H
    for u in (-W / 2 + 0.05, W / 2 - 0.05):
        for w in (0.06, D - 0.06):
            fr.cyl(u, w, 0.0, 0.08, 0.045, 0.045, '#1c1a19', segs=10)
            fr.box(u - 0.016, u + 0.016, w - 0.016, w + 0.016, 0.08, H - 0.12, C['brass'], 0.004)
    for y in (0.3, H - 0.2):
        fr.box(-W / 2 + 0.02, W / 2 - 0.02, 0.02, D - 0.02, y, y + 0.03, C['brassDark'], 0.004)
        fr.box(-W / 2 + 0.04, W / 2 - 0.04, 0.04, D - 0.04, y + 0.03, y + 0.055, S('#7a2230'), 0.006)
    fr.rod((-W / 2 + 0.05, 0.06, H - 0.12), (-W / 2 + 0.05, D - 0.06, H - 0.12), 0.018, C['brass'])
    fr.rod((W / 2 - 0.05, 0.06, H - 0.12), (W / 2 - 0.05, D - 0.06, H - 0.12), 0.018, C['brass'])
    fr.rod((-W / 2 + 0.05, D - 0.06, H - 0.12), (-W / 2 + 0.05, D - 0.06, H + 0.02), 0.018, C['brass'])
    fr.rod((-W / 2 + 0.05, 0.06, H - 0.12), (-W / 2 + 0.05, 0.06, H + 0.02), 0.018, C['brass'])
    fr.rod((-W / 2 + 0.05, 0.06, H + 0.02), (-W / 2 + 0.05, D - 0.06, H + 0.02), 0.018, C['brass'])
    top = H - 0.2 + 0.055
    x, z = fr.at(W * 0.12, D * 0.5)
    cyl(ST, x, z, top, top + 0.02, 0.2, 0.2, '#c8ccd2', segs=20)
    sphere(ST, x, top + 0.01, z, 0.17, '#b8bcc4', segs=16)
    sphere(ST, x, top + 0.2, z, 0.03, C['brass'], 8)
    x, z = fr.at(-W * 0.28, D * 0.4)
    cyl(ST, x, z, top, top + 0.14, 0.08, 0.1, '#f4f0e8', segs=14)
    cyl(ST, x, z, top + 0.14, top + 0.18, 0.06, 0.03, '#f4f0e8', segs=12)
    rod(ST, (x + 0.08, top + 0.08, z), (x + 0.16, top + 0.13, z), 0.012, '#f4f0e8', 5)
    x, z = fr.at(-W * 0.3, D * 0.5)
    for j in range(4):
        cyl(ST, x, z, 0.34 + j * 0.02, 0.355 + j * 0.02, 0.12, 0.12, '#f4f0e8', segs=14)
    x, z = fr.at(W * 0.2, D * 0.5)
    box(ST, x - 0.14, x + 0.14, 0.34, 0.46, z - 0.12, z + 0.12, '#8a5a34', 0.01)
    fr.box(-W / 2 - 0.01, -W / 2 + 0.04, 0.25, 0.45, H - 0.45, H - 0.02, '#f4f0e8', 0.01)         # the napkin over the rail

def umbrella_stand(fr):
    x, z = fr.cx, fr.cz
    r = min(fr.W, fr.D) / 2 - 0.04
    cyl(ST, x, z, 0.0, 0.55, r, r, C['brass'], segs=18, bevel=0.01)
    cyl(ST, x, z, 0.5, 0.56, r + 0.01, r + 0.01, C['brassDark'], segs=18)
    for k, (dx, dz, col) in enumerate(((-0.05, 0.02, '#1e2a3a'), (0.05, -0.03, '#2a3a2a'), (0.0, 0.06, '#1c1a19'))):
        rod(ST, (x + dx, 0.1, z + dz), (x + dx * 1.6, 0.86, z + dz * 1.6), 0.022, col, 6)
        rod(ST, (x + dx * 1.6, 0.86, z + dz * 1.6), (x + dx * 1.6 + 0.05, 0.93, z + dz * 1.6), 0.012, '#8a5a34', 5)

def filing_cabinets(fr):
    """Two grey steel filing cabinets (the switchboard room) with folders on top."""
    W, D, H = fr.W, fr.D, fr.H
    n = 2 if W > 0.9 else 1
    cw = W / n
    for i in range(n):
        u0 = -W / 2 + i * cw
        fr.box(u0 + 0.01, u0 + cw - 0.01, 0.0, D, 0.0, H, '#9ca2a6', 0.015)
        for k in range(4):
            y0 = 0.06 + k * (H - 0.1) / 4
            fr.box(u0 + 0.04, u0 + cw - 0.04, D - 0.01, D + 0.01, y0 + 0.02, y0 + (H - 0.1) / 4 - 0.02, '#aab0b4', 0.008)
            fr.box(u0 + cw / 2 - 0.07, u0 + cw / 2 + 0.07, D + 0.01, D + 0.03, y0 + (H - 0.1) / 8 + 0.02, y0 + (H - 0.1) / 8 + 0.05, C['brass'], 0.004)
    x, z = fr.at(-W / 4, D / 2)
    books_pile(x, z, H, 3, 0.2)

def switch_desk(fr, lamp_side=1):
    """An operator's desk: pedestal drawers, the switchboard upright with jacks and cords, a lamp, a
    black telephone, and a green swivel chair in front."""
    W, D = fr.W, fr.D
    dd = min(0.8, D - 0.5)
    H = 0.76
    for s in (-1, 1):
        u0, u1 = (-W / 2, -W / 2 + 0.45) if s < 0 else (W / 2 - 0.45, W / 2)
        fr.box(u0, u1, 0.0, dd - 0.02, 0.0, H - 0.04, WOOD, 0.015)
        for k in range(3):
            y0 = 0.06 + k * 0.22
            fr.box(u0 + 0.03, u1 - 0.03, dd - 0.03, dd - 0.0, y0, y0 + 0.19, WOOD_T, 0.008)
            fr.sphere((u0 + u1) / 2, dd, y0 + 0.095, 0.018, C['brass'], 8)
    fr.box(-W / 2 + 0.45, W / 2 - 0.45, 0.02, 0.08, 0.2, H - 0.04, WOOD_D, 0.006)
    fr.box(-W / 2 - 0.02, W / 2 + 0.02, 0.0, dd + 0.02, H - 0.04, H, WOOD_T, 0.012)
    pw = min(1.2, W - 0.5)
    fr.box(-pw / 2, pw / 2, 0.02, 0.3, H, H + 0.62, WOOD, 0.015)
    fr.box(-pw / 2 - 0.02, pw / 2 + 0.02, 0.0, 0.33, H + 0.62, H + 0.67, WOOD_T, 0.012)
    fr.front_tex(-pw / 2 + 0.06, pw / 2 - 0.06, 0.28, 0.305, H + 0.12, H + 0.58, K.CELL['signs'], pw, quad=0)
    fr.box(-pw / 2, pw / 2, 0.3, 0.46, H, H + 0.08, WOOD, 0.01)                                   # key shelf
    rr = random.Random(3)
    for k in range(10):
        u0 = rr.uniform(-pw / 2 + 0.1, pw / 2 - 0.1)
        y0 = rr.uniform(H + 0.2, H + 0.5)
        u1 = u0 + rr.uniform(-0.2, 0.2)
        col = rr.choice(['#8a2020', '#1a1a1a', '#8a2020'])
        fr.rod((u0, 0.31, y0), ((u0 + u1) / 2, 0.44, H + 0.14), 0.007, col, 4)
        fr.rod(((u0 + u1) / 2, 0.44, H + 0.14), (u1, 0.4, H + 0.08), 0.007, col, 4)
    lx = (W / 2 - 0.22) * lamp_side
    x, z = fr.at(lx, 0.3)
    lamp_on(x, z, H, 0.5, 0.13, 50.0)
    x, z = fr.at(-lx * 0.92, dd * 0.55)                                                            # telephone
    box(ST, x - 0.1, x + 0.1, H, H + 0.07, z - 0.08, z + 0.08, '#1c1a19', 0.02)
    obox(ST, x, H + 0.1, z, 0.22, 0.04, 0.06, '#1c1a19', fr.yaw, 0, 0.015)
    x, z = fr.at(-lx * 0.55, dd * 0.6)
    box(ST, x - 0.12, x + 0.12, H, H + 0.03, z - 0.09, z + 0.09, '#ede3c8', 0.005)                  # a ledger
    cx_, cz_ = fr.at(0.0, dd + 0.3)
    swivel_chair(cx_, cz_, math.atan2(fr.F[0], fr.F[1]) + math.pi)

def small_desk(fr):
    """A small writing desk with a lamp and a stack of papers."""
    W, D = fr.W, fr.D
    H = 0.74
    for u in (-W / 2 + 0.05, W / 2 - 0.05):
        for w in (0.05, D - 0.05):
            fr.box(u - 0.03, u + 0.03, w - 0.03, w + 0.03, 0.0, H - 0.04, WOOD_D, 0.006)
    fr.box(-W / 2 + 0.03, W / 2 - 0.03, 0.03, D - 0.03, H - 0.16, H - 0.04, WOOD, 0.008)
    fr.box(-W / 2 - 0.02, W / 2 + 0.02, 0.0, D + 0.02, H - 0.04, H, WOOD_T, 0.01)
    x, z = fr.at(-W / 2 + 0.22, D * 0.5)
    lamp_on(x, z, H, 0.46, 0.13, 45.0)
    x, z = fr.at(0.15, D * 0.5)
    for j in range(4):
        box(ST, x - 0.14, x + 0.14, H + j * 0.025, H + (j + 1) * 0.025 - 0.003, z - 0.1, z + 0.1, '#ede3c8', 0.004)

def wall_cubby(side, s, W=0.6, H=0.5, y=1.55, kind='papers'):
    """A small open wall cabinet (pigeonholes of papers, or a shelf of books)."""
    sg = seg_at(side, s)
    sg.put(s - W / 2, s + W / 2, y, y + H, 0.0, 0.26, WOOD, 0.012, where=sg.up)
    rows = 2
    cols = 2 if kind == 'papers' else 1
    for i in range(cols):
        for j in range(rows):
            a0 = s - W / 2 + 0.04 + i * (W - 0.08) / cols
            a1 = a0 + (W - 0.08) / cols - 0.03
            b0 = y + 0.04 + j * (H - 0.08) / rows
            b1 = b0 + (H - 0.08) / rows - 0.03
            sg.put(a0, a1, b0, b1, 0.24, 0.265, '#2a1810', 0.0, where=sg.up)
            if kind == 'papers':
                sg.put(a0 + 0.02, a1 - 0.02, b0, b0 + 0.08, 0.1, 0.25, '#ede3c8', 0.004, where=sg.up)
            else:
                n = int((a1 - a0) / 0.06)
                for k in range(n):
                    sg.put(a0 + k * 0.06, a0 + k * 0.06 + 0.05, b0, b1 - 0.02, 0.06, 0.24,
                           ['#2f5a5a', '#8a2a2c', '#3a5a3a', '#b08a58'][k % 4], 0.004, where=sg.up)

# ---- stairs ----------------------------------------------------------------------------------------
def stair_flight(fr):
    """Stone stairs rising along the back wall from a turned newel post at the low end (the west, seen
    from the room) to the high end in the corner, a brass handrail on the open side and one on the wall."""
    W, D = fr.W, fr.D
    m = -1 if fr.facing == 's' else 1          # u runs west for a south-facing frame: rise towards the east
    n = 8
    rise = min(fr.H, 1.6) / n
    run = (W - 0.5) / n
    width = D - 0.2
    stone, nose = S('#c8ae88', 0.9), S('#a88e6a', 0.9)
    def bx(u0, u1, *rest, **kw):
        fr.box(min(m * u0, m * u1), max(m * u0, m * u1), *rest, **kw)
    for i in range(n):
        u0 = -W / 2 + 0.4 + i * run
        y1 = rise * (i + 1)
        bx(u0, W / 2, 0.0, width, 0.0 if i == 0 else rise * i, y1, stone, 0.01)
        bx(u0 - 0.01, u0 + 0.04, 0.0, width + 0.01, y1 - 0.025, y1 + 0.005, nose, 0.004)
    bx(-W / 2 + 0.36, W / 2, width, width + 0.05, 0.0, 0.1, S('#6a5a44', 0.8), 0.004)
    nu = m * (-W / 2 + 0.2)
    fr.box(nu - 0.1, nu + 0.1, width - 0.14, width + 0.06, 0.0, 0.12, WOOD_D, 0.01)
    fr.box(nu - 0.075, nu + 0.075, width - 0.115, width + 0.035, 0.12, 0.98, WOOD, 0.01)
    fr.cyl(nu, width - 0.04, 0.98, 1.06, 0.1, 0.08, WOOD_T, segs=12)
    fr.sphere(nu, width - 0.04, 1.12, 0.075, WOOD_T, 10)
    top = rise * n
    fr.rod((nu, width - 0.04, 1.0), (m * (W / 2 - 0.05), width - 0.04, 0.9 + top - rise), 0.028, C['brass'])
    for k in range(1, n):
        u = m * (-W / 2 + 0.4 + (k - 0.5) * run)
        y = rise * k
        fr.rod((u, width - 0.04, y), (u, width - 0.04, y + 0.88), 0.012, C['brassDark'], 5)
    fr.rod((m * (-W / 2 + 0.4), 0.05, 0.95), (m * (W / 2 - 0.05), 0.05, 0.95 + top - rise), 0.02, C['brass'])

def trolley_bins(fr):
    """A brass service trolley with grey tubs and folded towels, and a grey bin beside it."""
    W, D, H = fr.W, fr.D, fr.H
    tw = W - 0.45
    for u in (-W / 2 + 0.04, -W / 2 + tw - 0.04):
        for w in (0.05, D - 0.05):
            fr.cyl(u, w, 0.0, 0.07, 0.04, 0.04, '#1c1a19', segs=8)
            fr.box(u - 0.014, u + 0.014, w - 0.014, w + 0.014, 0.07, H - 0.1, C['brass'], 0.004)
    for y in (0.25, H - 0.12):
        fr.box(-W / 2 + 0.02, -W / 2 + tw - 0.02, 0.02, D - 0.02, y, y + 0.03, '#6a4a30', 0.006)
    for k in range(2):
        u = -W / 2 + 0.1 + k * (tw - 0.2) / 2
        fr.box(u, u + (tw - 0.2) / 2 - 0.04, 0.08, D - 0.08, 0.28, 0.46, '#55595e', 0.015)
    fr.box(-W / 2 + 0.1, -W / 2 + tw - 0.1, 0.1, D - 0.1, H - 0.09, H + 0.05, '#ece6da', 0.02)
    x, z = fr.at(W / 2 - 0.2, D / 2)
    box(ST, x - 0.17, x + 0.17, 0.0, 0.72, z - 0.19, z + 0.19, '#4a4e54', 0.02)
    box(ST, x - 0.19, x + 0.19, 0.7, 0.76, z - 0.21, z + 0.21, '#3a3e44', 0.015)
    box(ST, x - 0.1, x - 0.02, 0.72, 0.85, z - 0.2, z - 0.18, '#ece6da', 0.004)

# ---- infirmary -------------------------------------------------------------------------------------
def hospital_bed(fr, blanket=S('#6e7e5a')):
    """A cream-painted iron bed: rail head- and footboards, a white mattress, pillow, a green blanket
    turned down over the sheet. The head is at the footprint's back (w = 0)."""
    W, D = fr.W, fr.D
    white = '#e8e0cc'
    for w, top in ((0.04, 1.0), (D - 0.04, 0.78)):
        for u in (-W / 2 + 0.04, W / 2 - 0.04):
            fr.rod((u, w, 0.0), (u, w, top), 0.025, white, 8)
            fr.sphere(u, w, top + 0.01, 0.03, white, 8)
        fr.rod((-W / 2 + 0.04, w, top - 0.04), (W / 2 - 0.04, w, top - 0.04), 0.02, white, 8)
        fr.rod((-W / 2 + 0.04, w, 0.4), (W / 2 - 0.04, w, 0.4), 0.018, white, 8)
        for k in range(1, 5):
            u = -W / 2 + 0.04 + k * (W - 0.08) / 5
            fr.rod((u, w, 0.4), (u, w, top - 0.04), 0.01, white, 6)
    for u in (-W / 2 + 0.04, W / 2 - 0.04):
        fr.cyl(u, D - 0.04, 0.0, 0.05, 0.035, 0.035, C['black'], segs=8)
    fr.box(-W / 2 + 0.04, W / 2 - 0.04, 0.06, D - 0.06, 0.34, 0.4, '#b8b4a8', 0.01)
    fr.box(-W / 2 + 0.06, W / 2 - 0.06, 0.08, D - 0.08, 0.4, 0.56, '#f4f2ec', 0.05)
    fr.box(-W / 2 + 0.03, W / 2 - 0.03, 0.72, D - 0.06, 0.42, 0.61, blanket, 0.05)
    fr.box(-W / 2 + 0.05, W / 2 - 0.05, 0.62, 0.8, 0.57, 0.64, '#f4f2ec', 0.04)
    fr.box(-W / 2 + 0.16, W / 2 - 0.16, 0.12, 0.5, 0.56, 0.72, '#f6f4ee', 0.07)

def nightstand(fr, lamp=True, plant=True, towels=False):
    W, D = fr.W, fr.D
    H = min(fr.H, 0.64)
    top = cabinet(fr, rows=2, cols=1, H=H - 0.05, knobs=True)
    if lamp:
        x, z = fr.at(-W / 2 + 0.2, D / 2)
        lamp_on(x, z, top, 0.46, 0.13, 45.0)
    if plant:
        x, z = fr.at(W / 2 - 0.14, D / 2)
        pot_plant(x, z, top, 0.45)
    if towels:
        x, z = fr.at(-0.05, D / 2)
        for j in range(3):
            box(ST, x - 0.16, x + 0.16, top + j * 0.05, top + (j + 1) * 0.05 - 0.004, z - 0.12, z + 0.12, '#f2eee4', 0.015)
        x, z = fr.at(W / 2 - 0.1, D / 2)
        pot_plant(x, z, top, 0.4)

def glass_cabinet(fr):
    """The medicine cabinet: grey-blue, glazed doors over drawers, bottles and boxes on its shelves."""
    W, D, H = fr.W, fr.D, fr.H
    body, dark = '#8a98a0', '#6e7c84'
    fr.box(-W / 2, W / 2, 0.0, D, 0.0, 0.08, dark, 0.01)
    fr.box(-W / 2, -W / 2 + 0.05, 0.0, D - 0.02, 0.08, H - 0.06, body, 0.01)
    fr.box(W / 2 - 0.05, W / 2, 0.0, D - 0.02, 0.08, H - 0.06, body, 0.01)
    fr.box(-W / 2, W / 2, 0.0, 0.03, 0.08, H - 0.06, dark, 0.006)
    fr.box(-W / 2 - 0.03, W / 2 + 0.03, 0.0, D + 0.02, H - 0.08, H, body, 0.015)
    fr.box(-W / 2 + 0.03, W / 2 - 0.03, 0.0, D - 0.02, 0.08, 0.5, body, 0.01)
    for u0, u1 in ((-W / 2 + 0.05, -0.01), (0.01, W / 2 - 0.05)):
        fr.box(u0, u1, D - 0.03, D, 0.12, 0.46, '#98a6ae', 0.01)
        fr.box((u0 + u1) / 2 - 0.08, (u0 + u1) / 2 + 0.08, D, D + 0.02, 0.3, 0.33, C['brass'], 0.004)
    for y in (0.5, 0.95, 1.38):
        fr.box(-W / 2 + 0.05, W / 2 - 0.05, 0.03, D - 0.03, y, y + 0.025, body, 0.004)
    rr = random.Random(8)
    for y in (0.525, 0.975, 1.405):
        u = -W / 2 + 0.1
        while u < W / 2 - 0.12:
            if rr.random() < 0.5:
                r_ = rr.uniform(0.04, 0.055)
                fr.cyl(u + r_, D / 2, y, y + rr.uniform(0.16, 0.24), r_, r_, rr.choice(['#8a4a22', '#e8e2d0', '#8a4a22', '#c8d0c0']), segs=10)
                u += 2 * r_ + 0.04
            else:
                w_ = rr.uniform(0.12, 0.18)
                fr.box(u, u + w_, 0.08, D - 0.08, y, y + rr.uniform(0.12, 0.18), rr.choice(['#dfe6d0', '#c8d8b8', '#e8e2d0']), 0.01)
                u += w_ + 0.04
    # the glazed doors: frames and glass
    for u0, u1 in ((-W / 2 + 0.05, -0.01), (0.01, W / 2 - 0.05)):
        fr.box(u0, u1, D - 0.035, D - 0.01, H - 0.12, H - 0.08, body, 0.006)
        fr.box(u0, u1, D - 0.035, D - 0.01, 0.5, 0.54, body, 0.006)
        fr.box(u0, u0 + 0.04, D - 0.035, D - 0.01, 0.54, H - 0.12, body, 0.006)
        fr.box(u1 - 0.04, u1, D - 0.035, D - 0.01, 0.54, H - 0.12, body, 0.006)
        fr.box(u0 + 0.04, u1 - 0.04, D - 0.03, D - 0.025, 0.54, H - 0.12, '#c8d8dc', 0.0)
    fr.box(-0.05, -0.02, D - 0.01, D + 0.02, 0.9, 1.15, C['brass'], 0.004)
    fr.box(0.02, 0.05, D - 0.01, D + 0.02, 0.9, 1.15, C['brass'], 0.004)

def stool(fr, top=S('#5e6e52')):
    x, z = fr.cx, fr.cz
    cyl(ST, x, z, 0.52, 0.6, 0.2, 0.2, top, segs=18, bevel=0.03)
    cyl(ST, x, z, 0.1, 0.52, 0.025, 0.025, WOOD_D, segs=8)
    for k in range(5):
        a = k * 2 * math.pi / 5
        rod(ST, (x, 0.1, z), (x + 0.22 * math.cos(a), 0.04, z + 0.22 * math.sin(a)), 0.018, WOOD_D, 5)
        sphere(ST, x + 0.22 * math.cos(a), 0.03, z + 0.22 * math.sin(a), 0.03, C['black'], 6)

def tray_cabinet(fr):
    top = cabinet(fr, rows=1, cols=1, doors_below=True)
    x, z = fr.at(0.05, fr.D / 2)
    box(ST, x - 0.16, x + 0.16, top, top + 0.05, z - 0.12, z + 0.12, '#e8e4dc', 0.01)
    box(ST, x - 0.14, x + 0.14, top + 0.01, top + 0.05, z - 0.1, z + 0.1, '#ccc8c0', 0.0)
    x, z = fr.at(-fr.W / 2 + 0.2, fr.D / 2)
    for j in range(3):
        box(ST, x - 0.14, x + 0.14, top + j * 0.05, top + (j + 1) * 0.05 - 0.004, z - 0.12, z + 0.12, '#f2eee4', 0.015)

# ---- cloakroom ------------------------------------------------------------------------------------
def coat_rail(fr, alcove=True):
    """A brass hanging rail with coats in the references' colours, a shelf of hats and hat boxes above."""
    W, D = fr.W, fr.D
    top = 1.55
    if alcove:                                      # a wooden back and sides (a built-in alcove)
        fr.box(-W / 2, W / 2, 0.0, 0.05, 0.0, 1.95, WOOD_D, 0.006)
        for u in (-W / 2, W / 2 - 0.06):
            fr.box(u, u + 0.06, 0.0, D, 0.0, 1.95, WOOD, 0.008)
        fr.box(-W / 2, W / 2, 0.0, D, 0.0, 0.1, WOOD_D, 0.006)
    fr.box(-W / 2 + 0.03, W / 2 - 0.03, 0.0, D - 0.02, top + 0.16, top + 0.2, WOOD_T, 0.008)
    fr.rod((-W / 2 + 0.06, D * 0.55, top), (W / 2 - 0.06, D * 0.55, top), 0.02, C['brass'])
    for u in (-W / 2 + 0.08, W / 2 - 0.08):
        fr.sphere(u, D * 0.55, top, 0.035, C['brass'], 8)
    rr = random.Random(int(abs(fr.cx) * 10 + abs(fr.cz)))
    cols = [S('#1e2a44'), '#c89a64', S('#7a2230'), S('#2e4a36'), S('#1e2a44'), S('#7a2230'), '#c89a64', S('#2e4a36')]
    n = max(3, int((W - 0.3) / 0.3))
    for k in range(n):
        u = -W / 2 + 0.2 + k * (W - 0.4) / max(1, n - 1)
        col = cols[(k + rr.randint(0, 1)) % len(cols)]
        L = rr.uniform(0.95, 1.1)
        fr.box(u - 0.1, u + 0.1, D * 0.55 - 0.13, D * 0.55 + 0.13, top - L, top - 0.1, col, 0.05)      # the coat
        fr.box(u - 0.13, u + 0.13, D * 0.55 - 0.12, D * 0.55 + 0.12, top - 0.28, top - 0.08, col, 0.06)  # shoulders
        fr.box(u - 0.035, u + 0.035, D * 0.55 + 0.1, D * 0.55 + 0.14, top - 0.28, top - 0.12, '#e8e0cc' if col != '#c89a64' else '#7a5a3a', 0.01)
        fr.rod((u, D * 0.55, top - 0.08), (u, D * 0.55, top + 0.03), 0.006, C['brassDark'], 4)
    for k in range(3):                                   # hats and hat boxes on the shelf
        u = -W / 2 + 0.3 + k * (W - 0.6) / 2
        x, z = fr.at(u, D * 0.5)
        c = [S('#1e2a44'), S('#7a2230'), '#b08a58'][(k + int(abs(fr.cx))) % 3]
        if k % 2 == 0:
            cyl(ST, x, z, top + 0.2, top + 0.34, 0.16, 0.16, c, segs=16, bevel=0.01)
            cyl(ST, x, z, top + 0.34, top + 0.36, 0.165, 0.165, C['brass'], segs=16)
        else:
            box(ST, x - 0.18, x + 0.18, top + 0.2, top + 0.34, z - 0.12, z + 0.12, c, 0.02)
            box(ST, x - 0.04, x + 0.04, top + 0.34, top + 0.36, z - 0.02, z + 0.02, C['brass'], 0.004)

# ---- bedroom, linen, exit (rooms without references, same style) -------------------------------------
def bed(fr, blanket=S('#7a2230'), frame=WOOD, sheet='#efe9dc'):
    W, D = fr.W, fr.D
    fr.box(-W / 2, W / 2, 0.0, 0.08, 0.0, 1.2, frame, 0.02)
    fr.box(-W / 2 + 0.1, W / 2 - 0.1, 0.08, 0.1, 0.55, 1.08, WOOD_T, 0.02)
    fr.box(-W / 2 - 0.02, W / 2 + 0.02, 0.0, 0.1, 1.18, 1.24, WOOD_D, 0.015)
    fr.box(-W / 2, W / 2, 0.08, D, 0.12, 0.34, frame, 0.02)
    fr.box(-W / 2 + 0.03, W / 2 - 0.03, 0.1, D - 0.03, 0.34, 0.54, sheet, 0.05)
    fr.box(-W / 2 + 0.01, W / 2 - 0.01, 0.62, D, 0.36, 0.6, blanket, 0.05)
    fr.box(-W / 2 + 0.02, W / 2 - 0.02, 0.56, 0.72, 0.52, 0.63, sheet, 0.04)
    fr.box(-W / 2 + 0.005, W / 2 - 0.005, 0.95, 0.99, 0.595, 0.607, C['gold'], 0.003)
    n = 2 if W > 1.3 else 1
    pw = (W - 0.3) / n
    for i in range(n):
        u0 = -W / 2 + 0.15 + i * pw
        fr.box(u0 + 0.03, u0 + pw - 0.03, 0.12, 0.48, 0.54, 0.72, C['cream'], 0.07)
    fr.box(-W / 2, W / 2, D - 0.06, D, 0.0, 0.62, frame, 0.02)
    for u in (-W / 2 + 0.05, W / 2 - 0.05):
        fr.box(u - 0.04, u + 0.04, D - 0.07, D + 0.01, 0.0, 0.7, WOOD_D, 0.015)

def wardrobe(fr, body=WOOD, doors=2):
    W, D, H = fr.W, fr.D, fr.H
    for u in (-W / 2 + 0.06, W / 2 - 0.06):
        for w in (0.06, D - 0.06):
            fr.box(u - 0.04, u + 0.04, w - 0.04, w + 0.04, 0.0, 0.1, WOOD_D, 0.01)
    fr.box(-W / 2 + 0.01, W / 2 - 0.01, 0.0, D - 0.02, 0.08, H - 0.1, body, 0.02)
    fr.box(-W / 2 - 0.03, W / 2 + 0.03, -0.0, D + 0.03, H - 0.1, H, WOOD_D, 0.02)
    fr.box(-W / 2 - 0.015, W / 2 + 0.015, D - 0.01, D + 0.02, H - 0.14, H - 0.12, C['brass'], 0.004)
    dw = (W - 0.08) / doors
    for i in range(doors):
        u0 = -W / 2 + 0.04 + i * dw
        fr.box(u0 + 0.01, u0 + dw - 0.01, D - 0.03, D, 0.14, H - 0.16, WOOD_T, 0.012)
        fr.box(u0 + 0.07, u0 + dw - 0.07, D - 0.005, D + 0.01, 0.24, H * 0.46, body, 0.012)
        fr.box(u0 + 0.07, u0 + dw - 0.07, D - 0.005, D + 0.01, H * 0.5, H - 0.26, body, 0.012)
        um = u0 + (dw - 0.06 if i == 0 else 0.06)
        fr.box(um - 0.012, um + 0.012, D, D + 0.03, H * 0.44, H * 0.56, C['brass'], 0.006)

def window_seat(fr):
    W, D = fr.W, fr.D
    fr.box(-W / 2, W / 2, 0.0, 0.62, 0.0, 0.42, WOOD, 0.02)
    for k in range(3):
        u0 = -W / 2 + 0.05 + k * (W - 0.1) / 3
        fr.box(u0 + 0.03, u0 + (W - 0.1) / 3 - 0.03, 0.6, 0.63, 0.06, 0.36, WOOD_T, 0.01)
    fr.box(-W / 2 + 0.02, W / 2 - 0.02, 0.02, 0.6, 0.42, 0.52, S('#8a2430'), 0.05)
    fr.box(-W / 2 + 0.06, -W / 2 + 0.45, 0.04, 0.2, 0.5, 0.82, S('#2e4a3c'), 0.07)
    fr.box(W / 2 - 0.45, W / 2 - 0.06, 0.04, 0.2, 0.5, 0.82, S('#9a2c38'), 0.07)
    x, z = fr.at(0.0, 0.95)
    plant_at(x, z, 0.62, seed=9)

def laundry_basket(fr):
    x, z = fr.cx, fr.cz
    r = min(fr.W, fr.D) / 2 - 0.05
    cyl(ST, x, z, 0.0, 0.48, r * 0.88, r, C['wicker'], segs=20, bevel=0.02)
    cyl(ST, x, z, 0.46, 0.5, r + 0.02, r + 0.02, '#8a6436', segs=20)
    for k in range(3):
        cyl(ST, x, z, 0.1 + k * 0.12, 0.12 + k * 0.12, r * (0.9 + 0.03 * k) + 0.006, r * (0.9 + 0.03 * k) + 0.006, '#8a6436', segs=20)
    for k in range(3):
        sphere(ST, x + 0.08 * math.cos(k * 2.1), 0.5, z + 0.08 * math.sin(k * 2.1), r * 0.55, ['#f2eee4', '#e8e2d4', '#c9d8e0'][k], segs=10)

def folding_table(fr):
    W, D, H = fr.W, fr.D, fr.H
    for u in (-W / 2 + 0.05, W / 2 - 0.05):
        for w in (0.05, D - 0.05):
            fr.box(u - 0.025, u + 0.025, w - 0.025, w + 0.025, 0.0, H - 0.04, WOOD_D, 0.006)
    fr.box(-W / 2, W / 2, 0.0, D, H - 0.04, H, WOOD_T, 0.01)
    for k, (u, w) in enumerate(((-0.18, 0.28), (0.18, 0.28), (0.0, D - 0.3))):
        col = ['#f2eee4', '#c9d8e0', '#e8dcc4'][k]
        for j in range(4 + k):
            fr.box(u - 0.15, u + 0.15, w - 0.12, w + 0.12, H + j * 0.045, H + (j + 1) * 0.045 - 0.004, col, 0.012)

def linen_press(fr):
    wardrobe(fr, body=S('#6a4028'), doors=2)
    top = fr.H
    for k in range(3):
        fr.box(-fr.W / 2 + 0.15 + k * 0.7, -fr.W / 2 + 0.75 + k * 0.7, 0.1, fr.D - 0.1, top, top + 0.1,
               ['#efe9dc', '#c9d8e0', '#e4dccb'][k], 0.02)

def exit_door(fr):
    W, D, H = fr.W, fr.D, fr.H
    fr.box(-W / 2, W / 2, 0.0, D, 0.0, 0.03, '#3a3a3a', 0.005)
    fr.box(-W / 2 - 0.1, -W / 2, 0.0, D, 0.0, 2.0, WOOD, 0.01)
    fr.box(W / 2, W / 2 + 0.1, 0.0, D, 0.0, 2.0, WOOD, 0.01)
    fr.box(-W / 2 - 0.12, W / 2 + 0.12, 0.0, D, 1.9, 2.04, WOOD, 0.01)
    for s in (-1, 1):
        a0, a1 = (-W / 2 + 0.01, -0.005) if s < 0 else (0.005, W / 2 - 0.01)
        fr.box(a0, a1, 0.0, D - 0.06, 0.02, 1.89, '#4c5e50', 0.012)
        fr.box(a0 + 0.08, a1 - 0.08, D - 0.07, D - 0.05, 1.1, 1.75, '#56685a', 0.01)
        fr.box(a0 + 0.12, a1 - 0.12, D - 0.07, D - 0.04, 1.35, 1.68, '#9fb8b0', 0.004)
    fr.box(-W / 2 + 0.1, W / 2 - 0.1, D - 0.05, D + 0.02, 1.0, 1.06, C['brass'], 0.01)
    for u in (-W / 2 + 0.12, W / 2 - 0.12):
        fr.box(u - 0.03, u + 0.03, D - 0.05, D + 0.02, 0.96, 1.1, C['brassDark'], 0.006)
    fr.box(-0.02, 0.02, D - 0.06, D - 0.05, 0.02, 1.89, '#28302a', 0.002)
    fr.front_tex(-0.34, 0.34, 0.0, D + 0.02, 2.06, 2.3, K.CELL['signs'], 0.68, color='#0e4a2a', quad=1)
    x, z = fr.at(0.0, D + 0.25)
    LIGHTS.append((x, 2.1, z, 30.0, 0.05, (0.35, 1.0, 0.55)))

def planter_box(fr):
    W, D = fr.W, fr.D
    fr.box(-W / 2, W / 2, 0.0, D, 0.0, 0.5, S('#3a2418'), 0.03)
    fr.box(-W / 2 - 0.015, W / 2 + 0.015, -0.015, D + 0.015, 0.46, 0.53, C['brass'], 0.012)
    fr.box(-W / 2 + 0.05, W / 2 - 0.05, 0.05, D - 0.05, 0.5, 0.52, C['soil'], 0.0)
    for k, (u, w) in enumerate(((-W / 4, D / 3), (W / 4, 2 * D / 3), (0.0, D / 2))):
        x, z = fr.at(u, w)
        rr = random.Random(30 + k)
        for i in range(9):
            yaw = i * (2 * math.pi / 9) * 2.618 + rr.uniform(-0.2, 0.2)
            leaf(ST, x, z, 0.52 + (i % 3) * 0.08, yaw, (0.45, 0.85, 1.15)[i % 3], 0.45, 0.24, (C['leaf1'], C['leaf2'], C['leaf3'])[i % 3])

def canister(x, z, h=0.7, r=0.16):
    cyl(ST, x, z, 0.0, h, r, r, '#6a6e72', segs=16, bevel=0.03)
    cyl(ST, x, z, h, h + 0.08, r * 0.8, r * 0.4, C['brass'], segs=14)
    cyl(ST, x, z, h * 0.3, h * 0.34, r + 0.005, r + 0.005, C['brass'], segs=16)

def toolbox(x, z, col=S('#4a5a3a')):
    box(ST, x - 0.18, x + 0.18, 0.0, 0.24, z - 0.12, z + 0.12, col, 0.015)
    box(ST, x - 0.06, x + 0.06, 0.24, 0.3, z - 0.015, z + 0.015, C['brassDark'], 0.004)

def fuse_box(side, s, y=1.45):
    sg = seg_at(side, s)
    sg.put(s - 0.22, s + 0.22, y - 0.28, y + 0.28, 0.0, 0.14, '#5a6068', 0.012, where=sg.up)
    sg.put(s - 0.19, s + 0.19, y - 0.25, y + 0.25, 0.14, 0.15, '#666c74', 0.006, where=sg.up)
    sg.put(s + 0.1, s + 0.13, y - 0.04, y + 0.04, 0.15, 0.17, C['brass'], 0.004, where=sg.up)

def pipe_run(side, s0, s1, y, d=0.08, r=0.03, col='#6a6e72', drops=()):
    """A pipe along a wall, with vertical drops at `drops` [(s, y_end)]."""
    sg = seg_at(side, (s0 + s1) / 2)
    p0 = sg.rect(s0, s0, d, d); p1 = sg.rect(s1, s1, d, d)
    rod(sg.up, (p0[0], y, p0[2]), (p1[0], y, p1[2]), r, col, 8)
    for (s, y1) in drops:
        p = seg_at(side, s).rect(s, s, d, d)
        tgt = seg_at(side, s)
        rod(tgt.up if y1 >= SPLIT else tgt.lo, (p[0], y, p[2]), (p[0], y1, p[2]), r, col, 8)
        sphere(tgt.up, p[0], y, p[2], r * 1.3, col, 8)

# ---- dispatch ---------------------------------------------------------------------------------------
def build_furniture(f, room):
    kind = f['kind']
    f = dict(f, **ROOMS[room].get('fx', {}).get(kind, {}))        # per-room details (make_room.py only)
    fr = Fr(f)
    B = {
        'sofa': lambda: sofa(fr),
        'armchair': lambda: sofa(Fr(f, f.get('facing')) if f.get('facing') else fr, 1, (S('#2e5a48'), S('#22463a'), S('#346852'))),
        'coffeeTable': lambda: round_table(fr, None, 'coffee', H=0.46),
        'lampTable': lambda: round_table(fr, None, 'lamp', H=0.62),
        'clothTable': lambda: round_table(fr, '#efe6d2', 'lampVase', H=0.76),
        'diningSet': lambda: dining_set(fr),
        'plant': lambda: plant_at(fr.cx, fr.cz, min(f['size'][0], f['size'][2]) / 0.6 * 0.95, seed=int(abs(fr.cx * 3 + fr.cz * 7)) + 1),
        'bench': lambda: bench(fr),
        'tuftedBench': lambda: bench(fr, tufted=True),
        'slatBench': lambda: slat_bench(fr),
        'console': lambda: hall_console(fr, f.get('items', ('lamp', 'plant'))),
        'sideboard': lambda: sideboard(fr),
        'writingDesk': lambda: writing_desk(fr),
        'bookcase': lambda: bookcase(fr, lamp=fr.W > 1.2, props=True),
        'bookcaseNW': lambda: angled_bookcase(f, 'nw'),
        'bookcaseNE': lambda: angled_bookcase(f, 'ne'),
        'bandstand': lambda: bandstand(f),
        'switchDesk': lambda: switch_desk(fr, 1 if fr.cx < 0 else -1),
        'smallDesk': lambda: small_desk(fr),
        'filingCabinet': lambda: filing_cabinets(fr),
        'box': lambda: crate(fr, braces=False, col='#b08a5a', dark='#a07e50'),
        'range': lambda: kitchen_range(fr),
        'greenCabinet': lambda: green_cabinet(fr),
        'counter': lambda: green_cabinet(fr, sink=True),
        'fridge': lambda: fridge(fr),
        'rack': lambda: wire_rack(fr),
        'plateShelf': lambda: wire_rack(fr, items='plates'),
        'island': lambda: island(fr),
        'prepTable': lambda: prep_table(fr),
        'shelf': lambda: shelving(fr, f.get('variant', 'boxes'), bays=f.get('bays', 1)),
        'cart': lambda: canvas_cart(fr),
        'crate': lambda: crate(fr),
        'crates': lambda: crate_stack(fr, f['layout']),
        'luggageCart': lambda: luggage_cart(fr),
        'platformCart': lambda: platform_cart(fr),
        'trolley': lambda: room_service_trolley(fr),
        'luggageTrolley': lambda: luggage_cart(fr),
        'umbrellaStand': lambda: umbrella_stand(fr),
        'stairs': lambda: stair_flight(fr),
        'binTrolley': lambda: trolley_bins(fr),
        'infirmaryBed': lambda: hospital_bed(Fr(f, f.get('facing')) if f.get('facing') else fr),
        'nightstand': lambda: nightstand(fr, lamp=f.get('lamp', True), plant=f.get('plant', True), towels=f.get('towels', False)),
        'medicineCabinet': lambda: glass_cabinet(fr),
        'stool': lambda: stool(fr),
        'trayCabinet': lambda: tray_cabinet(fr),
        'rail': lambda: coat_rail(fr, f.get('alcove', True)),
        'bed': lambda: bed(fr),
        'wardrobe': lambda: wardrobe(fr),
        'windowSeat': lambda: window_seat(Fr(f, f.get('facing', 'e'))),   # back to the window (dec_corner)
        'exitDoor': lambda: exit_door(fr),
        'linenShelf': lambda: shelving(fr, 'linens', frame=WOOD_D, board=WOOD_T, bays=2),
        'laundryBasket': lambda: laundry_basket(fr),
        'linenPress': lambda: linen_press(fr),
        'foldingTable': lambda: folding_table(fr),
        'planter': lambda: planter_box(fr),
        'chair': lambda: chair(Fr(f, f.get('facing')) if f.get('facing') else fr),
        'sideCabinet': lambda: side_cabinet(fr),
        'trayTrolley': lambda: wire_rack(fr),
        'towelCrate': lambda: towel_crate(fr),
        'crates2': lambda: crate_stack(fr, f['layout']),
        'canisters': lambda: (canister(*fr.at(-fr.W / 2 + 0.22, fr.D / 2), 0.66, 0.17), toolbox(*fr.at(fr.W / 2 - 0.28, fr.D / 2 + 0.05))),
        'towelChest': lambda: nightstand(fr, lamp=False, plant=False, towels=True),
    }
    if kind in B:
        B[kind]()
    else:
        print('WARNING: no builder for', kind, '- a plain box')
        fr.box(-fr.W / 2, fr.W / 2, 0.0, fr.D, 0.0, fr.H, WOOD, 0.02)

# ---- the rooms -------------------------------------------------------------------------------------
PANEL = K.style()
KITCHEN = K.style(kind='tiles', cell=K.CELL['walltiles'], threshold='#e4d8c4')
SERVICE = K.style(kind='plaster', cell=K.CELL['sage'], boards=K.CELL['boards'], wainH=0.92)
BACK = K.style(kind='plaster', cell=K.CELL['plaster'], boards=None, wainH=0.62, wainPanel=S('#5a3322'))
CLINIC = K.style(kind='plaster', cell=K.CELL['cream'], boards=None, wainH=0.92, wainPanel=S('#6a3e28'), threshold='#b8bc98')
LINEN = K.style(kind='plaster', cell=K.CELL['cream'], boards=K.CELL['boards'], wainH=0.92)

WARM_LIGHT = dict(sky=(0.9, 0.87, 0.82), sky_strength=0.45, key=500.0, key_color=(1.0, 0.96, 0.9))
COOL_LIGHT = dict(sky=(0.8, 0.78, 0.72), sky_strength=0.34, key=900.0, key_color=(1.0, 0.96, 0.9))
DARK_LIGHT = dict(sky=(0.86, 0.82, 0.78), sky_strength=0.2, key=220.0, key_color=(1.0, 0.95, 0.88))   # the dark rooms: lamps, little else

BURG, BURG_D, GOLD = shown('#743133', 0.86), shown('#5a2228', 0.86), shown('#b89050', 0.86)
DOORS = {'north': (-0.7, 0.7, -4.0, -3.4), 'south': (-0.7, 0.7, 3.4, 4.0), 'west': (-4.0, -3.4, -0.7, 0.7), 'east': (3.4, 4.0, -0.7, 0.7)}
OUTSIDE = {'north': (-0.7, 0.7, -4.4, -3.99), 'south': (-0.7, 0.7, 3.99, 4.4), 'west': (-4.4, -3.99, -0.7, 0.7), 'east': (3.99, 4.4, -0.7, 0.7)}
COVERED = set()          # doorway sides a rug runs through (no threshold stone there)

def runner(parts, w=1.4, doors=(), lines=((0.12, 0.045, None),), fill=BURG):
    """A runner (burgundy, gold line) made of straight parts [('x'|'z', from, to, centre)], running out
    through the given doorways."""
    rects = []
    for (ax, a, b, c) in parts:
        rects.append((a, b, c - w / 2, c + w / 2) if ax == 'x' else (c - w / 2, c + w / 2, a, b))
    virt = []
    for d in doors:
        x0, x1, z0, z1 = DOORS[d]
        if d in ('north', 'south'):
            rects.append((-w / 2, w / 2, z0, z1)); virt.append((-w / 2, w / 2) + OUTSIDE[d][2:])
        else:
            rects.append((x0, x1, -w / 2, w / 2)); virt.append(OUTSIDE[d][:2] + (-w / 2, w / 2))
        COVERED.add(d)
    return rug(rects, fill, lines, virt)

def door_mats(doors, w=1.2, depth=0.5):
    """Short strips of runner through each doorway (the references show one at every door)."""
    out = []
    for d in doors:
        if d in ('north', 'south'):
            z0, z1 = (-4.0, -4.0 + depth) if d == 'north' else (4.0 - depth, 4.0)
            out += rug([(-w / 2, w / 2, z0, z1)], BURG, ((0.1, 0.04, None),), [(-w / 2, w / 2) + OUTSIDE[d][2:]])
        else:
            x0, x1 = (-4.0, -4.0 + depth) if d == 'west' else (4.0 - depth, 4.0)
            out += rug([(x0, x1, -w / 2, w / 2)], BURG, ((0.1, 0.04, None),), [OUTSIDE[d][:2] + (-w / 2, w / 2)])
        COVERED.add(d)
    return out

def square_rug(x0, x1, z0, z1, fill=BURG, lines=((0.2, 0.05, None),)):
    return rug([(x0, x1, z0, z1)], fill, lines)

def border_band(inset=0.3, width=0.4, fill=BURG, lines=((0.06, 0.035, None), (0.33, 0.035, None)), notch=None, doors=()):
    """A band round the room parallel to the walls (the service rooms, the stairs, the infirmary), with
    a strip of it running out through each doorway."""
    a, b = -3.85 + inset, 3.85 - inset
    rects = [(a, b, a, a + width), (a, b, b - width, b), (a, a + width, a, b), (b - width, b, a, b)]
    if notch:
        rects = notch(rects)
    virt = []
    for d in doors:
        rects.append({'north': (-0.65, 0.65, -4.0, a + width), 'south': (-0.65, 0.65, b - width, 4.0),
                      'west': (-4.0, a + width, -0.65, 0.65), 'east': (b - width, 4.0, -0.65, 0.65)}[d])
        virt.append((-0.65, 0.65) + OUTSIDE[d][2:] if d in ('north', 'south') else OUTSIDE[d][:2] + (-0.65, 0.65))
        COVERED.add(d)
    return rug(rects, fill, lines, virt)

def paint(side, s, y=1.45, w=0.9, h=0.62, quad=0, cell=None, light=False):
    painting(seg_at(side, s), s, y, w, h, quad, cell if cell is not None else K.CELL['art'], light=light)

def sconce_at(side, s, y=1.55, **kw):
    sconce(seg_at(side, s), s, y, **kw)

def door_sconces(skip=(), off=0.42, y=1.55, **kw):
    """A sconce each side of every doorway, on the panel just past its pilasters."""
    for sg in SEGS:
        if not sg.door or sg.side in skip:
            continue
        dc = sg.door['center'][0] if sg.axis == 'x' else sg.door['center'][1]
        if sg.s1 > dc:
            continue
        hw = sg.door['width'] / 2
        for s_ in (dc - hw - PIL_W - off, dc + hw + PIL_W + off):
            sconce_at(sg.side, s_, y, **kw)

# -- per-room decoration (walls: paintings, sconces, windows, curtains, shelves) --
def dec_lounge():
    door_sconces()
    paint('west', -2.2, 1.55, 1.1, 0.72, 0, light=True)
    paint('east', -2.0, 1.6, 0.8, 0.55, 2)

def dec_ballroom():
    door_sconces()
    # curtains round the stage (north and west walls, behind the piano)
    drape('north', -3.5, -2.35, 0.34, 2.3, tie=1.1); drape('west', -3.5, -2.35, 0.34, 2.3, tie=1.1)
    drape('north', -2.35, -1.8, 0.34, 2.3, swag=False)
    window(seg_at('north', 2.4), 2.4, 1.45, 0.75, 1.15)
    window(seg_at('east', -2.4), -2.4, 1.45, 0.75, 1.15)
    paint('west', 2.3, 1.5, 0.66, 0.86, 1)
    paint('east', 2.4, 1.5, 0.66, 0.86, 3)
    sconce_at('north', 1.2); sconce_at('east', -1.2)

def dec_grand():
    door_sconces()
    paint('west', -2.3, 1.55, 1.0, 0.7, 1, light=True)
    paint('north', 2.2, 1.55, 1.0, 0.7, 2, light=True)

def dec_switchboard():
    door_sconces()
    wall_cubby('west', -2.9, 0.6, 0.5, 1.62, 'papers')
    wall_cubby('north', 3.0, 0.55, 0.55, 1.6, 'books')
    paint('west', -1.7, 1.75, 0.66, 0.46, 0)
    paint('north', 1.7, 1.75, 0.66, 0.46, 2)
    paint('south', -2.6, 1.55, 0.6, 0.42, 3)

def dec_dining():
    door_sconces()
    paint('north', 0.0, 1.6, 1.25, 0.8, 0, cell=K.CELL['pictures'])
    sconce_at('north', -1.35, 1.65); sconce_at('north', 1.35, 1.65)
    paint('west', 2.1, 1.5, 0.66, 0.9, 1)
    paint('east', 2.1, 1.5, 0.66, 0.9, 1, cell=K.CELL['pictures'])

def dec_library():
    door_sconces()
    sconce_at('north', -1.9, 1.7); sconce_at('north', 1.9, 1.7)
    paint('west', -1.9, 1.5, 0.66, 0.9, 1)
    paint('east', -2.2, 1.5, 0.66, 0.9, 3)

def dec_kitchen():
    door_sconces()
    range_hood('north', -2.35, 1.2)
    sg = seg_at('north', 0.6)
    wall_shelf(sg, -0.2, 2.2, 1.62, 0.26, WOOD_T, C['brass'])
    x0, x1, z0, z1 = sg.rect(0, 0, 0.13, 0.13)
    zc = z0
    for k, (s, kind) in enumerate(((0.0, 'plates'), (0.35, 'plates'), (0.8, 'pot'), (1.15, 'pot'), (1.5, 'pot'), (1.95, 'plant'))):
        if kind == 'plates':
            a_, u_, n_ = sg.axes()
            for j in range(3):
                disc(sg.up, sg.point(s + j * 0.03 - 0.03, 1.74, 0.03 + j * 0.02), a_, u_, n_, 0.12, 0.12, 0.0, 0.02, '#f2eee4', 16)
        elif kind == 'pot':
            cyl(sg.up, s, zc, 1.62, 1.74, 0.09, 0.09, '#b86a3a', segs=14)
        else:
            box(sg.up, s - 0.08, s + 0.08, 1.62, 1.74, zc - 0.08, zc + 0.08, '#8a5a34', 0.01)
            for q in range(7):
                leaf(sg.up, s, zc, 1.72, q * 2.4, 0.9, 0.24, 0.1, C['leaf2'])
    for s_ in (-0.9, 2.55):
        swan_lamp('north', s_)

def swan_lamp(side, s, y=1.85):
    """A brass swan-neck wall lamp with a glass shade (the kitchen)."""
    sg = seg_at(side, s)
    sg.put(s - 0.05, s + 0.05, y - 0.08, y + 0.08, 0.0, 0.02, C['brass'], 0.006, where=sg.up)
    p = sg.rect(s, s, 0.02, 0.02); q = sg.rect(s, s, 0.24, 0.24)
    rod(sg.up, (p[0], y, p[2]), (q[0], y + 0.1, q[2]), 0.015, C['brass'], 6)
    cyl(sg.up, q[0], q[2], y - 0.08, y + 0.08, 0.11, 0.05, '#fff0cc', segs=14, mat='glow')
    LIGHTS.append((q[0], y - 0.05, q[2], 40.0, 0.08, (1.0, 0.76, 0.48)))

def dec_service():
    door_sconces()
    strip_light(seg_at('north', 0.5), 0.5, 2.0)
    mop(-1.35, -3.62, (0.1, 0.12))

def dec_storage():
    for side, s in (('north', -1.9), ('north', 2.2), ('west', -1.4), ('west', 1.4), ('east', -1.4), ('east', 1.4)):
        lantern(seg_at(side, s), s, 1.7, 26.0)
    for s in (-1.3, 1.3):
        lantern(seg_at('south', s), s, 1.7, 18.0)

def dec_corridor_e():
    door_sconces()
    paint('north', 0.0, 1.62, 1.1, 0.64, 0)
    sconce_at('north', -1.25, 1.62); sconce_at('north', 1.25, 1.62)
    paint('west', -2.3, 1.55, 0.66, 0.9, 1)
    paint('east', -2.3, 1.55, 0.66, 0.9, 3)

def dec_corridor_w():
    door_sconces()
    oval_mirror(seg_at('north', 0.0), 0.0, 1.62, 0.36, 0.48)
    sconce_at('north', -1.3, 1.62); sconce_at('north', 1.3, 1.62)
    paint('west', -2.3, 1.55, 0.66, 0.9, 1)
    paint('east', 2.1, 1.55, 0.66, 0.9, 3)

def dec_corridor_n():
    door_sconces()
    paint('north', 2.0, 1.62, 1.0, 0.64, 0)
    paint('west', -1.4, 1.5, 0.66, 0.9, 1); sconce_at('west', -2.8); sconce_at('west', 0.6)
    paint('east', 0.6, 1.5, 0.66, 0.9, 3); sconce_at('east', -0.6); sconce_at('east', 1.9)

def dec_corridor_s():
    door_sconces()
    paint('west', -2.5, 1.6, 0.9, 0.6, 1)
    paint('north', 2.1, 1.62, 1.0, 0.64, 2)
    sconce_at('west', 0.3); sconce_at('east', -0.5); sconce_at('east', 1.9)

def dec_stairs():
    door_sconces(y=1.62)
    lantern(seg_at('west', -2.6), -2.6, 1.7, 30.0); lantern(seg_at('west', 0.3), 0.3, 1.7, 26.0)
    lantern(seg_at('east', 0.6), 0.6, 1.7, 26.0); lantern(seg_at('north', 2.4), 2.4, 1.95, 30.0)
    paint('west', -1.3, 1.6, 0.6, 0.8, 2)
    pipe_run('north', 0.95, 1.05, 2.2, drops=[(1.0, 0.1)])

def dec_back():
    door_sconces(y=1.6)
    sconce_at('north', 1.0, 1.6)
    pipe_run('north', 0.2, 3.7, 2.02, 0.07, 0.028, drops=[(2.6, 1.72), (3.5, 0.1)])
    pipe_run('north', 1.4, 3.7, 1.9, 0.14, 0.022, drops=[(2.8, 1.72)])
    fuse_box('north', 2.75, 1.45)

def dec_cloakroom():
    # A dead end since the locked-door rule: its one doorway (south) holds the locked door, drawn by the game; the east
    # wall, where a second doorway was, is panelled now, with a painting over the tufted bench.
    door_sconces(y=1.55)
    paint('north', 2.2, 1.62, 0.9, 0.6, 0)
    sconce_at('north', 1.2); sconce_at('north', 3.2)
    sconce_at('west', -2.55, 1.9); sconce_at('north', -2.6, 1.9)
    paint('east', 2.4, 1.5, 0.8, 0.56, 1)
    sconce_at('east', -2.4); sconce_at('east', 0.0)

def dec_corner():
    door_sconces()
    # the window over the window seat (its back is to the west wall; the seat's footprint is in hotel.js)
    seat = next(f for f in R['furniture'] if f['kind'] == 'windowSeat')['center'][1]
    window(seg_at('west', seat), seat, 1.5, 0.72, 1.1)
    paint('north', 1.4, 1.55, 1.0, 0.66, 0)
    sconce_at('north', -0.2); sconce_at('north', 3.0)

def dec_infirmary():
    door_sconces()
    sconce_at('west', -2.5); sconce_at('west', 1.2)
    paint('west', -1.3, 1.6, 0.8, 0.6, 0)
    paint('north', 3.05, 1.55, 0.45, 0.6, 2, cell=K.CELL['pictures'])
    if 'east' not in R['doors']:
        sconce_at('east', -0.5); sconce_at('east', 2.3)

def dec_linen(n):
    door_sconces()
    for s in (-1.0, 1.0):
        sconce_at('east' if n == 1 else 'west', s)
    sconce_at('north', 2.6 if n == 1 else -2.6)

def dec_suite():
    door_sconces()
    paint('north', 0.0, 1.72, 1.1, 0.6, 0, light=True)
    sconce_at('north', -1.45, 1.35, watts=30.0); sconce_at('north', 1.45, 1.35, watts=30.0)
    window(seg_at('west', -1.2), -1.2, 1.45, 0.8, 1.15)
    paint('east', 2.5, 1.5, 0.6, 0.8, 2)

def dec_housekeeping():
    door_sconces(y=1.6)
    lantern(seg_at('west', -1.2), -1.2, 1.75, 24.0)

def dec_exit():
    door_sconces()
    lantern(seg_at('west', 0.0), 0.0, 1.8, 26.0); lantern(seg_at('east', 0.0), 0.0, 1.8, 26.0)
    sign(seg_at('west', -2.6), -2.6, 1.5, 0.32, 0.32, 2)

# -- floors: the floor cell and the rugs (cut out of the floor) --
def rugs_lounge():
    return door_mats(['north', 'south', 'east', 'west']) + square_rug(-2.3, 2.3, -2.2, 2.3)
def rugs_ballroom():
    # burgundy carpet round the walls, the parquet dance floor inside a gold line
    a, b = -3.85, 3.85
    inner = (-2.75, 2.9, -2.55, 2.9)
    rects = [(a, b, a, inner[2]), (a, b, inner[3], b), (a, inner[0], inner[2], inner[3]), (inner[1], b, inner[2], inner[3])]
    for d in ('north', 'south', 'west', 'east'):
        x0, x1, z0, z1 = DOORS[d]
        rects.append((x0, x1, z0, z1) if d in ('north', 'south') else (x0, x1, z0, z1))
        COVERED.add(d)
    virt = [(-4.4, 4.4, -4.4, -3.84), (-4.4, 4.4, 3.84, 4.4), (-4.4, -3.84, -4.4, 4.4), (3.84, 4.4, -4.4, 4.4)]
    return rug(rects, BURG, ((0.1, 0.045, None),), virt)
def rugs_grand():
    out = runner([('x', -3.85, 3.85, 0.0), ('z', -3.85, 3.85, 0.0)], 1.45, ['north', 'south', 'east', 'west'])
    FL = target('floor')
    for (x0, x1, z0, z1) in ((-0.5, 0.5, -0.5, -0.455), (-0.5, 0.5, 0.455, 0.5), (-0.5, -0.455, -0.455, 0.455), (0.455, 0.5, -0.455, 0.455)):
        plane(FL, x0, x1, z0, z1, 0.0105, 'vc', None, GOLD)
    return out
def rugs_switchboard():
    return door_mats(['north', 'south', 'east', 'west']) + square_rug(-1.75, 1.75, -1.65, 1.85)
def rugs_dining():
    return door_mats(['south', 'east', 'west']) + square_rug(-3.75, -1.2, 1.2, 3.75) + square_rug(1.2, 3.75, 1.2, 3.75)
def rugs_library():
    return door_mats(['south', 'east', 'west']) + square_rug(-2.5, 2.5, -1.55, 2.6)
def rugs_kitchen():
    return door_mats(['south', 'east', 'west'])
def rugs_service():
    return border_band(0.12, 0.34, doors=('south', 'east', 'west'), lines=((0.05, 0.03, None),))
def rugs_storage():
    return door_mats(['south', 'east', 'west'])
def rugs_corridor_e():
    return runner([('x', -3.85, 3.85, 0.0), ('z', -3.3, 3.85, 0.0)], 1.45, ['south', 'east', 'west'])
def rugs_corridor_w():
    return runner([('x', -3.85, 3.85, -0.05), ('z', -0.05, 3.85, 0.0)], 1.9, ['south', 'east', 'west'])
def rugs_corridor_ns():
    return runner([('z', -3.85, 3.85, 0.0)], 1.35, ['north', 'south'])
def rugs_stairs():
    def notch(rects):
        # the band steps in round the stair flight (north-east)
        a, b = -3.55, 3.55
        w = 0.42
        out = [(a, 0.95, a, a + w), (a, b, b - w, b), (a, a + w, a, b), (b - w, b, -2.0 + 0.0, b),
               (0.95 - w, 0.95, a, -2.0 + w), (0.95 - w, b, -2.0, -2.0 + w)]
        return out
    return border_band(0.3, 0.42, notch=notch, doors=('north', 'south'), lines=((0.06, 0.035, None), (0.32, 0.035, None)))
def rugs_infirmary():
    def ring(rects):
        return rects
    doors = [d for d in ('north', 'south', 'east') if d in R['doors']]
    return border_band(0.22, 0.5, fill=S('#5a6e4e'), lines=((0.08, 0.035, '#e0d6b8'), (0.4, 0.035, '#e0d6b8')), doors=doors)
def rugs_cloakroom():
    return door_mats(['south']) + square_rug(-2.2, 2.2, -1.8, 1.9) + square_rug(2.75, 3.8, 1.5, 3.3, lines=((0.12, 0.04, None),))
def rugs_back():
    return door_mats(['south', 'east'])
def rugs_corner():
    return runner([('z', -0.7, 3.85, 0.0), ('x', -0.7, 3.85, 0.0)], 1.4, ['south', 'east'])
def rugs_dead():
    return door_mats(['south'])
def rugs_suite():
    return door_mats(['south']) + square_rug(-1.9, 1.9, -1.2, 1.9)

ROOMS = {
    'lounge': dict(fx={}, style=PANEL, floor=K.CELL['stone'], rugs=rugs_lounge, light=WARM_LIGHT, decor=dec_lounge),
    'ballroom': dict(style=PANEL, floor=K.CELL['parquet'], rugs=rugs_ballroom, light=WARM_LIGHT, decor=dec_ballroom,
                     pil={'north': [-0.9, 0.9, -2.2], 'west': [-0.9, 0.9]}),
    'grandCorridor': dict(style=PANEL, floor=K.CELL['stone'], rugs=rugs_grand, light=WARM_LIGHT, decor=dec_grand),
    'switchboard': dict(style=PANEL, floor=K.CELL['stone'], rugs=rugs_switchboard, light=WARM_LIGHT, decor=dec_switchboard),
    'dining': dict(style=PANEL, floor=K.CELL['stone'], rugs=rugs_dining, light=WARM_LIGHT, decor=dec_dining, pil={'north': []}),
    'library': dict(fx={'armchair': {'facing': 's'}}, style=PANEL, floor=K.CELL['planks'], rugs=rugs_library, light=WARM_LIGHT, decor=dec_library, pil={'north': [-1.68, 1.68]}),
    'kitchen': dict(style=KITCHEN, floor=K.CELL['checker'], rugs=rugs_kitchen, light=WARM_LIGHT, decor=dec_kitchen, pil={'north': [-1.55, 2.33]}),
    'serviceCorridor': dict(fx={'shelf': {'variant': 'towels'}}, style=SERVICE, floor=K.CELL['stone'], rugs=rugs_service, light=DARK_LIGHT, decor=dec_service, pil={'north': []}),
    'storage': dict(fx={'shelf': {'variant': 'storage', 'bays': 3},
                             'crates': {'layout': [(-0.33, 0.55, 0.72, 0.72, 0.0), (0.36, 0.45, 0.64, 0.62, 0.0), ('cloth', 0.36, 0.45, 0.5, 0.4, 0.62, '#e0d4b8')]},
                             'crates2': {'layout': [(-0.35, 0.47, 0.8, 0.75, 0.0), (0.4, 0.45, 0.62, 0.6, 0.0), (-0.35, 0.47, 0.64, 0.6, 0.75)]}}, style=PANEL, floor=K.CELL['stone'], rugs=rugs_storage, light=DARK_LIGHT, decor=dec_storage, pil={'north': []}),
    'corridorE': dict(style=PANEL, floor=K.CELL['stone'], rugs=rugs_corridor_e, light=WARM_LIGHT, decor=dec_corridor_e, pil={'north': [-2.0, 2.0]}),
    'corridorW': dict(fx={'console': {'items': ('lamp', 'bowl', 'flowers')}}, style=PANEL, floor=K.CELL['stone'], rugs=rugs_corridor_w, light=WARM_LIGHT, decor=dec_corridor_w, pil={'north': [-2.0, 2.0]}),
    'corridorN': dict(style=PANEL, floor=K.CELL['stone'], rugs=rugs_corridor_ns, light=WARM_LIGHT, decor=dec_corridor_n),
    'corridorS': dict(style=PANEL, floor=K.CELL['stone'], rugs=rugs_corridor_ns, light=WARM_LIGHT, decor=dec_corridor_s),
    'stairs': dict(style=PANEL, floor=K.CELL['stone'], rugs=rugs_stairs, light=DARK_LIGHT, decor=dec_stairs),
    'backCorridor': dict(fx={'crates': {'layout': [(-0.3, 0.6, 0.95, 0.85, 0.0), (-0.3, 0.6, 0.78, 0.7, 0.85), (0.5, 0.55, 0.55, 0.55, 0.0)]},
                                  'crates2': {'layout': [(-0.3, 0.55, 1.0, 0.72, 0.0), (0.55, 0.5, 0.55, 0.5, 0.0), (-0.3, 0.55, 0.62, 0.5, 0.72)]}}, style=BACK, floor=K.CELL['slate'], rugs=rugs_back, light=DARK_LIGHT, decor=dec_back, pil={'north': [0.9], 'west': []}),
    'cloakroom': dict(style=PANEL, floor=K.CELL['stone'], rugs=rugs_cloakroom, light=WARM_LIGHT, decor=dec_cloakroom, pil={'north': [0.1, 1.0], 'west': [-2.1, 0.9]}),
    'cornerCorridor': dict(fx={'console': {'items': ('lamp', 'books')}}, style=PANEL, floor=K.CELL['stone'], rugs=rugs_corner, light=WARM_LIGHT, decor=dec_corner),
    'infirmary1': dict(fx={'infirmaryBed': {'facing': 's'}}, style=CLINIC, floor=K.CELL['clinic'], rugs=rugs_infirmary, light=WARM_LIGHT, decor=dec_infirmary),
    'infirmary2': dict(fx={'infirmaryBed': {'facing': 's'}}, style=CLINIC, floor=K.CELL['clinic'], rugs=rugs_infirmary, light=WARM_LIGHT, decor=dec_infirmary),
    'linenStore1': dict(style=LINEN, floor=K.CELL['stone'], rugs=rugs_dead, light=WARM_LIGHT, decor=lambda: dec_linen(1)),
    'linenStore2': dict(style=LINEN, floor=K.CELL['stone'], rugs=rugs_dead, light=WARM_LIGHT, decor=lambda: dec_linen(2)),
    'suite416': dict(fx={'nightstand': {'plant': False}}, style=PANEL, floor=K.CELL['planks'], rugs=rugs_suite, light=WARM_LIGHT, decor=dec_suite),
    'housekeeping': dict(fx={'shelf': {'variant': 'linens'}}, style=SERVICE, floor=K.CELL['stone'], rugs=lambda: border_band(0.12, 0.34, doors=('south',), lines=((0.05, 0.03, None),)), light=DARK_LIGHT, decor=dec_housekeeping, pil={'north': []}),
    'exit': dict(style=SERVICE, floor=K.CELL['stone'], rugs=rugs_dead, light=COOL_LIGHT, decor=dec_exit, pil={'north': [-1.4, 1.4]}),
}

# ---- build -----------------------------------------------------------------------------------------
spec = ROOMS[ROOM]
st = spec['style']
WALLS = Walls(SEGS, R, st, spec.get('pil'))
cuts = spec['rugs']()
for sg in SEGS:
    wall_run(sg, WALLS, st)
for sg in SEGS:
    if sg.door:
        door_frame(sg, st, covered=sg.side in COVERED, spill=True)
build_floor(R, spec['floor'], cuts, repeat=2.0)
for f in R['furniture']:
    build_furniture(f, ROOM)
spec['decor']()

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
materials = [make_material(n, os.path.join(BUILD, 'albedo.png')) for n in MATS]
objs = build_objects(scene, materials)
print('room', ROOM, 'objects', len(objs), 'faces', sum(len(o.data.polygons) for o in objs.values()), 'lights', len(LIGHTS))
lightmap_uvs(objs, R)

if not NOBAKE:
    setup_lighting(scene, **spec['light'])
    scene.cycles.samples = SAMPLES
    rb = scene.render.bake
    rb.use_pass_direct = True; rb.use_pass_indirect = True; rb.use_pass_color = False
    rb.margin = 3; rb.margin_type = 'EXTEND'
    light = {'atlas': bpy.data.images.new('light_atlas', SIZE, SIZE, float_buffer=True),
             'floor': bpy.data.images.new('light_floor', FLOOR_SIZE, FLOOR_SIZE, float_buffer=True)}
    ao = {'atlas': bpy.data.images.new('ao_atlas', SIZE, SIZE, float_buffer=True),
          'floor': bpy.data.images.new('ao_floor', FLOOR_SIZE, FLOOR_SIZE, float_buffer=True)}
    t0 = time.time()
    bake_pass(objs, materials, 'DIFFUSE', light, True)
    print('bake light: %.1fs' % (time.time() - t0))
    scene.cycles.samples = max(24, SAMPLES // 2)
    bake_pass(objs, materials, 'AO', ao, True)
    print('bake ao: %.1fs' % (time.time() - t0))
    save_lightmap(light['atlas'], ao['atlas'], SIZE, os.path.join(OUT, ROOM + '-light.jpg'), BUILD)
    save_lightmap(light['floor'], ao['floor'], FLOOR_SIZE, os.path.join(OUT, ROOM + '-floor.jpg'), BUILD)

# the cut caps join the static part (their light-map islands come along)
if 'caps' in objs:
    bpy.ops.object.select_all(action='DESELECT')
    objs['caps'].select_set(True); objs['static'].select_set(True)
    bpy.context.view_layer.objects.active = objs['static']
    bpy.ops.object.join()
    del objs['caps']

# no images in the file: the game loads the shared albedo atlas and the light maps itself
for m in materials:
    for n in list(m.node_tree.nodes):
        if n.type == 'TEX_IMAGE':
            m.node_tree.nodes.remove(n)

bpy.ops.object.select_all(action='DESELECT')
for o in objs.values():
    o.select_set(True)
path = os.path.join(OUT, ROOM + '.glb')
bpy.ops.export_scene.gltf(
    filepath=path, export_format='GLB', use_selection=True,
    export_texcoords=True, export_normals=False, export_vertex_color='MATERIAL',
    export_lights=False, export_cameras=False, export_apply=False, export_yup=True)
print('exported', path, os.path.getsize(path), 'bytes')
