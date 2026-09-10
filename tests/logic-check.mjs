// Floor, grid and pathfinding checks in Node (no browser): node tests/logic-check.mjs
// Rules-engine checks live in tests/rules-check.mjs.
import { config } from '../src/config.js';
import { floor1 } from '../src/data/floor1.js';
import { buildFloor, roomAt } from '../src/game/floor.js';
import { buildGrid, findPath, smoothPath, roomSequence, nearestWalkable } from '../src/game/grid.js';

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };

const floor = buildFloor(floor1, config);
const grid = buildGrid(floor, config);
console.log('rooms:', floor.roomList.length, 'doorways:', floor.doorways.length, 'walls:', floor.walls.length, 'grid:', grid.cols, 'x', grid.rows);
check(floor.problems.length === 0, `floor data problems: ${JSON.stringify(floor.problems)}`);
check(floor.roomList.length >= 12 && floor.roomList.length <= 14, `${floor.roomList.length} rooms (12-14 wanted)`);
const startRoom = floor.rooms.get(floor.start.room);
check(startRoom.doorways.length >= 4, `start room "${startRoom.name}" has ${startRoom.doorways.length} doorways`);
check(floor.start.positions.length === 5, `${floor.start.positions.length} start positions`);
check(floor.roomList.filter(r => r.dark).length === 3, `${floor.roomList.filter(r => r.dark).length} dark rooms`);
check(floor.roomList.filter(r => r.doorways.length === 1 && !r.isExit).length >= 2, 'at least two dead ends');
check(floor.roomList.filter(r => r.isExit).length === 1, 'exactly one exit');
for (const d of floor.doorways) {
  const l = grid.landings.get(d.id);
  check(l[d.a].length > 0 && l[d.b].length > 0, `doorway ${d.id} passable (${l[d.a].length}/${l[d.b].length})`);
}
const startIdx = nearestWalkable(grid, floor.start.pos[0], floor.start.pos[1], 1);
for (const r of floor.roomList) {
  const idx = nearestWalkable(grid, r.center[0], r.center[1], 2.5);
  check(idx >= 0 && !!findPath(grid, startIdx, idx), `reachable on foot: ${r.id}`);
}
const exit = floor.rooms.get(floor.exitRoom);
const path = findPath(grid, startIdx, nearestWalkable(grid, exit.center[0], exit.center[1], 2));
check(!!path, `start -> exit path: ${roomSequence(grid, path).join(' > ')} (${smoothPath(grid, path).length} waypoints)`);
check(roomAt(floor, 0, 0) === floor.start.room, 'roomAt finds the hall at the origin');

console.log(failures ? `\n${failures} FAILED` : '\nALL LOGIC CHECKS PASSED');
process.exit(failures ? 1 : 0);
