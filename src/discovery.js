// Ties taps, pathfinding, action points and room discovery together for the active
// player. Talks to the renderer only through the callbacks in `on`, so the rules stay
// reusable.
import { roomAt } from './game/floor.js';
import { enterRoom, activePlayer } from './game/state.js';
import { buildAllowed, planMove } from './game/moves.js';

// `movers` are the movement objects (src/player.js), one per entry in state.players.
export function createDiscovery({ floor, grid, state, movers, cfg, on = {} }) {
  let allowed = buildAllowed(state, floor, grid);

  return {
    get allowed() { return allowed; },
    refresh() { allowed = buildAllowed(state, floor, grid); },
    activeMover() { return movers[state.activeIndex]; },

    // Ask the active player to walk to a world position. Returns what happened.
    walkTo(wx, wz) {
      const player = activePlayer(state);
      const mover = movers[player.index];
      const plan = planMove(state, floor, grid, cfg, player, [mover.x, mover.z], [wx, wz], allowed);
      if (!plan.ok) {
        if (plan.reason !== 'finished' && plan.reason !== 'escaped') on.reject?.(plan.reason, plan, player);
        return plan;
      }
      mover.setPath(plan.waypoints);
      on.route?.(plan, player);
      return plan;
    },

    // Call every frame: notices when the active player has crossed into another room.
    // Rooms are axis-aligned and never overlap, so a doorway is exactly one boundary crossing.
    update() {
      const player = activePlayer(state);
      const mover = movers[player.index];
      const roomId = roomAt(floor, mover.x, mover.z);
      if (!roomId || roomId === player.currentRoom) return null;
      const result = enterRoom(state, floor, player, roomId);
      allowed = buildAllowed(state, floor, grid);
      on.roomEntered?.(result);
      return result;
    },
  };
}
