# Dress kit — reusable parts for the hotel's DRESS guests (Eleanor, Clara, Beatrice), on top of guest_kit.py.
#   python3 tools/char-pipeline/make_dress_guest.py <name>     (spec: tools/char-pipeline/guests/<name>.py)
#
# guest_kit supplies the context (Guest, zp, materials, skull tables, add/add_w), the head/face/hair builders,
# bare arms + hands, and join/bake/rig/animate/export. This file adds what a dress guest needs instead of a
# suit, all parameterised by plain dicts in the spec (heights are PERCENT OF STANDING HEIGHT FROM THE TOP, x/y
# in metres; Blender Z up, the guest faces -Y, HER right is -X):
#
#   neck_yoke(g, NY)        skin neck flaring into the shoulders / upper chest (shows above any neckline)
#   bodice(g, B)            fitted torso from the waist to the neckline (bateau / scoop / crew / v), rolled top edge;
#                           sets g.bod_y(x, z, back) (surface lookups for belts), g.bw (skin weights)
#   sleeves(g, A, S)        'cap' | 'short' | 'long' (optional 'puff' at the shoulder + 'cuff' band at the wrist);
#                           the arm itself is guest_kit.arms(g, A) (bare skin under cap/short sleeves)
#   belt(g, Bt)             'metal' (thin band, optional buckle, sheen) | 'sash' (fabric band + knot + two tails)
#   skirt(g, K)             'bell' | 'a-line' | 'column' profiles (or an explicit measured profile), soft vertical
#                           folds, gently wavy hem, a turned-in hem lip; walk-safe skin weights (hips + a share of
#                           the thighs toward the hem; 'follow' for a column skirt that must move with the legs)
#   legs(g, Lg)             bare legs (skin) from inside the skirt to the ankle
#   pumps(g, S)             low-heeled court shoes: sole + block heel + low upper, the skin instep showing
#   lips(g, Li)             small closed smiling lips (upper lip with a soft bow, fuller lower lip)
#   earrings(g, E)          'stud' / 'ball' (pearl or gold sphere at the lobe), optional 'drop'
#   eye_shine(g, Sh)        a small painted white glint on each eye;  jaw_lift(g, skull, J): jawline climbing to the ear
#   shade (g.post_bake)     per-material colour multipliers after the bake (e.g. the neck's shadow under the chin)
#   hair_bands (g.hair_band_specs)  glossy light/dark colour bands along hair rolls, painted after the bake
#   soft_hands(g, A)        guest_kit.hands' fingers/thumb with a rounded tapered palm + wrist ball (same A['hand'])
#   soft_normals(g, Sn)     (via CFG['soft_normals'], applied in finish) even, glowing face shading: face normals bent
#                           toward a smooth front-facing ellipsoid (the lower face no longer shades like stubble)
#   coil_bun(g, Bn)         a twisted chignon: a rope coiled in a tightening spiral round an axis + a filling core
#   finish(g, RIG, out)     guest_kit join -> bake -> rig -> animate -> eyeCentre (one eye, glTF space) -> export
#
# Budget reminders: <= 32k triangles, GLB <= 1.2 MB. Every builder prints nothing; guest_kit.join prints tris by part.
import math, time
from pathlib import Path
import bpy, bmesh
from mathutils import Vector, Matrix
import guest_kit as GK
import victor_lib as L

sm = L.smoothstep
Table = GK.Table

def _se_xy(a, b, k, phi):
    """Superellipse point (x, y offset) at parameter phi: phi 0 = front (-Y), pi/2 = her left (+X)."""
    s, c = math.sin(phi), math.cos(phi)
    return (a * math.copysign(abs(s) ** k, s), -b * math.copysign(abs(c) ** k, c))

def _profile_tables(g, profiles):
    """profiles [(pct, width, depth, roundness, y_centre)] -> (TW, TD, TR, TY) PCHIP tables in world z."""
    P = sorted([(g.zp(p), w, d, r, y) for p, w, d, r, y in profiles])
    return tuple(Table([(q[0], q[k]) for q in P]) for k in (1, 2, 3, 4)) + (P[0][0], P[-1][0])

def _bvh(ob):
    from mathutils.bvhtree import BVHTree
    bm = bmesh.new(); bm.from_mesh(ob.data); bmesh.ops.triangulate(bm, faces=bm.faces[:]); t = BVHTree.FromBMesh(bm); bm.free()
    return t

# =============================================================================================
# NECK + YOKE (skin): neck column flaring into the shoulders and upper chest under the neckline
# =============================================================================================
def neck_yoke(g, NY):
    """NY['rings']: [(pct, width, depth, roundness, y_centre)] from the top (inside the head) down to below the
    neckline (inside the bodice). Weights: neck above NY['split'] (pct), spine below (blended over NY['blend'] m)."""
    rings = sorted([dict(z=g.zp(p), w=w, d=d, r=r, y=y) for p, w, d, r, y in NY['rings']], key=lambda q: q['z'])
    ob = L.loft('Neck', rings, n=NY.get('n', 28), cap_top=False, cap_bottom=False)
    zs = g.zp(NY['split']); bl = NY.get('blend', 0.03)
    return g.add_w(ob, 'skin', lambda co: {'neck': sm((co.z - zs + bl) / (2 * bl)), 'spine': 1 - sm((co.z - zs + bl) / (2 * bl))})

# =============================================================================================
# BODICE — a fitted torso built by COLUMNS: each column (ring parameter phi) runs from the bottom up to the
# neckline height at that phi, so the neckline is an exact clean edge (no deleted faces); a short rolled lip
# turns the edge inward. Rings are superellipses from B['profiles'].
# =============================================================================================
NECKLINES = {                # (power of |cos phi| shaping the dip, default front/back dips in pct below the side)
    'bateau': 2.0, 'crew': 1.4, 'scoop': 1.2, 'v': 0.45,
}
def neckline_fn(B):
    """Top height (pct) by ring parameter phi for B['neck'] = dict(kind, side, front, back[, power])."""
    N = B['neck']; p = N.get('power', NECKLINES.get(N.get('kind', 'bateau'), 2.0))
    side, front, back = N['side'], N['front'], N['back']
    def top(phi):
        c = math.cos(phi); w = abs(c) ** p
        if N.get('kind') == 'v' and c > 0: w = max(0.0, 1.0 - (1.0 - abs(c)) / N.get('v_width', 0.35)) ** 1.2 if abs(c) > 1.0 - N.get('v_width', 0.35) else 0.0
        return side + ((front if c > 0 else back) - side) * w
    return top

def bodice(g, B):
    zp = g.zp
    TW, TD, TR, TY, z_bot, z_topring = _profile_tables(g, B['profiles'])
    def ring_pt(phi, z):
        e = 2.0 + 6.0 * (1.0 - TR(z)); k = 2.0 / e
        x, y = _se_xy(TW(z) / 2, TD(z) / 2, k, phi); return Vector((x, y + TY(z), z))
    top = neckline_fn(B)
    NC, NR = B.get('ncol', 64), B.get('nrow', 26)
    lip = B.get('lip', 0.006)
    bm = bmesh.new(); cols = []
    for i in range(NC):
        phi = 2 * math.pi * i / NC
        zt = zp(top(phi)); zt = min(zt, z_topring)
        col = []
        for j in range(NR + 1):
            s = j / NR; s = 1 - (1 - s) ** 1.25                          # a little denser toward the neckline
            col.append(ring_pt(phi, z_bot + (zt - z_bot) * s))
        # rolled edge: over the top and turned in toward the body
        p = col[-1]; cxy = Vector((0.0, TY(zt), 0.0)); d = Vector((p.x, p.y, 0.0)) - cxy
        d = d.normalized() if d.length > 1e-6 else Vector((0, -1, 0))
        col.append(p - d * lip * 0.5 + Vector((0, 0, lip * 0.35)))
        col.append(p - d * lip * 1.3 - Vector((0, 0, lip * 0.6)))
        cols.append([bm.verts.new(q) for q in col])
    n = len(cols[0])
    for i in range(NC):
        a, b = cols[i], cols[(i + 1) % NC]
        for j in range(n - 1): bm.faces.new((a[j], b[j], b[j + 1], a[j + 1]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = L.new_object('Bodice', bm, smooth=True)
    tree = _bvh(ob)
    def bod_y(x, z, back=False):
        o = Vector((x, 1.0 if back else -1.0, z)); hit = tree.ray_cast(o, Vector((0, -1.0 if back else 1.0, 0)), 2.0)
        return hit[0].y if hit[0] is not None else ring_pt(0.0 if not back else math.pi, z).y
    def bod_r(phi, z):
        """World point on the bodice at ring angle phi (0 front, pi/2 her left) and height z, by a ray from outside."""
        c = Vector((0.0, TY(z), z)); d = Vector((math.sin(phi), -math.cos(phi), 0.0))
        hit = tree.ray_cast(c + d * 1.0, -d, 2.0)
        return hit[0] if hit[0] is not None else ring_pt(phi, z)
    g.bod_y, g.bod_r, g.bod_ring = bod_y, bod_r, ring_pt
    zw = zp(B['waist']); bl = B.get('hips_blend', 0.05); hh = B.get('hips_share', 0.5)
    g.bw = lambda co: {'spine': 1 - hh * sm((zw + bl * 0.3 - co.z) / bl), 'hips': hh * sm((zw + bl * 0.3 - co.z) / bl)}
    return g.add_w(ob, B.get('mat', 'dress'), g.bw)

# =============================================================================================
# SLEEVES — horizontal rings round the arm path (guest_kit.arm_path), weighted like the arm (upper/fore split at
# the elbow). 'cap': a short flared cap over the shoulder with a slanted hem; 'short': to above the elbow;
# 'long': to the wrist, with an optional 'puff' (extra radius near the shoulder, gathered at the cap) and
# 'cuff' (a band at the wrist).
# =============================================================================================
def sleeves(g, A, S):
    zp = g.zp; kind = S.get('kind', 'cap'); mat = S.get('mat', 'dress')
    for s, tag in ((1, 'L'), (-1, 'R')):
        SX, ZJ, (ex, ey, ZE), (hx, hy, ZW), xy = GK.arm_path(g, A, s)
        z_end = zp(S['end'])
        prof = []
        for zspec, w, d in S['stations']:           # like guest_kit.arms: 'end', pct, or ('j', dz) above the joint
            if zspec == 'end': z = z_end
            elif isinstance(zspec, tuple): z = ZJ + zspec[1]
            else: z = zp(zspec)
            x, y = xy(min(z, ZJ))
            if z > ZJ: x -= s * S.get('cap_in', 0.012) * (z - ZJ) / 0.05
            prof.append(dict(z=z, w=w, d=d, r=1.0, x=x, y=y))
        prof.sort(key=lambda p: p['z'])
        # densify below the shoulder so the rings follow the bent arm path (a long sleeve crosses the elbow)
        dense = [prof[0]]
        for p0, p1 in zip(prof[:-1], prof[1:]):
            k = max(1, int(math.ceil((p1['z'] - p0['z']) / S.get('ring_dz', 0.03))))
            for i in range(1, k + 1):
                t = i / k; z = p0['z'] + (p1['z'] - p0['z']) * t
                q = dict(z=z, w=p0['w'] + (p1['w'] - p0['w']) * t, d=p0['d'] + (p1['d'] - p0['d']) * t, r=1.0)
                if z <= ZJ: q['x'], q['y'] = xy(z)
                else: q['x'], q['y'] = p0['x'] + (p1['x'] - p0['x']) * t, p0['y'] + (p1['y'] - p0['y']) * t
                dense.append(q)
        prof = dense
        # never narrower than the arm underneath (+ clearance): a bare-skin arm (guest_kit.arms) stays hidden
        ast = []
        for zspec, w, d in A.get('stations', []):
            if zspec == 'end': z = zp(A['sleeve_end'])
            elif isinstance(zspec, tuple): z = ZJ + zspec[1]
            else: z = zp(zspec)
            ast.append((z, w, d))
        if ast and S.get('clear', 0.008) is not None:
            ast.sort(); cl = S.get('clear', 0.008)
            def arm_wd(z):
                if z <= ast[0][0]: return ast[0][1:]
                if z >= ast[-1][0]: return None                      # above the arm's cap: the sleeve's own shape
                for (z0, w0, d0), (z1, w1, d1) in zip(ast, ast[1:]):
                    if z0 <= z <= z1: t = (z - z0) / max(1e-9, z1 - z0); return (w0 + (w1 - w0) * t, d0 + (d1 - d0) * t)
            for q in prof:
                wd = arm_wd(q['z'])
                if wd and q['z'] <= ZJ: q['w'] = max(q['w'], wd[0] + 2 * cl); q['d'] = max(q['d'], wd[1] + 2 * cl)
        sl = L.loft(f'Sleeve{tag}', prof, n=S.get('n', 20), cap_bottom=False)
        # hem: slanted (outer side higher, the inner side toward the armpit lower) and turned in (a lip)
        slant = S.get('slant', 0.0); lip = S.get('lip', 0.005)
        bm = bmesh.new(); bm.from_mesh(sl.data)
        zmin = min(v.co.z for v in bm.verts)
        edge = [v for v in bm.verts if abs(v.co.z - zmin) < 1e-6]
        cx0 = sum(v.co.x for v in edge) / len(edge); cy0 = sum(v.co.y for v in edge) / len(edge)
        for v in bm.verts:
            if v.co.z < z_end + 0.03:
                t = sm((z_end + 0.03 - v.co.z) / 0.03)
                v.co.z -= slant * t * (0.5 - 0.5 * s * (v.co.x - cx0) / max(1e-6, max(abs(q.co.x - cx0) for q in edge)))
        # turn the open hem in: extrude the boundary inward + up (a visible fabric thickness, no see-through)
        bnd = [e for e in bm.edges if e.is_boundary]
        ret = bmesh.ops.extrude_edge_only(bm, edges=bnd)
        for v in [q for q in ret['geom'] if isinstance(q, bmesh.types.BMVert)]:
            d = Vector((v.co.x - cx0, v.co.y - cy0, 0.0)); d = d.normalized() if d.length > 1e-6 else Vector()
            v.co += -d * lip + Vector((0, 0, lip * 1.5))
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces); bm.to_mesh(sl.data); bm.free()
        if kind == 'long':
            g.add_split(sl, mat, f'upperarm.{tag}', f'forearm.{tag}', ZE, 0.035)
        else:
            g.add(sl, mat, f'upperarm.{tag}')
        if S.get('cuff'):
            Cf = S['cuff']; c1, c0 = zp(Cf['end']), zp(Cf['end']) + Cf['len']
            prof = [dict(z=c1, w=Cf['w'] * 0.94, d=Cf['d'] * 0.94, r=1.0), dict(z=c1 + 0.005, w=Cf['w'], d=Cf['d'], r=1.0),
                    dict(z=c0 - 0.005, w=Cf['w'], d=Cf['d'], r=1.0), dict(z=c0, w=Cf['w'] * 0.94, d=Cf['d'] * 0.94, r=1.0)]
            for p in prof: p['x'], p['y'] = xy(p['z'])
            g.add(L.loft(f'Cuff{tag}', prof, n=16), Cf.get('mat', mat), f'forearm.{tag}')

def puff_stations(end_pct, top_w, puff_w, arm_w, cuff_pct=None):
    """Convenience: stations for a long puff sleeve (gathered cap -> puff -> fitted forearm), for sleeves(kind='long')."""
    st = [('end', arm_w, arm_w), (('j', 0.034), top_w * 0.55, top_w * 0.60), (('j', 0.018), top_w, top_w * 1.05),
          (('j', -0.01), puff_w, puff_w * 1.02), (('j', -0.06), puff_w * 1.04, puff_w * 1.05), (('j', -0.11), puff_w * 0.90, puff_w * 0.92),
          (('j', -0.15), arm_w * 1.12, arm_w * 1.10)]
    return st

# =============================================================================================
# BELT — a band hugging the bodice/skirt surface between two heights. 'metal': thin, rounded edges, optional
# buckle; 'sash': taller soft band with a knot (front or side) and two hanging tails.
# =============================================================================================
def belt(g, Bt, surf_pt=None):
    """Bt: kind, top/bot (pct), thick, mat, n; sash: knot=dict(phi (0 front, +pi/2 her left), w, h, d),
    tails=[(dphi, length m, width m, splay rad)]; metal: buckle=dict(w, h, d, mat) at phi 0."""
    zp = g.zp; surf_pt = surf_pt or g.bod_r
    z1, z0 = zp(Bt['top']), zp(Bt['bot']); T = Bt.get('thick', 0.006); N = Bt.get('n', 64)
    kind = Bt.get('kind', 'metal'); mat = Bt.get('mat', 'gold')
    # cross-section profile of the band (fraction of height, outward offset in units of T): rounded edges
    prof = [(0.0, 0.1), (0.02, 0.65), (0.12, 1.0), (0.88, 1.0), (0.98, 0.65), (1.0, 0.1)]
    if kind == 'sash': prof = [(0.0, 0.2), (0.05, 0.8), (0.25, 1.15), (0.5, 0.9), (0.75, 1.15), (0.95, 0.8), (1.0, 0.2)]
    bm = bmesh.new(); rows = []
    for fz, _ in prof:
        z = z0 + (z1 - z0) * fz; rows.append([])
    for i in range(N):
        phi = 2 * math.pi * i / N
        for r, (fz, off) in zip(rows, prof):
            z = z0 + (z1 - z0) * fz; p = surf_pt(phi, z)
            n = Vector((math.sin(phi), -math.cos(phi), 0.0))
            r.append(bm.verts.new(p + n * (T * off - 0.0015)))
    for a, b in zip(rows[:-1], rows[1:]):
        for i in range(N):
            j = (i + 1) % N; bm.faces.new((a[i], a[j], b[j], b[i]))
    # the band's edges start just under the surface it hugs (profile offset ~0.1 T - 1.5 mm): no inner wall needed
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = L.new_object('Belt', bm, smooth=True)
    bw = lambda co: {'spine': 0.5, 'hips': 0.5}
    g.add_w(ob, mat, bw)
    zc = 0.5 * (z0 + z1)
    if kind == 'metal' and Bt.get('buckle'):
        Bk = Bt['buckle']; p = surf_pt(Bk.get('phi', 0.0), zc)
        bk = L.loft('Buckle', [dict(z=zc - Bk['h'] / 2, w=Bk['w'], d=Bk['d'], r=0.5), dict(z=zc + Bk['h'] / 2, w=Bk['w'], d=Bk['d'], r=0.5)], n=16)
        L.translate_verts(bk, (p.x, p.y - T - Bk['d'] * 0.3, 0)); g.add_w(bk, Bk.get('mat', mat), bw)
    if kind == 'sash':
        K = Bt.get('knot', dict(phi=0.0, w=0.07, h=0.06, d=0.035)); phi = K['phi']
        p = surf_pt(phi, zc); n = Vector((math.sin(phi), -math.cos(phi), 0.0))
        kn = L.uvsphere('SashKnot', 1.0, (0, 0, 0), scale=(K['w'] / 2, K['d'] / 2, K['h'] / 2), u=16, v=10)
        rot = Vector((0, -1, 0)).rotation_difference(n).to_matrix().to_4x4(); kn.data.transform(rot)
        L.translate_verts(kn, p + n * (T + K['d'] * 0.25)); g.add_w(kn, mat, bw)
        for k_, (dphi, ln, wd, spl) in enumerate(Bt.get('tails', [(-0.12, 0.30, 0.05, 0.10), (0.10, 0.26, 0.05, -0.08)])):
            pts, rads = [], []
            for t in range(9):
                f = t / 8; z = zc - 0.01 - ln * f
                ph = phi + dphi * (0.4 + 0.6 * f) + spl * f
                q = g.skirt_r(ph, z) if hasattr(g, 'skirt_r') else surf_pt(ph, z)
                nn = Vector((math.sin(ph), -math.cos(ph), 0.0))
                pts.append(q + nn * (T + 0.010)); rads.append(1.0)
            tl = L.ribbon_tube(f'SashTail{k_}', [tuple(p_) for p_ in pts], [tuple(Vector((math.sin(phi), -math.cos(phi), 0)))] * len(pts),
                               [wd * (0.75 + 0.35 * t / 8) for t in range(9)], [0.010] * 9, n=10)
            g.add_w(tl, mat, lambda co: {'hips': 1.0})
    return ob

# =============================================================================================
# SKIRT — rings from the waist to the hem. Radius at angle th: an ellipse (half-width a(z), half-depth b(z),
# centre y(z)) plus soft vertical folds amp(z) * fold(n th) growing toward the hem; the hem height waves with
# the folds; the hem turns inward (a lip) so the open bottom never shows a see-through edge.
#   K: style ('bell' | 'a-line' | 'column'), top/hem (pct), top_w/top_d, hem_w/hem_d (half sizes, m) or
#      profile=[(pct, half_w, half_d, y_centre)] (measured, overrides style), folds=dict(n, amp=[(pct, m)],
#      sharp (0 round .. 1 crisp valleys), phase), hem_wave (m), nr_per_fold, rows, lip (m),
#      weights: sway (share of the thigh at the hem), follow (share that moves WITH the legs: a column skirt),
#      top_spine (share of the spine at the very top, hides the belt seam), mat
# =============================================================================================
def skirt_profile(K, g):
    """Returns (A(z), B(z), Y(z)) tables for the skirt base ellipse."""
    zp = g.zp
    if 'profile' in K:
        P = [(zp(p), a, b, y) for p, a, b, y in K['profile']]
        return tuple(Table([(q[0], q[k]) for q in P]) for k in (1, 2, 3))
    st = K.get('style', 'bell'); zt, zh = zp(K['top']), zp(K['hem'])
    pw = {'bell': 1.55, 'a-line': 1.0, 'column': 0.6}[st]
    keys = []
    for i in range(13):
        t = i / 12; f = 1 - (1 - t) ** pw if st != 'column' else sm(min(1.0, t / 0.35)) * (1.0 - 0.08 * sm((t - 0.6) / 0.4))
        z = zt + (zh - zt) * t
        keys.append((z, K['top_w'] + (K['hem_w'] - K['top_w']) * f, K['top_d'] + (K['hem_d'] - K['top_d']) * f, K.get('top_y', 0.0) + (K.get('hem_y', 0.0) - K.get('top_y', 0.0)) * t))
    return tuple(Table([(q[0], q[k]) for q in keys]) for k in (1, 2, 3))

def skirt(g, K, R=None):
    zp = g.zp; TA, TB, TY = skirt_profile(K, g)
    zt, zh = zp(K['top']), zp(K['hem'])
    F = K.get('folds', {}); nf = F.get('n', 14); amp = Table([(zp(p), a) for p, a in F.get('amp', [(K['top'], 0.0), (K['hem'], 0.02)])])
    sharp = F.get('sharp', 0.35); ph0 = F.get('phase', 0.0)
    NR = nf * K.get('nr_per_fold', 7); ROWS = K.get('rows', 30); wave = K.get('hem_wave', 0.006); lip = K.get('lip', 0.010)
    def fold(th):
        c = math.cos(nf * th + ph0)                       # +1 crest, -1 valley; sharpen the valleys a little
        return c + sharp * (1 - c) * (1 + c) * 0.5 * (-1 if c < 0 else 0.4)
    def base_r(th, z):
        a, b = TA(z), TB(z); c, s = math.sin(th), -math.cos(th)
        return 1.0 / math.sqrt((c / a) ** 2 + (s / b) ** 2)
    def pt(th, z, extra=0.0):
        r = base_r(th, z) + amp(z) * fold(th) + extra
        return Vector((r * math.sin(th), TY(z) - r * math.cos(th), z))
    def skirt_r(th, z):                                   # a point just on the skirt (for sash tails etc.)
        return pt(th, max(zh, min(zt, z)))
    g.skirt_r = skirt_r; g.skirt_pt = pt
    bm = bmesh.new(); cols = []
    for i in range(NR):
        th = 2 * math.pi * i / NR; f = fold(th)
        zhem = zh + wave * f                              # crests hang a touch lower
        col = []
        for j in range(ROWS + 1):
            s = j / ROWS; s = s ** 1.15                       # rows a little denser near the waist
            z = zt + (zhem - zt) * s; col.append(pt(th, z))
        # hem lip: round under and turn inward, then run up the inside a little
        p = col[-1]; n = Vector((math.sin(th), -math.cos(th), 0.0))
        col.append(p - n * lip * 0.45 - Vector((0, 0, lip * 0.35)))
        col.append(p - n * lip * 1.0 + Vector((0, 0, lip * 0.1)))
        col.append(pt(th, zhem + K.get('lining', 0.10), -lip * 1.0))
        cols.append([bm.verts.new(q) for q in col])
    n_ = len(cols[0])
    for i in range(NR):
        a, b = cols[i], cols[(i + 1) % NR]
        for j in range(n_ - 1): bm.faces.new((a[j], a[j + 1], b[j + 1], b[j]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    # outward check: a face at the front mid-height should point to -Y
    ob = L.new_object('Skirt', bm, smooth=True)
    W = K.get('weights', {}); sway = W.get('sway', 0.22); follow = W.get('follow', 0.0); ts = W.get('top_spine', 0.35)
    zk = zp(R['knee']) if R else zh + 0.3; z_hipj = zp(R['hip']) if R else zt - 0.2
    def sw(co):
        t = max(0.0, min(1.0, (zt - co.z) / max(1e-6, zt - zh)))
        top = ts * (1 - sm(t / 0.08))                     # the top 8 % shares the spine (hides the belt seam)
        k = min(0.95, sway * t ** 1.4 + follow * sm((z_hipj - co.z) / 0.25))
        fl = sm((co.x + 0.06) / 0.12)                     # her left leg for x > 0, blended across the centre front/back
        shin = follow * sm((zk + 0.03 - co.z) / 0.10) if follow > 0 else 0.0
        hips = max(0.0, 1.0 - top - k)
        return {'spine': top, 'hips': hips, 'thigh.L': k * fl * (1 - shin), 'thigh.R': k * (1 - fl) * (1 - shin),
                'shin.L': k * fl * shin, 'shin.R': k * (1 - fl) * shin}
    return g.add_w(ob, K.get('mat', 'dress'), sw)

# =============================================================================================
# LEGS — bare legs (skin) from inside the skirt down to the ankle (the foot is part of pumps())
# =============================================================================================
def legs(g, Lg, R):
    """Lg: leg_x, leg_y, stations [(pct, width, depth)] top -> ankle, n. Weights: thigh above the knee, shin below."""
    zp = g.zp; zk = zp(R['knee'])
    for s, tag in ((1, 'L'), (-1, 'R')):
        prof = sorted([dict(z=zp(p), w=w, d=d, r=1.0, x=s * Lg['leg_x'], y=Lg.get('leg_y', 0.0) + dy) for p, w, d, dy in
                       [(q + (0.0,))[:4] for q in Lg['stations']]], key=lambda q: q['z'])
        lg = L.loft(f'Leg{tag}', prof, n=Lg.get('n', 16))
        g.add_split(lg, 'skin', f'thigh.{tag}', f'shin.{tag}', zk, 0.04)

# =============================================================================================
# PUMPS — low-heeled court shoes. Built along the foot (a: metres forward of the ankle, heel negative), then
# splayed and placed. The upper is LOW (a court shoe): the skin foot inside rises above its top line over the
# instep, so the opening reads without cutting holes. A block heel lifts the back; toes rest on the floor.
# =============================================================================================
def pumps(g, S):
    """S: leg_x, y, len, w (widest), heel (behind the ankle), heel_h (block heel height), heel_len, collar (height
    at the back), vamp (height of the top line at the toe box), splay (rad), out (extra x), foot_top (instep
    height at the ankle), mats: shoe / sole / skin."""
    HEEL, L0, W0 = S['heel'], S['len'], S['w']; TOE = L0 - HEEL; hh = S.get('heel_h', 0.035)
    ball = S.get('ball', TOE * 0.62)
    def sole_z(a):                                         # underside height of the foot bed along the foot
        if a >= ball - 0.01: return 0.004
        t = sm((ball - 0.01 - a) / max(1e-6, ball + HEEL - 0.03)); return 0.004 + (hh + 0.006 - 0.004) * t
    def st(a, w, top, r=0.8):
        b = sole_z(a); return dict(z=a, w=w, d=max(0.004, top - b), r=r, y=(top + b) / 2)
    col = S.get('collar', 0.085); vamp = S.get('vamp', 0.050)
    def top_line(a):                                      # shoe top edge: high at the heel counter, dipping to the vamp
        t = sm((a + HEEL * 0.6) / (HEEL * 0.6 + ball * 0.55)); return col + (vamp - col) * t
    stations = []
    for i in range(15):
        a = -HEEL + (L0) * (i / 14) ** 1.0
        f = (a + HEEL) / L0
        toe = S.get('toe_round', 2.6)                     # larger = a rounder, blunter toe
        w = W0 * (0.66 + 0.34 * math.sin(math.pi * min(1.0, f / 0.70) * 0.5) ** 0.8) if f < 0.70 else W0 * (1.0 - 0.72 * ((f - 0.70) / 0.30) ** toe)
        top = top_line(a)
        if f > 0.78: top = sole_z(a) + (top - sole_z(a)) * (1.0 - 0.70 * ((f - 0.78) / 0.22) ** 1.8)
        stations.append(st(a, max(0.012, w), top, 0.70 if f < 0.9 else 0.85))
    stations[0]['w'] *= 0.85; stations[-1]['w'] = max(0.01, stations[-1]['w'])
    shoe = L.loft('Pump', stations, n=S.get('n', 18))
    # sole plate: a thin darker slab under the forefoot + the block heel
    heel_len = S.get('heel_len', 0.042)
    hb = L.loft('PumpHeel', [dict(z=-HEEL + 0.004, w=W0 * 0.50, d=hh + 0.006, r=0.6, y=(hh + 0.006) / 2),
                             dict(z=-HEEL + heel_len, w=W0 * 0.52, d=hh + 0.006, r=0.6, y=(hh + 0.006) / 2)], n=12)
    # taper the heel block toward the floor (wider at the top, like the sheet's block heel)
    for v in hb.data.vertices:
        f = 1.0 - v.co.y / (hh + 0.006); v.co.x *= 1.0 - 0.18 * f; v.co.z += 0.006 * f
    hb.data.update()
    # foot (skin): narrower than the shoe, its top rising over the instep to the ankle
    ft = S.get('foot_top', 0.090)
    fst = []
    for i in range(9):
        a = -HEEL * 0.8 + (ball + 0.01 + HEEL * 0.8) * i / 8; f = i / 8
        ie = S.get('instep_end', 0.80)                   # the instep dips under the vamp (only its top shows); the heel stays under the collar
        top = (col - 0.010) + (ft - col + 0.010) * sm(f / 0.28) if f < 0.28 else ft + (vamp - 0.008 - ft) * sm((f - 0.28) / (ie - 0.28))
        b = sole_z(a) + 0.006
        fst.append(dict(z=a, w=W0 * S.get('foot_w', 0.72) * (0.92 + 0.08 * math.sin(math.pi * f)), d=max(0.01, top - b), r=0.95, y=(top + b) / 2))
    foot = L.loft('Foot', fst, n=16)
    parts = [(shoe, S.get('mat', 'shoe')), (hb, S.get('heel_mat', S.get('mat', 'shoe'))), (foot, 'skin')]
    for s, tag in ((1, 'L'), (-1, 'R')):
        lx = s * (S['leg_x'] + S.get('out', 0.0))
        for ob0, mat in parts:
            ob = ob0.copy(); ob.data = ob0.data.copy(); ob.name = f'{ob0.name}{tag}'; bpy.context.scene.collection.objects.link(ob)
            L.rotate_verts(ob, (math.pi / 2, 0, 0))                    # loft axis -> -Y (forward), local y -> up
            for v in ob.data.vertices:
                if v.co.z < 0.0015: v.co.z = 0.0015
            L.rotate_verts(ob, (0, 0, s * S['splay']), about=(0, 0.0, 0)); L.translate_verts(ob, (lx, S.get('y', 0.0), 0))
            g.add(ob, mat, f'foot.{tag}')
    for ob0, _ in parts: bpy.data.objects.remove(ob0, do_unlink=True)

# =============================================================================================
# SOFT HANDS — like guest_kit.hands (same A['hand'] dict), but a rounded, tapered palm (a soft mitten, no box corners)
# and a small wrist ball that hides the seam between the bare forearm and the palm.
# =============================================================================================
def soft_hands(g, A):
    Hd = A['hand']; zp = g.zp
    for s, tag in ((1, 'L'), (-1, 'R')):
        *_, (hx, hy, ZW), xy = GK.arm_path(g, A, s)
        z0 = zp(A['cuff_end']) + 0.012
        out = Vector((s, 0, 0)); fwd = Vector((0, -1, 0)); down = Vector((0, 0, -1))
        base = Vector((hx + s * Hd.get('out', 0.004), hy, 0))
        pl, pw, pt = Hd['palm_len'], Hd['palm_w'], Hd['palm_t']
        prof = [(1.00, 0.55, 0.70), (0.92, 0.80, 0.90), (0.78, 0.95, 0.98), (0.55, 1.02, 1.02), (0.30, 1.00, 0.98), (0.10, 0.86, 0.86),
                (-0.02, 0.70, 0.72), (-0.10, 0.62, 0.64)]
        palm = L.loft(f'Palm{tag}', [dict(z=z0 - pl * f, w=pt * wt, d=pw * wd, r=1.0) for f, wt, wd in prof], n=16)
        L.translate_verts(palm, base); g.add(palm, 'skin', f'hand.{tag}')
        wr = A['stations'][0][1] * 0.47 if A.get('stations') else pt * 0.55   # hides the forearm's flat end (at z0 - 0.012)
        wx, wy = xy(z0 - 0.012)
        g.add(L.uvsphere(f'Wrist{tag}', wr, (wx + s * Hd.get('out', 0.004) * 0.5, wy, z0 - 0.016), scale=(0.95, 1.0, 1.25), u=12, v=8), 'skin', f'hand.{tag}')
        for i, (yo, r, ln, bend) in enumerate(Hd['fingers']):
            p0 = Vector((base.x + s * Hd.get('finger_out', 0.004), hy + yo, z0 - pl * 0.80))
            pts = GK._curl(p0, down, -out, ln, bend, 10)
            tip = pts[-1] + (pts[-1] - pts[-2]).normalized() * r * 0.45
            rad = [r * (1.0 - 0.12 * k / 10) for k in range(11)]
            pts.append(tip); rad.append(r * 0.55)
            pts.append(tip + (pts[-1] - pts[-2]).normalized() * r * 0.35); rad.append(r * 0.18)
            g.add(L.tube(f'Finger{tag}{i}', [tuple(p) for p in pts], rad, n=8), 'skin', f'hand.{tag}')
        T = Hd['thumb']
        p0 = Vector((base.x - s * T[1], hy + T[0], z0 - T[2]))
        dirn = (down * 0.85 + fwd * 0.30 - out * 0.20).normalized(); inw = (-out * 0.8 + fwd * -0.2).normalized()
        pts = GK._curl(p0, dirn, inw, T[4], T[5], 8)
        tip = pts[-1] + (pts[-1] - pts[-2]).normalized() * T[3] * 0.45
        rad = [T[3] * (1.08 - 0.15 * k / 8) for k in range(9)] + [T[3] * 0.55, T[3] * 0.18]
        pts += [tip, tip + (tip - pts[-1]).normalized() * T[3] * 0.35]
        g.add(L.tube(f'Thumb{tag}', [tuple(p) for p in pts], rad, n=10), 'skin', f'hand.{tag}')

# =============================================================================================
# FACE EXTRAS — lips, earrings
# =============================================================================================
def lips(g, Li):
    """Li: z (pct of the lip line), w (corner to corner), rise (corners up: the smile), upper (max thickness),
    lower (max thickness), bow (dip of the upper lip's centre), mat, flat (depth kept), lift."""
    zm = g.zp(Li['z']); hw = Li['w'] * 0.5; r = Li.get('rise', 0.006); mat = Li.get('mat', 'lips')
    n = 20; lift = Li.get('lift', 0.002)
    def line(t):                                          # t -1..1 across; the lip line (a gentle smile)
        return zm + r * abs(t) ** 1.6 - Li.get('sag', 0.0015) * (1 - t * t)
    for nm, th, sgn, prof in (('LipUpper', Li['upper'], 1, [(0, 0.20), (0.18, 0.70), (0.38, 1.0), (0.5, 0.80), (0.62, 1.0), (0.82, 0.70), (1, 0.20)]),
                              ('LipLower', Li['lower'], -1, [(0, 0.20), (0.15, 0.62), (0.35, 0.95), (0.5, 1.0), (0.65, 0.95), (0.85, 0.62), (1, 0.20)])):
        ts = [-1 + 2 * i / n for i in range(n + 1)]
        rad = [th * 0.5 * k for k in L.smooth_profile(prof, [(t + 1) / 2 for t in ts])]
        pts = [tuple(g.on_face(t * hw * (0.96 if sgn < 0 else 1.0), line(t) + sgn * (rd * 0.95 - (Li.get('bow', 0.0) * (1 - abs(t)) ** 8 if sgn > 0 else 0)), lift)) for t, rd in zip(ts, rad)]
        tb = L.tube(nm, pts, [max(0.0012, q) for q in rad], n=10); g.flatten_to_face(tb, Li.get('flat', 0.45))
        g.add(tb, mat, 'head')

def earrings(g, E):
    """E: kind ('stud' | 'ball' | 'drop'), r (radius), x (|x| of the centre), dy (y offset from the head axis),
    z (pct), mat ('pearl' / 'gold'), drop=dict(len, r) for a hanging bead below."""
    for s in (1, -1):
        c = Vector((s * E['x'], g.Y0 + E.get('dy', 0.0), g.zp(E['z'])))
        g.add(L.uvsphere(f'Earring{s}', E['r'], c, u=12, v=8), E.get('mat', 'pearl'), 'head')
        if E.get('kind') == 'drop':
            D = E['drop']; g.add(L.uvsphere(f'EarDrop{s}', D['r'], c - Vector((0, 0, D['len'])), u=12, v=8), E.get('mat', 'pearl'), 'head')

def eye_shine(g, Sh):
    """A small painted highlight on each eye (the sheets' soft white glint): Sh = dict(r (radius), dx, dz (offset from
    the eye centre as a fraction of the eye's half width / half height; + = toward her left / up, mirrored or not by
    `mirror`), mat ('shine')). Needs guest_kit.eyes() first (g.eye_pts)."""
    C = g.C
    for p in getattr(g, 'eye_pts', []):
        s = 1 if (p.x > 0 or not Sh.get('mirror', False)) else -1
        n = g.face_normal(p.x, p.z)                                   # the eye disc's own plane (eyes() sits it in the face plane)
        rt = (Vector((1, 0, 0)) - n * n.x).normalized(); up = n.cross(rt).normalized()
        if up.z < 0: up = -up
        a, b = s * Sh.get('dx', -0.30), Sh.get('dz', 0.35)
        front = 0.012 * math.sqrt(max(0.05, 1.0 - a * a - b * b))           # the eye's front surface at that spot
        q = p + rt * (a * C['eye_w'] * 0.5) + up * (b * C['eye_h'] * 0.5) + n * (front + 0.0008)
        sh = L.uvsphere('EyeShine', 1.0, (0, 0, 0), scale=(Sh['r'], 0.002, Sh['r'] * 1.15), u=10, v=6)
        rot = Vector((0, -1, 0)).rotation_difference(n).to_matrix().to_4x4(); sh.data.transform(rot)
        L.translate_verts(sh, q); g.add(sh, Sh.get('mat', 'shine'), 'head')

def jaw_lift(g, ob, J):
    """Raise the underside of the head toward the back so the jawline climbs from the chin to the ear lobe (the skull
    shell's bottom is otherwise flat at the chin height). J: top (pct above which nothing moves), lift (m at the back
    bottom), y0 / y1 (offsets from the head axis: no lift in front of y0, full lift behind y1)."""
    zt = g.zp(J['top']); zc = g.zc
    for v in ob.data.vertices:
        if v.co.z >= zt: continue
        t = (zt - v.co.z) / max(1e-6, zt - zc); w = sm((v.co.y - g.Y0 - J['y0']) / (J['y1'] - J['y0']))
        v.co.z += J['lift'] * t * w
    ob.data.update()

# =============================================================================================
# HAIR EXTRAS — a coiled chignon
# =============================================================================================
def coil_bun(g, Bn):
    """Bn: centre (x, dy from the head axis, pct), axis (vector: the coil's axis, pointing out of the head),
    up (a vector roughly 'up' in the coil plane), turns, r_out/r_in (coil radius start/end), depth (how far the
    spiral climbs along the axis), rope (radius keys [(t, r)]), start (angle, rad), squash (x, y scale of the
    coil plane), drift / drift_x (the spiral centre moves down / toward Rt = her right by this much from start to end:
    the knot sits low), core (ellipsoid radii along (right, up, axis) + offset along the axis), strands (twists, depth),
    n_samples, n_ring, mat. Negative turns coil the other way (Rt is her right, U up, angle 90 deg = top)."""
    mat = Bn.get('mat', 'hair')
    cx, dy, pz = Bn['centre']; C = Vector((cx, g.Y0 + dy, g.zp(pz)))
    A = Vector(Bn['axis']).normalized(); U0 = Vector(Bn.get('up', (0, 0, 1)))
    U = (U0 - A * U0.dot(A)).normalized(); Rt = U.cross(A).normalized()
    sx, sy = Bn.get('squash', (1.0, 1.0))
    if 'core' in Bn:
        a, b, c, off = Bn['core']
        core = L.uvsphere('BunCore', 1.0, (0, 0, 0), u=24, v=16)
        M = Matrix((Rt * a, U * b, A * c)).transposed()
        for v in core.data.vertices: v.co = C + A * off + M @ v.co
        g.add(core, mat, 'head')
    N = Bn.get('n_samples', 90); pts, rads = [], []
    rope = Bn['rope']
    rr = L.smooth_profile(rope, [i / (N - 1) for i in range(N)])
    for i in range(N):
        t = i / (N - 1); ang = Bn.get('start', 0.0) + 2 * math.pi * Bn['turns'] * t
        rad = Bn['r_out'] + (Bn['r_in'] - Bn['r_out']) * t ** Bn.get('tighten', 1.0)
        Ct = C - U * (Bn.get('drift', 0.0) * t) + Rt * (Bn.get('drift_x', 0.0) * t)      # an eccentric spiral: the knot sits off centre
        p = Ct + Rt * (math.cos(ang) * rad * sx) + U * (math.sin(ang) * rad * sy) + A * (Bn.get('depth', 0.0) * math.sin(math.pi * min(1.0, t * 1.1)) ** 0.7 + Bn.get('lean', 0.0) * t)
        pts.append(tuple(p)); rads.append(max(0.003, rr[i]))
    tb = L.tube('BunCoil', pts, rads, n=Bn.get('n_ring', 14))
    if Bn.get('strands'):                                  # twist grooves along the rope (a rope of hair)
        k, dep = Bn['strands']
        bm = bmesh.new(); bm.from_mesh(tb.data); bm.verts.ensure_lookup_table(); nr = Bn.get('n_ring', 14)
        for idx, v in enumerate(bm.verts[:N * nr]):
            i, j = divmod(idx, nr); P = Vector(pts[i]); d = v.co - P
            ang = 2 * math.pi * j / nr + k * i / N * 2 * math.pi
            v.co = P + d * (1.0 - dep * (0.5 + 0.5 * math.cos(3 * ang)))
        bm.to_mesh(tb.data); bm.free()
    g.add(tb, mat, 'head')
    return pts

# =============================================================================================
# SCULPTED HAIR — a signed-distance volume (numpy) polygonised by surface nets, smoothed and decimated in
# Blender. Long / styled hair (an updo's wave rolls, a bob's curls, shoulder-length waves) is a smooth union
# of simple shapes, which a radial shell cannot express:
#   cap   : a layer over the skull (thickness by height) above the hairline (cut with a rounded edge)
#   masses: ellipsoids (x, y, pct centre; radii) — volume
#   rolls : tubes along smooth curves [(x, y_off from the head axis, pct), ...] with radius keys — waves, curls,
#           locks, wisps; each joins with its own blend k (small k keeps a crease = a sculpted groove)
#   grooves: thin tubes SUBTRACTED along curves (depth by radius), also darkened by the bake
# All coordinates are world metres except heights (pct) and y offsets from the head axis (g.Y0).
# =============================================================================================
import numpy as np

def _np_table(T):
    xs = np.linspace(T.x0, T.x1, len(T.ys)); ys = np.asarray(T.ys, dtype=np.float64)
    return lambda z: np.interp(z, xs, ys)

def smin(a, b, k):
    if k <= 0: return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0); return b * (1 - h) + a * h - k * h * (1 - h)
def smax(a, b, k): return -smin(-a, -b, k)

def sd_skull(g, P):
    """Approximate signed distance to the skull (negative inside), from the head tables (bulges ignored)."""
    W, DF, DB, E = (_np_table(t) for t in (g.W, g.DF, g.DB, g.E))
    x, y, z = P[:, 0], P[:, 1] - g.Y0, P[:, 2]
    zc = np.clip(z, g.zc, g.zt)
    w = np.maximum(W(zc), 2e-3); d = np.maximum(np.where(y < 0, DF(zc), DB(zc)), 2e-3); e = E(zc)
    ax, ay = np.abs(x) / w + 1e-9, np.abs(y) / d + 1e-9
    f = (ax ** e + ay ** e) ** (1.0 / e)
    # first-order distance: (f - 1) / |grad f| (horizontal gradient of the superellipse slice)
    gx = f ** (1 - e) * ax ** (e - 1) / w; gy = f ** (1 - e) * ay ** (e - 1) / d
    s = (f - 1.0) / np.maximum(np.sqrt(gx * gx + gy * gy), 1e-6)
    return np.maximum(s, np.maximum(z - g.zt, g.zc - z))

def sd_ellipsoid(P, c, r):
    q = (P - np.asarray(c)) / np.asarray(r); k = np.linalg.norm(q, axis=1)
    return (k - 1.0) * min(r)

def _curve(g, keys, n):
    """keys [(x, dy, pct, radius[, flat])] -> dense (N,3) points (world), radii and flatness (thickness / width)
    via Catmull-Rom."""
    ks = [(x, g.Y0 + dy, g.zp(p), r, (k[0] if k else 1.0)) for x, dy, p, r, *k in keys]
    d = np.array(L.catmull_rom(ks, n), dtype=np.float64)
    return d[:, :3], np.maximum(1e-3, d[:, 3]), np.clip(d[:, 4], 0.2, 1.0)

def sd_tube(P, pts, rad, flat=None, centre=None, margin=0.06):
    """Distance to a variable-radius tube along a polyline (min over segments). With `flat` (per point, thickness /
    width) the cross-section is an ellipse: `rad` across the surface, rad*flat along the outward direction from
    `centre` (a ribbon lying on the head). Points further than `margin` outside the bounding box get a coarse
    positive value — enough for blending."""
    lo = pts.min(0) - rad.max() - margin; hi = pts.max(0) + rad.max() + margin
    m = np.all((P >= lo) & (P <= hi), axis=1)
    out = np.full(len(P), margin)
    if m.any(): out[m] = _sd_tube(P[m], pts, rad, flat, centre)
    return out

def _sd_tube(P, pts, rad, flat=None, centre=None):
    best = np.full(len(P), 1e9)
    if flat is not None and centre is not None:
        # per-vertex outward frames (perpendicular to the local tangent), interpolated along each segment so the
        # ribbon's cross-section turns smoothly (per-segment frames left a crease at every joint)
        Tn = np.gradient(pts, axis=0); Tn /= np.maximum(1e-9, np.linalg.norm(Tn, axis=1))[:, None]
        Nv = pts - centre; Nv -= Tn * np.sum(Nv * Tn, axis=1)[:, None]; Nv /= np.maximum(1e-9, np.linalg.norm(Nv, axis=1))[:, None]
    for i in range(len(pts) - 1):
        a, b = pts[i], pts[i + 1]; ab = b - a; L2 = max(1e-12, ab @ ab)
        t = np.clip(((P - a) @ ab) / L2, 0.0, 1.0)
        v = P - (a + t[:, None] * ab); r = rad[i] + (rad[i + 1] - rad[i]) * t
        if flat is None or centre is None:
            dist = np.linalg.norm(v, axis=1) - r
        else:
            N = Nv[i][None, :] * (1 - t)[:, None] + Nv[i + 1][None, :] * t[:, None]
            N /= np.maximum(1e-9, np.linalg.norm(N, axis=1))[:, None]
            fl = flat[i] + (flat[i + 1] - flat[i]) * t
            vn = np.sum(v * N, axis=1); vt = v - vn[:, None] * N
            q = np.sqrt((np.linalg.norm(vt, axis=1) / r) ** 2 + (vn / (r * fl)) ** 2)
            dist = (q - 1.0) * r * fl
        np.minimum(best, dist, out=best)
    return best

def surface_nets(F, lo, v):
    """Surface nets over a scalar grid F (nx, ny, nz) with origin lo and voxel v: returns (verts (N,3), quads (M,4))."""
    nx, ny, nz = F.shape; inside = F < 0
    # corners of each cell
    c = [F[i:nx - 1 + i, j:ny - 1 + j, k:nz - 1 + k] for i in (0, 1) for j in (0, 1) for k in (0, 1)]
    offs = [(i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)]
    ins = np.stack([q < 0 for q in c]); act = ins.any(0) & ~ins.all(0)
    idx = np.full(act.shape, -1, dtype=np.int64); ids = np.nonzero(act); idx[ids] = np.arange(len(ids[0]))
    acc = np.zeros(ids[0].shape + (3,)); cnt = np.zeros(ids[0].shape)
    edges = [(a, b) for a in range(8) for b in range(a + 1, 8) if sum(abs(p - q) for p, q in zip(offs[a], offs[b])) == 1]
    for a, b in edges:
        fa, fb = c[a][ids], c[b][ids]; m = (fa < 0) != (fb < 0)
        t = np.where(m, fa / np.where(m, fa - fb, 1.0), 0.0)
        pa, pb = np.array(offs[a], float), np.array(offs[b], float)
        acc += m[:, None] * (pa + (pb - pa) * t[:, None]); cnt += m
    verts = np.asarray(lo) + (np.stack(ids, 1) + acc / np.maximum(cnt, 1)[:, None]) * v
    quads = []
    for ax in range(3):
        # grid edges along axis ax from point p to p+e_ax with a sign change; the 4 cells around it
        sl0 = [slice(1, n - 1) for n in F.shape]; sl1 = list(sl0)
        sl0[ax] = slice(0, F.shape[ax] - 1); sl1[ax] = slice(1, F.shape[ax])
        a0, a1 = inside[tuple(sl0)], inside[tuple(sl1)]; ch = a0 != a1
        P_ = np.nonzero(ch); flip = a0[P_]
        o1, o2 = [q for q in range(3) if q != ax]
        base = [P_[q] + (1 if q != ax else 0) for q in range(3)]          # indices into cells: point index along o1/o2 is +1 (sl start 1)
        def cell(d1, d2):
            ii = list(base); ii[o1] = ii[o1] - d1; ii[o2] = ii[o2] - d2; ii[ax] = P_[ax]
            return idx[tuple(ii)]
        q = np.stack([cell(1, 1), cell(0, 1), cell(0, 0), cell(1, 0)], 1)
        q[flip] = q[flip][:, ::-1]
        if ax == 1: q = q[:, ::-1]
        quads.append(q[(q >= 0).all(1)])
    return verts, np.concatenate(quads)

def sdf_object(g, name, sdf, lo, hi, voxel, drop=None, smooth=4, target_tris=None, chunk=400000, post_smooth=2, keep=None, keep_factor=1.0, keep_max=0.4):
    """Polygonise sdf(P (N,3)) -> (N,) over the box lo..hi; drop(p) -> True removes hidden faces (inside the skull);
    Taubin-smooth `smooth` passes; decimate to target_tris. Returns the Blender object (not yet added to g)."""
    lo = np.asarray(lo, float); hi = np.asarray(hi, float)
    n = np.ceil((hi - lo) / voxel).astype(int) + 1
    gx, gy, gz = (lo[i] + np.arange(n[i]) * voxel for i in range(3))
    G = np.stack(np.meshgrid(gx, gy, gz, indexing='ij'), -1).reshape(-1, 3)
    F = np.empty(len(G))
    for s in range(0, len(G), chunk): F[s:s + chunk] = sdf(G[s:s + chunk])
    F = F.reshape(n)
    edge = min(F[0].min(), F[-1].min(), F[:, 0].min(), F[:, -1].min(), F[:, :, 0].min(), F[:, :, -1].min())
    if edge < 0: print(f'REPORT WARNING {name}: the volume touches its box (the mesh would be open there): enlarge box')
    V, Q = surface_nets(F, lo, voxel)
    bm = bmesh.new(); vs = [bm.verts.new(tuple(p)) for p in V]
    for q in Q:
        try: bm.faces.new([vs[i] for i in q])
        except ValueError: pass
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-6)
    # Taubin smoothing (no shrink)
    for _ in range(smooth):
        for lam in (0.5, -0.53):
            new = {}
            for vt in bm.verts:
                if not vt.link_edges: continue
                avg = sum((e.other_vert(vt).co for e in vt.link_edges), Vector()) / len(vt.link_edges)
                new[vt] = vt.co + (avg - vt.co) * lam
            for vt, co in new.items(): vt.co = co
    if drop:
        dead = [f for f in bm.faces if all(drop(v.co) for v in f.verts)]
        bmesh.ops.delete(bm, geom=dead, context='FACES')
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = L.new_object(name, bm, smooth=True)
    if target_tris:
        tris = L.tri_count(ob)
        if tris > target_tris:
            mod = ob.modifiers.new('Dec', 'DECIMATE'); mod.ratio = target_tris / tris; mod.use_collapse_triangulate = True
            if keep:                                   # protect detail (e.g. near grooves): weight 1 = keep more triangles there
                vg = ob.vertex_groups.new(name='keep')
                V = np.array([tuple(v.co) for v in ob.data.vertices]); W = np.clip(keep(V), 0.0, 1.0) * keep_max
                for i, w in enumerate(W): vg.add([i], float(w), 'REPLACE')
                mod.vertex_group = 'keep'; mod.invert_vertex_group = True; mod.vertex_group_factor = keep_factor
            bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
            bpy.ops.object.modifier_apply(modifier=mod.name)
            if keep:
                ob.vertex_groups.remove(ob.vertex_groups['keep'])
                t2 = L.tri_count(ob)
                if t2 > target_tris * 1.03:            # the spared regions leave it over budget: a plain pass to the target
                    mod = ob.modifiers.new('Dec2', 'DECIMATE'); mod.ratio = target_tris / t2; mod.use_collapse_triangulate = True
                    bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
                    bpy.ops.object.modifier_apply(modifier=mod.name)
            if post_smooth: _taubin(ob, post_smooth)
    return ob

def decimate_parts(g, prefix, ratio):
    """Collapse-decimate the parts whose names start with `prefix` (e.g. the kit's dense ear spheres) to save triangles."""
    for ob in g.parts:
        if ob.name.startswith(prefix):
            mod = ob.modifiers.new('Dec', 'DECIMATE'); mod.ratio = ratio
            bpy.ops.object.select_all(action='DESELECT'); ob.select_set(True); bpy.context.view_layer.objects.active = ob
            bpy.ops.object.modifier_apply(modifier=mod.name)

def _taubin(ob, passes, lam=0.5, mu=-0.53):
    """Volume-preserving smoothing of an object's mesh (irons out the crumples a heavy decimation leaves)."""
    bm = bmesh.new(); bm.from_mesh(ob.data)
    for _ in range(passes):
        for f in (lam, mu):
            new = {}
            for vt in bm.verts:
                if not vt.link_edges or vt.is_boundary: continue
                avg = sum((e.other_vert(vt).co for e in vt.link_edges), Vector()) / len(vt.link_edges)
                new[vt] = vt.co + (avg - vt.co) * f
            for vt, co in new.items(): vt.co = co
    bm.to_mesh(ob.data); bm.free(); ob.data.update()

def loop_keys(g, centre, axis, radii, start=90.0, sweep=320.0, rope=((0.0, 0.02), (0.15, 0.04), (0.85, 0.04), (1.0, 0.02)),
              rise=0.0, up=(0, 0, 1), tilt=0.0, n=14, flat=None):
    """Roll keys (x, dy, pct, r[, flat]) for sculpt_hair['rolls'] along an elliptical LOOP: a chignon / curl / twist
    section. centre (x, dy from the head axis, pct), axis (the loop's normal, e.g. pointing out of the back of the head),
    radii (a across, b up, metres), start / sweep (degrees; 0 = +across, 90 = up), rope [(t, radius)] along the loop,
    rise (metres the loop climbs along the axis from start to end: overlapping loops), tilt (degrees about the up
    vector). Several loops with a small blend k (0.004) keep a crease between them (overlapping twisted loops)."""
    A = Vector(axis).normalized(); U0 = Vector(up)
    U = (U0 - A * U0.dot(A)).normalized(); R = U.cross(A).normalized()
    if tilt:
        from mathutils import Matrix as _M
        rot = _M.Rotation(math.radians(tilt), 3, U); A = rot @ A; R = rot @ R
    C = Vector((centre[0], g.Y0 + centre[1], g.zp(centre[2])))
    rr = L.smooth_profile(list(rope), [i / (n - 1) for i in range(n)])
    out = []
    for i in range(n):
        t = i / (n - 1); ang = math.radians(start + sweep * t)
        p = C + R * (math.cos(ang) * radii[0]) + U * (math.sin(ang) * radii[1]) + A * (rise * t)
        k = (float(p.x), float(p.y - g.Y0), float((1.0 - p.z / g.H) * 100.0), float(rr[i]))
        out.append(k + ((flat,) if flat else ()))
    return out

def valley(a, b, radius, lift=0.0, t0=0.08, t1=0.92, n=9):
    """Groove keys running in the valley between two roll key lists (same direction): midpoints of the two
    curves (resampled by parameter), pushed out by the mean roll radius (+ lift) away from the head axis
    (so the groove lies at the surface crease). Returns keys [(x, dy, pct, radius)] for Hs['grooves']."""
    A = np.array(L.catmull_rom([tuple(k) for k in a], 60)); B = np.array(L.catmull_rom([tuple(k) for k in b], 60))
    out = []
    for i in range(n):
        t = t0 + (t1 - t0) * i / (n - 1); j = int(round(t * 59))
        m = 0.5 * (A[j] + B[j]); d = np.array([m[0], m[1], 0.0]); dl = np.linalg.norm(d)
        push = 0.5 * (A[j][3] + B[j][3]) * 0.55 + lift
        if dl > 1e-6: m[0] += d[0] / dl * push; m[1] += d[1] / dl * push
        taper = math.sin(math.pi * (i / (n - 1))) ** 0.5
        out.append((float(m[0]), float(m[1]), float(m[2]), radius * (0.35 + 0.65 * taper)))
    return out

def sculpt_hair(g, Hs):
    """Hs: cap=dict(thick=[(pct, m)], hairline=fn(u)->pct, edge_k (rounding of the cut), blend), masses=[dict(c=(x, dy, pct),
    r=(rx, ry, rz), k)], rolls=[dict(keys=[(x, dy, pct, r[, flat])], k, n)], grooves=[dict(keys=[(x, dy, pct, r)], depth, k)]
    (groove keys are rough positions: they are projected onto the hair surface; depth = how deep the channel cuts),
    keep_region=fn((N,3) world) -> 0..1 optional: where the decimation keeps an even mesh (painted hair_bands need vertices),
    warp=fn((N,3) world) -> (N,3) optional: masses / rolls are evaluated at warp(P) (reshape the volume, e.g. scale x > 1 to
    narrow it); the skull cap and hairline cut are not warped, so the hair never exposes the head,
    box=(lo, hi) world, voxel, tris, smooth, mat, name. Sets g.hair_covers / g.hair_groove / g.hair_sdf."""
    zp = g.zp; Y0 = g.Y0
    Cp = Hs['cap']; TT = _np_table(Table([(zp(p), t) for p, t in Cp['thick']]))
    c0 = np.array([0.0, Y0 + 0.02, zp(14.0)])
    hl = Cp['hairline']; hl_u = np.linspace(0, 1, 721); hl_z = np.array([zp(hl(u)) for u in hl_u])
    def u_of(P):
        return (np.arctan2(-(P[:, 1] - c0[1]), P[:, 0] - c0[0]) - math.pi / 2) / (2 * math.pi) % 1.0
    rolls = [(_curve(g, R_['keys'], R_.get('n', 40)), R_.get('k', 0.01), R_.get('cut', True)) for R_ in Hs.get('rolls', [])]
    grooves = [(_curve(g, G_['keys'], G_.get('n', 30)), G_.get('k', 0.004), G_.get('depth', 0.006)) for G_ in Hs.get('grooves', [])]
    hc = np.array([0.0, Y0, zp(Hs.get('centre_pct', 12.0))])
    def cutf(P):
        """Positive below the hairline (where there must be no hair), smooth in height."""
        return np.interp(u_of(P), hl_u, hl_z) - P[:, 2]
    warp = Hs.get('warp')                              # optional fn((N,3) world) -> (N,3) design space: reshapes the masses and rolls
    g.hair_warp = warp                                  # (e.g. a narrower top) while the cap keeps following the skull
    def base(P):
        s = sd_skull(g, P) - TT(P[:, 2])
        s = smax(s, cutf(P), Cp.get('edge_k', 0.012))
        Q = warp(P) if warp else P
        for M in Hs.get('masses', []):
            m = sd_ellipsoid(Q, (M['c'][0], Y0 + M['c'][1], zp(M['c'][2])), M['r'])
            if M.get('cut', True): m = smax(m, cutf(P) - M.get('below', 0.0), Cp.get('edge_k', 0.012))
            s = smin(s, m, M.get('k', 0.02))
        for (pts, rad, fl), k, cut in rolls:
            t = sd_tube(Q, pts, rad, fl if (fl < 0.999).any() else None, hc)
            s = smin(s, t, k)
        return s
    # grooves SNAP to the base surface: each curve point is projected radially from the head centre onto base = 0,
    # then the carving tube runs `depth` below the surface (radius r): a channel of constant depth wherever it goes
    snapped = []
    for (pts, rad, fl), k, dep in grooves:
        D = pts - hc; D /= np.linalg.norm(D, axis=1)[:, None]
        lo_ = np.full(len(pts), 0.02); hi_ = np.full(len(pts), 0.45)
        for _ in range(30):
            mid = 0.5 * (lo_ + hi_); inside = base(hc + D * mid[:, None]) < 0
            lo_ = np.where(inside, mid, lo_); hi_ = np.where(inside, hi_, mid)
        surf = hc + D * lo_[:, None]
        snapped.append((surf + D * (rad - dep)[:, None], rad, k))
    def sdf(P):
        s = base(P)
        for pts, rad, k in snapped:
            s = smax(s, -sd_tube(P, pts, rad), k)
        return s
    lo, hi = Hs['box']
    drop = lambda p: g.inside_skull(p, -0.004)
    def keep(P):                                       # (N,3) -> weight 1 near the grooves: decimation spares them (crisp channels)
        w = np.zeros(len(P))
        if snapped:
            d = np.min(np.stack([sd_tube(P, pts, rad) for pts, rad, k in snapped]), axis=0)
            w = 1.0 - np.clip(d, 0.0, 0.012) / 0.012
        if Hs.get('keep_region'):                      # optional (N,3) -> 0..1: keep an even mesh there (e.g. for hair_bands)
            w = np.maximum(w, np.clip(Hs['keep_region'](P), 0.0, 1.0))
        return w
    ob = sdf_object(g, Hs.get('name', 'Hair'), sdf, lo, hi, Hs.get('voxel', 0.005), drop=drop, smooth=Hs.get('smooth', 3), target_tris=Hs.get('tris', 7000),
                    post_smooth=Hs.get('post_smooth', 2), keep=keep if (Hs.get('keep_grooves', True) or Hs.get('keep_region')) else None)
    def covered(p, margin=0.02):
        P = np.array([[p.x, p.y, p.z]]); return bool(p.z > np.interp(u_of(P), hl_u, hl_z)[0] + margin)
    g.hair_covers = covered; g.hair_sdf = sdf
    if snapped:
        def gam(p):
            P = np.array([[p.x, p.y, p.z]]); best = 0.0
            for pts, rad, k in snapped:
                d = sd_tube(P, pts, rad)[0]; best = max(best, float(np.clip(1.0 - (d + 0.002) / 0.008, 0.0, 1.0)))
            return best * 0.010
        g.hair_groove = gam
    return g.add(ob, Hs.get('mat', 'hair'), 'head')

# =============================================================================================
# FINISH
# =============================================================================================
def shade(g, mat, fn):
    """Multiply the baked vertex colour of material `mat` (e.g. 'Skin') by fn(co) -> factor (or (r, g, b) factors).
    Guests list them in g.post_bake = [(mat, fn), ...]; dress_kit.finish applies them after the bake (e.g. the soft
    shadow on the neck under the chin that marks where the face ends)."""
    me = g.mesh.data; col = me.color_attributes.get('Col')
    if col is None: return
    mi = {i for i, m in enumerate(me.materials) if m and m.name == mat}; vs = set()
    for poly in me.polygons:
        if poly.material_index in mi: vs.update(poly.vertices)
    for i in vs:
        k = fn(me.vertices[i].co); k = (k, k, k) if not isinstance(k, (tuple, list)) else k
        c = col.data[i].color; col.data[i].color = (c[0] * k[0], c[1] * k[1], c[2] * k[2], 1.0)

def lift_ao(g, scale):
    """Soften the baked shading per material: red = 1 - (1 - red) * scale[name], green/blue keep their ratio to red
    (so a baked blush survives), e.g. {'Skin': 0.3} keeps a fair face bright under the hair's occlusion. Runs after
    guest_kit.bake on the joined mesh."""
    if not scale: return
    me = g.mesh.data; col = me.color_attributes.get('Col')
    if col is None: return
    slot = {i: m.name for i, m in enumerate(me.materials) if m}; vm = {}
    for poly in me.polygons:
        for vi in poly.vertices: vm.setdefault(vi, slot.get(poly.material_index))
    for vi, name in vm.items():
        s = scale.get(name)
        if s is None: continue
        c = col.data[vi].color; r = max(1e-4, c[0]); r2 = 1 - (1 - r) * s        # lift the grey (AO) part, keep tint ratios
        col.data[vi].color = (r2, min(1.0, r2 * c[1] / r), min(1.0, r2 * c[2] / r), 1.0)

def soft_normals(g, Sn):
    """Even, glowing face shading (the sheets' vinyl-toy look): bend the shading normals of the SKIN on the front of the
    head toward the normals of a smooth ellipsoid, so the lower face / jaw stop facing down into shadow. Geometry is
    unchanged (custom split normals; the glTF exporter writes them). Sn: centre (x, dy from the head axis, pct), radii
    (rx, ry, rz) m, amount (0..1), z_top / z_bot (pct: the band it applies to, faded over `fade` m), front (m in front
    of the head axis where it starts), keep=[(x, dy, pct, r)] spheres left alone (e.g. the nose ball)."""
    me = g.mesh.data; zp = g.zp
    c = Vector((Sn['centre'][0], g.Y0 + Sn['centre'][1], zp(Sn['centre'][2]))); rx, ry, rz = Sn['radii']
    zt, zb = zp(Sn.get('z_top', 12.0)), zp(Sn.get('z_bot', 30.0)); fd = Sn.get('fade', 0.03); amt = Sn.get('amount', 0.6)
    y_start = g.Y0 - Sn.get('front', 0.05)
    keep = [(Vector((x, g.Y0 + dy, zp(p))), r) for x, dy, p, r in Sn.get('keep', [])]
    skin = {i for i, m in enumerate(me.materials) if m and m.name == Sn.get('mat', 'Skin')}
    vw = {}
    for v in me.vertices:
        p = v.co
        w = sm((zt - p.z) / fd + 0.5) * sm((p.z - zb) / fd + 0.5) * sm((y_start - p.y) / 0.04)
        for kc, kr in keep: w *= sm(((p - kc).length - kr) / (0.5 * kr))
        if w > 1e-3: vw[v.index] = w * amt
    normals = [Vector(n.vector) for n in me.corner_normals]
    for poly in me.polygons:
        if poly.material_index not in skin: continue
        for li in poly.loop_indices:
            vi = me.loops[li].vertex_index; w = vw.get(vi)
            if not w: continue
            d = me.vertices[vi].co - c
            en = Vector((d.x / (rx * rx), d.y / (ry * ry), d.z / (rz * rz))).normalized()
            normals[li] = (normals[li] * (1 - w) + en * w).normalized()
    me.normals_split_custom_set(normals)

def hair_bands(g, Hb):
    """Soft glossy colour BANDS that follow hair rolls (the sheets' sculpted sweep with its fine light lines, a chignon's
    twists), painted into the baked vertex colour instead of cut as geometry (cut grooves read as dark scratches from the
    game's high camera). Hb:
      families / curves  roll centre lines ((N,3) world points; families = [[...], ...] or curves = [...]). Each vertex
                 finds its nearest centre-line point; the direction from it to the vertex vs the outward direction from
                 `centre` (default the head at 12 %) tells crest (facing out) from flank / valley.
      band = (c0, c1)  cos-angle range over which flank turns to crest (default (0.35, 0.9))
      stripes = [dict(ref=(N,3) line, period, phase, max) | dict(axis=(centre, direction), period, turn, radius)]
                 alternative to families: even parallel bands `period` apart following the reference line (up to `max`
                 m from it), or a spiral round an axis (a chignon); each vertex uses the nearest stripe set.
      light / dark  darkening off each roll's crest / extra darkening in the valleys between rolls (0..1; colours stay <= 1,
                    so give the material a slightly lighter base)
      lines (True), line_w, line_amt  optional fine light line on each crest: its width (in 1 - cos) and strength
      reach (m): the effect fades out beyond this distance from every line;  mat ('Hair');  mask(co) -> 0..1 optional.
    Set g.hair_band_specs = [Hb, ...] in build(); dress_kit.finish() applies them after the bake."""
    me = g.mesh.data; col = me.color_attributes.get('Col')
    if col is None: return
    mi = {i for i, m in enumerate(me.materials) if m and m.name == Hb.get('mat', 'Hair')}
    vs = set()
    for poly in me.polygons:
        if poly.material_index in mi: vs.update(poly.vertices)
    vs = sorted(vs)
    if not vs: return
    P = np.array([tuple(me.vertices[i].co) for i in vs])
    if getattr(g, 'hair_warp', None): P = g.hair_warp(P)          # bands follow the rolls in their design space
    if Hb.get('stripes'):
        # parallel stripes: contours of the distance to a reference line (a sweep's front roll), `period` apart; or,
        # with axis=(centre, direction), a spiral round that axis (a chignon's twists)
        best_d = np.full(len(P), 1e9); f = np.ones(len(P))
        for St in Hb['stripes']:
            if 'axis' in St:
                c, ax = np.asarray(St['axis'][0], float), np.asarray(St['axis'][1], float); ax /= np.linalg.norm(ax)
                v = P - c; h = v @ ax; rv = v - h[:, None] * ax; r = np.linalg.norm(rv, axis=1)
                e1 = np.cross(ax, [0.0, 0.0, 1.0]); e1 /= max(1e-9, np.linalg.norm(e1)); e2 = np.cross(ax, e1)
                th = np.arctan2(rv @ e2, rv @ e1)
                ph = r / St['period'] + St.get('turn', 1.0) * th / (2 * np.pi)
                dd = np.maximum(0.0, np.linalg.norm(v, axis=1) - St.get('radius', 0.1))
            else:
                ref = np.asarray(St['ref'], float); d = _sd_tube(P, ref, np.zeros(len(ref)))
                ph = d / St['period'] + St.get('phase', 0.0); dd = np.maximum(0.0, d - St.get('max', 0.15))
            k = dd < best_d
            best_d[k] = dd[k]; f[k] = np.cos(2 * np.pi * ph[k])
        Hb = dict(Hb, reach=Hb.get('reach', 0.0))
    else:
        lines_all = [np.asarray(c, float) for fam in (Hb.get('families') or [Hb['curves']]) for c in fam]
        hc = np.array(Hb.get('centre', (0.0, g.Y0, g.zp(12.0))))
        best_d = np.full(len(P), 1e9); Q = np.zeros_like(P)           # nearest centre-line point
        for c in lines_all:
            for i in range(len(c) - 1):
                a_, b_ = c[i], c[i + 1]; ab = b_ - a_; L2 = max(1e-12, ab @ ab)
                t = np.clip(((P - a_) @ ab) / L2, 0.0, 1.0); q = a_ + t[:, None] * ab; d = np.linalg.norm(P - q, axis=1)
                k = d < best_d; best_d[k] = d[k]; Q[k] = q[k]
        out = Q - hc; out /= np.maximum(1e-9, np.linalg.norm(out, axis=1))[:, None]
        rv = P - Q; rv /= np.maximum(1e-9, np.linalg.norm(rv, axis=1))[:, None]
        cth = np.sum(rv * out, axis=1)                              # 1 on a roll's crest .. 0 on its flank
        c0, c1 = Hb.get('band', (0.35, 0.9))
        f = 2 * np.clip((cth - c0) / (c1 - c0), 0, 1) ** 1.2 - 1
    m = (1.0 - Hb.get('light', 0.15) * (1.0 - ((1 + f) / 2) ** 2)) * (1.0 - Hb.get('dark', 0.20) * ((1 - f) / 2) ** 1.3)
    if Hb.get('lines'):                                         # a fine light line on each crest
        lw = Hb.get('line_w', 0.03)
        m = np.maximum(m, m + (1.0 - m) * Hb.get('line_amt', 0.6) * np.clip(1 - (1 - f) / (2 * lw), 0, 1) ** 2)
    fade = np.clip(1.0 - (best_d - Hb.get('reach', 0.06)) / 0.03, 0.0, 1.0)
    if Hb.get('mask'): fade *= np.array([Hb['mask'](me.vertices[i].co) for i in vs])
    m = 1.0 + (m - 1.0) * fade
    for i, k in zip(vs, m):
        c = col.data[i].color; col.data[i].color = (min(1.0, c[0] * k), min(1.0, c[1] * k), min(1.0, c[2] * k), 1.0)
    print(f'REPORT hair_bands: {len(vs)} verts, multiplier p10 {np.percentile(m, 10):.2f} median {np.median(m):.2f} p90 {np.percentile(m, 90):.2f}')

def finish(g, R, out):
    """guest_kit's finish, plus eyeCentre = ONE eye centre (her left eye, +x) in glTF space (Y up, face toward
    +Z) in the armature extras: portrait.mjs reads |eyeCentre[0]| as the eye's x offset."""
    GK.join(g)
    if g.C.get('soft_normals'): soft_normals(g, g.C['soft_normals'])     # before the bake: the AO rays use these normals
    t0 = time.time(); GK.bake(g); print(f'REPORT ao_seconds={time.time() - t0:.1f}')
    lift_ao(g, g.C.get('ao_scale', {}))
    for mat, fn in getattr(g, 'post_bake', []): shade(g, mat, fn)
    for hb in getattr(g, 'hair_band_specs', []): hair_bands(g, hb)
    GK.rig(g, R); GK.animate(g, R)
    pts = getattr(g, 'eye_pts', None)
    if pts:
        e = max(pts, key=lambda p: p.x)
        g.arm['eyeCentre'] = [round(e.x, 4), round(e.z, 4), round(-e.y, 4)]
        print(f'REPORT eyeCentre={list(g.arm["eyeCentre"])}')
    GK.export(g, out)
