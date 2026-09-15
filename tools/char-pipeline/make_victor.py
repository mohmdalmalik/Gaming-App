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
    ear_h=0.112, ear_w=0.072, ear_out=0.048, ear_y=0.030, ear_tilt=0.50,
    eye_x=0.070, eye_w=0.038, eye_h=0.066,
    brow_x0=0.040, brow_x1=0.116, brow_thick=0.024, brow_arch=0.014,
    nose_w=0.076, nose_h=0.062, nose_out=0.042, bridge_h=0.012,
    mo_w=0.185, mo_thick=0.060, mo_out=0.020,
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
    shoe_len=0.370, shoe_w=0.190, shoe_h=0.078, shoe_splay=0.26,
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
    'skin':   L.solid_material('Skin',   '#f0b992'),   # warm peach: one step lighter/less saturated than the sheet's lit skin (#f4a877) so the warm hall light lands near it
    'hair':   L.solid_material('Hair',   '#26201b'),   # dark cocoa: desaturated so the warm hall light reads cocoa, not caramel — authored dark: under the hall's overhead lights the crown renders 2-3x brighter than the sides
    'jacket': L.solid_material('Jacket', '#1f2c50'),   # midnight navy
    'lapel':  L.solid_material('Lapel',  '#161d36'),   # satin facing: a shade darker than the cloth
    'shirt':  L.solid_material('Shirt',  '#f3eee2'),   # ivory
    'black':  L.solid_material('Black',  '#111116'),   # bow tie, shoes, buttons
    'shoe':   L.solid_material('Shoe',   '#34353b'),   # charcoal-black leather: black enough, light enough for the toe/instep/heel to read as form
    'dark':   L.solid_material('Dark',   '#221812'),   # brows, moustache, eyes, mouth (near the hair tone)
}
parts = []
def add(ob, mat, bone):
    L.assign(ob, M[mat], bone); parts.append(ob); return ob

# =============================================================================================
# HEAD
# =============================================================================================
skull = L.shell('Skull', skull_pt, nlon=56, nlat=36, warp_u=0.08)
# Nose bridge as part of the face: a soft ridge raised out of the skull surface from between the
# brows down into the nose ball (so the nose grows out of the face instead of sitting on it).
Z_BR_TOP, Z_BR_BOT = C['z_eye'] + 0.012, C['z_nose'] + 0.020
for v in skull.data.vertices:
    if v.co.y >= -0.05 or abs(v.co.x) > 0.045: continue
    g = math.exp(-(v.co.x ** 2) / (2 * 0.011 ** 2))
    h = L.smoothstep((Z_BR_TOP - v.co.z) / 0.030) * L.smoothstep((v.co.z - (Z_BR_BOT - 0.025)) / 0.02)
    v.co.y -= C['bridge_h'] * g * h
skull.data.update()
# cheek fullness beside the nose/moustache and a softly forward chin (small, so features placed on
# the analytic face stay seated)
L.shape(skull, [
    dict(c=( 0.15, -0.16, zp(21.5)), r=0.085, d=( 0.004, -0.005, 0)),
    dict(c=(-0.15, -0.16, zp(21.5)), r=0.085, d=(-0.004, -0.005, 0)),
    dict(c=(0, -0.19, zp(30.0)), r=0.07, d=(0, -0.006, 0)),
])
add(skull, 'skin', 'head')
# neck: a short thick cylinder, set a little forward so the nape curves in; hidden by chin and collar
add(L.loft('Neck', [dict(z=C['z_shoulder_top'] - 0.03, w=2*C['neck_r'], d=2*C['neck_r']*0.92, r=1.0, y=C['neck_y']),
                    dict(z=C['z_chin'] + 0.05, w=2*C['neck_r']*0.92, d=2*C['neck_r']*0.86, r=1.0, y=C['neck_y'])], n=18), 'skin', 'neck')

# ---- ears: a shaped outer rim (rounded tube around an oval) with a recessed inner form, angled
#      to face forward-and-out like the sheet's; a filler behind the rim so the head shows through nowhere
for s_ in (1, -1):
    tilt = C['ear_tilt']
    n_ = Vector((s_ * math.cos(tilt), -math.sin(tilt), 0.0))               # ear plane normal (out + forward)
    A = Vector((0, 0, 1)).cross(n_).normalized()                            # in-plane, front-back
    sk = T(C['z_ear'], W_TAB)
    Cc = Vector((s_ * (sk + C['ear_out'] - 0.030), C['ear_y'], C['z_ear']))
    aw, bh = C['ear_w'] * 0.5 - 0.008, C['ear_h'] * 0.5 - 0.008
    loop = [tuple(Cc + A * (aw * math.cos(t) * (1.0 if math.cos(t) > 0 else 0.9)) + Vector((0, 0, bh * math.sin(t) * (1.0 if math.sin(t) > 0 else 0.92)))) for t in [k / 18 * 2 * math.pi for k in range(18)]]
    add(L.planar_ring_tube(f'EarRim{s_}', loop, 0.0085, n_, n=8), 'skin', 'head')
    inner = L.uvsphere(f'EarInner{s_}', 1.0, (0, 0, 0), scale=(1.0, 1.0, 1.0), u=16, v=12)
    for v in inner.data.vertices:                                           # a shallow dish in the ear frame
        x, y, z = v.co.x, v.co.y, v.co.z
        v.co = Cc + A * (x * aw * 0.98) + Vector((0, 0, z * bh * 0.98)) + n_ * (y * 0.005 - 0.0035)
    add(inner, 'skin', 'head')
    back = L.uvsphere(f'EarBack{s_}', 1.0, (0, 0, 0), u=14, v=10)             # joins rim to the skull
    for v in back.data.vertices:
        x, y, z = v.co.x, v.co.y, v.co.z
        v.co = Cc + A * (x * aw * 0.85) + Vector((0, 0, z * bh * 0.85)) + n_ * (y * 0.012 - 0.014)
    add(back, 'skin', 'head')

# ---- eyes: dark vertical ovals set flush into the face (sheet size: 0.038 x 0.066), no highlight beads
for s_ in (1, -1):
    p = on_face(s_ * C['eye_x'], C['z_eye'], 0.005)
    eye = L.uvsphere(f'Eye{s_}', 1.0, (0, 0, 0), scale=(C['eye_w'] * 0.5, 0.012, C['eye_h'] * 0.5), u=18, v=14)
    L.translate_verts(eye, p)
    add(eye, 'dark', 'head')

# ---- brows: slim, one smooth gentle arch, blunt inner end, tapered outer end, low relief
for s_ in (1, -1):
    zb = C['z_brow']; x0, x1 = C['brow_x0'], C['brow_x1']; a = C['brow_arch']
    pts = L.bezier((s_ * x0, 0, zb - 0.004), (s_ * (x0 + 0.34 * (x1 - x0)), 0, zb + a), (s_ * (x0 + 0.66 * (x1 - x0)), 0, zb + a * 0.9), (s_ * x1, 0, zb - 0.012), n=14)
    pts = [tuple(on_face(x, z, 0.005)) for x, _, z in pts]
    rad = [C['brow_thick'] * 0.5 * (0.70 + 0.30 * math.sin(math.pi * min(1.0, i / 8)) if i < 9 else 0.35 + 0.65 * (1 - ((i - 9) / 5) ** 1.2)) for i in range(15)]
    br = L.tube(f'Brow{s_}', pts, rad, n=10); flatten_to_face(br, 0.45)
    add(br, 'dark', 'head')

# ---- nose: the ball at the end of the bridge ridge (the bridge itself is raised from the skull above)
ball_c = on_face(0, C['z_nose'], C['nose_out'] - 0.030)
nose = L.uvsphere('NoseBall', 1.0, (0, 0, 0), scale=(C['nose_w'] * 0.5, 0.030, C['nose_h'] * 0.5), u=20, v=14)
for v in nose.data.vertices:
    if v.co.z > 0: v.co.z *= 1.25; v.co.x *= 0.88                            # egg: taller above, merging up into the bridge
L.translate_verts(nose, ball_c); add(nose, 'skin', 'head')

# ---- moustache: two compact rounded lobes, a small notch under the nose, thickest a third of the
#      way out, thinning to short restrained upturned tips; low relief (about 2 cm off the face)
for s_ in (1, -1):
    zm = C['z_moustache']; hw = C['mo_w'] * 0.5
    pts = L.bezier((s_ * 0.004, 0, zm + 0.004), (s_ * hw * 0.36, 0, zm - 0.006), (s_ * hw * 0.74, 0, zm - 0.008), (s_ * hw, 0, zm + 0.012), n=16)
    pts = [tuple(on_face(x, z, 0.005)) for x, _, z in pts]
    prof = [0.40, 0.62, 0.82, 0.95, 1.0, 1.0, 0.97, 0.92, 0.85, 0.76, 0.66, 0.55, 0.45, 0.36, 0.28, 0.22, 0.17]
    mo = L.tube(f'Moustache{s_}', pts, [C['mo_thick'] * 0.5 * k for k in prof], n=12); flatten_to_face(mo, 0.42)
    add(mo, 'dark', 'head')

# ---- mouth: a subtle short smile under the moustache
pts = L.bezier((-C['mouth_w'] * 0.5, 0, C['z_mouth'] + 0.006), (-0.012, 0, C['z_mouth'] - 0.004), (0.012, 0, C['z_mouth'] - 0.004), (C['mouth_w'] * 0.5, 0, C['z_mouth'] + 0.006), n=8)
pts = [tuple(on_face(x, z, 0.002)) for x, _, z in pts]
add(L.tube('Mouth', pts, [0.0040 * t for t in L.taper(8, 0.5, 1.0, 0.5)], n=6), 'dark', 'head')

# =============================================================================================
# HAIR — a cap with its own measured silhouette (front width, side front/back depth by height),
# never thinner than 14 mm over the skull, swept to HIS RIGHT with a side part on HIS LEFT
# =============================================================================================
CAP_DROP = 1.0   # % of height: the smooth cap sits this much lower; the lock volumes make up the crown
def _ztab(rows): return sorted([(zp(p + CAP_DROP), v) for p, v in rows])
HW_TAB = _ztab([(0.2, 0.09), (0.9, 0.125), (1.6, 0.145), (3.2, 0.165), (4.7, 0.183), (6.3, 0.208), (7.9, 0.224), (9.5, 0.226),
                (11.0, 0.218), (12.6, 0.209), (14.2, 0.204), (15.8, 0.198), (17.3, 0.193), (19.0, 0.188), (20.5, 0.184),
                (22.0, 0.176), (23.6, 0.163), (25.2, 0.148), (26.8, 0.130), (28.5, 0.112), (31.5, 0.09)])
HF_TAB = _ztab([(0.2, 0.15), (0.9, 0.205), (1.6, 0.240), (3.2, 0.255), (4.7, 0.249), (6.3, 0.236), (7.9, 0.212), (9.5, 0.20), (31.5, 0.20)])
HB_TAB = _ztab([(0.2, 0.02), (0.9, 0.045), (1.6, 0.071), (3.2, 0.110), (4.7, 0.138), (6.3, 0.150), (7.9, 0.165), (9.5, 0.192),
                (11.0, 0.224), (12.6, 0.234), (14.2, 0.230), (15.8, 0.222), (17.3, 0.211), (19.0, 0.198), (20.5, 0.182),
                (22.0, 0.165), (23.6, 0.146), (25.2, 0.118), (26.8, 0.098), (28.5, 0.078), (31.5, 0.07)])
HE_TAB = _ztab([(0.2, 2.2), (1.6, 2.4), (4.7, 2.7), (8.0, 2.75), (12.0, 2.7), (18.0, 2.6), (31.5, 2.5)])
HAIR_MIN = 0.014

def hairline_z(u):
    """Bottom edge of the hair by longitude: forehead 8.6 %, temples (lower on HIS RIGHT where the sweep
    lands), a sideburn lock down to the ear's centre, clear of the ear, then down to the nape."""
    a = abs(((u + 0.5) % 1.0) - 0.5)          # 0 front .. 0.5 back
    right = u < 0.5
    z_front = C['z_hairline']; z_temple = zp(10.4) if right else zp(8.8)
    z_sb = zp(21.5); z_ear = C['z_ear'] + C['ear_h'] * 0.5 + 0.008; z_behind = zp(20.0); z_nape = zp(27.4)
    if a < 0.10:  return z_front + (z_temple - z_front) * L.smoothstep(a / 0.10)
    if a < 0.135: return z_temple + (z_sb - z_temple) * L.smoothstep((a - 0.10) / 0.035)        # sideburn front edge
    if a < 0.165: return z_sb                                                                     # sideburn
    if a < 0.20:  return z_sb + (z_ear - z_sb) * L.smoothstep((a - 0.165) / 0.035)              # up over the ear
    if a < 0.29:  return z_ear
    if a < 0.40:  return z_ear + (z_nape - z_ear) * L.smoothstep((a - 0.29) / 0.11)              # behind the ear
    return z_nape

# Sheet frame (from the turnaround analysis): x = -1 HIS RIGHT ear edge .. +1 his left ear edge;
# f = 0 forehead plane .. 1 rearmost hair; y = 0 hair top .. 1 chin. Converted to the cap's (u, z %).
def uz_from_sheet(x, f, y):
    xb = x * 0.243; yb = -0.233 + f * 0.467
    t = math.atan2(-yb / 0.234, xb / 0.243); u = ((t - math.pi / 2) / (2 * math.pi)) % 1.0
    return u, y * 31.3
def periodic_table(pts):
    tab = sorted(uz_from_sheet(*p_) for p_ in pts)
    def fn(u):
        u %= 1.0
        ext = [(a - 1.0, b) for a, b in tab] + tab + [(a + 1.0, b) for a, b in tab]
        for (ua, za), (ub, zb) in zip(ext[:-1], ext[1:]):
            if ua <= u <= ub:
                t = 0.0 if ub == ua else (u - ua) / (ub - ua); return zp(za + (zb - za) * t)
        return zp(tab[0][1])
    return fn
# T (crown leaf) boundary: its lip over W from the part across the crown to the right-rear tip, then its
# lower lip across the back, then up the part step
z_T = periodic_table([(0.45, 0.05, 0.02), (0.15, 0.15, 0.02), (-0.20, 0.06, 0.10), (-0.45, 0.10, 0.17), (-0.65, 0.18, 0.25),
                      (-0.85, 0.32, 0.25), (-0.97, 0.44, 0.22), (-1.00, 0.60, 0.24), (-1.00, 0.84, 0.25), (-1.00, 0.88, 0.26),
                      (-0.81, 0.95, 0.30), (-0.57, 0.97, 0.33), (-0.22, 0.98, 0.28), (0.13, 0.97, 0.24), (0.51, 0.93, 0.18),
                      (0.55, 0.60, 0.15), (0.55, 0.30, 0.15)])
# W (main sweep) lower edge: the fringe at the front, then the crease over the side band above his right ear
z_W = periodic_table([(0.50, 0.00, 0.22), (0.00, 0.00, 0.27), (-0.40, 0.00, 0.31), (-0.63, 0.02, 0.36), (-0.90, 0.15, 0.34),
                      (-1.00, 0.31, 0.33), (-1.00, 0.60, 0.34), (-1.00, 0.95, 0.35), (-0.60, 0.99, 0.60), (0.20, 0.99, 0.60), (0.55, 0.50, 0.60)])
def w_band(u):
    """W exists from the part (his left-front) round the front and along his right side to the right-rear."""
    a = ((u + 0.5) % 1.0) - 0.5          # -0.5..0.5, 0 front, + his right
    return L.smoothstep((a + 0.14) / 0.04) * L.smoothstep((0.47 - a) / 0.06)

def hair_outer(u, z):
    """Outer hair surface at longitude u and height z (never inside HAIR_MIN of the skull)."""
    t = 2 * math.pi * u + math.pi / 2
    c, s = math.cos(t), math.sin(t)
    # the crown's highest region sits a little on HIS LEFT of centre; toward his right the top descends gently
    right = L.smoothstep((-c - 0.05) / 0.6)                                # c<0 -> -X (his right)
    z_eff = z + 0.018 * right * L.smoothstep((z - zp(9.0)) / 0.06)
    w = T(z_eff, HW_TAB); df = T(z_eff, HF_TAB); db = T(z_eff, HB_TAB); e = T(z_eff, HE_TAB); k = 2.0 / e
    x = math.copysign(abs(c) ** k, c) * w
    y = -(abs(s) ** k) * df if s >= 0 else (abs(s) ** k) * db
    top = L.smoothstep((zp(CAP_DROP + 0.2) - z) / 0.02)                    # 0 at the very top -> 1 below
    band = L.smoothstep((zp(1.5) - z) / 0.04) * L.smoothstep((z - zp(16.0)) / 0.05)   # 2..14 %: the sweep's mass
    # sweep: HIS RIGHT (-X) side fuller (about 2.5 cm), with a rounded lobe in the front-right quadrant
    if x < 0: x -= 0.016 * band * (abs(c) ** 0.5)
    lobe = math.exp(-((u - 0.10) ** 2) / (2 * 0.06 ** 2)) * math.exp(-((z - zp(8.0)) ** 2) / (2 * 0.055 ** 2))
    x *= 1.0 + 0.11 * lobe; y *= 1.0 + 0.06 * lobe
    r_h = math.hypot(x, y)
    sk = skull_at(u, z); r_s = math.hypot(sk.x, sk.y)
    r = max(r_h, r_s + HAIR_MIN)
    # PART STEP on HIS LEFT (+X): beyond x = +0.13 the crown hair is combed flat (close to the skull), so
    # the top drops abruptly there — the sheet's strongest cue that the hair is parted on his left
    crown = L.smoothstep((z - zp(11.0)) / 0.03)
    stepw = L.smoothstep((x - 0.134) / 0.014) * crown
    r_flat = r_s + 0.024
    if r > r_flat: r = r - (r - r_flat) * stepw
    # LOCK REGIONS (raised areas of the cap; their edges are the sheet's crease lines): T = the crown leaf
    # on top (1 cm), W = the main sweep under it (0.6 cm). Both stop at the part step.
    inT = L.smoothstep((z - z_T(u)) / 0.012) * (1.0 - stepw)
    inW = L.smoothstep((z - z_W(u)) / 0.010) * w_band(u) * (1.0 - stepw)
    r += 0.010 * inT + 0.006 * inW
    r = max(r, r_s + HAIR_MIN)
    f = r / max(1e-6, r_h)
    return Vector((x * f, y * f, z))

def hair_inner(u, z):
    sk = skull_at(u, z); r = math.hypot(sk.x, sk.y); f = max(0.0, r - 0.008) / max(1e-6, r)
    return Vector((sk.x * f, sk.y * f, z))

def hair_pt(u, v):
    ztop = zp(CAP_DROP + 0.2); zh = hairline_z(u)
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

# ---- LOCKS: 3-4 swept volumes lying on the cap (half embedded), forming the raised front wave and
#      the sweep to HIS RIGHT. Keys: (u unwrapped: 0 front, +0.25 his right, -0.25 his left; z % from
#      top; width across the surface; thickness along the normal; lift of the centre line above the cap)
Z_CAP_TOP = zp(CAP_DROP + 0.2)
def hair_normal(u, z, e=1e-3):
    z = min(z, Z_CAP_TOP - 0.003)
    du = hair_outer((u + e) % 1.0, z) - hair_outer((u - e) % 1.0, z)
    dz = hair_outer(u, min(z + e, Z_CAP_TOP - 0.002)) - hair_outer(u, z - e)
    n = du.cross(dz)
    if n.length < 1e-12: return Vector((0, 0, 1))
    n.normalize()
    c = hair_outer(u, z)
    if n.dot(Vector((c.x, c.y, c.z - zp(15.0)))) < 0: n = -n         # outward: away from the head centre
    return n
def lock(name, keys, n_samples=26, n_ring=12):
    pts, nrm, ws, ts = [], [], [], []
    for k in L.catmull_rom(keys, n_samples):
        u = k[0] % 1.0; z = min(zp(k[1]), Z_CAP_TOP - 0.003)
        base = hair_outer(u, z); n = hair_normal(u, z)
        pts.append(tuple(base + n * k[4])); nrm.append(tuple(n)); ws.append(max(0.004, k[2])); ts.append(max(0.004, k[3]))
    return add(L.ribbon_tube(name, pts, nrm, ws, ts, n=n_ring), 'hair', 'head')
# W's rounded roll (the sheet's shoulder line): from the part, across the front-top, curling round his
# right temple, then back along his right side above the ear, tapering to a point at the right-rear.
# Keys: (u, z %) from the sheet frame, width across the surface, thickness (2 x protrusion), lift 0.
W_C = [(0.50, 0.02, 0.12, 0.020, 0.006), (0.30, 0.00, 0.13, 0.095, 0.030), (0.00, 0.00, 0.14, 0.105, 0.040), (-0.35, -0.02, 0.20, 0.130, 0.052),
       (-0.65, 0.05, 0.25, 0.135, 0.050), (-0.95, 0.20, 0.27, 0.090, 0.028), (-1.00, 0.45, 0.28, 0.062, 0.020), (-1.00, 0.70, 0.29, 0.050, 0.014),
       (-0.92, 0.95, 0.31, 0.020, 0.006)]
keys = []
for k, (x_, f_, y_, wd, th) in enumerate(W_C):
    u_, zpc = uz_from_sheet(x_, f_, y_)
    if keys and u_ < keys[-1][0] - 0.5: u_ += 1.0        # unwrap across the front
    keys.append((u_, zpc, wd, th, -0.012 if k in (0, len(W_C) - 1) else 0.0))
lock('LockW', keys, n_samples=30)

# =============================================================================================
# BODY
# =============================================================================================
Z_SH_TOP, Z_HEM, Z_WAIST = C['z_shoulder_top'], C['z_hem'], C['z_waist']
JACKET_PROFILES = [
    dict(z=Z_HEM,                     w=C['jacket_w_hem'],      d=C['jacket_d_hem'],        r=0.66),
    dict(z=Z_HEM + 0.08,              w=C['jacket_w_hem']-0.012, d=C['jacket_d_hem']+0.015, r=0.66),
    dict(z=Z_WAIST,                   w=C['jacket_w_waist']-0.006, d=C['jacket_d_chest']-0.024, r=0.66),
    dict(z=Z_WAIST + 0.12,            w=C['jacket_w_waist']+0.05, d=C['jacket_d_chest'],    r=0.64),
    dict(z=C['z_shoulder_joint']+0.02, w=C['jacket_w_shoulder']-0.015, d=C['jacket_d_chest']-0.025, r=0.72),
    dict(z=C['z_shoulder_joint']+0.05, w=0.455,                  d=C['jacket_d_chest']-0.045, r=0.84),
    dict(z=Z_SH_TOP,                  w=0.385,                  d=C['jacket_d_chest']-0.065, r=0.92),
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
jacket = L.loft('Jacket', JACKET_PROFILES, n=36)
for v in jacket.data.vertices:                                         # front hem: the two fronts' rounded corners meet under the button
    if v.co.y < -0.02 and v.co.z < Z_HEM + 0.09:
        lift = 0.030 * math.exp(-(v.co.x ** 2) / (2 * 0.055 ** 2)) * L.smoothstep((Z_HEM + 0.09 - v.co.z) / 0.07)
        v.co.z += lift
jacket.data.update(); add(jacket, 'jacket', 'spine')

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
flat_panel('Shirt', [(-0.052, Z_SH_TOP + 0.050), (-0.014, BTN_Z - 0.02), (0.014, BTN_Z - 0.02), (0.052, Z_SH_TOP + 0.050)], 0.004, 'shirt', 'spine')
# Peaked lapels (dark satin), thin, following the chest; their peaks meet the jacket collar's ends
for s_ in (1, -1):
    pts = [(s_ * 0.040, Z_SH_TOP + 0.044), (s_ * 0.078, Z_SH_TOP + 0.030), (s_ * 0.150, Z_SH_TOP - 0.095), (s_ * 0.116, Z_SH_TOP - 0.140), (s_ * 0.016, BTN_Z - 0.01)]
    flat_panel(f'Lapel{s_}', pts, 0.009, 'lapel', 'spine')
# Shirt collar: a fitted band round the neck with two folded points flanking the bow
NY = C['neck_y']; R_BAND = C['neck_r'] + 0.010; COL_TOP = Z_SH_TOP + 0.050
add(L.loft('CollarBand', [dict(z=Z_SH_TOP + 0.002, w=2*R_BAND+0.004, d=2*R_BAND-0.004, r=1.0, y=NY), dict(z=COL_TOP - 0.006, w=2*R_BAND, d=2*R_BAND-0.008, r=1.0, y=NY), dict(z=COL_TOP, w=2*R_BAND-0.012, d=2*R_BAND-0.018, r=1.0, y=NY)], n=24), 'shirt', 'neck')
for s_ in (1, -1):
    leaf = [(s_ * 0.09, COL_TOP - 0.003), (s_ * 0.40, COL_TOP - 0.006), (s_ * 0.34, COL_TOP - 0.034), (s_ * 0.12, COL_TOP - 0.020)]
    add(L.cylinder_leaf(f'CollarPoint{s_}', leaf, R_BAND + 0.001, 0.004, NY), 'shirt', 'neck')
# Jacket collar (satin): wraps the back and sides of the neck only, its ends running into the lapel peaks
R_JC = C['neck_r'] + 0.024
jc = L.loft('JacketCollar', [dict(z=Z_SH_TOP - 0.012, w=2*R_JC+0.006, d=2*R_JC+0.002, r=1.0, y=NY+0.008), dict(z=Z_SH_TOP + 0.040, w=2*R_JC, d=2*R_JC-0.004, r=1.0, y=NY+0.008), dict(z=Z_SH_TOP + 0.046, w=2*R_JC-0.018, d=2*R_JC-0.020, r=1.0, y=NY+0.008)], n=36)
bm = bmesh.new(); bm.from_mesh(jc.data)
front = [f for f in bm.faces if (lambda c: c.y < NY + 0.008 - 0.03 and abs(c.x) < R_JC * math.sin(0.50))(f.calc_center_median())]
bmesh.ops.delete(bm, geom=front, context='FACES')
bmesh.ops.holes_fill(bm, edges=[e for e in bm.edges if e.is_boundary], sides=12)
bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(jc.data); bm.free(); jc.data.update()
add(jc, 'lapel', 'neck')
# Bow tie: ONE connected shape — two wings pinched into a central knot — sitting on the collar band
BOW_Z = Z_SH_TOP + 0.030
bow = L.loft('BowTie', [
    dict(z=-0.080, w=0.020, d=0.014, r=0.8), dict(z=-0.062, w=0.046, d=0.024, r=0.7), dict(z=-0.034, w=0.054, d=0.028, r=0.7),
    dict(z=-0.015, w=0.030, d=0.024, r=0.8), dict(z=-0.009, w=0.036, d=0.034, r=0.9), dict(z=0.009, w=0.036, d=0.034, r=0.9),
    dict(z=0.015, w=0.030, d=0.024, r=0.8), dict(z=0.034, w=0.054, d=0.028, r=0.7), dict(z=0.062, w=0.046, d=0.024, r=0.7), dict(z=0.080, w=0.020, d=0.014, r=0.8)], n=16)
L.rotate_verts(bow, (0, math.pi / 2, 0))                                    # loft axis -> X (across the collar)
for v in bow.data.vertices:                                                 # wings curve back a little round the neck
    v.co.y += 0.06 * (v.co.x / 0.08) ** 2
L.translate_verts(bow, (0, NY - R_BAND - 0.012, BOW_Z)); add(bow, 'black', 'spine')
# shirt studs + jacket button
for i in range(3):
    zb = BOW_Z - 0.055 - i * 0.045
    add(L.uvsphere(f'Stud{i}', 0.0065, (0, chest_y(0, zb) - 0.010, zb), u=8, v=6), 'black', 'spine')
add(L.uvsphere('Button', 0.011, (0, chest_y(0, BTN_Z) - 0.012, BTN_Z), scale=(1, 0.6, 1), u=10, v=8), 'black', 'spine')

# ---- arms: ONE continuous lofted sleeve per arm (shoulder cap -> upper arm -> elbow -> forearm -> wrist),
#      round sections, a slight outward lean and a small forward bend at the elbow; skin weights blend
#      between the upper-arm and forearm bones across the elbow. No joint spheres.
SX, ZJ = C['shoulder_x'], C['z_shoulder_joint']
UR, FR = C['upperarm_r'], C['forearm_r']
def addw(ob, mat, upper, lower, z_split, blend=0.04):
    L.assign_split(ob, M[mat], upper, lower, z_split, blend); parts.append(ob); return ob
for s, tag in ((1, 'L'), (-1, 'R')):
    ex = s * (SX + 0.045); ey = -0.010
    hx = s * C['hand_x']; hy = -0.045
    ZE, ZW = C['z_elbow'], C['z_wrist']
    def arm_xy(z):                                                   # centre line of the sleeve at height z
        if z >= ZE:
            t = (ZJ - z) / (ZJ - ZE); t = max(0.0, min(1.0, t)); return s * SX + (ex - s * SX) * t, ey * t
        t = (ZE - z) / (ZE - ZW); t = max(0.0, min(1.0, t)); return ex + (hx - ex) * t, ey + (hy - ey) * t
    stations = [(ZW - 0.004, 2 * FR * 0.84, 2 * FR * 0.80, 1.0), ((ZE + ZW) / 2, 2 * FR * 0.94, 2 * FR * 0.92, 1.0),
                (ZE - 0.03, 2 * UR * 0.90, 2 * UR * 0.92, 1.0), (ZE + 0.03, 2 * UR * 0.94, 2 * UR * 0.98, 1.0),
                ((ZJ + ZE) / 2, 2 * UR * 0.97, 2 * UR, 1.0), (ZJ - 0.02, 2 * UR, 2 * UR * 1.02, 1.0),
                (ZJ + 0.025, 2 * UR * 0.86, 2 * UR * 0.92, 1.0), (ZJ + 0.048, 2 * UR * 0.45, 2 * UR * 0.55, 1.0)]
    prof = []
    for z, w, d, r in stations:
        x, y = arm_xy(min(z, ZJ)); prof.append(dict(z=z, w=w, d=d, r=r, x=x + (0.0 if z <= ZJ else -s * 0.012 * (z - ZJ) / 0.05), y=y))
    addw(L.loft(f'Sleeve{tag}', prof, n=20), 'jacket', f'upperarm.{tag}', f'forearm.{tag}', ZE, 0.035)
    cuff = L.loft(f'Cuff{tag}', [dict(z=ZW - 0.006, w=2*FR*0.90, d=2*FR*0.86, r=1.0), dict(z=ZW + 0.018, w=2*FR*0.86, d=2*FR*0.82, r=1.0)], n=14)
    L.translate_verts(cuff, (hx, hy, 0)); add(cuff, 'shirt', f'forearm.{tag}')
    # hand: a rounded mitt (slightly flattened), softly grouped fingers as a bevelled front, a thumb on the inside
    hand = L.loft(f'Hand{tag}', [dict(z=C['z_hand_end'], w=C['hand_w']*0.70, d=0.045, r=0.9), dict(z=C['z_hand_end']+0.03, w=C['hand_w'], d=0.058, r=0.75),
                                 dict(z=C['z_hand_end']+0.075, w=C['hand_w']*0.98, d=0.060, r=0.7), dict(z=ZW+0.01, w=C['hand_w']*0.72, d=0.050, r=0.95)], n=16)
    L.translate_verts(hand, (hx, hy, 0)); add(hand, 'skin', f'hand.{tag}')
    add(L.uvsphere(f'Thumb{tag}', 1.0, (0, 0, 0), scale=(0.016, 0.018, 0.030), u=10, v=8), 'skin', f'hand.{tag}')
    parts[-1].data.transform(__import__('mathutils').Matrix.Translation(Vector((hx - s * (C['hand_w']*0.5 + 0.006), hy - 0.012, ZW - 0.035))))

# ---- legs: ONE continuous lofted trouser leg per side (hip -> thigh -> knee -> shin -> ankle), slim,
#      slightly deeper than wide, a soft knee; weights blend between thigh and shin bones at the knee.
#      Shoes: a loft ALONG THE FOOT (heel -> arch -> instep -> ball -> rounded toe) with a flat sole.
LX = C['leg_x']; TW, TD, SW, SD = C['thigh_w'], C['thigh_d'], C['shin_w'], C['shin_d']
ZH, ZK, ZA = C['z_hip_joint'], C['z_knee'], C['z_ankle']
for s, tag in ((1, 'L'), (-1, 'R')):
    lx = s * LX
    leg = L.loft(f'Leg{tag}', [dict(z=ZA - 0.006, w=SW*0.90, d=SD*0.88, r=1.0), dict(z=ZA + 0.06, w=SW*0.95, d=SD*0.94, r=1.0),
                               dict(z=(ZA + ZK) / 2, w=SW, d=SD, r=1.0), dict(z=ZK - 0.03, w=SW*0.99, d=SD*1.02, r=1.0),
                               dict(z=ZK + 0.03, w=TW*0.96, d=TD*0.92, r=1.0), dict(z=(ZK + ZH) / 2, w=TW, d=TD, r=1.0),
                               dict(z=ZH + 0.03, w=TW*0.99, d=TD*0.99, r=1.0), dict(z=ZH + 0.10, w=TW*0.92, d=TD*0.94, r=1.0)], n=20)
    L.translate_verts(leg, (lx, 0, 0)); addw(leg, 'jacket', f'thigh.{tag}', f'shin.{tag}', ZK, 0.04)
    L0, W0, H0 = C['shoe_len'], C['shoe_w'], C['shoe_h']
    # stations along the foot: (position from the ankle, width, height, centre height, roundness)
    # heel -> ankle -> instep -> a tall blunt toe box that rounds off only over the last few cm
    st = [(-0.080, W0*0.52, 0.042, 0.027, 1.0), (-0.062, W0*0.80, 0.064, 0.035, 0.75), (-0.030, W0*0.93, 0.080, 0.043, 0.65),
          (0.020, W0*0.97, H0 + 0.010, 0.047, 0.62), (0.090, W0, H0 + 0.004, 0.044, 0.60), (0.160, W0, H0 * 0.98, 0.042, 0.58),
          (0.215, W0*0.98, H0 * 0.90, 0.039, 0.58), (0.255, W0*0.90, H0 * 0.70, 0.031, 0.65), (0.280, W0*0.66, H0 * 0.42, 0.020, 0.85), (L0 - 0.080, W0*0.30, 0.016, 0.010, 1.0)]
    shoe = L.loft(f'Shoe{tag}', [dict(z=a, w=w, d=d, r=r, y=yc) for a, w, d, yc, r in st], n=22)
    L.rotate_verts(shoe, (math.pi / 2, 0, 0))                          # loft axis -> -Y (forward); local y -> up
    for v in shoe.data.vertices:                                        # flat sole with a modest thickness
        if v.co.z < 0.006: v.co.z = 0.004 if v.co.z < 0.0 else v.co.z * 0.6 + 0.0024
    L.rotate_verts(shoe, (0, 0, s * C['shoe_splay']), about=(0, 0.05, 0)); L.translate_verts(shoe, (lx, 0, 0)); add(shoe, 'shoe', f'foot.{tag}')

# =============================================================================================
# JOIN + RIG
# =============================================================================================
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
mesh = bpy.context.active_object; mesh.name = 'Victor'; mesh.location = (0, 0, 0)
L.smooth_normals(mesh, 62.0)

# =============================================================================================
# BAKED SOFT SHADING -> vertex colours (glTF COLOR_0, linear). Ambient occlusion only (no directional
# light, so it stays right when he turns) plus a restrained warm tint on the cheeks and nose.
# =============================================================================================
def bake_vertex_shading(ob, n_rays=32, max_dist=0.26, strength=0.50):
    from mathutils.bvhtree import BVHTree
    me = ob.data
    bm = bmesh.new(); bm.from_mesh(me); bmesh.ops.triangulate(bm, faces=bm.faces[:])
    tree = BVHTree.FromBMesh(bm); bm.free()
    dirs = []
    for i in range(n_rays):                                   # cosine-weighted hemisphere (Fibonacci spiral)
        t = (i + 0.5) / n_rays; r = math.sqrt(t); phi = i * 2.399963
        dirs.append((r * math.cos(phi), r * math.sin(phi), math.sqrt(max(0.0, 1.0 - t))))
    skin_slots = {i for i, m in enumerate(me.materials) if m and m.name == 'Skin'}
    hair_slots = {i for i, m in enumerate(me.materials) if m and m.name == 'Hair'}
    skin_verts = set(); hair_verts = set()
    for poly in me.polygons:
        if poly.material_index in skin_slots: skin_verts.update(poly.vertices)
        if poly.material_index in hair_slots: hair_verts.update(poly.vertices)
    col = me.color_attributes.get('Col') or me.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='POINT')
    me.color_attributes.active_color = col
    me.color_attributes.render_color_index = me.color_attributes.find('Col')   # the exporter's 'ACTIVE' means the render colour
    occ_stats = []
    for v in me.vertices:
        n = Vector(me.vertex_normals[v.index].vector).normalized()
        a = Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 1, 0))
        t1 = a.cross(n).normalized(); t2 = n.cross(t1)
        o = v.co + n * 0.003; occ = 0.0
        for dx, dy, dz in dirs:
            hit = tree.ray_cast(o, t1 * dx + t2 * dy + n * dz, max_dist)
            if hit[0] is not None: occ += 1.0 - (hit[3] / max_dist) ** 0.6
        occ /= n_rays; occ_stats.append(occ)
        k = 1.0 - (strength * 0.7 if v.index in hair_verts else strength) * occ
        r = g = b = k
        if v.index in skin_verts:
            w = math.exp(-((abs(v.co.x) - 0.125) ** 2) / (2 * 0.045 ** 2)) * math.exp(-((v.co.z - zp(22.0)) ** 2) / (2 * 0.05 ** 2)) * L.smoothstep((-v.co.y - 0.10) / 0.06)
            w += 0.6 * math.exp(-((v.co.x) ** 2) / (2 * 0.03 ** 2)) * math.exp(-((v.co.z - zp(20.5)) ** 2) / (2 * 0.03 ** 2))   # nose ball
            w = min(1.0, w)
            g *= 1.0 - 0.08 * w; b *= 1.0 - 0.14 * w
            # ear cups and the ear-head junction: a little darker (the rim is otherwise the brightest skin)
            ear = math.exp(-((abs(v.co.x) - (T(C['z_ear'], W_TAB) + 0.022)) ** 2) / (2 * 0.02 ** 2)) * math.exp(-((v.co.z - C['z_ear']) ** 2) / (2 * 0.05 ** 2)) * math.exp(-((v.co.y - C['ear_y']) ** 2) / (2 * 0.04 ** 2))
            r *= 1.0 - 0.12 * ear; g *= 1.0 - 0.12 * ear; b *= 1.0 - 0.12 * ear                 # warmer by taking green/blue away (values must stay <= 1: uint16 export)
        col.data[v.index].color = (min(1.0, r), min(1.0, g), min(1.0, b), 1.0)
    occ_stats.sort(); m = len(occ_stats)
    print(f'REPORT ao verts={m} rays={n_rays} occ_min={occ_stats[0]:.2f} median={occ_stats[m // 2]:.2f} p90={occ_stats[int(m * 0.9)]:.2f} max={occ_stats[-1]:.2f}')
import time; _t0 = time.time(); bake_vertex_shading(mesh); print(f'REPORT ao_seconds={time.time() - _t0:.1f}')

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
                          export_animation_mode='ACTIONS', export_yup=True, export_morph=False, export_extras=True,
                          export_vertex_color='ACTIVE', export_all_vertex_colors=False)
print(f'REPORT file_bytes={out.stat().st_size} path={out}')
