# Clara — burgundy fitted dress (round crew neckline, short sleeves, a wider darker-burgundy sash at the natural
# waist, a straight column skirt to the ankle with a centre-back seam), long wavy shoulder-length dark auburn hair
# (a big side-swept wave over the forehead, sculpted S-wave curls down to the shoulders), small gold ball earrings,
# red lips in a small closed smile, slim arched dark brows, black low-heeled pumps.
# Reference: tools/char-pipeline/ref/clara-sheet.png (panels in ref/panels-clara/). Built by
#   python3 tools/char-pipeline/make_dress_guest.py clara   -> assets/characters/clara.glb
# Uses guest_kit (face, arms/hands, finish), dress_kit (neck, bodice, sleeves, belt, column skirt, legs, pumps, lips)
# and female_extras (the long sculpted hair, ball earrings).
#
# Measurements (sheet FRONT panel: figure 566 px = H = 1.66 m, 2.93 mm/px; SIDE 568 px). Percent of H from the top:
#   head   hair top 0 (the crest over her left temple), forehead hairline ~9.5 at the centre (8 on her left, 11.5-12.5
#          on her right under the wave), brows 12.2-13.8, eyes 15.5-19 (centre 17.3, x +-0.066), nose ball 19.3-21.2,
#          lips 22.5-24 (0.094 wide), chin 28.3, ears 17.5-24.5 (out to +-0.19), gold ball earrings at 23 (x +-0.18).
#          Face half-width ~0.14 at 18-22 %, 0.10 at 26 %; side: face front 0.20 ahead of the head axis, nose tip 0.24;
#          the head axis 0.03 behind the body centre.
#   hair   half-widths (her right / left): 0.25/0.24 at 10-12 %, 0.28/0.27 at 24 %, 0.26/0.25 at 30 %, ends ~34 %;
#          side: crest 0.22 ahead of the axis at 1-4 %, back 0.24 at 10-16 %, 0.30 at 22-28 %.
#   body   neck 0.114 wide; crew neckline 32.3 (sides) .. 34 (front centre); shoulders +-0.225 at 35 % (sleeve caps);
#          short sleeves to 42 (outside) .. 44.5 (inside), 0.11 wide at the hem; bust 0.30 x 0.28 at 38-40 %; sash
#          45.8-49.8 (0.27 wide); hips 0.385 x 0.28 at 58-62 %; column skirt 0.35 x 0.28 at 80-92 %, hem 92.5 %.
#          Arms: elbow 52 % at x +-0.228, wrist 59 % at +-0.265 (0.04 forward), hands 59-68.5 %. Legs x +-0.09,
#          pumps ~0.27 long with a 0.045 block heel, toes turned out.
import math
from mathutils import Vector
import guest_kit as GK
import dress_kit as DK
import female_extras as FX
import victor_lib as L

H = 1.66
def zp(p): return H * (1 - p / 100)
sm = GK.sm

CFG = dict(
    z_hair_top=0.0, z_skull_top=3.5, z_hairline=9.5, z_brow=13.0, z_eye=17.3, z_nose=20.3, z_mouth=23.3, z_chin=30.0, z_ear=21.0,
    head_y=0.03, z_shoulder_top=32.3,
    ear_style='round', ear_h=0.105, ear_w=0.075, ear_out=0.018, ear_y=0.030, ear_tilt=0.55, ear_thick=0.026, ear_rim=0.007, ear_bowl=0.010, ear_sink=0.020,
    eye_x=0.066, eye_w=0.045, eye_h=0.070, eye_lift=0.003,
    brow=dict(x0=0.030, x1=0.112, z=12.9, thick=0.030, arch=0.014, drop_in=0.006, drop_out=0.018,
              profile=[(0.0, 0.55), (0.06, 0.95), (0.25, 1.0), (0.60, 0.88), (0.90, 0.55), (1.0, 0.25)], flat=0.5),
    nose_w=0.052, nose_h=0.042, nose_d=0.030, nose_out=0.010, nose_top=1.3,
    lips=dict(z=22.9, w=0.094, rise=0.010, upper=0.011, lower=0.015, bow=0.002, flat=0.45),
    tint=dict(spots=[(0.090, 21.5, 0.038, 0.032, 1.0), (0.0, 20.3, 0.020, 0.020, 0.4)], g=0.20, b=0.16),
    groove_dark=(0.010, 0.55),
    ao_skip=('Brow', 'Eye', 'Lips', 'Gold'), ao_scale={'Skin': 0.25, 'Dress': 0.85},
    sheen={'Shoe': (0.34, [((0.2, -0.45, 0.87), 14.0, 1.0), ((0.0, -1.0, 0.3), 16.0, 0.8), ((0.9, 0.0, 0.45), 16.0, 0.5), ((-0.9, 0.0, 0.45), 16.0, 0.5)]),
           'Hair': (0.58, [((-0.1, -0.45, 0.89), 2.0, 1.0), ((0.5, -0.6, 0.6), 4.0, 0.45)]),
           'Gold': (0.50, [((0.0, -1.0, 0.25), 6.0, 1.0), ((-0.6, -0.6, 0.3), 8.0, 0.6), ((0.6, -0.6, 0.3), 8.0, 0.6)])},
)
COLOURS = dict(
    skin='#ffb084', hair='#663f3b', brow='#3a221c', eye='#0b0b0d', lips='#962430',
    dress='#5e2836', sash='#48222c', gold='#c8904a', shoe=GK.PALETTE['shoe_black'],
)

# ---- skull tables by f (0 chin .. 1 skull top): a soft oval face, full cheeks, small round chin (Eleanor's, a touch longer)
W  = [(0, 0.0), (0.02, 0.050), (0.05, 0.068), (0.10, 0.090), (0.16, 0.108), (0.23, 0.124), (0.28, 0.134), (0.34, 0.140),
      (0.42, 0.139), (0.52, 0.134), (0.62, 0.127), (0.70, 0.119), (0.80, 0.104), (0.88, 0.083), (0.94, 0.057), (0.98, 0.031), (1, 0.0)]
DF = [(0, 0.0), (0.017, 0.130), (0.04, 0.165), (0.08, 0.183), (0.12, 0.190), (0.20, 0.198), (0.30, 0.203), (0.45, 0.205),
      (0.60, 0.202), (0.75, 0.196), (0.85, 0.182), (0.93, 0.150), (0.98, 0.070), (1, 0.0)]
DB = [(0, 0.0), (0.05, 0.030), (0.15, 0.062), (0.30, 0.112), (0.45, 0.155), (0.60, 0.165), (0.75, 0.160), (0.85, 0.140),
      (0.93, 0.110), (0.98, 0.060), (1, 0.0)]
E  = [(0, 1.9), (0.10, 2.0), (0.20, 2.2), (0.30, 2.4), (0.50, 2.45), (0.70, 2.4), (0.90, 2.2), (1, 2.1)]
BULGES = [dict(x=0.092, z=22.0, sx=0.048, sz=0.040, a=0.026),      # full rosy cheeks
          dict(x=0.0, z=18.6, sx=0.015, sz=0.022, a=0.010),        # soft nose bridge
          dict(x=0.0, z=28.6, sx=0.045, sz=0.018, a=0.006)]        # small round chin

# ---- hair (female_extras.long_hair): envelope measured on the FRONT (wr her right / wl her left) and SIDE panels
ENV = dict(
    wr=[(0.0, -0.030), (1.0, 0.060), (2.0, 0.100), (3.0, 0.123), (4.0, 0.141), (6.0, 0.170), (8.0, 0.214), (10.0, 0.229), (12.0, 0.240),
        (14.0, 0.246), (16.0, 0.244), (18.0, 0.240), (20.0, 0.252), (22.0, 0.276), (24.0, 0.284), (26.0, 0.279), (28.0, 0.266),
        (30.0, 0.258), (32.0, 0.238), (34.0, 0.200), (35.0, 0.160)],
    wl=[(0.0, 0.082), (1.0, 0.106), (2.0, 0.120), (3.0, 0.126), (4.0, 0.153), (6.0, 0.202), (8.0, 0.236), (10.0, 0.236), (12.0, 0.228),
        (14.0, 0.218), (16.0, 0.212), (18.0, 0.216), (20.0, 0.238), (22.0, 0.264), (24.0, 0.270), (26.0, 0.261), (28.0, 0.258),
        (30.0, 0.255), (32.0, 0.217), (34.0, 0.200), (35.0, 0.160)],
    front=[(0.0, 0.200), (1.0, 0.217), (2.0, 0.223), (3.0, 0.223), (4.0, 0.215), (6.0, 0.195), (8.0, 0.180), (12.0, 0.175), (18.0, 0.170),
           (22.0, 0.140), (26.0, 0.110), (30.0, 0.100), (34.0, 0.060), (35.0, 0.040)],
    back=[(0.0, 0.100), (1.0, 0.140), (2.0, 0.170), (3.0, 0.192), (4.0, 0.206), (6.0, 0.228), (8.0, 0.240), (10.0, 0.245), (14.0, 0.239),
          (16.0, 0.238), (18.0, 0.248), (20.0, 0.274), (22.0, 0.294), (24.0, 0.303), (26.0, 0.295), (28.0, 0.278), (30.0, 0.252),
          (32.0, 0.215), (34.0, 0.165), (35.0, 0.140)],
    expo=[(0.0, 2.0), (4, 2.0), (10, 2.0), (16, 2.05), (22, 2.2), (30, 2.2), (35, 2.1)],
)
def forehead(x):
    """Lowest point of the hair over the forehead / temples (pct) across x (her right negative): the wave hangs low on
    her right; the part side (her left) is higher; the temples drop to the flat strands in front of the ears."""
    keys = [(-0.20, 19.5), (-0.145, 12.8), (-0.09, 11.0), (-0.03, 8.8), (0.02, 7.4), (0.06, 6.4), (0.10, 6.4), (0.13, 8.5), (0.16, 17.5), (0.20, 19.5)]
    for (x0, z0), (x1, z1) in zip(keys, keys[1:]):
        if x <= x1: return z0 + (z1 - z0) * sm((x - x0) / (x1 - x0)) if x >= x0 else z0
    return keys[-1][1]
import numpy as np
def _an(u): return np.abs(((u + 0.5) % 1.0) - 0.5)               # 0 front .. 0.5 back
def _smn(x): x = np.clip(x, 0.0, 1.0); return x * x * (3 - 2 * x)
WAVES = [
    # the sides: S-wave locks stacked down to the shoulders, their crest lines dropping toward the back
    dict(phase=lambda u, p: (p - 10.0 - 18.0 * (_an(u) - 0.2) / 0.25) / 8.5,
         mask=lambda u, p: _smn((_an(u) - 0.19) / 0.04) * _smn((0.36 - _an(u)) / 0.05) * _smn((p - 10.0) / 3.0) * _smn((35.0 - p) / 2.0),
         amp=0.034, shape='saw', crest=0.72, bias=0.45, dark=0.9, dark_at=0.30),
]
ROLLS = [
    # the big wave's rolled edge over the forehead: from her right temple across to the part and up into the crest
    dict(keys=[(0.215, 13.5, 0.014, 0.8), (0.17, 12.0, 0.026, 0.60), (0.11, 10.2, 0.028, 0.58), (0.04, 7.8, 0.026, 0.58), (0.97, 6.2, 0.024, 0.60),
               (0.91, 5.2, 0.022, 0.65), (0.87, 3.8, 0.022, 0.75), (0.87, 2.6, 0.024, 0.8), (0.89, 0.8, 0.014, 0.8)], sink=0.20, k=0.010, over=True),
    # the next wave behind it, and one more over the top toward the back of her right side
    dict(keys=[(0.28, 9.5, 0.014, 0.8), (0.20, 7.0, 0.028, 0.70), (0.10, 4.6, 0.030, 0.70), (0.00, 3.2, 0.030, 0.70), (0.93, 2.2, 0.026, 0.72),
               (0.89, 1.2, 0.014, 0.8)], sink=0.40, k=0.010),
    # flat strands at the temples, in front of the ears
    dict(keys=[(0.175, 11.0, 0.012, 0.4), (0.19, 13.5, 0.018, 0.35), (0.20, 16.5, 0.017, 0.35), (0.21, 18.8, 0.012, 0.4)], sink=0.62, k=0.008, over=True, n=16),
    dict(keys=[(0.825, 10.0, 0.012, 0.4), (0.81, 13.0, 0.018, 0.35), (0.80, 16.0, 0.017, 0.35), (0.79, 18.3, 0.012, 0.4)], sink=0.62, k=0.008, over=True, n=16),
    dict(keys=[(0.34, 7.0, 0.014, 0.8), (0.26, 3.8, 0.026, 0.70), (0.14, 1.8, 0.028, 0.70), (0.03, 0.9, 0.024, 0.72), (0.95, 0.6, 0.012, 0.8)], sink=0.45, k=0.010),
]
GROOVES = [
    # the side part over her left temple, and the channel behind the big wave
    dict(keys=[(0.85, 7.5, 0.006), (0.86, 5.0, 0.008), (0.875, 2.8, 0.008), (0.90, 1.0, 0.006)], depth=0.006, k=0.005),
    # the back: S-curved lock lines flowing from the crown down to the shoulder ends (between broad lock planes)
    dict(keys=[(0.50, 3.0, 0.006), (0.485, 9.0, 0.011), (0.505, 16.0, 0.012), (0.485, 23.0, 0.012), (0.50, 29.0, 0.010), (0.49, 32.5, 0.006)], depth=0.010, k=0.006),
    dict(keys=[(0.42, 5.0, 0.006), (0.405, 11.0, 0.011), (0.425, 18.0, 0.012), (0.405, 25.0, 0.011), (0.415, 31.0, 0.006)], depth=0.010, k=0.006),
    dict(keys=[(0.58, 5.0, 0.006), (0.595, 11.0, 0.011), (0.575, 18.0, 0.012), (0.595, 25.0, 0.011), (0.585, 31.0, 0.006)], depth=0.010, k=0.006),
    dict(keys=[(0.25, 10.5, 0.006), (0.17, 8.3, 0.008), (0.08, 5.8, 0.009), (0.00, 4.4, 0.009), (0.93, 3.4, 0.008), (0.89, 2.4, 0.006)], depth=0.008, k=0.004),
]
HAIR = dict(
    env=ENV, top=0.0, centre=(0.0, 0.02, 15.0), blur=1.5, inset=0.016,
    face=dict(z_top=forehead, w=[(6.0, 0.10), (9.0, 0.125), (12.0, 0.132), (14.0, 0.126), (18.0, 0.128), (20.0, 0.142), (24.0, 0.145),
                                 (27.0, 0.130), (29.0, 0.105), (31.0, 0.075)],
              y=[(0.0, -0.020), (30.0, -0.020)], k=0.010),
    cheek=dict(y=[(12.0, -0.060), (15.0, -0.030), (18.0, 0.015), (20.0, 0.038), (23.0, 0.045), (25.5, 0.030), (28.0, -0.030)], thin=-0.02, z=(11.5, 28.5)),
    ears=dict(r=(0.050, 0.052, 0.068), dx=0.026, dy=0.026, z=21.0),
    neck=dict(r=0.064, y=-0.012, z_top=28.5, k=0.02),
    body=[dict(c=(0.0, -0.03, 39.0), r=(0.245, 0.135, 0.110))],
    bottom=34.8, rolls=ROLLS, waves=WAVES, grooves=GROOVES, ko_k=0.040, voxel=0.005, tris=9000, smooth=4, post_smooth=2, taubin=6,
)

# ---- body
NECK = dict(rings=[(26.0, 0.110, 0.106, 1.0, 0.024), (29.0, 0.114, 0.110, 1.0, 0.020), (31.0, 0.118, 0.114, 1.0, 0.016),
                   (32.0, 0.128, 0.120, 1.0, 0.013), (32.8, 0.172, 0.136, 0.96, 0.010), (33.5, 0.240, 0.156, 0.92, 0.007),
                   (34.3, 0.290, 0.172, 0.90, 0.003), (35.5, 0.300, 0.192, 0.85, -0.004)],
            split=31.0, blend=0.02, n=28)
BOD = dict(profiles=[(50.0, 0.246, 0.206, 0.92, -0.018), (47.8, 0.240, 0.200, 0.92, -0.020), (46.0, 0.244, 0.204, 0.90, -0.020),
                     (44.0, 0.262, 0.228, 0.88, -0.022), (42.0, 0.282, 0.254, 0.86, -0.024), (40.0, 0.298, 0.272, 0.85, -0.024),
                     (38.0, 0.306, 0.272, 0.83, -0.020), (36.0, 0.318, 0.252, 0.80, -0.012), (34.5, 0.330, 0.224, 0.80, -0.004),
                     (33.3, 0.318, 0.198, 0.85, 0.004), (32.4, 0.280, 0.176, 0.90, 0.010), (31.6, 0.220, 0.160, 0.95, 0.014)],
           neck=dict(kind='crew', side=32.3, front=34.0, back=32.6), waist=47.8, ncol=48, nrow=20, lip=0.006)
A = dict(
    shoulder=(0.180, 36.0), shoulder_y=0.0, elbow=(0.226, -0.012, 52.0), wrist=(0.262, -0.042, 59.0),
    sleeve_end=59.2, cuff_end=59.2, sleeve=None, n=16,
    stations=[('end', 0.060, 0.056), (57.0, 0.066, 0.062), (53.0, 0.074, 0.070), (50.0, 0.080, 0.076), (47.0, 0.086, 0.082),
              (43.0, 0.092, 0.088), (39.0, 0.096, 0.092), (('j', -0.005), 0.092, 0.092), (('j', 0.02), 0.078, 0.080), (('j', 0.035), 0.042, 0.046)],
    hand=dict(palm_len=0.092, palm_w=0.100, palm_t=0.052, out=0.006, finger_out=0.006,
              fingers=[(-0.034, 0.0135, 0.080, 0.85), (-0.012, 0.0142, 0.086, 0.95), (0.010, 0.0138, 0.083, 0.95), (0.031, 0.0124, 0.070, 0.90)],
              thumb=(-0.043, 0.011, 0.024, 0.0140, 0.060, 0.35)),
)
SLV = dict(kind='short', end=43.0, slant=0.030, lip=0.005, n=24, cap_in=0.024,
           stations=[('end', 0.116, 0.112), (40.0, 0.118, 0.114), (('j', -0.02), 0.118, 0.116), (('j', 0.008), 0.112, 0.114), (('j', 0.022), 0.096, 0.104),
                     (('j', 0.032), 0.070, 0.082), (('j', 0.040), 0.036, 0.046)])
SASH = dict(kind='metal', top=45.8, bot=49.8, thick=0.007, mat='sash', n=72)
SKIRT = dict(top=48.6, hem=92.5, style='column',
             profile=[(48.6, 0.124, 0.104, -0.018), (50.0, 0.140, 0.114, -0.015), (52.0, 0.160, 0.126, -0.010), (54.0, 0.176, 0.134, -0.006),
                      (56.0, 0.186, 0.139, -0.003), (58.0, 0.192, 0.141, 0.0), (62.0, 0.194, 0.141, 0.0), (66.0, 0.191, 0.140, 0.0),
                      (70.0, 0.186, 0.138, 0.0), (76.0, 0.181, 0.138, 0.0), (80.0, 0.177, 0.139, 0.0), (86.0, 0.175, 0.141, 0.0), (92.5, 0.173, 0.143, 0.0)],
             folds=dict(n=10, amp=[(48.6, 0.0), (60.0, 0.002), (80.0, 0.004), (92.5, 0.005)], sharp=0.3, phase=0.0),
             hem_wave=0.002, nr_per_fold=7, rows=22, lip=0.010, lining=0.10,
             weights=dict(sway=0.0, follow=0.9, top_spine=0.35))
LEGS = dict(leg_x=0.090, leg_y=0.0, n=14,
            stations=[(62.0, 0.120, 0.125), (70.0, 0.108, 0.112), (80.0, 0.090, 0.094), (86.0, 0.094, 0.098), (91.0, 0.084, 0.090), (94.0, 0.074, 0.080), (96.0, 0.068, 0.074)])
SHOES = dict(leg_x=0.090, y=0.0, len=0.265, w=0.090, heel=0.075, heel_h=0.042, heel_len=0.046, collar=0.090, vamp=0.058,
             splay=0.28, out=0.012, foot_top=0.108, ball=0.125, mat='shoe')
EAR = dict(r=0.016, x=0.168, dy=0.030, z=23.2, stem=0.004, mat='gold')
RIG = dict(hip=62.0, knee=79.5, ankle=95.0, waist=47.8, shoulder_top=32.3, neck_y=0.018, hand_end=68.5, leg_x=0.090,
           heel=0.075, ball=0.125, arm=A, walk_kw=dict(skirt=True))

def build(g):
    g.set_head(W, DF, DB, E, BULGES)
    FX.long_hair(g, HAIR)
    GK.head(g, nlon=48, nlat=34, cull_in=g.hair_covers)
    GK.ears(g); DK.decimate_parts(g, 'Ear', 0.55); GK.eyes(g); GK.brows(g); GK.nose(g)
    DK.lips(g, g.C['lips']); FX.ball_earrings(g, EAR)
    DK.neck_yoke(g, NECK)
    DK.bodice(g, BOD)
    GK.arms(g, A); GK.hands(g, A)
    DK.sleeves(g, A, SLV)
    DK.skirt(g, SKIRT, RIG)
    def waist_pt(phi, z):                        # the sash hugs whichever is further out: bodice or skirt top
        p = g.bod_r(phi, z); q = g.skirt_pt(phi, z) if z <= g.zp(SKIRT['top']) else p
        c = Vector((0.0, -0.02, z))
        return p if (p - c).length >= (q - c).length else q
    DK.belt(g, SASH, waist_pt)
    DK.legs(g, LEGS, RIG)
    DK.pumps(g, SHOES)
