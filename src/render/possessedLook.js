// The possessed look — shared by the game (src/render/characterView.js) and the portrait tool
// (tools/char-pipeline/preview_glb.html), so the guest in the hotel and the guest in the interface
// have the same eyes. A possessed guest looks exactly like the normal guest except BOTH eyes: the
// black eye ovals become a deep blood-red iris — dark at the rim, brighter low in the middle — with a
// small crisp white catchlight high and a little right of centre, like the owner's reference. Only the
// player's own guest on their own screen ever wears it (main.js decides; nothing here knows who).
//
// Use (any guest GLB whose materials keep their names — 'Eye', and 'Shine' for the women's own
// catchlights):
//   import { createPossessedEyes } from '…/src/render/possessedLook.js';
//   const eyes = createPossessedEyes(root);   // once, after the model has loaded (materials flattened)
//   eyes.set(true);                           // red eyes on; eyes.set(false) puts the normal eyes back
// Dependency-free apart from 'three'. No extra draw calls: the Eye material of the one skinned mesh
// is swapped for a red one (one shader for every guest: they share its program).
import * as THREE from 'three';

// THE LOOK's colours (sRGB hex). The private interface plates (styles.css) are meant to use the same.
export const POSSESSED_COLORS = {
  irisRim: '#4a0710',      // the eye's edge: deep, almost black red
  irisMid: '#5e0b14',      // the body of the iris
  irisCore: '#a51d2a',     // brightest, low in the middle (the reference's red glow)
  catchlight: '#fff8f0',   // the small crisp white highlight
  plateTop: '#2b1018',     // private interface plate: dark plum-crimson backdrop, top ...
  plateBottom: '#160910',  // ... to bottom
  plateLine: '#a3263a',    // thin crimson inner line inside the gold border
  badgeClean: '#133a2a',   // the quiet green "CLEAN" pill
};

// Shape of the eye's paint, in eye-local units (x to the viewer's right, y up; the oval's edge is 1).
export const POSSESSED_EYE = {
  glowCentre: [0.18, -0.34],  // where the red is brightest (low and a little to the right)
  glowRadius: 0.8,
  catchlight: [0.12, 0.2],    // the white catchlight (a little right of centre and high, like the reference;
                              // kept near the middle so it stays inside both ovals when the head is turned)
  catchlightRadius: 0.2,      // (in eye widths: round, whatever the oval's shape)
  glow: 0.12,                 // faint self-light so the red still reads in a dark room (0 = none)
};

// The eye ovals' frame, measured from the mesh: for each eye (bind-pose x < 0 and x >= 0) its centre
// and a matrix taking a bind-pose position to eye-local coordinates (x to the viewer's right, y up,
// z out of the face; ±1 at the oval's edges). Works for any flattened eye oval, however it is turned.
export function measureEyes(geometry, materialIndex) {
  const pos = geometry.attributes.position;
  if (!pos) return null;
  const verts = new Set();
  const index = geometry.index;
  const groups = geometry.groups.length ? geometry.groups.filter(g => g.materialIndex === materialIndex)
    : [{ start: 0, count: index ? index.count : pos.count }];
  for (const g of groups) {
    for (let k = g.start; k < g.start + g.count; k++) verts.add(index ? index.getX(k) : k);
  }
  if (verts.size < 8) return null;
  const sides = [[], []];
  const v = new THREE.Vector3();
  for (const i of verts) { v.fromBufferAttribute(pos, i); sides[v.x < 0 ? 0 : 1].push(v.clone()); }
  const frames = sides.map(pts => (pts.length >= 4 ? measureOval(pts) : null));
  if (!frames[0] && !frames[1]) return null;
  return { left: frames[0] || frames[1], right: frames[1] || frames[0] };
}

function measureOval(pts) {
  const c = new THREE.Vector3();
  for (const p of pts) c.add(p);
  c.divideScalar(pts.length);
  // Covariance -> principal axes (Jacobi): longest = up, middle = across, shortest = out of the face.
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  for (const p of pts) {
    const d = [p.x - c.x, p.y - c.y, p.z - c.z];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) m[a][b] += d[a] * d[b];
  }
  const { values, vectors } = jacobi3(m);
  const order = [0, 1, 2].sort((a, b) => values[b] - values[a]);
  const axis = k => new THREE.Vector3(vectors[0][order[k]], vectors[1][order[k]], vectors[2][order[k]]).normalize();
  const up = axis(0), fwd = axis(2);
  if (fwd.z < 0) fwd.negate();                      // out of the face (the guests face +z)
  if (up.y < 0) up.negate();
  up.addScaledVector(fwd, -up.dot(fwd)).normalize();
  const right = new THREE.Vector3().crossVectors(up, fwd).normalize();   // the viewer's right
  // Semi-axes: the oval's extent along each axis.
  let sr = 0, su = 0, sf = 0;
  const d = new THREE.Vector3();
  for (const p of pts) {
    d.subVectors(p, c);
    sr = Math.max(sr, Math.abs(d.dot(right))); su = Math.max(su, Math.abs(d.dot(up))); sf = Math.max(sf, Math.abs(d.dot(fwd)));
  }
  if (!(sr > 0 && su > 0 && sf > 0)) return null;
  const toLocal = new THREE.Matrix3().set(
    right.x / sr, right.y / sr, right.z / sr,
    up.x / su, up.y / su, up.z / su,
    fwd.x / sf, fwd.y / sf, fwd.z / sf);
  return { centre: c, toLocal, aspect: su / sr };
}

// Eigen-decomposition of a symmetric 3x3 matrix (cyclic Jacobi). Columns of `vectors` are the axes.
function jacobi3(a) {
  a = a.map(r => r.slice());
  const vec = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 32; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-14) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      if (Math.abs(a[p][q]) < 1e-18) continue;
      const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const cs = 1 / Math.sqrt(t * t + 1), sn = t * cs;
      for (let k = 0; k < 3; k++) {           // a = J^T a J
        const akp = a[k][p], akq = a[k][q];
        a[k][p] = cs * akp - sn * akq; a[k][q] = sn * akp + cs * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p][k], aqk = a[q][k];
        a[p][k] = cs * apk - sn * aqk; a[q][k] = sn * apk + cs * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = vec[k][p], vkq = vec[k][q];
        vec[k][p] = cs * vkp - sn * vkq; vec[k][q] = sn * vkp + cs * vkq;
      }
    }
  }
  return { values: [a[0][0], a[1][1], a[2][2]], vectors: vec };
}

const linear = hex => new THREE.Color(hex);   // (sRGB hex -> the renderer's linear working colour)

// The red eye material for a guest's Eye material. `eyes` is measureEyes(...) of that mesh (without
// it the iris is a flat red). Keeps the base's vertex colours (baked shading) and sides; matte, lit
// like the rest of the guest, plus a faint glow.
export function possessedEyeMaterial(baseEyeMaterial, eyes = null) {
  const m = new THREE.MeshLambertMaterial({ color: 0xffffff });
  m.name = (baseEyeMaterial && baseEyeMaterial.name ? baseEyeMaterial.name : 'Eye') + ':possessed';
  if (baseEyeMaterial) {
    if (baseEyeMaterial.vertexColors) m.vertexColors = true;
    if (baseEyeMaterial.side !== undefined) m.side = baseEyeMaterial.side;
  }
  const E = POSSESSED_EYE;
  const zero = new THREE.Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);
  const L = eyes ? eyes.left : null, R = eyes ? eyes.right : null;
  const uniforms = {
    uEyeCL: { value: L ? L.centre.clone() : new THREE.Vector3() },
    uEyeML: { value: L ? L.toLocal.clone() : zero },
    uEyeCR: { value: R ? R.centre.clone() : new THREE.Vector3() },
    uEyeMR: { value: R ? R.toLocal.clone() : zero },
    uEyeAspect: { value: L ? L.aspect : 1.6 },
    uIrisRim: { value: linear(POSSESSED_COLORS.irisRim) },
    uIrisMid: { value: linear(POSSESSED_COLORS.irisMid) },
    uIrisCore: { value: linear(POSSESSED_COLORS.irisCore) },
    uCatchCol: { value: linear(POSSESSED_COLORS.catchlight) },
    uGlowC: { value: new THREE.Vector2(...E.glowCentre) },
    uGlowR: { value: E.glowRadius },
    uCatchC: { value: new THREE.Vector2(...E.catchlight) },
    uCatchR: { value: E.catchlightRadius },
    uGlow: { value: E.glow },
  };
  m.userData.possessedUniforms = uniforms;   // (for tuning from a debug console)
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = 'uniform vec3 uEyeCL;\nuniform mat3 uEyeML;\nuniform vec3 uEyeCR;\nuniform mat3 uEyeMR;\nvarying vec3 vEyeL;\n'
      + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vEyeL = position.x < 0.0 ? uEyeML * (position - uEyeCL) : uEyeMR * (position - uEyeCR);`);
    shader.fragmentShader = `uniform float uEyeAspect;
uniform vec3 uIrisRim;
uniform vec3 uIrisMid;
uniform vec3 uIrisCore;
uniform vec3 uCatchCol;
uniform vec2 uGlowC;
uniform float uGlowR;
uniform vec2 uCatchC;
uniform float uCatchR;
uniform float uGlow;
varying vec3 vEyeL;
` + shader.fragmentShader.replace('#include <opaque_fragment>', `
      {
        // The light falling here (the material is white: this is how lit a white eye would be), as a
        // brightness capped at 1: painted, matte — never brighter than its colours, never a glossy ball.
        vec3 lit = reflectedLight.directDiffuse + reflectedLight.indirectDiffuse;
        float shade = min(dot(lit, vec3(0.2126, 0.7152, 0.0722)), 1.0);
        vec2 e = vEyeL.xy;
        float r = clamp(length(e), 0.0, 1.0);
        // Iris: the rim colour at the edge, the body colour inside, brightest low in the middle.
        vec3 iris = mix(uIrisMid, uIrisRim, smoothstep(0.5, 0.97, r));
        float g = 1.0 - smoothstep(0.0, uGlowR, length(e - uGlowC));
        iris = mix(iris, uIrisRim, 0.6 * smoothstep(-0.2, 0.9, e.y));   // darker towards the top
        iris = mix(iris, uIrisCore, g * g);
        outgoingLight = iris * (shade + uGlow);
        // The catchlight: a small crisp round dot (measured in eye widths, so it stays round).
        vec2 dc = (e - uCatchC) * vec2(1.0, uEyeAspect);
        float hl = 1.0 - smoothstep(uCatchR * 0.78, uCatchR, length(dc));
        hl *= step(0.0, vEyeL.z);                  // (only on the front of the oval)
        outgoingLight = mix(outgoingLight, uCatchCol * (0.5 + 0.5 * shade), hl);
      }
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'possessedEye1';
  return m;
}

// Find a loaded guest's eyes (meshes whose material — or one of whose materials — is named 'Eye')
// and return a switch: set(on) swaps the red eyes in or the normal ones back (cheap; only on a
// change). The women's own small 'Shine' catchlights are hidden while possessed (the red eye has its
// own). A model without an Eye material gives a switch that does nothing (available: false).
export function createPossessedEyes(root) {
  const slots = [];     // { mesh, index (-1 = single material), normal, red }
  const shines = [];
  root.traverse(o => {
    if (!o.isMesh || !o.material) return;
    const list = Array.isArray(o.material) ? o.material : [o.material];
    list.forEach((mat, i) => {
      if (!mat) return;
      if (mat.name === 'Shine') { shines.push(mat); return; }
      if (mat.name !== 'Eye') return;
      const eyes = o.geometry ? measureEyes(o.geometry, Array.isArray(o.material) ? i : 0) : null;
      slots.push({ mesh: o, index: Array.isArray(o.material) ? i : -1, normal: mat, red: possessedEyeMaterial(mat, eyes) });
    });
  });
  let on = false;
  function set(v) {
    v = !!v;
    if (v === on) return;
    on = v;
    for (const s of slots) {
      const mat = on ? s.red : s.normal;
      if (s.index < 0) s.mesh.material = mat; else s.mesh.material[s.index] = mat;
    }
    for (const sh of shines) sh.visible = !on;
  }
  return { set, get on() { return on; }, available: slots.length > 0, materials: slots.map(s => s.red) };
}
