// Pure-rules checks for Hotel Escape (no browser): node tests/rules-check.mjs
import { config } from '../src/config.js';
import { rules, applyMode, objectivesForPlayers, cleanEscapeesForPlayers } from '../src/data/rules.js';
import { floor1 } from '../src/data/floor1.js';
import { roster } from '../src/data/characters.js';
import { buildFloor } from '../src/game/floor.js';
import { lanternCount, countType } from '../src/game/cards.js';
import {
  createState, resetState, activePlayer, nextPlayer, endTurn, enterRoom, checkWin,
  usableDoorways, pendingEncounters, lockEncounter, hasEncounterLock, playersInRoom,
  frontierDoorways, isRoomOpen, exitUnlocked, objectivesFound, objectivesRequired,
  objectivesAreCarried, canOfferObjective, escape, escapedCount, escapeesRequired,
  setOffer, clearOffer, lockOffer, convertToPossessed, guestsCannotWin, cleanGuestsRemaining,
  possessedPlayers, moveCostInto,
} from '../src/game/state.js';
import {
  search, canSearch, useBandage, useHint, resolveFullHand, roomYield, resolveMeeting,
  resolveTrade, resolveAttack, tradeableCards, overHandLimit,
} from '../src/game/actions.js';
import { countableCount } from '../src/game/cards.js';

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const floor = buildFloor(floor1, config);
const possessed = s => s.players.find(p => p.possessed);
const clean = s => s.players.filter(p => !p.possessed);

// --- Deal, hands, possession -------------------------------------------------------------
console.log('deck & deal');
let state = createState(floor, roster, 12345);
check(state.players.length === roster.length, `${state.players.length} players (the whole roster)`);
check(state.players.every(p => p.hand.length >= rules.handSize), 'everyone has at least a full hand');
check(state.players.every(p => lanternCount(p.hand) >= 1), 'every hand has at least one Lantern');
check(state.players.filter(p => p.possessed).length === 1, 'exactly one player possessed at setup');
check(countType(possessed(state).hand, 'possession') === rules.possessionSupply, `the possessed player holds ${rules.possessionSupply} Possession cards`);
const totalPoss = state.players.reduce((n, p) => n + countType(p.hand, 'possession'), 0);
check(totalPoss === rules.possessionSupply, 'no Possession cards leaked into other hands');
check(state.players.every(p => p.health === rules.maxHealth && p.alive), 'everyone starts at full health and alive');
check(state.players.every(p => p.actionPoints === rules.actionPointsPerTurn), `everyone starts with ${rules.actionPointsPerTurn} AP`);
check(!state.drawPile.some(c => c.type === 'possession'), 'the draw pile contains no Possession cards');
// deterministic
const a = createState(floor, roster, 999), b = createState(floor, roster, 999);
check(possessed(a).id === possessed(b).id && a.players[0].hand.map(c => c.type).join() === b.players[0].hand.map(c => c.type).join(), 'same seed → same deal');

// --- Turn structure ----------------------------------------------------------------------
console.log('turns');
state = createState(floor, roster, 7);
check(activePlayer(state).index === 0 && state.round === 1, 'starts on player 0, round 1');
activePlayer(state).actionPoints = 1;
let t = endTurn(state, floor);
check(t.to.index === 1 && activePlayer(state).actionPoints === rules.actionPointsPerTurn, 'End turn → next player with AP refilled');
for (let i = 0; i < roster.length - 1; i++) endTurn(state, floor);
check(activePlayer(state).index === 0 && state.round === 2, 'after a lap, back to player 0, round 2');
// dead players are skipped
state.players[1].alive = false;
state.activeIndex = 0;
check(nextPlayer(state).index === 2, 'nextPlayer skips a dead player');

// --- Moving & AP -------------------------------------------------------------------------
console.log('movement & action points');
state = createState(floor, roster, 3);
const p0 = activePlayer(state);
check(usableDoorways(state, floor, p0).length === 4, 'the central hall shows 4 usable doorways with a full turn');
let r = enterRoom(state, floor, p0, 'corridorE');
check(r.cost === 2 && p0.actionPoints === rules.actionPointsPerTurn - 2 && p0.currentRoom === 'corridorE', 'entering a new room costs 2 (discover + move)');
r = enterRoom(state, floor, p0, 'hall');
check(r.cost === 1 && p0.actionPoints === rules.actionPointsPerTurn - 3, 'stepping back into a known room costs 1');
p0.actionPoints = 1;
check(usableDoorways(state, floor, p0).length === 1, 'with 1 AP only the already-known door is usable (new rooms need 2)');
p0.actionPoints = 0;
check(usableDoorways(state, floor, p0).length === 0, 'no usable doorways with 0 AP');

// --- Searching ---------------------------------------------------------------------------
console.log('searching');
state = createState(floor, roster, 8);
const s0 = activePlayer(state);
s0.currentRoom = 'hall';
check(!search(state, floor, s0).ok && !canSearch(state, floor, s0).ok, 'a corridor / hall cannot be searched');
s0.currentRoom = 'dining';
const before = s0.hand.length, ap0 = s0.actionPoints;
r = search(state, floor, s0);
check(r.ok && s0.hand.length === before + 1 && s0.actionPoints === ap0 - 1, 'a searchable room draws a card for 1 AP');
r = search(state, floor, s0);
check(!r.ok && r.reason === 'searched', 'a room can only be searched once');
// Dark rooms are gated by `rules.darkRoomsRequireLight`, which is OFF for v0.1. Exercise both
// settings so the Phase 1 behaviour stays covered and the v0.1 decision is explicit.
s0.currentRoom = 'storage';
s0.hand = s0.hand.filter(c => c.type !== 'flashlight');
s0.actionPoints = 4;
check(search(state, floor, s0).ok, 'v0.1: a dark room is searchable with no Flashlight (gate off)');
rules.darkRoomsRequireLight = true;                       // temporarily behave like Phase 1
state.searchedRooms.delete('storage');
s0.actionPoints = 4;
r = search(state, floor, s0);
check(!r.ok && r.reason === 'dark', 'with the gate ON, a dark room needs a Flashlight');
s0.hand.push({ id: 'fl', type: 'flashlight' });
s0.actionPoints = 4;
check(search(state, floor, s0).ok, 'with the gate ON and a Flashlight, a dark room can be searched');
rules.darkRoomsRequireLight = false;                      // restore the v0.1 setting

// --- Trade: possession spreads unless a Lantern blocks -----------------------------------
console.log('trade & possession');
state = createState(floor, roster, 5);
let poss = possessed(state);
let victim = clean(state)[0];
// give victim a known non-lantern to offer, and strip lanterns so they cannot block
victim.hand = [{ id: 'v1', type: 'trinket' }, { id: 'v2', type: 'knife' }];
const possCard = poss.hand.find(c => c.type === 'possession');
r = resolveTrade(state, floor, poss, victim, possCard.id, 'v1');
check(r.ok && victim.possessed && r.possessed.some(e => e.newly === victim.id), 'a Possession card with no Lantern defence turns the victim possessed');
check(victim.hand.some(c => c.id === possCard.id), 'the newly possessed player now holds the Possession card (can spread it)');
check(poss.hand.some(c => c.id === 'v1'), 'the possessed giver received the offered card');

// block case
state = createState(floor, roster, 6);
poss = possessed(state);
victim = clean(state)[0];
victim.hand = [{ id: 'L', type: 'lantern' }, { id: 'x', type: 'trinket' }];
const before2 = poss.hand.length;
const pc2 = poss.hand.find(c => c.type === 'possession');
r = resolveTrade(state, floor, poss, victim, pc2.id, 'L');
check(r.ok && !victim.possessed && r.blocks.some(b => b.blocker === victim.id && b.revealed === poss.id), 'giving a Lantern blocks possession and reveals the possessed player');
check(victim.knows.has(poss.id), 'the defender now knows the giver is possessed');
check(poss.hand.some(c => c.id === 'L') && poss.hand.some(c => c.id === pc2.id), 'the Lantern goes to the giver and the Possession card stays on the possessed side');
check(!victim.hand.some(c => c.id === pc2.id), 'the blocked Possession card does not stay with the defender');

// a clean player may not offer a possession card
check(!tradeableCards(victim).some(c => c.type === 'possession'), 'a clean player cannot offer a Possession card');

// --- Attack ------------------------------------------------------------------------------
console.log('attack');
state = createState(floor, roster, 11);
let attacker = state.players[0], target = state.players[1];
attacker.hand.push({ id: 'kn', type: 'knife' });
attacker.actionPoints = 4;
// Attacks are only possible in a non-safe room; the starting hall is a safe zone.
check(!resolveAttack(state, floor, attacker, target, 'kn').ok
  && resolveAttack(state, floor, attacker, target, 'kn').reason === 'safe', 'no attacking in the safe starting room');
attacker.currentRoom = target.currentRoom = 'corridorE';
r = resolveAttack(state, floor, attacker, target, 'kn');
check(r.ok && r.damage === 1 && target.health === rules.maxHealth - 1 && attacker.actionPoints === 3, 'a knife drains 1 HP for 1 AP and stays in hand');
check(attacker.hand.some(c => c.id === 'kn'), 'the knife is reusable');
attacker.hand.push({ id: 'rv', type: 'revolver', shots: 2 });
target.health = 3;
r = resolveAttack(state, floor, attacker, target, 'rv');
check(r.ok && r.damage === 2 && target.health === 1 && !r.discarded, 'a revolver drains 2 HP, first shot leaves it in hand');
r = resolveAttack(state, floor, attacker, target, 'rv');
check(r.ok && target.health === 0 && r.killed && r.discarded && !attacker.hand.some(c => c.id === 'rv'), 'second shot kills and discards the empty revolver');
check(!target.alive, 'a player at 0 HP is dead');

// --- Bandage -----------------------------------------------------------------------------
console.log('bandage');
state = createState(floor, roster, 22);
let hurt = state.players[0];
hurt.health = 1; hurt.hand.push({ id: 'bd', type: 'bandage' }); hurt.actionPoints = 4;
r = useBandage(state, hurt, 'bd');
check(r.ok && hurt.health === 2 && hurt.actionPoints === 3 && !hurt.hand.some(c => c.id === 'bd'), 'a bandage heals 1 for 1 AP and is used up');

// --- Safe starting room ------------------------------------------------------------------
console.log('safe room');
state = createState(floor, roster, 4);
check(floor.rooms.get('hall').safe && !floor.rooms.get('corridorE').safe, 'the hall is flagged safe, corridors are not');
// Every player is together in the hall — a safe room forces no encounter.
check(pendingEncounters(state, floor, state.players[0]).length === 0, 'no forced encounter in the safe starting room even with others present');

// --- Encounter locks (in a normal room) --------------------------------------------------
console.log('encounter locks');
state = createState(floor, roster, 4);
state.players[0].currentRoom = state.players[1].currentRoom = state.players[2].currentRoom = 'corridorE';
const pend = pendingEncounters(state, floor, state.players[0]);
check(pend.length === 2, 'entering a normal room with two others forces an encounter with each');
lockEncounter(state, 'corridorE', 0, 1);
check(hasEncounterLock(state, 'corridorE', 1, 0), 'the lock is symmetric for the pair');
const after = pendingEncounters(state, floor, state.players[0]);
check(!after.some(q => q.index === 1) && after.some(q => q.index === 2), 'a locked pair is not forced again this round, but the third player still is');
endTurn(state, floor); for (let i = 0; i < roster.length - 1; i++) endTurn(state, floor); // new round clears locks
check(!hasEncounterLock(state, 'corridorE', 0, 1), 'encounter locks clear at the start of a new round');

// --- Possession cards & the hand limit ---------------------------------------------------
console.log('possession & hand limit');
const items6 = Array.from({ length: 6 }, (_, i) => ({ id: `i${i}`, type: 'trinket' }));
const poss3 = Array.from({ length: 3 }, (_, i) => ({ id: `p${i}`, type: 'possession' }));
check(overHandLimit({ hand: [...items6, ...poss3] }) === 0, 'six item cards + three Possession cards is NOT over the hand limit');
check(countableCount([...items6, ...poss3]) === 6, 'the public count ignores Possession cards (shows 6, not 9)');
check(overHandLimit({ hand: [...items6, { id: 'i7', type: 'trinket' }, ...poss3] }) === 1, 'a seventh ITEM card does put a player over the limit');

// --- Win conditions ----------------------------------------------------------------------
console.log('win conditions');
state = createState(floor, roster, 33);
let hero = clean(state)[0];
hero.hand = hero.hand.filter(c => c.type !== 'lantern');
hero.hand.push({ id: 'l1', type: 'lantern' }, { id: 'l2', type: 'lantern' }, { id: 'l3', type: 'lantern' });
check(checkWin(state, floor, hero) === 'humans' && state.won === 'humans', 'a clean player with 3 Lanterns entering the exit wins for the humans');
state = createState(floor, roster, 34);
for (const p of clean(state)) p.possessed = true;
check(checkWin(state, floor) === 'possessed', 'everyone possessed → possessed win');
state = createState(floor, roster, 35);
for (const p of clean(state)) p.alive = false;
check(checkWin(state, floor) === 'possessed', 'all clean players dead → possessed win');



// =========================================================================================
// PHASE 0 — PRACTICE MODE
// =========================================================================================
console.log('practice: setup');
const solo = roster.slice(0, 1);
const P0 = (seed = 20260917) => createState(floor, solo, seed, { practice: true });
let ps = P0();
let pp = activePlayer(ps);
check(ps.players.length === 1 && ps.practice === true, 'practice runs a single guest');
check(!pp.possessed && !ps.players.some(p => p.possessed), 'nobody is possessed in practice');
check(pp.hand.length === rules.startingHandSize, `the starting hand is ${rules.startingHandSize} cards`);
check(lanternCount(pp.hand) >= 1, 'the starting hand contains a Lantern');
const PHASE0 = new Set(Object.keys(rules.practiceDeck));
check(pp.hand.every(c => PHASE0.has(c.type)) && ps.drawPile.every(c => PHASE0.has(c.type)),
  'only Lantern / Hint / Distraction are dealt in practice');
check(!ps.drawPile.some(c => c.type === 'possession'), 'no Possession cards in the practice pile');
check(pp.actionPoints === rules.actionPointsPerTurn, `${rules.actionPointsPerTurn} action points to start`);
// A deterministic seed means the same practice hotel every time.
const s1 = P0(4242), s2 = P0(4242);
check(s1.players[0].hand.map(c => c.type).join() === s2.players[0].hand.map(c => c.type).join(),
  'the same seed deals the same practice hand');

console.log('practice: map roles');
const roleCount = id => floor.roomList.filter(r => r.role === id).length;
check(floor.roomList.length === rules.totalRooms, `${floor.roomList.length} rooms matches rules.totalRooms`);
check(roleCount('item') === rules.itemSearchRooms, `${roleCount('item')} item rooms matches rules.itemSearchRooms`);
check(roleCount('objective') === rules.objectiveCount, `${roleCount('objective')} objective rooms matches rules.objectiveCount`);
check(roleCount('utility') === 1 && roleCount('lobby') === 1 && roleCount('exit') === 1, 'one lobby, one utility room, one exit');
check(ps.drawPile.length >= rules.itemSearchRooms,
  `the practice pile (${ps.drawPile.length}) covers all ${rules.itemSearchRooms} item rooms`);

console.log('practice: action points');
ps = P0(); pp = activePlayer(ps);
let pr = enterRoom(ps, floor, pp, 'corridorE');
check(pr.cost === rules.newRoomEntryCost && pp.actionPoints === rules.actionPointsPerTurn - rules.newRoomEntryCost,
  `entering an undiscovered room costs ${rules.newRoomEntryCost}`);
pr = enterRoom(ps, floor, pp, 'hall');
check(pr.cost === rules.knownRoomMoveCost, `stepping back into a known room costs ${rules.knownRoomMoveCost}`);
pp.actionPoints = 1;
check(!usableDoorways(ps, floor, pp).some(d => !ps.discovered.has(d.otherRoom('hall'))),
  'with 1 action point no undiscovered room is offered');
pp.actionPoints = 0;
check(usableDoorways(ps, floor, pp).length === 0, 'no doorways are usable with 0 action points');
// AP never carries over.
pp.actionPoints = 3;
const t0 = endTurn(ps, floor);
check(t0.to === pp && pp.actionPoints === rules.actionPointsPerTurn, 'end turn refills action points for the solo guest');
check(ps.round === 2, 'a solo turn advances the round');

console.log('practice: searching');
ps = P0(); pp = activePlayer(ps);
const searchIn = (room) => { pp.currentRoom = room; pp.actionPoints = rules.actionPointsPerTurn; return search(ps, floor, pp); };
check(roomYield(floor.rooms.get('dining')) === 'card'
  && roomYield(floor.rooms.get('lounge')) === 'objective'
  && roomYield(floor.rooms.get('housekeeping')) === 'nothing', 'room roles decide what a search yields');
let sr = searchIn('dining');
check(sr.ok && sr.kind === 'card' && sr.card && pp.actionPoints === rules.actionPointsPerTurn - rules.searchCost,
  `an item room gives one card for ${rules.searchCost} action`);
check(!search(ps, floor, pp).ok && search(ps, floor, pp).reason === 'searched', 'a room can only be searched once');
sr = searchIn('housekeeping');
check(sr.ok && sr.kind === 'nothing', 'the utility room reports that it is empty rather than failing silently');
pp.currentRoom = 'hall';
check(!canSearch(ps, floor, pp).ok && canSearch(ps, floor, pp).reason === 'notSearchable', 'the lobby cannot be searched');
pp.currentRoom = 'storage'; pp.actionPoints = 4;
check(search(ps, floor, pp).ok, 'a dark room is searchable in practice (there is no Flashlight card)');

console.log('practice: objectives and the sealed exit');
ps = P0(); pp = activePlayer(ps);
check(!exitUnlocked(ps) && !isRoomOpen(ps, floor, 'exit'), 'the exit starts sealed');
pp.currentRoom = 'stairs'; ps.discovered.add('stairs'); pp.actionPoints = 4;
check(!usableDoorways(ps, floor, pp).some(d => d.otherRoom('stairs') === 'exit'), 'the sealed exit is not a usable doorway');
check(!frontierDoorways(ps, floor).some(d => d.a === 'exit' || d.b === 'exit'), 'the sealed exit is not shown as somewhere left to explore');
check(checkWin(ps, floor, pp) === null, 'reaching the exit early does not finish practice');
const objectiveRooms = floor.roomList.filter(r => r.role === 'objective').map(r => r.id);
objectiveRooms.forEach((id, i) => {
  const r = searchIn(id);
  check(r.ok && r.kind === 'objective' && r.found === i + 1, `objective ${i + 1} of ${r.required} found in ${id}`);
  check(r.exitJustUnlocked === (i === objectiveRooms.length - 1), `the exit opens only on objective ${objectiveRooms.length}`);
});
check(objectivesFound(ps) === objectivesRequired() && exitUnlocked(ps), 'all objectives found unlocks the exit');
check(isRoomOpen(ps, floor, 'exit'), 'the exit is now open');
pp.currentRoom = 'stairs'; pp.actionPoints = 4;
check(usableDoorways(ps, floor, pp).some(d => d.otherRoom('stairs') === 'exit'), 'the exit doorway becomes usable');
check(checkWin(ps, floor, pp) === null, 'standing next to the exit is not escaping');
pp.currentRoom = floor.exitRoom;
check(checkWin(ps, floor, pp) === 'practice' && ps.finished, 'reaching the exit with every objective completes practice');

console.log('practice: Hint');
ps = P0(); pp = activePlayer(ps);
pp.hand.push({ id: 'hint1', type: 'hint' });
const before0 = ps.discovered.size, ap1 = pp.actionPoints;
let hr = useHint(ps, floor, pp, 'hint1');
check(hr.ok && ps.discovered.size === before0 + 1, 'a Hint reveals one adjacent room');
check(pp.currentRoom === 'hall', 'a Hint never moves the player');
check(pp.actionPoints === ap1 - rules.playCardCost, `a Hint costs ${rules.playCardCost} action`);
check(!pp.hand.some(c => c.id === 'hint1'), 'the Hint is used up');
// Reveal the rest of the hall's neighbours, then the Hint has nothing left to show.
for (const d of floor.rooms.get('hall').doorways) ps.discovered.add(d.otherRoom('hall'));
pp.hand.push({ id: 'hint2', type: 'hint' }); pp.actionPoints = 4;
check(useHint(ps, floor, pp, 'hint2').reason === 'nothingAdjacent', 'a Hint fails plainly when every room next door is known');
// It must never point at the sealed exit.
ps = P0(); pp = activePlayer(ps);
pp.currentRoom = 'stairs'; ps.discovered.add('stairs'); ps.discovered.add('serviceCorridor'); ps.discovered.add('housekeeping');
pp.hand.push({ id: 'hint3', type: 'hint' }); pp.actionPoints = 4;
check(useHint(ps, floor, pp, 'hint3').reason === 'nothingAdjacent', 'a Hint will not reveal the sealed exit');

console.log('practice: the six-card hand limit');
ps = P0(); pp = activePlayer(ps);
pp.hand = Array.from({ length: rules.handLimit }, (_, i) => ({ id: `f${i}`, type: 'lantern' }));
pp.currentRoom = 'dining'; pp.actionPoints = 4;
sr = search(ps, floor, pp);
check(sr.ok && sr.full === true, 'searching on a full hand reports it');
check(pp.hand.length === rules.handLimit, 'the found card is NOT added silently');
check(ps.searchedRooms.has('dining'), 'the room still counts as searched, so it cannot be farmed');
let fr = resolveFullHand(ps, pp, sr.card, 'take', 'f0');
check(fr.ok && pp.hand.some(c => c.id === sr.card.id) && !pp.hand.some(c => c.id === 'f0')
  && pp.hand.length === rules.handLimit, 'taking the card drops one and stays at the limit');
// Leaving it instead puts it back in the pile.
ps = P0(); pp = activePlayer(ps);
pp.hand = Array.from({ length: rules.handLimit }, (_, i) => ({ id: `g${i}`, type: 'lantern' }));
pp.currentRoom = 'cloakroom'; pp.actionPoints = 4;
sr = search(ps, floor, pp);
const pile0 = ps.drawPile.length;
fr = resolveFullHand(ps, pp, sr.card, 'leave');
check(fr.ok && pp.hand.length === rules.handLimit && ps.drawPile.length === pile0 + 1, 'leaving the card returns it to the pile');
check(overHandLimit(pp) === 0, 'the player is never left over the limit');



// =========================================================================================
// PHASE 0 CORRECTION PASS
// =========================================================================================
console.log('correction: objectives are public team progress');
let cs = createState(floor, solo, 4242, { practice: true });
let cp = activePlayer(cs);
const objRoomIds = floor.roomList.filter(r => r.role === 'objective').map(r => r.id);
check(objectivesAreCarried() === false, 'objectives are never carried (legacyCarriedExitKey is off)');
check(canOfferObjective() === false, 'an objective can never be offered');
check(rules.legacyCarriedExitKey === false, 'the old three-Lanterns Exit Key model is disabled for v0.1');

const handBefore = cp.hand.map(c => c.id).join();
cp.currentRoom = objRoomIds[0]; cp.actionPoints = 4;
let cr = search(cs, floor, cp);
check(cr.ok && cr.kind === 'objective', 'searching an objective room yields an objective');
check(cp.hand.map(c => c.id).join() === handBefore, 'the objective is NOT added to the hand');
check(cs.objectivesFound.has(objRoomIds[0]), 'the objective is recorded against the ROOM');
check(!Object.keys(cp).some(k => /objective/i.test(k)), 'no objective field is attached to the player');
check(cs.players.every(p => p.hand.every(c => !objRoomIds.includes(c.id) && !objRoomIds.includes(c.type))),
  'no objective ever appears as a card in any hand');
check(!cs.drawPile.some(c => objRoomIds.includes(c.type)), 'no objective is ever in the draw pile');
// It cannot be offered, even by id.
check(setOffer(cs, cp, objRoomIds[0]).reason === 'objectiveNotOfferable', 'an objective cannot be set as an Offer');
// A Challenge cannot take one: after an attack the found set is untouched.
{
  const ms = createState(floor, roster, 77);
  const A = ms.players[0], B = ms.players[1];
  ms.objectivesFound.add(objRoomIds[0]);
  A.currentRoom = B.currentRoom = 'corridorE';
  A.hand.push({ id: 'kn2', type: 'knife' }); A.actionPoints = 4;
  const before = [...ms.objectivesFound];
  resolveAttack(ms, floor, A, B, 'kn2');
  check(JSON.stringify([...ms.objectivesFound]) === JSON.stringify(before), 'a Challenge cannot take an objective');
  check(![...A.hand, ...B.hand].some(c => objRoomIds.includes(c.type)), 'a Challenge never moves an objective into a hand');
}

console.log('correction: the exit is a safe end-zone resolved first');
cs = createState(floor, solo, 4242, { practice: true });
cp = activePlayer(cs);
const exitRoom = floor.rooms.get(floor.exitRoom);
check(exitRoom.safe === true, 'the exit room is flagged safe');
check(escapeesRequired(cs) === rules.requiredEscapees, `practice needs ${rules.requiredEscapees} clean escapee`);
check(escapeesRequired({ practice: false }) === rules.escapeesAtBalanceCount,
  `the six-player target is ${rules.escapeesAtBalanceCount} clean escapees`);
// Sealed: entering does nothing.
cp.currentRoom = floor.exitRoom;
check(escape(cs, floor, cp).reason === 'sealed', 'you cannot escape while the exit is sealed');
check(checkWin(cs, floor, cp) === null && !cs.finished, 'entering a sealed exit does not finish the run');
// Unlock and escape.
objRoomIds.forEach(id => cs.objectivesFound.add(id));
check(exitUnlocked(cs), 'the exit unlocks with every objective found');
check(checkWin(cs, floor, cp) === 'practice' && cs.finished, 'a clean guest at the open exit completes the run');
check(escapedCount(cs) === 1 && cs.escaped.has(cp.id), 'the escape is recorded');
// Permanent.
cp.possessed = true;
check(cs.escaped.has(cp.id), 'an escape stays recorded even if the player is later possessed');
// A possessed guest may stand in the exit and nothing happens.
{
  const es = createState(floor, solo, 5, { practice: true });
  const ep = activePlayer(es);
  objRoomIds.forEach(id => es.objectivesFound.add(id));
  ep.possessed = true; ep.currentRoom = floor.exitRoom;
  check(escape(es, floor, ep).reason === 'possessed', 'a possessed guest cannot escape');
  check(checkWin(es, floor, ep) === null && !es.finished, 'a possessed guest standing in the exit does not finish the run');
  check(escapedCount(es) === 0, 'no escape is recorded for a possessed guest');
}
// ORDER: the exit never generates a meeting, even with someone already standing in it.
{
  const os = createState(floor, roster, 9);
  os.objectivesFound = new Set(objRoomIds);
  const A = os.players[0], B = os.players[1];
  A.currentRoom = B.currentRoom = floor.exitRoom;
  check(pendingEncounters(os, floor, A).length === 0, 'arriving in the exit generates NO forced meeting');
  check(resolveMeeting(os, floor, A, B).reason === 'safeRoom', 'a meeting cannot be resolved inside the exit');
  A.hand.push({ id: 'kn3', type: 'knife' }); A.actionPoints = 4;
  check(resolveAttack(os, floor, A, B, 'kn3').reason === 'safe', 'a Challenge cannot be made inside the exit');
}

console.log('correction: meetings resolve from pre-committed offers');
{
  const ms = createState(floor, roster, 31);
  const A = ms.players[0], B = ms.players[1];
  ms.activeIndex = 0;
  A.hand = [{ id: 'a1', type: 'lantern' }, { id: 'a2', type: 'hint' }];
  B.hand = [{ id: 'b1', type: 'distraction' }];
  // An offer can only be set on your OWN turn.
  check(setOffer(ms, B, 'b1').reason === 'notYourTurn', 'a player cannot set an Offer on someone else\'s turn');
  check(setOffer(ms, A, 'a2').ok, 'the active player sets their own Offer');
  check(A.offer === 'a2' && A.intent === 'trade', 'the Offer and intent are stored on the player');
  // B commits on B's own turn.
  ms.activeIndex = 1;
  check(setOffer(ms, B, 'b1').ok, 'the other player committed their Offer on their own turn');
  ms.activeIndex = 0;
  // Now the meeting resolves with NO further input from B.
  A.currentRoom = B.currentRoom = 'corridorE';
  const r = resolveMeeting(ms, floor, A, B);
  check(r.ok, 'the meeting resolves from the two stored offers alone');
  check(A.hand.some(c => c.id === 'b1') && B.hand.some(c => c.id === 'a2'), 'the pre-committed cards changed hands');
  check(A.offer === null && B.offer === null, 'both Offers are cleared after the meeting');
  check(A.intent === 'trade' && B.intent === 'trade', 'both intents reset after the meeting');
  // resolveMeeting takes exactly four arguments: state, floor, mover, other. No callback, no
  // prompt, nothing that could ask the off-turn player anything.
  check(resolveMeeting.length === 4, 'resolveMeeting takes no decision callback (arity 4)');
}
// An Offer never survives the turn that set it.
{
  const ts = createState(floor, roster, 32);
  const A = activePlayer(ts);
  A.hand = [{ id: 'z1', type: 'lantern' }];
  setOffer(ts, A, 'z1');
  check(A.offer === 'z1', 'an Offer is set');
  clearOffer(A);
  check(A.offer === null && A.intent === 'trade', 'clearOffer resets both fields');
}
// Only the possessed side can commit a possess intent.
{
  const ps2 = createState(floor, roster, 33);
  const clean0 = ps2.players.find(p => !p.possessed);
  ps2.activeIndex = clean0.index;
  clean0.hand = [{ id: 'c1', type: 'lantern' }];
  setOffer(ps2, clean0, 'c1', 'possess');
  check(clean0.intent === 'trade', 'a clean player cannot commit a possess intent');
}

console.log('correction: dark rooms are atmosphere only');
check(rules.darkRoomsRequireLight === false, 'darkRoomsRequireLight is off for v0.1');
{
  const ds = createState(floor, solo, 8, { practice: true });
  const dp = activePlayer(ds);
  const darkRooms = floor.roomList.filter(r => r.dark && r.searchable);
  check(darkRooms.length > 0, `${darkRooms.length} dark rooms still carry the flag for lighting`);
  for (const r of darkRooms) {
    dp.currentRoom = r.id; dp.actionPoints = 4; dp.hand = [];
    check(canSearch(ds, floor, dp).ok, `${r.id} is searchable with no Flashlight`);
  }
  check(!Object.keys(rules.practiceDeck).includes('flashlight'), 'no Flashlight card is dealt in v0.1');
}

console.log('correction: search points');
{
  const ss2 = createState(floor, solo, 11, { practice: true });
  const sp = activePlayer(ss2);
  const searchable = floor.roomList.filter(r => r.searchable);
  check(searchable.every(r => !!r.searchPoint), 'every searchable room names the thing you actually search');
  check(searchable.length === rules.itemSearchRooms + rules.objectiveCount + 1,
    `${searchable.length} searchable rooms = ${rules.itemSearchRooms} item + ${rules.objectiveCount} objective + 1 utility`);
  sp.currentRoom = 'corridorW'; sp.actionPoints = 4;
  const sr2 = search(ss2, floor, sp);
  check(sr2.ok && sr2.searchPoint === floor.rooms.get('corridorW').searchPoint,
    `the result names the search point ("${sr2.searchPoint}"), not the corridor`);
}

// =============================================================================================
// PHASE 1 — the hot-seat rules sandbox. Everything above tests practice and the legacy engine
// and is unaffected: applyMode() is called here, at the end, and practice is restored after.
// =============================================================================================
console.log('\nphase 1: hot-seat configuration');
applyMode('hotseat', 6);
const HS = roster.slice(0, 6);
const hs = (seed = 101) => createState(floor, HS, seed, { mode: 'hotseat' });

check(rules.gameMode === 'hotseatRulesV1', 'gameMode is hotseatRulesV1');
check(rules.playerCount === 6, 'playerCount 6');
check(rules.actionPointsPerTurn === 4, 'actionPointsPerTurn 4');
check(rules.knownRoomMoveCost === 1, 'knownRoomMoveCost 1');
check(rules.newRoomEntryCost === 2, 'newRoomEntryCost 2');
check(rules.searchCost === 1, 'searchCost 1');
check(rules.startingHandSize === 4, 'startingHandSize 4');
check(rules.handLimit === 6, 'handLimit 6');
check(rules.itemSearchRooms === 12, 'itemSearchRooms 12');
check(rules.objectiveCount === 3, 'objectiveCount 3');
check(rules.requiredCleanEscapees === 2, 'requiredCleanEscapees 2');
check(rules.roundLimit === 8, 'roundLimit 8');
check(rules.turnTimerEnabled === true, 'turnTimerEnabled true');
check(rules.turnTimerSeconds === 45, 'turnTimerSeconds 45');
check(rules.healthEnabled === false, 'healthEnabled false');
check(rules.combatEnabled === false, 'combatEnabled false');
check(rules.lockedDoorsEnabled === false, 'lockedDoorsEnabled false');
check(rules.legacyCarriedExitKey === false, 'legacyCarriedExitKey false');
check(rules.onlineMode === false, 'onlineMode false — no server, no networking');
check(rules.totalRooms === 18 && floor.roomList.length === 18, '18 rooms, the corrected map');
check(rules.actionCost.move === 1 && rules.actionCost.discover === 1 && rules.actionCost.search === 1,
  'the derived action costs follow the flat values');

// Table scaling for four and five players.
check(objectivesForPlayers(4) === 2 && objectivesForPlayers(5) === 3 && objectivesForPlayers(6) === 3,
  'objectives = ceiling(players / 2)');
check(cleanEscapeesForPlayers(4) === 1 && cleanEscapeesForPlayers(5) === 1 && cleanEscapeesForPlayers(6) === 2,
  'clean escapees = maximum(1, floor(players / 3))');
applyMode('hotseat', 4);
check(rules.objectiveCount === 2 && rules.requiredCleanEscapees === 1, 'a four-player table needs 2 objectives and 1 clean escape');
applyMode('hotseat', 5);
check(rules.objectiveCount === 3 && rules.requiredCleanEscapees === 1, 'a five-player table needs 3 objectives and 1 clean escape');
applyMode('hotseat', 6);

console.log('phase 1: setup and roles');
{
  const s1 = hs(2001);
  check(s1.players.length === 6, 'six guests at the table');
  check(s1.mode === 'hotseat' && s1.hotseat === true && s1.practice === false, 'the state knows it is a hot-seat game');
  check(s1.players.filter(p => p.possessed).length === 1, 'exactly ONE hidden Possessor');
  check(s1.players.every(p => p.hand.length === rules.startingHandSize), 'four cards each');
  check(s1.players.every(p => lanternCount(p.hand) >= 1), 'every starting hand holds at least one Lantern');
  check(s1.players.every(p => countType(p.hand, 'possession') === 0), 'NO Possession cards are dealt — possession is an intent, not a card');
  check(s1.players.every(p => p.hand.every(c => ['lantern', 'hint', 'distraction'].includes(c.type))),
    'only the three approved card types are dealt');
  check(s1.players.every(p => p.roleSeen === false && p.roleChangePending === false), 'nobody has acknowledged a role yet');
  const dealt = 6 * rules.startingHandSize;
  const total = Object.values(rules.hotseatDeck).reduce((a, b) => a + b, 0);
  check(total - dealt >= rules.itemSearchRooms,
    `the draw pile covers every item room after dealing (${total} - ${dealt} = ${total - dealt} >= ${rules.itemSearchRooms})`);
  check(s1.drawPile.length === total - dealt, `${s1.drawPile.length} cards left in the pile`);
  check(s1.log.length === 0, 'the public log starts empty');
}

console.log('phase 1: turn structure and Offers');
{
  const s = hs(2002);
  const a = s.players[0];
  check(a.actionPoints === 4, 'the turn starts with 4 action points');
  check(a.offerLocked === false, 'the Offer is open at the start of a turn');
  check(setOffer(s, a, a.hand[0].id).ok, 'the active player commits an Offer');
  check(setOffer(s, s.players[1], s.players[1].hand[0].id).reason === 'notYourTurn',
    'nobody can set an Offer while it is not their turn');
  // The first action locks it.
  a.currentRoom = 'hall';
  enterRoom(s, floor, a, 'corridorE');
  check(a.offerLocked === true, 'the first action of the turn locks the Offer');
  check(setOffer(s, a, a.hand[1].id).reason === 'locked', 'a locked Offer cannot be changed');
  // It stands past the end of the turn — that is the whole point of a pre-committed Offer.
  const kept = a.offer;
  endTurn(s, floor);
  check(a.offer === kept, 'the Offer stands after the turn ends, waiting for someone to walk in');
  check(s.players[1].offerLocked === false, 'the next player may set their own Offer');
  check(s.meetingThisTurn === false, 'the one-meeting-per-turn flag resets each turn');
}
{
  // Searching and playing a Hint also lock it, so no interface can forget to.
  const s = hs(2003);
  const a = s.players[0];
  setOffer(s, a, a.hand[0].id);
  a.currentRoom = 'corridorW'; a.actionPoints = 4;
  search(s, floor, a);
  check(a.offerLocked === true, 'searching locks the Offer');
}
{
  const s = hs(2004);
  const a = s.players[0];
  const hint = a.hand.find(c => c.type === 'hint') || { id: 'h9', type: 'hint' };
  if (!a.hand.includes(hint)) a.hand.push(hint);
  setOffer(s, a, a.hand[0].id);
  a.currentRoom = 'hall'; a.actionPoints = 4;
  useHint(s, floor, a, hint.id);
  check(a.offerLocked === true, 'playing a Hint locks the Offer');
}
{
  // Not enough action points: the move is simply not affordable.
  const s = hs(2005);
  const a = s.players[0];
  a.actionPoints = 1;
  check(moveCostInto(s, 'corridorE') === 2, 'entering an undiscovered room costs 2');
  check(!usableDoorways(s, floor, a).some(d => d.otherRoom('hall') === 'corridorE') || false
    || usableDoorways(s, floor, a).every(d => moveCostInto(s, d.otherRoom('hall')) <= 1),
    'a doorway that cannot be afforded is not offered');
}

console.log('phase 1: meetings resolve from the two Offers alone');
// 1. Distraction cancels the meeting from either side.
{
  const s = hs(2101);
  const A = s.players[0], B = s.players[1];
  A.hand = [{ id: 'a1', type: 'hint' }]; B.hand = [{ id: 'b1', type: 'distraction' }];
  s.activeIndex = 1; setOffer(s, B, 'b1');
  s.activeIndex = 0; setOffer(s, A, 'a1');
  A.currentRoom = B.currentRoom = 'corridorE';
  const r = resolveMeeting(s, floor, A, B);
  check(r.ok && r.outcome === 'cancelled', 'a Distraction cancels the meeting');
  check(!B.hand.some(c => c.id === 'b1'), 'the Distraction is spent');
  check(A.hand.some(c => c.id === 'a1'), 'the other card is NOT exchanged');
  check(A.offer === null && B.offer === null && A.intent === 'trade' && B.intent === 'trade',
    'both Offers and intents reset after the meeting');
  check(!/possess/i.test(r.publicText), 'the public line gives nothing away about roles');
}
// 2. A Distraction beats a possession attempt too, and reveals nothing.
{
  const s = hs(2102);
  const A = s.players[0], B = s.players[1];
  A.possessed = true; B.possessed = false;
  A.hand = [{ id: 'a1', type: 'hint' }]; B.hand = [{ id: 'b1', type: 'distraction' }];
  s.activeIndex = 1; setOffer(s, B, 'b1');
  s.activeIndex = 0; setOffer(s, A, 'a1', 'possess');
  check(A.intent === 'possess', 'the possessed side may commit a possess intent');
  A.currentRoom = B.currentRoom = 'corridorE';
  const r = resolveMeeting(s, floor, A, B);
  check(r.outcome === 'cancelled' && !B.possessed, 'a Distraction stops a possession attempt');
  check(B.knows.size === 0, 'and tells the defender nothing about who tried');
}
// 3. A Lantern in the Offer BLOCKS possession: spent, not traded, and privately revealing.
{
  const s = hs(2103);
  const A = s.players[0], B = s.players[1];
  A.possessed = true; B.possessed = false; B.knows = new Set();
  A.hand = [{ id: 'a1', type: 'hint' }]; B.hand = [{ id: 'b1', type: 'lantern' }, { id: 'b2', type: 'hint' }];
  s.activeIndex = 1; setOffer(s, B, 'b1');
  s.activeIndex = 0; setOffer(s, A, 'a1', 'possess');
  A.currentRoom = B.currentRoom = 'corridorE';
  const r = resolveMeeting(s, floor, A, B);
  check(r.outcome === 'blocked', 'the possession attempt is blocked');
  check(!B.possessed, 'the target is NOT possessed');
  check(!B.hand.some(c => c.id === 'b1'), 'the Lantern is consumed');
  check(!A.hand.some(c => c.id === 'b1'), 'the Lantern is NOT handed to the attacker');
  check(A.hand.some(c => c.id === 'a1'), 'no card changes hands at all');
  check(B.knows.has(A.id), 'the target privately learns who attacked them');
  check(!r.publicText.includes('POSSESSED') && /blocked/i.test(r.publicText),
    `the public line says only that an attempt was blocked ("${r.publicText}")`);
  check(s.log.at(-1).text === r.publicText, 'the public log records exactly that line');
  check(B.notes.length === 1 && B.notes[0].includes(A.name), "the attacker's name goes to the target's PRIVATE notes");
  check(!s.log.some(l => l.text.includes('POSSESSED')), 'nothing in the public log names a role');
}
// 4. An unguarded target is possessed, with no normal exchange and no public tell.
{
  const s = hs(2104);
  const A = s.players[0], B = s.players[1];
  A.possessed = true; B.possessed = false;
  A.hand = [{ id: 'a1', type: 'hint' }]; B.hand = [{ id: 'b1', type: 'hint' }];
  s.activeIndex = 1; setOffer(s, B, 'b1');
  s.activeIndex = 0; setOffer(s, A, 'a1', 'possess');
  A.currentRoom = B.currentRoom = 'corridorE';
  const r = resolveMeeting(s, floor, A, B);
  check(r.outcome === 'possessed' && B.possessed, 'an unguarded guest is possessed');
  check(B.roleChangePending === true, 'the role change waits for that player’s own private screen');
  check(A.hand.some(c => c.id === 'a1') && B.hand.some(c => c.id === 'b1'), 'no normal exchange happens');
  check(/No cards changed hands/.test(r.publicText), 'publicly it looks like an ordinary empty meeting');
  check(B.notes.length === 1, 'the new Possessor has a private note waiting');
}
// 5. Possess against someone already possessed is an ordinary trade.
{
  const s = hs(2105);
  const A = s.players[0], B = s.players[1];
  A.possessed = true; B.possessed = true;
  A.hand = [{ id: 'a1', type: 'hint' }]; B.hand = [{ id: 'b1', type: 'lantern' }];
  s.activeIndex = 1; setOffer(s, B, 'b1');
  s.activeIndex = 0; setOffer(s, A, 'a1', 'possess');
  A.currentRoom = B.currentRoom = 'corridorE';
  const r = resolveMeeting(s, floor, A, B);
  check(r.outcome === 'trade' && r.swap === true, 'it resolves as a normal Trade');
  check(A.hand.some(c => c.id === 'b1') && B.hand.some(c => c.id === 'a1'), 'the two cards swapped');
}
// 6. An ordinary meeting exchanges both Offers at once; Nothing transfers nothing.
{
  const s = hs(2106);
  const A = s.players[0], B = s.players[1];
  A.possessed = false; B.possessed = false;
  A.hand = [{ id: 'a1', type: 'hint' }]; B.hand = [{ id: 'b1', type: 'lantern' }];
  s.activeIndex = 1; setOffer(s, B, 'b1');
  s.activeIndex = 0; setOffer(s, A, 'a1');
  A.currentRoom = B.currentRoom = 'corridorE';
  const r = resolveMeeting(s, floor, A, B);
  check(r.outcome === 'trade' && A.hand.some(c => c.id === 'b1') && B.hand.some(c => c.id === 'a1'),
    'both Offers change hands simultaneously');
}
{
  const s = hs(2107);
  const A = s.players[0], B = s.players[1];
  A.possessed = false; B.possessed = false;
  A.hand = [{ id: 'a1', type: 'hint' }]; B.hand = [{ id: 'b1', type: 'lantern' }];
  s.activeIndex = 1; setOffer(s, B, null);
  s.activeIndex = 0; setOffer(s, A, null);
  A.currentRoom = B.currentRoom = 'corridorE';
  const r = resolveMeeting(s, floor, A, B);
  check(r.outcome === 'nothing' && A.hand.length === 1 && B.hand.length === 1, 'an Offer of Nothing transfers nothing');
}
// 7. One forced meeting per turn, and never in the lobby or the exit.
{
  const s = hs(2108);
  const A = s.players[0], B = s.players[1], C = s.players[2];
  A.currentRoom = B.currentRoom = C.currentRoom = 'corridorE';
  check(pendingEncounters(s, floor, A).length === 2, 'two guests are here to choose between');
  const r = resolveMeeting(s, floor, A, B);
  check(r.ok && s.meetingThisTurn === true, 'the meeting is recorded for this turn');
  check(pendingEncounters(s, floor, A).length === 0, 'no SECOND forced meeting can happen this turn');
  endTurn(s, floor);
  check(s.meetingThisTurn === false, 'the next turn may force a meeting again');
}
{
  const s = hs(2109);
  const A = s.players[0], B = s.players[1];
  A.currentRoom = B.currentRoom = floor.start.room;
  check(floor.rooms.get(floor.start.room).safe, 'the lobby is a safe room');
  check(pendingEncounters(s, floor, A).length === 0, 'the lobby never forces a meeting');
  check(resolveMeeting(s, floor, A, B).reason === 'safeRoom', 'a meeting cannot be resolved in the lobby');
}

console.log('phase 1: the exit is resolved before any meeting');
{
  const s = hs(2201);
  const objRooms = floor.roomList.filter(r => r.role === 'objective').map(r => r.id);
  objRooms.slice(0, rules.objectiveCount).forEach(id => s.objectivesFound.add(id));
  check(exitUnlocked(s), 'the exit opens once every objective is in');
  const A = s.players[0], B = s.players[1];
  A.possessed = false; B.possessed = true;
  B.currentRoom = floor.exitRoom;
  A.currentRoom = floor.exitRoom;
  // ORDER: the arriving guest escapes; standing in the exit with someone else forces nothing.
  check(pendingEncounters(s, floor, A).length === 0, 'arriving in the exit forces NO meeting, even with someone there');
  check(resolveMeeting(s, floor, A, B).reason === 'safeRoom', 'a meeting can never be resolved in the exit');
  check(resolveAttack(s, floor, A, B, 'x').reason === 'combatDisabled', 'there is no Challenge in this mode at all');
  const won = checkWin(s, floor, A);
  check(s.escaped.has(A.id), 'the clean guest escaped on entry');
  check(won === null, 'one escape of two does not finish a six-player match');
  check(escapedCount(s) === 1 && escapeesRequired(s) === 2, '1 of 2 clean guests are out');
}
{
  // A possessed guest may stand in the exit and nothing happens.
  const s = hs(2202);
  floor.roomList.filter(r => r.role === 'objective').slice(0, rules.objectiveCount).forEach(r => s.objectivesFound.add(r.id));
  const P = s.players[0]; P.possessed = true; P.currentRoom = floor.exitRoom;
  check(checkWin(s, floor, P) !== 'guests', 'a possessed guest in the exit does not win it for the guests');
  check(escapedCount(s) === 0, 'and no escape is recorded');
}
{
  // Escaping is permanent: no more turns, not on the map, not available to meet.
  const s = hs(2203);
  floor.roomList.filter(r => r.role === 'objective').slice(0, rules.objectiveCount).forEach(r => s.objectivesFound.add(r.id));
  const A = s.players[1];
  A.possessed = false; A.currentRoom = floor.exitRoom;
  escape(s, floor, A);
  s.activeIndex = 0;
  check(nextPlayer(s).index === 2, 'the escaped guest is skipped in the turn order');
  check(!playersInRoom(s, floor.exitRoom).some(p => p.id === A.id), 'an escaped guest is no longer in the room');
  // Even if something moved them into an ordinary room, they are out and cannot be met.
  const B = s.players[2]; B.currentRoom = 'corridorE'; A.currentRoom = 'corridorE';
  check(resolveMeeting(s, floor, B, A).reason === 'escaped', 'an escaped guest cannot be met');
}

console.log('phase 1: win conditions');
{
  const s = hs(2301);
  floor.roomList.filter(r => r.role === 'objective').slice(0, rules.objectiveCount).forEach(r => s.objectivesFound.add(r.id));
  const [A, B] = [s.players[0], s.players[1]];
  A.possessed = B.possessed = false;
  A.currentRoom = B.currentRoom = floor.exitRoom;
  escape(s, floor, A);
  check(checkWin(s, floor, B) === 'guests', 'two clean escapes win it for the guests');
  check(s.finished === true && s.won === 'guests', 'the match is over');
}
{
  const s = hs(2302);
  // Everyone possessed: the guests can no longer make up the number.
  s.players.forEach(p => { p.possessed = true; });
  check(cleanGuestsRemaining(s).length === 0 && guestsCannotWin(s), 'no clean guests are left');
  check(checkWin(s, floor) === 'possessed', 'the possessed side wins when the guests cannot reach the number');
}
{
  const s = hs(2303);
  s.round = rules.roundLimit + 1;
  check(checkWin(s, floor) === 'possessed', `running past round ${rules.roundLimit} hands it to the possessed side`);
}
{
  // Five players, one escape needed: the maths scales.
  applyMode('hotseat', 5);
  const s = createState(floor, roster.slice(0, 5), 2304, { mode: 'hotseat' });
  floor.roomList.filter(r => r.role === 'objective').slice(0, rules.objectiveCount).forEach(r => s.objectivesFound.add(r.id));
  const A = s.players.find(p => !p.possessed);
  A.currentRoom = floor.exitRoom;
  check(escapeesRequired(s) === 1, 'a five-player table needs one clean escape');
  check(checkWin(s, floor, A) === 'guests', 'and one escape ends it');
  applyMode('hotseat', 6);
}

console.log('phase 1: no health, no combat, no locked doors, no carried objectives');
{
  const s = hs(2401);
  const A = s.players[0], B = s.players[1];
  A.currentRoom = B.currentRoom = 'corridorE';
  A.hand.push({ id: 'k1', type: 'knife' });
  check(resolveAttack(s, floor, A, B, 'k1').reason === 'combatDisabled', 'attacking is refused outright');
  check(B.health === rules.maxHealth, 'nothing can change health');
  check(rules.healthEnabled === false, 'health is off, so the interface does not show it');
  check(!floor.doorways.some(d => d.locked), 'no locked doors');
  check(objectivesAreCarried() === false && canOfferObjective() === false,
    'objectives are never carried and never offerable');
  const objId = floor.roomList.find(r => r.role === 'objective').id;
  s.objectivesFound.add(objId);
  check(setOffer(s, A, objId).reason === 'objectiveNotOfferable', 'an objective cannot be made an Offer');
}

console.log('phase 1: conversions are private');
{
  const s = hs(2501);
  const victim = s.players.find(p => !p.possessed);
  const r = convertToPossessed(s, victim, 'p1');
  check(r.ok && victim.possessed && victim.roleChangePending,
    'a conversion flags a private role-change screen rather than announcing it');
  check(convertToPossessed(s, victim, 'p1').reason === 'alreadyPossessed', 'converting twice does nothing');
  check(possessedPlayers(s).length >= 2, 'the possessed side has grown');
}

// Put the rulebook back to the practice defaults so nothing else is affected by these checks.
applyMode('practice');
check(rules.practiceMode === true && rules.gameMode === 'practice' && rules.turnTimerEnabled === false,
  'practice mode is restored unchanged after the hot-seat checks');

console.log(failures ? `\n${failures} FAILED` : '\nALL RULES CHECKS PASSED');
process.exit(failures ? 1 : 0);
