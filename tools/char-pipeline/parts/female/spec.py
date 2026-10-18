# The shared female body 'f' as swappable pieces: the item specs (what each piece is, how it is built, how it is baked,
# what it shades). Built by  LD_LIBRARY_PATH=... python3 tools/char-pipeline/parts/female/build.py [--only key,key] [--out dir]
#
# ONE body and rig for Clara, Eleanor and Beatrice (the female checkpoint). The three guest specs in
# tools/char-pipeline/guests/ (clara.py, eleanor.py, beatrice.py) are imported and never changed: every face, hair,
# gown, belt and earring below is built by their own numbers and builders. What is shared, and why:
#   - the BODY holds the skin every look shows: the neck and the yoke flaring into the shoulders, the bare arms and hands,
#     the bare legs. The legs, pumps, shoulders and rig are Clara's (the default Look; her column skirt is the tightest
#     round the legs). The arms are a blend: Eleanor's wide-set wrists (her ballgown is 0.26 m wide at hand height, so
#     Clara's own arms would sink into it), an elbow half-way between Eleanor's and Beatrice's (Beatrice's puff sleeves
#     clear the A-line skirt top), Eleanor's soft hands with curled fingers (Clara's straight fingers reached into the
#     ballgown).
#   - the yoke (neck to shoulders) is ONE surface fitted inside all three bodices just below each neckline (Beatrice's
#     high crew neck at 31 %, Clara's crew at 32-33 %, Eleanor's bateau, which on this body sits at 32.3-33.7 %), so no
#     neckline shows a gap or a poke.
#   - every bodice shares ONE upper torso (the neckline-to-shoulder zone, 30.6-34.5 %: Clara's shoulders, with
#     Beatrice's narrower top rings for her high crew neck). Below it each gown keeps its own bust, waist, sleeves and
#     skirt. Eleanor's shoulders come down ~1.3 % (her bateau neckline with them, keeping its width); Beatrice's bodice
#     top comes forward 2.2 cm (fading out by her waist).
#   - FACES: each classic face is its own head (the whole skull, ears, eyes and catchlights, brows, the grown button nose
#     and smile, Eleanor's and Beatrice's jaw lift), at its own height (Eleanor's head sits 3.8 cm higher than Clara's),
#     its head axis moved onto the shared neck the way it sat on its own neck (the male body's rule).
#   - HAIR is fitted to EVERY face: each style is built by its own builder in its own frame round the TARGET face's skull
#     (moved to where the style's own skull top was), then moved onto the target head (hair_builder). The cap layer
#     follows the target skull, so a skull never shows through. Plain = fitted to Clara's face; `~face_eleanor` /
#     `~face_beatrice`.
#   - EARRINGS (extras, attach 'ears') sit at the target face's ear lobe: their offset from their own ear centre, the
#     height scaled by the ear's size. Plain = Clara's ears.
#   - BELTS hug the gown they are worn with: one variant per gown (`belt_thin~dress_column`).
#
# Heights are PERCENT OF STANDING HEIGHT FROM THE TOP (g.zp(pct) -> metres), x/y in metres; Blender Z up, the guest
# faces -Y, HER right is -X (the kit's conventions). A face's own frame: Clara's head is built 0.03 m lower than the
# heights written in clara.py (her HEAD_DROP); Eleanor's and Beatrice's are not.
import math
import numpy as np
from mathutils import Vector
import guest_kit as GK
import dress_kit as DK
import female_extras as FX
import victor_lib as L
import clara as CL          # tools/char-pipeline/guests/
import eleanor as EL
import beatrice as BE

BODY = 'f'
H = 1.66
DEFAULT_FACE = 'clara'
sm = GK.sm

def _frame(drop):
    return lambda pct: H * (1.0 - pct / 100.0) - drop

# =====================================================================================================================
# FACES
# =====================================================================================================================
# head_y: the head axis on the shared neck. Each face keeps the distance from its head axis to its own neck's axis
# (measured at the top of each neck: Clara 0.023, Eleanor 0.017, Beatrice 0.0335; the shared neck: 0.022).
FACES = {
    'clara':    dict(mod=CL, drop=CL.HEAD_DROP, head_y=0.029, ear_dec=0.55, jaw=None, shine=None, look='clara',
                     colours=dict(Skin=CL.COLOURS['skin'], Brow=CL.COLOURS['brow'], Eye=CL.COLOURS['eye'], Lips=CL.COLOURS['lips'])),
    'eleanor':  dict(mod=EL, drop=0.0, head_y=0.025, ear_dec=0.55, jaw=EL.JAW, shine=EL.SHINE, look='eleanor',
                     colours=dict(Skin=EL.COLOURS['skin'], Brow=EL.COLOURS['brow'], Eye=EL.COLOURS['eye'], Lips=EL.COLOURS['lips'], Shine=EL.COLOURS['shine'])),
    'beatrice': dict(mod=BE, drop=0.0, head_y=0.0345, ear_dec=None, jaw=BE.JAW, shine=BE.SHINE, look='beatrice',
                     colours=dict(Skin=BE.COLOURS['skin'], Brow=BE.COLOURS['brow'], Eye=BE.COLOURS['eye'], Lips=BE.COLOURS['lips'], Shine=BE.COLOURS['shine'])),
}
FACE_ORDER = ['clara', 'eleanor', 'beatrice']
LOOK_OF_FACE = {'clara': ('waves', 'column', 'sash', 'goldDrop'), 'eleanor': ('chignon', 'ballgown', 'thin', 'pearlStud'),
                'beatrice': ('wavyBob', 'aline', 'thin', 'goldBall')}

def _cfg(name):
    F = FACES[name]; c = dict(F['mod'].CFG); c['head_y'] = F['head_y']
    return c

def skull_top(name):
    """World height of a face's skull top on this body (its own frame)."""
    F = FACES[name]; return H * (1.0 - F['mod'].CFG['z_skull_top'] / 100.0) - F['drop']

def use_face(g, name, place=None):
    """Switch the kit's head state to one face: its CFG, its head axis on the shared neck, its skull tables (set in its
    own frame; g.zp is left as the BODY frame, as each guest's own bake ran in the body frame). place=(drop, y0) puts
    that skull elsewhere instead (a hair being fitted to it in the hair's own frame)."""
    F = FACES[name]
    g.C = _cfg(name)
    drop, y0 = (F['drop'], F['head_y']) if place is None else place
    g.C['head_y'] = y0; g.Y0 = y0
    g.zp = _frame(drop)
    try: g.set_head(F['mod'].W, F['mod'].DF, F['mod'].DB, F['mod'].E, F['mod'].BULGES)
    finally: del g.zp
    g.face_name = name

class head_frame:
    """with head_frame(g, drop): g.zp is that frame (heights in a guest spec's own head frame)."""
    def __init__(self, g, drop): self.g, self.drop = g, drop
    def __enter__(self): self.g.zp = _frame(self.drop); return self.g
    def __exit__(self, *a): del self.g.zp

# THE CROWN every female hairstyle covers (the rule for every new style too): the skull is open there, under the hair.
# (distance round the head from the front 0 .. the back 0.5, depth below the skull top in pct). The three styles'
# hairlines, each in its own frame (aligned on the skull top), lie at least 1.3 % (2 cm) below it everywhere: the
# fringe 2.3-6.5 % below the top at the front, the sides 12-14 % (above and behind the ears), the back 24-31 %.
CROWN = [(0.0, 1.0), (0.12, 1.0), (0.25, 8.0), (0.36, 14.0), (0.5, 20.0)]

def crown_covered(g):
    T = GK.Table(CROWN); zt, Y0 = g.zt, g.Y0
    def cov(p):
        a = abs(math.atan2(p.x, -(p.y - Y0))) / (2 * math.pi)
        return (zt - p.z) / H * 100.0 < T(a)
    return cov

def build_face(g):
    """The whole head of the current face: skull (open only under the CROWN), ears, eyes (+ catchlights), brows, the
    button nose and the closed smile grown out of the skin (dress_kit.soft_nose / smile_lips). Records the face's
    after-bake shading (lips parting, Eleanor's chin shadow) and its relief normals in g.face_state."""
    name = g.face_name; F = FACES[name]; M = F['mod']
    g.post_bake = []; g.relief_normals = {}; g._skull_samplers = {}
    with head_frame(g, F['drop']):
        skull = GK.head(g, nlon=48, nlat=34, cull_in=crown_covered(g))
        if F['jaw']: DK.jaw_lift(g, skull, F['jaw'])
        GK.ears(g)
        if F['ear_dec']: DK.decimate_parts(g, 'Ear', F['ear_dec'])
        g.eye_pts = []; GK.eyes(g); g.face_eye_centre = sum(g.eye_pts, Vector()) / len(g.eye_pts)
        if F['shine']: DK.eye_shine(g, F['shine'])
        GK.brows(g); DK.soft_nose(g, skull, M.NOSE); DK.smile_lips(g, skull, M.LIPS)
    shades = list(g.post_bake)
    if name == 'eleanor':
        shades.append(('Skin', eleanor_chin_shade(g)))
    g.face_state = getattr(g, 'face_state', {}); g.face_state[name] = dict(shades=shades, relief=dict(g.relief_normals))
    g.post_bake = []; g.relief_normals = {}

def eleanor_chin_shade(g):
    """Eleanor's own soft shadow on the neck under her chin (guests/eleanor.py: the face ends in a clear jawline), as a
    function of the point; applied to her face's skin after the bake and folded into her face's shadow patch on the
    body's neck."""
    zc = g.zc
    return lambda co: (1.0 - 0.30 * GK.sm((zc + 0.004 + 2.8 * co.x * co.x - co.z) / 0.012) * (1.0 - GK.sm((zc - 0.09 - co.z) / 0.05))
                       * GK.sm((0.30 - abs(co.x)) / 0.05))

def face_post(g, mesh):
    """After the face's bake (and AO lift): its relief normals, its soft face normals, its shading (dress_kit.finish's
    order)."""
    name = mesh.name.split('_', 1)[1]; st = g.face_state[name]
    use_face(g, name)
    keep = getattr(g, 'mesh', None); g.mesh = mesh
    g.relief_normals = st['relief']; DK.relief_normals(g); g.relief_normals = {}
    if g.C.get('soft_normals'): DK.soft_normals(g, g.C['soft_normals'])
    for mat, fn in st['shades']: DK.shade(g, mat, fn)
    g.mesh = keep

def body_post(g, mesh):
    """The body's neck gets the default face's soft normals (Clara's: her own neck had them)."""
    use_face(g, DEFAULT_FACE)
    keep = getattr(g, 'mesh', None); g.mesh = mesh
    if g.C.get('soft_normals'): DK.soft_normals(g, g.C['soft_normals'])
    g.mesh = keep

# =====================================================================================================================
# BODY (neck + yoke, arms, hands, legs: the skin every look shows)
# =====================================================================================================================
# the yoke: a neck column (reaching up into Eleanor's higher head) flaring into the shoulders, fitted just inside the
# shared upper torso (TORSO below) at every neckline height
NECK = dict(rings=[(24.0, 0.108, 0.106, 1.0, 0.024), (27.0, 0.110, 0.108, 1.0, 0.022), (29.0, 0.114, 0.111, 1.0, 0.020),
                   (30.0, 0.124, 0.118, 1.0, 0.018), (30.6, 0.150, 0.132, 1.0, 0.017), (31.0, 0.178, 0.143, 1.0, 0.016),
                   (31.6, 0.210, 0.152, 0.98, 0.014), (32.4, 0.264, 0.168, 0.94, 0.010), (33.3, 0.298, 0.186, 0.90, 0.005),
                   (34.6, 0.304, 0.204, 0.86, -0.003)],
            split=30.0, blend=0.02, n=28)
# the arms: Clara's shoulder, an elbow between Eleanor's and Beatrice's, Eleanor's wrist and soft curled hands
A = dict(
    shoulder=(0.178, 36.0), shoulder_y=0.003, elbow=(0.220, -0.004, 49.5), wrist=(0.294, -0.044, 58.6),
    sleeve_end=58.8, cuff_end=58.8, sleeve=None, n=16,
    stations=[('end', 0.052, 0.049), (57.3, 0.061, 0.057), (56.0, 0.068, 0.064), (52.0, 0.077, 0.072), (49.5, 0.082, 0.077),
              (46.0, 0.088, 0.083), (42.0, 0.091, 0.087), (38.5, 0.092, 0.088), (('j', -0.005), 0.088, 0.088), (('j', 0.02), 0.077, 0.079),
              (('j', 0.035), 0.041, 0.046)],
    hand=EL.A['hand'],
)
LEGS = CL.LEGS
SHOES = CL.SHOES
RIG = dict(CL.RIG, arm=A, hand_end=66.0)

def build_body(g):
    DK.neck_yoke(g, NECK)
    GK.arms(g, A); DK.soft_hands(g, A)
    DK.legs(g, LEGS, RIG)

# =====================================================================================================================
# GOWNS (bodice + sleeves + skirt), on the shared upper torso
# =====================================================================================================================
TORSO = [(30.6, 0.190, 0.156, 1.0, 0.018), (31.0, 0.198, 0.160, 1.0, 0.016), (31.6, 0.220, 0.160, 0.95, 0.014),
         (32.4, 0.280, 0.176, 0.90, 0.010), (33.3, 0.318, 0.198, 0.85, 0.004), (34.5, 0.330, 0.224, 0.80, -0.004)]

def _bodice(B, below, neck, dy=None):
    """A gown's bodice dict on the shared torso: the TORSO rings, then the gown's own profiles below `below` pct (dy(pct)
    -> y shift for them), its own neckline kind with the heights given."""
    own = [(p, w, d, r, y + (dy(p) if dy else 0.0)) for p, w, d, r, y in B['profiles'] if p >= below]
    return dict(B, profiles=sorted(own + TORSO, key=lambda q: -q[0]), neck=dict(B['neck'], **neck))

BOD_COLUMN = _bodice(CL.BOD, 36.0, {})                                         # Clara: her own neckline (32.0 / 33.3 / 32.4)
BOD_BALLGOWN = _bodice(EL.BOD, 36.0, dict(side=32.3, front=33.7, back=33.2))   # the bateau keeps its width on these shoulders
BOD_ALINE = _bodice(BE.BOD, 37.0, {}, dy=lambda p: -0.022 * (1.0 - sm((p - 37.0) / 11.5)))   # forward onto the shared torso
# Beatrice's cuff ends at the shared wrist (her own wrist was 0.8 % lower), the gathers above it follow
SLV_ALINE = dict(BE.SLV, end=56.8, cuff=dict(BE.SLV['cuff'], end=58.8),
                 stations=[(('end' if p == 'end' else (p - 0.6 if isinstance(p, float) and p > 50.0 else p)), w, d) for p, w, d in BE.SLV['stations']])

DRESSES = {
    'column':   dict(bod=BOD_COLUMN, slv=CL.SLV, skirt=CL.SKIRT, centre_y=-0.02, look='clara', mod=CL),
    'ballgown': dict(bod=BOD_BALLGOWN, slv=EL.SLV, skirt=EL.SKIRT, centre_y=-0.035, look='eleanor', mod=EL),
    'aline':    dict(bod=BOD_ALINE, slv=SLV_ALINE, skirt=BE.SKIRT, centre_y=0.0, look='beatrice', mod=BE),
}
DRESS_ORDER = ['column', 'ballgown', 'aline']

def dress_builder(did):
    D = DRESSES[did]
    def fn(g):
        DK.bodice(g, D['bod'])
        DK.sleeves(g, A, D['slv'])
        DK.skirt(g, D['skirt'], RIG)
        top = D['skirt']['top']; cy = D['centre_y']
        bod_r, skirt_pt = g.bod_r, g.skirt_pt
        def waist_pt(phi, z):                    # a belt hugs whichever is further out: bodice or skirt top
            p = bod_r(phi, z); q = skirt_pt(phi, z) if z <= g.zp(top) else p
            c = Vector((0.0, cy, z))
            return p if (p - c).length >= (q - c).length else q
        g.dress_state = getattr(g, 'dress_state', {}); g.dress_state[did] = dict(waist_pt=waist_pt, skirt_r=g.skirt_r)
    return fn

# belts: the sash (Clara's) and the thin gold belt (Eleanor's / Beatrice's) round each gown's own waist
def _belt(base, waist, own_waist):
    d = waist - own_waist
    return dict(base, top=round(base['top'] + d, 3), bot=round(base['bot'] + d, 3))
WAIST = {'column': CL.BOD['waist'], 'ballgown': EL.BOD['waist'], 'aline': BE.BOD['waist']}
BELTS = {
    'sash': dict(spec={d: _belt(CL.SASH, WAIST[d], WAIST['column']) for d in DRESS_ORDER}, mat='Sash', colour=CL.COLOURS['sash'],
                 bake=dict(ao_skip=CL.CFG['ao_skip'])),
    'thin': dict(spec={'ballgown': EL.BELT, 'aline': BE.BELT, 'column': _belt(EL.BELT, WAIST['column'], WAIST['ballgown'])}, mat='Gold',
                 colour=EL.COLOURS['gold'], bake=dict(ao_skip=EL.CFG['ao_skip'], sheen=dict(Gold=EL.CFG['sheen']['Gold']))),
}
BELT_HOME = {'sash': 'column', 'thin': 'ballgown'}      # the gown each belt's plain file fits (its first Look's)

def copy_weights(objs, src, k=6):
    """Give each object the skin weights of the surface under it (inverse-distance blend of the `k` nearest vertices of
    `src`): a belt moves exactly with the gown it lies on, so the gown never shows through it when walking (contract
    3.3; dress_kit's own belt weights were a flat half spine / half hips)."""
    from mathutils.kdtree import KDTree
    me = src.data; tree = KDTree(len(me.vertices))
    for v in me.vertices: tree.insert(v.co, v.index)
    tree.balance()
    names = {gr.index: gr.name for gr in src.vertex_groups}
    wts = [{names[e.group]: e.weight for e in v.groups if e.weight > 1e-4} for v in me.vertices]
    for ob in objs:
        for vg in list(ob.vertex_groups): ob.vertex_groups.remove(vg)
        groups = {}
        for v in ob.data.vertices:
            acc, tot = {}, 0.0
            for co, i, d in tree.find_n(v.co, k):
                w = 1.0 / max(d, 1e-4); tot += w
                for b, x in wts[i].items(): acc[b] = acc.get(b, 0.0) + w * x
            s_ = sum(acc.values()) or 1.0
            for b, x in acc.items():
                if b not in groups: groups[b] = ob.vertex_groups.new(name=b)
                groups[b].add([v.index], x / s_, 'REPLACE')

def belt_builder(bid, did):
    def fn(g):
        import bpy
        st = g.dress_state[did]; keep = getattr(g, 'skirt_r', None); g.skirt_r = st['skirt_r']; n0 = len(g.parts)
        try: DK.belt(g, BELTS[bid]['spec'][did], st['waist_pt'])
        finally: g.skirt_r = keep
        copy_weights(g.parts[n0:], bpy.data.objects[f'dress_{did}'])
    return fn

def cull_inside(g, prefix, cover_prefixes):
    """Remove the faces of the parts named `prefix`* whose vertices all lie inside the parts named by cover_prefixes
    (ray parity, 3 directions): the pumps' foot skin hidden inside the shoe (only the instep shows)."""
    import bmesh
    from mathutils.bvhtree import BVHTree
    covers = [o for o in g.parts if any(o.name.startswith(c) for c in cover_prefixes)]
    trees = []
    for o in covers:
        bm = bmesh.new(); bm.from_mesh(o.data); bmesh.ops.triangulate(bm, faces=bm.faces[:]); trees.append(BVHTree.FromBMesh(bm)); bm.free()
    dirs = [Vector((0.3, 0.2, 1.0)).normalized(), Vector((-0.2, 1.0, 0.3)).normalized(), Vector((1.0, -0.3, 0.2)).normalized()]
    def inside(p):
        for t in trees:
            votes = 0
            for d in dirs:
                n, q = 0, p.copy()
                for _ in range(8):
                    hit = t.ray_cast(q, d, 1.0)
                    if hit[0] is None: break
                    n += 1; q = hit[0] + d * 1e-5
                votes += n % 2
            if votes >= 2: return True
        return False
    for o in [o for o in g.parts if o.name.startswith(prefix)]:
        bm = bmesh.new(); bm.from_mesh(o.data)
        ins = {v.index: inside(v.co + Vector()) for v in bm.verts}
        dead = [f for f in bm.faces if all(ins[v.index] for v in f.verts)]
        bmesh.ops.delete(bm, geom=dead, context='FACES'); bm.to_mesh(o.data); bm.free(); o.data.update()

def build_pumps(g):
    DK.pumps(g, SHOES)
    cull_inside(g, 'Foot', ('Pump',))

# =====================================================================================================================
# HAIR: each style built by its own guest's builder in its own frame, round the target face's skull, then moved on
# =====================================================================================================================
HAIR_SRC = {'waves': 'clara', 'chignon': 'eleanor', 'wavyBob': 'beatrice'}
HAIR_ORDER = ['waves', 'chignon', 'wavyBob']

def _hair_waves(g):
    FX.long_hair(g, CL.HAIR)
    FX.lock_tube(g, 'HairWave', CL.WAVE_TUBE, n_samples=56, n_ring=16)
    for i, c in enumerate(CL.CURLS): FX.spiral_curl(g, f'HairCurl{i}', **c)
    return None

def _hair_chignon(g):
    """guests/eleanor.py's hair: the sculpted updo with the twisted chignon, and its glossy bands (painted after the bake)."""
    hs = dict(EL.SCULPT); hs['masses'] = EL.SCULPT['masses'] + [EL.BUN_CORE]
    hs['rolls'] = EL.SCULPT['rolls'] + [dict(keys=DK.loop_keys(g, **{k: v for k, v in lp.items() if k != 'crease'}), k=0.004) for lp in EL.BUN_LOOPS]
    gr = []
    for i_lp, lp in enumerate(EL.BUN_LOOPS):
        lp = dict(lp); crease = lp.pop('crease', True)
        if not crease: continue
        rmax = max(r for _, r in lp['rope'])
        for side in ((0.85,) if i_lp == 0 else (-0.85, 0.85)):
            q = dict(lp, radii=(lp['radii'][0] + side * rmax, lp['radii'][1] + side * rmax), rope=((0.0, 0.003), (0.15, 0.006), (0.85, 0.006), (1.0, 0.003)))
            if q['radii'][1] > 0.01: gr.append(dict(keys=DK.loop_keys(g, **q), depth=0.007, k=0.003, n=40))
    hs['grooves'] = EL.SCULPT['grooves'] + gr
    DK.sculpt_hair(g, hs)
    bc = EL.BUN_CORE['c']
    return [dict(light=0.30, dark=0.30, lines=True, line_w=0.05, line_amt=0.7, stripes=[
        dict(ref=DK._curve(g, EL.WAVE1, 60)[0], period=0.042, phase=0.0, max=0.17),
        dict(ref=DK._curve(g, EL.LEFT1, 60)[0], period=0.038, phase=0.0, max=0.07),
        dict(axis=((bc[0], g.Y0 + bc[1], g.zp(bc[2])), EL.BUN_AX), period=0.028, turn=1.0, radius=0.10)])]

def _hair_bob(g):
    BE.band_hair(g, BE.SCULPT)
    return None

HAIR_FN = {'waves': _hair_waves, 'chignon': _hair_chignon, 'wavyBob': _hair_bob}

def hair_offset(hid, target):
    """(dy, dz): how far a style built in its own frame (its guest's own head axis) moves onto the target face on this
    body (skull top onto skull top)."""
    src = HAIR_SRC[hid]
    return FACES[target]['head_y'] - FACES[src]['mod'].CFG['head_y'], skull_top(target) - skull_top(src)

def hair_builder(hid):
    """A style fitted to the current face: built by its own guest's builder in its own frame, round the target skull
    moved to where the style's own skull was (top on top), then moved onto the target head (d). The cap layer follows
    the real target skull, so a skull never shows through. On its own face d is the head axis's move onto the shared
    neck only: the classic piece, unchanged. (Tried and dropped: stretching a style to the target's head width. On
    Beatrice's wider head it pushed the temple hair further out and the side-view red-eye score fell from 0.90 to 0.84.)"""
    def fn(g):
        target = g.face_name; src = HAIR_SRC[hid]; S = FACES[src]
        dy, dz = hair_offset(hid, target)
        place_drop = H * (1.0 - FACES[target]['mod'].CFG['z_skull_top'] / 100.0) - skull_top(src)
        use_face(g, target, place=(place_drop, S['mod'].CFG['head_y']))
        n0 = len(g.parts); g.hair_groove = None; g.hair_warp = None
        with head_frame(g, S['drop']):
            bands = HAIR_FN[hid](g)
        d = Vector((0.0, dy, dz))
        for ob in g.parts[n0:]: L.translate_verts(ob, d)
        groove = g.hair_groove
        g.hair_groove = (lambda p, f=groove: f(p - d)) if groove else None
        g.hair_state = getattr(g, 'hair_state', {})
        g.hair_state[g._building_key] = dict(bands=bands, warp=g.hair_warp, d=d)
        print(f'REPORT {g._building_key}: moved {d.y * 1000:+.1f} mm back, {d.z * 1000:+.1f} mm up')
        use_face(g, target)
    return fn

def hair_post(g, mesh):
    """Eleanor's glossy hair bands (dress_kit.hair_bands), painted in the style's own frame."""
    st = g.hair_state.get(mesh.name)
    if not st or not st['bands']: return
    keep = getattr(g, 'mesh', None); g.mesh = mesh; g.hair_warp = st['warp']
    L.translate_verts(mesh, -st['d'])
    try:
        for hb in st['bands']: DK.hair_bands(g, hb)
    finally:
        L.translate_verts(mesh, st['d']); g.mesh = keep; g.hair_warp = None

def hair_bake(src):
    C = FACES[src]['mod'].CFG
    return dict(sheen=C['sheen'], up_dark=C.get('up_dark', {}), groove_dark=C.get('groove_dark'), ao_skip=C['ao_skip'])

# =====================================================================================================================
# EARRINGS (extras, attach 'ears'): at the target face's lobe
# =====================================================================================================================
EXTRAS = {'goldDrop': dict(src='clara', spec=CL.EAR, mat='Gold', colour=CL.COLOURS['gold']),
          'pearlStud': dict(src='eleanor', spec=EL.EAR, mat='Pearl', colour=EL.COLOURS['pearl']),
          'goldBall': dict(src='beatrice', spec=BE.EAR, mat='Gold', colour=BE.COLOURS['gold'])}
EXTRA_ORDER = ['goldDrop', 'pearlStud', 'goldBall']

def _ear_centre(g, name):
    """The face's ear centre (|x|, y offset from the head axis, world z) and half height (guest_kit.ears_round)."""
    C = FACES[name]['mod'].CFG
    with head_frame(g, FACES[name]['drop']):
        ze = g.zp(C['z_ear'])
    use_face(g, name)
    return float(g.W(ze)) + C['ear_out'], C['ear_y'], ze, C['ear_h'] * 0.5

def earring_spec(g, eid, target):
    E = EXTRAS[eid]; src = E['src']; S = E['spec']
    sx, sy, sz, sh = _ear_centre(g, src)
    tx, ty, tz, th = _ear_centre(g, target)
    with head_frame(g, FACES[src]['drop']):
        ez = g.zp(S['z'])
    z = tz + (ez - sz) * th / sh
    pct = (1.0 - (z + FACES[target]['drop']) / H) * 100.0         # in the target face's own frame
    return dict(S, x=round(tx + (S['x'] - sx), 4), dy=round(ty + (S['dy'] - sy), 4), z=round(pct, 3))

def earring_builder(eid):
    def fn(g):
        target = g.face_name; E = earring_spec(g, eid, target); use_face(g, target)
        with head_frame(g, FACES[target]['drop']):
            if eid == 'goldDrop': FX.ball_earrings(g, E)
            else: DK.earrings(g, E)
    return fn

# =====================================================================================================================
# THE ITEM LIST
# =====================================================================================================================
AO_SKIP = ('Brow', 'Eye', 'Lips', 'Gold', 'Pearl', 'Shine')

def items():
    """Every piece of body 'f' in build order: dicts with key, slot, id, fit, face (head state), build, ctx (own bake
    context keys), casts [(target key, base context keys)], bake (cfg overlay), colours, materials, smooth, post, lift,
    patch_mod ({target key: fn(co) -> factor}: extra shading folded into that shadow patch), ship."""
    out = []
    def add(**k):
        k.setdefault('fit', None); k.setdefault('face', DEFAULT_FACE); k.setdefault('bake', dict(ao_skip=AO_SKIP)); k.setdefault('materials', {})
        k.setdefault('smooth', 62.0); k.setdefault('post', []); k.setdefault('ship', True); k.setdefault('extras', {}); k.setdefault('casts', [])
        k.setdefault('lift', None); k.setdefault('patch_mod', {}); k.setdefault('patch_soft', {})
        out.append(k)
    add(key='body', slot='body', id='body', build=build_body, ctx=[], bake=_cfg('clara'), colours=dict(Skin=CL.COLOURS['skin']),
        lift={'Skin': CL.CFG['ao_scale']['Skin']}, post=[body_post])
    dresses = [f'dress_{d}' for d in DRESS_ORDER]
    for F in FACE_ORDER:
        FF = FACES[F]; cfg = _cfg(F)
        add(key=f'face_{F}', slot='face', id=F, face=F, build=build_face, ctx=['body'], casts=[('body', [])], bake=cfg,
            colours=FF['colours'], lift={'Skin': cfg['ao_scale']['Skin']}, post=[face_post],
            patch_mod=({'body': 'eleanor_chin'} if F == 'eleanor' else {}))
    for d in DRESS_ORDER:
        D = DRESSES[d]
        # (the gold belt shades every gown the same: Clara's and Beatrice's own bakes skipped gold as an occluder, for
        # their earrings, so their belts cast no shadow; Eleanor's did)
        bake = _cfg(D['look']); bake['ao_skip'] = tuple(m for m in bake['ao_skip'] if m != 'Gold')
        add(key=f'dress_{d}', slot='dress', id=d, build=dress_builder(d), ctx=['body', 'feet_pumps'],
            casts=[('body', []), ('feet_pumps', ['body'])], bake=bake, colours=dict(Dress=D['mod'].COLOURS['dress']),
            lift={'Dress': D['mod'].CFG['ao_scale']['Dress']})
    for b in ('sash', 'thin'):
        B = BELTS[b]
        for d in DRESS_ORDER:
            fit = None if d == BELT_HOME[b] else f'dress_{d}'
            add(key=f'belt_{b}' + (f'~dress_{d}' if fit else ''), slot='belt', id=b, fit=fit, build=belt_builder(b, d), needs=[f'dress_{d}'],
                ctx=['body', f'dress_{d}'], casts=[(f'dress_{d}', ['body', 'feet_pumps'])], bake=dict(B['bake']), colours={B['mat']: B['colour']})
    add(key='feet_pumps', slot='feet', id='pumps', build=build_pumps, ctx=['body'],
        bake=dict(ao_skip=AO_SKIP, sheen=dict(Shoe=CL.CFG['sheen']['Shoe'])), colours=dict(Shoe=CL.COLOURS['shoe'], Skin=CL.COLOURS['skin']),
        lift={'Skin': CL.CFG['ao_scale']['Skin']})
    for F in FACE_ORDER:
        suffix = '' if F == DEFAULT_FACE else f'~face_{F}'
        own_dress = f"dress_{LOOK_OF_FACE[F][1]}"
        for hid in HAIR_ORDER:
            src = HAIR_SRC[hid]
            add(key=f'hairStyle_{hid}{suffix}', slot='hairStyle', id=hid, fit=(f'face_{F}' if suffix else None), face=F, build=hair_builder(hid),
                ctx=['body', f'face_{F}', own_dress], casts=[(f'face_{F}', ['body']), ('body', [f'face_{F}'])] + [(dd, ['body', 'feet_pumps']) for dd in dresses],
                bake=hair_bake(src), colours=dict(Hair=FACES[src]['mod'].COLOURS['hair']), post=[hair_post],
                # the hair's shadow on the gowns (shoulders, the back of the bodice) is an extra the contract does not
                # ask for: 3 % lighter everywhere, so its faint tail drops out with no edge and the long styles stay
                # under the byte cap
                patch_soft={'dress_': 0.03})
    for F in FACE_ORDER:
        suffix = '' if F == DEFAULT_FACE else f'~face_{F}'
        own_hair = f"hairStyle_{LOOK_OF_FACE[F][0]}" + suffix
        for eid in EXTRA_ORDER:
            E = EXTRAS[eid]; C = FACES[E['src']]['mod'].CFG
            sheen = {E['mat']: C['sheen'][E['mat']]} if E['mat'] in C['sheen'] else {}
            add(key=f'extra_{eid}{suffix}', slot='extra', id=eid, fit=(f'face_{F}' if suffix else None), face=F, build=earring_builder(eid),
                ctx=[f'face_{F}', own_hair], bake=dict(ao_skip=AO_SKIP, sheen=sheen), colours={E['mat']: E['colour']},
                extras={'attach': 'ears'})
    return out

COLOURS = dict(skin=CL.COLOURS['skin'], hair=CL.COLOURS['hair'], brow=CL.COLOURS['brow'], eye=CL.COLOURS['eye'], lips=CL.COLOURS['lips'],
               dress=CL.COLOURS['dress'], sash=CL.COLOURS['sash'], gold=CL.COLOURS['gold'], pearl=EL.COLOURS['pearl'], shoe=CL.COLOURS['shoe'],
               shine=EL.COLOURS['shine'])
BASE_CFG = _cfg(DEFAULT_FACE)
