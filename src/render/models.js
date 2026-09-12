// glTF model loading, caching and a warm "grand-hotel" recolour pass.
//
// The Kenney kits ship with a flat modern palette (coral upholstery, tan wood, cool metal).
// We convert every model's PBR materials to the same cheap MeshLambertMaterial the greybox
// uses (so the iPad renders one kind of shader) and recolour them by MATERIAL NAME toward
// warm walnut / cream / brass — late-1980s grand-hotel Art Deco. Changing the look later is a
// one-file edit here; nothing in the game logic or the room data knows about materials.
//
// This module is deliberately room-agnostic: `loadModel`/`instancedFromModel` work for any
// piece, so the same approach can dress the other rooms once the starting room is approved.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BASE = 'assets/models/';
const loader = new GLTFLoader();
const templates = new Map();   // url -> Promise<THREE.Group> (materials already warmed)

// Warm palette keyed by the material names inside the Kenney kits. `emissive` makes lamp
// shades glow; `opacity` (< 1) keeps glass see-through. Everything else is a solid colour.
const PALETTE = {
  wood:        { color: '#6b4a2b' },                        // walnut
  woodDark:    { color: '#3d2917' },                        // dark walnut / mahogany
  carpet:      { color: '#c2ac85' },                        // cream upholstery (sofas, chairs)
  carpetDarker:{ color: '#7c5a3a' },                        // rug border / trim
  carpetWhite: { color: '#e7dcc5' },                        // cream
  carpetBlue:  { color: '#35564e' },                        // deep teal accent
  metal:       { color: '#b0863b' },                        // brass
  lamp:        { color: '#ffe3ad', emissive: '#ffca73' },   // glowing lampshade
  glass:       { color: '#d3e4db', opacity: 0.4, transparent: true },
  plant:       { color: '#4f8158' },                        // foliage
  colormap:    { color: '#c7a774' },                        // warm tint over the shell texture
  _defaultMat: { color: '#b39a78' },
};

// Build the cheap warm material that replaces a loaded PBR one. `map` (the shell texture) is
// kept and tinted by the colour; the cache shares one material per (name+overrides+map).
const matCache = new Map();
function warmMaterial(src, overrides) {
  const name = src.name || '_defaultMat';
  const spec = { ...(PALETTE[name] || PALETTE._defaultMat), ...(overrides?.[name] ? { color: overrides[name] } : {}) };
  const hasMap = !!src.map;
  const key = `${name}|${spec.color}|${spec.emissive || ''}|${spec.opacity ?? 1}|${hasMap ? src.map.uuid : ''}`;
  let m = matCache.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color: new THREE.Color(spec.color) });
    m.name = name;                                     // keep the name so per-instance overrides can match
    if (hasMap) m.map = src.map;                       // keep the shell atlas, tinted by colour
    if (spec.emissive) m.emissive = new THREE.Color(spec.emissive);
    if (spec.opacity != null && spec.opacity < 1) { m.transparent = true; m.opacity = spec.opacity; m.depthWrite = false; }
    m.side = src.side;
    matCache.set(key, m);
  }
  return m;
}

function warmScene(root, overrides) {
  root.traverse(obj => {
    if (!obj.isMesh) return;
    obj.castShadow = obj.receiveShadow = false;
    if (Array.isArray(obj.material)) obj.material = obj.material.map(mm => warmMaterial(mm, overrides));
    else if (obj.material) obj.material = warmMaterial(obj.material, overrides);
  });
  return root;
}

// Load a model once (cached) and hand back a fresh clone each call. Geometry is shared between
// clones; materials are shared too unless per-instance `overrides` (material name -> colour)
// are given, in which case this clone gets its own recoloured copy.
export function loadModel(path, overrides) {
  if (!templates.has(path)) {
    templates.set(path, loader.loadAsync(BASE + path).then(gltf => warmScene(gltf.scene, null)));
  }
  return templates.get(path).then(tpl => {
    const g = tpl.clone(true);
    if (overrides) warmScene(g, overrides);
    return g;
  });
}

// The measured world-space size of a loaded model (metres), for scaling to a footprint.
export function measure(obj) {
  const box = new THREE.Box3().setFromObject(obj);
  const size = new THREE.Vector3(); box.getSize(size);
  return { size, min: box.min.clone(), max: box.max.clone() };
}

// One InstancedMesh from a model's first mesh — used for the many identical floor tiles so the
// whole floor is a single draw call. `matrices` are the per-tile transforms.
export async function instancedFromModel(path, matrices, overrides) {
  const tpl = await loadModel(path, overrides);
  let src = null;
  tpl.traverse(o => { if (!src && o.isMesh) src = o; });
  if (!src) return null;
  const inst = new THREE.InstancedMesh(src.geometry, src.material, matrices.length);
  inst.castShadow = inst.receiveShadow = false;
  // The instances are placed at the room's world position, but an InstancedMesh derives its
  // bounding sphere from the base geometry at the local origin. For rooms away from the origin
  // that makes Three.js wrongly frustum-cull the whole floor when the origin is off-screen, so
  // the floor vanishes. Disable culling for this single, always-relevant mesh.
  inst.frustumCulled = false;
  matrices.forEach((m, i) => inst.setMatrixAt(i, m));
  inst.instanceMatrix.needsUpdate = true;
  return inst;
}
