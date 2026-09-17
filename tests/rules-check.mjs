// Pure-rules checks for Hotel Escape (no browser): node tests/rules-check.mjs
import { config } from '../src/config.js';
import { rules } from '../src/data/rules.js';
import { floor1 } from '../src/data/floor1.js';
import { roster } from '../src/data/characters.js';
import { buildFloor } from '../src/game/floor.js';
import { lanternCount, countType } from '../src/game/cards.js';
import {
  createState, resetState, activePlayer, nextPlayer, endTurn, enterRoom, checkWin,
  usableDoorways, pendingEncounters, lockEncounter, hasEncounterLock, playersInRoom,
  frontierDoorways, isRoomOpen, exitUnlocked, objectivesFound, objectivesRequired,
} from '../src/game/state.js';
import {
  search, canSearch, useBandage, useHint, resolveFullHand, roomYield,
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
check(state.players.length === 5, 'five players');
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
for (let i = 0; i < 4; i++) endTurn(state, floor);
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
// dark searchable room needs a flashlight
s0.currentRoom = 'storage';
s0.hand = s0.hand.filter(c => c.type !== 'flashlight');
r = search(state, floor, s0);
check(!r.ok && r.reason === 'dark', 'cannot search a dark room without a Flashlight');
s0.hand.push({ id: 'fl', type: 'flashlight' });
r = search(state, floor, s0);
check(r.ok, 'with a Flashlight a dark searchable room can be searched');

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
// All five players are together in the hall — a safe room forces no encounter.
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
endTurn(state, floor); for (let i = 0; i < 4; i++) endTurn(state, floor); // new round clears locks
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

console.log(failures ? `\n${failures} FAILED` : '\nALL RULES CHECKS PASSED');
process.exit(failures ? 1 : 0);
