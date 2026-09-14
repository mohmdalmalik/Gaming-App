# Build "Victor" v2 — a rounded, cartoon-style hotel guest in a dark tuxedo — model + jointed rig +
# Idle/Walk animations, exported as a lightweight .glb. Headless Blender (bpy module).
#
#   python3 tools/char-pipeline/make_victor.py            -> assets/characters/victor.glb
#
# Design (see docs/CHARACTER_GUI_CHECKPOINT.md, "The target, measured"):
#   ~2.9 heads tall, shoulders ~1.25x head width, torso 29 %, legs 32 %, head 36 % of height.
#   Head: a UV sphere shaped into a skull (cheeks, jaw taper, chin) with a hair CAP that owns the crown,
#   a side part, a swept quiff; brows + moustache are tapered tubes; eyes/nose/ears/mouth sit on the
#   skull surface (placed with the analytic surface function, so nothing floats).
#   Body: a lofted tailored jacket (rounded shoulders, waist, hem) with lapels / shirt V / bow tie that
#   CONFORM to the chest; capsule limb segments with joint spheres so elbows and knees bend cleanly
#   with rigid weights. Colours are sRGB hex -> linear (the game converts to matte Lambert on load).
#   Walk is authored IN PLACE with contact / passing / lift phases; the cycle's stride length is
#   measured from the posed feet and stored in the GLB extras (userData.strideLength) so the game can
#   match cadence to the distance actually travelled.
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

# ---- proportions (metres; Blender Z up; character faces -Y) ---------------------------------
H_TOTAL = 1.66
GROUND = 0.0
ANKLE = 0.075; KNEE = 0.33; HIPJ = 0.62          # leg joints
HEM = 0.60; WAIST = 0.82; CHEST = 0.96; SH = 1.04; SHTOP = 1.09; NECKB = 1.10   # jacket / torso
HEADC = 1.36; HR = 0.245; HSX, HSY, HSZ = 1.0, 0.92, 1.02   # skull centre, radius, per-axis scale
LEGX = 0.115; SHOULDER_X = 0.275; ELBOW = 0.79; WRIST = 0.60
ARM_OUT = 0.045                                   # hands sit a little outward/forward (relaxed A-pose)

# ---- materials -------------------------------------------------------------------------------
M = {
    'skin':   L.solid_material('Skin',   '#e9bb92'),
    'hair':   L.solid_material('Hair',   '#22170f'),
    'jacket': L.solid_material('Jacket', '#1e2c4b'),   # dark navy tuxedo
    'lapel':  L.solid_material('Lapel',  '#2b3b60'),   # satin lapels: a shade lighter
    'shirt':  L.solid_material('Shirt',  '#f1ebdc'),
    'black':  L.solid_material('Black',  '#101014'),   # bow tie, shoes
    'dark':   L.solid_material('Dark',   '#1a1410'),   # brows, moustache, eyes, mouth
    'ivory':  L.solid_material('Ivory',  '#fff7e6'),   # eye highlights
}
parts = []   # (object, bone)
def add(ob, mat, bone):
    L.assign(ob, M[mat], bone); parts.append(ob); return ob

# ---- analytic surfaces (for placing features ON the skull / chest) -------------------------
def jaw_scale(z):
    """Per-height (x, y) multipliers giving cheeks + a tapered jaw/chin below the eye line."""
    t = max(0.0, (HEADC - 0.04 - z) / 0.30)      # 0 at the eye line, 1 at the chin
    return (1.0 - 0.27 * t * t, 1.0 - 0.18 * t * t)

def skull_y(x, z):
    """Front (-Y) surface of the shaped skull at (x, z); returns None outside."""
    rz = (z - HEADC) / (HR * HSZ)
    if abs(rz) >= 1.0: return None
    rr = HR * math.sqrt(1 - rz * rz)
    sx, sy = jaw_scale(z)
    ax, ay = rr * HSX * sx, rr * HSY * sy
    if abs(x) >= ax: return None
    return -ay * math.sqrt(1 - (x / ax) ** 2)

JACKET_PROFILES = [
    dict(z=HEM,        w=0.56, d=0.36, r=0.60),
    dict(z=HEM + 0.10, w=0.54, d=0.35, r=0.60),
    dict(z=WAIST,      w=0.52, d=0.33, r=0.60),
    dict(z=CHEST,      w=0.585, d=0.36, r=0.62),
    dict(z=SH,         w=0.62, d=0.365, r=0.70),
    dict(z=SHTOP,      w=0.54, d=0.32, r=0.88),
    dict(z=SHTOP + 0.035, w=0.30, d=0.24, r=1.0),
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
    """Front (-Y) surface of the lofted jacket at (x, z)."""
    p = _lerp_profile(z)
    exp = 2.0 + 6.0 * (1.0 - p['r']); k = 2.0 / exp
    u = min(0.999, abs(x) / (p['w'] / 2))
    c = u ** (1 / k)                       # |cos t|
    s = math.sqrt(max(0.0, 1 - c * c))     # |sin t|
    return -(s ** k) * p['d'] / 2

# ---- head ---------------------------------------------------------------------------------
skull = L.uvsphere('Skull', HR, (0, 0, HEADC), scale=(HSX, HSY, HSZ), u=40, v=26)
L.scale_by_height(skull, lambda z: jaw_scale(z))
# Shapers are applied to the skull AND (below) to the hair cap so the cap follows the skull exactly.
SKULL_SHAPERS = [
    dict(c=(0, -0.20 * HR, HEADC - 0.24), r=0.16, d=(0, -0.012, -0.015)),   # chin: a little forward + down
    dict(c=( 0.24, -0.06, HEADC - 0.05), r=0.13, d=( 0.006, -0.003, 0)),     # cheeks: a soft hint
    dict(c=(-0.24, -0.06, HEADC - 0.05), r=0.13, d=(-0.006, -0.003, 0)),
    dict(c=(0, 0.20, HEADC + 0.06), r=0.28, d=(0, 0.02, 0.01)),              # fuller back of the skull
]
L.shape(skull, SKULL_SHAPERS)
add(skull, 'skin', 'head')

# Neck (short cylinder, mostly hidden by the collar)
add(L.loft('Neck', [dict(z=NECKB - 0.02, w=0.15, d=0.14, r=1.0), dict(z=HEADC - 0.20, w=0.15, d=0.14, r=1.0)], n=16), 'skin', 'neck')

# Ears
for s in (1, -1):
    add(L.uvsphere(f'Ear{s}', 0.036, (s * (HR * HSX * 0.985), 0.005, HEADC - 0.02), scale=(0.45, 0.85, 1.0), u=14, v=10), 'skin', 'head')

# Eyes: dark ovals ON the surface + one small highlight each
EYE_Z = HEADC + 0.035; EYE_X = 0.088
for s in (1, -1):
    y = skull_y(s * EYE_X, EYE_Z)
    add(L.uvsphere(f'Eye{s}', 0.030, (s * EYE_X, y + 0.006, EYE_Z), scale=(1.0, 0.42, 1.12), u=16, v=10), 'dark', 'head')
    add(L.uvsphere(f'Glint{s}', 0.0075, (s * EYE_X - 0.009, y - 0.006, EYE_Z + 0.011), u=8, v=6), 'ivory', 'head')

# Brows: tapered tubes arching over each eye, conformed to the skull
for s in (1, -1):
    # Relaxed arch: the inner end sits level (not dipping toward the nose, which reads as a frown),
    # the arch peaks two-thirds out, and the tail tapers gently downward.
    z0 = EYE_Z + 0.064
    p = L.bezier((s * 0.035, 0, z0 + 0.004), (s * 0.075, 0, z0 + 0.020), (s * 0.12, 0, z0 + 0.018), (s * 0.156, 0, z0 - 0.002), n=14)
    p = [(x, skull_y(x, z) + 0.004, z) for x, _, z in p]
    add(L.tube(f'Brow{s}', p, [0.0135 * t for t in L.taper(14, 0.5, 1.0, 0.32, power=1.3)], n=8), 'dark', 'head')

# Nose: a small button sitting on the face
NOSE_Z = HEADC - 0.035
add(L.uvsphere('Nose', 0.034, (0, skull_y(0, NOSE_Z) - 0.016, NOSE_Z), scale=(1.0, 1.0, 0.9), u=16, v=12), 'skin', 'head')

# Moustache: two curved, tapered lobes meeting under the nose (thick at the centre, tapered ends)
MO_Z = HEADC - 0.085
for s in (1, -1):
    p = L.bezier((s * 0.006, 0, MO_Z + 0.002), (s * 0.045, 0, MO_Z + 0.016), (s * 0.095, 0, MO_Z + 0.008), (s * 0.128, 0, MO_Z - 0.012), n=14)
    p = [(x, skull_y(x, z) - 0.002, z) for x, _, z in p]
    add(L.tube(f'Moustache{s}', p, [0.019 * t for t in L.taper(14, 0.9, 1.0, 0.25, power=1.6)], n=8), 'dark', 'head')

# Mouth: a subtle short line below the moustache
MOUTH_Z = HEADC - 0.135
p = L.bezier((-0.032, 0, MOUTH_Z + 0.003), (-0.012, 0, MOUTH_Z - 0.004), (0.012, 0, MOUTH_Z - 0.004), (0.032, 0, MOUTH_Z + 0.003), n=8)
p = [(x, skull_y(x, z) - 0.001, z) for x, _, z in p]
add(L.tube('Mouth', p, [0.005 * t for t in L.taper(8, 0.5, 1.0, 0.5)], n=6), 'dark', 'head')

# ---- hair --------------------------------------------------------------------------------
# A cap that owns the whole crown: a slightly larger skull whose below-hairline vertices are pushed
# INSIDE the skull (closed mesh, no holes, no z-fighting). The hairline is a function of azimuth:
# high on the forehead, down to just above the ears at the sides, low at the nape.
# Orientation reminder: the character faces -Y, so HIS right is -X and HIS left is +X (a viewer looking
# at his face sees +X on the viewer's right). The target parts the hair on HIS LEFT (+X) and sweeps it
# toward HIS RIGHT (-X), where the quiff rises.
HEAD_CENTRE = Vector((0, 0, HEADC))
hair = L.uvsphere('HairCap', HR, (0, 0, HEADC), scale=(HSX * 1.055, HSY * 1.055, HSZ * 1.05), u=40, v=26)
L.scale_by_height(hair, lambda z: jaw_scale(z))
L.shape(hair, SKULL_SHAPERS)                      # follow the skull (else the fuller back pokes through)
def hairline_z(x, y):
    a = math.atan2(-y, x)                 # 0 at +X (his left side), pi/2 at the front (-Y)
    front = max(0.0, math.sin(a)) ** 1.3   # 1 at the front, 0 at the sides/back
    back = max(0.0, -math.sin(a))
    z = HEADC + 0.20 * front - 0.015 * (1 - front - back) - 0.22 * back
    # the sweep side (his right, -X) comes down a little further at the temple
    z -= 0.022 * front * (0.5 - 0.5 * math.tanh(x / 0.05))
    return z
# Vertices in the first row below the hairline are SNAPPED onto the hairline curve (so the edge
# follows it exactly instead of stair-stepping along the sphere's rows); rows further below are
# tucked inside the skull, which keeps the cap a closed mesh with no holes.
ROW = 2 * math.pi * HR * 1.05 / 26 * 0.55    # about one row spacing
for v in hair.data.vertices:
    zl = hairline_z(v.co.x, v.co.y)
    below = zl - v.co.z
    if 0 < below <= ROW:
        v.co.z = zl
        v.co = HEAD_CENTRE + (v.co - HEAD_CENTRE) * 0.995
    elif below > ROW:
        v.co = HEAD_CENTRE + (v.co - HEAD_CENTRE) * 0.86
hair.data.update()
# Volume: the whole cap swells radially with height (a round dome, not a peak), a little more on the
# sweep side; plus a gentle forward "wave" over the forehead.
def cap_swell(p):
    h = L.smoothstep((p.z - (HEADC - 0.02)) / 0.30)
    side = 0.5 - 0.5 * math.tanh(p.x / 0.08)          # 1 on his right (-X), 0 on his left
    return 1.0 + 0.075 * h + 0.03 * h * side
L.radial_scale(hair, HEAD_CENTRE, cap_swell)
# Side part: a shallow groove from the front hairline back over the crown, on HIS LEFT (+X)
PART_X = 0.07
for i in range(10):
    t = i / 9
    ang = math.radians(38 + t * 105)                      # forehead (38°) -> crown (90°) -> back (143°)
    cy, cz = -math.cos(ang), math.sin(ang)                # front is -Y: cos>0 at the front, <0 at the back
    c = HEAD_CENTRE + Vector((PART_X, cy * HR * 1.05, cz * HR * 1.08))
    L.shape(hair, [dict(c=tuple(c), r=0.04, d=tuple((c - HEAD_CENTRE).normalized() * -0.011), f='smooth')])
add(hair, 'hair', 'head')
# Quiff: a swept wave rising from the part toward his right (-X). Built at the origin, rotated about
# its own centre, then placed — so it sits ON the cap at the front-top instead of flying off.
quiff = L.uvsphere('Quiff', 0.10, (0, 0, 0), scale=(1.30, 0.95, 0.80), u=20, v=12)
L.rotate_verts(quiff, (0.45, -0.25, 0.20))            # tilt up at the front, lift the -X end
L.translate_verts(quiff, (-0.03, -0.14, HEADC + 0.205))   # sunk ~40 % into the cap so it merges
add(quiff, 'hair', 'head')

# ---- torso / jacket ------------------------------------------------------------------------
jacket = L.loft('Jacket', JACKET_PROFILES, n=32)
add(jacket, 'jacket', 'spine')

# Shirt V, lapels, collar and bow tie all conform to the chest (chest_y) so they follow its curve.
def flat_panel(name, outline_xz, inset, thick, mat, bone, cuts=6):
    """A one-sided panel that CONFORMS to the chest: the outline (list of (x, z)) is triangulated and
    subdivided so it has interior vertices, then every vertex is projected onto the chest surface at
    depth chest_y - inset. (A plain polygon with only corner vertices is a flat chord that sags
    behind the bulging chest and disappears — that was the invisible-shirt bug.) `thick` is unused
    (kept for call-site symmetry); the jacket behind hides the back."""
    # Counter-clockwise as seen from the front (-Y looking +Y: +X right, +Z up) => normal points out.
    area = 0.0
    for (x0, z0), (x1, z1) in zip(outline_xz, outline_xz[1:] + outline_xz[:1]): area += x0 * z1 - x1 * z0
    if area < 0: outline_xz = list(reversed(outline_xz))
    bm = bmesh.new()
    verts = [bm.verts.new(Vector((x, 0.0, z))) for x, z in outline_xz]
    face = bm.faces.new(verts)
    bmesh.ops.triangulate(bm, faces=[face])
    bmesh.ops.subdivide_edges(bm, edges=bm.edges[:], cuts=cuts, use_grid_fill=True)
    for v in bm.verts:
        v.co.y = chest_y(v.co.x, v.co.z) - inset
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # make sure the normals face out (-Y); flip if the mean normal points into the body
    ny = sum(f.normal.y for f in bm.faces)
    if ny > 0: bmesh.ops.reverse_faces(bm, faces=bm.faces[:])
    ob = L.new_object(name, bm, smooth=True)
    return add(ob, mat, bone)

# Shirt front: a V from the collar down to the button point
BTN_Z = WAIST + 0.02
flat_panel('Shirt', [(-0.10, SHTOP + 0.01), (-0.015, BTN_Z - 0.045), (0.015, BTN_Z - 0.045), (0.10, SHTOP + 0.01)], 0.004, 0.02, 'shirt', 'spine')
# Peaked lapels: from the collar point out to a peak, then down to the button point. Their inner
# edges open into a V so the ivory shirt reads as a V between them.
for s in (1, -1):
    pts = [(s * 0.062, SHTOP + 0.005), (s * 0.125, SHTOP - 0.03), (s * 0.17, CHEST + 0.02), (s * 0.125, CHEST - 0.02), (s * 0.02, BTN_Z - 0.01)]
    if s < 0: pts = list(reversed(pts))
    flat_panel(f'Lapel{s}', pts, 0.010, 0.02, 'lapel', 'spine')
# Collar: an ivory band around the neck base with a small opening at the front
add(L.loft('Collar', [dict(z=SHTOP - 0.005, w=0.20, d=0.17, r=1.0), dict(z=SHTOP + 0.04, w=0.19, d=0.165, r=1.0), dict(z=SHTOP + 0.045, w=0.16, d=0.145, r=1.0)], n=20), 'shirt', 'neck')
# Bow tie: two wings (lofted along X) + a knot, sitting on the shirt just under the collar
BOW_Z = SHTOP - 0.005
for s in (1, -1):
    wing = L.loft(f'Wing{s}', [dict(z=0.0, w=0.024, d=0.030, r=0.8), dict(z=0.035, w=0.052, d=0.055, r=0.7), dict(z=0.062, w=0.048, d=0.055, r=0.8), dict(z=0.075, w=0.022, d=0.030, r=1.0)], n=14)
    wing.rotation_euler = Euler((0, s * math.pi / 2, 0), 'XYZ')   # local Z -> ±X
    wing.location = Vector((s * 0.012, chest_y(s * 0.04, BOW_Z) - 0.022, BOW_Z))
    bpy.context.view_layer.objects.active = wing; wing.select_set(True); bpy.ops.object.transform_apply(location=True, rotation=True)
    add(wing, 'black', 'spine')
add(L.uvsphere('Knot', 0.02, (0, chest_y(0, BOW_Z) - 0.03, BOW_Z), scale=(0.9, 0.8, 1.0), u=12, v=8), 'black', 'spine')

# ---- arms (capsule segments + joint spheres) ----------------------------------------------
for s, tag in ((1, 'L'), (-1, 'R')):
    sx = s * SHOULDER_X
    # shoulder sphere tucked in the jacket shoulder; upper arm hangs slightly outward/forward
    add(L.uvsphere(f'Shoulder{tag}', 0.060, (s * 0.25, 0.0, SH - 0.035), u=14, v=10), 'jacket', f'upperarm.{tag}')   # inside the jacket shoulder
    ux, uy = s * (SHOULDER_X + ARM_OUT * 0.5), -0.015
    ua = L.capsule(f'UpperArm{tag}', 0.066, 0.058, SH - 0.02, ELBOW - 0.02, loc=(0, 0), n=16, rings=4)
    # lean the capsule so the elbow sits outward/forward of the shoulder
    for v in ua.data.vertices:
        t = (SH - 0.02 - v.co.z) / (SH - ELBOW)
        v.co.x += sx + s * ARM_OUT * 0.5 * t; v.co.y += -0.015 * t
    add(ua, 'jacket', f'upperarm.{tag}')
    ex, ey = s * (SHOULDER_X + ARM_OUT * 0.5), -0.015
    add(L.uvsphere(f'Elbow{tag}', 0.053, (ex, ey, ELBOW), u=14, v=10), 'jacket', f'upperarm.{tag}')
    fa = L.capsule(f'Forearm{tag}', 0.056, 0.047, ELBOW + 0.01, WRIST - 0.01, loc=(0, 0), n=16, rings=4)
    for v in fa.data.vertices:
        t = (ELBOW + 0.01 - v.co.z) / (ELBOW - WRIST)
        v.co.x += ex + s * ARM_OUT * 0.5 * t; v.co.y += ey - 0.03 * t
    add(fa, 'jacket', f'forearm.{tag}')
    # cuff: a thin ivory ring at the wrist
    cuff = L.loft(f'Cuff{tag}', [dict(z=WRIST - 0.005, w=0.098, d=0.098, r=1.0), dict(z=WRIST + 0.02, w=0.096, d=0.096, r=1.0)], n=14)
    for v in cuff.data.vertices: v.co.x += ex + s * ARM_OUT * 0.5; v.co.y += ey - 0.03
    add(cuff, 'shirt', f'forearm.{tag}')
    # hand: a rounded mitt with a small thumb bump on the inside
    hx, hy = ex + s * ARM_OUT * 0.5, ey - 0.03
    add(L.uvsphere(f'Hand{tag}', 0.064, (hx, hy, WRIST - 0.055), scale=(0.9, 0.78, 1.05), u=16, v=12), 'skin', f'hand.{tag}')
    add(L.uvsphere(f'Thumb{tag}', 0.028, (hx - s * 0.05, hy - 0.02, WRIST - 0.03), scale=(0.9, 0.9, 1.3), u=10, v=8), 'skin', f'hand.{tag}')

# ---- legs (trousers = capsules + knee spheres) + shoes ----------------------------------
for s, tag in ((1, 'L'), (-1, 'R')):
    lx = s * LEGX
    add(L.uvsphere(f'HipBall{tag}', 0.09, (lx, 0.0, HIPJ - 0.01), scale=(1, 0.95, 0.9), u=14, v=10), 'jacket', f'thigh.{tag}')
    add(L.capsule(f'Thigh{tag}', 0.088, 0.076, HIPJ, KNEE - 0.02, loc=(lx, 0.0), n=16, rings=4), 'jacket', f'thigh.{tag}')
    add(L.uvsphere(f'Knee{tag}', 0.073, (lx, 0.0, KNEE), u=14, v=10), 'jacket', f'thigh.{tag}')
    add(L.capsule(f'Shin{tag}', 0.072, 0.062, KNEE + 0.01, ANKLE, loc=(lx, 0.0), n=16, rings=4), 'jacket', f'shin.{tag}')
    # shoe: a rounded loft, longer toward the toe (-Y), with a low heel
    shoe = L.loft(f'Shoe{tag}', [
        dict(z=GROUND, w=0.135, d=0.235, r=0.55, y=-0.045), dict(z=GROUND + 0.035, w=0.145, d=0.25, r=0.55, y=-0.05),
        dict(z=GROUND + 0.075, w=0.135, d=0.215, r=0.65, y=-0.035), dict(z=GROUND + 0.105, w=0.11, d=0.14, r=0.9, y=0.0)], n=20)
    for v in shoe.data.vertices: v.co.x += lx
    add(shoe, 'black', f'foot.{tag}')

# ---- join into one mesh -------------------------------------------------------------------
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
mesh = bpy.context.active_object; mesh.name = 'Victor'
mesh.location = (0, 0, 0)
L.smooth_normals(mesh, 62.0)

# ---- armature ------------------------------------------------------------------------------
arm_data = bpy.data.armatures.new('VictorRig')
arm = bpy.data.objects.new('VictorRig', arm_data)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
def bone(name, head, tail, parent=None):
    b = eb.new(name); b.head = head; b.tail = tail; b.roll = 0.0
    if parent: b.parent = eb[parent]
    return b
bone('root',  (0, 0, 0), (0, 0, 0.12))
bone('hips',  (0, 0, HIPJ), (0, 0, WAIST + 0.04), 'root')
bone('spine', (0, 0, WAIST + 0.04), (0, 0, SHTOP), 'hips')
bone('neck',  (0, 0, SHTOP), (0, 0, HEADC - 0.20), 'spine')
bone('head',  (0, 0, HEADC - 0.20), (0, 0, HEADC + 0.30), 'neck')
for s, tag in ((1, 'L'), (-1, 'R')):
    sx = s * SHOULDER_X; ax = s * (SHOULDER_X + ARM_OUT * 0.5)
    bone(f'shoulder.{tag}', (s * 0.09, 0, SHTOP - 0.03), (sx, 0, SH - 0.03), 'spine')
    bone(f'upperarm.{tag}', (sx, 0, SH - 0.03), (ax, -0.015, ELBOW), f'shoulder.{tag}')
    bone(f'forearm.{tag}',  (ax, -0.015, ELBOW), (ax + s * ARM_OUT * 0.5, -0.045, WRIST), f'upperarm.{tag}')
    bone(f'hand.{tag}',     (ax + s * ARM_OUT * 0.5, -0.045, WRIST), (ax + s * ARM_OUT * 0.5, -0.05, WRIST - 0.11), f'forearm.{tag}')
    lx = s * LEGX
    bone(f'thigh.{tag}', (lx, 0, HIPJ), (lx, 0, KNEE), 'hips')
    bone(f'shin.{tag}',  (lx, 0, KNEE), (lx, 0, ANKLE), f'thigh.{tag}')
    bone(f'foot.{tag}',  (lx, 0, ANKLE), (lx, -0.16, 0.02), f'shin.{tag}')
bpy.ops.object.mode_set(mode='OBJECT')
amod = mesh.modifiers.new('Armature', 'ARMATURE'); amod.object = arm
mesh.parent = arm

# ---- animation ----------------------------------------------------------------------------
FPS = 24; scene.render.fps = FPS
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
for pb in arm.pose.bones: pb.rotation_mode = 'XYZ'

def key(bname, frame, rx=0.0, ry=0.0, rz=0.0, loc=None):
    pb = arm.pose.bones[bname]
    pb.rotation_euler = (rx, ry, rz); pb.keyframe_insert('rotation_euler', frame=frame)
    if loc is not None:
        pb.location = loc; pb.keyframe_insert('location', frame=frame)

def new_action(name):
    arm.animation_data_create()
    act = bpy.data.actions.new(name); act.use_fake_user = True
    arm.animation_data.action = act
    return act

# Sign conventions (bones pointing DOWN, roll 0): +rx swings the tail toward +Y (BACKWARD).
# So a forward swing is -rx. For bones pointing UP (spine/neck/head): +rx tips the tail FORWARD (-Y).
def fwd(a): return -a          # forward swing for a downward bone
def stance_knee(phi):          # small knee give while loaded
    return max(0.0, math.sin(2 * math.pi * phi)) * 0.16 if phi < 0.5 else 0.0
def swing_knee(phi):           # lift the foot through the swing (0.5 .. 1.0)
    return 0.0 if phi < 0.5 else max(0.0, math.sin(2 * math.pi * (phi - 0.5))) * 1.05

# ---- Walk: in place. phi = 0 heel contact (left), 0.25 mid-stance, 0.5 toe-off, 0.75 passing.
new_action('Walk')
WALK_N = 24
A_LEG = 0.52; A_ARM = 0.42
def thigh_angle(phi):
    # +A at contact, -A at toe-off, back to +A: smooth-triangle for near-linear foot travel in stance
    c = math.cos(2 * math.pi * phi)
    return A_LEG * math.copysign(abs(c) ** 0.85, c)
for f in range(WALK_N + 1):
    t = f / WALK_N
    for tag, phi in (('L', t), ('R', (t + 0.5) % 1.0)):
        th = thigh_angle(phi)
        kn = stance_knee(phi) + swing_knee(phi)
        # foot: keep the sole level while loaded, toe slightly down when lifted
        if phi < 0.5: ft = -(fwd(th) + kn) * 0.9
        else: ft = -(fwd(th) + kn) * 0.35 + 0.22 * math.sin(2 * math.pi * (phi - 0.5))
        key(f'thigh.{tag}', f, rx=fwd(th))
        key(f'shin.{tag}', f, rx=kn)
        key(f'foot.{tag}', f, rx=ft)
        # arms swing opposite to the same-side leg; elbow bends more when the arm is forward
        arm_ph = (phi + 0.5) % 1.0
        ua = A_ARM * math.cos(2 * math.pi * arm_ph)
        key(f'upperarm.{tag}', f, rx=fwd(ua), rz=-0.08 * (1 if tag == 'L' else -1))
        key(f'forearm.{tag}', f, rx=fwd(0.18 + 0.30 * (0.5 + 0.5 * math.cos(2 * math.pi * arm_ph))))
        key(f'hand.{tag}', f, rx=fwd(0.05))
    # hips: lowest at each contact (double support), highest at mid-stance; lateral sway to the stance leg
    bob = -0.022 * (0.5 + 0.5 * math.cos(4 * math.pi * t))
    sway = 0.012 * math.sin(2 * math.pi * t)
    key('hips', f, rz=0.07 * math.cos(2 * math.pi * t), loc=(sway, bob, 0.0))   # bone-local Y = world Z (up)
    key('spine', f, rx=0.06, rz=-0.05 * math.cos(2 * math.pi * t))
    key('neck', f, rx=-0.03)
    key('head', f, rz=0.02 * math.cos(2 * math.pi * t), rx=0.01 * math.cos(4 * math.pi * t))
    key('shoulder.L', f, ry=0.0); key('shoulder.R', f, ry=0.0)

# Measure the stride the clip represents: forward distance between the two ankles at the contact
# pose (frame 0) is one STEP; a cycle is two steps. Also the toe's lowest point (grounding check).
scene.frame_set(0)
bpy.context.view_layer.update()
def world(pb_name, tail=False):
    pb = arm.pose.bones[pb_name]
    return arm.matrix_world @ (pb.tail if tail else pb.head)
aL, aR = world('foot.L'), world('foot.R')
STEP = abs(aL.y - aR.y)
STRIDE = 2 * STEP
toe_min = 9; toe_max = -9; heel_min = 9
for f in range(WALK_N + 1):
    scene.frame_set(f); bpy.context.view_layer.update()
    for tag in ('L', 'R'):
        tz = world(f'foot.{tag}', tail=True).z; hz = world(f'foot.{tag}').z
        toe_min = min(toe_min, tz); toe_max = max(toe_max, tz); heel_min = min(heel_min, hz)
print(f'REPORT step={STEP:.3f} stride={STRIDE:.3f} toe_z=[{toe_min:.3f},{toe_max:.3f}] ankle_min_z={heel_min:.3f}')

# ---- Idle: restrained breathing, a slow weight shift, tiny head drift ---------------------
new_action('Idle')
IDLE_N = 72
for f in range(IDLE_N + 1):
    t = f / IDLE_N
    br = math.sin(2 * math.pi * t)                 # one breath per 3 s
    sw = math.sin(2 * math.pi * t * 0.5 + 0.8)     # slow weight shift
    key('hips', f, rz=0.012 * sw, loc=(0.006 * sw, 0.004 * br, 0.0))
    key('spine', f, rx=0.045 + 0.018 * br, rz=-0.008 * sw)
    key('neck', f, rx=-0.02)
    key('head', f, rx=0.012 * math.sin(2 * math.pi * t + 0.9), rz=0.015 * math.sin(2 * math.pi * t * 0.5))
    for tag, s in (('L', 1), ('R', -1)):
        key(f'thigh.{tag}', f, rx=0.0); key(f'shin.{tag}', f, rx=0.0); key(f'foot.{tag}', f, rx=0.0)
        key(f'upperarm.{tag}', f, rx=fwd(0.04 * br + 0.02), rz=-s * 0.10, ry=0.0)
        key(f'forearm.{tag}', f, rx=fwd(0.22 + 0.03 * br))
        key(f'hand.{tag}', f, rx=fwd(0.05))
        key(f'shoulder.{tag}', f, ry=0.0)
bpy.ops.object.mode_set(mode='OBJECT')

# The asset carries its own stride so the game never guesses it.
arm['strideLength'] = round(STRIDE, 4); arm['walkClipSeconds'] = round(WALK_N / FPS, 4)
mesh['strideLength'] = round(STRIDE, 4)

# ---- report + export ---------------------------------------------------------------------
tris = L.tri_count(mesh)
print(f'REPORT tris={tris} materials={len(mesh.data.materials)} verts={len(mesh.data.vertices)} height={H_TOTAL}')
out = REPO / 'assets' / 'characters' / 'victor.glb'
out.parent.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True); mesh.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(
    filepath=str(out), export_format='GLB', use_selection=True,
    export_apply=False, export_animations=True, export_animation_mode='ACTIONS',
    export_yup=True, export_morph=False, export_extras=True,
)
print(f'REPORT file_bytes={out.stat().st_size} path={out}')
