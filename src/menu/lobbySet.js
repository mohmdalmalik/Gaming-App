// Builds the static main-menu lobby (architecture, furniture, lamps, light pools) from
// src/menu/lobbyLayout.js. Placeholder art in the game's palette: walnut, cream marble, burgundy
// velvet, brass. It is meant to be seen slightly blurred, so the effort goes into composition,
// warm light and strong silhouettes rather than detail.
//
// Cheap to draw: every solid piece is merged into a handful of meshes by material (all plain-
// coloured parts share ONE Lambert mesh through vertex colours), and all glows, light pools and
// wall washes are additive instanced quads. The whole room is ~25 draw calls.
// The only moving parts are the lift doors, the dial needle and the light levels (see `lift`).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as TX from './lobbyTextures.js';

const D2R = Math.PI / 180;
const C = {
  walnut: '#4a2a17', walnutDark: '#2c180d', walnutMid: '#5b3520', ebony: '#17100c',
  brass: '#c29243', brassDark: '#8a6328', marbleBlack: '#1c1513', cream: '#e6d6b4',
  plaster: '#4a3324', plasterDark: '#2e2016', ceiling: '#150f0b',
  velvet: '#7d1a24', velvetDark: '#561019', leaf: '#3f6b40', leafDark: '#2b4a2e',
  planter: '#1a1412', glow: '#ffe2ae', glowWarm: '#ffcc80', curtain: '#5a0f18',
};

// ---- geometry batching ------------------------------------------------------------------------
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
const col = new THREE.Color();
const AY = new THREE.Vector3(0, 1, 0);
const FLAT = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);

class Batch {
  constructor(uv = false) { this.uv = uv; this.parts = []; this.stack = [new THREE.Matrix4()]; }
  get M() { return this.stack[this.stack.length - 1]; }
  // enter a local frame at (x, y, z) turned by `headingDeg` (0 = local +Z faces world +Z)
  push(x = 0, y = 0, z = 0, headingDeg = 0, scale = 1) {
    const m = new THREE.Matrix4().compose(_p.set(x, y, z), _q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), headingDeg * D2R), _s.setScalar(scale));
    this.stack.push(this.M.clone().multiply(m));
  }
  pop() { this.stack.pop(); }
  add(geo, color, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k) || (k === 'uv' && !this.uv)) g.deleteAttribute(k);
    _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz));
    g.applyMatrix4(this.M.clone().multiply(_m));
    const n = g.attributes.position.count;
    const arr = new Float32Array(n * 3);
    col.set(color || '#ffffff');
    for (let i = 0; i < n; i++) { arr[i * 3] = col.r; arr[i * 3 + 1] = col.g; arr[i * 3 + 2] = col.b; }
    g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    this.parts.push(g);
    return g;
  }
  // an axis-aligned (in the current frame) box by centre and size
  box(w, h, d, x, y, z, color, ry = 0) { return this.add(unitBox, color, x, y, z, 0, ry, 0, w, h, d); }
  // a box resting on y0
  block(w, h, d, x, y0, z, color, ry = 0) { return this.box(w, h, d, x, y0 + h / 2, z, color, ry); }
  mesh(material, name) {
    if (!this.parts.length) return null;
    const g = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, material);
    m.name = name;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    return m;
  }
}

// A flat rectangle in a wall/floor with UVs taken from world position (so pieces tile seamlessly).
function quad(batch, corners, uvs, color) {
  const g = new THREE.BufferGeometry();
  const [a, b, c, d] = corners;
  g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c, ...a, ...c, ...d], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([...uvs[0], ...uvs[1], ...uvs[2], ...uvs[0], ...uvs[2], ...uvs[3]], 2));
  g.computeVertexNormals();
  batch.add(g, color);
  g.dispose();
}
// back-wall piece (faces +Z) from x0..x1, y0..y1 at z, UV per 1.2 m x panelTop bay
function backWallQuad(batch, x0, x1, y0, y1, z, bayW, bayH) {
  quad(batch, [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]],
    [[x0 / bayW, y0 / bayH], [x1 / bayW, y0 / bayH], [x1 / bayW, y1 / bayH], [x0 / bayW, y1 / bayH]]);
}
// right-wall piece (faces -X) along z0..z1 at x
function rightWallQuad(batch, z0, z1, y0, y1, x, bayW, bayH) {
  quad(batch, [[x, y0, z0], [x, y0, z1], [x, y1, z1], [x, y1, z0]],
    [[-z0 / bayW, y0 / bayH], [-z1 / bayW, y0 / bayH], [-z1 / bayW, y1 / bayH], [-z0 / bayW, y1 / bayH]]);
}

// A drooping palm frond along local +X (width across Z), for a double-sided leaf material.
function frondGeometry(len, width, droop, segs = 7) {
  const pos = [], idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const x = t * len, y = Math.sin(t * Math.PI * 0.5) * len * 0.35 - t * t * droop;
    const w = width * Math.sin(Math.min(1, t * 1.15) * Math.PI) * (1 - t * 0.3) + 0.004;
    pos.push(x, y, -w / 2, x, y + w * 0.25, 0, x, y, w / 2);
  }
  for (let i = 0; i < segs; i++) {
    const a = i * 3, b = (i + 1) * 3;
    idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ---- glows (additive quads) --------------------------------------------------------------------
// type: 'bill' (faces the camera), 'floor' (flat on the floor, optional yaw), 'wall' (facing a normal)
class Glows {
  constructor(texture, max) {
    this.items = [];
    this.mat = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: true });
    this.max = max;
  }
  add(item) { this.items.push({ intensity: 1, ...item }); return this.items.length - 1; }
  build() {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mesh = new THREE.InstancedMesh(geo, this.mat, Math.max(1, this.items.length));
    mesh.frustumCulled = false;
    mesh.count = this.items.length;
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, this.items.length) * 3), 3);
    this.mesh = mesh;
    this.items.forEach((it, i) => { this.setMatrix(i, null); this.setColor(i); });
    mesh.renderOrder = 5;
    return mesh;
  }
  setMatrix(i, camQ) {
    const it = this.items[i];
    _p.set(...it.pos);
    if (it.type === 'bill') { if (!camQ) _q.identity(); else _q.copy(camQ); }
    else if (it.type === 'floor') _q.setFromAxisAngle(AY, (it.yaw || 0) * D2R).multiply(FLAT);
    else {
      _q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), new THREE.Vector3(...it.normal));
      if (it.roll) _q.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), it.roll));
    }
    _s.set(it.size[0], it.size[1], 1);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(i, _m);
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  setColor(i) {
    const it = this.items[i];
    col.set(it.color).multiplyScalar(it.intensity);
    this.mesh.setColorAt(i, col);
    this.mesh.instanceColor.needsUpdate = true;
  }
  set(i, intensity) { if (this.items[i].intensity !== intensity) { this.items[i].intensity = intensity; this.setColor(i); } }
  faceCamera(camQ) { this.items.forEach((it, i) => { if (it.type === 'bill') this.setMatrix(i, camQ); }); }
}

// ---- the build -----------------------------------------------------------------------------------
export function buildLobbySet(L) {
  const R = L.room;
  const group = new THREE.Group();
  group.name = 'menu-lobby-set';
  const disposables = [];

  // materials (cheap: Lambert/Basic like the game)
  const lam = new THREE.MeshLambertMaterial({ vertexColors: true });
  const lamDouble = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const floorTex = TX.marbleFloor();
  floorTex.repeat.set(1, 1);
  const floorMat = new THREE.MeshLambertMaterial({ map: floorTex });
  const wallMat = new THREE.MeshLambertMaterial({ map: TX.walnutPanel() });
  const rugMat = new THREE.MeshLambertMaterial({ map: TX.rugTexture() });
  const runnerMat = new THREE.MeshLambertMaterial({ map: TX.runnerTexture() });
  const keysMat = new THREE.MeshLambertMaterial({ map: TX.keyBoardTexture() });
  const winMat = new THREE.MeshBasicMaterial({ map: TX.windowTexture() });
  const doorMat = new THREE.MeshLambertMaterial({ map: TX.liftDoorTexture() });
  const dialMat = new THREE.MeshLambertMaterial({ map: TX.dialTexture(), transparent: true, alphaTest: 0.05, emissive: new THREE.Color('#3a2a14') });
  disposables.push(lam, lamDouble, glowMat, floorMat, wallMat, rugMat, runnerMat, keysMat, winMat, doorMat, dialMat);

  const S = new Batch();          // solid Lambert, vertex colours
  const LV = new Batch();         // double-sided (leaves)
  const G = new Batch();          // unlit glowing (lamp shades, chandelier glass, lift ceiling)
  const W = new Batch(true);      // walnut panelling (textured)
  const RG = new Batch(true);     // rugs
  const glows = new Glows(TX.glowTexture());
  const washes = new Glows(TX.washTexture());

  const H = R.height, PT = R.panelTop, BW = 1.2;
  const zB = R.z0, xR = R.x1;
  const lift = L.lift, lx0 = lift.x - lift.width / 2, lx1 = lift.x + lift.width / 2;
  const ar = L.archway, ax0 = ar.x - ar.width / 2, ax1 = ar.x + ar.width / 2;

  // --- floor (one plane, world-tiled marble) ---
  {
    const fw = R.x1 - R.x0, fd = R.z1 - R.z0;
    const g = new THREE.PlaneGeometry(fw, fd);
    g.rotateX(-Math.PI / 2);
    g.translate((R.x0 + R.x1) / 2, 0, (R.z0 + R.z1) / 2);
    const tile = 1.8;   // texture = 2 x 2 tiles of 0.9 m
    const uv = g.attributes.uv, p = g.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, p.getX(i) / tile, -p.getZ(i) / tile);
    const m = new THREE.Mesh(g, floorMat);
    m.name = 'floor';
    group.add(m);
    disposables.push(g);
  }

  // --- back wall: panelling with holes for the lift and the archway, plaster above ---
  const wallZ = zB;
  const backSpans = [[R.x0, ax0], [ax1, lx0], [lx1, xR]];
  for (const [a, b] of backSpans) backWallQuad(W, a, b, 0, PT, wallZ, BW, PT);
  backWallQuad(W, ax0, ax1, ar.height, PT, wallZ, BW, PT);
  backWallQuad(W, lx0, lx1, lift.height, PT, wallZ, BW, PT);
  // plaster above the panelling, frieze and cornice
  S.box(R.x1 - R.x0, H - PT, 0.1, (R.x0 + R.x1) / 2, (PT + H) / 2, wallZ - 0.05, C.plaster);
  S.box(R.x1 - R.x0, 0.12, 0.08, (R.x0 + R.x1) / 2, PT + 0.06, wallZ + 0.04, C.walnutDark);
  S.box(R.x1 - R.x0, 0.035, 0.1, (R.x0 + R.x1) / 2, PT + 0.02, wallZ + 0.05, C.brass);
  S.box(R.x1 - R.x0, 0.3, 0.3, (R.x0 + R.x1) / 2, H - 0.15, wallZ + 0.15, C.walnutDark);
  S.box(R.x1 - R.x0, 0.12, 0.45, (R.x0 + R.x1) / 2, H - 0.36, wallZ + 0.22, C.walnut);
  // right wall
  rightWallQuad(W, zB, R.z1, 0, PT, xR, BW, PT);
  S.box(0.1, H - PT, R.z1 - zB, xR + 0.05, (PT + H) / 2, (zB + R.z1) / 2, C.plaster);
  S.box(0.08, 0.12, R.z1 - zB, xR - 0.04, PT + 0.06, (zB + R.z1) / 2, C.walnutDark);
  S.box(0.1, 0.035, R.z1 - zB, xR - 0.05, PT + 0.02, (zB + R.z1) / 2, C.brass);
  S.box(0.3, 0.3, R.z1 - zB, xR - 0.15, H - 0.15, (zB + R.z1) / 2, C.walnutDark);
  // left wall (mostly out of view)
  S.box(0.1, H, R.z1 - zB, R.x0 - 0.05, H / 2, (zB + R.z1) / 2, C.plasterDark);
  // ceiling with deep coffers
  S.box(R.x1 - R.x0, 0.1, R.z1 - zB, (R.x0 + R.x1) / 2, H + 0.05, (zB + R.z1) / 2, C.ceiling);
  for (let x = R.x0 + 3; x < R.x1; x += 3.4) S.box(0.3, 0.32, R.z1 - zB, x, H - 0.16, (zB + R.z1) / 2, C.walnutDark);
  for (let z = zB + 3; z < R.z1; z += 3.4) S.box(R.x1 - R.x0, 0.32, 0.3, (R.x0 + R.x1) / 2, H - 0.16, z, C.walnutDark);

  // --- pilasters (back wall and right wall), with brass bands ---
  for (const x of L.pilasters) {
    S.block(0.56, H - 0.45, 0.16, x, 0, wallZ + 0.08, C.walnutDark);
    S.block(0.64, 0.16, 0.2, x, 0, wallZ + 0.1, C.ebony);
    S.block(0.6, 0.06, 0.2, x, PT - 0.05, wallZ + 0.1, C.brass);
    S.block(0.6, 0.06, 0.2, x, H - 0.75, wallZ + 0.1, C.brass);
    S.block(0.06, PT - 0.6, 0.02, x, 0.3, wallZ + 0.17, C.brassDark);
  }
  for (const zp of L.rightPilasters) {
    S.block(0.16, H - 0.45, 0.56, xR - 0.08, 0, zp, C.walnutDark);
    S.block(0.2, 0.06, 0.6, xR - 0.1, PT - 0.05, zp, C.brass);
    S.block(0.2, 0.06, 0.6, xR - 0.1, H - 0.75, zp, C.brass);
  }

  // --- sconces on the pilasters: brass plate, glowing shade, halo and a wash up the wall ---
  const sconce = (x, y, z, nx, nz) => {
    S.box(nx ? 0.04 : 0.13, 0.32, nx ? 0.13 : 0.04, x + nx * 0.02, y, z + nz * 0.02, C.brass);
    const sx = x + nx * 0.12, sz = z + nz * 0.12;
    G.add(new THREE.CylinderGeometry(0.075, 0.1, 0.2, 10, 1, true), C.glow, sx, y + 0.06, sz);
    glows.add({ type: 'bill', pos: [sx + nx * 0.05, y + 0.06, sz + nz * 0.05], size: [0.75, 0.75], color: '#ffc477', intensity: 0.9 });
    washes.add({ type: 'wall', pos: [x + nx * 0.18, y + 0.15, z + nz * 0.18], normal: [nx, 0, nz], size: [1.0, 2.6], color: '#ff9a40', intensity: 0.42 });
  };
  for (const [x, y] of L.sconces) sconce(x, y, wallZ + 0.16, 0, 1);
  const flickerGlow = glows.items.length - (L.sconces.length - (L.flickerSconce ?? 0)) * 1;   // the halo of that sconce
  const flickerWash = washes.items.length - (L.sconces.length - (L.flickerSconce ?? 0));
  for (const zp of L.rightSconces) sconce(xR - 0.16, 2.3, zp, -1, 0);

  // --- the lift: brass surround, Art Deco fan, floor dial, the car inside, sliding doors ---
  const LH = lift.height, LD = lift.depth;
  // stepped brass architrave
  S.block(0.16, LH + 0.12, 0.12, lx0 - 0.08, 0, wallZ + 0.06, C.brass);
  S.block(0.16, LH + 0.12, 0.12, lx1 + 0.08, 0, wallZ + 0.06, C.brass);
  S.block(lift.width + 0.32, 0.12, 0.12, lift.x, LH, wallZ + 0.06, C.brass);
  S.block(0.12, LH + 0.3, 0.06, lx0 - 0.22, 0, wallZ + 0.03, C.brassDark);
  S.block(0.12, LH + 0.3, 0.06, lx1 + 0.22, 0, wallZ + 0.03, C.brassDark);
  // fan transom (alternating brass / dark wedges)
  {
    const r = 0.62, n = 15, cy = LH + 0.12;
    for (let i = 0; i < n; i++) {
      const a0 = Math.PI * i / n, a1 = Math.PI * (i + 1) / n;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, Math.cos(a0) * r, Math.sin(a0) * r, 0, Math.cos(a1) * r, Math.sin(a1) * r, 0], 3));
      g.computeVertexNormals();
      // (wound counter-clockwise from the front: +Z normal)
      S.add(g, i % 2 ? C.brassDark : C.brass, lift.x, cy, wallZ + 0.02);
    }
    S.add(new THREE.CylinderGeometry(r + 0.06, r + 0.06, 0.05, 24, 1, false, -Math.PI / 2, Math.PI), C.brass, lift.x, cy, wallZ + 0.01, -Math.PI / 2, 0, 0);
  }
  // reveal (jambs and head) — the doors slide into the wall behind these
  S.box(0.03, LH, 0.42, lx0 - 0.015, LH / 2, wallZ - 0.21, C.brassDark);
  S.box(0.03, LH, 0.42, lx1 + 0.015, LH / 2, wallZ - 0.21, C.brassDark);
  S.box(lift.width, 0.03, 0.42, lift.x, LH + 0.015, wallZ - 0.21, C.brassDark);
  // the car: warm wood walls, brass rail, a lit ceiling
  const cz0 = wallZ - 0.42, cz1 = wallZ - 0.42 - LD;
  const cw = lift.width + 0.1;
  S.box(cw, 0.04, LD, lift.x, 0.0, (cz0 + cz1) / 2, '#3a2416');
  S.box(cw, LH + 0.15, 0.05, lift.x, (LH + 0.15) / 2, cz1, C.walnutMid);
  S.box(0.05, LH + 0.15, LD, lift.x - cw / 2, (LH + 0.15) / 2, (cz0 + cz1) / 2, C.walnutMid);
  S.box(0.05, LH + 0.15, LD, lift.x + cw / 2, (LH + 0.15) / 2, (cz0 + cz1) / 2, C.walnutMid);
  S.box(cw - 0.1, 0.04, 0.04, lift.x, 0.95, cz1 + 0.06, C.brass);
  S.box(cw - 0.3, 0.9, 0.02, lift.x, 1.55, cz1 + 0.035, '#7d6a52');   // smoky mirror
  G.box(cw - 0.2, 0.03, LD - 0.2, lift.x, LH + 0.12, (cz0 + cz1) / 2, '#ffe9c4');
  S.box(cw, 0.05, LD + 0.42, lift.x, LH + 0.16, (cz0 + cz1 + 0.42) / 2 + 0.0, C.walnutDark);
  // a sill
  S.box(lift.width + 0.06, 0.02, 0.44, lift.x, 0.01, wallZ - 0.2, C.brassDark);
  // call button plate
  S.box(0.12, 0.26, 0.03, lx1 + 0.42, 1.1, wallZ + 0.015, C.brass);
  const callGlow = glows.add({ type: 'bill', pos: [lx1 + 0.42, 1.14, wallZ + 0.06], size: [0.12, 0.12], color: '#ffb35a', intensity: 0.6 });
  // floor dial above the fan: plate + needle (moving)
  const dialY = LH + 0.98;
  const DS = 1.35;   // dial scale
  const dialG = new THREE.PlaneGeometry(0.72 * DS, 0.45 * DS);
  const dial = new THREE.Mesh(dialG, dialMat);
  dial.position.set(lift.x, dialY + 0.12, wallZ + 0.03);
  dial.name = 'lift-dial';
  group.add(dial);
  const needleG = new THREE.BoxGeometry(0.022, 0.21 * DS, 0.01); needleG.translate(0, 0.1 * DS, 0);
  const needle = new THREE.Mesh(needleG, new THREE.MeshBasicMaterial({ color: '#1a0f08' }));
  needle.position.set(lift.x, dialY + 0.12 - 0.225 + 0.018 * 450 / 160 + 0.0, wallZ + 0.045);
  // the dial texture's pivot is 18 px above its bottom edge (texture 160 px tall = 0.45 m)
  needle.position.y = dialY + 0.12 - 0.225 * DS + (18 / 160) * 0.45 * DS;
  needle.name = 'lift-needle';
  group.add(needle);
  disposables.push(dialG, needleG, needle.material);
  const dingGlow = glows.add({ type: 'bill', pos: [lift.x, dialY + 0.5, wallZ + 0.08], size: [0.4, 0.4], color: '#ffcf7a', intensity: 0.15 });
  S.box(0.12, 0.08, 0.04, lift.x, dialY + 0.5, wallZ + 0.03, C.brass);
  G.add(new THREE.SphereGeometry(0.04, 8, 6), '#ffe2a0', lift.x, dialY + 0.5, wallZ + 0.06);
  // a thin line of light between the shut doors: the car is lit and waiting
  const seamGlow = washes.add({ type: 'wall', pos: [lift.x, LH / 2, wallZ - 0.2], normal: [0, 0, 1], size: [0.14, LH * 1.05], color: '#ffd08a', intensity: 0.8 });
  // doors: two brass leaves at the back of the reveal
  const doorG = new THREE.BoxGeometry(lift.width / 2 + 0.01, LH, 0.04);
  const doorL = new THREE.Mesh(doorG, doorMat), doorR = new THREE.Mesh(doorG, doorMat);
  doorL.name = 'lift-door-L'; doorR.name = 'lift-door-R';
  const doorZ = wallZ - 0.25;
  doorL.position.set(lift.x - lift.width / 4, LH / 2, doorZ);
  doorR.position.set(lift.x + lift.width / 4, LH / 2, doorZ);
  doorR.scale.x = -1;   // mirrored pattern
  group.add(doorL, doorR);
  disposables.push(doorG);
  // light spill onto the lobby floor when open
  const spillG = new THREE.PlaneGeometry(1, 1); spillG.rotateX(-Math.PI / 2);
  const spillMat = new THREE.MeshBasicMaterial({ map: TX.spillTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, color: new THREE.Color(0, 0, 0) });
  const spill = new THREE.Mesh(spillG, spillMat);
  spill.scale.set(2.6, 1, 3.0);
  spill.position.set(lift.x, 0.015, wallZ + 1.5);
  spill.renderOrder = 4;
  spill.name = 'lift-spill';
  group.add(spill);
  disposables.push(spillG, spillMat);

  // --- archway to a dark corridor (stepped Deco portal) ---
  {
    const ah = ar.height;
    S.block(0.2, ah + 0.1, 0.14, ax0 - 0.1, 0, wallZ + 0.07, C.walnutDark);
    S.block(0.2, ah + 0.1, 0.14, ax1 + 0.1, 0, wallZ + 0.07, C.walnutDark);
    S.block(ar.width + 0.4, 0.14, 0.14, ar.x, ah, wallZ + 0.07, C.walnutDark);
    S.block(ar.width + 0.1, 0.05, 0.16, ar.x, ah + 0.14, wallZ + 0.08, C.brass);
    S.block(ar.width - 0.3, 0.2, 0.12, ar.x, ah + 0.19, wallZ + 0.06, C.walnutDark);
    S.block(ar.width - 0.8, 0.18, 0.1, ar.x, ah + 0.39, wallZ + 0.05, C.walnutDark);
    S.block(0.05, ah, 0.02, ax0 - 0.1, 0, wallZ + 0.15, C.brass);
    S.block(0.05, ah, 0.02, ax1 + 0.1, 0, wallZ + 0.15, C.brass);
    // corridor beyond: dim, long, with one far sconce
    const cd = 7, cz = wallZ - cd / 2;
    S.box(ar.width + 0.4, 0.02, cd, ar.x, 0, cz, '#2a1c14');
    S.box(0.1, ah + 0.3, cd, ax0 - 0.05, (ah + 0.3) / 2, cz, '#2b1b12');
    S.box(0.1, ah + 0.3, cd, ax1 + 0.05, (ah + 0.3) / 2, cz, '#2b1b12');
    S.box(ar.width + 0.4, 0.1, cd, ar.x, ah + 0.3, cz, '#160f0b');
    S.box(ar.width + 0.4, ah + 0.3, 0.1, ar.x, (ah + 0.3) / 2, wallZ - cd, '#22160f');
    S.block(0.7, 2.1, 0.04, ar.x + 0.1, 0, wallZ - cd + 0.06, '#120c08');      // a door at the far end
    glows.add({ type: 'bill', pos: [ax0 + 0.08, 1.9, wallZ - 4.6], size: [0.45, 0.45], color: '#d68a4a', intensity: 0.5 });
    glows.add({ type: 'floor', pos: [ar.x, 0.02, wallZ - 4.6], size: [1.5, 2.2], color: '#a85a28', intensity: 0.22 });
    G.add(new THREE.CylinderGeometry(0.04, 0.05, 0.12, 8, 1, true), '#ffcf96', ax0 + 0.08, 1.9, wallZ - 4.6);
  }

  // --- reception desk: walnut front with brass fluting, black marble top, lamp, bell, keys ---
  {
    const rc = L.reception, z0 = rc.front, z1 = rc.front - rc.depth, zc = (z0 + z1) / 2;
    const len = rc.x1 - rc.x0, xc = (rc.x0 + rc.x1) / 2, dh = rc.height - 0.08;
    S.block(len, dh, rc.depth, xc, 0, zc, C.walnut);
    S.block(len - 0.1, 0.1, rc.depth - 0.06, xc, 0, zc + 0.03, C.ebony);
    for (const ex of [rc.x0, rc.x1]) {           // streamlined round ends
      S.add(new THREE.CylinderGeometry(rc.depth / 2, rc.depth / 2, dh, 18), C.walnut, ex, dh / 2, zc);
      S.add(new THREE.CylinderGeometry(rc.depth / 2 + 0.06, rc.depth / 2 + 0.06, 0.08, 18), C.marbleBlack, ex, dh + 0.04, zc);
      for (let k = 0; k < 3; k++) S.add(new THREE.CylinderGeometry(rc.depth / 2 + 0.008, rc.depth / 2 + 0.008, 0.025, 18), C.brass, ex, 0.3 + k * 0.22, zc);
    }
    S.block(len, 0.08, rc.depth + 0.12, xc, dh, zc, C.marbleBlack);
    S.block(len, 0.025, 0.02, xc, dh - 0.02, z0 + 0.065, C.brass);
    for (let x = rc.x0 + 0.25; x < rc.x1 - 0.1; x += 0.3) S.block(0.03, dh - 0.25, 0.02, x, 0.17, z0 + 0.008, C.brass);
    // desk lamp (cream shade, lit)
    const lx = rc.x1 - 0.45, lzz = zc;
    S.add(new THREE.CylinderGeometry(0.07, 0.09, 0.04, 12), C.brass, lx, rc.height + 0.02, lzz);
    S.add(new THREE.CylinderGeometry(0.012, 0.012, 0.36, 6), C.brass, lx, rc.height + 0.2, lzz);
    G.add(new THREE.CylinderGeometry(0.09, 0.15, 0.17, 14, 1, true), C.glow, lx, rc.height + 0.42, lzz);
    glows.add({ type: 'bill', pos: [lx, rc.height + 0.4, lzz + 0.05], size: [0.9, 0.9], color: '#ffbe6e', intensity: 0.85 });
    glows.add({ type: 'floor', pos: [lx - 0.3, rc.height + 0.005, lzz + 0.05], size: [1.0, 0.6], color: '#ffb060', intensity: 0.35 });
    // bell, guest book, flowers
    S.add(new THREE.SphereGeometry(0.06, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), C.brass, rc.x0 + 1.25, rc.height, z0 - 0.15);
    S.block(0.4, 0.035, 0.28, xc + 0.25, rc.height, z0 - 0.2, '#5a1018', 0.15);
    S.block(0.36, 0.01, 0.24, xc + 0.25, rc.height + 0.035, z0 - 0.2, '#e9dcbc', 0.15);
    S.add(new THREE.CylinderGeometry(0.07, 0.05, 0.3, 10), '#1d2a2a', rc.x0 + 0.05, rc.height + 0.15, zc);
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4, rr = 0.06 + (i % 3) * 0.05;
      S.add(new THREE.SphereGeometry(0.075, 8, 6), i % 2 ? '#b8323c' : '#e9d9c0', rc.x0 + 0.05 + Math.cos(a) * rr, rc.height + 0.42 + (i % 4) * 0.05, zc + Math.sin(a) * rr);
    }
    // key pigeonholes on the wall behind
    const k = rc.keys;
    const kg = new THREE.PlaneGeometry(k.x1 - k.x0, k.y1 - k.y0);
    const keys = new THREE.Mesh(kg, keysMat);
    keys.position.set((k.x0 + k.x1) / 2, (k.y0 + k.y1) / 2, wallZ + 0.035);
    keys.name = 'key-board';
    group.add(keys);
    disposables.push(kg);
    S.box(k.x1 - k.x0 + 0.14, k.y1 - k.y0 + 0.14, 0.05, (k.x0 + k.x1) / 2, (k.y0 + k.y1) / 2, wallZ + 0.01, C.walnutDark);
    // clock above
    const ck = rc.clock;
    S.add(new THREE.CylinderGeometry(ck.r + 0.07, ck.r + 0.07, 0.06, 32), C.brass, ck.x, ck.y, wallZ + 0.04, Math.PI / 2, 0, 0);
    G.add(new THREE.CylinderGeometry(ck.r, ck.r, 0.02, 32), '#d9c6a0', ck.x, ck.y, wallZ + 0.08, Math.PI / 2, 0, 0);
    for (let i = 0; i < 12; i++) {
      const a = i / 12 * Math.PI * 2;
      S.box(0.03, i % 3 ? 0.05 : 0.1, 0.01, ck.x + Math.sin(a) * (ck.r - 0.08), ck.y + Math.cos(a) * (ck.r - 0.08), wallZ + 0.095, '#2a1a10', 0);
    }
    S.add(unitBox, '#1a100a', ck.x + 0.09, ck.y + 0.06, wallZ + 0.1, 0, 0, -1.0, 0.025, 0.24, 0.01);
    S.add(unitBox, '#1a100a', ck.x - 0.12, ck.y + 0.12, wallZ + 0.105, 0, 0, 0.75, 0.02, 0.36, 0.01);
    // sunburst behind the clock
    for (let i = 0; i < 12; i++) {
      const a = (i / 11 - 0.5) * Math.PI * 0.9;
      S.add(unitBox, C.brassDark, ck.x + Math.sin(a) * (ck.r + 0.32), ck.y + Math.cos(a) * (ck.r + 0.32), wallZ + 0.02, 0, 0, -a, 0.035, 0.42, 0.02);
    }
    glows.add({ type: 'wall', pos: [ck.x, ck.y - 0.2, wallZ + 0.12], normal: [0, 0, 1], size: [2.4, 2.0], color: '#ff9a40', intensity: 0.18 });
  }

  // --- stairs rising to the left along the back wall: marble treads, red runner, brass rail ---
  {
    const st = L.stairs, zc = (st.z0 + st.z1) / 2, sd = st.z1 - st.z0;
    for (let i = 0; i < st.steps; i++) {
      const x1 = st.x - i * st.tread, x0 = x1 - st.tread, top = (i + 1) * st.rise;
      S.block(st.tread, top, sd, (x0 + x1) / 2, 0, zc, i % 2 ? '#cdbb98' : '#c6b390');
      S.block(st.tread + 0.002, 0.012, sd * 0.55, (x0 + x1) / 2, top, zc - 0.05, C.velvet);
      S.box(0.012, st.rise, sd * 0.55, x1 + 0.001, top - st.rise / 2, zc - 0.05, C.velvetDark);
      if (i % 2 === 0) S.add(new THREE.CylinderGeometry(0.022, 0.022, 0.9, 6), C.brass, (x0 + x1) / 2, top + 0.45, st.z1 - 0.08);
    }
    // stringer and handrail along the slope
    const run = st.steps * st.tread, rise = st.steps * st.rise, ang = Math.atan2(rise, run), len = Math.hypot(run, rise);
    const mx = st.x - run / 2, my = rise / 2;
    S.add(unitBox, C.walnutDark, mx, my - 0.05, st.z1 + 0.04, 0, 0, -ang, len, 0.3, 0.08);
    S.add(unitBox, C.brass, mx, my + 0.92, st.z1 - 0.08, 0, 0, -ang, len, 0.05, 0.07);
    // newel post at the foot, with a lamp
    S.block(0.2, 1.05, 0.2, st.x + 0.1, 0, st.z1 - 0.08, C.walnutDark);
    S.block(0.24, 0.06, 0.24, st.x + 0.1, 1.05, st.z1 - 0.08, C.brass);
    G.add(new THREE.SphereGeometry(0.11, 12, 8), '#ffe4b8', st.x + 0.1, 1.24, st.z1 - 0.08);
    glows.add({ type: 'bill', pos: [st.x + 0.1, 1.24, st.z1], size: [0.9, 0.9], color: '#ffc070', intensity: 0.8 });
    glows.add({ type: 'floor', pos: [st.x + 0.4, 0.02, st.z1 + 0.4], size: [2.2, 2.2], color: '#ff9e50', intensity: 0.25 });
    // the landing up top
    S.block(2.6, 0.2, sd + 0.4, st.x - run - 1.3, rise - 0.2, zc + 0.2, C.walnutDark);
  }

  // --- tall night windows with heavy curtains on the right wall ---
  const winG = new THREE.PlaneGeometry(1.35, 3.3);
  disposables.push(winG);
  for (const w of L.windows) {
    const wm = new THREE.Mesh(winG, winMat);
    wm.position.set(xR - 0.04, 0.75 + 1.65, w.z);
    wm.rotation.y = -Math.PI / 2;
    wm.name = 'window';
    group.add(wm);
    S.block(0.12, 0.12, 1.55, xR - 0.06, 0.63, w.z, C.walnutDark);
    S.block(0.1, 0.1, 1.55, xR - 0.05, 4.05, w.z, C.walnutDark);
    // curtains: pleated velvet on both sides + pelmet
    for (const side of [-1, 1]) {
      for (let k = 0; k < 4; k++) {
        const zz = w.z + side * (0.72 + k * 0.1);
        S.block(0.14 + (k % 2) * 0.05, 4.55, 0.11, xR - 0.12, 0, zz, k % 2 ? C.curtain : '#43090f');
      }
    }
    S.block(0.24, 0.42, 2.5, xR - 0.12, 4.3, w.z, C.curtain);
    S.block(0.26, 0.05, 2.52, xR - 0.13, 4.3, w.z, C.brass);
    // cold moonlight on the floor
    glows.add({ type: 'floor', pos: [xR - 2.0, 0.02, w.z], size: [2.8, 1.5], color: '#4d6fb0', intensity: 0.45, yaw: 0 });
  }

  // --- cold moonlight falling in through the windows: soft slanted shafts (additive) ---
  const shafts = new Glows(TX.shaftTexture());
  for (const w of L.windows) {
    shafts.add({ type: 'wall', pos: [xR - 1.25, 1.45, w.z], normal: [0, 0, 1], size: [1.9, 3.9], color: '#6b8ccc', intensity: 0.55, roll: -0.7 });
  }

  // --- painting (dark landscape in a gilt frame) ---
  {
    const p = L.painting;
    S.box(p.w + 0.16, p.h + 0.16, 0.06, p.x, p.y, wallZ + 0.03, C.brass);
    S.box(p.w, p.h, 0.02, p.x, p.y, wallZ + 0.065, '#2a3226');
    S.box(p.w, p.h * 0.35, 0.021, p.x, p.y - p.h * 0.32, wallZ + 0.066, '#3d4a35');
    S.box(p.w * 0.5, p.h * 0.25, 0.022, p.x + p.w * 0.12, p.y + p.h * 0.05, wallZ + 0.067, '#52583f');
    glows.add({ type: 'wall', pos: [p.x, p.y + 0.4, wallZ + 0.1], normal: [0, 0, 1], size: [2.6, 2.0], color: '#ff9a40', intensity: 0.2 });
  }

  // --- columns (black marble shafts with brass bands) ---
  for (const c of L.columns) {
    S.add(new THREE.CylinderGeometry(0.36, 0.36, H - 0.6, 20), '#241a17', c.x, (H - 0.6) / 2 + 0.3, c.z);
    S.block(0.95, 0.3, 0.95, c.x, 0, c.z, C.ebony);
    S.block(1.0, 0.04, 1.0, c.x, 0.3, c.z, C.brass);
    S.add(new THREE.CylinderGeometry(0.5, 0.38, 0.3, 20), C.brass, c.x, H - 0.45, c.z);
    for (const y of [1.2, 2.6]) S.add(new THREE.CylinderGeometry(0.375, 0.375, 0.05, 20), C.brass, c.x, y, c.z);
    S.block(0.95, 0.15, 0.95, c.x, H - 0.3, c.z, C.walnutDark);
  }

  // --- seating: velvet sofas and armchairs (proportioned for the guests) ---
  const seatPoints = {};
  const sh = L.seatHeight;
  for (const so of L.sofas) {
    const n = so.seats, sw = so.kind === 'sofa' ? 0.62 : 0.6;
    const width = n * sw + 0.4;
    const velvet = so.color || C.velvet;
    const dark = so.color ? new THREE.Color(so.color).multiplyScalar(0.7).getStyle() : C.velvetDark;
    S.push(so.x, 0, so.z, so.heading);
    // base, seat cushion(s), back, arms (local: facing +Z; pelvis line z = 0)
    S.block(width - 0.06, 0.07, 0.6, 0, 0.0, -0.12, C.ebony);
    for (const lxx of [-(width / 2 - 0.08), width / 2 - 0.08]) for (const lzz of [0.12, -0.36]) S.block(0.05, 0.05, 0.05, lxx, 0, lzz, C.brass);
    // (shallow seats: the guests' stylised thighs are short, and their knees must clear the edge)
    S.block(width - 0.06, 0.08, 0.5, 0, 0.05, -0.15, dark);
    for (let i = 0; i < n; i++) {
      const cx = (i - (n - 1) / 2) * sw;
      S.add(new RoundedBoxGeometry(sw - 0.03, sh - 0.1, 0.36, 2, 0.05), velvet, cx, 0.1 + (sh - 0.1) / 2, -0.06);
      S.add(new RoundedBoxGeometry(sw - 0.05, 0.62, 0.15, 2, 0.06), velvet, cx, sh + 0.3, -0.27, -0.12, 0, 0);
      seatPoints[`${so.id}:${i}`] = { local: [cx, 0] };
    }
    S.add(new RoundedBoxGeometry(width, 0.9, 0.2, 2, 0.06), dark, 0, 0.48, -0.4, -0.08, 0, 0);
    S.block(width - 0.1, 0.03, 0.2, 0, 0.92, -0.44, C.brassDark);
    for (const sx of [-1, 1]) {
      S.add(new RoundedBoxGeometry(0.2, 0.46, 0.56, 2, 0.06), velvet, sx * (width / 2 - 0.1), 0.25, -0.12);
      S.add(new RoundedBoxGeometry(0.16, 0.42, 0.28, 2, 0.05), dark, sx * (width / 2 - 0.09), 0.68, -0.3);
      S.block(0.2, 0.025, 0.5, sx * (width / 2 - 0.1), 0.48, -0.1, C.brassDark);
    }
    S.pop();
    for (let i = 0; i < n; i++) {
      const sp = seatPoints[`${so.id}:${i}`];
      const h = so.heading * D2R;
      const lx2 = sp.local[0], lz2 = sp.local[1];
      sp.x = so.x + lx2 * Math.cos(h) + lz2 * Math.sin(h);
      sp.z = so.z - lx2 * Math.sin(h) + lz2 * Math.cos(h);
      sp.y = sh; sp.heading = h;
    }
  }

  // --- tables ---
  for (const t of L.tables) {
    S.add(new THREE.CylinderGeometry(t.r, t.r, 0.04, 24), C.walnut, t.x, t.h - 0.02, t.z);
    S.add(new THREE.CylinderGeometry(t.r + 0.01, t.r + 0.01, 0.015, 24), C.brass, t.x, t.h - 0.045, t.z);
    S.add(new THREE.CylinderGeometry(0.05, 0.07, t.h - 0.06, 8), C.brassDark, t.x, (t.h - 0.06) / 2 + 0.02, t.z);
    S.add(new THREE.CylinderGeometry(t.r * 0.55, t.r * 0.6, 0.03, 16), C.ebony, t.x, 0.015, t.z);
    if (t.tea) {
      S.add(new THREE.CylinderGeometry(0.2, 0.2, 0.012, 16), C.brass, t.x + 0.05, t.h + 0.006, t.z);
      S.add(new THREE.SphereGeometry(0.075, 12, 8), '#efe6d2', t.x + 0.08, t.h + 0.08, t.z - 0.03);
      for (const [dx, dz] of [[-0.12, 0.08], [0.15, 0.12]]) S.add(new THREE.CylinderGeometry(0.035, 0.028, 0.05, 10), '#efe6d2', t.x + dx, t.h + 0.035, t.z + dz);
    } else {
      // a table lamp
      S.add(new THREE.CylinderGeometry(0.05, 0.07, 0.3, 10), C.brass, t.x, t.h + 0.15, t.z);
      G.add(new THREE.CylinderGeometry(0.09, 0.15, 0.17, 14, 1, true), C.glow, t.x, t.h + 0.38, t.z);
      glows.add({ type: 'bill', pos: [t.x, t.h + 0.36, t.z], size: [0.8, 0.8], color: '#ffbe6e', intensity: 0.8 });
    }
  }

  // --- floor lamps (brass, cream shade) ---
  for (const fl of L.floorLamps) {
    S.add(new THREE.CylinderGeometry(0.16, 0.19, 0.04, 16), C.brass, fl.x, 0.02, fl.z);
    S.add(new THREE.CylinderGeometry(0.015, 0.015, 1.4, 6), C.brass, fl.x, 0.72, fl.z);
    G.add(new THREE.CylinderGeometry(0.15, 0.24, 0.3, 16, 1, true), C.glow, fl.x, 1.5, fl.z);
    G.add(new THREE.CircleGeometry(0.24, 16), '#fff2d0', fl.x, 1.351, fl.z, Math.PI / 2, 0, 0);
    glows.add({ type: 'bill', pos: [fl.x, 1.48, fl.z], size: [1.4, 1.4], color: '#ffbb66', intensity: 0.85 });
    glows.add({ type: 'floor', pos: [fl.x, 0.02, fl.z], size: [3.4, 3.4], color: '#ff9e50', intensity: 0.42 });
  }

  // --- rugs ---
  const rugG = new THREE.PlaneGeometry(1, 1); rugG.rotateX(-Math.PI / 2);
  for (const r of L.rugs) RG.add(rugG, '#ffffff', r.x, 0.01, r.z, 0, r.heading * D2R, 0, r.w, 1, r.d);
  rugG.dispose();
  // the runner leading to the lift (its pattern repeats along its length)
  if (L.runner) {
    const r = L.runner;
    const g = new THREE.PlaneGeometry(r.w, r.d); g.rotateX(-Math.PI / 2);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (r.d / r.w) / 2);
    const m = new THREE.Mesh(g, runnerMat);
    m.position.set(r.x, 0.008, r.z);
    m.rotation.y = r.heading * D2R;
    m.name = 'runner';
    group.add(m);
    disposables.push(g);
  }

  // --- potted palms ---
  const palm = (p) => {
    const s = p.s;
    S.add(new THREE.CylinderGeometry(0.3 * s, 0.24 * s, 0.55 * s, 14), C.planter, p.x, 0.275 * s, p.z);
    S.add(new THREE.CylinderGeometry(0.305 * s, 0.305 * s, 0.05 * s, 14), C.brass, p.x, 0.48 * s, p.z);
    S.add(new THREE.CylinderGeometry(0.245 * s, 0.245 * s, 0.04 * s, 14), C.brass, p.x, 0.08 * s, p.z);
    S.add(new THREE.CylinderGeometry(0.035 * s, 0.05 * s, 0.9 * s, 6), '#4a3622', p.x, 0.95 * s, p.z);
    const fr = frondGeometry(1.0, 0.36, 0.55);
    for (let i = 0; i < 11; i++) {
      const yaw = i * 2.4 + p.x, tilt = (i % 3) * 0.18;
      LV.add(fr, i % 2 ? C.leaf : C.leafDark, p.x, (1.28 + (i % 3) * 0.12) * s, p.z, 0, yaw, 0.35 - tilt, s * (0.85 + (i % 4) * 0.08), s, s);
    }
    fr.dispose();
  };
  for (const p of L.palms) palm(p);

  // --- chandeliers: tiered Art Deco glass with brass rings, a halo and a pool on the floor ---
  for (const ch of L.chandeliers) {
    S.add(new THREE.CylinderGeometry(0.018, 0.018, H - ch.y, 6), C.brass, ch.x, (H + ch.y) / 2 + 0.3, ch.z);
    S.add(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 16), C.brass, ch.x, H - 0.05, ch.z);
    const tiers = [[0.54, 0.25], [0.42, 0.23], [0.28, 0.21]];
    let y = ch.y;
    for (const [r, h] of tiers) {
      G.add(new THREE.CylinderGeometry(r, r * 0.92, h, 20, 1, true), '#ffe7bf', ch.x, y, ch.z);
      S.add(new THREE.CylinderGeometry(r + 0.02, r + 0.02, 0.04, 20), C.brass, ch.x, y + h / 2, ch.z);
      y -= h;
    }
    G.add(new THREE.ConeGeometry(0.16, 0.32, 12), '#ffe7bf', ch.x, y - 0.06, ch.z, Math.PI, 0, 0);
    S.add(new THREE.SphereGeometry(0.05, 8, 6), C.brass, ch.x, y - 0.25, ch.z);
    glows.add({ type: 'bill', pos: [ch.x, ch.y - 0.2, ch.z], size: [3.4, 3.4], color: '#ffb866', intensity: 0.55 });
    glows.add({ type: 'bill', pos: [ch.x, ch.y - 0.2, ch.z], size: [1.5, 1.5], color: '#ffd9a0', intensity: 0.6 });
    glows.add({ type: 'floor', pos: [ch.x, 0.02, ch.z], size: [5.5, 5.5], color: '#ff9e50', intensity: 0.2 });
    // a glow on the ceiling above
    glows.add({ type: 'floor', pos: [ch.x, H - 0.33, ch.z], size: [3.5, 3.5], color: '#ff9a40', intensity: 0.22 });
  }

  // --- luggage trolley by the lift (brass birdcage cart with cases) ---
  {
    const t = L.trolley;
    S.push(t.x, 0, t.z, t.heading);
    S.block(0.95, 0.05, 0.55, 0, 0.14, 0, C.brass);
    for (const [wx, wz] of [[-0.4, -0.22], [0.4, -0.22], [-0.4, 0.22], [0.4, 0.22]]) S.add(new THREE.CylinderGeometry(0.07, 0.07, 0.04, 10), C.ebony, wx, 0.07, wz, Math.PI / 2, 0, 0);
    for (const sx of [-0.45, 0.45]) {
      S.add(new THREE.CylinderGeometry(0.02, 0.02, 1.45, 6), C.brass, sx, 0.88, -0.2);
      S.add(new THREE.CylinderGeometry(0.02, 0.02, 1.45, 6), C.brass, sx, 0.88, 0.2);
    }
    S.add(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), C.brass, 0, 1.6, -0.2, 0, 0, Math.PI / 2);
    S.add(new THREE.CylinderGeometry(0.02, 0.02, 0.9, 6), C.brass, 0, 1.6, 0.2, 0, 0, Math.PI / 2);
    S.block(0.75, 0.24, 0.46, -0.02, 0.17, 0, '#6b4a2b');
    S.block(0.6, 0.2, 0.4, 0.04, 0.41, 0.0, '#2f4a3c');
    S.block(0.42, 0.28, 0.24, -0.1, 0.61, 0.02, '#8a5a32');
    S.block(0.3, 0.2, 0.3, 0.18, 0.61, -0.02, '#5a1a1e');
    S.pop();
  }

  // --- warm reflections in the polished floor under the brightest lamps ---
  // (soft vertical streaks toward the camera: a cheap stand-in for a glossy floor)
  const reflect = (x, z, len, intensity, color = '#ffb46a') =>
    glows.add({ type: 'floor', pos: [x, 0.018, z + len * 0.35], size: [0.5, len], color, intensity });
  reflect(L.lift.x, zB + 0.2, 1.8, 0.0, '#ffd9a0');   // the lift's (lit only while open) — index kept
  const liftReflect = glows.items.length - 1;
  for (const fl of L.floorLamps) reflect(fl.x, fl.z + 0.3, 1.6, 0.28);
  for (const [x] of L.sconces) reflect(x, zB + 0.3, 1.2, 0.12);

  // assemble
  const solid = S.mesh(lam, 'lobby-solid');
  const leaves = LV.mesh(lamDouble, 'lobby-leaves');
  const glowing = G.mesh(glowMat, 'lobby-glow');
  const walls = W.mesh(wallMat, 'lobby-walls');
  const rugs = RG.mesh(rugMat, 'lobby-rugs');
  for (const m of [solid, leaves, glowing, walls, rugs]) if (m) { group.add(m); disposables.push(m.geometry); }
  const glowMesh = glows.build();
  const washMesh = washes.build();
  const shaftMesh = shafts.build();
  group.add(glowMesh, washMesh, shaftMesh);
  disposables.push(glowMesh.geometry, washMesh.geometry, shaftMesh.geometry, glows.mat, washes.mat, shafts.mat);

  // dust motes drifting slowly in the warm light (one draw call; they show when the view is sharp)
  let motes = null;
  if (L.motes) {
    const seeds = [];
    for (const [[x0, x1, y0, y1, z0, z1], n] of L.motes) {
      for (let i = 0; i < n; i++) seeds.push([x0 + Math.random() * (x1 - x0), y0 + Math.random() * (y1 - y0), z0 + Math.random() * (z1 - z0), Math.random() * 100]);
    }
    const pos = new Float32Array(seeds.length * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ map: TX.glowTexture(), size: 0.035, color: new THREE.Color('#ffd49a').multiplyScalar(0.8), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.renderOrder = 6;
    pts.name = 'motes';
    group.add(pts);
    disposables.push(g, m);
    motes = { seeds, pos, g };
  }

  // real lights
  const lights = {};
  for (const l of L.lights) {
    const pl = new THREE.PointLight(l.color, l.intensity, l.distance, l.decay);
    pl.position.set(...l.pos);
    pl.userData = { base: l.intensity, open: l.open || 0 };
    group.add(pl);
    lights[l.id] = pl;
  }
  const hemi = new THREE.HemisphereLight(L.hemisphere.sky, L.hemisphere.ground, L.hemisphere.intensity);
  group.add(hemi);

  // --- the moving parts of the lift ---
  const doorClosedX = [lift.x - lift.width / 4, lift.x + lift.width / 4];
  const slide = lift.width / 2 + 0.02;
  const liftParts = {
    // 0 = shut, 1 = fully open
    setOpen(k) {
      doorL.position.x = doorClosedX[0] - slide * k;
      doorR.position.x = doorClosedX[1] + slide * k;
      const lit = Math.min(1, k * 1.6);
      lights.lift.intensity = lights.lift.userData.open * lit;
      spillMat.color.setRGB(1, 0.85, 0.62).multiplyScalar(0.55 * lit);
      glows.set(liftReflect, 0.35 * lit);
      washes.set(seamGlow, 0.8 * (1 - Math.min(1, k * 8)));
    },
    // the needle: 0 = L … floors
    setFloor(f) { needle.rotation.z = Math.PI / 2 - (f / lift.floors) * Math.PI; },
    setDing(v) { glows.set(dingGlow, 0.15 + 0.85 * v); glows.set(callGlow, 0.6 + 0.6 * v); },
  };
  liftParts.setOpen(0);
  liftParts.setFloor(0);

  return {
    group,
    seats: seatPoints,
    lights,
    hemi,
    lift: liftParts,
    // per frame: billboards face the camera, lamps breathe a little
    update(time, camera) {
      glows.faceCamera(camera.quaternion);
      // the sconce by the dark archway falters now and then (a faint unease in a warm room)
      const ph = time % 11.3;
      const fl = ph > 9.6 && ph < 10.5 ? 0.35 + 0.65 * (Math.sin(ph * 61) > 0.1 ? 1 : 0.2) : 1;
      glows.set(flickerGlow, 0.9 * fl);
      washes.set(flickerWash, 0.42 * fl);
      const f = 1 + Math.sin(time * 1.7) * 0.015 + Math.sin(time * 4.3) * 0.01;
      lights.chandA.intensity = lights.chandA.userData.base * f;
      if (motes) {
        const { seeds, pos, g } = motes;
        for (let i = 0; i < seeds.length; i++) {
          const [x, y, z, ph] = seeds[i];
          const t = time * 0.12 + ph;
          pos[i * 3] = x + Math.sin(t * 0.9) * 0.25 + Math.sin(t * 2.3) * 0.05;
          pos[i * 3 + 1] = y + Math.sin(t * 0.6 + ph) * 0.3;
          pos[i * 3 + 2] = z + Math.cos(t * 0.7) * 0.25;
        }
        g.attributes.position.needsUpdate = true;
      }
      lights.chandB.intensity = lights.chandB.userData.base * (2 - f);
    },
    dispose() {
      group.parent?.remove(group);
      for (const d of disposables) d.dispose?.();
    },
  };
}
