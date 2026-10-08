// Planning a move: from the player's position to a tapped point, respecting discovery
// and action points. Pure logic — a server could run the same function to validate a
// client's move.
import { findPath, smoothPath, roomSequence, nearestWalkable } from './grid.js';
import { canAffordRoute, doorwayPassable, encountersIn } from './state.js';

// Cells `player` (by default the active guest) may use right now: discovered rooms, plus a step
// inside any undiscovered room that a discovered doorway leads to (its "landing"). A doorway that
// cannot be passed — a barricade, or a locked door into a locked room — has the cells just inside it
// on BOTH sides taken away, so no route can thread through the opening. A locked door only stops
// guests going in: for a guest standing INSIDE the locked room it is the way out, and stays open.
export function buildAllowed(state, floor, grid, player = state.players?.[state.activeIndex]) {
  const frontier = new Set();
  const sealed = new Set();
  const from = player?.currentRoom ?? null;
  for (const d of floor.doorways) {
    const landings = grid.landings.get(d.id) || {};
    // (a guest who is in neither room of this doorway can only reach it from outside a locked room)
    const side = from === d.a || from === d.b ? from : null;
    if (!doorwayPassable(state, d, side)) {
      for (const idx of landings[d.a] || []) sealed.add(idx);
      for (const idx of landings[d.b] || []) sealed.add(idx);
      continue;
    }
    const aKnown = state.discovered.has(d.a), bKnown = state.discovered.has(d.b);
    if (aKnown === bKnown) continue;
    for (const idx of landings[aKnown ? d.b : d.a] || []) frontier.add(idx);
  }
  return idx => {
    if (sealed.has(idx)) return false;
    const k = grid.room[idx];
    if (k >= 0 && state.discovered.has(grid.roomList[k].id)) return true;
    return frontier.has(idx);
  };
}

// A tap on (or right next to) a doorway means "go through it": aim for a point just inside
// the room on the far side rather than the doorway line itself. This works both for a
// glowing (undiscovered) doorway and for a doorway back into a room already known — the far
// side is simply the room the player is not currently standing in — so tapping any doorway
// beside you reliably takes you through instead of stopping on whichever grid cell is nearest.
function throughDoorwayTarget(state, floor, grid, cfg, player, to, allowed) {
  const t = cfg.walls.thickness;
  for (const d of floor.doorways) {
    const half = d.width / 2 + 0.4, reach = t + 0.4;
    const inside = d.axis === 'x'
      ? Math.abs(to[0] - d.center[0]) <= half && Math.abs(to[1] - d.center[1]) <= reach
      : Math.abs(to[1] - d.center[1]) <= half && Math.abs(to[0] - d.center[0]) <= reach;
    if (!inside) continue;
    // The far side is the room the player is not in. If the player is beside neither room
    // of this doorway, it is not theirs to step through.
    let dest;
    if (player.currentRoom === d.a) dest = d.b;
    else if (player.currentRoom === d.b) dest = d.a;
    else continue;
    const side = d.sideFor(dest); // the wall of the destination room this doorway sits in
    const inward = side === 'north' ? [0, 1] : side === 'south' ? [0, -1] : side === 'east' ? [-1, 0] : [1, 0];
    const depth = t + cfg.player.clearance + 0.4;
    const point = [d.center[0] + inward[0] * depth, d.center[1] + inward[1] * depth];
    const cell = nearestWalkable(grid, point[0], point[1], 1.0, idx => allowed(idx) && grid.roomIdOf(idx) === dest);
    if (cell >= 0) return cell;
  }
  return -1;
}

// A guest can end up standing on cells that are closed off — right in front of a door that
// turned out to open onto a locked room, or where a barricade has just gone up. They may always
// walk back out: the closed-off patch they stand in (on their own room's side only) is usable as
// a way out, never as a destination and never into the room beyond.
function escapeAllowed(grid, player, start, allowed) {
  if (allowed(start)) return allowed;
  const pocket = new Set([start]);
  const stack = [start];
  const { cols, rows, walkable } = grid;
  while (stack.length) {
    const idx = stack.pop();
    const i = idx % cols, j = (idx - i) / cols;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const n = nj * cols + ni;
      if (pocket.has(n) || !walkable[n] || allowed(n) || grid.roomIdOf(n) !== player.currentRoom) continue;
      pocket.add(n); stack.push(n);
    }
  }
  return idx => allowed(idx) || pocket.has(idx);
}

// --- Tap a room, walk there (docs/GAME_RULES.md > Turn: you act by tapping rooms) ----------------
// The fewest-rooms route from the room `player` stands in to room `toRoom`, through doorways they may
// pass right now (no barricade; never INTO a locked room — out of one is always fine). A list of room
// ids, the start room first, or { blocked } saying why there is none: 'locked' (the room itself is
// locked against them), 'barricaded' (a barricade is in the way) or 'noRoute'.
export function roomRoute(state, floor, player, toRoom) {
  const from = player.currentRoom;
  if (from === toRoom) return [from];
  const bfs = passable => {
    const prev = new Map([[from, null]]);
    const queue = [from];
    while (queue.length) {
      const here = queue.shift();
      for (const d of floor.rooms.get(here)?.doorways || []) {
        const next = d.otherRoom(here);
        if (prev.has(next) || !state.discovered.has(next) || !passable(d, here)) continue;
        prev.set(next, here);
        if (next === toRoom) {
          const route = [next];
          for (let r = here; r != null; r = prev.get(r)) route.unshift(r);
          return route;
        }
        queue.push(next);
      }
    }
    return null;
  };
  const route = bfs((d, here) => doorwayPassable(state, d, here));
  if (route) return route;
  // Why not: is the room there at all, and what stands in the way?
  const any = bfs(() => true);
  if (!any) return { blocked: 'noRoute' };
  if (state.lockedRooms?.has(toRoom)) return { blocked: 'locked' };
  const viaOpenRooms = bfs((d, here) => !state.lockedRooms?.has(d.otherRoom(here)));
  return { blocked: viaOpenRooms ? 'barricaded' : 'locked' };
}

// Plan a walk for `player` from the point `from` into room `toRoom` along the fewest-rooms route
// (roomRoute), one move per room entered — the same checks as any move (canAffordRoute).
// Entering a room that holds a guest not met there this round forces a meeting (docs/GAME_RULES.md >
// Meetings; the same test as pendingEncounters, so a safe zone never stops anyone): a walk through
// several rooms therefore ENDS in the first such room on the way — `stop` names it, `meet` the guests
// waiting there, and the walk and its cost go only that far. `standAt(roomId)` gives the point to stand
// on in the room the walk ends in (or pass that point itself). Returns the plan
// ({ ok, cost, rooms, cells, waypoints, dest: the room the walk ends in, target: toRoom, stop, meet })
// or { ok: false, reason }.
export function planRoomMove(state, floor, grid, cfg, player, from, toRoom, standAt, allowed) {
  if (state.finished) return { ok: false, reason: 'finished' };
  if (!player.alive) return { ok: false, reason: 'dead' };
  let route = roomRoute(state, floor, player, toRoom);
  if (!Array.isArray(route)) return { ok: false, reason: route.blocked, dest: toRoom, target: toRoom };
  let stop = null, meet = [];
  for (let i = 1; i < route.length - 1; i++) {
    const met = encountersIn(state, floor, player, route[i]);
    if (met.length) { stop = route[i]; meet = met.map(q => q.id); route = route.slice(0, i + 1); break; }
  }
  const dest = route[route.length - 1];
  const pre = canAffordRoute(state, floor, player, route);
  if (!pre.ok) return { ok: false, ...pre, rooms: route, dest, target: toRoom, stop, meet };
  const to = typeof standAt === 'function' ? standAt(dest) : standAt;
  const onRoute = new Set(route);
  const allow = idx => allowed(idx) && onRoute.has(grid.roomIdOf(idx));
  const target = nearestWalkable(grid, to[0], to[1], 2.5, idx => allow(idx) && grid.roomIdOf(idx) === dest);
  if (target < 0) return { ok: false, reason: 'noFloor', dest, target: toRoom };
  const start = nearestWalkable(grid, from[0], from[1], 1.5, () => true);
  if (start < 0) return { ok: false, reason: 'noFloor', dest, target: toRoom };
  const walk = escapeAllowed(grid, player, start, allow);
  const cells = findPath(grid, start, target, walk);
  if (!cells) return { ok: false, reason: 'noPath', dest, target: toRoom };
  const rooms = roomSequence(grid, cells);
  if (rooms[0] !== player.currentRoom) rooms.unshift(player.currentRoom);
  const verdict = canAffordRoute(state, floor, player, rooms);
  if (!verdict.ok) return { ok: false, ...verdict, rooms, dest, target: toRoom, stop, meet };
  const waypoints = smoothPath(grid, cells, walk, cfg.player.clearance * 0.5);
  waypoints[0] = [from[0], from[1]];
  // End exactly on the standing spot (not on the middle of the grid cell it falls in).
  const [tx, tz] = grid.center(target), at = grid.cellAt(to[0], to[1]);
  if (waypoints.length > 1 && at >= 0 && grid.walkable[at] && Math.hypot(tx - to[0], tz - to[1]) <= grid.cell) waypoints[waypoints.length - 1] = [to[0], to[1]];
  return { ok: true, ...verdict, rooms, cells, waypoints, dest, target: toRoom, stop, meet };
}

// Is the point (x, z) a place a guest can stand in room `roomId`: on free floor of that room, with the
// whole figure's footprint (0.25 m round it) clear of walls and furniture? (main.js picks standing spots
// with it; tests/logic-check.mjs checks the data's standing spots with the same test.)
export function standable(grid, roomId, x, z) {
  const c = grid.cellAt(x, z);
  if (c < 0 || !grid.walkable[c] || grid.roomIdOf(c) !== roomId) return false;
  return [[0.25, 0], [-0.25, 0], [0, 0.25], [0, -0.25]].every(([dx, dz]) => { const k = grid.cellAt(x + dx, z + dz); return k >= 0 && grid.walkable[k]; });
}

// Plan a walk for `player` (a rules player from state.players) from `from` to the ground point `to`.
// (The game no longer lets a guest walk to any point — they walk from room to room, planRoomMove above;
// this older planner stays for the walkTo debug hook and the tests that probe the walkable floor.)
export function planMove(state, floor, grid, cfg, player, from, to, allowed) {
  if (state.finished) return { ok: false, reason: 'finished' };
  if (!player.alive) return { ok: false, reason: 'dead' };
  let target = throughDoorwayTarget(state, floor, grid, cfg, player, to, allowed);
  if (target < 0) target = nearestWalkable(grid, to[0], to[1], cfg.grid.tapSnapRadius, allowed);
  if (target < 0) return { ok: false, reason: 'noFloor' };
  const start = nearestWalkable(grid, from[0], from[1], 1.5, () => true);
  if (start < 0) return { ok: false, reason: 'noFloor' };
  const walk = escapeAllowed(grid, player, start, allowed);
  const cells = findPath(grid, start, target, walk);
  if (!cells) return { ok: false, reason: 'noPath' };
  // The room the player is actually standing in comes first, so a pending doorway crossing
  // (player half a cell short of the boundary) is counted too.
  const rooms = roomSequence(grid, cells);
  if (rooms[0] !== player.currentRoom) rooms.unshift(player.currentRoom);
  const verdict = canAffordRoute(state, floor, player, rooms);
  if (!verdict.ok) return { ok: false, ...verdict, rooms };
  const waypoints = smoothPath(grid, cells, walk, cfg.player.clearance * 0.5);
  waypoints[0] = [from[0], from[1]];
  return { ok: true, ...verdict, rooms, cells, waypoints };
}
