# Male extras — small reusable parts for the suited male guests, on top of guest_kit.py (which stays untouched):
#   glasses(g, G)        round wire spectacles: two rims (tubes on flat, slightly wrapped planes in front of the
#                        face), a keyhole bridge over the nose, temple arms running back to the ears
#   bow_tie(g, B)        a fuller bow tie than guest_kit.bow_tie (tall wings pinched to a knot), on the collar
#   studs(g, S)          shirt studs (small glossy spheres on the shirt front)
#   pocket_square(g, P)  a folded white square peeking out of the chest welt (two soft points)
#   env_hair(g, Hs)      sculpted hair: measured envelope + rounded lock rolls + carved grooves (SDF, surface nets)
#   bend_normals(...)    stylised shading help: bend a material's normals toward a direction (e.g. a round lower face)
# Heights are PERCENT OF STANDING HEIGHT FROM THE TOP, x/y in metres; Blender Z up, the guest faces -Y, HIS right
# is -X. Every part is rigid-skinned (head / spine) like the rest of the kit.
import math
import bmesh
from mathutils import Vector, Matrix
import guest_kit as GK
import victor_lib as L

sm = GK.sm

def glasses(g, G):
    """G: x (rim centre |x|), z (pct of the rim centre), r (rim radius, to the wire centre), rz (vertical radius,
    default r), wire (wire radius), gap (clearance in front of the face / nose), wrap (rad each rim turns toward the
    side), tilt (rad the rims lean back at the top), bridge_z (pct), bridge_rise (m the bridge arches up), temple_z
    (pct where the arms leave the rims), ear (x, dy from the head axis, pct) where the arms end (behind the ear top),
    drop (m the arm's tip bends down behind the ear), mat, seg (points per rim), n (tube sides)."""
    zp = g.zp; mat = G.get('mat', 'glasses'); w = G['wire']; n = G.get('n', 8); seg = G.get('seg', 40)
    zc = zp(G['z']); R = G['r']; Rz = G.get('rz', R); gap = G.get('gap', 0.010)
    rims = {}
    for s in (1, -1):
        cx = s * G['x']
        # rim frame: normal turned toward the side by `wrap`, leaning back by `tilt`
        a = G.get('wrap', 0.12) * s; t = G.get('tilt', 0.08)
        nrm = Vector((math.sin(a) * math.cos(t), -math.cos(a) * math.cos(t), math.sin(t))).normalized()
        ex = Vector((math.cos(a), math.sin(a), 0.0)); ey = nrm.cross(ex).normalized()   # in-plane axes (ex ~ +X, ey ~ up)
        if ey.z < 0: ey = -ey
        ring = [Vector((cx, 0, zc)) + ex * (R * math.cos(2 * math.pi * i / seg)) + ey * (Rz * math.sin(2 * math.pi * i / seg)) for i in range(seg)]
        # the rim plane sits `gap` in front of whatever it covers (face, nose ball, cheek): push along -nrm-ish (-Y)
        need = -1e9
        for p in ring + [Vector((cx, 0, zc)) + ex * (R * 0.7 * math.cos(2 * math.pi * i / 16)) + ey * (Rz * 0.7 * math.sin(2 * math.pi * i / 16)) for i in range(16)]:
            fy = g.face_y(p.x, p.z)
            if fy is None: continue
            # the rim point must be at y <= fy - gap (in front of the face); the plane's y offset needed
            need = max(need, p.y - (fy - gap - G.get('nose_clear', 0.0) * sm((0.03 - abs(p.x)) / 0.02)))
        # place the whole plane so its most demanding point just clears: shift by -need along Y (and keep the frame)
        off = Vector((0, -need, 0)) + Vector((0, G.get('dy', 0.0), 0))
        ring = [p + off for p in ring]
        rims[s] = (ring, nrm, ex, ey, Vector((cx, 0, zc)) + off)
        ob = L.planar_ring_tube(f'Rim{s}', [tuple(p) for p in ring], w, nrm, n=n)
        g.add(ob, mat, 'head')
    # bridge: from the inner edge of one rim to the other, arching up over the nose
    zb = zp(G.get('bridge_z', G['z'] - 1.0)); rise = G.get('bridge_rise', 0.006)
    def inner(s):
        ring = rims[s][0]; return min(ring, key=lambda p: abs(p.x) + 3 * abs(p.z - zb))
    pa, pb = inner(-1), inner(1)
    fy0 = g.face_y(0.0, zb); ymid = min(pa.y, pb.y, (fy0 if fy0 is not None else pa.y) - G.get('bridge_gap', 0.012))
    pm = Vector((0.0, ymid, max(pa.z, pb.z) + rise))
    pts = L.bezier(tuple(pa), tuple(pa.lerp(pm, 0.6) + Vector((0, 0, rise * 0.4))), tuple(pb.lerp(pm, 0.6) + Vector((0, 0, rise * 0.4))), tuple(pb), n=12)
    g.add(L.tube('Bridge', pts, [w * 0.95] * len(pts), n=n), mat, 'head')
    # temple arms: from the rim's outer edge at temple_z, back along the side of the head to the ear top, then down
    zt = zp(G.get('temple_z', G['z'] - 1.0)); ex_, ey_, ez_ = G['ear']
    for s in (1, -1):
        ring = rims[s][0]
        p0 = max(ring, key=lambda p: s * p.x - 3 * abs(p.z - zt))
        pe = Vector((s * ex_, g.Y0 + ey_, zp(ez_)))
        # hinge: a short stub pointing back from the rim, then a straight run clearing the head side
        side = G.get('side_out', 0.012)
        mid_z = p0.z + (pe.z - p0.z) * 0.5; mid_y = p0.y + (pe.y - p0.y) * 0.5
        # clearance: the arm must stay outside the skull at the mid point
        mx = s * (max(abs(p0.x), g.W(mid_z) + side))
        pts = L.bezier(tuple(p0), tuple(p0 + Vector((s * 0.004, 0.030, 0))), (mx, mid_y, mid_z), tuple(pe), n=14)
        drop = G.get('drop', 0.025)
        tip = pe + Vector((0, 0.022, -drop))
        pts = pts + [tuple(pe + (tip - pe) * k) for k in (0.35, 0.7, 1.0)]
        g.add(L.tube(f'Temple{s}', pts, [w * 0.85] * len(pts), n=6), mat, 'head')
    g.glasses_rims = rims

def bow_tie(g, B):
    """B: z (pct centre), w (half span, m), h (wing height at the tips), h_mid (height near the knot), knot (w, h, d),
    d (wing thickness), y (front face offset from the collar front, m), curve (m the wings sweep back), mat."""
    C = g.C; NY = C['neck_y']; R = C['neck_r'] + B.get('gap', 0.010); z = g.zp(B['z']); mat = B.get('mat', 'tie')
    hw = B['w']; h = B['h']; hm = B['h_mid']; kw, kh, kd = B['knot']; d = B['d']
    # the wings' back face sits just in front of whatever is behind them: the collar round the neck, or the shirt
    # front / jacket where the chest is further forward
    y0 = NY - R - B.get('y', 0.012)
    for i in range(9):
        for j in range(5):
            x = -hw + 2 * hw * i / 8; zz = z - h / 2 + h * j / 4
            y0 = min(y0, g.chest_y(x, min(zz, g.jacket_top)) - B.get('clear', 0.010))
    # each wing: a loft along x from the knot to the tip; section = rounded rect (height, thickness)
    for s in (1, -1):
        prof = []
        for t, hh, dd in [(0.0, hm * 0.8, d * 0.8), (0.12, hm, d), (0.45, h * 0.92, d * 1.05), (0.80, h, d), (0.94, h * 0.92, d * 0.9), (1.0, h * 0.6, d * 0.6)]:
            prof.append(dict(z=kw * 0.3 + (hw - kw * 0.3) * t, w=hh, d=dd, r=0.75))
        wing = L.loft(f'BowWing{s}', prof, n=16)
        L.rotate_verts(wing, (0, s * math.pi / 2, 0))             # loft axis (z) -> +/-x
        for v in wing.data.vertices:
            u = abs(v.co.x) / hw
            v.co.y += B.get('curve', 0.02) * u * u
            v.co.z *= 1.0 - B.get('pinch', 0.25) * math.exp(-((u - 0.08) / 0.12) ** 2)    # pinched near the knot
            v.co.z += B.get('droop', 0.0) * u * u
        L.translate_verts(wing, (0, y0 + d * 0.5, z)); g.add(wing, mat, 'spine')
    knot = L.uvsphere('BowKnot', 1.0, (0, 0, 0), scale=(kw * 0.5, kd * 0.5, kh * 0.5), u=14, v=10)
    for v in knot.data.vertices:                                   # a rounded box: flatten the sphere a little
        v.co.x = math.copysign(abs(v.co.x / (kw * 0.5)) ** 0.7 * kw * 0.5, v.co.x)
        v.co.z = math.copysign(abs(v.co.z / (kh * 0.5)) ** 0.8 * kh * 0.5, v.co.z)
    L.translate_verts(knot, (0, y0 + d * 0.5 - B.get('knot_out', 0.004), z)); g.add(knot, mat, 'spine')

def studs(g, S):
    """S: pts [(x, pct)], r, mat; sit on the shirt V (g.chest_y + the shirt panel's offset)."""
    for i, (x, p) in enumerate(S['pts']):
        z = g.zp(p); y = g.chest_y(x, min(z, g.jacket_top)) - S.get('out', 0.008)
        b = L.uvsphere(f'Stud{i}', S['r'], (x, y, z), scale=(1, 0.6, 1), u=10, v=6)
        g.add_w(b, S.get('mat', 'button'), g.jw)

def pocket_square(g, P):
    """P: x0, x1 (|x| span, his left), p (pct of the welt line), h (height of the points above it), mat; two soft points."""
    zp = g.zp; z0 = zp(P['p']); x0, x1 = P['x0'], P['x1']; h = P['h']
    xm = x0 + (x1 - x0) * P.get('split', 0.55)
    outline = [(x0, z0), (x1, z0 + P.get('slant', 0.0)), (x1 - 0.006, z0 + h * 0.55), (xm + 0.010, z0 + h * 0.95), (xm, z0 + h * 0.5),
               (xm - 0.012, z0 + h * 0.75), (x0 + 0.010, z0 + h * 0.60)]
    GK.slab(g, 'PocketSq', outline, lambda x, z: g.chest_y(x, z), 0.0, P.get('thick', 0.006), P.get('mat', 'shirt'), g.jw, cuts=2)

# =============================================================================================
# SCULPTED HAIR from a MEASURED ENVELOPE (signed-distance volume, polygonised with dress_kit's surface nets):
#   base   = the envelope (per-height superellipse slices from four measured extents, like guest_kit.hair_shell),
#            resampled as a smooth radius field about a centre in the head (radial_env: round crown, no knife-edge
#            ridge) and shrunk by `inset`, united with a thin skin-tight layer over the skull (t_min), limited to
#            skull + edge(u) + slope * (height above the hairline) (short sides, full top), cut at the hairline
#            with a rounded edge (edge_k)
#   rolls  = rounded locks lying ON the envelope along (u, pct, radius) keys (sink: how much of the radius hides)
#   grooves= channels carved along (u, pct, radius) keys on the envelope (between the locks)
# =============================================================================================
def env_tables(g, E):
    import numpy as np
    import dress_kit as DK
    zp = g.zp
    T = {k: DK._np_table(GK.Table([(zp(p), v) for p, v in E[k]])) for k in ('wr', 'wl', 'front', 'back', 'expo')}
    return T

def env_hair(g, Hs):
    """Hs: env (wr/wl/front/back/expo tables, like hair_shell), top (pct of the crown), hairline(u) -> pct, edge(u) -> m,
    slope (m per m above the hairline), t_min, inset, edge_k, rolls [dict(keys=[(u, pct, r)], sink, k, n)],
    grooves [dict(keys=[(u, pct, r)], k, lift, n)], voxel, tris, smooth, box_pad, name, mat.
    Sets g.hair_covers (for the skull cull), g.hair_groove (bake darkening), g.hair_env (T), g.hair_sdf."""
    import numpy as np
    import dress_kit as DK
    zp = g.zp; T = env_tables(g, Hs['env']); T['_top'] = Hs.get('top', 0.0)
    c0r = np.array([0.0, g.Y0 + Hs.get('centre', (0.0, 0.02, 14.5))[1], zp(Hs.get('centre', (0.0, 0.02, 14.5))[2])])
    R_at = radial_env(g, T, c0r, blur=Hs.get('blur', 1.5))
    Rs_at = radial_skull(g, c0r)
    def base_env(P):
        u, v, r = radial_uv(c0r, P); return (r - R_at(u, v)) * 0.9
    def skull_rad(P):
        u, v, r = radial_uv(c0r, P); return (r - Rs_at(u, v)) * 0.9
    hl = Hs['hairline']; hl_u = np.linspace(0, 1, 721); hl_z = np.array([zp(hl(u)) for u in hl_u])
    ed = Hs['edge']; ed_v = np.array([ed(u) for u in hl_u])
    tb = Hs.get('thin_below'); tb_z = np.array([zp(tb(u)) for u in hl_u]) if tb else hl_z
    c0 = np.array([0.0, g.Y0 + 0.02, zp(14.0)])
    def u_of(P): return (np.arctan2(-(P[:, 1] - c0[1]), P[:, 0] - c0[0]) - math.pi / 2) / (2 * math.pi) % 1.0
    z_top = zp(Hs.get('top', 0.0)); inset = Hs.get('inset', 0.0); t_min = Hs.get('t_min', 0.008); slope = Hs.get('slope', 0.9)
    def curve(keys, n, lift_fn):
        ks = [list(k) for k in keys]
        for i in range(1, len(ks)):
            while ks[i][0] - ks[i - 1][0] > 0.5: ks[i][0] -= 1.0
            while ks[i][0] - ks[i - 1][0] < -0.5: ks[i][0] += 1.0
        d = L.catmull_rom([tuple(k) for k in ks], n); pts, rad = [], []
        for u, p, r in d:
            q, nn = radial_point(g, R_at, c0r, u % 1.0, p)
            pts.append(tuple(q - nn * lift_fn(r))); rad.append(max(1e-3, r))
        return np.array(pts), np.array(rad)
    rolls = [(curve(R_['keys'], R_.get('n', 40), lambda r, s=R_.get('sink', 0.5): r * s), R_.get('k', 0.008)) for R_ in Hs.get('rolls', [])]
    grooves = [(curve(G_['keys'], G_.get('n', 30), lambda r, l=G_.get('lift', 0.0): -l), G_.get('k', 0.004)) for G_ in Hs.get('grooves', [])]
    def sdf(P):
        sk = skull_rad(P)
        s = base_env(P) + inset
        s = DK.smin(s, sk - t_min, 0.004)
        for (pts, rad), k in rolls: s = DK.smin(s, DK.sd_tube(P, pts, rad), k)
        for (pts, rad), k in grooves: s = DK.smax(s, -DK.sd_tube(P, pts, rad), k)
        u = u_of(P); zl = np.interp(u, hl_u, hl_z); allow = np.interp(u, hl_u, ed_v) + slope * np.maximum(0.0, P[:, 2] - np.interp(u, hl_u, tb_z))
        s = DK.smax(s, sk - allow, 0.006)                                   # short sides / thin sideburns
        s = DK.smax(s, zl - P[:, 2], Hs.get('edge_k', 0.010))               # the hairline cut (rounded)
        return s
    # box from the envelope
    pad = Hs.get('box_pad', 0.03)
    zs = np.linspace(zp(Hs.get('bottom', 30.0)), z_top, 40)
    xl = min(-float(T['wr'](z)) for z in zs) - pad; xh = max(float(T['wl'](z)) for z in zs) + pad
    yl = g.Y0 - max(float(T['front'](z)) for z in zs) - pad; yh = g.Y0 + max(float(T['back'](z)) for z in zs) + pad
    lo = (xl, yl, zp(Hs.get('bottom', 30.0))); hi = (xh, yh, z_top + pad)
    drop = lambda p: g.inside_skull(p, -0.004)
    ob = DK.sdf_object(g, Hs.get('name', 'Hair'), sdf, lo, hi, Hs.get('voxel', 0.005), drop=drop, smooth=Hs.get('smooth', 3), target_tris=Hs.get('tris', 8000))
    def covered(p, margin=0.02):
        P = np.array([[p.x, p.y, p.z]]); return bool(p.z > np.interp(u_of(P), hl_u, hl_z)[0] + margin)
    g.hair_covers = covered; g.hair_sdf = sdf; g.hair_env = T
    if grooves:
        def gam(p):
            P = np.array([[p.x, p.y, p.z]]); best = 0.0
            for (pts, rad), k in grooves:
                d = DK.sd_tube(P, pts, rad)[0]; best = max(best, float(np.clip(1.0 - d / 0.008, 0.0, 1.0)))
            return best * 0.010
        g.hair_groove = gam
    return g.add(ob, Hs.get('mat', 'hair'), 'head')

def radial_env(g, T, c0, nu=192, nv=96, blur=1.5):
    """The envelope as a RADIUS FIELD R(u, v) about c0 (u longitude as in hair_shell, v polar angle from the top),
    sampled on a grid and softly blurred: a smooth, crease-free base whose top is round (the per-height slices
    alone give a knife-edge ridge at the crown)."""
    import numpy as np
    from scipy import ndimage as nd
    us = np.arange(nu) / nu; vs = np.linspace(0.0, math.pi, nv)
    U, V = np.meshgrid(us, vs, indexing='ij'); t = 2 * math.pi * U + math.pi / 2
    D = np.stack([np.sin(V) * np.cos(t), -np.sin(V) * np.sin(t), np.cos(V)], -1)          # (nu, nv, 3)
    rs = np.arange(0.02, 0.45, 0.002); R = np.zeros((nu, nv))
    for i, r in enumerate(rs):
        P = c0 + D * r; z = P[..., 2]
        x0, x1 = -T['wr'](z), T['wl'](z); yf, yb = g.Y0 - T['front'](z), g.Y0 + T['back'](z)
        a = (x1 - x0) / 2; b = (yb - yf) / 2; e = T['expo'](z); ok = (a > 1e-4) & (b > 1e-4) & (z < g.zp(T['_top']))
        f = (np.abs(P[..., 0] - (x0 + x1) / 2) / np.maximum(a, 1e-4)) ** e + (np.abs(P[..., 1] - (yf + yb) / 2) / np.maximum(b, 1e-4)) ** e
        R = np.where(ok & (f < 1.0), r, R)
    R = np.where(R <= 0, 0.03, R)
    if blur: R = nd.gaussian_filter(R, blur, mode=('wrap', 'nearest'))
    def R_at(u, v):
        fu = (np.asarray(u) % 1.0) * nu; fv = np.clip(np.asarray(v) / math.pi * (nv - 1), 0, nv - 1.001)
        i0 = np.floor(fu).astype(int) % nu; i1 = (i0 + 1) % nu; j0 = np.floor(fv).astype(int); j1 = j0 + 1; au = fu - np.floor(fu); av = fv - j0
        return (R[i0, j0] * (1 - au) * (1 - av) + R[i1, j0] * au * (1 - av) + R[i0, j1] * (1 - au) * av + R[i1, j1] * au * av)
    return R_at

def radial_uv(c0, P):
    import numpy as np
    d = P - c0; r = np.linalg.norm(d, axis=-1); v = np.arccos(np.clip(d[..., 2] / np.maximum(r, 1e-9), -1, 1))
    u = ((np.arctan2(-d[..., 1], d[..., 0]) - math.pi / 2) / (2 * math.pi)) % 1.0
    return u, v, r

def radial_point(g, R_at, c0, u, pct, inset=0.0):
    """Point on the radial envelope at longitude u and height pct (bisection on the polar angle) + outward normal."""
    import numpy as np
    zt = g.zp(pct); lo, hi = 0.0, math.pi * 0.98
    def pt(v):
        t = 2 * math.pi * u + math.pi / 2; d = np.array([math.sin(v) * math.cos(t), -math.sin(v) * math.sin(t), math.cos(v)])
        return c0 + d * float(R_at(u, v)), d
    for _ in range(30):
        m = 0.5 * (lo + hi)
        if pt(m)[0][2] > zt: lo = m
        else: hi = m
    v = 0.5 * (lo + hi); p, d = pt(v)
    e = 1e-3
    # normal from the local surface tangents
    t1 = radial_pt_uv(R_at, c0, (u + e) % 1.0, v) - radial_pt_uv(R_at, c0, (u - e) % 1.0, v)
    t2 = radial_pt_uv(R_at, c0, u, v + e) - radial_pt_uv(R_at, c0, u, v - e)
    n = np.cross(t1, t2); n = n / max(1e-12, np.linalg.norm(n))
    if np.dot(n, d) < 0: n = -n
    return Vector(tuple(p - n * inset)), Vector(tuple(n))

def radial_pt_uv(R_at, c0, u, v):
    import numpy as np
    t = 2 * math.pi * u + math.pi / 2; d = np.array([math.sin(v) * math.cos(t), -math.sin(v) * math.sin(t), math.cos(v)])
    return c0 + d * float(R_at(u, v))

def radial_skull(g, c0, nu=192, nv=96):
    """The skull as a radius field about c0 (inside test = dress_kit.sd_skull < 0): an accurate, smooth distance to use
    for the hair's thickness limits (sd_skull's horizontal slices misjudge points above the crown)."""
    import numpy as np
    import dress_kit as DK
    from scipy import ndimage as nd
    us = np.arange(nu) / nu; vs = np.linspace(0.0, math.pi, nv)
    U, V = np.meshgrid(us, vs, indexing='ij'); t = 2 * math.pi * U + math.pi / 2
    D = np.stack([np.sin(V) * np.cos(t), -np.sin(V) * np.sin(t), np.cos(V)], -1).reshape(-1, 3)
    R = np.zeros(len(D))
    for r in np.arange(0.01, 0.40, 0.002):
        ins = DK.sd_skull(g, c0 + D * r) < 0; R = np.where(ins, r, R)
    R = nd.gaussian_filter(R.reshape(nu, nv), 0.8, mode=('wrap', 'nearest'))
    def R_at(u, v):
        fu = (np.asarray(u) % 1.0) * nu; fv = np.clip(np.asarray(v) / math.pi * (nv - 1), 0, nv - 1.001)
        i0 = np.floor(fu).astype(int) % nu; i1 = (i0 + 1) % nu; j0 = np.floor(fv).astype(int); j1 = j0 + 1; au = fu - np.floor(fu); av = fv - j0
        return (R[i0, j0] * (1 - au) * (1 - av) + R[i1, j0] * au * (1 - av) + R[i0, j1] * (1 - au) * av + R[i1, j1] * au * av)
    return R_at

def bend_normals(g, mat_name, weight, target, amount=1.0):
    """Stylised lighting help: bend the shading normals of `mat_name` vertices toward `target` (a direction) by
    weight(co) * amount (0..1), e.g. to keep a round lower face lit like the sheets' soft studio light (the chin's
    downward normals otherwise go brown under a key light from above). Writes custom split normals (exported)."""
    me = g.mesh.data; T = Vector(target).normalized()
    slot = {i for i, m in enumerate(me.materials) if m and m.name == mat_name}
    me.update()
    normals = [Vector(l.normal) for l in me.loops] if hasattr(me.loops[0], 'normal') else None
    cn = me.corner_normals if hasattr(me, 'corner_normals') else None
    out = []
    for poly in me.polygons:
        for li in poly.loop_indices:
            n = Vector(cn[li].vector) if cn is not None else normals[li]
            if poly.material_index in slot:
                co = me.vertices[me.loops[li].vertex_index].co; w = max(0.0, min(1.0, weight(co) * amount))
                if w > 0: n = (n * (1 - w) + T * w).normalized()
            out.append(n)
    me.normals_split_custom_set([tuple(n) for n in out])

def taubin(ob, iters=6, lam=0.5, mu=-0.53, pin=None):
    """Taubin smoothing (no shrink) of a mesh object in place: irons out small bumps a displaced shell picks up.
    pin(v) -> True keeps a vertex fixed (e.g. an open rim)."""
    import bmesh
    bm = bmesh.new(); bm.from_mesh(ob.data)
    fixed = {v.index for v in bm.verts if v.is_boundary or (pin and pin(v.co))}
    for _ in range(iters):
        for k in (lam, mu):
            new = {}
            for v in bm.verts:
                if v.index in fixed or not v.link_edges: continue
                avg = sum((e.other_vert(v).co for e in v.link_edges), Vector()) / len(v.link_edges)
                new[v] = v.co + (avg - v.co) * k
            for v, co in new.items(): v.co = co
    bm.to_mesh(ob.data); bm.free(); ob.data.update()

def radial_grooves(g, grooves, centre=(0.0, 0.02, 14.5), R=0.2):
    """Replace g.hair_groove (the bake's groove darkening) with a version that measures the distance to each groove
    curve by DIRECTION from the hair centre (x R metres), so raised lock planes over a groove do not hide it (the
    kit measures true 3-D distance to the undisplaced envelope). grooves: the same dicts as hair_shell's."""
    c0 = Vector((centre[0], g.Y0 + centre[1], g.zp(centre[2])))
    G = []
    for gr in grooves:
        keys = [list(k) for k in gr['keys']]
        for i in range(1, len(keys)):
            while keys[i][0] - keys[i - 1][0] > 0.5: keys[i][0] -= 1.0
            while keys[i][0] - keys[i - 1][0] < -0.5: keys[i][0] += 1.0
        pts = [(g.hair_surface(u % 1.0, p)[0] - c0).normalized() * R for u, p, *_ in L.catmull_rom([tuple(k) for k in keys], gr.get('n', 30))]
        G.append((pts, gr['depth'], gr['width']))
    def amt(p):
        q = (p - c0); q = q.normalized() * R if q.length > 1e-9 else q; off = 0.0
        for pts, depth, width in G:
            best, bi = 1e9, 0
            for i in range(len(pts) - 1):
                a, b = pts[i], pts[i + 1]; ab = b - a; L2 = ab.length_squared
                t = 0.0 if L2 < 1e-12 else max(0.0, min(1.0, (q - a).dot(ab) / L2))
                dd = (a + ab * t - q).length
                if dd < best: best, bi = dd, i + t
            if best < 3 * width:
                s = bi / (len(pts) - 1); off += depth * math.sin(math.pi * s) ** 0.6 * GK.gauss(best, width)
        return off
    g.hair_groove = amt
