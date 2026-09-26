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
    ear_style='round', ear_h=0.096, ear_w=0.062, ear_out=0.016, ear_y=0.0, ear_tilt=0.55, ear_thick=0.026, ear_rim=0.007, ear_bowl=0.010, ear_sink=0.020,
    eye_x=0.063, eye_w=0.037, eye_h=0.060, eye_lift=0.003,
    brow=dict(x0=0.030, x1=0.108, z=12.7, thick=0.017, arch=0.005, drop_in=0.002, drop_out=0.024,
              profile=[(0.0, 0.45), (0.06, 0.90), (0.20, 1.0), (0.60, 0.90), (0.90, 0.60), (1.0, 0.25)], flat=0.5),
    nose_w=0.044, nose_h=0.038, nose_d=0.040, nose_out=0.022, nose_top=1.2,
    lips=dict(z=22.4, w=0.080, rise=0.008, upper=0.010, lower=0.014, bow=0.002, flat=0.45),
    tint=dict(spots=[(0.085, 21.0, 0.035, 0.030, 1.0), (0.0, 19.3, 0.020, 0.020, 0.4)], g=0.10, b=0.12),
    groove_dark=(0.010, 0.50),
    ao_skip=('Brow', 'Eye', 'Lips', 'Pearl'), ao_scale={'Skin': 0.55},
    sheen={'Shoe': (0.34, [((0.2, -0.45, 0.87), 14.0, 1.0), ((0.0, -1.0, 0.3), 16.0, 0.8), ((0.9, 0.0, 0.45), 16.0, 0.5), ((-0.9, 0.0, 0.45), 16.0, 0.5)]),
           'Hair': (0.55, (-0.2, -0.40, 0.89), 2.0),
           'Gold': (0.55, [((0.0, -1.0, 0.25), 6.0, 1.0), ((-0.6, -0.6, 0.3), 8.0, 0.6), ((0.6, -0.6, 0.3), 8.0, 0.6)]),
           'Pearl': (0.70, (-0.3, -0.6, 0.75), 3.0)},
)
COLOURS = dict(
    skin='#ffb68c', hair='#886a62', brow='#2e1d16', eye='#0b0b0d', lips='#a82e38',
    dress='#404251', gold='#d8b077', pearl='#f6f1e8', shoe='#5f5a58',
)

# ---- skull tables by f (0 chin .. 1 skull top): a soft oval face, full cheeks, small round chin
W  = [(0, 0.0), (0.02, 0.050), (0.05, 0.068), (0.10, 0.093), (0.16, 0.110), (0.23, 0.126), (0.28, 0.132), (0.34, 0.134),
      (0.42, 0.133), (0.52, 0.128), (0.62, 0.121), (0.70, 0.114), (0.80, 0.100), (0.88, 0.080), (0.94, 0.055), (0.98, 0.030), (1, 0.0)]
DF = [(0, 0.0), (0.017, 0.130), (0.04, 0.165), (0.08, 0.183), (0.12, 0.190), (0.20, 0.198), (0.30, 0.203), (0.45, 0.205),
      (0.60, 0.200), (0.75, 0.190), (0.85, 0.170), (0.93, 0.130), (0.98, 0.070), (1, 0.0)]
DB = [(0, 0.0), (0.05, 0.050), (0.15, 0.090), (0.30, 0.130), (0.45, 0.155), (0.60, 0.165), (0.75, 0.160), (0.85, 0.140),
      (0.93, 0.110), (0.98, 0.060), (1, 0.0)]
E  = [(0, 2.2), (0.10, 2.4), (0.30, 2.7), (0.50, 2.75), (0.70, 2.6), (0.90, 2.3), (1, 2.1)]
BULGES = [dict(x=0.085, z=21.0, sx=0.040, sz=0.035, a=0.014),      # full rosy cheeks
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

SCULPT = dict(
    cap=dict(thick=[(0, 0.05), (4, 0.045), (8, 0.035), (12, 0.028), (16, 0.022), (20, 0.018), (24, 0.015), (28, 0.012)], hairline=hairline, edge_k=0.012),
    masses=[dict(c=(0.0, 0.0, 8.0), r=(0.190, 0.200, 0.135), k=0.03)],
    rolls=[
        # the wave (her right): three parallel rolls, the front one biggest
        dict(keys=[(0.075, -0.10, 1.5, 0.020), (0.040, -0.160, 3.2, 0.036), (-0.020, -0.172, 4.8, 0.042), (-0.080, -0.160, 6.8, 0.045), (-0.135, -0.125, 9.5, 0.046),
                   (-0.185, -0.065, 12.3, 0.045), (-0.205, 0.0, 14.0, 0.042), (-0.190, 0.080, 15.0, 0.038), (-0.140, 0.150, 15.5, 0.032), (-0.070, 0.190, 16.0, 0.022)], k=0.006),
        dict(keys=[(0.070, -0.030, 0.4, 0.020), (0.020, -0.100, 1.2, 0.034), (-0.050, -0.125, 2.8, 0.040), (-0.120, -0.095, 5.5, 0.043), (-0.175, -0.040, 8.8, 0.043),
                   (-0.190, 0.040, 11.5, 0.040), (-0.160, 0.120, 13.2, 0.035), (-0.090, 0.180, 14.5, 0.025)], k=0.006),
        dict(keys=[(0.050, 0.060, 0.3, 0.020), (-0.020, 0.0, 0.6, 0.032), (-0.090, -0.020, 2.2, 0.038), (-0.145, 0.030, 5.0, 0.040), (-0.160, 0.100, 8.5, 0.038),
                   (-0.120, 0.160, 11.5, 0.032), (-0.050, 0.190, 13.5, 0.022)], k=0.006),
        # her left side, from the part back to the chignon
        dict(keys=[(0.075, -0.12, 2.5, 0.020), (0.110, -0.150, 6.2, 0.034), (0.145, -0.120, 10.0, 0.038), (0.165, -0.050, 12.5, 0.038), (0.160, 0.040, 14.5, 0.036),
                   (0.120, 0.120, 16.0, 0.030), (0.060, 0.170, 16.5, 0.020)], k=0.006),
        dict(keys=[(0.070, -0.050, 0.8, 0.020), (0.110, -0.080, 3.0, 0.032), (0.150, -0.030, 6.5, 0.036), (0.160, 0.050, 10.0, 0.035), (0.130, 0.130, 13.0, 0.030),
                   (0.070, 0.180, 14.5, 0.020)], k=0.006),
        # wisps in front of the ears
        dict(keys=[(-0.150, -0.085, 13.5, 0.010), (-0.152, -0.085, 16.0, 0.011), (-0.147, -0.078, 18.0, 0.008), (-0.140, -0.072, 19.2, 0.004)], k=0.004, n=16),
        dict(keys=[(0.140, -0.080, 13.0, 0.009), (0.146, -0.072, 15.5, 0.009), (0.140, -0.066, 17.2, 0.004)], k=0.004, n=16),
    ],
    grooves=[dict(keys=[(0.075, -0.175, 2.8, 0.006), (0.075, -0.10, 1.0, 0.007), (0.070, 0.0, 0.2, 0.006)], k=0.004)] +
            [dict(keys=[(x * 0.3, 0.10, 1.2, 0.005), (x * 0.8, 0.17, 5.0, 0.006), (x, 0.197, 9.5, 0.006), (x * 0.9, 0.19, 13.0, 0.005)], k=0.004)
             for x in (-0.10, -0.05, 0.0, 0.05, 0.10)],
    box=((-0.30, 0.02 - 0.27, zp(29.0)), (0.27, 0.02 + 0.25, zp(-1.0))), voxel=0.005, tris=7500, smooth=3,
)

# ---- chignon: a thick rope coiled in a tightening spiral, axis pointing back and a little down
BUN = dict(centre=(-0.015, 0.185, 20.8), axis=(0.0, 1.0, -0.15), up=(0, 0, 1), turns=1.55, r_out=0.096, r_in=0.020,
           depth=0.035, lean=0.0, start=math.radians(100), squash=(1.12, 0.86), tighten=1.0,
           rope=[(0.0, 0.036), (0.08, 0.055), (0.4, 0.053), (0.8, 0.043), (1.0, 0.024)],
           core=(0.114, 0.096, 0.070, 0.0), n_samples=96, n_ring=14, strands=(1.5, 0.10))

# ---- body
NECK = dict(rings=[(24.0, 0.108, 0.104, 1.0, 0.018), (27.5, 0.112, 0.110, 1.0, 0.016), (29.0, 0.118, 0.116, 1.0, 0.014),
                   (30.0, 0.150, 0.130, 1.0, 0.012), (30.6, 0.200, 0.145, 0.95, 0.012), (31.2, 0.250, 0.157, 0.92, 0.010),
                   (32.0, 0.294, 0.174, 0.90, 0.008), (33.0, 0.330, 0.190, 0.85, 0.004), (34.5, 0.320, 0.210, 0.80, -0.004)],
            split=29.5, blend=0.02, n=28)
BOD = dict(profiles=[(49.2, 0.222, 0.205, 0.92, -0.034), (47.4, 0.214, 0.196, 0.92, -0.035), (46.0, 0.216, 0.198, 0.90, -0.035),
                     (44.0, 0.232, 0.213, 0.88, -0.034), (42.0, 0.242, 0.228, 0.86, -0.033), (40.0, 0.250, 0.250, 0.85, -0.032),
                     (38.0, 0.262, 0.262, 0.83, -0.027), (36.0, 0.290, 0.254, 0.80, -0.016), (34.5, 0.340, 0.228, 0.80, -0.004),
                     (33.0, 0.345, 0.205, 0.85, 0.004), (32.0, 0.310, 0.185, 0.90, 0.010), (31.0, 0.262, 0.165, 0.95, 0.014)],
           neck=dict(kind='bateau', side=31.0, front=32.4, back=31.9), waist=47.4, ncol=64, nrow=26, lip=0.006)
A = dict(
    shoulder=(0.182, 36.5), shoulder_y=0.005, elbow=(0.215, 0.0, 49.0), wrist=(0.285, -0.045, 58.5),
    sleeve_end=58.8, cuff_end=58.8, sleeve=None, n=16,
    stations=[('end', 0.058, 0.054), (56.0, 0.064, 0.060), (52.0, 0.074, 0.068), (49.5, 0.078, 0.072), (46.0, 0.082, 0.078),
              (42.0, 0.086, 0.082), (38.5, 0.088, 0.086), (('j', -0.005), 0.088, 0.088), (('j', 0.02), 0.075, 0.078), (('j', 0.035), 0.040, 0.045)],
    hand=dict(palm_len=0.080, palm_w=0.088, palm_t=0.044, out=0.004, finger_out=0.004,
              fingers=[(-0.029, 0.0118, 0.066, 1.1), (-0.010, 0.0124, 0.070, 1.2), (0.010, 0.0120, 0.068, 1.2), (0.028, 0.0108, 0.060, 1.15)],
              thumb=(-0.037, 0.009, 0.022, 0.0128, 0.050, 0.40)),
)
SLV = dict(kind='cap', end=36.8, slant=0.022, lip=0.005, n=24,
           stations=[('end', 0.112, 0.110), (35.8, 0.114, 0.112), (('j', 0.012), 0.110, 0.112), (('j', 0.030), 0.090, 0.098), (('j', 0.046), 0.040, 0.050)])
BELT = dict(kind='metal', top=46.4, bot=48.4, thick=0.006, mat='gold', n=72)
SKIRT = dict(top=47.2, hem=90.9,
             profile=[(47.2, 0.108, 0.098, -0.035), (48.5, 0.116, 0.104, -0.033), (50.0, 0.146, 0.126, -0.027), (52.0, 0.168, 0.145, -0.024),
                      (54.0, 0.185, 0.160, -0.019), (56.0, 0.202, 0.176, -0.016), (58.0, 0.216, 0.188, -0.015), (60.0, 0.231, 0.199, -0.013),
                      (64.0, 0.257, 0.222, -0.011), (68.0, 0.283, 0.245, -0.009), (72.0, 0.307, 0.264, -0.007), (76.0, 0.330, 0.283, -0.005),
                      (80.0, 0.351, 0.301, -0.004), (84.0, 0.370, 0.318, -0.003), (88.0, 0.389, 0.333, -0.001), (92.0, 0.398, 0.345, 0.0)],
             folds=dict(n=14, amp=[(47.2, 0.0), (50.0, 0.002), (52.0, 0.004), (60.0, 0.009), (70.0, 0.014), (80.0, 0.024), (90.9, 0.030)], sharp=0.5, phase=0.0),
             hem_wave=0.006, nr_per_fold=7, rows=30, lip=0.010, lining=0.10,
             weights=dict(sway=0.22, follow=0.0, top_spine=0.35))
LEGS = dict(leg_x=0.095, leg_y=0.0, n=14,
            stations=[(61.0, 0.120, 0.125), (70.0, 0.108, 0.112), (80.0, 0.090, 0.094), (86.0, 0.098, 0.102), (91.0, 0.088, 0.094), (94.0, 0.078, 0.084), (96.0, 0.072, 0.078)])
SHOES = dict(leg_x=0.095, y=0.0, len=0.25, w=0.088, heel=0.066, heel_h=0.036, heel_len=0.044, collar=0.090, vamp=0.058,
             splay=0.26, out=0.010, foot_top=0.105, ball=0.12, mat='shoe')
EAR = dict(kind='stud', r=0.015, x=0.165, dy=-0.02, z=22.3, mat='pearl')
RIG = dict(hip=63.0, knee=80.0, ankle=95.0, waist=47.4, shoulder_top=31.5, neck_y=0.015, hand_end=66.0, leg_x=0.095,
           heel=0.066, ball=0.12, arm=A, walk_kw=dict(skirt=True))

def build(g):
    g.set_head(W, DF, DB, E, BULGES)
    DK.sculpt_hair(g, SCULPT)
    DK.coil_bun(g, BUN)
    GK.head(g, cull_in=g.hair_covers)
    GK.ears(g); GK.eyes(g); GK.brows(g); GK.nose(g)
    DK.lips(g, g.C['lips']); DK.earrings(g, EAR)
    DK.neck_yoke(g, NECK)
    DK.bodice(g, BOD)
    GK.arms(g, A); GK.hands(g, A)
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
