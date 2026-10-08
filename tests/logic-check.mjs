// Hotel, grid and pathfinding checks in Node (no browser): node tests/logic-check.mjs
// The hotel is random every match (src/game/hotel.js), so these check the TILES and many generated
// hotels rather than one fixed map. Rules-engine checks live in tests/rules-check.mjs.
import { config } from '../src/config.js';
import { hotel } from '../src/data/hotel.js';
import {
  createHotel, resetHotel, openFrontierDoor, openDoors, exitPlaced, placeTile, roomAt, SIDES, fogCells, cellOf,
} from '../src/game/hotel.js';
import { buildAllowed, roomRoute, planRoomMove, standable } from '../src/game/moves.js';
import { buildGrid, findPath, nearestWalkable, roomSequence } from '../src/game/grid.js';
import { makeRng, buildDrawDeck, deal, shuffle } from '../src/game/cards.js';
import { rules } from '../src/data/rules.js';

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

console.log('\nrooms with jobs (tiles)');
const JOBS = { linenStore1: 'linenStore', linenStore2: 'linenStore', infirmary1: 'infirmary', infirmary2: 'infirmary', switchboard: 'switchboard' };
check(hotel.tiles.filter(x => x.job).map(x => x.id).sort().join() === Object.keys(JOBS).sort().join()
  && hotel.tiles.every(x => !x.job || JOBS[x.id] === x.job), 'five job tiles: linenStore1/2, infirmary1/2, switchboard');
check(!['suite410', 'suite412', 'suite414', 'suite418', 'gardenLounge'].some(id => hotel.tiles.some(x => x.id === id)),
  'the five tiles they replaced are gone');
{
  // Same doorway shapes as the tiles they replaced: 2 dead ends, 1 corner, 1 straight, 1 four-way.
  const shape = x => x.doors.length === 2 ? (SIDES.indexOf(x.doors[0]) % 2 === SIDES.indexOf(x.doors[1]) % 2 ? 'straight' : 'corner') : `${x.doors.length}`;
  const got = Object.keys(JOBS).map(id => shape(hotel.tiles.find(x => x.id === id))).sort().join();
  check(got === ['1', '1', 'corner', 'straight', '4'].sort().join(), `their doorway shapes: 2 dead ends, 1 corner, 1 straight, 1 four-way (${got})`);
  let jobOk = true;
  for (const def of hotel.tiles) for (let rot = 0; rot < 4; rot++) {
    resetHotel(floor, 1);
    const room = placeTile(floor, def, [3, 3], rot);
    if (room.job !== (def.job || null)) jobOk = false;
    if (def.job && (!room.searchable || room.dark || room.locked || room.safe)) jobOk = false;
  }
  check(jobOk, 'placed in any orientation, a tile keeps its job (and a job room stays searchable, lit, unlocked)');
}

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
let problems = [], closed = 0, walkOk = 0, exitWalk = 0, slowest = 0, placed = [], jobRooms = true, jobsSeen = 0;
let lockedDead = true, lockedSeen = 0, exitPastLocks = 0, lockedByLobby = false;
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
  for (const r of floor.roomList) if (r.job !== (JOBS[r.id] || null)) jobRooms = false;
  // Locked rooms: dead ends with a single doorway, never next to the lobby; the Fire Exit is reached
  // from the lobby without ever passing through one (a locked tile counts as a wall).
  for (const r of floor.roomList.filter(x => x.locked)) {
    lockedSeen++;
    if (r.doorways.length !== 1 || r.frontier.length || r.neighbours.size !== 1) lockedDead = false;
    if (r.neighbours.has(floor.start.room)) lockedByLobby = true;
  }
  if (exit) {
    const seen = new Set([floor.start.room]), queue = [floor.start.room];
    while (queue.length) {
      const here = queue.shift();
      for (const d of floor.rooms.get(here).doorways) {
        const n = d.otherRoom(here);
        if (!seen.has(n) && !floor.rooms.get(n).locked) { seen.add(n); queue.push(n); }
      }
    }
    if (seen.has(exit.id)) exitPastLocks++;
  }
  jobsSeen += floor.roomList.filter(r => r.job).length;
}
check(closed === 0, 'the hotel never closed itself off before the Fire Exit was placed');
check(problems.length === 0, `no overlaps, every doorway has floor on both sides (${problems.slice(0, 3).join('; ') || 'none'})`);
check(walkOk === 400, `every room of every hotel can be walked to from the lobby (${walkOk}/400)`);
check(exitWalk === 400, `the Fire Exit can be walked to in every hotel (${exitWalk}/400)`);
check(jobRooms && jobsSeen > 400 * 3, `every job room placed carries its job, and no other room has one (${jobsSeen} job rooms placed in 400 hotels)`);
check(lockedDead && lockedSeen > 400, `every locked room placed is a dead end with a single doorway (${lockedSeen} placed)`);
check(!lockedByLobby, 'a locked room never joins the lobby');
check(exitPastLocks === 400, `the Fire Exit is never behind a locked room: reached from the lobby without passing one (${exitPastLocks}/400)`);
const avg = placed.reduce((a, b) => a + b, 0) / placed.length;
console.log(`       tiles placed when every door had been tried: average ${avg.toFixed(1)}, fewest ${Math.min(...placed)}; slowest walkable-grid rebuild ${slowest.toFixed(1)} ms`);
check(slowest < 150, 'rebuilding the walkable grid after a door opens stays quick');

// The fogged rooms (docs/GAME_RULES.md > Doors and exploring): ONE per empty cell that a closed door
// still leads to, however many doors lead there; never on a room; gone once its door is opened.
console.log('\nfogged rooms beyond closed doors');
{
  let ok = true, shared = 0, total = 0, cleared = true;
  for (let seed = 1; seed <= 200; seed++) {
    resetHotel(floor, seed);
    const rng = makeRng(seed * 7 + 3);
    for (let step = 0; step < 12 + (seed % 10); step++) {
      const doors = openDoors(floor);
      if (!doors.length) break;
      const pick = doors[Math.floor(rng() * doors.length)];
      const key = pick.cell.join();
      const r = openFrontierDoor(floor, pick.id, {});
      if (r.ok && fogCells(floor).has(key)) cleared = false;
    }
    const fog = fogCells(floor);
    const want = new Set(openDoors(floor).map(d => d.cell.join()));
    if (fog.size !== want.size || [...want].some(k => !fog.has(k))) ok = false;
    for (const f of fog.values()) {
      total++;
      if (f.doors.length > 1) shared++;
      if (floor.cells.has(f.key) || f.doors.some(d => d.jammed || d.cell.join() !== f.key)) ok = false;
      if (cellOf(floor, f.center[0], f.center[1]).join() !== f.key || roomAt(floor, f.center[0], f.center[1])) ok = false;
    }
  }
  check(ok, `one fogged room per empty cell a closed door leads to, never on a room (${total} in 200 hotels)`);
  check(shared > 0, `several doors into one empty cell still make ONE fogged room (${shared} such cells seen)`);
  check(cleared, 'opening a door clears its fogged room (a real room stands there now)');
}

// Tapping a revealed room walks the fewest-rooms route to its standing spot, 1 AP per room entered.
console.log('\nwalking to a tapped room');
{
  let ok = true, tried = 0, why = '';
  for (let seed = 1; seed <= 60; seed++) {
    resetHotel(floor, seed);
    const rng = makeRng(seed * 11 + 1);
    for (let step = 0; step < 18; step++) { const doors = openDoors(floor); if (!doors.length) break; openFrontierDoor(floor, doors[Math.floor(rng() * doors.length)].id, {}); }
    const grid = buildGrid(floor, config);
    const ids = floor.roomList.map(r => r.id);
    const state = { finished: false, discovered: new Set(ids), lockedRooms: new Set(), barricades: new Map(), players: [] };
    const player = { currentRoom: floor.start.room, alive: true, actionPoints: 99, index: 0 };
    state.players = [player]; state.activeIndex = 0;
    const allowed = buildAllowed(state, floor, grid, player);
    // graph distances from the lobby
    const dist = new Map([[floor.start.room, 0]]), q = [floor.start.room];
    while (q.length) { const h = q.shift(); for (const d of floor.rooms.get(h).doorways) { const n = d.otherRoom(h); if (!dist.has(n)) { dist.set(n, dist.get(h) + 1); q.push(n); } } }
    for (const to of ids.filter(id => id !== floor.start.room).slice(0, 6)) {
      tried++;
      const route = roomRoute(state, floor, player, to);
      const c = floor.rooms.get(to).center, spot = [c[0] + 0.95, c[1]];
      const plan = planRoomMove(state, floor, grid, config, player, floor.start.pos, to, spot, allowed);
      const end = plan.ok && plan.waypoints.at(-1);
      if (!Array.isArray(route) || route.length - 1 !== dist.get(to) || !plan.ok || plan.cost !== dist.get(to)
        || plan.rooms.join() !== route.join() || Math.hypot(end[0] - spot[0], end[1] - spot[1]) > 0.01) { ok = false; why ||= `seed ${seed} → ${to}: ${JSON.stringify({ route, d: dist.get(to), plan: plan.ok ? plan.rooms : plan.reason })}`; }
    }
    // a locked room says so; a barricade on the only way says so
    const dead = floor.roomList.find(r => r.doorways.length === 1 && r.id !== floor.start.room && r.doorways[0].otherRoom(r.id) !== floor.start.room);
    if (dead) {
      state.lockedRooms.add(dead.id);
      if (roomRoute(state, floor, player, dead.id).blocked !== 'locked') { ok = false; why ||= `seed ${seed}: a locked room did not say locked`; }
      state.lockedRooms.delete(dead.id);
      state.barricades.set(dead.doorways[0].id, { by: 'x' });
      if (roomRoute(state, floor, player, dead.id).blocked !== 'barricaded') { ok = false; why ||= `seed ${seed}: a barricade did not say barricaded`; }
      state.barricades.clear();
    }
  }
  check(ok, `the walk takes the fewest rooms, costs one AP per room and ends on the standing spot (${tried} walks)${why ? ` — ${why}` : ''}`);
}

// A walk stops in the first room on the way that holds a guest the walker must meet (the meeting rule:
// entering a room with a guest forces the meeting there). The pure planner says where it stops and
// charges only up to there. A guest already met in that room this round does not stop it; the lobby (a
// safe zone) never does; practice has no meetings.
console.log('\nstopping on the way for a meeting');
{
  const out = { stop: 0, cost: 0, end: 0, met: 0, lobby: 0, practice: 0, last: 0 };
  let tried = 0, lobbyTried = 0, why = '';
  const fail = (k, msg) => { out[k]++; why ||= msg; };
  for (let seed = 1; seed <= 60; seed++) {
    resetHotel(floor, seed);
    const rng = makeRng(seed * 7 + 3);
    for (let step = 0; step < 18; step++) { const doors = openDoors(floor); if (!doors.length) break; openFrontierDoor(floor, doors[Math.floor(rng() * doors.length)].id, {}); }
    const grid = buildGrid(floor, config);
    const ids = floor.roomList.map(r => r.id);
    const mk = (i, room) => ({ id: `g${i}`, index: i, currentRoom: room, alive: true, actionPoints: 99 });
    const lobby = floor.start.room;
    const spotIn = id => { const c = floor.rooms.get(id).center; return [c[0], c[1]]; };
    const state = { finished: false, practice: false, discovered: new Set(ids), lockedRooms: new Set(), barricades: new Map(), encounterLocks: new Set(), players: [] };
    const walker = mk(0, lobby), other = mk(1, lobby);
    state.players = [walker, other]; state.activeIndex = 0;
    const plan = to => {
      const allowed = buildAllowed(state, floor, grid, walker);
      return planRoomMove(state, floor, grid, config, walker, spotIn(walker.currentRoom), to, spotIn, allowed);
    };
    // 1) a guest on the way, in a room that is not safe: the walk stops there and costs only that far
    for (const to of ids) {
      walker.currentRoom = lobby;
      const route = roomRoute(state, floor, walker, to);
      if (!Array.isArray(route) || route.length < 4) continue;
      const k = route.findIndex((r, i) => i > 0 && i < route.length - 1 && !floor.rooms.get(r).safe);
      if (k < 0) continue;
      tried++;
      other.currentRoom = route[k];
      const p = plan(to);
      if (!p.ok || p.stop !== route[k] || p.meet.join() !== 'g1') fail('stop', `seed ${seed} → ${to}: did not stop in ${route[k]} (${JSON.stringify({ ok: p.ok, stop: p.stop, reason: p.reason })})`);
      else {
        if (p.cost !== k || p.rooms.at(-1) !== route[k] || p.dest !== route[k]) fail('cost', `seed ${seed} → ${to}: stop ${route[k]} at step ${k} cost ${p.cost}, rooms ${p.rooms.join('>')}`);
        const e = p.waypoints.at(-1), c = spotIn(route[k]);
        if (Math.hypot(e[0] - c[0], e[1] - c[1]) > 0.01) fail('end', `seed ${seed}: the stopped walk does not end on the stop room's standing spot`);
      }
      // the guest at the END of the walk is no reason to stop early (the walk ends there anyway)
      other.currentRoom = to;
      const q = plan(to);
      if (!q.ok || q.stop !== null || q.cost !== route.length - 1) fail('last', `seed ${seed} → ${to}: a guest in the destination changed the walk`);
      // 2) already met in that room this round: no stop
      other.currentRoom = route[k];
      state.encounterLocks.add(`${route[k]}:0-1`);
      const m = plan(to);
      if (!m.ok || m.stop !== null || m.cost !== route.length - 1 || m.dest !== to) fail('met', `seed ${seed} → ${to}: stopped for a guest already met there`);
      state.encounterLocks.clear();
      // 4) practice: nobody to meet
      state.practice = true;
      const pr = plan(to);
      if (!pr.ok || pr.stop !== null || pr.cost !== route.length - 1) fail('practice', `seed ${seed}: practice stopped for a meeting`);
      state.practice = false;
      other.currentRoom = lobby;
      break;
    }
    // 3) a guest in the lobby on the way: no stop (the lobby is a safe zone)
    for (const a of floor.rooms.get(lobby).doorways.map(d => d.otherRoom(lobby))) {
      walker.currentRoom = a;
      const to = ids.find(id => { const r = roomRoute(state, floor, walker, id); return Array.isArray(r) && r.length >= 3 && r.indexOf(lobby) > 0 && r.indexOf(lobby) < r.length - 1; });
      if (!to) continue;
      lobbyTried++;
      const route = roomRoute(state, floor, walker, to);
      other.currentRoom = lobby;
      const p = plan(to);
      if (!p.ok || p.stop !== null || p.cost !== route.length - 1 || p.dest !== to) fail('lobby', `seed ${seed}: ${a} → ${to} stopped in the lobby (${JSON.stringify({ ok: p.ok, stop: p.stop, cost: p.cost })})`);
      break;
    }
  }
  check(tried >= 30 && !out.stop, `a walk stops in the first room on the way with a guest to meet, and says who (${tried} walks)${out.stop ? ` — ${why}` : ''}`);
  check(tried >= 30 && !out.cost && !out.end, `it costs only the rooms up to that stop and ends on that room's standing spot${out.cost || out.end ? ` — ${why}` : ''}`);
  check(tried >= 30 && !out.last, 'a guest in the room walked TO does not shorten the walk (the meeting happens on arrival)');
  check(tried >= 30 && !out.met, 'a guest already met in that room this round does not stop the walk');
  check(lobbyTried >= 20 && !out.lobby, `a guest in the lobby never stops a walk through it (safe zone; ${lobbyTried} walks)${out.lobby ? ` — ${why}` : ''}`);
  check(tried >= 30 && !out.practice, 'in practice (no meetings) nothing stops a walk');
}

// Standing spots, checked with the SAME test the game uses (moves.standable: the figure's whole footprint
// clear of walls and furniture): in every room, in every orientation, the middle is free and there are
// at least six free spots (six guests can always share a room), all at least 1.4 m apart; and the lobby's
// six start spots are all free.
{
  let bad = [];
  const spots = hotel.standingSpots;
  const apart = spots.every((a, i) => spots.every((b, j) => i === j || Math.hypot(a[0] - b[0], a[1] - b[1]) >= 1.4 - 1e-9));
  for (const def of [{ ...hotel.lobby, doors: SIDES }, ...hotel.tiles]) for (let rot = 0; rot < 4; rot++) {
    if (def.id === hotel.lobby.id && rot) continue;          // (the lobby is never turned)
    resetHotel(floor, 1);
    floor.rooms.clear(); floor.roomList.length = 0; floor.cells.clear(); floor.frontier.length = 0; floor.walls.length = 0;
    floor.bounds = { min: [Infinity, Infinity], max: [-Infinity, -Infinity] };
    const room = placeTile(floor, def, [0, 0], rot);
    const grid = buildGrid(floor, config);
    const ok = spots.map(([x, z]) => standable(grid, room.id, room.center[0] + x, room.center[1] + z));
    if (!ok[0] || ok.filter(Boolean).length < 6) bad.push(`${def.id} ${rot * 90}°: ${ok.filter(Boolean).length} free${ok[0] ? '' : ', middle blocked'}`);
    if (def.id === hotel.lobby.id && !hotel.lobby.startPositions.every(([x, z]) => standable(grid, room.id, room.center[0] + x, room.center[1] + z))) bad.push('a lobby start spot is blocked');
  }
  check(apart, 'the standing spots are at least 1.4 m apart (guests sharing a room never hide one another)');
  check(bad.length === 0, `in every room, every orientation, the middle and at least six standing spots are free (the game's own footprint test)${bad.length ? ` (${bad.slice(0, 5).join('; ')})` : ''}`);
  check(JSON.stringify(hotel.lobby.startPositions) === JSON.stringify(spots.slice(0, 6)), 'the guests start on the lobby\'s first six standing spots, round its middle');
}

// The starting deal (pure, no hotel): 1 Lantern + 3 other cards for every guest, at every table size;
// the remaining Lanterns are shuffled back into the pile. (rules-check covers the full setup.)
console.log('\nthe starting deal');
{
  let ok = true;
  for (const n of [1, 4, 5, 6]) for (let seed = 1; seed <= 100; seed++) {
    const rng = makeRng(seed);
    const { hands, deck } = deal(shuffle(buildDrawDeck(rules.deck), rng), n, rng);
    const lanterns = h => h.filter(c => c.type === 'lantern').length;
    if (hands.length !== n || !hands.every(h => h.length === rules.startingHandSize && lanterns(h) === 1)) ok = false;
    if (lanterns(deck) !== rules.deck.lantern - n || deck.length + n * rules.startingHandSize !== 48) ok = false;
  }
  check(ok, 'every guest (1, 4, 5 or 6 at the table) is dealt exactly 1 Lantern + 3 other cards; the other Lanterns stay in the pile');
}

console.log(failures ? `\n${failures} FAILED` : '\nALL LOGIC CHECKS PASSED');
process.exit(failures ? 1 : 0);
