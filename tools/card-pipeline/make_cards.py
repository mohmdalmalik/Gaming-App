# Card illustrations for Hotel Escape, modelled and rendered procedurally in Blender (bpy, headless)
# to sit next to the painted reference assets/cards/lantern.jpg: one object, centred, three-quarter
# view, warm key + soft fill + rim light, on a dark mottled green backdrop (purple for the evil
# Possession card) with a soft vignette.
#
#   python3 tools/card-pipeline/make_cards.py                      # all cards (~1-2 min each)
#   python3 tools/card-pipeline/make_cards.py --only knife,revolver
#   python3 tools/card-pipeline/make_cards.py --draft               # quick low-sample look
#   python3 tools/card-pipeline/make_cards.py --post                # re-run the 2D pass only
#
# Output: assets/cards/<type>.jpg (640x640 JPEG). Raw renders go to tools/card-pipeline/build/.
# lantern.jpg is the hand-painted reference and is never touched by this script.
import os, sys, math, json, time
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import bpy, bmesh
from mathutils import Vector
import cardlib as L
from cardlib import lin
import post

REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
OUT = os.path.join(REPO, 'assets', 'cards')
BUILD = os.path.join(HERE, 'build')
os.makedirs(BUILD, exist_ok=True)

argv = sys.argv[1:]
def arg(k, d):
    return type(d)(argv[argv.index(k) + 1]) if k in argv else d
ONLY = [s for s in arg('--only', '').split(',') if s]
DRAFT = '--draft' in argv
POST_ONLY = '--post' in argv
SAMPLES = arg('--samples', 24 if DRAFT else 160)
RES = arg('--res', 400 if DRAFT else 800)       # rendered larger, downsampled to 640 in post

WARM = (1.0, 0.76, 0.5); WARM2 = (1.0, 0.68, 0.4); COOL = (0.55, 0.78, 0.72)
PI = math.pi

# ================================================================================================
# Materials shared by several cards
# ================================================================================================
def brass(name='brass', rough=0.3, base='#c89a4e'):
    return L.metal(name, base, rough, 0.1, '#2a1a08', 7.0, 0.9)

def steel(name='steel', rough=0.22, base='#b9bcc2'):
    return L.metal(name, base, rough, 0.07, '#1a1a1c', 12.0, 0.7)

def walnut(name='walnut', axis='X', scale=3.0):
    return L.wood(name, '#26120a', '#6a3a1e', 0.36, scale, 9.0, axis, 0.4)

# ================================================================================================
# Cards. Each builder models the object under L.root(); returns the card's settings.
# ================================================================================================
ANCHORS = {}

def build_espresso():
    porc = L.plastic('porcelain', '#f2ebdf', 0.14, '#6b5a48', 0.55, 0.5, coat=0.6, ss=0.15)
    # burgundy band + white body on the cup, by height
    m, nt, b = L.new_mat('cup')
    v = L.tex_coord(nt, 'Object')
    sep = nt.add('ShaderNodeSeparateXYZ'); nt.link(v, sep.inputs[0])
    r = L.ramp(nt, sep.outputs['Z'], [(0.0, lin('#f2ebdf')), (0.50, lin('#f2ebdf')), (0.5001, lin('#7a1e2b')), (0.575, lin('#7a1e2b')), (0.5751, lin('#f2ebdf')), (1.0, lin('#f2ebdf'))])
    r.color_ramp.interpolation = 'CONSTANT'
    col = L.ao_dirt(nt, r.outputs['Color'], '#6b5a48', 0.05, 0.55)
    nt.link(col, b.inputs['Base Color'])
    L.P(b, Roughness=0.14, **{'Coat Weight': 0.6, 'Coat Roughness': 0.06, 'Subsurface Weight': 0.12, 'Subsurface Scale': 0.02})
    cupm = m
    gold = L.metal('gold', '#e0b460', 0.2, 0.05, '#3a2408', 10.0, 0.3)
    # coffee: dark centre, golden crema toward the rim, mottled
    m, nt, b = L.new_mat('coffee')
    v = L.tex_coord(nt, 'Object')
    grad = nt.add('ShaderNodeTexGradient'); grad.gradient_type = 'SPHERICAL'
    mp = nt.add('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (2.5, 2.5, 2.5)
    mp.inputs['Location'].default_value = (0, 0, 0)
    nt.link(v, mp.inputs['Vector']); nt.link(mp.outputs[0], grad.inputs[0])
    n = L.noise(nt, v, 14, 6, 0.6)
    mx = nt.add('ShaderNodeMix'); mx.data_type = 'FLOAT'; mx.inputs['Factor'].default_value = 0.3
    nt.link(grad.outputs['Fac'], mx.inputs[2]); nt.link(n.outputs['Fac'], mx.inputs[3])
    r = L.ramp(nt, mx.outputs[0], [(0.05, lin('#8a5a2e')), (0.3, lin('#5e3418')), (0.6, lin('#2e160a'))])
    nt.link(r.outputs['Color'], b.inputs['Base Color']); L.P(b, Roughness=0.25)
    coffee = m
    bean = L.plastic('bean', '#4a2512', 0.3, '#120804', 0.6, 0.5, coat=0.4, var=0.3)

    L.root()
    # saucer
    L.lathe('saucer', [(0, 0.02), (0.36, 0.02), (0.38, 0.0), (0.43, 0.0), (0.45, 0.025), (0.58, 0.05), (0.72, 0.095),
                       (0.8, 0.13), (0.822, 0.145), (0.81, 0.16), (0.775, 0.155), (0.70, 0.125), (0.56, 0.085), (0.44, 0.075), (0, 0.075)], porc, 96, 50)
    L.torus('saucer_gold', 0.812, 0.008, gold, loc=(0, 0, 0.157), seg=128)
    # cup
    z0 = 0.075
    prof = [(0, z0 + 0.0), (0.2, z0), (0.225, z0 + 0.02), (0.23, z0 + 0.05), (0.27, z0 + 0.1), (0.33, z0 + 0.2), (0.39, z0 + 0.36),
            (0.425, z0 + 0.52), (0.44, z0 + 0.6), (0.445, z0 + 0.625), (0.435, z0 + 0.635), (0.415, z0 + 0.62),
            (0.40, z0 + 0.55), (0.36, z0 + 0.38), (0.29, z0 + 0.2), (0.2, z0 + 0.12), (0, z0 + 0.11)]
    cup = L.lathe('cup', prof, cupm, 96, 50)
    L.torus('cup_gold', 0.441, 0.009, gold, loc=(0, 0, z0 + 0.628), seg=128)
    # coffee surface
    zc = z0 + 0.54
    L.lathe('coffee', [(0, zc), (0.393, zc), (0.399, zc - 0.02), (0, zc - 0.03)], coffee, 96, None)
    # handle: an ear-shaped loop on +X
    L.tube('handle', [(0.37, 0, z0 + 0.5), (0.55, 0, z0 + 0.53), (0.63, 0, z0 + 0.42), (0.57, 0, z0 + 0.27), (0.43, 0, z0 + 0.22), (0.31, 0, z0 + 0.2)], 0.036, cupm, bevres=6)
    # a small spoon resting on the saucer
    sp = steel('spoon', 0.18, '#d8d6d0')
    bowl = L.sphere('spoonbowl', 0.12, sp, loc=(0, 0, 0), scale=(1.0, 0.62, 0.22))
    bowl.location = (-0.30, -0.56, 0.105); bowl.rotation_euler = (0.1, 0.0, math.radians(-20))
    L.tube('spoonstem', [(-0.22, -0.53, 0.11), (-0.02, -0.46, 0.14), (0.25, -0.42, 0.155), (0.45, -0.38, 0.16)], 0.015, sp, bevres=3)
    # two coffee beans on the ground in front
    for i, (x, y, rz) in enumerate([(0.72, -0.72, 0.6), (0.95, -0.52, -0.9)]):
        be = L.sphere(f'bean{i}', 0.1, bean, loc=(x, y, 0.045), scale=(1.0, 0.72, 0.48), rot=(0, 0, rz))
        cut = L.box(f'crease{i}', (0.26, 0.012, 0.06), None, loc=(x, y, 0.09), rot=(0, 0, rz))
        L.boolean(be, cut, sharp=None)
    ANCHORS['steam'] = [Vector((0, 0, z0 + 0.66)), 0.4]
    return dict(az=22, el=30, fill=0.78, lens=70, center=(0.5, 0.56), steam=True)

def build_knife():
    blade_m = L.metal('blade', '#cfd1d4', 0.14, 0.05, '#2a2a2a', 14, 0.6)
    br = brass('bolster', 0.28)
    wd = walnut('handle', 'X', 2.5)
    L.root()
    top = [(-0.15, 0.13), (0.55, 0.145), (0.82, 0.13), (1.05, 0.075), (1.32, 0.0)]
    bot = [(-0.15, -0.17), (0.3, -0.19), (0.7, -0.175), (1.0, -0.12), (1.2, -0.055), (1.32, 0.0)]
    def ip(tab, x):
        for (x0, z0), (x1, z1) in zip(tab, tab[1:]):
            if x0 <= x <= x1: return z0 + (z1 - z0) * (x - x0) / (x1 - x0)
        return tab[-1][1]
    secs = []; N = 60
    for i in range(N + 1):
        x = -0.15 + 1.47 * i / N
        if i == N: secs.append([(1.32, 0, 0.0)]); continue
        zt, zb = ip(top, x), ip(bot, x)
        t = 0.05 * (1 - 0.55 * max(0, (x - 0.5) / 0.82))
        zg = zb + 0.52 * (zt - zb); e = 0.003
        secs.append([(x, t / 2, zt), (x, t / 2, zg), (x, e, zb), (x, -e, zb), (x, -t / 2, zg), (x, -t / 2, zt)])
    L.loft('blade', secs, blade_m, sharp=6)
    hp = L.smooth_poly([(-0.1, 0.125), (-0.5, 0.118), (-0.9, 0.125), (-1.2, 0.115), (-1.34, 0.03), (-1.33, -0.09), (-1.2, -0.165),
                        (-0.95, -0.17), (-0.75, -0.135), (-0.55, -0.175), (-0.3, -0.185), (-0.1, -0.175)], 6)
    L.extrude2d('handle', hp, 0.17, wd, bev=0.05, seg=4, rot=(PI / 2, 0, 0))
    L.extrude2d('bolster', [(-0.19, 0.155), (-0.1, 0.155), (-0.1, -0.2), (-0.12, -0.265), (-0.17, -0.285), (-0.2, -0.24)], 0.2, br, bev=0.018, seg=3, rot=(PI / 2, 0, 0))
    for x in (-0.42, -0.8, -1.12):
        L.cyl('rivet', 0.036, 0.19, br, 32, 0.008, loc=(x, 0, -0.02), rot=(PI / 2, 0, 0))
    L.ROOT.rotation_euler = (math.radians(12), math.radians(-38), math.radians(18))
    return dict(az=0, el=8, fill=0.86, lens=70, floor=False, wall=1.6, floor_glow=False,
                refl=[((0, -1, 0), (0.6, 0, 0), 900, 2.5, (0.25, 0, 0.15))])

def build_revolver():
    gun = L.metal('gunmetal', '#9a9ea6', 0.24, 0.08, '#16161a', 10.0, 0.9)
    dark = L.metal('darksteel', '#4a4d55', 0.3, 0.06, '#101012', 10.0, 0.6)
    grip = L.wood('grip', '#1a0a05', '#8a4a24', 0.42, 3.0, 10.0, 'Z', 0.3, 0.8, 0.1)
    nt = L.NT(grip); bsdf = grip.node_tree.nodes['Principled BSDF']
    v = L.tex_coord(nt, 'Object')
    w1 = nt.add('ShaderNodeTexWave'); w1.bands_direction = 'DIAGONAL'; w1.inputs['Scale'].default_value = 28; nt.link(v, w1.inputs['Vector'])
    mp = nt.add('ShaderNodeMapping'); mp.inputs['Rotation'].default_value = (0, 0, PI / 2); nt.link(v, mp.inputs['Vector'])
    w2 = nt.add('ShaderNodeTexWave'); w2.bands_direction = 'DIAGONAL'; w2.inputs['Scale'].default_value = 28; nt.link(mp.outputs[0], w2.inputs['Vector'])
    mm = nt.add('ShaderNodeMath', operation='MINIMUM'); nt.link(w1.outputs['Fac'], mm.inputs[0]); nt.link(w2.outputs['Fac'], mm.inputs[1])
    bu = nt.add('ShaderNodeBump'); bu.inputs['Strength'].default_value = 0.35; bu.inputs['Distance'].default_value = 0.01
    nt.link(mm.outputs[0], bu.inputs['Height']); nt.link(bu.outputs['Normal'], bsdf.inputs['Normal'])
    L.root()
    Y0 = 0.24          # bore axis height
    # barrel with a top rib and front sight, ejector-rod housing underneath
    L.cyl('barrel', 0.078, 1.0, gun, 48, 0.012, loc=(0.66, 0, Y0), rot=(0, PI / 2, 0))
    L.lathe('muzzle', [(0, 0), (0.084, 0), (0.084, 0.03), (0.07, 0.04), (0.03, 0.04), (0.03, 0.02), (0, 0.02)], gun, 48, 40,
            loc=(1.14, 0, Y0), rot=(0, PI / 2, 0))
    L.box('rib', (0.95, 0.05, 0.05), gun, 0.012, loc=(0.66, 0, Y0 + 0.08))
    L.extrude2d('sight', [(1.04, Y0 + 0.09), (1.13, Y0 + 0.09), (1.13, Y0 + 0.15), (1.09, Y0 + 0.15)], 0.03, gun, 0.006, rot=(PI / 2, 0, 0))
    L.cyl('ejector', 0.04, 0.62, gun, 32, 0.008, loc=(0.5, 0, Y0 - 0.11), rot=(0, PI / 2, 0))
    L.cyl('ejknob', 0.05, 0.06, dark, 32, 0.012, loc=(0.83, 0, Y0 - 0.11), rot=(0, PI / 2, 0))
    L.box('lug', (0.55, 0.05, 0.08), gun, 0.01, loc=(0.47, 0, Y0 - 0.075))
    # the cylinder: chamfered drum with six flutes and chamber mouths
    cz = [(0, 0), (0.17, 0), (0.205, 0.035), (0.205, 0.525), (0.17, 0.56), (0, 0.56)]
    cyl = L.lathe('cylinder', cz, gun, 72, 40, loc=(-0.42, 0, Y0), rot=(0, PI / 2, 0))
    for k in range(6):
        a = 2 * PI * (k + 0.5) / 6
        c = L.lathe('flute', [(0, 0), (0.045, 0.04), (0.05, 0.1), (0.05, 0.3), (0.045, 0.36), (0, 0.4)], None, 24, None,
                    loc=(-0.34, 0.225 * math.cos(a), Y0 + 0.225 * math.sin(a)), rot=(0, PI / 2, 0))
        cyl = L.boolean(cyl, c, sharp=40)
    for k in range(6):
        a = 2 * PI * k / 6
        c = L.cyl('chamber', 0.045, 0.1, None, 24, loc=(0.14, 0.12 * math.cos(a), Y0 + 0.12 * math.sin(a)), rot=(0, PI / 2, 0))
        cyl = L.boolean(cyl, c, sharp=40)
    # frame (with the grip frame), hammer, trigger guard, trigger
    fr = [(0.2, 0.48), (0.2, 0.05), (0.08, -0.02), (-0.44, -0.03), (-0.52, -0.1), (-0.72, -0.5), (-0.98, -0.44),
          (-0.82, -0.05), (-0.7, 0.3), (-0.56, 0.48)]
    L.extrude2d('frame', fr, 0.2, gun, bev=0.03, seg=3, rot=(PI / 2, 0, 0))
    L.extrude2d('strap', [(-0.46, 0.44), (0.2, 0.44), (0.2, 0.52), (-0.5, 0.52)], 0.14, gun, bev=0.025, seg=3, rot=(PI / 2, 0, 0))
    hm = L.smooth_poly([(-0.56, 0.44), (-0.62, 0.53), (-0.74, 0.58), (-0.79, 0.555), (-0.72, 0.46), (-0.68, 0.34)], 4)
    L.extrude2d('hammer', hm, 0.08, dark, bev=0.015, seg=2, rot=(PI / 2, 0, 0))
    L.tube('guard', [(0.0, 0, -0.02), (-0.02, 0, -0.13), (-0.1, 0, -0.21), (-0.24, 0, -0.23), (-0.36, 0, -0.17), (-0.42, 0, -0.07), (-0.44, 0, -0.03)], 0.024, gun, bevres=4)
    L.tube('trigger', [(-0.17, 0, -0.02), (-0.155, 0, -0.08), (-0.17, 0, -0.14), (-0.22, 0, -0.17)], 0.022, dark, bevres=4)
    # walnut grips
    gp = L.smooth_poly([(-0.52, -0.06), (-0.62, -0.3), (-0.76, -0.58), (-0.86, -0.72), (-0.98, -0.78), (-1.14, -0.72),
                        (-1.17, -0.62), (-1.04, -0.4), (-0.9, -0.12), (-0.8, 0.1), (-0.7, 0.2), (-0.6, 0.12)], 5)
    L.extrude2d('grip', gp, 0.27, grip, bev=0.07, seg=4, rot=(PI / 2, 0, 0))
    L.cyl('gripscrew', 0.04, 0.29, gun, 32, 0.012, loc=(-0.84, 0, -0.36), rot=(PI / 2, 0, 0))
    L.torus('lanyard', 0.06, 0.016, gun, loc=(-1.1, 0, -0.8), rot=(PI / 2, 0, 0), seg=32)
    L.cyl('pin', 0.03, 0.22, dark, 24, 0.008, loc=(0.12, 0, 0.36), rot=(PI / 2, 0, 0))
    L.ROOT.rotation_euler = (math.radians(4), math.radians(-3), math.radians(-24))
    return dict(az=0, el=10, fill=0.86, lens=70, floor=False, wall=1.8, floor_glow=False,
                refl=[((0, -1, 0), (-0.2, 0, 0.2), 700, 3.0, (0.2, 0, 0.25))])

def build_barricade():
    tints = [('#4a2f18', '#9c7447'), ('#3e2714', '#8a653c'), ('#533520', '#a5804f'), ('#442a16', '#94703f')]
    pines = [L.wood(f'pine{i}', d, l, 0.72, 2.0, 5.0, 'X', 0.0, 0.9, 0.35, offset=(i * 3.7, i * 1.3, i * 2.1)) for i, (d, l) in enumerate(tints)]
    iron = L.metal('iron', '#5b5650', 0.5, 0.1, '#1a1008', 9.0, 0.8)
    L.root()
    import random
    rnd = random.Random(4)
    def plank(name, length, width, th, loc, ang, jag=True, mi=0):
        pine = pines[mi]
        # a board with split, uneven ends
        hl = length / 2; hw = width / 2
        left = [(-hl + rnd.uniform(-0.05, 0.05), hw), (-hl - 0.03, hw * 0.3), (-hl + 0.06, -hw * 0.2), (-hl + rnd.uniform(-0.04, 0.04), -hw)]
        right = [(hl + rnd.uniform(-0.04, 0.04), -hw), (hl + 0.07, -hw * 0.35), (hl - 0.04, hw * 0.25), (hl + rnd.uniform(-0.05, 0.03), hw)]
        poly = [left[0], left[1], left[2], left[3]] + [(-hl * 0.3, -hw), (hl * 0.4, -hw - 0.004)] + right + [(hl * 0.3, hw + 0.004), (-hl * 0.4, hw)]
        ob = L.extrude2d(name, poly, th, pine, bev=0.012, seg=2, rot=(PI / 2, 0, 0))
        ob.location = loc; ob.rotation_euler = (PI / 2, math.radians(-ang), 0)
        return ob
    plank('p1', 2.45, 0.36, 0.09, (0.02, 0.06, 0), 35, mi=0)
    plank('p2', 2.55, 0.34, 0.09, (-0.02, -0.04, 0.02), -39, mi=1)
    plank('p3', 2.25, 0.32, 0.09, (0.05, -0.14, -0.72), 5, mi=2)
    plank('p4', 2.15, 0.33, 0.09, (-0.04, -0.14, 0.74), -3, mi=3)
    # nail heads (and one bent nail)
    for (x, y, z) in [(0.0, -0.1, 0.0), (0.93, -0.19, 0.72), (-0.95, -0.19, 0.77), (0.95, -0.19, -0.7), (-0.95, -0.19, -0.74),
                      (0.55, -0.19, -0.7), (-0.6, -0.19, 0.76), (0.55, -0.2, 0.74), (-0.57, -0.2, -0.73)]:
        L.cyl('nail', 0.032, 0.02, iron, 20, 0.006, loc=(x, y, z), rot=(PI / 2, 0, 0))
    L.tube('bent', [(0.25, -0.2, 0.05), (0.25, -0.3, 0.06), (0.3, -0.36, 0.12), (0.38, -0.36, 0.14)], 0.012, iron, bevres=2)
    L.cyl('nailb', 0.03, 0.015, iron, 20, 0.005, loc=(0.385, -0.36, 0.14), rot=(0, PI / 2, 0))
    return dict(az=22, el=10, fill=0.84, lens=70, floor=False, wall=0.9, floor_glow=False)

def build_lockPick():
    br = brass('lockbrass', 0.32, '#b3935a')
    st = steel('shackle', 0.24)
    pick = steel('pick', 0.18, '#c8cbd0')
    L.root()
    # padlock body: rounded block with a raised face plate
    body = L.extrude2d('body', L.rounded_rect(1.0, 0.9, 0.2, 8), 0.36, br, bev=0.06, seg=4, rot=(PI / 2, 0, 0))
    plate = L.extrude2d('plate', L.rounded_rect(0.8, 0.7, 0.14, 8), 0.04, br, bev=0.012, seg=2, loc=(0, -0.19, 0), rot=(PI / 2, 0, 0))
    kh = L.ellipse(0.06, 0.06, 24, 0, 0.05) [:13] + [(-0.03, -0.14), (0.03, -0.14)]
    kh = [(0.06 * math.cos(a), 0.06 + 0.06 * math.sin(a)) for a in [math.radians(-60 + 300 * i / 20) for i in range(21)]] + [(-0.035, -0.13), (0.035, -0.13)]
    kh = kh[:21]; kh = kh + [(-0.035, -0.13), (0.035, -0.13)]
    cut = L.extrude2d('kh', kh, 0.3, None, loc=(0, -0.2, -0.02), rot=(PI / 2, 0, 0))
    L.boolean(plate, cut)
    L.extrude2d('khdark', kh, 0.02, L.plastic('void', '#050303', 0.9, dirt_amt=0), loc=(0, -0.155, -0.02), rot=(PI / 2, 0, 0))
    # shackle
    L.tube('shackle', [(-0.3, 0, 0.42), (-0.3, 0, 0.72), (-0.22, 0, 0.93), (0, 0, 1.0), (0.22, 0, 0.93), (0.3, 0, 0.72), (0.3, 0, 0.42)], 0.075, st, bevres=6)
    # rivets
    for x, z in ((-0.32, 0.27), (0.32, 0.27), (-0.32, -0.27), (0.32, -0.27)):
        L.sphere('rivet', 0.035, br, loc=(x, -0.21, z), scale=(1, 0.5, 1))
    # the picks: a slim hook pick and an L-shaped tension wrench, both in the keyhole, with a
    # leather-wrapped handle on the hook pick
    kx, ky, kz = 0.0, -0.2, 0.0
    L.tube('hook', [(kx + 0.01, ky + 0.06, kz + 0.05), (kx, ky - 0.02, kz + 0.02), (kx + 0.12, ky - 0.2, kz - 0.06), (kx + 0.62, ky - 0.62, kz - 0.36)], 0.014, pick, bevres=2)
    L.tube('hooktip', [(kx + 0.01, ky + 0.06, kz + 0.05), (kx - 0.01, ky + 0.04, kz + 0.09)], 0.012, pick, bevres=2)
    leather = L.plastic('leather', '#4a2414', 0.55, '#120804', 0.6, var=0.25, scale=30)
    d = Vector((0.5, -0.42, -0.3)).normalized()
    gp = L.cyl('grip', 0.042, 0.4, leather, 24, 0.014)
    gp.location = Vector((kx + 0.62, ky - 0.62, kz - 0.36)) + d * 0.18
    gp.rotation_euler = d.to_track_quat('Z', 'Y').to_euler()
    L.tube('tens', [(kx - 0.01, ky + 0.03, kz - 0.1), (kx - 0.01, ky - 0.08, kz - 0.1), (kx - 0.05, ky - 0.14, kz - 0.12), (kx - 0.5, ky - 0.36, kz - 0.42)], 0.013, pick, bevres=2)
    L.ROOT.rotation_euler = (0, 0, math.radians(-22))
    return dict(az=0, el=14, fill=0.8, lens=70, floor=True, center=(0.5, 0.52), refl=[((0, -1, 0), (0, -0.2, 0), 220, 3.0, (0.25, 0, 0.35))])

def build_masterKey():
    br = brass('keybrass', 0.27, '#c49a52')
    enamel = L.plastic('enamel', '#6e1a26', 0.18, '#1a0508', 0.5, coat=0.8)
    L.root()
    key = bpy.data.objects.new('KEY', None); L.link(key)
    parts = []
    bx = -0.95
    R = lambda: (PI / 2, 0, 0)
    parts.append(L.torus('bow', 0.3, 0.06, br, loc=(bx, 0, 0), rot=R(), seg=96))
    for a in (90, 180, 270):
        c = (bx + 0.36 * math.cos(math.radians(a)), 0, 0.36 * math.sin(math.radians(a)))
        parts.append(L.torus('lobe', 0.15, 0.048, br, loc=c, rot=R(), seg=64))
    for a in (0, 90, 180, 270):
        c = (bx + 0.13 * math.cos(math.radians(a)), 0, 0.13 * math.sin(math.radians(a)))
        parts.append(L.torus('quatre', 0.12, 0.022, br, loc=c, rot=R(), seg=48))
    parts.append(L.sphere('boss', 0.07, br, loc=(bx, 0, 0), scale=(1, 0.7, 1)))
    # shaft with turned collars
    prof = [(0, 0), (0.06, 0), (0.09, 0.03), (0.09, 0.06), (0.06, 0.08), (0.075, 0.12), (0.075, 0.15), (0.055, 0.17),
            (0.062, 0.3), (0.08, 0.32), (0.08, 0.36), (0.062, 0.38), (0.062, 1.5), (0.07, 1.52), (0.07, 1.55), (0, 1.55)]
    parts.append(L.lathe('shaft', prof, br, 48, 40, loc=(bx + 0.33, 0, 0), rot=(0, PI / 2, 0)))
    bit = [(0.52, 0.0), (0.86, 0.0), (0.86, -0.36), (0.8, -0.36), (0.8, -0.25), (0.74, -0.25), (0.74, -0.36), (0.66, -0.36),
           (0.66, -0.29), (0.6, -0.29), (0.6, -0.36), (0.52, -0.36)]
    parts.append(L.extrude2d('bit', bit, 0.08, br, bev=0.014, seg=2, rot=(PI / 2, 0, 0)))
    for p in parts: p.parent = key
    key.rotation_euler = (math.radians(10), math.radians(-32), math.radians(14))
    bpy.context.view_layer.update()
    # split ring through the left lobe, and a hotel fob hanging from it (world-vertical)
    lobe = key.matrix_world @ Vector((bx - 0.36 - 0.12, 0, 0))
    L.torus('ring', 0.13, 0.018, br, loc=(lobe.x - 0.02, lobe.y, lobe.z - 0.08), rot=(PI / 2, 0, math.radians(75)), seg=64)
    top = Vector((lobe.x - 0.02, lobe.y, lobe.z - 0.2))
    fob = L.smooth_poly([(0, 0.02), (0.17, -0.1), (0.24, -0.4), (0.17, -0.7), (0, -0.8), (-0.17, -0.7), (-0.24, -0.4), (-0.17, -0.1)], 6)
    fobo = L.extrude2d('fob', fob, 0.06, br, bev=0.02, seg=3, rot=(PI / 2, 0, 0))
    inner = [(x * 0.78, -0.4 + (y + 0.4) * 0.8) for x, y in fob]
    cut = L.extrude2d('fobcut', inner, 0.05, None, loc=(0, -0.04, 0), rot=(PI / 2, 0, 0))
    fobo = L.boolean(fobo, cut)
    hole = L.cyl('hole', 0.035, 0.3, None, 24, loc=(0, 0, -0.06), rot=(PI / 2, 0, 0))
    fobo = L.boolean(fobo, hole)
    en = L.extrude2d('fobenamel', inner, 0.02, enamel, loc=(0, -0.012, 0), rot=(PI / 2, 0, 0))
    tx = L.text('fobM', 'M', 0.3, 0.012, br, loc=(0, -0.03, -0.42), rot=(PI / 2, 0, 0), bev=0.004)
    fe = bpy.data.objects.new('FOB', None); L.link(fe)
    for p in (fobo, en, tx): p.parent = fe
    fe.location = top; fe.rotation_euler = (0, 0, math.radians(-18))
    return dict(az=0, el=10, fill=0.84, lens=70, floor=False, wall=1.6, floor_glow=False,
                refl=[((0, -1, 0), (-0.2, 0, 0), 500, 3.0, (0.2, 0, 0.2))])

def build_handMirror():
    silver = L.metal('silver', '#cfc9bf', 0.26, 0.1, '#241c14', 9.0, 1.0)
    glass = L.metal('mirror', '#e9edf0', 0.02, 0.0, '#e9edf0', 3.0, 0.0)
    L.root()
    rx, rz, cz = 0.5, 0.64, 0.55
    ell = lambda sx, sz, n=96: [(sx * math.cos(2 * PI * i / n), sz * math.sin(2 * PI * i / n)) for i in range(n)]
    # back plate, glass, rolled rim, beads
    L.extrude2d('back', [(x, y + cz) for x, y in ell(rx + 0.09, rz + 0.09)], 0.07, silver, bev=0.025, seg=3, loc=(0, 0.02, 0), rot=(PI / 2, 0, 0))
    L.extrude2d('glass', [(x, y + cz) for x, y in ell(rx - 0.01, rz - 0.01)], 0.02, glass, loc=(0, -0.025, 0), rot=(PI / 2, 0, 0))
    L.tube('rim', [(x, -0.03, y + cz) for x, y in ell(rx + 0.02, rz + 0.02)], 0.055, silver, closed=True, kind='POLY', bevres=4)
    for x, y in ell(rx + 0.1, rz + 0.1, 36):
        L.sphere('bead', 0.034, silver, loc=(x, -0.02, y + cz), seg=16, rings=8)
    # crest at the top and a leaf where the handle joins
    L.sphere('crest', 0.08, silver, loc=(0, -0.03, cz + rz + 0.12), scale=(1.3, 0.5, 1.0))
    for sgn in (-1, 1):
        L.tube('scroll', [(0, -0.03, cz + rz + 0.1), (sgn * 0.12, -0.03, cz + rz + 0.16), (sgn * 0.22, -0.03, cz + rz + 0.1), (sgn * 0.2, -0.03, cz + rz + 0.04)], 0.025, silver, bevres=3)
    L.sphere('neck', 0.12, silver, loc=(0, 0.0, cz - rz - 0.02), scale=(1.2, 0.55, 0.9))
    hp = [(0, 0), (0.05, 0), (0.07, 0.03), (0.07, 0.06), (0.05, 0.09), (0.045, 0.3), (0.06, 0.38), (0.075, 0.42), (0.06, 0.46),
          (0.04, 0.5), (0.04, 0.62), (0.055, 0.66), (0.08, 0.7), (0.055, 0.74), (0.045, 0.78), (0.06, 0.82), (0, 0.84)]
    L.lathe('handle', [(r, -z) for r, z in hp][::-1] if False else hp, silver, 48, 40, loc=(0, 0, cz - rz - 0.08), rot=(PI, 0, 0))
    L.ROOT.rotation_euler = (math.radians(-6), math.radians(24), math.radians(22))
    return dict(az=0, el=10, fill=0.86, lens=70, floor=False, wall=1.5, floor_glow=False,
                refl=[((0, -1, 0), (0, 0, 0.55), 350, 1.4, (-0.35, 0, 0.25)), ((0, -1, 0), (0, 0, 0.55), 120, 5.0, (0.1, 0, -0.1))])

def build_bandage():
    m, nt, b = L.new_mat('gauze')
    v = L.tex_coord(nt, 'Object')
    n = L.noise(nt, v, 30, 6, 0.7)
    r = L.ramp(nt, n.outputs['Fac'], [(0.3, lin('#f1e9d8')), (0.7, lin('#ddd2bb'))])
    col = L.ao_dirt(nt, r.outputs['Color'], '#6a5a42', 0.05, 0.8)
    nt.link(col, b.inputs['Base Color'])
    L.P(b, Roughness=0.85, **{'Sheen Weight': 0.5, 'Sheen Roughness': 0.35, 'Subsurface Weight': 0.15, 'Subsurface Scale': 0.02})
    w1 = nt.add('ShaderNodeTexWave'); w1.inputs['Scale'].default_value = 70; nt.link(v, w1.inputs['Vector'])
    w2 = nt.add('ShaderNodeTexWave'); w2.bands_direction = 'Y'; w2.inputs['Scale'].default_value = 70; nt.link(v, w2.inputs['Vector'])
    mx = nt.add('ShaderNodeMath', operation='MULTIPLY'); nt.link(w1.outputs['Fac'], mx.inputs[0]); nt.link(w2.outputs['Fac'], mx.inputs[1])
    bu = nt.add('ShaderNodeBump'); bu.inputs['Strength'].default_value = 0.6; bu.inputs['Distance'].default_value = 0.004
    nt.link(mx.outputs[0], bu.inputs['Height']); nt.link(bu.outputs['Normal'], b.inputs['Normal'])
    gauze = m
    # the roll's ends show its wound layers
    m, nt, b = L.new_mat('rollend')
    v = L.tex_coord(nt, 'Object')
    w = nt.add('ShaderNodeTexWave'); w.wave_type = 'RINGS'; w.rings_direction = 'Z'; w.inputs['Scale'].default_value = 14
    w.inputs['Distortion'].default_value = 0.6; nt.link(v, w.inputs['Vector'])
    r = L.ramp(nt, w.outputs['Fac'], [(0.0, lin('#b5a88e')), (0.25, lin('#ece3d0')), (1.0, lin('#e6dcc6'))])
    col = L.ao_dirt(nt, r.outputs['Color'], '#6a5a42', 0.05, 0.8)
    nt.link(col, b.inputs['Base Color']); L.P(b, Roughness=0.9, **{'Sheen Weight': 0.4})
    bu = nt.add('ShaderNodeBump'); bu.inputs['Strength'].default_value = 0.4
    nt.link(w.outputs['Fac'], bu.inputs['Height']); nt.link(bu.outputs['Normal'], b.inputs['Normal'])
    ends = m
    # kraft paper band with a red cross printed on it, centred where the band faces the camera
    m, nt, b = L.new_mat('paper')
    tc = nt.add('ShaderNodeTexCoord'); sep = nt.add('ShaderNodeSeparateXYZ'); nt.link(tc.outputs['Object'], sep.inputs[0])
    def mth(op, a, b_=None):
        nd = nt.add('ShaderNodeMath', operation=op)
        (nt.link(a, nd.inputs[0]) if not isinstance(a, float) else setattr(nd.inputs[0], 'default_value', a))
        if b_ is not None: (nt.link(b_, nd.inputs[1]) if not isinstance(b_, float) else setattr(nd.inputs[1], 'default_value', b_))
        return nd.outputs[0]
    th0 = math.atan2(-math.cos(math.radians(24)), -math.sin(math.radians(24)))
    s_ = mth('MULTIPLY', mth('SUBTRACT', mth('ARCTAN2', sep.outputs['Y'], sep.outputs['X']), th0), 0.46)
    t_ = sep.outputs['Z']
    As, At = mth('ABSOLUTE', s_), mth('ABSOLUTE', t_)
    arm1 = mth('MULTIPLY', mth('LESS_THAN', As, 0.13), mth('LESS_THAN', At, 0.042))
    arm2 = mth('MULTIPLY', mth('LESS_THAN', As, 0.042), mth('LESS_THAN', At, 0.13))
    cross = mth('MAXIMUM', arm1, arm2)
    mx = nt.add('ShaderNodeMix'); mx.data_type = 'RGBA'; nt.link(cross, mx.inputs['Factor'])
    mx.inputs[6].default_value = lin('#cdb68a'); mx.inputs[7].default_value = lin('#a8181e')
    col = L.ao_dirt(nt, mx.outputs[2], '#5a4a30', 0.05, 0.6)
    nt.link(col, b.inputs['Base Color']); L.P(b, Roughness=0.55)
    paper = m
    L.root()
    R, W = 0.45, 0.6
    roll = L.lathe('roll', [(0, -W / 2), (R - 0.03, -W / 2), (R - 0.005, -W / 2 + 0.012), (R, -W / 2 + 0.04), (R, W / 2 - 0.04),
                           (R - 0.005, W / 2 - 0.012), (R - 0.03, W / 2), (0, W / 2)], gauze, 96, 30, loc=(0, 0, R), rot=(0, PI / 2, 0))
    # end faces get the layered material (mesh axis is Z before the object's rotation)
    roll.data.materials.append(ends)
    for p in roll.data.polygons:
        if abs(p.normal.z) > 0.9: p.material_index = 1
    # paper band with a red cross, turned to face the camera
    L.lathe('band', [(R + 0.003, -0.17), (R + 0.014, -0.17), (R + 0.014, 0.17), (R + 0.003, 0.17)], paper, 128, 40, loc=(0, 0, R), rot=(0, PI / 2, 0))
    # the loose tail, unrolled on the floor towards us with a little curl at the end
    path = [(-0.3, 0.1), (-0.15, 0.015), (0.0, 0.004), (0.25, 0.004), (0.45, 0.008), (0.6, 0.03), (0.68, 0.09), (0.66, 0.15), (0.6, 0.16), (0.57, 0.12)]
    pts = L.smooth_poly(path, 8, closed=False)
    bm = bmesh.new(); rows = []
    for i, (u, zz) in enumerate(pts):
        sway = 0.04 * math.sin(i * 0.12)
        rows.append((bm.verts.new((-W / 2 + 0.03 + sway, -u, zz)), bm.verts.new((W / 2 - 0.03 + sway, -u, zz))))
    for (a0, a1), (b0, b1) in zip(rows, rows[1:]): bm.faces.new((a0, a1, b1, b0))
    tail = L.mesh_obj('tail', bm, gauze, 60)
    sol = tail.modifiers.new('sol', 'SOLIDIFY'); sol.thickness = 0.012
    tail = L.bake(tail, 60)
    # a brass safety pin resting on the tail
    pin = brass('pin', 0.22)
    px, py = -0.12, -0.3
    L.torus('coil', 0.035, 0.008, pin, loc=(px - 0.2, py, 0.05), rot=(PI / 2, 0, 0), seg=32)
    L.tube('wire1', [(px - 0.2, py, 0.085), (px, py, 0.075), (px + 0.2, py, 0.06)], 0.008, pin, bevres=2)
    L.tube('wire2', [(px - 0.2, py, 0.015), (px, py, 0.03), (px + 0.2, py, 0.045)], 0.008, pin, bevres=2)
    L.box('clasp', (0.07, 0.03, 0.06), pin, 0.012, loc=(px + 0.21, py, 0.055))
    L.ROOT.rotation_euler = (0, 0, math.radians(-30))
    return dict(az=0, el=24, fill=0.8, lens=70, floor=True, center=(0.5, 0.54))

def build_flashlight():
    nick = L.metal('nickel', '#c2c0ba', 0.2, 0.08, '#1c1a16', 10.0, 0.9)
    br = brass('fbrass', 0.28)
    lens = L.emissive('lens', '#ffd98a', 14.0)
    refl = L.metal('reflector', '#f0e6d0', 0.08, 0.02, '#f0e6d0', 5.0, 0.0)
    L.root()
    prof = [(0, -1.05), (0.07, -1.05), (0.11, -1.03), (0.135, -1.0), (0.14, -0.96), (0.135, -0.93), (0.13, -0.9), (0.13, 0.28),
            (0.14, 0.3), (0.14, 0.34), (0.15, 0.36), (0.23, 0.6), (0.245, 0.62), (0.255, 0.64), (0.255, 0.72), (0.245, 0.745),
            (0.215, 0.75), (0.2, 0.735), (0, 0.735)]
    body = L.lathe('body', prof, nick, 72, 35, rot=(0, PI / 2, 0))
    for x0 in (-0.86, 0.08):
        for k in range(7):
            L.torus('knurl', 0.131, 0.012, br, loc=(x0 + k * 0.03, 0, 0), rot=(0, PI / 2, 0), seg=48)
    L.lathe('lens', [(0, 0.7), (0.205, 0.7), (0.205, 0.742), (0, 0.742)], lens, 64, None, rot=(0, PI / 2, 0))
    L.lathe('bezelring', [(0.2, 0.74), (0.255, 0.74), (0.255, 0.76), (0.21, 0.77), (0.2, 0.765)], br, 72, 35, rot=(0, PI / 2, 0))
    # slide switch on top, lanyard ring at the tail
    L.box('switchbase', (0.3, 0.1, 0.03), br, 0.01, loc=(-0.3, 0, 0.13))
    L.box('switch', (0.08, 0.07, 0.05), br, 0.012, loc=(-0.22, 0, 0.16))
    L.torus('lanyard', 0.07, 0.014, br, loc=(-1.1, 0, 0), rot=(0, 0, 0), scale=(1, 1, 1), seg=40)
    L.ROOT.rotation_euler = (math.radians(-6), math.radians(-30), math.radians(-40))
    ANCHORS['lens'] = [Vector((0.745, 0, 0)), 0.2]
    ANCHORS['lens_dir'] = [Vector((1.745, 0, 0)), 0.2]
    return dict(az=0, el=12, fill=0.84, lens=70, floor=False, wall=1.8, floor_glow=False, beam=True, center=(0.44, 0.56),
                refl=[((0, 0, 1), (-0.3, 0, 0.13), 300, 2.5, (0, 0, 0))])

def build_possession():
    pewter = L.metal('pewter', '#8d8594', 0.3, 0.12, '#0e0812', 8.0, 1.0)
    glow = L.emissive('violet', '#b46bff', 12.0)
    # the eye: pale veined sclera, glowing violet iris, black slit pupil (facing -Y)
    m, nt, b = L.new_mat('eye')
    tc = nt.add('ShaderNodeTexCoord'); sep = nt.add('ShaderNodeSeparateXYZ'); nt.link(tc.outputs['Object'], sep.inputs[0])
    def mth(op, a, b_=None, v=None):
        nd = nt.add('ShaderNodeMath', operation=op)
        (nt.link(a, nd.inputs[0]) if not isinstance(a, float) else setattr(nd.inputs[0], 'default_value', a))
        if b_ is not None:
            (nt.link(b_, nd.inputs[1]) if not isinstance(b_, float) else setattr(nd.inputs[1], 'default_value', b_))
        return nd.outputs[0]
    X, Z = sep.outputs['X'], sep.outputs['Z']
    rr = mth('SQRT', mth('ADD', mth('MULTIPLY', X, X), mth('MULTIPLY', Z, Z)))
    px = mth('MULTIPLY', X, 3.6)
    pr = mth('SQRT', mth('ADD', mth('MULTIPLY', px, px), mth('MULTIPLY', Z, Z)))
    iris = mth('LESS_THAN', rr, 0.19)
    pupil = mth('LESS_THAN', pr, 0.13)
    nz = L.noise(nt, tc.outputs['Object'], 18, 8, 0.7)
    veins = L.ramp(nt, nz.outputs['Fac'], [(0.45, lin('#d9cfc4')), (0.5, lin('#8a2a3a')), (0.55, lin('#d9cfc4'))])
    irc = L.ramp(nt, mth('ADD', mth('MULTIPLY', rr, 4.4), mth('MULTIPLY', nz.outputs['Fac'], 0.5)), [(0.25, lin('#e0a8ff')), (0.55, lin('#a64dff')), (0.95, lin('#3a0c70'))])
    c1 = nt.add('ShaderNodeMix'); c1.data_type = 'RGBA'; nt.link(iris, c1.inputs['Factor']); nt.link(veins.outputs['Color'], c1.inputs[6]); nt.link(irc.outputs['Color'], c1.inputs[7])
    c2 = nt.add('ShaderNodeMix'); c2.data_type = 'RGBA'; nt.link(pupil, c2.inputs['Factor']); nt.link(c1.outputs[2], c2.inputs[6]); c2.inputs[7].default_value = (0.005, 0.0, 0.01, 1)
    nt.link(c2.outputs[2], b.inputs['Base Color'])
    em = mth('MULTIPLY', mth('SUBTRACT', iris, pupil), 4.0)
    nt.link(irc.outputs['Color'], b.inputs['Emission Color']); nt.link(em, b.inputs['Emission Strength'])
    L.P(b, Roughness=0.08, **{'Coat Weight': 1.0, 'Coat Roughness': 0.02, 'Subsurface Weight': 0.2, 'Subsurface Scale': 0.02})
    eye = m
    L.root()
    # body disc with raised rim, pierced with an almond-shaped opening
    body = L.lathe('disc', [(0, -0.06), (0.6, -0.06), (0.64, -0.03), (0.64, 0.04), (0.6, 0.075), (0.54, 0.075), (0.5, 0.03), (0, 0.03)], pewter, 96, 35, rot=(-PI / 2, 0, 0))
    alm = []
    for i in range(48):
        t = 2 * PI * i / 48
        alm.append((0.42 * math.cos(t), 0.22 * math.sin(t) * (abs(math.sin(t)) ** 0.0) * (1 - 0.0) * (1 if True else 1) * (0.55 + 0.45 * (1 - abs(math.cos(t)) ** 2) ** 0.5) / 1.0))
    cut = L.extrude2d('almond', alm, 0.5, None, rot=(PI / 2, 0, 0))
    body = L.boolean(body, cut)
    L.tube('lids', [(x, -0.035, y) for x, y in alm], 0.035, pewter, closed=True, kind='POLY', bevres=4)
    L.sphere('eye', 0.26, eye, loc=(0, 0.13, 0), rot=(0, 0, 0))
    # glowing ring inside the rim
    L.torus('glowring', 0.56, 0.012, glow, loc=(0, -0.06, 0), rot=(PI / 2, 0, 0), seg=96)
    # rays: long and short, alternating
    for k in range(16):
        a = 2 * PI * k / 16 + PI / 2
        ln = 0.36 if k % 2 == 0 else 0.2
        w = 0.1 if k % 2 == 0 else 0.07
        r0 = 0.6
        pts = [(r0, -w), (r0 + ln * 0.55, -w * 0.45), (r0 + ln, 0), (r0 + ln * 0.55, w * 0.45), (r0, w)]
        ca, sa = math.cos(a), math.sin(a)
        pr_ = [(x * ca - y * sa, x * sa + y * ca) for x, y in pts]
        L.extrude2d('ray', pr_, 0.05, pewter, bev=0.012, seg=2, loc=(0, 0.0, 0), rot=(PI / 2, 0, 0))
    # bail and a short chain going up
    L.torus('bail', 0.09, 0.025, pewter, loc=(0, 0, 1.07), rot=(0, PI / 2, 0), seg=40)
    z = 1.2
    for k in range(4):
        L.torus('link', 0.07, 0.018, pewter, loc=(0, 0, z), rot=((0, PI / 2, 0) if k % 2 else (PI / 2, 0, 0)), scale=(1, 1, 1.6) if False else (1, 1, 1), seg=32)
        z += 0.12
    L.ROOT.rotation_euler = (math.radians(4), math.radians(-8), math.radians(-14))
    return dict(az=0, el=6, fill=0.84, lens=70, floor=False, wall=1.2, floor_glow=False, backdrop='purple', evil=True,
                refl=[((0, -1, 0), (0, 0, 0), 250, 3.0, (0.25, 0, 0.3))])

# ================================================================================================
# Rig, render and post
# ================================================================================================
CARDS = {
    'espresso': build_espresso,
    'knife': build_knife,
    'revolver': build_revolver,
    'barricade': build_barricade,
    'lockPick': build_lockPick,
    'masterKey': build_masterKey,
    'handMirror': build_handMirror,
    'bandage': build_bandage,
    'flashlight': build_flashlight,
    'possession': build_possession,
}

def rig(cfg, lo, hi):
    tgt = Vector((0, 0, (lo.z + hi.z) / 2))
    az = cfg['az']
    if cfg.get('evil'): L.world('#2a1838', '#180a24', '#08040c', cfg.get('world', 1.0))
    else: L.world(strength=cfg.get('world', 1.0))
    k = cfg.get('light', 1.0) * 0.3
    global WARM, WARM2, COOL
    if cfg.get('evil'):
        WARM, WARM2, COOL = (0.85, 0.8, 1.0), (0.75, 0.45, 1.0), (0.6, 0.4, 0.9)
    else:
        WARM, WARM2, COOL = (1.0, 0.76, 0.5), (1.0, 0.68, 0.4), (0.55, 0.78, 0.72)
    L.area('key', L.sph(az - 50, 38, 5.5, tgt), tgt, 1100 * k * cfg.get('key', 1.0), WARM, 2.2)
    L.area('fill', L.sph(az + 70, 12, 6.0, tgt), tgt, 220 * k * cfg.get('fill', 1.0), COOL, 3.0)
    L.area('rim', L.sph(az + 150, 30, 5.0, tgt), tgt, 900 * k * cfg.get('rim', 1.0), WARM2, 1.2)
    L.area('rim2', L.sph(az - 150, 45, 5.0, tgt), tgt, 400 * k * cfg.get('rim', 1.0), WARM2, 1.2)
    L.area('top', L.sph(az, 80, 5.0, tgt), tgt, 250 * k, WARM, 2.0)
    return tgt

def project(cam, p):
    from bpy_extras.object_utils import world_to_camera_view
    q = world_to_camera_view(bpy.context.scene, cam, p)
    return (q.x, 1 - q.y)

def make(name):
    t0 = time.time()
    raw = os.path.join(BUILD, name + '.png'); meta_p = os.path.join(BUILD, name + '.json')
    if not POST_ONLY:
        L.reset(); ANCHORS.clear()
        cfg = CARDS[name]()
        lo, hi = L.normalise(cfg.get('size', 2.0))
        # pose / lift for floating objects
        if cfg.get('lift'): L.ROOT.location.z += cfg['lift']; bpy.context.view_layer.update(); lo, hi = L.bbox_world([o for o in bpy.context.scene.objects if o.type == 'MESH'])
        tgt = rig(cfg, lo, hi)
        if cfg.get('floor', True): L.catcher(lo.z - cfg.get('lift', 0) * 0)
        if cfg.get('wall') is not None:
            # a shadow-catching "backdrop" behind the object, facing the camera
            dirc = (L.sph(cfg['az'], cfg['el'], 1.0) ).normalized()
            wc = L.catcher(loc=tgt - dirc * cfg['wall'])
            wc.rotation_euler = dirc.to_track_quat('Z', 'Y').to_euler()
        L.render_setup(RES, SAMPLES, cfg.get('exposure', 0.0))
        cam, d = L.camera(cfg['az'], cfg['el'], tgt, cfg.get('fill', 0.8), cfg.get('lens', 70), cfg.get('center', (0.5, 0.5)))
        for i, rf in enumerate(cfg.get('refl', [])):
            # a soft light placed exactly where a flat metal face reflects the camera, so the face
            # shows a bright sheen instead of mirroring the dark room
            n, p, pw, sz = Vector(rf[0]), Vector(rf[1]), rf[2], rf[3]
            off = Vector(rf[4]) if len(rf) > 4 else Vector((0, 0, 0))
            M = L.ROOT.matrix_world
            nw = (M.to_3x3() @ n).normalized(); pw_ = M @ p
            v = (cam.location - pw_).normalized()
            r = (2 * nw.dot(v) * nw - v + off).normalized()
            lo_ = L.area(f'refl{i}', pw_ + r * 4.0, pw_, pw * 0.3 * cfg.get('light', 1.0), WARM, sz)
            lo_.visible_camera = False; lo_.visible_diffuse = rf[5] if len(rf) > 5 else False
        if cfg.get('front'):
            # a big soft light just above/behind the camera: flat metal faces facing us reflect it
            fl = L.area('front', L.sph(cfg['az'] + cfg.get('front_az', -12), cfg['el'] + cfg.get('front_el', 22), d * 1.1, tgt), tgt,
                        cfg['front'] * 0.3 * cfg.get('light', 1.0), WARM, cfg.get('front_size', 3.0))
            fl.visible_camera = False
        meta = {k: v for k, v in cfg.items() if isinstance(v, (int, float, str, bool, list, tuple))}
        anchors = {}
        for k, (p, r) in ANCHORS.items():
            w = L.ROOT.matrix_world @ p
            a = project(cam, w); b = project(cam, w + Vector((r * L.ROOT.scale.x, 0, 0)))
            anchors[k] = [a[0], a[1], abs(b[0] - a[0])]
        meta['anchors'] = anchors
        json.dump(meta, open(meta_p, 'w'))
        L.render(raw)
    meta = json.load(open(meta_p))
    extra = None
    if meta.get('steam'): extra = steam_fx(meta['anchors']['steam'])
    if meta.get('beam'): extra = beam_fx(meta['anchors']['lens'], meta['anchors']['lens_dir'])
    if meta.get('evil'): extra = aura_fx()
    post.composite(raw, os.path.join(OUT, name + '.jpg'), meta.get('backdrop', 'green'), seed=meta.get('seed', 7),
                   glow_amt=meta.get('glow_amt', 26.0), bloom=meta.get('bloom', 1.0), extra=extra,
                   floor_glow=meta.get('floor_glow', True))
    print(f'[{name}] {time.time() - t0:.0f}s  ->  assets/cards/{name}.jpg', flush=True)

def beam_fx(lens, ahead):
    """A soft cone of warm light from the torch's lens (painted in 2D)."""
    import numpy as np
    def fx(out, a, size):
        p = np.array(lens[:2]) * size; q = np.array(ahead[:2]) * size; r0 = lens[2] * size
        d = q - p; d /= np.linalg.norm(d); nrm = np.array([-d[1], d[0]])
        yy, xx = np.mgrid[0:size, 0:size]
        vx, vy = xx - p[0], yy - p[1]
        t = vx * d[0] + vy * d[1]; perp = np.abs(vx * nrm[0] + vy * nrm[1])
        width = r0 * 0.9 + np.maximum(t, 0) * 0.42
        beam = np.exp(-(perp / width) ** 2 * 1.6) * np.clip(t / (r0 * 0.6), 0, 1) * np.exp(-np.maximum(t, 0) / (size * 0.55))
        beam *= (1 - 0.85 * a)
        col = np.array([255, 214, 150.0])
        return out + beam[..., None] * col * 0.6
    return fx

def aura_fx():
    """A faint violet aura around the evil card's object."""
    import numpy as np
    from scipy import ndimage
    def fx(out, a, size):
        g = ndimage.gaussian_filter((a > 0.5).astype(float), size * 0.04)
        g2 = ndimage.gaussian_filter((a > 0.5).astype(float), size * 0.12)
        glow = (0.55 * g + 0.6 * g2) * (1 - a)
        return out + glow[..., None] * np.array([180, 107, 255.0]) * 0.45
    return fx

def steam_fx(anchor):
    """Soft wisps of steam rising from the cup (painted in 2D, like a painter would)."""
    import numpy as np
    from scipy import ndimage
    def fx(out, a, size):
        cx, cy, rw = anchor[0] * size, anchor[1] * size, anchor[2] * size
        layer = np.zeros((size, size))
        yy, xx = np.mgrid[0:size, 0:size]
        rng = np.random.default_rng(3)
        for k, off in enumerate((-0.45, 0.05, 0.5)):
            ph = rng.random() * 6.28
            for t in np.linspace(0, 1, 260):
                y = cy - rw * 0.15 - t * rw * 2.3
                x = cx + off * rw * (1 - 0.3 * t) + math.sin(t * 7.5 + ph) * rw * 0.18 * (0.3 + t)
                w = rw * (0.05 + 0.1 * t)
                inten = math.sin(min(1, t * 1.25) * PI) ** 1.2
                x0, x1 = int(max(0, x - 3 * w)), int(min(size, x + 3 * w)); y0, y1 = int(max(0, y - 3 * w)), int(min(size, y + 3 * w))
                if x1 <= x0 or y1 <= y0: continue
                sub = np.exp(-(((xx[y0:y1, x0:x1] - x) ** 2 + (yy[y0:y1, x0:x1] - y) ** 2) / (2 * w * w)))
                layer[y0:y1, x0:x1] = np.maximum(layer[y0:y1, x0:x1], sub * inten)
        layer = ndimage.gaussian_filter(layer, 3) * 0.32
        col = np.array([235, 225, 205.0])
        return out * (1 - layer[..., None]) + col * layer[..., None]
    return fx

if __name__ == '__main__':
    names = ONLY or list(CARDS)
    for n in names:
        if n == 'lantern': continue
        make(n)
