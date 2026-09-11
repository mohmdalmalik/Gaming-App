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
} from '../src/game/state.js';
import { search, canSearch, useBandage, resolveTrade, resolveAttack, tradeableCards } from '../src/game/actions.js';

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

// --- Encounter locks ---------------------------------------------------------------------
console.log('encounter locks');
state = createState(floor, roster, 4);
state.players[1].currentRoom = 'hall'; // both in the hall
const pend = pendingEncounters(state, floor, state.players[0]);
check(pend.length === 4, 'entering the hall forces an encounter with each of the other four');
lockEncounter(state, 'hall', 0, 1);
check(hasEncounterLock(state, 'hall', 1, 0), 'the lock is symmetric for the pair');
check(!pendingEncounters(state, floor, state.players[0]).some(q => q.index === 1), 'a locked pair is not forced again in the same room this round');
endTurn(state, floor); for (let i = 0; i < 4; i++) endTurn(state, floor); // new round clears locks
check(!hasEncounterLock(state, 'hall', 0, 1), 'encounter locks clear at the start of a new round');

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

console.log(failures ? `\n${failures} FAILED` : '\nALL RULES CHECKS PASSED');
process.exit(failures ? 1 : 0);
