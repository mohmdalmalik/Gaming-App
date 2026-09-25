// Hotel, grid and pathfinding checks in Node (no browser): node tests/logic-check.mjs
// The hotel is random every match (src/game/hotel.js), so these check the TILES and many generated
// hotels rather than one fixed map. Rules-engine checks live in tests/rules-check.mjs.
import { config } from '../src/config.js';
import { hotel } from '../src/data/hotel.js';
import {
  createHotel, resetHotel, openFrontierDoor, openDoors, exitPlaced, placeTile, roomAt, SIDES,
} from '../src/game/hotel.js';
import { buildGrid, findPath, nearestWalkable, roomSequence } from '../src/game/grid.js';
import { makeRng } from '../src/game/cards.js';

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const floor = createHotel(hotel, config);
const t = config.walls.thickness, reachIn = t + config.player.clearance + 0.35;
const INWARD = { north: [0, 1], south: [0, -1], east: [-1, 0], west: [1, 0] };
const DOOR = { north: [0, -4], south: [0, 4], east: [4, 0], west: [-4, 0] };

// Inside one room: the centre, the standing spots round it and the space in front of every doorway
// are walkable, and all of them join up.
function roomIsOpen(room, grid) {
  const [cx, cz] = room.center;
  const spot = (x, z) => nearestWalkable(grid, x, z, 0.3);
  const centre = spot(cx, cz);
  if (centre < 0) return 'centre blocked';
  for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (spot(cx + ox * 0.95, cz + oz * 0.95) < 0) return 'a standing spot is blocked';
  for (const side of room.doorSides) {
    const [dx, dz] = DOOR[side], [ix, iz] = INWARD[side];
    const idx = spot(cx + dx + ix * reachIn, cz + dz + iz * reachIn);
    if (idx < 0) return `the ${side} doorway is blocked`;
    if (!findPath(grid, centre, idx)) return `the ${side} doorway cannot be reached from the centre`;
  }
  return null;
}

console.log('the tiles');
check(hotel.tileSize === 8 && hotel.tiles.length === 24, 'a deck of 24 square 8 m tiles');
check(new Set(hotel.tiles.map(x => x.id)).size === 24 && !hotel.tiles.some(x => x.id === hotel.lobby.id), 'every tile has its own id');
check(hotel.tiles.every(x => x.doors.every(s => SIDES.includes(s)) && new Set(x.doors).size === x.doors.length), 'doorways are named sides, each at most once');
let tileProblems = [];
for (const def of hotel.tiles) {
  for (let rot = 0; rot < 4; rot++) {
    resetHotel(floor, 1);
    const room = placeTile(floor, def, [3, 3], rot);
    const grid = buildGrid(floor, config);
    const bad = roomIsOpen(room, grid);
    if (bad) tileProblems.push(`${def.id} turned ${rot * 90}°: ${bad}`);
    const fits = room.furniture.every(f => f.min[0] >= room.min[0] + t - 1e-6 && f.max[0] <= room.max[0] - t + 1e-6
      && f.min[1] >= room.min[1] + t - 1e-6 && f.max[1] <= room.max[1] - t + 1e-6);
    if (!fits) tileProblems.push(`${def.id} turned ${rot * 90}°: furniture pokes through a wall`);
  }
}
check(tileProblems.length === 0, `every tile in every orientation keeps its centre and doorways clear (${tileProblems.slice(0, 4).join('; ') || 'all 96 fine'})`);

console.log('\nthe lobby');
const layouts = [['north', 'east', 'south', 'west'], ...SIDES.map(c => SIDES.filter(s => s !== c))];
for (const doors of layouts) {
  resetHotel(floor, 1);
  floor.rooms.clear(); floor.roomList.length = 0; floor.cells.clear(); floor.frontier.length = 0; floor.walls.length = 0;
  floor.bounds = { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
  const lobby = placeTile(floor, { ...hotel.lobby, doors, searchable: false }, [0, 0], 0);
  const grid = buildGrid(floor, config);
  const bad = roomIsOpen(lobby, grid);
  const starts = hotel.lobby.startPositions.every(([x, z]) => nearestWalkable(grid, x, z, 0.3) >= 0);
  check(!bad && starts, `lobby open on ${doors.join(', ')}: all six start spots and every doorway clear${bad ? ` (${bad})` : ''}`);
}

console.log('\n400 generated hotels, opened door by door');
let problems = [], closed = 0, walkOk = 0, exitWalk = 0, slowest = 0, placed = [];
for (let seed = 1; seed <= 400; seed++) {
  resetHotel(floor, seed);
  const rng = makeRng(seed * 13 + 5);
  for (let step = 0; step < 150; step++) {
    const doors = openDoors(floor);
    if (!doors.length) { if (!exitPlaced(floor)) closed++; break; }
    openFrontierDoor(floor, doors[Math.floor(rng() * doors.length)].id, {});
  }
  placed.push(floor.roomList.length - 1);
  const t0 = performance.now();
  const grid = buildGrid(floor, config);
  slowest = Math.max(slowest, performance.now() - t0);
  if (floor.problems.length) problems.push(`seed ${seed}: ${floor.problems[0]}`);
  // Rooms never overlap and every room is where roomAt says it is.
  const cells = new Set(floor.roomList.map(r => r.cell.join()));
  if (cells.size !== floor.roomList.length || !floor.roomList.every(r => roomAt(floor, r.center[0], r.center[1]) === r.id)) problems.push(`seed ${seed}: overlapping rooms`);
  const start = nearestWalkable(grid, floor.start.pos[0], floor.start.pos[1], 1);
  if (floor.roomList.every(r => { const i = nearestWalkable(grid, r.center[0], r.center[1], 1.5); return i >= 0 && findPath(grid, start, i); })) walkOk++;
  const exit = floor.rooms.get(floor.exitRoom);
  const path = exit && findPath(grid, start, nearestWalkable(grid, exit.center[0], exit.center[1], 1.5));
  if (path && roomSequence(grid, path).at(-1) === exit.id) exitWalk++;
}
check(closed === 0, 'the hotel never closed itself off before the Fire Exit was placed');
check(problems.length === 0, `no overlaps, every doorway has floor on both sides (${problems.slice(0, 3).join('; ') || 'none'})`);
check(walkOk === 400, `every room of every hotel can be walked to from the lobby (${walkOk}/400)`);
check(exitWalk === 400, `the Fire Exit can be walked to in every hotel (${exitWalk}/400)`);
const avg = placed.reduce((a, b) => a + b, 0) / placed.length;
console.log(`       tiles placed when every door had been tried: average ${avg.toFixed(1)}, fewest ${Math.min(...placed)}; slowest walkable-grid rebuild ${slowest.toFixed(1)} ms`);
check(slowest < 150, 'rebuilding the walkable grid after a door opens stays quick');

console.log(failures ? `\n${failures} FAILED` : '\nALL LOGIC CHECKS PASSED');
process.exit(failures ? 1 : 0);
