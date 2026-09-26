# Guest kit — the shared, parameterised machinery every hotel guest is built from (Blender bpy 4.2, headless).
#   python3 tools/char-pipeline/make_guest.py <name>      (spec: tools/char-pipeline/guests/<name>.py)
#
# Extracted from make_victor.py and generalised. A guest spec supplies numbers (CFG, tables, colours) and a
# build(g) function that calls the builders below in order; everything is deterministic bmesh maths.
#
#   g = Guest(name, CFG, COLOURS)            context: H, zp(), C (config), M (materials), parts, add()/add_w()
#   g.set_head(W, DF, DB, E, bulges)         skull tables -> skull_at / skull_pt / face_y / on_face / flatten_to_face
#   head(g) ears(g) eyes(g) brows(g) nose(g) mouth(g) moustache(g)          face (optional parts: just skip them)
#   hair_shell(g, **spec)                    smooth hair cap from an envelope + hairline + edge thickness + grooves
#   neck(g)
#   jacket(g, J) + lapels(g, J) + pockets(g, J) + buttons(g, J) + back_seam(g, J)     J: jacket dict (see marcus.py)
#   shirt_front(g, S) collar(g, S) tie(g, T) | bow_tie(g, T)
#   arms(g, A) (sleeve material or bare) cuffs(g, A) hands(g, A)     trousers(g, P)     shoes(g, S)
#   finish(g, out)                           join, normals, AO+tint bake, rig, Idle/Walk, extras, export
#
# Conventions (same as Victor): Blender Z up, the guest faces -Y, HIS right is -X. Heights in the specs are
# PERCENT OF STANDING HEIGHT FROM THE TOP (zp(pct) -> metres), as measured on the reference sheets.
# The skull axis sits at y = C['head_y'] (a stocky guest's head sits behind his chest): every head
# function below returns WORLD coordinates, so features placed with on_face() land on the face.
#
# A dress guest replaces jacket()+trousers() with her own body builder (bare arms: arms(g, A) with
# A['sleeve']=None and A['skin_arm']=True; shoes(g, dict(kind='pump', ...))); the head/hair/finish are shared.
import sys, os, math, time, bisect
from pathlib import Path
import bpy, bmesh, addon_utils
from mathutils import Vector, Matrix

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
import victor_lib as L
import guest_anim as GA

def reset_scene():
    try: addon_utils.enable("io_scene_gltf2", default_set=True, persistent=True)
    except Exception as e: print("addon note:", e)
    bpy.ops.wm.read_factory_settings(use_empty=True)

sm = L.smoothstep
def gauss(d, s): return math.exp(-(d * d) / (2 * s * s))

class Table:
    """Smooth monotone (PCHIP) lookup through (x, value) keys, constant outside. No overshoot, no creases
    at the keys (linear tables made faceted silhouettes on Victor's hair)."""
    def __init__(self, keys, n=600):
        from scipy.interpolate import PchipInterpolator
        import numpy as np
        d = {}
        for x, v in keys: d[float(x)] = float(v)
        xs = sorted(d); ys = [d[x] for x in xs]
        self.x0, self.x1 = xs[0], xs[-1]
        if len(xs) == 1: self.ys = [ys[0]] * 2; self.dx = 1.0; return
        f = PchipInterpolator(xs, ys); gx = np.linspace(self.x0, self.x1, n)
        self.ys = [float(v) for v in f(gx)]; self.dx = (self.x1 - self.x0) / (n - 1)
    def __call__(self, x):
        if x <= self.x0: return self.ys[0]
        if x >= self.x1: return self.ys[-1]
        t = (x - self.x0) / self.dx; i = int(t); f = t - i
        return self.ys[i] * (1 - f) + self.ys[i + 1] * f

# =============================================================================================
# CONTEXT
# =============================================================================================
class Guest:
    def __init__(self, name, cfg, colours, H=1.66):
        self.name = name; self.H = H; self.C = dict(cfg); self.parts = []
        # materials: key -> glTF material named key.capitalize() ('skin' -> 'Skin'; the bake finds skin/hair by name)
        self.M = {k: L.solid_material(k.capitalize(), v) for k, v in colours.items()}
        self.Y0 = self.C.get('head_y', 0.0)
        self.jw = None                                 # jacket weight function (set by jacket())
    def zp(self, pct): return self.H * (1.0 - pct / 100.0)
    def z(self, key): return self.zp(self.C[key])     # CFG heights are stored in percent from the top
    def add(self, ob, mat, bone):
        L.assign(ob, self.M[mat], bone); self.parts.append(ob); return ob
    def add_w(self, ob, mat, wfn):
        """One material; per-vertex skin weights from wfn(co) -> {bone: weight} (weights need not sum to 1)."""
        ob.data.materials.clear(); ob.data.materials.append(self.M[mat]); vg = {}
        for v in ob.data.vertices:
            for b, w in wfn(v.co).items():
                if w <= 1e-4: continue
                if b not in vg: vg[b] = ob.vertex_groups.new(name=b)
                vg[b].add([v.index], w, 'REPLACE')
        self.parts.append(ob); return ob
    def add_split(self, ob, mat, upper, lower, z_split, blend=0.04):
        L.assign_split(ob, self.M[mat], upper, lower, z_split, blend); self.parts.append(ob); return ob

    # ---- skull surface --------------------------------------------------------------------------------------
    def set_head(self, W, DF, DB, E, bulges=()):
        """Skull tables keyed by f (0 = chin bottom, 1 = skull top): half-width, front depth, back depth (metres
        from the skull axis) and superellipse exponent (2 round .. 3 rounded-square). bulges: dicts
        (x, z%, sx, sz, a) — soft forward swellings on the face (cheeks, nose bridge, chin), mirrored if x != 0."""
        C = self.C; zc, zt = self.z('z_chin'), self.z('z_skull_top'); self.zc, self.zt = zc, zt
        zz = lambda f: zc + (zt - zc) * f
        self.W = Table([(zz(f), v) for f, v in W]); self.DF = Table([(zz(f), v) for f, v in DF])
        self.DB = Table([(zz(f), v) for f, v in DB]); self.E = Table([(zz(f), v) for f, v in E])
        self.bulges = []
        for b in bulges:
            for s in ((1, -1) if b['x'] else (1,)):
                self.bulges.append((s * b['x'], self.zp(b['z']), b['sx'], b['sz'], b['a']))
    def bulge(self, x, z):
        return sum(a * gauss(x - bx, sx) * gauss(z - bz, sz) for bx, bz, sx, sz, a in self.bulges)
    def skull_at(self, u, z):
        """Skull surface point at longitude u (0 front, 0.25 his right = -X, 0.5 back) and height z (world)."""
        w = self.W(z); df = self.DF(z); db = self.DB(z); k = 2.0 / self.E(z)
        t = 2 * math.pi * u + math.pi / 2; c, s = math.cos(t), math.sin(t)
        x = math.copysign(abs(c) ** k, c) * w
        if s >= 0:
            y = -(abs(s) ** k) * df
            y -= self.bulge(x, z) * sm(-y / max(1e-6, 0.55 * df))
        else: y = (abs(s) ** k) * db
        return Vector((x, y + self.Y0, z))
    def skull_pt(self, u, v):
        if v <= 0.0: return Vector((0.0, self.Y0 - 0.02, self.zt))
        if v >= 1.0: return Vector((0.0, self.Y0 - 0.06, self.zc))
        return self.skull_at(u, self.zt - (self.zt - self.zc) * (0.5 - 0.5 * math.cos(math.pi * v)))
    def face_y(self, x, z):
        """Front skin surface (world y) at (x, z) — for placing features ON the face. None if outside."""
        w = self.W(z); df = self.DF(z); k = 2.0 / self.E(z)
        if w <= 1e-4 or abs(x) >= w: return None
        c = (abs(x) / w) ** (1 / k); s = math.sqrt(max(0.0, 1 - c * c)); y = -(s ** k) * df
        return y - self.bulge(x, z) * sm(-y / max(1e-6, 0.55 * df)) + self.Y0
    def face_normal(self, x, z):
        e = 0.004; w = self.W(z)
        yx1, yx0 = self.face_y(min(x + e, w - 1e-3), z), self.face_y(max(x - e, -w + 1e-3), z)
        yz1, yz0 = self.face_y(x, z + e), self.face_y(x, z - e)
        if None in (yx1, yx0, yz1, yz0): return Vector((0, -1, 0))
        return Vector((-(yx1 - yx0) / (2 * e), -1.0, -(yz1 - yz0) / (2 * e))).normalized()
    def on_face(self, x, z, lift=0.0):
        y = self.face_y(x, z)
        if y is None: y = -self.DF(z) + self.Y0
        return Vector((x, y, z)) + self.face_normal(x, z) * lift
    def flatten_to_face(self, ob, factor):
        """Compress a feature's depth toward the face surface (keeps its outline, thins its relief)."""
        for v in ob.data.vertices:
            y0 = self.face_y(v.co.x, v.co.z)
            if y0 is None: continue
            v.co.y = y0 + (v.co.y - y0) * factor
        ob.data.update()
    def inside_skull(self, p, pad=0.0):
        z = p.z
        if z >= self.zt or z <= self.zc: return False
        w = self.W(z) + pad; e = self.E(z); y = p.y - self.Y0
        d = (self.DF(z) + self.bulge(p.x, z)) if y < 0 else self.DB(z)
        d += pad
        if w <= 1e-5 or d <= 1e-5: return False
        return (abs(p.x) / w) ** e + (abs(y) / d) ** e < 1.0
    def skull_r(self, c, d, r_hi=0.40):
        """Distance from c along unit d to the skull surface (c must be inside)."""
        lo, hi = 0.0, r_hi
        for _ in range(28):
            m = 0.5 * (lo + hi)
            if self.inside_skull(c + d * m): lo = m
            else: hi = m
        return lo

# =============================================================================================
# HEAD
# =============================================================================================
def head(g, nlon=56, nlat=38, cull_in=None):
    """The skull shell (skin). cull_in(p) -> True drops faces hidden inside the hair (fewer triangles)."""
    skull = L.shell('Skull', g.skull_pt, nlon=nlon, nlat=nlat, warp_u=0.08)
    if cull_in:
        bm = bmesh.new(); bm.from_mesh(skull.data)
        dead = [f for f in bm.faces if all(cull_in(v.co) for v in f.verts)]
        bmesh.ops.delete(bm, geom=dead, context='FACES'); bm.to_mesh(skull.data); bm.free()
    return g.add(skull, 'skin', 'head')

def neck(g):
    C = g.C; r = C['neck_r']; ny = C['neck_y']
    return g.add(L.loft('Neck', [dict(z=g.z('z_shoulder_top') - 0.04, w=2*r, d=2*r*0.94, r=1.0, y=ny),
                                 dict(z=g.zc + 0.06, w=2*r*0.94, d=2*r*0.88, r=1.0, y=ny)], n=18), 'skin', 'neck')

def ears(g, style=None):
    """Ears. style (or CFG['ear_style']): 'round' (default) = the sheets' round C-shaped vinyl-toy ear: a thick disc
    whose edge stays full (a rolled rim all round), a recessed bowl opening at the front-bottom, a soft round lobe;
    'shell' = the earlier thin deformed-sphere ear (kept for compatibility)."""
    style = style or g.C.get('ear_style', 'round')
    if style == 'round': return ears_round(g)
    return ears_shell(g)

def ears_round(g):
    """CFG: ear_h / ear_w (outline), ear_out (how far the ear centre sits beyond the skull side), ear_y (front/back),
    z_ear (pct, centre), ear_tilt (flare: rad the back edge swings out from the head side), ear_thick (disc),
    ear_rim (rolled rim height), ear_bowl (bowl depth), ear_sink (front edge sunk into the head)."""
    C = g.C; ze = g.z('z_ear')
    for s_ in (1, -1):
        fl = C.get('ear_tilt', 0.6)
        A = Vector((s_ * math.sin(fl), math.cos(fl), 0.0))                  # in-plane, toward the back edge
        N = Vector((s_ * math.cos(fl), -math.sin(fl), 0.0))                 # out of the dish (out + forward)
        U = Vector((0, 0, 1))
        Cc = Vector((s_ * (g.W(ze) + C['ear_out']), g.Y0 + C['ear_y'], ze))
        aw, bh = C['ear_w'] * 0.5, C['ear_h'] * 0.5
        T = C.get('ear_thick', 0.030) * 0.5; rim, bowl_d = C.get('ear_rim', 0.008), C.get('ear_bowl', 0.012)
        sink = C.get('ear_sink', 0.022)
        eu, ev = C.get('ear_seg', (28, 20)); ear = L.uvsphere(f'Ear{s_}', 1.0, (0, 0, 0), u=eu, v=ev)
        for v in ear.data.vertices:
            px, py, pz = v.co.x, v.co.y, v.co.z                             # px: front(-)/back(+), pz: up, py: out of the dish
            rho = min(1.0, math.sqrt(px * px + pz * pz)); ang = math.atan2(pz, px)   # 0 back, pi/2 top, +-pi front
            full = (max(0.0, 1.0 - rho ** 4)) ** 0.25                       # squarish profile: the edge stays thick (rolled)
            front = sm((-px - 0.30) / 0.55)                                  # the attachment side
            lobe = sm((-pz - 0.35) / 0.45) * sm((0.5 - px) / 0.8)
            c_open = sm((ang - 2.3) / 0.5) if ang > 0 else sm((-ang - 2.0) / 0.6)   # the C opens at the front-bottom
            ridge = rim * math.exp(-((rho - 0.80) / 0.13) ** 2) * (1.0 - 0.8 * c_open)
            bowl = bowl_d * sm((0.66 - rho) / 0.28) * (1.0 - 0.8 * lobe) * (1.0 - 0.6 * front)
            if py >= 0: d = T * full + ridge * full - bowl
            else:       d = -T * full * 0.8
            # round outline (a slightly wider top, rounder lobe), the front edge tucked into the head
            wx = aw * (1.0 + 0.10 * pz)
            v.co = Cc + A * (px * wx) + U * (pz * bh) + N * d - N * sink * front + A * (-0.35 * sink * front)
        g.add(ear, 'skin', 'head')

def ears_shell(g):
    """ONE shaped shell per ear from a deformed sphere in the ear's own frame: rounded helix rim round the top
    and back, recessed bowl, full lobe, convex back, front edge sunk into the head. The ear plane is turned
    forward (ear_tilt) so the dish shows from the front, as on every sheet."""
    C = g.C; ze = g.z('z_ear')
    for s_ in (1, -1):
        tilt = C['ear_tilt']
        n_ = Vector((s_ * math.cos(tilt), -math.sin(tilt), 0.0))
        A = Vector((0, 0, 1)).cross(n_).normalized()
        Cc = Vector((s_ * (g.W(ze) + C['ear_out'] - 0.030), g.Y0 + C['ear_y'], ze))
        aw, bh = C['ear_w'] * 0.5, C['ear_h'] * 0.5
        roll = C.get('ear_roll', 0.0)                                       # top of the ear leaning in toward the head
        U = Vector((0, 0, 1)) * math.cos(roll) - n_ * math.sin(roll); N = Vector((0, 0, 1)) * math.sin(roll) + n_ * math.cos(roll)
        rim, bowl_d = C.get('ear_rim', 0.013), C.get('ear_bowl', 0.011)
        ear = L.uvsphere(f'Ear{s_}', 1.0, (0, 0, 0), u=26, v=18)
        for v in ear.data.vertices:
            px, py, pz = v.co.x, v.co.y, v.co.z                             # px: front(-)/back(+) in the ear plane, pz: up, py: out of it
            rho = min(1.0, math.sqrt(px * px + pz * pz)); ang = math.atan2(pz, px)   # ang 0 = back, pi/2 = top, pi = front
            front = sm((-px - 0.35) / 0.5)                                  # the attachment edge
            lobe = sm((-pz - 0.40) / 0.40) * sm((0.6 - px) / 0.8)           # full soft lobe at the bottom
            # the helix: a rolled rim round the top and back that fades out at the front-bottom (the C opens there)
            c_open = sm((ang - 2.2) / 0.5) if ang > 0 else sm((-ang - 1.9) / 0.6)
            ridge = rim * math.exp(-((rho - 0.76) / 0.19) ** 2) * (1.0 - c_open) * (1.0 - 0.7 * lobe)
            bowl = bowl_d * sm((0.64 - rho) / 0.26) * (1.0 - lobe) * (1.0 - 0.5 * front)
            wx = aw * (0.95 if px < 0 else 1.0) * (1.0 + C.get('ear_top_wide', 0.0) * pz)   # wider round top, narrower lobe
            if py >= 0:
                d = 0.007 + ridge - bowl + lobe * 0.012 * math.sqrt(max(0.0, 1.0 - rho * rho))
                d *= math.sqrt(max(0.0, 1.0 - rho ** 5)) * 0.8 + 0.2       # the rim rolls over the outline
            else:
                d = -0.012 * math.sqrt(max(0.0, 1.0 - rho * rho))
            d += C.get('ear_cup', 0.0) * rho * rho * (1.0 - front)          # cupped: the rim stands forward of the bowl
            v.co = Cc + A * (px * wx) + U * (pz * bh) + N * (d - 0.014 * front)
        g.add(ear, 'skin', 'head')

def eyes(g, mat='eye'):
    """Vertical ovals set into the face (glossy black material)."""
    C = g.C
    for s_ in (1, -1):
        p = g.on_face(s_ * C['eye_x'], g.z('z_eye'), C.get('eye_lift', 0.004))
        eye = L.uvsphere(f'Eye{s_}', 1.0, (0, 0, 0), scale=(C['eye_w'] * 0.5, 0.012, C['eye_h'] * 0.5), u=16, v=10)
        n = g.face_normal(s_ * C['eye_x'], g.z('z_eye'))            # sit the oval in the local face plane
        rot = Vector((0, -1, 0)).rotation_difference(n).to_matrix().to_4x4()
        eye.data.transform(rot); L.translate_verts(eye, p); g.add(eye, mat, 'head')
        g.eye_pts = getattr(g, 'eye_pts', []) + [p.copy()]

def brows(g, mat='brow'):
    """One tube per brow along a cubic through the inner end, two arch points and the outer end, lying on the
    forehead. B = C['brow']: x0/x1 (inner/outer |x|), z (pct), thick, arch (rise of the middle), drop_in /
    drop_out (inner / outer end below z), profile [(t, radius factor)], flat (depth kept)."""
    B = g.C['brow']; zb = g.zp(B['z']); x0, x1 = B['x0'], B['x1']
    for s_ in (1, -1):
        pts = L.bezier((s_ * x0, 0, zb - B['drop_in']), (s_ * (x0 + 0.33 * (x1 - x0)), 0, zb + B['arch']),
                       (s_ * (x0 + 0.70 * (x1 - x0)), 0, zb + B['arch'] * 0.9), (s_ * x1, 0, zb - B['drop_out']), n=20)
        pts = [tuple(g.on_face(x, z, 0.004)) for x, _, z in pts]
        ts = [i / 20 for i in range(21)]
        rad = [B['thick'] * 0.5 * k for k in L.smooth_profile(B['profile'], ts)]
        br = L.tube(f'Brow{s_}', pts, rad, n=10); g.flatten_to_face(br, B.get('flat', 0.5))
        g.add(br, mat, 'head')

def nose(g):
    """A ball nose on a soft bridge (the bridge is a face bulge in the spec)."""
    C = g.C; zn = g.z('z_nose')
    c = g.on_face(0, zn, C['nose_out'] - C['nose_d'] * 0.5)
    nb = L.uvsphere('NoseBall', 1.0, (0, 0, 0), scale=(C['nose_w'] * 0.5, C['nose_d'] * 0.5, C['nose_h'] * 0.5), u=20, v=14)
    for v in nb.data.vertices:
        if v.co.z > 0: v.co.z *= C.get('nose_top', 1.15); v.co.x *= 0.92       # egg: merges up into the bridge
    L.translate_verts(nb, c); g.add(nb, 'skin', 'head')

def mouth(g, mat='mouth'):
    """A smile line: a tapered tube along a curve (centre dip, ends rising), lying on the face."""
    Mo = g.C['mouth']; zm = g.zp(Mo['z']); hw = Mo['w'] * 0.5; r = Mo['rise']
    pts = L.bezier((-hw, 0, zm + r), (-hw * 0.45, 0, zm - Mo.get('sag', 0.004)), (hw * 0.45, 0, zm - Mo.get('sag', 0.004)), (hw, 0, zm + r), n=16)
    pts = [tuple(g.on_face(x, z, 0.002)) for x, _, z in pts]
    m = L.tube('Mouth', pts, [Mo['thick'] * 0.5 * t for t in L.smooth_profile([(0, 0.35), (0.12, 0.8), (0.5, 1.0), (0.88, 0.8), (1, 0.35)], [i / 16 for i in range(17)])], n=8)
    g.flatten_to_face(m, 0.5); g.add(m, mat, 'head')

def moustache(g, mat='brow'):
    """ONE connected moustache from tip to tip (Victor): notch under the nose, full lobes, rising tapered ends.
    MO = C['moustache']: w, thick, z (pct), top/bot edge keys vs |x|/half-width (units of the half thickness)."""
    MO = g.C['moustache']; N_M = 48; zm = g.zp(MO['z']); hw = MO['w'] * 0.5; R = MO['thick'] * 0.5
    ts = [-1.0 + 2.0 * i / N_M for i in range(N_M + 1)]
    top = L.smooth_profile(MO['top'], [abs(t) for t in ts]); bot = L.smooth_profile(MO['bot'], [abs(t) for t in ts])
    zs = [R * (u + l) * 0.5 for u, l in zip(top, bot)]; rs = [max(0.10, (u - l) * 0.5) for u, l in zip(top, bot)]
    pts = [tuple(g.on_face(t * hw, zm + z, 0.006)) for t, z in zip(ts, zs)]
    mo = L.tube('Moustache', pts, [R * r for r in rs], n=14); g.flatten_to_face(mo, 0.42); g.add(mo, mat, 'head')

# =============================================================================================
# HAIR — one smooth closed-looking cap, built as a radial shell from a point inside the head:
#   envelope : per-height superellipse slices from FOUR measured extents (his right / his left / front / back,
#              metres from the skull axis) + exponent, smooth (PCHIP) in height -> the sheet silhouettes by
#              construction, round and crease-free
#   hairline : z (pct) of the hair's lower edge by longitude u (0 front, 0.25 his right, 0.5 back)
#   edge     : thickness of the hair at its lower edge by u (thick roll edge on the forehead, thin sideburns);
#              the thickness may grow by `slope` per metre above the hairline (short sides, full top)
#   grooves  : soft channels along curves given as (u, pct) keys (the sheet's sculpted lock lines)
#   disp     : optional callback disp(u, v, p) -> extra radial offset (bespoke volume)
#   thin_below: optional thin_below(u) -> pct: the thickness grows (slope) only above this height instead of above
#              the hairline (a flat sideburn in front of the ear under a full top)
# The lower edge curls under into the skin (rounded lip); the shell's open rim ends inside the skull.
# =============================================================================================
def hair_shell(g, wr, wl, front, back, expo, hairline, edge, slope=0.9, t_min=0.010, grooves=(), disp=None,
               centre=(0.0, 0.02, 14.0), nlon=88, nrows=40, top=0.2, lip=0.8, name='Hair', mat='hair', thin_below=None):
    zp = g.zp; Y0 = g.Y0
    TWR, TWL, TF, TB, TE = (Table([(zp(p), v) for p, v in t]) for t in (wr, wl, front, back, expo))
    z_top = zp(top)
    def env_in(p):
        z = p.z
        if z >= z_top: return False
        x0, x1 = -TWR(z), TWL(z); yf, yb = Y0 - TF(z), Y0 + TB(z)
        a = 0.5 * (x1 - x0); b = 0.5 * (yb - yf)
        if a <= 1e-4 or b <= 1e-4: return False
        e = TE(z)
        return (abs(p.x - 0.5 * (x0 + x1)) / a) ** e + (abs(p.y - 0.5 * (yf + yb)) / b) ** e < 1.0
    c0 = Vector((centre[0], Y0 + centre[1], zp(centre[2])))
    def dirv(u, v):
        t = 2 * math.pi * u + math.pi / 2; sv = math.sin(v)
        return Vector((sv * math.cos(t), -sv * math.sin(t), math.cos(v)))
    def env_r(d):
        r, last = 0.03, None
        while r < 0.42:
            if env_in(c0 + d * r): last = r
            r += 0.006
        if last is None: return 0.0
        lo, hi = last, last + 0.006
        for _ in range(14):
            m = 0.5 * (lo + hi)
            if env_in(c0 + d * m): lo = m
            else: hi = m
        return lo
    # grooves: sample each curve on the (undisplaced) envelope
    def raw_pt(u, v):
        d = dirv(u, v); rs = g.skull_r(c0, d); return c0 + d * max(env_r(d), rs + t_min)
    def v_at(u, zpct, f=raw_pt):
        zt_ = zp(zpct); lo, hi = 0.02, math.pi * 0.97
        for _ in range(24):
            m = 0.5 * (lo + hi)
            if f(u, m).z > zt_: lo = m
            else: hi = m
        return 0.5 * (lo + hi)
    G = []
    for gr in grooves:
        keys = [list(k) for k in gr['keys']]
        for i in range(1, len(keys)):                      # unwrap u
            while keys[i][0] - keys[i - 1][0] > 0.5: keys[i][0] -= 1.0
            while keys[i][0] - keys[i - 1][0] < -0.5: keys[i][0] += 1.0
        dense = L.catmull_rom([tuple(k) for k in keys], gr.get('n', 24))
        pts = [raw_pt(u % 1.0, v_at(u % 1.0, zpc)) for u, zpc in dense]
        G.append((pts, gr['depth'], gr['width']))
    def groove_off(p):
        return -groove_amt(p)
    def groove_amt(p):
        off = 0.0
        for pts, depth, width in G:
            best, bi = 1e9, 0
            for i in range(len(pts) - 1):
                a, b = pts[i], pts[i + 1]; ab = b - a; L2 = ab.length_squared
                t = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, (p - a).dot(ab) / L2))
                dd = (a + ab * t - p).length
                if dd < best: best, bi = dd, i + t
            if best < 3 * width:
                s = bi / (len(pts) - 1); taper = math.sin(math.pi * s) ** 0.6
                off += depth * taper * gauss(best, width)
        return off
    def outer(u, v, with_detail=True):
        d = dirv(u, v); rs = g.skull_r(c0, d); re = env_r(d); p = c0 + d * re
        if with_detail:
            re += groove_off(p)
            if disp: re += disp(u, v, p)
        t = max(re - rs, t_min)
        h = max(0.0, (c0 + d * (rs + t)).z - zp(thin_below(u) if thin_below else hairline(u)))
        t = min(t, edge(u) + (slope(u) if callable(slope) else slope) * h)
        return c0 + d * (rs + t), rs, t
    # rows: v from the top pole down to the hairline, then the rounded lip into the skin
    bm = bmesh.new(); rows = []
    for i in range(nlon):
        u = i / nlon
        vh = v_at(u, hairline(u), lambda uu, vv: outer(uu, vv, False)[0])
        col = []
        for j in range(1, nrows + 1):
            s = j / nrows; v = vh * (0.5 * s + 0.5 * s ** 1.35) / 1.0
            col.append(outer(u, v)[0])
        ph, rs, th = outer(u, vh); d = dirv(u, vh)
        R = (ph - c0).length; dv = lip * th / max(0.05, R) + 0.004
        for f_, k in ((0.35, 0.80), (0.70, 0.42), (1.0, -0.004 / max(1e-4, th))):
            vv = vh + dv * f_; dd = dirv(u, vv); rr = g.skull_r(c0, dd)
            col.append(c0 + dd * (rr + k * th))
        rows.append([bm.verts.new(p) for p in col])
    top_v = bm.verts.new(outer(0.0, 0.0)[0])
    n = len(rows[0])
    for i in range(nlon):
        a, b = rows[i], rows[(i + 1) % nlon]
        bm.faces.new((top_v, a[0], b[0]))
        for j in range(n - 1): bm.faces.new((a[j], a[j + 1], b[j + 1], b[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # recalc may pick inward for an open shell: make sure the top faces point up
    if sum(f.normal.z for f in bm.faces if f.calc_center_median().z > zp(top + 3)) < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    ob = L.new_object(name, bm, smooth=True)
    def covered(p, margin=0.03):
        # True where the hair hides the skull (above the hairline by `margin`): used to drop hidden skull faces
        u = (math.atan2(-(p.y - c0.y), p.x - c0.x) - math.pi / 2) / (2 * math.pi) % 1.0
        return p.z > zp(hairline(u)) + margin
    g.hair_covers = covered
    g.hair_groove = lambda p: groove_amt(p)          # metres of groove depth at p (the bake darkens the grooves)
    def surface(u, zpct, detail=False):
        """Point on the hair surface (without grooves unless detail) at longitude u and height pct, and its outward normal."""
        u %= 1.0; f = lambda uu, vv: outer(uu, vv, detail)[0]; v = v_at(u, zpct, f); e = 2e-3
        p = f(u, v); du = f((u + e) % 1.0, v) - f((u - e) % 1.0, v); dv = f(u, v + e) - f(u, v - e)
        n = du.cross(dv)
        n = n.normalized() if n.length > 1e-12 else (p - c0).normalized()
        if n.dot(p - c0) < 0: n = -n
        return p, n
    g.hair_surface = surface
    return g.add(ob, mat, 'head')

def hair_lock(g, name, keys, n_samples=32, n_ring=12, mat='hair'):
    """A rounded lock lying on the hair (half embedded): keys (u, pct, width across the surface, thickness along
    the normal, lift of the centre line). Widths/thicknesses should taper at both ends so it grows out of the cap.
    u is unwrapped across the front automatically."""
    ks = [list(k) for k in keys]
    for i in range(1, len(ks)):
        while ks[i][0] - ks[i - 1][0] > 0.5: ks[i][0] -= 1.0
        while ks[i][0] - ks[i - 1][0] < -0.5: ks[i][0] += 1.0
    pts, nrm, ws, ts = [], [], [], []
    for k in L.catmull_rom([tuple(k) for k in ks], n_samples):
        p, n = g.hair_surface(k[0], k[1])
        pts.append(tuple(p + n * k[4])); nrm.append(tuple(n)); ws.append(max(0.004, k[2])); ts.append(max(0.003, k[3]))
    return g.add(L.ribbon_tube(name, pts, nrm, ws, ts, n=n_ring), mat, 'head')

# =============================================================================================
# BODY — jacket (ring-built, front opening cut into each ring), raised slabs for lapels / flaps / tie
# =============================================================================================
def slab(g, name, outline, surf, lift, thick, mat, wfn, cuts=4, sign=-1, sink=0.002, max_edge=None):
    """A thin raised panel conforming to a surface: outline [(x, z)] in metres, surf(x, z) -> y of the surface
    it lies on. Its top stands `lift + thick` off the surface (toward -Y for front surfaces, sign=-1; +Y for
    back ones), its underside `sink` inside it; vertical walls give the crisp lit/shaded edge of a lapel or
    pocket flap."""
    area = sum(x0 * z1 - x1 * z0 for (x0, z0), (x1, z1) in zip(outline, outline[1:] + outline[:1]))
    if area < 0: outline = list(reversed(outline))
    bm = bmesh.new(); vs = [bm.verts.new(Vector((x, 0.0, z))) for x, z in outline]
    f = bm.faces.new(vs); bmesh.ops.triangulate(bm, faces=[f], quad_method='BEAUTY', ngon_method='BEAUTY')
    if cuts == 'auto' or max_edge:                    # fine enough that the flat facets never dip under a curved surface
        longest = max(e.calc_length() for e in bm.edges); cuts = max(1, int(math.ceil(longest / (max_edge or 0.022))) - 1)
    if cuts: bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    for v in bm.verts: v.co.y = surf(v.co.x, v.co.z) + sign * (lift + thick)
    top = bm.faces[:]
    ret = bmesh.ops.extrude_face_region(bm, geom=top, use_keep_orig=True)        # keep the top, the copy becomes the underside
    for v in [e for e in ret['geom'] if isinstance(e, bmesh.types.BMVert)]:
        v.co.y = surf(v.co.x, v.co.z) - sign * sink
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = L.new_object(name, bm, smooth=True)
    return g.add_w(ob, mat, wfn) if wfn else ob

def jacket(g, J):
    """J['profiles']: [(pct, width, depth, roundness, y_centre)] from the hem up to the collar top (smoothly
    interpolated). The fronts part below J['open_apex'] (pct) in a V that reaches J['open_hem'] half-width at
    the hem, its lower corners rounded with radius J['corner']. Sets g.chest_y / g.back_y (surfaces for the
    panels) and g.jw (skin weights: spine above the waist, sharing J['hem_hips'] with the hips at the hem)."""
    zp = g.zp
    P = sorted([(zp(p), w, d, r, y) for p, w, d, r, y in J['profiles']])
    TW, TD, TR, TY = (Table([(q[0], q[k]) for q in P]) for k in (1, 2, 3, 4))
    z_hem, z_top = P[0][0], P[-1][0]; g.jacket_top = z_top; g.z_hem = z_hem
    def surf_y(x, z, back=False):
        z = max(z_hem, min(z_top, z)); w, d, r = TW(z), TD(z), TR(z)
        e = 2.0 + 6.0 * (1.0 - r); k = 2.0 / e
        u = min(0.999, abs(x) / (w / 2)); c = u ** (1 / k); s = math.sqrt(max(0.0, 1 - c * c))
        return TY(z) + (s ** k) * d / 2 * (1 if back else -1)
    g.chest_y = lambda x, z: surf_y(x, z); g.back_y = lambda x, z: surf_y(x, z, True)
    z_waist = zp(J['waist']); hh = J.get('hem_hips', 0.5)
    def jw(co):
        a = 1.0 - hh * sm((z_waist - co.z) / max(1e-6, z_waist - z_hem))
        return {'spine': a, 'hips': 1.0 - a}
    g.jw = jw
    z_apex = zp(J['open_apex']); RC = J['corner']; oh = J['open_hem']
    def open_hw(z):
        if z >= z_apex: return 0.0
        t = (z_apex - z) / max(1e-6, z_apex - z_hem); w = oh * t ** 1.4
        h = z - z_hem
        if h < RC: w += RC - math.sqrt(max(0.0, RC ** 2 - (RC - h) ** 2))
        return w
    g.open_hw = open_hw
    def outline(z):
        rr = L.rounded_rect_ring(TW(z), TD(z), TR(z), 720); yc = TY(z)
        rr = rr[540:] + rr[:540]
        return [Vector((p.x, p.y + yc, 0)) for p in rr]
    NJ = J.get('nj', 64)
    zs = [z_hem + RC * (1 - math.cos(math.radians(a))) for a in range(0, 90, 10)]
    zs += list(frange(z_hem + RC, z_top, J.get('ring_dz', 0.015))) + [z_apex, z_top]
    zs = sorted(set(round(z, 5) for z in zs if z_hem <= z <= z_top))
    bm = bmesh.new(); prev = None
    for z in zs:
        ol = outline(z); hw = open_hw(z)
        if hw > 0:
            yc = surf_y(hw, z)
            pts = [Vector((hw, yc, 0))] + [p for p in ol if not (p.y < TY(z) and abs(p.x) < hw)] + [Vector((-hw, yc, 0))]
            vs = [bm.verts.new(Vector((q.x, q.y, z))) for q in L.resample_polyline(pts, NJ + 1)]
        else:
            vs = [bm.verts.new(Vector((q.x, q.y, z))) for q in L.resample_polyline(ol, NJ, closed=True)]; vs = vs + [vs[0]]
        if prev is not None:
            for i in range(NJ): bm.faces.new((prev[i], prev[i + 1], vs[i + 1], vs[i]))
        prev = vs
    bm.faces.new(prev[:NJ])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    from mathutils.bvhtree import BVHTree
    bmt = bm.copy(); bmesh.ops.triangulate(bmt, faces=bmt.faces[:]); tree = BVHTree.FromBMesh(bmt); bmt.free()
    ob = L.new_object('Jacket', bm, smooth=True)
    # panels (shirt V, lapels, flaps, tie) are laid on the ACTUAL jacket mesh (its flat facets sit a few mm off
    # the analytic surface), found by casting a ray at the jacket from the front / back; analytic fallback
    def mesh_y(x, z, back=False):
        o = Vector((x, 1.0 if back else -1.0, z)); hit = tree.ray_cast(o, Vector((0, -1.0 if back else 1.0, 0)), 2.0)
        return hit[0].y if hit[0] is not None else surf_y(x, z, back)
    g.chest_y = lambda x, z: mesh_y(x, z); g.back_y = lambda x, z: mesh_y(x, z, True)
    g.jacket_tree = tree
    return g.add_w(ob, J.get('mat', 'jacket'), jw)

def frange(a, b, step):
    x = a
    while x < b: yield x; x += step

def lapels(g, J):
    """Notch (single-breasted suit) or peak (tuxedo) lapels as raised slabs on the chest, plus the jacket collar
    wrapping the back of the neck. J['lapel'] = dict(outline=[(x, pct)] for HIS LEFT (+x, mirrored),
    thick, mat, collar=[(x, pct)] optional upper collar leaf (the notch is the gap between the two))."""
    La = J['lapel']; zp = g.zp; surf = g.chest_y
    for s_ in (1, -1):
        for key, nm in (('outline', 'Lapel'), ('collar', 'CollarLeaf')):
            if key not in La or (key == 'collar' and La.get('wrap')): continue
            pts = [(s_ * x, zp(p)) for x, p in La[key]]
            slab(g, f'{nm}{s_}', pts, lambda x, z: surf(x, min(z, g.jacket_top)), La.get('lift', 0.0) + (La.get('collar_lift', 0.0015) if key == 'collar' else 0.0), La['thick'],
                 La.get('mat', 'jacket'), g.jw, max_edge=La.get('max_edge', 0.05))
    if La.get('edge_shade') and 'shade' in g.M:   # a shadow line just outside the lapel's outer edge: reads as a raised lapel
        idx = La['edge_shade']; wdt = La.get('shade_w', 0.007)
        for s_ in (1, -1):
            P_ = [Vector((s_ * La['outline'][i][0], 0, zp(La['outline'][i][1]))) for i in idx]
            ln = sum((b - a).length for a, b in zip(P_[:-1], P_[1:])); P_ = L.resample_polyline(P_, max(3, int(ln / 0.012)))
            strip_o, strip_i = [], []
            for k, p_ in enumerate(P_):
                a = P_[max(0, k - 1)]; b = P_[min(len(P_) - 1, k + 1)]; t = (b - a).normalized()
                nrm = Vector((t.z, 0, -t.x)) * s_                             # in-plane normal, away from the chest centre
                if nrm.x * s_ < 0: nrm = -nrm
                strip_i.append((p_.x, p_.z)); strip_o.append((p_.x + nrm.x * wdt, p_.z + nrm.z * wdt))
            slab(g, f'LapelShade{s_}', strip_i + list(reversed(strip_o)), lambda x, z: g.chest_y(x, min(z, g.jacket_top)), 0.0, 0.0015,
                 'shade', g.jw, cuts=0)
    if La.get('wrap'):                        # ONE smooth jacket collar: round the back of the neck, down onto the chest as the leaves
        W_ = La['wrap']; C = g.C; R = C['neck_r'] + W_.get('gap_neck', 0.030); zt, zf = zp(W_['top']), zp(W_['front'])
        op = W_.get('open', 0.55)
        ztop = lambda f: zf + (zt - zf) * sm((f - op) / W_.get('v_width', 1.0))
        return wrap_collar(g, 'JacketCollar', La.get('mat', 'jacket'), R, C['neck_y'] + W_.get('dy', 0.0), op, ztop, g.jacket_top - 0.03,
                           W_['tip'], W_.get('th_side', 1.6), thick=W_.get('thick', 0.008), gap=W_.get('gap', 0.010),
                           wfn=lambda co: {'spine': 1.0})
    # jacket collar round the back of the neck, stepping down at the front to meet the collar leaves
    C = g.C; NY = C['neck_y']; R = C['neck_r'] + La.get('collar_gap', 0.028)
    zt_b, zt_f = zp(La['collar_top']), zp(La.get('collar_front', 34.0)); op = La.get('collar_open', 0.75)
    jc = ring_wall('JacketCollar', NY + La.get('collar_dy', 0.004), R, 0.012, lambda th: g.jacket_top - 0.03,
                   lambda th: zt_f + (zt_b - zt_f) * sm((math.pi - abs(math.pi - th) - op) / 0.9), open_=op, n=36)
    g.add(jc, La.get('mat', 'jacket'), 'spine')

def ring_wall(name, cy, R, thick, z_bot, z_top, open_=0.0, n=40):
    """A thin upright band round a vertical axis at (0, cy): radius R (outer), wall `thick`, a rounded top edge.
    theta is measured from the FRONT (-Y) toward +X; the band leaves a front gap |theta| < open_ (its ends are
    capped). z_bot(theta) / z_top(theta) shape its lower and upper edges (a shirt collar's V, a jacket collar
    stepping down to the lapels)."""
    bm = bmesh.new(); st = []
    closed = open_ <= 1e-6
    ths = [open_ + (2 * math.pi - 2 * open_) * i / (n if closed else n - 1) for i in range(n)]
    for th in ths:
        c, s_ = math.sin(th), -math.cos(th)
        def P(r, z): return Vector((r * c, cy + r * s_, z))
        zb, zt = z_bot(th), z_top(th); ri = R - thick; rm = R - thick * 0.5
        st.append([bm.verts.new(P(R, zb)), bm.verts.new(P(R, zt - thick * 0.4)), bm.verts.new(P(rm, zt)),
                   bm.verts.new(P(ri, zt - thick * 0.4)), bm.verts.new(P(ri, zb))])
    m = len(st); k = len(st[0])
    for i in range(m if closed else m - 1):
        a, b = st[i], st[(i + 1) % m]
        for j in range(k - 1): bm.faces.new((a[j], b[j], b[j + 1], a[j + 1]))
        bm.faces.new((a[k - 1], b[k - 1], b[0], a[0]))
    if not closed: bm.faces.new(st[0]); bm.faces.new(list(reversed(st[-1])))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return L.new_object(name, bm, smooth=True)

def wrap_collar(g, name, mat, R, cy, open_, z_top, z_bot_side, tip, th_side, thick=0.006, gap=0.003, wfn=None,
                nth=30, nt=7, tip_round=0.35):
    """ONE smooth collar surface (no slabs meeting at angles): it wraps round the back of the neck on a cylinder
    (radius R about (0, cy)) and, at the front, turns down onto the chest as a point / leaf. Columns run from the
    front gap (angle open_ from the front, toward +X) round the back to the other side. Each column goes from its
    bottom point to its top point z_top(theta) (theta measured from the front, folded to 0..pi); bottom points sit
    at z_bot_side behind theta >= th_side (hidden in the jacket) and sweep forward and down to tip = (x, pct) at the
    front edge. Every point is pushed radially out to lie on the cylinder above the jacket top, or `gap` above the
    real jacket surface below it (ray cast), so it follows the chest exactly. thick: shell thickness (inward)."""
    from mathutils.bvhtree import BVHTree
    tree = getattr(g, 'jacket_tree', None); zj = g.jacket_top
    tip_x, tip_z = tip[0], g.zp(tip[1])
    def on_cyl(th, z, r): return Vector((r * math.sin(th), cy - r * math.cos(th), z))
    def surf_r(d, z, extra, wing=1.0):
        """Radius from the axis at height z along the horizontal direction d where the collar lies (wing: 1 on the
        front wing, which follows the chest; 0 round the sides/back, which stay on the cylinder inside the jacket)."""
        r = R + extra
        if tree is not None and z < zj + 0.002 and wing > 1e-3:
            hit = tree.ray_cast(Vector((0.0, cy, min(z, zj - 0.005))), d, 1.0)   # below the jacket's top cap: side wall hits only
            if hit[0] is not None:
                rj = (Vector((hit[0].x, hit[0].y - cy, 0))).length + gap + extra
                w = sm((zj + 0.002 - z) / 0.025)                          # blend from the cylinder onto the chest
                r = max(r, R + extra + (rj - R) * w * wing) if rj > R else r
        return r
    ths = [open_ + (2 * math.pi - 2 * open_) * i / (nth - 1) for i in range(nth)]
    def column(th, extra):
        f = th if th <= math.pi else 2 * math.pi - th; sgn = 1 if th <= math.pi else -1
        top = on_cyl(th, z_top(f), R)
        u = sm((th_side - f) / max(1e-6, th_side - open_))                  # 1 at the front edge -> 0 at th_side
        bside = on_cyl(th, z_bot_side, R)
        btip = Vector((sgn * tip_x, cy - R, tip_z))
        bot = bside.lerp(btip, u)
        pts = []
        for k in range(nt + 1):
            t = k / nt; p = bot.lerp(top, t)
            d = Vector((p.x, p.y - cy, 0.0)); d = d.normalized() if d.length > 1e-6 else Vector((0, -1, 0))
            r = surf_r(d, p.z, extra, sm((th_side + 0.15 - f) / 0.35)); pts.append(Vector((d.x * r, cy + d.y * r, p.z)))
        return pts
    bm = bmesh.new()
    O = [[bm.verts.new(p) for p in column(th, 0.0)] for th in ths]
    I = [[bm.verts.new(p) for p in column(th, -thick)] for th in ths]
    for i in range(nth - 1):
        for k in range(nt):
            bm.faces.new((O[i][k], O[i + 1][k], O[i + 1][k + 1], O[i][k + 1]))
            bm.faces.new((I[i][k + 1], I[i + 1][k + 1], I[i + 1][k], I[i][k]))
        bm.faces.new((O[i][nt], O[i + 1][nt], I[i + 1][nt], I[i][nt]))       # top edge
        bm.faces.new((I[i][0], I[i + 1][0], O[i + 1][0], O[i][0]))           # bottom edge
    for i in (0, nth - 1):
        for k in range(nt): bm.faces.new((O[i][k], O[i][k + 1], I[i][k + 1], I[i][k]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = L.new_object(name, bm, smooth=True)
    return g.add_w(ob, mat, wfn) if wfn else g.add(ob, mat, 'neck')

def rounded_rect_xz(x0, x1, z0, z1, r_bot, r_top=0.004, n=4):
    """Outline of a rectangle (x0<x1, z0 bottom < z1 top) with rounded corners, counter-clockwise."""
    pts = []
    def arc(cx, cz, r, a0, a1):
        for i in range(n + 1):
            a = math.radians(a0 + (a1 - a0) * i / n); pts.append((cx + r * math.cos(a), cz + r * math.sin(a)))
    arc(x1 - r_bot, z0 + r_bot, r_bot, -90, 0); arc(x1 - r_top, z1 - r_top, r_top, 0, 90)
    arc(x0 + r_top, z1 - r_top, r_top, 90, 180); arc(x0 + r_bot, z0 + r_bot, r_bot, 180, 270)
    return pts

def pockets(g, J):
    """Flap pockets at the hips (both sides) and an optional slanted chest welt on HIS LEFT."""
    zp = g.zp
    for x0, x1, p0, p1 in J.get('flaps', []):
        for s_ in (1, -1):
            xa, xb = sorted((s_ * x0, s_ * x1))
            slab(g, f'Flap{s_}', rounded_rect_xz(xa, xb, zp(p1), zp(p0), 0.008, n=2), g.chest_y, 0.0, J.get('flap_thick', 0.006), J.get('mat', 'jacket'), g.jw, cuts=1)
            if 'shade' in g.M:                        # the shadow line under the flap's lower edge (reads as a pocket at game size)
                slab(g, f'FlapShade{s_}', [(xa + 0.004, zp(p1) - 0.005), (xb - 0.004, zp(p1) - 0.005), (xb - 0.004, zp(p1) + 0.002), (xa + 0.004, zp(p1) + 0.002)],
                     g.chest_y, 0.0, 0.0015, 'shade', g.jw, cuts=0)
    if 'welt' in J:
        x0, x1, p, h, slant = J['welt']; z0 = zp(p)
        pts = [(x0, z0 - h / 2), (x1, z0 - h / 2 + slant), (x1, z0 + h / 2 + slant), (x0, z0 + h / 2)]
        slab(g, 'Welt', pts, g.chest_y, 0.0, 0.004, J.get('mat', 'jacket'), g.jw, cuts=2)

def buttons(g, J):
    """Front buttons (on the fastening line) and sleeve buttons are separate calls: this is the front."""
    for i, (x, p) in enumerate(J.get('buttons', [])):
        z = g.zp(p); r = J.get('button_r', 0.011)
        b = L.uvsphere(f'Button{i}', r, (x, g.chest_y(x, z) - J.get('flap_thick', 0.006) * 0.3, z), scale=(1, 0.55, 1), u=10, v=6)
        g.add_w(b, 'button', g.jw)

def back_seam(g, J):
    """The back: a centre seam (a shallow raised welt line) from the collar to the vent, and the vent itself
    (the overlapping flap: a thin raised panel from J['vent'] pct to the hem)."""
    zp = g.zp; bs = lambda x, z: g.back_y(x, z)
    if 'vent' in J:
        zv = zp(J['vent'])
        slab(g, 'Vent', [(-0.004, g.z_hem + 0.001), (0.030, g.z_hem + 0.001), (0.030, zv - 0.02), (-0.004, zv)], bs, 0.0, 0.004, J.get('mat', 'jacket'), g.jw, cuts=2, sign=1)
        slab(g, 'Seam', [(-0.003, zv - 0.005), (0.003, zv - 0.005), (0.003, g.jacket_top - 0.03), (-0.003, g.jacket_top - 0.03)], bs, 0.0, 0.0025, J.get('mat', 'jacket'), g.jw, cuts=1, sign=1)

def shirt_front(g, S):
    """The shirt V between the lapels: a thin panel just in front of the jacket surface."""
    pts = [(x, g.zp(p)) for x, p in S['v']]
    return slab(g, 'ShirtV', pts, lambda x, z: g.chest_y(x, min(z, g.jacket_top)), 0.004, 0.002, 'shirt', g.jw, max_edge=S.get('max_edge', 0.034))

def collar(g, S):
    """Shirt collar. With S['wrap'] (dict: top, v, tip, th_side, open, gap) ONE smooth wrapped surface (band + points,
    see wrap_collar); otherwise a band round the neck whose front opens in a V and two pointed leaf slabs."""
    if S.get('wrap'):
        W_ = S['wrap']; C = g.C; R = C['neck_r'] + W_.get('gap_neck', 0.010); zt, zv = g.zp(W_['top']), g.zp(W_['v'])
        op = W_.get('open', 0.10)
        ztop = lambda f: zv + (zt - zv) * sm((f - op) / W_.get('v_width', 0.8))
        zj = g.jacket_top
        def wfn(co):
            a = sm((co.z - (zj - 0.03)) / 0.05); return {'neck': 0.3 + 0.5 * a, 'spine': 0.7 - 0.5 * a}
        return wrap_collar(g, 'ShirtCollar', 'shirt', R, C['neck_y'], op, ztop, zj - W_.get('below', 0.03), W_['tip'], W_.get('th_side', 1.5),
                           thick=W_.get('thick', 0.005), gap=W_.get('gap', 0.004), wfn=wfn)
    C = g.C; NY = C['neck_y']; R = C['neck_r'] + 0.012; zt = g.zp(S['collar_top']); zv = g.zp(S.get('collar_v', 33.6))
    band = ring_wall('CollarBand', NY, R, 0.007, lambda th: g.jacket_top - 0.02,
                     lambda th: zv + (zt - zv) * sm((math.pi - abs(math.pi - th)) / S.get('v_width', 0.9)), open_=S.get('v_open', 0.16), n=40)
    g.add(band, 'shirt', 'neck')
    def csurf(x, z):                       # the band's front round the neck, blending smoothly onto the shirt front below it
        yb = NY - math.sqrt(max(0.0, R * R - min(abs(x), R * 0.98) ** 2)) - 0.001
        t = sm((g.jacket_top + 0.004 - z) / 0.035)
        return yb + (min(yb, g.chest_y(x, min(z, g.jacket_top - 0.002)) - 0.006) - yb) * t
    for s_ in (1, -1):
        slab(g, f'CollarPoint{s_}', [(s_ * x, g.zp(p)) for x, p in S['point']], csurf, 0.0, 0.004, 'shirt', lambda co: {'neck': 0.5, 'spine': 0.5}, max_edge=0.016)

def tie(g, T):
    """Four-in-hand tie: a blade slab on the shirt (tip under the lapels' crossing) and a knot block."""
    zp = g.zp; surf = lambda x, z: g.chest_y(x, min(z, g.jacket_top)) - 0.003
    slab(g, 'TieBlade', [(x, zp(p)) for x, p in T['blade']], surf, 0.0, T.get('thick', 0.008), 'tie', g.jw, max_edge=0.045)
    kz0, kz1 = zp(T['knot'][1]), zp(T['knot'][0]); w0, w1 = T['knot_w']
    kn = L.loft('TieKnot', [dict(z=kz0, w=w0, d=0.026, r=0.75), dict(z=(kz0 + kz1) / 2, w=(w0 + w1) / 2 + 0.004, d=0.032, r=0.75), dict(z=kz1, w=w1, d=0.030, r=0.8)], n=16)
    # the knot leans forward with the chest: its top sits against the collar band, its bottom on the shirt front
    y_top = g.C['neck_y'] - g.C['neck_r'] - 0.012 - 0.013; y_bot = g.chest_y(0, kz0) - 0.003 - 0.013
    for v in kn.data.vertices:
        t = (v.co.z - kz0) / max(1e-6, kz1 - kz0); v.co.y += y_bot + (y_top - y_bot) * t
    kn.data.update(); g.add(kn, 'tie', 'spine')

def bow_tie(g, T):
    """Bow tie (Victor): two wings pinched into a central knot, sitting on the collar band."""
    C = g.C; NY = C['neck_y']; R = C['neck_r'] + 0.010; z = g.zp(T['z']); s = T.get('scale', 1.0)
    bow = L.loft('BowTie', [dict(z=a * s, w=w * s, d=d, r=r) for a, w, d, r in [(-0.080, 0.020, 0.014, 0.8), (-0.062, 0.046, 0.024, 0.7), (-0.034, 0.054, 0.028, 0.7),
        (-0.015, 0.030, 0.024, 0.8), (-0.009, 0.036, 0.034, 0.9), (0.009, 0.036, 0.034, 0.9), (0.015, 0.030, 0.024, 0.8), (0.034, 0.054, 0.028, 0.7), (0.062, 0.046, 0.024, 0.7), (0.080, 0.020, 0.014, 0.8)]], n=16)
    L.rotate_verts(bow, (0, math.pi / 2, 0))
    for v in bow.data.vertices: v.co.y += 0.06 * (v.co.x / 0.08) ** 2
    L.translate_verts(bow, (0, NY - R - 0.012, z)); g.add(bow, T.get('mat', 'tie'), 'spine')

# =============================================================================================
# ARMS — one lofted sleeve per arm (shoulder cap -> elbow -> wrist), cuffs, hands with a thumb and four
# softly curled fingers (palm toward the thigh). A['sleeve'] = material key, or None for a bare arm in 'skin'.
# =============================================================================================
def arm_path(g, A, s):
    SX, ZJ = A['shoulder'][0], g.zp(A['shoulder'][1])
    ex, ey, ZE = s * A['elbow'][0], A['elbow'][1], g.zp(A['elbow'][2])
    hx, hy, ZW = s * A['wrist'][0], A['wrist'][1], g.zp(A['wrist'][2])
    def xy(z):
        if z >= ZE:
            t = max(0.0, min(1.0, (ZJ - z) / (ZJ - ZE))); return s * SX + (ex - s * SX) * t, A.get('shoulder_y', 0.0) * (1 - t) + ey * t
        t = max(0.0, min(1.0, (ZE - z) / (ZE - ZW))); return ex + (hx - ex) * t, ey + (hy - ey) * t
    return SX, ZJ, (ex, ey, ZE), (hx, hy, ZW), xy

def arms(g, A):
    zp = g.zp
    for s, tag in ((1, 'L'), (-1, 'R')):
        SX, ZJ, (ex, ey, ZE), (hx, hy, ZW), xy = arm_path(g, A, s)
        z_end = zp(A['sleeve_end'])
        prof = []
        for pct_or_z, w, d in A['stations']:          # (z, width, depth); z as 'end', 'elbow', pct, or ('j', dz) above the joint
            if pct_or_z == 'end': z = z_end
            elif isinstance(pct_or_z, tuple): z = ZJ + pct_or_z[1]
            else: z = zp(pct_or_z)
            x, y = xy(min(z, ZJ))
            if z > ZJ: x -= s * A.get('cap_in', 0.012) * (z - ZJ) / 0.05
            prof.append(dict(z=z, w=w, d=d, r=1.0, x=x, y=y))
        prof.sort(key=lambda p: p['z'])
        sl = L.loft(f'Sleeve{tag}', prof, n=A.get('n', 20))
        g.add_split(sl, A.get('sleeve') or 'skin', f'upperarm.{tag}', f'forearm.{tag}', ZE, 0.035)
        # sleeve buttons: a short vertical row on the back-outer side, just above the sleeve end
        for i in range(A.get('sleeve_buttons', 0)):
            z = z_end + 0.022 + i * 0.020; x, y = xy(z); w = prof[0]['w'] * 0.5
            a = math.radians(A.get('button_angle', 55.0))                    # from straight back toward the outside
            p = Vector((x + s * w * math.sin(a) * 1.0, y + w * math.cos(a) * 1.0, z))
            b = L.uvsphere(f'SleeveBtn{tag}{i}', 0.0065, p, scale=(1, 1, 1), u=6, v=4)
            g.add(b, 'button', f'forearm.{tag}')

def cuffs(g, A):
    zp = g.zp; c0, c1 = zp(A['sleeve_end']) + 0.012, zp(A['cuff_end'])
    for s, tag in ((1, 'L'), (-1, 'R')):
        *_, xy = arm_path(g, A, s)
        rw, rd = A['cuff_wd']
        prof = [dict(z=c1, w=rw * 0.96, d=rd * 0.96, r=1.0), dict(z=c1 + 0.006, w=rw, d=rd, r=1.0), dict(z=c0, w=rw, d=rd, r=1.0)]
        for p in prof: p['x'], p['y'] = xy(p['z'])
        g.add(L.loft(f'Cuff{tag}', prof, n=16), 'shirt', f'forearm.{tag}')
        if A.get('cufflink'):
            x, y = xy((c0 + c1) / 2); z = (c0 + c1) / 2
            g.add(L.uvsphere(f'Link{tag}', 0.006, (x + s * rw * 0.40, y + rd * 0.34, z), u=6, v=4), 'button', f'forearm.{tag}')

def _curl(p0, down, inward, length, bend, n):
    """Points of a finger: starting at p0 heading `down`, bending toward `inward` by `bend` radians."""
    pts = []; R = length / max(1e-6, bend)
    for i in range(n + 1):
        a = bend * i / n
        pts.append(p0 + down * (R * math.sin(a)) + inward * (R * (1 - math.cos(a))))
    return pts

def hands(g, A):
    """Relaxed hands: a rounded palm block, four fingers curling in toward the palm (index at the front),
    and a separate thumb hanging at the front. Hd = A['hand']."""
    Hd = A['hand']; zp = g.zp
    for s, tag in ((1, 'L'), (-1, 'R')):
        *_, (hx, hy, ZW), xy = arm_path(g, A, s)
        z0 = zp(A['cuff_end']) + 0.012                                        # palm top, inside the cuff
        out = Vector((s, 0, 0)); fwd = Vector((0, -1, 0)); down = Vector((0, 0, -1))
        base = Vector((hx + s * Hd.get('out', 0.004), hy, 0))
        pl, pw, pt = Hd['palm_len'], Hd['palm_w'], Hd['palm_t']
        palm = L.loft(f'Palm{tag}', [dict(z=z0 - pl, w=pt * 0.80, d=pw * 0.90, r=0.9), dict(z=z0 - pl * 0.80, w=pt, d=pw, r=0.88),
                                     dict(z=z0 - pl * 0.40, w=pt * 1.02, d=pw * 1.02, r=0.9), dict(z=z0 - pl * 0.08, w=pt * 0.86, d=pw * 0.86, r=0.95),
                                     dict(z=z0 + 0.010, w=pt * 0.74, d=pw * 0.74, r=1.0)], n=16)
        L.translate_verts(palm, base); g.add(palm, 'skin', f'hand.{tag}')
        for i, (yo, r, ln, bend) in enumerate(Hd['fingers']):
            p0 = Vector((base.x + s * Hd.get('finger_out', 0.004), hy + yo, z0 - pl * 0.78))
            pts = _curl(p0, down, -out, ln, bend, 10)
            tip = pts[-1] + (pts[-1] - pts[-2]).normalized() * r * 0.45
            rad = [r * (1.0 - 0.12 * k / 10) for k in range(11)]
            pts.append(tip); rad.append(r * 0.55)
            pts.append(tip + (pts[-1] - pts[-2]).normalized() * r * 0.35); rad.append(r * 0.18)
            g.add(L.tube(f'Finger{tag}{i}', [tuple(p) for p in pts], rad, n=Hd.get('finger_n', 8)), 'skin', f'hand.{tag}')
        T = Hd['thumb']                                                         # (y offset, x in, z below palm top, radius, length, bend)
        p0 = Vector((base.x - s * T[1], hy + T[0], z0 - T[2]))
        dirn = (down * 0.85 + fwd * 0.30 - out * 0.20).normalized(); inw = (-out * 0.8 + fwd * -0.2).normalized()
        pts = _curl(p0, dirn, inw, T[4], T[5], 8)
        tip = pts[-1] + (pts[-1] - pts[-2]).normalized() * T[3] * 0.45
        rad = [T[3] * (1.08 - 0.15 * k / 8) for k in range(9)] + [T[3] * 0.55, T[3] * 0.18]
        pts += [tip, tip + (tip - pts[-1]).normalized() * T[3] * 0.35]
        g.add(L.tube(f'Thumb{tag}', [tuple(p) for p in pts], rad, n=10), 'skin', f'hand.{tag}')

# =============================================================================================
# TROUSERS — ONE continuous surface waistband -> hips -> crotch -> both legs (Victor pass 7), with a soft
# break at the hem (the last rings widen a little and dip at the front over the shoe).
# =============================================================================================
def trousers(g, P):
    zp = g.zp; LX = P['leg_x']; TW, TD, SW, SD = P['thigh_w'], P['thigh_d'], P['shin_w'], P['shin_d']
    ZH, ZK = zp(P['hip']), zp(P['knee']); ZC = zp(P['crotch']); ZT = zp(P['top']); ZB = zp(P['hem'])
    LY = P.get('leg_y', 0.0); NL = P.get('nl', 24); PW = 2 * LX + TW
    PR = [(zp(p), PW * fw, TD + dd, r) for p, fw, dd, r in P['pelvis']]
    PR.sort()
    LEG = sorted((zp(q), w, d) for q, w, d in P['leg_profile']) + [(ZC, TW, TD)] if P.get('leg_profile') else None   # optional explicit (pct, w, d)
    LEG = LEG or [(ZB, SW * 1.03, SD * 1.02), (ZB + 0.05, SW * 0.97, SD * 0.96), (ZK - 0.10, SW, SD), (ZK - 0.03, SW * 1.0, SD * 1.01),
           (ZK + 0.03, TW * 0.97, TD * 0.94), ((ZK + ZH) / 2, TW, TD), (ZH + 0.03, TW, TD), (ZC, TW, TD)]
    def lst(table, z):
        if z <= table[0][0]: return table[0][1:]
        if z >= table[-1][0]: return table[-1][1:]
        for p, q in zip(table[:-1], table[1:]):
            if p[0] <= z <= q[0]:
                t = (z - p[0]) / (q[0] - p[0]); return tuple(pa + (qa - pa) * t for pa, qa in zip(p[1:], q[1:]))
    def widen(z):
        if z <= ZC:
            u = max(0.0, min(1.0, (z - (ZC - 0.09)) / 0.09)); return (LX - TW / 2) * u * u
        return (LX - TW / 2) + 0.9 * (z - ZC)
    LXH = P.get('leg_x_hem', LX)                  # leg centre at the hem: > leg_x keeps the outer edge straight while the leg tapers
    def lobe(z, s):
        w, d = lst(LEG, min(z, ZC)); gw = widen(z)
        if z > ZC: d += (lst(PR, z)[1] - d) * sm((z - ZC) / 0.06)
        lx = LX + (LXH - LX) * max(0.0, min(1.0, (ZC - z) / max(1e-6, ZC - ZB)))
        return (s * (lx - gw / 2), LY, w + gw, d, 1.0)
    def mirror(left): m = [Vector((-p.x, p.y, p.z)) for p in left]; return [m[0]] + list(reversed(m[1:]))
    def leg_ring(z):
        cx, cy, w, d, r = lobe(z, 1); pts = L.rounded_rect_ring(w, d, r, 360); pts = pts[180:] + pts[:180]
        dip = P.get('break_dip', 0.0) * sm((ZB + 0.03 - z) / 0.03)
        return [Vector((p.x + cx, p.y + cy, z - dip * max(0.0, -p.y / (d / 2)))) for p in L.resample_polyline(pts, NL, closed=True)]
    def pelvis_ring(z):
        if z <= ZC + 1e-9:
            left = leg_ring(z); left[0].x = 0.0; half = left + [left[0].copy()]
        else:
            k = 0.15 * sm((z - ZC) / 0.05); s = sm((z - ZC - 0.015) / 0.08)
            un = L.union_outline([lobe(z, 1), lobe(z, -1)], k, n=720)[0:361]
            w, d, r = lst(PR, z); rr = L.rounded_rect_ring(w, d, r, 720); rr = (rr[540:] + rr[:540])[0:361]
            rr = [Vector((p.x, p.y + LY, 0)) for p in rr]
            un = [Vector((p.x, p.y, 0)) for p in un]
            hu = L.resample_polyline(un, NL + 1); hr = L.resample_polyline(rr, NL + 1)
            half = [p * (1 - s) + q * s for p, q in zip(hu, hr)]; half[0].x = 0.0; half[-1].x = 0.0
        ring = half[:NL] + [half[NL]] + [Vector((-p.x, p.y, 0.0)) for p in reversed(half[1:NL])]
        return [Vector((p.x, p.y, z if p.z == 0 or z > ZC else p.z)) for p in ring]
    zs_p = sorted(set([ZT] + [q[0] for q in PR if q[0] < ZT] + [ZC + dz for dz in (0.0, 0.004, 0.008, 0.014, 0.020, 0.028, 0.038, 0.050)]), reverse=True)
    zs_l = [ZC - dz for dz in (0.004, 0.008, 0.012, 0.018, 0.024, 0.032, 0.040, 0.050, 0.062, 0.076, 0.092, 0.110)] + \
           [(ZK + ZH) / 2, ZK + 0.03, ZK - 0.03, (ZK + ZB) / 2, ZB + 0.08, ZB + 0.03, ZB + 0.01, ZB]
    zs_l = sorted(set(z for z in zs_l if ZB <= z < ZC), reverse=True)
    bm = bmesh.new(); prev = None
    for z in zs_p:
        ring = pelvis_ring(z)
        if abs(z - ZC) < 1e-9: vs = [bm.verts.new(p) for p in ring[:NL]]; vs = vs + [vs[0]] + [bm.verts.new(p) for p in ring[NL + 1:]]
        else: vs = [bm.verts.new(p) for p in ring]
        if prev is None: bm.faces.new(vs)
        else:
            for i in range(2 * NL): j = (i + 1) % (2 * NL); bm.faces.new((prev[i], prev[j], vs[j], vs[i]))
        prev = vs
    for s, top in ((1, prev[0:NL]), (-1, [prev[NL]] + prev[NL + 1:2 * NL])):
        pv = top
        for z in zs_l:
            ring = leg_ring(z) if s > 0 else mirror(leg_ring(z)); vs = [bm.verts.new(p) for p in ring]
            for i in range(NL): j = (i + 1) % NL; bm.faces.new((pv[i], pv[j], vs[j], vs[i]))
            pv = vs
        bm.faces.new(list(reversed(pv)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = L.new_object('Trousers', bm, smooth=True)
    def tw(co):
        x, z = co.x, co.z; fL = sm((x + 0.03) / 0.06)
        if z >= ZC - 1e-6:
            wt = 0.6 * sm((ZC + 0.07 - z) / 0.06); hips = 1 - wt; tL, tR = wt * fL, wt * (1 - fL); sh = 0.0
        else:
            m = sm((ZC - z) / 0.05); wt = 0.6 + 0.4 * m; hips = 1 - wt
            fl = fL * (1 - m) + (1.0 if x > 0 else 0.0) * m; tL, tR = wt * fl, wt * (1 - fl)
            sh = 1 - sm((z - (ZK - 0.04)) / 0.08)
        return {'hips': hips, 'thigh.L': tL * (1 - sh), 'thigh.R': tR * (1 - sh), 'shin.L': tL * sh, 'shin.R': tR * sh}
    return g.add_w(ob, P.get('mat', 'trouser'), tw)

# =============================================================================================
# SHOES — derby: a sole slab with a visible edge and heel block, an upper (heel counter -> instep -> toe box),
# a raised lacing facing with lace bars, a toe-cap line; splayed like the sheets.
# =============================================================================================
def shoes(g, S):
    L0, W0, H0 = S['len'], S['w'], S['h']; HEEL = S['heel']; TOE = L0 - HEEL
    for s, tag in ((1, 'L'), (-1, 'R')):
        lx = s * (S['leg_x'] + S.get('out', 0.0))
        sole_st = [(-HEEL, W0*0.66, 0.034), (-HEEL + 0.016, W0*0.93, 0.036), (-0.010, W0*1.00, 0.036), (0.004, W0*1.01, 0.021), (0.03, W0*1.04, 0.019),
                   (0.15, W0*1.06, 0.019), (TOE - 0.070, W0*1.04, 0.018), (TOE - 0.035, W0*0.94, 0.017), (TOE - 0.012, W0*0.70, 0.015), (TOE + 0.002, W0*0.30, 0.013)]
        sole = L.loft(f'Sole{tag}', [dict(z=a, w=w, d=t, r=0.72, y=t / 2) for a, w, t in sole_st], n=18)
        def st(a, w, h, r=0.62):
            base = 0.034 if a < -0.01 else (0.019 if a > 0.02 else 0.019 + 0.015 * (0.02 - a) / 0.03)
            return dict(z=a, w=w, d=h, r=r, y=base - 0.006 + h / 2)
        # side profile: heel counter, the instep rising to the ankle, the lacing throat, then a low rounded toe box
        up = [st(-HEEL + 0.006, W0*0.56, 0.066, 1.0), st(-HEEL + 0.020, W0*0.86, 0.090, 0.8), st(-0.030, W0*0.95, 0.102, 0.75), st(0.008, W0*0.97, H0, 0.75),
              st(0.045, W0*0.99, H0*0.90, 0.78), st(0.080, W0*1.0, H0*0.74, 0.80), st(0.115, W0*1.0, H0*0.62, 0.82), st(TOE - 0.095, W0*0.99, H0*0.60, 0.84),
              st(TOE - 0.078, W0*0.98, H0*0.60, 0.85), st(TOE - 0.072, W0*0.975, H0*0.595, 0.85), st(TOE - 0.066, W0*0.97, H0*0.595, 0.86),
              st(TOE - 0.040, W0*0.92, H0*0.57, 0.88), st(TOE - 0.020, W0*0.80, H0*0.50, 0.92), st(TOE - 0.008, W0*0.60, H0*0.34, 0.96), st(TOE - 0.001, W0*0.28, H0*0.16, 1.0)]
        shoe = L.loft(f'Shoe{tag}', up, n=S.get('n', 24))
        # toe-cap line: a shallow crease across the top of the toe box
        zc = TOE - 0.074
        for v in shoe.data.vertices:
            if v.co.y > 0.03: v.co.y -= 0.0035 * gauss(v.co.z - zc, 0.0035) * sm((v.co.y - 0.03) / 0.02)
        shoe.data.update()
        # lacing facing (two quarters meeting over the instep) + lace bars
        fac = L.loft(f'Facing{tag}', [dict(z=0.010, w=W0*0.46, d=0.010, r=0.9), dict(z=0.045, w=W0*0.54, d=0.012, r=0.9), dict(z=0.085, w=W0*0.40, d=0.010, r=0.9), dict(z=0.110, w=W0*0.14, d=0.006, r=1.0)], n=16)
        ob_list = [(sole, S.get('sole_mat', 'sole')), (shoe, 'shoe'), (fac, 'shoe')]
        for ob, _ in ob_list:
            L.rotate_verts(ob, (math.pi / 2, 0, 0))                        # loft axis -> -Y (forward); local y -> up
        # the facing sits on the instep surface: lift it to the upper's top at each point
        top = {}
        for v in shoe.data.vertices:
            k = round(v.co.y, 3)
            top[k] = max(top.get(k, 0.0), v.co.z)
        ks = sorted(top)
        def top_at(y):
            i = bisect.bisect_left(ks, y); i = max(1, min(len(ks) - 1, i)); return max(top[ks[i - 1]], top[ks[i]])
        for v in fac.data.vertices:
            v.co.z += top_at(v.co.y) - 0.004 - 0.004 * (1 - abs(v.co.x) / (W0 * 0.3))
        fac.data.update()
        for ob, mat in ob_list:
            for v in ob.data.vertices:
                if v.co.z < 0.002: v.co.z = 0.002
            L.rotate_verts(ob, (0, 0, s * S['splay']), about=(0, 0.05, 0)); L.translate_verts(ob, (lx, S.get('y', 0.0), 0))
            g.add(ob, mat, f'foot.{tag}')
        for i in range(S.get('laces', 3)):                                   # lace bars across the facing
            y = -(0.030 + i * 0.022); zt = top_at(y) + 0.003
            bar = L.tube(f'Lace{tag}{i}', [(-0.018, y, zt - 0.004), (0, y, zt - 0.001), (0.018, y, zt - 0.004)], [0.0026] * 3, n=6)
            L.rotate_verts(bar, (0, 0, s * S['splay']), about=(0, 0.05, 0)); L.translate_verts(bar, (lx, S.get('y', 0.0), 0))
            g.add(bar, 'sole', f'foot.{tag}')

# =============================================================================================
# FINISH — join, normals, baked soft shading, rig, animation, export
# =============================================================================================
def join(g):
    counts = {}
    for o in g.parts:
        k = ''.join(ch for ch in o.name.split('.')[0] if not ch.isdigit()).rstrip('LR-') or o.name
        counts[k] = counts.get(k, 0) + L.tri_count(o)
    print('REPORT tris by part: ' + ', '.join(f'{k} {v}' for k, v in sorted(counts.items(), key=lambda kv: -kv[1])))
    bpy.ops.object.select_all(action='DESELECT')
    for o in g.parts: o.select_set(True)
    bpy.context.view_layer.objects.active = g.parts[0]
    bpy.ops.object.join()
    mesh = bpy.context.active_object; mesh.name = g.name.capitalize(); mesh.location = (0, 0, 0)
    L.smooth_normals(mesh, g.C.get('smooth_angle', 62.0)); g.mesh = mesh
    return mesh

def bake(g, n_rays=32, max_dist=0.26, strength=0.50):
    """Ambient occlusion into COLOR_0 (no directional light, so it stays right when he turns), a restrained warm
    tint on the cheeks / nose / ears, and optional per-material 'sheen' (a fixed soft highlight: Lambert has no
    specular, so glossy shoes / hair get a lighter band where the normal faces C['sheen_dir'])."""
    from mathutils.bvhtree import BVHTree
    ob = g.mesh; me = ob.data; C = g.C
    # occluders: everything except the thin face features (brows / eyes / mouth / moustache lie ON the skin; their
    # occlusion only printed blocky patches on the coarse skull quads)
    no_occ = {i for i, m in enumerate(me.materials) if m and m.name in C.get('ao_skip', ('Brow', 'Eye', 'Mouth'))}
    bm = bmesh.new(); bm.from_mesh(me)
    bmesh.ops.delete(bm, geom=[f for f in bm.faces if f.material_index in no_occ], context='FACES')
    bmesh.ops.triangulate(bm, faces=bm.faces[:]); tree = BVHTree.FromBMesh(bm); bm.free()
    dirs = []
    for i in range(n_rays):
        t = (i + 0.5) / n_rays; r = math.sqrt(t); phi = i * 2.399963
        dirs.append((r * math.cos(phi), r * math.sin(phi), math.sqrt(max(0.0, 1.0 - t))))
    slot = {i: m.name for i, m in enumerate(me.materials) if m}
    vmat = {}
    for poly in me.polygons:
        for vi in poly.vertices: vmat.setdefault(vi, slot.get(poly.material_index))
    col = me.color_attributes.get('Col') or me.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='POINT')
    me.color_attributes.active_color = col; me.color_attributes.render_color_index = me.color_attributes.find('Col')
    tint = C.get('tint', {}); sheen = C.get('sheen', {})
    ze = g.z('z_ear'); earx = g.W(ze) + 0.022
    occ_stats = []
    for v in me.vertices:
        n = Vector(me.vertex_normals[v.index].vector).normalized()
        a = Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 1, 0)); t1 = a.cross(n).normalized(); t2 = n.cross(t1)
        o = v.co + n * 0.003; occ = 0.0
        for dx, dy, dz in dirs:
            hit = tree.ray_cast(o, t1 * dx + t2 * dy + n * dz, max_dist)
            if hit[0] is not None: occ += 1.0 - (hit[3] / max_dist) ** 0.6
        occ /= n_rays; occ_stats.append(occ)
        mname = vmat.get(v.index, '')
        k = 1.0 - (strength * (0.7 if mname == 'Hair' else 1.0)) * occ
        r = g_ = b = k
        if mname == 'Skin' and tint:
            w = 0.0
            for cx, cz, sx, sz, amt in tint.get('spots', []):
                w += amt * gauss(abs(v.co.x) - cx, sx) * gauss(v.co.z - g.zp(cz), sz) * sm((g.Y0 - v.co.y - 0.10) / 0.06)
            w = min(1.0, w); g_ *= 1.0 - tint.get('g', 0.08) * w; b *= 1.0 - tint.get('b', 0.14) * w
            ear = gauss(abs(v.co.x) - earx, 0.02) * gauss(v.co.z - ze, 0.05) * gauss(v.co.y - (g.Y0 + C['ear_y']), 0.04)
            r *= 1.0 - 0.10 * ear; g_ *= 1.0 - 0.12 * ear; b *= 1.0 - 0.12 * ear
        if mname == 'Hair' and getattr(g, 'hair_groove', None) and C.get('groove_dark'):
            gd = min(1.0, g.hair_groove(v.co) / C['groove_dark'][0]); m_ = 1.0 - C['groove_dark'][1] * gd; r *= m_; g_ *= m_; b *= m_
        if mname in sheen:                    # (floor, [(direction, power, amount), ...]) or (floor, direction, power)
            sh = sheen[mname]; lobes = sh[1] if isinstance(sh[1], list) else [(sh[1], sh[2], 1.0)]
            hl = min(1.0, sum(amt * max(0.0, n.dot(Vector(hd).normalized())) ** pw for hd, pw, amt in lobes))
            m_ = sh[0] + (1.0 - sh[0]) * hl; r *= m_; g_ *= m_; b *= m_
        col.data[v.index].color = (min(1.0, r), min(1.0, g_), min(1.0, b), 1.0)
    occ_stats.sort(); m = len(occ_stats)
    print(f'REPORT ao verts={m} rays={n_rays} occ_median={occ_stats[m // 2]:.2f} p90={occ_stats[int(m * 0.9)]:.2f}')

def rig(g, R):
    """Same bones / hierarchy as Victor: root, hips, spine, neck, head, shoulder/upperarm/forearm/hand .L/.R,
    thigh/shin/foot .L/.R. R: joint positions (pct heights, metres x/y)."""
    zp = g.zp; mesh = g.mesh
    arm_data = bpy.data.armatures.new(g.name.capitalize() + 'Rig'); arm = bpy.data.objects.new(arm_data.name, arm_data)
    bpy.context.scene.collection.objects.link(arm); bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT'); eb = arm_data.edit_bones
    def bone(name, head, tail, parent=None):
        b = eb.new(name); b.head = head; b.tail = tail; b.roll = 0.0
        if parent: b.parent = eb[parent]
    HIPJ, KNEE, ANKLE = zp(R['hip']), zp(R['knee']), zp(R['ankle'])
    ZWA, ZST = zp(R['waist']), zp(R['shoulder_top']); ny = R.get('neck_y', 0.0)
    bone('root', (0, 0, 0), (0, 0, 0.12))
    bone('hips', (0, 0, HIPJ), (0, 0, ZWA), 'root')
    bone('spine', (0, 0, ZWA), (0, 0, ZST), 'hips')
    bone('neck', (0, ny, ZST), (0, ny, g.zc + 0.02), 'spine')
    bone('head', (0, ny, g.zc + 0.02), (0, ny, g.zt), 'neck')
    A = R['arm']
    for s, tag in ((1, 'L'), (-1, 'R')):
        SX, ZJ, (ex, ey, ZE), (hx, hy, ZW), _ = arm_path(g, A, s)
        bone(f'shoulder.{tag}', (s * 0.08, 0, ZST - 0.03), (s * SX, A.get('shoulder_y', 0.0), ZJ), 'spine')
        bone(f'upperarm.{tag}', (s * SX, A.get('shoulder_y', 0.0), ZJ), (ex, ey, ZE), f'shoulder.{tag}')
        bone(f'forearm.{tag}', (ex, ey, ZE), (hx, hy, ZW), f'upperarm.{tag}')
        bone(f'hand.{tag}', (hx, hy, ZW), (hx, hy - 0.005, zp(R['hand_end'])), f'forearm.{tag}')
        lx = s * R['leg_x']
        bone(f'thigh.{tag}', (lx, 0, HIPJ), (lx, 0, KNEE), 'hips')
        bone(f'shin.{tag}', (lx, 0, KNEE), (lx, 0, ANKLE), f'thigh.{tag}')
        bone(f'foot.{tag}', (lx, 0, ANKLE), (lx, -0.18, 0.02), f'shin.{tag}')
    bpy.ops.object.mode_set(mode='OBJECT')
    amod = mesh.modifiers.new('Armature', 'ARMATURE'); amod.object = arm; mesh.parent = arm
    g.arm = arm; return arm

def animate(g, R):
    """Walk + Idle from the shared guest_anim (same as Victor); stores the stride extras."""
    arm = g.arm; scene = bpy.context.scene; FPS = 24; scene.render.fps = FPS
    bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='POSE')
    for pb in arm.pose.bones: pb.rotation_mode = 'XYZ'
    zp = g.zp
    CONTACT, STRIDE = GA.build_walk(bpy, arm, dict(hip=zp(R['hip']), knee=zp(R['knee']), ankle=zp(R['ankle']), heel=R['heel'], ball=R['ball']),
                                    **R.get('walk_kw', {}))
    print(f'REPORT contact_stride={CONTACT:.3f} stride={STRIDE:.3f}')
    ys = []
    for f in range(4, 11):
        scene.frame_set(f); bpy.context.view_layer.update(); pb = arm.pose.bones['foot.L']; w = arm.matrix_world @ pb.head; ys.append((f, w.y, w.z))
    sl = (ys[-1][1] - ys[0][1]) / ((ys[-1][0] - ys[0][0]) / GA.WALK_N)
    print(f'REPORT planted ankle: moves {sl:+.3f} m/cycle (expect +{CONTACT:.3f}), height {min(z for _, _, z in ys):.3f}..{max(z for _, _, z in ys):.3f}')
    GA.build_idle(bpy, arm, **R.get('idle_kw', {}))
    bpy.ops.object.mode_set(mode='OBJECT')
    arm['strideLength'] = round(STRIDE, 4); arm['contactStride'] = round(CONTACT, 4); arm['walkClipSeconds'] = round(GA.WALK_N / FPS, 4)
    # eye centre for the portrait tool, in glTF space (Y up, the face toward +Z): Blender (x, y, z) -> (x, z, -y)
    pts = getattr(g, 'eye_pts', None)
    e = sum(pts, Vector()) / len(pts) if pts else g.on_face(0.0, g.z('z_eye'))
    arm['eyeCentre'] = [round(e.x, 4), round(e.z, 4), round(-e.y, 4)]
    g.mesh['strideLength'] = round(STRIDE, 4)
    return CONTACT, STRIDE

def export(g, out):
    out = Path(out); out.parent.mkdir(parents=True, exist_ok=True)
    tris = L.tri_count(g.mesh)
    print(f'REPORT tris={tris} materials={len(g.mesh.data.materials)} verts={len(g.mesh.data.vertices)} height={g.H}')
    bpy.ops.object.select_all(action='DESELECT'); g.arm.select_set(True); g.mesh.select_set(True); bpy.context.view_layer.objects.active = g.arm
    bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', use_selection=True, export_apply=False, export_animations=True,
                              export_animation_mode='ACTIONS', export_yup=True, export_morph=False, export_extras=True,
                              export_vertex_color='ACTIVE', export_all_vertex_colors=False)
    print(f'REPORT file_bytes={out.stat().st_size} path={out}')

def finish(g, R, out):
    join(g)
    t0 = time.time(); bake(g); print(f'REPORT ao_seconds={time.time() - t0:.1f}')
    rig(g, R); animate(g, R); export(g, out)
