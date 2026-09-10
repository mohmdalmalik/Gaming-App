// Game state and rules (pure data + functions, no rendering). Everything a server would
// need to validate a move lives here.

export function createState(floor) {
  const state = {};
  resetState(state, floor);
  return state;
}

export function resetState(state, floor) {
  state.discovered = new Set([floor.start.room]);
  state.currentRoom = floor.start.room;
  state.actionPoints = floor.rules.startActionPoints;
  state.turn = 1;
  state.finished = false;
  return state;
}

// Cost of walking a route that visits these rooms in order (consecutive duplicates removed).
export function routeCost(floor, roomSequence) {
  let transitions = 0;
  for (let i = 1; i < roomSequence.length; i++) {
    if (roomSequence[i] !== roomSequence[i - 1]) transitions++;
  }
  const cost = transitions * floor.rules.enterRoomCost + (transitions === 0 ? floor.rules.moveWithinRoomCost : 0);
  return { transitions, cost };
}

export function canAffordRoute(state, floor, roomSequence) {
  const { transitions, cost } = routeCost(floor, roomSequence);
  if (state.finished) return { ok: false, cost, transitions, reason: 'finished' };
  if (cost > state.actionPoints) return { ok: false, cost, transitions, reason: 'notEnoughActionPoints' };
  return { ok: true, cost, transitions, reason: null };
}

// The player has crossed into `roomId`. Charges the doorway cost and reveals the room.
export function enterRoom(state, floor, roomId) {
  const result = { room: roomId, revealed: false, cost: 0, isExit: false };
  if (roomId === state.currentRoom) return result;
  result.cost = floor.rules.enterRoomCost;
  state.actionPoints = Math.max(0, state.actionPoints - result.cost);
  state.currentRoom = roomId;
  if (!state.discovered.has(roomId)) {
    state.discovered.add(roomId);
    result.revealed = true;
  }
  const room = floor.rooms.get(roomId);
  if (room?.isExit) {
    result.isExit = true;
    state.finished = true;
  }
  return result;
}

export function endTurn(state, floor) {
  state.actionPoints = floor.rules.startActionPoints;
  state.turn += 1;
  return state;
}

// Doorways with exactly one side discovered: the places the player can still explore.
export function frontierDoorways(state, floor) {
  return floor.doorways.filter(d => state.discovered.has(d.a) !== state.discovered.has(d.b));
}

export function isDiscovered(state, roomId) {
  return state.discovered.has(roomId);
}
