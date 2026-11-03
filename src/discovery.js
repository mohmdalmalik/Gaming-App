// Ties pathfinding, action points and room discovery together for the active player (main.js
// turns a tap on a room into a planned walk here). Talks to the renderer only through the callbacks
// in `on`, so the rules stay reusable.
// `state` and `floor` are what the screens draw: in the page, its presenter state and its own copy of the hotel
// (src/net/viewAsState.js, src/net/floorCopy.js). Crossing into a room is the table's to decide: `enter(player,
// roomId)` settles it and returns its result, with `state` already up to date (without `enter`, nothing is settled).
// `before()` (optional) runs before the walking cells are worked out again, so they follow the latest state.
import { roomAt } from './game/hotel.js';
import { activePlayer } from './game/state.js';
import { buildAllowed, planMove, planRoomMove } from './game/moves.js';

// `movers` are the movement objects (src/player.js), one per entry in state.players.
export function createDiscovery({ floor, grid, state, movers, cfg, on = {}, enter = null, before = null }) {
  let allowed = buildAllowed(state, floor, grid);

  return {
    get allowed() { return allowed; },
    refresh() { before?.(); allowed = buildAllowed(state, floor, grid); },
    activeMover() { return movers[state.activeIndex]; },

    // Work out a walk for the active player without committing it.
    plan(wx, wz) {
      const player = activePlayer(state);
      const mover = movers[player.index];
      return planMove(state, floor, grid, cfg, player, [mover.x, mover.z], [wx, wz], allowed);
    },
    // Work out a walk into room `roomId` for the active player without committing it: the fewest-rooms
    // route, one move per room entered, ending early in a room where a meeting is forced (planRoomMove).
    // `standAt(roomId)` gives the standing spot [x, z] in the room the walk ends in. `player`: the active guest as the
    // rules see them (their action points), when the screens' record does not hold them (a computer guest's).
    planToRoom(roomId, standAt, player = activePlayer(state)) {
      const mover = movers[player.index];
      return planRoomMove(state, floor, grid, cfg, player, [mover.x, mover.z], roomId, standAt, allowed);
    },
    // Commit a plan (start walking).
    go(plan) {
      const player = activePlayer(state);
      movers[player.index].setPath(plan.waypoints);
      on.route?.(plan, player);
      return plan;
    },
    // Plan and commit in one step (used by tests and simple callers).
    walkTo(wx, wz) {
      const player = activePlayer(state);
      const plan = this.plan(wx, wz);
      if (!plan.ok) {
        if (plan.reason !== 'finished' && plan.reason !== 'dead') on.reject?.(plan.reason, plan, player);
        return plan;
      }
      return this.go(plan);
    },

    // Call every frame: notices when the active player has crossed into another room.
    // Rooms are axis-aligned and never overlap, so a doorway is exactly one boundary crossing.
    update() {
      const player = activePlayer(state);
      const mover = movers[player.index];
      const roomId = roomAt(floor, mover.x, mover.z);
      if (!roomId || roomId === player.currentRoom) return null;
      if (!enter) return null;
      const result = enter(player, roomId);
      allowed = buildAllowed(state, floor, grid);
      on.roomEntered?.(result);
      return result;
    },
  };
}
