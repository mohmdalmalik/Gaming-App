// A player's avatar (src/data/wardrobe.js avatar v2: ids only), made at run time from PIECES on a shared body
// (src/render/avatarParts.js: each piece's GLB parsed once, the worn pieces merged once per set of pieces):
//   loadBase(avatar)                  -> Promise<base>: the guest's assembly for these pieces (base.id = its
//                                        geometryKey): the merged geometry, the eye geometry, the rig to clone, the
//                                        Idle/Walk clips, the stride, the height and the eyes' and head's measurements
//   createAvatarModel(base, avatar, { rim })
//                                     -> { root, headBone, base, mesh, eyeMesh, setAvatar(avatar), avatar,
//                                          setPossessed(on), eyes, glasses, withAllShaders(fn), dispose() }:
//                                        its own bones (a SkeletonUtils clone), the SHARED geometry, its own materials
//   paletteFor(avatar)                -> Float32Array(48): the palette's linear RGB (contract section 4)
// A guest is TWO draw calls: one skinned mesh for every piece (glasses included) painted by a 16-colour palette
// uniform, and one for the eyes (the face's Eye, plus Shine as a second group where the face has catchlights: three
// calls while they show), so a possessed guest's eyes can turn red. setAvatar() only repaints (16 colours and the
// eyes, no allocation); an avatar with other pieces (geometryKey) is another base, which the caller loads.
//
// Recolouring keeps the models' look: every clothing piece's baked shading (COLOR_0) is neutral grey, so the grooves,
// seams and ambient occlusion carry over to any colour; satin lapels and seams follow the main colour, darker. Eye
// colours are painted by the possessed eyes' own shader (src/render/possessedLook.js) with other colours and no glow,
// so they cost no new shader; the possessed switch is rebuilt whenever the eye material changes, so un-possessing
// always gives the avatar's own eyes back. Nothing here knows any rule or role.
import * as THREE from 'three';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { createPossessedEyes, possessedEyeMaterial } from './possessedLook.js';
import { assemble, writePalette, PALETTE_SIZE } from './avatarParts.js';
import { item } from '../data/wardrobe.js';

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

// The guests' one material: matte Lambert with the baked shading (vertex colours), each vertex painted by its
// palette entry (`paletteSlot`), then the rim + fill. ONE program for every guest, body and eyes alike (the colours
// and the rim are uniforms); `rim: false` (portraits) is the same program with no rim.
const WHITE = new Float32Array(PALETTE_SIZE * 3).fill(1);
function guestMaterial({ palette = WHITE, rim = GAME_RIM, color = 0xffffff, side = THREE.DoubleSide, name = 'Guest' } = {}) {
  const m = new THREE.MeshLambertMaterial({ color, vertexColors: true, side });
  m.name = name;
  const r = rim || { color: '#000000', rim: 0, fill: 0 };
  const uniforms = { uPalette: { value: palette }, uRimColor: { value: new THREE.Color(r.color) }, uRim: { value: new THREE.Vector2(r.rim, r.fill) } };
  m.userData.palette = palette;
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = `attribute float paletteSlot;\nuniform vec3 uPalette[${PALETTE_SIZE}];\nvarying vec3 vPalette;\n` + shader.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
      vPalette = uPalette[int(paletteSlot + 0.5)];`);
    shader.fragmentShader = 'uniform vec3 uRimColor;\nuniform vec2 uRim;\nvarying vec3 vPalette;\n' + shader.fragmentShader
      .replace('#include <color_fragment>', `#include <color_fragment>
      diffuseColor.rgb *= vPalette;`)
      .replace('#include <opaque_fragment>', `
      float rimK = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.4);
      outgoingLight += uRimColor * rimK * uRim.x * (0.35 + 0.65 * diffuseColor.rgb) + diffuseColor.rgb * uRim.y;
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'guestPalette1';
  return m;
}

// The guest for these pieces (shared by every avatar wearing them; parts downloaded and parsed once). The model made
// from it holds it (createAvatarModel) and lets it go when disposed.
export function loadBase(av) {
  return assemble(av).then(asm => { asm.release(); return asm; });
}

// The avatar's palette: linear RGB per entry (src/render/avatarParts.js writePalette).
export function paletteFor(av, out = new Float32Array(PALETTE_SIZE * 3)) { return writePalette(out, av); }

// One avatar. `rim`: the guests' rim light (GAME_RIM), other values ({ color, rim, fill }), or false (portraits).
export function createAvatarModel(base, avatar, { rim = GAME_RIM } = {}) {
  base.retain();
  const root = SkeletonUtils.clone(base.rig);
  root.name = `avatar:${base.id}`;
  let mesh = null, eyeMesh = null;
  root.traverse(o => { if (o.isSkinnedMesh) { if (o.name === 'eyes') eyeMesh = o; else mesh = o; o.frustumCulled = false; } });
  // One skeleton for both meshes, as one model (SkeletonUtils gives each its own copy: two bone textures to update
  // every frame instead of one).
  const skeleton = mesh.skeleton;
  if (eyeMesh && eyeMesh.skeleton !== skeleton) { const own = eyeMesh.skeleton; eyeMesh.bind(skeleton, eyeMesh.bindMatrix); own.dispose(); }
  const palette = new Float32Array(PALETTE_SIZE * 3);
  const owned = [];                 // the materials this avatar made (disposed with it)
  const bodyMat = guestMaterial({ palette, rim });
  mesh.material = bodyMat;
  owned.push(bodyMat);
  // the eyes: the face's own Eye (and Shine) colours, lit like the rest of the guest (white palette)
  const eyeMats = (base.eyeMaterials || []).map(e => { const m = guestMaterial({ rim, color: e.color, side: e.side, name: e.name }); owned.push(m); return m; });
  let normalEye = eyeMats.find(m => m.name === 'Eye') || null;
  const shine = eyeMats.find(m => m.name === 'Shine') || null;
  const shineOff = shine ? Object.assign(new THREE.MeshBasicMaterial({ visible: false }), { name: 'Shine:hidden' }) : null;
  if (shineOff) owned.push(shineOff);
  const eyeIndex = eyeMats.indexOf(normalEye), shineIndex = eyeMats.indexOf(shine);
  if (eyeMesh) eyeMesh.material = eyeMats.slice();   // (its own list: the iris and the red eyes are swapped into it)
  const headBone = skeleton.bones[base.headIdx] || null;
  let iris = null, current = null;
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
    writePalette(palette, av);
    // the eyes: classic (the face's own) or an iris painted by the possessed eyes' shader
    const eyeItem = item('eyes', av?.colours?.eyes);
    let eyeMat = eyeMats[eyeIndex] || null;
    if (eyeMesh && eyeIndex >= 0 && eyeItem?.value) {
      if (!iris) { iris = possessedEyeMaterial(eyeMats[eyeIndex], base.eyes); iris.name = 'Eye'; owned.push(iris); }
      const u = iris.userData.possessedUniforms;
      u.uIrisRim.value.set(eyeItem.value[0]); u.uIrisMid.value.set(eyeItem.value[1]); u.uIrisCore.value.set(eyeItem.value[2]);
      u.uGlow.value = 0;
      eyeMat = iris;
    }
    // (the iris has its own catchlight: the face's catchlights hide)
    if (eyeMesh && shineIndex >= 0) eyeMesh.material[shineIndex] = eyeItem?.value ? shineOff : shine;
    if (eyeMesh && eyeIndex >= 0 && eyeMat !== normalEye) {
      eyes.set(false);                      // the old normal eyes back on the mesh, then the new ones in
      eyeMesh.material[eyeIndex] = normalEye = eyeMat;
      rebuildEyes();                        // (and red again if it was)
    }
  }
  setAvatar(avatar);
  if (!eyes.available && eyeMesh) rebuildEyes();

  let disposed = false;
  return {
    root, headBone, base, mesh, eyeMesh,
    setAvatar,
    get avatar() { return current; },
    // red eyes on / off (kept across eye-colour changes)
    setPossessed(on) { wantPossessed = !!on; eyes.set(wantPossessed); },
    get eyes() { return eyes; },
    // the glasses worn ('round', ...: merged into the guest), or null
    get glasses() { return base.glasses || (base.builtInGlasses ? 'builtIn' : null); },
    // Run `fn` (a shader compile) while the avatar wears everything it could: the red / coloured eyes' shader (the
    // glasses are part of the guest's own mesh: no shader of their own). Worn only while `fn` sets the compile off:
    // three.js picks and starts every shader at once inside compile / compileAsync and then only waits for them, so
    // the red eyes come off before that wait — a frame of the lobby, or a portrait drawn meanwhile, never shows them.
    async withAllShaders(fn) {
      const was = wantPossessed;
      eyes.set(true);
      let pending;
      try { pending = fn(); } finally { eyes.set(was); }
      await pending;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.parent?.remove(root);
      eyes.set(false);
      for (const m of eyes.materials || []) m.dispose();
      for (const m of owned) m.dispose();
      skeleton.dispose();            // (its bone texture)
      base.release();
    },
  };
}

// The pieces avatars need, downloaded ahead without making a guest (the menu: the six Looks).
export { preload as preloadAvatars } from './avatarParts.js';
