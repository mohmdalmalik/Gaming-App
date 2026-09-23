// Pure-rules checks for Hotel Escape (no browser): node tests/rules-check.mjs
// These test docs/GAME_RULES.md — the owner's restored ruleset — through the engine alone.
import { config } from '../src/config.js';
import { rules, applyMode } from '../src/data/rules.js';
import { floor1 } from '../src/data/floor1.js';
import { roster } from '../src/data/characters.js';
import { buildFloor } from '../src/game/floor.js';
import { lanternCount, countType, countableCount, piecesIn, hasAllPieces, isPiece } from '../src/game/cards.js';
import {
  createState, activePlayer, nextPlayer, endTurn, enterRoom, checkWin, canEscape, hidingRooms,
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
check(rules.keyPieces.join(',') === 'bow,shank,bit' && rules.keyPiecesToEscape === 3, 'three key pieces: Bow, Shank, Bit');
check(rules.lockedRoomCount === 2 && rules.lockPickChance === 0.5, 'two locked rooms; a Lock Pick works half the time');
check(rules.startingHandSize === 4 && rules.guaranteedLantern && rules.handLimit === 6, '4-card start with a Lantern; hand limit 6');
check(deckTotal === 40, `the draw deck has ${deckTotal} cards (40)`);
check(rules.deck.lantern === 12 && rules.deck.bandage === 7 && rules.deck.flashlight === 5 && rules.deck.knife === 4
  && rules.deck.barricade === 4 && rules.deck.lockPick === 4 && rules.deck.revolver === 2 && rules.deck.masterKey === 2,
  'deck mix: 12 Lantern, 7 Bandage, 5 Flashlight, 4 Knife, 4 Barricade, 4 Lock Pick, 2 Revolver, 2 Master Key');
check(!('hint' in rules.cards) && !('distraction' in rules.cards) && !('trinket' in rules.cards), 'no Hint, Distraction or Trinket cards');
check(!('possession' in rules.deck) && !rules.keyPieces.some(t => t in rules.deck), 'Possession cards and key pieces are never in the deck');
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
  check(s.players.every(p => lanternCount(p.hand) >= 1), 'every hand holds at least one Lantern');
  check(s.drawPile.length === deckTotal - 24, `${s.drawPile.length} cards left in the pile after dealing`);
  check(s.discardPile.length === 0, 'the discard pile starts empty');
  check(s.players.every(p => p.health === 3 && p.alive), 'everyone starts at full health');
  check(s.players.every(p => piecesIn(p.hand).length === 0), 'nobody starts with a key piece');
}
// Key pieces: three different rooms, never the lobby or next to it, never the exit.
{
  const lobbyRoom = floor.rooms.get(lobby);
  const allowed = new Set(hidingRooms(floor));
  check(!allowed.has(lobby) && ![...lobbyRoom.neighbours].some(id => allowed.has(id)) && !allowed.has(floor.exitRoom),
    'hiding rooms exclude the lobby, its neighbours and the exit');
  let ok = true, distinct = true, lockedOk = true, inDark = 0, inLocked = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const s = hs(seed);
    const rooms = s.pieceRooms;
    if (rooms.length !== 3 || !rooms.every(r => allowed.has(r))) ok = false;
    if (new Set(rooms).size !== 3) distinct = false;
    for (const r of rooms) {
      const drops = s.roomDrops.get(r) || [];
      if (!drops.some(isPiece)) ok = false;
      if (floor.rooms.get(r).dark) inDark++;
      if (s.lockedRooms.has(r)) inLocked++;
    }
    if (s.lockedRooms.size !== 2 || [...s.lockedRooms].some(r => !allowed.has(r))) lockedOk = false;
  }
  check(ok, 'over 200 deals every piece lies in an allowed room, on that room’s floor');
  check(distinct, 'the three pieces are always in three different rooms');
  check(lockedOk, 'two locked rooms every deal, never the lobby, its neighbours or the exit');
  check(inDark > 0 && inLocked > 0, `a piece can be in a dark room (${inDark} times) or a locked room (${inLocked} times)`);
  const a = hs(77), b = hs(77), c = hs(78);
  check(a.pieceRooms.join() === b.pieceRooms.join() && a.lockedRooms.size === b.lockedRooms.size, 'the same seed hides things in the same places');
  check(a.pieceRooms.join() !== c.pieceRooms.join() || [...a.lockedRooms].join() !== [...c.lockedRooms].join(), 'a different seed changes them');
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
  // Drops are always there for the taking.
  const pieceRoom = s.pieceRooms[0];
  p.currentRoom = pieceRoom; s.discovered.add(pieceRoom); s.lockedRooms.delete(pieceRoom);
  if (floor.rooms.get(pieceRoom).dark) p.hand.push({ id: 'fl', type: 'flashlight' });
  const f = search(s, floor, p);
  check(f.ok && f.kind === 'found' && f.pieces.length === 1 && piecesIn(p.hand).length === 1, 'searching a piece’s room finds the piece');
  check(!s.roomDrops.has(pieceRoom), 'and it is gone from the floor');
  check(countableCount(p.hand) === 5, 'a key piece does not count toward the hand limit');
  check(discardCard(s, p, piecesIn(p.hand)[0].id).reason === 'undroppable', 'a key piece cannot be discarded');
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
  for (let i = 0; i < living; i++) endTurn(s, floor);
  check(!isBarricaded(s, door.id), 'it comes down when that guest’s next turn comes round (one round)');
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
  V.hand.push({ id: 'pc', type: 'bow' });
  const carried = V.hand.filter(c => c.type !== 'possession').map(c => c.id);
  K.hand.push({ id: 'rv', type: 'revolver', shots: 2 });
  V.health = 2;
  resolveAttack(s, floor, K, V, 'rv');
  check(!V.alive && V.hand.length === 0, 'the dead guest’s hand is empty');
  const drops = s.roomDrops.get('kitchen') || [];
  check(carried.every(id => drops.some(c => c.id === id)), 'everything they carried — the key piece included — is on the floor of that room');
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
  check(V.hand.some(c => c.id === 'la'), 'the Lantern STILL goes to the other guest');
  check(K.knows.has(V.id), 'the defender privately learns who tried');
  check(t.received[K.id] === null, 'the defender received nothing');
  check(countType(V.hand, 'possession') === 2, 'the possessed side is down to two Possession cards');
  check(K.notes.some(n => n.includes(V.name)), 'the defender’s private note names the attacker');
}
{
  // Possession cards never count and are hidden from the public count.
  const s = hs(19);
  const V = possessed(s);
  check(countableCount(V.hand) === 4 && V.hand.length === 7, 'three Possession cards, public count still 4');
  check(overHandLimit(V) === 0, 'they never push a hand over the limit');
  V.hand.push({ id: 'x1', type: 'bow' }, { id: 'x2', type: 'lantern' }, { id: 'x3', type: 'lantern' }, { id: 'x4', type: 'lantern' });
  check(countableCount(V.hand) === 7 && overHandLimit(V) === 1, 'ordinary cards over 6 must be discarded; the piece does not count');
}

console.log('\nescape and winning');
{
  const s = hs(20);
  const K = cleanOnes(s)[0];
  K.currentRoom = floor.exitRoom; s.discovered.add(floor.exitRoom);
  check(!canEscape(s, floor, K) && checkWin(s, floor, K) === null, 'entering the exit with no pieces does nothing');
  K.hand.push({ id: 'b1', type: 'bow' }, { id: 'b2', type: 'shank' });
  check(!canEscape(s, floor, K), 'two pieces are not enough');
  K.hand.push({ id: 'b3', type: 'bit' });
  check(hasAllPieces(K.hand) && canEscape(s, floor, K), 'all three pieces and the exit: the guest can escape');
  // ORDER: the exit is resolved before any meeting.
  const other = cleanOnes(s)[1]; other.currentRoom = floor.exitRoom;
  check(pendingEncounters(s, floor, K).length === 0, 'the exit is safe: no meeting can be forced there');
  check(checkWin(s, floor, K) === 'humans' && s.finished && s.escaped.has(K.id), 'a clean guest with all three pieces escapes and the guests win');
}
{
  const s = hs(21);
  const V = possessed(s);
  V.currentRoom = floor.exitRoom;
  V.hand.push({ id: 'b1', type: 'bow' }, { id: 'b2', type: 'shank' }, { id: 'b3', type: 'bit' });
  check(!canEscape(s, floor, V) && checkWin(s, floor, V) === null, 'a possessed guest holding all three pieces can never escape');
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
  // Practice: alone, find the pieces and get out.
  applyMode('practice');
  const s = createState(floor, roster.slice(0, 1), 5, { mode: 'practice' });
  const p = activePlayer(s);
  check(s.players.length === 1 && !p.possessed && s.pieceRooms.length === 3, 'practice: one clean guest, three pieces hidden');
  check(rules.turnTimerEnabled === false, 'practice has no timer');
  p.currentRoom = floor.exitRoom;
  check(checkWin(s, floor, p) === null, 'the exit does nothing without the pieces');
  p.hand.push({ id: 'b1', type: 'bow' }, { id: 'b2', type: 'shank' }, { id: 'b3', type: 'bit' });
  check(checkWin(s, floor, p) === 'humans', 'with all three pieces, practice is complete');
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
