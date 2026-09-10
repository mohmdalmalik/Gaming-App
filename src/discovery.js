// Ties taps, pathfinding, action points and room discovery together. Talks to the
// renderer only through the callbacks in `on`, so the rules stay reusable.
import { roomAt } from './game/floor.js';
import { enterRoom } from './game/state.js';
import { buildAllowed, planMove } from './game/moves.js';

export function createDiscovery({ floor, grid, state, player, cfg, on = {} }) {
  let allowed = buildAllowed(state, floor, grid);

  return {
    get allowed() { return allowed; },
    refresh() { allowed = buildAllowed(state, floor, grid); },

    // Ask the player to walk to a world position. Returns what happened.
    walkTo(wx, wz) {
      const plan = planMove(state, floor, grid, cfg, [player.x, player.z], [wx, wz], allowed);
      if (!plan.ok) {
        if (plan.reason !== 'finished') on.reject?.(plan.reason, plan);
        return plan;
      }
      player.setPath(plan.waypoints);
      on.route?.(plan);
      return plan;
    },

    // Call every frame: notices when the player has crossed into another room. Rooms are
    // axis-aligned and never overlap, so a doorway crossing is exactly one boundary crossing.
    update() {
      const roomId = roomAt(floor, player.x, player.z);
      if (!roomId || roomId === state.currentRoom) return null;
      const result = enterRoom(state, floor, roomId);
      allowed = buildAllowed(state, floor, grid);
      on.roomEntered?.(result);
      return result;
    },
  };
}
