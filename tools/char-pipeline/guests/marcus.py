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
    z_hair_top=0.2, z_skull_top=2.9, z_hairline=8.1, z_brow=13.1, z_eye=17.8, z_nose=20.9, z_mouth=24.8, z_chin=31.6, z_ear=20.2,
    head_y=0.06, z_shoulder_top=35.3,
    ear_style='round', ear_seg=(20, 14), ear_h=0.140, ear_w=0.110, ear_out=0.024, ear_y=0.034, ear_tilt=0.78, ear_thick=0.034, ear_rim=0.010, ear_bowl=0.016, ear_sink=0.022,
    eye_x=0.0635, eye_w=0.038, eye_h=0.088, eye_lift=0.003,
    brow=dict(x0=0.032, x1=0.113, z=12.8, thick=0.039, arch=0.015, drop_in=-0.004, drop_out=0.017,
              profile=[(0.0, 0.30), (0.05, 0.82), (0.14, 0.97), (0.45, 1.0), (0.85, 0.90), (0.95, 0.72), (1.0, 0.30)], flat=0.5),
    nose_w=0.081, nose_h=0.068, nose_d=0.062, nose_out=0.035, nose_top=1.15,
    mouth=dict(w=0.150, z=24.8, rise=0.030, sag=0.007, thick=0.0105),
    neck_r=0.094, neck_y=0.028,
    tint=dict(spots=[(0.110, 23.0, 0.045, 0.035, 1.0), (0.0, 20.9, 0.03, 0.025, 0.55)], g=0.07, b=0.12),
    groove_dark=(0.008, 0.50),
    # the crown faces the hall's overhead lamps (2-5x the light on the sides): author it darker and a touch warmer so
    # the top of the hair still reads dark brown from the practice camera, while the sides keep their value
    up_dark={'Hair': (0.89, 0.7, (0.97, 1.0, 1.03))},
    sheen={'Shoe': (0.34, [((0.2, -0.45, 0.87), 14.0, 1.0), ((0.0, -1.0, 0.3), 16.0, 0.8), ((0.9, 0.0, 0.45), 16.0, 0.5), ((-0.9, 0.0, 0.45), 16.0, 0.5)]), 'Hair': (0.55, (-0.15, -0.85, 0.35), 2.0)},
)
COLOURS = dict(
    # Skin and tie keep the neutral-preview tuning (they read right in the lobby: skin median ~#b15a1a, tie ~#680d0d).
    # Cloth, hair and shoes now use the lobby-measured in-game palette (guest_kit.PALETTE): under the hotel's warm
    # lamps the suit stays navy (never lavender), the hair dark brown (not orange/taupe), the shoes black leather.
    skin='#dc8a5e', hair=GK.PALETTE['hair_dark_brown'], brow='#2e2019', mouth='#3a2218', eye='#0b0b0d',
    jacket=GK.PALETTE['navy'], trouser=GK.PALETTE['navy_trouser'], button='#1b1e28', shade='#191c28',
    shirt='#f8f0e4', tie='#843c48',
    shoe=GK.PALETTE['shoe_black'], sole='#1a1818',  # the bake's shoe sheen adds the toe/heel highlights
)

# ---- skull tables by f (0 chin .. 1 skull top); face: broad U jaw, full cheeks, rounded-square
W  = [(0, 0.0), (0.01, 0.066), (0.03, 0.098), (0.06, 0.121), (0.10, 0.138), (0.15, 0.154), (0.22, 0.164), (0.30, 0.169),
      (0.40, 0.168), (0.50, 0.165), (0.60, 0.162), (0.70, 0.158), (0.80, 0.152), (0.88, 0.141), (0.94, 0.117), (0.98, 0.072), (1, 0.0)]
DF = [(0, 0.0), (0.02, 0.182), (0.05, 0.204), (0.10, 0.214), (0.17, 0.216), (0.25, 0.219), (0.35, 0.219), (0.45, 0.211),
      (0.55, 0.205), (0.66, 0.203), (0.76, 0.197), (0.85, 0.181), (0.92, 0.150), (0.97, 0.095), (1, 0.0)]
DB = [(0, 0.0), (0.02, 0.030), (0.06, 0.052), (0.12, 0.075), (0.20, 0.102), (0.30, 0.130), (0.42, 0.158), (0.55, 0.176),
      (0.68, 0.181), (0.78, 0.174), (0.87, 0.155), (0.93, 0.125), (0.98, 0.070), (1, 0.0)]
E  = [(0, 2.0), (0.08, 2.2), (0.25, 2.55), (0.45, 2.65), (0.65, 2.6), (0.85, 2.45), (1, 2.2)]
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
    front=[(0.3, 0.176), (1.0, 0.193), (2.0, 0.204), (3.0, 0.210), (4.0, 0.211), (5.0, 0.210), (6.0, 0.215), (7.0, 0.206), (8.0, 0.200),
           (10.0, 0.200), (14.0, 0.200), (20.0, 0.19), (28.3, 0.08)],
    back=[(0.3, -0.030), (0.6, -0.018), (1.0, 0.012), (1.5, 0.035), (2.0, 0.052), (3.0, 0.083), (4.0, 0.107), (5.0, 0.125), (6.0, 0.143),
          (7.0, 0.166), (8.0, 0.178), (9.0, 0.192), (10.0, 0.207), (11.0, 0.219), (12.0, 0.228), (13.0, 0.237), (14.0, 0.240), (15.0, 0.234),
          (16.0, 0.230), (18.0, 0.221), (20.0, 0.206), (22.0, 0.188), (24.0, 0.164), (26.0, 0.126), (27.0, 0.111), (28.3, 0.080)],
    expo=[(0.3, 2.1), (2, 2.2), (6, 2.35), (12, 2.6), (20, 2.6), (28.3, 2.4)],
    grooves=[dict(keys=[(0.20, 12.5), (0.27, 14.6), (0.34, 16.8), (0.41, 19.0)], depth=0.008, width=0.012, n=40)],
    # the sculpted lock planes, sweeping from the part (his left, u ~0.85) over the top to his right side and back;
    # later (front) locks stand higher, so each steps down onto the one behind it with its own rounded edge
    lock_fields=[dict(keys=[(0.64, 4.5), (0.56, 7.0), (0.52, 12.0), (0.50, 18.0), (0.50, 23.0)], half=0.055, height=0.010, soft=0.010),
                 dict(keys=[(0.74, 2.6), (0.62, 1.6), (0.48, 2.8), (0.40, 6.5), (0.37, 11.5), (0.36, 17.0)], half=0.042, height=0.021, soft=0.010),
                 dict(keys=[(0.80, 3.4), (0.90, 1.4), (0.00, 1.0), (0.10, 1.8), (0.20, 4.2), (0.28, 8.0), (0.34, 12.5)], half=0.038, height=0.032, soft=0.010),
                 dict(keys=[(0.86, 6.0), (0.94, 3.8), (0.02, 3.2), (0.09, 4.2), (0.16, 6.8), (0.23, 10.2), (0.29, 13.8)], half=0.032, height=0.043, soft=0.010)],
    lock_base=0.028, lock_crease=0.009, lock_crease_geo=0.004,
    slope=lambda u: 0.9 - 0.62 * GK.sm((abs(((u + 0.5) % 1.0) - 0.5) - 0.13) / 0.03) * GK.sm((0.26 - abs(((u + 0.5) % 1.0) - 0.5)) / 0.02), t_min=0.010, centre=(0.0, 0.02, 14.5), nlon=92, nrows=42, top=0.3, lip=0.6,
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
    z_f = (5.2 + 3.4 * ss(a / 0.13)) if right else (5.2 - 1.2 * ss(a / 0.07))   # diagonal fringe: high by the part, low under the wave
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
    # side profile (y centre, Blender -Y = forward) fitted to the SIDE panel: chest curving forward from the collar,
    # the back curving in at the waist, the hem flaring slightly over the seat
    profiles=[(66.5, 0.452, 0.372, 0.70, -0.006), (64.0, 0.452, 0.368, 0.70, -0.022), (60.0, 0.448, 0.362, 0.70, -0.026),
              (55.0, 0.446, 0.360, 0.70, -0.032), (50.0, 0.448, 0.358, 0.70, -0.020), (45.0, 0.456, 0.352, 0.72, -0.002),
              (41.0, 0.474, 0.320, 0.76, 0.014), (38.5, 0.492, 0.286, 0.76, 0.022), (36.8, 0.506, 0.252, 0.74, 0.028),
              (35.3, 0.470, 0.222, 0.80, 0.032), (34.0, 0.300, 0.204, 0.96, 0.036), (33.0, 0.200, 0.184, 1.0, 0.040)],
    waist=55.0, hem_hips=0.5, nj=52, ring_dz=0.020, open_apex=60.8, open_hem=0.030, corner=0.050,
    lapel=dict(outline=[(0.004, 52.6), (0.188, 38.4), (0.176, 36.9), (0.146, 37.4), (0.112, 35.2), (0.106, 38.4), (0.076, 45.0)],
               collar=[(0.150, 36.9), (0.180, 36.5), (0.150, 34.0), (0.118, 33.4), (0.104, 34.6), (0.114, 35.4)],
               wrap=dict(top=31.8, front=32.8, open=0.78, v_width=1.2, tip=(0.160, 36.9), th_side=1.55, gap=0.027, gap_neck=0.022, thick=0.007, tuck=0.030, nth=24),
               thick=0.012, lift=0.002, edge_shade=[0, 1, 2, 3], shade_w=0.006, collar_top=31.4, collar_front=34.4, collar_open=0.80, collar_gap=0.020, collar_dy=0.0),
    flaps=[(0.104, 0.224, 56.8, 59.7)], welt=(0.125, 0.192, 46.6, 0.010, 0.008), flap_thick=0.009,
    buttons=[(0.0, 55.6), (0.0, 60.0)], button_r=0.0125, vent=57.0,
)
SH = dict(max_edge=0.045, lift=0.008, v=[(-0.098, 33.6), (0.098, 33.6), (0.104, 38.4), (0.084, 45.0), (0.006, 51.8), (-0.006, 51.8), (-0.084, 45.0), (-0.104, 38.4)], collar_top=29.8, collar_v=31.2, v_width=0.60, v_open=0.30,
          wrap=dict(top=29.2, v=33.2, open=0.10, v_width=0.85, tip=(0.085, 36.0), th_side=1.0, below=0.012, tuck=0.012, gap=0.008, gap_neck=0.010, thick=0.005, nth=24),
          point=[(0.010, 33.4), (0.048, 30.9), (0.110, 31.8), (0.100, 37.4)])
TIE = dict(knot=(33.3, 36.8), knot_w=(0.030, 0.062), blade=[(-0.017, 36.6), (0.017, 36.6), (0.042, 49.4), (0.0, 52.6), (-0.042, 49.4)], thick=0.009)
A = dict(
    shoulder=(0.222, 37.8), shoulder_y=0.0, elbow=(0.283, 0.012, 52.0), wrist=(0.312, -0.030, 63.2),
    sleeve_end=62.2, cuff_end=64.1, sleeve='jacket', n=20,
    stations=[('end', 0.132, 0.128), (58.0, 0.134, 0.132), (53.0, 0.138, 0.138), (47.0, 0.146, 0.148), (42.0, 0.150, 0.152),
              (('j', -0.01), 0.152, 0.156), (('j', 0.018), 0.132, 0.142), (('j', 0.034), 0.070, 0.080)],
    cuff_wd=(0.118, 0.114), cufflink=True, sleeve_buttons=3, button_angle=60.0,
    hand=dict(finger_n=7, palm_len=0.106, palm_w=0.124, palm_t=0.074, out=0.014, finger_out=0.015,
              fingers=[(-0.043, 0.0205, 0.100, 1.75), (-0.015, 0.0212, 0.106, 1.85), (0.014, 0.0205, 0.102, 1.85), (0.042, 0.0185, 0.090, 1.75)],
              thumb=(-0.056, 0.016, 0.026, 0.0225, 0.074, 0.55)),
)
P = dict(leg_x=0.106, leg_x_hem=0.121, leg_y=0.015, thigh_w=0.184, thigh_d=0.240, shin_w=0.141, shin_d=0.205, hip=72.5, knee=84.5, crotch=70.5,
         top=58.0, hem=92.3, break_dip=0.012, nl=20,
         leg_profile=[(92.3, 0.146, 0.212), (91.0, 0.141, 0.205), (88.0, 0.146, 0.206), (84.5, 0.157, 0.212), (80.0, 0.168, 0.222), (76.0, 0.178, 0.234), (73.0, 0.183, 0.240)],
         pelvis=[(69.0, 0.95, 0.01, 0.85), (66.5, 1.0, 0.02, 0.78), (63.0, 0.99, 0.0, 0.75), (60.0, 0.95, -0.02, 0.75), (58.0, 0.91, -0.03, 0.8)])
S = dict(n=20, leg_x=0.121, len=0.305, w=0.152, h=0.100, heel=0.070, splay=0.28, out=0.002, y=0.022, laces=3)
RIG = dict(hip=72.5, knee=84.5, ankle=95.8, waist=55.0, shoulder_top=35.3, neck_y=0.028, hand_end=73.4, leg_x=0.112,
           heel=0.070, ball=0.16, arm=A)

def build(g):
    g.set_head(W, DF, DB, E, BULGES)
    GK.hair_shell(g, hairline=hairline, edge=edge, thin_below=thin_below, **HAIR)
    for name, keys in LOCKS.items(): GK.hair_lock(g, name, keys)
    GK.head(g, nlon=48, nlat=34, cull_in=g.hair_covers)
    GK.ears(g); GK.eyes(g); GK.brows(g); GK.nose(g); GK.mouth(g)
    GK.neck(g)
    GK.jacket(g, J); GK.lapels(g, J); GK.pockets(g, J); GK.buttons(g, J); GK.back_seam(g, J)
    GK.shirt_front(g, SH); GK.collar(g, SH); GK.tie(g, TIE)
    GK.arms(g, A); GK.cuffs(g, A); GK.hands(g, A)
    GK.trousers(g, P); GK.shoes(g, S)
