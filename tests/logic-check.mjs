// Quick check of the pure game modules in Node (no browser): node tests/logic-check.mjs
import { config } from '../src/config.js';
import { floor1 } from '../src/data/floor1.js';
import { roster, outfits, bodyTypes } from '../src/data/characters.js';
import { buildFloor, roomAt } from '../src/game/floor.js';
import { buildGrid, findPath, smoothPath, roomSequence, nearestWalkable } from '../src/game/grid.js';
import { createState, canAffordRoute, enterRoom, endTurn, frontierDoorways, activePlayer, nextPlayer } from '../src/game/state.js';
import { buildAllowed, planMove } from '../src/game/moves.js';

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };

const floor = buildFloor(floor1, config);
const grid = buildGrid(floor, config);
console.log('rooms:', floor.roomList.length, 'doorways:', floor.doorways.length, 'walls:', floor.walls.length, 'grid:', grid.cols, 'x', grid.rows);
check(floor.problems.length === 0, `floor data problems: ${JSON.stringify(floor.problems)}`);
check(floor.roomList.length >= 12 && floor.roomList.length <= 14, `${floor.roomList.length} rooms (12–14 wanted)`);
const startRoom = floor.rooms.get(floor.start.room);
check(startRoom.doorways.length >= 4, `start room "${startRoom.name}" has ${startRoom.doorways.length} doorways`);
check(floor.start.positions.length === 5, `${floor.start.positions.length} start positions`);
const deadEnds = floor.roomList.filter(r => r.doorways.length === 1 && !r.isExit).map(r => r.id);
check(deadEnds.length >= 2, `dead ends: ${deadEnds.join(', ')}`);
check(floor.roomList.filter(r => r.isExit).length === 1, 'exactly one exit');
for (const d of floor.doorways) {
  const l = grid.landings.get(d.id);
  check(l[d.a].length > 0 && l[d.b].length > 0, `doorway ${d.id} passable (${l[d.a].length}/${l[d.b].length} landing cells)`);
}
check(roster.length === 5 && new Set(roster.map(r => r.outfit)).size === 5, 'five players, five different outfits');
check(Object.values(outfits).filter(o => o.body === 'male').length === 3 && Object.values(outfits).filter(o => o.body === 'female').length === 3, '3 male + 3 female outfits');
check(roster.every(r => outfits[r.outfit] && bodyTypes[outfits[r.outfit].body]), 'every roster outfit exists');
const flickerRooms = floor.roomList.filter(r => r.mood.flicker).map(r => r.id);
console.log('  flicker only in:', flickerRooms.join(', '));

// Routes ignoring discovery
const startIdx = nearestWalkable(grid, floor.start.pos[0], floor.start.pos[1], 1);
const exitRoom = floor.rooms.get(floor.exitRoom);
const exitIdx = nearestWalkable(grid, exitRoom.center[0], exitRoom.center[1], 2);
const path = findPath(grid, startIdx, exitIdx);
const seq = roomSequence(grid, path);
check(!!path, `start→exit path: ${seq.join(' > ')} (${path?.length} cells, ${smoothPath(grid, path).length} waypoints)`);
for (const r of floor.roomList) {
  const idx = nearestWalkable(grid, r.center[0], r.center[1], 2.5);
  check(idx >= 0 && !!findPath(grid, startIdx, idx), `reachable: ${r.id}`);
}

// Hot-seat rules
const state = createState(floor, roster);
check(state.players.length === 5 && activePlayer(state).name === 'Victor', 'Victor starts');
check(activePlayer(state).actionPoints === 5, 'start with 5 action points');
check(canAffordRoute(state, floor, activePlayer(state), ['hall']).ok, 'moving inside the hall is free');
check(canAffordRoute(state, floor, activePlayer(state), seq).cost === seq.length - 1, `start→exit costs ${seq.length - 1}`);
check(canAffordRoute(state, floor, activePlayer(state), seq).ok === (seq.length - 1 <= 5), 'affordability matches 5 points');
let r = enterRoom(state, floor, activePlayer(state), 'corridorE');
check(r.revealed && r.cost === 1 && activePlayer(state).actionPoints === 4, 'entering corridorE reveals it and costs 1');
r = enterRoom(state, floor, activePlayer(state), 'hall');
check(!r.revealed && activePlayer(state).actionPoints === 3, 'going back into a known room also costs 1');
activePlayer(state).actionPoints = 0;
check(canAffordRoute(state, floor, activePlayer(state), ['hall', 'corridorW']).reason === 'notEnoughActionPoints', 'cannot change rooms at 0');
const t = endTurn(state, floor);
check(t.to.name === 'Eleanor' && activePlayer(state).actionPoints === 5 && state.round === 1, 'End turn → Eleanor with 5 points, round 1');
check(nextPlayer(state).name === 'Marcus', 'next after Eleanor is Marcus');
for (let i = 0; i < 4; i++) endTurn(state, floor);
check(activePlayer(state).name === 'Victor' && state.round === 2, 'after a full table it is Victor again, round 2');
// Escape
const victor = activePlayer(state);
victor.currentRoom = 'stairs';
r = enterRoom(state, floor, victor, 'exit');
check(r.escaped && victor.escaped && !state.finished, 'Victor escapes, game continues');
endTurn(state, floor);
check(activePlayer(state).name === 'Eleanor', 'turn passes to Eleanor');
for (let i = 0; i < 4; i++) endTurn(state, floor);
check(activePlayer(state).name === 'Eleanor', 'Victor is skipped in the rotation');
for (const p of state.players) if (!p.escaped) { p.currentRoom = 'stairs'; enterRoom(state, floor, p, 'exit'); }
check(state.finished, 'all escaped → finished');
// planMove with discovery
const s2 = createState(floor, roster);
const allowed = buildAllowed(s2, floor, grid);
const p1 = activePlayer(s2);
let plan = planMove(s2, floor, grid, config, p1, floor.start.pos, floor.rooms.get('corridorE').center, allowed);
check(!plan.ok && plan.reason === 'noFloor', 'cannot target deep inside an undiscovered room');
const dE = floor.doorways.find(d => d.id === 'hall->corridorE');
plan = planMove(s2, floor, grid, config, p1, floor.start.pos, dE.center, allowed);
check(plan.ok && plan.rooms.join('>') === 'hall>corridorE' && plan.cost === 1, `tapping the east doorway plans hall>corridorE for 1 point`);
check(roomAt(floor, ...plan.waypoints[plan.waypoints.length - 1]) === 'corridorE', 'the plan ends inside corridorE');
// Tapping a doorway between two KNOWN rooms goes through from either side (not a coin toss).
const s3 = createState(floor, roster);
const p3 = activePlayer(s3);
enterRoom(s3, floor, p3, 'corridorE');
enterRoom(s3, floor, p3, 'hall'); // back in the hall, corridorE now discovered
const allowed3 = buildAllowed(s3, floor, grid);
const planA = planMove(s3, floor, grid, config, p3, floor.rooms.get('hall').center, dE.center, allowed3);
check(planA.ok && planA.rooms.at(-1) === 'corridorE' && planA.cost === 1, `known east doorway from hall → corridorE (${planA.rooms?.join('>')}, cost ${planA.cost})`);
p3.currentRoom = 'corridorE';
const planB = planMove(s3, floor, grid, config, p3, floor.rooms.get('corridorE').center, dE.center, allowed3);
check(planB.ok && planB.rooms.at(-1) === 'hall' && planB.cost === 1, `known east doorway from corridorE → hall (${planB.rooms?.join('>')}, cost ${planB.cost})`);
console.log(failures ? `\n${failures} FAILED` : '\nALL LOGIC CHECKS PASSED');
process.exit(failures ? 1 : 0);
