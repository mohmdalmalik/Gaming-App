// Everything a guest can do that changes the game: search, play a card, and the two ways a
// forced meeting resolves — trade or attack. Pure logic; the interface calls these and shows
// whatever they return. Implements docs/GAME_RULES.md (the owner's design — see CLAUDE.md).
import { rules } from '../data/rules.js';
import { CARDS, takeCard, isWeapon, isPiece, countableCount, shuffle } from './cards.js';
import {
  checkWin, logPublic, convertToPossessed, isLocked, unlockRoom, placeBarricade, isBarricaded,
  adjacentLockedRooms,
} from './state.js';

// --- Deck ------------------------------------------------------------------------------------
// Draw one card; when the deck runs out the discard pile is shuffled into a new deck.
export function drawCard(state) {
  if (!state.drawPile.length && state.discardPile.length) {
    state.drawPile = shuffle(state.discardPile.splice(0), state.rng);
  }
  return state.drawPile.shift() || null;
}

// Put a played or discarded card on the discard pile. Possession cards and key pieces never go
// there — they are not deck cards.
export function toDiscard(state, card) {
  if (!card || card.type === 'possession' || isPiece(card)) return;
  state.discardPile.push(card);
}

// --- Searching ---------------------------------------------------------------------------------
// Whether the current room can be searched by `player` right now.
export function canSearch(state, floor, player) {
  const room = floor.rooms.get(player.currentRoom);
  if (state.finished) return { ok: false, reason: 'finished' };
  if (!room?.searchable) return { ok: false, reason: 'notSearchable' };
  if (player.actionPoints < rules.actionCost.search) return { ok: false, reason: 'ap' };
  if (room.dark && rules.darkRoomsRequireLight && !player.hand.some(c => c.type === 'flashlight')) {
    return { ok: false, reason: 'dark' };
  }
  const drops = state.roomDrops.get(room.id) || [];
  // A room gives up its card draw once; anything lying on its floor can always be picked up.
  if (!drops.length && state.searchedRooms.has(room.id)) return { ok: false, reason: 'searched' };
  if (!drops.length && !state.drawPile.length && !state.discardPile.length) return { ok: false, reason: 'empty' };
  return { ok: true };
}

// Search the current room (1 AP). If the room hides a key piece or dropped cards, you take them
// all. Otherwise you draw one card. A drawn card that does not fit is reported with `full` so
// the caller can ask what to do with it; the room counts as searched either way.
export function search(state, floor, player) {
  const gate = canSearch(state, floor, player);
  if (!gate.ok) return gate;
  const room = floor.rooms.get(player.currentRoom);
  player.actionPoints -= rules.actionCost.search;
  const base = { ok: true, room: room.id, searchPoint: room.searchPoint || null };

  const drops = state.roomDrops.get(room.id);
  if (drops?.length) {
    state.roomDrops.delete(room.id);
    player.hand.push(...drops);
    return {
      ...base, kind: 'found', cards: drops,
      pieces: drops.filter(isPiece),
      full: countableCount(player.hand) > rules.handLimit,   // settled at the end of the turn
    };
  }

  state.searchedRooms.add(room.id);
  const card = drawCard(state);
  if (!card) return { ...base, kind: 'nothing' };
  const full = countableCount(player.hand) >= rules.handLimit;
  if (!full) player.hand.push(card);
  return { ...base, kind: 'card', card, full };
}

// A drawn card the guest could not hold: 'take' it (dropping `dropId`) or 'leave' it.
export function resolveFullHand(state, player, card, choice, dropId = null) {
  if (choice === 'take') {
    if (!dropId) return { ok: false, reason: 'noChoice' };
    const dropped = takeCard(player.hand, dropId);
    if (!dropped) return { ok: false, reason: 'noCard' };
    if (dropped.type === 'possession' || isPiece(dropped)) { player.hand.push(dropped); return { ok: false, reason: 'undroppable' }; }
    toDiscard(state, dropped);
    player.hand.push(card);
    return { ok: true, kept: card, dropped };
  }
  toDiscard(state, card);
  return { ok: true, left: card };
}

// Discard a card to obey the hand limit at the end of a turn. Free. Never a piece or a
// Possession card.
export function discardCard(state, player, cardId) {
  const card = player.hand.find(c => c.id === cardId);
  if (!card) return { ok: false, reason: 'noCard' };
  if (card.type === 'possession' || isPiece(card)) return { ok: false, reason: 'undroppable' };
  takeCard(player.hand, cardId);
  toDiscard(state, card);
  return { ok: true, card };
}

// How many cards a guest must shed to obey the hand limit (pieces and Possession excluded).
export function overHandLimit(player) {
  return Math.max(0, countableCount(player.hand) - rules.handLimit);
}

// --- Cards played on your turn ------------------------------------------------------------------
const needAp = (state, player) => {
  if (state.finished) return { ok: false, reason: 'finished' };
  if (player.actionPoints < rules.actionCost.useCard) return { ok: false, reason: 'ap' };
  return null;
};

// Bandage (1 AP): restore one health bar, up to the maximum. Used up.
export function useBandage(state, player, cardId) {
  const bad = needAp(state, player); if (bad) return bad;
  const card = player.hand.find(c => c.id === cardId && c.type === 'bandage');
  if (!card) return { ok: false, reason: 'noCard' };
  if (player.health >= rules.maxHealth) return { ok: false, reason: 'full' };
  player.actionPoints -= rules.actionCost.useCard;
  player.health = Math.min(rules.maxHealth, player.health + rules.bandageHeal);
  takeCard(player.hand, cardId); toDiscard(state, card);
  return { ok: true, health: player.health };
}

// Master Key or Lock Pick (1 AP) on a locked room next door. The key always works; the pick
// works `lockPickChance` of the time. Both are used up whatever happens.
export function useUnlock(state, floor, player, cardId, roomId) {
  const bad = needAp(state, player); if (bad) return bad;
  const card = player.hand.find(c => c.id === cardId && CARDS[c.type]?.unlock);
  if (!card) return { ok: false, reason: 'noCard' };
  if (!adjacentLockedRooms(state, floor, player).includes(roomId)) return { ok: false, reason: 'notAdjacentLocked' };
  player.actionPoints -= rules.actionCost.useCard;
  takeCard(player.hand, cardId); toDiscard(state, card);
  const opened = card.type === 'masterKey' || state.rng() < rules.lockPickChance;
  if (opened) unlockRoom(state, roomId);
  logPublic(state, `${player.name} ${opened ? 'opened' : 'failed to open'} ${floor.rooms.get(roomId)?.name ?? 'a locked room'}.`);
  return { ok: true, opened, room: roomId, card: card.type };
}

// Barricade (1 AP): seal one doorway of the room you are in for one round. Used up.
export function useBarricade(state, floor, player, cardId, doorwayId) {
  const bad = needAp(state, player); if (bad) return bad;
  const card = player.hand.find(c => c.id === cardId && c.type === 'barricade');
  if (!card) return { ok: false, reason: 'noCard' };
  const door = (floor.rooms.get(player.currentRoom)?.doorways || []).find(d => d.id === doorwayId);
  if (!door) return { ok: false, reason: 'notYourDoorway' };
  if (isBarricaded(state, doorwayId)) return { ok: false, reason: 'alreadySealed' };
  player.actionPoints -= rules.actionCost.useCard;
  takeCard(player.hand, cardId); toDiscard(state, card);
  placeBarricade(state, player, doorwayId);
  logPublic(state, `${player.name} barricaded a doorway of ${floor.rooms.get(player.currentRoom)?.name}.`);
  return { ok: true, doorway: doorwayId };
}

// --- Trade ------------------------------------------------------------------------------------
// Which cards a guest may give: a clean guest can never give a Possession card; the possessed
// side may give anything.
export function tradeableCards(player) {
  return player.hand.filter(c => player.possessed || c.type !== 'possession');
}

// Both guests chose secretly; the cards swap at the same time. P entered the room and gives
// cardIdP; Q gives cardIdQ. Results are PRIVATE — the returned `received` map says what each
// side gets to see, and `notes` carries the two private consequences (a block, a conversion).
//
//   Receive a Possession card without giving a Lantern -> possessed; you keep the card.
//   Receive a Possession card while giving a Lantern  -> the attempt fails, the Possession card
//     is destroyed, the Lantern STILL goes to the other guest, and you learn who tried.
export function resolveTrade(state, floor, P, Q, cardIdP, cardIdQ) {
  if (state.finished) return { ok: false, reason: 'finished' };
  const cP = P.hand.find(c => c.id === cardIdP);
  const cQ = Q.hand.find(c => c.id === cardIdQ);
  if (!cP || !cQ) return { ok: false, reason: 'noCard' };
  if (cP.type === 'possession' && !P.possessed) return { ok: false, reason: 'illegal' };
  if (cQ.type === 'possession' && !Q.possessed) return { ok: false, reason: 'illegal' };

  takeCard(P.hand, cardIdP);
  takeCard(Q.hand, cardIdQ);
  const events = {
    ok: true, given: { [P.id]: cP.type, [Q.id]: cQ.type },
    received: { [P.id]: cQ.type, [Q.id]: cP.type },
    blocks: [], possessed: [], notes: {},
  };
  const note = (id, text) => { (events.notes[id] ||= []).push(text); };

  // One direction of possession: giver G hands `pc`, receiver R handed `rc`.
  const passPossession = (G, R, pc, rc) => {
    G.hand.push(rc);                                  // whatever R gave, G keeps — Lantern included
    if (rc.type === 'lantern') {
      R.knows.add(G.id);                              // blocked, and R knows who tried
      events.blocks.push({ blocker: R.id, revealed: G.id });
      events.received[R.id] = null;                   // the Possession card is destroyed
      note(R.id, `You handed over a Lantern and it burned away a Possession card. ${G.name} is POSSESSED — only you know.`);
      note(G.id, `${R.name} blocked you with a Lantern. They now know what you are.`);
    } else {
      R.hand.push(pc);                                // R keeps the Possession card
      if (!R.possessed) {
        convertToPossessed(state, R, G.id);
        events.possessed.push({ newly: R.id, by: G.id });
        note(R.id, `You received a Possession card from ${G.name}. You are now POSSESSED.`);
        note(G.id, `${R.name} is now possessed.`);
      } else {
        note(R.id, `${G.name} handed you a Possession card. You already belong to the hotel.`);
      }
    }
  };

  if (cP.type === 'possession' && cQ.type !== 'possession') passPossession(P, Q, cP, cQ);
  else if (cQ.type === 'possession' && cP.type !== 'possession') passPossession(Q, P, cQ, cP);
  else { P.hand.push(cQ); Q.hand.push(cP); events.swap = true; }   // plain swap (or both possessed)

  for (const [pid, lines] of Object.entries(events.notes)) {
    const p = state.players.find(q => q.id === pid);
    if (p) p.notes.push(...lines);
  }
  logPublic(state, `${P.name} and ${Q.name} traded.`);
  events.win = checkWin(state, floor);
  return events;
}

// --- Attack ------------------------------------------------------------------------------------
// Everything a dead guest carried lands on the floor of that room, except their Possession
// cards, which leave the game with them. Searching the room picks it all up.
function dropEverything(state, player) {
  const dropped = player.hand.filter(c => c.type !== 'possession');
  player.hand = [];
  if (dropped.length) {
    state.roomDrops.set(player.currentRoom, [...(state.roomDrops.get(player.currentRoom) || []), ...dropped]);
  }
  return dropped;
}

// `attacker` hits `target` with a weapon (1 AP). Knife is reusable; the Revolver spends a shot
// and is gone when empty. Never in the lobby.
export function resolveAttack(state, floor, attacker, target, weaponId) {
  if (state.finished) return { ok: false, reason: 'finished' };
  if (!rules.combatEnabled) return { ok: false, reason: 'combatDisabled' };
  if (floor.rooms.get(attacker.currentRoom)?.safe) return { ok: false, reason: 'safe' };
  if (attacker.currentRoom !== target.currentRoom) return { ok: false, reason: 'notTogether' };
  if (attacker.actionPoints < rules.actionCost.attack) return { ok: false, reason: 'ap' };
  const weapon = attacker.hand.find(c => c.id === weaponId && isWeapon(c));
  if (!weapon) return { ok: false, reason: 'noWeapon' };
  if (!target.alive) return { ok: false, reason: 'targetDead' };
  attacker.actionPoints -= rules.actionCost.attack;
  const damage = CARDS[weapon.type].damage;
  target.health = Math.max(0, target.health - damage);
  const events = { ok: true, attacker: attacker.id, target: target.id, weapon: weapon.type, damage, discarded: false, killed: false, dropped: [] };
  if (weapon.type === 'revolver') {
    weapon.shots = (weapon.shots ?? CARDS.revolver.shots) - 1;
    if (weapon.shots <= 0) { takeCard(attacker.hand, weapon.id); toDiscard(state, weapon); events.discarded = true; }
  }
  if (target.health === 0) {
    target.alive = false;
    events.killed = true;
    events.dropped = dropEverything(state, target);
  }
  logPublic(state, `${attacker.name} attacked ${target.name} with a ${CARDS[weapon.type].name}${events.killed ? ' — fatally' : ''}.`);
  events.win = checkWin(state, floor);
  return events;
}

// A guest who has died for any reason drops what they carried (exported for the tests).
export { dropEverything };
