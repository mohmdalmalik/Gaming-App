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
    z_hair_top=0.0, z_skull_top=3.2, z_hairline=5.5, z_brow=11.8, z_eye=16.8, z_nose=19.8, z_mouth=22.9, z_chin=28.8, z_ear=20.6,
    head_y=0.046, z_shoulder_top=32.0,
    ear_style='round', ear_seg=(20, 14), ear_h=0.118, ear_w=0.086, ear_out=0.010, ear_y=0.010, ear_tilt=0.60, ear_thick=0.028, ear_rim=0.008, ear_bowl=0.011, ear_sink=0.020,
    eye_x=0.066, eye_w=0.047, eye_h=0.069, eye_lift=0.003,
    brow=dict(x0=0.038, x1=0.109, z=12.95, thick=0.0265, arch=0.019, drop_in=-0.014, drop_out=0.010,
              profile=[(0.0, 0.72), (0.06, 0.95), (0.30, 1.0), (0.70, 0.96), (0.92, 0.80), (1.0, 0.55)], flat=0.5),
    nose_w=0.074, nose_h=0.058, nose_d=0.040, nose_out=0.016, nose_top=1.25,
    lips=dict(z=23.1, w=0.128, rise=0.017, upper=0.013, lower=0.023, bow=0.003, flat=0.5, mat='lips'),
    tint=dict(spots=[(0.100, 21.4, 0.042, 0.034, 1.0), (0.0, 20.2, 0.020, 0.020, 0.4)], g=0.10, b=0.08),
    groove_dark=(0.010, 0.60),
    # the crown faces the hall's overhead lamps (2-5x the light on the sides): authored darker so the top of the
    # hair still reads dark chocolate from the practice camera (the sheen lobes face the front, not the lamps)
    up_dark={'Hair': (0.82, 0.9, (0.97, 1.0, 1.03))},
    ao_skip=('Brow', 'Eye', 'Lips', 'Gold', 'Shine'), ao_scale={'Skin': 0.30, 'Dress': 0.85},
    sheen={'Shoe': (0.34, [((0.2, -0.45, 0.87), 14.0, 1.0), ((0.0, -1.0, 0.3), 16.0, 0.8), ((0.9, 0.0, 0.45), 16.0, 0.5), ((-0.9, 0.0, 0.45), 16.0, 0.5)]),
           'Hair': (0.62, [((-0.1, -0.90, 0.35), 3.0, 1.0), ((0.5, -0.75, 0.3), 6.0, 0.45)]),
           'Gold': (0.55, [((0.0, -1.0, 0.25), 6.0, 1.0), ((-0.6, -0.6, 0.3), 8.0, 0.6), ((0.6, -0.6, 0.3), 8.0, 0.6)])},
)
COLOURS = dict(
    # lobby-measured (lineup_measure.mjs --inject dressEmerald=...), solved at the palette's mid light level and nudged
    # a little warmer for the neutral preview: in the lobby dress ~#10291f..#2c453e (sheet #1a332c), hair ~#26170f
    # (sheet #2f201d), skin ~#9d512c..#eb875e, gold ~#9a6e31 (sheet #b38042), berry lips ~#511212
    skin='#d0865c', hair='#5a4a44', brow='#3a2c29', eye='#0b0b0d', lips='#80403c',
    dress='#36524f', gold='#d3b182', shoe=GK.PALETTE['shoe_black'], sole='#1a1818', shine='#9c9794',
)

# ---- skull (f: 0 chin .. 1 skull top): soft round face, full cheeks, round chin (a rounded U from the front and
# the side: the bottom rows are narrower and shallower, so the chin has no flat underside plate)
W  = [(0, 0.0), (0.02, 0.048), (0.05, 0.072), (0.10, 0.098), (0.16, 0.121), (0.24, 0.140), (0.32, 0.150), (0.42, 0.151),
      (0.52, 0.147), (0.62, 0.139), (0.72, 0.129), (0.82, 0.114), (0.90, 0.094), (0.95, 0.069), (0.99, 0.030), (1, 0.0)]
# fuller, rounder lower face (owner: the face read too long): 3.5 % wider up to the cheekbones, easing out by the brow
W  = [(f, w * (1.0 + 0.035 * min(1.0, max(0.0, (0.72 - f) / 0.20)))) for f, w in W]
DF = [(0, 0.0), (0.02, 0.112), (0.05, 0.150), (0.10, 0.178), (0.18, 0.194), (0.30, 0.203), (0.45, 0.205),
      (0.60, 0.202), (0.75, 0.194), (0.86, 0.176), (0.94, 0.140), (0.99, 0.060), (1, 0.0)]
DB = [(0, 0.0), (0.05, 0.030), (0.15, 0.070), (0.30, 0.120), (0.45, 0.160), (0.60, 0.172), (0.75, 0.166), (0.86, 0.146),
      (0.94, 0.112), (0.99, 0.060), (1, 0.0)]
E  = [(0, 1.9), (0.10, 2.0), (0.20, 2.2), (0.35, 2.35), (0.50, 2.4), (0.70, 2.35), (0.90, 2.2), (1, 2.1)]
BULGES = [dict(x=0.098, z=21.6, sx=0.048, sz=0.038, a=0.024),      # full cheeks
          dict(x=0.0, z=17.9, sx=0.015, sz=0.022, a=0.012),        # soft nose bridge
          dict(x=0.0, z=27.8, sx=0.050, sz=0.016, a=0.006)]        # round chin

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
    # the side sweep: from the part (her left) the hairline runs DIAGONALLY down across the forehead to her right temple
    # (the wave comes down there); on her left it lifts away, leaving the forehead's top corner open (sheet front)
    if right:
        z = 6.0 + 7.4 * min(1.0, a / 0.12) ** 0.8
        z += (15.5 - z) * ss((a - 0.13) / 0.07)
    else:
        z = 6.0 - 0.8 * ss(a / 0.04)
        z += (15.5 - z) * ss((a - 0.10) / 0.10)               # the open corner, then down to the ear's top
    z += (15.0 - z) * ss((a - 0.205) / 0.02)                  # over the ear
    z += (27.0 - z) * ss((a - 0.27) / 0.05)                   # the curtain behind the ear (the curl ends hang lower)
    return z

def band_keys(th0, p0, p1, sweep, wig, half, k=1.0, n=9):
    """Band path keys (x, dy, pct, half-width) along an S on the bob envelope; the width tapers toward the crown."""
    keys = []
    for i in range(n):
        t = i / (n - 1); th = th0 + sweep * t + wig * math.sin(2 * math.pi * t * 0.9)
        x, dy, pp = env(th, p0 + (p1 - p0) * t, k); keys.append((x, dy, pp, half * (0.45 + 0.55 * sm(t / 0.45))))
    return keys
def curl_end(th, p=26.0, k=0.86, r=(0.050, 0.046, 0.040)):
    x, dy, pp = env(th, p, k); return dict(c=(x, dy, pp), r=r, k=0.035, cut=False)
# back/sides: 8 locks between the old crease lines, alternately taller / lower (each stands proud of its neighbours)
def s_band(th0, p0, p1, sweep, amp, half, n=11):
    """One big S: the path drifts `sweep` rad and swings +-amp rad once (a single full wave over its length)."""
    keys = []
    for i in range(n):
        t = i / (n - 1); th = th0 + sweep * t + amp * math.sin(2 * math.pi * t)
        x, dy, pp = env(th, p0 + (p1 - p0) * t, 1.0); keys.append((x, dy, pp, half * (0.40 + 0.60 * sm(t / 0.40))))
    return keys
BACK_ANGLES = ((84, 36), (112, 27), (140, 16), (168, 5), (-164, -5), (-136, -16), (-108, -27), (-80, -36))
BACK_BANDS = [dict(keys=band_keys(math.radians(a), 3.0, 27.0, math.radians(sw), math.radians(15), 0.075), height=h, soft=0.008, taper=(0.12, 0.10), dome=0.55)
              for (a, sw), h in zip(BACK_ANGLES, (0.046, 0.028, 0.046, 0.028, 0.046, 0.028, 0.046, 0.030))]
# the front: the big side-swept wave from the part (her left) over the forehead to her right side, a second wave above it,
# and her left side's lock falling from the part
def sweep_band(p_part, half, dx=0.0):
    # (the forehead keys sit high, so the wave leaves the sheet's open forehead between the brows and the hair)
    return [(0.055 + dx, -0.15 + 0.03 * p_part, p_part, half * 0.5), (-0.02, -0.205, p_part + 1.8, half), (-0.10, -0.19, p_part + 3.8, half),
            (-0.17, -0.14, p_part + 6.8, half), (-0.225, -0.07, p_part + 10.8, half), (-0.255, 0.005, p_part + 15.5, half),
            (-0.255, 0.07, p_part + 20.0, half)]
def left_band(dp=0.0, ddy=0.0, k=1.0):
    """Her left side's lock falling from the part (a second one sits behind it): keys (x, dy, pct, half-width)."""
    return [(0.07, -0.13 + ddy, 2.0 + dp, 0.022 * k), (0.13, -0.17 + ddy, 4.8 + dp, 0.038 * k), (0.19, -0.13 + ddy, 8.5 + dp, 0.042 * k),
            (0.24, -0.07 + ddy, 13.0 + dp, 0.044 * k), (0.26, 0.00 + ddy, 17.5 + dp, 0.044 * k), (0.255, 0.07 + ddy, 22.5 + dp, 0.042 * k)]
# three narrower stacked waves from the part over the forehead and down her right side (with dark valleys between
# them: the sheet's front shows three rolls), and two locks down her left side
FRONT_BANDS = [dict(keys=sweep_band(5.0, 0.036), height=0.046, soft=0.008, dome=0.55, taper=(0.10, 0.12), cut=True),
               dict(keys=sweep_band(1.1, 0.036), height=0.048, soft=0.008, dome=0.55, taper=(0.10, 0.16), cut=True),
               dict(keys=sweep_band(-2.8, 0.034), height=0.040, soft=0.008, dome=0.55, taper=(0.10, 0.20), cut=True),
               dict(keys=left_band(), height=0.050, soft=0.008, dome=0.55, taper=(0.10, 0.15), cut=True),
               dict(keys=left_band(-1.5, 0.075, 0.9), height=0.040, soft=0.008, dome=0.55, taper=(0.12, 0.15), cut=True)]

# the big rounded curl lobes framing the face on both sides (sheet front: three per side, the lowest at chin height),
# set behind the earrings so the gold stays in front
SIDE_LOBES = [dict(c=(sx * x, dy, p), r=r, k=0.016, cut=False) for sx in (1, -1) for x, dy, p, r in
              ((0.258, 0.040, 18.6, (0.050, 0.066, 0.046)), (0.256, 0.058, 22.6, (0.056, 0.070, 0.048)), (0.216, 0.050, 26.6, (0.054, 0.066, 0.046)))]
# the wave LIFTS up from the part (her left of centre) before sweeping over: a raised roll on the front of the crown
LIFT = dict(c=(0.050, -0.050, 1.8), r=(0.100, 0.090, 0.040), k=0.04)

SCULPT = dict(
    cap=dict(thick=[(0, 0.024), (3, 0.034), (6, 0.040), (10, 0.032), (14, 0.024), (18, 0.020), (24, 0.016), (28, 0.012)], hairline=hairline, edge_k=0.030),
    # a rounded cloud: a tall round crown, the body widest low (~20 %), rounded side bulges, and a scalloped rim of
    # curl ends round the jaw and the nape (not cut by the hairline: they hang below it as separate rounded ends)
    masses=[dict(c=(-0.010, 0.040, 8.5), r=(0.185, 0.190, 0.140), k=0.05),            # the round crown (top at 0 %)
            dict(c=(-0.010, 0.068, 15.5), r=(0.285, 0.232, 0.140), k=0.05),           # the bob's body: a round cloud
            dict(c=(-0.200, 0.045, 20.5), r=(0.084, 0.140, 0.072), k=0.04),           # her right side bulge
            dict(c=(0.190, 0.045, 20.5), r=(0.080, 0.140, 0.072), k=0.04),            # her left side bulge
            dict(c=(0.0, 0.180, 22.0), r=(0.175, 0.110, 0.078), k=0.04),              # the full round back, low
            dict(c=(-0.010, -0.070, 3.2), r=(0.120, 0.100, 0.042), k=0.05)] +         # the front of the crown rolling forward
           [curl_end(math.radians(a)) for a in (84, 106, 128, 150, 172, -166, -144, -122, -100, -78)] +
           SIDE_LOBES,
    bands=BACK_BANDS + FRONT_BANDS, lock_base=0.030, valley=0.012,
    box=((-0.36, 0.046 - 0.25, zp(30.0)), (0.34, 0.046 + 0.36, zp(-1.0))), voxel=0.0045, tris=12000, smooth=4, post_smooth=3,
)

# ---- body
NECK = dict(rings=[(24.0, 0.150, 0.138, 1.0, 0.035), (28.0, 0.152, 0.140, 1.0, 0.032), (30.0, 0.156, 0.144, 1.0, 0.030),
                   (31.0, 0.160, 0.146, 1.0, 0.028), (32.0, 0.176, 0.150, 0.98, 0.026), (33.6, 0.240, 0.160, 0.92, 0.018)],
            split=29.8, blend=0.02, n=28)
BOD = dict(profiles=[(50.0, 0.246, 0.236, 0.92, 0.000), (48.5, 0.238, 0.230, 0.92, 0.000), (47.0, 0.242, 0.234, 0.90, 0.000),
                     (45.0, 0.258, 0.248, 0.88, 0.000), (43.0, 0.276, 0.272, 0.86, -0.002), (41.0, 0.290, 0.290, 0.85, -0.004),
                     (39.0, 0.302, 0.284, 0.84, -0.002), (37.0, 0.318, 0.258, 0.82, 0.008), (35.0, 0.336, 0.226, 0.82, 0.018),
                     (33.8, 0.330, 0.200, 0.86, 0.022), (32.8, 0.286, 0.184, 0.92, 0.024), (31.8, 0.226, 0.170, 0.98, 0.026),
                     (31.0, 0.198, 0.160, 1.0, 0.027), (30.6, 0.190, 0.156, 1.0, 0.028)],
           neck=dict(kind='crew', side=31.6, front=32.8, back=31.5), waist=48.5, ncol=48, nrow=18, lip=0.006)
A = dict(
    shoulder=(0.172, 35.0), shoulder_y=0.010, elbow=(0.238, 0.012, 50.0), wrist=(0.290, -0.030, 59.6),
    sleeve_end=59.6, cuff_end=59.6, sleeve=None, n=16,
    stations=[('end', 0.064, 0.060), (57.0, 0.070, 0.066), (53.0, 0.078, 0.074), (50.0, 0.082, 0.078), (46.0, 0.088, 0.084),
              (42.0, 0.092, 0.088), (38.5, 0.094, 0.090), (('j', -0.005), 0.088, 0.088), (('j', 0.02), 0.075, 0.078), (('j', 0.035), 0.040, 0.045)],
    hand=dict(palm_len=0.092, palm_w=0.100, palm_t=0.056, out=0.006, finger_out=0.008,
              fingers=[(-0.031, 0.0150, 0.082, 1.55), (-0.010, 0.0156, 0.088, 1.65), (0.010, 0.0152, 0.085, 1.65), (0.029, 0.0138, 0.074, 1.55)],
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
JAW = dict(top=24.3, lift=0.026, y0=-0.10, y1=0.02)
SHINE = dict(r=0.0065, dx=0.30, dz=0.45, mat='shine')      # the sheet's soft glint (glossy eyes)
EAR = dict(kind='ball', r=0.023, x=0.182, dy=-0.020, z=23.2, mat='gold')
RIG = dict(hip=62.0, knee=79.0, ankle=95.5, waist=48.5, shoulder_top=32.0, neck_y=0.030, hand_end=70.0, leg_x=0.100,
           heel=0.062, ball=0.115, arm=A, walk_kw=dict(skirt=True))

# =============================================================================================
# BAND HAIR — dress_kit.sculpt_hair's cap + masses, plus SCULPTED LOCK BANDS (the lock_fields idea of guest_kit.hair_shell
# carried into the SDF): each band is a broad raised strip following an S path on the hair surface, with a gently domed
# top and a rounded edge `soft` wide; overlapping bands take the MAX, so a taller band steps down onto its neighbour
# with its own rounded edge (the sheet's carved clay locks). `lock_base` lowers the mass where the bands are, so they
# restore the measured silhouette instead of growing it. Band keys: (x, dy, pct, half-width); the path is snapped
# onto the base surface. Built only from dress_kit's public SDF helpers (dress_kit.py itself is untouched).
# =============================================================================================
def band_hair(g, Hs):
    zp = g.zp; Y0 = g.Y0
    Cp = Hs['cap']; TT = DK._np_table(GK.Table([(zp(p), t) for p, t in Cp['thick']]))
    c0 = np.array([0.0, Y0 + 0.02, zp(14.0)])
    hl = Cp['hairline']; hl_u = np.linspace(0, 1, 721); hl_z = np.array([zp(hl(u)) for u in hl_u])
    def u_of(P): return (np.arctan2(-(P[:, 1] - c0[1]), P[:, 0] - c0[0]) - math.pi / 2) / (2 * math.pi) % 1.0
    def cutf(P): return np.interp(u_of(P), hl_u, hl_z) - P[:, 2]
    hc = np.array([0.0, Y0, zp(Hs.get('centre_pct', 12.0))]); ek = Cp.get('edge_k', 0.012)
    def base(P):
        s_ = DK.sd_skull(g, P) - TT(P[:, 2]); s_ = DK.smax(s_, cutf(P), ek)
        for M in Hs.get('masses', []):
            m = DK.sd_ellipsoid(P, (M['c'][0], Y0 + M['c'][1], zp(M['c'][2])), M['r'])
            if M.get('cut', True): m = DK.smax(m, cutf(P) - M.get('below', 0.0), ek)
            s_ = DK.smin(s_, m, M.get('k', 0.02))
        return s_
    def snap(pts):                                     # radially from the head centre onto base = 0
        D = pts - hc; D /= np.linalg.norm(D, axis=1)[:, None]
        lo_ = np.full(len(pts), 0.02); hi_ = np.full(len(pts), 0.45)
        for _ in range(28):
            mid = 0.5 * (lo_ + hi_); inside = base(hc + D * mid[:, None]) < 0
            lo_ = np.where(inside, mid, lo_); hi_ = np.where(inside, hi_, mid)
        return hc + D * lo_[:, None]
    bands = []
    for B in Hs.get('bands', []):
        pts, half, _ = DK._curve(g, B['keys'], B.get('n', 36))
        bands.append((snap(pts), half, B['height'], B.get('soft', 0.012), B.get('taper', (0.15, 0.15)), B.get('dome', 0.35), B.get('cut', False)))
    lb = Hs.get('lock_base', 0.0)
    def dist_param(P, pts, half):
        lo = pts.min(0) - half.max() - 0.02; hi = pts.max(0) + half.max() + 0.02
        m = np.all((P >= lo) & (P <= hi), axis=1)
        d = np.full(len(P), 1.0); sp = np.zeros(len(P)); hw = np.full(len(P), half.mean())
        if not m.any(): return d, sp, hw
        Q = P[m]; best = np.full(len(Q), 1e9); bs = np.zeros(len(Q)); bh = np.zeros(len(Q)); n = len(pts) - 1
        for i in range(n):
            a, b = pts[i], pts[i + 1]; ab = b - a; L2 = max(1e-12, ab @ ab)
            t = np.clip(((Q - a) @ ab) / L2, 0.0, 1.0); dd = np.linalg.norm(Q - (a + t[:, None] * ab), axis=1)
            w = dd < best; best = np.where(w, dd, best); bs = np.where(w, (i + t) / n, bs); bh = np.where(w, half[i] + (half[i + 1] - half[i]) * t, bh)
        d[m] = best; sp[m] = bs; hw[m] = bh
        return d, sp, hw
    def ss(x): x = np.clip(x, 0.0, 1.0); return x * x * (3 - 2 * x)
    def bump(P):
        h = np.zeros(len(P)); cov = np.zeros(len(P))
        for pts, half, hgt, soft, (t0, t1), dome, cut in bands:
            d, sp, hw = dist_param(P, pts, half)
            along = ss(sp / t0) * ss((1.0 - sp) / t1)
            if cut: along = along * ss(-cutf(P) / 0.012)      # 'cut' bands stop at the hairline (keep the forehead open)
            edge = ss((hw - d) / soft + 0.5)
            prof = 1.0 - dome * np.clip(d / np.maximum(hw, 1e-4), 0, 1) ** 2
            h = np.maximum(h, hgt * edge * prof * along); cov = np.maximum(cov, edge * along)
        return h - lb * cov
    def sdf(P): return base(P) - (bump(P) if bands else 0.0)
    lo, hi = Hs['box']
    ob = DK.sdf_object(g, Hs.get('name', 'Hair'), sdf, lo, hi, Hs.get('voxel', 0.005), drop=lambda p: g.inside_skull(p, -0.004),
                       smooth=Hs.get('smooth', 3), target_tris=Hs.get('tris', 7000), post_smooth=Hs.get('post_smooth', 2))
    def covered(p, margin=0.02):
        return bool(p.z > np.interp(u_of(np.array([[p.x, p.y, p.z]])), hl_u, hl_z)[0] + margin)
    g.hair_covers = covered; g.hair_sdf = sdf
    # the bake darkens a little along each band's edge (the crease where it steps onto its neighbour)
    # and, with Hs['valley'] > 0, darkens the VALLEYS between bands (inside the banded area but off every band's crest):
    # the sheet's dark channels between its rounded S-locks, which read even in flat light
    vk = Hs.get('valley', 0.0)
    def gam(p):
        P = np.array([[p.x, p.y, p.z]]); best = 0.0; cov = 0.0; near = 0.0
        for pts, half, hgt, soft, (t0, t1), dome, cut in bands:
            d, sp, hw = dist_param(P, pts, half); x = abs(d[0] - hw[0])
            if sp[0] > 0.12 and sp[0] < 0.9: best = max(best, float(np.clip(1.0 - x / soft, 0.0, 1.0)))
            if vk:
                along = float(ss(sp[0] / t0) * ss((1.0 - sp[0]) / t1))
                cov = max(cov, float(ss((hw[0] - d[0]) / soft + 0.5)) * along * (1.0 - 0.6 * min(1.0, d[0] / max(hw[0], 1e-4)) ** 2))
                near = max(near, along * float(np.clip((2.4 * hw[0] - d[0]) / hw[0], 0.0, 1.0)))
        return best * 0.010 + (vk * near * (1.0 - cov) if vk else 0.0)
    g.hair_groove = gam
    return g.add(ob, Hs.get('mat', 'hair'), 'head')

def build(g):
    g.set_head(W, DF, DB, E, BULGES)
    band_hair(g, SCULPT)
    skull = GK.head(g, nlon=48, nlat=34, cull_in=g.hair_covers)
    DK.jaw_lift(g, skull, JAW)
    GK.ears(g); GK.eyes(g); DK.eye_shine(g, SHINE); GK.brows(g); GK.nose(g)
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
