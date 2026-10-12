// Glasses fitted to ANY of the guest models at run time, from the model's own measurements (the eye
// ovals, the brows, the face's front surface, the head's width, the ears; src/render/avatar.js measures
// them once per look), as ONE merged tube geometry in the model's bind-pose space. The caller fixes it to
// the head bone (src/render/avatar.js attachGlasses): one extra draw call, no skinning, and it follows the
// head through the walk. Built once per (look, style) and kept (a few kB each).
//
// Styles (src/data/wardrobe.js 'glasses' items): round, oval, deco (a rounded square), pincenez (no
// temples) and monocle (one rim and a cord to the ear; a locked "Coming soon" item). A half-moon shape
// was tried and dropped: its flat top crosses the guests' big noses.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const cache = new Map();
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// A rim's outline in its own 2D frame (u outward from the nose, v up), radius 1, N points, closed.
function outline(kind, N = 40) {
  const pts = [];
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    let u = Math.cos(a), v = Math.sin(a);
    if (kind === 'deco') {                     // a rounded square (superellipse), a touch wider than tall
      const n = 4.2, c = Math.cos(a), s = Math.sin(a);
      u = Math.sign(c) * Math.abs(c) ** (2 / n); v = Math.sign(s) * Math.abs(s) ** (2 / n) * 0.8;
    } else if (kind === 'oval') v *= 0.7;
    else if (kind === 'pincenez') { u *= 0.85; v *= 0.68; }
    pts.push([u, v]);
  }
  return pts;
}

// `base` is a loaded look (src/render/avatar.js loadBase): its eyes, head and parts.
export function buildGlasses(base, style) {
  const key = `${base.id}:${style}`;
  if (cache.has(key)) return cache.get(key);
  const E = base.eyes, H = base.head;
  if (!E || !H) return null;
  const eyeL = E.left.centre, eyeR = E.right.centre;
  const ex = (Math.abs(eyeL.x) + Math.abs(eyeR.x)) / 2, ey = (eyeL.y + eyeR.y) / 2;
  // the brows: the lowest brow point over the eyes (the rim's top stays under it)
  let browMin = Infinity;
  const brow = base.info.Brow;
  if (brow) {
    const bp = brow.mesh.geometry.attributes.position, p = V();
    for (let v = 0; v < bp.count; v++) {
      p.fromBufferAttribute(bp, v);
      if (Math.abs(Math.abs(p.x) - ex) < ex * 0.6) browMin = Math.min(browMin, p.y);
    }
  }
  const female = base.def.body === 'f';
  const tube = female ? 0.0036 : 0.0042;
  const clear = 0.007;
  const R = ex * (style === 'pincenez' ? 0.82 : style === 'oval' ? 0.95 : 1.02);
  const bridgeHalf = ex * (style === 'pincenez' ? 0.3 : 0.32);
  const cx = bridgeHalf + R * (style === 'pincenez' ? 0.9 : 1.0);
  let cy = ey;
  // keep the top of the rim under the brows: move the rim down a little, then squash it
  const shape = outline(style === 'round' || style === 'monocle' ? 'round' : style);
  const topV = Math.max(...shape.map(p => p[1]));
  let sy = 1;
  const room = browMin - 0.006 - cy;
  if (topV * R > room) {
    const drop = Math.min(topV * R - room, R * 0.18);
    cy -= drop;
    if (topV * R > room + drop) sy = (room + drop) / (topV * R);
  }
  const parts = [];
  const faceZ = (x, y) => { const z = H.frontZ(x, y, 0.014); return Number.isFinite(z) ? z : null; };
  const rims = {};
  for (const side of (style === 'monocle' ? [-1] : [-1, 1])) {
    const eye = side < 0 ? eyeL : eyeR;
    const pts = shape.map(([u, v]) => {
      const x = side * (cx + u * R), y = cy + v * R * sy;
      // a plane a few mm in front of the eye, receding outward like the face, and never inside the face
      const planeZ = eye.z + 0.012 - Math.max(0, Math.abs(x) - ex) * 0.55;
      const f = faceZ(x, y);
      return V(x, y, Math.max(planeZ, f != null ? f + clear : planeZ));
    });
    // smooth the depth along the ring (no kinks where the nose pushes it forward)
    for (let pass = 0; pass < 3; pass++) {
      const zs = pts.map(p => p.z);
      pts.forEach((p, i) => { const a = zs[(i + pts.length - 1) % pts.length], b = zs[(i + 1) % pts.length]; p.z = Math.max(zs[i], (a + 2 * zs[i] + b) / 4); });
    }
    rims[side] = pts;
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true, 'centripetal'), 64, tube, 6, true));
  }
  // the rim point nearest an angle (radians, 0 = outward, PI = toward the nose)
  const ringPoint = (side, ang) => {
    const pts = rims[side], N = pts.length;
    return pts[Math.round((((ang / (Math.PI * 2)) % 1) + 1) % 1 * N) % N].clone();
  };
  if (style !== 'monocle') {
    // the bridge: from one rim's inner side to the other's, over the nose
    const aIn = ringPoint(-1, Math.PI - 0.35), bIn = ringPoint(1, Math.PI - 0.35);
    const by = (aIn.y + bIn.y) / 2 + R * (style === 'pincenez' ? 0.18 : 0.08);
    const bz = Math.max(aIn.z, (faceZ(0, by) ?? aIn.z) + clear);
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([aIn, V(aIn.x * 0.5, by, (aIn.z + bz) / 2 + 0.002), V(0, by, bz),
      V(bIn.x * 0.5, by, (bIn.z + bz) / 2 + 0.002), bIn]), 24, tube * 0.9, 6, false));
  }
  if (style !== 'pincenez' && style !== 'monocle') {
    // the temples: from the hinge (outer side, a little above the middle) back along the head to the ear
    for (const side of [-1, 1]) {
      const hinge = ringPoint(side, 0.22);
      const path = [hinge];
      let x = Math.abs(hinge.x);
      const zEnd = earZ(base, side, ey) - 0.025;
      const steps = 8;
      for (let k = 1; k <= steps; k++) {
        const z = hinge.z - 0.01 + (zEnd - hinge.z + 0.01) * (k / steps);
        x = Math.max(x * 0.98, H.halfWidth(hinge.y, z, side, 0.016, 0.016) + clear * 0.8);
        path.push(V(side * x, hinge.y - 0.004 * k, z));
      }
      const last = path[path.length - 1];
      path.push(V(last.x * 0.97, last.y - 0.03, last.z - 0.012));   // the hook behind the ear
      parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path, false, 'centripetal'), 32, tube * 0.85, 5, false));
    }
  }
  if (style === 'monocle') {
    // a fine cord from the rim's outer edge down along the cheek, then back to behind the ear
    const S = -1, p0 = ringPoint(S, -0.6), ez = earZ(base, S, ey);
    const cord = [p0, V(p0.x + S * 0.012, p0.y - 0.05, p0.z - 0.03), V(S * (Math.abs(p0.x) + 0.03), p0.y - 0.09, (p0.z + ez) / 2),
      V(S * (H.halfWidth(ey - 0.06, ez + 0.02, S, 0.02, 0.03) + 0.008), ey - 0.06, ez + 0.01)];
    parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(cord, false, 'centripetal'), 24, tube * 0.45, 4, false));
  }
  const geo = mergeGeometries(parts.map(g => { g.deleteAttribute('uv'); return g; }), false);
  for (const g of parts) g.dispose();
  geo.computeBoundingSphere();
  cache.set(key, geo);
  return geo;
}

// The ear's depth (z) on one side: the head's widest point a little below the eyes.
function earZ(base, side, ey) {
  let best = null;
  for (const p of base.head.skin) {
    if (p.y < ey - 0.12 || p.y > ey + 0.02 || p.x * side <= 0) continue;
    if (!best || p.x * side > best.x * side) best = p;
  }
  return best ? best.z : -0.05;
}

// The glasses' geometry for the head bone's space: a Mesh that follows the head (`material` given).
// (The geometry is in the bind-pose mesh space: headInverse x bindMatrix carries it into the bone's.)
export function glassesMesh(base, style, material) {
  const geo = buildGlasses(base, style);
  if (!geo) return null;
  const m = new THREE.Mesh(geo, material);
  m.name = 'glasses';
  m.frustumCulled = false;
  m.matrixAutoUpdate = false;
  m.matrix.copy(base.headInverse).multiply(base.bindMatrix);
  return m;
}
