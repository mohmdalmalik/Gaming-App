// THE RANDOM HOTEL: a new floor every match, built from a shuffled deck of square room tiles that
// are placed as the hotel is explored. Pure logic (no rendering, no DOM) so a server can run it.
// Implements "Rooms" in docs/GAME_RULES.md — the owner's design; see CLAUDE.md before changing a
// rule here. What is IN the deck lives in src/data/hotel.js.
//
// The hotel is a grid of tiles. The lobby sits at cell (0, 0); every tile is `tileSize` metres
// square and its doorways are centred on its sides, so any doorway lines up with the tile beside
// it. A doorway that leads to an empty cell is a CLOSED door ("frontier" door). Opening one draws
// the top tile of the deck and turns it to a random orientation that fits:
//   • one of its doorways meets the door that was opened;
//   • every side that touches an existing room matches it: doorway meets doorway (they connect),
//     wall meets wall — no doorway ever opens into a wall;
//   • a locked room never joins the lobby (docs/GAME_RULES.md: never the lobby or a room next to it);
//   • until the Fire Exit is placed, the hotel must not close itself off: after placing, at least
//     one reachable closed door must still lead to a cell with no other room around it, so the
//     next tile — ultimately the Fire Exit — always fits somewhere.
// A tile that cannot fit goes to the bottom of the deck and the next is tried. If none can, the door
// is jammed: it stays shut for the rest of the match (the rules above guarantee another way on).
//
// The floor object this builds has the same shape the rest of the game already reads (rooms,
// roomList, doorways, walls, bounds, start, exitRoom) plus `frontier` (the closed doors), `cells`
// and `deck`. It grows in place as doors are opened.
import { makeRng, shuffle } from './cards.js';

export const SIDES = ['north', 'east', 'south', 'west'];          // clockwise
export const OPPOSITE = { north: 'south', south: 'north', east: 'west', west: 'east' };
const DIR = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const NORMAL = { north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] };
const EPS = 1e-6;

// Turn a side `r` quarter turns clockwise (seen from above; north is -z, east is +x).
export const turnSide = (side, r) => SIDES[(SIDES.indexOf(side) + r) % 4];
// Turn a point around the tile centre the same way: (x, z) -> (-z, x) per quarter turn.
function turnPoint([x, z], r) {
  for (let k = 0; k < r; k++) [x, z] = [-z, x];
  return [x + 0, z + 0];   // +0 turns -0 into 0
}

const key = (i, j) => `${i},${j}`;

export function createHotel(data, cfg) {
  return {
    id: data.id, name: data.name, data, cfg,
    tileSize: data.tileSize,
    rooms: new Map(), roomList: [], doorways: [], walls: [], frontier: [],
    cells: new Map(), deck: [],
    bounds: { min: [0, 0], max: [0, 0] },
    start: null, exitRoom: null, problems: [],
    rules: { moveWithinRoomCost: 0, enterRoomCost: 1 },
    version: 0,     // bumps whenever the hotel grows, so views know to catch up
    rng: null,
  };
}

// A fresh hotel for a new match: the lobby with 3 or 4 open doorways, and a shuffled deck with the
// Fire Exit somewhere in its last five tiles.
export function resetHotel(floor, seed) {
  const data = floor.data;
  const rng = makeRng(((seed >>> 0) ^ 0x5eed7e11) >>> 0 || 1);
  floor.rng = rng;
  floor.rooms.clear(); floor.roomList.length = 0; floor.doorways.length = 0;
  floor.walls.length = 0; floor.frontier.length = 0; floor.cells.clear();
  floor.exitRoom = null; floor.problems.length = 0;
  floor.bounds = { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };

  // The lobby: how many doorways, then which sides are walls.
  const counts = data.lobbyDoorways;
  const open = counts[Math.floor(rng() * counts.length)];
  const sides = shuffle([...SIDES], rng).slice(0, open);   // (shuffle works in place: copy first)
  const lobbyDef = { ...data.lobby, doors: SIDES.filter(s => sides.includes(s)), searchable: false };
  const lobby = placeRoom(floor, lobbyDef, [0, 0], 0);

  // The deck: every ordinary tile shuffled, the Fire Exit shuffled into the last few.
  const exitDef = data.tiles.find(t => t.isExit);
  const rest = shuffle(data.tiles.filter(t => !t.isExit), rng);
  const at = rest.length - (data.exitInLast - 1) + Math.floor(rng() * data.exitInLast);
  rest.splice(Math.max(0, Math.min(rest.length, at)), 0, exitDef);
  floor.deck = rest;

  const positions = data.lobby.startPositions.map(([x, z]) => [lobby.center[0] + x, lobby.center[1] + z]);
  floor.start = { room: lobby.id, pos: positions[0], positions };
  floor.version++;
  return floor;
}

export const roomAtCell = (floor, i, j) => floor.rooms.get(floor.cells.get(key(i, j))) || null;
export const exitPlaced = floor => floor.exitRoom != null;

// Which room contains the point? Rooms touch but never overlap.
export function roomAt(floor, x, z) {
  const S = floor.tileSize;
  const room = roomAtCell(floor, Math.floor(x / S + 0.5), Math.floor(z / S + 0.5));
  if (room && x >= room.min[0] && x < room.max[0] && z >= room.min[1] && z < room.max[1]) return room.id;
  return null;
}

// --- building rooms -----------------------------------------------------------------------------
function doorCenter(room, side) {
  const [cx, cz] = room.center, h = room.size[0] / 2;
  if (side === 'north') return [cx, cz - h];
  if (side === 'south') return [cx, cz + h];
  if (side === 'east') return [cx + h, cz];
  return [cx - h, cz];
}

export function placeTile(floor, def, cell, rot) { return placeRoom(floor, def, cell, rot); }   // tests: place without the fit rules

function placeRoom(floor, def, cell, rot) {
  const S = floor.tileSize, t = floor.cfg.walls.thickness, width = floor.data.doorWidth;
  const [i, j] = cell;
  const cx = i * S, cz = j * S;
  const doorSides = new Set(def.doors.map(s => turnSide(s, rot)));
  const room = {
    id: def.id,
    name: def.name,
    role: def.role || (def.isExit ? 'exit' : 'item'),
    tile: def.id,
    rotation: rot,
    cell: [i, j],
    isExit: !!def.isExit,
    dark: !!def.dark,
    locked: !!def.locked,       // a locked tile: locked the moment it is revealed
    safe: !!def.safe,
    searchable: def.searchable !== false && !def.isExit,
    searchPoint: def.searchPoint || null,
    center: [cx, cz],
    size: [S, S],
    min: [cx - S / 2, cz - S / 2],
    max: [cx + S / 2, cz + S / 2],
    mood: def.mood || { color: '#ffffff', intensity: 1, ambient: 0.6 },
    doorSides,
    furniture: (def.furniture || []).map((f, k) => {
      const [fx, fz] = turnPoint(f.pos, rot);
      let [fw, fh, fd] = f.size;
      if (rot % 2) [fw, fd] = [fd, fw];
      const look = def.colors?.[f.kind] || {};
      return {
        id: `${def.id}:${f.kind}:${k}`, kind: f.kind, color: f.color ?? look.color, emissive: f.emissive ?? look.emissive,
        center: [cx + fx, cz + fz], size: [fw, fh, fd],
        min: [cx + fx - fw / 2, cz + fz - fd / 2], max: [cx + fx + fw / 2, cz + fz + fd / 2],
      };
    }),
    doorways: [],       // open doorways to placed rooms
    frontier: [],       // closed doors to empty cells
    openings: { north: [], south: [], east: [], west: [] },
    walls: [],
    neighbours: new Set(),
  };
  for (const side of doorSides) {
    const c = doorCenter(room, side);
    const along = side === 'north' || side === 'south' ? c[0] : c[1];
    room.openings[side].push([along - width / 2, along + width / 2]);
  }
  floor.rooms.set(room.id, room);
  floor.roomList.push(room);
  floor.cells.set(key(i, j), room.id);
  floor.bounds.min[0] = Math.min(floor.bounds.min[0], room.min[0]);
  floor.bounds.min[1] = Math.min(floor.bounds.min[1], room.min[1]);
  floor.bounds.max[0] = Math.max(floor.bounds.max[0], room.max[0]);
  floor.bounds.max[1] = Math.max(floor.bounds.max[1], room.max[1]);
  if (room.isExit) floor.exitRoom = room.id;

  // Each doorway either meets a neighbour's doorway (they connect) or leads to an empty cell (a
  // closed door).
  const connected = [];
  for (const side of SIDES) {
    const [di, dj] = DIR[side];
    const other = roomAtCell(floor, i + di, j + dj);
    if (other) {
      for (const w of other.walls) if (w.side === OPPOSITE[side]) w.neighbour = room.id;
    }
    if (!doorSides.has(side)) continue;
    const center = doorCenter(room, side);
    const axis = side === 'north' || side === 'south' ? 'x' : 'z';
    if (other && other.doorSides.has(OPPOSITE[side])) {
      const shut = other.frontier.find(d => d.side === OPPOSITE[side]);
      if (shut) removeFrontier(floor, shut);
      connected.push(connect(floor, other, room, OPPOSITE[side], center, axis, width, t));
    } else if (!other) {
      const door = { id: `${room.id}>${side}`, room: room.id, side, center, axis, width, cell: [i + di, j + dj], jammed: false };
      room.frontier.push(door);
      floor.frontier.push(door);
    }
  }
  buildWalls(floor, room);
  floor.version++;
  room.connected = connected;
  return room;
}

function removeFrontier(floor, door) {
  const room = floor.rooms.get(door.room);
  room.frontier = room.frontier.filter(d => d !== door);
  const k = floor.frontier.indexOf(door);
  if (k >= 0) floor.frontier.splice(k, 1);
}

// An open doorway between two placed rooms (`a` existed first).
function connect(floor, a, b, sideA, center, axis, width, t) {
  const half = width / 2;
  const doorway = {
    id: `${a.id}->${b.id}`, a: a.id, b: b.id, sideA, sideB: OPPOSITE[sideA], center, axis, width,
    opening: axis === 'x'
      ? { min: [center[0] - half, center[1] - t], max: [center[0] + half, center[1] + t] }
      : { min: [center[0] - t, center[1] - half], max: [center[0] + t, center[1] + half] },
    otherRoom(id) { return id === this.a ? this.b : this.a; },
    sideFor(id) { return id === this.a ? this.sideA : this.sideB; },
  };
  floor.doorways.push(doorway);
  a.doorways.push(doorway); b.doorways.push(doorway);
  a.neighbours.add(b.id); b.neighbours.add(a.id);
  return doorway;
}

// Wall segments of one room: each side minus its doorway opening. North/south walls run the full
// width; east/west walls are shortened by the wall thickness so the corners don't overlap.
function buildWalls(floor, room) {
  const t = floor.cfg.walls.thickness;
  let n = 0;
  for (const side of SIDES) {
    const axisX = side === 'north' || side === 'south';
    const extent = axisX ? [room.min[0], room.max[0]] : [room.min[1] + t, room.max[1] - t];
    const cuts = [extent[0], extent[1]];
    for (const [o0, o1] of room.openings[side]) cuts.push(o0, o1);
    cuts.sort((p, q) => p - q);
    const [di, dj] = DIR[side];
    const neighbour = roomAtCell(floor, room.cell[0] + di, room.cell[1] + dj);
    for (let k = 0; k < cuts.length - 1; k++) {
      const s0 = cuts[k], s1 = cuts[k + 1];
      if (s1 - s0 < EPS) continue;
      const mid = (s0 + s1) / 2;
      if (room.openings[side].some(([o0, o1]) => mid > o0 && mid < o1)) continue;
      let min, max;
      if (side === 'north') { min = [s0, room.min[1]]; max = [s1, room.min[1] + t]; }
      else if (side === 'south') { min = [s0, room.max[1] - t]; max = [s1, room.max[1]]; }
      else if (side === 'east') { min = [room.max[0] - t, s0]; max = [room.max[0], s1]; }
      else { min = [room.min[0], s0]; max = [room.min[0] + t, s1]; }
      const wall = {
        id: `${room.id}:${side}:${n++}`, room: room.id, neighbour: neighbour ? neighbour.id : null,
        side, normal: NORMAL[side], min, max,
        center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2], size: [max[0] - min[0], max[1] - min[1]],
      };
      room.walls.push(wall);
      floor.walls.push(wall);
    }
  }
}

// --- placing a tile behind a door -----------------------------------------------------------------
// Does tile `def`, turned `rot` quarter turns, fit in `cell`? `ctx.isLocked(roomId)` says which
// placed rooms are locked right now (they cannot be walked through).
export function tileFits(floor, def, cell, rot, ctx = {}) {
  const sides = new Set(def.doors.map(s => turnSide(s, rot)));
  const [i, j] = cell;
  if (floor.cells.has(key(i, j))) return false;
  let touchesSomething = false;
  for (const side of SIDES) {
    const [di, dj] = DIR[side];
    const other = roomAtCell(floor, i + di, j + dj);
    if (!other) continue;
    const theirs = other.doorSides.has(OPPOSITE[side]);
    if (sides.has(side) !== theirs) return false;          // doorway meets doorway, wall meets wall
    if (theirs) touchesSomething = true;
    if (def.locked && theirs && other.id === floor.start?.room) return false;   // never next to the lobby
  }
  if (!touchesSomething) return false;
  if (!exitPlaced(floor) && !def.isExit && !keepsHotelOpen(floor, cell, sides, !!def.locked, ctx)) return false;
  return true;
}

// Would the hotel still have somewhere to grow if a tile with doorways `sides` went into `cell`?
// True when a room reachable from the lobby (not through a locked room) keeps a closed door into a
// cell that has no other room around it — any tile, the Fire Exit included, fits there.
function keepsHotelOpen(floor, cell, sides, newLocked, ctx) {
  const newKey = key(cell[0], cell[1]);
  const occupied = (i, j) => floor.cells.has(key(i, j)) || key(i, j) === newKey;
  const doorsOf = (i, j) => key(i, j) === newKey ? sides : roomAtCell(floor, i, j)?.doorSides;
  const locked = (i, j) => key(i, j) === newKey ? newLocked : !!ctx.isLocked?.(roomAtCell(floor, i, j)?.id);
  const jammed = (i, j, side) => key(i, j) !== newKey && roomAtCell(floor, i, j).frontier.some(d => d.side === side && d.jammed);
  const start = floor.rooms.get(floor.start.room).cell;
  const seen = new Set([key(...start)]);
  const queue = [start];
  while (queue.length) {
    const [i, j] = queue.shift();
    for (const side of doorsOf(i, j)) {
      const [di, dj] = DIR[side];
      const ni = i + di, nj = j + dj;
      if (!occupied(ni, nj)) {
        if (jammed(i, j, side)) continue;
        // an open end: the cell beyond has no other room around it
        const around = SIDES.filter(s => occupied(ni + DIR[s][0], nj + DIR[s][1])).length;
        if (around === 1) return true;
        continue;
      }
      if (!doorsOf(ni, nj).has(OPPOSITE[side]) || seen.has(key(ni, nj)) || locked(ni, nj)) continue;
      seen.add(key(ni, nj));
      queue.push([ni, nj]);
    }
  }
  return false;
}

// Open a closed door: draw tiles until one fits, turn it, place it. Returns
// { ok, room, doorway, connected, tried } or { ok: false, reason: 'jammed' | 'noDoor' }.
export function openFrontierDoor(floor, doorId, ctx = {}) {
  const door = floor.frontier.find(d => d.id === doorId);
  if (!door) return { ok: false, reason: 'noDoor' };
  if (door.jammed) return { ok: false, reason: 'jammed' };
  const n = floor.deck.length;
  for (let k = 0; k < n; k++) {
    const def = floor.deck.shift();
    const turns = shuffle([0, 1, 2, 3], floor.rng).filter(r => tileFits(floor, def, door.cell, r, ctx));
    if (turns.length) {
      const room = placeRoom(floor, def, door.cell, turns[0]);
      const doorway = room.connected.find(d => d.a === door.room);
      return { ok: true, room, doorway, connected: room.connected, tried: k + 1 };
    }
    floor.deck.push(def);     // it cannot fit here: to the bottom of the deck
  }
  door.jammed = true;
  floor.version++;
  return { ok: false, reason: 'jammed' };
}

// Tests and debugging only: put a named tile on top of the deck.
export function stackDeck(floor, tileId) {
  const k = floor.deck.findIndex(t => t.id === tileId);
  if (k < 0) return false;
  floor.deck.unshift(...floor.deck.splice(k, 1));
  return true;
}

// Closed doors that can still be opened.
export const openDoors = floor => floor.frontier.filter(d => !d.jammed);

// Tests and debugging only: open closed doors until tile `tileId` is on the board — next to room
// `nextTo` if given — putting it on top of the deck wherever it fits. Returns the rooms placed (the
// caller reveals them, and locks the locked ones, as the game would).
export function growTo(floor, tileId, ctx = {}, nextTo = null) {
  const placed = [];
  for (let guard = 0; guard < 80 && !floor.rooms.has(tileId); guard++) {
    const def = floor.deck.find(t => t.id === tileId);
    const doors = openDoors(floor);
    if (!def || !doors.length) break;
    const spot = doors.find(d => (!nextTo || d.room === nextTo) && [0, 1, 2, 3].some(r => tileFits(floor, def, d.cell, r, ctx)));
    if (!spot && nextTo) break;
    if (spot) stackDeck(floor, tileId);
    const r = openFrontierDoor(floor, (spot || doors[guard % doors.length]).id, ctx);
    if (r.ok) placed.push(r.room);
  }
  return placed;
}
