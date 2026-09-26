# Female extras — reusable parts for the DRESS guests (Clara, Beatrice, ...) on top of guest_kit.py + dress_kit.py
# (both untouched):
#   long_hair(g, Hs)     long / shoulder-length sculpted hair as ONE signed-distance volume: the silhouette comes from
#                        an envelope measured on the sheet panels (per-height extents, like guest_kit.hair_shell, turned
#                        into a smooth radius field about a centre in the head), minus KEEP-OUT volumes (the face below
#                        the hairline, the ears, the neck, the shoulders) so the hair frames the face and hangs round the
#                        neck as a curtain; plus rounded wave ROLLS (flattened tubes lying on the envelope) and carved
#                        GROOVES between them. Polygonised with dress_kit's surface nets (sdf_object), smoothed.
#   ball_earrings(g, E)  gold / pearl ball earrings hanging just under the ear lobe (a tiny stem into the lobe)
# Heights are PERCENT OF STANDING HEIGHT FROM THE TOP, x/y in metres; Blender Z up, the guest faces -Y, HER right is -X.
# Longitude u: 0 front, 0.25 her right (-X), 0.5 back, 0.75 her left (+X).
import math
import numpy as np
from mathutils import Vector
import guest_kit as GK
import dress_kit as DK
import male_extras as MX
import victor_lib as L

sm = GK.sm

def _box(P, c, h, k=0.0):
    """Signed distance to an axis-aligned box (centre c, half sizes h), rounded by k."""
    q = np.abs(P - np.asarray(c)) - (np.asarray(h) - k)
    return np.linalg.norm(np.maximum(q, 0.0), axis=1) + np.minimum(np.max(q, axis=1), 0.0) - k

def long_hair(g, Hs):
    """Hs:
      env      dict(wr, wl, front, back, expo) — extents (m from the head axis; wr = her right) by pct height, as in
               guest_kit.hair_shell; top (pct of the crown); centre (x, dy, pct) of the radius field; blur
      inset    m the base sits inside the envelope (the rolls then restore the silhouette)
      face     dict(z_top=fn(x)->pct (the hairline across the forehead / temples), w=[(pct, half width)], y=[(pct, y
               offset from the head axis: the keep-out's back face)], k) — no hair in front of that plane
      ears     dict(r=(rx, ry, rz), dx (beyond the skull side), dy, z pct) — clearance round each ear (optional)
      cheek    dict(y (or [(pct, y)]), thin, z=(top pct, bottom pct)) — in front of the plane y (offset from the head axis) between those
               heights the hair may only hug the skull (within `thin`): flat temple strands, no mass beside the cheeks
      neck     dict(r (radius), y (centre offset), z_top pct, k) — a vertical cylinder below the chin kept clear
      body     [dict(c=(x, dy, pct), r=(rx, ry, rz))] — ellipsoids (shoulders / upper back) the hair rests on
      bottom   pct: the hair's lowest point (a rounded cut)
      rolls    [dict(keys=[(u, pct, radius[, flat])], sink, k, n, over)] — rounded locks lying on the envelope (over: added
               after the keep-outs, e.g. the rolled edge of a wave over the forehead)
      waves    [dict(phase=fn(u, pct) -> lock count, mask=fn(u, pct) -> 0..1, amp (m), shape 'saw'|'sin', crest, p, bias)] —
               sculpted wave relief displacing the envelope (numpy arrays in, arrays out)
      grooves  [dict(keys=[(u, pct, radius)], depth, k, n)] — channels (projected onto the envelope)
      voxel, tris, smooth, post_smooth, taubin (extra smoothing passes), name, mat
    Sets g.hair_covers (skull cull), g.hair_groove (bake darkening), g.hair_sdf."""
    zp = g.zp; Y0 = g.Y0
    T = MX.env_tables(g, Hs['env']); T['_top'] = Hs.get('top', 0.0)
    cx_, cdy, cpct = Hs.get('centre', (0.0, 0.02, 15.0))
    c0 = np.array([cx_, Y0 + cdy, zp(cpct)])
    R_at = MX.radial_env(g, T, c0, blur=Hs.get('blur', 1.5))
    WV = Hs.get('waves', [])
    def wave_disp(u, pct, dark=False):
        d = np.zeros_like(u)
        for w in WV:
            m = w['mask'](u, pct)
            if not np.any(m > 1e-4): continue
            t = w['phase'](u, pct); t = t - np.floor(t)                    # 0..1 across one lock
            if w.get('shape', 'saw') == 'saw':                                # a lock plane: rises slowly, rolls over, steps down
                a = w.get('crest', 0.75); rise = np.clip(t / a, 0, 1); fall = np.clip((1 - t) / (1 - a), 0, 1)
                f = np.where(t < a, np.sin(rise * math.pi / 2) ** w.get('p', 1.5), np.sin(fall * math.pi / 2) ** 0.7)
            else:
                f = 0.5 - 0.5 * np.cos(2 * math.pi * t)
            if dark: d = np.maximum(d, w.get('dark', 1.0) * m * np.clip(1.0 - f / w.get('dark_at', 0.35), 0.0, 1.0))
            else: d += w['amp'] * m * (f - w.get('bias', 0.5))
        return d
    def base_env(P):
        u, v, r = MX.radial_uv(c0, P); d = (r - R_at(u, v)) * 0.9
        if WV: d = d - wave_disp(u, (g.H - P[:, 2]) / g.H * 100.0)
        return d
    # keep-outs ------------------------------------------------------------------------------------------------
    F = Hs['face']; FW = DK._np_table(GK.Table([(zp(p), w) for p, w in F['w']])); FY = DK._np_table(GK.Table([(zp(p), y) for p, y in F['y']]))
    xs = np.linspace(-0.3, 0.3, 241); zt_x = np.array([zp(F['z_top'](x)) for x in xs])
    def face_ko(P):
        x, y, z = P[:, 0], P[:, 1], P[:, 2]
        a = np.abs(x) - FW(z); b = y - (Y0 + FY(z)); c = z - np.interp(x, xs, zt_x)
        return DK.smax(DK.smax(a, b, F.get('k', 0.01)), c, F.get('k', 0.01))
    kos = [face_ko]
    if Hs.get('ears'):
        E = Hs['ears']
        def ear_ko(P):
            ze = zp(E['z']); xe = float(g.W(ze)) + E.get('dx', 0.02)
            return np.minimum(DK.sd_ellipsoid(P, (xe, Y0 + E.get('dy', 0.0), ze), E['r']), DK.sd_ellipsoid(P, (-xe, Y0 + E.get('dy', 0.0), ze), E['r']))
        kos.append(ear_ko)
    if Hs.get('neck'):
        N = Hs['neck']
        def neck_ko(P):
            d = np.sqrt(P[:, 0] ** 2 + (P[:, 1] - (Y0 + N.get('y', 0.0))) ** 2) - N['r']
            return DK.smax(d, P[:, 2] - zp(N['z_top']), N.get('k', 0.02))
        kos.append(neck_ko)
    if Hs.get('cheek'):
        Ck = Hs['cheek']; Rs_at = MX.radial_skull(g, c0)
        CY = DK._np_table(GK.Table([(zp(p), y) for p, y in Ck['y']])) if isinstance(Ck['y'], (list, tuple)) else (lambda z: Ck['y'])
        def cheek_ko(P):
            u, v, r = MX.radial_uv(c0, P); sk = (r - Rs_at(u, v)) * 0.9
            a = P[:, 1] - (Y0 + CY(P[:, 2])); b = Ck['thin'] - sk
            z0, z1 = zp(Ck['z'][0]), zp(Ck['z'][1])
            c = np.maximum(P[:, 2] - z0, z1 - P[:, 2])
            return DK.smax(DK.smax(a, b, 0.006), c, 0.01)
        kos.append(cheek_ko)
    for Bd in Hs.get('body', []):
        kos.append(lambda P, Bd=Bd: DK.sd_ellipsoid(P, (Bd['c'][0], Y0 + Bd['c'][1], zp(Bd['c'][2])), Bd['r']))
    def keepout(P):
        s = kos[0](P)
        for f in kos[1:]: s = np.minimum(s, f(P))
        return s
    # rolls / grooves on the envelope ----------------------------------------------------------------------------
    def curve(keys, n, lift):
        ks = [list(k) for k in keys]
        for i in range(1, len(ks)):
            while ks[i][0] - ks[i - 1][0] > 0.5: ks[i][0] -= 1.0
            while ks[i][0] - ks[i - 1][0] < -0.5: ks[i][0] += 1.0
        ks = [tuple(k) + ((1.0,) if len(k) == 3 else ()) for k in ks]
        d = L.catmull_rom(ks, n); pts, rad, fl, nrm = [], [], [], []
        for u, p, r, f in d:
            q, nn = MX.radial_point(g, R_at, c0, u % 1.0, p)
            pts.append(tuple(q - nn * lift(r))); rad.append(max(1e-3, r)); fl.append(min(1.0, max(0.2, f))); nrm.append(tuple(nn))
        return np.array(pts), np.array(rad), np.array(fl)
    rolls = [(curve(R_['keys'], R_.get('n', 40), lambda r, s=R_.get('sink', 0.5): r * s), R_.get('k', 0.008), R_.get('over', False)) for R_ in Hs.get('rolls', [])]
    inset = Hs.get('inset', 0.0)
    # grooves: the carving tube's centre sits (depth - radius) below the BASE surface (the envelope minus inset)
    # a groove's depth scales with its radius (depth at the widest key): the ends taper out shallow instead of ending in
    # a narrow deep slit
    def gdepth(G_):
        rm = max(k[2] for k in G_['keys']); d = G_.get('depth', 0.006)
        return lambda r: d * min(1.0, r / rm)
    grooves = [(curve(G_['keys'], G_.get('n', 30), lambda r, dd=gdepth(G_): inset + dd(r) - r), G_.get('k', 0.004)) for G_ in Hs.get('grooves', []) if not G_.get('over')]
    # 'over' grooves are carved last (after the 'over' rolls): e.g. the crease separating a raised wave from the hair behind it;
    # their depth is measured from the ENVELOPE (not the inset base), since they cut into rolls standing on it
    grooves_o = [(curve(G_['keys'], G_.get('n', 30), lambda r, dd=gdepth(G_): dd(r) - r), G_.get('k', 0.004)) for G_ in Hs.get('grooves', []) if G_.get('over')]
    zb = zp(Hs.get('bottom', 34.0)); zt = zp(Hs.get('top', 0.0))
    def sdf(P):
        s = base_env(P) + inset
        for (pts, rad, fl), k, over in rolls:
            if not over: s = DK.smin(s, DK.sd_tube(P, pts, rad, fl if (fl < 0.999).any() else None, c0), k)
        for (pts, rad, fl), k in grooves:
            s = DK.smax(s, -DK.sd_tube(P, pts, rad), k)
        s = DK.smax(s, -keepout(P), Hs.get('ko_k', 0.012))
        for (pts, rad, fl), k, over in rolls:                                 # 'over' rolls lie over the keep-out edge (a rolled hairline)
            if over: s = DK.smin(s, DK.sd_tube(P, pts, rad, fl if (fl < 0.999).any() else None, c0), k)
        for (pts, rad, fl), k in grooves_o:
            s = DK.smax(s, -DK.sd_tube(P, pts, rad), k)
        s = DK.smax(s, zb - P[:, 2], Hs.get('bottom_k', 0.02))
        return s
    pad = 0.04
    zs = np.linspace(zb, zt, 40)
    xl = min(-float(T['wr'](z)) for z in zs) - pad; xh = max(float(T['wl'](z)) for z in zs) + pad
    yl = Y0 - max(float(T['front'](z)) for z in zs) - pad; yh = Y0 + max(float(T['back'](z)) for z in zs) + pad
    lo = (xl, yl, zb - 0.02); hi = (xh, yh, zt + pad)
    drop = lambda p: g.inside_skull(p, -0.004)
    ob = DK.sdf_object(g, Hs.get('name', 'Hair'), sdf, lo, hi, Hs.get('voxel', 0.005), drop=drop, smooth=Hs.get('smooth', 4),
                       target_tris=Hs.get('tris', 9000), post_smooth=Hs.get('post_smooth', 2))
    if Hs.get('taubin'): MX.taubin(ob, iters=Hs['taubin'])
    hl = Hs.get('hairline')
    def covered(p, margin=0.008):
        # a skull point is hidden when it lies inside the hair volume (the hair wraps it by `margin`): exact, so the
        # culled skull edge never shows as a stepped line along the hairline
        return bool(sdf(np.array([[p.x, p.y, p.z]]))[0] < -margin)
    g.hair_covers = covered; g.hair_sdf = sdf
    if grooves or grooves_o or WV:
        def gam(p):
            P = np.array([[p.x, p.y, p.z]]); best = 0.0
            for (pts, rad, fl), k in grooves + grooves_o:
                d = DK.sd_tube(P, pts, rad)[0]; best = max(best, float(np.clip(1.0 - (d + 0.002) / 0.008, 0.0, 1.0)))
            if WV:                                                          # the wave troughs (between the locks) read darker
                u, v, r = MX.radial_uv(c0, P); best = max(best, float(wave_disp(u, (g.H - P[:, 2]) / g.H * 100.0, dark=True)[0]))
            return best * 0.010
        g.hair_groove = gam
    return g.add(ob, Hs.get('mat', 'hair'), 'head')

def ball_earrings(g, E):
    """E: r (ball radius), x (|x| of the centre), dy (from the head axis), z (pct), stem (m: a short stem up into the
    lobe), mat."""
    for s in (1, -1):
        c = Vector((s * E['x'], g.Y0 + E.get('dy', 0.0), g.zp(E['z'])))
        g.add(L.uvsphere(f'Earring{s}', E['r'], c, u=14, v=10), E.get('mat', 'gold'), 'head')
        if E.get('stem'):
            g.add(L.tube(f'EarStem{s}', [tuple(c), tuple(c + Vector((0, 0, E['r'] + E['stem'])))], [0.003, 0.003], n=6), E.get('mat', 'gold'), 'head')
