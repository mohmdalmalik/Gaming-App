// A room built offline as ONE baked model (tools/lobby-pipeline/make_lobby.py), used for the
// starting room. Its soft light, ambient occlusion and furniture shadows are baked into a light
// texture, so the surfaces need no real-time lighting at all: every material is an unlit
// MeshBasicMaterial = albedo (vertex colour or texture) × baked light. That is the cheapest shader
// Three.js has, and the whole room is ~50 draw calls.
//
// The model follows the game's data, not the other way round: collision, pathfinding and the
// walkable centre still come from src/data/floor1.js, and the model's furniture sits on those
// same footprints.
//
// Cutaway: every game wall segment has two nodes in the model, W_<side>_<i>_lo (up to the cut,
// topped by a dark cut cap) and W_<side>_<i>_up (the rest, origin on the cut). Lowering a wall
// folds the upper part down onto the cut, so a lowered wall reads as a cut architectural model
// instead of a squashed one.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { easeOutCubic } from './materials.js';

const BASE = 'assets/models/';
const LM_SCALE = 4.0;   // the light texture stores light / LM_SCALE (tools/lobby-pipeline/make_lobby.py)

function loadTexture(url) {
  return new Promise((resolve, reject) => new THREE.TextureLoader().load(url, resolve, undefined, reject));
}

export async function dressBaked(view, spec, cfg) {
  // Two light maps: one atlas for walls and furniture, and a sharper one of its own for the
  // floor and rugs (mapped straight down), since the floor is most of what you look at.
  const [gltf, light, floorLight] = await Promise.all([
    new GLTFLoader().loadAsync(BASE + spec.model),
    loadTexture(BASE + spec.light),
    loadTexture(BASE + spec.floorLight),
  ]);
  for (const tex of [light, floorLight]) {
    tex.flipY = false;                  // matches the glTF's (already flipped) second UV set
    tex.channel = 1;                    // uv1 = the light-map UVs
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
  }

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
    mats.set(src.name, m);
    return m;
  };

  const root = gltf.scene;
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

  // Hook every wall segment of the room up to its two model parts.
  const H = cfg.walls.height, stub = cfg.cutaway.stubHeight;
  for (const w of view.walls) {
    const [, side, i] = w.wall.id.split(':');
    const lo = nodes.get(`W_${side}_${i}_lo`), up = nodes.get(`W_${side}_${i}_up`);
    if (lo && up) w.baked = { lo, up };
    else console.warn(`baked room: no model part for wall ${w.wall.id}`);
  }
  const plain = view.setWallHeight.bind(view);
  view.setWallHeight = (w, height) => {
    if (!w.baked) { plain(w, height); return; }
    w.height = height;
    const k = easeOutCubic(view.revealT);
    const t = THREE.MathUtils.clamp((height - stub) / (H - stub), 0, 1) * k;
    w.baked.up.scale.y = Math.max(0.001, t);
    w.baked.up.visible = t > 0.02;
    w.baked.lo.scale.y = Math.max(0.02, k);
  };
  for (const w of view.walls) view.setWallHeight(w, w.height);
  return root;
}
