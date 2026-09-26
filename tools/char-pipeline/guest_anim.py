# Idle + Walk actions for every guest rig (Blender). Shared by make_victor.py and make_guest.py.
#
# Walk: legs from gait.py (heel strike -> foot flat -> heel rise over the ball -> toe-off -> swing),
# posed by two-bone IK so the planted foot keeps still against the contact stride; the pelvis turns a
# little with the forward leg, the chest counter-turns, the head stays level and facing ahead, and the
# arms swing loosely from the shoulder (opposite the legs, trailing them slightly, elbows softening as
# the arm comes forward). The GLB stores two numbers:
#   contactStride  - metres per cycle at which the planted foot is exactly still (the leg geometry)
#   strideLength   - metres per cycle the GAME uses (distance / strideLength drives the phase). It is
#                    longer than the contact stride on purpose: these guests have short legs, and at the
#                    game's walking speed a fully planted walk needs ~5-6 steps a second, which reads as
#                    frantic. WALK_STRIDE_SCALE trades a little foot glide for a calm ~3.5 steps a second.
import math
import gait as G

WALK_STRIDE_SCALE = 1.5
WALK_N = 32

def _key(arm, bname, frame, rx=0.0, ry=0.0, rz=0.0, loc=None):
    pb = arm.pose.bones[bname]; pb.rotation_mode = 'XYZ'; pb.rotation_euler = (rx, ry, rz); pb.keyframe_insert('rotation_euler', frame=frame)
    if loc is not None: pb.location = loc; pb.keyframe_insert('location', frame=frame)

def _new_action(arm, bpy, name):
    arm.animation_data_create(); act = bpy.data.actions.new(name); act.use_fake_user = True; arm.animation_data.action = act; return act

def build_walk(bpy, arm, dims, arm_amp=0.20, arm_bias=0.03, arm_out=0.06, skirt=False):
    """dims: hip, knee, ankle (joint heights), heel, ball (floor distances behind/ahead of the ankle).
    Returns (contact_stride, game_stride)."""
    l1, l2 = dims['hip'] - dims['knee'], dims['knee'] - dims['ankle']
    kw = dict(drop=0.004, bob=0.032, lift=0.012, heel_up=0.42, toe_up=0.22, center=-0.04)
    if skirt: kw.update(bob=0.024, heel_up=0.36, toe_up=0.16)            # a gown: shorter, smoother steps
    D = G.max_stride(l1, l2, dims['ankle'], dims['heel'], dims['ball'], dims['hip'], 0.6, limit=0.996, **kw)
    if skirt: D *= 0.9
    g = G.Gait(l1, l2, dims['ankle'], dims['heel'], dims['ball'], dims['hip'], D, 0.6, **kw)
    _new_action(arm, bpy, 'Walk')
    lag = 0.05
    for f in range(WALK_N + 1):
        t = f / WALK_N
        for tag, phi in (('L', t), ('R', (t + 0.5) % 1.0)):
            thigh, knee, pitch, _, _ = g.leg(phi)
            _key(arm, f'thigh.{tag}', f, rx=-thigh)
            _key(arm, f'shin.{tag}', f, rx=knee)
            _key(arm, f'foot.{tag}', f, rx=thigh - knee - pitch)
            # arm: back when this side's leg is forward, trailing the legs a little
            c = math.cos(2 * math.pi * (phi - lag))
            ua = arm_bias - arm_amp * c
            fore = 0.16 + 0.16 * (0.5 - 0.5 * math.cos(2 * math.pi * (phi - lag - 0.06) + math.pi))
            s = 1 if tag == 'L' else -1
            _key(arm, f'upperarm.{tag}', f, rx=-ua, rz=-arm_out * s)
            _key(arm, f'forearm.{tag}', f, rx=-fore)
            _key(arm, f'hand.{tag}', f, rx=-0.06)
            _key(arm, f'shoulder.{tag}', f, ry=0.0)
        c2 = math.cos(2 * math.pi * t)
        bob = g.hip_y(t) - dims['hip']; sway = 0.010 * math.sin(2 * math.pi * t)
        _key(arm, 'hips', f, ry=-0.07 * c2, rz=0.025 * math.sin(2 * math.pi * t), loc=(sway, bob, 0.0))
        _key(arm, 'spine', f, rx=0.045, ry=0.11 * c2, rz=-0.02 * math.sin(2 * math.pi * t))
        _key(arm, 'neck', f, rx=-0.03, ry=-0.025 * c2)
        _key(arm, 'head', f, rx=-0.012 * math.cos(4 * math.pi * t), ry=-0.015 * c2)
    return D, D * WALK_STRIDE_SCALE

def build_idle(bpy, arm, arm_out=0.06):
    _new_action(arm, bpy, 'Idle'); N = 72
    for f in range(N + 1):
        t = f / N; br = math.sin(2 * math.pi * t); sw = math.sin(2 * math.pi * t * 0.5 + 0.8)
        _key(arm, 'hips', f, rz=0.010 * sw, loc=(0.005 * sw, 0.004 * br, 0.0))
        _key(arm, 'spine', f, rx=0.035 + 0.016 * br, rz=-0.007 * sw); _key(arm, 'neck', f, rx=-0.015)
        _key(arm, 'head', f, rx=0.010 * math.sin(2 * math.pi * t + 0.9), rz=0.012 * math.sin(2 * math.pi * t * 0.5))
        for tag, s in (('L', 1), ('R', -1)):
            _key(arm, f'thigh.{tag}', f); _key(arm, f'shin.{tag}', f); _key(arm, f'foot.{tag}', f)
            _key(arm, f'upperarm.{tag}', f, rx=-(0.03 * br + 0.02), rz=-s * arm_out)
            _key(arm, f'forearm.{tag}', f, rx=-(0.14 + 0.03 * br)); _key(arm, f'hand.{tag}', f, rx=-0.04); _key(arm, f'shoulder.{tag}', f)
    return N
