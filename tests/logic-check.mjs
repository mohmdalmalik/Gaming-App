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
check(floor.roomList.length === 18, `${floor.roomList.length} rooms (18 wanted for the six-player layout)`);
const startRoom = floor.rooms.get(floor.start.room);
check(startRoom.doorways.length >= 4, `start room "${startRoom.name}" has ${startRoom.doorways.length} doorways`);
check(floor.start.positions.length === 5, `${floor.start.positions.length} start positions`);
check(floor.roomList.filter(r => r.dark).length === 4, `${floor.roomList.filter(r => r.dark).length} dark rooms`);
check(floor.roomList.filter(r => r.doorways.length === 1 && !r.isExit).length === 2, 'exactly two dead-end branches');
// Room roles for the six-player balance layout (see src/data/rules.js).
const byRole = id => floor.roomList.filter(r => r.role === id).length;
check(byRole('lobby') === 1, `${byRole('lobby')} lobby`);
check(byRole('item') === 12, `${byRole('item')} item-search rooms (12 wanted)`);
check(byRole('objective') === 3, `${byRole('objective')} objective rooms (3 wanted)`);
check(byRole('utility') === 1, `${byRole('utility')} utility room`);
check(byRole('exit') === 1, `${byRole('exit')} exit`);
check(floor.roomList.every(r => r.doorways.length <= 4), 'no room has more than four connections');

// --- Topology: no single room may control the way out -------------------------------------
// The exit must never sit behind a chokepoint. This section fails if the Service Corridor or the
// Service Stairs (or any other non-lobby room) becomes a single point of failure.
const ids = floor.roomList.map(r => r.id);
const adj = new Map(ids.map(id => [id, [...floor.rooms.get(id).neighbours]]));
const reach = (src, blocked = null) => {
  const seen = new Set([src]); const queue = [src];
  while (queue.length) {
    const here = queue.shift();
    for (const n of adj.get(here)) if (n !== blocked && !seen.has(n)) { seen.add(n); queue.push(n); }
  }
  return seen;
};
const exitId = floor.exitRoom;
const lobby = floor.start.room;
check(reach(lobby).size === ids.length, 'every room is reachable from the lobby');

// The named offenders, called out explicitly so a regression names itself.
for (const id of ['serviceCorridor', 'stairs']) {
  check(reach(lobby, id).has(exitId), `${id} is NOT the only route to the exit`);
}
// And the general rule.
const exitChokepoints = ids.filter(v => v !== lobby && v !== exitId && !reach(lobby, v).has(exitId));
check(exitChokepoints.length === 0, `no non-lobby room controls all access to the exit (found: ${exitChokepoints.join(', ') || 'none'})`);

// Objective rooms want an alternative route too.
for (const r of floor.roomList.filter(r => r.role === 'objective')) {
  const cuts = ids.filter(v => v !== lobby && v !== r.id && !reach(lobby, v).has(r.id));
  check(cuts.length === 0, `objective room ${r.id} has an alternative route (chokepoints: ${cuts.join(', ') || 'none'})`);
}
check(floor.rooms.get('ballroom').doorways.length >= 2, 'the Ballroom is not reachable only through the Dining Room');
check(floor.rooms.get(lobby).doorways.length >= 2, `the lobby has at least two routes into the hotel (${floor.rooms.get(lobby).doorways.length})`);
check(floor.rooms.get(exitId).doorways.length >= 2, `the exit has at least two doorways (${floor.rooms.get(exitId).doorways.length})`);

// Two routes from the lobby to the exit that share no doorway.
function routeToExit(bannedEdges = new Set()) {
  const seen = new Set([lobby]); const queue = [[lobby, [lobby]]];
  while (queue.length) {
    const [here, path] = queue.shift();
    for (const n of adj.get(here)) {
      const key = [here, n].sort().join('|');
      if (seen.has(n) || bannedEdges.has(key)) continue;
      if (n === exitId) return [...path, n];
      seen.add(n); queue.push([n, [...path, n]]);
    }
  }
  return null;
}
const routeA = routeToExit();
const usedEdges = new Set(routeA.slice(0, -1).map((r, i) => [r, routeA[i + 1]].sort().join('|')));
const routeB = routeToExit(usedEdges);
check(!!routeA && !!routeB, `two independent routes to the exit (${routeA?.join(' > ')} | ${routeB?.join(' > ') ?? 'NONE'})`);

// No locked doors in this phase.
check(!floor.doorways.some(d => d.locked), 'no locked doors');
check(floor.rooms.get(exitId).safe === true, 'the exit is flagged safe (no meeting or challenge on entry)');
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
