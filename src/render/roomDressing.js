// Dress a room's greybox shell with real glTF pieces. Driven entirely by data:
//   • the room data (src/data/hotel.js) — the colliding furniture (footprints; optional model + yaw)
//   • src/data/dressing.js — the shell (floor, walls, columns), non-colliding decor, lamp lights
//
// Only rooms present in `roomDressings` are touched; every other room stays greybox. The swap
// preserves the game completely: collision comes from the same furniture data, and the wall
// pieces are slotted back into the cutaway system so the dollhouse view still opens up.
//
// Loading is async (the models are local files, so it's quick); if a piece fails to load it is
// skipped with a warning rather than breaking the room.
import * as THREE from 'three';
import { loadModel, instancedFromModel } from './models.js';
import { roomDressings } from '../data/dressing.js';
import { dressBaked, dressBakedTile } from './bakedRoom.js';

const rad = deg => (deg || 0) * Math.PI / 180;

// Polished-brass lift doors (the door model's texture is a bold red; brass reads as an elegant
// grand-hotel elevator and matches the concept's "polished brass").
const liftMaterial = new THREE.MeshLambertMaterial({ color: new THREE.Color('#b0863b') });

// Place a loaded model under `parent` at a world position, facing `yawDeg`, resting on `y`,
// enlarged by `scale` (furniture is scaled up to read at a believable size next to characters).
async function place(parent, path, x, z, yawDeg, y = 0, overrides, scale = 1) {
  try {
    const m = await loadModel(path, overrides);
    m.position.set(x, y, z);
    m.rotation.y = rad(yawDeg);
    if (scale !== 1) m.scale.setScalar(scale);
    parent.add(m);
    return m;
  } catch (e) {
    console.warn(`dressing: could not load ${path}:`, e.message);
    return null;
  }
}

// Replace one greybox wall segment with a run of tiled Kenney wall panels. The returned group
// is 1 metre tall at scale.y = 1 (an inner node bakes out the model's natural height), so the
// existing cutaway — which sets scale.y in metres — keeps working unchanged.
async function buildWallRun(wall, spec) {
  const group = new THREE.Group();
  const inner = new THREE.Group();
  inner.scale.y = 1 / spec.natHeight;   // so the caller's metre-based scale.y maps 1:1
  group.add(inner);
  const axisX = wall.side === 'north' || wall.side === 'south';
  const segLen = axisX ? wall.size[0] : wall.size[1];
  const natLen = 2.0;                    // Kenney wall piece length
  const n = Math.max(1, Math.round(segLen / natLen));
  const tileLen = segLen / n;
  for (let i = 0; i < n; i++) {
    const s = -segLen / 2 + tileLen * (i + 0.5);
    const wrapper = new THREE.Group();
    wrapper.scale.z = tileLen / natLen;  // stretch the panel to fill its slice
    if (axisX) { wrapper.rotation.y = Math.PI / 2; wrapper.position.x = s; }
    else { wrapper.position.z = s; }
    const panel = await loadModel(spec.model).catch(() => null);
    if (panel) wrapper.add(panel);
    inner.add(wrapper);
  }
  group.position.set(wall.center[0], 0, wall.center[1]);
  return group;
}

async function dressOne(view, floor, cfg, spec) {
  const room = view.room;
  const group = view.group;

  // 1. Hide the greybox floor and furniture boxes. Their soft contact shadows are LEFT in
  //    place — they now ground the real models sitting on the same footprints.
  if (view.floorMesh) view.floorMesh.visible = false;
  for (const f of view.furniture) f.mesh.visible = false;

  // A baked room (the starting room): one model built and lit offline replaces the shell, the
  // furniture and the decoration. Only the lamp lights below still apply (they light the guests).
  if (spec.style === 'baked' && spec.tile) { await dressBakedTile(view, spec, cfg); return; }
  if (spec.style === 'baked') {
    await dressBaked(view, spec, cfg);
    applyLampLights(view, spec);
    return;
  }

  // 2. Wooden floor: one InstancedMesh of the 2 m tile, so the whole floor is a single draw
  //    call. The tile's top sits at y = 0 (model top is at `spec.floor.top`).
  if (spec.floor) {
    const tile = spec.floor.tile;
    const nx = Math.max(1, Math.round(room.size[0] / tile));
    const nz = Math.max(1, Math.round(room.size[1] / tile));
    const mats = [];
    const m = new THREE.Matrix4();
    for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
      const x = room.center[0] - room.size[0] / 2 + tile * (i + 0.5);
      const z = room.center[1] - room.size[1] / 2 + tile * (j + 0.5);
      mats.push(m.clone().setPosition(x, -spec.floor.top, z));
    }
    const inst = await instancedFromModel(spec.floor.model, mats).catch(() => null);
    if (inst) group.add(inst);
  }

  // 3. Wall panels: swap each greybox wall segment's mesh for a tiled run, keeping the same
  //    `w` entry so the cutaway loop still finds it.
  if (spec.wall) {
    for (const w of view.walls) {
      const run = await buildWallRun(w.wall, spec.wall);
      group.remove(w.mesh);
      w.mesh = run;
      group.add(run);
      view.setWallHeight(w, w.height);   // apply the current cutaway height straight away
    }
  }

  // 4. Corner columns.
  if (spec.columns) {
    const hw = room.size[0] / 2 - spec.columns.inset;
    const hd = room.size[1] / 2 - spec.columns.inset;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      await place(group, spec.columns.model, room.center[0] + sx * hw, room.center[1] + sz * hd, 0);
    }
  }

  // 5. Colliding furniture: one model per entry (+ any props on top). `lift` is a pair of doors.
  for (const f of room.furniture) {
    const [cx, cz] = f.center;
    if (f.kind === 'lift') {
      for (const dx of [-0.45, 0.45]) {
        const leaf = await place(group, 'building/door-rotate-square-a.glb', cx + dx, cz, 90);
        if (leaf) { leaf.scale.z = 0.9 / 1.025; leaf.traverse(o => { if (o.isMesh) o.material = liftMaterial; }); }
      }
      continue;
    }
    if (!f.model) continue;
    await place(group, f.model, cx, cz, f.yaw, 0, undefined, f.scale || 1);
    for (const p of f.props || []) {
      const [px, py, pz] = p.pos;
      await place(group, p.model, cx + px, cz + pz, f.yaw, py, p.overrides, p.scale || 1);
    }
  }

  // 6. Non-colliding decoration (rugs, cushions).
  for (const d of spec.decor || []) {
    await place(group, d.model, room.center[0] + d.pos[0], room.center[1] + d.pos[1], d.yaw, d.y ?? 0.015, d.overrides, d.scale || 1);
  }

  applyLampLights(view, spec);
}

// Lamp lights: drop the chosen mood-light points down to lamp height and warm them, so the lamps
// read as the light source. Index 0 (the ceiling fill) is left as-is.
function applyLampLights(view, spec) {
  if (spec.lampLights) {
    for (const idx of spec.lampLights.indices) {
      const L = view.lights[idx];
      if (!L) continue;
      L.pos.y = spec.lampLights.height;
      L.color.set(spec.lampLights.color);
      L.base *= spec.lampLights.intensityScale;
    }
  }
}

// Dress one room view if it has an entry in `roomDressings` (rooms are dressed as they appear;
// the lobby again at every new match). Resolves once its pieces are in place; a failure is logged,
// not thrown, and the room keeps its greybox.
export async function dressRoom(view, floor, cfg) {
  const spec = roomDressings[view.room.id];
  if (!spec) return false;
  try { await dressOne(view, floor, cfg, spec); return true; }
  catch (e) { console.warn(`dressing: room "${view.room.id}" failed:`, e.message); return false; }
}
