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
                   facial=dict(handlebar={}, pencil=dict(z=24.4))),
    'marcus': dict(cfg=_head_cfg(MS, _on_victor_neck(MS)), tables=(MS.W, MS.DF, MS.DB, MS.E, MS.BULGES), nlon=48, nlat=34,
                   colours=dict(Skin=MS.COLOURS['skin'], Brow=MS.COLOURS['brow'], Mouth=MS.COLOURS['mouth'], Eye=MS.COLOURS['eye']),
                   look=('lounge', 'tie'), smooth=62.0,
                   # his nose sits higher and his smile is wide and high: a slimmer handlebar under the nose, the smile
                   # still showing beneath it
                   facial=dict(handlebar=dict(z=22.9, thick=0.054, w=0.196), pencil=dict(z=23.55, w=0.118))),
    'henry':  dict(cfg=_head_cfg(HS, _on_victor_neck(HS)), tables=(HS.W, HS.DF, HS.DB, HS.E, HS.BULGES), nlon=44, nlat=32,
                   colours=dict(Skin=HS.COLOURS['skin'], Brow=HS.COLOURS['brow'], Mouth=HS.COLOURS['mouth'], Eye=HS.COLOURS['eye'],
                                Glasses=HS.COLOURS['glasses']),
                   look=('dinner', 'bowFull'), smooth=80.0,
                   lift={'Skin': 0.45},          # his fair face stays light under the hair (as his own build: dress_kit.lift_ao)
                   bend=True,                    # his round lower face's shading normals bent forward (male_extras.bend_normals)
                   glasses=HS.GL,                # his own round frames: drawn when he wears "Round" (builtInGlasses)
                   facial=dict(handlebar=dict(z=25.15, thick=0.050, w=0.188), pencil=dict(z=25.95, w=0.116))),
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
# THE ITEM LIST (build order matters: neckwear follows the top it is fitted to)
# =====================================================================================================================
TOP_COLOURS = {
    'tux':       dict(Jacket=V.COLOURS['jacket'], Lapel=V.COLOURS['lapel'], Shade=V.COLOURS['shade'], Button=V.COLOURS['button'], Shirt=SHIRT),
    'lounge':    dict(Jacket=MS.COLOURS['jacket'], Shade=MS.COLOURS['shade'], Button=MS.COLOURS['button'], Shirt=MS.COLOURS['shirt']),
    'dinner':    dict(Jacket=HS.COLOURS['jacket'], Shade=HS.COLOURS['shade'], Horn=HS.COLOURS['horn'], Button=HS.COLOURS['button'], Shirt=HS.COLOURS['shirt']),
    'waistcoat': dict(Jacket=V.COLOURS['jacket'], Button=V.COLOURS['button'], Shirt=WHITE_SHIRT, Gold='#e0b060', Tie=V.COLOURS['tie']),
}
HAIRS = [   # id, builder, bake overlay, colour, post (blur), smoothing angle
    ('swept', hair_swept, BAKE_HAIR_V, HAIR_DARK, None, 62.0),
    ('sideSwept', hair_side_swept, BAKE_HAIR_V, MS.COLOURS['hair'], None, 62.0),
    ('quiff', hair_quiff, BAKE_HAIR_H, HS.COLOURS['hair'], blur_hair, 80.0),
    ('sidePart', hair_side_part, BAKE_HAIR_V, HAIR_DARK, None, 62.0),
    ('curlyCrop', hair_curly, BAKE_HAIR_V, HAIR_DARK, None, 62.0),
]
FACIALS = [('handlebar', facial_handlebar), ('pencil', facial_pencil)]

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
        for fid, fn in FACIALS:
            add(key=f'facial_{fid}{suffix}', slot='facial', id=fid, fit=(f'face_{F}' if suffix else None), face=F, build=fn,
                ctx=[f'face_{F}'], casts=[(f'face_{F}', ['body'])], bake=dict(FF['cfg']), colours=dict(Stache=V.COLOURS['stache']))
    legs = ['legs_trousers', 'legs_blackTrousers']
    def top(tid, fn, smooth=62.0, lift=None, post=()):
        add(key=f'top_{tid}', slot='top', id=tid, build=fn, ctx=['body', 'legs_trousers'],
            casts=[('body', ['face_victor'])] + [(l, ['body', 'feet_derby']) for l in legs],
            colours=TOP_COLOURS[tid], smooth=smooth, lift=lift, post=list(post))
    def neck(nid, fn, fit_top='tux', variant=None, colour=V.COLOURS['tie'], smooth=62.0, tops=('tux', 'lounge', 'dinner', 'waistcoat')):
        key = f'neck_{nid}' + (f'~top_{variant}' if variant else '')
        T = variant or fit_top
        add(key=key, slot='neck', id=nid, fit=(f'top_{variant}' if variant else None), build=fn, jacket_of=f'top_{T}',
            ctx=['body', f'top_{T}'], casts=[('body', ['face_victor', f'top_{T}'])] + [(f'top_{t}', ['body', 'legs_trousers']) for t in tops],
            colours=dict(Tie=colour), smooth=smooth)
    top('tux', top_tux)
    top('lounge', top_lounge)
    top('dinner', top_dinner, smooth=80.0, lift={'Jacket': 0.65})
    top('waistcoat', top_waistcoat, post=[waistcoat_creases])
    neck('bow', neck_bow)
    neck('tie', neck_tie, colour=MS.COLOURS['tie'], tops=('tux', 'lounge', 'dinner'))
    neck('tie', neck_tie_vest, variant='waistcoat', colour=MS.COLOURS['tie'], tops=('waistcoat',))
    neck('bowFull', neck_bow_full, colour=HS.COLOURS['tie'], smooth=80.0)
    add(key='legs_trousers', slot='legs', id='trousers', build=legs_trousers, ctx=['body', 'feet_derby'],
        casts=[('body', []), ('feet_derby', ['body'])], colours=dict(Trouser=V.COLOURS['trouser']))
    add(key='legs_blackTrousers', slot='legs', id='blackTrousers', build=legs_trousers, ctx=['body', 'feet_derby'],
        casts=[('body', []), ('feet_derby', ['body'])], colours=dict(Trouser=HS.COLOURS['trouser']), materials=dict(Trouser='fixed'))
    add(key='feet_derby', slot='feet', id='derby', build=feet_derby, ctx=['body'], colours=dict(Shoe=V.COLOURS['shoe'], Sole=V.COLOURS['sole']))
    return out

# the rig and the clips: Victor's
RIG = V.RIG
COLOURS = dict(V.COLOURS, glasses=HS.COLOURS['glasses'], horn=HS.COLOURS['horn'], gold='#e0b060')
BASE_CFG = FACES[DEFAULT_FACE]['cfg']
