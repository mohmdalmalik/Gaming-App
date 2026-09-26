# Marcus — navy single-breasted notch-lapel suit, burgundy tie, dark-brown side-swept hair, caramel skin.
# Reference: tools/char-pipeline/ref/marcus-sheet.png (panels in ref/panels-marcus/). Built by
#   python3 tools/char-pipeline/make_guest.py marcus   -> assets/characters/marcus.glb
#
# Measurements (sheet FRONT panel: figure 568 px = H = 1.66 m, 2.92 mm/px; SIDE panel 570 px; HEAD FRONT
# close-up: hair top -> chin 198 px = 0.30 H). Heights are percent of standing height from the top:
#   head   hair top 0.2, hairline 8.4, brows 12.2, eyes 16.9, nose ball 20.2, smile 24.0 (ends 23.0), chin 30.3,
#          ears 17.2-24.8 (centre 21.0). Face half-width 0.167 at the cheeks (full, rounded-square: 0.150 at 26 %,
#          0.122 at 28.3 %), ears out to 0.232 from the head axis. Hair half-widths 0.225 (his right, the sweep's
#          overhang, at 10 %) / 0.20 (his left); side view: front roll 0.22 ahead of the head axis, back of the hair
#          0.239 behind it (at 14 %), nape 27.5 %. The head axis sits 0.06 behind the body centre (SIDE: the chest
#          is further forward than the face).
#   body   collar 30-33, shoulder top 35.3 (points +-0.28 at 36.6 incl. the sleeve caps), lapel V 52.6, buttons
#          55.6 / 60.0, flap pockets 57-59.4 (x 0.115-0.215), chest welt 46.5 (his left), hem 66.5; jacket 0.452
#          wide x 0.36 deep (boxy, straight sides). Sleeves 0.13-0.15 wide, hanging out to the hands at x +-0.315;
#          cuffs 62.2-64.1; hands 63.9-73.6 (0.14 across in front, 0.16 front-to-back). Legs: centres +-0.102,
#          0.19-0.195 wide, trousers break at 92.3; shoes 0.33 long, toes turned out.
import math
import guest_kit as GK
import victor_lib as L

H = 1.66
def zp(p): return H * (1 - p / 100)

CFG = dict(
    z_hair_top=0.2, z_skull_top=3.8, z_hairline=8.1, z_brow=13.1, z_eye=17.8, z_nose=20.9, z_mouth=24.8, z_chin=30.8, z_ear=20.2,
    head_y=0.06, z_shoulder_top=35.3,
    ear_h=0.124, ear_w=0.112, ear_out=0.058, ear_y=0.004, ear_tilt=0.85, ear_cup=0.020, ear_roll=0.12, ear_top_wide=0.20, ear_rim=0.017, ear_bowl=0.012,
    eye_x=0.069, eye_w=0.042, eye_h=0.071, eye_lift=0.003,
    brow=dict(x0=0.033, x1=0.118, z=13.1, thick=0.037, arch=0.010, drop_in=0.005, drop_out=0.013,
              profile=[(0.0, 0.30), (0.05, 0.82), (0.14, 0.97), (0.45, 1.0), (0.85, 0.90), (0.95, 0.72), (1.0, 0.30)], flat=0.5),
    nose_w=0.086, nose_h=0.072, nose_d=0.066, nose_out=0.040, nose_top=1.15,
    mouth=dict(w=0.150, z=24.8, rise=0.022, sag=0.005, thick=0.009),
    neck_r=0.094, neck_y=0.028,
    tint=dict(spots=[(0.110, 23.0, 0.045, 0.035, 1.0), (0.0, 20.9, 0.03, 0.025, 0.55)], g=0.07, b=0.12),
    groove_dark=(0.010, 0.60),
    sheen={'Shoe': (0.34, [((0.2, -0.45, 0.87), 14.0, 1.0), ((0.0, -1.0, 0.3), 16.0, 0.8), ((0.9, 0.0, 0.45), 16.0, 0.5), ((-0.9, 0.0, 0.45), 16.0, 0.5)]), 'Hair': (0.50, (-0.2, -0.40, 0.89), 2.0)},
)
COLOURS = dict(
    # Two lightings pull in opposite directions: the preview's neutral light + the game's Neutral tone mapping
    # (which subtracts up to 0.04 linear from every channel and so re-saturates dark colours) wants greyish bases
    # to land on the sheet's measured medians (skin #c26b39, hair #342520, suit #232a3e, tie #7a282d); the hall's
    # warm light halves blue and would turn such a navy brown-black. These bases are the compromise: the suit
    # renders close to the sheet in the neutral preview (median ~#1c2a4e) and a very dark navy in the hall.
    skin='#dc8a5e', hair='#705c57', brow='#2e2019', mouth='#3a2218', eye='#0b0b0d',
    jacket='#3f4764', trouser='#3b425d', button='#1b1e28', shade='#191c28',
    shirt='#f8f0e4', tie='#843c48',
    shoe='#5f5a58', sole='#1a1818',  # shoe base is lighter: the bake's sheen darkens all but the toe/heel highlights
)

# ---- skull tables by f (0 chin .. 1 skull top); face: broad U jaw, full cheeks, rounded-square
W  = [(0, 0.0), (0.015, 0.076), (0.04, 0.110), (0.075, 0.132), (0.12, 0.152), (0.16, 0.159), (0.24, 0.165), (0.36, 0.167),
      (0.47, 0.168), (0.59, 0.168), (0.70, 0.166), (0.80, 0.160), (0.88, 0.147), (0.94, 0.120), (0.98, 0.072), (1, 0.0)]
DF = [(0, 0.0), (0.02, 0.170), (0.05, 0.195), (0.10, 0.208), (0.17, 0.216), (0.25, 0.219), (0.35, 0.219), (0.45, 0.211),
      (0.55, 0.205), (0.66, 0.203), (0.76, 0.197), (0.85, 0.181), (0.92, 0.150), (0.97, 0.095), (1, 0.0)]
DB = [(0, 0.0), (0.02, 0.030), (0.06, 0.052), (0.12, 0.075), (0.20, 0.102), (0.30, 0.130), (0.42, 0.158), (0.55, 0.176),
      (0.68, 0.181), (0.78, 0.174), (0.87, 0.155), (0.93, 0.125), (0.98, 0.070), (1, 0.0)]
E  = [(0, 2.3), (0.08, 2.6), (0.25, 2.95), (0.45, 3.05), (0.65, 2.9), (0.85, 2.6), (1, 2.2)]
BULGES = [dict(x=0.104, z=23.4, sx=0.052, sz=0.045, a=0.028),      # cheek fullness beside the smile
          dict(x=0.0, z=18.6, sx=0.017, sz=0.028, a=0.032),        # nose bridge rising into the ball
          dict(x=0.0, z=28.7, sx=0.050, sz=0.020, a=0.005)]        # soft chin

# ---- hair: envelope extents (metres from the head axis) by height (pct)
HAIR = dict(          # silhouette extents measured on the FRONT (widths) and SIDE (front/back) panels, per pct height
    wr=[(0.3, -0.016), (0.6, -0.007), (1.0, 0.025), (1.5, 0.060), (2.0, 0.077), (3.0, 0.118), (4.0, 0.145), (5.0, 0.159), (6.0, 0.174),
        (7.0, 0.183), (8.0, 0.191), (9.0, 0.197), (10.0, 0.208), (11.0, 0.216), (12.0, 0.222), (13.0, 0.218), (14.0, 0.212), (15.0, 0.207),
        (16.0, 0.200), (17.0, 0.194), (19.0, 0.186), (22.0, 0.178), (24.5, 0.165), (26.0, 0.140), (27.0, 0.130), (28.3, 0.100)],
    wl=[(0.3, 0.098), (0.6, 0.104), (1.0, 0.115), (1.5, 0.124), (2.0, 0.130), (3.0, 0.139), (4.0, 0.145), (5.0, 0.152), (6.0, 0.177),
        (7.0, 0.197), (8.0, 0.205), (9.0, 0.206), (12.0, 0.206), (13.0, 0.203), (14.0, 0.200), (15.0, 0.197), (16.0, 0.194), (17.0, 0.190),
        (19.0, 0.186), (22.0, 0.178), (24.5, 0.165), (26.0, 0.140), (27.0, 0.130), (28.3, 0.100)],
    front=[(0.3, 0.182), (1.0, 0.198), (2.0, 0.211), (3.0, 0.220), (4.0, 0.226), (5.0, 0.228), (6.0, 0.227), (7.0, 0.221), (8.0, 0.209),
           (10.0, 0.200), (14.0, 0.200), (20.0, 0.19), (28.3, 0.08)],
    back=[(0.3, -0.015), (0.6, 0.0), (1.0, 0.035), (1.5, 0.058), (2.0, 0.073), (3.0, 0.105), (4.0, 0.129), (5.0, 0.143), (6.0, 0.158),
          (7.0, 0.170), (8.0, 0.176), (9.0, 0.190), (10.0, 0.207), (11.0, 0.219), (12.0, 0.228), (13.0, 0.237), (14.0, 0.240), (15.0, 0.234),
          (16.0, 0.228), (18.0, 0.216), (20.0, 0.199), (22.0, 0.181), (24.0, 0.158), (26.0, 0.126), (27.0, 0.111), (28.3, 0.080)],
    expo=[(0.3, 2.1), (2, 2.2), (6, 2.35), (12, 2.6), (20, 2.6), (28.3, 2.4)],
    grooves=[
             dict(keys=[(0.80, 3.0), (0.88, 0.9), (0.97, 0.6), (0.06, 1.0), (0.14, 2.6), (0.22, 5.0), (0.30, 7.5), (0.37, 9.5)], depth=0.014, width=0.012),
             dict(keys=[(0.20, 12.8), (0.26, 13.8), (0.33, 14.8), (0.40, 15.8)], depth=0.010, width=0.009),
             dict(keys=[(0.40, 3.5), (0.47, 1.8), (0.55, 1.5), (0.63, 3.0)], depth=0.008, width=0.009)],
    slope=lambda u: 0.9 - 0.62 * GK.sm((abs(((u + 0.5) % 1.0) - 0.5) - 0.13) / 0.03) * GK.sm((0.26 - abs(((u + 0.5) % 1.0) - 0.5)) / 0.02), t_min=0.010, centre=(0.0, 0.02, 14.5), nlon=80, nrows=38, top=0.3, lip=0.6,
)
# rounded locks lying on the cap: the front roll sweeping from his left temple across the forehead to his right
# side (the sheet's big wave), keys (u, pct, width, thickness, lift)
LOCKS = {'LockRoll': [(0.86, 5.0, 0.04, 0.012, -0.010), (0.92, 4.0, 0.085, 0.028, -0.008), (0.99, 3.6, 0.105, 0.032, -0.008), (0.06, 4.0, 0.115, 0.034, -0.007),
                      (0.13, 5.4, 0.115, 0.032, -0.006), (0.20, 7.6, 0.100, 0.028, -0.006), (0.27, 9.8, 0.075, 0.020, -0.006), (0.34, 11.6, 0.035, 0.010, -0.008)]}
def hairline(u):
    """Lower edge of the hair (pct) by longitude: forehead 8.4 (a touch lower on his right where the sweep lands),
    round the forehead corners to the temples, a short sideburn to 19.5 in front of the ear, over the ear at 16,
    down behind the ear to the nape at 27.5."""
    a = abs(((u + 0.5) % 1.0) - 0.5); right = (u % 1.0) < 0.5; ss = GK.sm
    z_f = 7.0 + (2.8 if right else -0.4) * ss((a - 0.02) / 0.11) + 0.6 * ss((a - 0.12) / 0.05)   # a slight dip at the temple corners
    if a < 0.158: return z_f
    if a < 0.175: return z_f + (19.5 - z_f) * ss((a - 0.158) / 0.017)
    if a < 0.222: return 19.5
    if a < 0.245: return 19.5 + (14.6 - 19.5) * ss((a - 0.222) / 0.023)
    if a < 0.300: return 14.6
    if a < 0.380: return 14.6 + (27.0 - 14.6) * ss((a - 0.300) / 0.080)
    return 27.0
def thin_below(u):
    """In front of the ear the sideburn stays flat up to the temple (the full side hair starts above 11 %)."""
    a = abs(((u + 0.5) % 1.0) - 0.5); w = GK.sm((a - 0.145) / 0.02) * GK.sm((0.245 - a) / 0.02)
    return hairline(u) * (1 - w) + 11.0 * w
def edge(u):
    a = abs(((u + 0.5) % 1.0) - 0.5)
    return 0.008 + 0.026 * GK.sm((0.15 - a) / 0.05) + 0.006 * GK.sm((a - 0.17) / 0.03) * GK.sm((0.30 - a) / 0.04)          # a thick rounded edge over the forehead, thin sideburns / nape

# ---- body
J = dict(
    profiles=[(66.5, 0.452, 0.345, 0.70, 0.000), (64.0, 0.452, 0.356, 0.70, -0.003), (60.0, 0.448, 0.364, 0.70, -0.005),
              (55.0, 0.446, 0.366, 0.70, -0.006), (50.0, 0.448, 0.360, 0.70, -0.005), (45.0, 0.456, 0.346, 0.72, -0.002),
              (41.0, 0.470, 0.322, 0.76, 0.004), (38.5, 0.486, 0.292, 0.78, 0.010), (36.8, 0.486, 0.262, 0.80, 0.015),
              (35.3, 0.448, 0.236, 0.86, 0.020), (34.0, 0.300, 0.228, 1.0, 0.028), (33.0, 0.245, 0.222, 1.0, 0.032)],
    waist=55.0, hem_hips=0.5, nj=56, ring_dz=0.020, open_apex=60.8, open_hem=0.030, corner=0.050,
    lapel=dict(outline=[(0.004, 52.6), (0.188, 38.4), (0.176, 36.9), (0.146, 37.4), (0.112, 35.2), (0.106, 38.4), (0.076, 45.0)],
               collar=[(0.150, 36.9), (0.180, 36.5), (0.150, 34.0), (0.118, 33.4), (0.104, 34.6), (0.114, 35.4)],
               thick=0.009, lift=0.002, collar_top=31.4, collar_front=34.4, collar_open=0.80, collar_gap=0.020, collar_dy=0.0),
    flaps=[(0.104, 0.224, 56.8, 59.7)], welt=(0.125, 0.192, 46.6, 0.010, 0.008), flap_thick=0.009,
    buttons=[(0.0, 55.6), (0.0, 60.0)], button_r=0.0125, vent=57.0,
)
SH = dict(max_edge=0.042, v=[(-0.118, 33.1), (0.118, 33.1), (0.112, 38.4), (0.084, 45.0), (0.006, 51.8), (-0.006, 51.8), (-0.084, 45.0), (-0.112, 38.4)], collar_top=29.8, collar_v=31.2, v_width=0.60, v_open=0.30,
          point=[(0.010, 33.4), (0.048, 30.9), (0.110, 31.8), (0.100, 37.4)])
TIE = dict(knot=(33.3, 36.8), knot_w=(0.030, 0.062), blade=[(-0.017, 36.6), (0.017, 36.6), (0.042, 49.4), (0.0, 52.6), (-0.042, 49.4)], thick=0.009)
A = dict(
    shoulder=(0.215, 38.3), shoulder_y=0.0, elbow=(0.285, 0.0, 52.0), wrist=(0.315, 0.0, 63.2),
    sleeve_end=62.2, cuff_end=64.1, sleeve='jacket', n=20,
    stations=[('end', 0.132, 0.128), (58.0, 0.134, 0.132), (53.0, 0.138, 0.138), (47.0, 0.146, 0.148), (42.0, 0.150, 0.152),
              (('j', -0.01), 0.152, 0.156), (('j', 0.018), 0.132, 0.142), (('j', 0.034), 0.070, 0.080)],
    cuff_wd=(0.118, 0.114), cufflink=True, sleeve_buttons=3, button_angle=60.0,
    hand=dict(palm_len=0.108, palm_w=0.120, palm_t=0.070, out=0.014, finger_out=0.013,
              fingers=[(-0.042, 0.0180, 0.096, 1.25), (-0.014, 0.0185, 0.102, 1.35), (0.014, 0.0180, 0.098, 1.35), (0.041, 0.0162, 0.086, 1.3)],
              thumb=(-0.052, 0.014, 0.028, 0.0200, 0.070, 0.45)),
)
P = dict(leg_x=0.106, leg_y=0.015, thigh_w=0.182, thigh_d=0.240, shin_w=0.172, shin_d=0.212, hip=72.5, knee=84.5, crotch=70.5,
         top=58.0, hem=92.3, break_dip=0.012, nl=22,
         pelvis=[(69.0, 0.95, 0.01, 0.85), (66.5, 1.0, 0.03, 0.78), (63.0, 1.0, 0.05, 0.75), (60.0, 0.97, 0.06, 0.75), (58.0, 0.93, 0.05, 0.8)])
S = dict(leg_x=0.106, len=0.305, w=0.152, h=0.100, heel=0.070, splay=0.28, out=0.016, y=0.022, laces=3)
RIG = dict(hip=72.5, knee=84.5, ankle=95.8, waist=55.0, shoulder_top=35.3, neck_y=0.028, hand_end=73.4, leg_x=0.106,
           heel=0.070, ball=0.16, arm=A)

def build(g):
    g.set_head(W, DF, DB, E, BULGES)
    GK.hair_shell(g, hairline=hairline, edge=edge, thin_below=thin_below, **HAIR)
    for name, keys in LOCKS.items(): GK.hair_lock(g, name, keys)
    GK.head(g, cull_in=g.hair_covers)
    GK.ears(g); GK.eyes(g); GK.brows(g); GK.nose(g); GK.mouth(g)
    GK.neck(g)
    GK.jacket(g, J); GK.lapels(g, J); GK.pockets(g, J); GK.buttons(g, J); GK.back_seam(g, J)
    GK.shirt_front(g, SH); GK.collar(g, SH); GK.tie(g, TIE)
    GK.arms(g, A); GK.cuffs(g, A); GK.hands(g, A)
    GK.trousers(g, P); GK.shoes(g, S)
