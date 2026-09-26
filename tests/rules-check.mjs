// Pure-rules checks for Hotel Escape (no browser): node tests/rules-check.mjs
// These test docs/GAME_RULES.md — the owner's restored ruleset — through the engine alone.
import { config } from '../src/config.js';
import { rules, applyMode } from '../src/data/rules.js';
import { hotel } from '../src/data/hotel.js';
import { roster } from '../src/data/characters.js';
import { createHotel, openFrontierDoor, openDoors, exitPlaced, growTo } from '../src/game/hotel.js';
import { lanternCount, countType, countableCount, hasEscapeLanterns } from '../src/game/cards.js';
import {
  createState, activePlayer, nextPlayer, endTurn, enterRoom, checkWin, canEscape, openableDoors,
  usableDoorways, pendingEncounters, lockEncounter, hasEncounterLock, playersInRoom, canAffordRoute,
  isLocked, isBarricaded, doorwayPassable, placeBarricade, adjacentLockedRooms, convertToPossessed, dawnHasBroken, isFinalRound,
} from '../src/game/state.js';
import {
  search, canSearch, useBandage, useUnlock, useBarricade, resolveFullHand, discardCard, overHandLimit,
  resolveTrade, resolveAttack, tradeableCards, drawCard, dropEverything, openDoor, escape,
  canUseRoom, useInfirmary, useSwitchboard, useHandMirror, useEspresso,
} from '../src/game/actions.js';
import { buildGrid, nearestWalkable } from '../src/game/grid.js';
import { buildAllowed, planMove } from '../src/game/moves.js';

let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
// One hotel object, rebuilt for every new match (createState -> resetState -> resetHotel).
const floor = createHotel(hotel, config);
const lobby = hotel.lobby.id;
const SIX = roster.slice(0, 6);
applyMode('hotseat', 6);
// Grow the hotel behind a closed door the way the game does (revealed; locked tiles lock).
function grow(s, doorId) {
  const r = openFrontierDoor(floor, doorId, { isLocked: id => s.lockedRooms.has(id) });
  if (r.ok) { s.discovered.add(r.room.id); if (r.room.locked) s.lockedRooms.add(r.room.id); }
  return r;
}
// Make sure a particular tile is on the board (the engine's test helper opens doors until it is).
function ensureRoom(s, id) {
  for (const room of growTo(floor, id, { isLocked: r => s.lockedRooms.has(r) })) {
    s.discovered.add(room.id); if (room.locked) s.lockedRooms.add(room.id);
  }
  return floor.rooms.has(id);
}
// A six-guest match with a few familiar rooms already on the board for the rules checks below.
const hs = (seed = 1) => {
  const s = createState(floor, SIX, seed, { mode: 'hotseat' });
  for (const id of ['corridorE', 'corridorW', 'kitchen']) ensureRoom(s, id);
  return s;
};
const hsx = seed => { const s = hs(seed); ensureRoom(s, 'exit'); return s; };   // ...with the Fire Exit placed
const possessed = s => s.players.find(p => p.possessed);
const S_active = s => activePlayer(s);
// Make one guest (not `keep`) the only possessed guest, so nobody else converts anyone in a staging.
const possessedFix = (s, keep) => { s.players.forEach(p => { p.possessed = false; }); s.players.find(p => p !== keep).possessed = true; };
const cleanOnes = s => s.players.filter(p => !p.possessed);
const deckTotal = Object.values(rules.deck).reduce((a, b) => a + b, 0);

console.log('configuration (docs/GAME_RULES.md)');
check(rules.actionPointsPerTurn === 4, '4 action points a turn');
check(rules.actionCost.move === 1, 'moving into any adjacent room through an open doorway costs 1');
check(rules.actionCost.open === 1, 'opening a closed door costs 1');
check(rules.actionCost.search === 1 && rules.actionCost.useCard === 1 && rules.actionCost.attack === 1, 'search, card and attack cost 1');
check(rules.turnTimerSeconds === 45 && rules.turnTimerEnabled === true, 'hot-seat has the 45-second timer');
check(rules.maxHealth === 3 && rules.bandageHeal === 1, '3 health bars; a Bandage restores 1');
check(rules.healthEnabled && rules.combatEnabled && rules.lockedDoorsEnabled && rules.darkRoomsRequireLight, 'health, combat, locked doors and dark rooms are ON');
check(rules.possessionSupply === 3, 'the Possessed guest starts with 3 Possession cards');
check(rules.lanternsToEscape === 3, 'three Lanterns let a clean guest escape');
check(!('keyPieces' in rules) && !['bow', 'shank', 'bit'].some(t => t in rules.cards), 'the key pieces are gone entirely');
check(rules.lanternBlock === 'discard', 'the game uses the approved rule: a blocking Lantern is used up');
check(rules.lanternsDealtEach === 0, 'the game uses the approved rule: Lanterns are never dealt');
check(rules.lockPickChance === 0.5, 'a Lock Pick works half the time');
check(!('lockedRoomCount' in rules), 'the locked rooms are tiles in the room deck, not a number here');
check(rules.startingHandSize === 4 && rules.handLimit === 6, '4-card starting hand; hand limit 6');
check(deckTotal === 48, `the draw deck has ${deckTotal} cards (48)`);
check(rules.deck.lantern === 14 && rules.deck.bandage === 7 && rules.deck.flashlight === 5 && rules.deck.knife === 4
  && rules.deck.barricade === 4 && rules.deck.lockPick === 4 && rules.deck.handMirror === 3 && rules.deck.espresso === 3
  && rules.deck.revolver === 2 && rules.deck.masterKey === 2 && Object.keys(rules.deck).length === 10,
  'deck mix: 14 Lantern, 7 Bandage, 5 Flashlight, 4 Knife, 4 Barricade, 4 Lock Pick, 3 Hand Mirror, 3 Espresso, 2 Revolver, 2 Master Key');
check(!('hint' in rules.cards) && !('distraction' in rules.cards) && !('trinket' in rules.cards), 'no Hint, Distraction or Trinket cards');
check(!('possession' in rules.deck), 'Possession cards are never in the deck');
check(rules.onlineMode === false, 'no server, no networking');
check(rules.roundLimit === 8, 'dawn deadline: 8 rounds');
check(!('objectiveCount' in rules), 'no public objectives in this ruleset');

console.log('\nsetup');
{
  const s = hs(101);
  check(s.players.length === 6, 'six guests');
  check(s.players.filter(p => p.possessed).length === 1, 'exactly one is possessed');
  check(countType(possessed(s).hand, 'possession') === 3, 'and holds 3 Possession cards');
  check(cleanOnes(s).every(p => countType(p.hand, 'possession') === 0), 'nobody else holds one');
  check(s.players.every(p => countableCount(p.hand) === 4), 'four ordinary cards each');
  check(s.drawPile.length === deckTotal - 24, `${s.drawPile.length} cards left in the pile after dealing`);
  check(countType(s.drawPile, 'lantern') === rules.deck.lantern, `all ${rules.deck.lantern} Lanterns are in the draw pile`);
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
    if (countType(s.drawPile, 'lantern') !== rules.deck.lantern) pileOk = false;
  }
  check(dealt === 0, 'over 200 six-player deals, not one Lantern was dealt');
  check(pileOk, `every time, all ${rules.deck.lantern} Lanterns went into the draw pile`);
  applyMode('hotseat', 4);
  const f = createState(floor, roster.slice(0, 4), 3, { mode: 'hotseat' });
  check(f.players.every(p => lanternCount(p.hand) === 0 && countableCount(p.hand) === 4), 'four players: four cards each, no Lanterns');
  applyMode('hotseat', 6);
  // The Lanterns are shuffled into the remainder, not stacked at the bottom.
  let early = 0;
  for (let seed = 1; seed <= 200; seed++) if (hs(seed).drawPile.slice(0, 4).some(c => c.type === 'lantern')) early++;
  check(early > 150, `Lanterns are shuffled through the pile (one in the first four draws in ${early} of 200 deals)`);
}
console.log('\nthe random hotel');
{
  const tiles = hotel.tiles, others = tiles.filter(t => !t.isExit);
  const nDoors = n => others.filter(t => t.doors.length === n).length;
  check(tiles.length === 24 && tiles.filter(t => t.isExit).length === 1, 'a room deck of 24 tiles with one Fire Exit');
  check(tiles.filter(t => t.locked).length === 2, 'two locked rooms');
  check(tiles.filter(t => t.dark).length === 5, 'five dark rooms (about the share there was before)');
  check(nDoors(4) === 4 && nDoors(3) === 7 && nDoors(2) === 8 && nDoors(1) === 4, 'doorways: 4 crossings, 7 T-junctions, 8 two-way, 4 dead ends');
  check(tiles.every(t => t.doors.length >= 1 && t.doors.length <= 4), 'every tile has 1 to 4 doorways');
  let lobbyOk = true, exitOk = true; const shapes = new Set(); const decks = new Set();
  for (let seed = 1; seed <= 300; seed++) {
    const s = createState(floor, SIX, seed, { mode: 'hotseat' });
    const L = floor.rooms.get(lobby);
    if (floor.roomList.length !== 1 || (L.doorSides.size !== 3 && L.doorSides.size !== 4) || L.frontier.length !== L.doorSides.size) lobbyOk = false;
    shapes.add([...L.doorSides].sort().join());
    const at = floor.deck.findIndex(t => t.isExit);
    if (floor.deck.length !== 24 || at < 24 - hotel.exitInLast) exitOk = false;
    decks.add(floor.deck.map(t => t.id).join());
    void s;
  }
  check(lobbyOk, 'every match starts with only the lobby, with 3 or 4 closed doors');
  check(shapes.size === 5, `the lobby's doorways are chosen at random (${shapes.size} of the 5 possible layouts seen)`);
  check(exitOk, 'the Fire Exit is always shuffled into the last five tiles of the deck');
  check(decks.size === 300, 'the deck is shuffled differently every match');
  const a = createState(floor, SIX, 77, { mode: 'hotseat' }); const d1 = floor.deck.map(t => t.id).join() + [...floor.rooms.get(lobby).doorSides];
  const b = createState(floor, SIX, 77, { mode: 'hotseat' }); const d2 = floor.deck.map(t => t.id).join() + [...floor.rooms.get(lobby).doorSides];
  check(d1 === d2, 'the same seed builds the same starting hotel');
  void a; void b;
}

console.log('\ndoors: opening and entering');
{
  const s = createState(floor, SIX, 41, { mode: 'hotseat' });
  const p = activePlayer(s), q = s.players[1];
  const door = floor.rooms.get(lobby).frontier[0];
  check(openableDoors(s, floor, p).length === floor.rooms.get(lobby).doorSides.size, 'every closed door of your room can be opened');
  const r = openDoor(s, floor, p, door.id);
  check(r.ok && p.actionPoints === 3, 'opening a door costs 1 action point');
  check(p.currentRoom === lobby, 'and you stay where you are');
  check(s.discovered.has(r.room.id) && floor.rooms.has(r.room.id), 'the room behind it is revealed');
  check(!floor.frontier.includes(door) && r.doorway && usableDoorways(s, floor, p).some(d => d.id === r.doorway.id), 'the door stays open: it is now a doorway you can walk through');
  check(playersInRoom(s, r.room.id).length === 0, 'the new room is empty, so opening it never starts a meeting');
  check(r.room.doorSides.has({ north: 'south', south: 'north', east: 'west', west: 'east' }[door.side]), 'one of its doorways meets the door that was opened');
  const e = enterRoom(s, floor, p, r.room.id);
  check(e.cost === 1 && p.actionPoints === 2 && p.currentRoom === r.room.id, 'going in is a normal move: 1 action point');
  check(openDoor(s, floor, q, floor.rooms.get(r.room.id).frontier[0]?.id || 'x').reason === 'notYourDoor', 'you can only open a door of the room you are in');
  p.actionPoints = 0;
  const f2 = floor.rooms.get(r.room.id).frontier[0];
  if (f2) check(openDoor(s, floor, p, f2.id).reason === 'ap' && openableDoors(s, floor, p).length === 0, 'with no action points left, no door opens');
  // A locked tile is locked the moment it is revealed, and never joins the lobby.
  let lockedOk = true, neverLobby = true;
  for (let seed = 1; seed <= 60; seed++) {
    const t = createState(floor, SIX, seed, { mode: 'hotseat' });
    ensureRoom(t, 'cloakroom'); ensureRoom(t, 'suite416');
    for (const id of ['cloakroom', 'suite416']) {
      if (floor.rooms.has(id) && !t.lockedRooms.has(id)) lockedOk = false;
      if (floor.rooms.get(id)?.neighbours.has(lobby)) neverLobby = false;
    }
  }
  check(lockedOk, 'a locked room is locked from the moment it is revealed');
  check(neverLobby, 'a locked room never joins the lobby');
}
{
  // Every placement follows the tile rules; the hotel never closes itself off before the exit.
  let bad = 0, closed = 0, exits = 0, jamAp = true;
  for (let seed = 1; seed <= 400; seed++) {
    const s = createState(floor, SIX, seed, { mode: 'hotseat' });
    const p = activePlayer(s);
    for (let step = 0; step < 120; step++) {
      const doors = openDoors(floor);
      if (!doors.length) { if (!exitPlaced(floor)) closed++; break; }
      const d = doors[(seed * 31 + step * 7) % doors.length];
      p.currentRoom = d.room; p.actionPoints = 4;
      const r = openDoor(s, floor, p, d.id);
      if (!r.ok && p.actionPoints !== 4) jamAp = false;
      if (!r.ok) continue;
      if (r.room.isExit) exits++;
      // every side of the new room matches its neighbours: doorway to doorway, wall to wall
      for (const [side, [di, dj]] of Object.entries({ north: [0, -1], south: [0, 1], east: [1, 0], west: [-1, 0] })) {
        const other = floor.rooms.get(floor.cells.get(`${r.room.cell[0] + di},${r.room.cell[1] + dj}`));
        if (other && other.doorSides.has({ north: 'south', south: 'north', east: 'west', west: 'east' }[side]) !== r.room.doorSides.has(side)) bad++;
      }
    }
  }
  check(bad === 0, 'no doorway ever opens into a wall: every new tile matches all its neighbours');
  check(closed === 0, 'over 400 hotels opened door by door, the hotel never closed itself off before the Fire Exit');
  check(exits === 400, 'the Fire Exit was reached in every one of them');
  check(jamAp, 'a jammed door costs no action point');
}

console.log('\nturns and movement');
{
  const s = hs(7);
  check(activePlayer(s).index === 0 && s.round === 1, 'starts on the first guest, round 1');
  const p = activePlayer(s);
  const r = enterRoom(s, floor, p, 'corridorE');
  check(r.cost === 1 && p.actionPoints === 3, 'entering a room costs 1');
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
  ensureRoom(s, 'storage');
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
  ensureRoom(s, 'cloakroom');
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
    ensureRoom(t, 'suite416');
    const L = [...t.lockedRooms][0], nb = [...floor.rooms.get(L).neighbours][0];
    q.currentRoom = nb; q.actionPoints = 4; q.hand.push({ id: 'lp', type: 'lockPick' });
    const res = useUnlock(t, floor, q, 'lp', L);
    tries++; if (res.opened) opened++;
    if (q.hand.some(c => c.id === 'lp')) { opened = -999; break; }
  }
  check(opened > 70 && opened < 130, `a Lock Pick opened ${opened} of ${tries} locked rooms (about half)`);
  check(opened !== -999, 'a Lock Pick is used up whether or not it works');
  const t2 = hs(12), q2 = activePlayer(t2);
  ensureRoom(t2, 'cloakroom');
  q2.hand.push({ id: 'mk2', type: 'masterKey' });
  check(useUnlock(t2, floor, q2, 'mk2', [...t2.lockedRooms][0]).reason === 'notAdjacentLocked', 'a key only works on a locked room next door');
}

console.log('\nbarricades');
{
  const s = hs(13), p = activePlayer(s);
  p.currentRoom = 'corridorE'; s.discovered.add('corridorE'); p.actionPoints = 4;
  const door = floor.rooms.get('corridorE').doorways[0];
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
  const other = floor.doorways.find(d => d.a !== 'corridorE' && d.b !== 'corridorE');
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
  const s = hsx(20);
  const K = cleanOnes(s)[0];
  K.currentRoom = floor.exitRoom; s.discovered.add(floor.exitRoom);
  K.hand = K.hand.filter(c => c.type !== 'lantern');
  check(!canEscape(s, floor, K) && checkWin(s, floor) === null, 'standing in the exit with no Lanterns does nothing');
  check(escape(s, floor, K).reason === 'notLetOut' && K.actionPoints === 4, 'Escape is refused without three Lanterns, and costs nothing');
  K.hand.push({ id: 'b1', type: 'lantern' }, { id: 'b2', type: 'lantern' });
  check(!canEscape(s, floor, K), 'two Lanterns are not enough');
  K.hand.push({ id: 'b3', type: 'lantern' });
  check(hasEscapeLanterns(K.hand) && canEscape(s, floor, K), 'three Lanterns and the exit: the guest can escape');
  // ORDER: the exit is resolved before any meeting.
  const other = cleanOnes(s)[1]; other.currentRoom = floor.exitRoom;
  check(pendingEncounters(s, floor, K).length === 0, 'the exit is safe: no meeting can be forced there');
  check(rules.escapeCost === 1 && rules.actionCost.escape === 1, 'escaping costs 1 action point');
  check(!s.finished && checkWin(s, floor) === null, 'walking in does not escape by itself: escaping is its own action');
  K.actionPoints = 0;
  check(escape(s, floor, K).reason === 'ap' && !s.finished, 'with no action points left there is no escape this turn');
  K.actionPoints = 2;
  const r = escape(s, floor, K);
  check(r.ok && K.actionPoints === 1 && s.finished && s.won === 'humans' && s.escaped.has(K.id), 'Escape spends 1 action point and the guests win');
  check(s.log.at(-1).text.includes('escaped'), 'the table sees the escape in the public log');
}
{
  // Arriving with no action points left: escape on the next turn; the exit is safe meanwhile.
  const s = hsx(31);
  const K = cleanOnes(s)[0];
  s.activeIndex = K.index;
  K.hand = [{ id: 'n1', type: 'lantern' }, { id: 'n2', type: 'lantern' }, { id: 'n3', type: 'lantern' }];
  K.currentRoom = floor.exitRoom; K.actionPoints = 0;
  check(escape(s, floor, K).reason === 'ap', 'arrived with 0 action points: not yet');
  const V = possessed(s); V.currentRoom = floor.exitRoom;
  check(pendingEncounters(s, floor, V).length === 0, 'the Fire Exit stays a safe zone: nobody can force a meeting on the waiting guest');
  for (let i = 0; i < s.players.length; i++) endTurn(s, floor);
  check(S_active(s) === K && K.actionPoints === 4 && escape(s, floor, K).ok && s.won === 'humans', 'on their next turn they spend 1 action point and escape');
}
{
  // Dawn can still beat a guest who reaches the exit with nothing left on the last turn.
  const s = hsx(32);
  const K = cleanOnes(s)[0];
  s.players.forEach(p => { p.possessed = false; }); possessedFix(s, K);
  K.hand = [{ id: 'd1', type: 'lantern' }, { id: 'd2', type: 'lantern' }, { id: 'd3', type: 'lantern' }];
  K.currentRoom = floor.exitRoom;
  while (!(s.round === rules.roundLimit && s.activeIndex === K.index)) endTurn(s, floor);
  K.actionPoints = 0;
  while (!checkWin(s, floor)) endTurn(s, floor);
  check(s.dawn && s.won === 'possessed' && !s.escaped.size, 'reaching the exit with no action points on the last turn: dawn breaks first');
}
{
  const s = hsx(21);
  const V = possessed(s);
  V.currentRoom = floor.exitRoom;
  V.hand.push({ id: 'b1', type: 'lantern' }, { id: 'b2', type: 'lantern' }, { id: 'b3', type: 'lantern' });
  check(!canEscape(s, floor, V) && escape(s, floor, V).reason === 'notLetOut' && !s.finished, 'a possessed guest holding three Lanterns can never escape');
}
{
  const s = hs(22);
  s.players.forEach(p => { p.possessed = true; });
  check(checkWin(s, floor) === 'possessed', 'every living guest possessed: the hotel wins');
  const s2 = hs(23);
  cleanOnes(s2).forEach(p => { p.alive = false; });
  check(checkWin(s2, floor) === 'possessed', 'every clean guest dead: the hotel wins');
  // DAWN: played out turn by turn through the real endTurn, not by setting the round directly.
  const s3 = hs(24);
  s3.players.forEach(p => { p.possessed = false; }); s3.players[5].possessed = true;   // nobody converts anyone here
  let before = true;
  while (s3.round < rules.roundLimit) { endTurn(s3, floor); if (checkWin(s3, floor)) before = false; }
  check(before && !s3.finished, 'no dawn during rounds 1 to 7');
  check(isFinalRound(s3) && !dawnHasBroken(s3), 'round 8 is the final round, and it is still being played');
  for (let i = 0; i < 5; i++) { endTurn(s3, floor); if (checkWin(s3, floor)) before = false; }
  check(before && s3.round === rules.roundLimit, 'every guest but the last has had their round-8 turn: still no dawn');
  endTurn(s3, floor);
  check(s3.round === rules.roundLimit + 1 && checkWin(s3, floor) === 'possessed' && s3.dawn && s3.finished,
    'the moment round 8 ends with nobody out, dawn breaks and the hotel wins');
  // An escape on the very last turn beats dawn.
  const s4 = hsx(29);
  s4.round = rules.roundLimit; s4.activeIndex = 5;
  const K = cleanOnes(s4).find(p => p.index === 5) || cleanOnes(s4)[0];
  s4.activeIndex = K.index;
  K.hand = [{ id: 'e1', type: 'lantern' }, { id: 'e2', type: 'lantern' }, { id: 'e3', type: 'lantern' }];
  K.currentRoom = floor.exitRoom;
  check(escape(s4, floor, K).ok && s4.won === 'humans' && !s4.dawn, 'a clean guest who escapes during round 8 wins — dawn has not broken yet');
  // Dead guests don't stretch the night: a round is one turn for every LIVING guest.
  const s5 = hs(30);
  s5.players.forEach(p => { p.possessed = false; }); s5.players[0].possessed = true;
  s5.players[2].alive = false; s5.players[4].alive = false;
  let turns = 0;
  while (!checkWin(s5, floor) && turns < 200) { endTurn(s5, floor); turns++; }
  check(s5.dawn && turns === rules.roundLimit * 4, `with four guests alive, dawn breaks after ${turns} turns (8 rounds of 4)`);
}
{
  // Practice has no deadline.
  applyMode('practice');
  const ps = createState(floor, roster.slice(0, 1), 3, { mode: 'practice' });
  ps.round = 50;
  check(checkWin(ps, floor) === null && !dawnHasBroken(ps), 'practice: no deadline, even in round 50');
  applyMode('hotseat', 6);
}
{
  // Practice: alone, find three Lanterns and get out.
  applyMode('practice');
  let reachable = 0;
  for (let seed = 1; seed <= 200; seed++) {
    const t = createState(floor, roster.slice(0, 1), seed, { mode: 'practice' });
    const third = t.drawPile.map((c, i) => (c.type === 'lantern' ? i : -1)).filter(i => i >= 0)[2];
    if (third < hotel.tiles.filter(x => !x.isExit).length) reachable++;
  }
  check(reachable >= 190, `practice is winnable: the third Lantern is within the ${hotel.tiles.length - 1} searchable rooms in ${reachable} of 200 deals`);
  const s = createState(floor, roster.slice(0, 1), 5, { mode: 'practice' });
  const p = activePlayer(s);
  check(s.players.length === 1 && !p.possessed && lanternCount(p.hand) === 0, 'practice: one clean guest, no Lanterns dealt');
  check(rules.turnTimerEnabled === false, 'practice has no timer');
  check(rules.practiceSeed == null, 'practice builds a new random hotel every match');
  ensureRoom(s, 'exit');
  p.currentRoom = floor.exitRoom;
  check(!escape(s, floor, p).ok && !s.finished, 'the exit does nothing without three Lanterns');
  p.hand.push({ id: 'b1', type: 'lantern' }, { id: 'b2', type: 'lantern' }, { id: 'b3', type: 'lantern' });
  check(escape(s, floor, p).ok && s.won === 'humans', 'with three Lanterns, Escape (1 action) completes practice');
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

// ================================================================================================
// Part 2 (approved): rooms with jobs, the Hand Mirror and the Espresso.
// ================================================================================================
// Put guest `p` in tile `id` (placed on the board first if need be) with a fresh 4 action points.
function standIn(s, p, id) {
  const ok = ensureRoom(s, id);
  if (ok) { p.currentRoom = id; s.discovered.add(id); p.actionPoints = 4; }
  return ok;
}
// Everyone clean except the guests at these seat numbers (so a check never depends on the seed).
function setRoles(s, ...possessedSeats) {
  s.players.forEach((p, i) => { p.possessed = possessedSeats.includes(i); });
}
const ids = hand => hand.map(c => c.id).join();
const filler = (n, tag = 'h') => Array.from({ length: n }, (_, i) => ({ id: `${tag}${i}`, type: 'bandage' }));

console.log('\nconfiguration: rooms with jobs and the new cards');
{
  check(rules.linenStoreDraws === 2, 'a Linen Store draw gives 2 cards');
  check(rules.infirmaryCost === 1 && rules.actionCost.infirmary === 1, 'the Infirmary costs 1 action point');
  check(rules.infirmaryHeal === 2, 'the Infirmary restores 2 health');
  check(rules.switchboardCost === 1 && rules.actionCost.switchboard === 1, 'the Switchboard costs 1 action point');
  check(rules.espressoCost === 0 && rules.actionCost.espresso === 0, 'an Espresso is free (no action point)');
  check(rules.cards.espresso?.extraActions === 2, 'an Espresso gives 2 extra action points');
  check(rules.playCardCost === 1 && rules.actionCost.useCard === 1, 'a Hand Mirror costs 1 action point, like any other card');
  check(!!rules.cards.handMirror && rules.cards.handMirror.name === 'Hand Mirror', 'the Hand Mirror is in the card catalogue');
  check(!!rules.cards.espresso && rules.cards.espresso.name === 'Espresso', 'the Espresso is in the card catalogue');
  check(!rules.cards.handMirror.evil && !rules.cards.espresso.evil && !rules.cards.handMirror.weapon && !rules.cards.espresso.weapon,
    'neither new card is a weapon or a possession card');
  let mirrors = 0, espressos = 0, lanterns = 0, deckOk = true;
  for (let seed = 1; seed <= 200; seed++) {
    const s = createState(floor, SIX, seed, { mode: 'hotseat' });
    for (const p of s.players) { mirrors += countType(p.hand, 'handMirror'); espressos += countType(p.hand, 'espresso'); lanterns += lanternCount(p.hand); }
    const all = [...s.drawPile, ...s.players.flatMap(p => p.hand.filter(c => c.type !== 'possession'))];
    if (all.length !== 48 || countType(all, 'handMirror') !== 3 || countType(all, 'espresso') !== 3) deckOk = false;
  }
  check(deckOk, 'every match: 48 cards in all, 3 of them Hand Mirrors and 3 Espressos');
  check(mirrors > 0, `Hand Mirrors turn up in starting hands (${mirrors} over 200 six-player deals)`);
  check(espressos > 0, `Espressos turn up in starting hands (${espressos} over 200 six-player deals)`);
  check(lanterns === 0, 'and still not one Lantern was dealt');
}

console.log('\nthe room deck: rooms with jobs');
{
  const tiles = hotel.tiles, jobs = j => tiles.filter(t => t.job === j);
  const others = tiles.filter(t => !t.isExit);
  const opposite = { north: 'south', south: 'north', east: 'west', west: 'east' };
  const straight = others.filter(t => t.doors.length === 2 && opposite[t.doors[0]] === t.doors[1]).length;
  const bend = others.filter(t => t.doors.length === 2 && opposite[t.doors[0]] !== t.doors[1]).length;
  const n = k => others.filter(t => t.doors.length === k).length;
  check(tiles.length === 24, 'the room deck still has 24 tiles');
  check(jobs('linenStore').length === 2 && jobs('infirmary').length === 2 && jobs('switchboard').length === 1,
    'exactly 2 Linen Stores, 2 Infirmaries and 1 Switchboard');
  check(tiles.filter(t => t.job).length === 5 && tiles.every(t => !t.job || ['linenStore', 'infirmary', 'switchboard'].includes(t.job)),
    'five rooms with jobs, and no other kind of job');
  check(['linenStore1', 'linenStore2'].every(id => tiles.find(t => t.id === id)?.job === 'linenStore')
    && ['infirmary1', 'infirmary2'].every(id => tiles.find(t => t.id === id)?.job === 'infirmary')
    && tiles.find(t => t.id === 'switchboard')?.job === 'switchboard', 'the job rooms are the tiles linenStore1/2, infirmary1/2 and switchboard');
  check(!['suite410', 'suite412', 'suite414', 'suite418', 'gardenLounge'].some(id => tiles.some(t => t.id === id)),
    'Suites 410, 412, 414, 418 and the Garden Lounge are gone');
  check(n(4) === 4 && n(3) === 7 && straight === 4 && bend === 4 && n(1) === 4,
    `doorways unchanged: 4 four-way, 7 T, 4 straight, 4 corner, 4 dead ends (${n(4)}/${n(3)}/${straight}/${bend}/${n(1)})`);
  check(tiles.find(t => t.isExit)?.doors.length === 1, '...plus the Fire Exit (a dead end)');
  check(tiles.filter(t => t.dark).length === 5 && tiles.filter(t => t.locked).length === 2, 'still 5 dark rooms and 2 locked rooms');
  check(tiles.filter(t => t.job).every(t => t.searchable !== false && !t.dark && !t.locked && !t.isExit && !t.safe),
    'every job room can be searched, and none is dark, locked or safe');
  // On the board, each one carries its job.
  let placedOk = true, placedAll = true;
  for (let seed = 1; seed <= 30; seed++) {
    const s = createState(floor, SIX, seed, { mode: 'hotseat' });
    for (const t of tiles.filter(x => x.job)) {
      if (!ensureRoom(s, t.id)) { placedAll = false; continue; }
      const room = floor.rooms.get(t.id);
      if (room.job !== t.job || !room.searchable || room.dark || isLocked(s, t.id)) placedOk = false;
    }
    const plain = floor.roomList.filter(r => !tiles.find(t => t.id === r.id)?.job);
    if (plain.some(r => r.job)) placedOk = false;
  }
  check(placedAll, 'over 30 hotels, all five job rooms could be placed every time');
  check(placedOk, 'a placed job room carries its job (searchable, not dark, not locked); no other room has one');
}

console.log('\nLinen Store');
{
  const s = hs(201), p = cleanOnes(s)[0];
  check(standIn(s, p, 'linenStore1'), 'a Linen Store is on the board');
  p.hand = filler(2);
  const pile = s.drawPile.length, top = s.drawPile.slice(0, 2).map(c => c.id);
  const r = search(s, floor, p);
  check(r.ok && r.kind === 'cards' && r.cards.length === 2 && p.actionPoints === 3, 'the first search draws 2 cards for 1 action point');
  check(r.cards.every(c => p.hand.includes(c)) && countableCount(p.hand) === 4 && s.drawPile.length === pile - 2,
    'both cards go into the hand, and 2 leave the draw pile');
  check(ids(r.cards) === top.join() && r.card === r.cards[0], 'they are the top two cards of the draw pile');
  check(!r.full && r.overflow.length === 0, 'nothing overflows with room in the hand');
  check(canSearch(s, floor, p).reason === 'searched' && search(s, floor, p).reason === 'searched' && p.actionPoints === 3,
    'a second search is refused ("searched"), costing nothing');
  check(s.log.at(-1).text === `${p.name} searched Linen Store.`, 'the public log says only that a search happened');
  check(!s.log.some(l => /Lantern|Bandage|Knife|Flashlight|Revolver|Barricade|Lock Pick|Master Key|Hand Mirror|Espresso/.test(l.text)),
    'it never names what was found');
  // The other Linen Store has its own 2-card draw.
  check(standIn(s, p, 'linenStore2'), 'the second Linen Store is on the board');
  p.hand = filler(1);
  const r2 = search(s, floor, p);
  check(r2.ok && r2.kind === 'cards' && r2.cards.length === 2 && countableCount(p.hand) === 3, 'the second Linen Store also gives 2 cards');
}
{
  // Five cards in hand: one fits, the other goes to the take-or-leave prompt.
  const s = hs(202), p = cleanOnes(s)[0];
  standIn(s, p, 'linenStore1');
  p.hand = filler(5);
  const r = search(s, floor, p);
  check(r.ok && r.cards.length === 2 && r.full && r.overflow.length === 1, 'with 5 cards in hand: 1 kept, 1 overflows');
  check(p.hand.includes(r.cards[0]) && !p.hand.includes(r.cards[1]) && r.overflow[0] === r.cards[1] && countableCount(p.hand) === 6,
    'the first card is kept, the second is not added (the hand is at 6)');
  const leave = resolveFullHand(s, p, r.overflow[0], 'leave');
  check(leave.ok && s.discardPile.includes(r.overflow[0]) && countableCount(p.hand) === 6, 'leaving the overflow card puts it on the discard pile');
}
{
  // Six cards in hand: both overflow; each goes through take-or-leave.
  const s = hs(203), p = cleanOnes(s)[0];
  standIn(s, p, 'linenStore1');
  p.hand = filler(6);
  const before = ids(p.hand);
  const r = search(s, floor, p);
  check(r.ok && r.full && r.overflow.length === 2 && ids(r.overflow) === ids(r.cards), 'with 6 cards in hand: both cards overflow');
  check(ids(p.hand) === before, 'neither is added to the hand');
  check(s.searchedRooms.has('linenStore1'), 'the room counts as searched anyway');
  const take = resolveFullHand(s, p, r.overflow[0], 'take', 'h0');
  check(take.ok && p.hand.includes(r.overflow[0]) && !p.hand.some(c => c.id === 'h0') && countableCount(p.hand) === 6,
    'the first can be taken by dropping a card');
  const take2 = resolveFullHand(s, p, r.overflow[1], 'take', 'h1');
  check(take2.ok && p.hand.includes(r.overflow[1]) && countableCount(p.hand) === 6 && s.discardPile.some(c => c.id === 'h1'),
    'and the second too — each overflow card has its own take-or-leave');
}
{
  // Possession cards don't count toward the hand limit here either.
  const s = hs(204); setRoles(s, 0);
  const V = s.players[0];
  standIn(s, V, 'linenStore1');
  V.hand = [...filler(4), { id: 'pz1', type: 'possession' }, { id: 'pz2', type: 'possession' }, { id: 'pz3', type: 'possession' }];
  const r = search(s, floor, V);
  check(r.ok && r.cards.length === 2 && !r.full && r.cards.every(c => V.hand.includes(c)),
    'a possessed guest with 4 ordinary cards + 3 Possession cards keeps both (Possession cards do not count)');
}
{
  // Only one card left anywhere: the Linen Store gives just that one.
  const s = hs(205), p = cleanOnes(s)[0];
  standIn(s, p, 'linenStore1');
  p.hand = filler(2);
  s.drawPile = [s.drawPile[0]]; s.discardPile = [];
  const last = s.drawPile[0];
  const r = search(s, floor, p);
  check(r.ok && r.kind === 'cards' && r.cards.length === 1 && r.cards[0] === last && p.hand.includes(last) && !r.full,
    'with only 1 card left in the deck, the Linen Store gives that 1');
  const s2 = hs(206), q = cleanOnes(s2)[0];
  standIn(s2, q, 'linenStore1');
  q.hand = filler(2);
  const lone = s2.drawPile[0];
  s2.drawPile = []; s2.discardPile = [lone];
  const r2 = search(s2, floor, q);
  check(r2.ok && r2.cards?.length === 1 && q.hand.includes(lone) && !s2.drawPile.length && !s2.discardPile.length,
    'with the deck empty and 1 card in the discard pile, it is reshuffled and that 1 is given');
  const s3 = hs(207), u = cleanOnes(s3)[0];
  standIn(s3, u, 'linenStore1');
  s3.drawPile = []; s3.discardPile = [];
  check(canSearch(s3, floor, u).reason === 'empty' && search(s3, floor, u).reason === 'empty' && u.actionPoints === 4,
    'with no cards left at all, there is nothing to search (no action point spent)');
}
{
  // Cards dropped in a Linen Store are picked up first; the 2-card draw is still there after.
  const s = hs(208), p = cleanOnes(s)[0];
  standIn(s, p, 'linenStore1');
  p.hand = filler(1);
  s.roomDrops.set('linenStore1', [{ id: 'dz1', type: 'knife' }]);
  const f = search(s, floor, p);
  check(f.ok && f.kind === 'found' && p.hand.some(c => c.id === 'dz1') && !s.roomDrops.has('linenStore1'),
    'cards lying in a Linen Store are picked up first');
  check(!s.searchedRooms.has('linenStore1') && canSearch(s, floor, p).ok, 'picking them up does not use the room’s draw');
  const r = search(s, floor, p);
  check(r.ok && r.kind === 'cards' && r.cards.length === 2 && countableCount(p.hand) === 4, 'the 2-card draw is still available afterwards');
}
{
  // An ordinary room still draws exactly one.
  const s = hs(209), p = cleanOnes(s)[0];
  standIn(s, p, 'corridorE');
  p.hand = filler(2);
  const pile = s.drawPile.length;
  const r = search(s, floor, p);
  check(r.ok && r.kind === 'card' && !r.cards && countableCount(p.hand) === 3 && s.drawPile.length === pile - 1,
    'an ordinary room still draws exactly 1 card');
}

console.log('\nInfirmary');
{
  const s = hs(210); setRoles(s, 5);
  const p = s.players[0];
  check(standIn(s, p, 'infirmary1'), 'an Infirmary is on the board');
  p.health = 1;
  const g = canUseRoom(s, floor, p);
  check(g.ok && g.job === 'infirmary', 'a hurt guest can use it');
  const r = useInfirmary(s, floor, p);
  check(r.ok && p.health === 3 && r.health === 3 && r.healed === 2 && p.actionPoints === 3, '1 action point: health 1 -> 3');
  check(s.log.at(-1).text.includes(p.name) && !/possess/i.test(s.log.at(-1).text), 'the public log says who was treated, nothing more');
  // Usable again in the same turn while hurt (no once-per-turn limit).
  p.health = 2;
  const r2 = useInfirmary(s, floor, p);
  check(r2.ok && p.health === 3 && r2.healed === 1 && p.actionPoints === 2, 'used again the same turn: 2 -> 3 (never above the maximum)');
  check(canUseRoom(s, floor, p).reason === 'full' && useInfirmary(s, floor, p).reason === 'full' && p.actionPoints === 2,
    'at full health it is refused and no action point is spent');
  p.health = 1; p.actionPoints = 0;
  check(useInfirmary(s, floor, p).reason === 'ap' && p.health === 1, 'with no action points it is refused');
  p.actionPoints = 4;
  standIn(s, p, 'corridorE'); p.health = 1;
  check(canUseRoom(s, floor, p).reason === 'noJob' && useInfirmary(s, floor, p).reason === 'noJob' && p.health === 1 && p.actionPoints === 4,
    'outside an Infirmary there is nothing to use ("noJob")');
  const V = s.players[5];
  standIn(s, V, 'infirmary1'); V.health = 1;
  const rv = useInfirmary(s, floor, V);
  check(rv.ok && V.health === 3, 'a possessed guest can use it too');
  check(standIn(s, p, 'infirmary2'), 'the other Infirmary is on the board');
  p.health = 1;
  check(useInfirmary(s, floor, p).ok && p.health === 3, 'the other Infirmary works the same way');
  p.health = 1; p.alive = false;
  check(useInfirmary(s, floor, p).reason === 'dead', 'the dead cannot use it');
  p.alive = true; s.finished = true;
  check(useInfirmary(s, floor, p).reason === 'finished', 'nor can anyone once the match is over');
}

console.log('\nSwitchboard');
{
  const s = hs(211); setRoles(s, 4);
  check(ensureRoom(s, 'switchboard'), 'the Switchboard is on the board');
  for (const q of s.players) { q.currentRoom = 'switchboard'; }
  s.discovered.add('switchboard');
  const [A, B, C, D, E, F] = s.players;
  check(activePlayer(s) === A && canUseRoom(s, floor, A).ok && canUseRoom(s, floor, A).job === 'switchboard', 'the active guest can ring it');
  const r = useSwitchboard(s, floor, A);
  check(r.ok && r.count === 1 && A.actionPoints === 3, '1 action point: one guest is possessed');
  check(s.switchboardCalls.get(A.id) === s.turn, 'the ring is recorded for this turn');
  const line = s.log.at(-1).text;
  check(line.includes(A.name) && /\b1\b/.test(line), `the public log gives the number ("${line}")`);
  check(!line.includes(E.name), 'and never the possessed guest’s name');
  check(canUseRoom(s, floor, A).reason === 'usedThisTurn' && useSwitchboard(s, floor, A).reason === 'usedThisTurn' && A.actionPoints === 3,
    'a second ring in the same turn is refused, with no action point spent');
  convertToPossessed(s, C, E.id);
  endTurn(s, floor);
  const r2 = useSwitchboard(s, floor, B);
  check(activePlayer(s) === B && s.round === 1 && r2.ok && r2.count === 2, 'another guest rings in the same round: 2, after a conversion');
  const line2 = s.log.at(-1).text;
  check(/\b2\b/.test(line2) && !line2.includes(C.name) && !line2.includes(E.name), 'again the number and no possessed guest’s name');
  E.alive = false;
  endTurn(s, floor); endTurn(s, floor);                // C, then D
  const r3 = useSwitchboard(s, floor, D);
  check(activePlayer(s) === D && r3.ok && r3.count === 1, 'a dead possessed guest is not counted');
  endTurn(s, floor);                                    // E is dead: F
  F.actionPoints = 0;
  check(activePlayer(s) === F && useSwitchboard(s, floor, F).reason === 'ap', 'with no action points it is refused');
  endTurn(s, floor);
  check(activePlayer(s) === A && s.round === 2, 'round 2: back to the first guest');
  const r4 = useSwitchboard(s, floor, A);
  check(r4.ok && r4.count === 1 && A.actionPoints === 3, 'the same guest can ring again on their next turn');
  A.currentRoom = 'corridorE'; A.actionPoints = 4;
  check(canUseRoom(s, floor, A).reason === 'noJob' && useSwitchboard(s, floor, A).reason === 'noJob' && A.actionPoints === 4,
    'outside the Switchboard there is nothing to ring ("noJob")');
  check(!s.log.some(l => l.text.includes('Switchboard') && [C, E].some(q => l.text.includes(q.name))),
    'no Switchboard line ever names a possessed guest');
}

console.log('\nHand Mirror');
{
  const s = hs(212); setRoles(s, 1);
  const A = s.players[0], V = s.players[1], K = s.players[2];
  for (const q of [A, V, K]) standIn(s, q, 'corridorE');
  V.hand = [{ id: 'vk', type: 'knife' }, { id: 'vl', type: 'lantern' }, { id: 'vp1', type: 'possession' }, { id: 'vp2', type: 'possession' }];
  A.hand = [{ id: 'hm1', type: 'handMirror' }, { id: 'hm2', type: 'handMirror' }, { id: 'hm3', type: 'handMirror' }];
  const vBefore = ids(V.hand);
  const r = useHandMirror(s, floor, A, 'hm1', V.id);
  check(r.ok && A.actionPoints === 3, 'a Hand Mirror costs 1 action point');
  check(!A.hand.some(c => c.id === 'hm1') && s.discardPile.some(c => c.id === 'hm1'), 'and is used up (on the discard pile)');
  check(r.target === V.id && ids(r.hand) === vBefore, 'it shows the target’s whole hand');
  check(r.hand.filter(c => c.type === 'possession').length === 2 && r.unmasked, 'Possession cards included');
  check(ids(V.hand) === vBefore, 'the target keeps every card');
  check(V.notes.some(n => n.includes(A.name) && n.includes('Hand Mirror')) && !A.notes.length,
    'the target is told privately (on their own next screen) that their hand was seen');
  check(A.knows.has(V.id), 'a clean guest who sees a Possession card now knows the target is possessed');
  const line = s.log.at(-1).text;
  const others = Object.values(rules.cards).map(c => c.name).filter(nm => nm !== 'Hand Mirror');
  check(line.includes(A.name) && line.includes(V.name), `the public log names who used it and on whom ("${line}")`);
  check(!others.some(nm => line.includes(nm)) && !/possess/i.test(line), 'and never what it showed');
  // A clean target.
  K.hand = [{ id: 'kb', type: 'bandage' }];
  const knew = [...A.knows].join();
  const r2 = useHandMirror(s, floor, A, 'hm2', K.id);
  check(r2.ok && !r2.unmasked && ids(r2.hand) === 'kb' && [...A.knows].join() === knew, 'a clean target: nothing new is learned about roles');
  // Refusals: the card is kept and no action point is spent.
  A.actionPoints = 4;
  const refused = (res, why) => res.reason === why && A.actionPoints === 4 && A.hand.some(c => c.id === 'hm3');
  check(refused(useHandMirror(s, floor, A, 'hm3', A.id), 'noTarget'), 'refused on yourself');
  check(refused(useHandMirror(s, floor, A, 'hm3', 'nobody'), 'noTarget'), 'refused on nobody');
  K.alive = false;
  check(refused(useHandMirror(s, floor, A, 'hm3', K.id), 'targetDead'), 'refused on a dead guest');
  K.alive = true;
  standIn(s, K, 'kitchen'); A.actionPoints = 4;
  check(refused(useHandMirror(s, floor, A, 'hm3', K.id), 'notTogether'), 'refused on a guest in another room');
  A.actionPoints = 0;
  check(useHandMirror(s, floor, A, 'hm3', V.id).reason === 'ap' && A.hand.some(c => c.id === 'hm3'), 'refused with no action points');
  A.actionPoints = 4;
  check(refused(useHandMirror(s, floor, A, 'hm1', V.id), 'noCard'), 'refused without a Hand Mirror in hand');
  // In the lobby (a safe zone) it still works.
  A.currentRoom = K.currentRoom = lobby;
  const r3 = useHandMirror(s, floor, A, 'hm3', K.id);
  check(r3.ok && A.actionPoints === 3, 'it works in the lobby too');
  check(countType(A.hand, 'handMirror') === 0 && s.discardPile.filter(c => c.type === 'handMirror').length === 3, 'all three mirrors are used up');
}

console.log('\nEspresso');
{
  const s = hs(213);
  const A = activePlayer(s);
  A.hand = [{ id: 'es1', type: 'espresso' }, { id: 'es2', type: 'espresso' }, { id: 'es3', type: 'espresso' }];
  A.actionPoints = 0;
  const r = useEspresso(s, A, 'es1');
  check(r.ok && A.actionPoints === 2 && r.actionPoints === 2 && r.gained === 2, 'free: it works with 0 action points and gives 2');
  check(!A.hand.some(c => c.id === 'es1') && s.discardPile.some(c => c.id === 'es1'), 'used up (on the discard pile)');
  A.actionPoints = 4;
  check(useEspresso(s, A, 'es2').ok && A.actionPoints === 6, 'it can take you past 4: 4 -> 6');
  check(useEspresso(s, A, 'es3').ok && A.actionPoints === 8, 'two in one turn: 8');
  check(useEspresso(s, A, 'es3').reason === 'noCard' && A.actionPoints === 8, 'no Espresso left: refused');
  // The extra points can really be spent.
  standIn(s, A, 'corridorE'); A.actionPoints = 6;
  let moves = 0;
  const other = () => (A.currentRoom === 'corridorE' ? lobby : 'corridorE');
  for (let i = 0; i < 6; i++) {
    if (!canAffordRoute(s, floor, A, [A.currentRoom, other()]).ok) break;
    if (enterRoom(s, floor, A, other()).cost === 1) moves++;
  }
  check(moves === 6 && A.actionPoints === 0 && canAffordRoute(s, floor, A, [A.currentRoom, other()]).reason === 'notEnoughActionPoints',
    'six action points buy exactly six moves');
  A.actionPoints = 8;
  const living = s.players.filter(q => q.alive).length;
  const nextUp = nextPlayer(s);
  endTurn(s, floor);
  check(nextUp.actionPoints === 4, 'the next guest starts with the usual 4');
  for (let i = 1; i < living; i++) endTurn(s, floor);
  check(activePlayer(s) === A && A.actionPoints === 4, 'round the table and back: exactly 4 again (never carried over)');
  A.hand.push({ id: 'es4', type: 'espresso' });
  s.finished = true;
  check(useEspresso(s, A, 'es4').reason === 'finished' && A.hand.some(c => c.id === 'es4') && A.actionPoints === 4, 'refused once the match is over');
  s.finished = false; A.alive = false;
  check(useEspresso(s, A, 'es4').reason === 'dead', 'the dead cannot use one');
}

console.log('\nnever stuck beside a door that cannot be used');
{
  // A guest standing right at a closed door opens it and the room behind is locked (or a barricade
  // goes up in front of them): the floor round that doorway is closed off, yet they must always be
  // able to walk back into their room — and never through the doorway.
  let cases = 0, free = 0, through = 0, freeCost = true;
  for (let seed = 1; seed <= 120; seed++) {
    const s = createState(floor, SIX, seed, { mode: 'hotseat' });
    const p = activePlayer(s);
    for (let step = 0; step < 40; step++) {
      const doors = openDoors(floor); if (!doors.length) break;
      const d = doors[(seed * 31 + step * 7) % doors.length];
      p.currentRoom = d.room; p.actionPoints = 4; s.discovered.add(d.room);
      let grid = buildGrid(floor, config);
      const at = nearestWalkable(grid, d.center[0], d.center[1], 3, buildAllowed(s, floor, grid));
      if (at < 0) continue;
      const pos = grid.center(at);
      const r = openDoor(s, floor, p, d.id);
      if (!r.ok) continue;
      if (!r.locked) {
        if (step % 3) continue;
        placeBarricade(s, p, r.doorway.id);   // the barricade case
      }
      cases++;
      grid = buildGrid(floor, config);
      const allowed = buildAllowed(s, floor, grid);
      const back = planMove(s, floor, grid, config, p, pos, floor.rooms.get(d.room).center, allowed);
      if (back.ok) free++;
      if (back.ok && (back.cost !== 0 || back.rooms.some(id => id !== d.room))) freeCost = false;
      const beyond = planMove(s, floor, grid, config, p, pos, r.room.center, allowed);
      const farSide = new Set(grid.landings.get(r.doorway.id)[r.room.id]);
      if (back.ok && back.cells.some(c => farSide.has(c))) through++;
      if (beyond.ok && beyond.cells.some(c => farSide.has(c))) through++;
      s.barricades.clear();
    }
  }
  check(cases > 100 && free === cases, `standing at the door, the guest can always walk back into the room (${free}/${cases})`);
  check(freeCost, 'and that walk stays in the room and costs nothing');
  check(through === 0, 'but the route never goes through the locked or barricaded doorway');
}

console.log(failures ? `\n${failures} FAILED` : '\nALL RULES CHECKS PASSED');
process.exit(failures ? 1 : 0);
