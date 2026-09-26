# Walk cycle by foot placement + two-bone IK (pure Python, used by the Blender guest builders).
#
# The walk is authored the way a real step works: the heel strikes with the toe up, the foot rolls
# flat, the ground contact then moves backward at exactly the walking speed while the body passes over
# it, the heel lifts and the foot rolls over the ball, the toe pushes off, and the foot swings forward
# (knee bent, toe clear of the floor) to the next heel strike. Hip and knee angles come from two-bone IK
# on the ankle path, so the planted foot never slides against the stride stored in the GLB.
#
# Sagittal coordinates: x = forward from the hip joint, y = up from the floor. Angles: thigh forward
# positive, knee flexion positive, foot pitch toe-up positive.
import math

def smooth(t): t = max(0.0, min(1.0, t)); return t * t * (3 - 2 * t)
def herm(p0, p1, m0, m1, s):
    s2, s3 = s * s, s * s * s
    return (2*s3 - 3*s2 + 1) * p0 + (s3 - 2*s2 + s) * m0 + (-2*s3 + 3*s2) * p1 + (s3 - s2) * m1
def rot(v, a):
    c, s = math.cos(a), math.sin(a); return (v[0] * c - v[1] * s, v[0] * s + v[1] * c)

class Gait:
    """l1 thigh, l2 shin, ah ankle height, heel/ball: distances behind/ahead of the ankle on the floor,
    hip: standing hip-joint height. D stride (metres per cycle), duty: share of the cycle a foot is down."""
    def __init__(self, l1, l2, ah, heel, ball, hip, D, duty=0.60, bob=0.014, drop=0.012, lift=0.055,
                 toe_up=0.30, heel_up=0.62, center=0.0):
        self.__dict__.update(l1=l1, l2=l2, ah=ah, heel=heel, ball=ball, hip=hip, D=D, duty=duty, bob=bob,
                             drop=drop, lift=lift, toe_up=toe_up, heel_up=heel_up)
        self.pa, self.pb = 0.10, 0.36               # heel roll ends / heel starts to rise (share of the cycle)
        # the flat-foot ankle position runs backward at D per cycle; A0 centres the stance under the hip
        self.A0 = D * duty / 2 + center
    def hip_y(self, p):                              # lowest at each heel strike (p = 0, 0.5)
        return self.hip - self.drop - self.bob * (0.5 + 0.5 * math.cos(4 * math.pi * p))
    def pitch_stance(self, p):
        if p < self.pa: return self.toe_up * (1 - smooth(p / self.pa))
        if p < self.pb: return 0.0
        s = (p - self.pb) / (self.duty - self.pb); return -self.heel_up * s ** 1.6
    def stance(self, p):
        A = self.A0 - self.D * p; th = self.pitch_stance(p)
        if th >= 0:   piv, rel = (A - self.heel, 0.0), (self.heel, self.ah)
        else:         piv, rel = (A + self.ball, 0.0), (-self.ball, self.ah)
        r = rot(rel, th); return (piv[0] + r[0], piv[1] + r[1]), th
    def foot(self, p):
        """Ankle (x, y) and foot pitch at cycle phase p (0 = this foot's heel strike)."""
        p %= 1.0
        if p <= self.duty: return self.stance(p)
        e = 1e-4
        (a0, t0) = self.stance(self.duty); (a0m, t0m) = self.stance(self.duty - e)
        (a1, t1) = self.stance(0.0);       (a1p, t1p) = self.stance(e)
        T = 1.0 - self.duty; s = (p - self.duty) / T
        vx0, vy0 = (a0[0] - a0m[0]) / e * T, (a0[1] - a0m[1]) / e * T
        vx1, vy1 = (a1p[0] - a1[0]) / e * T, (a1p[1] - a1[1]) / e * T
        x = herm(a0[0], a1[0], vx0, vx1, s)
        y = herm(a0[1], a1[1], vy0, vy1, s) + self.lift * math.sin(math.pi * s ** 0.85) ** 1.3
        th = herm(t0, t1, (t0 - t0m) / e * T, (t1p - t1) / e * T, s) + 0.10 * math.sin(math.pi * s)
        return (x, y), th
    def leg(self, p):
        """(thigh, knee, foot-relative) angles for the IK leg at phase p, plus how stretched it is (0..1)."""
        (ax, ay), th = self.foot(p)
        hy = self.hip_y(p); vx, vy = ax, ay - hy; d = math.hypot(vx, vy)
        L = self.l1 + self.l2; stretch = d / L; d = min(d, L * 0.9995)
        alpha = math.atan2(vx, -vy)                                     # hip->ankle, forward of straight down
        phi = math.acos(max(-1, min(1, (self.l1 ** 2 + d * d - self.l2 ** 2) / (2 * self.l1 * d))))
        thigh = alpha + phi                                             # knee bends forward
        knee = math.pi - math.acos(max(-1, min(1, (self.l1 ** 2 + self.l2 ** 2 - d * d) / (2 * self.l1 * self.l2))))
        shin_world = thigh - knee                                       # shin forward of straight down
        return thigh, knee, th, shin_world, stretch

def max_stride(l1, l2, ah, heel, ball, hip, duty=0.60, limit=0.985, **kw):
    lo, hi = 0.2, 3.0
    for _ in range(40):
        D = (lo + hi) / 2; g = Gait(l1, l2, ah, heel, ball, hip, D, duty, **kw)
        worst = max(g.leg(i / 200)[4] for i in range(200))
        if worst <= limit: lo = D
        else: hi = D
    return lo

if __name__ == '__main__':
    H = 1.66; zp = lambda pct: H * (1 - pct / 100)
    hip, knee, ank = zp(74.0), zp(86.5), zp(96.0)
    l1, l2 = hip - knee, knee - ank
    for duty in (0.58, 0.60, 0.62):
        for drop in (0.0, 0.012, 0.02, 0.03):
            D = max_stride(l1, l2, ank, 0.062, 0.165, hip, duty, drop=drop)
            print(f'duty {duty} drop {drop}: max stride {D:.3f} m  -> {2.0 / D:.2f} cycles/s = {4.0 / D:.2f} steps/s at 2 m/s')
