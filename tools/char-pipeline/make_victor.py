# Build "Victor" v3 — rebuilt to match the owner's reference sheet (tools/char-pipeline/ref/).
#   python3 tools/char-pipeline/make_victor.py   -> assets/characters/victor.glb
#
# Every proportion comes from CFG below, measured on the sheet's neutral FRONT/SIDE/BACK panels
# (row-width profiles, see docs/CHARACTER_GUI_CHECKPOINT.md "Reference, measured v3"). Heights are
# fractions of the standing height mapped to H metres.
#
# Construction (all deterministic bmesh maths in victor_lib):
#   skull  = parametric shell: superellipse cross-sections whose half-width, front depth, back depth
#            and squareness are HEIGHT TABLES (softly squared face, defined cheeks, rounded chin)
#   hair   = a second shell offset from the skull along its normal by a THICKNESS FIELD (thin sides
#            and back, a front sweep peaking over the forehead toward his right, a part step on his
#            left, sideburns; negative below the hairline so the cap tucks inside the skin: no holes,
#            no jagged intersections)
#   face   = eyes / brows / nose / moustache / mouth / ears placed ON the skull surface function
#   body   = lofted jacket (slim depth, waist, long hem), conforming shirt V + peaked lapels, bow tie,
#            capsule limbs with joint spheres, cuffs, mitt hands with thumbs, lofted shoes
#   rig    = same joint set as v2 (shoulder/upperarm/forearm/hand, thigh/shin/foot, hips/spine/neck/
#            head); Idle + Walk re-authored on the new joints; stride measured and stored in extras.
import sys, os, math
from pathlib import Path
import bpy, bmesh, addon_utils
from mathutils import Vector, Euler

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
sys.path.insert(0, str(HERE))
import victor_lib as L

try:
    addon_utils.enable("io_scene_gltf2", default_set=True, persistent=True)
except Exception as e:
    print("addon note:", e)
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# =============================================================================================
# CONFIG — measured relationships (fractions of standing height unless noted). Blender Z up,
# character faces -Y, HIS right is -X, HIS left is +X.
# =============================================================================================
H = 1.66
def zp(pct): return H * (1.0 - pct / 100.0)         # z of a point at pct of height from the TOP
CFG = dict(
    # ---- head. Sheet FRONT panel, measured as % of standing height from the top (chin sits on the
    #      collar; the neck is hidden): hair top 0.2, hairline 8.6, brows 13.0, eyes 17.6, nose ball 21.0,
    #      moustache 22.5-26 (centre 24.2), mouth 27.3, chin bottom 31.5, ears 16-27 (centre 21.5).
    #      Skull top is hidden under the hair (~3.8 %). Width: skin 0.236 H at the cheekbones, ears to 0.29 H,
    #      hair 0.285 H at the temples. Depth (SIDE close-up): forehead 0.233 in front of the skull axis,
    #      occiput 0.215 behind, nose tip +0.043 from the face plane, moustache +0.020, chin -0.015.
    z_hair_top=zp(0.2), z_skull_top=zp(3.8), z_hairline=zp(8.6), z_brow=zp(13.0), z_eye=zp(17.3),
    z_nose=zp(20.3), z_moustache=zp(23.7), z_mouth=zp(27.3), z_chin=zp(31.5), z_ear=zp(21.2),
    skull_half_w=0.196,
    ear_h=0.115, ear_w=0.078, ear_out=0.050, ear_y=0.030,
    eye_x=0.071, eye_w=0.040, eye_h=0.068,
    brow_x0=0.040, brow_x1=0.116, brow_thick=0.034, brow_arch=0.018,
    nose_w=0.080, nose_h=0.064, nose_out=0.043,
    mo_w=0.200, mo_thick=0.062, mo_out=0.020,
    mouth_w=0.060,
    # ---- neck / shoulders / torso (FRONT: collar top ~32 %, shoulders 36-40 %, jacket 0.326 H wide;
    #      SIDE: collar region <= 0.24 deep, chest 0.30 deep; hem 72.5 %)
    neck_r=0.105, neck_y=-0.03, z_shoulder_top=zp(35.5), z_shoulder_joint=zp(40.0), shoulder_x=0.222,
    jacket_w_shoulder=0.515, jacket_d_chest=0.300, jacket_w_waist=0.465, z_waist=zp(58.0),
    jacket_w_hem=0.500, jacket_d_hem=0.240, z_hem=zp(72.5),
    # ---- arms (FRONT: hands end at 72 %, hand centres +-0.335; elbow ~55 %)
    upperarm_r=0.068, forearm_r=0.058, z_elbow=zp(55.5), z_wrist=zp(66.5), z_hand_end=zp(72.5),
    hand_x=0.335, hand_len=0.115, hand_w=0.092,
    # ---- legs (FRONT: two legs span 0.23 H; SIDE: thigh 0.135 H deep; knee ~86 %, ankle 96 %;
    #      shoes 0.05 H tall, 0.185 H long, both together 0.30 H wide with the splay)
    leg_x=0.114, thigh_w=0.160, thigh_d=0.190, shin_w=0.155, shin_d=0.155,
    z_hip_joint=zp(74.0), z_knee=zp(86.5), z_ankle=zp(96.0),
    shoe_len=0.420, shoe_w=0.200, shoe_h=0.075, shoe_splay=0.26,
)
C = CFG
# Skull tables by f (0 = chin bottom, 1 = skull top): half-width, front depth, back depth (from the
# skull axis x=y=0), squareness. Values are metres, read off the sheet (see CFG comment).
zc, zt = C['z_chin'], C['z_skull_top']
def zz(f): return zc + (zt - zc) * f
W_TAB  = [(zz(f), w) for f, w in [(0, 0), (0.02, 0.098), (0.058, 0.114), (0.112, 0.140), (0.17, 0.158), (0.227, 0.169),
          (0.285, 0.178), (0.343, 0.184), (0.40, 0.188), (0.455, 0.189), (0.50, 0.189), (0.566, 0.189), (0.624, 0.187),
          (0.682, 0.184), (0.74, 0.180), (0.794, 0.174), (0.851, 0.162), (0.91, 0.138), (0.967, 0.085), (1, 0)]]
DF_TAB = [(zz(f), d) for f, d in [(0, 0), (0.02, 0.190), (0.058, 0.213), (0.112, 0.222), (0.17, 0.226), (0.227, 0.229),
          (0.285, 0.231), (0.343, 0.233), (0.60, 0.233), (0.682, 0.232), (0.74, 0.230), (0.794, 0.226), (0.851, 0.216),
          (0.91, 0.185), (0.967, 0.115), (1, 0)]]
DB_TAB = [(zz(f), d) for f, d in [(0, 0), (0.02, 0.050), (0.058, 0.062), (0.112, 0.075), (0.17, 0.088), (0.227, 0.108),
          (0.285, 0.135), (0.343, 0.150), (0.40, 0.165), (0.455, 0.180), (0.50, 0.195), (0.566, 0.208), (0.624, 0.213),
          (0.682, 0.215), (0.74, 0.213), (0.794, 0.205), (0.851, 0.190), (0.91, 0.160), (0.967, 0.100), (1, 0)]]
E_TAB  = [(zz(f), e) for f, e in [(0, 2.2), (0.06, 2.35), (0.17, 2.5), (0.30, 2.65), (0.45, 2.8), (0.60, 2.85), (0.75, 2.75),
          (0.88, 2.5), (1, 2.2)]]

def T(z, tab): return L.lerp_table(z, tab)

def skull_at(u, z):
    """Skull surface point at longitude u (0 front, 0.25 his right = -X, 0.5 back) and height z."""
    w = T(z, W_TAB); df = T(z, DF_TAB); db = T(z, DB_TAB); e = T(z, E_TAB); k = 2.0 / e
    t = 2 * math.pi * u + math.pi / 2
    c, s = math.cos(t), math.sin(t)
    x = math.copysign(abs(c) ** k, c) * w
    y = -(abs(s) ** k) * df if s >= 0 else (abs(s) ** k) * db
    return Vector((x, y, z))

def skull_pt(u, v):
    """Shell function: v in [0,1], 0 = top pole, 1 = chin pole (cosine-spaced rows)."""
    if v <= 0.0: return Vector((0.0, -0.02, zt))
    if v >= 1.0: return Vector((0.0, -0.06, zc))
    z = zt - (zt - zc) * (0.5 - 0.5 * math.cos(math.pi * v))
    return skull_at(u, z)

def face_y(x, z):
    """Front skin surface at (x, z) — for placing features ON the face. None if outside."""
    w = T(z, W_TAB); df = T(z, DF_TAB); e = T(z, E_TAB); k = 2.0 / e
    if w <= 1e-4 or abs(x) >= w: return None
    c = (abs(x) / w) ** (1 / k); s = math.sqrt(max(0.0, 1 - c * c))
    return -(s ** k) * df

def face_normal(x, z):
    e = 0.004
    yx1, yx0 = face_y(min(x + e, T(z, W_TAB) - 1e-3), z), face_y(max(x - e, -T(z, W_TAB) + 1e-3), z)
    yz1, yz0 = face_y(x, z + e), face_y(x, z - e)
    if None in (yx1, yx0, yz1, yz0): return Vector((0, -1, 0))
    n = Vector((-(yx1 - yx0) / (2 * e), -1.0, -(yz1 - yz0) / (2 * e)))   # front points -Y
    return n.normalized()

def on_face(x, z, lift=0.0):
    y = face_y(x, z)
    if y is None: y = -T(z, DF_TAB)
    return Vector((x, y, z)) + face_normal(x, z) * lift

def flatten_to_face(ob, factor):
    """Compress a feature's depth toward the face surface (keeps its outline, thins its relief)."""
    for v in ob.data.vertices:
        y0 = face_y(v.co.x, v.co.z)
        if y0 is None: continue
        v.co.y = y0 + (v.co.y - y0) * factor
    ob.data.update()

# ---- materials -------------------------------------------------------------------------------
M = {
    'skin':   L.solid_material('Skin',   '#eebe95'),   # warm peach
    'hair':   L.solid_material('Hair',   '#382920'),   # dark espresso (sculpted forms need a little value)
    'jacket': L.solid_material('Jacket', '#1f2c50'),   # midnight navy
    'lapel':  L.solid_material('Lapel',  '#161d36'),   # satin facing: a shade darker than the cloth
    'shirt':  L.solid_material('Shirt',  '#f3eee2'),   # ivory
    'black':  L.solid_material('Black',  '#111116'),   # bow tie, shoes, buttons
    'dark':   L.solid_material('Dark',   '#221812'),   # brows, moustache, eyes, mouth (near the hair tone)
}
parts = []
def add(ob, mat, bone):
    L.assign(ob, M[mat], bone); parts.append(ob); return ob

# =============================================================================================
# HEAD
# =============================================================================================
skull = L.shell('Skull', skull_pt, nlon=56, nlat=36, warp_u=0.08)
add(skull, 'skin', 'head')
# neck: a short thick cylinder, set a little forward so the nape curves in; hidden by chin and collar
add(L.loft('Neck', [dict(z=C['z_shoulder_top'] - 0.03, w=2*C['neck_r'], d=2*C['neck_r']*0.92, r=1.0, y=C['neck_y']),
                    dict(z=C['z_chin'] + 0.05, w=2*C['neck_r']*0.92, d=2*C['neck_r']*0.86, r=1.0, y=C['neck_y'])], n=18), 'skin', 'neck')

# ---- ears: big rounded discs standing out from the skull at nose level, slightly behind the axis
for s in (1, -1):
    ear = L.uvsphere(f'Ear{s}', 1.0, (0, 0, 0), scale=(0.030, C['ear_w'] * 0.5, C['ear_h'] * 0.5), u=18, v=14)
    L.rotate_verts(ear, (0.0, 0.0, s * 0.22))
    sk = T(C['z_ear'], W_TAB)
    L.translate_verts(ear, (s * (sk + C['ear_out'] - 0.030 + 0.006), C['ear_y'], C['z_ear']))
    add(ear, 'skin', 'head')
    # inner bowl: a slightly darker-lit concavity read comes from a smaller disc set into the outer one
    bowl = L.uvsphere(f'EarBowl{s}', 1.0, (0, 0, 0), scale=(0.012, C['ear_w'] * 0.30, C['ear_h'] * 0.30), u=12, v=10)
    L.translate_verts(bowl, (s * (sk + C['ear_out'] + 0.006 - 0.004), C['ear_y'] + 0.004, C['z_ear'] - 0.004))
    add(bowl, 'skin', 'head')

# ---- eyes: dark vertical ovals set flush into the face, no highlight beads
for s in (1, -1):
    p = on_face(s * C['eye_x'], C['z_eye'], 0.006)
    eye = L.uvsphere(f'Eye{s}', 1.0, (0, 0, 0), scale=(C['eye_w'] * 0.5, 0.014, C['eye_h'] * 0.5), u=18, v=14)
    L.translate_verts(eye, p)
    add(eye, 'dark', 'head')

# ---- brows: bold, curved, rounded inner end, tapered outer end; the arch peaks a third of the way out
for s in (1, -1):
    zb = C['z_brow']; x0, x1 = C['brow_x0'], C['brow_x1']; a = C['brow_arch']
    pts = L.bezier((s * x0, 0, zb - 0.006), (s * (x0 + 0.33 * (x1 - x0)), 0, zb + a), (s * (x0 + 0.67 * (x1 - x0)), 0, zb + a), (s * x1, 0, zb - 0.012), n=14)
    pts = [tuple(on_face(x, z, 0.006)) for x, _, z in pts]
    rad = [C['brow_thick'] * 0.5 * (0.80 + 0.20 * math.sin(math.pi * min(1.0, i / 7)) if i < 8 else 0.28 + 0.72 * (1 - ((i - 8) / 6) ** 1.25)) for i in range(15)]
    br = L.tube(f'Brow{s}', pts, rad, n=10); flatten_to_face(br, 0.50)
    add(br, 'dark', 'head')

# ---- nose: a round ball sitting on the moustache, with a short soft bridge up between the eyes
ball_c = on_face(0, C['z_nose'], C['nose_out'] - 0.030)
nose = L.uvsphere('NoseBall', 1.0, (0, 0, 0), scale=(C['nose_w'] * 0.5, 0.030, C['nose_h'] * 0.5), u=20, v=14)
for v in nose.data.vertices:
    if v.co.z > 0: v.co.z *= 1.15; v.co.x *= 0.92
L.translate_verts(nose, ball_c); add(nose, 'skin', 'head')

# ---- moustache: two full teardrop lobes meeting under the nose, thick near the centre, tapering to
#      slightly raised outer tips; flattened so it stands ~2 cm off the face
for s in (1, -1):
    zm = C['z_moustache']; hw = C['mo_w'] * 0.5
    pts = L.bezier((s * 0.000, 0, zm + 0.002), (s * hw * 0.38, 0, zm - 0.008), (s * hw * 0.74, 0, zm - 0.004), (s * hw, 0, zm + 0.016), n=16)
    pts = [tuple(on_face(x, z, 0.006)) for x, _, z in pts]
    rad = [C['mo_thick'] * 0.5 * (1.0 - 0.76 * L.smoothstep((i / 16 - 0.28) / 0.72) ** 1.15) for i in range(17)]
    mo = L.tube(f'Moustache{s}', pts, rad, n=12); flatten_to_face(mo, 0.55)
    add(mo, 'dark', 'head')

mc = L.uvsphere('MoustacheCentre', 1.0, (0, 0, 0), scale=(0.022, 0.012, C['mo_thick'] * 0.40), u=12, v=10)
L.translate_verts(mc, on_face(0, C['z_moustache'] - 0.004, 0.006)); add(mc, 'dark', 'head')

# ---- mouth: a subtle short smile under the moustache
pts = L.bezier((-C['mouth_w'] * 0.5, 0, C['z_mouth'] + 0.006), (-0.012, 0, C['z_mouth'] - 0.004), (0.012, 0, C['z_mouth'] - 0.004), (C['mouth_w'] * 0.5, 0, C['z_mouth'] + 0.006), n=8)
pts = [tuple(on_face(x, z, 0.002)) for x, _, z in pts]
add(L.tube('Mouth', pts, [0.0040 * t for t in L.taper(8, 0.5, 1.0, 0.5)], n=6), 'dark', 'head')

# =============================================================================================
# HAIR — a cap with its own measured silhouette (front width, side front/back depth by height),
# never thinner than 14 mm over the skull, swept to HIS RIGHT with a side part on HIS LEFT
# =============================================================================================
def _ztab(rows): return sorted([(zp(p), v) for p, v in rows])
HW_TAB = _ztab([(0.2, 0.09), (0.9, 0.125), (1.6, 0.145), (3.2, 0.165), (4.7, 0.183), (6.3, 0.208), (7.9, 0.224), (9.5, 0.226),
                (11.0, 0.218), (12.6, 0.209), (14.2, 0.204), (15.8, 0.198), (17.3, 0.193), (19.0, 0.188), (20.5, 0.184),
                (22.0, 0.176), (23.6, 0.163), (25.2, 0.148), (26.8, 0.130), (28.5, 0.112), (31.5, 0.09)])
HF_TAB = _ztab([(0.2, 0.16), (0.9, 0.222), (1.6, 0.248), (3.2, 0.255), (4.7, 0.249), (6.3, 0.236), (7.9, 0.212), (9.5, 0.20), (31.5, 0.20)])
HB_TAB = _ztab([(0.2, 0.02), (0.9, 0.045), (1.6, 0.071), (3.2, 0.110), (4.7, 0.138), (6.3, 0.150), (7.9, 0.165), (9.5, 0.192),
                (11.0, 0.224), (12.6, 0.234), (14.2, 0.230), (15.8, 0.222), (17.3, 0.211), (19.0, 0.198), (20.5, 0.182),
                (22.0, 0.165), (23.6, 0.146), (25.2, 0.118), (26.8, 0.098), (28.5, 0.078), (31.5, 0.07)])
HE_TAB = _ztab([(0.2, 2.3), (1.6, 2.6), (4.7, 2.75), (8.0, 2.75), (12.0, 2.7), (18.0, 2.6), (31.5, 2.5)])
HAIR_MIN = 0.014

def hairline_z(u):
    """Bottom edge of the hair by longitude: forehead 8.6 %, temples (lower on HIS RIGHT where the sweep
    lands), a sideburn lock down to the ear's centre, clear of the ear, then down to the nape."""
    a = abs(((u + 0.5) % 1.0) - 0.5)          # 0 front .. 0.5 back
    right = u < 0.5
    z_front = C['z_hairline']; z_temple = zp(10.4) if right else zp(8.8)
    z_sb = zp(21.5); z_ear = C['z_ear'] + C['ear_h'] * 0.5 + 0.008; z_behind = zp(20.0); z_nape = zp(27.8)
    if a < 0.10:  return z_front + (z_temple - z_front) * L.smoothstep(a / 0.10)
    if a < 0.135: return z_temple + (z_sb - z_temple) * L.smoothstep((a - 0.10) / 0.035)        # sideburn front edge
    if a < 0.165: return z_sb                                                                     # sideburn
    if a < 0.20:  return z_sb + (z_ear - z_sb) * L.smoothstep((a - 0.165) / 0.035)              # up over the ear
    if a < 0.29:  return z_ear
    if a < 0.40:  return z_ear + (z_nape - z_ear) * L.smoothstep((a - 0.29) / 0.11)              # behind the ear
    return z_nape

def hair_outer(u, z):
    """Outer hair surface at longitude u and height z (never inside HAIR_MIN of the skull)."""
    t = 2 * math.pi * u + math.pi / 2
    c, s = math.cos(t), math.sin(t)
    w = T(z, HW_TAB); df = T(z, HF_TAB); db = T(z, HB_TAB); e = T(z, HE_TAB); k = 2.0 / e
    x = math.copysign(abs(c) ** k, c) * w
    y = -(abs(s) ** k) * df if s >= 0 else (abs(s) ** k) * db
    top = L.smoothstep((C['z_hair_top'] - z) / 0.02)                       # 0 at the very top -> 1 below
    band = L.smoothstep((zp(1.5) - z) / 0.04) * L.smoothstep((z - zp(16.0)) / 0.05)   # 2..14 %: the sweep's mass
    # sweep: HIS RIGHT (-X) side fuller (about 2.5 cm), with a rounded lobe in the front-right quadrant
    if x < 0: x -= 0.016 * band * (abs(c) ** 0.5)
    lobe = math.exp(-((u - 0.10) ** 2) / (2 * 0.06 ** 2)) * math.exp(-((z - zp(8.0)) ** 2) / (2 * 0.055 ** 2))
    x *= 1.0 + 0.11 * lobe; y *= 1.0 + 0.06 * lobe
    # part on HIS LEFT (+X): a groove from the front hairline back over the crown, hair combed flat beyond it
    front = L.smoothstep((0.06 - y) / 0.10)                                # 1 in the front half, 0 at the back
    groove = math.exp(-((x - 0.10) ** 2) / (2 * 0.011 ** 2)) * front * L.smoothstep((z - (C['z_hairline'] + 0.015)) / 0.02)
    flat = L.smoothstep((x - 0.115) / 0.035) * front
    # lock grooves: three soft channels slanting across the top toward the lobe
    q = x + 0.45 * y
    locks = sum(math.exp(-((q - qc) ** 2) / (2 * 0.011 ** 2)) for qc in (-0.13, -0.045, 0.04)) * L.smoothstep((z - zp(9.0)) / 0.03)
    r_h = math.hypot(x, y)
    sk = skull_at(u, z); r_s = math.hypot(sk.x, sk.y)
    r = max(r_h, r_s + HAIR_MIN)
    r -= 0.010 * groove + 0.007 * locks
    r = r - (r - (r_s + 0.022)) * flat * (1.0 if r > r_s + 0.022 else 0.0)
    r = max(r, r_s + HAIR_MIN)
    f = r / max(1e-6, r_h)
    return Vector((x * f, y * f, z))

def hair_inner(u, z):
    sk = skull_at(u, z); r = math.hypot(sk.x, sk.y); f = max(0.0, r - 0.008) / max(1e-6, r)
    return Vector((sk.x * f, sk.y * f, z))

def hair_pt(u, v):
    ztop = C['z_hair_top']; zh = hairline_z(u)
    if v <= 0.0: return Vector((0.0, -0.08, ztop))
    if v >= 1.0: return Vector((0.0, 0.0, zt - 0.02))
    if v <= 0.60:
        s = (v / 0.60) ** 1.7
        return hair_outer(u, ztop - (ztop - zh) * s)
    if v <= 0.72:
        t = (v - 0.60) / 0.12
        po, pi_ = hair_outer(u, zh), hair_inner(u, zh + 0.006)
        m = (po + pi_) * 0.5 + Vector((0, 0, -0.55 * (po - pi_).length))
        return po * (1 - t) ** 2 + m * 2 * (1 - t) * t + pi_ * t * t
    s = (v - 0.72) / 0.28
    return hair_inner(u, zh + 0.006 + (zt - 0.02 - zh - 0.006) * s)
hair = L.shell('Hair', hair_pt, nlon=64, nlat=46, warp_u=0.0)
add(hair, 'hair', 'head')

# =============================================================================================
# BODY
# =============================================================================================
Z_SH_TOP, Z_HEM, Z_WAIST = C['z_shoulder_top'], C['z_hem'], C['z_waist']
JACKET_PROFILES = [
    dict(z=Z_HEM,                     w=C['jacket_w_hem'],      d=C['jacket_d_hem'],        r=0.62),
    dict(z=Z_HEM + 0.08,              w=C['jacket_w_hem']-0.01, d=C['jacket_d_hem']+0.015,  r=0.62),
    dict(z=Z_WAIST,                   w=C['jacket_w_waist'],    d=C['jacket_d_chest']-0.02, r=0.62),
    dict(z=Z_WAIST + 0.12,            w=C['jacket_w_waist']+0.05, d=C['jacket_d_chest'],    r=0.64),
    dict(z=C['z_shoulder_joint']+0.02, w=C['jacket_w_shoulder']-0.015, d=C['jacket_d_chest']-0.025, r=0.72),
    dict(z=C['z_shoulder_joint']+0.05, w=0.46,                   d=C['jacket_d_chest']-0.045, r=0.80),
    dict(z=Z_SH_TOP,                  w=0.39,                   d=C['jacket_d_chest']-0.065, r=0.90),
    dict(z=Z_SH_TOP + 0.030,          w=0.29,                   d=0.225,                    r=1.0),
    dict(z=Z_SH_TOP + 0.050,          w=0.245,                  d=0.215,                    r=1.0),
]
def _lerp_profile(z):
    ps = JACKET_PROFILES
    if z <= ps[0]['z']: return ps[0]
    if z >= ps[-1]['z']: return ps[-1]
    for a, b in zip(ps[:-1], ps[1:]):
        if a['z'] <= z <= b['z']:
            t = (z - a['z']) / (b['z'] - a['z'])
            return dict(z=z, w=a['w'] + (b['w'] - a['w']) * t, d=a['d'] + (b['d'] - a['d']) * t, r=a['r'] + (b['r'] - a['r']) * t)
    return ps[-1]
def chest_y(x, z):
    p = _lerp_profile(z); exp = 2.0 + 6.0 * (1.0 - p['r']); k = 2.0 / exp
    u = min(0.999, abs(x) / (p['w'] / 2)); c = u ** (1 / k); s = math.sqrt(max(0.0, 1 - c * c))
    return -(s ** k) * p['d'] / 2
add(L.loft('Jacket', JACKET_PROFILES, n=36), 'jacket', 'spine')

def flat_panel(name, outline_xz, inset, mat, bone, cuts=6):
    area = 0.0
    for (x0, z0), (x1, z1) in zip(outline_xz, outline_xz[1:] + outline_xz[:1]): area += x0 * z1 - x1 * z0
    if area < 0: outline_xz = list(reversed(outline_xz))
    bm = bmesh.new()
    verts = [bm.verts.new(Vector((x, 0.0, z))) for x, z in outline_xz]
    face = bm.faces.new(verts)
    bmesh.ops.triangulate(bm, faces=[face])
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    for v in bm.verts: v.co.y = chest_y(v.co.x, v.co.z) - inset
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    if sum(f.normal.y for f in bm.faces) > 0: bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    return add(L.new_object(name, bm, smooth=True), mat, bone)

# Shirt: a narrow, tidy V from the collar to the single button
BTN_Z = Z_WAIST + 0.05
flat_panel('Shirt', [(-0.056, Z_SH_TOP + 0.045), (-0.014, BTN_Z - 0.02), (0.014, BTN_Z - 0.02), (0.056, Z_SH_TOP + 0.045)], 0.004, 'shirt', 'spine')
# Peaked lapels (dark satin), thin, following the chest
for s in (1, -1):
    pts = [(s * 0.042, Z_SH_TOP + 0.040), (s * 0.110, Z_SH_TOP - 0.010), (s * 0.155, Z_SH_TOP - 0.100), (s * 0.118, Z_SH_TOP - 0.140), (s * 0.016, BTN_Z - 0.01)]
    flat_panel(f'Lapel{s}', pts, 0.009, 'lapel', 'spine')
# Collar band + wing tips
NY = C['neck_y']
add(L.loft('Collar', [dict(z=Z_SH_TOP - 0.005, w=2*C['neck_r']+0.026, d=2*C['neck_r']+0.02, r=1.0, y=NY), dict(z=Z_SH_TOP + 0.060, w=2*C['neck_r']+0.018, d=2*C['neck_r']+0.014, r=1.0, y=NY), dict(z=Z_SH_TOP + 0.066, w=2*C['neck_r']-0.01, d=2*C['neck_r']-0.01, r=1.0, y=NY)], n=22), 'shirt', 'neck')
add(L.loft('JacketCollar', [dict(z=Z_SH_TOP - 0.01, w=2*C['neck_r']+0.05, d=2*C['neck_r']+0.045, r=1.0, y=NY+0.012), dict(z=Z_SH_TOP + 0.052, w=2*C['neck_r']+0.036, d=2*C['neck_r']+0.032, r=1.0, y=NY+0.012), dict(z=Z_SH_TOP + 0.058, w=2*C['neck_r']+0.016, d=2*C['neck_r']+0.012, r=1.0, y=NY+0.012)], n=22), 'lapel', 'neck')
# Bow tie: small wings + knot
BOW_Z = Z_SH_TOP + 0.034
for s in (1, -1):
    wing = L.loft(f'Wing{s}', [dict(z=0.0, w=0.024, d=0.030, r=0.8), dict(z=0.034, w=0.056, d=0.038, r=0.7), dict(z=0.062, w=0.052, d=0.038, r=0.8), dict(z=0.076, w=0.022, d=0.030, r=1.0)], n=14)
    L.rotate_verts(wing, (0, s * math.pi / 2, 0))
    L.translate_verts(wing, (s * 0.010, chest_y(s * 0.035, BOW_Z) - 0.012, BOW_Z))
    add(wing, 'black', 'spine')
add(L.uvsphere('Knot', 0.020, (0, chest_y(0, BOW_Z) - 0.020, BOW_Z), scale=(0.9, 0.8, 1.05), u=12, v=8), 'black', 'spine')
# shirt studs + jacket button
for i in range(3):
    zb = BOW_Z - 0.055 - i * 0.045
    add(L.uvsphere(f'Stud{i}', 0.0065, (0, chest_y(0, zb) - 0.010, zb), u=8, v=6), 'black', 'spine')
add(L.uvsphere('Button', 0.011, (0, chest_y(0, BTN_Z) - 0.012, BTN_Z), scale=(1, 0.6, 1), u=10, v=8), 'black', 'spine')

# ---- arms: slim capsules with joint spheres; hang with a slight outward angle
SX, ZJ = C['shoulder_x'], C['z_shoulder_joint']
for s, tag in ((1, 'L'), (-1, 'R')):
    ex = s * (SX + 0.045); ey = -0.010
    hx = s * C['hand_x']; hy = -0.045
    add(L.uvsphere(f'Shoulder{tag}', C['upperarm_r'] * 0.90, (s * (SX - 0.035), 0.0, ZJ - 0.02), u=14, v=10), 'jacket', f'upperarm.{tag}')
    ua = L.capsule(f'UpperArm{tag}', C['upperarm_r'], C['upperarm_r'] * 0.9, ZJ, C['z_elbow'] - 0.01, n=16, rings=4)
    for v in ua.data.vertices:
        t = (ZJ - v.co.z) / (ZJ - C['z_elbow']); v.co.x += s * SX + (ex - s * SX) * t; v.co.y += ey * t
    add(ua, 'jacket', f'upperarm.{tag}')
    add(L.uvsphere(f'Elbow{tag}', C['upperarm_r'] * 0.86, (ex, ey, C['z_elbow']), u=14, v=10), 'jacket', f'upperarm.{tag}')
    fa = L.capsule(f'Forearm{tag}', C['forearm_r'], C['forearm_r'] * 0.86, C['z_elbow'] + 0.01, C['z_wrist'] - 0.005, n=16, rings=4)
    for v in fa.data.vertices:
        t = (C['z_elbow'] + 0.01 - v.co.z) / (C['z_elbow'] - C['z_wrist']); v.co.x += ex + (hx - ex) * t; v.co.y += ey + (hy - ey) * t
    add(fa, 'jacket', f'forearm.{tag}')
    cuff = L.loft(f'Cuff{tag}', [dict(z=C['z_wrist'] - 0.006, w=2*C['forearm_r']*0.9, d=2*C['forearm_r']*0.9, r=1.0), dict(z=C['z_wrist'] + 0.018, w=2*C['forearm_r']*0.88, d=2*C['forearm_r']*0.88, r=1.0)], n=14)
    L.translate_verts(cuff, (hx, hy, 0)); add(cuff, 'shirt', f'forearm.{tag}')
    # hand: a rounded mitt (slightly flattened), softly grouped fingers as a bevelled front, a thumb on the inside
    hand = L.loft(f'Hand{tag}', [dict(z=C['z_hand_end'], w=C['hand_w']*0.70, d=0.045, r=0.9), dict(z=C['z_hand_end']+0.03, w=C['hand_w'], d=0.058, r=0.75),
                                 dict(z=C['z_hand_end']+0.075, w=C['hand_w']*0.98, d=0.060, r=0.7), dict(z=C['z_wrist']+0.01, w=C['hand_w']*0.72, d=0.050, r=0.95)], n=16)
    L.translate_verts(hand, (hx, hy, 0)); add(hand, 'skin', f'hand.{tag}')
    add(L.uvsphere(f'Thumb{tag}', 1.0, (0, 0, 0), scale=(0.016, 0.018, 0.030), u=10, v=8), 'skin', f'hand.{tag}')
    parts[-1].data.transform(__import__('mathutils').Matrix.Translation(Vector((hx - s * (C['hand_w']*0.5 + 0.006), hy - 0.012, C['z_wrist'] - 0.035))))

# ---- legs: capsules (slightly deeper than wide, like the sheet), knee spheres, lofted shoes
LX = C['leg_x']
for s, tag in ((1, 'L'), (-1, 'R')):
    lx = s * LX
    add(L.uvsphere(f'HipBall{tag}', 1.0, (lx, 0.0, C['z_hip_joint'] + 0.02), scale=(C['thigh_w']*0.5, C['thigh_d']*0.5, 0.075), u=14, v=10), 'jacket', f'thigh.{tag}')
    th = L.loft(f'Thigh{tag}', [dict(z=C['z_knee'] - 0.01, w=C['thigh_w']*0.92, d=C['thigh_d']*0.86, r=1.0), dict(z=(C['z_knee']+C['z_hip_joint'])/2, w=C['thigh_w'], d=C['thigh_d'], r=1.0), dict(z=C['z_hip_joint'] + 0.05, w=C['thigh_w']*0.98, d=C['thigh_d']*0.98, r=1.0)], n=18)
    L.translate_verts(th, (lx, 0, 0)); add(th, 'jacket', f'thigh.{tag}')
    add(L.uvsphere(f'Knee{tag}', 1.0, (lx, 0.0, C['z_knee']), scale=(C['shin_w']*0.5*0.98, C['shin_d']*0.5, 0.075), u=14, v=10), 'jacket', f'thigh.{tag}')
    sh = L.loft(f'Shin{tag}', [dict(z=C['z_ankle'] - 0.005, w=C['shin_w']*0.98, d=C['shin_d']*0.92, r=1.0), dict(z=(C['z_ankle']+C['z_knee'])/2, w=C['shin_w']*0.96, d=C['shin_d']*0.96, r=1.0), dict(z=C['z_knee'] + 0.01, w=C['shin_w'], d=C['shin_d'], r=1.0)], n=18)
    L.translate_verts(sh, (lx, 0, 0)); add(sh, 'jacket', f'shin.{tag}')
    L0, W0, H0 = C['shoe_len'], C['shoe_w'], C['shoe_h']
    # a rounded slip-on: toe well forward of the ankle, a short heel behind it; toes splayed OUTWARD
    yc = -(L0 * 0.5 - 0.075)
    shoe = L.loft(f'Shoe{tag}', [
        dict(z=0.0,        w=W0*0.90, d=L0*0.94, r=0.60, y=yc),
        dict(z=H0*0.40,    w=W0,      d=L0,      r=0.60, y=yc),
        dict(z=H0*0.75,    w=W0*0.90, d=L0*0.88, r=0.62, y=yc + 0.012),
        dict(z=H0,         w=W0*0.68, d=L0*0.50, r=0.75, y=-0.045)], n=22)
    L.rotate_verts(shoe, (0, 0, s * C['shoe_splay']), about=(0, 0.05, 0)); L.translate_verts(shoe, (lx, 0, 0)); add(shoe, 'black', f'foot.{tag}')

# =============================================================================================
# JOIN + RIG
# =============================================================================================
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
mesh = bpy.context.active_object; mesh.name = 'Victor'; mesh.location = (0, 0, 0)
L.smooth_normals(mesh, 62.0)

arm_data = bpy.data.armatures.new('VictorRig'); arm = bpy.data.objects.new('VictorRig', arm_data)
scene.collection.objects.link(arm); bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT'); eb = arm_data.edit_bones
def bone(name, head, tail, parent=None):
    b = eb.new(name); b.head = head; b.tail = tail; b.roll = 0.0
    if parent: b.parent = eb[parent]
    return b
HIPJ, KNEE, ANKLE = C['z_hip_joint'], C['z_knee'], C['z_ankle']
bone('root',  (0, 0, 0), (0, 0, 0.12))
bone('hips',  (0, 0, HIPJ), (0, 0, Z_WAIST + 0.02), 'root')
bone('spine', (0, 0, Z_WAIST + 0.02), (0, 0, Z_SH_TOP), 'hips')
bone('neck',  (0, 0, Z_SH_TOP), (0, 0, C['z_chin'] + 0.02), 'spine')
bone('head',  (0, 0, C['z_chin'] + 0.02), (0, 0, C['z_skull_top']), 'neck')
for s, tag in ((1, 'L'), (-1, 'R')):
    ex = s * (SX + 0.045); hx = s * C['hand_x']
    bone(f'shoulder.{tag}', (s * 0.08, 0, Z_SH_TOP - 0.03), (s * SX, 0, ZJ), 'spine')
    bone(f'upperarm.{tag}', (s * SX, 0, ZJ), (ex, -0.010, C['z_elbow']), f'shoulder.{tag}')
    bone(f'forearm.{tag}',  (ex, -0.010, C['z_elbow']), (hx, -0.035, C['z_wrist']), f'upperarm.{tag}')
    bone(f'hand.{tag}',     (hx, -0.035, C['z_wrist']), (hx, -0.04, C['z_hand_end']), f'forearm.{tag}')
    lx = s * LX
    bone(f'thigh.{tag}', (lx, 0, HIPJ), (lx, 0, KNEE), 'hips')
    bone(f'shin.{tag}',  (lx, 0, KNEE), (lx, 0, ANKLE), f'thigh.{tag}')
    bone(f'foot.{tag}',  (lx, 0, ANKLE), (lx, -0.18, 0.02), f'shin.{tag}')
bpy.ops.object.mode_set(mode='OBJECT')
amod = mesh.modifiers.new('Armature', 'ARMATURE'); amod.object = arm; mesh.parent = arm

# =============================================================================================
# ANIMATION (same authoring as v2, on the new joints)
# =============================================================================================
FPS = 24; scene.render.fps = FPS
bpy.context.view_layer.objects.active = arm; bpy.ops.object.mode_set(mode='POSE')
for pb in arm.pose.bones: pb.rotation_mode = 'XYZ'
def key(bname, frame, rx=0.0, ry=0.0, rz=0.0, loc=None):
    pb = arm.pose.bones[bname]; pb.rotation_euler = (rx, ry, rz); pb.keyframe_insert('rotation_euler', frame=frame)
    if loc is not None: pb.location = loc; pb.keyframe_insert('location', frame=frame)
def new_action(name):
    arm.animation_data_create(); act = bpy.data.actions.new(name); act.use_fake_user = True; arm.animation_data.action = act; return act
def fwd(a): return -a
def stance_knee(phi): return max(0.0, math.sin(2 * math.pi * phi)) * 0.16 if phi < 0.5 else 0.0
def swing_knee(phi): return 0.0 if phi < 0.5 else max(0.0, math.sin(2 * math.pi * (phi - 0.5))) * 1.05

new_action('Walk'); WALK_N = 24; A_LEG = 0.50; A_ARM = 0.40
def thigh_angle(phi):
    c = math.cos(2 * math.pi * phi); return A_LEG * math.copysign(abs(c) ** 0.85, c)
for f in range(WALK_N + 1):
    t = f / WALK_N
    for tag, phi in (('L', t), ('R', (t + 0.5) % 1.0)):
        th = thigh_angle(phi); kn = stance_knee(phi) + swing_knee(phi)
        ft = -(fwd(th) + kn) * 0.9 if phi < 0.5 else -(fwd(th) + kn) * 0.45 + 0.10 * math.sin(2 * math.pi * (phi - 0.5))
        key(f'thigh.{tag}', f, rx=fwd(th)); key(f'shin.{tag}', f, rx=kn); key(f'foot.{tag}', f, rx=ft)
        arm_ph = (phi + 0.5) % 1.0; ua = A_ARM * math.cos(2 * math.pi * arm_ph)
        key(f'upperarm.{tag}', f, rx=fwd(ua), rz=-0.06 * (1 if tag == 'L' else -1))
        key(f'forearm.{tag}', f, rx=fwd(0.16 + 0.28 * (0.5 + 0.5 * math.cos(2 * math.pi * arm_ph))))
        key(f'hand.{tag}', f, rx=fwd(0.05))
    bob = -0.020 * (0.5 + 0.5 * math.cos(4 * math.pi * t)); sway = 0.010 * math.sin(2 * math.pi * t)
    key('hips', f, rz=0.06 * math.cos(2 * math.pi * t), loc=(sway, bob, 0.0))
    key('spine', f, rx=0.05, rz=-0.045 * math.cos(2 * math.pi * t))
    key('neck', f, rx=-0.03); key('head', f, rz=0.02 * math.cos(2 * math.pi * t), rx=0.01 * math.cos(4 * math.pi * t))
    key('shoulder.L', f, ry=0.0); key('shoulder.R', f, ry=0.0)
scene.frame_set(0); bpy.context.view_layer.update()
def world(pb_name, tail=False):
    pb = arm.pose.bones[pb_name]; return arm.matrix_world @ (pb.tail if tail else pb.head)
STEP = abs(world('foot.L').y - world('foot.R').y); STRIDE = 2 * STEP
toe_min = 9; toe_max = -9
for f in range(WALK_N + 1):
    scene.frame_set(f); bpy.context.view_layer.update()
    for tag in ('L', 'R'):
        tz = world(f'foot.{tag}', tail=True).z; toe_min = min(toe_min, tz); toe_max = max(toe_max, tz)
print(f'REPORT step={STEP:.3f} stride={STRIDE:.3f} toe_z=[{toe_min:.3f},{toe_max:.3f}]')

new_action('Idle'); IDLE_N = 72
for f in range(IDLE_N + 1):
    t = f / IDLE_N; br = math.sin(2 * math.pi * t); sw = math.sin(2 * math.pi * t * 0.5 + 0.8)
    key('hips', f, rz=0.010 * sw, loc=(0.005 * sw, 0.004 * br, 0.0))
    key('spine', f, rx=0.035 + 0.016 * br, rz=-0.007 * sw); key('neck', f, rx=-0.015)
    key('head', f, rx=0.010 * math.sin(2 * math.pi * t + 0.9), rz=0.012 * math.sin(2 * math.pi * t * 0.5))
    for tag, s in (('L', 1), ('R', -1)):
        key(f'thigh.{tag}', f, rx=0.0); key(f'shin.{tag}', f, rx=0.0); key(f'foot.{tag}', f, rx=0.0)
        key(f'upperarm.{tag}', f, rx=fwd(0.03 * br + 0.02), rz=-s * 0.06, ry=0.0)
        key(f'forearm.{tag}', f, rx=fwd(0.14 + 0.03 * br)); key(f'hand.{tag}', f, rx=fwd(0.04)); key(f'shoulder.{tag}', f, ry=0.0)
bpy.ops.object.mode_set(mode='OBJECT')
arm['strideLength'] = round(STRIDE, 4); arm['walkClipSeconds'] = round(WALK_N / FPS, 4); mesh['strideLength'] = round(STRIDE, 4)

tris = L.tri_count(mesh)
print(f'REPORT tris={tris} materials={len(mesh.data.materials)} verts={len(mesh.data.vertices)} height={H}')
out = REPO / 'assets' / 'characters' / 'victor.glb'; out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True); mesh.select_set(True); bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', use_selection=True, export_apply=False, export_animations=True,
                          export_animation_mode='ACTIONS', export_yup=True, export_morph=False, export_extras=True)
print(f'REPORT file_bytes={out.stat().st_size} path={out}')
