# Henry — older gentleman: ivory shawl-collar dinner jacket (one ivory button, flap pockets, white pocket square), white
# dress shirt with two black studs, black bow tie, black trousers, black glossy shoes; silver-grey hair swept up and
# back (a full quiff, sculpted locks), round thin dark-brown wire glasses, fair peachy skin with rosy cheeks.
# Reference: tools/char-pipeline/ref/henry-sheet.png (panels in ref/panels-henry/). Built by
#   python3 tools/char-pipeline/make_guest.py henry   -> assets/characters/henry.glb
# Uses guest_kit (face, hair_shell with sculpted lock planes, suit body, finish), male_extras (glasses, bow tie, studs,
# pocket square, Taubin smoothing of the hair, radial groove shading, the lower-face normal bend) and dress_kit.lift_ao.
#
# Measurements (sheet FRONT panel: figure 567 px = H = 1.66 m, 2.93 mm/px; SIDE 567 px; HEAD close-ups ~2.5 mm/px but
# drawn ~8 % larger and turned ~9 deg to his left, so the body panels win where they disagree). Percent of H from the top:
#   head   hair top 0 (the crest over his left temple), forehead hairline 6.4 at the centre (5.8 on his left, 9-12 on his
#          right under the quiff), brows 12-14.5 (thick, grey, outer ends lower), eyes 17.5-20 (centre 18.7, x +-0.064,
#          0.040 x 0.058), nose ball 20.5-23.8 (0.08 wide), smile 24.5-25.5 (0.13 wide), chin 30.3, ears 18.5-26 (round,
#          out to +-0.24). Face half-width 0.165 at the cheeks, 0.142 at 26 %, 0.123 at 28 %; side: forehead 0.19 ahead
#          of the head axis (0.03 behind the body centre), nose tip 0.265, the lower face full (0.23 at 24-27 %).
#   hair   half-widths 0.265 (his right: the side sweep, 12-14 %) / 0.195 (his left, 9-10 %); side: quiff front 0.19 at
#          1-3 %, back 0.252 at 14 %, nape 27.5 %; the his-right mass sits over the ear top (to 21 %).
#   glasses rims centred +-0.083 on the eyes, radius 0.063 (to the wire), wire 0.010 thick, bridge at 19 %, temples to
#          the ear tops. Body: Marcus's measured suit (the silhouettes agree within 1-2 %): shawl lapel from the collar
#          to the V at 55 %, button 56.6 % (ivory), flaps 56.4-58.8 at x 0.13-0.215, pocket square 42-44.5 % (his left),
#          studs 40 / 46 %, bow tie 32.6-37.8 % x +-0.084, cuffs 61-63 %, hands to 72.6 %, trouser hem 93 %.
import math
import guest_kit as GK
import dress_kit as DK
import male_extras as MX
import victor_lib as L

H = 1.66
def zp(p): return H * (1 - p / 100)
sm = GK.sm

CFG = dict(
    z_hair_top=0.0, z_skull_top=4.5, z_hairline=8.0, z_brow=13.5, z_eye=19.8, z_nose=23.1, z_mouth=26.3, z_chin=31.4, z_ear=22.2,
    head_y=0.03, z_shoulder_top=35.3,
    ear_style='round', ear_seg=(22, 16), ear_h=0.138, ear_w=0.112, ear_out=0.020, ear_y=0.026, ear_tilt=0.70, ear_thick=0.036, ear_rim=0.012, ear_bowl=0.020, ear_sink=0.022,
    eye_x=0.064, eye_w=0.040, eye_h=0.058, eye_lift=0.005,
    brow=dict(x0=0.038, x1=0.128, z=13.4, thick=0.036, arch=0.010, drop_in=0.000, drop_out=0.022,
              profile=[(0.0, 0.40), (0.05, 0.85), (0.14, 0.97), (0.45, 1.0), (0.85, 0.92), (0.95, 0.75), (1.0, 0.35)], flat=0.5),
    nose_w=0.082, nose_h=0.080, nose_d=0.066, nose_out=0.038, nose_top=1.15,
    mouth=dict(w=0.132, z=26.3, rise=0.020, sag=0.004, thick=0.008),
    neck_r=0.094, neck_y=0.020,
    tint=dict(spots=[(0.100, 24.0, 0.050, 0.035, 1.0), (0.0, 22.9, 0.028, 0.024, 0.7)], g=0.20, b=0.20),
    groove_dark=(0.007, 0.55), smooth_angle=80.0,
    sheen={'Shoe': (0.34, [((0.2, -0.45, 0.87), 14.0, 1.0), ((0.0, -1.0, 0.3), 16.0, 0.8), ((0.9, 0.0, 0.45), 16.0, 0.5), ((-0.9, 0.0, 0.45), 16.0, 0.5)]),
           'Hair': (0.74, (-0.2, -0.40, 0.89), 2.0)},
    ao_skip=('Brow', 'Eye', 'Mouth', 'Glasses'), ao_scale={'Skin': 0.45, 'Jacket': 0.65},
)
COLOURS = dict(
    # Black cloth / leather use the lobby-measured in-game palette (guest_kit.PALETTE): under the hotel's warm light they
    # read black like Victor's and Marcus's (cool charcoal in the neutral preview: expected). The ivory jacket and the
    # silver hair are compromises that read ivory / grey (not yellow / white) in both lights.
    skin='#ffb08a', hair='#a4a1aa', brow='#8e868a', mouth='#4a2418', eye='#0b0b0d', glasses='#3a2218',
    jacket='#fbe7d3', trouser='#34363e', button='#16161a', shade='#cdb9a4', horn='#dccab4',
    shirt='#fbf6f0', tie='#34363e',
    shoe=GK.PALETTE['shoe_black'], sole='#1a1818',
)

# ---- skull tables by f (0 chin .. 1 skull top): a round soft face, full low cheeks/jowls
W  = [(0, 0.0), (0.02, 0.066), (0.05, 0.100), (0.08, 0.122), (0.13, 0.146), (0.20, 0.164), (0.28, 0.174), (0.35, 0.176),
      (0.43, 0.174), (0.50, 0.171), (0.61, 0.165), (0.72, 0.158), (0.83, 0.146), (0.90, 0.128), (0.96, 0.092), (0.99, 0.050), (1, 0.0)]
DF = [(0, 0.0), (0.02, 0.095), (0.037, 0.135), (0.074, 0.180), (0.13, 0.204), (0.20, 0.214), (0.28, 0.216), (0.35, 0.215), (0.43, 0.213),
      (0.50, 0.211), (0.57, 0.209), (0.65, 0.207), (0.72, 0.204), (0.80, 0.196), (0.87, 0.184), (0.94, 0.158), (0.98, 0.110), (1, 0.0)]
DB = [(0, 0.0), (0.02, 0.030), (0.06, 0.052), (0.12, 0.075), (0.20, 0.102), (0.30, 0.130), (0.42, 0.158), (0.55, 0.176),
      (0.68, 0.181), (0.78, 0.174), (0.87, 0.155), (0.93, 0.125), (0.98, 0.070), (1, 0.0)]
E  = [(0, 2.0), (0.08, 2.15), (0.25, 2.5), (0.45, 2.55), (0.65, 2.5), (0.85, 2.35), (1, 2.2)]
BULGES = [dict(x=0.110, z=25.6, sx=0.062, sz=0.042, a=0.050),      # full rosy cheeks beside the smile
          dict(x=0.0, z=21.2, sx=0.016, sz=0.024, a=0.026),        # nose bridge rising into the ball
          dict(x=0.0, z=29.0, sx=0.050, sz=0.020, a=0.006)]        # soft chin

# ---- hair (guest_kit.hair_shell + lock_fields, smoothed by male_extras.taubin): the envelope measured on the FRONT (widths: wr his right, wl his left) and SIDE
# (front / back) panels, metres from the head axis by pct height, + expo (slice roundness)
HAIR = dict(
    wr=[(0.0, -0.010), (0.5, 0.010), (1.0, 0.035), (1.5, 0.060), (2.0, 0.085), (3.0, 0.130), (4.0, 0.168), (5.0, 0.197), (6.0, 0.215),
        (7.0, 0.227), (8.0, 0.238), (9.0, 0.245), (10.0, 0.252), (11.0, 0.259), (12.0, 0.264), (13.0, 0.265), (14.0, 0.262), (15.0, 0.255),
        (16.0, 0.245), (17.0, 0.232), (18.0, 0.218), (19.5, 0.198), (21.0, 0.184), (22.0, 0.172), (23.0, 0.160), (24.5, 0.140), (26.0, 0.110)],
    wl=[(0.0, 0.070), (0.5, 0.080), (1.0, 0.090), (1.5, 0.101), (2.0, 0.106), (3.0, 0.118), (4.0, 0.135), (5.0, 0.155), (6.0, 0.174),
        (7.0, 0.183), (8.0, 0.191), (9.0, 0.195), (10.0, 0.196), (12.0, 0.193), (13.0, 0.188), (14.0, 0.184), (15.0, 0.180), (16.0, 0.176),
        (17.0, 0.172), (19.0, 0.180), (21.0, 0.176), (22.0, 0.170), (23.0, 0.160), (24.5, 0.140), (26.0, 0.110)],
    front=[(0.0, 0.160), (0.5, 0.180), (1.0, 0.190), (2.0, 0.193), (3.0, 0.190), (4.0, 0.184), (5.0, 0.179), (6.0, 0.179), (8.0, 0.188),
           (10.0, 0.200), (14.0, 0.205), (20.0, 0.19), (27.5, 0.08)],
    back=[(0.0, -0.040), (0.5, -0.015), (1.0, 0.012), (1.5, 0.035), (2.0, 0.056), (3.0, 0.094), (4.0, 0.125), (5.0, 0.142), (6.0, 0.157),
          (7.0, 0.169), (8.0, 0.181), (9.0, 0.196), (10.0, 0.210), (11.0, 0.222), (12.0, 0.231), (13.0, 0.236), (14.0, 0.238), (15.0, 0.237),
          (16.0, 0.230), (18.0, 0.212), (20.0, 0.186), (22.0, 0.160), (24.0, 0.136), (26.0, 0.110)],
    expo=[(0.0, 2.1), (2, 2.2), (6, 2.35), (12, 2.5), (20, 2.5), (28, 2.4)],
    # sculpted lock PLANES (guest_kit lock_fields), like Marcus's: the part is on his LEFT (u ~0.85); the hair sweeps from
    # it up into the crest over his left temple and over the top / forehead down to his right side and back. Later
    # (front) locks stand higher, so each steps down onto the one behind it with its own rounded edge.
    lock_fields=[dict(keys=[(0.57, 2.5), (0.54, 8.0), (0.515, 14.0), (0.50, 19.0), (0.50, 22.5)], half=0.055, height=0.012, soft=0.020),      # back, his left half
                 dict(keys=[(0.43, 2.5), (0.46, 8.0), (0.485, 14.0), (0.50, 19.0), (0.50, 22.5)], half=0.055, height=0.020, soft=0.020),      # back, his right half (overlaps)
                 dict(keys=[(0.44, 2.0), (0.39, 6.5), (0.35, 12.0), (0.33, 16.0), (0.32, 19.5)], half=0.050, height=0.022, soft=0.016),       # his right side
                 dict(keys=[(0.70, 3.5), (0.67, 8.5), (0.63, 14.0), (0.61, 17.0), (0.60, 20.0)], half=0.050, height=0.022, soft=0.016),       # his left side
                 dict(keys=[(0.25, 8.0), (0.14, 4.6), (0.04, 2.6), (0.94, 1.6), (0.84, 1.4), (0.75, 2.8), (0.68, 5.5)], half=0.048, height=0.036, soft=0.014),  # top band
                 dict(keys=[(0.215, 11.0), (0.13, 8.2), (0.04, 6.2), (0.95, 4.4), (0.88, 2.6), (0.83, 1.0)], half=0.034, height=0.052, soft=0.013)],   # the quiff edge
    lock_base=0.030,
    grooves=[dict(keys=[(0.20, 8.4), (0.13, 6.4), (0.04, 4.6), (0.95, 3.6), (0.90, 3.0)], depth=0.008, width=0.013, n=40),     # quiff / top band
             dict(keys=[(0.33, 6.5), (0.27, 4.8), (0.21, 3.6)], depth=0.008, width=0.013, n=30),                                   # top band / his right side
             dict(keys=[(0.78, 3.5), (0.70, 5.5), (0.64, 9.5), (0.60, 14.5)], depth=0.008, width=0.013, n=30),                     # top band / his left side
             dict(keys=[(0.28, 9.5), (0.34, 12.5), (0.39, 16.5)], depth=0.007, width=0.013, n=30),
             dict(keys=[(0.23, 12.5), (0.29, 14.2), (0.35, 17.0), (0.40, 20.5)], depth=0.007, width=0.013, n=30),
             dict(keys=[(0.74, 9.0), (0.68, 12.0), (0.63, 16.0), (0.59, 20.0)], depth=0.007, width=0.013, n=30),                                  # lock line, his right side
             dict(keys=[(0.47, 5.0), (0.49, 12.0), (0.50, 19.0)], depth=0.005, width=0.018, n=30)],                                # one soft line where the two back planes meet
    slope=1.6, t_min=0.010, centre=(0.0, 0.02, 14.5), nlon=88, nrows=42, top=0.2, lip=0.6,
)
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
        return _keys(a, [(0.0, 7.1), (0.05, 8.1), (0.10, 9.3), (0.16, 11.2), (0.19, 13.8), (0.212, 18.6), (0.225, 19.2), (0.238, 17.4), (0.30, 17.4),
                         (0.35, 19.2), (0.43, 21.8), (0.5, 24.0)])
    return _keys(a, [(0.0, 7.1), (0.05, 6.6), (0.10, 6.4), (0.13, 7.0), (0.165, 10.5), (0.19, 13.0), (0.205, 17.0), (0.225, 17.8), (0.238, 17.0), (0.30, 17.0),
                     (0.35, 19.2), (0.43, 21.8), (0.5, 24.0)])
def thin_below(u):
    """The sideburns stay flat up to the temple; the full side hair starts above 12 %."""
    a = _a(u); w = sm((a - 0.170) / 0.030) * sm((0.240 - a) / 0.025)
    return hairline(u) * (1 - w) + 13.0 * w
def edge(u):
    """Hair thickness allowed at the hairline (it grows by `slope` per metre above thin_below)."""
    a = _a(u); right = (u % 1.0) < 0.5
    over_ear = 0.0 * sm((a - 0.232) / 0.012) * sm((0.33 - a) / 0.03) if right else 0.0     # his right: the side mass sits over the ear top
    return 0.008 + 0.022 * sm((0.17 - a) / 0.05) + 0.002 * sm((a - 0.26) / 0.03) + over_ear   # a thick rounded quiff edge, thin sideburns

# ---- glasses (male_extras.glasses)
GL = dict(x=0.083, z=19.8, r=0.063, rz=0.065, wire=0.0050, gap=0.012, wrap=0.10, tilt=0.06, bridge_z=19.0, bridge_rise=0.004,
          temple_z=18.8, ear=(0.175, 0.020, 19.0), drop=0.022, seg=28, n=6)

# ---- body (Marcus's measured suit body, the lapels made a shawl)
J = dict(
    profiles=[(66.5, 0.452, 0.345, 0.70, 0.000), (64.0, 0.452, 0.356, 0.70, -0.003), (60.0, 0.448, 0.364, 0.70, -0.005),
              (55.0, 0.446, 0.366, 0.70, -0.006), (50.0, 0.448, 0.360, 0.70, -0.005), (45.0, 0.456, 0.346, 0.72, -0.002),
              (41.0, 0.474, 0.318, 0.76, 0.004), (38.5, 0.492, 0.284, 0.76, 0.010), (36.8, 0.506, 0.248, 0.74, 0.014),
              (35.3, 0.476, 0.220, 0.80, 0.018), (34.2, 0.400, 0.210, 0.88, 0.022), (33.1, 0.290, 0.196, 0.96, 0.026), (32.3, 0.205, 0.182, 1.0, 0.028)],   # sloped shoulders
    waist=55.0, hem_hips=0.5, nj=44, ring_dz=0.020, open_apex=59.5, open_hem=0.030, corner=0.050,
    lapel=dict(outline=[(0.004, 55.2), (0.034, 54.0), (0.066, 52.0), (0.103, 48.0), (0.128, 44.0), (0.148, 40.0), (0.160, 37.0), (0.164, 35.4),
                        (0.155, 34.4), (0.130, 34.1), (0.106, 34.6), (0.092, 35.8), (0.082, 37.5), (0.070, 40.5), (0.057, 44.0), (0.040, 48.0), (0.020, 52.0), (0.010, 53.8)],
               wrap=dict(top=31.2, front=32.8, open=0.95, v_width=1.2, tip=(0.135, 35.2), th_side=1.55, gap=0.024, gap_neck=0.024, thick=0.008, tuck=0.030),
               thick=0.012, lift=0.002, max_edge=0.09, edge_shade=list(range(0, 9)), shade_w=0.005, collar_top=31.4, collar_front=34.4, collar_open=0.80, collar_gap=0.020, collar_dy=0.0),
    flaps=[(0.130, 0.215, 56.4, 58.8)], welt=(0.135, 0.195, 44.6, 0.008, 0.006), flap_thick=0.008,
    buttons=[(0.006, 56.6)], button_r=0.0150, vent=57.0,
)
SH = dict(max_edge=0.08, v=[(-0.122, 33.1), (0.122, 33.1), (0.098, 38.0), (0.070, 44.0), (0.035, 50.0), (0.006, 55.0), (-0.006, 55.0), (-0.035, 50.0), (-0.070, 44.0), (-0.098, 38.0)],
          collar_top=29.8, collar_v=31.2, v_width=0.60, v_open=0.30,
          wrap=dict(top=30.6, v=32.8, open=0.10, v_width=0.85, tip=(0.070, 34.5), th_side=1.0, below=0.012, gap=0.008, gap_neck=0.010, thick=0.005))
COLLAR_FALL = [(-0.175, 36.0), (-0.12, 34.9), (-0.06, 34.4), (0.0, 34.3), (0.06, 34.4), (0.12, 34.9), (0.175, 36.0),
               (0.150, 33.8), (0.080, 33.3), (0.0, 33.2), (-0.080, 33.3), (-0.150, 33.8)]
BOW = dict(z=35.6, w=0.084, h=0.094, h_mid=0.044, knot=(0.034, 0.040, 0.030), d=0.020, y=0.012, curve=0.018, pinch=0.25, mat='tie')
STUDS = dict(pts=[(0.0, 40.2), (0.0, 46.2)], r=0.0085, mat='button', out=0.009)
SQUARE = dict(x0=0.140, x1=0.190, p=44.4, h=0.022, slant=0.006, mat='shirt')
A = dict(
    shoulder=(0.222, 37.8), shoulder_y=0.0, elbow=(0.285, 0.0, 52.0), wrist=(0.315, 0.0, 63.2),
    sleeve_end=62.0, cuff_end=63.6, sleeve='jacket', n=20,
    stations=[('end', 0.134, 0.130), (58.0, 0.136, 0.134), (53.0, 0.140, 0.140), (47.0, 0.148, 0.150), (42.0, 0.152, 0.154),
              (('j', -0.01), 0.154, 0.158), (('j', 0.018), 0.132, 0.142), (('j', 0.034), 0.070, 0.080)],
    cuff_wd=(0.120, 0.116), cufflink=True, sleeve_buttons=1, button_angle=60.0,
    hand=dict(finger_n=7, palm_len=0.108, palm_w=0.128, palm_t=0.078, out=0.014, finger_out=0.015,      # Marcus's chunky curled hands, a touch fuller
              fingers=[(-0.044, 0.0225, 0.100, 1.20), (-0.015, 0.0232, 0.106, 1.30), (0.014, 0.0225, 0.102, 1.35), (0.043, 0.0205, 0.090, 1.35)],   # relaxed, only softly curled
              thumb=(-0.057, 0.017, 0.026, 0.0235, 0.074, 0.55)),
)
P = dict(leg_x=0.106, leg_x_hem=0.118, leg_y=0.015, thigh_w=0.180, thigh_d=0.225, shin_w=0.138, shin_d=0.190, hip=72.5, knee=84.5, crotch=70.5,
         top=58.0, hem=93.0, break_dip=0.012, nl=16,
         leg_profile=[(93.0, 0.142, 0.196), (91.0, 0.138, 0.190), (88.0, 0.142, 0.192), (84.5, 0.152, 0.198), (80.0, 0.163, 0.208), (76.0, 0.173, 0.220), (73.0, 0.178, 0.226)],
         pelvis=[(69.0, 0.95, 0.01, 0.85), (66.5, 1.0, 0.03, 0.78), (63.0, 1.0, 0.05, 0.75), (60.0, 0.97, 0.06, 0.75), (58.0, 0.93, 0.05, 0.8)])
S = dict(n=16, leg_x=0.121, len=0.305, w=0.150, h=0.098, heel=0.070, splay=0.28, out=0.002, y=0.022, laces=3)
RIG = dict(hip=72.5, knee=84.5, ankle=95.8, waist=55.0, shoulder_top=35.3, neck_y=0.020, hand_end=72.8, leg_x=0.112,
           heel=0.070, ball=0.16, arm=A)

def _bake_soft(g, *a, **k):
    """guest_kit.bake, then dress_kit.lift_ao with CFG['ao_scale'] (keeps his fair face light under the collar and
    hair; installed for this build only, see build())."""
    _BAKE(g, *a, **k); DK.lift_ao(g, g.C.get('ao_scale', {}))
    # the round lower face: bend its shading normals toward the front (the sheet's face is evenly lit to the chin)
    zt, zb, yf = g.zp(21.0), g.zc, g.Y0 - 0.01
    def w(co):                                        # the nose ball (in front of the face surface) keeps its own shading
        fy = g.face_y(co.x, co.z); off = 0.0 if fy is None else fy - co.y
        return sm((zt - co.z) / 0.05) * sm((co.z - zb + 0.02) / 0.03) * sm((yf - co.y) / 0.13) * (1.0 - sm((off - 0.004) / 0.008))
    MX.bend_normals(g, 'Skin', w, (0.0, -0.85, 0.52), 0.75)
_BAKE = GK.bake

def build(g):
    GK.bake = _bake_soft                                  # finish() looks bake up on the module: soften the AO for Henry
    g.set_head(W, DF, DB, E, BULGES)
    MX.taubin(GK.hair_shell(g, hairline=hairline, edge=edge, thin_below=thin_below, **HAIR), iters=6)   # iron out small bumps
    MX.radial_grooves(g, HAIR['grooves'])      # the bake darkens the lock lines even where raised locks cover them
    GK.head(g, nlon=44, nlat=32, cull_in=g.hair_covers)
    GK.ears(g); GK.eyes(g); GK.brows(g); GK.nose(g); GK.mouth(g)
    MX.glasses(g, GL)
    GK.neck(g)
    GK.jacket(g, J); GK.lapels(g, J); GK.pockets(g, J)
    GK.slab(g, 'Seam', [(-0.0015, g.z_hem + 0.004), (0.0015, g.z_hem + 0.004), (0.0015, g.jacket_top - 0.035), (-0.0015, g.jacket_top - 0.035)],
            g.back_y, 0.0, 0.0010, 'shade', g.jw, sign=1, cuts=0)        # the back: one centre seam to the hem, no vent
    # the shawl collar's fall across the upper back (the sheet's BACK: a folded collar lying on the shoulders)
    fall = [(x, g.zp(p)) for x, p in COLLAR_FALL]
    bsurf = lambda x, z: g.back_y(x, min(z, g.jacket_top - 0.004))
    GK.slab(g, 'CollarFall', fall, bsurf, 0.002, 0.007, 'jacket', lambda co: {'spine': 1.0}, sign=1, max_edge=0.03)
    lo = [q for q in fall if q[1] < g.zp(34.9)]; lo.sort()
    fall_edge = [(x, z - 0.0035) for x, z in lo] + [(x, z + 0.0015) for x, z in reversed(lo)]
    GK.slab(g, 'CollarFallShade', fall_edge, bsurf, 0.0, 0.0012, 'shade', lambda co: {'spine': 1.0}, sign=1, cuts=0)
    for i, (x, p) in enumerate(J['buttons']):            # the front button is self-coloured (ivory horn), not black
        z = g.zp(p); b = L.uvsphere(f'Button{i}', J['button_r'], (x, g.chest_y(x, z) - 0.004, z), scale=(1, 0.5, 1), u=12, v=8); g.add_w(b, 'horn', g.jw)
    GK.shirt_front(g, SH); GK.collar(g, SH); MX.bow_tie(g, BOW); MX.studs(g, STUDS); MX.pocket_square(g, SQUARE)
    GK.arms(g, A); GK.cuffs(g, A); GK.hands(g, A)
    GK.trousers(g, P); GK.shoes(g, S)
