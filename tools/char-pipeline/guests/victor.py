# Victor — midnight-navy tuxedo with black satin PEAKED lapels, one button, white dress shirt with three black studs,
# black bow tie, big black handlebar moustache, dark-brown swept hair (side part on his left, sweep to his right),
# peach skin. Rebuilt with the guest kit (the original builder, make_victor.py, is kept as the old reference).
# Reference: tools/char-pipeline/ref/victor-sheet.png (panels in ref/panels/, cut by make_panels.py; light-grey
# background, its own face-panel scale). Built by
#   python3 tools/char-pipeline/make_guest.py victor   -> assets/characters/victor.glb   (GUEST_OUT=... for a scratch build)
#
# Measurements (sheet FRONT panel: figure 469 px = H = 1.66 m, 3.54 mm/px; SIDE panel for depths; x from the body
# centre, side depths from the leg axis). Heights in percent of standing height from the top:
#   head   hair top 0.2 (the front wave is the highest point in profile), hairline 8.6-9 (lower on his right under the
#          sweep), brows 13.0, eyes 17.3, nose 20.3, moustache 22.4-25 (centre 23.7), mouth 27.1, chin 31.5-32, ears
#          16.5-27. Hair half-widths 0.251 (his right, the sweep, at 10 %) / 0.223 (his left); hair 0.45 deep at 12 %.
#   body   shirt collar 31.8, bow tie 33.9-40.3 (0.17 wide), studs 40.9 / 45.2 / 49.7, peaked lapel tips +-0.177 at 38,
#          lapels cross at 52.5, one button 55.2, jetted pockets 57 (x 0.096-0.17), chest welt on his left 44.6,
#          hem 66. Jacket 0.40 wide x 0.29-0.30 deep (slim), shoulders 0.44 across the sleeve caps; sleeves 0.124
#          wide; cuffs 61.5-63; hands centred at x +-0.337, down to 72.5. Legs 0.17 -> 0.13 wide, centres +-0.10 ->
#          +-0.123 at the hem (93); crotch 70.
import math
import guest_kit as GK
import male_extras as MX
import victor_lib as L

H = 1.66
def zp(p): return H * (1 - p / 100)

CFG = dict(
    z_hair_top=0.2, z_skull_top=2.9, z_hairline=8.6, z_brow=13.0, z_eye=17.3, z_nose=20.3, z_mouth=27.2, z_chin=32.6, z_ear=22.2,
    head_y=-0.035, z_shoulder_top=35.5,
    ear_style='round', ear_seg=(22, 16), ear_h=0.138, ear_w=0.108, ear_out=0.008, ear_y=0.030, ear_tilt=0.78, ear_thick=0.032, ear_rim=0.010, ear_bowl=0.015, ear_sink=0.022,
    eye_x=0.069, eye_w=0.040, eye_h=0.074, eye_lift=0.003,
    brow=dict(x0=0.036, x1=0.114, z=12.6, thick=0.034, arch=0.016, drop_in=0.004, drop_out=0.016,
              profile=[(0.0, 0.30), (0.05, 0.82), (0.14, 0.97), (0.45, 1.0), (0.85, 0.90), (0.95, 0.72), (1.0, 0.30)], flat=0.5),
    nose_w=0.098, nose_h=0.084, nose_d=0.070, nose_out=0.042, nose_top=1.15,
    # handlebar moustache: one tube tip to tip, notch under the nose, full lobes, ends curling up (make_victor's keys)
    moustache=dict(w=0.206, thick=0.066, z=23.4,
                   top=[(0.0, 0.45), (0.20, 1.00), (0.48, 0.86), (0.70, 0.52), (0.86, 0.80), (1.0, 1.20)],
                   bot=[(0.0, -0.95), (0.20, -1.05), (0.48, -0.90), (0.70, -0.30), (0.86, 0.36), (1.0, 0.96)]),
    mouth=dict(w=0.056, z=27.0, rise=0.006, sag=0.004, thick=0.0075),
    neck_r=0.090, neck_y=-0.030,
    tint=dict(spots=[(0.115, 22.0, 0.045, 0.035, 1.0), (0.0, 20.5, 0.03, 0.025, 0.55)], g=0.08, b=0.14),
    groove_dark=(0.008, 0.45),
    sheen={'Shoe': (0.34, [((0.2, -0.45, 0.87), 14.0, 1.0), ((0.0, -1.0, 0.3), 16.0, 0.8), ((0.9, 0.0, 0.45), 16.0, 0.5), ((-0.9, 0.0, 0.45), 16.0, 0.5)]),
           'Hair': (0.50, (-0.2, -0.40, 0.89), 2.0), 'Lapel': (0.70, (0.1, -0.6, 0.8), 6.0)},
)
COLOURS = dict(
    # neutral-preview bases tuned like Marcus's (see his notes on the two lightings); lighter / less saturated than
    # the sheet so the warm hall light lands near it (make_victor.py's material notes)
    skin='#fcc49a', hair='#6b625f', brow='#2a211c', mouth='#3a2218', eye='#0b0b0d', stache='#1c1a1c',
    jacket='#474e68', lapel='#686874', trouser='#434a63', button='#16161a', shade='#191c28',
    shirt='#f6f0e6', tie='#1a1a1e',
    shoe='#5f5a58', sole='#1a1818',
)

# ---- skull tables by f (0 chin .. 1 skull top); face: broad U jaw, full cheeks, rounded-square
W  = [(0, 0.0), (0.01, 0.060), (0.03, 0.088), (0.06, 0.112), (0.09, 0.128), (0.155, 0.152), (0.22, 0.170), (0.30, 0.182),
      (0.40, 0.188), (0.50, 0.188), (0.60, 0.185), (0.70, 0.180), (0.80, 0.171), (0.88, 0.156), (0.94, 0.126), (0.98, 0.075), (1, 0.0)]
DF = [(0, 0.0), (0.02, 0.170), (0.05, 0.195), (0.10, 0.207), (0.17, 0.212), (0.25, 0.215), (0.35, 0.215), (0.45, 0.209),
      (0.55, 0.205), (0.66, 0.203), (0.76, 0.197), (0.85, 0.181), (0.92, 0.150), (0.97, 0.095), (1, 0.0)]
DB = [(0, 0.0), (0.02, 0.030), (0.06, 0.055), (0.12, 0.080), (0.20, 0.110), (0.30, 0.140), (0.42, 0.170), (0.55, 0.188),
      (0.68, 0.194), (0.78, 0.186), (0.87, 0.165), (0.93, 0.132), (0.98, 0.072), (1, 0.0)]
E  = [(0, 2.0), (0.08, 2.2), (0.25, 2.55), (0.45, 2.65), (0.65, 2.6), (0.85, 2.45), (1, 2.2)]
BULGES = [dict(x=0.110, z=23.0, sx=0.050, sz=0.045, a=0.030),      # cheeks beside the moustache
          dict(x=0.0, z=18.0, sx=0.016, sz=0.026, a=0.028),        # nose bridge rising into the ball
          dict(x=0.0, z=29.0, sx=0.050, sz=0.020, a=0.006)]        # soft chin

# ---- hair: envelope extents (metres from the head axis) by height (pct)
HAIR = dict(          # silhouette extents measured on the FRONT (widths) and SIDE (front/back) panels, per pct height
    wr=[(0.3, 0.000), (0.5, 0.011), (1.0, 0.053), (2.0, 0.113), (3.0, 0.145), (4.0, 0.163), (5.0, 0.181), (6.0, 0.195),
        (8.0, 0.223), (10.0, 0.245), (12.0, 0.228), (14.0, 0.220), (16.0, 0.210), (18.0, 0.200), (20.0, 0.193), (22.0, 0.184),
        (24.5, 0.168), (26.0, 0.140), (27.0, 0.112), (28.3, 0.075)],
    wl=[(0.3, 0.085), (0.5, 0.092), (1.0, 0.106), (2.0, 0.134), (3.0, 0.142), (4.0, 0.145), (5.0, 0.152), (6.0, 0.188),
        (8.0, 0.210), (10.0, 0.220), (12.0, 0.217), (14.0, 0.208), (16.0, 0.200), (18.0, 0.192), (20.0, 0.190), (22.0, 0.184),
        (24.5, 0.168), (26.0, 0.140), (27.0, 0.112), (28.3, 0.075)],
    front=[(0.3, 0.206), (1.0, 0.215), (2.0, 0.222), (3.0, 0.226), (4.0, 0.226), (5.0, 0.222), (6.0, 0.218), (7.0, 0.208), (8.0, 0.200),
           (10.0, 0.200), (14.0, 0.200), (20.0, 0.19), (28.3, 0.08)],
    back=[(0.3, -0.060), (0.6, -0.030), (1.0, -0.003), (2.0, 0.064), (3.0, 0.099), (4.0, 0.120), (5.0, 0.149), (6.0, 0.166),
          (8.0, 0.191), (10.0, 0.226), (12.0, 0.248), (14.0, 0.251), (16.0, 0.243), (18.0, 0.233), (20.0, 0.215), (22.0, 0.194),
          (24.0, 0.170), (26.0, 0.146), (27.0, 0.128), (28.3, 0.090)],
    expo=[(0.3, 2.1), (2, 2.2), (6, 2.35), (12, 2.6), (20, 2.6), (28.3, 2.4)],
    grooves=[dict(keys=[(0.20, 12.5), (0.27, 14.6), (0.34, 16.8), (0.41, 19.0)], depth=0.008, width=0.012, n=40)],
    # the sculpted lock planes, sweeping from the part (his left, u ~0.85) over the top to his right side and back;
    # later (front) locks stand higher, so each steps down onto the one behind it with its own rounded edge
    lock_fields=[dict(keys=[(0.64, 4.5), (0.56, 7.0), (0.52, 12.0), (0.50, 18.0), (0.50, 23.0)], half=0.055, height=0.010, soft=0.013),
                 dict(keys=[(0.74, 2.6), (0.62, 1.6), (0.48, 2.8), (0.40, 6.5), (0.37, 11.5), (0.36, 17.0)], half=0.042, height=0.021, soft=0.013),
                 dict(keys=[(0.80, 3.4), (0.90, 1.4), (0.00, 1.0), (0.10, 1.8), (0.20, 4.2), (0.28, 8.0), (0.34, 12.5)], half=0.038, height=0.032, soft=0.013),
                 dict(keys=[(0.86, 6.0), (0.94, 3.8), (0.02, 3.2), (0.09, 4.2), (0.16, 6.8), (0.23, 10.2), (0.29, 13.8)], half=0.032, height=0.043, soft=0.013)],
    lock_base=0.028,
    slope=lambda u: 0.9 - 0.62 * GK.sm((abs(((u + 0.5) % 1.0) - 0.5) - 0.13) / 0.03) * GK.sm((0.26 - abs(((u + 0.5) % 1.0) - 0.5)) / 0.02), t_min=0.010, centre=(0.0, 0.02, 14.5), nlon=80, nrows=38, top=0.3, lip=0.6,
)
def hairline(u):
    """Lower edge of the hair (pct) by longitude: the fringe (8.4 at the centre, lower toward his right where the sweep
    lands), round the temple corner, a short sideburn in front of the ear (tip 19.5), over the ear (15), then a
    rounded U behind the ear down to the nape (27.8 at the centre back)."""
    a = abs(((u + 0.5) % 1.0) - 0.5); right = (u % 1.0) < 0.5; ss = GK.sm
    z_f = (7.8 + 3.0 * ss(a / 0.13)) if right else (7.8 - 0.6 * ss(a / 0.07))   # the fringe line: higher by the part, lower under the sweep
    z = z_f + (12.5 - z_f) * ss((a - 0.15) / 0.04)                        # temple corner
    sb = max(0.0, 1.0 - abs(a - 0.212) / 0.020) ** 1.3                      # sideburn: a V pointing down
    z = z + (19.5 - z) * sb * ss((0.235 - a) / 0.01 + 1.0)
    z = z + (15.2 - z) * ss((a - 0.228) / 0.012)                            # over the ear
    z_n = 25.4 + 2.4 * ss((a - 0.36) / 0.14)                                 # the nape: a soft U, lowest at the centre back
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
    # side profile (y centre, Blender -Y = forward) fitted to the SIDE panel (slim tuxedo, chest forward, hem over the seat)
    profiles=[(66.0, 0.412, 0.290, 0.70, -0.042), (64.0, 0.410, 0.286, 0.70, -0.046), (60.0, 0.402, 0.286, 0.70, -0.052),
              (56.0, 0.396, 0.280, 0.70, -0.060), (52.0, 0.396, 0.280, 0.70, -0.062), (47.0, 0.398, 0.278, 0.72, -0.050),
              (43.0, 0.404, 0.268, 0.74, -0.040), (40.0, 0.412, 0.250, 0.76, -0.032), (38.0, 0.420, 0.236, 0.74, -0.032),
              (36.5, 0.410, 0.220, 0.78, -0.032), (35.3, 0.370, 0.204, 0.84, -0.030), (34.0, 0.270, 0.188, 0.96, -0.030), (33.0, 0.196, 0.176, 1.0, -0.030)],
    waist=55.0, hem_hips=0.5, nj=52, ring_dz=0.020, open_apex=56.0, open_hem=0.034, corner=0.045, mat='jacket',
    # PEAKED satin lapels (his left, mirrored): V at 52.5, outer edge up to the peak tip, the peak's top edge back in to
    # the gorge, then the inner edge down beside the shirt
    lapel=dict(outline=[(0.004, 52.8), (0.070, 48.0), (0.140, 41.6), (0.184, 37.4), (0.178, 36.6), (0.122, 35.8), (0.096, 36.8), (0.080, 41.0), (0.040, 48.0)],
               wrap=dict(top=31.6, front=33.2, open=0.80, v_width=1.2, tip=(0.126, 35.9), th_side=1.55, gap=0.027, gap_neck=0.022, thick=0.007, tuck=0.030),
               thick=0.010, lift=0.002, mat='lapel', collar_top=31.4, collar_front=34.4, collar_open=0.80, collar_gap=0.020, collar_dy=0.0),
    flaps=[(0.096, 0.172, 56.6, 57.8)], welt=(0.130, 0.190, 44.8, 0.008, 0.006), flap_thick=0.006,
    buttons=[(0.0, 55.2)], button_r=0.013, vent=60.0,
)
SH = dict(max_edge=0.034, lift=0.008, v=[(-0.080, 33.4), (0.080, 33.4), (0.082, 38.0), (0.066, 43.0), (0.006, 52.2), (-0.006, 52.2), (-0.066, 43.0), (-0.082, 38.0)],
          collar_top=30.4, collar_v=31.6, v_width=0.60, v_open=0.30,
          wrap=dict(top=30.8, v=34.0, open=0.10, v_width=0.85, tip=(0.072, 35.6), th_side=1.0, below=0.012, tuck=0.012, gap=0.008, gap_neck=0.010, thick=0.005),
          studs=[(0.0, 40.9), (0.0, 45.2), (0.0, 49.7)], stud_r=0.0085)
# the fuller bow tie from male_extras (tall wings pinched to a knot), sized to the sheet: 0.17 wide, 0.068 tall, centre 37.1
BOW = dict(z=37.3, w=0.088, h=0.072, h_mid=0.036, knot=(0.032, 0.036, 0.032), d=0.022, y=0.012, clear=0.016, curve=0.016, pinch=0.25, mat='tie')
A = dict(
    shoulder=(0.185, 37.4), shoulder_y=0.0, elbow=(0.252, 0.004, 52.0), wrist=(0.326, -0.036, 63.6),
    sleeve_end=62.2, cuff_end=64.0, sleeve='jacket', n=20,
    stations=[('end', 0.118, 0.114), (57.0, 0.120, 0.118), (52.0, 0.124, 0.124), (46.0, 0.128, 0.132), (41.0, 0.132, 0.136),
              (('j', -0.01), 0.134, 0.140), (('j', 0.018), 0.116, 0.126), (('j', 0.034), 0.062, 0.070)],
    cuff_wd=(0.106, 0.102), cufflink=True, sleeve_buttons=2, button_angle=60.0,
    hand=dict(finger_n=8, palm_len=0.116, palm_w=0.110, palm_t=0.064, out=0.012, finger_out=0.013,
              fingers=[(-0.038, 0.0180, 0.092, 1.6), (-0.013, 0.0186, 0.098, 1.7), (0.012, 0.0180, 0.094, 1.7), (0.037, 0.0165, 0.082, 1.6)],
              thumb=(-0.050, 0.015, 0.024, 0.0200, 0.068, 0.55)),
)
P = dict(leg_x=0.100, leg_x_hem=0.121, leg_y=-0.035, thigh_w=0.168, thigh_d=0.210, shin_w=0.132, shin_d=0.180, hip=73.0, knee=84.5, crotch=70.5,
         top=58.0, hem=93.0, break_dip=0.012, nl=20,
         leg_profile=[(93.0, 0.132, 0.186), (91.0, 0.129, 0.180), (88.0, 0.134, 0.182), (84.5, 0.143, 0.190), (80.0, 0.151, 0.198), (76.0, 0.162, 0.206), (73.0, 0.168, 0.210)],
         pelvis=[(69.0, 0.95, 0.00, 0.85), (66.0, 1.0, 0.0, 0.78), (63.0, 0.98, -0.02, 0.75), (60.0, 0.94, -0.04, 0.75), (58.0, 0.90, -0.05, 0.8)])
S = dict(n=20, leg_x=0.121, len=0.290, w=0.140, h=0.095, heel=0.066, splay=0.26, out=0.0, y=-0.032, laces=3)
RIG = dict(hip=73.0, knee=84.5, ankle=95.9, waist=55.0, shoulder_top=35.5, neck_y=-0.030, hand_end=73.4, leg_x=0.110, leg_y=-0.035,
           heel=0.066, ball=0.15, arm=A)

def build(g):
    g.set_head(W, DF, DB, E, BULGES)
    GK.hair_shell(g, hairline=hairline, edge=edge, thin_below=thin_below, **HAIR)
    GK.head(g, nlon=52, nlat=36, cull_in=g.hair_covers)
    GK.ears(g); GK.eyes(g); GK.brows(g); GK.nose(g); GK.moustache(g, mat='stache'); GK.mouth(g)
    GK.neck(g)
    GK.jacket(g, J); GK.lapels(g, J); GK.pockets(g, J); GK.buttons(g, J); GK.back_seam(g, J)
    GK.shirt_front(g, SH); GK.collar(g, SH); GK.studs(g, SH); MX.bow_tie(g, BOW)
    GK.arms(g, A); GK.cuffs(g, A); GK.hands(g, A)
    GK.trousers(g, P); GK.shoes(g, S)
