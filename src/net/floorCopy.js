// THE DEVICE'S OWN COPY OF THE HOTEL (DESIGN §6.7). The screens draw, build the walking grid and plan walks on a hotel
// grown only from what the view says has been placed (view.hotel): the lobby's open sides, then every room tile in
// placement order with its cell and rotation, then the jammed doors. The real hotel (and its room deck) never leaves
// the table. Pure (no DOM, no THREE): the page and the Node tests use it.
//
//   const floor = createFloorCopy(hotelData, cfg)   ONE object for the page's life (created at boot, where main.js
//                                                   creates the floor today: discovery, the map and the search marks
//                                                   keep it)
//   syncFloor(floor, view.hotel)                    bring it up to date, in place. True when anything changed.
//
// A placement list that is not a continuation of what the copy holds (another lobby, a different first room, fewer
// rooms, a jammed door that is no longer jammed) means a new match: the same object is re-dealt in place (clearHotel +
// placeLobby, as resetHotel does), then grown. New rooms go in with placeTile, exactly as openDoor placed them, so the
// rooms, doorways, closed doors, walls and the Fire Exit come out as on the real floor. floor.version moves on with
// every change (placeTile bumps it, a jammed door bumps it), so room views, fog and the grid catch up as after an
// openDoor today. floor.deck holds `roomTilesLeft` placeholders (HIDDEN_TILE): its length is public, never its order.
import { createHotel, clearHotel, placeLobby, placeTile, SIDES } from '../game/hotel.js';

export const HIDDEN_TILE = Object.freeze({ id: null, hidden: true });

const tileIndexes = new WeakMap();   // hotel data -> Map(tile id -> tile)
function tileOf(data, id) {
  let index = tileIndexes.get(data);
  if (!index) { index = new Map(data.tiles.map(t => [t.id, t])); tileIndexes.set(data, index); }
  const def = index.get(id);
  if (!def) throw new Error(`floorCopy: unknown tile "${id}"`);
  return def;
}

export function createFloorCopy(hotelData, cfg) {
  return createHotel(hotelData, cfg);
}

const lobbyOf = floor => (floor.start ? floor.rooms.get(floor.start.room) : null);
const samePlacement = (room, [id, i, j, rot]) => room.tile === id && room.cell[0] === i && room.cell[1] === j && room.rotation === rot;

// Does the copy hold a beginning of this hotel (the same lobby, and its rooms are the first ones placed)?
function continues(floor, hotel, doors) {
  const lobby = lobbyOf(floor);
  if (!lobby || floor.roomList[0] !== lobby) return false;
  if (doors.length !== lobby.doorSides.size || doors.some(s => !lobby.doorSides.has(s))) return false;
  const rooms = floor.roomList.length - 1;
  if (rooms > hotel.placed.length) return false;
  for (let k = 0; k < rooms; k++) if (!samePlacement(floor.roomList[k + 1], hotel.placed[k])) return false;
  return true;
}

function place(floor, placed, from) {
  for (let k = from; k < placed.length; k++) {
    const [id, i, j, rot] = placed[k];
    placeTile(floor, tileOf(floor.data, id), [i, j], rot);
  }
}

export function syncFloor(floor, hotel) {
  if (!hotel) return false;
  const doors = SIDES.filter(s => (hotel.lobbyDoors || []).includes(s));
  const placed = hotel.placed || [];
  const jammed = new Set(hotel.jammed || []);
  let changed = false;
  let redeal = !continues(floor, hotel, doors);
  if (!redeal) {
    const had = floor.roomList.length - 1;
    if (placed.length > had) { place(floor, placed, had); changed = true; }
    // within a match a jammed door stays jammed (or goes when a room is placed behind it): one that is jammed
    // here but not there means this is another hotel
    if (floor.frontier.some(d => d.jammed && !jammed.has(d.id))) redeal = true;
  }
  if (redeal) {
    clearHotel(floor);
    placeLobby(floor, doors);
    place(floor, placed, 0);
    floor.version++;
    changed = true;
  }
  let jams = 0;
  for (const d of floor.frontier) if (!d.jammed && jammed.has(d.id)) { d.jammed = true; jams++; }
  if (jams) { floor.version++; changed = true; }
  const left = Math.max(0, hotel.roomTilesLeft | 0);
  if (floor.deck.length !== left) {
    floor.deck.length = 0;
    for (let k = 0; k < left; k++) floor.deck.push(HIDDEN_TILE);
  }
  return changed;
}
