// The people in the main-menu lobby: the six guests (in their game outfits), re-dressed staff
// (manager, concierge) and a couple of background extras. One `Actor` per person.
//
// Cheap on purpose (iPad): each guest model ships as ~10-15 primitives (one per colour). They are
// merged ONCE per model into a single skinned mesh whose colours live in a vertex-colour attribute,
// so every person on screen is ONE draw call, and re-dressing a person (staff uniforms, extras) is
// just a different colour attribute on the same shared geometry.
//
// Animation: the GLB's 'Idle' and 'Walk' clips (the walk is in place: its phase is driven by the
// distance walked / the stride length carried in the GLB extras, so feet never slide — the same
// approach as src/render/characterView.js). There is no sit clip: sitting is posed at runtime on top
// of the Idle clip (pelvis lowered and pushed back, legs solved by a two-bone IK so the feet stay
// planted on the floor, forearms resting on the lap), blended in and out over ~0.6 s.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const loader = new GLTFLoader();
const templates = new Map();   // model id -> Promise<template>

// The same faint warm rim + fill the game's guests get (src/render/characterView.js, guestLight), so
// dark suits still read as silhouettes against a dark room. Part of the guests' own shader: no light.
const RIM = { color: new THREE.Color('#ffd9a8'), rim: 0.55, fill: 0.08 };
function guestLight(m) {
  m.onBeforeCompile = shader => {
    shader.uniforms.uRimColor = { value: RIM.color };
    shader.uniforms.uRim = { value: new THREE.Vector2(RIM.rim, RIM.fill) };
    shader.fragmentShader = 'uniform vec3 uRimColor;\nuniform vec2 uRim;\n' + shader.fragmentShader.replace('#include <opaque_fragment>', `
      float rimK = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.4);
      outgoingLight += uRimColor * rimK * uRim.x * (0.35 + 0.65 * diffuseColor.rgb) + diffuseColor.rgb * uRim.y;
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'menuGuestLight1';
  return m;
}
let sharedMaterial = null;
function castMaterial() {
  if (!sharedMaterial) sharedMaterial = guestLight(new THREE.MeshLambertMaterial({ vertexColors: true }));
  return sharedMaterial;
}

// Load a guest model once and merge its primitives into one skinned mesh with vertex colours.
// The template remembers which vertex ranges belong to which original material ('Jacket', 'Hair'…)
// so a copy can be re-dressed by name.
function loadTemplate(id) {
  if (templates.has(id)) return templates.get(id);
  const p = loader.loadAsync(`assets/characters/${id}.glb`).then(gltf => {
    const root = gltf.scene;
    let strideLength = 1.1;
    const parts = [];
    root.traverse(o => {
      if (o.userData && typeof o.userData.strideLength === 'number') strideLength = o.userData.strideLength;
      if (o.isSkinnedMesh) parts.push(o);
    });
    if (!parts.length) throw new Error(`no skinned mesh in ${id}`);
    const geos = [], ranges = {};
    let offset = 0;
    for (const m of parts) {
      const g = m.geometry, n = g.attributes.position.count;
      const base = m.material.color || new THREE.Color(1, 1, 1);
      const src = g.attributes.color;
      const col = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const r = src ? src.getX(i) : 1, gg = src ? src.getY(i) : 1, b = src ? src.getZ(i) : 1;
        col[i * 3] = base.r * r; col[i * 3 + 1] = base.g * gg; col[i * 3 + 2] = base.b * b;
      }
      const ng = new THREE.BufferGeometry();
      for (const a of ['position', 'normal', 'skinIndex', 'skinWeight']) ng.setAttribute(a, g.attributes[a]);
      ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
      if (g.index) ng.setIndex(g.index);
      geos.push(ng);
      const name = m.material.name || 'part';
      (ranges[name] ||= []).push([offset, n]);
      offset += n;
    }
    const merged = mergeGeometries(geos, false);
    const carrier = parts[0];
    carrier.geometry = merged;
    carrier.material = castMaterial();
    carrier.frustumCulled = false;   // skinned: the bind-pose bounds are wrong once posed
    for (const m of parts.slice(1)) m.parent.remove(m);
    const idle = gltf.animations.find(a => /idle/i.test(a.name)) || gltf.animations[0];
    const walk = gltf.animations.find(a => /walk/i.test(a.name)) || gltf.animations[1];
    return { id, root, strideLength, ranges, baseColor: merged.attributes.color.array.slice(), idle, walk };
  });
  templates.set(id, p);
  return p;
}

// Re-dress: a new geometry that shares every attribute with the template except the colours.
// `dress` maps original material names to a colour (hex string) or { color, mul } (mul: scale the
// original shading instead of replacing the hue, e.g. greying hair).
function dressedGeometry(tpl, mesh, dress) {
  if (!dress) return mesh.geometry;
  const src = mesh.geometry;
  const g = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(src.attributes)) if (k !== 'color') g.setAttribute(k, a);
  g.setIndex(src.index);
  g.groups = src.groups;
  const col = tpl.baseColor.slice();
  const c = new THREE.Color();
  for (const [name, spec] of Object.entries(dress)) {
    const ranges = tpl.ranges[name];
    if (!ranges) continue;
    c.set(typeof spec === 'string' ? spec : spec.color);
    for (const [start, n] of ranges) {
      // keep the model's baked shading: scale the new colour by the original brightness relative to
      // the material's flat colour (approximated by the range's brightest vertex)
      let maxL = 1e-6;
      for (let i = start; i < start + n; i++) maxL = Math.max(maxL, col[i * 3] + col[i * 3 + 1] + col[i * 3 + 2]);
      for (let i = start; i < start + n; i++) {
        const k = (col[i * 3] + col[i * 3 + 1] + col[i * 3 + 2]) / maxL;
        col[i * 3] = c.r * k; col[i * 3 + 1] = c.g * k; col[i * 3 + 2] = c.b * k;
      }
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

// Free the shared, merged guest geometry (a later lobby simply loads the models again).
export function disposeCast() {
  for (const p of templates.values()) p.then(t => t && t.root.traverse(o => { if (o.isSkinnedMesh) o.geometry.dispose(); })).catch(() => {});
  templates.clear();
}

export function preloadCast(ids) {
  return Promise.all(ids.map(id => loadTemplate(id).catch(e => { console.warn('lobby: could not load guest', id, e && e.message); return null; })));
}

// ---- small maths helpers --------------------------------------------------------------------
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const qAxis = (axis, ang, out = new THREE.Quaternion()) => out.setFromAxisAngle(axis, ang);
const smooth = t => t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t);
const wrapAngle = a => Math.atan2(Math.sin(a), Math.cos(a));

// Rotate a bone by `ang` about `axis` given in the actor's BODY frame (x = its left, y = up,
// z = facing), whatever the bone's parent chain is doing.
function rotateInBody(bone, bodyQ, axis, ang) {
  if (Math.abs(ang) < 1e-5) return;
  bone.parent.getWorldQuaternion(_q);                       // parent world
  _q2.copy(bodyQ).multiply(qAxis(axis, ang, _q3)).multiply(_q3.copy(bodyQ).invert()); // body-axis rotation in world
  // local' = parent^-1 * R * parent * local
  _q3.copy(_q).invert().multiply(_q2).multiply(_q);
  bone.quaternion.premultiply(_q3);
}

// ---- Actor ------------------------------------------------------------------------------------
// One person. Owns its mixer, its position/heading on the floor, and three blendable "layers":
// walking (weight from movement), sitting (0..1, posed over the clip) and small gestures (head turn,
// talking hands).
export class Actor {
  constructor(tpl, spec, parent) {
    this.spec = spec;
    this.name = spec.name;
    this.tpl = tpl;
    this.group = new THREE.Group();
    this.group.name = `menu-actor:${spec.name}`;
    const root = SkeletonUtils.clone(tpl.root);
    this.model = root;
    let mesh = null;
    root.traverse(o => { if (o.isSkinnedMesh) mesh = o; });
    mesh.geometry = dressedGeometry(tpl, mesh, spec.dress);
    mesh.material = castMaterial();
    mesh.frustumCulled = false;
    this.mesh = mesh;
    if (spec.scale) root.scale.setScalar(spec.scale);
    this.group.add(root);
    parent.add(this.group);

    this.bones = {};
    // (GLTFLoader strips '.' from node names: 'thigh.L' arrives as 'thighL'; accept either)
    root.traverse(o => { if (o.isBone) { this.bones[o.name] = o; this.bones[o.name.replace(/(L|R)$/, '.$1')] = o; } });
    const b = this.bones;
    // rest measurements (metres, model space; the rig is upright with zero rotations on the trunk)
    this.rest = {
      hipsY: b.hips.position.y,
      hipsZ: b.hips.position.z,
      thighOff: b['thigh.L'].position.clone(),
      L1: b['shin.L'].position.length(),
      L2: b['foot.L'].position.length(),
      footAng: 2 * Math.atan2(b['foot.L'].quaternion.x, b['foot.L'].quaternion.w),   // signed about X
    };
    this.rest.ankleY = this.rest.hipsY - this.rest.L1 - this.rest.L2;

    this.mixer = new THREE.AnimationMixer(root);
    this.idle = this.mixer.clipAction(tpl.idle);
    this.walk = this.mixer.clipAction(tpl.walk);
    this.idle.play(); this.walk.play();
    this.walk.timeScale = 0;
    this.walk.setEffectiveWeight(0);
    this.idle.time = (spec.phase ?? Math.random()) * tpl.idle.duration;
    this.idle.timeScale = spec.idleSpeed ?? (0.85 + Math.random() * 0.3);
    this.walkDuration = tpl.walk.duration;
    this.stride = tpl.strideLength * (spec.scale || 1);

    // locomotion state
    this.x = 0; this.z = 0; this.heading = 0;
    this.walkW = 0; this.moving = false;
    this.path = null; this.speed = spec.speed || 1.15;
    this.turnTo = null;          // heading to turn to while standing
    // sitting state
    this.seat = null;            // { x, z, y (seat surface), heading, depth }
    this.sitW = 0; this.sitTarget = 0; this.sitSpeed = 1 / 0.55;
    // gestures
    this.headYaw = 0; this.headYawTarget = 0;
    this.headPitch = 0;
    this.talk = spec.talk || 0;  // 0..1: hands gesture while standing talking
    this.time = Math.random() * 10;
    this.bodyQ = new THREE.Quaternion();
  }

  place(x, z, heading) {
    this.x = x; this.z = z; this.heading = heading;
    this.path = null; this.moving = false;
  }

  // Seat at a seat point (pelvis position on the cushion) facing `heading`; `y` is the cushion top.
  sitAt(seat, instant = true) {
    this.seat = seat;
    const S = this.sitGeometry(seat);
    this.x = S.footX; this.z = S.footZ; this.heading = seat.heading;
    this.sitTarget = 1;
    if (instant) this.sitW = 1;
    this.path = null;
  }

  // Where the feet stand for a seat: in front of the pelvis by F (depends on this body's legs).
  sitGeometry(seat) {
    const r = this.rest, s = this.spec.scale || 1;
    const hipY = (seat.y + (seat.flesh ?? 0.065)) / s;                    // pelvis bone height on the cushion
    const kneeLift = this.spec.feetForward ?? seat.feetForward ?? 0.18;  // how far the shins lean forward (rad)
    const kneeY = r.ankleY + r.L2 * Math.cos(kneeLift);
    const ca = THREE.MathUtils.clamp((hipY - kneeY) / r.L1, -0.35, 1);
    const a = Math.acos(ca);
    const F = (r.L1 * Math.sin(a) + r.L2 * Math.sin(kneeLift)) * s;
    return { hipY, F, footX: seat.x + Math.sin(seat.heading) * F, footZ: seat.z + Math.cos(seat.heading) * F };
  }

  standUp() { this.sitTarget = 0; }
  standTime() { return this.sitW / this.sitSpeed; }
  sitDown() { this.sitTarget = 1; }

  // Walk along world points [[x,z],…]; `onArrive` when done; `face` = heading to turn to on arrival.
  walkPath(points, { speed, face, onArrive } = {}) {
    this.path = points.map(p => ({ x: p[0], z: p[1] }));
    if (speed) this.speed = speed;
    this.arriveFace = face;
    this.onArrive = onArrive || null;
  }

  update(dt) {
    this.time += dt;
    // --- sitting blend (only stands up / sits when not walking) ---
    const sitStep = this.sitSpeed * dt;
    if (this.sitW < this.sitTarget) this.sitW = Math.min(this.sitTarget, this.sitW + sitStep);
    else if (this.sitW > this.sitTarget) this.sitW = Math.max(this.sitTarget, this.sitW - sitStep);

    // --- locomotion ---
    let dist = 0;
    // rising from a seat with somewhere to go: start turning toward it in the last part of the rise
    if (this.path && this.path.length && this.sitW > 0.001 && this.sitW < 0.4 && this.sitTarget === 0) {
      const tgt = this.path[0];
      const dh = wrapAngle(Math.atan2(tgt.x - this.x, tgt.z - this.z) - this.heading);
      this.heading += dh * Math.min(1, dt * 3);
    }
    if (this.path && this.path.length && this.sitW <= 0.001) {
      const tgt = this.path[0];
      const dx = tgt.x - this.x, dz = tgt.z - this.z;
      const d = Math.hypot(dx, dz);
      // ease in from standstill and slow down for the final waypoint
      const last = this.path.length === 1;
      const want = this.speed * (last ? Math.min(1, 0.35 + d / 0.9) : 1);
      this.curSpeed = (this.curSpeed || 0) + (want - (this.curSpeed || 0)) * Math.min(1, dt * 4);
      const step = Math.min(d, this.curSpeed * dt);
      if (d > 1e-4) {
        const h = Math.atan2(dx, dz);
        const dh = wrapAngle(h - this.heading);
        this.heading += dh * Math.min(1, dt * 7);
        // walk forward, a little less when facing away from the target (turning on the spot)
        const k = Math.max(0.3, Math.cos(dh));
        this.x += Math.sin(this.heading) * step * k;
        this.z += Math.cos(this.heading) * step * k;
        dist = step * k;
      }
      if (d < 0.06) {
        this.path.shift();
        if (!this.path.length) {
          this.path = null; this.curSpeed = 0;
          if (this.arriveFace != null) this.turnTo = this.arriveFace;
          const cb = this.onArrive; this.onArrive = null;
          if (cb) cb(this);
        }
      }
      this.moving = true;
    } else this.moving = false;

    // turning on the spot (with a few small steps so it does not look like a statue on a turntable)
    let turnSteps = 0;
    if (!this.moving && this.turnTo != null) {
      const dh = wrapAngle(this.turnTo - this.heading);
      const rate = 3.2;
      const st = Math.sign(dh) * Math.min(Math.abs(dh), rate * dt);
      this.heading += st;
      turnSteps = Math.abs(st) * 0.32;
      if (Math.abs(dh) < 0.01) this.turnTo = null;
    }

    // walk weight + phase from distance
    const targetW = this.moving ? 1 : (this.turnTo != null ? 0.45 : 0);
    this.walkW += (targetW - this.walkW) * Math.min(1, dt * 8);
    const phaseDist = dist + turnSteps;
    if (phaseDist > 0) this.walk.time = (this.walk.time + (phaseDist / this.stride) * this.walkDuration) % this.walkDuration;
    this.walk.setEffectiveWeight(this.walkW);
    this.idle.setEffectiveWeight(1 - this.walkW);
    this.mixer.update(dt);

    // group transform
    this.group.position.set(this.x, this.spec.y || 0, this.z);
    this.group.rotation.y = this.heading;
    this.group.updateMatrixWorld(true);
    this.group.getWorldQuaternion(this.bodyQ);

    if (this.sitW > 0) this.applySit(smooth(this.sitW));
    this.applyGestures(dt);
  }

  // Pose the sitting layer over whatever the clip did, with weight w (0..1).
  applySit(w) {
    const b = this.bones, r = this.rest;
    const seat = this.seat;
    if (!seat) return;
    const S = this.sitGeometry(seat);
    const s = this.spec.scale || 1;
    // pelvis: lowered to the cushion and pushed back over it (the feet stay where they are)
    const clipY = b.hips.position.y;
    const hipY = THREE.MathUtils.lerp(clipY, S.hipY, w);
    const hipZ = THREE.MathUtils.lerp(b.hips.position.z, r.hipsZ - S.F / s, w);
    b.hips.position.y = hipY;
    b.hips.position.z = hipZ;
    // keep the pelvis level while seated (the idle sway is for standing)
    b.hips.quaternion.slerp(_q.identity(), w);
    // rising: lean the trunk forward in the middle of the movement (weight over the feet)
    const lean = Math.sin(Math.PI * w) * 0.45 * (1 - w * 0.4);
    const back = (this.spec.recline ?? 0.12) * w;     // settled back into the cushion
    rotateInBody(b.spine, this.bodyQ, X, lean - back);
    // legs: two-bone IK from the hip joint to the planted ankle, in the side plane
    const splay = (this.spec.splay ?? 0.1) * w;
    for (const side of ['L', 'R']) {
      const thigh = b[`thigh.${side}`], shin = b[`shin.${side}`], foot = b[`foot.${side}`];
      const sgn = side === 'L' ? 1 : -1;
      // hip joint and ankle target in the root frame (y up, z forward); ankle stays at standing spot
      const hy = hipY + r.thighOff.y, hz = hipZ + r.thighOff.z;
      const ay = r.ankleY, az = r.hipsZ + r.thighOff.z + 0.02 * w;
      const dy = ay - hy, dz = az - hz;
      let d = Math.hypot(dy, dz);
      const L1 = r.L1, L2 = r.L2;
      d = Math.min(d, (L1 + L2) * 0.9999);
      const theta = Math.atan2(dz, -dy);                          // hip->ankle, from straight down
      const cosA = THREE.MathUtils.clamp((L1 * L1 + d * d - L2 * L2) / (2 * L1 * d), -1, 1);
      const a = theta + Math.acos(cosA);                          // thigh angle (knee forward)
      const ky = hy - L1 * Math.cos(a), kz = hz + L1 * Math.sin(a);
      const bAng = Math.atan2(az - kz, -(ay - ky));               // shin angle from straight down
      // local rotations (thigh rest = 180° about X, hanging down)
      qAxis(X, Math.PI - a, _q2);
      if (splay) _q2.premultiply(qAxis(Y, sgn * splay, _q3));
      thigh.quaternion.slerp(_q2, Math.min(1, w * 3));
      qAxis(X, a - bAng, _q2);
      shin.quaternion.slerp(_q2, Math.min(1, w * 3));
      qAxis(X, bAng + r.footAng, _q2);
      foot.quaternion.slerp(_q2, Math.min(1, w * 3));
    }
    // arms: forearms forward onto the lap
    const armW = w * (this.spec.lapHands ?? 1);
    if (armW > 0.001) {
      for (const side of ['L', 'R']) {
        const sgn = side === 'L' ? 1 : -1;
        rotateInBody(b[`upperarm.${side}`], this.bodyQ, X, -0.22 * armW);
        rotateInBody(b[`upperarm.${side}`], this.bodyQ, Z, sgn * -0.06 * armW);
        rotateInBody(b[`forearm.${side}`], this.bodyQ, X, -0.55 * armW);
        rotateInBody(b[`forearm.${side}`], this.bodyQ, Y, sgn * -0.3 * armW);
      }
    }
  }

  applyGestures(dt) {
    const b = this.bones;
    // head: ease toward the wanted yaw (glances), plus a slow natural drift
    this.headYaw += (this.headYawTarget - this.headYaw) * Math.min(1, dt * 2.5);
    const drift = Math.sin(this.time * 0.37 + this.idle.time) * 0.06;
    rotateInBody(b.head, this.bodyQ, Y, this.headYaw * 0.6 + drift);
    rotateInBody(b.neck, this.bodyQ, Y, this.headYaw * 0.4);
    if (this.headPitch) rotateInBody(b.head, this.bodyQ, X, this.headPitch);
    // talking: one forearm lifts and moves a little while standing
    const talk = this.talk * (1 - this.walkW) * (1 - this.sitW);
    if (talk > 0.01) {
      const t = this.time;
      const side = this.spec.talkHand || 'R';
      const k = 0.5 + 0.5 * Math.sin(t * 1.3) * Math.sin(t * 0.47 + 1);
      rotateInBody(b[`upperarm.${side}`], this.bodyQ, X, -0.25 * talk * (0.6 + 0.4 * k));
      rotateInBody(b[`forearm.${side}`], this.bodyQ, X, -(0.9 + 0.35 * k) * talk);
    }
  }

  dispose() {
    this.group.parent?.remove(this.group);
    if (this.spec.dress) this.mesh.geometry.dispose();
    this.mixer.stopAllAction();
  }
}

export async function createActor(spec, parent) {
  const tpl = await loadTemplate(spec.model);
  return new Actor(tpl, spec, parent);
}
