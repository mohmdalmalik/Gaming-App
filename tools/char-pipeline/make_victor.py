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

M = {
    "skin":  mat("Skin",  (0.86, 0.66, 0.49), 0.55),
    "hair":  mat("Hair",  (0.11, 0.08, 0.06), 0.5),
    "jacket":mat("Jacket",(0.07, 0.075, 0.10), 0.55),   # near-black, faint navy
    "shirt": mat("Shirt", (0.92, 0.89, 0.80), 0.5),     # ivory
    "accent":mat("Accent",(0.03, 0.03, 0.045), 0.4),    # bow tie / lapels / shoes (deep black)
    "dark":  mat("Dark",  (0.02, 0.02, 0.03), 0.4),     # eyes / brows / moustache
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
HEADC = 1.47; HEADR = 0.27          # still a large cartoon head, a touch smaller so it reads from above
HEAD_TILT = -0.26                    # tilt the face up so it catches the elevated camera
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
add_sphere(HEADR, (0, 0, HEADC), "skin", "head", scale=(1.0, 0.94, 1.06), subdiv=3)
# Hair: one clean "helmet" sphere, slightly larger than the head and shifted up/back, giving a
# high slicked-back hairline (matches Victor's portrait) with no fringe slab and no z-fighting.
add_sphere(HEADR*1.06, (0, 0.05, HEADC+HEADR*0.17), "hair", "head", scale=(1.07, 1.05, 1.0), subdiv=3)
# Ears
for s in (1, -1):
    add_sphere(0.06, (s*HEADR*0.98, 0.0, HEADC), "skin", "head", scale=(0.7,1,1.2))
# Nose
add_sphere(0.055, (0, -HEADR*0.98, HEADC-0.02), "skin", "head", scale=(1,1.2,1))
# Eyes (dark, with a small ivory catch-light) + expressive angled brows above a clear gap.
for s in (1, -1):
    add_sphere(0.042, (s*0.115, -HEADR*0.9, HEADC+0.05), "dark", "head", scale=(1, 0.68, 1.15))
    add_sphere(0.013, (s*0.10, -HEADR*0.99, HEADC+0.085), "shirt", "head")  # catch-light
    add_box((0.11, 0.02, 0.028), (s*0.115, -HEADR*0.93, HEADC+0.185), "dark", "head", rot=(0, 0, -s*0.26), bevel=0.004)
# Neat moustache (two angled bars under the nose)
for s in (1, -1):
    add_box((0.10, 0.05, 0.035), (s*0.055, -HEADR*0.86, HEADC-0.12), "dark", "head", rot=(0,0,-s*0.2), bevel=0.008)

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
