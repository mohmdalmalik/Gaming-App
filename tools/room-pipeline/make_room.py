# Build ONE room tile as a baked, stylised model in the lobby's style (see README.md).
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
import bpy, json, math, os, sys, random, time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from roomkit import *            # noqa: E402,F401,F403
import roomkit as K              # noqa: E402

REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(REPO, 'assets', 'models', 'rooms')
BUILD = os.path.join(HERE, 'build')
os.makedirs(OUT, exist_ok=True); os.makedirs(BUILD, exist_ok=True)

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else sys.argv[1:]
def arg(k, d):
    return type(d)(argv[argv.index(k) + 1]) if k in argv else d
ROOM = arg('--room', 'lounge')
SAMPLES = arg('--samples', 48)
SIZE = arg('--size', 1024)
FLOOR_SIZE = arg('--floorsize', 1024)
NOBAKE = '--nobake' in argv

J = json.load(open(os.path.join(HERE, 'rooms.json')))
T_W = J['wallThickness']
R = J['rooms'][ROOM]
ST = target('static')
rng = random.Random(hash(ROOM) & 0xffff)

# ---- walls of this room --------------------------------------------------------------------------
SEGS = [Seg(w, R, set(R['doors']), T_W) for w in R['walls']]
BY_SIDE = {}
for s in SEGS:
    BY_SIDE.setdefault(s.side, []).append(s)
for sg in SEGS:
    for d in R['doorways']:
        dc = d['center'][0] if sg.axis == 'x' else d['center'][1]
        other = d['center'][1] if sg.axis == 'x' else d['center'][0]
        if d['axis'] == sg.axis and abs(other - (sg.outer + sg.face) / 2) < 0.2:
            if abs(sg.s0 - (dc + d['width'] / 2)) < 1e-3 or abs(sg.s1 - (dc - d['width'] / 2)) < 1e-3:
                sg.door = d
                sg.gaps.append((dc - d['width'] / 2 - CASING_W, dc + d['width'] / 2 + CASING_W))

def seg_at(side, s):
    return next(o for o in BY_SIDE[side] if o.s0 - 1e-6 <= s <= o.s1 + 1e-6)

def free_wall(side):
    """True if this side has no doorway (decor can go anywhere along it)."""
    return side not in R['doors']

# ---- a local frame for a piece of furniture ------------------------------------------------------
INNER = 3.85
FDIR = {'n': (0, -1), 's': (0, 1), 'e': (1, 0), 'w': (-1, 0)}

class Fr:
    """A furniture footprint seen from the piece itself: u across (centred), w from its back (0) to
    its front (D), y up. `facing` is where its front looks; by default away from the wall it backs
    onto (the wall parallel to its longer side)."""
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

    def at(self, u, w):
        return (self.back[0] + self.F[0] * w + self.Rv[0] * u, self.back[1] + self.F[1] * w + self.Rv[1] * u)

    def box(self, u0, u1, w0, w1, y0, y1, color, bevel=0.012, t=None, **kw):
        a, b = self.at(u0, w0), self.at(u1, w1)
        box(t or ST, min(a[0], b[0]), max(a[0], b[0]), y0, y1, min(a[1], b[1]), max(a[1], b[1]), color, bevel, **kw)

    def cyl(self, u, w, y0, y1, r0, r1=None, color='#ffffff', segs=20, bevel=0.0, mat='vc', t=None):
        x, z = self.at(u, w)
        cyl(t or ST, x, z, y0, y1, r0, r1, color, segs, bevel, mat)

    def rod(self, a, b, r, color, segs=8):
        (u0, w0, y0), (u1, w1, y1) = a, b
        p, q = self.at(u0, w0), self.at(u1, w1)
        rod(ST, (p[0], y0, p[1]), (q[0], y1, q[1]), r, color, segs)

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

# ---- furniture library ---------------------------------------------------------------------------
def lamp_on(x, z, y, h=0.6, shade_r=0.15, watts=70.0):
    cyl(ST, x, z, y, y + 0.03, 0.09, color=C['brass'], segs=20, bevel=0.01)
    cyl(ST, x, z, y + 0.03, y + h * 0.42, 0.07, 0.05, color=C['brass'], segs=20)
    cyl(ST, x, z, y + h * 0.42, y + h * 0.62, 0.015, color=C['brassDark'], segs=10)
    cyl(ST, x, z, y + h * 0.58, y + h, shade_r, shade_r * 0.7, C['shade'], segs=20, mat='glow')
    LIGHTS.append((x, y + h * 0.5, z, watts, 0.1, (1.0, 0.72, 0.44)))
    LIGHTS.append((x, y + h + 0.08, z, watts * 0.17, 0.1, (1.0, 0.76, 0.5)))

def floor_lamp(x, z, watts=60.0):
    cyl(ST, x, z, 0.0, 0.03, 0.16, color=C['brass'], segs=20, bevel=0.01)
    cyl(ST, x, z, 0.03, 1.38, 0.018, color=C['brass'], segs=10)
    cyl(ST, x, z, 1.3, 1.62, 0.2, 0.13, C['shade'], segs=20, mat='glow')
    LIGHTS.append((x, 1.36, z, watts, 0.1, (1.0, 0.72, 0.44)))
    LIGHTS.append((x, 1.72, z, watts * 0.2, 0.1, (1.0, 0.76, 0.5)))

def candle(x, z, y):
    cyl(ST, x, z, y, y + 0.03, 0.05, color=C['brass'], segs=12)
    cyl(ST, x, z, y + 0.03, y + 0.16, 0.014, color=C['cream'], segs=8)
    sphere(ST, x, y + 0.18, z, 0.016, '#ffd680', mat='glow', segs=6)
    LIGHTS.append((x, y + 0.24, z, 6.0, 0.03, (1.0, 0.7, 0.4)))

def vase(x, z, y, col='#2f5a50', flowers=True):
    cyl(ST, x, z, y, y + 0.2, 0.06, 0.045, col, segs=14)
    if flowers:
        for k, fc in enumerate(('#c03040', '#e8d070', '#f0e8e0', '#c03040', '#d06080')):
            a = k * 2.4
            sphere(ST, x + 0.05 * math.cos(a), y + 0.27 + 0.03 * (k % 2), z + 0.05 * math.sin(a), 0.035, fc, segs=8)

def books_pile(x, z, y, n=2):
    for i in range(n):
        c = rng.choice(['#2f4a5c', '#7e2632', '#3d5a36', '#7a5a2a'])
        box(ST, x - 0.13 + i * 0.01, x + 0.13, y + i * 0.03, y + (i + 1) * 0.03, z - 0.09, z + 0.09, c, 0.006)

def plant_at(x, z, scale=1.0, seed=3, planter=True):
    r = random.Random(seed)
    s = scale
    if planter:
        box(ST, x - 0.24 * s, x + 0.24 * s, 0.0, 0.5 * s, z - 0.24 * s, z + 0.24 * s, C['planter'], 0.03)
        box(ST, x - 0.255 * s, x + 0.255 * s, 0.44 * s, 0.52 * s, z - 0.255 * s, z + 0.255 * s, C['brass'], 0.012)
        box(ST, x - 0.25 * s, x + 0.25 * s, 0.0, 0.05, z - 0.25 * s, z + 0.25 * s, C['brass'], 0.01)
        box(ST, x - 0.2 * s, x + 0.2 * s, 0.5 * s, 0.53 * s, z - 0.2 * s, z + 0.2 * s, C['soil'], 0.0)
    base = 0.52 * s if planter else 0.0
    for i in range(13):
        yaw = i * (2 * math.pi / 13) * 2.618 + r.uniform(-0.2, 0.2)
        tier = i % 3
        pitch = (0.35, 0.75, 1.1)[tier] + r.uniform(-0.1, 0.1)
        length = ((0.62, 0.58, 0.48)[tier] + r.uniform(-0.05, 0.05)) * s
        leaf(ST, x, z, base + tier * 0.12 * s, yaw, pitch, length, 0.2 * s, (C['leaf1'], C['leaf2'], C['leaf3'])[i % 3])
    cyl(ST, x, z, base - 0.02, base + 0.43 * s, 0.025, color=C['leaf3'], segs=6)

def sofa(fr, seats=None, cols=('velvet', 'velvetDeep', 'velvetHi')):
    W, D, hs = fr.W, fr.D, fr.H / 0.9
    main, deep, hi = (C[c] for c in cols)
    seats = seats or (1 if W < 1.1 else 2 if W < 1.7 else 3)
    arm = 0.2 if W > 0.8 else 0.16
    for u in (-W / 2 + 0.08, W / 2 - 0.08):
        for w in (0.1, D - 0.08):
            fr.box(u - 0.04, u + 0.04, w - 0.04, w + 0.04, 0.0, 0.1, C['walnutDark'], 0.01)
    fr.box(-W / 2, W / 2, 0.0, D, 0.08, 0.36 * hs, deep, 0.05)
    fr.box(-W / 2 + 0.02, W / 2 - 0.02, 0.0, 0.28, 0.3, 0.92 * hs, main, 0.08)
    for s in (-1, 1):
        a = s * W / 2
        fr.box(min(a, a - s * arm), max(a, a - s * arm), 0.0, D, 0.3, 0.68 * hs, main, 0.08)
    inner = W - 2 * arm
    cw = inner / seats
    for i in range(seats):
        u0 = -W / 2 + arm + i * cw + 0.01
        fr.box(u0, u0 + cw - 0.02, 0.26, D - 0.02, 0.34, 0.5 * hs, hi, 0.07)
        fr.box(u0 + 0.02, u0 + cw - 0.04, 0.2, 0.42, 0.46, 0.84 * hs, hi, 0.08)

def round_table(fr, cloth=None, items='vase'):
    r = min(fr.W, fr.D) / 2 - 0.03
    H = fr.H
    cu, cw = 0.0, fr.D / 2
    if cloth:
        fr.cyl(cu, cw, 0.03, H - 0.02, r + 0.02, r + 0.06, cloth, segs=32)
        fr.cyl(cu, cw, H - 0.03, H, r + 0.03, r + 0.03, cloth, segs=32, bevel=0.01)
        fr.cyl(cu, cw, 0.0, 0.03, r + 0.06, r + 0.06, C['walnutDark'], segs=32)
    else:
        fr.cyl(cu, cw, H - 0.07, H, r, r, C['walnutTop'], segs=36, bevel=0.02)
        fr.cyl(cu, cw, H - 0.13, H - 0.07, r - 0.05, r - 0.05, C['walnut'], segs=36, bevel=0.01)
        for a in range(4):
            ang = math.pi / 4 + a * math.pi / 2
            fr.box(cu + (r - 0.16) * math.cos(ang) - 0.035, cu + (r - 0.16) * math.cos(ang) + 0.035,
                   cw + (r - 0.16) * math.sin(ang) - 0.035, cw + (r - 0.16) * math.sin(ang) + 0.035,
                   0.0, H - 0.1, C['walnutDark'], 0.012)
    x, z = fr.at(cu, cw)
    if items == 'vase':
        vase(x + 0.08, z - 0.05, H)
        books_pile(x - 0.12, z + 0.12, H, 2)
    elif items == 'dinner':
        candle(x, z, H)
        for a in range(4):
            ang = a * math.pi / 2 + 0.3
            px, pz = x + (r - 0.16) * math.cos(ang), z + (r - 0.16) * math.sin(ang)
            cyl(ST, px, pz, H, H + 0.015, 0.1, 0.1, C['white'], segs=16)
            cyl(ST, px, pz, H + 0.015, H + 0.02, 0.07, 0.07, '#f4f2ec', segs=16)
    elif items == 'lamp':
        lamp_on(x, z, H, 0.55, 0.14)
    elif items == 'candles':
        candle(x - 0.08, z, H); candle(x + 0.1, z + 0.06, H)
        vase(x, z - 0.14, H, '#e8e2d0')

def chair(fr, seat=C['velvet']):
    W, D = min(fr.W, 0.56), min(fr.D, 0.56)
    for u in (-W / 2 + 0.05, W / 2 - 0.05):
        for w in (0.05, D - 0.05):
            fr.box(u - 0.025, u + 0.025, w - 0.025, w + 0.025, 0.0, 0.44, C['walnutDark'], 0.008)
    fr.box(-W / 2, W / 2, 0.0, D, 0.42, 0.47, C['walnut'], 0.015)
    fr.box(-W / 2 + 0.03, W / 2 - 0.03, 0.06, D - 0.02, 0.47, 0.53, seat, 0.03)
    for u in (-W / 2 + 0.05, W / 2 - 0.05):
        fr.box(u - 0.025, u + 0.025, 0.02, 0.07, 0.44, 0.98, C['walnutDark'], 0.008)
    fr.box(-W / 2 + 0.05, W / 2 - 0.05, 0.02, 0.06, 0.62, 0.94, C['walnut'], 0.015)
    fr.box(-W / 2 + 0.09, W / 2 - 0.09, 0.05, 0.08, 0.66, 0.9, seat, 0.02)

def bench(fr, top=C['velvet']):
    W, D = fr.W, fr.D
    for u in (-W / 2 + 0.06, W / 2 - 0.06):
        for w in (0.06, D - 0.06):
            fr.box(u - 0.03, u + 0.03, w - 0.03, w + 0.03, 0.0, 0.32, C['walnutDark'], 0.008)
    fr.box(-W / 2, W / 2, 0.0, D, 0.3, 0.36, C['walnut'], 0.012)
    fr.box(-W / 2 + 0.02, W / 2 - 0.02, 0.02, D - 0.02, 0.36, 0.46, top, 0.04)

def cabinet(fr, body=C['walnut'], top=C['walnutTop'], pulls=C['brass'], rows=3, cols=None, H=None, feet=C['walnutDark']):
    """A chest of drawers / sideboard / console body across the footprint."""
    W, D = fr.W, fr.D
    H = H or fr.H - 0.05
    for u in (-W / 2 + 0.06, W / 2 - 0.06):
        for w in (0.06, D - 0.06):
            fr.box(u - 0.04, u + 0.04, w - 0.04, w + 0.04, 0.0, 0.12, feet, 0.01)
    fr.box(-W / 2 + 0.01, W / 2 - 0.01, 0.0, D - 0.02, 0.1, H, body, 0.02)
    fr.box(-W / 2 - 0.02, W / 2 + 0.02, -0.0, D + 0.01, H, H + 0.05, top, 0.015)
    cols = cols or max(1, round(W / 0.6))
    cw = (W - 0.06) / cols
    rh = (H - 0.16) / rows
    for r_ in range(rows):
        y0 = 0.15 + r_ * rh
        for c_ in range(cols):
            u0 = -W / 2 + 0.03 + c_ * cw
            fr.box(u0 + 0.01, u0 + cw - 0.01, D - 0.03, D + 0.0, y0 + 0.01, y0 + rh - 0.01, top, 0.008)
            um = u0 + cw / 2
            fr.box(um - 0.06, um + 0.06, D, D + 0.022, y0 + rh / 2 - 0.013, y0 + rh / 2 + 0.013, pulls, 0.006)
    return H + 0.05

def console(fr, lamps=1, extras=True):
    top = cabinet(fr, rows=2 if fr.H < 0.85 else 3)
    W = fr.W
    spots = [0.0] if lamps == 1 else [-W / 2 + 0.3, W / 2 - 0.3] if lamps == 2 else []
    for u in spots:
        x, z = fr.at(u + (0.2 if lamps == 1 else 0), fr.D / 2)
        lamp_on(x, z, top, 0.62, 0.16)
    if extras:
        x, z = fr.at(-W / 4 if lamps == 1 else 0.0, fr.D / 2)
        vase(x, z, top)

def bookcase(fr, body=C['walnut']):
    W, D, H = fr.W, fr.D, fr.H
    fr.box(-W / 2, -W / 2 + 0.04, 0.0, D, 0.0, H, body, 0.01)
    fr.box(W / 2 - 0.04, W / 2, 0.0, D, 0.0, H, body, 0.01)
    fr.box(-W / 2, W / 2, 0.0, 0.03, 0.0, H, C['walnutDark'], 0.005)
    fr.box(-W / 2 - 0.02, W / 2 + 0.02, 0.0, D + 0.03, H - 0.06, H, C['walnutTop'], 0.012)
    fr.box(-W / 2 - 0.02, W / 2 + 0.02, D - 0.01, D + 0.035, H - 0.1, H - 0.085, C['brass'], 0.003)
    fr.box(-W / 2, W / 2, 0.0, D, 0.0, 0.1, C['walnutDark'], 0.01)
    shelves = []
    y = 0.1
    while y + 0.34 < H - 0.06:
        shelves.append(y)
        y += 0.36
    for y0 in shelves:
        fr.box(-W / 2 + 0.04, W / 2 - 0.04, 0.03, D, y0, y0 + 0.025, C['walnutTop'], 0.004)
        fr.front_tex(-W / 2 + 0.06, W / 2 - 0.06, 0.05, D - 0.05, y0 + 0.025, y0 + 0.31, K.CELL['books'], 0.6)
    fr.box(-W / 2 + 0.04, W / 2 - 0.04, 0.03, D, H - 0.09, H - 0.06, C['walnutTop'], 0.004)

def kitchen_counter(fr):
    W, D, H = fr.W, fr.D, fr.H
    fr.box(-W / 2, W / 2, 0.0, D - 0.04, 0.0, 0.1, C['black'], 0.005)
    fr.box(-W / 2, W / 2, 0.0, D - 0.02, 0.1, H - 0.05, '#dcd4c0', 0.012)
    n = max(1, round(W / 0.5)); cw = W / n
    for i in range(n):
        u0 = -W / 2 + i * cw
        fr.box(u0 + 0.02, u0 + cw - 0.02, D - 0.03, D, 0.16, H - 0.25, '#e8e2d2', 0.01)
        fr.box(u0 + 0.02, u0 + cw - 0.02, D - 0.03, D, H - 0.22, H - 0.08, '#e8e2d2', 0.01)
        fr.box(u0 + cw / 2 - 0.05, u0 + cw / 2 + 0.05, D, D + 0.02, H - 0.17, H - 0.14, C['steel'], 0.005)
    fr.box(-W / 2 - 0.01, W / 2 + 0.01, 0.0, D + 0.02, H - 0.05, H, '#2a2a2c', 0.01)
    # pots, a kettle, a board and bowls on top
    x, z = fr.at(-W / 2 + 0.35, D / 2)
    cyl(ST, x, z, H, H + 0.2, 0.14, 0.14, C['steel'], segs=18, bevel=0.01)
    cyl(ST, x, z, H + 0.2, H + 0.22, 0.15, 0.15, C['steelDark'], segs=18)
    if W > 1.4:
        x, z = fr.at(0.2, D / 2)
        box(ST, x - 0.22, x + 0.22, H, H + 0.03, z - 0.14, z + 0.14, C['oak'], 0.01)
        cyl(ST, x + 0.05, z, H + 0.03, H + 0.1, 0.06, 0.04, '#d8b060', segs=10)
        x, z = fr.at(W / 2 - 0.35, D / 2)
        cyl(ST, x, z, H, H + 0.16, 0.09, 0.07, '#b83a2a', segs=14)
        cyl(ST, x, z, H + 0.16, H + 0.19, 0.03, 0.03, C['black'], segs=8)
        x, z = fr.at(-0.5, D / 2)
        cyl(ST, x, z, H, H + 0.08, 0.13, 0.1, C['white'], segs=16)

def shelving(fr, variant='boxes', metal=True):
    W, D, H = fr.W, fr.D, fr.H
    post = C['steelDark'] if metal else C['oakDark']
    for u in (-W / 2 + 0.03, W / 2 - 0.03):
        for w in (0.03, D - 0.03):
            fr.box(u - 0.025, u + 0.025, w - 0.025, w + 0.025, 0.0, H, post, 0.005)
    levels = [0.1, 0.5, 0.9, 1.3, H - 0.04]
    for y in levels:
        fr.box(-W / 2, W / 2, 0.0, D, y, y + 0.03, C['steel'] if metal else C['oak'], 0.004)
    rr = random.Random(int(fr.cx * 100 + fr.cz * 7))
    for y in levels[:-1]:
        u = -W / 2 + 0.07
        while u < W / 2 - 0.12:
            if variant == 'linens':
                w_ = rr.uniform(0.28, 0.36)
                col = rr.choice([C['linen'], C['linen2'], C['linenBlue'], C['white']])
                n = rr.randint(3, 6)
                for k in range(n):
                    fr.box(u, u + w_, 0.08, D - 0.06, y + 0.03 + k * 0.05, y + 0.03 + (k + 1) * 0.05 - 0.004, col, 0.012)
                u += w_ + 0.05
            elif variant == 'kitchen':
                if rr.random() < 0.5:
                    r_ = rr.uniform(0.05, 0.08); h_ = rr.uniform(0.14, 0.26)
                    fr.cyl(u + r_, D / 2, y + 0.03, y + 0.03 + h_, r_, r_, rr.choice(['#c8b890', '#b0c8b0', '#d8c8a0', C['steel']]), segs=12)
                    fr.cyl(u + r_, D / 2, y + 0.03 + h_, y + 0.05 + h_, r_ * 0.8, r_ * 0.8, C['steelDark'], segs=12)
                    u += 2 * r_ + 0.04
                else:
                    w_ = rr.uniform(0.18, 0.3)
                    fr.box(u, u + w_, 0.08, D - 0.06, y + 0.03, y + 0.03 + rr.uniform(0.1, 0.28), rr.choice(['#8a6a42', '#a88a58', '#c8c0a8']), 0.01)
                    u += w_ + 0.04
            else:   # boxes, tins, a folded tarpaulin
                w_ = rr.uniform(0.22, 0.42); h_ = rr.uniform(0.14, 0.33)
                col = rr.choice([C['crate'], '#9a8058', '#b8a070', '#7a6a50', '#5a6a58'])
                fr.box(u, u + w_, 0.06, D - 0.06, y + 0.03, y + 0.03 + h_, col, 0.012)
                fr.box(u + 0.02, u + w_ - 0.02, D - 0.061, D - 0.058, y + 0.03 + h_ * 0.55, y + 0.03 + h_ * 0.7, '#e8dcc0', 0.002)
                u += w_ + 0.04

def crate(fr, lid=True):
    W, D, H = fr.W, fr.D, fr.H
    s = min(W, D) - 0.04
    fr.box(-s / 2, s / 2, (fr.D - s) / 2, (fr.D + s) / 2, 0.0, H - 0.02, C['crateDark'], 0.01)
    for y0 in (0.04, H / 2 - 0.05, H - 0.14):
        fr.box(-s / 2 - 0.012, s / 2 + 0.012, (fr.D - s) / 2 - 0.012, (fr.D + s) / 2 + 0.012, y0, y0 + 0.1, C['crate'], 0.008)
    for u in (-s / 2, s / 2):
        for w in ((fr.D - s) / 2, (fr.D + s) / 2):
            fr.box(u - 0.035, u + 0.035, w - 0.035, w + 0.035, 0.0, H - 0.01, C['crate'], 0.006)
    if lid:
        fr.box(-s / 2 - 0.02, s / 2 + 0.02, (fr.D - s) / 2 - 0.02, (fr.D + s) / 2 + 0.02, H - 0.03, H, '#9a7a4e', 0.01)
    if H > 0.75:
        s2 = s * 0.55
        fr.box(-s2 / 2 + 0.05, s2 / 2 + 0.05, fr.D / 2 - s2 / 2, fr.D / 2 + s2 / 2, H, H + 0.3, '#b8a070', 0.012)

def laundry_cart(fr):
    W, D, H = fr.W, fr.D, fr.H
    for u in (-W / 2 + 0.06, W / 2 - 0.06):
        for w in (0.08, D - 0.08):
            fr.cyl(u, w, 0.0, 0.08, 0.05, 0.05, C['black'], segs=12)
            fr.box(u - 0.015, u + 0.015, w - 0.015, w + 0.015, 0.08, H, C['steel'], 0.004)
    fr.box(-W / 2 + 0.04, W / 2 - 0.04, 0.04, D - 0.04, 0.2, H - 0.05, '#d8ccb0', 0.03)
    fr.box(-W / 2 + 0.02, W / 2 - 0.02, 0.02, D - 0.02, H - 0.06, H - 0.02, C['steel'], 0.008)
    rr = random.Random(5)
    for k in range(5):
        u = rr.uniform(-W / 2 + 0.2, W / 2 - 0.2); w = rr.uniform(0.2, D - 0.2)
        x, z = fr.at(u, w)
        sphere(ST, x, H - 0.02, z, rr.uniform(0.12, 0.18), rr.choice([C['linen'], C['white'], C['linenBlue']]), segs=10)

def service_trolley(fr):
    W, D, H = fr.W, fr.D, fr.H
    for u in (-W / 2 + 0.05, W / 2 - 0.05):
        for w in (0.06, D - 0.06):
            fr.cyl(u, w, 0.0, 0.07, 0.035, 0.035, C['black'], segs=10)
            fr.box(u - 0.012, u + 0.012, w - 0.012, w + 0.012, 0.07, H - 0.12, C['brass'], 0.003)
    for y in (0.25, H - 0.16):
        fr.box(-W / 2 + 0.02, W / 2 - 0.02, 0.02, D - 0.02, y, y + 0.025, C['brassDark'], 0.006)
    fr.box(-W / 2, W / 2, 0.0, D, H - 0.16, H - 0.13, C['white'], 0.01)
    fr.box(-W / 2 - 0.01, W / 2 + 0.01, -0.01, D + 0.01, H - 0.3, H - 0.14, C['white'], 0.005, drop=('up',))
    x, z = fr.at(0.0, D * 0.35)
    cyl(ST, x, z, H - 0.13, H - 0.11, 0.16, 0.16, C['steel'], segs=20)
    sphere(ST, x, H - 0.11, z, 0.14, '#c8ccd2', segs=16)
    sphere(ST, x, H + 0.04, z, 0.02, C['steel'], segs=6)
    x, z = fr.at(0.12, D * 0.75)
    cyl(ST, x, z, H - 0.13, H + 0.02, 0.06, 0.05, C['white'], segs=12)
    x, z = fr.at(-0.15, D * 0.72)
    cyl(ST, x, z, H - 0.13, H - 0.05, 0.035, 0.04, C['white'], segs=10)
    # a slice of the tray's contents on the lower shelf
    fr.box(-W / 2 + 0.08, W / 2 - 0.08, 0.1, D - 0.1, 0.275, 0.33, C['linen'], 0.02)

def luggage_trolley(fr):
    W, D, H = fr.W, fr.D, fr.H
    fr.box(-W / 2, W / 2, 0.0, D, 0.1, 0.16, C['brassDark'], 0.01)
    fr.box(-W / 2 + 0.03, W / 2 - 0.03, 0.03, D - 0.03, 0.16, 0.18, C['velvetDeep'], 0.01)
    for u in (-W / 2 + 0.08, W / 2 - 0.08):
        for w in (0.1, D - 0.1):
            fr.cyl(u, w, 0.0, 0.1, 0.05, 0.05, C['black'], segs=12)
    for w in (0.04, D - 0.04):
        fr.rod((-W / 2 + 0.04, w, 0.16), (-W / 2 + 0.04, w, 1.55), 0.022, C['brass'])
        fr.rod((W / 2 - 0.04, w, 0.16), (W / 2 - 0.04, w, 1.55), 0.022, C['brass'])
    fr.rod((-W / 2 + 0.04, 0.04, 1.55), (-W / 2 + 0.04, D - 0.04, 1.55), 0.022, C['brass'])
    fr.rod((W / 2 - 0.04, 0.04, 1.55), (W / 2 - 0.04, D - 0.04, 1.55), 0.022, C['brass'])
    fr.rod((-W / 2 + 0.04, D / 2, 1.55), (W / 2 - 0.04, D / 2, 1.55), 0.022, C['brass'])
    y = 0.18
    for (w0, w1, h, col) in ((0.08, D - 0.1, 0.24, '#6a3a22'), (0.12, D - 0.2, 0.2, '#2f3a4a'), (0.2, D - 0.3, 0.18, '#8a5a30')):
        fr.box(-W / 2 + 0.1, W / 2 - 0.1, w0, w1, y, y + h, col, 0.03)
        fr.box(-0.1, 0.1, (w0 + w1) / 2 - 0.02, (w0 + w1) / 2 + 0.02, y + h, y + h + 0.04, C['brass'], 0.005)
        y += h
    x, z = fr.at(0.0, D * 0.5)
    cyl(ST, x, z, y, y + 0.14, 0.14, 0.12, '#3a2a22', segs=16)   # a hatbox

def stairs(fr):
    """A stair flight rising along the wall to a landing door (the service stairs)."""
    W, D = fr.W, fr.D
    n = 8
    run = (W - 0.6) / n
    width = D - 0.25
    for i in range(n):
        u0 = -W / 2 + i * run
        y1 = 0.17 * (i + 1)
        fr.box(u0, W / 2 - 0.6 + 0.001 if i == n - 1 else u0 + run + 0.001, 0.0, width, 0.0, y1, '#7a7468', 0.008)
        fr.box(u0 - 0.004, u0 + 0.035, 0.0, width + 0.01, y1 - 0.02, y1 + 0.004, '#5a554c', 0.004)
    fr.box(W / 2 - 0.6, W / 2, 0.0, width, 0.0, 0.17 * n, '#6e685c', 0.008)                       # landing
    for i in range(n + 2):
        u = -W / 2 + 0.1 + i * (W - 0.2) / (n + 1)
        y = min(0.17 * n, 0.17 * max(1, (u + W / 2) / run))
        fr.rod((u, width + 0.06, y), (u, width + 0.06, y + 0.85), 0.012, C['iron'], 6)
    fr.rod((-W / 2 + 0.05, width + 0.06, 0.17 + 0.85), (W / 2 - 0.6, width + 0.06, 0.17 * n + 0.85), 0.03, C['walnut'])
    fr.rod((W / 2 - 0.6, width + 0.06, 0.17 * n + 0.85), (W / 2 - 0.02, width + 0.06, 0.17 * n + 0.85), 0.03, C['walnut'])
    fr.box(-W / 2 - 0.02, W / 2, width - 0.02, width + 0.03, 0.0, 0.12, '#5a554c', 0.004)

def bed(fr, blanket=C['velvet'], frame=C['walnut'], sheet=C['linen']):
    W, D = fr.W, fr.D
    fr.box(-W / 2, W / 2, 0.0, 0.08, 0.0, 1.2, frame, 0.02)                            # headboard
    fr.box(-W / 2 + 0.1, W / 2 - 0.1, 0.08, 0.1, 0.55, 1.08, C['walnutTop'], 0.02)
    fr.box(-W / 2 - 0.02, W / 2 + 0.02, 0.0, 0.1, 1.18, 1.24, C['walnutDark'], 0.015)
    fr.box(-W / 2, W / 2, 0.08, D, 0.12, 0.34, frame, 0.02)                          # frame
    fr.box(-W / 2 + 0.03, W / 2 - 0.03, 0.1, D - 0.03, 0.34, 0.54, sheet, 0.05)       # mattress
    fr.box(-W / 2 + 0.01, W / 2 - 0.01, 0.62, D, 0.36, 0.6, blanket, 0.05)             # blanket
    fr.box(-W / 2 + 0.02, W / 2 - 0.02, 0.56, 0.72, 0.52, 0.63, sheet, 0.04)           # turned-down sheet
    fr.box(-W / 2 + 0.005, W / 2 - 0.005, 0.95, D - 0.1, 0.59, 0.605, C['gold'], 0.004)
    n = 2 if W > 1.3 else 1
    pw = (W - 0.3) / n
    for i in range(n):
        u0 = -W / 2 + 0.15 + i * pw
        fr.box(u0 + 0.03, u0 + pw - 0.03, 0.12, 0.48, 0.54, 0.72, C['cream'], 0.07)
    fr.box(-W / 2, W / 2, D - 0.06, D, 0.0, 0.62, frame, 0.02)                       # footboard
    for u in (-W / 2 + 0.05, W / 2 - 0.05):
        fr.box(u - 0.04, u + 0.04, D - 0.07, D + 0.01, 0.0, 0.7, C['walnutDark'], 0.015)

def wardrobe(fr, body=C['walnut'], doors=2):
    W, D, H = fr.W, fr.D, fr.H
    for u in (-W / 2 + 0.06, W / 2 - 0.06):
        for w in (0.06, D - 0.06):
            fr.box(u - 0.04, u + 0.04, w - 0.04, w + 0.04, 0.0, 0.1, C['walnutDark'], 0.01)
    fr.box(-W / 2 + 0.01, W / 2 - 0.01, 0.0, D - 0.02, 0.08, H - 0.1, body, 0.02)
    fr.box(-W / 2 - 0.03, W / 2 + 0.03, -0.0, D + 0.03, H - 0.1, H, C['walnutDark'], 0.02)
    fr.box(-W / 2 - 0.015, W / 2 + 0.015, D - 0.01, D + 0.02, H - 0.14, H - 0.12, C['brass'], 0.004)
    dw = (W - 0.08) / doors
    for i in range(doors):
        u0 = -W / 2 + 0.04 + i * dw
        fr.box(u0 + 0.01, u0 + dw - 0.01, D - 0.03, D, 0.14, H - 0.16, C['walnutTop'], 0.012)
        fr.box(u0 + 0.07, u0 + dw - 0.07, D - 0.005, D + 0.01, 0.24, H * 0.46, body, 0.012)
        fr.box(u0 + 0.07, u0 + dw - 0.07, D - 0.005, D + 0.01, H * 0.5, H - 0.26, body, 0.012)
        um = u0 + (dw - 0.06 if i == 0 else 0.06)
        fr.box(um - 0.012, um + 0.012, D, D + 0.03, H * 0.44, H * 0.56, C['brass'], 0.006)

def coat_rail(fr):
    W, D = fr.W, fr.D
    top = 1.62
    for u in (-W / 2 + 0.06, W / 2 - 0.06):
        fr.box(u - 0.2, u + 0.2, D / 2 - 0.2, D / 2 + 0.2, 0.0, 0.04, C['brassDark'], 0.01)
        fr.rod((u, D / 2, 0.04), (u, D / 2, top), 0.022, C['brass'])
    fr.rod((-W / 2 + 0.06, D / 2, top), (W / 2 - 0.06, D / 2, top), 0.02, C['brass'])
    fr.box(-W / 2 + 0.02, W / 2 - 0.02, 0.05, D - 0.05, top + 0.12, top + 0.15, C['walnutTop'], 0.006)
    rr = random.Random(int(fr.cx * 10 + fr.cz))
    u = -W / 2 + 0.2
    while u < W / 2 - 0.2:
        col = rr.choice(['#23283a', '#3a3a3e', '#8a6a44', '#5a1c24', '#2e3a2e', '#4a3a2a'])
        th = rr.uniform(0.09, 0.14)
        fr.box(u, u + th, D / 2 - 0.2, D / 2 + 0.2, rr.uniform(0.55, 0.75), top - 0.04, col, 0.04)
        fr.box(u + th / 2 - 0.01, u + th / 2 + 0.01, D / 2 - 0.02, D / 2 + 0.02, top - 0.06, top + 0.02, C['steel'], 0.003)
        u += th + rr.uniform(0.02, 0.06)
    for k in range(3):                                   # hats on the shelf
        uu = -W / 2 + 0.4 + k * (W - 0.8) / 2
        x, z = fr.at(uu, D / 2)
        cyl(ST, x, z, top + 0.15, top + 0.17, 0.15, 0.15, rr.choice(['#2a2a2e', '#5a4632', '#6a2a2a']), segs=18)
        cyl(ST, x, z, top + 0.17, top + 0.28, 0.09, 0.085, rr.choice(['#2a2a2e', '#5a4632', '#6a2a2a']), segs=18)

def window_seat(fr):
    W, D = fr.W, fr.D
    fr.box(-W / 2, W / 2, 0.0, 0.62, 0.0, 0.42, C['walnut'], 0.02)
    fr.box(-W / 2 + 0.02, W / 2 - 0.02, 0.02, 0.6, 0.42, 0.52, C['green'], 0.05)
    fr.box(-W / 2 + 0.06, -W / 2 + 0.45, 0.04, 0.2, 0.5, 0.82, C['greenHi'], 0.07)
    fr.box(W / 2 - 0.45, W / 2 - 0.06, 0.04, 0.2, 0.5, 0.82, C['velvetHi'], 0.07)
    x, z = fr.at(0.0, 0.95)
    plant_at(x, z, 0.62, seed=9)

def exit_door(fr):
    W, D, H = fr.W, fr.D, fr.H
    fr.box(-W / 2, W / 2, 0.0, D, 0.0, 0.03, '#3a3a3a', 0.005)
    fr.box(-W / 2 - 0.1, -W / 2, 0.0, D, 0.0, 2.0, '#39443c', 0.01)
    fr.box(W / 2, W / 2 + 0.1, 0.0, D, 0.0, 2.0, '#39443c', 0.01)
    fr.box(-W / 2 - 0.1, W / 2 + 0.1, 0.0, D, 1.9, 2.0, '#39443c', 0.01)
    for s in (-1, 1):
        a0, a1 = (-W / 2 + 0.01, -0.005) if s < 0 else (0.005, W / 2 - 0.01)
        fr.box(a0, a1, 0.0, D - 0.06, 0.02, 1.89, '#4c5e50', 0.012)
        fr.box(a0 + 0.08, a1 - 0.08, D - 0.07, D - 0.05, 1.1, 1.75, '#56685a', 0.01)
        fr.box(a0 + 0.12, a1 - 0.12, D - 0.07, D - 0.04, 1.35, 1.68, '#9fb8b0', 0.004)   # a wired glass pane
    fr.box(-W / 2 + 0.1, W / 2 - 0.1, D - 0.05, D + 0.02, 1.0, 1.06, C['steel'], 0.01)  # push bar
    for u in (-W / 2 + 0.12, W / 2 - 0.12):
        fr.box(u - 0.03, u + 0.03, D - 0.05, D + 0.02, 0.96, 1.1, C['steelDark'], 0.006)
    fr.box(-0.02, 0.02, D - 0.06, D - 0.05, 0.02, 1.89, '#28302a', 0.002)
    fr.front_tex(-0.34, 0.34, 0.0, D + 0.02, 2.02, 2.26, K.CELL['signs'], 0.68, color='#0e4a2a', quad=1)   # EXIT
    x, z = fr.at(0.0, D + 0.25)
    LIGHTS.append((x, 2.1, z, 30.0, 0.05, (0.35, 1.0, 0.55)))

def switchboard(fr):
    W, D = fr.W, fr.D
    fr.box(-W / 2, W / 2, 0.0, D, 0.0, 0.72, C['walnut'], 0.02)                       # desk
    fr.box(-W / 2 - 0.02, W / 2 + 0.02, 0.0, D + 0.02, 0.72, 0.76, C['walnutTop'], 0.015)
    for u in (-W / 4, W / 4):
        fr.box(u - 0.25, u + 0.25, D - 0.01, D + 0.005, 0.12, 0.62, C['walnutTop'], 0.012)
    fr.box(-W / 2, W / 2, 0.0, 0.26, 0.76, 1.62, C['walnut'], 0.02)                  # the upright
    fr.front_tex(-W / 2 + 0.06, W / 2 - 0.06, 0.26, 0.27, 0.86, 1.52, K.CELL['signs'], W, quad=0)
    fr.box(-W / 2 - 0.02, W / 2 + 0.02, 0.0, 0.3, 1.62, 1.68, C['walnutDark'], 0.015)
    fr.box(-W / 2 + 0.02, W / 2 - 0.02, 0.26, 0.29, 1.56, 1.6, C['brass'], 0.004)
    rr = random.Random(3)
    for k in range(9):                                                                # cords
        u0 = rr.uniform(-W / 2 + 0.12, W / 2 - 0.12)
        y0 = rr.uniform(0.95, 1.45)
        u1 = u0 + rr.uniform(-0.25, 0.25)
        col = rr.choice(['#3a2418', '#1a1a1a', '#6a2a2a'])
        fr.rod((u0, 0.28, y0), ((u0 + u1) / 2, 0.42, 0.86), 0.007, col, 5)
        fr.rod(((u0 + u1) / 2, 0.42, 0.86), (u1, 0.34, 0.77), 0.007, col, 5)
    for u in (-W / 2 + 0.15, W / 2 - 0.15):                                           # keys and lamps
        fr.box(u - 0.1, u + 0.1, 0.34, 0.5, 0.76, 0.8, C['black'], 0.006)
    x, z = fr.at(W / 2 - 0.2, D - 0.25)
    cyl(ST, x, z, 0.76, 0.8, 0.08, 0.08, C['black'], segs=14)                           # a headset
    sphere(ST, x, 0.84, z, 0.05, C['black'], segs=10)

def filing_cabinet(fr):
    top = cabinet(fr, body='#4a5a48', top='#3c4a3a', pulls=C['brass'], rows=4, cols=1, feet='#2a3228')
    x, z = fr.at(0.0, fr.D / 2)
    lamp_on(x + 0.05, z, top, 0.5, 0.13, 55.0)

def infirmary_bed(fr):
    W, D = fr.W, fr.D
    white = '#e8e8e2'
    for w in (0.04, D - 0.04):
        for u in (-W / 2 + 0.04, W / 2 - 0.04):
            fr.rod((u, w, 0.0), (u, w, 0.95 if w < 0.1 else 0.72), 0.02, white, 8)
        top = 0.95 if w < 0.1 else 0.72
        fr.rod((-W / 2 + 0.04, w, top), (W / 2 - 0.04, w, top), 0.02, white, 8)
        for k in range(5):
            u = -W / 2 + 0.12 + k * (W - 0.24) / 4
            fr.rod((u, w, 0.35), (u, w, top), 0.009, white, 6)
    fr.box(-W / 2 + 0.03, W / 2 - 0.03, 0.04, D - 0.04, 0.3, 0.36, '#c8ccc8', 0.01)
    fr.box(-W / 2 + 0.05, W / 2 - 0.05, 0.06, D - 0.06, 0.36, 0.52, C['white'], 0.05)
    fr.box(-W / 2 + 0.04, W / 2 - 0.04, 0.6, D - 0.05, 0.4, 0.57, '#b8ccd8', 0.05)
    fr.box(-W / 2 + 0.05, W / 2 - 0.05, 0.56, 0.7, 0.53, 0.6, C['white'], 0.04)
    fr.box(-W / 2 + 0.15, W / 2 - 0.15, 0.1, 0.46, 0.52, 0.66, C['white'], 0.07)

def medicine_cabinet(fr):
    W, D, H = fr.W, fr.D, fr.H
    white = '#ecebe4'
    fr.box(-W / 2, W / 2, 0.0, D, 0.0, 0.1, '#bcbcb4', 0.01)
    fr.box(-W / 2, W / 2, 0.0, D - 0.02, 0.1, H - 0.05, white, 0.02)
    fr.box(-W / 2 - 0.02, W / 2 + 0.02, 0.0, D + 0.01, H - 0.05, H, '#d8d6ce', 0.015)
    for u0, u1 in ((-W / 2 + 0.04, -0.01), (0.01, W / 2 - 0.04)):
        fr.box(u0, u1, D - 0.03, D, 0.16, 0.8, '#e2e0d8', 0.01)
        fr.box(u0, u1, D - 0.03, D - 0.005, 0.9, H - 0.12, '#a8bcc2', 0.004)           # glass
    fr.box(-W / 2 + 0.04, W / 2 - 0.04, 0.05, D - 0.05, 1.28, 1.3, '#c8ccc8', 0.003)
    rr = random.Random(8)
    for y in (0.9, 1.3):
        u = -W / 2 + 0.1
        while u < W / 2 - 0.1:
            r_ = rr.uniform(0.03, 0.045)
            fr.cyl(u + r_, D / 2, y + 0.02, y + 0.02 + rr.uniform(0.12, 0.2), r_, r_,
                   rr.choice(['#6a3a22', '#2f5a3a', '#e8e2d0', '#3a4a6a']), segs=8)
            u += 2 * r_ + 0.03
    fr.front_tex(-0.18, 0.18, D - 0.01, D + 0.005, H - 0.44, H - 0.08, K.CELL['signs'], 0.36, color=white, quad=2)
    for u in (-0.06, 0.06):
        fr.box(u - 0.01, u + 0.01, D, D + 0.02, 0.45, 0.6, C['steel'], 0.004)

def stool(fr, top=C['walnutTop']):
    x, z = fr.cx, fr.cz
    cyl(ST, x, z, 0.52, 0.58, 0.19, 0.19, top, segs=20, bevel=0.015)
    for a in range(3):
        ang = a * 2 * math.pi / 3
        rod(ST, (x + 0.13 * math.cos(ang), 0.53, z + 0.13 * math.sin(ang)), (x + 0.2 * math.cos(ang), 0.0, z + 0.2 * math.sin(ang)), 0.017, C['walnutDark'])
    cyl(ST, x, z, 0.2, 0.22, 0.17, 0.17, C['walnutDark'], segs=16)

def laundry_basket(fr):
    x, z = fr.cx, fr.cz
    r = min(fr.W, fr.D) / 2 - 0.05
    cyl(ST, x, z, 0.0, 0.48, r * 0.88, r, C['wicker'], segs=20, bevel=0.02)
    cyl(ST, x, z, 0.46, 0.5, r + 0.02, r + 0.02, '#8a6436', segs=20)
    for k in range(4):
        cyl(ST, x, z, 0.08 + k * 0.1, 0.1 + k * 0.1, r * (0.9 + 0.025 * k) + 0.005, r * (0.9 + 0.025 * k) + 0.005, '#8a6436', segs=20)
    for k in range(3):
        sphere(ST, x + 0.08 * math.cos(k * 2.1), 0.5, z + 0.08 * math.sin(k * 2.1), r * 0.55, rng.choice([C['linen'], C['white'], C['linenBlue']]), segs=10)

def folding_table(fr):
    W, D, H = fr.W, fr.D, fr.H
    for u in (-W / 2 + 0.05, W / 2 - 0.05):
        for w in (0.05, D - 0.05):
            fr.box(u - 0.02, u + 0.02, w - 0.02, w + 0.02, 0.0, H - 0.04, C['oakDark'], 0.006)
    fr.box(-W / 2, W / 2, 0.0, D, H - 0.04, H, C['oak'], 0.01)
    for k, (u, w) in enumerate(((-0.18, 0.28), (0.18, 0.28), (0.0, D - 0.3))):
        n = 4 + k
        col = [C['white'], C['linenBlue'], C['linen2']][k]
        for j in range(n):
            fr.box(u - 0.15, u + 0.15, w - 0.12, w + 0.12, H + j * 0.045, H + (j + 1) * 0.045 - 0.004, col, 0.012)
    x, z = fr.at(0.25, D - 0.25)
    box(ST, x - 0.08, x + 0.08, H, H + 0.08, z - 0.12, z + 0.12, C['steelDark'], 0.02)   # an iron
    box(ST, x - 0.03, x + 0.03, H + 0.08, H + 0.14, z - 0.08, z + 0.06, C['black'], 0.01)

def linen_press(fr):
    wardrobe(fr, body='#b8a07a', doors=2)
    top = fr.H
    for k in range(3):
        fr.box(-fr.W / 2 + 0.15 + k * 0.7, -fr.W / 2 + 0.75 + k * 0.7, 0.1, fr.D - 0.1, top, top + 0.1,
               [C['linen'], C['linenBlue'], C['linen2']][k], 0.02)

def bandstand(fr):
    W, D = fr.W, fr.D
    fr.box(-W / 2, W / 2, 0.0, D, 0.0, 0.24, C['walnut'], 0.02)
    fr.box(-W / 2 - 0.01, W / 2 + 0.01, -0.0, D + 0.01, 0.2, 0.24, C['brass'], 0.006)
    fr.box(-W / 2 + 0.02, W / 2 - 0.02, 0.02, D - 0.02, 0.24, 0.25, C['velvetDeep'], 0.004)
    # an upright piano against the back, a stool, and a music stand
    fr.box(-0.6, 0.6, 0.05, 0.55, 0.25, 1.45, C['black'], 0.03)
    fr.box(-0.6, 0.6, 0.55, 0.78, 0.9, 1.0, C['black'], 0.02)
    fr.box(-0.56, 0.56, 0.55, 0.72, 1.0, 1.02, '#f2eee4', 0.004)
    for k in range(20):
        u = -0.53 + k * 0.056
        if k % 7 not in (2, 6):
            fr.box(u + 0.018, u + 0.042, 0.55, 0.64, 1.02, 1.045, C['black'], 0.002)
    fr.box(-0.62, 0.62, 0.03, 0.57, 1.45, 1.49, C['black'], 0.02)
    x, z = fr.at(0.3, 0.3)
    candle(x, z, 1.49)
    fr.box(-0.25, 0.25, 0.95, 1.2, 0.25, 0.72, C['black'], 0.03)
    fr.box(-0.27, 0.27, 0.93, 1.22, 0.72, 0.78, C['velvet'], 0.03)
    x, z = fr.at(-0.5, 1.05)
    rod(ST, (x, 0.25, z), (x, 1.2, z), 0.012, C['brass'])
    box(ST, x - 0.18, x + 0.18, 1.18, 1.4, z - 0.02, z + 0.02, C['brassDark'], 0.004)

def planter_box(fr):
    W, D = fr.W, fr.D
    fr.box(-W / 2, W / 2, 0.0, D, 0.0, 0.55, C['planter'], 0.03)
    fr.box(-W / 2 - 0.015, W / 2 + 0.015, -0.015, D + 0.015, 0.5, 0.58, C['brass'], 0.012)
    fr.box(-W / 2 + 0.05, W / 2 - 0.05, 0.05, D - 0.05, 0.55, 0.57, C['soil'], 0.0)
    for k, (u, w) in enumerate(((-W / 4, D / 3), (W / 4, 2 * D / 3), (0.0, D / 2))):
        x, z = fr.at(u, w)
        rr = random.Random(30 + k)
        for i in range(11):
            yaw = i * (2 * math.pi / 11) * 2.618 + rr.uniform(-0.2, 0.2)
            leaf(ST, x, z, 0.56 + (i % 3) * 0.08, yaw, (0.4, 0.8, 1.1)[i % 3], 0.45, 0.17, (C['leaf1'], C['leaf2'], C['leaf3'])[i % 3])

def build_furniture(f, room):
    kind = f['kind']
    fr = Fr(f)
    if kind == 'sofa':
        sofa(fr)
    elif kind == 'armchair':
        sofa(fr, 1, ('green', 'greenDeep', 'greenHi') if room in ('library', 'gardenLounge') else ('velvet', 'velvetDeep', 'velvetHi'))
    elif kind == 'table':
        round_table(fr, cloth=C['white'] if room in ('ballroom', 'dining') else None,
                    items={'ballroom': 'candles', 'dining': 'dinner', 'lounge': 'lamp'}.get(room, 'vase'))
    elif kind == 'plant':
        plant_at(fr.cx, fr.cz, f['size'][1] / 1.3, seed=int(abs(fr.cx * 3 + fr.cz * 7)))
    elif kind == 'bench':
        bench(fr, C['velvet'] if room != 'cloakroom' else C['green'])
    elif kind == 'chair':
        chair(Fr(f, {'switchboard': 'n', 'dining': 's', 'suite416': 'e'}.get(room)), C['green'] if room == 'switchboard' else C['velvet'])
    elif kind in ('console', 'sideboard'):
        console(fr, lamps=2 if kind == 'sideboard' else 1)
    elif kind == 'bookcase':
        bookcase(fr)
    elif kind == 'counter':
        kitchen_counter(fr)
    elif kind == 'shelf':
        shelving(fr, 'kitchen' if room == 'kitchen' else 'linens' if room == 'housekeeping' else 'boxes', metal=room != 'kitchen')
    elif kind == 'cart':
        laundry_cart(fr)
    elif kind == 'crate':
        crate(fr)
    elif kind == 'trolley':
        (luggage_trolley if room == 'corridorS' else service_trolley)(fr)
    elif kind == 'stairs':
        stairs(fr)
    elif kind == 'bed':
        bed(fr)
    elif kind == 'wardrobe':
        wardrobe(fr)
    elif kind == 'rail':
        coat_rail(fr)
    elif kind == 'windowSeat':
        window_seat(Fr(f, 's'))
    elif kind == 'exitDoor':
        exit_door(fr)
    elif kind == 'switchboard':
        switchboard(fr)
    elif kind == 'filingCabinet':
        filing_cabinet(fr)
    elif kind == 'infirmaryBed':
        infirmary_bed(fr)
    elif kind == 'medicineCabinet':
        medicine_cabinet(fr)
    elif kind == 'stool':
        stool(fr)
    elif kind == 'linenShelf':
        shelving(fr, 'linens', metal=False)
    elif kind == 'laundryBasket':
        laundry_basket(fr)
    elif kind == 'linenPress':
        linen_press(fr)
    elif kind == 'foldingTable':
        folding_table(fr)
    elif kind == 'bandstand':
        bandstand(fr)
    elif kind == 'planter':
        planter_box(fr)
    else:
        print('WARNING: no builder for', kind, '- a plain box')
        fr.box(-fr.W / 2, fr.W / 2, 0.0, fr.D, 0.0, fr.H, C['walnut'], 0.02)

# ---- the rooms -------------------------------------------------------------------------------------
CREAM = dict(kind='cream', wall='#d6c6a0', upper='#d6c6a0', panel='#e2d4b0', field='#cfbd96', rail='#b89c6c',
             cap=C['cap'], skirting='#6a4c30', trim=C['gold'], casing='#b89c6c', casingField='#e0d0ac')
DAMASK = dict(kind='wallpaper', cell=K.CELL['damask'], wall=C['wall'], panel=C['panel'], rail=C['rail'], cap=C['cap'])
STRIPES = dict(kind='wallpaper', cell=K.CELL['stripes'], wall=C['wall'], panel=C['panel'], rail=C['rail'], cap=C['cap'])
KITCHEN = dict(kind='tiles', wall='#e2dccb', upper='#e2dccb', rail='#9a8a70', cap=C['cap'], skirting='#3a3a38',
               band='#2f5a52', cornice='#d8d2c0', casing='#7a6a58', casingField='#8a7a66')
CLINIC = dict(kind='tiles', wall='#dfe8e2', upper='#dfe8e2', rail='#8a9a90', cap=C['cap'], skirting='#5a6a62',
              band='#3a7a6a', cornice='#e8eee8', casing='#9aa8a0', casingField='#b8c4bc')
def PLASTER(wall, lower, pipes=False):
    return dict(kind='plaster', wall=wall, upper=wall, lower=lower, rail='#3a3a34', cap=C['cap'], skirting='#2a2a26',
                pipes=pipes, casing='#4a4a42', casingField='#55554c')
LINEN_WALL = dict(kind='plaster', wall='#d8cba8', upper='#d8cba8', lower='#8a7250', rail='#5a4630', cap=C['cap'],
                  skirting='#3a2a1c', casing=C['rail'], casingField=C['walnut'])

WARM_LIGHT = dict(sky=(0.72, 0.66, 0.58), sky_strength=0.22, key=1100.0)
COOL_LIGHT = dict(sky=(0.78, 0.8, 0.8), sky_strength=0.24, key=1000.0, key_color=(0.95, 0.97, 1.0))
DARK_LIGHT = dict(sky=(0.42, 0.48, 0.58), sky_strength=0.045, key=140.0, key_color=(0.75, 0.82, 1.0))

def runner_x(z=0.0, x0=-3.7, x1=3.7, w=1.1):
    return (x0, x1, z - w / 2, z + w / 2, K.CELL['runner'])
def runner_z(x=0.0, z0=-3.7, z1=3.7, w=1.1):
    return (x - w / 2, x + w / 2, z0, z1, K.CELL['runner'])

def paint(side, s, y=1.45, w=0.9, h=0.62, quad=0):
    painting(seg_at(side, s), s, y, w, h, quad)

def door_sconces(skip=()):
    for sg in SEGS:
        if not sg.door or sg.s1 > (sg.door['center'][0] if sg.axis == 'x' else sg.door['center'][1]):
            continue
        dc = sg.door['center'][0] if sg.axis == 'x' else sg.door['center'][1]
        hw = sg.door['width'] / 2
        if sg.side in skip:
            continue
        for s_ in (dc - hw - CASING_W - 0.28, dc + hw + CASING_W + 0.28):
            sconce(seg_at(sg.side, s_), s_, 1.62)

def bulbs(spots):
    for side, s_ in spots:
        caged_bulb(seg_at(side, s_), s_)

def wall_bookshelf(side, s0, s1, H=2.0, depth=0.28):
    """A shallow built-in bookshelf along a wall (inside the 0.3 m band the guests never reach)."""
    sg = seg_at(side, (s0 + s1) / 2)
    x0, x1, z0, z1 = sg.rect(s0, s1, 0.0, depth)
    facing = {'north': 's', 'south': 'n', 'west': 'e', 'east': 'w'}[side]
    f = {'center': [(x0 + x1) / 2, (z0 + z1) / 2], 'size': [x1 - x0, H, z1 - z0]}
    bookcase(Fr(f, facing))

def dec_lounge():
    door_sconces()
    paint('north', 2.4, 1.5, 1.0, 0.66, 0); paint('south', -2.4, 1.5, 1.0, 0.66, 1)
    paint('east', -2.4, 1.5, 0.66, 0.86, 2); paint('west', 2.4, 1.5, 0.66, 0.86, 3)
    floor_lamp(-3.6, -2.2)
    plant_at(3.62, 2.2, 0.55, seed=4)

def dec_ballroom():
    door_sconces()
    for side in ('north', 'south', 'east', 'west'):
        for s_ in (-2.4, 2.4):
            mirror(seg_at(side, s_), s_, 1.45, 0.62, 0.95)
            sconce(seg_at(side, s_ + (0.62 if s_ > 0 else -0.62)), s_ + (0.62 if s_ > 0 else -0.62), 1.62)

def dec_grand():
    door_sconces()
    paint('north', -2.4, 1.5, 1.0, 0.66, 0); paint('north', 2.4, 1.5, 0.66, 0.86, 2)
    paint('south', -2.4, 1.5, 1.0, 0.66, 1); paint('south', 2.4, 1.5, 0.66, 0.86, 3)
    paint('east', 2.4, 1.5, 1.0, 0.66, 0); paint('west', -2.4, 1.5, 1.0, 0.66, 1)
    floor_lamp(-3.6, 3.6)

def dec_switchboard():
    door_sconces()
    wall_clock(seg_at('north', -3.1), -3.1, 1.98)
    paint('east', 2.4, 1.5, 0.66, 0.86, 2); paint('west', -2.2, 1.5, 0.9, 0.62, 0)
    paint('south', 2.4, 1.5, 0.9, 0.62, 1)

def dec_dining():
    door_sconces()
    paint('north', 0.0, 1.55, 1.3, 0.78, 1)
    window(seg_at('north', -2.6), -2.6); window(seg_at('north', 2.6), 2.6)
    paint('east', -2.4, 1.5, 0.66, 0.86, 2); paint('west', -2.4, 1.5, 0.66, 0.86, 3)

def dec_library():
    door_sconces()
    wall_bookshelf('east', -3.0, -1.4); wall_bookshelf('west', -3.0, -1.4)
    paint('south', -2.4, 1.5, 1.0, 0.66, 0); paint('south', 2.4, 1.5, 0.66, 0.86, 2)
    floor_lamp(3.6, 2.2)

def dec_kitchen():
    door_sconces()
    sg = seg_at('north', 0.0)
    wall_shelf(sg, -1.5, 1.5, 1.55, [(C['white'], 0.14, 0.18), ('#b83a2a', 0.2, 0.14), (C['steel'], 0.24, 0.2), ('#d8c8a0', 0.12, 0.22),
                                   (C['white'], 0.14, 0.18), ('#3a5a7a', 0.16, 0.16), (C['steel'], 0.2, 0.12), ('#d8c8a0', 0.12, 0.22)])
    wall_shelf(sg, -1.2, 1.2, 1.98, [('#c8b890', 0.16, 0.2), ('#b0c8b0', 0.16, 0.18), (C['steel'], 0.3, 0.14), ('#c8b890', 0.16, 0.2), ('#e8e2d0', 0.2, 0.16)])
    wall_clock(seg_at('north', 2.6), 2.6, 1.7)
    sconce(seg_at('north', -2.6), -2.6, 1.62)

def dec_service():
    bulbs([('north', -2.2), ('south', 2.4)])
    radiator(seg_at('north', 2.3), 2.3)
    sign(seg_at('north', -2.9), -2.9, 1.5, 0.3, 0.3, 2)

def dec_storage():
    bulbs([('north', 2.0), ('south', -2.4)])
    radiator(seg_at('south', 2.4), 2.4, 0.6)

def dec_corridor_ew(quad_a=0, quad_b=1):
    door_sconces()
    paint('north', 0.0, 1.55, 1.1, 0.7, quad_a)
    paint('north', -2.6, 1.5, 0.66, 0.86, 2); paint('north', 2.6, 1.5, 0.66, 0.86, 3)
    paint('south', -2.4, 1.5, 0.9, 0.62, quad_b); paint('south', 2.4, 1.5, 0.9, 0.62, quad_a)

def dec_corridor_ns(console_side='east', quads=(0, 1)):
    door_sconces()
    if console_side:
        paint(console_side, 0.0, 1.55, 1.1, 0.7, quads[0])
    for side in ('east', 'west'):
        for s_, q in ((-2.6, 2), (2.6, 3)):
            if not (side == 'west' and room_has_near(side, s_)):
                paint(side, s_, 1.5, 0.66, 0.86, q)
    if console_side != 'west':
        mirror(seg_at('west', 0.0), 0.0, 1.45, 0.6, 0.9) if ROOM == 'corridorN' else None

def room_has_near(side, s_):
    for f in R['furniture']:
        cx, cz = f['center']; sx, _, sz = f['size']
        if side in ('east', 'west'):
            near = (cx > 2.9) if side == 'east' else (cx < -2.9)
            if near and cz - sz / 2 - 0.5 < s_ < cz + sz / 2 + 0.5 and f['size'][1] > 0.95:
                return True
    return False

def dec_stairs():
    bulbs([('west', -2.4), ('east', 2.6)])
    sign(seg_at('west', 2.6), 2.6, 1.55, 0.36, 0.36, 2)

def dec_back():
    bulbs([('north', 1.4), ('west', 1.6)])
    radiator(seg_at('west', -0.6), -0.6, 0.6)

def dec_cloakroom():
    door_sconces()
    mirror(seg_at('east', -2.4), -2.4, 1.45, 0.6, 1.0)
    paint('south', -2.4, 1.5, 0.9, 0.62, 1)
    sconce(seg_at('east', -3.2), -3.2, 1.62)

def dec_corner():
    door_sconces()
    window(seg_at('north', -3.05), -3.05, 1.5, 0.8, 0.95)
    paint('north', 1.4, 1.5, 1.0, 0.66, 0); paint('west', 0.4, 1.5, 0.66, 0.86, 2)
    floor_lamp(3.6, -3.6)

def dec_infirmary(n):
    door_sconces()
    if n == 1:
        sign(seg_at('north', 2.2), 2.2, 1.55, 0.44, 0.44, 2)
        wall_clock(seg_at('north', -2.3), -2.3, 1.7)
        sconce(seg_at('west', 2.4), 2.4, 1.62); sconce(seg_at('west', -2.4), -2.4, 1.62)
    else:
        sign(seg_at('west', 0.0), 0.0, 1.55, 0.44, 0.44, 2)
        wall_clock(seg_at('east', 2.4), 2.4, 1.7)
        sconce(seg_at('west', -2.4), -2.4, 1.62); sconce(seg_at('west', 2.4), 2.4, 1.62)

def dec_linen(n):
    door_sconces()
    if n == 1:
        sconce(seg_at('east', -1.4), -1.4, 1.62); sconce(seg_at('east', 1.2), 1.2, 1.62)
        wall_shelf(seg_at('east', -2.6), -3.2, -2.0, 1.6, [(C['linen'], 0.3, 0.12), (C['linenBlue'], 0.3, 0.1), (C['linen2'], 0.3, 0.14)])
    else:
        sconce(seg_at('west', -1.4), -1.4, 1.62); sconce(seg_at('west', 1.0), 1.0, 1.62)
        wall_shelf(seg_at('west', -2.4), -3.0, -1.8, 1.6, [(C['linen'], 0.3, 0.12), (C['linenBlue'], 0.3, 0.1), (C['linen2'], 0.3, 0.14)])

def dec_suite():
    door_sconces()
    paint('north', 0.0, 1.66, 1.1, 0.62, 1)
    sconce(seg_at('north', -1.35), -1.35, 1.32, watts=30.0); sconce(seg_at('north', 1.35), 1.35, 1.32, watts=30.0)
    window(seg_at('west', -1.2), -1.2)
    paint('east', -2.4, 1.5, 0.66, 0.86, 2); paint('east', 2.4, 1.5, 0.66, 0.86, 3)
    floor_lamp(-3.6, 1.9)

def dec_housekeeping():
    bulbs([('west', -1.5), ('south', -2.4)])

def dec_exit():
    bulbs([('west', 0.0), ('east', 0.0)])
    sign(seg_at('west', -2.6), -2.6, 1.5, 0.32, 0.32, 2)

ROOMS = {
    'lounge': dict(style=WALNUT, floor=K.CELL['stone'], rugs=[(-2.3, 2.3, -1.7, 1.7, K.CELL['rug'])], light=WARM_LIGHT, decor=dec_lounge),
    'ballroom': dict(style=CREAM, floor=K.CELL['parquet'], rugs=[], light=WARM_LIGHT, decor=dec_ballroom),
    'grandCorridor': dict(style=WALNUT, floor=K.CELL['stone'], light=WARM_LIGHT, decor=dec_grand,
                          rugs=[runner_x(), runner_z(0, -3.7, -0.55), runner_z(0, 0.55, 3.7)]),
    'switchboard': dict(style=WALNUT, floor=K.CELL['parquet'], rugs=[(-1.8, 1.8, -1.4, 1.4, K.CELL['rug'])], light=WARM_LIGHT, decor=dec_switchboard),
    'dining': dict(style=DAMASK, floor=K.CELL['parquet'], rugs=[(-2.0, 2.0, -1.4, 1.8, K.CELL['rug'])], light=WARM_LIGHT, decor=dec_dining),
    'library': dict(style=WALNUT, floor=K.CELL['parquet'], rugs=[(-2.0, 2.0, -2.5, 2.1, K.CELL['rugGreen'])], light=WARM_LIGHT, decor=dec_library),
    'kitchen': dict(style=KITCHEN, floor=K.CELL['checker'], rugs=[], light=COOL_LIGHT, decor=dec_kitchen),
    'serviceCorridor': dict(style=PLASTER('#8a9080', '#4f5a4c', pipes=True), floor=K.CELL['lino'], rugs=[], light=DARK_LIGHT, decor=dec_service),
    'storage': dict(style=PLASTER('#8a7a64', '#5a4a3a', pipes=True), floor=K.CELL['planks'], rugs=[], light=DARK_LIGHT, decor=dec_storage),
    'corridorE': dict(style=WALNUT, floor=K.CELL['stone'], rugs=[runner_x(), runner_z(0, 0.55, 3.7)], light=WARM_LIGHT, decor=lambda: dec_corridor_ew(0, 1)),
    'corridorW': dict(style=WALNUT, floor=K.CELL['stone'], rugs=[runner_x(), runner_z(0, 0.55, 3.7)], light=WARM_LIGHT, decor=lambda: dec_corridor_ew(1, 0)),
    'corridorN': dict(style=WALNUT, floor=K.CELL['stone'], rugs=[runner_z()], light=WARM_LIGHT, decor=lambda: dec_corridor_ns('east', (0, 1))),
    'corridorS': dict(style=DAMASK, floor=K.CELL['stone'], rugs=[runner_z()], light=WARM_LIGHT, decor=lambda: dec_corridor_ns(None, (1, 0))),
    'stairs': dict(style=PLASTER('#7e8078', '#4a4c46'), floor=K.CELL['planks'], rugs=[], light=DARK_LIGHT, decor=dec_stairs),
    'backCorridor': dict(style=PLASTER('#7a7466', '#4a4438', pipes=True), floor=K.CELL['planks'], rugs=[], light=DARK_LIGHT, decor=dec_back),
    'cloakroom': dict(style=WALNUT, floor=K.CELL['parquet'], rugs=[runner_x(0.9, -1.5, 3.7), runner_z(0.3, 1.45, 3.7)], light=WARM_LIGHT, decor=dec_cloakroom),
    'cornerCorridor': dict(style=WALNUT, floor=K.CELL['stone'], rugs=[runner_x(0, -0.55, 3.7), runner_z(0, 0.55, 3.7)], light=WARM_LIGHT, decor=dec_corner),
    'infirmary1': dict(style=CLINIC, floor=K.CELL['clinic'], rugs=[], light=COOL_LIGHT, decor=lambda: dec_infirmary(1)),
    'infirmary2': dict(style=CLINIC, floor=K.CELL['clinic'], rugs=[], light=COOL_LIGHT, decor=lambda: dec_infirmary(2)),
    'linenStore1': dict(style=LINEN_WALL, floor=K.CELL['planks'], rugs=[], light=WARM_LIGHT, decor=lambda: dec_linen(1)),
    'linenStore2': dict(style=LINEN_WALL, floor=K.CELL['planks'], rugs=[], light=WARM_LIGHT, decor=lambda: dec_linen(2)),
    'suite416': dict(style=DAMASK, floor=K.CELL['carpet'], rugs=[(-1.6, 1.6, -1.4, 1.2, K.CELL['rug'])], light=WARM_LIGHT, decor=dec_suite),
    'housekeeping': dict(style=PLASTER('#8a9080', '#4f5a4c'), floor=K.CELL['lino'], rugs=[], light=DARK_LIGHT, decor=dec_housekeeping),
    'exit': dict(style=PLASTER('#7a8078', '#4a5048'), floor=K.CELL['lino'], rugs=[], light=COOL_LIGHT, decor=dec_exit),
}

# ---- build -----------------------------------------------------------------------------------------
spec = ROOMS[ROOM]
st = spec['style']
for sg in SEGS:
    wall_run(sg, st)
for sg in SEGS:
    if sg.door:
        door_frame(sg, st)
build_floor(R, spec['floor'], spec['rugs'])
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
    rb.margin = 6; rb.margin_type = 'EXTEND'
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
