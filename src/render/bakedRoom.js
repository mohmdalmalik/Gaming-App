// A room built offline as ONE baked model (tools/lobby-pipeline/make_lobby.py), used for the
// starting room. Its soft light, ambient occlusion and furniture shadows are baked into a light
// texture, so the surfaces need no real-time lighting at all: every material is an unlit
// MeshBasicMaterial = albedo (vertex colour or texture) × baked light. That is the cheapest shader
// Three.js has, and the whole room is ~50 draw calls.
//
// The model follows the game's data, not the other way round: collision, pathfinding and the
// walkable centre still come from the lobby in src/data/hotel.js, and the model's furniture sits on those
// same footprints.
//
// Walls: each side of the model is built in parts, A | B · doorway · C | D, plus F, a plain-wall
// piece that fills B · doorway · C. The lobby has 3 or 4 open doorways, chosen each match: an open
// side shows A B C D, a closed-off side shows A F D. Every part has two nodes, W_<side>_<part>_lo (up
// to the cut, topped by a dark cut cap) and _up (the rest, origin on the cut). Lowering a wall
// (cutaway) folds the upper parts down onto the cut, so a lowered wall reads as a cut architectural
// model instead of a squashed one.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { easeOutCubic } from './materials.js';
import { applyXray } from './xray.js';

const BASE = 'assets/models/';
const LM_SCALE = 4.0;   // the light texture stores light / LM_SCALE (tools/lobby-pipeline/make_lobby.py)

function loadTexture(url) {
  return new Promise((resolve, reject) => new THREE.TextureLoader().load(url, resolve, undefined, reject));
}

// Where each wall part sits along its side (metres from the side's middle).
const PARTS = { A: [-4, -1.2], B: [-1.2, -0.6], C: [0.6, 1.2], D: [1.2, 4], F: [-1.2, 1.2] };

// Loaded once per page: a new match re-dresses a fresh lobby view from the same files.
const cache = new Map();
function loadAssets(spec) {
  const k = spec.model;
  if (!cache.has(k)) {
    // Two light maps: one atlas for walls and furniture, and a sharper one of its own for the
    // floor and rugs (mapped straight down), since the floor is most of what you look at.
    cache.set(k, Promise.all([
      new GLTFLoader().loadAsync(BASE + spec.model),
      loadTexture(BASE + spec.light),
      loadTexture(BASE + spec.floorLight),
    ]).then(([gltf, light, floorLight]) => {
      for (const tex of [light, floorLight]) {
        tex.flipY = false;                  // matches the glTF's (already flipped) second UV set
        tex.channel = 1;                    // uv1 = the light-map UVs
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.anisotropy = 4;
      }
      return { gltf, light, floorLight };
    }));
  }
  return cache.get(k);
}

export async function dressBaked(view, spec, cfg) {
  const { gltf, light, floorLight } = await loadAssets(spec);

  const intensity = LM_SCALE * Math.PI * (spec.exposure ?? 1);
  const mats = new Map();
  const convert = src => {
    let m = mats.get(src.name);
    if (m) return m;
    if (src.name === 'glow') {
      // lamp shades and sconce glass: unlit and bright, they read as the light source
      m = new THREE.MeshBasicMaterial({ color: new THREE.Color(spec.glow || '#ffe2ac'), side: THREE.DoubleSide });
    } else {
      const lm = src.name === 'floor' || src.name === 'rug' ? floorLight : light;
      m = new THREE.MeshBasicMaterial({ map: src.map || null, vertexColors: !src.map, lightMap: lm, lightMapIntensity: intensity });
    }
    m.name = src.name;
    applyXray(m);                           // fades out where it would hide the guest (xray.js)
    mats.set(src.name, m);
    return m;
  };

  const root = gltf.scene.clone(true);
  const nodes = new Map();
  root.traverse(o => {
    if (o.isMesh) {
      o.material = Array.isArray(o.material) ? o.material.map(convert) : convert(o.material);
      o.matrixAutoUpdate = true;
    }
    if (o.name) nodes.set(o.name, o);
  });

  // Hide the greybox floor, walls, furniture boxes and their contact shadows: the baked model
  // carries its own (softer) shadows. Characters keep theirs.
  for (const child of view.group.children) child.visible = false;
  view.group.add(root);

  // Hook every wall segment of this match's lobby up to the model parts along it: an open side
  // uses A B C D, a closed-off side A F D. Parts no segment claims stay hidden.
  const H = cfg.walls.height, stub = cfg.cutaway.stubHeight;
  const room = view.room, [cx, cz] = room.center;
  // (Only the part nodes themselves: a part made of several materials loads as a group whose child
  // meshes carry the same W_ prefix, and those must stay visible inside it.)
  const isPart = name => /^W_(north|south|east|west)_[A-F]_(lo|up)$/.test(name);
  for (const node of nodes.values()) if (isPart(node.name)) node.visible = false;
  for (const w of view.walls) {
    const side = w.wall.side, axisX = side === 'north' || side === 'south';
    const a = axisX ? w.wall.min[0] - cx : w.wall.min[1] - cz, b = axisX ? w.wall.max[0] - cx : w.wall.max[1] - cz;
    const letters = room.doorSides.has(side) ? 'ABCD' : 'AFD';
    w.baked = [];
    for (const L of letters) {
      const mid = (PARTS[L][0] + PARTS[L][1]) / 2;
      if (mid <= a || mid >= b) continue;
      const lo = nodes.get(`W_${side}_${L}_lo`), up = nodes.get(`W_${side}_${L}_up`);
      if (lo && up) { lo.visible = up.visible = true; w.baked.push({ lo, up }); }
    }
    if (!w.baked.length) { w.baked = null; console.warn(`baked room: no model part for wall ${w.wall.id}`); }
  }
  const plain = view.setWallHeight.bind(view);
  view.setWallHeight = (w, height) => {
    if (!w.baked) { plain(w, height); return; }
    w.height = height;
    const k = easeOutCubic(view.revealT);
    const t = THREE.MathUtils.clamp((height - stub) / (H - stub), 0, 1) * k;
    for (const part of w.baked) {
      part.up.scale.y = Math.max(0.001, t);
      part.up.visible = t > 0.02;
      part.lo.scale.y = Math.max(0.02, k);
    }
  };
  for (const w of view.walls) view.setWallHeight(w, w.height);
  return root;
}

// Between games (main.js: a new hotel, back to the menu): free the graphics memory of every room tile's
// light maps — a fully explored hotel holds 48 of them. The pictures stay loaded here, so a room that is
// discovered again simply uploads its maps again when it is next drawn. The lobby's own maps (the
// starting room, always there) and the shared albedo are kept.
export function releaseTileTextures() {
  for (const [model, loading] of cache) {
    if (!model.startsWith('rooms/')) continue;
    loading.then(({ light, floorLight }) => { light.dispose(); floorLight.dispose(); }, () => {});
  }
}

// ---- Room tiles --------------------------------------------------------------------------------
// Every other room is a tile built the same way (tools/room-pipeline/make_room.py), in the tile's
// DEFAULT orientation: the model is turned with the tile here. Walls are simpler than the lobby's:
// each game wall segment has ONE upper part, W_<side>_<k>_up (k = 0 for a plain side; 0 / 1 for the
// two halves of a side with a doorway, along the side's axis), named in the model's own sides. The
// lower walls, the floor and the furniture never fold, so they are merged into "static" and "floor".
// All tiles share ONE albedo texture (rooms/albedo.jpg: floors, rugs, paintings, wallpaper…).
const SIDES = ['north', 'east', 'south', 'west'];
let albedo = null;
function sharedAlbedo(path) {
  if (!albedo) {
    albedo = loadTexture(BASE + path).then(t => {
      t.flipY = false; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
      return t;
    });
  }
  return albedo;
}

// A tile's materials, made from the model's: `convert(src, isFloor)` (one material per kind, shared).
function tileConverter(spec, { light, floorLight }, map, view = null) {
  const intensity = LM_SCALE * Math.PI * (spec.exposure ?? 1);
  const mats = new Map();
  return (src, isFloor) => {
    const key = `${src.name}|${isFloor}`;
    let m = mats.get(key);
    if (m) return m;
    const lm = isFloor ? floorLight : light;
    if (src.name === 'glow') m = new THREE.MeshBasicMaterial({ vertexColors: true });
    else if (src.name === 'tex') m = new THREE.MeshBasicMaterial({ map, lightMap: lm, lightMapIntensity: intensity });
    else m = new THREE.MeshBasicMaterial({ vertexColors: true, lightMap: lm, lightMapIntensity: intensity });
    m.name = src.name;
    applyXray(m);                           // fades out where it would hide the guest (xray.js)
    mats.set(key, m);
    if (m.lightMap && view) (view.bakedMats ||= []).push({ mat: m, base: intensity });   // (mood.js flickers these)
    return m;
  };
}

// A copy of the tile's model with its game materials, and its nodes by name.
function tileModel(gltf, convert) {
  const root = gltf.scene.clone(true);
  const nodes = new Map();
  root.traverse(o => {
    if (o.name) nodes.set(o.name, o);
  });
  for (const [name, node] of nodes) {
    const isFloor = name === 'floor' || name.startsWith('floor');
    node.traverse(o => {
      if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(m => convert(m, isFloor)) : convert(o.material, isFloor);
    });
  }
  return { root, nodes };
}

// One tile, built exactly as a revealed room's would be but placed nowhere, for the warm-up at the start
// of a game (main.js warmUp): drawn once out of sight behind the black screen, so the shaders a room
// tile needs are built then, not in the middle of play the first time a door opens.
export async function warmTile(spec) {
  const [assets, map] = await Promise.all([loadAssets(spec), sharedAlbedo(spec.albedo)]);
  return tileModel(assets.gltf, tileConverter(spec, assets, map)).root;
}

export async function dressBakedTile(view, spec, cfg) {
  const [assets, map] = await Promise.all([loadAssets(spec), sharedAlbedo(spec.albedo)]);
  const { root, nodes } = tileModel(assets.gltf, tileConverter(spec, assets, map, view));
  for (const child of view.group.children) child.visible = false;
  // The tile turns about its centre: a quarter turn clockwise (seen from above) per step of
  // `room.rotation`, exactly as src/game/hotel.js turns the tile's doorways and furniture.
  const room = view.room, rot = room.rotation || 0, [cx, cz] = room.center;
  const wrapper = new THREE.Group();
  wrapper.name = `tile:${room.tile || room.id}`;
  wrapper.position.set(cx, 0, cz);
  wrapper.rotation.y = -rot * Math.PI / 2;
  wrapper.add(root);
  view.group.add(wrapper);

  // Hook each game wall segment up to its model part.
  const back = (4 - rot) % 4;
  for (const w of view.walls) {
    let x = w.wall.center[0] - cx, z = w.wall.center[1] - cz;
    for (let k = 0; k < back; k++) [x, z] = [-z, x];                        // world -> model
    const side = SIDES[(SIDES.indexOf(w.wall.side) + back) % 4];
    const hasDoor = room.doorSides.has(SIDES[(SIDES.indexOf(side) + rot) % 4]);
    const along = side === 'north' || side === 'south' ? x : z;
    const up = nodes.get(`W_${side}_${hasDoor ? (along < 0 ? 0 : 1) : 0}_up`);
    w.baked = up ? [{ up }] : null;
    if (!up) console.warn(`baked tile ${room.id}: no model part for wall ${w.wall.id}`);
  }
  const H = cfg.walls.height, stub = cfg.cutaway.stubHeight;
  const plain = view.setWallHeight.bind(view);
  view.setWallHeight = (w, height) => {
    if (!w.baked) { plain(w, height); return; }
    w.height = height;
    const k = easeOutCubic(view.revealT);
    const t = THREE.MathUtils.clamp((height - stub) / (H - stub), 0, 1) * k;
    for (const part of w.baked) {
      part.up.scale.y = Math.max(0.001, t);
      part.up.visible = t > 0.02;
    }
    wrapper.scale.y = Math.max(0.02, k);        // the room rises into view as it is revealed
  };
  for (const w of view.walls) view.setWallHeight(w, w.height);
  return root;
}
