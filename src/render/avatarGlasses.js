// Glasses fitted to ANY guest at run time, from the guest's own measurements (the eye ovals, the brows, the face's
// front surface, the head's width, the ears: src/render/avatarParts.js measures them from the face and body pieces
// worn), as ONE merged tube geometry in the guest's bind-pose space. avatarParts.js merges it into the guest's one
// skinned mesh, every vertex on the head bone (glassesPiece): no extra draw call, and it follows the head through the
// walk. Built once per (body, face, style) and kept (a few kB each): the hairstyle or the clothes never change the fit.
//
// Styles (src/data/wardrobe.js 'glasses' items): round, oval, deco (a rounded square), pincenez (no
// temples), monocle and gilt (Gold frames). A half-moon shape was tried and dropped: its flat top crosses the guests'
// big noses. Frames only, never a lens: the eyes always show.
// The two W1-B styles are drawn finer than the wire frames, in metalwork that reads as gilt (their frame colour is a
// fixed gold, src/data/wardrobe.js frameHex):
//   monocle  one rim on the guest's right eye: a flat gilt band (wider than deep) with a fine beaded edge round it, a
//            small eyelet at its outer foot, and a fine beaded chain from the eyelet down the cheek and back up to
//            behind the ear (the chain rides the head, as the frames do: it never trails off the body)
//   gilt     round spectacles: the same flat gilt band for both rims, an arched keyhole bridge over the nose, small
//            end pieces at the hinges and riding-bow temples that curl down behind the ears
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const cache = new Map();
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// A tube whose round section is squashed along `axis` (a flat band: `half` wide, `half * flat` deep), for the gilt
// rims. Built as a TubeGeometry, then each ring is flattened about its centre on the curve (normals follow).
function bandTube(curve, segments, half, flat, radial, closed, axis = V(0, 0, 1)) {
  const g = new THREE.TubeGeometry(curve, segments, half, radial, closed);
  const pos = g.attributes.position, nor = g.attributes.normal, c = new THREE.Vector3(), d = new THREE.Vector3(), n = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    curve.getPointAt(closed && i === segments ? 0 : i / segments, c);
    for (let j = 0; j <= radial; j++) {
      const v = i * (radial + 1) + j;
      d.fromBufferAttribute(pos, v).sub(c);
      d.addScaledVector(axis, d.dot(axis) * (flat - 1));
      pos.setXYZ(v, c.x + d.x, c.y + d.y, c.z + d.z);
      n.fromBufferAttribute(nor, v);
      n.addScaledVector(axis, n.dot(axis) * (1 / flat - 1)).normalize();
      nor.setXYZ(v, n.x, n.y, n.z);
    }
  }
  return g;
}
// A fine chain: a thin tube whose radius swells and narrows `links` times along it (beads / links at any size).
function beadedTube(curve, segments, r, links, radial) {
  const g = new THREE.TubeGeometry(curve, segments, r, radial, false);
  const pos = g.attributes.position, c = new THREE.Vector3(), d = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    curve.getPointAt(i / segments, c);
    const k = 0.5 + 0.7 * Math.abs(Math.sin(Math.PI * links * i / segments));
    for (let j = 0; j <= radial; j++) {
      const v = i * (radial + 1) + j;
      d.fromBufferAttribute(pos, v).sub(c).multiplyScalar(k);
      pos.setXYZ(v, c.x + d.x, c.y + d.y, c.z + d.z);
    }
  }
  return g;
}

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

// `fit`: the face's measurements ({ key: 'body:face', eyes, head, brow (the Brow's positions), female }), or an assembly
// (src/render/avatarParts.js assemble: its `fit`).
export function buildGlasses(fit, style) {
  if (fit?.fit) fit = fit.fit;
  const key = `${fit?.key}:${style}`;
  if (cache.has(key)) return cache.get(key);
  const E = fit?.eyes, H = fit?.head;
  if (!E || !H) return null;
  const eyeL = E.left.centre, eyeR = E.right.centre;
  const ex = (Math.abs(eyeL.x) + Math.abs(eyeR.x)) / 2, ey = (eyeL.y + eyeR.y) / 2;
  // the brows: the lowest brow point over the eyes (the rim's top stays under it)
  let browMin = Infinity;
  const brow = fit.brow;
  if (brow) {
    for (let v = 0; v < brow.length; v += 3) if (Math.abs(Math.abs(brow[v]) - ex) < ex * 0.6) browMin = Math.min(browMin, brow[v + 1]);
  }
  const female = !!fit.female;
  const tube = female ? 0.0036 : 0.0042;
  const clear = 0.007;
  const R = ex * (style === 'pincenez' ? 0.82 : style === 'oval' ? 0.95 : style === 'gilt' ? 1.04 : style === 'monocle' ? (fit.female ? 0.90 : 0.98) : 1.02);
  const gilt = style === 'gilt' || style === 'monocle';      // the flat gilt band rims (W1-B)
  const band = tube * (style === 'monocle' ? 1.30 : 1.12);   // the band's half-width (its depth: 0.45 of that)
  const bridgeHalf = ex * (style === 'pincenez' ? 0.3 : 0.32);
  const cx = bridgeHalf + R * (style === 'pincenez' ? 0.9 : 1.0);
  let cy = ey;
  // keep the top of the rim under the brows: move the rim down a little, then squash it
  const shape = outline(style === 'round' || gilt ? 'round' : style);
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
    const rim = new THREE.CatmullRomCurve3(pts, true, 'centripetal');
    if (!gilt) parts.push(new THREE.TubeGeometry(rim, 64, tube, 6, true));
    else {
      parts.push(bandTube(rim, style === 'monocle' ? 64 : 48, band, 0.45, 6, true));
      if (style === 'monocle') {         // the fine beaded edge just outside the band (milgrain)
        const cxs = side * cx, edge = pts.map(p => {
          const r0 = Math.max(1e-6, Math.hypot(p.x - cxs, p.y - cy)), k = (r0 + band + tube * 0.42) / r0;
          return V(cxs + (p.x - cxs) * k, cy + (p.y - cy) * k, p.z - 0.0008);
        });
        parts.push(beadedTube(new THREE.CatmullRomCurve3(edge, true, 'centripetal'), 64, tube * 0.42, 48, 3));
      }
    }
  }
  // the rim point nearest an angle (radians, 0 = outward, PI = toward the nose)
  const ringPoint = (side, ang) => {
    const pts = rims[side], N = pts.length;
    return pts[Math.round((((ang / (Math.PI * 2)) % 1) + 1) % 1 * N) % N].clone();
  };
  if (style === 'gilt') {
    // the keyhole bridge: an arch from one rim's inner side up over the nose to the other's, never on the face
    const aIn = ringPoint(-1, Math.PI - 0.22), bIn = ringPoint(1, Math.PI - 0.22);
    const top = (aIn.y + bIn.y) / 2 + R * 0.40;
    const bz = Math.max(aIn.z, (faceZ(0, top) ?? aIn.z) + clear);
    const mid = (p, k) => V(p.x * k, p.y + (top - p.y) * (1 - k * k), Math.max((p.z + bz) / 2 + 0.002, (faceZ(p.x * k, p.y + (top - p.y) * (1 - k * k)) ?? -Infinity) + clear));
    parts.push(bandTube(new THREE.CatmullRomCurve3([aIn, mid(aIn, 0.62), V(0, top, bz), mid(bIn, 0.62), bIn]), 24, band * 0.8, 0.6, 5, false));
  }
  if (style !== 'monocle' && style !== 'gilt') {
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
      const zEnd = earZ(H, side, ey) - 0.025;
      const steps = 8;
      for (let k = 1; k <= steps; k++) {
        const z = hinge.z - 0.01 + (zEnd - hinge.z + 0.01) * (k / steps);
        x = Math.max(x * 0.98, H.halfWidth(hinge.y, z, side, 0.016, 0.016) + clear * 0.8);
        path.push(V(side * x, hinge.y - 0.004 * k, z));
      }
      const last = path[path.length - 1];
      if (style !== 'gilt') path.push(V(last.x * 0.97, last.y - 0.03, last.z - 0.012));   // the hook behind the ear
      else {                                // a riding bow: the end curls down behind the ear and forward under it
        for (const [dy, dz, f] of [[-0.022, -0.012, 0.985], [-0.046, -0.008, 0.97], [-0.060, 0.008, 0.955]]) {
          const y = last.y + dy, z = last.z + dz;
          path.push(V(side * Math.max(Math.abs(last.x) * f, H.halfWidth(y, z, side, 0.016, 0.016) + clear * 0.8), y, z));
        }
        // the end pieces: a short block at each hinge
        const hz = hinge.z;
        parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([V(hinge.x, hinge.y, hz + 0.002), V(hinge.x, hinge.y, hz - 0.008)]), 2, tube * 1.25, 6, false));
      }
      parts.push(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(path, false, 'centripetal'), style === 'gilt' ? 30 : 32, tube * (style === 'gilt' ? 0.8 : 0.85), 5, false));
    }
  }
  if (style === 'monocle') {
    // the eyelet at the rim's outer foot, and a fine beaded chain from it down the cheek and back up behind the ear
    const S = -1, p0 = ringPoint(S, -0.65), ez = earZ(H, S, ey);
    const out = V(p0.x - S * cx, p0.y - cy, 0).normalize();
    const eye = p0.clone().addScaledVector(out, band + tube * 0.9);
    const ring = new THREE.TorusGeometry(tube * 0.95, tube * 0.32, 4, 10);
    ring.translate(eye.x, eye.y, eye.z);
    parts.push(ring);
    const off = (x, y, z) => V(S * Math.max(Math.abs(x), H.halfWidth(y, z, S, 0.02, 0.03) + 0.010), y, z);
    const chain = [eye, off(eye.x + S * 0.010, eye.y - 0.045, eye.z - 0.022), off(eye.x + S * 0.026, eye.y - 0.085, (eye.z + ez) / 2 + 0.006),
      off(S * (Math.abs(eye.x) + 0.034), eye.y - 0.090, ez + 0.03), off(S * (Math.abs(eye.x) + 0.03), ey - 0.07, ez + 0.006),
      off(S * (H.halfWidth(ey - 0.05, ez - 0.004, S, 0.02, 0.03) + 0.008), ey - 0.05, ez - 0.004)];
    parts.push(beadedTube(new THREE.CatmullRomCurve3(chain, false, 'centripetal'), 72, tube * 0.42, 40, 4));
  }
  const geo = mergeGeometries(parts.map(g => { g.deleteAttribute('uv'); return g; }), false);
  for (const g of parts) g.dispose();
  geo.computeBoundingSphere();
  cache.set(key, geo);
  return geo;
}

// The ear's depth (z) on one side: the head's widest point a little below the eyes.
function earZ(head, side, ey) {
  let best = null;
  for (const p of head.skin) {
    if (p.y < ey - 0.12 || p.y > ey + 0.02 || p.x * side <= 0) continue;
    if (!best || p.x * side > best.x * side) best = p;
  }
  return best ? best.z : -0.05;
}

// The glasses as a piece of the guest (src/render/avatarParts.js merges it in): the tubes with the skin of a rigid
// piece on the head bone (`headIdx`), so they move exactly as a mesh fixed to the head would. No vertex colour (white:
// the frame colour comes from the guest's palette). Kept with the tubes.
const pieces = new Map();
export function glassesPiece(fit, style, headIdx) {
  if (fit?.fit) fit = fit.fit;
  const key = `${fit?.key}:${style}:${headIdx}`;
  if (pieces.has(key)) return pieces.get(key);
  const tubes = buildGlasses(fit, style);
  if (!tubes) return null;
  const n = tubes.attributes.position.count;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', tubes.attributes.position);
  g.setAttribute('normal', tubes.attributes.normal);
  const joints = new Uint8Array(n * 4), weights = new Uint8Array(n * 4);
  for (let v = 0; v < n; v++) { joints[v * 4] = headIdx; weights[v * 4] = 255; }
  g.setAttribute('skinIndex', new THREE.BufferAttribute(joints, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(weights, 4, true));
  g.setIndex(tubes.index);
  pieces.set(key, g);
  return g;
}
