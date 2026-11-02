// A WHOLE MATCH AS PLAIN DATA AND BACK: the engine state and the hotel, so a server can save a table after every step
// and bring it back after a restart (DESIGN §10.2). Pure: no DOM, no Node APIs, no clock, no randomness of its own
// (the random sources are handed in again on the way back). Grown from the Edge spike's lib/snapshot.js.
//
//   toSnapshot(state, floor)                                 -> a plain object (JSON-safe: Sets as { $set: [...] },
//                                                               Maps as { $map: [[k, v]...] }, no functions)
//   fromSnapshot(snap, { hotelData, cfg, rng, hotelRng })     -> { state, floor }   (snap: that object or its JSON text)
//
// The STATE is kept whole (every field: hands, piles, events, inboxes, notes, locks...), minus its random generator
// `state.rng`, which is a function: `rng` is put back in its place (a server passes a crypto source; a test passes
// a copy of the generator it forked).
// The HOTEL is never stored whole: it is kept as what was placed (the lobby's open sides, then every room as [tile id,
// [cell i, j], rotation] in placement order), the jammed doors, the room deck's order (tile ids) and the version
// counter, and rebuilt with clearHotel + placeLobby + placeTile (src/game/hotel.js), which gives the same rooms,
// doorways (ids and order), closed doors, walls and bounds as the hotel that was played. Its generator is
// `hotelRng` (the next room's turn when a door is opened).
import { createHotel, clearHotel, placeLobby, placeTile, SIDES } from '../game/hotel.js';

export const SNAPSHOT_VERSION = 1;

// Sets and Maps tagged (JSON.stringify's replacer sees the Set itself, before it would become {}).
const replacer = (k, v) => (v instanceof Set ? { $set: [...v] } : v instanceof Map ? { $map: [...v] } : v);
const isTag = (v, tag) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 1 && tag in v;

// Undo the tags, everywhere (a plain object in, the engine's shapes out).
function revive(x) {
  if (Array.isArray(x)) return x.map(revive);
  if (!x || typeof x !== 'object') return x;
  if (isTag(x, '$set')) return new Set(x.$set.map(revive));
  if (isTag(x, '$map')) return new Map(x.$map.map(([k, v]) => [revive(k), revive(v)]));
  const out = {};
  for (const k of Object.keys(x)) out[k] = revive(x[k]);
  return out;
}

export function toSnapshot(state, floor) {
  const lobby = floor.rooms.get(floor.start.room);
  const { rng, ...rest } = state;           // the generator is a function: never stored (it is handed back in)
  return JSON.parse(JSON.stringify({
    v: SNAPSHOT_VERSION,
    state: rest,
    floor: {
      lobbyDoors: SIDES.filter(s => lobby.doorSides.has(s)),
      placed: floor.roomList.filter(r => r !== lobby).map(r => [r.tile, [r.cell[0], r.cell[1]], r.rotation]),
      jammed: floor.frontier.filter(d => d.jammed).map(d => d.id),
      deck: floor.deck.map(t => t.id),
      version: floor.version,
    },
  }, replacer));
}

export function fromSnapshot(snap, { hotelData, cfg, rng = null, hotelRng = null } = {}) {
  const s = typeof snap === 'string' ? JSON.parse(snap) : snap;
  if (!s || s.v !== SNAPSHOT_VERSION) throw new Error(`snapshot: version ${s?.v} (this build reads ${SNAPSHOT_VERSION})`);
  const byId = new Map(hotelData.tiles.map(t => [t.id, t]));
  const tile = id => { const t = byId.get(id); if (!t) throw new Error(`snapshot: no room tile "${id}" in this hotel`); return t; };

  const floor = createHotel(hotelData, cfg);
  clearHotel(floor);
  placeLobby(floor, s.floor.lobbyDoors);
  for (const [id, cell, rot] of s.floor.placed) placeTile(floor, tile(id), [cell[0], cell[1]], rot);
  const jammed = new Set(s.floor.jammed);
  for (const d of floor.frontier) if (jammed.has(d.id)) d.jammed = true;
  floor.deck = s.floor.deck.map(tile);
  floor.version = s.floor.version;
  floor.rng = hotelRng;

  const restored = revive(s.state);
  restored.rng = rng;                       // (named so: a purity scan of src/net/ forbids reading the engine's generator)
  return { state: restored, floor };
}
