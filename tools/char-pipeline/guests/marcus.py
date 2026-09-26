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
    z_hair_top=0.2, z_skull_top=3.8, z_hairline=8.1, z_brow=13.1, z_eye=17.8, z_nose=20.9, z_mouth=24.8, z_chin=31.6, z_ear=20.2,
    head_y=0.06, z_shoulder_top=35.3,
    ear_style='round', ear_seg=(24, 18), ear_h=0.140, ear_w=0.110, ear_out=0.024, ear_y=0.034, ear_tilt=0.78, ear_thick=0.034, ear_rim=0.010, ear_bowl=0.016, ear_sink=0.022,
    eye_x=0.069, eye_w=0.044, eye_h=0.074, eye_lift=0.003,
    brow=dict(x0=0.035, x1=0.118, z=13.1, thick=0.032, arch=0.016, drop_in=0.006, drop_out=0.012,
              profile=[(0.0, 0.30), (0.05, 0.82), (0.14, 0.97), (0.45, 1.0), (0.85, 0.90), (0.95, 0.72), (1.0, 0.30)], flat=0.5),
    nose_w=0.086, nose_h=0.072, nose_d=0.066, nose_out=0.040, nose_top=1.15,
    mouth=dict(w=0.150, z=24.8, rise=0.022, sag=0.005, thick=0.009),
    neck_r=0.094, neck_y=0.028,
    tint=dict(spots=[(0.110, 23.0, 0.045, 0.035, 1.0), (0.0, 20.9, 0.03, 0.025, 0.55)], g=0.07, b=0.12),
    groove_dark=(0.010, 0.55),
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
W  = [(0, 0.0), (0.01, 0.074), (0.03, 0.108), (0.06, 0.130), (0.10, 0.145), (0.15, 0.154), (0.22, 0.164), (0.30, 0.169),
      (0.40, 0.168), (0.50, 0.165), (0.60, 0.162), (0.70, 0.158), (0.80, 0.152), (0.88, 0.141), (0.94, 0.117), (0.98, 0.072), (1, 0.0)]
DF = [(0, 0.0), (0.02, 0.182), (0.05, 0.204), (0.10, 0.214), (0.17, 0.216), (0.25, 0.219), (0.35, 0.219), (0.45, 0.211),
      (0.55, 0.205), (0.66, 0.203), (0.76, 0.197), (0.85, 0.181), (0.92, 0.150), (0.97, 0.095), (1, 0.0)]
DB = [(0, 0.0), (0.02, 0.030), (0.06, 0.052), (0.12, 0.075), (0.20, 0.102), (0.30, 0.130), (0.42, 0.158), (0.55, 0.176),
      (0.68, 0.181), (0.78, 0.174), (0.87, 0.155), (0.93, 0.125), (0.98, 0.070), (1, 0.0)]
E  = [(0, 2.2), (0.08, 2.35), (0.25, 2.55), (0.45, 2.65), (0.65, 2.6), (0.85, 2.45), (1, 2.2)]
BULGES = [dict(x=0.104, z=24.0, sx=0.055, sz=0.050, a=0.040),      # cheek fullness beside the smile
          dict(x=0.0, z=18.6, sx=0.017, sz=0.028, a=0.032),        # nose bridge rising into the ball
          dict(x=0.0, z=28.7, sx=0.050, sz=0.020, a=0.005)]        # soft chin

# ---- hair: envelope extents (metres from the head axis) by height (pct)
HAIR = dict(          # silhouette extents measured on the FRONT (widths) and SIDE (front/back) panels, per pct height
    wr=[(0.3, -0.016), (0.6, -0.007), (1.0, 0.025), (1.5, 0.060), (2.0, 0.077), (3.0, 0.118), (4.0, 0.145), (5.0, 0.159), (6.0, 0.174),
        (7.0, 0.183), (8.0, 0.191), (9.0, 0.197), (10.0, 0.208), (11.0, 0.216), (12.0, 0.222), (13.0, 0.218), (14.0, 0.212), (15.0, 0.207),
        (16.0, 0.200), (17.0, 0.194), (19.0, 0.186), (22.0, 0.176), (24.5, 0.160), (26.0, 0.130), (27.0, 0.105), (28.3, 0.070)],
    wl=[(0.3, 0.098), (0.6, 0.104), (1.0, 0.115), (1.5, 0.124), (2.0, 0.130), (3.0, 0.139), (4.0, 0.145), (5.0, 0.152), (6.0, 0.177),
        (7.0, 0.197), (8.0, 0.205), (9.0, 0.206), (12.0, 0.206), (13.0, 0.203), (14.0, 0.200), (15.0, 0.197), (16.0, 0.194), (17.0, 0.190),
        (19.0, 0.186), (22.0, 0.176), (24.5, 0.160), (26.0, 0.130), (27.0, 0.105), (28.3, 0.070)],
    front=[(0.3, 0.190), (1.0, 0.210), (2.0, 0.224), (3.0, 0.230), (4.0, 0.230), (5.0, 0.225), (6.0, 0.215), (7.0, 0.206), (8.0, 0.200),
           (10.0, 0.200), (14.0, 0.200), (20.0, 0.19), (28.3, 0.08)],
    back=[(0.3, -0.015), (0.6, 0.0), (1.0, 0.035), (1.5, 0.058), (2.0, 0.073), (3.0, 0.105), (4.0, 0.129), (5.0, 0.143), (6.0, 0.158),
          (7.0, 0.170), (8.0, 0.176), (9.0, 0.190), (10.0, 0.207), (11.0, 0.219), (12.0, 0.228), (13.0, 0.237), (14.0, 0.240), (15.0, 0.234),
          (16.0, 0.228), (18.0, 0.216), (20.0, 0.199), (22.0, 0.181), (24.0, 0.158), (26.0, 0.126), (27.0, 0.111), (28.3, 0.080)],
    expo=[(0.3, 2.1), (2, 2.2), (6, 2.35), (12, 2.6), (20, 2.6), (28.3, 2.4)],
    grooves=[dict(keys=[(0.86, 5.5), (0.93, 3.2), (0.00, 2.4), (0.07, 2.7), (0.14, 4.2), (0.21, 7.0), (0.27, 10.0), (0.33, 12.5)], depth=0.012, width=0.013, n=60),
             dict(keys=[(0.78, 4.0), (0.86, 1.6), (0.97, 0.9), (0.08, 1.2), (0.18, 2.8), (0.27, 5.6), (0.35, 8.8), (0.41, 11.5)], depth=0.011, width=0.013, n=60),
             dict(keys=[(0.20, 12.5), (0.27, 14.6), (0.34, 16.8), (0.41, 19.0)], depth=0.009, width=0.012, n=40),
             dict(keys=[(0.62, 6.0), (0.55, 9.0), (0.50, 13.0), (0.47, 18.0)], depth=0.008, width=0.012, n=40)],
    slope=lambda u: 0.9 - 0.62 * GK.sm((abs(((u + 0.5) % 1.0) - 0.5) - 0.13) / 0.03) * GK.sm((0.26 - abs(((u + 0.5) % 1.0) - 0.5)) / 0.02), t_min=0.010, centre=(0.0, 0.02, 14.5), nlon=84, nrows=40, top=0.3, lip=0.6,
)
# rounded locks lying on the cap: the front roll sweeping from his left temple across the forehead to his right
# side (the sheet's big wave), keys (u, pct, width, thickness, lift)
# extra rounded locks lying on the cap (GK.hair_lock keys: u, pct, width, thickness, lift). None for Marcus: narrow
# ribbon locks crinkled the surface; the wide soft grooves above carry his lock lines instead.
LOCKS = {}
def hairline(u):
    """Lower edge of the hair (pct) by longitude: the fringe (7 at the centre, lower toward his right where the wave
    lands), round the temple corner (12.5), a narrow POINTED sideburn in front of the ear (tip 19.5), over the ear
    (14.2), then a rounded U behind the ear down to the nape point (28.4 at the centre back)."""
    a = abs(((u + 0.5) % 1.0) - 0.5); right = (u % 1.0) < 0.5; ss = GK.sm
    z_f = (6.6 + 3.0 * ss(a / 0.13)) if right else (6.6 - 1.2 * ss(a / 0.07))   # diagonal fringe: high by the part, low under the wave
    z = z_f + (12.5 - z_f) * ss((a - 0.15) / 0.04)                        # temple corner
    sb = max(0.0, 1.0 - abs(a - 0.212) / 0.020) ** 1.3                      # sideburn: a V pointing down
    z = z + (19.5 - z) * sb * ss((0.235 - a) / 0.01 + 1.0)
    z = z + (14.2 - z) * ss((a - 0.228) / 0.012)                            # over the ear
    z_n = 25.6 + 2.6 * ss((a - 0.36) / 0.14)                                 # the nape: a soft U, lowest at the centre back
    return z + (z_n - z) * ss((a - 0.292) / 0.055)                          # straight down behind the ear
def thin_below(u):
    """In front of the ear the sideburn stays flat up to the temple (the full side hair starts above 11 %)."""
    a = abs(((u + 0.5) % 1.0) - 0.5); w = GK.sm((a - 0.17) / 0.02) * GK.sm((0.245 - a) / 0.02)
    return hairline(u) * (1 - w) + 11.0 * w
def edge(u):
    a = abs(((u + 0.5) % 1.0) - 0.5)
    right = (u % 1.0) < 0.5
    return 0.008 + (0.026 + (0.010 * GK.sm((0.13 - abs(a - 0.07)) / 0.06) if right else 0.0)) * GK.sm((0.15 - a) / 0.05) + 0.006 * GK.sm((a - 0.17) / 0.03) * GK.sm((0.30 - a) / 0.04)          # a thick rounded edge over the forehead, thin sideburns / nape

# ---- body
J = dict(
    profiles=[(66.5, 0.452, 0.345, 0.70, 0.000), (64.0, 0.452, 0.356, 0.70, -0.003), (60.0, 0.448, 0.364, 0.70, -0.005),
              (55.0, 0.446, 0.366, 0.70, -0.006), (50.0, 0.448, 0.360, 0.70, -0.005), (45.0, 0.456, 0.346, 0.72, -0.002),
              (41.0, 0.474, 0.318, 0.76, 0.004), (38.5, 0.492, 0.284, 0.76, 0.010), (36.8, 0.506, 0.248, 0.74, 0.014),
              (35.3, 0.470, 0.218, 0.80, 0.018), (34.0, 0.300, 0.200, 0.96, 0.024), (33.0, 0.200, 0.180, 1.0, 0.028)],
    waist=55.0, hem_hips=0.5, nj=52, ring_dz=0.020, open_apex=60.8, open_hem=0.030, corner=0.050,
    lapel=dict(outline=[(0.004, 52.6), (0.188, 38.4), (0.176, 36.9), (0.146, 37.4), (0.112, 35.2), (0.106, 38.4), (0.076, 45.0)],
               collar=[(0.150, 36.9), (0.180, 36.5), (0.150, 34.0), (0.118, 33.4), (0.104, 34.6), (0.114, 35.4)],
               wrap=dict(top=31.8, front=32.8, open=0.78, v_width=1.2, tip=(0.160, 36.9), th_side=1.55, gap=0.020, gap_neck=0.022, thick=0.008),
               thick=0.012, lift=0.002, edge_shade=[0, 1, 2, 3], shade_w=0.006, collar_top=31.4, collar_front=34.4, collar_open=0.80, collar_gap=0.020, collar_dy=0.0),
    flaps=[(0.104, 0.224, 56.8, 59.7)], welt=(0.125, 0.192, 46.6, 0.010, 0.008), flap_thick=0.009,
    buttons=[(0.0, 55.6), (0.0, 60.0)], button_r=0.0125, vent=57.0,
)
SH = dict(max_edge=0.042, v=[(-0.118, 33.1), (0.118, 33.1), (0.112, 38.4), (0.084, 45.0), (0.006, 51.8), (-0.006, 51.8), (-0.084, 45.0), (-0.112, 38.4)], collar_top=29.8, collar_v=31.2, v_width=0.60, v_open=0.30,
          wrap=dict(top=29.2, v=33.2, open=0.10, v_width=0.85, tip=(0.085, 36.0), th_side=1.0, below=0.012, gap=0.008, gap_neck=0.010, thick=0.005),
          point=[(0.010, 33.4), (0.048, 30.9), (0.110, 31.8), (0.100, 37.4)])
TIE = dict(knot=(33.3, 36.8), knot_w=(0.030, 0.062), blade=[(-0.017, 36.6), (0.017, 36.6), (0.042, 49.4), (0.0, 52.6), (-0.042, 49.4)], thick=0.009)
A = dict(
    shoulder=(0.222, 37.8), shoulder_y=0.0, elbow=(0.285, 0.0, 52.0), wrist=(0.315, 0.0, 63.2),
    sleeve_end=62.2, cuff_end=64.1, sleeve='jacket', n=20,
    stations=[('end', 0.132, 0.128), (58.0, 0.134, 0.132), (53.0, 0.138, 0.138), (47.0, 0.146, 0.148), (42.0, 0.150, 0.152),
              (('j', -0.01), 0.152, 0.156), (('j', 0.018), 0.132, 0.142), (('j', 0.034), 0.070, 0.080)],
    cuff_wd=(0.118, 0.114), cufflink=True, sleeve_buttons=3, button_angle=60.0,
    hand=dict(finger_n=8, palm_len=0.106, palm_w=0.124, palm_t=0.074, out=0.014, finger_out=0.015,
              fingers=[(-0.043, 0.0205, 0.100, 1.75), (-0.015, 0.0212, 0.106, 1.85), (0.014, 0.0205, 0.102, 1.85), (0.042, 0.0185, 0.090, 1.75)],
              thumb=(-0.056, 0.016, 0.026, 0.0225, 0.074, 0.55)),
)
P = dict(leg_x=0.106, leg_x_hem=0.121, leg_y=0.015, thigh_w=0.184, thigh_d=0.240, shin_w=0.141, shin_d=0.205, hip=72.5, knee=84.5, crotch=70.5,
         top=58.0, hem=92.3, break_dip=0.012, nl=20,
         leg_profile=[(92.3, 0.146, 0.212), (91.0, 0.141, 0.205), (88.0, 0.146, 0.206), (84.5, 0.157, 0.212), (80.0, 0.168, 0.222), (76.0, 0.178, 0.234), (73.0, 0.183, 0.240)],
         pelvis=[(69.0, 0.95, 0.01, 0.85), (66.5, 1.0, 0.03, 0.78), (63.0, 1.0, 0.05, 0.75), (60.0, 0.97, 0.06, 0.75), (58.0, 0.93, 0.05, 0.8)])
S = dict(n=20, leg_x=0.121, len=0.305, w=0.152, h=0.100, heel=0.070, splay=0.28, out=0.002, y=0.022, laces=3)
RIG = dict(hip=72.5, knee=84.5, ankle=95.8, waist=55.0, shoulder_top=35.3, neck_y=0.028, hand_end=73.4, leg_x=0.112,
           heel=0.070, ball=0.16, arm=A)

def build(g):
    g.set_head(W, DF, DB, E, BULGES)
    GK.hair_shell(g, hairline=hairline, edge=edge, thin_below=thin_below, **HAIR)
    for name, keys in LOCKS.items(): GK.hair_lock(g, name, keys)
    GK.head(g, nlon=52, nlat=36, cull_in=g.hair_covers)
    GK.ears(g); GK.eyes(g); GK.brows(g); GK.nose(g); GK.mouth(g)
    GK.neck(g)
    GK.jacket(g, J); GK.lapels(g, J); GK.pockets(g, J); GK.buttons(g, J); GK.back_seam(g, J)
    GK.shirt_front(g, SH); GK.collar(g, SH); GK.tie(g, TIE)
    GK.arms(g, A); GK.cuffs(g, A); GK.hands(g, A)
    GK.trousers(g, P); GK.shoes(g, S)
