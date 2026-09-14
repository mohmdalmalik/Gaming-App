# Small, deterministic geometry helpers for building stylised characters headless in Blender (bpy).
# Everything here is plain vertex maths on bmesh so it behaves identically without a window.
#
#   loft(profiles, ...)      -> a closed tube skinned over rounded-rectangle cross-sections
#   shape(obj, shapers)      -> smooth-falloff vertex displacement (programmatic proportional edit)
#   tube(points, radii, ...) -> a tapered tube along a polyline/bezier (brows, moustache, hair strands)
#   capsule(...)             -> a limb segment with rounded ends
#   ellipsoid(...)           -> a subdivided sphere scaled per axis (skull base)
#   hexlin('#rrggbb')        -> sRGB hex -> linear tuple for Principled base colour
import bpy, bmesh, math
from mathutils import Vector

# ---- colour ------------------------------------------------------------------------------
def _s2l(c):
    c = c / 255.0
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4
def hexlin(h):
    h = h.lstrip('#')
    return (_s2l(int(h[0:2], 16)), _s2l(int(h[2:4], 16)), _s2l(int(h[4:6], 16)))

def solid_material(name, hexcol, rough=0.85):
    m = bpy.data.materials.new(name); m.use_nodes = True
    b = m.node_tree.nodes.get("Principled BSDF") or m.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (*hexlin(hexcol), 1.0)
    b.inputs["Roughness"].default_value = rough
    if "Metallic" in b.inputs: b.inputs["Metallic"].default_value = 0.0
    return m

# ---- mesh object plumbing ----------------------------------------------------------------
def new_object(name, bm, smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me); bm.free()
    if smooth:
        for p in me.polygons: p.use_smooth = True
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob

def smooth_normals(ob, angle_deg=60.0):
    """Smooth shading with an auto-smooth-like split on hard edges (Blender 4.2: modifier-free path)."""
    for p in ob.data.polygons: p.use_smooth = True
    try:
        bpy.context.view_layer.objects.active = ob
        ob.select_set(True)
        bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle_deg))
    except Exception:
        pass

# ---- cross-section + loft -----------------------------------------------------------------
def rounded_rect_ring(w, d, r, n=24):
    """Points of a rounded-rectangle-like cross-section (a superellipse) in the XY plane: width w along
    X, depth d along Y. `r` is ROUNDNESS 0..1 (1 = ellipse, 0 = nearly a box); values > 1 are treated
    as an absolute corner radius and converted. Returns n Vectors, evenly spaced in parameter angle."""
    if r > 1.0:                                   # absolute radius -> roundness
        r = max(0.0, min(1.0, r / max(1e-6, min(w, d) / 2)))
    r = max(0.0, min(1.0, r))
    exp = 2.0 + 6.0 * (1.0 - r)                    # 2 = ellipse ... 8 = boxy
    k = 2.0 / exp
    pts = []
    for i in range(n):
        t = i / n * 2 * math.pi
        c, s = math.cos(t), math.sin(t)
        x = math.copysign(abs(c) ** k, c) * w / 2
        y = math.copysign(abs(s) ** k, s) * d / 2
        pts.append(Vector((x, y, 0.0)))
    return pts

def _ring_at(profile, n):
    """profile: dict(z, w, d, r, x=0, y=0, rot=0) -> list of Vector"""
    ring = rounded_rect_ring(profile['w'], profile['d'], profile.get('r', 0.0), n)
    rot = profile.get('rot', 0.0)
    out = []
    for p in ring:
        if rot:
            c, s = math.cos(rot), math.sin(rot)
            p = Vector((p.x * c - p.y * s, p.x * s + p.y * c, 0.0))
        out.append(Vector((p.x + profile.get('x', 0.0), p.y + profile.get('y', 0.0), profile['z'])))
    return out

def loft(name, profiles, n=24, cap_top=True, cap_bottom=True, smooth=True):
    """Skin a closed tube over stacked cross-sections. Each profile is a dict with keys
    z (height), w (width X), d (depth Y), r (corner radius), optional x/y offset and rot (radians).
    Profiles must be ordered bottom -> top. Returns the mesh object."""
    bm = bmesh.new()
    rings = []
    for pr in profiles:
        rings.append([bm.verts.new(v) for v in _ring_at(pr, n)])
    bm.verts.ensure_lookup_table()
    for a, b in zip(rings[:-1], rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    if cap_bottom: bm.faces.new(list(reversed(rings[0])))
    if cap_top: bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object(name, bm, smooth)

# ---- programmatic proportional editing -----------------------------------------------------
def shape(ob, shapers):
    """Displace vertices with a smooth falloff. shapers: list of dicts
       {c:(x,y,z) centre, r: radius, d:(dx,dy,dz) offset at the centre, f:'smooth'|'sharp'}
    Applied in object space, in order. Deterministic, no operators."""
    me = ob.data
    for s in shapers:
        c = Vector(s['c']); r = float(s['r']); d = Vector(s['d']); mode = s.get('f', 'smooth')
        for v in me.vertices:
            t = (v.co - c).length / r
            if t >= 1.0: continue
            w = 1.0 - t
            if mode == 'smooth': w = w * w * (3 - 2 * w)       # smoothstep
            elif mode == 'sharp': w = w ** 0.5
            v.co += d * w
    me.update()

def scale_by_height(ob, fn):
    """Radially scale each vertex about the Z axis by fn(z) -> (sx, sy). Good for jaw taper / cheeks."""
    me = ob.data
    for v in me.vertices:
        sx, sy = fn(v.co.z)
        v.co.x *= sx; v.co.y *= sy
    me.update()

# ---- primitives ---------------------------------------------------------------------------
def ellipsoid(name, r, loc, scale=(1, 1, 1), subdiv=3):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    for v in bm.verts:
        v.co = Vector((v.co.x * scale[0], v.co.y * scale[1], v.co.z * scale[2])) + Vector(loc)
    return new_object(name, bm)

def capsule(name, r_top, r_bot, z_top, z_bot, loc=(0, 0), n=16, rings=6):
    """A limb segment: a tapered cylinder with hemispherical ends, from z_bot to z_top at (x,y)=loc."""
    profiles = []
    # bottom cap
    for i in range(rings):
        a = (i / rings) * math.pi / 2
        rr = r_bot * math.cos(math.pi / 2 - a)
        profiles.append(dict(z=z_bot + r_bot - r_bot * math.sin(math.pi / 2 - a), w=2 * max(0.01, rr), d=2 * max(0.01, rr), r=max(0.005, rr)))
    profiles.append(dict(z=z_bot + r_bot, w=2 * r_bot, d=2 * r_bot, r=r_bot))
    profiles.append(dict(z=z_top - r_top, w=2 * r_top, d=2 * r_top, r=r_top))
    for i in range(1, rings + 1):
        a = (i / rings) * math.pi / 2
        rr = r_top * math.cos(a)
        profiles.append(dict(z=z_top - r_top + r_top * math.sin(a), w=2 * max(0.01, rr), d=2 * max(0.01, rr), r=max(0.005, rr)))
    for p in profiles: p['x'] = loc[0]; p['y'] = loc[1]
    return loft(name, profiles, n=n)

def tube(name, points, radii, n=10, close=False):
    """A tapered tube along a polyline. points: list of (x,y,z); radii: list of floats (same length).
    Uses parallel-transport frames so the tube doesn't twist. Ends are capped with a fan."""
    P = [Vector(p) for p in points]
    bm = bmesh.new()
    # tangents
    T = []
    for i in range(len(P)):
        a = P[max(0, i - 1)]; b = P[min(len(P) - 1, i + 1)]
        t = (b - a); T.append(t.normalized() if t.length > 1e-9 else Vector((1, 0, 0)))
    # initial normal
    up = Vector((0, 0, 1)) if abs(T[0].z) < 0.9 else Vector((0, 1, 0))
    N = (up - T[0] * up.dot(T[0])).normalized()
    rings = []
    for i in range(len(P)):
        if i > 0:
            # transport N along
            N = (N - T[i] * N.dot(T[i]))
            N = N.normalized() if N.length > 1e-9 else Vector((0, 0, 1))
        B = T[i].cross(N).normalized()
        ring = []
        for k in range(n):
            a = k / n * 2 * math.pi
            ring.append(bm.verts.new(P[i] + (N * math.cos(a) + B * math.sin(a)) * radii[i]))
        rings.append(ring)
    for a, b in zip(rings[:-1], rings[1:]):
        for i in range(n):
            j = (i + 1) % n
            bm.faces.new((a[i], a[j], b[j], b[i]))
    bm.faces.new(list(reversed(rings[0]))); bm.faces.new(rings[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return new_object(name, bm)

def bezier(p0, p1, p2, p3, n=12):
    pts = []
    for i in range(n + 1):
        t = i / n; u = 1 - t
        pts.append(tuple(u*u*u*a + 3*u*u*t*b + 3*u*t*t*c + t*t*t*d for a, b, c, d in zip(p0, p1, p2, p3)))
    return pts

def taper(n, start=0.35, mid=1.0, end=0.35, power=1.0):
    """Radius multipliers along n+1 samples: thin at both ends, full in the middle."""
    out = []
    for i in range(n + 1):
        t = i / n
        w = 1 - abs(2 * t - 1) ** power       # 0 at ends, 1 in the middle
        out.append(start + (mid - start) * w if t < 0.5 else end + (mid - end) * w)
    return out

# ---- finishing ----------------------------------------------------------------------------
def assign(ob, material, group, weight=1.0):
    ob.data.materials.clear(); ob.data.materials.append(material)
    vg = ob.vertex_groups.new(name=group)
    vg.add([v.index for v in ob.data.vertices], weight, 'REPLACE')
    return ob

def mirror_x(ob):
    """Return a mirrored copy across X (for left/right limbs)."""
    cp = ob.copy(); cp.data = ob.data.copy(); cp.name = ob.name + '.mirror'
    bpy.context.scene.collection.objects.link(cp)
    for v in cp.data.vertices: v.co.x = -v.co.x
    # flip winding so normals point outward again
    bm = bmesh.new(); bm.from_mesh(cp.data)
    bmesh.ops.reverse_faces(bm, faces=bm.faces)
    bm.to_mesh(cp.data); bm.free()
    return cp

def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs: o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    ob = bpy.context.active_object; ob.name = name
    return ob

def tri_count(ob):
    ob.data.calc_loop_triangles()
    return len(ob.data.loop_triangles)
