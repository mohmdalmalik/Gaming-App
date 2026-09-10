// Quick check of the pure game modules in Node (no browser): node tests/logic-check.mjs
import { config } from '../src/config.js';
import { floor1 } from '../src/data/floor1.js';
import { buildFloor, roomAt } from '../src/game/floor.js';
import { buildGrid, findPath, smoothPath, roomSequence, nearestWalkable } from '../src/game/grid.js';
import { createState, canAffordRoute, enterRoom, endTurn, frontierDoorways } from '../src/game/state.js';

const floor = buildFloor(floor1, config);
console.log('rooms:', floor.roomList.length, 'doorways:', floor.doorways.length, 'walls:', floor.walls.length);
console.log('problems:', floor.problems);
const grid = buildGrid(floor, config);
console.log('grid:', grid.cols, 'x', grid.rows, 'walkable cells:', grid.walkable.reduce((a, b) => a + b, 0));
console.log('problems after grid:', floor.problems);
for (const d of floor.doorways) {
  const l = grid.landings.get(d.id);
  console.log(' doorway', d.id.padEnd(28), 'landing cells', d.a, l[d.a].length, '|', d.b, l[d.b].length);
}
// Path from start to the exit ignoring discovery
const startIdx = nearestWalkable(grid, floor.start.pos[0], floor.start.pos[1], 1);
const exitRoom = floor.rooms.get(floor.exitRoom);
const exitIdx = nearestWalkable(grid, exitRoom.center[0], exitRoom.center[1], 2);
const path = findPath(grid, startIdx, exitIdx);
console.log('start→exit cells:', path?.length, 'rooms:', roomSequence(grid, path).join(' > '));
const smooth = smoothPath(grid, path, () => true, config.player.clearance * 0.5);
console.log('smoothed waypoints:', smooth.length);
// Path to each dead end
for (const id of ['storage', 'serviceRoom']) {
  const r = floor.rooms.get(id);
  const idx = nearestWalkable(grid, r.center[0], r.center[1], 2);
  const p = findPath(grid, startIdx, idx);
  console.log(`start→${id}:`, p?.length, roomSequence(grid, p).join(' > '));
}
// Rules
const state = createState(floor);
const seq = roomSequence(grid, path);
console.log('afford start→exit with 10 AP:', canAffordRoute(state, floor, seq));
state.actionPoints = 2;
console.log('afford with 2 AP:', canAffordRoute(state, floor, seq).reason);
console.log('afford within room:', canAffordRoute(state, floor, ['suite']).ok);
state.actionPoints = 0;
console.log('AP 0 leaving room:', canAffordRoute(state, floor, ['suite', 'corridorA']).reason);
endTurn(state, floor);
console.log('after end turn AP:', state.actionPoints, 'turn', state.turn);
console.log('frontier from start:', frontierDoorways(state, floor).map(d => d.id));
console.log('enter corridorA:', enterRoom(state, floor, 'corridorA'), 'AP', state.actionPoints);
console.log('roomAt(3,0) boundary:', roomAt(floor, 3, 0), 'roomAt(2.99,0):', roomAt(floor, 2.99, 0));
// ASCII map of walkable grid (downsampled)
let art = '';
for (let j = 0; j < grid.rows; j += 2) { let line=''; for (let i = 0; i < grid.cols; i += 1) { const idx = j*grid.cols+i; line += grid.walkable[idx] ? '.' : (grid.room[idx] >= 0 ? '#' : ' '); } art += line + '\n'; }
console.log(art);
