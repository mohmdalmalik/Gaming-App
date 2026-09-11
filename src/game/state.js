// Game state and turn rules (pure data + functions, no rendering). A server could reuse
// all of this. See docs/GAME_RULES.md for the spec.
//
// Hot-seat: five players share one floor and take turns. Discovered rooms are shared;
// health, action points, current room, hand and the possession flag are per player.
import { rules } from '../data/rules.js';
import { makeRng, buildDrawDeck, buildPossessionSupply, deal, shuffle, lanternCount } from './cards.js';

export function createState(floor, roster, seed = 1) {
  const state = { roster };
  resetState(state, floor, seed);
  return state;
}

export function resetState(state, floor, seed) {
  const rng = makeRng(seed ?? ((Math.floor(performance.now?.() ?? 0) || 1)));
  state.seed = seed;
  state.discovered = new Set([floor.start.room]);

  // Deal hands from a shuffled draw pile, one guaranteed Lantern each.
  const drawPile = shuffle(buildDrawDeck(), rng);
  const { hands, deck } = deal(drawPile, state.roster.length);
  state.drawPile = deck;

  // Exactly one player is secretly possessed and holds the Possession supply.
  const possessedIndex = Math.floor(rng() * state.roster.length);

  state.players = state.roster.map((p, index) => ({
    id: p.id,
    name: p.name,
    outfit: p.outfit,
    color: p.color,
    index,
    currentRoom: floor.start.room,
    actionPoints: rules.actionPointsPerTurn,
    health: rules.maxHealth,
    alive: true,
    possessed: index === possessedIndex,
    hand: hands[index],
    knows: new Set(),   // ids of players this player has learned are possessed
  }));
  state.players[possessedIndex].hand.push(...buildPossessionSupply());

  state.activeIndex = 0;
  state.round = 1;      // one round = every living player has taken a turn
  state.turn = 1;       // counts individual turns
  state.encounterLocks = new Set();
  state.searchedRooms = new Set(); // a room can only be searched once
  state.finished = false;
  state.won = null;     // 'humans' | 'possessed'
  return state;
}

// What it costs to step into `roomId`: a known room is just the move; an undiscovered room
// also costs the discover point (revealing it), so entering a new room costs 2.
export function moveCostInto(state, roomId) {
  return rules.actionCost.move + (state.discovered.has(roomId) ? 0 : rules.actionCost.discover);
}

export const activePlayer = state => state.players[state.activeIndex];

// Who plays after the active player (skipping the dead), or null if nobody can.
export function nextPlayer(state) {
  const n = state.players.length;
  for (let k = 1; k <= n; k++) {
    const p = state.players[(state.activeIndex + k) % n];
    if (p.alive) return p;
  }
  return null;
}

// Cost of walking a route that visits these rooms in order (consecutive duplicates removed).
// Each step into a new room costs the move point, plus the discover point if that room is
// still undiscovered. Moving within a room is free.
export function routeCost(state, floor, roomSequence) {
  let transitions = 0, cost = 0;
  for (let i = 1; i < roomSequence.length; i++) {
    if (roomSequence[i] !== roomSequence[i - 1]) { transitions++; cost += moveCostInto(state, roomSequence[i]); }
  }
  return { transitions, cost };
}

export function canAffordRoute(state, floor, player, roomSequence) {
  const { transitions, cost } = routeCost(state, floor, roomSequence);
  if (state.finished) return { ok: false, cost, transitions, reason: 'finished' };
  if (!player.alive) return { ok: false, cost, transitions, reason: 'dead' };
  if (cost > player.actionPoints) return { ok: false, cost, transitions, reason: 'notEnoughActionPoints' };
  return { ok: true, cost, transitions, reason: null };
}

// `player` has crossed into `roomId`: charge the move cost, set the room, reveal it.
// Win/encounter checks are the caller's job once the walk has finished.
export function enterRoom(state, floor, player, roomId) {
  const result = { player, room: roomId, revealed: false, cost: 0, enteredExit: false };
  if (roomId === player.currentRoom) return result;
  const revealing = !state.discovered.has(roomId);
  result.cost = rules.actionCost.move + (revealing ? rules.actionCost.discover : 0);
  player.actionPoints = Math.max(0, player.actionPoints - result.cost);
  player.currentRoom = roomId;
  if (revealing) { state.discovered.add(roomId); result.revealed = true; }
  result.enteredExit = !!floor.rooms.get(roomId)?.isExit;
  return result;
}

// Pass control to the next living player and refill their action points. A new lap round
// the table increments the round and clears the per-room encounter locks.
export function endTurn(state, floor) {
  const from = activePlayer(state);
  const to = nextPlayer(state);
  if (!to) { state.finished = true; return { from, to: null, finished: true }; }
  if (to.index <= from.index) { state.round += 1; state.encounterLocks.clear(); }
  state.activeIndex = to.index;
  to.actionPoints = rules.actionPointsPerTurn;
  state.turn += 1;
  return { from, to, finished: false, round: state.round };
}

// Decide the game if a condition is met. `enteredExitBy` is the player who just stepped into
// the exit room this instant, if any.
export function checkWin(state, floor, enteredExitBy = null) {
  if (state.finished) return state.won;
  if (enteredExitBy && enteredExitBy.alive && !enteredExitBy.possessed
      && lanternCount(enteredExitBy.hand) >= rules.lanternsToEscape) {
    state.won = 'humans'; state.finished = true; return 'humans';
  }
  const alive = state.players.filter(p => p.alive);
  // The possessed side wins once no living clean player remains (all possessed, or all
  // clean are dead).
  if (alive.length === 0 || !alive.some(p => !p.possessed)) {
    state.won = 'possessed'; state.finished = true; return 'possessed';
  }
  return null;
}

// --- Rooms & doorways --------------------------------------------------------------------

// Doorways the active player can afford to step through this turn (a known neighbour costs 1,
// an undiscovered one costs 2 — the move plus discovering it).
export function usableDoorways(state, floor, player) {
  if (state.finished || !player.alive) return [];
  return (floor.rooms.get(player.currentRoom)?.doorways || [])
    .filter(d => player.actionPoints >= moveCostInto(state, d.otherRoom(player.currentRoom)));
}

// Doorways with exactly one side discovered: the places still to be explored.
export function frontierDoorways(state, floor) {
  return floor.doorways.filter(d => state.discovered.has(d.a) !== state.discovered.has(d.b));
}

export function isDiscovered(state, roomId) {
  return state.discovered.has(roomId);
}

// --- Encounters --------------------------------------------------------------------------

export function playersInRoom(state, roomId, exceptId = null) {
  return state.players.filter(p => p.alive && p.currentRoom === roomId && p.id !== exceptId);
}

export function encounterKey(roomId, i, j) {
  const [a, b] = i < j ? [i, j] : [j, i];
  return `${roomId}:${a}-${b}`;
}
export const hasEncounterLock = (state, roomId, i, j) => state.encounterLocks.has(encounterKey(roomId, i, j));
export const lockEncounter = (state, roomId, i, j) => state.encounterLocks.add(encounterKey(roomId, i, j));

// Players `player` must have a forced encounter with, having just entered their room:
// everyone else alive in the room they have not already met there this round.
export function pendingEncounters(state, floor, player) {
  return playersInRoom(state, player.currentRoom, player.id)
    .filter(q => !hasEncounterLock(state, player.currentRoom, player.index, q.index));
}
