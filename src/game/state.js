// Game state and turn rules (pure data + functions, no rendering). A server could reuse
// all of this. See docs/GAME_RULES.md for the spec.
//
// Hot-seat: five players share one floor and take turns. Discovered rooms are shared;
// health, action points, current room, hand and the possession flag are per player.
import { rules } from '../data/rules.js';
import { makeRng, buildDrawDeck, buildPossessionSupply, deal, shuffle, lanternCount } from './cards.js';

// `opts.practice` builds a Phase 0 practice game: one guest, no possession, the three Phase 0
// card types only, and objectives to find. Everything else (the multiplayer path) is unchanged.
export function createState(floor, roster, seed = 1, opts = {}) {
  const state = { roster, practice: !!opts.practice };
  resetState(state, floor, seed);
  return state;
}

export function resetState(state, floor, seed) {
  const rng = makeRng(seed ?? ((Math.floor(performance.now?.() ?? 0) || 1)));
  const practice = !!state.practice;
  state.seed = seed;
  state.discovered = new Set([floor.start.room]);

  // Deal hands from a shuffled draw pile, one guaranteed Lantern each. Practice uses the
  // three-card Phase 0 deck.
  const drawPile = shuffle(buildDrawDeck(practice ? rules.practiceDeck : rules.deck), rng);
  const { hands, deck } = deal(drawPile, state.roster.length);
  state.drawPile = deck;

  // Exactly one player is secretly possessed and holds the Possession supply. Practice mode
  // has no hidden role at all, so nobody is possessed.
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
    knows: new Set(),   // ids of players this player has learned are possessed
    // Pre-committed meeting state, set on this player's OWN turn (see setOffer below).
    offer: null,        // card id they are willing to hand over, or null for nothing
    intent: 'trade',    // 'trade' | 'possess' — only the possessed side may set 'possess'
  }));
  if (possessedIndex >= 0) state.players[possessedIndex].hand.push(...buildPossessionSupply());

  state.activeIndex = 0;
  state.round = 1;      // one round = every living player has taken a turn
  state.turn = 1;       // counts individual turns
  state.encounterLocks = new Set();
  state.searchedRooms = new Set(); // a room can only be searched once
  state.objectivesFound = new Set(); // ids of objective rooms already searched — PUBLIC TEAM
                                     // progress, never held by a player and never transferable
  state.escaped = new Set();         // ids of players who have reached the exit; permanent
  state.finished = false;
  state.won = null;     // 'humans' | 'possessed' | 'practice'
  return state;
}

// --- Objectives and the sealed exit ------------------------------------------------------
// The exit exists in the map from the start but stays hidden and unreachable until every
// objective has been found. This is the one rule that gives the hotel a real late game: it
// stops the way out being stumbled on in the first few turns.
export const objectivesRequired = () => rules.objectiveCount;
export const objectivesFound = state => state.objectivesFound?.size ?? 0;
export const exitUnlocked = state => objectivesFound(state) >= objectivesRequired();

// Objectives are public team progress, full stop. These two predicates exist so the rest of the
// code (and the tests) can state the rule rather than rely on objectives happening not to be
// cards. Nothing may make them carryable while `legacyCarriedExitKey` is false.
export const objectivesAreCarried = () => !!rules.legacyCarriedExitKey;
export const canOfferObjective = () => false;

// How many clean guests must reach the exit to finish. One in practice (there is one guest);
// the six-player target is configurable and used the moment more guests exist.
export const escapeesRequired = state =>
  state?.practice ? rules.requiredEscapees : rules.escapeesAtBalanceCount;
export const escapedCount = state => state.escaped?.size ?? 0;

// Record a permanent escape. Only a clean, living player who is standing in the exit while it is
// unlocked can escape; a possessed player may stand there and nothing happens.
export function escape(state, floor, player) {
  if (!floor.rooms.get(player.currentRoom)?.isExit) return { ok: false, reason: 'notAtExit' };
  if (!exitUnlocked(state)) return { ok: false, reason: 'sealed' };
  if (player.possessed) return { ok: false, reason: 'possessed' };
  if (!player.alive) return { ok: false, reason: 'dead' };
  if (state.escaped.has(player.id)) return { ok: true, already: true, escaped: escapedCount(state) };
  state.escaped.add(player.id);
  return { ok: true, escaped: escapedCount(state), required: escapeesRequired(state) };
}

// --- Pre-committed offers ------------------------------------------------------------------
// A player decides what they are willing to hand over ON THEIR OWN TURN. When another player
// walks into their room the meeting resolves from the two stored offers with no further input,
// so nobody is ever interrupted while someone else is taking a turn. An objective can never be
// an offer: objectives are not cards and `canOfferObjective()` is false.
export function setOffer(state, player, cardId, intent = 'trade') {
  if (state.finished) return { ok: false, reason: 'finished' };
  if (state.activeIndex !== player.index) return { ok: false, reason: 'notYourTurn' };
  if (cardId == null) { player.offer = null; player.intent = 'trade'; return { ok: true, offer: null }; }
  if (state.objectivesFound?.has(cardId)) return { ok: false, reason: 'objectiveNotOfferable' };
  const card = player.hand.find(c => c.id === cardId);
  if (!card) return { ok: false, reason: 'noCard' };
  player.offer = cardId;
  player.intent = player.possessed && intent === 'possess' ? 'possess' : 'trade';
  return { ok: true, offer: player.offer, intent: player.intent };
}

export function clearOffer(player) { player.offer = null; player.intent = 'trade'; }

// Can this room be entered / seen at all yet? Only the exit is ever sealed.
export function isRoomOpen(state, floor, roomId) {
  const room = floor.rooms.get(roomId);
  if (!room?.isExit) return true;
  return exitUnlocked(state);
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
  // Practice mode: reaching the exit once every objective is found completes the run. There is
  // no losing side and no timer, so nothing else can end it.
  if (state.practice) {
    // The exit is a safe end-zone: entering it resolves BEFORE anything else can happen there.
    if (enteredExitBy && exitUnlocked(state) && !enteredExitBy.possessed) {
      escape(state, floor, enteredExitBy);
      if (escapedCount(state) >= escapeesRequired(state)) { state.won = 'practice'; state.finished = true; return 'practice'; }
    }
    return null;
  }
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
    .filter(d => {
      const dest = d.otherRoom(player.currentRoom);
      if (!isRoomOpen(state, floor, dest)) return false;   // the exit is sealed until 3/3
      return player.actionPoints >= moveCostInto(state, dest);
    });
}

// Doorways with exactly one side discovered: the places still to be explored. A doorway into
// the sealed exit is not shown as somewhere left to explore.
export function frontierDoorways(state, floor) {
  return floor.doorways.filter(d =>
    state.discovered.has(d.a) !== state.discovered.has(d.b)
    && isRoomOpen(state, floor, d.a) && isRoomOpen(state, floor, d.b));
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
// everyone else alive in the room they have not already met there this round. A SAFE room
// never forces an encounter, so none are pending there.
export function pendingEncounters(state, floor, player) {
  if (floor.rooms.get(player.currentRoom)?.safe) return [];
  return playersInRoom(state, player.currentRoom, player.id)
    .filter(q => !hasEncounterLock(state, player.currentRoom, player.index, q.index));
}
