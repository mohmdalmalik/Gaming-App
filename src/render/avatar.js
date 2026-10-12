// A player's avatar, made at run time from one of the six guest models (the "looks", src/data/wardrobe.js)
// with no change to the .glb files:
//   loadBase(id)                      -> Promise<base>: the GLB parsed ONCE per look, whatever number of
//                                        avatars wear it (shared geometry, the Idle/Walk clips, the stride,
//                                        and the measurements the glasses are fitted from: eyes, head, ears)
//   createAvatarModel(base, avatar, { rim })
//                                     -> { root, parts, headBone, setAvatar(avatar), setPossessed(on),
//                                          eyes, dispose() }: a SkeletonUtils clone (its own bones, the
//                                        SHARED geometry) with its own matte materials painted from the
//                                        catalogue, and glasses fixed to its head bone
//   paletteFor(base, avatar)          -> { materialName: linear Color }
//   lobbyDress(base, avatar)          -> { materialName: '#rrggbb' } (the menu lobby's `dress` format)
// (GLTFLoader turns a guest's one mesh of 9-15 primitives into 9-15 SkinnedMesh siblings sharing one
// skeleton, one per material: so "a part" here is one of those meshes, found by its material's name.)
//
// Recolouring keeps the models' look: every clothing part's baked shading (COLOR_0) is neutral grey, so
// the grooves, seams and ambient occlusion carry over to any colour; seams, satin lapels and the sash
// follow the main colour, darker (wardrobe.js `derive`). Eye colours are painted by the possessed eyes'
// own shader (src/render/possessedLook.js) with other colours and no glow, so they cost no new shader;
// the possessed switch is rebuilt whenever the eye material changes, so un-possessing always gives the
// avatar's own eyes back. Nothing here knows any rule or role.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { createPossessedEyes, possessedEyeMaterial, measureEyes } from './possessedLook.js';
import { glassesMesh } from './avatarGlasses.js';
import { BASES, isBase, item } from '../data/wardrobe.js';

const loader = new GLTFLoader();
const bases = new Map();          // look id -> Promise<base>

// The faint warm rim + fill only the guests get (no scene light, no extra draw call): a navy suit still
// reads in a dark room. The game's values; the menu lobby passes its own (same shader, other numbers).
export const GAME_RIM = { color: '#ffe2b8', rim: 0.42, fill: 0.1 };
export function guestLight(m, rim = GAME_RIM) {
  const color = new THREE.Color(rim.color), k = new THREE.Vector2(rim.rim, rim.fill);
  m.onBeforeCompile = shader => {
    shader.uniforms.uRimColor = { value: color };
    shader.uniforms.uRim = { value: k };
    shader.fragmentShader = 'uniform vec3 uRimColor;\nuniform vec2 uRim;\n' + shader.fragmentShader.replace('#include <opaque_fragment>', `
      float rimK = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.4);
      outgoingLight += uRimColor * rimK * uRim.x * (0.35 + 0.65 * diffuseColor.rgb) + diffuseColor.rgb * uRim.y;
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'guestLight1';     // (the same program as src/render/characterView.js's)
  return m;
}

export function loadBase(id) {
  if (!isBase(id)) id = 'victor';
  if (bases.has(id)) return bases.get(id);
  const def = BASES[id];
  const p = loader.loadAsync(def.model).then(gltf => {
    const root = gltf.scene;
    let rig = null;
    const meshes = [];
    root.traverse(o => {
      if (o.isSkinnedMesh) meshes.push(o);
      if (o.userData && (o.userData.eyeCentre || typeof o.userData.strideLength === 'number')) rig = { ...rig, ...o.userData };
    });
    if (!meshes.length) throw new Error(`no skinned mesh in ${def.model}`);
    // Per part: its own colour, sides and whether it carries the baked shading.
    const info = {};
    for (const mesh of meshes) {
      const m = mesh.material;
      info[m.name] = { mesh, name: m.name, color: m.color ? m.color.clone() : new THREE.Color(1, 1, 1), side: m.side, vertexColors: !!m.vertexColors };
    }
    const any = meshes[0];
    const headIdx = any.skeleton.bones.findIndex(b => b.name === 'head');
    const eyes = info.Eye ? measureEyes(info.Eye.mesh.geometry, 0) : null;
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    return {
      id, def, root, info, eyes, head: measureHead(info, headIdx), headIdx,
      clips: { idle: gltf.animations.find(a => /idle/i.test(a.name)) || gltf.animations[0], walk: gltf.animations.find(a => /walk/i.test(a.name)) || gltf.animations[1] },
      eyeCentre: rig?.eyeCentre || null, strideLength: typeof rig?.strideLength === 'number' ? rig.strideLength : 1.1,
      height: box.max.y - box.min.y,
      bindMatrix: any.bindMatrix.clone(), headInverse: headIdx >= 0 ? any.skeleton.boneInverses[headIdx].clone() : new THREE.Matrix4(),
    };
  });
  p.catch(() => bases.delete(id));     // (a failed download may be tried again)
  bases.set(id, p);
  return p;
}
// (tests, tools) the looks already parsed
export const loadedBases = () => [...bases.keys()];

// Head measurements in the bind pose (mesh space): the face's front surface and the head's half-width,
// from the head-weighted Skin vertices. The glasses are fitted from these.
function measureHead(info, headIdx) {
  const s = info.Skin;
  if (!s || headIdx < 0) return null;
  const skin = [];
  const g = s.mesh.geometry, si = g.attributes.skinIndex, sw = g.attributes.skinWeight, pos = g.attributes.position;
  for (let v = 0; v < pos.count; v++) {
    let w = 0;
    for (let c = 0; c < 4; c++) if (si.getComponent(v, c) === headIdx) w += sw.getComponent(v, c);
    if (w > 0.5) skin.push(new THREE.Vector3().fromBufferAttribute(pos, v));
  }
  return {
    skin,
    frontZ(x, y, r = 0.012) { let z = -Infinity; for (const p of skin) if (Math.hypot(p.x - x, p.y - y) < r && p.z > z) z = p.z; return z; },
    halfWidth(y, z, sign, ry = 0.012, rz = 0.012) { let x = 0; for (const p of skin) if (Math.abs(p.y - y) < ry && Math.abs(p.z - z) < rz && p.x * sign > x) x = p.x * sign; return x; },
  };
}

const lin = hex => new THREE.Color(hex);   // sRGB hex -> the renderer's linear working colour

// The colour each named part gets for this avatar (absent: the model's own).
export function paletteFor(base, avatar) {
  const def = base.def, out = {};
  const put = (names, hex) => { for (const n of names || []) if (base.info[n] && hex) out[n] = lin(hex); };
  const skin = item('skin', avatar.skin), hair = item('hair', avatar.hair);
  const main = item('main', avatar.main), accent = item('accent', avatar.accent), metal = item('metal', avatar.metal);
  if (skin) { put(def.parts.skin, skin.value); put(def.parts.lips, skin.lips); }
  if (hair) { put(def.parts.hair, hair.value); put(def.parts.brow, hair.brow); }
  if (main) put(def.parts.main, main.value);
  if (accent) put(def.parts.accent, accent.value);
  if (metal) put(def.parts.metal, metal.value);
  for (const [name, rule] of Object.entries(def.derive || {})) {
    const src = rule.from === 'main' && main ? lin(main.value) : null;
    if (!src || !base.info[name]) continue;
    let mul = rule.mul;
    if (rule.dark) {   // darker for dark cloth (x0.25) up to x0.62 for light cloth
      const l = src.r * 0.2126 + src.g * 0.7152 + src.b * 0.0722;
      mul = THREE.MathUtils.lerp(0.25, 0.62, THREE.MathUtils.smoothstep(l, 0.02, 0.5));
    }
    out[name] = src.clone().multiplyScalar(mul);
  }
  return out;
}

// The same colours as sRGB hex, in the menu lobby's `dress` format (src/menu/lobbyCast.js).
export function lobbyDress(base, avatar) {
  return Object.fromEntries(Object.entries(paletteFor(base, avatar)).map(([k, c]) => [k, '#' + c.getHexString()]));
}

// One avatar. `rim`: the guests' rim light (GAME_RIM), other values ({ color, rim, fill }), or false
// (portraits). `original: true` keeps the model's own colours and Henry's own glasses (tests: the runtime
// portraits are compared with the shipped pictures).
export function createAvatarModel(base, avatar, { rim = GAME_RIM, original = false } = {}) {
  const root = SkeletonUtils.clone(base.root);
  root.name = `avatar:${base.id}`;
  const parts = {};
  const owned = [];                 // the materials this avatar made (disposed with it)
  let anyMesh = null;
  const matte = m => (rim ? guestLight(m, rim) : m);
  root.traverse(o => {
    if (!o.isSkinnedMesh) return;
    o.frustumCulled = false;        // (skinned: the bind-pose bounds are wrong once posed)
    const src = base.info[o.material.name] || { color: o.material.color, side: o.material.side, vertexColors: !!o.material.vertexColors, name: o.material.name };
    const m = new THREE.MeshLambertMaterial({ color: src.color.clone() });
    if (src.vertexColors) m.vertexColors = true;   // the baked shading multiplies the colour
    if (src.side !== undefined) m.side = src.side;
    m.name = src.name;              // (found by name: 'Eye', 'Shine', 'Glasses')
    o.material = matte(m);
    owned.push(m);
    parts[m.name] = { mesh: o, material: m };
    anyMesh = o;
  });
  // One skeleton for every part, as in the model itself (SkeletonUtils gives each part its own copy: 9-15
  // bone textures to update every frame instead of one).
  const skeleton = anyMesh.skeleton;
  root.traverse(o => { if (o.isSkinnedMesh && o.skeleton !== skeleton) { const own = o.skeleton; o.bind(skeleton, o.bindMatrix); own.dispose(); } });
  const headBone = skeleton.bones[base.headIdx] || null;
  const frameMat = matte(new THREE.MeshLambertMaterial({ color: lin('#3a2218') }));
  frameMat.name = 'Glasses';
  owned.push(frameMat);
  let glasses = null, glassesStyle = null, iris = null, current = null, normalEye = parts.Eye?.material || null;
  let eyes = { set() {}, on: false, available: false, materials: [] }, wantPossessed = false;

  // The possessed switch for the eyes the avatar has now (rebuilt when they change).
  function rebuildEyes() {
    eyes.set(false);
    for (const m of eyes.materials || []) m.dispose();
    eyes = createPossessedEyes(root);
    eyes.set(wantPossessed);
  }

  function setAvatar(av) {
    current = av;
    const pal = original ? {} : paletteFor(base, av);
    for (const [name, p] of Object.entries(parts)) p.material.color.copy(pal[name] || base.info[name]?.color || p.material.color);
    // the eyes: classic (the model's own) or an iris painted by the possessed eyes' shader
    const eyeItem = original ? null : item('eyes', av.eyes);
    const eye = parts.Eye;
    let eyeMat = eye?.material || null;
    if (eye && eyeItem?.value) {
      if (!iris) { iris = possessedEyeMaterial(eye.material, base.eyes); iris.name = 'Eye'; owned.push(iris); }
      const u = iris.userData.possessedUniforms;
      u.uIrisRim.value.set(eyeItem.value[0]); u.uIrisMid.value.set(eyeItem.value[1]); u.uIrisCore.value.set(eyeItem.value[2]);
      u.uGlow.value = 0;
      eyeMat = iris;
    }
    if (parts.Shine) parts.Shine.mesh.visible = !(eyeItem && eyeItem.value);   // (the iris has its own catchlight)
    if (eye && eyeMat !== normalEye) {
      eyes.set(false);                      // the old normal eyes back on the mesh, then the new ones in
      eye.mesh.material = normalEye = eyeMat;
      rebuildEyes();                        // (and red again if it was)
    }
    // glasses: Henry's own round frames, or ones fitted to the head bone
    const g = original ? null : item('glasses', av.glasses), frame = item('frame', av.frame);
    if (frame && !original) frameMat.color.copy(lin(frame.value));
    const builtIn = base.def.builtInGlasses && parts[base.def.builtInGlasses];
    const useBuiltIn = !!builtIn && (original ? true : g?.value === 'round');
    if (builtIn) {
      builtIn.mesh.visible = useBuiltIn;
      if (!original) builtIn.material.color.copy(frameMat.color);
    }
    const style = g?.value && !useBuiltIn ? g.value : null;
    if (style !== glassesStyle) {
      if (glasses) { glasses.parent?.remove(glasses); glasses = null; }
      glassesStyle = style;
      if (style && headBone) { glasses = glassesMesh(base, style, frameMat); if (glasses) headBone.add(glasses); }
    }
  }
  setAvatar(avatar);
  if (!eyes.available && parts.Eye) rebuildEyes();

  return {
    root, parts, headBone, base,
    setAvatar,
    get avatar() { return current; },
    // red eyes on / off (kept across eye-colour changes)
    setPossessed(on) { wantPossessed = !!on; eyes.set(wantPossessed); },
    get eyes() { return eyes; },
    get glasses() { return glasses; },
    // Run `fn` (a shader compile) while the avatar wears everything it could: the red / coloured eyes'
    // shader and a pair of glasses, so a later pick or a possession never stalls on a new shader.
    // Worn only while `fn` sets the compile off: three.js picks and starts every shader at once inside
    // compile / compileAsync and then only waits for them, so the extra eyes and glasses come off before
    // that wait — a frame of the lobby, or a portrait drawn meanwhile (src/render/avatarPortrait.js shares
    // one model per look), never shows them.
    async withAllShaders(fn) {
      const was = wantPossessed;
      eyes.set(true);
      const tmp = !glasses && headBone ? glassesMesh(base, 'round', frameMat) : null;
      if (tmp) headBone.add(tmp);
      let pending;
      try { pending = fn(); } finally { if (tmp) headBone.remove(tmp); eyes.set(was); }
      await pending;
    },
    dispose() {
      root.parent?.remove(root);
      if (glasses) glasses.parent?.remove(glasses);
      eyes.set(false);
      for (const m of eyes.materials || []) m.dispose();
      for (const m of owned) m.dispose();
      skeleton.dispose();            // (its bone texture)
    },
  };
}
