# Eleanor — 1950s navy bateau-neck dress with cap sleeves, thin gold belt and a full bell skirt; dark-brown
# sculpted updo (side-part wave + twisted chignon at the nape), pearl studs, black low-heeled pumps.
# Reference: tools/char-pipeline/ref/eleanor-sheet.png (panels in ref/panels-eleanor/). Built by
#   python3 tools/char-pipeline/make_dress_guest.py eleanor   -> assets/characters/eleanor.glb
#
# Measurements (sheet FRONT panel: figure 572 px = H = 1.66 m, 2.90 mm/px; SIDE 570 px; HEAD FRONT close-up:
# 423 px/m, i.e. eye -> chin 71 px = 0.168 m). Heights are percent of standing height from the top:
#   head   hair top 0, forehead hairline 7.3, brows 12.4-14.5 (inner end high, outer end low), eyes 15.2-18.3
#          (centre 16.8, x +-0.064), nose ball 19.3, lips 21.8-23.4 (0.09 wide), chin 26.9, ears 16-23.2.
#          Face half-width 0.133 at the cheeks (0.127 at 21.4 %, 0.096 at 24.3 %, 0.071 at 25.4 %); side: face
#          front 0.205 ahead of the head axis (ear ~ on the axis), nose tip 0.235, chin 0.17.
#   hair   half-widths 0.244 (her right: the wave, at 13-14 %) / 0.197 (her left, 12 %); side: crest 0.215 ahead
#          of the axis at 3 %, back 0.198 at 11 %; chignon 13.5-28 % (0.275 wide, reaching 0.25 behind the axis).
#   body   neck 0.116 wide; bateau neckline 31 (sides, +-0.127) .. 32.4 (front centre) / 31.9 (back); shoulder
#          tips (cap sleeves) +-0.22 at 34-36 %; cap sleeve hem 36.5 (outside) .. 38.5 (inside); bust 0.265 deep
#          at 38 %; waist 0.214 x 0.196 at 47.4 %; gold belt 46.4-48.4. Skirt half-width 0.148 (50), 0.24 (60),
#          0.309 (70), 0.369 (80), 0.415 (90); depth ~0.88 of the width; hem 91-92.5 %, ~14 soft folds.
#          Arms: upper arm 0.088 wide hanging at x +-0.19, elbow 49 %, wrist 58.5 % at x +-0.285, hands to 66 %.
#          Legs x +-0.10 (0.075 at the ankle), pumps 0.245 long, block heel 0.035, collar 94.5 %, toes turned out.
import math
import guest_kit as GK
import dress_kit as DK
import victor_lib as L

H = 1.66
def zp(p): return H * (1 - p / 100)
sm = GK.sm

CFG = dict(
    z_hair_top=0.0, z_skull_top=3.0, z_hairline=7.3, z_brow=12.7, z_eye=16.8, z_nose=19.3, z_mouth=22.4, z_chin=26.9, z_ear=19.6,
    head_y=0.02, z_shoulder_top=31.5,
    ear_style='round', ear_h=0.074, ear_w=0.052, ear_out=0.002, ear_y=0.004, ear_tilt=0.30, ear_thick=0.026, ear_rim=0.007, ear_bowl=0.010, ear_sink=0.020,
    eye_x=0.063, eye_w=0.040, eye_h=0.067, eye_lift=0.003,
    brow=dict(x0=0.030, x1=0.096, z=12.6, thick=0.019, arch=0.014, drop_in=-0.020, drop_out=0.000,     # inner ends raised: soft friendly arcs from the game camera too
              profile=[(0.0, 0.55), (0.05, 0.90), (0.25, 1.0), (0.60, 0.88), (0.90, 0.55), (1.0, 0.25)], flat=0.5),
    nose_w=0.056, nose_h=0.042, nose_d=0.030, nose_out=0.012, nose_top=1.3,
    lips=dict(z=22.4, w=0.094, rise=0.015, upper=0.010, lower=0.015, bow=0.002, flat=0.45),
    tint=dict(spots=[(0.080, 20.9, 0.024, 0.020, 1.0), (0.0, 19.3, 0.018, 0.016, 0.3)], g=0.36, b=0.28),       # soft rosy blush discs
    soft_normals=dict(centre=(0.0, 0.03, 25.0), radii=(0.20, 0.24, 0.55), amount=1.0, z_top=12.5, z_bot=30.0, fade=0.03, front=0.04,
                      keep=[(0.0, -0.215, 19.3, 0.034)]),
    groove_dark=(0.010, 0.65),
    ao_skip=('Brow', 'Eye', 'Lips', 'Pearl', 'Shine'), ao_scale={'Skin': 0.20, 'Dress': 0.85},
    sheen={'Shoe': (0.34, [((0.2, -0.45, 0.87), 14.0, 1.0), ((0.0, -1.0, 0.3), 16.0, 0.8), ((0.9, 0.0, 0.45), 16.0, 0.5), ((-0.9, 0.0, 0.45), 16.0, 0.5)]),
           'Hair': (0.38, [((-0.1, -0.45, 0.89), 2.2, 1.0), ((0.5, -0.6, 0.6), 5.0, 0.45)]),
           'Gold': (0.55, [((0.0, -1.0, 0.25), 6.0, 1.0), ((-0.6, -0.6, 0.3), 8.0, 0.6), ((0.6, -0.6, 0.3), 8.0, 0.6)]),
           'Pearl': (0.70, (-0.3, -0.6, 0.75), 3.0)},
)
COLOURS = dict(
    skin='#ffb98e', hair='#7c6259', brow='#2e1d16', eye='#0b0b0d', lips='#b03a42',
    dress=GK.PALETTE['navy'], gold='#d8b077', pearl='#f6f1e8', shoe=GK.PALETTE['shoe_black'], shine='#f4f1ee',
)

# ---- skull tables by f (0 chin .. 1 skull top): a soft oval face, full cheeks, small round chin
W  = [(0, 0.0), (0.015, 0.050), (0.04, 0.072), (0.08, 0.094), (0.13, 0.110), (0.19, 0.123), (0.25, 0.131), (0.31, 0.135), (0.36, 0.135),
      (0.42, 0.133), (0.52, 0.128), (0.62, 0.121), (0.70, 0.114), (0.80, 0.100), (0.88, 0.080), (0.94, 0.055), (0.98, 0.030), (1, 0.0)]
DF = [(0, 0.0), (0.017, 0.130), (0.04, 0.165), (0.08, 0.183), (0.12, 0.190), (0.20, 0.198), (0.30, 0.203), (0.45, 0.205),
      (0.60, 0.202), (0.75, 0.196), (0.85, 0.182), (0.93, 0.150), (0.98, 0.070), (1, 0.0)]
DB = [(0, 0.0), (0.05, 0.030), (0.15, 0.062), (0.30, 0.112), (0.45, 0.155), (0.60, 0.165), (0.75, 0.160), (0.85, 0.140),
      (0.93, 0.110), (0.98, 0.060), (1, 0.0)]
E  = [(0, 2.0), (0.08, 2.2), (0.18, 2.35), (0.30, 2.45), (0.50, 2.45), (0.70, 2.4), (0.90, 2.2), (1, 2.1)]
BULGES = [dict(x=0.086, z=21.4, sx=0.046, sz=0.040, a=0.020),      # full rosy cheeks, widest at cheek / mouth level
          dict(x=0.0, z=17.8, sx=0.015, sz=0.022, a=0.010),        # soft nose bridge
          dict(x=0.0, z=25.6, sx=0.040, sz=0.015, a=0.004)]        # small round chin

# ---- hair: a sculpted volume (dress_kit.sculpt_hair): a puffed mass over a thin cap, the side-part WAVE as rolls
# sweeping from the part (her left, x +0.07) forward over the forehead and down her right side to the chignon,
# two rolls down her left side, soft grooves on the back converging into the chignon, wisps in front of the ears.
# Roll keys: (x, y offset from the head axis, pct, radius).
def _a(u): return abs(((u + 0.5) % 1.0) - 0.5)
def hairline(u):
    """Where the cap/mass is cut (pct) by longitude u (0 front, 0.25 her right, 0.5 back, 0.75 her left). At the front the
    visible edge is the underside of the wave rolls; the cut sits a little above it (hidden under them)."""
    u %= 1.0; right = u < 0.5; a = _a(u); ss = sm
    if right:
        keys = [(0.0, 6.0), (0.04, 7.0), (0.08, 9.0), (0.11, 11.5), (0.14, 14.0), (0.165, 16.0), (0.19, 15.8), (0.21, 15.5), (0.30, 15.5),
                (0.33, 18.0), (0.38, 24.0), (0.45, 27.0), (0.5, 27.3)]
    else:
        keys = [(0.0, 6.0), (0.03, 5.8), (0.07, 6.5), (0.10, 8.0), (0.13, 11.0), (0.15, 14.0), (0.17, 16.0), (0.20, 15.8), (0.30, 15.8),
                (0.33, 18.0), (0.38, 24.0), (0.45, 27.0), (0.5, 27.3)]
    for (a0, z0), (a1, z1) in zip(keys, keys[1:]):
        if a <= a1: return z0 + (z1 - z0) * ss((a - a0) / (a1 - a0))
    return keys[-1][1]

# the wave (her right): three parallel rolls, the front one biggest; each starts small INSIDE the crown (no bumps)
WAVE1 = [(0.045, -0.060, 4.0, 0.006), (0.040, -0.145, 3.4, 0.032), (-0.020, -0.156, 5.5, 0.042), (-0.080, -0.134, 7.8, 0.045), (-0.135, -0.110, 10.3, 0.046),
         (-0.185, -0.062, 12.3, 0.045), (-0.205, 0.0, 14.2, 0.042), (-0.190, 0.080, 15.8, 0.038), (-0.140, 0.140, 17.5, 0.032), (-0.075, 0.170, 19.0, 0.018)]
WAVE2 = [(0.040, -0.040, 3.4, 0.006), (0.030, -0.148, 1.5, 0.034), (-0.050, -0.164, 2.6, 0.040), (-0.120, -0.110, 5.2, 0.043), (-0.160, -0.045, 8.6, 0.043),
         (-0.190, 0.040, 11.8, 0.040), (-0.160, 0.115, 14.2, 0.035), (-0.090, 0.160, 16.5, 0.018)]
WAVE3 = [(0.020, 0.020, 3.6, 0.006), (-0.020, 0.0, 1.2, 0.030), (-0.085, 0.000, 3.2, 0.036), (-0.135, 0.040, 5.8, 0.040), (-0.150, 0.100, 8.8, 0.038),
         (-0.120, 0.150, 12.0, 0.030), (-0.050, 0.175, 14.5, 0.016)]
# behind the wave: two more rolls sweep over the crown toward the chignon (seen from the game's high camera)
WAVE4 = [(0.040, 0.060, 3.4, 0.006), (0.000, 0.070, 0.9, 0.030), (-0.070, 0.090, 2.0, 0.036), (-0.110, 0.130, 5.0, 0.036), (-0.100, 0.170, 8.5, 0.030),
         (-0.050, 0.190, 11.5, 0.016)]
LEFT3 = [(0.040, 0.020, 3.4, 0.006), (0.070, 0.060, 1.9, 0.024), (0.105, 0.110, 4.6, 0.028), (0.098, 0.160, 8.5, 0.026), (0.050, 0.185, 11.5, 0.012)]
# her left side, from the part back to the chignon
LEFT1 = [(0.055, -0.080, 5.0, 0.006), (0.100, -0.140, 6.2, 0.034), (0.128, -0.112, 10.0, 0.036), (0.152, -0.050, 12.5, 0.036), (0.152, 0.040, 14.5, 0.034),
         (0.120, 0.120, 16.0, 0.030), (0.060, 0.160, 16.5, 0.016)]
LEFT2 = [(0.050, -0.020, 4.0, 0.006), (0.085, -0.065, 3.6, 0.030), (0.122, -0.030, 6.8, 0.034), (0.148, 0.050, 10.0, 0.034), (0.130, 0.130, 13.0, 0.030),
         (0.070, 0.170, 14.5, 0.016)]

SCULPT = dict(
    cap=dict(thick=[(0, 0.012), (3, 0.02), (6, 0.032), (8, 0.035), (12, 0.028), (16, 0.022), (20, 0.018), (24, 0.015), (28, 0.012)], hairline=hairline, edge_k=0.012),
    masses=[dict(c=(-0.010, -0.014, 6.0), r=(0.140, 0.180, 0.092), k=0.03),           # the crown
            dict(c=(0.0, 0.070, 11.0), r=(0.180, 0.130, 0.100), k=0.03),            # the round back dome above the chignon
            dict(c=(-0.130, 0.02, 11.5), r=(0.090, 0.140, 0.060), k=0.03),          # fill under the wave, her right
            dict(c=(0.110, 0.02, 11.5), r=(0.070, 0.130, 0.060), k=0.03),           # fill, her left
            dict(c=(-0.030, -0.100, 3.2), r=(0.120, 0.090, 0.050), k=0.04),          # the sweep's crest: a fuller, higher top-front
            dict(c=(0.005, 0.030, 2.6), r=(0.130, 0.160, 0.052), k=0.035),          # a smooth crown dome over the rolls' seams (no 'turban' wraps from above)
            dict(c=(0.125, -0.010, 11.0), r=(0.080, 0.130, 0.075), k=0.04),          # her left side: fuller, rounder
            dict(c=(-0.010, 0.120, 17.5), r=(0.150, 0.100, 0.075), k=0.03),          # nape: side hair sweeping into the chignon
            dict(c=(-0.125, 0.120, 19.0), r=(0.065, 0.070, 0.075), k=0.03, cut=False),  # behind her right ear, into the chignon
            dict(c=(0.110, 0.120, 18.5), r=(0.055, 0.065, 0.065), k=0.03, cut=False)],  # behind her left ear
    rolls=[dict(keys=[(x * (1 + 0.04 * (abs(x) > 0.12)), dy, p, r * (0.45 if i == 0 else 0.75 if i == 1 else 1.0), fl) for i, (x, dy, p, r) in enumerate(k)], k=0.028)
           for k, fl in ((WAVE1, 0.80), (WAVE2, 0.78), (WAVE3, 0.78), (WAVE4, 0.78), (LEFT1, 0.80), (LEFT2, 0.78))] + [
        # wisps in front of the ears
        dict(keys=[(-0.148, -0.080, 13.8, 0.010), (-0.150, -0.082, 15.8, 0.010), (-0.145, -0.080, 17.2, 0.006), (-0.139, -0.080, 17.9, 0.003)], k=0.004, n=16),
        dict(keys=[(0.140, -0.080, 13.0, 0.009), (0.146, -0.072, 15.5, 0.009), (0.140, -0.066, 17.2, 0.004)], k=0.004, n=16),
    ],
    grooves=[dict(keys=[(0.072, -0.165, 3.2, 0.002), (0.072, -0.12, 1.6, 0.005), (0.068, -0.04, 0.9, 0.005), (0.060, 0.05, 1.4, 0.004), (0.050, 0.11, 3.0, 0.002)], depth=0.004, k=0.003)] +      # the side part
            [dict(keys=DK.valley(p, q, 0.006, t0=0.30, t1=0.85), depth=0.0045, k=0.003) for p, q in ((WAVE1, WAVE2), (WAVE2, WAVE3), (LEFT1, LEFT2))] +
            [dict(keys=[(0.02, 0.07, 0.6, 0.006), (-0.07, 0.07, 1.8, 0.008), (-0.12, 0.12, 5.0, 0.009), (-0.12, 0.17, 9.0, 0.009), (-0.07, 0.20, 12.0, 0.007)], depth=0.007, k=0.004),
             dict(keys=[(0.05, 0.03, 0.8, 0.006), (0.10, 0.02, 3.5, 0.008), (0.13, 0.08, 7.5, 0.009), (0.11, 0.15, 11.0, 0.008), (0.06, 0.19, 13.5, 0.006)], depth=0.007, k=0.004)] +
            [dict(keys=[(x * 0.6, 0.12, 3.0, 0.003), (x * 0.9, 0.175, 6.0, 0.009), (x, 0.197, 9.5, 0.010), (x * 0.8, 0.195, 12.5, 0.008), (x * 0.55, 0.18, 14.5, 0.003)],
                  depth=0.0035, k=0.004) for x in (-0.15, -0.09, -0.03, 0.03, 0.09, 0.15)],
    box=((-0.30, 0.02 - 0.27, zp(30.0)), (0.27, 0.02 + 0.33, zp(-1.0))), voxel=0.004, tris=11700, smooth=5, post_smooth=3,
)

# ---- chignon as overlapping twisted loops (sculpted into the hair volume, creases kept between them): a big outer
# loop wrapping round from the top, an upper loop lying over it, a small knot, and a filling core. dress_kit.loop_keys
# kwargs (expanded in build(), where the head axis is known).
BUN_AX = (0.0, 1.0, -0.04)
BUN_CORE = dict(c=(-0.035, 0.160, 20.4), r=(0.098, 0.090, 0.080), k=0.03, cut=False)
BUN_LOOPS = [       # stacked outward like a dome (round in profile), each off-centre so they overlap like twisted loops
    dict(centre=(-0.032, 0.178, 20.5), axis=BUN_AX, radii=(0.088, 0.070), start=95, sweep=330,
         rope=((0.0, 0.022), (0.12, 0.040), (0.80, 0.040), (1.0, 0.024)), rise=0.018, n=16),
    dict(centre=(-0.018, 0.218, 19.7), axis=BUN_AX, radii=(0.056, 0.042), start=210, sweep=300, tilt=10,
         rope=((0.0, 0.020), (0.15, 0.036), (0.80, 0.036), (1.0, 0.020)), rise=0.014, n=14),
    dict(centre=(-0.046, 0.242, 21.1), axis=BUN_AX, radii=(0.026, 0.020), start=30, sweep=320,
         rope=((0.0, 0.016), (0.2, 0.024), (0.8, 0.024), (1.0, 0.014)), rise=0.004, n=12, crease=False),
]
# ---- chignon (old coil version, kept for reference: dress_kit.coil_bun): a thick rope coiled in a tightening spiral, axis pointing back and a little down
BUN = dict(centre=(-0.050, 0.150, 20.4), axis=(0.0, 1.0, -0.10), up=(0, 0, 1), turns=-1.5, r_out=0.086, r_in=0.020,
           depth=0.060, lean=0.0, start=math.radians(205), squash=(1.40, 0.92), tighten=0.9, drift=0.040, drift_x=0.012,
           rope=[(0.0, 0.032), (0.10, 0.050), (0.45, 0.048), (0.80, 0.038), (1.0, 0.020)],
           core=(0.120, 0.100, 0.095, -0.005), n_samples=80, n_ring=10, strands=(1.5, 0.10))

# ---- body
NECK = dict(rings=[(24.0, 0.108, 0.104, 1.0, 0.018), (27.5, 0.112, 0.110, 1.0, 0.016), (29.0, 0.118, 0.116, 1.0, 0.014),
                   (30.0, 0.150, 0.130, 1.0, 0.012), (30.6, 0.200, 0.145, 0.95, 0.012), (31.2, 0.262, 0.157, 0.92, 0.010),
                   (32.0, 0.282, 0.172, 0.90, 0.008), (33.0, 0.298, 0.186, 0.85, 0.004), (34.5, 0.290, 0.205, 0.80, -0.004)],
            split=29.5, blend=0.02, n=28)
BOD = dict(profiles=[(49.2, 0.222, 0.205, 0.92, -0.034), (47.4, 0.214, 0.196, 0.92, -0.035), (46.0, 0.216, 0.198, 0.90, -0.035),
                     (44.0, 0.232, 0.213, 0.88, -0.034), (42.0, 0.242, 0.228, 0.86, -0.033), (40.0, 0.250, 0.250, 0.85, -0.032),
                     (38.0, 0.262, 0.262, 0.83, -0.027), (36.0, 0.290, 0.254, 0.80, -0.016), (34.5, 0.318, 0.228, 0.80, -0.004),
                     (33.0, 0.326, 0.205, 0.85, 0.004), (32.0, 0.318, 0.185, 0.90, 0.010), (31.0, 0.278, 0.165, 0.95, 0.014)],
           neck=dict(kind='bateau', side=31.0, front=32.4, back=31.9), waist=47.4, ncol=48, nrow=18, lip=0.006)
A = dict(
    shoulder=(0.171, 36.5), shoulder_y=0.005, elbow=(0.203, 0.0, 49.0), wrist=(0.294, -0.045, 58.5),
    sleeve_end=58.8, cuff_end=58.8, sleeve=None, n=16,
    stations=[('end', 0.048, 0.046), (57.3, 0.058, 0.054), (56.0, 0.068, 0.063), (52.0, 0.078, 0.072), (49.5, 0.082, 0.076), (46.0, 0.088, 0.082),
              (42.0, 0.092, 0.087), (38.5, 0.094, 0.090), (('j', -0.005), 0.088, 0.088), (('j', 0.02), 0.075, 0.078), (('j', 0.035), 0.040, 0.045)],
    hand=dict(palm_len=0.094, palm_w=0.102, palm_t=0.052, out=0.004, finger_out=0.004,
              fingers=[(-0.034, 0.0136, 0.086, 1.35), (-0.012, 0.0144, 0.092, 1.50), (0.011, 0.0140, 0.089, 1.50), (0.032, 0.0126, 0.076, 1.40)],
              thumb=(-0.044, 0.011, 0.026, 0.0145, 0.062, 0.55)),
)
SLV = dict(kind='cap', end=36.9, slant=0.024, lip=0.005, n=24, cap_in=0.030,
           stations=[('end', 0.120, 0.116), (35.8, 0.120, 0.118), (('j', 0.012), 0.118, 0.118), (('j', 0.030), 0.110, 0.112), (('j', 0.046), 0.092, 0.100), (('j', 0.060), 0.066, 0.078), (('j', 0.070), 0.026, 0.036)])
BELT = dict(kind='metal', top=46.4, bot=48.4, thick=0.006, mat='gold', n=72)
SKIRT = dict(top=47.2, hem=90.9,
             profile=[(47.2, 0.108, 0.098, -0.035), (48.5, 0.116, 0.104, -0.033), (50.0, 0.146, 0.126, -0.027), (52.0, 0.168, 0.145, -0.024),
                      (54.0, 0.185, 0.160, -0.019), (56.0, 0.202, 0.176, -0.016), (58.0, 0.216, 0.188, -0.015), (60.0, 0.227, 0.196, -0.013),
                      (64.0, 0.250, 0.216, -0.011), (68.0, 0.274, 0.237, -0.009), (72.0, 0.297, 0.255, -0.007), (76.0, 0.319, 0.268, -0.005),
                      (80.0, 0.339, 0.281, -0.004), (84.0, 0.358, 0.295, -0.003), (88.0, 0.378, 0.310, -0.001), (92.0, 0.388, 0.320, 0.0)],
             folds=dict(n=12, amp=[(47.2, 0.0), (48.6, 0.002), (50.0, 0.006), (52.0, 0.010), (60.0, 0.016), (70.0, 0.024), (80.0, 0.036), (90.9, 0.048)], sharp=0.7, phase=0.0),
             hem_wave=0.012, nr_per_fold=8, rows=18, lip=0.010, lining=0.10,
             weights=dict(sway=0.22, follow=0.0, top_spine=0.35))
LEGS = dict(leg_x=0.095, leg_y=0.0, n=14,
            stations=[(61.0, 0.120, 0.125), (70.0, 0.108, 0.112), (80.0, 0.090, 0.094), (86.0, 0.098, 0.102), (91.0, 0.088, 0.094), (94.0, 0.078, 0.084), (96.0, 0.072, 0.078)])
SHOES = dict(leg_x=0.095, y=0.0, len=0.25, w=0.088, heel=0.066, heel_h=0.036, heel_len=0.044, collar=0.088, vamp=0.060,
             splay=0.26, out=0.010, foot_top=0.105, ball=0.12, mat='shoe')
JAW = dict(top=22.0, lift=0.024, y0=-0.01, y1=0.09)          # jawline rising from the chin toward the ear lobe
SHINE = dict(r=0.0035, dx=-0.30, dz=0.45, mirror=True, mat='shine')      # a tiny glint, upper-inner on each eye
EAR = dict(kind='stud', r=0.014, x=0.146, dy=-0.004, z=21.6, mat='pearl')
RIG = dict(hip=63.0, knee=80.0, ankle=95.0, waist=47.4, shoulder_top=31.5, neck_y=0.015, hand_end=66.0, leg_x=0.095,
           heel=0.066, ball=0.12, arm=A, walk_kw=dict(skirt=True))

def build(g):
    g.set_head(W, DF, DB, E, BULGES)
    hs = dict(SCULPT); hs['masses'] = SCULPT['masses'] + [BUN_CORE]
    hs['rolls'] = SCULPT['rolls'] + [dict(keys=DK.loop_keys(g, **{k: v for k, v in lp.items() if k != 'crease'}), k=0.004) for lp in BUN_LOOPS]
    # creases between the loops: shallow grooves along each loop's inner and outer edge (projected onto the surface)
    gr = []
    for i_lp, lp in enumerate(BUN_LOOPS):
        lp = dict(lp); crease = lp.pop('crease', True)
        if not crease: continue
        rmax = max(r for _, r in lp['rope'])
        for side in ((0.85,) if i_lp == 0 else (-0.85, 0.85)):
            q = dict(lp, radii=(lp['radii'][0] + side * rmax, lp['radii'][1] + side * rmax), rope=((0.0, 0.003), (0.15, 0.006), (0.85, 0.006), (1.0, 0.003)))
            if q['radii'][1] > 0.01: gr.append(dict(keys=DK.loop_keys(g, **q), depth=0.007, k=0.003, n=40))
    hs['grooves'] = SCULPT['grooves'] + gr
    DK.sculpt_hair(g, hs)
    skull = GK.head(g, nlon=48, nlat=34, cull_in=g.hair_covers)
    DK.jaw_lift(g, skull, JAW)
    GK.ears(g); DK.decimate_parts(g, 'Ear', 0.55); GK.eyes(g); DK.eye_shine(g, SHINE); GK.brows(g); GK.nose(g)
    DK.lips(g, g.C['lips']); DK.earrings(g, EAR)
    DK.neck_yoke(g, NECK)
    DK.bodice(g, BOD)
    GK.arms(g, A); DK.soft_hands(g, A)
    DK.sleeves(g, A, SLV)
    DK.skirt(g, SKIRT, RIG)
    def waist_pt(phi, z):                        # the belt hugs whichever is further out: bodice or skirt top
        p = g.bod_r(phi, z); q = g.skirt_pt(phi, z) if z <= g.zp(SKIRT['top']) else p
        c = Vector((0.0, -0.035, z))
        return p if (p - c).length >= (q - c).length else q
    DK.belt(g, BELT, waist_pt)
    DK.legs(g, LEGS, RIG)
    DK.pumps(g, SHOES)

from mathutils import Vector
