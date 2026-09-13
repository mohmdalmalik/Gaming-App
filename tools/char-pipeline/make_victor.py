# Build "Victor" — a rounded, cartoon-style hotel guest in a dark tuxedo — model + rig + Idle/Walk
# animations, exported as a lightweight .glb for the game. Headless Blender (bpy module).
#
# Approach: low-poly primitives joined into ONE mesh, rigid-skinned (each part 100% to one bone) to
# a small armature (hips/spine/head/arms/legs), with two armature actions (Idle, Walk). The game's
# movement code drives travel; the Walk clip stays in place.
import bpy, bmesh, math, os, addon_utils

try:
    addon_utils.enable("io_scene_gltf2", default_set=True, persistent=True)
except Exception as e:
    print("addon note:", e)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene

# ---- materials ---------------------------------------------------------------------------
def mat(name, rgb, rough=0.6, metal=0.0):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF") or m.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (*rgb, 1.0)
    b.inputs["Roughness"].default_value = rough
    if "Metallic" in b.inputs: b.inputs["Metallic"].default_value = metal
    return m

# Colours are authored as sRGB hex (like the game's palette) and converted to LINEAR for Blender's
# Principled base colour, so the round-trip Blender -> glTF -> Three.js reproduces the intended
# shade. (Authoring raw linear numbers made everything render far too light — a near-black tuxedo
# came out mid-grey and dark hair came out dirty-blonde.)
def _s2l(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def hexlin(h):
    h = h.lstrip('#')
    return (_s2l(int(h[0:2], 16)), _s2l(int(h[2:4], 16)), _s2l(int(h[4:6], 16)))

M = {
    "skin":  mat("Skin",  hexlin('#d9b38c'), 0.8),   # match the other guests' skin tone
    "hair":  mat("Hair",  hexlin('#241811'), 0.85),  # dark brown
    "jacket":mat("Jacket",hexlin('#15151a'), 0.85),  # near-black tuxedo (matches outfit colour)
    "shirt": mat("Shirt", hexlin('#efe9dc'), 0.85),  # ivory
    "accent":mat("Accent",hexlin('#101015'), 0.8),   # bow tie / lapels / shoes (deep black)
    "dark":  mat("Dark",  hexlin('#0c0c11'), 0.8),   # eyes / brows / moustache
}
MAT_ORDER = list(M.keys())
MAT_INDEX = {k: i for i, k in enumerate(MAT_ORDER)}

parts = []
def finish_part(obj, group, material, subsurf=0, shade_smooth=True):
    # apply any modifiers, assign a single material + a single vertex group (rigid skin), collect.
    bpy.context.view_layer.objects.active = obj
    if subsurf:
        m = obj.modifiers.new("s", "SUBSURF"); m.levels = subsurf; m.render_levels = subsurf
        bpy.ops.object.modifier_apply(modifier=m.name)
    obj.data.materials.clear(); obj.data.materials.append(M[material])
    if shade_smooth:
        for p in obj.data.polygons: p.use_smooth = True
    vg = obj.vertex_groups.new(name=group)
    vg.add([v.index for v in obj.data.vertices], 1.0, 'REPLACE')
    parts.append(obj)
    return obj

def add_box(size, loc, mat_key, group, scale=(1,1,1), rot=(0,0,0), bevel=0.06, bseg=2, subsurf=0):
    bpy.ops.mesh.primitive_cube_add(size=1.0, location=loc)
    o = bpy.context.active_object
    o.scale = (size[0]*scale[0], size[1]*scale[1], size[2]*scale[2])
    o.rotation_euler = rot
    if bevel:
        bm = o.modifiers.new("b", "BEVEL"); bm.width = bevel; bm.segments = bseg
        bpy.context.view_layer.objects.active = o; bpy.ops.object.modifier_apply(modifier=bm.name)
    return finish_part(o, group, mat_key, subsurf=subsurf)

def add_sphere(radius, loc, mat_key, group, scale=(1,1,1), subdiv=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=radius, location=loc)
    o = bpy.context.active_object; o.scale = scale
    return finish_part(o, group, mat_key)

def add_cyl(r1, r2, depth, loc, mat_key, group, rot=(0,0,0), verts=16):
    bpy.ops.mesh.primitive_cone_add(vertices=verts, radius1=r1, radius2=r2, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object
    return finish_part(o, group, mat_key)

# ---- proportions (Blender Z up; character faces -Y, i.e. Blender front) -------------------
HIP = 0.78; KNEE = 0.42; ANKLE = 0.09; SH = 1.16; NECK = 1.20
HEADC = 1.45; HEADR = 0.235         # large cartoon head, but sized so the whole figure reads as a person from above
HEAD_TILT = 0.0                      # upright head (like the other guests). The game camera looks DOWN, so a
                                     # tilted-up face just exposes the bare crown; hair must own the top instead.
LEGX = 0.12; ARMX = 0.28

# Legs (trousers dark = accent? use jacket-dark for trousers) --------------------------------
trouser = "jacket"
for s in (1, -1):
    tag = "L" if s > 0 else "R"
    # thigh
    add_box((0.17, 0.19, KNEE-0.02), (s*LEGX, 0, (HIP+KNEE)/2), trouser, f"thigh.{tag}", bevel=0.06)
    # shin
    add_box((0.15, 0.17, KNEE-ANKLE), (s*LEGX, 0, (KNEE+ANKLE)/2), trouser, f"shin.{tag}", bevel=0.05)
    # shoe (rounded, toe forward -Y)
    add_box((0.17, 0.34, 0.12), (s*LEGX, -0.07, 0.06), "accent", f"shin.{tag}", bevel=0.06, bseg=3)

# Pelvis / hips block -------------------------------------------------------------------------
add_box((0.42, 0.30, 0.22), (0, 0, HIP-0.02), trouser, "hips", bevel=0.10, bseg=3)

# Jacket torso (tapered, rounded) -------------------------------------------------------------
add_box((0.50, 0.34, SH-HIP+0.06), (0, 0, (HIP+SH)/2), "jacket", "spine", bevel=0.12, bseg=3, subsurf=1)
# Ivory shirt wedge on the chest (front = -Y)
add_box((0.16, 0.02, 0.34), (0, -0.175, SH-0.16), "shirt", "spine", bevel=0.02)
# Lapels (two angled dark panels)
for s in (1, -1):
    add_box((0.11, 0.02, 0.34), (s*0.10, -0.172, SH-0.14), "accent", "spine", rot=(0,0, s*0.18), bevel=0.01)
# Collar (ivory) + bow tie (accent)
add_box((0.26, 0.06, 0.07), (0, -0.15, SH+0.02), "shirt", "spine", bevel=0.02)
add_box((0.14, 0.05, 0.05), (0, -0.19, SH-0.02), "accent", "spine", bevel=0.02, bseg=2)
add_box((0.04, 0.05, 0.05), (0, -0.19, SH-0.02), "dark", "spine", bevel=0.01)  # bow knot

# Arms (sleeve dark + rounded hand) -----------------------------------------------------------
for s in (1, -1):
    tag = "L" if s > 0 else "R"
    add_box((0.15, 0.16, 0.40), (s*ARMX, 0, SH-0.24), "jacket", f"arm.{tag}", bevel=0.06, bseg=2)
    add_sphere(0.10, (s*ARMX, 0, SH-0.48), "skin", f"arm.{tag}", scale=(1,1,0.9))

# Head + features (all → head bone). Built, then joined + tilted up about the neck so the face
# reads from the game's steep elevated camera. -------------------------------------------------
head_start = len(parts)
add_sphere(HEADR, (0, 0, HEADC), "skin", "head", scale=(1.0, 0.95, 1.04), subdiv=3)
# Hair: a full "helmet" cap that OWNS the whole crown so the top of the head reads as dark hair from
# the game's overhead camera (like the other guests). It is concentric-ish, a touch larger than the
# skull, raised slightly, and pulled back only enough to leave a clean forehead + hairline. The eyes
# and brows sit forward of the hair's front edge so the face still reads head-on and in the portrait.
add_sphere(HEADR*1.05, (0, 0.055, HEADC+0.05), "hair", "head", scale=(1.08, 1.02, 1.02), subdiv=3)
# Ears
for s in (1, -1):
    add_sphere(0.055, (s*HEADR*0.98, 0.0, HEADC-0.01), "skin", "head", scale=(0.7,1,1.2))
# Nose
add_sphere(0.05, (0, -HEADR*0.98, HEADC-0.03), "skin", "head", scale=(1,1.2,1))
# Eyes (dark, rounder, with a small ivory catch-light) below softer, lower brows.
for s in (1, -1):
    add_sphere(0.036, (s*0.10, -HEADR*0.92, HEADC+0.03), "dark", "head", scale=(1, 0.62, 1.0))
    add_sphere(0.011, (s*0.088, -HEADR*0.99, HEADC+0.055), "shirt", "head")  # catch-light
    add_box((0.085, 0.02, 0.022), (s*0.10, -HEADR*0.95, HEADC+0.115), "dark", "head", rot=(0, 0, -s*0.12), bevel=0.004)
# Neat moustache (two slim angled bars just under the nose)
for s in (1, -1):
    add_box((0.075, 0.04, 0.026), (s*0.05, -HEADR*0.9, HEADC-0.085), "dark", "head", rot=(0,0,-s*0.16), bevel=0.008)

# Join the head parts on their own, pivot at the neck, and tilt the whole head up so the face
# reads from the elevated camera. The tilt bakes into the mesh at the final join.
head_objs = parts[head_start:]
del parts[head_start:]
bpy.ops.object.select_all(action='DESELECT')
for o in head_objs: o.select_set(True)
bpy.context.view_layer.objects.active = head_objs[0]
bpy.ops.object.join()
head_asm = bpy.context.active_object
bpy.context.scene.cursor.location = (0, 0, NECK)
bpy.ops.object.origin_set(type='ORIGIN_CURSOR')
head_asm.rotation_euler = (HEAD_TILT, 0, 0)
parts.append(head_asm)

# ---- join into one mesh ---------------------------------------------------------------------
bpy.ops.object.select_all(action='DESELECT')
for o in parts: o.select_set(True)
bpy.context.view_layer.objects.active = parts[0]
bpy.ops.object.join()
mesh = bpy.context.active_object
mesh.name = "Victor"
mesh.location = (0, 0, 0)

# ---- armature -------------------------------------------------------------------------------
arm_data = bpy.data.armatures.new("VictorRig")
arm = bpy.data.objects.new("VictorRig", arm_data)
scene.collection.objects.link(arm)
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='EDIT')
eb = arm_data.edit_bones
def bone(name, head, tail, parent=None):
    b = eb.new(name); b.head = head; b.tail = tail; b.roll = 0.0
    if parent: b.parent = eb[parent]
    return b
bone("root",  (0,0,0),      (0,0,0.10))
bone("hips",  (0,0,HIP-0.02),(0,0,SH-0.10), "root")
bone("spine", (0,0,SH-0.10), (0,0,NECK),    "hips")
bone("head",  (0,0,NECK),    (0,0,NECK+0.5),"spine")
for s, tag in ((1,"L"), (-1,"R")):
    bone(f"thigh.{tag}", (s*LEGX,0,HIP-0.02), (s*LEGX,0,KNEE), "hips")
    bone(f"shin.{tag}",  (s*LEGX,0,KNEE),     (s*LEGX,0,ANKLE), f"thigh.{tag}")
    bone(f"arm.{tag}",   (s*ARMX,0,SH-0.06),  (s*ARMX,0,SH-0.52), "spine")
bpy.ops.object.mode_set(mode='OBJECT')

# bind: armature modifier on the mesh + parent
amod = mesh.modifiers.new("Armature", "ARMATURE"); amod.object = arm
mesh.parent = arm

# ---- animation helpers ----------------------------------------------------------------------
FPS = 24; scene.render.fps = FPS
bpy.context.view_layer.objects.active = arm
bpy.ops.object.mode_set(mode='POSE')
for pb in arm.pose.bones:
    pb.rotation_mode = 'XYZ'

def key(bone, frame, rx=0.0, ry=0.0, rz=0.0, loc=None):
    pb = arm.pose.bones[bone]
    pb.rotation_euler = (rx, ry, rz)
    pb.keyframe_insert("rotation_euler", frame=frame)
    if loc is not None:
        pb.location = loc
        pb.keyframe_insert("location", frame=frame)

def new_action(name):
    arm.animation_data_create()
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    arm.animation_data.action = act
    return act

# ---- Idle: subtle breathing bob + tiny arm sway + slow head drift --------------------------
new_action("Idle")
IDLE_N = 48
for f in range(0, IDLE_N + 1):
    t = f / IDLE_N
    bob = math.sin(t * 2 * math.pi) * 0.012            # hips up/down (bone-local Y ≈ up here)
    sway = math.sin(t * 2 * math.pi) * 0.05
    key("hips", f, loc=(0, bob, 0))
    key("spine", f, rx=math.sin(t*2*math.pi)*0.02)
    key("head", f, rx=math.sin(t*2*math.pi + 0.6)*0.03, rz=math.sin(t*2*math.pi)*0.02)
    key("arm.L", f, rx=sway); key("arm.R", f, rx=-sway)

# ---- Walk: in-place cycle — legs/arms counter-swing, knee bend, hip bob --------------------
new_action("Walk")
WALK_N = 24
SWING = 0.62; KNEEB = 0.7; ARMSW = 0.5
for f in range(0, WALK_N + 1):
    t = f / WALK_N
    a = math.sin(t * 2 * math.pi)
    b = math.sin(t * 2 * math.pi + math.pi)
    key("thigh.L", f, rx=a * SWING)
    key("thigh.R", f, rx=b * SWING)
    # knees bend as that leg swings back / lifts (clamp negative part)
    key("shin.L", f, rx=max(0.0, -a) * KNEEB)
    key("shin.R", f, rx=max(0.0, -b) * KNEEB)
    # arms counter-swing to same-side leg
    key("arm.L", f, rx=-a * ARMSW)
    key("arm.R", f, rx=-b * ARMSW)
    # hips: two small bobs per stride + slight yaw
    key("hips", f, rz=math.sin(t*2*math.pi)*0.06, loc=(0, abs(math.sin(t*2*math.pi))*0.02, 0))
    key("spine", f, rz=-math.sin(t*2*math.pi)*0.05)

bpy.ops.object.mode_set(mode='OBJECT')

# ---- report + export ------------------------------------------------------------------------
mesh.data.calc_loop_triangles()
tris = len(mesh.data.loop_triangles)
print(f"REPORT tris={tris} materials={len(mesh.data.materials)} verts={len(mesh.data.vertices)}")

out = "/home/user/Gaming-App/assets/characters/victor.glb"
os.makedirs(os.path.dirname(out), exist_ok=True)
# select armature + mesh for export
bpy.ops.object.select_all(action='DESELECT')
arm.select_set(True); mesh.select_set(True)
bpy.context.view_layer.objects.active = arm
bpy.ops.export_scene.gltf(
    filepath=out, export_format='GLB', use_selection=True,
    export_apply=False, export_animations=True, export_animation_mode='ACTIONS',
    export_yup=True, export_morph=False,
)
print(f"REPORT file_bytes={os.path.getsize(out)} path={out}")
