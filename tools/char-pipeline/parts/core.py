# Parts pipeline core (Blender bpy 4.2, headless): build a guest as SEPARATE swappable pieces that share ONE rig.
# Production port of the parts proof (scratchpad parts-proof/pipeline/parts_kit.py). The kit modules in
# tools/char-pipeline/ (guest_kit, dress_kit, male_extras, victor_lib) are imported and never changed.
#
# A piece is a group of kit objects (the hair shell; the jacket + lapels + sleeves + shirt front ...) joined into one
# mesh, given smooth normals, BAKED IN CONTEXT (ambient occlusion from the body and its usual neighbours, so it shades
# like the one-piece guest), skinned to the shared armature and exported as its own GLB. The body GLB also carries the
# Idle and Walk clips. The shadow a piece casts on another piece (hair on the forehead, the jacket hem on the trousers)
# is an "AO patch": per target piece, per target material, the glTF vertex indices and their multipliers; the game
# multiplies them in when it assembles a guest, so any combination shades like a one-piece bake.
#
# The post-step after Blender's export makes every file follow the parts format (contract 3.3): uint8 skin weights
# that sum to 255 (12 bytes a vertex saved), the armature node named `Rig`, the mesh node named after the file,
# metallic 0 / roughness 1 / double-sided materials, the material colours of THIS piece, and the scene extras the
# manifest reads (slot, id, fit, hash, materials -> palette entries, patches, eye centre ...).
import sys, os, math, json
from pathlib import Path
import bpy, bmesh
import numpy as np
from mathutils import Vector

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
for p in (str(HERE), str(KIT), str(KIT / 'guests')):
    if p not in sys.path: sys.path.insert(0, p)
import guest_kit as GK
import dress_kit as DK
import victor_lib as L
import glb as G
import tables as T

def _copy(o):
    d = o.copy(); d.data = o.data.copy(); bpy.context.scene.collection.objects.link(d)
    for m in list(d.modifiers): d.modifiers.remove(m)
    return d

def group(g, name, fn):
    """Run fn() (kit builders adding objects to g.parts) and join everything it added into ONE mesh named `name`."""
    n0 = len(g.parts); fn(); objs = g.parts[n0:]
    if not objs: raise RuntimeError(f'{name}: the builder added nothing')
    counts = {}
    for o in objs:
        k = ''.join(ch for ch in o.name.split('.')[0] if not ch.isdigit()).rstrip('LR-') or o.name
        counts[k] = counts.get(k, 0) + L.tri_count(o)
    print(f'REPORT {name} tris by part: ' + ', '.join(f'{k} {v}' for k, v in sorted(counts.items(), key=lambda kv: -kv[1])))
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    if len(objs) > 1: bpy.ops.object.join()
    m = bpy.context.view_layer.objects.active; m.name = name; m.data.name = name; m.location = (0, 0, 0)
    del g.parts[n0:]
    # degenerate faces (a voxel-meshed sculpt can leave a few): dissolve them, so the export never drops or mangles
    # triangles ("Mesh is not valid" from the glTF exporter); nothing changes on a clean mesh
    bm = bmesh.new(); bm.from_mesh(m.data)
    before = len(bm.faces); bmesh.ops.dissolve_degenerate(bm, dist=1e-7, edges=bm.edges[:])
    if len(bm.faces) != before: print(f'REPORT {name}: {before - len(bm.faces)} degenerate faces removed')
    bm.to_mesh(m.data); bm.free(); m.data.validate(clean_customdata=False)
    return m

def tri_count(ob): return L.tri_count(ob)

def bake_colours(g, mesh, ctx=(), groove=None, cfg=None):
    """guest_kit.bake (unchanged) on a temporary join of `mesh` (its vertices first) with the context meshes ->
    the (N, 4) COLOR_0 of `mesh`'s vertices as a one-piece bake would give them in that company. cfg overlays g.C
    for this bake only (the piece's own tint / sheen / crown darkening / groove darkening / occluders)."""
    dups = [_copy(o) for o in [mesh] + [c for c in ctx if c is not None]]
    bpy.ops.object.select_all(action='DESELECT')
    for d in dups: d.select_set(True)
    bpy.context.view_layer.objects.active = dups[0]
    if len(dups) > 1: bpy.ops.object.join()
    j = bpy.context.view_layer.objects.active
    n = len(mesh.data.vertices)
    a = np.array([v.co[:] for v in mesh.data.vertices]); b = np.array([j.data.vertices[i].co[:] for i in range(n)])
    assert np.abs(a - b).max() < 1e-6, 'join did not keep the piece first'
    keep = (getattr(g, 'mesh', None), getattr(g, 'hair_groove', None), g.C)
    g.mesh = j; g.hair_groove = groove
    if cfg: g.C = dict(g.C, **cfg)
    try: GK.bake(g)
    finally:
        col = j.data.color_attributes['Col']
        out = np.array([col.data[i].color[:] for i in range(n)])
        me = j.data; bpy.data.objects.remove(j); bpy.data.meshes.remove(me)
        g.mesh, g.hair_groove, g.C = keep
    return out

def write_colours(mesh, cols):
    me = mesh.data
    col = me.color_attributes.get('Col') or me.color_attributes.new(name='Col', type='FLOAT_COLOR', domain='POINT')
    me.color_attributes.active_color = col; me.color_attributes.render_color_index = me.color_attributes.find('Col')
    for i, c in enumerate(cols): col.data[i].color = tuple(float(x) for x in c)

def read_colours(mesh):
    col = mesh.data.color_attributes['Col']
    return np.array([col.data[i].color[:] for i in range(len(mesh.data.vertices))])

def vertex_materials(mesh):
    """Material name of every vertex (the first face that uses it)."""
    me = mesh.data; slot = {i: m.name for i, m in enumerate(me.materials) if m}; out = [''] * len(me.vertices)
    for poly in me.polygons:
        for vi in poly.vertices:
            if not out[vi]: out[vi] = slot.get(poly.material_index, '')
    return out

def lift(cols, mats, scale):
    """dress_kit.lift_ao on an (N, 4) array: per material, red = 1 - (1 - red) * scale, green / blue keep their ratio."""
    out = cols.copy()
    for i, m in enumerate(mats):
        s = scale.get(m)
        if s is None: continue
        r = max(1e-4, out[i, 0]); r2 = 1 - (1 - r) * s
        out[i, :3] = (r2, min(1.0, r2 * out[i, 1] / r), min(1.0, r2 * out[i, 2] / r))
    return out

def ao_patch(g, target, base_ctx, casters, thresh=0.995, cfg=None, lift_scale=None):
    """Multiplier per vertex of `target` for the shadow the `casters` add: bake(target | base + casters) /
    bake(target | base) on the red channel. lift_scale (the target's own AO softening, e.g. Henry's fair face) is
    applied to the multiplier. -> (Blender vertex indices, multipliers) where it darkens by more than 0.5 %."""
    a = bake_colours(g, target, base_ctx, cfg=cfg)[:, 0]; b = bake_colours(g, target, list(base_ctx) + list(casters), cfg=cfg)[:, 0]
    r = np.clip(b / np.maximum(a, 1e-4), 0.0, 1.0)
    if lift_scale:
        mats = vertex_materials(target)
        s = np.array([lift_scale.get(m, 1.0) for m in mats])
        r = 1.0 - (1.0 - r) * s
    idx = np.nonzero(r < thresh)[0]
    return idx, r[idx]

def attach(mesh, arm):
    mesh.parent = arm
    mod = mesh.modifiers.new('Armature', 'ARMATURE'); mod.object = arm

def export_glb(arm, mesh, out, anims=False):
    out = Path(out); out.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT'); arm.select_set(True); mesh.select_set(True); bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(filepath=str(out), export_format='GLB', use_selection=True, export_apply=False, export_animations=anims,
                              export_animation_mode='ACTIONS', export_yup=True, export_morph=False, export_extras=True,
                              export_vertex_color='ACTIVE', export_all_vertex_colors=False)

def _lin(hexcol):
    return [round(float(c), 6) for c in L.hexlin(hexcol)] + [1.0]

def postprocess(path, key, body, materials, colours=None, extras=None):
    """Make an exported GLB follow the parts format: uint8 weights, node names, materials, scene extras.
    materials: {material name: palette entry}; colours: {material name: '#rrggbb'} (this piece's own colours)."""
    gltf, binb = G.read(path)
    replace = {}
    for _, _, p, mat in G.prim_list(gltf):
        a = p['attributes']
        for k in [k for k in a if k.startswith('TEXCOORD') or k.startswith('COLOR_') and k != 'COLOR_0']: a.pop(k)
        wi = a['WEIGHTS_0']
        if gltf['accessors'][wi]['componentType'] == 5126:
            replace[wi] = (G.quantise_weights(G.accessor(gltf, binb, wi)), 5121, True)
            gltf['accessors'][wi].pop('min', None); gltf['accessors'][wi].pop('max', None)
    binb = G.repack(gltf, binb, replace)
    r6 = lambda v: [round(float(x), 6) for x in v]        # float noise out of the JSON (it counts toward the byte cap)
    for n in gltf['nodes']:
        for k in ('translation', 'rotation', 'scale'):
            if k in n: n[k] = r6(n[k])
    for a in gltf['accessors']:
        for k in ('min', 'max'):
            if k in a and a['componentType'] == 5126: a[k] = r6(a[k])
    for n in gltf['nodes']:
        if 'mesh' in n: n['name'] = key
        elif n.get('name', '').endswith('Rig') and 'children' in n and not n.get('mesh'): n['name'] = 'Rig'
    for m in gltf.get('meshes', []): m['name'] = key
    if gltf.get('skins'): gltf['skins'][0]['name'] = 'Rig'
    used = set()
    for m in gltf.get('materials', []):
        name = m.get('name', '')
        pbr = m.setdefault('pbrMetallicRoughness', {})
        pbr['metallicFactor'] = 0; pbr['roughnessFactor'] = 1
        if colours and name in colours: pbr['baseColorFactor'] = _lin(colours[name])
        m['doubleSided'] = True
        used.add(name)
    ex = dict(partFormat=T.PART_FORMAT, body=body)
    slot, ident, fit = T.split_key(key)
    ex.update(slot=slot, id=ident, key=key, fit=(f'{fit[0]}_{fit[1]}' if fit else None))
    ex['hash'] = G.piece_hash(gltf, binb)
    ex['materials'] = {n: materials.get(n, T.PALETTE.get(n)) for n in sorted(used)}
    if extras: ex.update(extras)
    gltf['scenes'][0]['extras'] = ex
    G.write(path, gltf, binb)
    return ex['hash']

def set_scene_extras(path, extras):
    gltf, binb = G.read(path)
    gltf['scenes'][0].setdefault('extras', {}).update(extras)
    G.write(path, gltf, binb)

def file_hash(path):
    gltf, binb = G.read(path); return G.piece_hash(gltf, binb)

def map_patch(target_glb, mesh, idx, mul, tol=2e-5):
    """Blender vertex indices of `mesh` -> {material: {'idx': [glTF vertex indices], 'mul': [...]}} in target_glb
    (glTF splits by material and duplicates vertices at sharp edges: matched by position within `tol`)."""
    from scipy.spatial import cKDTree
    gltf, binb = G.read(target_glb)
    prims = G.positions_by_material(gltf, binb)
    names = list(prims); allp = np.concatenate([prims[n] for n in names]).astype(np.float64)
    owner = np.concatenate([[k] * len(prims[n]) for k, n in enumerate(names)]); local = np.concatenate([np.arange(len(prims[n])) for n in names])
    tree = cKDTree(allp); out = {}; miss = 0
    co = np.array([mesh.data.vertices[int(i)].co[:] for i in idx]) if len(idx) else np.zeros((0, 3))
    for (x, y, z), m in zip(co, mul):
        hits = tree.query_ball_point((x, z, -y), tol)
        if not hits: miss += 1; continue
        for h in hits:
            d = out.setdefault(names[owner[h]], {'idx': [], 'mul': []}); d['idx'].append(int(local[h])); d['mul'].append(round(float(m), 3))
    for d in out.values():                       # sorted by index (stable files, easy to read)
        order = np.argsort(d['idx']); d['idx'] = [d['idx'][k] for k in order]; d['mul'] = [d['mul'][k] for k in order]
    return out, miss

def glb_vertex_map(target_glb, mesh, tol=2e-5):
    """For checks: how many of mesh's vertices are found in the GLB (deterministic rebuild sanity)."""
    gltf, binb = G.read(target_glb)
    from scipy.spatial import cKDTree
    allp = np.concatenate(list(G.positions_by_material(gltf, binb).values())).astype(np.float64)
    tree = cKDTree(allp); co = np.array([v.co[:] for v in mesh.data.vertices])
    d, _ = tree.query(np.stack([co[:, 0], co[:, 2], -co[:, 1]], 1))
    return int((d > tol).sum())

def fib_points(n, z_min=-0.2):
    """Roughly even unit directions (Fibonacci sphere), only those with z > z_min."""
    out = []; ga = math.pi * (3 - math.sqrt(5))
    for i in range(n):
        z = 1 - 2 * (i + 0.5) / n; r = math.sqrt(max(0.0, 1 - z * z)); t = ga * i
        if z > z_min: out.append((r * math.cos(t), r * math.sin(t), z))
    return out

def hidden_by(target, idx, caster, reach=0.15, fan=75.0):
    """Of the target's vertices `idx`, those the caster HIDES: every ray of a fan round the vertex's outward normal
    (the normal and 8 directions `fan` degrees off it) hits the caster within `reach` (the trouser tops under the jacket,
    the skull under the hair, the shirt under the bow tie). A shadow patch there would never be seen, so it is left out
    of the file (the format is unchanged: fewer entries)."""
    from mathutils.bvhtree import BVHTree
    bm = bmesh.new(); bm.from_mesh(caster.data); bmesh.ops.triangulate(bm, faces=bm.faces[:]); tree = BVHTree.FromBMesh(bm); bm.free()
    me = target.data; out = np.zeros(len(idx), bool)
    for k, vi in enumerate(idx):
        v = me.vertices[int(vi)]; n = Vector(me.vertex_normals[int(vi)].vector).normalized()
        a = Vector((1, 0, 0)) if abs(n.x) < 0.9 else Vector((0, 1, 0)); t1 = a.cross(n).normalized(); t2 = n.cross(t1)
        o = v.co + n * 0.0015; hid = True
        for j in range(9):
            if j == 0: d = n
            else:
                ang = 2 * math.pi * (j - 1) / 8; d = (n * math.cos(math.radians(fan)) + (t1 * math.cos(ang) + t2 * math.sin(ang)) * math.sin(math.radians(fan))).normalized()
            if tree.ray_cast(o, d, reach)[0] is None: hid = False; break
        out[k] = hid
    # a vertex's colour blends across every triangle it is part of: it only counts as hidden when every vertex it
    # shares a face with is hidden too (else the visible part of that triangle would lose its shadow)
    hidden = {int(vi) for k, vi in enumerate(idx) if out[k]}
    keep = set()
    for poly in me.polygons:
        vs = list(poly.vertices)
        if any(v not in hidden for v in vs): keep.update(v for v in vs if v in hidden)
    return np.array([bool(out[k]) and int(vi) not in keep for k, vi in enumerate(idx)], bool)
