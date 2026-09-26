# Beatrice — emerald crew-neck dress with LONG PUFF (bishop) sleeves gathered into fitted cuffs, a thin gold belt,
# an A-line mid-calf skirt; a voluminous near-black wavy bob (sculpted S-waves, side-swept front lock, full round
# back), gold ball earrings, berry lips, black low-heeled pumps.
# Reference: tools/char-pipeline/ref/beatrice-sheet.png (panels in ref/panels-beatrice/). Built by
#   python3 tools/char-pipeline/make_dress_guest.py beatrice   -> assets/characters/beatrice.glb
#
# Measurements (sheet FRONT panel: figure 572 px = H = 1.66 m, 2.90 mm/px; SIDE 571 px). Heights are percent of
# standing height from the top; x from the face centre; side depths from the head axis (0.046 behind the body centre):
#   head   hair top 0, fringe 5.5, brows 11.8 (x 0.04..0.125), eyes 16.8 (x +-0.068, 0.038 x 0.066), nose ball 19.2,
#          lips 22.3 (0.125 wide), chin 28.3; face half-width 0.145 at the cheeks (17-20 %), round jaw; ears 16-23 %
#          at x 0.145-0.19; gold balls r 0.018 at x +-0.165, 22.5 %.
#   hair   a bob: half-width 0.11 (1 %), 0.21 (6), 0.25 (10), 0.28 (14), 0.30 (18-20), 0.26 (24), 0.15 (27.5);
#          front of the crown 0.18 ahead of the axis; back 0.12 (1 %), 0.20 (4), 0.24 (8), 0.29 (12), 0.30 (14-22),
#          0.22 (26), 0.14 (28). Ears exposed; the curtain hangs behind them to 27.5 %.
#   body   neck 0.116 wide (28.5-31); crew neckline 30.8 (sides / back) .. 31.6 (front); bust 0.29 deep at 40-42;
#          waist 0.238 x 0.233 at 48.5; gold belt 47.8-49.8. Puff sleeves 0.16 wide at 50-54 %, gathered into cuffs
#          57.5-59.5; wrists at x +-0.29; hands to 70 %. Skirt 0.305 x 0.267 (52), 0.409 x 0.346 (60), 0.479 x 0.407
#          (70), 0.551 x 0.465 (80), 0.60 x 0.50 (86); hem 89 %. Legs x +-0.10, 0.075 wide; pumps 0.24 long.
#   colours (sheet medians) skin #bf663a, hair #2f201d, dress #1a332c, gold #b38042, lips #5d1a1a, shoes #201816;
#          the bases below are lobby-solved (guest_kit.PALETTE / lobby_base) so they read right in the game.
import math
import numpy as np
import guest_kit as GK
import dress_kit as DK
import victor_lib as L
from mathutils import Vector

H = 1.66
def zp(p): return H * (1 - p / 100)
sm = GK.sm

CFG = dict(
    z_hair_top=0.0, z_skull_top=3.2, z_hairline=5.5, z_brow=11.8, z_eye=16.8, z_nose=19.2, z_mouth=22.3, z_chin=28.3, z_ear=19.6,
    head_y=0.046, z_shoulder_top=32.0,
    ear_style='round', ear_seg=(20, 14), ear_h=0.094, ear_w=0.070, ear_out=0.008, ear_y=0.010, ear_tilt=0.60, ear_thick=0.028, ear_rim=0.008, ear_bowl=0.011, ear_sink=0.020,
    eye_x=0.070, eye_w=0.046, eye_h=0.078, eye_lift=0.003,
    brow=dict(x0=0.044, x1=0.118, z=12.1, thick=0.030, arch=0.010, drop_in=0.004, drop_out=0.012,
              profile=[(0.0, 0.55), (0.06, 0.95), (0.30, 1.0), (0.75, 0.88), (0.94, 0.62), (1.0, 0.35)], flat=0.5),
    nose_w=0.064, nose_h=0.050, nose_d=0.032, nose_out=0.008, nose_top=1.25,
    lips=dict(z=22.4, w=0.122, rise=0.012, upper=0.012, lower=0.020, bow=0.003, flat=0.5, mat='lips'),
    tint=dict(spots=[(0.095, 20.5, 0.040, 0.034, 1.0), (0.0, 19.2, 0.020, 0.020, 0.4)], g=0.18, b=0.16),
    groove_dark=(0.010, 0.60),
    ao_skip=('Brow', 'Eye', 'Lips', 'Gold', 'Shine'), ao_scale={'Skin': 0.30, 'Dress': 0.85},
    sheen={'Shoe': (0.34, [((0.2, -0.45, 0.87), 14.0, 1.0), ((0.0, -1.0, 0.3), 16.0, 0.8), ((0.9, 0.0, 0.45), 16.0, 0.5), ((-0.9, 0.0, 0.45), 16.0, 0.5)]),
           'Hair': (0.45, [((-0.1, -0.45, 0.89), 2.0, 1.0), ((0.5, -0.6, 0.6), 5.0, 0.40)]),
           'Gold': (0.55, [((0.0, -1.0, 0.25), 6.0, 1.0), ((-0.6, -0.6, 0.3), 8.0, 0.6), ((0.6, -0.6, 0.3), 8.0, 0.6)])},
)
COLOURS = dict(
    # lobby-measured (lineup_measure.mjs --inject dressEmerald=...), solved at the palette's mid light level and nudged
    # a little warmer for the neutral preview: in the lobby dress ~#10291f..#2c453e (sheet #1a332c), hair ~#26170f
    # (sheet #2f201d), skin ~#9d512c..#eb875e, gold ~#9a6e31 (sheet #b38042), berry lips ~#511212
    skin='#d08874', hair='#4f4a52', brow='#3a2c29', eye='#0b0b0d', lips='#7a4652',
    dress='#36524f', gold='#d3b182', shoe=GK.PALETTE['shoe_black'], sole='#1a1818', shine='#f4f1ee',
)

# ---- skull (f: 0 chin .. 1 skull top): soft round face, full cheeks, round chin
W  = [(0, 0.0), (0.02, 0.052), (0.05, 0.076), (0.10, 0.100), (0.16, 0.121), (0.24, 0.137), (0.32, 0.146), (0.42, 0.147),
      (0.52, 0.144), (0.62, 0.138), (0.72, 0.130), (0.82, 0.116), (0.90, 0.095), (0.95, 0.070), (0.99, 0.030), (1, 0.0)]
DF = [(0, 0.0), (0.02, 0.150), (0.05, 0.176), (0.10, 0.190), (0.18, 0.197), (0.30, 0.203), (0.45, 0.205),
      (0.60, 0.202), (0.75, 0.194), (0.86, 0.176), (0.94, 0.140), (0.99, 0.060), (1, 0.0)]
DB = [(0, 0.0), (0.05, 0.030), (0.15, 0.070), (0.30, 0.120), (0.45, 0.160), (0.60, 0.172), (0.75, 0.166), (0.86, 0.146),
      (0.94, 0.112), (0.99, 0.060), (1, 0.0)]
E  = [(0, 1.9), (0.10, 2.0), (0.20, 2.2), (0.35, 2.35), (0.50, 2.4), (0.70, 2.35), (0.90, 2.2), (1, 2.1)]
BULGES = [dict(x=0.092, z=20.8, sx=0.045, sz=0.036, a=0.020),      # full cheeks
          dict(x=0.0, z=17.9, sx=0.015, sz=0.022, a=0.012),        # soft nose bridge
          dict(x=0.0, z=26.8, sx=0.045, sz=0.016, a=0.006)]        # round chin

# ---- HAIR (dress_kit.sculpt_hair). The bob envelope: half-width A, half-depth B and centre offset DY (behind the
# head axis) by height, from the sheet; rolls (the S-waves) are laid on it, grooves carved in the valleys between.
ENV_A = GK.Table([(0.5, 0.10), (1, 0.115), (2, 0.14), (4, 0.18), (6, 0.21), (8, 0.23), (10, 0.25), (12, 0.265), (14, 0.28),
                  (16, 0.29), (18, 0.298), (20, 0.300), (22, 0.29), (24, 0.262), (26, 0.215), (27.5, 0.15)])
ENV_BK = GK.Table([(0.5, 0.10), (1, 0.123), (2, 0.163), (4, 0.204), (6, 0.227), (8, 0.24), (10, 0.256), (12, 0.284), (14, 0.300),
                   (16, 0.298), (18, 0.292), (20, 0.302), (22, 0.304), (24, 0.286), (26, 0.216), (27.5, 0.15)])
ENV_FR = GK.Table([(0.5, 0.10), (1, 0.15), (2, 0.175), (4, 0.183), (8, 0.183), (12, 0.175), (16, 0.16), (20, 0.14), (24, 0.12), (27.5, 0.08)])
def env(th, p, k=1.0):
    """Point (x, dy, pct) on the bob envelope at longitude th (0 front, +pi/2 her left, pi back) scaled by k."""
    a, bk, fr = ENV_A(p), ENV_BK(p), ENV_FR(p); b = (bk + fr) / 2; dc = (bk - fr) / 2
    return (k * a * math.sin(th), dc - k * b * math.cos(th), p)
def s_curve(th0, p0, p1, sweep, wig, r=0.014, k=1.0, n=9):
    """Groove keys (x, dy, pct, r) along an S-curve on the bob envelope: from (th0, p0) down to p1, drifting `sweep`
    rad and wiggling `wig` rad (the waves); sculpt_hair snaps them onto the hair surface."""
    keys = []
    for i in range(n):
        t = i / (n - 1); th = th0 + sweep * t + wig * math.sin(2 * math.pi * t * 0.9)
        x, dy, pp = env(th, p0 + (p1 - p0) * t, k); keys.append((x, dy, pp, r * (0.25 + 0.75 * sm(t / 0.3))))
    return keys
# creases radiating from the crown whorl (top of the back) down round the back and sides
BACK_GROOVES = [s_curve(math.radians(a), 3.0, 27.5, math.radians(sw * 1.8), math.radians(17)) for a, sw in
                ((70, 22), (98, 18), (126, 12), (154, 6), (-178, 0), (-150, -6), (-122, -12), (-94, -18), (-66, -22))]
# the side sweep from the part (her left, x +0.05) forward and over to her right, parallel creases down the front / her right
def sweep_curve(p_part, r=0.014):
    return [(0.05, -0.14 + 0.03 * p_part, p_part, r * 0.25), (-0.02, -0.205, p_part + 2.5, r), (-0.10, -0.19, p_part + 5.0, r),
            (-0.17, -0.14, p_part + 8.0, r), (-0.225, -0.07, p_part + 11.5, r), (-0.255, 0.005, p_part + 15.5, r),
            (-0.255, 0.07, p_part + 20.0, r)]
FRONT_GROOVES = [sweep_curve(3.0), sweep_curve(6.0)]
LEFT_GROOVES = [[(0.08, -0.13, 3.0, 0.004), (0.13, -0.17, 4.0, 0.014), (0.19, -0.13, 8.0, 0.014), (0.24, -0.07, 12.5, 0.014),
                 (0.26, 0.00, 17.0, 0.014), (0.255, 0.07, 22.0, 0.014)]]
# the scalloped lower rim: soft lobes round the bottom of the bob
RIM_LOBES = [dict(c=(0.26 * math.sin(math.radians(a)), 0.075 - 0.215 * math.cos(math.radians(a)), 24.0), r=(0.070, 0.070, 0.052), k=0.03)
             for a in (60, 90, 120, 150, 180, 210, 240, 270, 300)]

def hairline(u):
    """Lower edge of the hair by longitude u (0 front, 0.25 her right, 0.5 back, 0.75 her left): the fringe (5.5),
    the temples (down to 16 in front of the ear), above the ear (15.5), then the bob's curtain behind it (27.5)."""
    u %= 1.0; a = abs(((u + 0.5) % 1.0) - 0.5); right = u < 0.5; ss = sm
    z = 4.9 + (3.0 if right else 0.6) * ss(a / 0.08)
    z += (15.5 - z) * ss((a - 0.045) / 0.065)                 # arched: down past the temples to the ear's top
    z += (15.0 - z) * ss((a - 0.205) / 0.02)                  # over the ear
    z += (27.5 - z) * ss((a - 0.27) / 0.05)                   # the curtain behind the ear
    return z

SCULPT = dict(
    cap=dict(thick=[(0, 0.024), (3, 0.034), (6, 0.040), (10, 0.032), (14, 0.024), (18, 0.020), (24, 0.016), (28, 0.012)], hairline=hairline, edge_k=0.030),
    masses=[dict(c=(-0.010, 0.030, 6.0), r=(0.195, 0.200, 0.100), k=0.05),            # the round crown (reaches the hair top)
            dict(c=(-0.012, 0.070, 17.5), r=(0.285, 0.230, 0.102), k=0.05),           # the bob's body
            dict(c=(-0.180, 0.065, 22.0), r=(0.110, 0.150, 0.072), k=0.04),           # her right side, down toward the chin
            dict(c=(0.170, 0.065, 22.0), r=(0.105, 0.150, 0.072), k=0.04),            # her left side
            dict(c=(0.0, 0.180, 22.5), r=(0.170, 0.110, 0.070), k=0.04),              # the full round back, low
            dict(c=(-0.195, 0.000, 12.5), r=(0.095, 0.160, 0.072), k=0.05),           # fullness hugging the temples (her right)
            dict(c=(0.185, 0.000, 12.5), r=(0.090, 0.160, 0.072), k=0.05),            # (her left)
            dict(c=(-0.010, -0.080, 2.8), r=(0.130, 0.110, 0.045), k=0.05),           # the front of the crown rolling forward
            ],
    rolls=[],
    grooves=[dict(keys=k, depth=0.009, k=0.005) for k in BACK_GROOVES + FRONT_GROOVES + LEFT_GROOVES],
    box=((-0.36, 0.046 - 0.25, zp(30.0)), (0.34, 0.046 + 0.36, zp(-1.0))), voxel=0.0045, tris=10500, smooth=7, post_smooth=4,
)

# ---- body
NECK = dict(rings=[(24.0, 0.108, 0.104, 1.0, 0.035), (27.0, 0.112, 0.108, 1.0, 0.032), (29.0, 0.116, 0.112, 1.0, 0.030),
                   (30.4, 0.122, 0.116, 1.0, 0.028), (31.4, 0.140, 0.124, 1.0, 0.026), (32.4, 0.200, 0.140, 0.95, 0.022),
                   (33.6, 0.270, 0.160, 0.90, 0.016)],
            split=29.5, blend=0.02, n=28)
BOD = dict(profiles=[(50.0, 0.246, 0.236, 0.92, 0.000), (48.5, 0.238, 0.230, 0.92, 0.000), (47.0, 0.242, 0.234, 0.90, 0.000),
                     (45.0, 0.258, 0.248, 0.88, 0.000), (43.0, 0.276, 0.272, 0.86, -0.002), (41.0, 0.290, 0.290, 0.85, -0.004),
                     (39.0, 0.302, 0.284, 0.84, -0.002), (37.0, 0.318, 0.258, 0.82, 0.008), (35.0, 0.336, 0.226, 0.82, 0.018),
                     (33.8, 0.330, 0.200, 0.86, 0.022), (32.8, 0.270, 0.176, 0.92, 0.024), (31.8, 0.190, 0.150, 1.0, 0.026),
                     (31.0, 0.150, 0.134, 1.0, 0.027), (30.6, 0.140, 0.128, 1.0, 0.028)],
           neck=dict(kind='crew', side=31.4, front=32.3, back=31.4), waist=48.5, ncol=48, nrow=18, lip=0.006)
A = dict(
    shoulder=(0.172, 35.0), shoulder_y=0.010, elbow=(0.238, 0.012, 50.0), wrist=(0.290, -0.030, 59.6),
    sleeve_end=59.6, cuff_end=59.6, sleeve=None, n=16,
    stations=[('end', 0.064, 0.060), (57.0, 0.070, 0.066), (53.0, 0.078, 0.074), (50.0, 0.082, 0.078), (46.0, 0.088, 0.084),
              (42.0, 0.092, 0.088), (38.5, 0.094, 0.090), (('j', -0.005), 0.088, 0.088), (('j', 0.02), 0.075, 0.078), (('j', 0.035), 0.040, 0.045)],
    hand=dict(palm_len=0.092, palm_w=0.098, palm_t=0.052, out=0.004, finger_out=0.004,
              fingers=[(-0.032, 0.0135, 0.080, 1.0), (-0.011, 0.0142, 0.086, 1.1), (0.010, 0.0138, 0.083, 1.1), (0.030, 0.0124, 0.072, 1.0)],
              thumb=(-0.042, 0.011, 0.024, 0.0140, 0.060, 0.40)),
)
# long bishop sleeve: gathered at the shoulder, full through the forearm (0.16 at 50-54 %), gathered into a cuff
SLV = dict(kind='long', end=57.6, slant=0.0, lip=0.004, n=24, cap_in=0.030,
           stations=[('end', 0.110, 0.104), (56.0, 0.150, 0.142), (53.5, 0.166, 0.156), (50.5, 0.160, 0.152), (47.0, 0.148, 0.142),
                     (43.0, 0.138, 0.134), (39.5, 0.134, 0.132), (('j', -0.01), 0.140, 0.140), (('j', 0.014), 0.126, 0.132),
                     (('j', 0.032), 0.098, 0.108), (('j', 0.048), 0.058, 0.070)],
           cuff=dict(end=59.6, len=0.036, w=0.086, d=0.082))
BELT = dict(kind='metal', top=47.8, bot=49.8, thick=0.006, mat='gold', n=72)
SKIRT = dict(top=48.8, hem=89.0,
             profile=[(48.8, 0.121, 0.117, 0.0), (50.0, 0.130, 0.122, 0.0), (52.0, 0.152, 0.133, 0.0), (56.0, 0.183, 0.157, -0.004),
                      (60.0, 0.204, 0.173, -0.013), (64.0, 0.217, 0.184, -0.016), (70.0, 0.239, 0.203, -0.017), (75.0, 0.257, 0.218, -0.020),
                      (80.0, 0.275, 0.232, -0.023), (84.0, 0.291, 0.244, -0.026), (88.0, 0.300, 0.250, -0.027), (90.0, 0.302, 0.251, -0.027)],
             folds=dict(n=8, amp=[(48.8, 0.0), (52.0, 0.003), (60.0, 0.006), (70.0, 0.010), (80.0, 0.015), (89.0, 0.020)], sharp=0.5, phase=0.0),
             hem_wave=0.008, nr_per_fold=10, rows=18, lip=0.010, lining=0.10,
             weights=dict(sway=0.24, follow=0.0, top_spine=0.35))
LEGS = dict(leg_x=0.100, leg_y=0.0, n=14,
            stations=[(66.0, 0.118, 0.124), (74.0, 0.104, 0.110), (80.0, 0.088, 0.094), (86.0, 0.094, 0.100), (91.0, 0.082, 0.088), (94.0, 0.074, 0.080), (96.0, 0.068, 0.074)])
SHOES = dict(leg_x=0.100, y=0.0, len=0.24, w=0.086, heel=0.062, heel_h=0.034, heel_len=0.042, collar=0.086, vamp=0.058,
             splay=0.26, out=0.012, foot_top=0.100, ball=0.115, mat='shoe')
JAW = dict(top=23.0, lift=0.026, y0=-0.10, y1=0.02)
SHINE = dict(r=0.0060, dx=0.30, dz=0.42, mat='shine')
EAR = dict(kind='ball', r=0.018, x=0.165, dy=-0.004, z=22.6, mat='gold')
RIG = dict(hip=62.0, knee=79.0, ankle=95.5, waist=48.5, shoulder_top=32.0, neck_y=0.030, hand_end=70.0, leg_x=0.100,
           heel=0.062, ball=0.115, arm=A, walk_kw=dict(skirt=True))

def build(g):
    g.set_head(W, DF, DB, E, BULGES)
    DK.sculpt_hair(g, SCULPT)
    skull = GK.head(g, nlon=48, nlat=34, cull_in=g.hair_covers)
    DK.jaw_lift(g, skull, JAW)
    GK.ears(g); GK.eyes(g); GK.brows(g); GK.nose(g)
    DK.lips(g, g.C['lips']); DK.earrings(g, EAR)
    DK.neck_yoke(g, NECK)
    DK.bodice(g, BOD)
    GK.arms(g, A); GK.hands(g, A)
    DK.sleeves(g, A, SLV)
    DK.skirt(g, SKIRT, RIG)
    def waist_pt(phi, z):
        p = g.bod_r(phi, z); q = g.skirt_pt(phi, z) if z <= g.zp(SKIRT['top']) else p
        c = Vector((0.0, 0.0, z))
        return p if (p - c).length >= (q - c).length else q
    DK.belt(g, BELT, waist_pt)
    DK.legs(g, LEGS, RIG)
    DK.pumps(g, SHOES)
