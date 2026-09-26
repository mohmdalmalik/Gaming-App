# Male extras — small reusable parts for the suited male guests, on top of guest_kit.py (which stays untouched):
#   glasses(g, G)        round wire spectacles: two rims (tubes on flat, slightly wrapped planes in front of the
#                        face), a keyhole bridge over the nose, temple arms running back to the ears
#   bow_tie(g, B)        a fuller bow tie than guest_kit.bow_tie (tall wings pinched to a knot), on the collar
#   studs(g, S)          shirt studs (small glossy spheres on the shirt front)
#   pocket_square(g, P)  a folded white square peeking out of the chest welt (two soft points)
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

def stepped_hair(g, hair, hairline, edge, thin_below=None, steps=(), crease_dark=1.0):
    """guest_kit.hair_shell plus SCULPTED LOCK STEPS: each step is a curve [(u, pct)] on the hair surface along
    which the surface on one side (`side` +1/-1 relative to the curve's direction x the outward normal) stands
    `depth` proud, rising over `w` (the rounded lock edge) and easing back to the base surface over `reach`
    (a flat, slightly tilted lock plane overlapping the next one), with a narrow crease on the low side. Steps fade
    in/out over `fade` of their length. The curves are sampled on a first, plain shell (then discarded).
    steps: [dict(keys=[(u, pct)], depth, w, reach, side, crease, fade, n)]."""
    import numpy as np, bpy
    base = {k: v for k, v in hair.items() if k not in ('grooves', 'disp')}
    ob = GK.hair_shell(g, hairline=hairline, edge=edge, thin_below=thin_below, **base)
    C = []
    for st in steps:
        ks = [list(k) for k in st['keys']]
        for i in range(1, len(ks)):
            while ks[i][0] - ks[i - 1][0] > 0.5: ks[i][0] -= 1.0
            while ks[i][0] - ks[i - 1][0] < -0.5: ks[i][0] += 1.0
        dense = L.catmull_rom([(u, p, 0.0) for u, p in ks], st.get('n', 36))
        P, N = [], []
        for u, p, _ in dense:
            q, n = g.hair_surface(u % 1.0, p); P.append(tuple(q)); N.append(tuple(n))
        P = np.array(P); N = np.array(N); T = np.gradient(P, axis=0); T /= np.maximum(1e-9, np.linalg.norm(T, axis=1))[:, None]
        C.append((P, N, T, st))
    g.parts.remove(ob); bpy.data.objects.remove(ob, do_unlink=True)
    def near(P, p):
        A = P[:-1]; AB = P[1:] - A; L2 = np.maximum(1e-12, (AB * AB).sum(1))
        t = np.clip(((p - A) * AB).sum(1) / L2, 0.0, 1.0); Q = A + AB * t[:, None]; d = np.linalg.norm(Q - p, axis=1)
        i = int(np.argmin(d)); return i, t[i], Q[i], d[i]
    def step_amt(p):
        """(raise, crease) at point p (numpy)."""
        up = 0.0; cr = 0.0
        for P, N, T, st in C:
            lo = P.min(0) - st.get('reach', 0.03) - 0.01; hi = P.max(0) + st.get('reach', 0.03) + 0.01
            if np.any(p < lo) or np.any(p > hi): continue
            i, t, q, d = near(P, p)
            s = (i + t) / (len(P) - 1); f = st.get('fade', 0.18)
            taper = sm(s / f) * sm((1.0 - s) / f)
            if taper <= 1e-4: continue
            side = np.dot(np.cross(T[i], N[i]), p - q) * st.get('side', 1)
            w = st.get('w', 0.005); reach = st.get('reach', 0.03); dep = st['depth']
            if side > 0:
                up += dep * taper * sm(d / w) * max(0.0, 1.0 - d / reach) ** 1.3
            else:
                cr += st.get('crease', 0.5) * dep * taper * math.exp(-(d / w) ** 2)
        return up, cr
    def disp(u, v, p):
        up, cr = step_amt(np.array([p.x, p.y, p.z])); return up - cr
    extra = dict(hair); extra.pop('disp', None)
    ob = GK.hair_shell(g, hairline=hairline, edge=edge, thin_below=thin_below, disp=disp, **extra)
    hg = getattr(g, 'hair_groove', None)
    def groove(p):
        up, cr = step_amt(np.array([p.x, p.y, p.z]))
        return (hg(p) if hg else 0.0) + crease_dark * cr * 4.0
    g.hair_groove = groove
    return ob
