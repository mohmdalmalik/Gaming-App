// Pure-rules checks for Hotel Escape (no browser): node tests/rules-check.mjs
// These test docs/GAME_RULES.md — the owner's restored ruleset — through the engine alone.
import { config } from '../src/config.js';
import { rules, applyMode } from '../src/data/rules.js';
import { floor1 } from '../src/data/floor1.js';
import { roster } from '../src/data/characters.js';
import { buildFloor } from '../src/game/floor.js';
import { lanternCount, countType, countableCount, hasEscapeLanterns } from '../src/game/cards.js';
import {
  createState, activePlayer, nextPlayer, endTurn, enterRoom, checkWin, canEscape, lockableRooms,
  usableDoorways, pendingEncounters, lockEncounter, hasEncounterLock, playersInRoom, canAffordRoute,
  isLocked, isBarricaded, doorwayPassable, adjacentLockedRooms, convertToPossessed,
} from '../src/game/state.js';
import {
  search, canSearch, useBandage, useUnlock, useBarricade, resolveFullHand, discardCard, overHandLimit,
  resolveTrade, resolveAttack, tradeableCards, drawCard, dropEverything,
} from '../src/game/actions.js';

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const floor = buildFloor(floor1, config);
const lobby = floor.start.room;
const SIX = roster.slice(0, 6);
applyMode('hotseat', 6);
const hs = (seed = 1) => createState(floor, SIX, seed, { mode: 'hotseat' });
const possessed = s => s.players.find(p => p.possessed);
const cleanOnes = s => s.players.filter(p => !p.possessed);
const deckTotal = Object.values(rules.deck).reduce((a, b) => a + b, 0);

console.log('configuration (docs/GAME_RULES.md)');
check(rules.actionPointsPerTurn === 4, '4 action points a turn');
check(rules.actionCost.move === 1 && rules.actionCost.discover === 0, 'moving into ANY adjacent room costs 1, new or known');
check(rules.actionCost.search === 1 && rules.actionCost.useCard === 1 && rules.actionCost.attack === 1, 'search, card and attack cost 1');
check(rules.turnTimerSeconds === 45 && rules.turnTimerEnabled === true, 'hot-seat has the 45-second timer');
check(rules.maxHealth === 3 && rules.bandageHeal === 1, '3 health bars; a Bandage restores 1');
check(rules.healthEnabled && rules.combatEnabled && rules.lockedDoorsEnabled && rules.darkRoomsRequireLight, 'health, combat, locked doors and dark rooms are ON');
check(rules.possessionSupply === 3, 'the Possessed guest starts with 3 Possession cards');
check(rules.lanternsToEscape === 3, 'three Lanterns let a clean guest escape');
check(!('keyPieces' in rules) && !['bow', 'shank', 'bit'].some(t => t in rules.cards), 'the key pieces are gone entirely');
check(rules.lanternBlock === 'discard', 'the game uses the approved rule: a blocking Lantern is used up');
check(rules.lanternsDealtEach === 0, 'the game uses the approved rule: Lanterns are never dealt');
check(rules.lockedRoomCount === 2 && rules.lockPickChance === 0.5, 'two locked rooms; a Lock Pick works half the time');
check(rules.startingHandSize === 4 && rules.handLimit === 6, '4-card starting hand; hand limit 6');
check(deckTotal === 40, `the draw deck has ${deckTotal} cards (40)`);
check(rules.deck.lantern === 12 && rules.deck.bandage === 7 && rules.deck.flashlight === 5 && rules.deck.knife === 4
  && rules.deck.barricade === 4 && rules.deck.lockPick === 4 && rules.deck.revolver === 2 && rules.deck.masterKey === 2,
  'deck mix: 12 Lantern, 7 Bandage, 5 Flashlight, 4 Knife, 4 Barricade, 4 Lock Pick, 2 Revolver, 2 Master Key');
check(!('hint' in rules.cards) && !('distraction' in rules.cards) && !('trinket' in rules.cards), 'no Hint, Distraction or Trinket cards');
check(!('possession' in rules.deck), 'Possession cards are never in the deck');
check(rules.onlineMode === false, 'no server, no networking');
check(!('roundLimit' in rules) && !('objectiveCount' in rules), 'no round limit and no public objectives in this ruleset');

console.log('\nsetup');
{
  const s = hs(101);
  check(s.players.length === 6, 'six guests');
  check(s.players.filter(p => p.possessed).length === 1, 'exactly one is possessed');
  check(countType(possessed(s).hand, 'possession') === 3, 'and holds 3 Possession cards');
  check(cleanOnes(s).every(p => countType(p.hand, 'possession') === 0), 'nobody else holds one');
  check(s.players.every(p => countableCount(p.hand) === 4), 'four ordinary cards each');
  check(s.drawPile.length === deckTotal - 24, `${s.drawPile.length} cards left in the pile after dealing`);
  check(countType(s.drawPile, 'lantern') === rules.deck.lantern, 'all 12 Lanterns are in the draw pile');
  check(s.discardPile.length === 0, 'the discard pile starts empty');
  check(s.players.every(p => p.health === 3 && p.alive), 'everyone starts at full health');
  check(s.roomDrops.size === 0, 'nothing is lying on any floor at the start');
}
// Lanterns are never dealt — over many deals, at every table size.
{
  let dealt = 0, pileOk = true;
  for (let seed = 1; seed <= 200; seed++) {
    const s = hs(seed);
    dealt += s.players.reduce((n, p) => n + lanternCount(p.hand), 0);
    if (countType(s.drawPile, 'lantern') !== 12) pileOk = false;
  }
  check(dealt === 0, 'over 200 six-player deals, not one Lantern was dealt');
  check(pileOk, 'every time, all 12 Lanterns went into the draw pile');
  applyMode('hotseat', 4);
  const f = createState(floor, roster.slice(0, 4), 3, { mode: 'hotseat' });
  check(f.players.every(p => lanternCount(p.hand) === 0 && countableCount(p.hand) === 4), 'four players: four cards each, no Lanterns');
  applyMode('hotseat', 6);
  // The Lanterns are shuffled into the remainder, not stacked at the bottom.
  let early = 0;
  for (let seed = 1; seed <= 200; seed++) if (hs(seed).drawPile.slice(0, 4).some(c => c.type === 'lantern')) early++;
  check(early > 150, `Lanterns are shuffled through the pile (one in the first four draws in ${early} of 200 deals)`);
}
// Locked rooms: two, random each match, never the lobby, its neighbours or the exit.
{
  const lobbyRoom = floor.rooms.get(lobby);
  const allowed = new Set(lockableRooms(floor));
  check(!allowed.has(lobby) && ![...lobbyRoom.neighbours].some(id => allowed.has(id)) && !allowed.has(floor.exitRoom),
    'lockable rooms exclude the lobby, its neighbours and the exit');
  let lockedOk = true; const seen = new Set();
  for (let seed = 1; seed <= 200; seed++) {
    const s = hs(seed);
    if (s.lockedRooms.size !== 2 || [...s.lockedRooms].some(r => !allowed.has(r))) lockedOk = false;
    seen.add([...s.lockedRooms].sort().join('+'));
  }
  check(lockedOk, 'two locked rooms every deal, never the lobby, its neighbours or the exit');
  check(seen.size > 20, `the locked rooms change from match to match (${seen.size} different pairs in 200 deals)`);
  const a = hs(77), b = hs(77);
  check([...a.lockedRooms].join() === [...b.lockedRooms].join(), 'the same seed locks the same rooms');
}

console.log('\nturns and movement');
{
  const s = hs(7);
  check(activePlayer(s).index === 0 && s.round === 1, 'starts on the first guest, round 1');
  const p = activePlayer(s);
  const r = enterRoom(s, floor, p, 'corridorE');
  check(r.cost === 1 && p.actionPoints === 3 && r.revealed, 'entering a NEW room costs 1 and reveals it');
  enterRoom(s, floor, p, 'hall');
  check(p.actionPoints === 2, 'entering a KNOWN room also costs 1');
  p.actionPoints = 0;
  check(usableDoorways(s, floor, p).length === 0, 'with no action points no door is usable');
  p.actionPoints = 1;
  check(usableDoorways(s, floor, p).length > 0, 'with one, doors are usable');
  const t = endTurn(s, floor);
  check(t.to.index === 1 && activePlayer(s).actionPoints === 4, 'end turn: next guest, points refilled to 4');
  for (let i = 0; i < 5; i++) endTurn(s, floor);
  check(activePlayer(s).index === 0 && s.round === 2, 'a full lap starts round 2');
  s.players[1].alive = false; s.activeIndex = 0;
  check(nextPlayer(s).index === 2, 'a dead guest is skipped');
}

console.log('\nsearching, the deck and the discard pile');
{
  const s = hs(8);
  const p = activePlayer(s);
  const plain = floor.roomList.find(r => r.searchable && !r.dark && !s.lockedRooms.has(r.id) && !s.roomDrops.has(r.id));
  p.currentRoom = plain.id; p.actionPoints = 4; s.discovered.add(plain.id);
  const n = p.hand.length, pile = s.drawPile.length;
  const r = search(s, floor, p);
  check(r.ok && r.kind === 'card' && p.hand.length === n + 1 && s.drawPile.length === pile - 1 && p.actionPoints === 3,
    'searching an ordinary room draws one card for 1 action point');
  check(canSearch(s, floor, p).reason === 'searched', 'a room gives up its draw once');
  check(s.log.at(-1).text === `${p.name} searched ${plain.name}.`, 'the public log says only that a search happened');
  check(!s.log.some(l => /Lantern|Bandage|Knife|Flashlight|Revolver|Barricade|Lock Pick|Master Key/.test(l.text)), 'it never names what was found');
  // Dropped items are always there for the taking, even in a room already searched.
  s.roomDrops.set(plain.id, [{ id: 'd1', type: 'lantern' }, { id: 'd2', type: 'knife' }]);
  p.actionPoints = 4;
  const f = search(s, floor, p);
  check(f.ok && f.kind === 'found' && p.hand.some(c => c.id === 'd1') && p.hand.some(c => c.id === 'd2'), 'dropped cards in an already-searched room can still be picked up');
  check(!s.roomDrops.has(plain.id), 'and they are gone from the floor');
  const before = countableCount(p.hand);
  p.hand.push({ id: 'lx', type: 'lantern' });
  check(countableCount(p.hand) === before + 1, 'a Lantern counts toward the hand limit like any card');
  check(discardCard(s, p, 'lx').ok, 'and can be discarded like any card');
  const s2 = hs(9), q = activePlayer(s2);
  check(discardCard(s2, possessed(s2), possessed(s2).hand.find(c => c.type === 'possession').id).reason === 'undroppable', 'a Possession card cannot be discarded');
  // Discard pile recycles into the deck.
  const card = q.hand.find(c => c.type !== 'possession');
  discardCard(s2, q, card.id);
  check(s2.discardPile.length === 1, 'a discarded card goes on the discard pile');
  s2.drawPile = [];
  const drawn = drawCard(s2);
  check(drawn && drawn.id === card.id && s2.discardPile.length === 0, 'when the deck is empty the discard pile is shuffled into a new deck');
}
// Dark rooms need a Flashlight (not used up).
{
  const s = hs(10), p = activePlayer(s);
  const dark = floor.roomList.find(r => r.dark && r.searchable && !s.lockedRooms.has(r.id));
  p.currentRoom = dark.id; s.discovered.add(dark.id); p.actionPoints = 4;
  p.hand = p.hand.filter(c => c.type !== 'flashlight');
  check(canSearch(s, floor, p).reason === 'dark', 'a dark room cannot be searched without a Flashlight');
  p.hand.push({ id: 'fl1', type: 'flashlight' });
  const r = search(s, floor, p);
  check(r.ok && p.hand.some(c => c.id === 'fl1'), 'with a Flashlight it can, and the Flashlight is kept');
}

console.log('\nlocked rooms, keys and picks');
{
  const s = hs(11), p = activePlayer(s);
  const locked = [...s.lockedRooms][0];
  const neighbour = [...floor.rooms.get(locked).neighbours][0];
  p.currentRoom = neighbour; s.discovered.add(neighbour); p.actionPoints = 4;
  check(isLocked(s, locked), 'a room is locked');
  check(canAffordRoute(s, floor, p, [neighbour, locked]).reason === 'locked', 'you cannot walk into it');
  check(!usableDoorways(s, floor, p).some(d => d.otherRoom(neighbour) === locked), 'its door is not offered');
  check(adjacentLockedRooms(s, floor, p).includes(locked), 'it is listed as a locked room next door');
  p.hand.push({ id: 'mk', type: 'masterKey' });
  const r = useUnlock(s, floor, p, 'mk', locked);
  check(r.ok && r.opened && !isLocked(s, locked) && p.actionPoints === 3, 'a Master Key always opens it for 1 action point');
  check(!p.hand.some(c => c.id === 'mk') && s.discardPile.some(c => c.id === 'mk'), 'and is used up');
  check(usableDoorways(s, floor, p).some(d => d.otherRoom(neighbour) === locked), 'the door is now offered — it stays open');
  // Lock Pick: half the time, used up either way.
  let opened = 0, tries = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const t = hs(seed), q = activePlayer(t);
    const L = [...t.lockedRooms][0], nb = [...floor.rooms.get(L).neighbours][0];
    q.currentRoom = nb; q.actionPoints = 4; q.hand.push({ id: 'lp', type: 'lockPick' });
    const res = useUnlock(t, floor, q, 'lp', L);
    tries++; if (res.opened) opened++;
    if (q.hand.some(c => c.id === 'lp')) { opened = -999; break; }
  }
  check(opened > 70 && opened < 130, `a Lock Pick opened ${opened} of ${tries} locked rooms (about half)`);
  check(opened !== -999, 'a Lock Pick is used up whether or not it works');
  const t2 = hs(12), q2 = activePlayer(t2);
  q2.hand.push({ id: 'mk2', type: 'masterKey' });
  check(useUnlock(t2, floor, q2, 'mk2', [...t2.lockedRooms][0]).reason === 'notAdjacentLocked', 'a key only works on a locked room next door');
}

console.log('\nbarricades');
{
  const s = hs(13), p = activePlayer(s);
  p.currentRoom = 'corridorE'; s.discovered.add('corridorE'); p.actionPoints = 4;
  const door = floor.rooms.get('corridorE').doorways.find(d => d.otherRoom('corridorE') === 'hall');
  p.hand.push({ id: 'bar', type: 'barricade' });
  const r = useBarricade(s, floor, p, 'bar', door.id);
  check(r.ok && isBarricaded(s, door.id) && p.actionPoints === 3, 'a Barricade seals a doorway of your room for 1 action point');
  check(!doorwayPassable(s, door), 'nobody can pass a barricaded doorway');
  check(!usableDoorways(s, floor, p).some(d => d.id === door.id), 'not even the guest who placed it');
  check(useBarricade(s, floor, p, 'x', door.id).reason === 'noCard', 'used up');
  const living = s.players.filter(q => q.alive).length;
  let stood = true;
  for (let i = 0; i < living - 1; i++) { endTurn(s, floor); if (!isBarricaded(s, door.id)) stood = false; }
  check(stood, 'it stands through every other guest’s turn');
  endTurn(s, floor);
  check(activePlayer(s) === p && !isBarricaded(s, door.id), 'it comes down the moment the placer’s next turn starts');
  // Still exactly "until your next turn" when somebody dies in between.
  p.hand.push({ id: 'bar3', type: 'barricade' }); p.actionPoints = 4;
  useBarricade(s, floor, p, 'bar3', door.id);
  s.players[3].alive = false;
  let turns = 0;
  do { endTurn(s, floor); turns++; } while (activePlayer(s) !== p && turns < 10);
  check(!isBarricaded(s, door.id) && turns === living - 1, 'with a guest dead in between, it still comes down exactly at the placer’s next turn');
  const other = floor.rooms.get('kitchen').doorways[0];
  p.hand.push({ id: 'bar2', type: 'barricade' }); p.actionPoints = 4;
  check(useBarricade(s, floor, p, 'bar2', other.id).reason === 'notYourDoorway', 'only a doorway of the room you are in');
}

console.log('\nhealth, bandages and attacks');
{
  const s = hs(14);
  const A = s.players[0], B = s.players[1];
  A.currentRoom = B.currentRoom = 'corridorE'; A.actionPoints = 4;
  A.hand.push({ id: 'kn', type: 'knife' });
  const r = resolveAttack(s, floor, A, B, 'kn');
  check(r.ok && B.health === 2 && A.actionPoints === 3 && A.hand.some(c => c.id === 'kn'), 'a Knife does 1 damage for 1 action point and is kept');
  A.hand.push({ id: 'rv', type: 'revolver', shots: 2 });
  resolveAttack(s, floor, A, B, 'rv');
  check(B.health === 0 && !B.alive, 'a Revolver does 2: the guest is dead');
  check(A.hand.find(c => c.id === 'rv')?.shots === 1, 'and the Revolver has one shot left');
  const C = s.players[2]; C.currentRoom = 'corridorE'; C.health = 3;
  const r2 = resolveAttack(s, floor, A, C, 'rv');
  check(r2.ok && r2.discarded && !A.hand.some(c => c.id === 'rv') && s.discardPile.some(c => c.id === 'rv'), 'the second shot empties it and it is gone');
  check(resolveAttack(s, floor, A, B, 'kn').reason === 'targetDead', 'the dead cannot be attacked');
  A.actionPoints = 4; B.alive = true; B.health = 1;
  A.currentRoom = B.currentRoom = lobby;
  check(resolveAttack(s, floor, A, B, 'kn').reason === 'safe', 'no attacks in the lobby');
  A.currentRoom = B.currentRoom = 'corridorW'; A.hand = A.hand.filter(c => c.type !== 'knife');
  check(resolveAttack(s, floor, A, B, 'kn').reason === 'noWeapon', 'attacking needs a weapon');
  // Bandage.
  B.actionPoints = 4; B.hand.push({ id: 'bd', type: 'bandage' });
  const h = useBandage(s, B, 'bd');
  check(h.ok && B.health === 2 && B.actionPoints === 3 && s.discardPile.some(c => c.id === 'bd'), 'a Bandage restores 1 for 1 action point and is used up');
  B.health = 3; B.hand.push({ id: 'bd2', type: 'bandage' });
  check(useBandage(s, B, 'bd2').reason === 'full', 'not above 3');
}
// Death drops everything in the room.
{
  const s = hs(15);
  const V = possessed(s); const K = cleanOnes(s)[0];
  V.currentRoom = K.currentRoom = 'kitchen'; K.actionPoints = 4;
  V.hand.push({ id: 'pc', type: 'lantern' });
  const carried = V.hand.filter(c => c.type !== 'possession').map(c => c.id);
  K.hand.push({ id: 'rv', type: 'revolver', shots: 2 });
  V.health = 2;
  resolveAttack(s, floor, K, V, 'rv');
  check(!V.alive && V.hand.length === 0, 'the dead guest’s hand is empty');
  const drops = s.roomDrops.get('kitchen') || [];
  check(carried.every(id => drops.some(c => c.id === id)), 'everything they carried — Lanterns included — is on the floor of that room');
  check(!drops.some(c => c.type === 'possession'), 'their Possession cards leave the game with them');
  K.currentRoom = 'kitchen'; s.discovered.add('kitchen'); K.actionPoints = 4;
  const f = search(s, floor, K);
  check(f.ok && f.kind === 'found' && K.hand.some(c => c.id === 'pc'), 'searching the room picks it all up');
}

console.log('\nmeetings');
{
  const s = hs(16);
  const A = s.players[0], B = s.players[1], C = s.players[2];
  A.currentRoom = B.currentRoom = C.currentRoom = lobby;
  check(pendingEncounters(s, floor, A).length === 0, 'the lobby never forces a meeting');
  A.currentRoom = B.currentRoom = C.currentRoom = 'corridorE';
  check(pendingEncounters(s, floor, A).length === 2, 'entering a room with two guests: a meeting, with a choice of whom');
  lockEncounter(s, 'corridorE', A.index, B.index);
  check(hasEncounterLock(s, 'corridorE', B.index, A.index), 'the lock is for the pair');
  check(pendingEncounters(s, floor, A).length === 1 && pendingEncounters(s, floor, A)[0] === C, 'the same two cannot be forced to meet again in that room this round');
  A.currentRoom = B.currentRoom = 'kitchen';
  check(pendingEncounters(s, floor, A).some(q => q === B), 'meeting in a different room is a new meeting');
  for (let i = 0; i < 6; i++) endTurn(s, floor);
  check(!hasEncounterLock(s, 'corridorE', A.index, B.index), 'locks clear each round');
  const pr = createState(floor, roster.slice(0, 1), 1, { mode: 'practice' });
  check(pendingEncounters(pr, floor, activePlayer(pr)).length === 0, 'practice has no meetings at all');
}

console.log('\ntrade and possession');
{
  const s = hs(17);
  const V = possessed(s), K = cleanOnes(s)[0];
  check(!tradeableCards(K).some(c => c.type === 'possession'), 'a clean guest can never give a Possession card');
  check(tradeableCards(V).some(c => c.type === 'possession'), 'a possessed guest may');
  check(resolveTrade(s, floor, K, V, 'zz', V.hand[0].id).reason === 'noCard', 'you can only give a card you hold');
  // Plain swap.
  V.currentRoom = K.currentRoom = 'corridorE';
  K.hand = [{ id: 'k1', type: 'lantern' }, { id: 'k2', type: 'bandage' }];
  V.hand = [{ id: 'v1', type: 'knife' }, ...V.hand.filter(c => c.type === 'possession')];
  const t = resolveTrade(s, floor, K, V, 'k2', 'v1');
  check(t.ok && t.swap && K.hand.some(c => c.id === 'v1') && V.hand.some(c => c.id === 'k2'), 'the two cards swap at the same time');
  check(t.received[K.id] === 'knife' && t.received[V.id] === 'bandage', 'each side is told only what THEY received');
  check(!K.possessed, 'an ordinary trade possesses nobody');
  // Possession without a Lantern.
  const pc = V.hand.find(c => c.type === 'possession');
  K.hand.push({ id: 'k3', type: 'bandage' });
  const t2 = resolveTrade(s, floor, V, K, pc.id, 'k3');
  check(t2.ok && K.possessed && K.roleChangePending, 'receiving a Possession card without giving a Lantern possesses you');
  check(K.hand.some(c => c.id === pc.id), 'and you keep that Possession card');
  check(V.hand.some(c => c.id === 'k3'), 'the possessed giver keeps what you gave');
  check(K.notes.some(n => /POSSESSED/.test(n)), 'you are told privately');
  check(!s.log.some(l => /POSSESS/i.test(l.text)), 'the public log says nothing about it');
}
{
  // Possession blocked by a Lantern.
  const s = hs(18);
  const V = possessed(s), K = cleanOnes(s)[0];
  V.currentRoom = K.currentRoom = 'corridorE';
  const pc = V.hand.find(c => c.type === 'possession');
  K.hand = [{ id: 'la', type: 'lantern' }];
  const t = resolveTrade(s, floor, V, K, pc.id, 'la');
  check(t.ok && !K.possessed, 'giving a Lantern blocks the attempt');
  check(!K.hand.some(c => c.id === pc.id) && !V.hand.some(c => c.id === pc.id) && !s.discardPile.some(c => c.id === pc.id),
    'the Possession card is destroyed');
  check(!V.hand.some(c => c.id === 'la') && !K.hand.some(c => c.id === 'la'), 'the blocking Lantern is used up — nobody holds it');
  check(s.discardPile.some(c => c.id === 'la'), 'it goes to the discard pile');
  check(t.lanternsBurned === 1, 'the trade reports one Lantern burned');
  check(K.knows.has(V.id), 'the defender privately learns who tried');
  check(t.received[K.id] === null && t.received[V.id] === null, 'neither side received anything');
  check(countType(V.hand, 'possession') === 2, 'the possessed side is down to two Possession cards');
  check(K.notes.some(n => n.includes(V.name)), 'the defender’s private note names the attacker');
}
{
  // An ORDINARY trade: a Lantern changes hands like any card, so teammates can pool them.
  const s = hs(26);
  const [A, B] = cleanOnes(s);
  A.currentRoom = B.currentRoom = 'corridorE';
  A.hand = [{ id: 'l1', type: 'lantern' }]; B.hand = [{ id: 'b1', type: 'bandage' }];
  const t = resolveTrade(s, floor, A, B, 'l1', 'b1');
  check(t.ok && t.swap && B.hand.some(c => c.id === 'l1') && A.hand.some(c => c.id === 'b1'), 'in an ordinary trade a Lantern goes to the other guest');
  check(!s.discardPile.some(c => c.id === 'l1'), 'and is not used up');
  // A possessed guest giving a Lantern normally (no Possession card) is an ordinary trade too.
  const V = possessed(s); V.currentRoom = 'corridorE';
  V.hand.push({ id: 'vl', type: 'lantern' });
  const t2 = resolveTrade(s, floor, V, A, 'vl', 'b1');
  check(t2.ok && t2.swap && A.hand.some(c => c.id === 'vl') && !A.possessed, 'a possessed guest can hand over a Lantern to look innocent');
}
{
  // The comparison variant exists only for the simulator; the game never switches it on.
  rules.lanternBlock = 'attacker';
  const s = hs(27);
  const V = possessed(s), K = cleanOnes(s)[0];
  V.currentRoom = K.currentRoom = 'corridorE';
  const pc = V.hand.find(c => c.type === 'possession');
  K.hand = [{ id: 'la', type: 'lantern' }];
  resolveTrade(s, floor, V, K, pc.id, 'la');
  check(V.hand.some(c => c.id === 'la') && !K.possessed, 'simulator variant: the blocking Lantern goes to the possessed guest');
  rules.lanternBlock = 'discard';
  rules.lanternsDealtEach = 1;
  const d = hs(28);
  check(d.players.every(p => lanternCount(p.hand) === 1 && countableCount(p.hand) === 4), 'simulator variant: one Lantern dealt to each guest');
  rules.lanternsDealtEach = 0;
}
{
  // Possession cards never count and are hidden from the public count.
  const s = hs(19);
  const V = possessed(s);
  check(countableCount(V.hand) === 4 && V.hand.length === 7, 'three Possession cards, public count still 4');
  check(overHandLimit(V) === 0, 'they never push a hand over the limit');
  V.hand.push({ id: 'x2', type: 'lantern' }, { id: 'x3', type: 'lantern' }, { id: 'x4', type: 'lantern' });
  check(countableCount(V.hand) === 7 && overHandLimit(V) === 1, 'seven ordinary cards (Lanterns included) must come down to 6');
}

console.log('\nescape and winning');
{
  const s = hs(20);
  const K = cleanOnes(s)[0];
  K.currentRoom = floor.exitRoom; s.discovered.add(floor.exitRoom);
  K.hand = K.hand.filter(c => c.type !== 'lantern');
  check(!canEscape(s, floor, K) && checkWin(s, floor, K) === null, 'entering the exit with no Lanterns does nothing');
  K.hand.push({ id: 'b1', type: 'lantern' }, { id: 'b2', type: 'lantern' });
  check(!canEscape(s, floor, K), 'two Lanterns are not enough');
  K.hand.push({ id: 'b3', type: 'lantern' });
  check(hasEscapeLanterns(K.hand) && canEscape(s, floor, K), 'three Lanterns and the exit: the guest can escape');
  // ORDER: the exit is resolved before any meeting.
  const other = cleanOnes(s)[1]; other.currentRoom = floor.exitRoom;
  check(pendingEncounters(s, floor, K).length === 0, 'the exit is safe: no meeting can be forced there');
  check(checkWin(s, floor, K) === 'humans' && s.finished && s.escaped.has(K.id), 'a clean guest with three Lanterns escapes and the guests win');
}
{
  const s = hs(21);
  const V = possessed(s);
  V.currentRoom = floor.exitRoom;
  V.hand.push({ id: 'b1', type: 'lantern' }, { id: 'b2', type: 'lantern' }, { id: 'b3', type: 'lantern' });
  check(!canEscape(s, floor, V) && checkWin(s, floor, V) === null, 'a possessed guest holding three Lanterns can never escape');
}
{
  const s = hs(22);
  s.players.forEach(p => { p.possessed = true; });
  check(checkWin(s, floor) === 'possessed', 'every living guest possessed: the hotel wins');
  const s2 = hs(23);
  cleanOnes(s2).forEach(p => { p.alive = false; });
  check(checkWin(s2, floor) === 'possessed', 'every clean guest dead: the hotel wins');
  const s3 = hs(24);
  s3.round = 50;
  check(checkWin(s3, floor) === null, 'there is no round limit');
}
{
  // Practice: alone, find three Lanterns and get out.
  applyMode('practice');
  const s = createState(floor, roster.slice(0, 1), rules.practiceSeed, { mode: 'practice' });
  const p = activePlayer(s);
  check(s.players.length === 1 && !p.possessed && lanternCount(p.hand) === 0, 'practice: one clean guest, no Lanterns dealt');
  check(rules.turnTimerEnabled === false, 'practice has no timer');
  const third = s.drawPile.map((c, i) => (c.type === 'lantern' ? i : -1)).filter(i => i >= 0)[2];
  check(third < 16, `the fixed practice deal is winnable: the third Lantern is draw ${third + 1} of the 16 rooms`);
  p.currentRoom = floor.exitRoom;
  check(checkWin(s, floor, p) === null, 'the exit does nothing without three Lanterns');
  p.hand.push({ id: 'b1', type: 'lantern' }, { id: 'b2', type: 'lantern' }, { id: 'b3', type: 'lantern' });
  check(checkWin(s, floor, p) === 'humans', 'with three Lanterns, practice is complete');
  applyMode('hotseat', 6);
}

console.log('\nfull hand');
{
  const s = hs(25), p = activePlayer(s);
  const plain = floor.roomList.find(r => r.searchable && !r.dark && !s.lockedRooms.has(r.id) && !s.roomDrops.has(r.id));
  p.currentRoom = plain.id; p.actionPoints = 4;
  while (countableCount(p.hand) < rules.handLimit) p.hand.push({ id: `f${p.hand.length}`, type: 'lantern' });
  const r = search(s, floor, p);
  check(r.ok && r.kind === 'card' && r.full && !p.hand.some(c => c.id === r.card.id), 'a drawn card with no room is not taken silently');
  const dropId = p.hand.find(c => c.type === 'lantern').id;
  const take = resolveFullHand(s, p, r.card, 'take', dropId);
  check(take.ok && p.hand.some(c => c.id === r.card.id) && !p.hand.some(c => c.id === dropId) && countableCount(p.hand) === 6, 'take it and drop one');
  check(s.discardPile.some(c => c.id === dropId), 'the dropped card goes to the discard pile');
}

console.log(failures ? `\n${failures} FAILED` : '\nALL RULES CHECKS PASSED');
process.exit(failures ? 1 : 0);
