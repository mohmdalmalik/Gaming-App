// Game state and rules (pure data + functions, no rendering). Everything a server would
// need to validate a move lives here.
//
// Several players share one floor (hot-seat: one device, one player moves at a time).
// Discovered rooms are shared; action points, current room and "escaped" are per player.

export function createState(floor, roster) {
  const state = { roster };
  resetState(state, floor);
  return state;
}

export function resetState(state, floor) {
  state.discovered = new Set([floor.start.room]);
  state.players = state.roster.map((p, index) => ({
    id: p.id,
    name: p.name,
    outfit: p.outfit,
    color: p.color,
    index,
    currentRoom: floor.start.room,
    actionPoints: floor.rules.actionPointsPerTurn,
    escaped: false,
  }));
  state.activeIndex = 0;
  state.round = 1;      // one round = every remaining player has had a turn
  state.turn = 1;       // counts individual turns
  state.finished = false;
  return state;
}

export const activePlayer = state => state.players[state.activeIndex];

// Who plays after the active player (skipping anyone who has escaped), or null.
export function nextPlayer(state) {
  const n = state.players.length;
  for (let k = 1; k <= n; k++) {
    const p = state.players[(state.activeIndex + k) % n];
    if (!p.escaped) return p;
  }
  return null;
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

export function canAffordRoute(state, floor, player, roomSequence) {
  const { transitions, cost } = routeCost(floor, roomSequence);
  if (state.finished) return { ok: false, cost, transitions, reason: 'finished' };
  if (player.escaped) return { ok: false, cost, transitions, reason: 'escaped' };
  if (cost > player.actionPoints) return { ok: false, cost, transitions, reason: 'notEnoughActionPoints' };
  return { ok: true, cost, transitions, reason: null };
}

// `player` has crossed into `roomId`. Charges the doorway cost, reveals the room and
// notices the exit.
export function enterRoom(state, floor, player, roomId) {
  const result = { player, room: roomId, revealed: false, cost: 0, escaped: false, allEscaped: false };
  if (roomId === player.currentRoom) return result;
  result.cost = floor.rules.enterRoomCost;
  player.actionPoints = Math.max(0, player.actionPoints - result.cost);
  player.currentRoom = roomId;
  if (!state.discovered.has(roomId)) {
    state.discovered.add(roomId);
    result.revealed = true;
  }
  if (floor.rooms.get(roomId)?.isExit && !player.escaped) {
    player.escaped = true;
    result.escaped = true;
    if (state.players.every(p => p.escaped)) {
      state.finished = true;
      result.allEscaped = true;
    }
  }
  return result;
}

// Pass control to the next player who has not escaped and refill their points.
export function endTurn(state, floor) {
  const from = activePlayer(state);
  const to = nextPlayer(state);
  if (!to) { state.finished = true; return { from, to: null, finished: true }; }
  if (to.index <= from.index) state.round += 1; // wrapped around the table
  state.activeIndex = to.index;
  to.actionPoints = floor.rules.actionPointsPerTurn;
  state.turn += 1;
  return { from, to, finished: false, round: state.round };
}

// Doorways with exactly one side discovered: the places the players can still explore.
export function frontierDoorways(state, floor) {
  return floor.doorways.filter(d => state.discovered.has(d.a) !== state.discovered.has(d.b));
}

export function isDiscovered(state, roomId) {
  return state.discovered.has(roomId);
}
