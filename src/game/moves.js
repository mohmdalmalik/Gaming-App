// Planning a move: from the player's position to a tapped point, respecting discovery
// and action points. Pure logic — a server could run the same function to validate a
// client's move.
import { findPath, smoothPath, roomSequence, nearestWalkable } from './grid.js';
import { canAffordRoute } from './state.js';

// Cells the player may use right now: discovered rooms, plus a step inside any
// undiscovered room that a discovered doorway leads to (its "landing").
export function buildAllowed(state, floor, grid) {
  const frontier = new Set();
  for (const d of floor.doorways) {
    const aKnown = state.discovered.has(d.a), bKnown = state.discovered.has(d.b);
    if (aKnown === bKnown) continue;
    for (const idx of grid.landings.get(d.id)?.[aKnown ? d.b : d.a] || []) frontier.add(idx);
  }
  return idx => {
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

// Plan a walk for `player` (a rules player from state.players) from `from` to the tap `to`.
export function planMove(state, floor, grid, cfg, player, from, to, allowed) {
  if (state.finished) return { ok: false, reason: 'finished' };
  if (!player.alive) return { ok: false, reason: 'dead' };
  let target = throughDoorwayTarget(state, floor, grid, cfg, player, to, allowed);
  if (target < 0) target = nearestWalkable(grid, to[0], to[1], cfg.grid.tapSnapRadius, allowed);
  if (target < 0) return { ok: false, reason: 'noFloor' };
  const start = nearestWalkable(grid, from[0], from[1], 1.5, () => true);
  if (start < 0) return { ok: false, reason: 'noFloor' };
  const cells = findPath(grid, start, target, allowed);
  if (!cells) return { ok: false, reason: 'noPath' };
  // The room the player is actually standing in comes first, so a pending doorway crossing
  // (player half a cell short of the boundary) is counted too.
  const rooms = roomSequence(grid, cells);
  if (rooms[0] !== player.currentRoom) rooms.unshift(player.currentRoom);
  const verdict = canAffordRoute(state, floor, player, rooms);
  if (!verdict.ok) return { ok: false, ...verdict, rooms };
  const waypoints = smoothPath(grid, cells, allowed, cfg.player.clearance * 0.5);
  waypoints[0] = [from[0], from[1]];
  return { ok: true, ...verdict, rooms, cells, waypoints };
}
