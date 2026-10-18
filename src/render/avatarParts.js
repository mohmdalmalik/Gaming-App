// A guest made of PIECES (Wardrobe W1, the contract of 18 Oct 2026): one shared body per gender (rig, skin under the
// clothes, the Idle and Walk clips) and swappable pieces skinned to the same 19 bones (a face, a hairstyle, a
// moustache, a jacket, a tie, trousers, a dress, a belt, shoes, small extras), every one its own small GLB in
// assets/characters/parts/<body>/ (built by tools/char-pipeline/parts, listed in its manifest.json). Loading and
// assembly only: nothing here knows any rule, role or catalogue choice beyond the file keys src/data/wardrobe.js
// partKeysFor gives.
//
//   loadManifest()             -> Promise<manifest> (assets/characters/parts/manifest.json), fetched once
//   loadPart('m/hairStyle_swept') -> Promise<part>: the file fetched and parsed ONCE, shared by every guest wearing it
//   preload([avatar | key, ...])  -> Promise: the pieces downloaded ahead (the menu's lobby: the six Looks)
//   assemble(avatar, { mergeEyes, bakeColours }) -> Promise<Assembly> (one reference: release() it when done)
//
// An Assembly is ONE merged skinned geometry (every piece but the eyes, shadow patches applied, the code-drawn glasses
// merged in) + ONE eye geometry (the face's Eye, and Shine as a second group where the face has catchlights), so a
// guest costs 2 draw calls (3 while the catchlights show): src/render/avatar.js makes the guest from it. Colours are
// NOT in the geometry: every vertex carries `paletteSlot` (its material's palette entry, contract section 4) and the
// guest's material paints it from a 16-colour uniform palette, so a new colour never merges anything again. Fixed
// materials (the shirt, the shoes, Henry's black trousers) have their own colour multiplied into the vertex colour.
// `bakeColours: true` (the menu's lobby people) multiplies the avatar's colours in too (palette slot 0, white), and
// `mergeEyes: true` puts the eyes into the one geometry: one draw call, for figures that are never possessed.
//
// Assemblies are cached by the avatar's pieces (src/data/wardrobe.js geometryKey; baked ones by every colour too) and
// counted: whoever holds one releases it (src/render/avatar.js does, when the guest is disposed). One nobody holds is
// kept a little (IDLE_KEEP, the most recent), so the same look again costs no merge, then let go. The parsed pieces
// themselves are kept for the visit (they are the download).
//
// Shadow patches (the hair's shadow on the forehead, a jacket's hem on the trousers: the pieces' scene extras
// aoPatches) are multiplied into the assembly's OWN copy of a piece's vertex colours; a cached piece never changes. A
// patch baked against another version of its target (the target's `hash` differs) is skipped, with one warning.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { partKeysFor, geometryKey, avatarKey, genderOf, paletteHex } from '../data/wardrobe.js';
import { measureEyes } from './possessedLook.js';
import { glassesPiece } from './avatarGlasses.js';

// (relative to this module, so the game's page and the pipeline's tool pages find the same files)
const ROOT = new URL('../../assets/characters/parts/', import.meta.url).href;
const loader = new GLTFLoader();

// The palette (contract section 4): index -> entry. 0 = fixed (white: the vertex colour already holds the colour).
export const PALETTE = Object.freeze({ fixed: 0, skin: 1, lips: 2, hair: 3, brow: 4, main: 5, lapel: 6, shade: 7, accent: 8, metal: 9, frame: 10 });
export const PALETTE_SIZE = 16;
// The default `materials` table (a piece's own scene extras say it first; this is only for a name they leave out).
const DEFAULT_MATERIALS = {
  Shirt: 'fixed', Button: 'fixed', Horn: 'fixed', Sole: 'fixed', Shoe: 'fixed', Mouth: 'fixed', Pearl: 'fixed', Glove: 'fixed',
  Petal: 'fixed', Glass: 'fixed', Skin: 'skin', Lips: 'lips', Hair: 'hair', Brow: 'brow', Stache: 'brow', Jacket: 'main',
  Trouser: 'main', Dress: 'main', Lapel: 'lapel', Shade: 'shade', Tie: 'accent', Sash: 'accent', Trim: 'accent', Gold: 'metal',
  Glasses: 'frame', Eye: 'eye', Shine: 'eye',
};
const EYE_MATERIALS = ['Eye', 'Shine'];       // the eye mesh, in this order (its groups)
const IDLE_KEEP = 3;                          // assemblies nobody holds, kept for a quick return (about 1.2 MB each)

// ---- the manifest and the pieces --------------------------------------------------------------------------------------
let manifestP = null;
export function loadManifest() {
  if (!manifestP) {
    manifestP = fetch(`${ROOT}manifest.json`).then(r => { if (!r.ok) throw new Error(`parts manifest: ${r.status}`); return r.json(); });
    manifestP.catch(() => { manifestP = null; });     // (tried again next time)
  }
  return manifestP;
}

const parts = new Map();          // key ('m/body', 'm/hairStyle_swept') -> Promise<part>
export function loadPart(key) {
  let p = parts.get(key);
  if (!p) {
    p = loader.loadAsync(`${ROOT}${key}.glb`).then(gltf => readPart(key, gltf));
    p.catch(() => parts.delete(key));                 // (a failed download may be tried again)
    parts.set(key, p);
  }
  return p;
}
// A parsed piece: its primitives (one per material, in the file's order), its scene extras, the rig's extras and
// clips (the body), and its bones' names in joint order.
function readPart(key, gltf) {
  const meshes = [];
  let rig = null;
  gltf.scene.traverse(o => {
    if (o.isSkinnedMesh) meshes.push(o);
    if (o.userData && (o.userData.eyeCentre || typeof o.userData.strideLength === 'number') && !o.isMesh) rig = { ...rig, ...o.userData };
  });
  if (!meshes.length) throw new Error(`${key}: no skinned mesh`);
  const extras = gltf.scene.userData || {};
  const own = extras.materials || {};
  const prims = meshes.map(m => ({
    name: m.material.name, geometry: m.geometry, color: m.material.color ? m.material.color.clone() : new THREE.Color(1, 1, 1),
    side: m.material.side, entry: own[m.material.name] || DEFAULT_MATERIALS[m.material.name] || 'fixed',
  }));
  const skeleton = meshes[0].skeleton;
  return {
    key, scene: gltf.scene, meshes, prims, extras, rig, hash: extras.hash || null,
    bones: skeleton.bones.map(b => b.name), boneInverses: skeleton.boneInverses, bindMatrix: meshes[0].bindMatrix.clone(),
    clips: { idle: gltf.animations.find(a => /idle/i.test(a.name)) || null, walk: gltf.animations.find(a => /walk/i.test(a.name)) || null },
  };
}

// Download pieces ahead (avatars or file keys); never fails (a piece that cannot come now is tried again when worn).
export function preload(list = []) {
  const keys = new Set();
  for (const x of list) {
    if (!x) continue;
    if (typeof x === 'string') { keys.add(x); continue; }
    const k = partKeysFor(x);
    keys.add(k.body); for (const p of k.parts) keys.add(p);
  }
  return Promise.all([...keys].map(k => loadPart(k).catch(e => { console.warn('parts: could not load', k, e?.message || e); return null; })));
}

// ---- assembly ----------------------------------------------------------------------------------------------------------
const cache = new Map();          // cache key -> Assembly (held, or idle)
const building = new Map();       // cache key -> Promise<Assembly>
const idle = [];                  // the cache keys of assemblies nobody holds, oldest first
const warned = new Set();
const keyOf = (av, mergeEyes, bakeColours) => `${bakeColours ? avatarKey(av) : geometryKey(av)}${mergeEyes ? '|eyes' : ''}${bakeColours ? '|baked' : ''}`;

export function assemble(av, { mergeEyes = false, bakeColours = false } = {}) {
  const ck = keyOf(av, mergeEyes, bakeColours);
  const have = cache.get(ck);
  if (have) { have.retain(); return Promise.resolve(have); }
  let p = building.get(ck);
  if (!p) {
    p = build(av, ck, { mergeEyes, bakeColours }).then(asm => { building.delete(ck); cache.set(ck, asm); idle.push(ck); trimIdle(); return asm; },
      err => { building.delete(ck); throw err; });
    building.set(ck, p);
  }
  return p.then(asm => { asm.retain(); return asm; });
}
function trimIdle() {
  while (idle.length > IDLE_KEEP) {
    const ck = idle.shift(), asm = cache.get(ck);
    if (!asm || asm.refs > 0) continue;
    cache.delete(ck);
    asm.dispose();
  }
}

// The vertices (in this primitive) whose skin follows the head bone more than half: the head's measurements.
function headPoints(geometry, headIdx, out) {
  const si = geometry.attributes.skinIndex, sw = geometry.attributes.skinWeight, pos = geometry.attributes.position;
  for (let v = 0; v < pos.count; v++) {
    let w = 0;
    for (let c = 0; c < 4; c++) if (si.getComponent(v, c) === headIdx) w += sw.getComponent(v, c);
    if (w > 0.5) out.push(new THREE.Vector3().fromBufferAttribute(pos, v));
  }
}
// Head measurements in the bind pose (mesh space): the face's front surface and the head's half-width, from the
// head-weighted Skin of the body and the face. The glasses are fitted from these.
function measureHead(skin) {
  if (!skin.length) return null;
  return {
    skin,
    frontZ(x, y, r = 0.012) { let z = -Infinity; for (const p of skin) if (Math.hypot(p.x - x, p.y - y) < r && p.z > z) z = p.z; return z; },
    halfWidth(y, z, sign, ry = 0.012, rz = 0.012) { let x = 0; for (const p of skin) if (Math.abs(p.y - y) < ry && Math.abs(p.z - z) < rz && p.x * sign > x) x = p.x * sign; return x; },
  };
}

// sRGB hex -> linear [r, g, b] (cached: a handful of colours)
const linMemo = new Map();
const tmpColor = new THREE.Color();
export function linearOf(hex) {
  if (!hex) return null;
  let v = linMemo.get(hex);
  if (!v) { tmpColor.set(hex); v = [tmpColor.r, tmpColor.g, tmpColor.b]; linMemo.set(hex, v); }
  return v;
}
// The avatar's palette as linear RGB, written into `out` (Float32Array(48)): the direct entries from
// src/data/wardrobe.js paletteHex, then lapel (main x 0.62) and shade (main darkened: x0.25 for dark cloth up to x0.62
// for light cloth), exactly as the guests were painted before pieces. An entry with no colour is white.
export function writePalette(out, av) {
  out.fill(1);
  const hex = paletteHex(av);
  const put = (i, c) => { if (c) { out[i * 3] = c[0]; out[i * 3 + 1] = c[1]; out[i * 3 + 2] = c[2]; } };
  for (const name of ['skin', 'lips', 'hair', 'brow', 'main', 'accent', 'metal', 'frame']) put(PALETTE[name], linearOf(hex[name]));
  const main = linearOf(hex.main);
  if (main) {
    put(PALETTE.lapel, main.map(v => v * 0.62));
    const l = main[0] * 0.2126 + main[1] * 0.7152 + main[2] * 0.0722;
    const k = THREE.MathUtils.lerp(0.25, 0.62, THREE.MathUtils.smoothstep(l, 0.02, 0.5));
    put(PALETTE.shade, main.map(v => v * k));
  }
  return out;
}

// One primitive's contribution to a merged geometry: its arrays, its palette slot and the colour multiplied into its
// vertex colour (null: none).
function addPiece(acc, geometry, { slot, mul = null, jointMap = null }) {
  const pos = geometry.attributes.position, n = pos.count;
  acc.list.push({ geometry, n, slot, mul, jointMap, start: acc.verts });
  acc.verts += n;
  acc.indices += geometry.index ? geometry.index.count : n;
}
// An attribute's values as one tightly packed array of its own type (the pipeline writes them packed; anything
// else, interleaved say, is unpacked).
function packed(attr) {
  if (!attr.isInterleavedBufferAttribute && attr.array.length === attr.count * attr.itemSize) return attr.array;
  const inter = !!attr.isInterleavedBufferAttribute;
  const src = inter ? attr.data.array : attr.array, stride = inter ? attr.data.stride : attr.itemSize, off = inter ? attr.offset : 0;
  const out = new src.constructor(attr.count * attr.itemSize);
  for (let v = 0; v < attr.count; v++) for (let c = 0; c < attr.itemSize; c++) out[v * attr.itemSize + c] = src[v * stride + off + c];
  return out;
}
function mergeInto(acc) {
  const V = acc.verts;
  const position = new Float32Array(V * 3), normal = new Float32Array(V * 3), color = new Uint16Array(V * 4);
  const skinIndex = new Uint8Array(V * 4), skinWeight = new Uint8Array(V * 4), paletteSlot = new Uint8Array(V);
  const index = V > 65535 ? new Uint32Array(acc.indices) : new Uint16Array(acc.indices);
  const groups = [];
  let ii = 0;
  for (const p of acc.list) {
    const g = p.geometry, a = g.attributes, o = p.start, n = p.n;
    position.set(packed(a.position), o * 3);
    normal.set(packed(a.normal), o * 3);
    // colour: the bake (COLOR_0, u16x4; white when a piece has none) x the multiplier
    const src = a.color;
    const [mr, mg, mb] = p.mul || [1, 1, 1];
    const q = x => Math.max(0, Math.min(65535, Math.round(x * 65535)));
    for (let v = 0, j = o * 4; v < n; v++, j += 4) {
      color[j] = q((src ? src.getX(v) : 1) * mr);
      color[j + 1] = q((src ? src.getY(v) : 1) * mg);
      color[j + 2] = q((src ? src.getZ(v) : 1) * mb);
      color[j + 3] = 65535;
    }
    const si = packed(a.skinIndex), sw = a.skinWeight;
    if (p.jointMap) for (let k = 0; k < n * 4; k++) skinIndex[o * 4 + k] = p.jointMap[si[k]];
    else skinIndex.set(si, o * 4);
    if (sw.array instanceof Uint8Array && sw.normalized) skinWeight.set(packed(sw), o * 4);
    else {   // (float weights: to u8, each vertex summing to 255)
      for (let v = 0; v < n; v++) {
        let left = 255;
        for (let c = 0; c < 4; c++) { const q = c < 3 ? Math.round(sw.getComponent(v, c) * 255) : left; skinWeight[(o + v) * 4 + c] = Math.max(0, Math.min(255, q)); left -= q; }
      }
    }
    paletteSlot.fill(p.slot, o, o + n);
    const idx = g.index;
    const start = ii;
    if (idx) { const arr = idx.array; for (let k = 0; k < idx.count; k++) index[ii++] = arr[k] + o; }
    else for (let k = 0; k < n; k++) index[ii++] = o + k;
    groups.push({ start, count: ii - start });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normal, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(color, 4, true));
  geo.setAttribute('skinIndex', new THREE.BufferAttribute(skinIndex, 4));
  geo.setAttribute('skinWeight', new THREE.BufferAttribute(skinWeight, 4, true));
  geo.setAttribute('paletteSlot', new THREE.BufferAttribute(paletteSlot, 1));
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  geo.computeBoundingSphere();
  return { geometry: geo, groups };
}
// A geometry that shares everything with the piece's but has its own copy of the vertex colours (for the patches).
function ownColours(g) {
  const o = new THREE.BufferGeometry();
  for (const [k, a] of Object.entries(g.attributes)) o.setAttribute(k, k === 'color' ? a.clone() : a);
  o.setIndex(g.index);
  return o;
}

async function build(av, cacheKey, { mergeEyes, bakeColours }) {
  const keys = partKeysFor(av);
  const [body, ...pieces] = await Promise.all([loadPart(keys.body), ...keys.parts.map(loadPart)]);
  const manifest = await loadManifest().catch(() => null);
  const t0 = performance.now();
  const bodyId = keys.body.split('/')[0];
  const names = body.bones;
  const headIdx = names.indexOf('head');
  const warnings = [];
  // every primitive worn: { part (file key without the body), plain (slot_id), prim, geometry, jointMap }
  const worn = [{ part: 'body', plain: 'body', src: body }, ...pieces.map((p, i) => {
    const k = keys.parts[i].slice(bodyId.length + 1);
    return { part: k, plain: k.split('~')[0], src: p };
  })];
  const prims = [];
  for (const w of worn) {
    let jointMap = null;
    if (w.src !== body && w.src.bones.join() !== names.join()) {
      jointMap = w.src.bones.map(n => names.indexOf(n));
      if (jointMap.some(i => i < 0)) throw new Error(`${w.src.key}: a bone that is not in the body's rig`);
    }
    for (const pr of w.src.prims) {
      // (Henry's own round frames: only when the face's built-in style is worn)
      if (pr.name === 'Glasses' && keys.builtInGlasses !== `${bodyId}/${w.part}`) continue;
      prims.push({ w, pr, geometry: pr.geometry, jointMap, own: false });
    }
  }
  // the shadow patches of every worn piece on every worn piece
  const byPart = new Map();
  for (const w of worn) { byPart.set(w.part, w); if (!byPart.has(w.plain)) byPart.set(w.plain, w); }
  for (const w of worn) {
    for (const [target, patch] of Object.entries(w.src.extras.aoPatches || {})) {
      const t = byPart.get(target);
      if (!t || !patch) continue;
      if (patch.against && t.src.hash && patch.against !== t.src.hash) {
        const msg = `parts: the shadow of ${w.src.key} on ${t.src.key} was baked against another version of it (skipped)`;
        warnings.push(msg);
        if (!warned.has(msg)) { warned.add(msg); console.warn(msg); }
        continue;
      }
      for (const [mat, pm] of Object.entries(patch.mats || {})) {
        const q = prims.find(x => x.w === t && x.pr.name === mat);
        if (!q || !pm?.idx) continue;
        if (!q.own) { q.geometry = ownColours(q.geometry); q.own = true; }
        const c = q.geometry.attributes.color;
        if (!c) continue;
        const arr = c.array, s = c.itemSize, whole = !(arr instanceof Float32Array);
        for (let k = 0; k < pm.idx.length; k++) {
          const i = pm.idx[k] * s, m = pm.mul[k];
          if (i + 2 >= arr.length) continue;
          for (let ch = 0; ch < 3; ch++) arr[i + ch] = whole ? Math.round(arr[i + ch] * m) : arr[i + ch] * m;
        }
      }
    }
  }
  // the guest's measurements: the eyes (the face's Eye), the head (head-weighted Skin), the brows (the glasses' fit)
  const face = keys.eyesFrom ? worn.find(w => `${bodyId}/${w.part}` === keys.eyesFrom) : null;
  const eyePrim = face?.src.prims.find(p => p.name === 'Eye');
  const eyes = eyePrim ? measureEyes(eyePrim.geometry, 0) : null;
  const skin = [];
  if (headIdx >= 0) for (const q of prims) if (q.pr.name === 'Skin' && (q.w === face || q.w.src === body)) headPoints(q.pr.geometry, headIdx, skin);
  const head = measureHead(skin);
  const brow = face?.src.prims.find(p => p.name === 'Brow')?.geometry.attributes.position.array || null;
  const faceId = face ? face.plain.split('_')[1] : null;
  const fit = { key: `${bodyId}:${faceId}`, eyes, head, brow, female: genderOf(bodyId) === 'f' };

  // one merged geometry (+ the eyes)
  const palette = bakeColours ? writePalette(new Float32Array(PALETTE_SIZE * 3), av) : null;
  const main = { list: [], verts: 0, indices: 0 }, eyeAcc = { list: [], verts: 0, indices: 0 };
  const ranges = {}, eyeMaterials = [];
  const order = q => (EYE_MATERIALS.includes(q.pr.name) ? EYE_MATERIALS.indexOf(q.pr.name) : -1);
  for (const q of prims) {
    const isEye = q.pr.entry === 'eye' || EYE_MATERIALS.includes(q.pr.name);
    if (isEye && !mergeEyes) continue;
    const c = q.pr.color;
    const slot = PALETTE[q.pr.entry] ?? 0;
    let mul = null, useSlot = slot;
    if (isEye || slot === 0) mul = [c.r, c.g, c.b];
    else if (palette) { mul = [palette[slot * 3], palette[slot * 3 + 1], palette[slot * 3 + 2]]; useSlot = 0; }
    if (isEye) useSlot = 0;
    (ranges[q.pr.name] ||= []).push([main.verts, q.geometry.attributes.position.count]);
    addPiece(main, q.geometry, { slot: useSlot, mul, jointMap: q.jointMap });
  }
  // the code-drawn glasses (frames only: no lens), fitted to this face and merged in on the head bone
  if (keys.glasses && eyes && head) {
    const g = glassesPiece(fit, keys.glasses, headIdx);
    if (g) {
      let mul = null, slot = PALETTE.frame;
      if (palette) { mul = [palette[slot * 3], palette[slot * 3 + 1], palette[slot * 3 + 2]]; slot = 0; }
      (ranges.Glasses ||= []).push([main.verts, g.attributes.position.count]);
      addPiece(main, g, { slot, mul });
    }
  }
  const merged = mergeInto(main);
  let eyeGeometry = null;
  if (!mergeEyes) {
    const eyePrims = prims.filter(q => order(q) >= 0 && q.w === face).sort((a, b) => order(a) - order(b));
    for (const q of eyePrims) {
      addPiece(eyeAcc, q.geometry, { slot: 0, jointMap: q.jointMap });
      eyeMaterials.push({ name: q.pr.name, color: q.pr.color.clone(), side: q.pr.side });
    }
    if (eyeAcc.list.length) {
      const e = mergeInto(eyeAcc);
      eyeGeometry = e.geometry;
      e.groups.forEach((gr, i) => eyeGeometry.addGroup(gr.start, gr.count, i));
    }
  }

  // the rig to clone: the body's armature with the merged mesh (and the eyes) on its skeleton
  const rig = SkeletonUtils.clone(body.scene);
  rig.name = `guest:${geometryKey(av)}`;
  const old = [];
  rig.traverse(o => { if (o.isSkinnedMesh) old.push(o); });
  const skeleton = old[0].skeleton, holder = old[0].parent, bindMatrix = old[0].bindMatrix.clone();
  for (const o of old) { o.parent.remove(o); if (o.skeleton !== skeleton) o.skeleton.dispose(); }
  const placeholder = new THREE.MeshBasicMaterial();     // (each guest puts its own materials on: src/render/avatar.js)
  const add = (geo, name) => {
    const sm = new THREE.SkinnedMesh(geo, placeholder);
    sm.name = name; sm.frustumCulled = false;
    holder.add(sm); sm.bind(skeleton, bindMatrix);
    return sm;
  };
  add(merged.geometry, 'guest');
  if (eyeGeometry) add(eyeGeometry, 'eyes');
  rig.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(rig);

  const files = [keys.body, ...keys.parts];
  const bytes = manifest ? files.reduce((s, k) => s + ((k === keys.body ? manifest.bodies?.[bodyId]?.bytes : manifest.parts?.[k]?.bytes) || 0), 0) : 0;
  const tris = (merged.geometry.index.count + (eyeGeometry ? eyeGeometry.index.count : 0)) / 3;
  const rigX = body.rig || {};
  let refs = 0, disposed = false;
  const asm = {
    key: geometryKey(av), id: geometryKey(av), cacheKey, body: bodyId, gender: genderOf(bodyId), face: faceId,
    geometry: merged.geometry, eyeGeometry, eyeMaterials, ranges,
    rig, bindMatrix, boneInverses: skeleton.boneInverses, headIdx, headInverse: headIdx >= 0 ? skeleton.boneInverses[headIdx].clone() : new THREE.Matrix4(),
    clips: body.clips, strideLength: typeof rigX.strideLength === 'number' ? rigX.strideLength : 1.1, contactStride: rigX.contactStride ?? null,
    eyeCentre: face?.src.extras.eyeCentre || rigX.eyeCentre || null, height: box.max.y - box.min.y,
    eyes, head, fit, glasses: keys.glasses, builtInGlasses: keys.builtInGlasses,
    merged: { mergeEyes, bakeColours },
    stats: { tris, bytes, files, buildMs: +(performance.now() - t0).toFixed(1) }, warnings,
    get refs() { return refs; },
    retain() {
      refs++;
      const at = idle.indexOf(cacheKey);
      if (at >= 0 && cache.get(cacheKey) === asm) idle.splice(at, 1);
      if (!cache.has(cacheKey)) cache.set(cacheKey, asm);   // (let go while nobody held it: back in the cache)
      disposed = false;
      return asm;
    },
    release() {
      if (refs <= 0) return;
      refs--;
      if (!refs && cache.get(cacheKey) === asm) { idle.push(cacheKey); trimIdle(); }
    },
    // (the graphics chip's copies only: the arrays stay, so one still in use simply uploads again)
    dispose() { if (disposed) return; disposed = true; merged.geometry.dispose(); eyeGeometry?.dispose(); },
  };
  return asm;
}

// (tests) what is loaded and cached
export function partsDebug() {
  return { parts: [...parts.keys()], assemblies: [...cache.values()].map(a => ({ key: a.cacheKey, refs: a.refs, tris: a.stats.tris })), idle: [...idle] };
}
