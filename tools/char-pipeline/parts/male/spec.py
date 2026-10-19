# The male body 'm' as swappable pieces: the item specs (what each piece is, how it is built, how it is baked, what it
# shades). Built by  LD_LIBRARY_PATH=... python3 tools/char-pipeline/parts/build.py m [--only key,key] [--out dir]
#
# The body is Victor's: his proportions, his rig (today's 19 bones), his Idle and Walk. Every piece below is built in
# ONE Blender scene against that body, so each one carries the same inverse bind matrices.
#
# Faces: each classic face is its own head (skull, ears, eyes, brows, nose, mouth; Henry also his own round frames),
# because the skull shape IS most of a face here (Victor's broad rounded-square jaw, Marcus's narrower cheeks under a
# big smile, Henry's round low face). Each face sits on the shared neck the way it sat on its own body (the head axis
# keeps its distance to the neck axis). Hair and moustaches are fitted to EACH face (a variant file per face:
# `hairStyle_swept~face_marcus`): the plain file is the one fitted to Victor's face (the body's default face).
#
# Clothes: every top is built on Victor's jacket body (his profiles, his arm joints: the shared rig), so Marcus's suit
# and Henry's dinner jacket become a touch slimmer (allowed: "may change build slightly") and keep their own cut:
# lapels, buttons, pockets, vent or seam, shirt V, sleeves, colours. All tops share ONE collar fitting zone: the same
# shirt collar and the same chest surface from the collar down to the tie knot (the waistcoat matches its depth there),
# so every bow tie and tie sits right on every top. The long tie has one fitted variant for the waistcoat (it tucks in).
#
# Heights are PERCENT OF STANDING HEIGHT FROM THE TOP (g.zp(pct) -> metres), x/y in metres; Blender Z up, the guest
# faces -Y, HIS right is -X (the kit's conventions).
import math
from pathlib import Path
import numpy as np
from mathutils import Vector
import guest_kit as GK
import dress_kit as DK
import male_extras as MX
import victor_lib as L
import victor as V          # tools/char-pipeline/guests/
import marcus as MS
import henry as HS

BODY = 'm'
H = 1.66
DEFAULT_FACE = 'victor'
BODY_KEYS = ('neck_r', 'neck_y', 'z_shoulder_top')      # body-level settings: always Victor's (the shared neck)
AO_SKIP = ('Brow', 'Eye', 'Mouth', 'Glasses')            # never occlude in a bake (they lie ON the skin / are optional)

def _head_cfg(S, head_y):
    c = {k: v for k, v in S.CFG.items() if k not in BODY_KEYS}
    c.update({k: V.CFG[k] for k in BODY_KEYS}); c['head_y'] = head_y; c['ao_skip'] = AO_SKIP
    return c

# the head axis keeps its distance to the neck axis when the face moves onto Victor's neck (neck_y -0.030)
def _on_victor_neck(S): return round(S.CFG['head_y'] - S.CFG['neck_y'] + V.CFG['neck_y'], 4)

FACES = {
    'victor': dict(cfg=_head_cfg(V, V.CFG['head_y']), tables=(V.W, V.DF, V.DB, V.E, V.BULGES), nlon=48, nlat=36,
                   colours=dict(Skin=V.COLOURS['skin'], Brow=V.COLOURS['brow'], Mouth=V.COLOURS['mouth'], Eye=V.COLOURS['eye']),
                   look=('tux', 'bow'), smooth=62.0,
                   # moustache fitting: the handlebar exactly as Victor's own; the pencil as the proof
                   facial=dict(handlebar={}, pencil=dict(z=24.4), dali=dict(z=24.0, w=0.040, top=20.6))),
    'marcus': dict(cfg=_head_cfg(MS, _on_victor_neck(MS)), tables=(MS.W, MS.DF, MS.DB, MS.E, MS.BULGES), nlon=48, nlat=34,
                   colours=dict(Skin=MS.COLOURS['skin'], Brow=MS.COLOURS['brow'], Mouth=MS.COLOURS['mouth'], Eye=MS.COLOURS['eye']),
                   look=('lounge', 'tie'), smooth=62.0,
                   # his nose sits higher and his smile is wide and high: a slimmer handlebar under the nose, the smile
                   # still showing beneath it
                   facial=dict(handlebar=dict(z=22.9, thick=0.054, w=0.196), pencil=dict(z=23.55, w=0.118), dali=dict(z=23.25, w=0.036, top=21.0))),
    'henry':  dict(cfg=_head_cfg(HS, _on_victor_neck(HS)), tables=(HS.W, HS.DF, HS.DB, HS.E, HS.BULGES), nlon=44, nlat=32,
                   colours=dict(Skin=HS.COLOURS['skin'], Brow=HS.COLOURS['brow'], Mouth=HS.COLOURS['mouth'], Eye=HS.COLOURS['eye'],
                                Glasses=HS.COLOURS['glasses']),
                   look=('dinner', 'bowFull'), smooth=80.0,
                   lift={'Skin': 0.45},          # his fair face stays light under the hair (as his own build: dress_kit.lift_ao)
                   bend=True,                    # his round lower face's shading normals bent forward (male_extras.bend_normals)
                   glasses=HS.GL,                # his own round frames: drawn when he wears "Round" (builtInGlasses)
                   facial=dict(handlebar=dict(z=25.15, thick=0.050, w=0.188), pencil=dict(z=25.95, w=0.116), dali=dict(z=25.6, w=0.037, top=22.3))),
}
FACE_ORDER = ['victor', 'marcus', 'henry']

def use_face(g, name):
    """Switch the kit's head state (skull tables, head axis, face settings) to one classic face."""
    F = FACES[name]
    g.C = dict(F['cfg']); g.Y0 = g.C.get('head_y', 0.0)
    g.set_head(*F['tables']); g.face_name = name

# ---- colours (the baseColorFactor of each piece's materials; painted materials: tools only; fixed: the game's) --------
SHIRT = V.COLOURS['shirt']
WHITE_SHIRT = '#eef2fb'       # the waistcoat's shirt: a cool white, so under the hotel's warm lamps it still reads white
HAIR_DARK = V.COLOURS['hair']
SHEEN_HAIR = {'Hair': V.CFG['sheen']['Hair']}
BAKE_HAIR_V = dict(sheen=dict(V.CFG['sheen'], **SHEEN_HAIR), up_dark=V.CFG['up_dark'], groove_dark=V.CFG['groove_dark'], ao_skip=AO_SKIP)
BAKE_HAIR_H = dict(sheen=dict(V.CFG['sheen'], Hair=HS.CFG['sheen']['Hair']), up_dark=HS.CFG['up_dark'], groove_dark=HS.CFG['groove_dark'], ao_skip=AO_SKIP)

# =====================================================================================================================
# HAIR (built on whichever face is current: every style is fitted to every face)
# =====================================================================================================================
def hair_swept(g):
    GK.hair_shell(g, hairline=V.hairline, edge=V.edge, thin_below=V.thin_below, **V.HAIR)

# Marcus's and Henry's shells had 92 segments round (8,188 triangles); 88 keeps the same shape under the 8,000 budget
HAIR_M = dict(MS.HAIR, nlon=88)
HAIR_H = dict(HS.HAIR, nlon=88)

def hair_side_swept(g):
    GK.hair_shell(g, hairline=MS.hairline, edge=MS.edge, thin_below=MS.thin_below, **HAIR_M)
    for name, keys in MS.LOCKS.items(): GK.hair_lock(g, name, keys)

def hair_quiff(g):
    MX.taubin(GK.hair_shell(g, hairline=HS.hairline, edge=HS.edge, thin_below=HS.thin_below, **HAIR_H), iters=3)
    MX.radial_grooves(g, HS.HAIR['grooves'], keep_prev=True)

def _box(g): return ((-0.28, g.Y0 - 0.30, g.zp(30.0)), (0.28, g.Y0 + 0.30, g.zp(-1.5)))

def side_part_hairline(u):
    """The Side part's lower edge (pct) by longitude u (0 front, 0.25 his right, 0.5 back, 0.75 his left). The proof's
    line ran level across the forehead (a hard straight cut). This one is shaped like a real hairline, smoothly: a soft
    rounded point a little to his right of centre, gently receding temple corners (deeper on the part side, his
    left), the temple points, a short sideburn, over the ear and down to a tapered nape."""
    a = abs(((u + 0.5) % 1.0) - 0.5); right = (u % 1.0) < 0.5; ss = GK.sm
    d = (u + 0.5) % 1.0 - 0.5                                   # signed: + toward his right
    z_f = 8.2 - 0.50 * math.exp(-((d - 0.018) / 0.034) ** 2)    # the soft point of the fringe
    rec = (1.30 if not right else 0.95) * math.exp(-((a - 0.105) / 0.034) ** 2)     # temple recessions, deeper by the part
    z_f += rec + 0.40 * ss((a - 0.05) / 0.07) + 0.12 * math.sin(2 * math.pi * 3 * u + 0.4)   # (a slow, gentle unevenness)
    z = z_f + (11.6 - z_f) * ss((a - 0.142) / 0.035)           # the temple point and the corner
    # the sideburn: ONE short soft tab in front of the ear (a rounded front edge, its foot rising gently toward the
    # ear), then straight on over the ear. (Pass 2 had a V that climbed back up before the ear: the notch between them
    # left two thin spikes, which read as fangs from the side.)
    z = z + (16.6 - 1.2 * ss((a - 0.208) / 0.018) - z) * ss((a - 0.190) / 0.016)
    z = z + (14.8 - z) * ss((a - 0.222) / 0.018)               # over the ear
    z_n = 24.6 + 1.6 * ss((a - 0.36) / 0.14)                    # the nape: a soft tapered U
    return z + (z_n - z) * ss((a - 0.292) / 0.055)

def side_part_spec(g):
    def kx(x, dy, pct, r): return (x, dy, pct, r)
    # three broad, shallow comb lines from the part (his left, +x) over the top toward his right temple (pass 1 had
    # five thin ones: at close range they read as wrinkles).
    # Every groove END stays well above the hairline (pass 2's ended on it and punched 4 holes, about 1 cm each, at the
    # temples and the front of the part): sculpt_hair snaps a groove point by bisecting along a ray from the head
    # centre (12 %), and a ray that crosses the hairline height just under the surface snaps to that inner crossing,
    # so the channel is cut from inside the thin edge. `manifest.py --check` now fails a hair piece with such a hole.
    combs = [dict(keys=[kx(0.070, y, z0 + 0.4, 0.0062), kx(0.020, y + 0.012, z0 - 0.1, 0.0066), kx(-0.060, y + 0.030, z0 + 0.7, 0.0066),
                        kx(-0.140, y + 0.060, z1, 0.0058)], depth=0.0034, k=0.004, n=34)
             for y, z0, z1 in ((-0.150, 2.9, 7.4), (-0.060, 2.1, 5.6), (0.035, 2.4, 4.2))]
    sides = [dict(keys=[kx(s * 0.196, -0.050, 9.2, 0.0058), kx(s * 0.205, 0.010, 10.2, 0.0060), kx(s * 0.178, 0.110, 12.5, 0.0055),
                        kx(s * 0.120, 0.185, 14.5, 0.0050)], depth=0.0028, k=0.004, n=28) for s in (1, -1)]   # combed back over each ear
    return dict(
        cap=dict(thick=[(0, 0.030), (2.5, 0.032), (5.0, 0.029), (7.0, 0.021), (8.5, 0.013), (10.0, 0.010), (14.0, 0.008), (18.0, 0.007), (24.0, 0.006), (28.0, 0.005)],
                 hairline=side_part_hairline, edge_k=0.018),
        masses=[dict(c=(-0.020, -0.034, 4.4), r=(0.160, 0.160, 0.060), k=0.045)],             # the top, swept to his right
        # the rounded front of the sweep, set back from the hairline (the proof's roll sat ON the edge: a helmet rim)
        rolls=[dict(keys=[(0.070, -0.176, 6.0, 0.013), (0.020, -0.190, 5.4, 0.020), (-0.050, -0.184, 5.6, 0.023),
                          (-0.112, -0.142, 7.2, 0.019), (-0.158, -0.074, 9.6, 0.012)], k=0.024)],
        grooves=[dict(keys=[(0.082, -0.18, 6.1, 0.005), (0.088, -0.10, 3.4, 0.005), (0.088, 0.00, 2.2, 0.005), (0.080, 0.10, 3.4, 0.005)], depth=0.008, k=0.003, n=36)]   # the part
                + combs + sides,
        box=_box(g), voxel=0.0036, tris=7400, smooth=4, post_smooth=2)

def hair_side_part(g):
    DK.sculpt_hair(g, side_part_spec(g))

def curly_hairline(u):
    a = abs(((u + 0.5) % 1.0) - 0.5); ss = GK.sm
    z = 7.6 + (12.0 - 7.6) * ss((a - 0.15) / 0.04)
    sb = max(0.0, 1.0 - abs(a - 0.212) / 0.022) ** 1.3
    z = z + (17.5 - z) * sb * ss((0.235 - a) / 0.01 + 1.0)
    z = z + (14.6 - z) * ss((a - 0.228) / 0.012)
    z_n = 23.8 + 2.0 * ss((a - 0.36) / 0.14)
    return z + (z_n - z) * ss((a - 0.292) / 0.055)

def curls(g):
    """The proof's curly crop: ~130 round curls (sphere masses) on the CURRENT face's scalp above the hairline."""
    import core as PC
    c0 = Vector((0.0, g.Y0 + 0.02, g.zp(13.0))); out = []
    for i, d in enumerate(PC.fib_points(260, z_min=-0.55)):
        dv = Vector(d); r_s = g.skull_r(c0, dv); p = c0 + dv * (r_s + 0.016)
        u = (math.atan2(-(p.y - c0.y), p.x - c0.x) - math.pi / 2) / (2 * math.pi) % 1.0
        hl = g.zp(curly_hairline(u)); top_k = GK.sm((p.z - g.zp(9.0)) / 0.05)
        if p.z < hl + 0.014: continue
        rad = 0.020 + 0.006 * top_k + 0.003 * math.sin(i * 2.7)
        front = GK.sm((0.16 - abs(((u + 0.5) % 1.0) - 0.5)) / 0.05)
        out.append(dict(c=(p.x, p.y - g.Y0, (1 - p.z / g.H) * 100), r=(rad, rad, rad * 0.92), k=0.007, below=0.006 + 0.012 * front))
    return out

def hair_curly(g):
    DK.sculpt_hair(g, dict(cap=dict(thick=[(0, 0.022), (4, 0.022), (9, 0.018), (14, 0.012), (20, 0.008), (28, 0.006)], hairline=curly_hairline, edge_k=0.008),
                           masses=curls(g), box=_box(g), voxel=0.0035, tris=7900, smooth=3, post_smooth=2, keep_grooves=False))

# =====================================================================================================================
# FACIAL HAIR (fitted to the current face: moustache height and size per face)
# =====================================================================================================================
PENCIL = dict(n=10, w=0.122, thick=0.017, z=24.4,
              top=[(0.0, 0.20), (0.08, 0.70), (0.30, 1.00), (0.75, 0.80), (1.0, 0.20)],
              bot=[(0.0, -0.20), (0.08, -0.70), (0.30, -1.00), (0.75, -0.60), (1.0, -0.05)])
def _moustache(g, base, fit):
    keep = g.C.get('moustache'); g.C['moustache'] = dict(base, **fit)
    GK.moustache(g, mat='stache'); g.C['moustache'] = keep
def facial_handlebar(g): _moustache(g, V.CFG['moustache'], FACES[g.face_name]['facial']['handlebar'])
def facial_pencil(g): _moustache(g, PENCIL, FACES[g.face_name]['facial']['pencil'])

# =====================================================================================================================
# FACES
# =====================================================================================================================
def build_face(g):
    F = FACES[g.face_name]
    GK.head(g, nlon=F['nlon'], nlat=F['nlat'], cull_in=None)      # the WHOLE skull: any hair (or none) can sit on it
    GK.ears(g)
    g.eye_pts = []; GK.eyes(g); g.face_eye_centre = sum(g.eye_pts, Vector()) / len(g.eye_pts)
    GK.brows(g); GK.nose(g); GK.mouth(g)
    if F.get('glasses'): MX.glasses(g, F['glasses'])

def blur_hair(g, mesh):
    """Henry's own hair pass (guests/henry.py): soften the baked crease lines (no per-vertex sawtooth)."""
    keep = getattr(g, 'mesh', None); g.mesh = mesh; MX.blur_colours(g, 'Hair', iters=2); g.mesh = keep

def bend_henry(g, mesh):
    """Henry's own normal bend (guests/henry.py _bake_soft), on his face piece after its bake."""
    use_face(g, 'henry'); sm = GK.sm
    zt, zb, yf = g.zp(21.0), g.zc, g.Y0 - 0.01
    def w(co):
        fy = g.face_y(co.x, co.z); off = 0.0 if fy is None else fy - co.y
        return sm((zt - co.z) / 0.05) * sm((co.z - zb + 0.02) / 0.03) * sm((yf - co.y) / 0.13) * (1.0 - sm((off - 0.004) / 0.008))
    keep = getattr(g, 'mesh', None); g.mesh = mesh
    MX.bend_normals(g, 'Skin', w, (0.0, -0.85, 0.52), 0.75); g.mesh = keep

# =====================================================================================================================
# BODY (neck + hands: what every face and top shares)
# =====================================================================================================================
def build_body(g):
    GK.neck(g); GK.hands(g, V.A)

# =====================================================================================================================
# TOPS (all on Victor's jacket body and arm joints; one shared collar zone)
# =====================================================================================================================
SX = 0.885      # Marcus's and Henry's cut, measured on their wider (0.452 m) jackets, onto Victor's (0.40 m): x scale
def _sx(pts): return [(round(x * SX, 4), p) for x, p in pts]

def top_tux(g):
    GK.jacket(g, V.J); GK.lapels(g, V.J); GK.pockets(g, V.J); GK.buttons(g, V.J); GK.back_seam(g, V.J)
    GK.shirt_front(g, V.SH); GK.collar(g, V.SH); GK.studs(g, V.SH)
    GK.arms(g, V.A); GK.cuffs(g, V.A)

LA_M = MS.J['lapel']
J_LOUNGE = dict(V.J, open_apex=MS.J['open_apex'], open_hem=MS.J['open_hem'], corner=MS.J['corner'], mat='jacket',
                lapel=dict(outline=_sx(LA_M['outline']), wrap=dict(LA_M['wrap'], tip=(round(LA_M['wrap']['tip'][0] * SX, 4), LA_M['wrap']['tip'][1])),
                           thick=LA_M['thick'], lift=LA_M['lift'], max_edge=0.065, edge_shade=LA_M['edge_shade'], shade_w=LA_M['shade_w'], mat='jacket'),
                flaps=[(0.094, 0.184, 56.8, 59.7)], welt=(0.111, 0.170, 46.6, 0.010, 0.008), flap_thick=MS.J['flap_thick'],
                buttons=MS.J['buttons'], button_r=MS.J['button_r'], vent=MS.J['vent'])
SH_LOUNGE = dict(V.SH, v=_sx(MS.SH['v']), max_edge=0.06)
SH_LOUNGE.pop('studs', None)
A_LOUNGE = dict(V.A, stations=MS.A['stations'], cuff_wd=MS.A['cuff_wd'], sleeve_buttons=MS.A['sleeve_buttons'])
def top_lounge(g):
    J = J_LOUNGE
    GK.jacket(g, J); GK.lapels(g, J); GK.pockets(g, J); GK.buttons(g, J); GK.back_seam(g, J)
    GK.shirt_front(g, SH_LOUNGE); GK.collar(g, SH_LOUNGE)
    GK.arms(g, A_LOUNGE); GK.cuffs(g, A_LOUNGE)

LA_H = HS.J['lapel']
J_DINNER = dict(V.J, nj=44, open_apex=HS.J['open_apex'], open_hem=HS.J['open_hem'], corner=HS.J['corner'], mat='jacket',
                lapel=dict(outline=_sx(LA_H['outline']), wrap=dict(LA_H['wrap'], nth=24, tip=(round(LA_H['wrap']['tip'][0] * SX, 4), LA_H['wrap']['tip'][1])),
                           thick=LA_H['thick'], lift=LA_H['lift'], max_edge=LA_H['max_edge'], edge_shade=LA_H['edge_shade'], shade_w=LA_H['shade_w'], mat='jacket'),
                flaps=[(0.115, 0.190, 56.4, 58.8)], welt=(0.119, 0.173, 44.6, 0.008, 0.006), flap_thick=HS.J['flap_thick'],
                buttons=HS.J['buttons'], button_r=HS.J['button_r'])
J_DINNER.pop('vent', None)
SH_DINNER = dict(V.SH, v=_sx(HS.SH['v']), max_edge=HS.SH['max_edge'])
SH_DINNER.pop('studs', None)
A_DINNER = dict(V.A, stations=HS.A['stations'], cuff_wd=HS.A['cuff_wd'], sleeve_buttons=HS.A['sleeve_buttons'])
STUDS_DINNER = HS.STUDS
SQUARE_DINNER = dict(HS.SQUARE, x0=round(HS.SQUARE['x0'] * SX, 4), x1=round(HS.SQUARE['x1'] * SX, 4))
COLLAR_FALL_DINNER = _sx(HS.COLLAR_FALL)
def top_dinner(g):
    J = J_DINNER
    GK.jacket(g, J); GK.lapels(g, J); GK.pockets(g, J)
    GK.slab(g, 'Seam', [(-0.0015, g.z_hem + 0.004), (0.0015, g.z_hem + 0.004), (0.0015, g.jacket_top - 0.035), (-0.0015, g.jacket_top - 0.035)],
            g.back_y, 0.0, 0.0010, 'shade', g.jw, sign=1, cuts=0)        # the back: one centre seam to the hem, no vent
    fall = [(x, g.zp(p)) for x, p in COLLAR_FALL_DINNER]                    # the shawl collar's fall across the upper back
    bsurf = lambda x, z: g.back_y(x, min(z, g.jacket_top - 0.004))
    GK.slab(g, 'CollarFall', fall, bsurf, 0.002, 0.007, 'jacket', lambda co: {'spine': 1.0}, sign=1, max_edge=0.03)
    lo = [q for q in fall if q[1] < g.zp(34.9)]; lo.sort()
    fall_edge = [(x, z - 0.0035) for x, z in lo] + [(x, z + 0.0015) for x, z in reversed(lo)]
    GK.slab(g, 'CollarFallShade', fall_edge, bsurf, 0.0, 0.0012, 'shade', lambda co: {'spine': 1.0}, sign=1, cuts=0)
    for i, (x, p) in enumerate(J['buttons']):            # the front button is self-coloured (ivory horn)
        z = g.zp(p); b = L.uvsphere(f'Button{i}', J['button_r'], (x, g.chest_y(x, z) - 0.004, z), scale=(1, 0.5, 1), u=12, v=8); g.add_w(b, 'horn', g.jw)
    GK.shirt_front(g, SH_DINNER); GK.collar(g, SH_DINNER); MX.studs(g, STUDS_DINNER); MX.pocket_square(g, SQUARE_DINNER)
    GK.arms(g, A_DINNER); GK.cuffs(g, A_DINNER)

# the waistcoat with shirtsleeves (the proof's, fixed): its depth matches the tuxedo's in the collar zone (33-47 %), so
# every bow tie fits it; the shirt is a cooler white and the sleeves have real folds (the review: they read as bare arms)
J_VEST = dict(
    profiles=[(62.6, 0.392, 0.276, 0.72, -0.046), (60.0, 0.386, 0.272, 0.72, -0.052), (56.0, 0.380, 0.266, 0.72, -0.060),
              (52.0, 0.382, 0.270, 0.72, -0.062), (47.0, 0.386, 0.278, 0.74, -0.050), (43.0, 0.388, 0.268, 0.76, -0.040),
              (40.0, 0.380, 0.250, 0.78, -0.032), (38.0, 0.356, 0.236, 0.80, -0.032), (36.5, 0.318, 0.220, 0.84, -0.032),
              (35.3, 0.282, 0.204, 0.88, -0.030), (34.0, 0.232, 0.188, 0.96, -0.030), (33.0, 0.190, 0.176, 1.0, -0.030)],
    waist=55.0, hem_hips=0.5, nj=46, ring_dz=0.020, open_apex=60.6, open_hem=0.052, corner=0.010, mat='jacket',
    buttons=[(0.0, 48.6), (0.0, 51.4), (0.0, 54.2), (0.0, 57.0), (0.0, 59.8)], button_r=0.0095, flap_thick=0.004)
SH_VEST = dict(V.SH, v=[(-0.084, 33.4), (0.084, 33.4), (0.090, 37.2), (0.064, 41.6), (0.006, 46.6), (-0.006, 46.6), (-0.064, 41.6), (-0.090, 37.2)],
               studs=[(0.0, 41.6), (0.0, 44.6)])
A_SHIRT = dict(V.A, sleeve='shirt', cap_in=0.030, sleeve_buttons=0,
               stations=[('end', 0.124, 0.120), (59.0, 0.134, 0.130), (54.0, 0.140, 0.138), (48.0, 0.146, 0.146), (42.0, 0.148, 0.150),
                         (('j', -0.01), 0.150, 0.150), (('j', 0.016), 0.138, 0.140), (('j', 0.036), 0.090, 0.096), (('j', 0.046), 0.040, 0.050)])

def _gauss(d, s): return math.exp(-(d * d) / (2 * s * s))

def _fold(z, th, ZJ, ZE, z_end):
    """The shirt sleeve's fold field at height z and angle th round the arm (0 = front, +pi/2 = the outer side):
    -> (displacement along the outward direction, crease depth >= 0). Three soft creases in the crook of the elbow and
    two on its point, two diagonal folds down the forearm, the cotton blousing over the cuff and gathered into it, long
    soft creases down the upper arm."""
    sm = GK.sm
    if z >= ZJ - 0.004 or z <= z_end + 0.002: return 0.0, 0.0
    front = max(0.0, math.cos(th)); back = max(0.0, -math.cos(th)); c = 0.0
    for dz, a in ((0.012, 0.0042), (-0.006, 0.0048), (-0.024, 0.0040)):
        c += a * front ** 1.5 * _gauss(z - (ZE + dz + 0.010 * math.sin(th)), 0.0060)
    for dz, a in ((0.016, 0.0028), (-0.004, 0.0030)):
        c += a * back ** 2 * _gauss(z - (ZE + dz), 0.0065)
    for z0, slope, a in ((ZE - 0.050, 0.030, 0.0030), (ZE - 0.095, -0.024, 0.0026)):
        c += a * _gauss(z - (z0 + slope * th / math.pi), 0.0080) * (0.6 + 0.4 * front)
    c += 0.0030 * _gauss(z - (z_end + 0.006), 0.0040)
    for t0 in (0.95, -0.85, 2.3):
        dth = (th - t0 + math.pi) % (2 * math.pi) - math.pi
        c += 0.0020 * _gauss(dth, 0.16) * sm((z - ZE - 0.03) / 0.03) * sm((ZJ - 0.02 - z) / 0.03)
    return 0.0040 * _gauss(z - (z_end + 0.024), 0.010) - c, c

def _ring_zs(st, ZJ, ZE, z_end):
    """Ring heights: dense (6-7 mm) through the elbow and over the cuff, where the folds are; 2-2.5 cm elsewhere."""
    lo, hi = st[0][0], st[-1][0]; zs = [lo]
    while zs[-1] < hi - 1e-6:
        z = zs[-1]
        if z < z_end + 0.040: step = 0.0065
        elif abs(z - ZE) < 0.045: step = 0.0070
        elif z < ZE: step = 0.016
        elif z < ZJ - 0.01: step = 0.024
        else: step = 0.008
        zs.append(min(hi, z + step))
    return zs

def shirt_sleeves(g, A):
    """Shirt sleeves with folds (replaces guest_kit.arms for the waistcoat): the same arm path and stations, lofted
    with rings where the folds are, then displaced along each ring's outward direction by the fold field (_fold).
    waistcoat_creases() later paints the same creases into the bake."""
    zp = g.zp; g.sleeve_folds = []
    for s, tag in ((1, 'L'), (-1, 'R')):
        SX_, ZJ, (ex, ey, ZE), (hx, hy, ZW), xy = GK.arm_path(g, A, s)
        z_end = zp(A['sleeve_end'])
        st = []
        for pz, w, d in A['stations']:
            if pz == 'end': z = z_end
            elif isinstance(pz, tuple): z = ZJ + pz[1]
            else: z = zp(pz)
            st.append((z, w, d))
        st.sort()
        zz = [q[0] for q in st]; ww = [q[1] for q in st]; dd = [q[2] for q in st]
        prof = []
        for z in _ring_zs(st, ZJ, ZE, z_end):
            x, y = xy(min(z, ZJ))
            if z > ZJ: x -= s * A.get('cap_in', 0.012) * (z - ZJ) / 0.05
            prof.append(dict(z=z, w=float(np.interp(z, zz, ww)), d=float(np.interp(z, zz, dd)), r=1.0, x=x, y=y))
        sl = L.loft(f'Sleeve{tag}', prof, n=18)
        for v in sl.data.vertices:
            x0, y0 = xy(min(v.co.z, ZJ)); rx, ry = v.co.x - x0, v.co.y - y0; rl = math.hypot(rx, ry)
            if rl < 1e-6: continue
            k, _ = _fold(v.co.z, math.atan2(s * rx, -ry), ZJ, ZE, z_end)
            v.co.x += rx / rl * k; v.co.y += ry / rl * k
        sl.data.update()
        g.add_split(sl, 'shirt', f'upperarm.{tag}', f'forearm.{tag}', ZE, 0.035)
        g.sleeve_folds.append((s, xy, ZJ, ZE, z_end))

def waistcoat_creases(g, mesh):
    """Post-bake: darken the shirt sleeves' creases (the same fold field as the geometry), so they read at game size
    and in the warm lobby light, where a plain white sleeve looked like a bare arm."""
    col = mesh.data.color_attributes['Col']; mats = C_vertex_materials(mesh)
    for i, v in enumerate(mesh.data.vertices):
        if mats[i] != 'Shirt': continue
        for s, xy, ZJ, ZE, z_end in g.sleeve_folds:
            if not (z_end < v.co.z < ZJ) or v.co.x * s < 0.12: continue
            x0, y0 = xy(v.co.z); rx, ry = v.co.x - x0, v.co.y - y0
            if math.hypot(rx, ry) > 0.11: continue
            _, c = _fold(v.co.z, math.atan2(s * rx, -ry), ZJ, ZE, z_end)
            f = 1.0 - 0.50 * min(1.0, c / 0.0040)
            r, gg, b, a = col.data[i].color; col.data[i].color = (r * f, gg * f, b * f, a)

def C_vertex_materials(mesh):
    import core
    return core.vertex_materials(mesh)

def top_waistcoat(g):
    GK.jacket(g, J_VEST)
    GK.shirt_front(g, SH_VEST); GK.collar(g, SH_VEST)
    r = SH_VEST.get('stud_r', 0.008); lift = SH_VEST['lift'] + 0.002          # guest_kit.studs, 8 x 5 segments
    for i, (x, p) in enumerate(SH_VEST['studs']):
        z = g.zp(p); y = g.chest_y(x, min(z, g.jacket_top)) - lift - r * 0.35
        g.add_w(L.uvsphere(f'Stud{i}', r, (x, y, z), scale=(1, 0.6, 1), u=8, v=5), 'button', g.jw)
    # the waistcoat's front edges over the shirt (a raised band along each side of the V), two welts
    for s in (1, -1):
        edge = [(s * 0.090, 37.0), (s * 0.064, 41.6), (s * 0.006, 46.8)]
        pts = [Vector((x, 0, g.zp(p))) for x, p in edge]; pts = L.resample_polyline(pts, 14)
        inner, outer = [], []
        for k, p in enumerate(pts):
            a = pts[max(0, k - 1)]; b = pts[min(len(pts) - 1, k + 1)]; t = (b - a).normalized()
            n = Vector((t.z, 0, -t.x)) * s
            if n.x * s < 0: n = -n
            inner.append((p.x - n.x * 0.004, p.z - n.z * 0.004)); outer.append((p.x + n.x * 0.014, p.z + n.z * 0.014))
        GK.slab(g, f'VestEdge{s}', inner + list(reversed(outer)), lambda x, z: g.chest_y(x, min(z, g.jacket_top)), 0.009, 0.005, 'jacket', g.jw, cuts=0)
        GK.slab(g, f'VestWelt{s}', [(s * 0.070, g.zp(55.6)), (s * 0.140, g.zp(55.0)), (s * 0.140, g.zp(54.4)), (s * 0.070, g.zp(55.0))][::s],
                g.chest_y, 0.0, 0.004, 'jacket', g.jw, cuts=1)
    for i, (x, p) in enumerate(J_VEST['buttons']):          # guest_kit.buttons, a little lighter (8 x 5 segments)
        z = g.zp(p); b = L.uvsphere(f'Button{i}', J_VEST['button_r'], (x, g.chest_y(x, z) - J_VEST['flap_thick'] * 0.3, z), scale=(1, 0.55, 1), u=8, v=5)
        g.add_w(b, 'button', g.jw)
    ch = []                       # gold watch chain: from the fourth button to his left welt pocket, in a soft curve
    for i in range(17):
        t = i / 16; x = 0.012 + 0.096 * t; pz = 56.6 + (55.2 - 56.6) * t + 1.8 * math.sin(math.pi * t)
        z = g.zp(pz); ch.append((x, g.chest_y(x, z) - 0.006, z))
    g.add_w(L.tube('Chain', ch, [0.0026] * len(ch), n=6), 'gold', g.jw)
    shirt_sleeves(g, A_SHIRT); GK.cuffs(g, A_SHIRT)
    for s, tag in ((1, 'L'), (-1, 'R')):          # sleeve garters (accent colour): a band round each upper arm
        *_, xy = GK.arm_path(g, A_SHIRT, s); zc_ = g.zp(46.0)
        prof = []
        for dz, f in ((-0.012, 0.98), (-0.008, 1.06), (0.008, 1.06), (0.012, 0.98)):
            x, y = xy(zc_ + dz); prof.append(dict(z=zc_ + dz, w=0.150 * f, d=0.152 * f, r=1.0, x=x, y=y))
        g.add(L.loft(f'Garter{tag}', prof, n=16), 'tie', f'upperarm.{tag}')

# =====================================================================================================================
# NECKWEAR (fitted to the shared collar zone of the jacket built just before it: the tuxedo's)
# =====================================================================================================================
def neck_bow(g): MX.bow_tie(g, V.BOW)
TIE = dict(MS.TIE, knot=(33.9, 37.3), blade=[(-0.017, 37.1), (0.017, 37.1), (0.040, 49.4), (0.0, 52.6), (-0.040, 49.4)])
TIE_OUT = 0.009     # the tie lies 9 mm further forward than Marcus's own: in front of the tuxedo's, Henry's and the
                    # waistcoat's shirt studs (they poked through it), its underside still on a plain shirt front
def _forward(g, dy, fn):
    keep = g.chest_y; base = keep
    g.chest_y = lambda x, z: base(x, z) - dy
    try: fn()
    finally: g.chest_y = keep
def neck_tie(g): _forward(g, TIE_OUT, lambda: GK.tie(g, TIE))
BOW_FULL = dict(HS.BOW, z=36.4)
def neck_bow_full(g): MX.bow_tie(g, BOW_FULL)
def neck_tie_vest(g):
    """The long tie on the waistcoat: the same knot, the blade over both shirt studs, tucked under the waistcoat at
    its V point (it dives behind the waistcoat front between 45.6 and 47 %)."""
    keep = g.chest_y; zd0, zd1 = g.zp(45.6), g.zp(47.0)
    out = TIE_OUT + 0.004                 # the waistcoat's second stud stands 4 mm proud of the tuxedo's shirt line
    g.chest_y = lambda x, z: keep(x, z) - out + (0.030 + out) * GK.sm((zd0 - z) / (zd0 - zd1))
    try: GK.tie(g, dict(TIE, blade=[(-0.017, 37.1), (0.017, 37.1), (0.034, 46.0), (0.0, 48.6), (-0.034, 46.0)]))
    finally: g.chest_y = keep

# =====================================================================================================================
# LEGS AND FEET
# =====================================================================================================================
def heel_follow(g, ob, P, amount=0.6, span=0.09):
    """The back of each trouser hem follows the heel a little (foot weight up to `amount`, fading out `span` above the
    hem, back half only). At toe-off the heel lifts and today's guests show the shoe's heel counter coming through the
    back of the hem by a few millimetres (poke.py found it); resting on the heel, the hem now lifts with it."""
    z_hem = g.zp(P['hem']); ly = P.get('leg_y', 0.0)
    for side in ('L', 'R'):
        if f'foot.{side}' not in ob.vertex_groups: ob.vertex_groups.new(name=f'foot.{side}')
    for v in ob.data.vertices:
        z = v.co.z
        if z > z_hem + span: continue
        w = amount * GK.sm((z_hem + span - z) / span) * GK.sm((v.co.y - ly) / 0.03)
        if w <= 1e-4: continue
        for gr in v.groups: gr.weight *= (1.0 - w)
        ob.vertex_groups[f"foot.{'L' if v.co.x > 0 else 'R'}"].add([v.index], w, 'ADD')

def legs_trousers(g): heel_follow(g, GK.trousers(g, V.P), V.P)
def feet_derby(g): GK.shoes(g, V.S)

# =====================================================================================================================
# WARDROBE W1-B: Henry's lowered bow ties, the Dalí moustache, the Poet, the smoking jacket and the men's extras
# (black orchid buttonhole, lantern fob, evening gloves). Everything below only ADDS pieces: the W1-A pieces above are
# built exactly as before (same geometry, same hash), so no shadow patch baked against them goes stale.
# =====================================================================================================================
import bpy, bmesh
from mathutils.bvhtree import BVHTree

_outer = {}
def outer_hit(key, x, z, back=False):
    """The OUTERMOST surface of a piece built earlier in this scene (its joined object, named after its key) at (x, z):
    a ray from the front (or the back) -> (y, normal) or (None, None). Lapels, flaps, the shirt V, buttons included."""
    ob = bpy.data.objects.get(key)
    if ob is None: raise RuntimeError(f'{key} is not built yet (list it in the item ctx)')
    ent = _outer.get(key)
    if ent is None or ent[0] != ob.as_pointer() or ent[2] != len(ob.data.vertices):
        bm = bmesh.new(); bm.from_mesh(ob.data); bmesh.ops.triangulate(bm, faces=bm.faces[:]); t = BVHTree.FromBMesh(bm); bm.free()
        ent = _outer[key] = (ob.as_pointer(), t, len(ob.data.vertices))
    hit = ent[1].ray_cast(Vector((x, 1.0 if back else -1.0, z)), Vector((0, -1.0 if back else 1.0, 0)), 2.0)
    if hit[0] is None: return None, None
    n = Vector(hit[1]).normalized()
    if (n.y > 0) != back: n = -n
    return hit[0].y, n

# ---- Henry's bow ties (W1-A review ART-5): his head sits ~5 cm further forward on the shared neck, so from the game's
# high camera his chin hid the top half of the bow. On HIS face the bows sit 1.2 cm lower and 6 mm further forward
# (a `~face_henry` variant: every other face keeps today's bow exactly). Measured through the game's own renderer.
# (Fixer, 19 Oct, art review ART-4: lowered, the wing tips crossed the lapel and shirt-front edges and looked ragged
# there; on his face the wings are now 7 % shorter and their tips sweep back 4 mm less, so they end clear in front.)
HENRY_BOW_DROP, HENRY_BOW_OUT = 0.72, 0.006          # pct of height (1.2 cm), metres
HENRY_BOW_SPAN, HENRY_BOW_SWEEP = 0.90, 0.008        # the wings' half span x this; their back-sweep less this (m)
def _henry_bow(B): return dict(B, z=B['z'] + HENRY_BOW_DROP, y=B.get('y', 0.012) + HENRY_BOW_OUT, clear=B.get('clear', 0.010) + HENRY_BOW_OUT,
                               w=B['w'] * HENRY_BOW_SPAN, curve=max(0.0, B.get('curve', 0.02) - HENRY_BOW_SWEEP))
def neck_bow_henry(g): MX.bow_tie(g, _henry_bow(V.BOW))
def neck_bow_full_henry(g): MX.bow_tie(g, _henry_bow(BOW_FULL))

# ---- the Dalí moustache: thin and waxed, a short bar on the upper lip, then two points sweeping up past the nose.
# Fitted per face (FACES[...]['facial']['dali']): the bar's height (pct), its half-width, the points' x and the height
# they rise to (pct): always below the eyes' lower edge (the possessed red must show), and close to the cheek (they
# pass behind the rim of any glasses rather than through it).
def facial_dali(g):
    F = FACES[g.face_name]['facial']['dali']
    z0, hw, top = F['z'], F['w'], F['top']
    rise = z0 - top
    # (x, height pct, lift off the skin, radius) for his left side: the full waxed bar over the lip, a tight turn just
    # outside the nose wing, then the point rising almost straight up beside the nose, flicking out at its tip
    keys = [(0.000, z0 + 0.05, 0.0050, 0.0090), (0.50 * hw, z0 + 0.12, 0.0050, 0.0084), (0.85 * hw, z0 + 0.20, 0.0050, 0.0070),
            (hw + 0.006, z0 + 0.10, 0.0054, 0.0058), (hw + 0.012, z0 - 0.20 * rise, 0.0058, 0.0050), (hw + 0.015, z0 - 0.45 * rise, 0.0062, 0.0042),
            (hw + 0.017, z0 - 0.70 * rise, 0.0068, 0.0033), (hw + 0.020, z0 - 0.88 * rise, 0.0074, 0.0023), (hw + 0.025, top, 0.0080, 0.0011)]
    d = L.catmull_rom([(x, p, l, r) for x, p, l, r in keys], 31)        # (976 triangles: the handlebar's count)
    side = [(x, p, l, r) for x, p, l, r in d]
    path = [(-x, p, l, r) for x, p, l, r in reversed(side[1:])] + side
    pts = [tuple(g.on_face(x, g.zp(p), l)) for x, p, l, r in path]
    mo = L.tube('Dali', pts, [r for *_, r in path], n=8)
    for v in mo.data.vertices:                     # the bar lies flatter on the lip (its depth 60 %), the points stay round
        y0 = g.face_y(v.co.x, v.co.z)
        if y0 is None: continue
        k = 0.60 + 0.40 * GK.sm((abs(v.co.x) - hw) / 0.008)
        v.co.y = y0 + (v.co.y - y0) * k
    mo.data.update()
    g.add(mo, 'stache', 'head')

# ---- evening gloves (extra, attach 'hands'): white dress gloves over the body's hands. The body's own hand builder
# (guest_kit.hands) with every radius and the palm 2.5 mm larger (they enclose the hand in every pose: both are rigid on
# the hand bone), a little coarser (the triangle cap of an extra is 1,500), and three stitched "points" on the back.
GLOVE_OUT, GLOVE_PALM_OUT = 0.0022, 0.0028
def glove_hands(g, A, out=GLOVE_OUT, palm_out=GLOVE_PALM_OUT, curl=4, finger_n=7, thumb_n=8, palm_n=12):
    Hd = A['hand']; zp = g.zp; g.glove_points = []
    for s, tag in ((1, 'L'), (-1, 'R')):
        *_, (hx, hy, ZW), xy = GK.arm_path(g, A, s)
        z0 = zp(A['cuff_end']) + 0.012
        outv = Vector((s, 0, 0)); fwd = Vector((0, -1, 0)); down = Vector((0, 0, -1))
        base = Vector((hx + s * Hd.get('out', 0.004), hy, 0))
        pl, pw, pt = Hd['palm_len'], Hd['palm_w'], Hd['palm_t']; o2 = 2 * palm_out
        palm = L.loft(f'GPalm{tag}', [dict(z=z0 - pl - palm_out, w=pt * 0.80 + o2, d=pw * 0.90 + o2, r=0.9), dict(z=z0 - pl * 0.80, w=pt + o2, d=pw + o2, r=0.88),
                                      dict(z=z0 - pl * 0.40, w=pt * 1.02 + o2, d=pw * 1.02 + o2, r=0.9), dict(z=z0 - pl * 0.08, w=pt * 0.86 + o2, d=pw * 0.86 + o2, r=0.95),
                                      dict(z=z0 + 0.010, w=pt * 0.74 + o2, d=pw * 0.74 + o2, r=1.0)], n=palm_n, cap_top=False)
        L.translate_verts(palm, base); g.add(palm, 'glove', f'hand.{tag}')
        for i, (yo, r, ln, bend) in enumerate(Hd['fingers']):
            p0 = Vector((base.x + s * Hd.get('finger_out', 0.004), hy + yo, z0 - pl * 0.78))
            pts = GK._curl(p0, down, -outv, ln, bend, curl)
            tip = pts[-1] + (pts[-1] - pts[-2]).normalized() * (r * 0.45 + out * 0.6)
            rad = [r * (1.0 - 0.12 * k / curl) + out for k in range(curl + 1)]
            pts.append(tip); rad.append(r * 0.55 + out)
            pts.append(tip + (pts[-1] - pts[-2]).normalized() * (r * 0.35 + out * 0.4)); rad.append(r * 0.18 + out * 0.5)
            g.add(L.tube(f'GFinger{tag}{i}', [tuple(p) for p in pts], rad, n=finger_n), 'glove', f'hand.{tag}')
        T = Hd['thumb']
        p0 = Vector((base.x - s * T[1], hy + T[0], z0 - T[2]))
        dirn = (down * 0.85 + fwd * 0.30 - outv * 0.20).normalized(); inw = (-outv * 0.8 + fwd * -0.2).normalized()
        pts = GK._curl(p0, dirn, inw, T[4], T[5], curl)
        tip = pts[-1] + (pts[-1] - pts[-2]).normalized() * (T[3] * 0.45 + out * 0.6)
        rad = [T[3] * (1.08 - 0.15 * k / curl) + out * 1.25 for k in range(curl + 1)] + [T[3] * 0.55 + out, T[3] * 0.18 + out * 0.5]
        pts += [tip, tip + (tip - pts[-1]).normalized() * (T[3] * 0.35 + out * 0.4)]
        g.add(L.tube(f'GThumb{tag}', [tuple(p) for p in pts], rad, n=thumb_n), 'glove', f'hand.{tag}')
        # the glove's wrist: a soft welt just below the shirt cuff (so it reads as a glove, not a pale hand), and a pearl
        # button on the inside of the wrist
        zc = zp(A['cuff_end'])
        welt = L.loft(f'GWelt{tag}', [dict(z=zc - 0.012, w=pt * 0.90 + o2, d=pw * 0.88 + o2, r=0.95), dict(z=zc - 0.005, w=pt * 0.98 + o2 + 0.004, d=pw * 0.96 + o2 + 0.004, r=0.95),
                                      dict(z=zc + 0.010, w=pt * 0.92 + o2, d=pw * 0.90 + o2, r=0.95)], n=palm_n, cap_top=False, cap_bottom=False)
        L.translate_verts(welt, base); g.add(welt, 'glove', f'hand.{tag}')
        g.add(L.uvsphere(f'GPearl{tag}', 0.0032, (base.x - s * (pt * 0.47 + o2 / 2 + 0.001), hy - 0.010, zc - 0.008), u=6, v=4), 'pearl', f'hand.{tag}')
        # the three stitched points on the back of the hand (the outer side): fine raised seams, darkened after the bake
        xo = base.x + s * (pt * 1.02 / 2 + palm_out + 0.0004)
        for k, yo in enumerate((-0.026, 0.0, 0.026)):
            seam = [(xo - s * 0.004 * abs(yo) / 0.026, hy + yo * (1.0 - 0.25 * t), z0 - pl * (0.70 - 0.42 * t)) for t in (0.0, 0.33, 0.66, 1.0)]
            g.glove_points.append([Vector(p) for p in seam])
            g.add(L.tube(f'GSeam{tag}{k}', seam, [0.0013] * 4, n=3), 'glove', f'hand.{tag}')

def extra_gloves(g): glove_hands(g, V.A)

def glove_seams(g, mesh):
    """Post-bake: the stitched points read as fine darker lines (cream thread on white kid)."""
    col = mesh.data.color_attributes['Col']; lines = getattr(g, 'glove_points', [])
    for i, v in enumerate(mesh.data.vertices):
        d = min(((v.co - (a + (b - a) * max(0.0, min(1.0, (v.co - a).dot(b - a) / max(1e-9, (b - a).length_squared))))).length
                 for pts in lines for a, b in zip(pts[:-1], pts[1:])), default=1.0)
        if d < 0.0019:
            r, gg, b, al = col.data[i].color; f = 0.66; col.data[i].color = (r * f, gg * f * 0.97, b * f * 0.92, al)

# ---- the black orchid buttonhole (extra, attach 'chest'): a near-black cattleya orchid pinned on his LEFT lapel (on
# the waistcoat, its left breast), facing out and a little up (the game camera looks down). One variant per top (it
# lies on that top's own lapel surface). (Fixer, 19 Oct: reshaped after the art review, which read the first flower as
# an insect: four wing-like tepals, a round body and a stem like a tail.) Now an orchid's own parts: three narrow
# pointed sepals (one up, two down at the sides), two broad round-tipped petals with wavy edges, and an open, frilled
# lip (the labellum: a shallow trumpet) at the bottom with a pale lavender throat facing out, and a small pale column
# above it; no visible stem. 'Petal' is a fixed colour (a pale lavender: the throat); the post-bake tints the sepals,
# petals and the lip's frill near-black plum (about #24131f at the centre, a little lighter at the tips so the outline
# keeps on a dark jacket), so it reads as a black orchid, never navy, and never as the possessed crimson.
ORCHID_AT = {   # top -> (x, pct) of the flower's centre: on the lapel, below the gorge, clear of the bow tie's wings
    'tux': (0.128, 40.6), 'lounge': (0.124, 41.2), 'dinner': (0.124, 40.8), 'waistcoat': (0.118, 42.4), 'smoking': (0.106, 41.4)}
# (angle deg in the flower's plane: 90 = up, length, width, cup toward the tip, kind) at size 1 (metres)
ORCHID_TEPALS = [(90, 0.023, 0.0075, 0.0030, 'sepal'), (222, 0.021, 0.0068, 0.0026, 'sepal'), (318, 0.021, 0.0068, 0.0026, 'sepal'),
                 (12, 0.022, 0.0150, 0.0030, 'petal'), (168, 0.022, 0.0150, 0.0030, 'petal')]
# the lip: a broad frilled petal hanging below the centre, cupped toward the viewer (length, width, cup, frill)
ORCHID_LIP = dict(length=0.0175, width=0.0190, cup=0.0034, frill=0.0011, scallop=0.075)
# the post-bake tints (linear RGB factors on the pale lavender base; the bake's own shading is kept under them):
# sepals and petals near-black plum (a touch lighter at the tips: the outline keeps on a dark jacket), the lip's frill
# as dark, its throat a pale lavender streak down the middle of its FRONT, the column pale
ORCHID_TINT = dict(centre=(0.0200, 0.0122, 0.0132), tip=(0.0420, 0.0240, 0.0300), rim=(0.0260, 0.0140, 0.0180),
                   throat=(0.80, 0.74, 0.84), column=(0.95, 0.93, 0.95))
def _frame(n, up_tilt):
    N = Vector(n).normalized()
    U = Vector((0, 0, 1)); U = (U - N * U.dot(N)).normalized()
    t = math.radians(up_tilt); N2 = (N * math.cos(t) + U * math.sin(t)).normalized(); U2 = (U * math.cos(t) - N * math.sin(t)).normalized()
    R = U2.cross(N2).normalized()
    return R, U2, N2
def _tepal(name, ang, ln, wd, cup, kind, layer, lift, uv=(10, 7)):
    """One sepal or petal from the centre along `ang`, thin, cupped toward the viewer; `lift` keeps a part that rises
    in the (tilted) frame clear of the cloth."""
    t = L.uvsphere(name, 1.0, (0, 0, 0), scale=(wd / 2, 0.0009, ln / 2), u=uv[0], v=uv[1])
    a = math.radians(ang - 90)
    for v in t.data.vertices:
        s_ = max(0.0, min(1.0, (v.co.z / (ln / 2) + 1.0) / 2.0))           # 0 at the base .. 1 at the tip
        if kind == 'petal': tt = s_ ** 0.72; xf = 1.0                      # widest nearer the tip, a round tip
        else: tt = s_ ** 1.35; xf = 1.0 - 0.55 * GK.sm((s_ - 0.55) / 0.45)  # widest a third along, pointed
        zz = tt * ln; x = v.co.x * xf
        edge = abs(v.co.x) / (wd / 2 + 1e-9)
        ruffle = (0.0009 if kind == 'petal' else 0.0003) * math.sin(s_ * math.pi * 5.0) * edge * s_
        X, Z = x * math.cos(a) - zz * math.sin(a), x * math.sin(a) + zz * math.cos(a)
        y_ = v.co.y + cup * s_ * s_ + ruffle + layer + lift * max(0.0, Z)
        v.co = Vector((X, y_, Z))
    t.data.update(); return t
def orchid_parts(tag='', lift=0.0, tepal_uv=(10, 7), lip_uv=(16, 8), column_uv=(6, 4)):
    """One orchid in its own frame (x across, z up, y out toward the viewer), size 1: [(object, part)], part in
    'tepal', 'lip', 'column', and for the lip per vertex (front face?, along 0..1, across 0..1) for its colours. The
    sepals behind, the petals a touch in front, the lip in front of them."""
    out = []
    for k, (ang, ln, wd, cup, kind) in enumerate(ORCHID_TEPALS):
        out.append((_tepal(f'Tepal{tag}{k}', ang, ln, wd, cup, kind, 0.0 if kind == 'sepal' else 0.0006, lift, tepal_uv), 'tepal', None))
    # the lip: broad and rounded, hanging down from just below the centre, its sides cupped forward round a pale throat,
    # its edge frilled
    Lp = ORCHID_LIP; ln, wd = Lp['length'], Lp['width']
    lip = L.uvsphere(f'Lip{tag}', 1.0, (0, 0, 0), scale=(wd / 2, 0.0010, ln / 2), u=lip_uv[0], v=lip_uv[1])
    meta = []
    for v in lip.data.vertices:
        s_ = max(0.0, min(1.0, (-v.co.z / (ln / 2) + 1.0) / 2.0))          # 0 at its base (top) .. 1 at its tip (bottom)
        tt = s_ ** 0.8
        xf = 0.5 + 0.5 * GK.sm(s_ / 0.5)                                    # narrow at the base, broad and round below
        x = v.co.x * xf; edge = abs(v.co.x) / (wd / 2 + 1e-9)
        meta.append((v.co.y > 0.0, s_, edge))
        rim = max(edge, GK.sm((s_ - 0.7) / 0.3))
        th = math.atan2(v.co.x, -v.co.z + 1e-9)
        frill = Lp['frill'] * math.sin(th * 8.0) * rim * rim
        y_ = v.co.y + Lp['cup'] * edge * edge + 0.0016 * s_ + frill + 0.0016
        zc = -0.0015 - 0.5 * ln; z_ = -0.0015 - tt * ln
        k = 1.0 + Lp['scallop'] * math.sin(th * 9.0) * rim * GK.sm((s_ - 0.25) / 0.3)   # a scalloped, frilled edge
        v.co = Vector((x * k, y_, zc + (z_ - zc) * k))
    lip.data.update(); out.append((lip, 'lip', meta))
    col = L.uvsphere(f'Column{tag}', 0.0021, (0.0, 0.0030, -0.0010), scale=(1.0, 1.0, 1.7), u=column_uv[0], v=column_uv[1])
    out.append((col, 'column', None))
    return out
def orchid(g, top_key, x, pct, wfn, size=1.45, tilt=16.0):
    z = g.zp(pct); y, n = outer_hit(top_key, x, z)
    if y is None: raise RuntimeError(f'orchid: no {top_key} surface at {x}, {pct}')
    R, U, N = _frame(n, tilt)
    C = Vector((x, y, z)) + N * 0.0030 * size                     # a few mm off the cloth (pinned through)
    parts = {'lip': [], 'column': []}
    def place(ob):
        for v in ob.data.vertices:
            p = v.co.copy(); v.co = C + (R * p.x + U * p.z + N * p.y) * size
        ob.data.update(); return ob
    # (the lighter mesh, as on the corsage: a buttonhole of about 580 triangles, no heavier than the first flower, so the
    # guest's triangle cap takes nothing more off a full set of extras and glasses than before)
    for ob, part, meta in orchid_parts(lift=math.tan(math.radians(tilt)), tepal_uv=(8, 6), lip_uv=(12, 7)):
        place(ob)
        if part == 'lip': parts['lip'] += [(v.co.copy(), *m) for v, m in zip(ob.data.vertices, meta)]
        if part == 'column': parts['column'] += [v.co.copy() for v in ob.data.vertices]
        g.add_w(ob, 'petal', wfn)
    g.orchid_frames = getattr(g, 'orchid_frames', {}); g.orchid_frames[top_key] = (C.copy(), R.copy(), U.copy(), N.copy(), size, parts)

def orchid_tint(c, t):
    return (c[0] * t[0], c[1] * t[1], c[2] * t[2], c[3])
def orchid_paint(col, verts, frames):
    """Tint the baked flower(s): `frames` [(C, R, U, N, size, parts)]; a vertex of a lip or a column (matched by
    position) gets the lip's colours (a pale throat streak down the middle of its front, a dark frill) or the column's,
    every other one the sepal/petal plum (lighter at the tips). Writes col.data."""
    from mathutils import kdtree
    trees = []
    for C, R, U, N, size, parts in frames:
        kl = kdtree.KDTree(max(1, len(parts['lip'])))
        for i, (p, *_) in enumerate(parts['lip']): kl.insert(p, i)
        kl.balance()
        kc = kdtree.KDTree(max(1, len(parts['column'])))
        for i, p in enumerate(parts['column']): kc.insert(p, i)
        kc.balance()
        trees.append((C, R, U, N, size, parts, kl, kc))
    T = ORCHID_TINT
    mix = lambda a, b, k: tuple(a[j] + (b[j] - a[j]) * k for j in range(3))
    for i, v in enumerate(verts):
        best = None
        for C, R, U, N, size, parts, kl, kc in trees:
            d = (v.co - C) / size; r = math.hypot(d.dot(R), d.dot(U))
            if best is None or r < best[0]: best = (r, parts, kl, kc)
        r, parts, kl, kc = best
        c = col.data[i].color
        if kc.find(v.co)[2] < 1e-5: col.data[i].color = orchid_tint(c, T['column']); continue
        hit = kl.find(v.co)
        if hit[2] < 1e-5:
            _, front, s_, edge = parts['lip'][hit[1]]
            if not front: col.data[i].color = orchid_tint(c, T['rim']); continue
            k = max(GK.sm((edge - 0.10) / 0.35), GK.sm((s_ - 0.55) / 0.35))      # the throat: a streak down the middle
            col.data[i].color = orchid_tint(c, mix(T['throat'], T['rim'], k)); continue
        col.data[i].color = orchid_tint(c, mix(T['centre'], T['tip'], GK.sm(r / 0.024) ** 1.5))

def orchid_colours(g, mesh):
    """Post-bake: the sepals and petals near-black plum, the lip's throat pale lavender to a plum frill, the column pale."""
    fr = getattr(g, 'orchid_frames', {}); key = mesh.name.split('~')[1] if '~' in mesh.name else None
    if key not in fr: return
    orchid_paint(mesh.data.color_attributes['Col'], mesh.data.vertices, [fr[key]])

# ---- the lantern fob (extra, attach 'waist'): a fine watch chain from his front button to his left pocket, and a small
# brass lantern hanging from the chain's lowest point (the hotel's Lantern card in miniature). The chain lies on the
# top's own surface with that top's skin weights (nothing separates when walking); the lantern rides the same weights.
# On the waistcoat the chain is already part of the top: its variant hangs only the lantern from that chain.
FOB_CHAIN = {   # top -> chain from (x, pct) to (x, pct), sag (pct)
    'tux': ((0.018, 55.3), (0.118, 56.5), 1.6), 'lounge': ((0.018, 55.7), (0.128, 56.6), 1.6),
    'dinner': ((0.024, 56.6), (0.134, 56.3), 1.5), 'smoking': ((0.078, 57.0), (0.150, 57.4), 1.5)}
def lantern(g, top, wfn, h=0.038):
    """The little lantern hung from `top` (a world point), resting against the cloth: ring, cap, glass, posts, base."""
    def surf(x, z):
        y, n = outer_hit(g.fob_top, x, z); return y
    w = h * 0.52
    zr = top.z; z_cap = zr - 0.006; z_glass_top = z_cap - h * 0.22; z_glass_bot = z_glass_top - h * 0.50; z_base = z_glass_bot - h * 0.12
    x = top.x
    yb = min(surf(x, zz) for zz in (z_cap, z_glass_top, z_glass_bot, z_base)) - w * 0.5 - 0.0025
    parts = []
    ring = [(x + 0.0045 * math.cos(a), yb, zr - 0.002 + 0.0045 * math.sin(a)) for a in [2 * math.pi * k / 10 for k in range(11)]]
    parts.append(('gold', L.tube('LRing', ring, [0.0010] * len(ring), n=4)))
    cap = L.loft('LCap', [dict(z=z_cap - h * 0.22, w=w * 1.08, d=w * 1.08, r=0.6), dict(z=z_cap - h * 0.14, w=w * 0.86, d=w * 0.86, r=0.7),
                          dict(z=z_cap - h * 0.02, w=w * 0.30, d=w * 0.30, r=1.0), dict(z=z_cap, w=w * 0.12, d=w * 0.12, r=1.0)], n=8)
    parts.append(('gold', cap))
    glass = L.loft('LGlass', [dict(z=z_glass_bot, w=w * 0.84, d=w * 0.84, r=0.7), dict(z=(z_glass_bot + z_glass_top) / 2, w=w * 0.92, d=w * 0.92, r=0.7),
                              dict(z=z_glass_top, w=w * 0.84, d=w * 0.84, r=0.7)], n=8)
    parts.append(('glass', glass))
    for sx, sy in ((1, 1), (1, -1), (-1, 1), (-1, -1)):
        px, py = x + sx * w * 0.44, yb + sy * w * 0.44
        parts.append(('gold', L.tube('LPost', [(px, py, z_glass_bot - 0.001), (px * 1.0 + sx * 0.0006, py + sy * 0.0006, (z_glass_bot + z_glass_top) / 2), (px, py, z_glass_top + 0.001)], [0.0012] * 3, n=4)))
    base = L.loft('LBase', [dict(z=z_base, w=w * 0.70, d=w * 0.70, r=0.7), dict(z=z_base + h * 0.06, w=w * 1.02, d=w * 1.02, r=0.6),
                            dict(z=z_glass_bot + 0.001, w=w * 0.94, d=w * 0.94, r=0.6)], n=8)
    parts.append(('gold', base))
    for mat, ob in parts:
        for v in ob.data.vertices:
            if ob.name.startswith(('LCap', 'LGlass', 'LBase')): v.co.x += x; v.co.y += yb
        ob.data.update(); g.add_w(ob, mat, wfn)

def fob(g, top_id, wfn):
    key = f'top_{top_id}'; g.fob_top = key
    if top_id == 'waistcoat':                       # the waistcoat's own chain (top_waistcoat): the lantern from its low point
        t = 0.42; x = 0.012 + 0.096 * t; pz = 56.6 + (55.2 - 56.6) * t + 1.8 * math.sin(math.pi * t)
        z = g.zp(pz); y = g.chest_y(x, z) - 0.006; low = Vector((x, y, z))
    else:
        (xa, pa), (xb, pb), sag = FOB_CHAIN[top_id]
        pts = []
        for i in range(25):
            t = i / 24; x = xa + (xb - xa) * t; pz = pa + (pb - pa) * t + sag * math.sin(math.pi * t)
            z = g.zp(pz); y, _ = outer_hit(key, x, z); pts.append(Vector((x, y - 0.0032, z)))
        g.add_w(L.tube('FobChain', [tuple(p) for p in pts], [0.0022] * len(pts), n=5), 'gold', wfn)
        low = min(pts, key=lambda p: p.z)
    drop = [low, low + Vector((0, -0.001, -0.007)), low + Vector((0, -0.0015, -0.013))]
    g.add_w(L.tube('FobDrop', [tuple(p) for p in drop], [0.0015] * 3, n=4), 'gold', wfn)
    lantern(g, drop[-1], wfn)

# ---- the smoking jacket (B1, boutique): velvet (main colour) with a quilted satin shawl collar, turned-back satin cuffs,
# piped pockets and two frog closures (all the accent colour: 'Trim'). Built on Victor's jacket body like every top,
# with the dinner jacket's shawl line and shirt (the shared collar zone: every bow tie and tie sits right on it), closed
# lower (the fronts part only below 61 %). Quilting is in the geometry (soft diamond puffs on a one-sided shawl surface,
# the seams darkened after the bake); the velvet's soft pile is a gentle mottling in the bake.
QUILT_PITCH, QUILT_PUFF = 0.030, 0.0026
def _quilt(x, z):
    u = (x + z) * 0.7071; v = (z - x) * 0.7071
    a = math.sin(math.pi * u / QUILT_PITCH) ** 2; b = math.sin(math.pi * v / QUILT_PITCH) ** 2
    return (a * b) ** 0.35
def quilted_panel(g, name, outline, surf, lift, thick, mat, wfn, max_edge=0.021, puff=QUILT_PUFF, sink=0.002):
    """A one-sided raised panel (top surface + its edge wall, no hidden underside: half a slab's triangles) whose top is
    puffed into quilted diamonds. outline [(x, z)] (metres), surf(x, z) -> y of the surface under it (front: -Y out)."""
    area = sum(x0 * z1 - x1 * z0 for (x0, z0), (x1, z1) in zip(outline, outline[1:] + outline[:1]))
    if area < 0: outline = list(reversed(outline))
    dense = []
    for (x0, z0), (x1, z1) in zip(outline, outline[1:] + outline[:1]):
        k = max(1, int(math.hypot(x1 - x0, z1 - z0) / max_edge))
        dense += [(x0 + (x1 - x0) * i / k, z0 + (z1 - z0) * i / k) for i in range(k)]
    bm = bmesh.new(); vs = [bm.verts.new(Vector((x, 0.0, z))) for x, z in dense]
    f = bm.faces.new(vs); bmesh.ops.triangulate(bm, faces=[f], quad_method='BEAUTY', ngon_method='BEAUTY')
    longest = max(e.calc_length() for e in bm.edges)
    cuts = max(1, int(math.ceil(longest / max_edge)) - 1)
    inner = [e for e in bm.edges if not e.is_boundary]
    bmesh.ops.subdivide_edges(bm, edges=inner, cuts=1, use_grid_fill=True)
    for _ in range(3):                                         # split long interior edges until the mesh is fine enough
        long_ = [e for e in bm.edges if not e.is_boundary and e.calc_length() > max_edge * 1.15]
        if not long_: break
        bmesh.ops.subdivide_edges(bm, edges=long_, cuts=1, use_grid_fill=False)
        bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bmesh.ops.beautify_fill(bm, faces=bm.faces[:], edges=[e for e in bm.edges if not e.is_boundary])
    edge_d = {}
    bnd = [v for v in bm.verts if v.is_boundary]
    for v in bm.verts:
        d = min((v.co - b.co).length for b in bnd) if not v.is_boundary else 0.0
        q = _quilt(v.co.x, v.co.z) * GK.sm(d / 0.010)
        v.co.y = surf(v.co.x, v.co.z) - (lift + thick) - puff * q
    walls = bmesh.ops.extrude_edge_only(bm, edges=[e for e in bm.edges if e.is_boundary])
    for v in [e for e in walls['geom'] if isinstance(e, bmesh.types.BMVert)]:
        v.co.y = surf(v.co.x, v.co.z) + sink
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    ob = L.new_object(name, bm, smooth=True)
    return g.add_w(ob, mat, wfn)

SX_SHAWL = 1.10        # the shawl a touch broader than the dinner jacket's
LA_SMOKING_OUT = [(round(x * SX * (SX_SHAWL if i < 8 else 1.05 if i == 8 else 1.0), 4), p) for i, (x, p) in enumerate(LA_H['outline'])]
J_SMOKING = dict(V.J, nj=44, ring_dz=0.024, open_apex=61.0, open_hem=0.046, corner=0.055, mat='jacket',
                 lapel=dict(wrap=dict(LA_H['wrap'], nth=22, tip=(round(LA_H['wrap']['tip'][0] * SX * SX_SHAWL, 4), LA_H['wrap']['tip'][1])),
                            thick=LA_H['thick'], lift=LA_H['lift'], mat='trim'))
J_SMOKING.pop('vent', None)
A_SMOKING = dict(V.A, stations=HS.A['stations'], cuff_wd=HS.A['cuff_wd'], sleeve_buttons=0, n=18)
FROGS = (56.8, 59.6)          # pct of the two frog closures (below the shawl's V at 55.2)
def frog(g, pct, wfn, half=0.050, R=0.0105, r=0.0021):
    """One frog closure: a corded bar across the closure ending in a three-loop rosette each side, a barrel toggle."""
    z = g.zp(pct)
    def on(x, zz, out=0.0):
        y, _ = outer_hit('top_smoking_body', x, zz); return Vector((x, y - 0.0028 - out, zz))
    for s in (1, -1):
        pts = [on(s * (0.006 + (half - 0.006) * t), z) for t in (0.0, 0.25, 0.5, 0.75, 1.0)]
        J = Vector((s * half, z))
        for ang in (math.pi / 2, 0.0, -math.pi / 2):               # loops: up, out, down
            d = Vector((s * math.cos(ang), math.sin(ang))); pp = Vector((-d.y, d.x))
            for k in range(1, 7):
                t = k / 6; p2 = J + d * (R * 1.9 * (1 - math.cos(2 * math.pi * t)) / 2) + pp * (R * 0.55 * math.sin(2 * math.pi * t))
                pts.append(on(p2.x, p2.y, 0.0006 * math.sin(math.pi * t)))
        g.add_w(L.tube(f'Frog{s}', [tuple(p) for p in pts], [r] * len(pts), n=3), 'trim', wfn)
    y, _ = outer_hit('top_smoking_body', 0.0, z)
    tg = L.uvsphere('Toggle', 1.0, (0.0, y - 0.006, z), scale=(0.0045, 0.0045, 0.0105), u=6, v=4)
    L.rotate_verts(tg, (0, math.pi / 2, 0), about=(0.0, y - 0.006, z))
    g.add_w(tg, 'trim', wfn)

def top_smoking(g):
    J = J_SMOKING
    GK.jacket(g, J)
    g.parts[-1].name = 'top_smoking_body'                          # (the frogs and the shawl follow its surface)
    GK.lapels(g, J)                                                # (no outline in J: only the shawl's wrap round the neck)
    surf = lambda x, z: g.chest_y(x, min(z, g.jacket_top))
    for s_ in (1, -1):                                             # the quilted shawl, both sides
        quilted_panel(g, f'Shawl{s_}', [(s_ * x, g.zp(p)) for x, p in LA_SMOKING_OUT], surf, LA_H['lift'], LA_H['thick'], 'trim', g.jw)
        idx = LA_H['edge_shade']; wdt = LA_H.get('shade_w', 0.006)   # the shadow line just outside its outer edge
        P_ = [Vector((s_ * LA_SMOKING_OUT[i][0], 0, g.zp(LA_SMOKING_OUT[i][1]))) for i in idx]
        ln = sum((b - a).length for a, b in zip(P_[:-1], P_[1:])); P_ = L.resample_polyline(P_, max(3, int(ln / 0.024)))
        si, so = [], []
        for k, p_ in enumerate(P_):
            a = P_[max(0, k - 1)]; b = P_[min(len(P_) - 1, k + 1)]; t = (b - a).normalized()
            nrm = Vector((t.z, 0, -t.x)) * s_
            if nrm.x * s_ < 0: nrm = -nrm
            si.append((p_.x, p_.z)); so.append((p_.x + nrm.x * wdt, p_.z + nrm.z * wdt))
        GK.slab(g, f'ShawlShade{s_}', si + list(reversed(so)), surf, 0.0, 0.0015, 'shade', g.jw, cuts=0)
    fall = [(x, g.zp(p)) for x, p in COLLAR_FALL_DINNER]               # the shawl's fall across the upper back
    bsurf = lambda x, z: g.back_y(x, min(z, g.jacket_top - 0.004))
    GK.slab(g, 'CollarFall', fall, bsurf, 0.002, 0.007, 'trim', lambda co: {'spine': 1.0}, sign=1, max_edge=0.03)
    GK.slab(g, 'Seam', [(-0.0015, g.z_hem + 0.004), (0.0015, g.z_hem + 0.004), (0.0015, g.jacket_top - 0.035), (-0.0015, g.jacket_top - 0.035)],
            g.back_y, 0.0, 0.0010, 'shade', g.jw, sign=1, cuts=0)
    for s_ in (1, -1):                                             # piped hip pockets and his left breast pocket
        for x0, x1, p, h in ((0.104, 0.184, 61.4, 0.012), (0.136, 0.186, 46.6, 0.010))[: (2 if s_ > 0 else 1)]:
            xa, xb = sorted((s_ * x0, s_ * x1)); zc = g.zp(p)
            GK.slab(g, f'Piping{s_}{p}', [(xa, zc - h / 2), (xb, zc - h / 2), (xb, zc + h / 2), (xa, zc + h / 2)], g.chest_y, 0.0, 0.004, 'trim', g.jw, cuts=0)
    GK.shirt_front(g, SH_DINNER); GK.collar(g, SH_DINNER); MX.studs(g, STUDS_DINNER)
    for p in FROGS: frog(g, p, g.jw)
    GK.arms(g, A_SMOKING); GK.cuffs(g, A_SMOKING)
    for s, tag in ((1, 'L'), (-1, 'R')):                           # the turned-back satin cuffs
        *_, xy = GK.arm_path(g, A_SMOKING, s)
        z_end = g.zp(A_SMOKING['sleeve_end']); w0, d0 = A_SMOKING['stations'][0][1], A_SMOKING['stations'][0][2]
        prof = []
        # (a closed band from just above the sleeve's own hem: nothing of the hand is ever inside it)
        for dz, f in ((0.0006, 1.05), (0.005, 1.09), (0.046, 1.08), (0.052, 1.02)):
            x, y = xy(z_end + dz); prof.append(dict(z=z_end + dz, w=w0 * f, d=d0 * f, r=1.0, x=x, y=y))
        g.add(L.loft(f'TurnCuff{tag}', prof, n=16), 'trim', f'forearm.{tag}')

def _in_shawl(g, x, z):
    poly = [(px, g.zp(pp)) for px, pp in LA_SMOKING_OUT]; inside = False
    for (x0, z0), (x1, z1) in zip(poly, poly[1:] + poly[:1]):
        if (z0 > z) != (z1 > z) and x < x0 + (z - z0) * (x1 - x0) / (z1 - z0): inside = not inside
    return inside
def velvet(g, mesh):
    """Post-bake: velvet's soft pile (a gentle, slow mottling of the cloth) and the shawl's quilting seams."""
    col = mesh.data.color_attributes['Col']; mats = C_vertex_materials(mesh)
    for i, v in enumerate(mesh.data.vertices):
        p = v.co; f = 1.0
        if mats[i] == 'Jacket':
            n = math.sin(p.x * 23.0 + 1.3) * math.sin(p.z * 19.0 + 0.4) + 0.6 * math.sin((p.x + p.z) * 41.0 + p.y * 30.0)
            f = 1.0 - 0.045 * (n + 1.6) / 3.2
        elif mats[i] == 'Trim' and p.y < -0.05 and _in_shawl(g, abs(p.x), p.z):
            q = _quilt(p.x, p.z); f = 0.72 + 0.28 * min(1.0, q / 0.55)
        if f != 1.0:
            c = col.data[i].color; col.data[i].color = (c[0] * f, c[1] * f, c[2] * f, c[3])

# ---- the Poet (A3, hairStyle 'lamplighter' for men): tousled romantic waves, longer than the others (over the tops of
# the ears, down to the collar line behind), a side part on his left and loose S-waves tumbling forward and to his
# right, kept above the brows. Sculpted with Beatrice's lock-band hair (guests/beatrice.py band_hair: dress_kit's SDF
# helpers + raised S-shaped lock bands with dark valleys between them) on whichever face is current, so every face
# gets its own fitted copy. The band paths are given on the skull (longitude u, height pct) and snapped onto the hair.
import beatrice as BE
def poet_hairline(u):
    """Lower edge (pct) by longitude u (0 front, 0.25 his right, 0.5 back, 0.75 his left)."""
    a = abs(((u + 0.5) % 1.0) - 0.5); ss = GK.sm; d = (u + 0.5) % 1.0 - 0.5          # d < 0: his left (the part side)
    z = 8.0 + 0.9 * ss((a - 0.03) / 0.05) + 1.7 * math.exp(-((d - 0.075) / 0.038) ** 2)  # the forehead; the front wave dips at his right
    z = z + (12.6 - z) * ss((a - 0.118) / 0.035)              # the temples
    z = z + (15.2 - z) * ss((a - 0.168) / 0.022)              # a soft sideburn in front of the ear
    z = z + (13.6 - z) * ss((a - 0.205) / 0.016)              # over the top of the ear
    z = z + (27.6 - z) * ss((a - 0.282) / 0.050)              # behind the ear, down to the nape
    return z

def _poet_path(g, keys, half):
    """keys [(u, pct)] on the skull -> band keys (x, dy, pct, half-width): a point a little outside the skull (the band
    path is snapped onto the hair surface by band_hair)."""
    out = []
    for i, (u, p) in enumerate(keys):
        q = g.skull_at(u % 1.0, g.zp(p)); c = Vector((0.0, g.Y0, q.z)); q = c + (q - c) * 1.12
        t = i / max(1, len(keys) - 1)
        out.append((q.x, q.y - g.Y0, p, half * (0.45 + 0.55 * GK.sm(t / 0.35))))
    return out
def _s(u0, u1, p0, p1, amp, n=8, ph=0.0):
    """An S-wave path from (u0, p0) to (u1, p1) swinging +-amp in u (one and a half waves along it)."""
    return [(u0 + (u1 - u0) * t + amp * math.sin(2 * math.pi * 1.5 * t + ph), p0 + (p1 - p0) * t) for t in [i / (n - 1) for i in range(n)]]

def poet_spec(g):
    ss = GK.sm
    bands = []
    # the front: three waves from the part (his left, u 0.84) over the crown, tumbling forward and down to his right
    for i, (p0, h, hw) in enumerate(((0.6, 0.024, 0.036), (2.4, 0.030, 0.040), (4.2, 0.026, 0.038))):
        keys = [(0.86, p0), (0.93, p0 + 2.4 + i * 0.4), (1.00, p0 + 4.4 + i * 0.9), (1.07, p0 + 5.6 + i * 1.0), (1.13, p0 + 6.8 + i * 0.8),
                (1.19, p0 + 8.6 + i * 0.6), (1.235, p0 + 11.6 + i * 0.4)]
        bands.append(dict(keys=_poet_path(g, keys, hw), height=h, soft=0.008, dome=0.5, taper=(0.10, 0.18), cut=True))
    # his left (the part side): two waves sweeping back over the temple and behind the ear
    for i, (p0, h) in enumerate(((3.5, 0.018), (7.0, 0.020))):
        bands.append(dict(keys=_poet_path(g, _s(0.84, 0.66, p0, p0 + 16.0, 0.018, ph=i * 1.3), 0.032), height=h, soft=0.008, dome=0.5, taper=(0.12, 0.15), cut=True))
    # his right: two waves down over the top of the ear and back
    for i, (p0, h) in enumerate(((5.0, 0.020), (9.0, 0.018))):
        bands.append(dict(keys=_poet_path(g, _s(0.14, 0.34, p0, p0 + 15.5, 0.018, ph=0.6 + i * 1.1), 0.032), height=h, soft=0.008, dome=0.5, taper=(0.12, 0.15), cut=True))
    # the back: six S-waves from the crown to the nape, alternately taller (each stands proud of its neighbours)
    for k, u0 in enumerate((0.375, 0.425, 0.475, 0.525, 0.575, 0.625)):
        bands.append(dict(keys=_poet_path(g, _s(u0, u0 + 0.02 * (1 if k % 2 else -1), 3.5, 26.8, 0.022, ph=k * 0.9), 0.036),
                          height=(0.022 if k % 2 else 0.016), soft=0.008, dome=0.55, taper=(0.12, 0.10), cut=True))
    # the curl ends round the bottom of the hair (behind the ears and the nape), not cut by the hairline: they flick out
    curls = []
    for a, p in ((0.33, 25.0), (0.375, 26.8), (0.43, 27.6), (0.48, 28.0), (0.54, 27.8), (0.59, 27.2), (0.635, 26.0), (0.68, 24.6)):
        q = g.skull_at(a, g.zp(p - 1.2)); c = Vector((0.0, g.Y0, q.z)); q = c + (q - c) * 1.10
        curls.append(dict(c=(q.x, q.y - g.Y0, p - 1.0), r=(0.036, 0.034, 0.030), k=0.022, cut=False))
    # loose locks over the temples (his right, where the front waves end; his left behind the part)
    for x, dy, p, r in ((-0.168, -0.055, 12.2, (0.030, 0.040, 0.034)), (0.172, -0.010, 13.2, (0.028, 0.040, 0.032))):
        curls.append(dict(c=(x, dy, p), r=r, k=0.020, cut=False))
    return dict(
        cap=dict(thick=[(0, 0.034), (3, 0.040), (6, 0.038), (10, 0.032), (14, 0.028), (20, 0.024), (28, 0.016)], hairline=poet_hairline, edge_k=0.016),
        masses=[dict(c=(0.010, 0.000, 3.6), r=(0.170, 0.185, 0.082), k=0.040),               # the tousled crown
                dict(c=(0.050, -0.130, 2.6), r=(0.105, 0.090, 0.046), k=0.035),             # the wave lifting from the part
                dict(c=(-0.060, -0.165, 6.2), r=(0.080, 0.050, 0.038), k=0.030)] +          # the forward roll over his right brow
               [dict(c=(x, dy, p), r=(0.040, 0.040, 0.030), k=0.022) for x, dy, p in          # loose tousled locks on top
                ((-0.080, -0.060, 1.8), (0.090, 0.020, 2.2), (-0.040, 0.090, 3.4), (0.060, 0.120, 5.0), (-0.110, 0.040, 4.2))] + [
                dict(c=(0.0, 0.120, 19.5), r=(0.165, 0.110, 0.090), k=0.040),                # fullness low at the back
                dict(c=(-0.160, 0.020, 10.5), r=(0.070, 0.120, 0.060), k=0.035),            # his right side, above the ear
                dict(c=(0.158, 0.030, 10.0), r=(0.066, 0.120, 0.060), k=0.035)] + curls,     # his left side
        bands=bands, lock_base=0.006, valley=0.010,
        box=((-0.30, g.Y0 - 0.32, g.zp(30.5)), (0.30, g.Y0 + 0.32, g.zp(-4.5))), voxel=0.0040, tris=7800, smooth=4, post_smooth=2)

def hair_poet(g):
    BE.band_hair(g, poet_spec(g))

def extra_orchid_on(tid):
    def build(g):
        x, p = ORCHID_AT[tid]; orchid(g, f'top_{tid}', x, p, g.jw)
    return build
def extra_fob_on(tid):
    def build(g): fob(g, tid, g.jw)
    return build

# =====================================================================================================================
# THE ITEM LIST (build order matters: neckwear follows the top it is fitted to)
# =====================================================================================================================
TOP_COLOURS = {
    'tux':       dict(Jacket=V.COLOURS['jacket'], Lapel=V.COLOURS['lapel'], Shade=V.COLOURS['shade'], Button=V.COLOURS['button'], Shirt=SHIRT),
    'lounge':    dict(Jacket=MS.COLOURS['jacket'], Shade=MS.COLOURS['shade'], Button=MS.COLOURS['button'], Shirt=MS.COLOURS['shirt']),
    'dinner':    dict(Jacket=HS.COLOURS['jacket'], Shade=HS.COLOURS['shade'], Horn=HS.COLOURS['horn'], Button=HS.COLOURS['button'], Shirt=HS.COLOURS['shirt']),
    'waistcoat': dict(Jacket=V.COLOURS['jacket'], Button=V.COLOURS['button'], Shirt=WHITE_SHIRT, Gold='#e0b060', Tie=V.COLOURS['tie']),
    'smoking':   dict(Jacket='#2f4a3c', Trim='#1a1a1e', Shade='#16241c', Button=HS.COLOURS['button'], Shirt=HS.COLOURS['shirt']),
}
HAIRS = [   # id, builder, bake overlay, colour, post (blur), smoothing angle
    ('swept', hair_swept, BAKE_HAIR_V, HAIR_DARK, None, 62.0),
    ('sideSwept', hair_side_swept, BAKE_HAIR_V, MS.COLOURS['hair'], None, 62.0),
    ('quiff', hair_quiff, BAKE_HAIR_H, HS.COLOURS['hair'], blur_hair, 80.0),
    ('sidePart', hair_side_part, BAKE_HAIR_V, HAIR_DARK, None, 62.0),
    ('curlyCrop', hair_curly, BAKE_HAIR_V, HAIR_DARK, None, 62.0),
    ('lamplighter', lambda g: hair_poet(g), BAKE_HAIR_V, HAIR_DARK, None, 62.0),     # W1-B: the Poet (defined further down)
]
FACIALS = [('handlebar', facial_handlebar), ('pencil', facial_pencil)]
W1B_FACIALS = [('dali', lambda g: facial_dali(g))]       # (W1-B; defined further down)
ALL_TOPS = ('tux', 'lounge', 'dinner', 'waistcoat', 'smoking')

def items():
    """Every piece of body 'm' in build order: dicts with key, slot, id, fit, face (head state), build, ctx (own bake
    context keys), casts [(target key, base context keys)], bake (cfg overlay), colours, materials, smooth, post, ship."""
    out = []
    def add(**k):
        k.setdefault('fit', None); k.setdefault('face', DEFAULT_FACE); k.setdefault('bake', dict(ao_skip=AO_SKIP)); k.setdefault('materials', {})
        k.setdefault('smooth', 62.0); k.setdefault('post', []); k.setdefault('ship', True); k.setdefault('extras', {}); k.setdefault('casts', [])
        k.setdefault('lift', None); k.setdefault('jacket_of', None)
        out.append(k)
    add(key='body', slot='body', id='body', build=build_body, ctx=[], colours=dict(Skin=V.COLOURS['skin']))
    for F in FACE_ORDER:
        FF = FACES[F]
        add(key=f'face_{F}', slot='face', id=F, face=F, build=build_face, ctx=['body'], casts=[('body', [])],
            bake=dict(FF['cfg']), colours=FF['colours'], smooth=FF['smooth'], lift=FF.get('lift'),
            post=([bend_henry] if FF.get('bend') else []),
            extras=({'builtInGlasses': {'style': 'round', 'material': 'Glasses'}} if FF.get('glasses') else {}))
        top, neck = FF['look']
        suffix = '' if F == DEFAULT_FACE else f'~face_{F}'
        for hid, fn, bake, col, post, smooth in HAIRS:
            add(key=f'hairStyle_{hid}{suffix}', slot='hairStyle', id=hid, fit=(f'face_{F}' if suffix else None), face=F, build=fn,
                ctx=['body', f'face_{F}', f'top_{top}', f'neck_{neck}'], casts=[(f'face_{F}', ['body']), ('body', [f'face_{F}'])],
                bake=bake, colours=dict(Hair=col), smooth=smooth, post=([post] if post else []))
        for fid, fn in FACIALS + W1B_FACIALS:
            add(key=f'facial_{fid}{suffix}', slot='facial', id=fid, fit=(f'face_{F}' if suffix else None), face=F, build=fn,
                ctx=[f'face_{F}'], casts=[(f'face_{F}', ['body'])], bake=dict(FF['cfg']), colours=dict(Stache=V.COLOURS['stache']))
    legs = ['legs_trousers', 'legs_blackTrousers']
    def top(tid, fn, smooth=62.0, lift=None, post=(), bake=None):
        add(key=f'top_{tid}', slot='top', id=tid, build=fn, ctx=['body', 'legs_trousers'],
            casts=[('body', ['face_victor'])] + [(l, ['body', 'feet_derby']) for l in legs],
            colours=TOP_COLOURS[tid], smooth=smooth, lift=lift, post=list(post), **({'bake': bake} if bake else {}))
    def neck(nid, fn, fit_top='tux', variant=None, colour=V.COLOURS['tie'], smooth=62.0, tops=ALL_TOPS, face_fit=None):
        # (face_fit: a variant fitted to a face instead of a top: Henry's lowered bows, W1-B)
        key = f'neck_{nid}' + (f'~top_{variant}' if variant else '') + (f'~face_{face_fit}' if face_fit else '')
        T = variant or fit_top
        add(key=key, slot='neck', id=nid, fit=(f'top_{variant}' if variant else f'face_{face_fit}' if face_fit else None), build=fn, jacket_of=f'top_{T}',
            ctx=['body', f'top_{T}'], casts=[('body', [f'face_{face_fit or DEFAULT_FACE}', f'top_{T}'])] + [(f'top_{t}', ['body', 'legs_trousers']) for t in tops],
            colours=dict(Tie=colour), smooth=smooth)
    top('tux', top_tux)
    top('lounge', top_lounge)
    top('dinner', top_dinner, smooth=80.0, lift={'Jacket': 0.65})
    top('waistcoat', top_waistcoat, post=[waistcoat_creases])
    # W1-B: the smoking jacket (its satin trim has a soft fixed sheen, like the shoes' polish)
    top('smoking', top_smoking, post=[velvet], bake=dict(ao_skip=AO_SKIP, sheen={'Trim': (0.74, [((0.0, -1.0, 0.55), 5.0, 0.55), ((0.0, -0.3, 1.0), 6.0, 0.35)])}))
    out[-1]['patch_below'] = 0.985     # (its shadow on the body and trousers: the faintest 1.5 % left out, so the file keeps room
                                       # under its byte cap for the recorded test results)
    neck('bow', neck_bow)
    neck('tie', neck_tie, colour=MS.COLOURS['tie'], tops=tuple(t for t in ALL_TOPS if t != 'waistcoat'))
    neck('tie', neck_tie_vest, variant='waistcoat', colour=MS.COLOURS['tie'], tops=('waistcoat',))
    neck('bowFull', neck_bow_full, colour=HS.COLOURS['tie'], smooth=80.0)
    # W1-B: on Henry's face both bows sit lower (his chin hid them from the game camera)
    neck('bow', neck_bow_henry, face_fit='henry')
    neck('bowFull', neck_bow_full_henry, colour=HS.COLOURS['tie'], smooth=80.0, face_fit='henry')
    add(key='legs_trousers', slot='legs', id='trousers', build=legs_trousers, ctx=['body', 'feet_derby'],
        casts=[('body', []), ('feet_derby', ['body'])], colours=dict(Trouser=V.COLOURS['trouser']))
    add(key='legs_blackTrousers', slot='legs', id='blackTrousers', build=legs_trousers, ctx=['body', 'feet_derby'],
        casts=[('body', []), ('feet_derby', ['body'])], colours=dict(Trouser=HS.COLOURS['trouser']), materials=dict(Trouser='fixed'))
    add(key='feet_derby', slot='feet', id='derby', build=feet_derby, ctx=['body'], colours=dict(Shoe=V.COLOURS['shoe'], Sole=V.COLOURS['sole']))
    # ---- W1-B extras: one variant per top for those that lie on the top (they follow its surface), plain gloves
    for tid in ALL_TOPS:
        add(key=f'extra_blackOrchid~top_{tid}', slot='extra', id='blackOrchid', fit=f'top_{tid}', build=extra_orchid_on(tid), jacket_of=f'top_{tid}',
            ctx=['body', f'top_{tid}'], colours=dict(Petal=ORCHID_HEX), post=[orchid_colours], extras={'attach': 'chest'})
    for tid in ALL_TOPS:
        add(key=f'extra_lantern~top_{tid}', slot='extra', id='lantern', fit=f'top_{tid}', build=extra_fob_on(tid), jacket_of=f'top_{tid}',
            ctx=['body', f'top_{tid}', 'legs_trousers'], colours=dict(Gold=COLOURS['gold'], Glass=GLASS_HEX), extras={'attach': 'waist'})
    # (hidesSkin: the body's hands are not drawn under the gloves, src/render/avatarParts.js; fixer, 19 Oct)
    add(key='extra_eveningGloves', slot='extra', id='eveningGloves', build=extra_gloves, ctx=['body', 'top_tux'], colours=dict(Glove=GLOVE_HEX, Pearl=PEARL_HEX),
        post=[glove_seams], extras={'attach': 'hands', 'hidesSkin': ['hand.L', 'hand.R']})
    return out

# the rig and the clips: Victor's
RIG = V.RIG
ORCHID_HEX, GLASS_HEX, GLOVE_HEX, TRIM_HEX, PEARL_HEX = '#c9b6dc', '#f3e8cc', '#eef2fa', '#1a1a1e', '#ece6dc'    # (W1-B: fixed colours; trim: tools only;
# the orchid's is its throat's pale lavender: the post-bake tints the rest near-black plum, orchid_paint)
COLOURS = dict(V.COLOURS, glasses=HS.COLOURS['glasses'], horn=HS.COLOURS['horn'], gold='#e0b060',
               petal=ORCHID_HEX, glass=GLASS_HEX, glove=GLOVE_HEX, trim=TRIM_HEX, pearl=PEARL_HEX)
BASE_CFG = FACES[DEFAULT_FACE]['cfg']
