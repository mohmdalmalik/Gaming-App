// Camera rig: an elevated view that follows the active guest, corner-on by default (yawOffsetDeg: 45,
// like the owner's room pictures). It snaps its rotation in 90° steps and zooms within limits.
//
// The player can look over the whole revealed hotel: zooming out goes as far as it takes to show every
// revealed room at once (the limit grows with the hotel, worked out for the screen's shape and — so a
// turn of the view never jolts the zoom — for the widest of the four turns), and on the way out the
// view glides to the middle of the hotel. A drag pans over the revealed rooms: the middle of the screen
// always stays over a revealed room (or close to one; the margin grows as you zoom out), so the hotel
// can never be dragged off the screen. The view never drifts back on its own: it returns to the active
// guest only when told to (recentre: a new turn, a move, a meeting, or the "centre on me" button), and
// after a door opens it eases to show the guest's room and the new one together (showRooms).
import * as THREE from 'three';

const QUARTER = Math.PI / 2;

function smoothstep(t) { t = Math.min(1, Math.max(0, t)); return t * t * (3 - 2 * t); }

// The outline (convex hull) of the rooms' corners, on the ground: only these can be the first to leave
// the screen as the view comes in, so only these need fitting.
function hull(rects) {
  const pts = [...new Map(rects.flatMap(q => [[q[0], q[1]], [q[2], q[1]], [q[0], q[3]], [q[2], q[3]]]).map(p => [`${p[0]},${p[1]}`, p])).values()]
    .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (pts.length < 3) return pts;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower.at(-2), lower.at(-1), p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper.at(-2), upper.at(-1), p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

export function createCameraRig(camera, cfg) {
  const c = cfg.camera;
  const pitch = THREE.MathUtils.degToRad(c.pitchDeg);
  const base = THREE.MathUtils.degToRad(c.yawOffsetDeg || 0);   // a fixed turn of the whole view (0 = square on)
  const target = new THREE.Vector3();   // where the player is
  const focus = new THREE.Vector3();    // eased focus point (before pan)
  const pan = new THREE.Vector3();      // world-space offset of the view from the guest (drag, zoom-out)
  const offset = new THREE.Vector3();
  const aim = new THREE.Vector3();      // the ground point the camera looks at
  let yawIndex = 0;
  let yaw = 0, yawFrom = 0, yawTo = 0, yawT = 1;
  let distance = c.distance;
  let followed = false;
  // An eased move of the view: to `aim` ([x, z] for focus + pan; null = back onto the guest) and, if
  // `dist` is set, to that zoom. null when the view is the player's.
  let glide = null;
  let rooms = [];            // the revealed rooms' footprints: [minX, minZ, maxX, maxZ] each
  let roomsVersion = 0;
  // The zoom-out limit (the widest of the four turns) and, for each turn, the overview's centre.
  const fit = { version: -1, aspect: NaN, d: c.maxDistance, centres: [[0, 0], [0, 0], [0, 0], [0, 0]] };

  // Aim a little past the focus toward the camera (lookAhead, scaled with the zoom), so the guest's
  // room — or, zoomed right out, the whole hotel — sits above the middle of the screen, clear of the hand.
  const ahead = d => (c.lookAhead || 0) * d / c.distance;
  const margin = () => c.fitMargin || { x: 0.92, top: 0.62, bottom: 0.5 };

  // The view of a set of rooms from turn `y`: the least distance at which they all fit inside the part
  // of the screen the interface leaves free (cfg.camera.fitMargin, in screen units: the guest strip at
  // the top, the panel and the hand at the bottom) — their outline, on the floor and at the top of the
  // walls — and the point to centre on (focus + pan) at distance `atD` (default: that least distance).
  // Seen in perspective the near end looks bigger than the far end, so the view is not simply aimed at
  // their middle: the aim slides toward or away from the camera, and sideways, until the rooms sit
  // evenly in that free space.
  function fitView(rects, y, atD = null, m = margin()) {
    const sy = Math.sin(y), cy = Math.cos(y), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const o = [sy * cp, sp, cy * cp];          // from the aim point to the camera (unit)
    const f = [-o[0], -o[1], -o[2]];           // looking direction
    const r = [cy, 0, -sy];                    // screen right
    const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];   // screen up
    const tanV = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2), tanH = tanV * camera.aspect;
    const mx = (Math.min(...rects.map(q => q[0])) + Math.max(...rects.map(q => q[2]))) / 2;
    const mz = (Math.min(...rects.map(q => q[1])) + Math.max(...rects.map(q => q[3]))) / 2;
    const pts = [];
    for (const [x, z] of hull(rects)) for (const h of [0, cfg.walls.height]) pts.push([x, h, z]);
    // Where the corners land on screen, aimed at the middle slid `s` m toward the camera, `t` m right.
    const extent = (d, s, t) => {
      const px = mx + sy * s + r[0] * t + o[0] * d, py = o[1] * d, pz = mz + cy * s + r[2] * t + o[2] * d;
      let xlo = Infinity, xhi = -Infinity, lo = Infinity, hi = -Infinity;
      for (const [X, H, Z] of pts) {
        const vx = X - px, vy = H - py, vz = Z - pz;
        const depth = vx * f[0] + vy * f[1] + vz * f[2];
        if (depth < 0.5) return null;
        const sx = (vx * r[0] + vy * r[1] + vz * r[2]) / (depth * tanH);
        const su = (vx * u[0] + vy * u[1] + vz * u[2]) / (depth * tanV);
        xlo = Math.min(xlo, sx); xhi = Math.max(xhi, sx); lo = Math.min(lo, su); hi = Math.max(hi, su);
      }
      return { xlo, xhi, lo, hi };
    };
    // (sliding toward the camera raises the rooms on screen; sliding right moves them left)
    const bisect = (a, b, tooFar) => { for (let k = 0; k < 18; k++) { const v = (a + b) / 2; if (tooFar(v)) b = v; else a = v; } return (a + b) / 2; };
    const balance = d => {
      let s = 0, t = 0;
      for (let pass = 0; pass < 2; pass++) {
        t = bisect(-d, d, v => { const e = extent(d, s, v); return !e || e.xlo + e.xhi < 0; });
        s = bisect(-d, d, v => { const e = extent(d, v, t); return !e || (e.hi + e.lo) - (m.top - m.bottom) > 0; });
      }
      return [s, t];
    };
    const fits = d => {
      const [s, t] = balance(d), e = extent(d, s, t);
      return !!e && e.xlo >= -m.x && e.xhi <= m.x && e.hi <= m.top && e.lo >= -m.bottom;
    };
    let lo = c.minDistance, hi = 600;
    if (fits(lo)) hi = lo;
    else for (let k = 0; k < 18; k++) { const mid = (lo + hi) / 2; if (fits(mid)) hi = mid; else lo = mid; }
    const d = atD ?? hi;
    const [s0, t] = balance(d), s = s0 - ahead(d);   // (the rig adds the look-ahead itself)
    return { d: hi, cx: mx + sy * s + r[0] * t, cz: mz + cy * s + r[2] * t };
  }

  // How far out the camera may go: the whole revealed hotel in view, at the widest of the four turns
  // (so turning the view never changes the limit), and never less than cfg.camera.maxDistance. Also
  // keeps each turn's overview centre. Cached until the rooms or the screen's shape change.
  function fitDistance() {
    if (!rooms.length) return c.maxDistance;
    if (fit.version === roomsVersion && fit.aspect === camera.aspect) return fit.d;
    fit.version = roomsVersion; fit.aspect = camera.aspect;
    const ys = [0, 1, 2, 3].map(k => base + k * QUARTER);
    const d = Math.max(c.maxDistance, ...ys.map(y => fitView(rooms, y).d));
    fit.d = d;
    fit.centres = ys.map(y => { const v = fitView(rooms, y, d); return [v.cx, v.cz]; });
    return d;
  }
  const overview = () => { fitDistance(); return fit.centres[((yawIndex % 4) + 4) % 4]; };

  // The middle of the screen (the aim, look-ahead included) must stay over a revealed room — within a
  // margin of one that grows as the view zooms out (1.5 m at the standard zoom; a few metres more when
  // the whole hotel is in view anyway) — so the hotel is never dragged off the screen. Zoomed well out,
  // the overview's own centre is allowed too (it can lie between the arms of an L-shaped hotel).
  function clampPan() {
    if (!rooms.length) return;
    const y = yaw + base, a = ahead(distance);
    const hx = Math.sin(y) * a, hz = Math.cos(y) * a;
    const ax = focus.x + pan.x + hx, az = focus.z + pan.z + hz;
    const R = (c.panMargin ?? 1.5) + 0.15 * Math.max(0, distance - c.distance);
    const max = fitDistance();
    if (distance >= 0.6 * max) {
      const [ox, oz] = overview();
      if (Math.hypot(focus.x + pan.x - ox, focus.z + pan.z - oz) <= R) return;
    }
    let bx = ax, bz = az, bd = Infinity;
    for (const q of rooms) {
      const x = THREE.MathUtils.clamp(ax, q[0] - R, q[2] + R), z = THREE.MathUtils.clamp(az, q[1] - R, q[3] + R);
      const d = Math.hypot(x - ax, z - az);
      if (d < bd) { bd = d; bx = x; bz = z; if (!d) break; }
    }
    if (bd > 0) { pan.x = bx - hx - focus.x; pan.z = bz - hz - focus.z; }
  }

  const rig = {
    camera,
    get yaw() { return yaw + base; },
    get yawIndex() { return yawIndex; },
    get distance() { return distance; },
    get maxDistance() { return fitDistance(); },
    get pan() { return pan; },
    get returning() { return !!glide; },
    // (the ground point the view is centred on, before the look-ahead: for the tests)
    get centre() { return [focus.x + pan.x, focus.z + pan.z]; },
    // (the ground point in the middle of the screen, look-ahead included: for the tests)
    get aim() { return [aim.x, aim.z]; },
    get debug() { return { returning: !!glide, yawT, distance, maxDistance: fitDistance(), pan: [pan.x, pan.z], aim: [aim.x, aim.z], overview: overview() }; },

    setFocus(x, z, immediate = false) {
      target.set(x, 0, z);
      if (immediate || !followed) { focus.copy(target); followed = true; }
    },
    // The revealed rooms' footprints, [minX, minZ, maxX, maxZ] each (call whenever the hotel grows,
    // or a new match starts).
    setRooms(list) {
      const key = list.map(q => q.join()).join(';');
      if (key === rooms.key) return;
      rooms = list.map(q => [...q]);
      rooms.key = key;
      roomsVersion++;
    },

    rotate(steps) {
      const atLimit = rooms.length && distance >= fitDistance() - 0.05;
      yawIndex = ((yawIndex + steps) % 4 + 4) % 4;
      yawFrom = yaw;
      yawTo = yaw + steps * QUARTER;
      yawT = 0;
      // zoomed right out, the view stays the whole hotel: it eases to that turn's overview centre
      if (atLimit) glide = { aim: overview(), dist: null };
    },
    rotateLeft() { rig.rotate(1); },
    rotateRight() { rig.rotate(-1); },

    // Pinch / mouse wheel. Zooming OUT also glides the view toward the middle of the hotel (the
    // overview's centre), so that at the limit the whole revealed hotel is in view; zooming in keeps
    // the view where it is.
    zoomBy(factor) {
      const max = fitDistance();
      const before = distance;
      distance = THREE.MathUtils.clamp(distance / factor, c.minDistance, max);
      glide = null;
      if (rooms.length && distance > before + 1e-6 && max > before + 1e-6) {
        const k = (distance - before) / (max - before), [ox, oz] = overview();
        pan.x += (ox - (focus.x + pan.x)) * k;
        pan.z += (oz - (focus.z + pan.z)) * k;
      }
      clampPan();
    },

    // Shift the view by a world-space delta (the ground point under the finger stays put).
    panByWorld(dx, dz) {
      pan.x += dx; pan.z += dz;
      glide = null;
      clampPan();
    },
    // Fingers lifted. (The view stays where it was left: it no longer drifts back by itself.)
    release() {},

    // Back to the active guest: the pan eases out (and, with `zoom`, the standard zoom comes back).
    recentre({ zoom = true, immediate = false } = {}) {
      glide = { aim: null, dist: zoom ? c.distance : null };
      if (immediate) {
        pan.set(0, 0, 0);
        if (zoom) distance = c.distance;
        focus.copy(target);
        glide = null;
      }
    },
    // Ease the view so these rooms ([minX, minZ, maxX, maxZ] each — the guest's room and a room just
    // opened) are both in view, zooming out only as far as they need. (Looser than the overview: they
    // may reach a little under the edges of the interface.)
    showRooms(list) {
      const m = c.showMargin || { x: 0.96, top: 0.84, bottom: 0.66 };
      const v = fitView(list, yawTo + base, null, m);
      const dist = v.d > distance ? Math.min(v.d, fitDistance()) : null;
      const at = fitView(list, yawTo + base, dist ?? distance, m);
      glide = { aim: [at.cx, at.cz], dist };
    },

    reset() {
      pan.set(0, 0, 0);
      distance = c.distance;
      yawIndex = 0; yaw = 0; yawFrom = 0; yawTo = 0; yawT = 1;
      focus.copy(target);
      glide = null;
    },

    update(dt) {
      if (yawT < 1) {
        yawT = Math.min(1, yawT + dt / c.rotateDuration);
        yaw = yawFrom + (yawTo - yawFrom) * smoothstep(yawT);
      }
      focus.lerp(target, 1 - Math.exp(-c.followLerp * dt));
      if (glide) {
        const k = 1 - Math.exp(-(c.returnLerp ?? 3.5) * dt);
        const gx = glide.aim ? glide.aim[0] - focus.x : 0, gz = glide.aim ? glide.aim[1] - focus.z : 0;
        pan.x += (gx - pan.x) * k; pan.z += (gz - pan.z) * k;
        if (glide.dist != null) distance += (glide.dist - distance) * k;
        if (Math.hypot(gx - pan.x, gz - pan.z) < 0.02 && (glide.dist == null || Math.abs(distance - glide.dist) < 0.02)) {
          pan.x = gx; pan.z = gz;
          if (glide.dist != null) distance = glide.dist;
          glide = null;
        }
      }
      distance = Math.min(distance, fitDistance());   // (the hotel can shrink: a new match)
      if (!glide) clampPan();

      const y = yaw + base;
      const a = ahead(distance);
      aim.set(focus.x + pan.x + Math.sin(y) * a, 0, focus.z + pan.z + Math.cos(y) * a);
      offset.set(Math.sin(y) * Math.cos(pitch), Math.sin(pitch), Math.cos(y) * Math.cos(pitch)).multiplyScalar(distance);
      camera.position.copy(aim).add(offset);
      camera.lookAt(aim);
      // Zoomed far out, the far side of a big hotel must not be clipped away.
      const far = Math.max(c.far, distance * 2 + 60);
      if (Math.abs(camera.far - far) > 1) { camera.far = far; camera.updateProjectionMatrix(); }
      camera.updateMatrixWorld();
    },
  };
  return rig;
}
