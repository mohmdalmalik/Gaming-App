# Henry — older gentleman: ivory shawl-collar dinner jacket (one button, flap pockets, white pocket square), white
# dress shirt with black studs, black bow tie, black trousers, black glossy shoes; silver-grey hair swept up and
# back (a full quiff, sculpted flat locks), round thin dark-brown wire glasses, fair peachy skin with rosy cheeks.
# Reference: tools/char-pipeline/ref/henry-sheet.png (panels in ref/panels-henry/). Built by
#   python3 tools/char-pipeline/make_guest.py henry   -> assets/characters/henry.glb
# Uses guest_kit (body/face/finish), dress_kit.sculpt_hair (the SDF hair sculpt, read-only use) and male_extras
# (glasses, bow tie, studs, pocket square).
import math
import guest_kit as GK
import dress_kit as DK
import male_extras as MX
import victor_lib as L

H = 1.66
def zp(p): return H * (1 - p / 100)
sm = GK.sm

CFG = dict(
    z_hair_top=0.0, z_skull_top=4.5, z_hairline=8.0, z_brow=13.5, z_eye=19.8, z_nose=22.9, z_mouth=25.9, z_chin=31.4, z_ear=21.9,
    head_y=0.03, z_shoulder_top=35.3,
    ear_style='round', ear_seg=(18, 14), ear_h=0.128, ear_w=0.120, ear_out=0.036, ear_y=0.018, ear_tilt=0.98, ear_thick=0.034, ear_rim=0.010, ear_bowl=0.016, ear_sink=0.022,
    eye_x=0.064, eye_w=0.040, eye_h=0.058, eye_lift=0.003,
    brow=dict(x0=0.040, x1=0.128, z=13.5, thick=0.034, arch=0.008, drop_in=0.002, drop_out=0.012,
              profile=[(0.0, 0.40), (0.05, 0.85), (0.14, 0.97), (0.45, 1.0), (0.85, 0.92), (0.95, 0.75), (1.0, 0.35)], flat=0.5),
    nose_w=0.076, nose_h=0.074, nose_d=0.064, nose_out=0.038, nose_top=1.15,
    mouth=dict(w=0.132, z=25.9, rise=0.020, sag=0.004, thick=0.008),
    neck_r=0.094, neck_y=0.020,
    tint=dict(spots=[(0.100, 24.0, 0.050, 0.035, 1.0), (0.0, 22.9, 0.028, 0.024, 0.7)], g=0.20, b=0.20),
    groove_dark=(0.010, 0.35),
    sheen={'Shoe': (0.34, [((0.2, -0.45, 0.87), 14.0, 1.0), ((0.0, -1.0, 0.3), 16.0, 0.8), ((0.9, 0.0, 0.45), 16.0, 0.5), ((-0.9, 0.0, 0.45), 16.0, 0.5)]),
           'Hair': (0.70, (-0.2, -0.40, 0.89), 2.0)},
    ao_skip=('Brow', 'Eye', 'Mouth', 'Glasses'), ao_scale={'Skin': 0.45, 'Jacket': 0.8, 'Hair': 0.7},
)
COLOURS = dict(
    skin='#ffb08a', hair='#e6d4cb', brow='#9a8a86', mouth='#4a2418', eye='#0b0b0d', glasses='#3a2218',
    jacket='#f7e0c6', trouser='#4a4646', button='#1b1a1a', shade='#c7b096', horn='#d9c3a8',
    shirt='#fbf6f0', tie='#3a3436',
    shoe='#5f5856', sole='#1a1818',
)

# ---- skull tables by f (0 chin .. 1 skull top): a round soft face, full low cheeks/jowls
W  = [(0, 0.0), (0.02, 0.060), (0.05, 0.092), (0.08, 0.110), (0.13, 0.128), (0.20, 0.146), (0.28, 0.159), (0.35, 0.165),
      (0.43, 0.167), (0.50, 0.167), (0.61, 0.164), (0.72, 0.158), (0.83, 0.146), (0.90, 0.128), (0.96, 0.092), (0.99, 0.050), (1, 0.0)]
DF = [(0, 0.0), (0.02, 0.095), (0.037, 0.135), (0.074, 0.180), (0.13, 0.204), (0.20, 0.214), (0.28, 0.216), (0.35, 0.215), (0.43, 0.213),
      (0.50, 0.211), (0.57, 0.209), (0.65, 0.207), (0.72, 0.204), (0.80, 0.196), (0.87, 0.184), (0.94, 0.158), (0.98, 0.110), (1, 0.0)]
DB = [(0, 0.0), (0.02, 0.030), (0.06, 0.052), (0.12, 0.075), (0.20, 0.102), (0.30, 0.130), (0.42, 0.158), (0.55, 0.176),
      (0.68, 0.181), (0.78, 0.174), (0.87, 0.155), (0.93, 0.125), (0.98, 0.070), (1, 0.0)]
E  = [(0, 2.1), (0.08, 2.2), (0.25, 2.45), (0.45, 2.55), (0.65, 2.5), (0.85, 2.35), (1, 2.2)]
BULGES = [dict(x=0.100, z=24.6, sx=0.055, sz=0.045, a=0.030),      # full rosy cheeks beside the smile
          dict(x=0.0, z=21.2, sx=0.016, sz=0.024, a=0.026),        # nose bridge rising into the ball
          dict(x=0.0, z=29.0, sx=0.050, sz=0.020, a=0.006)]        # soft chin

# ---- hair: guest_kit.hair_shell with the envelope measured on the FRONT (widths) and SIDE (front/back) panels,
# metres from the head axis by pct height; sculpted lock lines as soft grooves.
HAIR = dict(
    wr=[(0.0, -0.010), (0.5, 0.010), (1.0, 0.035), (1.5, 0.060), (2.0, 0.085), (3.0, 0.130), (4.0, 0.168), (5.0, 0.197), (6.0, 0.215),
        (7.0, 0.227), (8.0, 0.238), (9.0, 0.245), (10.0, 0.252), (11.0, 0.259), (12.0, 0.264), (13.0, 0.265), (14.0, 0.262), (15.0, 0.255),
        (16.0, 0.248), (17.0, 0.242), (18.0, 0.236), (20.0, 0.222), (21.5, 0.205), (23.0, 0.185), (24.5, 0.170), (26.0, 0.145), (27.5, 0.100)],
    wl=[(0.0, 0.070), (0.5, 0.080), (1.0, 0.090), (1.5, 0.101), (2.0, 0.106), (3.0, 0.118), (4.0, 0.135), (5.0, 0.155), (6.0, 0.174),
        (7.0, 0.183), (8.0, 0.191), (9.0, 0.195), (10.0, 0.196), (12.0, 0.193), (13.0, 0.188), (14.0, 0.184), (15.0, 0.180), (16.0, 0.176),
        (17.0, 0.172), (19.0, 0.180), (22.0, 0.180), (24.5, 0.165), (26.0, 0.140), (27.5, 0.100)],
    front=[(0.0, 0.160), (0.5, 0.180), (1.0, 0.190), (2.0, 0.193), (3.0, 0.192), (4.0, 0.185), (5.0, 0.178), (6.0, 0.180), (8.0, 0.190),
           (10.0, 0.200), (14.0, 0.205), (20.0, 0.19), (27.5, 0.08)],
    back=[(0.0, 0.010), (0.5, 0.020), (1.0, 0.040), (1.5, 0.060), (2.0, 0.080), (3.0, 0.118), (4.0, 0.143), (5.0, 0.158), (6.0, 0.170),
          (7.0, 0.180), (8.0, 0.195), (9.0, 0.212), (10.0, 0.226), (11.0, 0.240), (12.0, 0.247), (13.0, 0.251), (14.0, 0.252), (15.0, 0.250),
          (16.0, 0.246), (18.0, 0.238), (20.0, 0.222), (22.0, 0.200), (24.0, 0.172), (26.0, 0.135), (27.0, 0.110), (28.0, 0.080)],
    expo=[(0.0, 2.1), (2, 2.2), (6, 2.35), (12, 2.5), (20, 2.5), (28, 2.4)],
    grooves=[],
    slope=0.9, t_min=0.010, centre=(0.0, 0.02, 14.5), nlon=84, nrows=40, top=0.0, lip=0.6,
)
# sculpted locks (male_extras.env_hair): rounded locks lying on the measured envelope, keys (u, pct, radius); u 0 front,
# 0.25 his right, 0.5 back, 0.75 his left. Channels between them are carved grooves.
ROLLS = [
    # the quiff: its thick rolled front edge over the forehead, turning up into the crest over his left temple
    dict(keys=[(0.215, 11.2, 0.012), (0.19, 10.4, 0.022), (0.12, 8.6, 0.026), (0.03, 7.4, 0.027), (0.95, 6.6, 0.027), (0.89, 5.8, 0.025),
               (0.855, 4.5, 0.026), (0.865, 1.8, 0.026), (0.89, 0.6, 0.012)], sink=0.45, k=0.010),
    dict(keys=[(0.28, 7.5, 0.010), (0.25, 7.0, 0.020), (0.16, 5.6, 0.024), (0.05, 4.2, 0.025), (0.96, 3.0, 0.024), (0.91, 1.6, 0.018), (0.90, 0.8, 0.008)], sink=0.60, k=0.010),
    dict(keys=[(0.33, 4.5, 0.010), (0.29, 4.0, 0.020), (0.19, 2.6, 0.022), (0.08, 1.3, 0.020), (0.99, 0.6, 0.010)], sink=0.60, k=0.010),
    # his right side: broad flat locks sweeping back and down to the nape (big radius, mostly sunk: planes, not tubes)
    dict(keys=[(0.19, 12.5, 0.015), (0.22, 13.2, 0.040), (0.29, 15.5, 0.045), (0.35, 19.0, 0.045), (0.40, 23.0, 0.035), (0.43, 25.5, 0.012)], sink=0.85, k=0.012),
    dict(keys=[(0.22, 8.8, 0.015), (0.26, 9.3, 0.042), (0.33, 11.5, 0.048), (0.39, 15.5, 0.048), (0.44, 20.5, 0.040), (0.47, 24.0, 0.012)], sink=0.85, k=0.012),
    dict(keys=[(0.30, 5.2, 0.015), (0.34, 6.0, 0.042), (0.40, 8.8, 0.048), (0.45, 13.0, 0.048), (0.49, 18.5, 0.040), (0.50, 22.0, 0.012)], sink=0.85, k=0.012),
    # his left side: back from the crest
    dict(keys=[(0.855, 7.5, 0.015), (0.82, 8.5, 0.040), (0.75, 11.0, 0.045), (0.68, 14.5, 0.045), (0.62, 19.0, 0.035), (0.58, 23.0, 0.012)], sink=0.85, k=0.012),
    dict(keys=[(0.86, 3.2, 0.015), (0.81, 4.0, 0.042), (0.73, 6.3, 0.048), (0.66, 10.0, 0.048), (0.59, 15.0, 0.040), (0.55, 20.0, 0.012)], sink=0.85, k=0.012),
    dict(keys=[(0.93, 0.8, 0.015), (0.80, 1.5, 0.040), (0.70, 3.0, 0.045), (0.61, 6.5, 0.045), (0.55, 11.0, 0.035), (0.52, 16.0, 0.012)], sink=0.85, k=0.012),
]
GROOVES = [
    dict(keys=[(0.26, 8.8, 0.008), (0.17, 7.9, 0.008), (0.06, 6.7, 0.008), (0.97, 5.5, 0.008), (0.91, 4.0, 0.008), (0.88, 2.5, 0.008)], k=0.004),
    dict(keys=[(0.31, 5.8, 0.008), (0.21, 4.2, 0.008), (0.10, 2.9, 0.008), (0.01, 1.9, 0.008), (0.94, 1.2, 0.008)], k=0.004),
    dict(keys=[(0.24, 11.2, 0.008), (0.30, 12.8, 0.008), (0.36, 15.5, 0.008), (0.42, 20.0, 0.008), (0.45, 23.5, 0.008)], k=0.004),
    dict(keys=[(0.29, 7.2, 0.008), (0.36, 9.0, 0.008), (0.42, 12.5, 0.008), (0.47, 17.5, 0.008), (0.49, 21.5, 0.008)], k=0.004),
    dict(keys=[(0.83, 6.0, 0.008), (0.77, 7.6, 0.008), (0.70, 10.5, 0.008), (0.63, 14.5, 0.008), (0.58, 19.0, 0.008)], k=0.004),
    dict(keys=[(0.85, 2.2, 0.008), (0.76, 3.0, 0.008), (0.66, 5.0, 0.008), (0.58, 9.0, 0.008), (0.54, 14.0, 0.008)], k=0.004),
]
def _a(u): return abs(((u + 0.5) % 1.0) - 0.5)
def _keys(a, keys):
    for (a0, z0), (a1, z1) in zip(keys, keys[1:]):
        if a <= a1: return z0 + (z1 - z0) * sm((a - a0) / (a1 - a0))
    return keys[-1][1]
def hairline(u):
    """Lower edge of the hair (pct) by longitude u (0 front, 0.25 his right, 0.5 back, 0.75 his left): the quiff's
    underside over the forehead (higher on his left where the part is), the temple corner, a short sideburn in front
    of the ear, over the ear, then down behind it to the nape."""
    u %= 1.0; a = _a(u)
    if u < 0.5:
        return _keys(a, [(0.0, 7.0), (0.05, 7.8), (0.10, 8.8), (0.16, 10.5), (0.185, 11.5), (0.20, 19.0), (0.222, 20.0), (0.238, 19.5), (0.30, 19.5),
                         (0.34, 22.5), (0.41, 26.0), (0.5, 27.4)])
    return _keys(a, [(0.0, 7.0), (0.05, 6.4), (0.10, 6.2), (0.13, 7.0), (0.165, 10.5), (0.19, 13.0), (0.205, 17.0), (0.225, 17.8), (0.238, 17.0), (0.30, 17.0),
                     (0.34, 21.5), (0.41, 26.0), (0.5, 27.4)])
def thin_below(u):
    """The sideburns stay flat up to the temple; the full side hair starts above 12 %."""
    a = _a(u); w = sm((a - 0.180) / 0.012) * sm((0.228 - a) / 0.010)
    return hairline(u) * (1 - w) + 13.0 * w
def edge(u):
    a = _a(u); right = (u % 1.0) < 0.5
    over_ear = 0.040 * sm((a - 0.232) / 0.012) * sm((0.33 - a) / 0.03) if right else 0.0     # his right: the side mass sits over the ear top
    return 0.008 + 0.022 * sm((0.17 - a) / 0.05) + 0.006 * sm((a - 0.26) / 0.03) + over_ear   # a thick rounded quiff edge, thin sideburns

# ---- glasses (male_extras.glasses)
GL = dict(x=0.083, z=19.8, r=0.063, rz=0.065, wire=0.0050, gap=0.012, wrap=0.10, tilt=0.06, bridge_z=19.0, bridge_rise=0.004,
          temple_z=18.8, ear=(0.175, 0.020, 19.0), drop=0.022, seg=32, n=6)

# ---- body (Marcus's measured suit body, the lapels made a shawl)
J = dict(
    profiles=[(66.5, 0.452, 0.345, 0.70, 0.000), (64.0, 0.452, 0.356, 0.70, -0.003), (60.0, 0.448, 0.364, 0.70, -0.005),
              (55.0, 0.446, 0.366, 0.70, -0.006), (50.0, 0.448, 0.360, 0.70, -0.005), (45.0, 0.456, 0.346, 0.72, -0.002),
              (41.0, 0.474, 0.318, 0.76, 0.004), (38.5, 0.492, 0.284, 0.76, 0.010), (36.8, 0.506, 0.248, 0.74, 0.014),
              (35.3, 0.470, 0.218, 0.80, 0.018), (34.0, 0.300, 0.200, 0.96, 0.024), (33.0, 0.200, 0.180, 1.0, 0.028)],
    waist=55.0, hem_hips=0.5, nj=52, ring_dz=0.020, open_apex=59.5, open_hem=0.030, corner=0.050,
    lapel=dict(outline=[(0.004, 55.2), (0.034, 54.0), (0.066, 52.0), (0.103, 48.0), (0.128, 44.0), (0.148, 40.0), (0.160, 37.0), (0.164, 35.4),
                        (0.155, 34.4), (0.130, 34.1), (0.106, 34.6), (0.092, 35.8), (0.082, 37.5), (0.070, 40.5), (0.057, 44.0), (0.040, 48.0), (0.020, 52.0), (0.010, 53.8)],
               wrap=dict(top=30.0, front=32.8, open=0.95, v_width=1.2, tip=(0.135, 35.2), th_side=1.55, gap=0.020, gap_neck=0.022, thick=0.008),
               thick=0.012, lift=0.002, max_edge=0.075, edge_shade=list(range(0, 9)), shade_w=0.005, collar_top=31.4, collar_front=34.4, collar_open=0.80, collar_gap=0.020, collar_dy=0.0),
    flaps=[(0.130, 0.215, 56.4, 58.8)], welt=(0.135, 0.195, 44.6, 0.008, 0.006), flap_thick=0.008,
    buttons=[(0.006, 56.6)], button_r=0.0150, vent=57.0,
)
SH = dict(max_edge=0.065, v=[(-0.122, 33.1), (0.122, 33.1), (0.098, 38.0), (0.070, 44.0), (0.035, 50.0), (0.006, 55.0), (-0.006, 55.0), (-0.035, 50.0), (-0.070, 44.0), (-0.098, 38.0)],
          collar_top=29.8, collar_v=31.2, v_width=0.60, v_open=0.30,
          wrap=dict(top=29.8, v=32.8, open=0.10, v_width=0.85, tip=(0.070, 34.5), th_side=1.0, below=0.012, gap=0.008, gap_neck=0.010, thick=0.005))
BOW = dict(z=35.6, w=0.084, h=0.094, h_mid=0.044, knot=(0.034, 0.040, 0.030), d=0.020, y=0.012, curve=0.018, pinch=0.25, mat='tie')
STUDS = dict(pts=[(0.0, 40.2), (0.0, 46.2)], r=0.0085, mat='button', out=0.009)
SQUARE = dict(x0=0.140, x1=0.190, p=44.4, h=0.022, slant=0.006, mat='shirt')
A = dict(
    shoulder=(0.222, 37.8), shoulder_y=0.0, elbow=(0.285, 0.0, 52.0), wrist=(0.315, 0.0, 63.2),
    sleeve_end=61.0, cuff_end=63.2, sleeve='jacket', n=20,
    stations=[('end', 0.134, 0.130), (58.0, 0.136, 0.134), (53.0, 0.140, 0.140), (47.0, 0.148, 0.150), (42.0, 0.152, 0.154),
              (('j', -0.01), 0.154, 0.158), (('j', 0.018), 0.132, 0.142), (('j', 0.034), 0.070, 0.080)],
    cuff_wd=(0.120, 0.116), cufflink=True, sleeve_buttons=1, button_angle=60.0,
    hand=dict(finger_n=6, palm_len=0.106, palm_w=0.124, palm_t=0.074, out=0.014, finger_out=0.015,
              fingers=[(-0.043, 0.0205, 0.100, 1.75), (-0.015, 0.0212, 0.106, 1.85), (0.014, 0.0205, 0.102, 1.85), (0.042, 0.0185, 0.090, 1.75)],
              thumb=(-0.056, 0.016, 0.026, 0.0225, 0.074, 0.55)),
)
P = dict(leg_x=0.106, leg_x_hem=0.118, leg_y=0.015, thigh_w=0.180, thigh_d=0.225, shin_w=0.138, shin_d=0.190, hip=72.5, knee=84.5, crotch=70.5,
         top=58.0, hem=93.0, break_dip=0.012, nl=20,
         leg_profile=[(93.0, 0.142, 0.196), (91.0, 0.138, 0.190), (88.0, 0.142, 0.192), (84.5, 0.152, 0.198), (80.0, 0.163, 0.208), (76.0, 0.173, 0.220), (73.0, 0.178, 0.226)],
         pelvis=[(69.0, 0.95, 0.01, 0.85), (66.5, 1.0, 0.03, 0.78), (63.0, 1.0, 0.05, 0.75), (60.0, 0.97, 0.06, 0.75), (58.0, 0.93, 0.05, 0.8)])
S = dict(n=20, leg_x=0.121, len=0.305, w=0.150, h=0.098, heel=0.070, splay=0.28, out=0.002, y=0.022, laces=3)
RIG = dict(hip=72.5, knee=84.5, ankle=95.8, waist=55.0, shoulder_top=35.3, neck_y=0.020, hand_end=72.6, leg_x=0.112,
           heel=0.070, ball=0.16, arm=A)

def _bake_soft(g, *a, **k):
    """guest_kit.bake, then dress_kit.lift_ao with CFG['ao_scale'] (keeps his fair face light under the collar and
    hair; installed for this build only, see build())."""
    _BAKE(g, *a, **k); DK.lift_ao(g, g.C.get('ao_scale', {}))
    # the round lower face: bend its shading normals toward the front (the sheet's face is evenly lit to the chin)
    zt, zb, yf = g.zp(21.0), g.zc, g.Y0 - 0.06
    def w(co):                                        # the nose ball (in front of the face surface) keeps its own shading
        fy = g.face_y(co.x, co.z); off = 0.0 if fy is None else fy - co.y
        return sm((zt - co.z) / 0.05) * sm((co.z - zb) / 0.01) * sm((yf - co.y) / 0.05) * (1.0 - sm((off - 0.004) / 0.008))
    MX.bend_normals(g, 'Skin', w, (0.0, -0.85, 0.52), 0.75)
_BAKE = GK.bake

def build(g):
    GK.bake = _bake_soft                                  # finish() looks bake up on the module: soften the AO for Henry
    g.set_head(W, DF, DB, E, BULGES)
    MX.env_hair(g, dict(env=HAIR, top=0.4, top_k=0.025, hairline=hairline, edge=edge, thin_below=thin_below, slope=0.9, t_min=0.008, inset=0.010, edge_k=0.010,
                        rolls=ROLLS, grooves=GROOVES, voxel=0.005, tris=8000, smooth=3, bottom=29.5))
    GK.head(g, nlon=52, nlat=36, cull_in=g.hair_covers)
    GK.ears(g); GK.eyes(g); GK.brows(g); GK.nose(g); GK.mouth(g)
    MX.glasses(g, GL)
    GK.neck(g)
    GK.jacket(g, J); GK.lapels(g, J); GK.pockets(g, J)
    GK.slab(g, 'Seam', [(-0.0015, g.z_hem + 0.004), (0.0015, g.z_hem + 0.004), (0.0015, g.jacket_top - 0.035), (-0.0015, g.jacket_top - 0.035)],
            g.back_y, 0.0, 0.0010, 'shade', g.jw, sign=1, cuts=0)        # the back: one centre seam to the hem, no vent
    for i, (x, p) in enumerate(J['buttons']):            # the front button is self-coloured (ivory horn), not black
        z = g.zp(p); b = L.uvsphere(f'Button{i}', J['button_r'], (x, g.chest_y(x, z) - 0.004, z), scale=(1, 0.5, 1), u=12, v=8); g.add_w(b, 'horn', g.jw)
    GK.shirt_front(g, SH); GK.collar(g, SH); MX.bow_tie(g, BOW); MX.studs(g, STUDS); MX.pocket_square(g, SQUARE)
    GK.arms(g, A); GK.cuffs(g, A); GK.hands(g, A)
    GK.trousers(g, P); GK.shoes(g, S)
