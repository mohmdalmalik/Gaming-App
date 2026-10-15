// Dress a room's greybox shell with its baked model. Driven entirely by data:
//   • src/data/dressing.js — which baked model, light maps and exposure each room has, and (the lobby) where the
//     lamp lights sit
//   • the room data (src/data/hotel.js) — the colliding furniture footprints, which stay the game's collision
//
// Only rooms present in `roomDressings` are touched; any other room stays greybox. The swap preserves the game
// completely: collision comes from the same furniture data, and the walls keep working with the cutaway.
// (Until 14 Oct 2026 this file could also dress a room from the Kenney furniture and building pieces, with a
// loader in src/render/models.js; every room is baked now, so that path and those files were removed.)
//
// Loading is async (the models are local files, so it's quick); if a piece fails to load it is
// skipped with a warning rather than breaking the room.
import { roomDressings } from '../data/dressing.js';
import { dressBaked, dressBakedTile } from './bakedRoom.js';

async function dressOne(view, floor, cfg, spec) {
  // Only baked rooms exist (src/data/dressing.js); a spec of any other style leaves the room as it is.
  if (spec.style !== 'baked') throw new Error(`no way to dress style "${spec.style}"`);

  // Hide the greybox floor and furniture boxes. Their soft contact shadows are LEFT in place — they now
  // ground the real models sitting on the same footprints.
  if (view.floorMesh) view.floorMesh.visible = false;
  for (const f of view.furniture) f.mesh.visible = false;

  // A baked room: one model built and lit offline replaces the shell, the furniture and the decoration.
  // A tile (every room but the lobby) comes with its own light maps; the lobby also has lamp lights, which
  // still apply (they light the guests).
  if (spec.tile) { await dressBakedTile(view, spec, cfg); return; }
  await dressBaked(view, spec, cfg);
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
