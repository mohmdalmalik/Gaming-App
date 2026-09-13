# Headless Blender (bpy module) pipeline check: build a small rounded, animated object and export
# a binary glTF (.glb). Kept entirely separate from the game (tools/ only).
import bpy, math, addon_utils, os

try:
    addon_utils.enable("io_scene_gltf2", default_set=True, persistent=True)
except Exception as e:
    print("addon enable note:", e)

bpy.ops.wm.read_factory_settings(use_empty=True)

def smooth(obj):
    for p in obj.data.polygons:
        p.use_smooth = True

def solid_material(name, rgba, roughness=0.6):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    if bsdf is None:
        bsdf = mat.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Base Color"].default_value = rgba
    bsdf.inputs["Roughness"].default_value = roughness
    return mat

# A rounded "guest" stand-in: a subdivided/beveled body + a smooth head sphere.
bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=0.32, location=(0, 0, 1.15))
head = bpy.context.active_object; head.name = "Head"; smooth(head)

bpy.ops.mesh.primitive_cube_add(size=1.0, location=(0, 0, 0.55))
body = bpy.context.active_object; body.name = "Body"
body.scale = (0.55, 0.4, 0.7)
bpy.ops.object.modifier_add(type='BEVEL'); body.modifiers["Bevel"].width = 0.12; body.modifiers["Bevel"].segments = 3
bpy.ops.object.modifier_add(type='SUBSURF'); body.modifiers["Subdivision"].levels = 2
smooth(body)

body.data.materials.append(solid_material("Suit", (0.16, 0.19, 0.34, 1.0)))
head.data.materials.append(solid_material("Skin", (0.86, 0.66, 0.50, 1.0)))

# Parent head to body, keyframe a gentle idle bob + turn (frames 1..24) to test animation export.
head.parent = body
scene = bpy.context.scene
scene.frame_start = 1; scene.frame_end = 24
for f, z, deg in [(1, 0.55, 0.0), (12, 0.63, 12.0), (24, 0.55, 0.0)]:
    scene.frame_set(f)
    body.location.z = z
    body.rotation_euler.z = math.radians(deg)
    body.keyframe_insert("location", index=2)
    body.keyframe_insert("rotation_euler", index=2)

out = "/home/user/Gaming-App/tools/char-pipeline/test_guest.glb"
bpy.ops.export_scene.gltf(filepath=out, export_format='GLB', export_animations=True, export_apply=True)
print(f"OK exported {out} ({os.path.getsize(out)} bytes); frames {scene.frame_start}-{scene.frame_end}")
