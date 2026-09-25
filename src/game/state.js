// Game state and turn rules (pure data + functions, no rendering). A server could reuse all
// of this unchanged. Implements docs/GAME_RULES.md — the owner's design; see CLAUDE.md before
// changing any rule here.
//
// One hotel, 4-6 guests (or one in practice). The hotel is random every match (src/game/hotel.js):
// resetState builds a fresh one. Revealed rooms are shared; health, action points, current room,
// hand and the hidden possession flag are per guest.
import { rules } from '../data/rules.js';
import {
  makeRng, buildDrawDeck, buildPossessionSupply, deal, shuffle, hasEscapeLanterns,
} from './cards.js';
import { resetHotel, openDoors } from './hotel.js';

// `opts.mode`: 'practice' (one guest, no hidden role, no meetings) or 'hotseat' (4-6 guests).
export function createState(floor, roster, seed = 1, opts = {}) {
  const mode = opts.mode || (opts.practice ? 'practice' : 'hotseat');
  const state = { roster, mode, practice: mode === 'practice', hotseat: mode === 'hotseat' };
  resetState(state, floor, seed);
  return state;
}

export function resetState(state, floor, seed) {
  const rng = makeRng(seed ?? ((Math.floor(performance.now?.() ?? 0) || 1)));
  const practice = !!state.practice;
  state.seed = seed;
  state.rng = rng;                       // kept: reshuffles and Lock Picks draw from it later
  resetHotel(floor, seed ?? 1);          // a new random hotel: the lobby and a shuffled room deck
  state.discovered = new Set([floor.start.room]);   // every placed room is revealed

  // Deal from a shuffled draw pile. Lanterns are never dealt — they are found only by searching.
  const drawPile = shuffle(buildDrawDeck(rules.deck), rng);
  const { hands, deck } = deal(drawPile, state.roster.length, rng);
  state.drawPile = deck;
  state.discardPile = [];                // reshuffled into a new draw pile when the deck runs out

  // Exactly one guest starts secretly possessed, with the Possession supply in hand. Practice
  // has no hidden role at all.
  const possessedIndex = practice ? -1 : Math.floor(rng() * state.roster.length);

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
    knows: new Set(),          // ids of guests this guest has learned are possessed
    roleSeen: false,           // acknowledged their private role screen
    roleChangePending: false,  // converted, and not yet told privately
    notes: [],                 // private messages waiting for this guest's own screen
  }));
  if (possessedIndex >= 0) state.players[possessedIndex].hand.push(...buildPossessionSupply());

  state.roomDrops = new Map();           // roomId -> cards lying on the floor (a dead guest's hand)
  state.lockedRooms = new Set();         // the locked tiles, from the moment they are revealed
  state.barricades = new Map();          // doorwayId -> { by: playerId, until: turn number }

  state.activeIndex = 0;
  state.round = 1;             // one round = every living guest has taken a turn
  state.turn = 1;              // counts individual turns
  state.encounterLocks = new Set();      // "these two already met in this room this round"
  state.searchedRooms = new Set();       // a room gives up its card draw once
  state.escaped = new Set();
  state.log = [];                        // PUBLIC log — never a hidden role
  state.finished = false;
  state.won = null;            // 'humans' | 'possessed' | null
  state.dawn = false;          // true when the hotel won because dawn broke
  return state;
}

// Append a line to the PUBLIC log. Safe for the whole table: no roles, no private results.
export function logPublic(state, text) {
  state.log.push({ round: state.round, turn: state.turn, text });
  if (state.log.length > 60) state.log.shift();
  return text;
}

// --- Rooms: locked doors and barricades --------------------------------------------------------
export const isLocked = (state, roomId) => state.lockedRooms?.has(roomId) ?? false;
export function unlockRoom(state, roomId) { state.lockedRooms.delete(roomId); }

export const isBarricaded = (state, doorwayId) => !!state.barricades?.has(doorwayId);
// A Barricade stands until the guest who placed it starts their next turn.
export function placeBarricade(state, player, doorwayId) {
  state.barricades.set(doorwayId, { by: player.id, placedTurn: state.turn });
}
// Called as a turn starts: the new active guest's own barricades come down. A barricade whose
// placer has died has no "next turn", so it comes down at the next turn start instead.
export function expireBarricades(state) {
  const now = activePlayer(state);
  for (const [id, b] of state.barricades) {
    const placer = state.players.find(p => p.id === b.by);
    if (b.by === now.id || !placer?.alive) state.barricades.delete(id);
  }
}

// Can `player` step through this doorway right now?
export function doorwayPassable(state, doorway) {
  if (isBarricaded(state, doorway.id)) return false;
  if (isLocked(state, doorway.a) || isLocked(state, doorway.b)) return false;
  return true;
}

// Entering a room costs the move. Every room costs the same, new or known.
export function moveCostInto(state, roomId) { return rules.actionCost.move; }

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
  for (let i = 1; i < roomSequence.length; i++) {
    if (roomSequence[i] !== roomSequence[i - 1] && isLocked(state, roomSequence[i])) {
      return { ok: false, cost, transitions, reason: 'locked' };
    }
  }
  if (cost > player.actionPoints) return { ok: false, cost, transitions, reason: 'notEnoughActionPoints' };
  return { ok: true, cost, transitions, reason: null };
}

// `player` has crossed into `roomId`: charge the move, set the room, reveal it.
// Escape / meeting checks are the caller's job once the walk has finished.
export function enterRoom(state, floor, player, roomId) {
  const result = { player, room: roomId, revealed: false, cost: 0, enteredExit: false };
  if (roomId === player.currentRoom) return result;
  const revealing = !state.discovered.has(roomId);
  result.cost = moveCostInto(state, roomId);
  player.actionPoints = Math.max(0, player.actionPoints - result.cost);
  player.currentRoom = roomId;
  if (revealing) { state.discovered.add(roomId); result.revealed = true; }
  result.enteredExit = !!floor.rooms.get(roomId)?.isExit;
  return result;
}

// Pass control to the next living guest and refill their action points. A new lap round the
// table increments the round and clears the per-room meeting locks.
export function endTurn(state, floor) {
  const from = activePlayer(state);
  const to = nextPlayer(state);
  if (!to) { state.finished = true; return { from, to: null, finished: true }; }
  if (to.index <= from.index) { state.round += 1; state.encounterLocks.clear(); }
  state.activeIndex = to.index;
  to.actionPoints = rules.actionPointsPerTurn;
  state.turn += 1;
  expireBarricades(state);
  return { from, to, finished: false, round: state.round };
}

// --- Escape and winning -----------------------------------------------------------------------
export const canEscape = (state, floor, player) =>
  player.alive && !player.possessed && hasEscapeLanterns(player.hand)
  && !!floor.rooms.get(player.currentRoom)?.isExit;

// Dawn: the match has run past its last round. `state.round` moves on as the last guest of a round
// finishes, so this is true the moment round `roundLimit` ends. Practice has no deadline.
export const dawnHasBroken = state => !state.practice && state.round > rules.roundLimit;
export const isFinalRound = state => !state.practice && state.round === rules.roundLimit;

// Decide the game. `enteredExitBy` is the guest who just stepped into the exit, if any. The exit
// is resolved FIRST: a clean guest carrying three Lanterns escapes before anything else can
// happen to them there — even on the last turn before dawn.
export function checkWin(state, floor, enteredExitBy = null) {
  if (state.finished) return state.won;
  if (enteredExitBy && canEscape(state, floor, enteredExitBy)) {
    state.escaped.add(enteredExitBy.id);
    state.won = 'humans'; state.finished = true; return 'humans';
  }
  if (state.practice) return null;     // alone, the only ending is getting out
  const alive = state.players.filter(p => p.alive);
  // The possessed side wins once no living clean guest remains.
  if (alive.length === 0 || !alive.some(p => !p.possessed)) {
    state.won = 'possessed'; state.finished = true; return 'possessed';
  }
  // ...or when round `roundLimit` has ended with nobody out: dawn breaks.
  if (dawnHasBroken(state)) {
    state.won = 'possessed'; state.dawn = true; state.finished = true; return 'possessed';
  }
  return null;
}

// --- Rooms & doorways --------------------------------------------------------------------

// Doorways the active guest can step through this turn: affordable, not barricaded, not into a
// locked room.
export function usableDoorways(state, floor, player) {
  if (state.finished || !player.alive) return [];
  return (floor.rooms.get(player.currentRoom)?.doorways || [])
    .filter(d => doorwayPassable(state, d) && player.actionPoints >= moveCostInto(state, d.otherRoom(player.currentRoom)));
}

// Closed doors, anywhere in the hotel: the places still to be explored.
export function frontierDoorways(state, floor) {
  return openDoors(floor);
}

// Closed doors of the guest's own room they can open this turn (1 AP each).
export function openableDoors(state, floor, player) {
  if (state.finished || !player.alive) return [];
  if (player.actionPoints < rules.actionCost.open) return [];
  return (floor.rooms.get(player.currentRoom)?.frontier || []).filter(d => !d.jammed);
}

export const isDiscovered = (state, roomId) => state.discovered.has(roomId);

// Locked rooms next door to where the guest is standing (where a key or pick could be used).
export function adjacentLockedRooms(state, floor, player) {
  const room = floor.rooms.get(player.currentRoom);
  return [...(room?.neighbours || [])].filter(id => isLocked(state, id));
}

// --- Meetings ------------------------------------------------------------------------------

export function playersInRoom(state, roomId, exceptId = null) {
  return state.players.filter(p => p.alive && p.currentRoom === roomId && p.id !== exceptId);
}

export function encounterKey(roomId, i, j) {
  const [a, b] = i < j ? [i, j] : [j, i];
  return `${roomId}:${a}-${b}`;
}
export const hasEncounterLock = (state, roomId, i, j) => state.encounterLocks.has(encounterKey(roomId, i, j));
export const lockEncounter = (state, roomId, i, j) => state.encounterLocks.add(encounterKey(roomId, i, j));

// Guests `player` must meet, having just entered their room: everyone else alive in the room
// they have not already met there this round. The lobby (a safe zone) never forces a meeting.
export function pendingEncounters(state, floor, player) {
  if (state.practice) return [];
  if (floor.rooms.get(player.currentRoom)?.safe) return [];
  return playersInRoom(state, player.currentRoom, player.id)
    .filter(q => !hasEncounterLock(state, player.currentRoom, player.index, q.index));
}

// A guest has been converted. Told privately, on their own screen, never announced.
export function convertToPossessed(state, player, byId = null) {
  if (player.possessed) return { ok: false, reason: 'alreadyPossessed' };
  player.possessed = true;
  player.roleChangePending = true;
  player.convertedBy = byId;
  return { ok: true, newly: player.id, by: byId };
}
