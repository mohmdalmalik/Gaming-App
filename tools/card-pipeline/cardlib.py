# Shared helpers for the card-art pipeline: scene reset, procedural geometry (lathe, extruded 2D
# outlines, tubes along curves, booleans), a small material library, the studio light rig, the
# auto-framing camera and the Cycles render. See make_cards.py for the cards themselves.
import bpy, bmesh, math, os
from mathutils import Vector, Matrix, Euler

# ---- colour ------------------------------------------------------------------------------------
def lin(h, a=1.0):
    """'#rrggbb' (sRGB) -> linear RGBA tuple."""
    h = h.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(((v / 12.92) if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4) for v in c) + (a,)

# ---- scene -------------------------------------------------------------------------------------
def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    return sc

ROOT = None
def root():
    """Every part is parented to one empty so the whole object can be normalised and posed."""
    global ROOT
    ROOT = bpy.data.objects.new('ROOT', None)
    bpy.context.scene.collection.objects.link(ROOT)
    return ROOT

def link(ob, parent=True):
    bpy.context.scene.collection.objects.link(ob)
    if parent and ROOT is not None and ob is not ROOT:
        ob.parent = ROOT
    return ob

def set_sharp(me, angle=40):
    """Smooth shading with edges sharper than `angle` degrees kept crisp."""
    bm = bmesh.new(); bm.from_mesh(me)
    lim = math.radians(angle)
    for f in bm.faces: f.smooth = True
    for e in bm.edges:
        if len(e.link_faces) == 2:
            e.smooth = e.calc_face_angle(0) < lim
        else:
            e.smooth = False
    bm.to_mesh(me); bm.free(); me.update()

def mesh_obj(name, bm, mat=None, sharp=40, loc=(0, 0, 0), rot=(0, 0, 0), scale=None):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    if sharp is not None: set_sharp(me, sharp)
    ob = bpy.data.objects.new(name, me)
    if mat: me.materials.append(mat)
    ob.location = loc; ob.rotation_euler = rot
    if scale is not None: ob.scale = scale if hasattr(scale, '__len__') else (scale,) * 3
    return link(ob)

def bake(ob, sharp=40):
    """Apply all modifiers (and curve -> mesh) in place; keeps materials, then re-smooths."""
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    if sharp is not None: set_sharp(me, sharp)
    new = bpy.data.objects.new(ob.name + '_m', me)
    new.matrix_world = ob.matrix_world.copy()
    link(new, parent=False)
    new.parent = ob.parent
    new.matrix_parent_inverse = ob.matrix_parent_inverse.copy()
    new.location, new.rotation_euler, new.scale = ob.location.copy(), ob.rotation_euler.copy(), ob.scale.copy()
    bpy.data.objects.remove(ob)
    return new

def bevel(ob, width, seg=3, angle=35, sharp=40):
    m = ob.modifiers.new('bev', 'BEVEL')
    m.width = width; m.segments = seg; m.limit_method = 'ANGLE'; m.angle_limit = math.radians(angle)
    m.profile = 0.5; m.miter_outer = 'MITER_ARC'
    return bake(ob, sharp)

def boolean(ob, cutter, op='DIFFERENCE', sharp=40, keep=False):
    m = ob.modifiers.new('bool', 'BOOLEAN')
    m.operation = op; m.object = cutter; m.solver = 'EXACT'
    cutter.hide_render = True; cutter.hide_viewport = True
    out = bake(ob, sharp)
    if not keep: bpy.data.objects.remove(cutter)
    return out

def subsurf(ob, levels=2, sharp=None):
    m = ob.modifiers.new('sub', 'SUBSURF'); m.levels = levels; m.render_levels = levels
    return bake(ob, sharp)

# ---- geometry primitives -----------------------------------------------------------------------
def lathe(name, prof, mat=None, seg=64, sharp=40, loc=(0, 0, 0), rot=(0, 0, 0), arc=None):
    """Surface of revolution about Z from a list of (r, z). r == 0 points become poles."""
    bm = bmesh.new()
    rings = []
    n = seg
    full = arc is None
    cols = n if full else n + 1
    for (r, z) in prof:
        if r < 1e-6:
            rings.append([bm.verts.new((0, 0, z))])
        else:
            ring = []
            for i in range(cols):
                a = (2 * math.pi * i / n) if full else (arc[0] + (arc[1] - arc[0]) * i / n)
                ring.append(bm.verts.new((r * math.cos(a), r * math.sin(a), z)))
            rings.append(ring)
    for A, B in zip(rings, rings[1:]):
        if len(A) == 1 and len(B) == 1: continue
        if len(A) == 1:
            for i in range(cols if full else cols - 1):
                bm.faces.new((A[0], B[(i + 1) % cols], B[i]))
        elif len(B) == 1:
            for i in range(cols if full else cols - 1):
                bm.faces.new((A[i], A[(i + 1) % cols], B[0]))
        else:
            for i in range(cols if full else cols - 1):
                j = (i + 1) % cols
                bm.faces.new((A[i], A[j], B[j], B[i]))
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_obj(name, bm, mat, sharp, loc, rot)

def extrude2d(name, poly, depth, mat=None, bev=0.0, seg=3, sharp=40, loc=(0, 0, 0), rot=(0, 0, 0), holes=()):
    """A flat outline (list of (x, y)) extruded along Z by `depth`, centred on z = 0, optionally
    bevelled. Coordinates are in the XY plane; rotate the object to stand it up."""
    bm = bmesh.new()
    def ring(pts, z):
        return [bm.verts.new((x, y, z)) for (x, y) in pts]
    lo = ring(poly, -depth / 2); hi = ring(poly, depth / 2)
    n = len(poly)
    for i in range(n):
        j = (i + 1) % n
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    bm.faces.new(hi); bm.faces.new(list(reversed(lo)))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = mesh_obj(name, bm, mat, None, loc, rot)
    if bev > 0:
        ob = bevel(ob, bev, seg, sharp=sharp)
    else:
        set_sharp(ob.data, sharp)
    return ob

def tube(name, pts, radius, mat=None, res=4, closed=False, kind='BEZIER', taper=None, sharp=None, fill_caps=True, bevres=6, twist=0):
    """A round tube following the points (smooth Bezier with auto handles)."""
    cu = bpy.data.curves.new(name, 'CURVE'); cu.dimensions = '3D'
    cu.bevel_depth = radius; cu.bevel_resolution = bevres; cu.use_fill_caps = fill_caps
    cu.resolution_u = res * 3
    if kind == 'BEZIER':
        sp = cu.splines.new('BEZIER'); sp.bezier_points.add(len(pts) - 1)
        for bp, p in zip(sp.bezier_points, pts):
            bp.co = p; bp.handle_left_type = bp.handle_right_type = 'AUTO'
    else:
        sp = cu.splines.new('POLY'); sp.points.add(len(pts) - 1)
        for bp, p in zip(sp.points, pts): bp.co = (*p, 1)
    sp.use_cyclic_u = closed
    ob = bpy.data.objects.new(name, cu)
    if mat: cu.materials.append(mat)
    link(ob)
    return bake(ob, sharp)

def box(name, size, mat=None, bev=0.0, seg=3, loc=(0, 0, 0), rot=(0, 0, 0), sharp=40):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    for v in bm.verts: v.co = Vector((v.co.x * size[0], v.co.y * size[1], v.co.z * size[2]))
    ob = mesh_obj(name, bm, mat, None, loc, rot)
    if bev > 0: ob = bevel(ob, bev, seg, sharp=sharp)
    else: set_sharp(ob.data, sharp)
    return ob

def cyl(name, r, h, mat=None, seg=48, bev=0.0, loc=(0, 0, 0), rot=(0, 0, 0), sharp=40, r2=None):
    """Cylinder along Z centred at the origin (r2: a different top radius -> cone)."""
    r2 = r if r2 is None else r2
    ob = lathe(name, [(0, -h / 2), (r, -h / 2), (r2, h / 2), (0, h / 2)], mat, seg, None, loc, rot)
    if bev > 0: ob = bevel(ob, bev, 3, sharp=sharp)
    else: set_sharp(ob.data, sharp)
    return ob

def sphere(name, r, mat=None, loc=(0, 0, 0), scale=(1, 1, 1), seg=48, rings=24, rot=(0, 0, 0)):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=rings, radius=r)
    for f in bm.faces: f.smooth = True
    ob = mesh_obj(name, bm, mat, None, loc, rot)
    for p in ob.data.polygons: p.use_smooth = True
    ob.scale = scale
    return ob

def torus(name, R, r, mat=None, loc=(0, 0, 0), rot=(0, 0, 0), seg=64, mseg=16, arc=None, scale=(1, 1, 1)):
    """Torus around Z (major radius R, minor r). arc=(a0, a1) radians makes an open section
    (as a tube, so its ends are capped)."""
    if arc is None:
        pts = [(R * math.cos(2 * math.pi * i / seg), R * math.sin(2 * math.pi * i / seg), 0) for i in range(seg)]
        ob = tube(name, pts, r, mat, closed=True, kind='POLY', bevres=max(2, mseg // 4))
    else:
        pts = [(R * math.cos(arc[0] + (arc[1] - arc[0]) * i / seg), R * math.sin(arc[0] + (arc[1] - arc[0]) * i / seg), 0) for i in range(seg + 1)]
        ob = tube(name, pts, r, mat, closed=False, kind='POLY', bevres=max(2, mseg // 4))
    ob.location = loc; ob.rotation_euler = rot; ob.scale = scale
    return ob

def text(name, s, size, depth, mat=None, loc=(0, 0, 0), rot=(0, 0, 0), bev=0.0):
    cu = bpy.data.curves.new(name, 'FONT'); cu.body = s; cu.size = size; cu.extrude = depth
    cu.align_x = 'CENTER'; cu.align_y = 'CENTER'; cu.bevel_depth = bev
    ob = bpy.data.objects.new(name, cu)
    if mat: cu.materials.append(mat)
    ob.location = loc; ob.rotation_euler = rot
    link(ob)
    return bake(ob, 30)

def join(name, obs):
    """Merge several mesh objects (same parent) into one."""
    bm = bmesh.new()
    mats = []
    for ob in obs:
        me = ob.data
        for m in me.materials:
            if m not in mats: mats.append(m)
    for ob in obs:
        tmp = bmesh.new(); tmp.from_mesh(ob.data)
        mp = {i: mats.index(m) for i, m in enumerate(ob.data.materials)}
        for f in tmp.faces: f.material_index = mp.get(f.material_index, 0)
        M = ob.matrix_local
        bmesh.ops.transform(tmp, matrix=M, verts=tmp.verts)
        me2 = bpy.data.meshes.new('tmp'); tmp.to_mesh(me2); tmp.free()
        bm.from_mesh(me2); bpy.data.meshes.remove(me2)
    for ob in obs: bpy.data.objects.remove(ob)
    me = bpy.data.meshes.new(name); bm.to_mesh(me); bm.free()
    for m in mats: me.materials.append(m)
    ob = bpy.data.objects.new(name, me)
    return link(ob)

# ---- materials ---------------------------------------------------------------------------------
class NT:
    """Tiny node-tree builder."""
    def __init__(self, mat):
        self.t = mat.node_tree; self.n = self.t.nodes; self.l = self.t.links
    def add(self, kind, **kw):
        nd = self.n.new(kind)
        for k, v in kw.items(): setattr(nd, k, v)
        return nd
    def link(self, a, b):
        self.l.new(a, b)

def new_mat(name):
    m = bpy.data.materials.new(name); m.use_nodes = True
    return m, NT(m), m.node_tree.nodes['Principled BSDF']

def P(bsdf, **kw):
    for k, v in kw.items():
        bsdf.inputs[k].default_value = v

def tex_coord(nt, kind='Object', scale=(1, 1, 1), loc=(0, 0, 0)):
    tc = nt.add('ShaderNodeTexCoord')
    mp = nt.add('ShaderNodeMapping'); mp.inputs['Scale'].default_value = scale; mp.inputs['Location'].default_value = loc
    nt.link(tc.outputs[kind], mp.inputs['Vector'])
    return mp.outputs['Vector']

def noise(nt, vec, scale=5.0, detail=6.0, rough=0.6):
    n = nt.add('ShaderNodeTexNoise'); n.inputs['Scale'].default_value = scale
    n.inputs['Detail'].default_value = detail; n.inputs['Roughness'].default_value = rough
    nt.link(vec, n.inputs['Vector'])
    return n

def ramp(nt, fac, stops):
    r = nt.add('ShaderNodeValToRGB')
    el = r.color_ramp.elements
    el[0].position, el[0].color = stops[0][0], stops[0][1]
    el[1].position, el[1].color = stops[-1][0], stops[-1][1]
    for p, c in stops[1:-1]:
        e = el.new(p); e.color = c
    nt.link(fac, r.inputs['Fac'])
    return r

def ao_dirt(nt, color_out, dirt='#1a0f06', dist=0.08, amount=1.0):
    """Darken crevices (painterly occlusion) — mixes the base colour towards `dirt` in cavities."""
    ao = nt.add('ShaderNodeAmbientOcclusion'); ao.inputs['Distance'].default_value = dist; ao.samples = 8
    inv = nt.add('ShaderNodeMath', operation='POWER'); inv.inputs[1].default_value = 1.5
    nt.link(ao.outputs['AO'], inv.inputs[0])
    mix = nt.add('ShaderNodeMix'); mix.data_type = 'RGBA'
    one = nt.add('ShaderNodeMath', operation='SUBTRACT'); one.inputs[0].default_value = 1.0
    nt.link(inv.outputs[0], one.inputs[1])
    mul = nt.add('ShaderNodeMath', operation='MULTIPLY'); mul.inputs[1].default_value = amount
    nt.link(one.outputs[0], mul.inputs[0])
    nt.link(mul.outputs[0], mix.inputs['Factor'])
    nt.link(color_out, mix.inputs[6]); mix.inputs[7].default_value = lin(dirt)
    return mix.outputs[2]

def metal(name, base, rough=0.3, var=0.12, dirt='#20140a', scale=8.0, dirt_amt=0.85, aniso=0.0, spots=0.0):
    """Aged metal: colour & roughness vary with noise, cavities darkened."""
    m, nt, b = new_mat(name)
    v = tex_coord(nt, 'Object', (1, 1, 1))
    n = noise(nt, v, scale, 8, 0.65)
    c = ramp(nt, n.outputs['Fac'], [(0.3, lin(base)), (0.7, tuple(min(1, x * (1 - var * 2)) for x in lin(base)[:3]) + (1,))])
    col = ao_dirt(nt, c.outputs['Color'], dirt, 0.06, dirt_amt)
    nt.link(col, b.inputs['Base Color'])
    rr = ramp(nt, n.outputs['Fac'], [(0.3, (rough - var, rough - var, rough - var, 1)), (0.75, (rough + var, rough + var, rough + var, 1))])
    nt.link(rr.outputs['Color'], b.inputs['Roughness'])
    P(b, Metallic=1.0)
    if aniso: P(b, Anisotropic=aniso)
    return m

def plastic(name, base, rough=0.4, dirt='#140c06', dirt_amt=0.6, spec=0.5, coat=0.0, sheen=0.0, ss=0.0, var=0.0, scale=6.0):
    m, nt, b = new_mat(name)
    c = nt.add('ShaderNodeRGB'); c.outputs[0].default_value = lin(base)
    out = c.outputs[0]
    if var:
        v = tex_coord(nt); n = noise(nt, v, scale, 6, 0.6)
        r = ramp(nt, n.outputs['Fac'], [(0.3, lin(base)), (0.7, tuple(x * (1 - var) for x in lin(base)[:3]) + (1,))])
        out = r.outputs['Color']
    col = ao_dirt(nt, out, dirt, 0.05, dirt_amt) if dirt_amt else out
    nt.link(col, b.inputs['Base Color'])
    P(b, Roughness=rough)
    b.inputs['Specular IOR Level'].default_value = spec
    if coat: P(b, **{'Coat Weight': coat, 'Coat Roughness': 0.08})
    if sheen: P(b, **{'Sheen Weight': sheen, 'Sheen Roughness': 0.4})
    if ss: P(b, **{'Subsurface Weight': ss, 'Subsurface Scale': 0.03})
    return m

def wood(name, dark='#3a2012', light='#7a4526', rough=0.42, scale=3.0, rings=6.0, axis='X', coat=0.3, dirt_amt=0.7, bump=0.15, offset=(0, 0, 0)):
    """Procedural wood grain along `axis`."""
    m, nt, b = new_mat(name)
    sc = {'X': (0.15, 1, 1), 'Y': (1, 0.15, 1), 'Z': (1, 1, 0.15)}[axis]
    v = tex_coord(nt, 'Object', tuple(s * scale for s in sc), offset)
    n = noise(nt, v, 1.2, 4, 0.5)
    w = nt.add('ShaderNodeTexWave'); w.wave_type = 'RINGS'; w.rings_direction = axis
    w.inputs['Scale'].default_value = rings; w.inputs['Distortion'].default_value = 6.0
    w.inputs['Detail'].default_value = 4; w.inputs['Detail Scale'].default_value = 1.5
    nt.link(v, w.inputs['Vector'])
    fine = noise(nt, v, 40, 4, 0.6)
    mx = nt.add('ShaderNodeMix'); mx.data_type = 'FLOAT'; mx.inputs['Factor'].default_value = 0.25
    nt.link(w.outputs['Fac'], mx.inputs[2]); nt.link(fine.outputs['Fac'], mx.inputs[3])
    r = ramp(nt, mx.outputs[0], [(0.15, lin(dark)), (0.55, lin(light)), (0.95, lin(dark))])
    col = ao_dirt(nt, r.outputs['Color'], '#120904', 0.06, dirt_amt)
    nt.link(col, b.inputs['Base Color'])
    P(b, Roughness=rough)
    if coat: P(b, **{'Coat Weight': coat, 'Coat Roughness': 0.15})
    bm = nt.add('ShaderNodeBump'); bm.inputs['Strength'].default_value = bump; bm.inputs['Distance'].default_value = 0.02
    nt.link(mx.outputs[0], bm.inputs['Height']); nt.link(bm.outputs['Normal'], b.inputs['Normal'])
    return m

def emissive(name, color, strength=10.0):
    m, nt, b = new_mat(name)
    P(b, **{'Base Color': lin(color), 'Emission Color': lin(color), 'Emission Strength': strength})
    return m

# ---- lights / camera / render ------------------------------------------------------------------
def sph(az, el, d, target=Vector((0, 0, 0))):
    az, el = math.radians(az), math.radians(el)
    return target + d * Vector((math.sin(az) * math.cos(el), -math.cos(az) * math.cos(el), math.sin(el)))

def look(ob, target):
    ob.rotation_euler = (Vector(target) - ob.location).to_track_quat('-Z', 'Y').to_euler()

def area(name, loc, target, power, color, size=1.0, sx=None, glossy=True, spot=None):
    ld = bpy.data.lights.new(name, 'AREA'); ld.energy = power; ld.color = color[:3]
    ld.shape = 'RECTANGLE' if sx else 'DISK'; ld.size = size
    if sx: ld.size_y = sx
    if spot is not None: ld.spread = math.radians(spot)
    ob = bpy.data.objects.new(name, ld); ob.location = loc; look(ob, target)
    ob.visible_glossy = glossy
    bpy.context.scene.collection.objects.link(ob)
    return ob

def point(name, loc, power, color, radius=0.05):
    ld = bpy.data.lights.new(name, 'POINT'); ld.energy = power; ld.color = color[:3]; ld.shadow_soft_size = radius
    ob = bpy.data.objects.new(name, ld); ob.location = loc
    bpy.context.scene.collection.objects.link(ob)
    return ob

def world(top='#3a2a1c', horizon='#0e2019', bottom='#0a1410', strength=1.0):
    """Dim environment: warm above, dark green around (so metal reflects the card's backdrop)."""
    w = bpy.data.worlds.new('W'); w.use_nodes = True; bpy.context.scene.world = w
    t = w.node_tree; n = t.nodes; L = t.links
    bg = n['Background']; bg.inputs['Strength'].default_value = strength
    tc = n.new('ShaderNodeTexCoord'); sep = n.new('ShaderNodeSeparateXYZ')
    L.new(tc.outputs['Generated'], sep.inputs[0])
    r = n.new('ShaderNodeValToRGB'); el = r.color_ramp.elements
    el[0].position, el[0].color = 0.35, lin(bottom)
    el[1].position, el[1].color = 0.9, lin(top)
    e = el.new(0.52); e.color = lin(horizon)
    L.new(sep.outputs['Z'], r.inputs['Fac']); L.new(r.outputs['Color'], bg.inputs['Color'])
    return w

def bbox_world(obs):
    lo = Vector((1e9,) * 3); hi = Vector((-1e9,) * 3)
    dg = bpy.context.evaluated_depsgraph_get()
    for ob in obs:
        if ob.type != 'MESH' or ob.hide_render: continue
        ev = ob.evaluated_get(dg); M = ev.matrix_world
        for v in ev.data.vertices:
            p = M @ v.co
            lo = Vector(map(min, lo, p)); hi = Vector(map(max, hi, p))
    return lo, hi

def world_verts(obs, step=1):
    dg = bpy.context.evaluated_depsgraph_get(); out = []
    for ob in obs:
        if ob.type != 'MESH' or ob.hide_render: continue
        ev = ob.evaluated_get(dg); M = ev.matrix_world
        vs = ev.data.vertices
        for i in range(0, len(vs), step): out.append(M @ vs[i].co)
    return out

def normalise(size=2.0):
    """Scale ROOT so the object's largest dimension is `size`, and centre it at the origin with
    its lowest point at z = 0."""
    bpy.context.view_layer.update()
    obs = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    lo, hi = bbox_world(obs)
    s = size / max(hi - lo)
    ROOT.scale = (s, s, s)
    bpy.context.view_layer.update()
    lo, hi = bbox_world(obs)
    c = (lo + hi) / 2
    ROOT.location = Vector((-c.x, -c.y, -lo.z))
    bpy.context.view_layer.update()
    return bbox_world(obs)

def camera(az, el, target, fill=0.8, lens=70, center=(0.5, 0.5), fill_w=None):
    """A camera looking at `target` from azimuth/elevation, moved in/out and shifted so the object
    fills `fill` of the frame and its projected box is centred at `center` (0..1 image coords)."""
    from bpy_extras.object_utils import world_to_camera_view
    sc = bpy.context.scene
    cd = bpy.data.cameras.new('Cam'); cd.lens = lens; cd.sensor_width = 36
    cam = bpy.data.objects.new('Cam', cd); sc.collection.objects.link(cam); sc.camera = cam
    obs = [o for o in sc.objects if o.type == 'MESH' and not o.hide_render and not o.get('catcher')]
    verts = world_verts(obs, 1)
    if len(verts) > 40000: verts = verts[::max(1, len(verts) // 40000)]
    d = 8.0
    for _ in range(6):
        cam.location = sph(az, el, d, target); look(cam, target)
        bpy.context.view_layer.update()
        cd.shift_x = cd.shift_y = 0
        bpy.context.view_layer.update()
        P2 = [world_to_camera_view(sc, cam, v) for v in verts]
        x0 = min(p.x for p in P2); x1 = max(p.x for p in P2)
        y0 = min(p.y for p in P2); y1 = max(p.y for p in P2)
        fw = fill_w if fill_w is not None else fill
        d *= max((x1 - x0) / fw, (y1 - y0) / fill)
    cam.location = sph(az, el, d, target); look(cam, target); bpy.context.view_layer.update()
    P2 = [world_to_camera_view(sc, cam, v) for v in verts]
    x0 = min(p.x for p in P2); x1 = max(p.x for p in P2)
    y0 = min(p.y for p in P2); y1 = max(p.y for p in P2)
    cd.shift_x = ((x0 + x1) / 2 - center[0])
    cd.shift_y = ((y0 + y1) / 2 - (1 - center[1]))
    return cam, d

def catcher(z=0.0, size=40, loc=None, rot=(0, 0, 0)):
    bm = bmesh.new(); bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=size / 2)
    me = bpy.data.meshes.new('catcher'); bm.to_mesh(me); bm.free()
    ob = bpy.data.objects.new('catcher', me); ob.location = loc or (0, 0, z); ob.rotation_euler = rot
    ob.is_shadow_catcher = True; ob['catcher'] = 1
    bpy.context.scene.collection.objects.link(ob)
    return ob

def render_setup(size=640, samples=160, exposure=0.0, look='AgX - Medium High Contrast'):
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    cy = sc.cycles
    cy.device = 'CPU'; cy.samples = samples; cy.use_adaptive_sampling = True; cy.adaptive_threshold = 0.02
    cy.use_denoising = True; cy.denoiser = 'OPENIMAGEDENOISE'
    try: cy.denoising_input_passes = 'RGB_ALBEDO_NORMAL'
    except Exception: pass
    cy.max_bounces = 8; cy.glossy_bounces = 4; cy.transmission_bounces = 8; cy.diffuse_bounces = 3
    cy.caustics_reflective = False; cy.caustics_refractive = False
    cy.blur_glossy = 1.0
    sc.render.film_transparent = True
    sc.render.resolution_x = sc.render.resolution_y = size; sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = 'PNG'; sc.render.image_settings.color_mode = 'RGBA'
    sc.render.image_settings.color_depth = '16'
    sc.view_settings.view_transform = 'AgX'
    try: sc.view_settings.look = look
    except Exception: pass
    sc.view_settings.exposure = exposure
    sc.render.threads_mode = 'FIXED'; sc.render.threads = os.cpu_count() or 4

def render(path):
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)

def loft(name, sections, mat=None, cap0=True, cap1=True, closed=True, sharp=40):
    """Skin a list of cross-sections (each a list of 3D points, same count). A section that is a
    single point is a pole (a tip)."""
    bm = bmesh.new()
    R = [[bm.verts.new(p) for p in s] for s in sections]
    for A, B in zip(R, R[1:]):
        n = max(len(A), len(B))
        m = n if closed else n - 1
        for i in range(m):
            j = (i + 1) % n
            if len(A) == 1: bm.faces.new((A[0], B[i], B[j]))
            elif len(B) == 1: bm.faces.new((A[i], A[j], B[0]))
            else: bm.faces.new((A[i], A[j], B[j], B[i]))
    if cap0 and len(R[0]) > 2: bm.faces.new(list(reversed(R[0])))
    if cap1 and len(R[-1]) > 2: bm.faces.new(R[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return mesh_obj(name, bm, mat, sharp)

def rounded_rect(w, h, r, n=6):
    """Outline of a rounded rectangle centred at the origin."""
    pts = []
    for cx, cy, a0 in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, 90), (-w / 2 + r, -h / 2 + r, 180), (w / 2 - r, -h / 2 + r, 270)):
        for i in range(n + 1):
            a = math.radians(a0 + 90 * i / n)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts

def ellipse(rx, ry, n=48, cx=0, cy=0):
    return [(cx + rx * math.cos(2 * math.pi * i / n), cy + ry * math.sin(2 * math.pi * i / n)) for i in range(n)]

def smooth_poly(pts, n=8, closed=True):
    """Catmull-Rom resample of a polygon, so a few control points give a smooth outline."""
    P = [Vector((p[0], p[1], 0)) for p in pts]
    out = []
    N = len(P)
    rng = range(N) if closed else range(N - 1)
    for i in rng:
        p0 = P[(i - 1) % N] if closed or i > 0 else P[0]
        p1 = P[i]; p2 = P[(i + 1) % N]
        p3 = P[(i + 2) % N] if closed or i + 2 < N else P[-1]
        for k in range(n):
            t = k / n
            t2, t3 = t * t, t * t * t
            q = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
            out.append((q.x, q.y))
    if not closed: out.append((P[-1].x, P[-1].y))
    return out
