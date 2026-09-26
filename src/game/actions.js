// Everything a guest can do that changes the game: search, play a card, and the two ways a
// forced meeting resolves — trade or attack. Pure logic; the interface calls these and shows
// whatever they return. Implements docs/GAME_RULES.md (the owner's design — see CLAUDE.md).
import { rules } from '../data/rules.js';
import { CARDS, takeCard, isWeapon, countableCount, shuffle } from './cards.js';
import {
  checkWin, logPublic, convertToPossessed, isLocked, unlockRoom, placeBarricade, isBarricaded,
  adjacentLockedRooms,
} from './state.js';
import { openFrontierDoor } from './hotel.js';

// --- Doors -------------------------------------------------------------------------------------
// Open a closed door of your room (1 AP): the room behind it is drawn from the room deck, turned to
// fit and revealed. You stay where you are — going in is a normal move. A new room is empty, so
// opening a door never starts a meeting. A door that no remaining tile can fit is jammed: nothing
// is revealed and no action point is spent.
export function openDoor(state, floor, player, doorId) {
  if (state.finished) return { ok: false, reason: 'finished' };
  if (!player.alive) return { ok: false, reason: 'dead' };
  const door = floor.frontier.find(d => d.id === doorId);
  if (!door || door.room !== player.currentRoom) return { ok: false, reason: 'notYourDoor' };
  if (door.jammed) return { ok: false, reason: 'jammed' };
  if (player.actionPoints < rules.actionCost.open) return { ok: false, reason: 'ap' };
  const res = openFrontierDoor(floor, doorId, { isLocked: id => isLocked(state, id) });
  if (!res.ok) {
    logPublic(state, `${player.name} tried a door in ${floor.rooms.get(player.currentRoom)?.name}: it is jammed shut.`);
    return res;
  }
  player.actionPoints -= rules.actionCost.open;
  state.discovered.add(res.room.id);
  if (res.room.locked && rules.lockedDoorsEnabled) state.lockedRooms.add(res.room.id);
  logPublic(state, `${player.name} opened a door: ${res.room.name}.`);
  return { ok: true, room: res.room, doorway: res.doorway, connected: res.connected, locked: isLocked(state, res.room.id) };
}

// --- Deck ------------------------------------------------------------------------------------
// Draw one card; when the deck runs out the discard pile is shuffled into a new deck.
export function drawCard(state) {
  if (!state.drawPile.length && state.discardPile.length) {
    state.drawPile = shuffle(state.discardPile.splice(0), state.rng);
  }
  return state.drawPile.shift() || null;
}

// Put a played or discarded card on the discard pile. Possession cards never go there — they are
// not deck cards; a discarded Possession card leaves the game.
export function toDiscard(state, card) {
  if (!card || card.type === 'possession') return;
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

// Search the current room (1 AP). If dropped cards are lying there you take them all (always
// possible). Otherwise you draw one card, once per room — a Linen Store's draw gives
// `linenStoreDraws` (2) cards. Results are PRIVATE to the searcher: the public log records only
// that a search happened. A drawn card that does not fit is reported with `full` so the caller can
// ask what to do with it; the room counts as searched either way.
//
// Result: `kind: 'card'` with `card` (one draw), or `kind: 'cards'` with `cards` (a Linen Store);
// `overflow` lists the drawn cards that did not fit (each goes to the take-or-leave prompt, like a
// single card that does not fit), and `full` says whether there are any.
export function search(state, floor, player) {
  const gate = canSearch(state, floor, player);
  if (!gate.ok) return gate;
  const room = floor.rooms.get(player.currentRoom);
  player.actionPoints -= rules.actionCost.search;
  const base = { ok: true, room: room.id, searchPoint: room.searchPoint || null };

  logPublic(state, `${player.name} searched ${room.name}.`);
  const drops = state.roomDrops.get(room.id);
  if (drops?.length) {
    state.roomDrops.delete(room.id);
    player.hand.push(...drops);
    return {
      ...base, kind: 'found', cards: drops,
      full: countableCount(player.hand) > rules.handLimit,   // settled at the end of the turn
    };
  }

  state.searchedRooms.add(room.id);
  const draws = room.job === 'linenStore' ? rules.linenStoreDraws : 1;
  const drawn = [];
  for (let k = 0; k < draws; k++) { const c = drawCard(state); if (c) drawn.push(c); }
  if (!drawn.length) return { ...base, kind: 'nothing' };
  const overflow = [];
  for (const c of drawn) {
    if (countableCount(player.hand) >= rules.handLimit) overflow.push(c);
    else player.hand.push(c);
  }
  if (draws === 1) return { ...base, kind: 'card', card: drawn[0], full: overflow.length > 0, overflow };
  return { ...base, kind: 'cards', cards: drawn, card: drawn[0], full: overflow.length > 0, overflow };
}

// A drawn card the guest could not hold: 'take' it (dropping `dropId`) or 'leave' it.
export function resolveFullHand(state, player, card, choice, dropId = null) {
  if (choice === 'take') {
    if (!dropId) return { ok: false, reason: 'noChoice' };
    const dropped = takeCard(player.hand, dropId);
    if (!dropped) return { ok: false, reason: 'noCard' };
    if (dropped.type === 'possession') { player.hand.push(dropped); return { ok: false, reason: 'undroppable' }; }
    toDiscard(state, dropped);
    player.hand.push(card);
    return { ok: true, kept: card, dropped };
  }
  toDiscard(state, card);
  return { ok: true, left: card };
}

// Discard a card to obey the hand limit at the end of a turn. Free. Never a Possession card.
export function discardCard(state, player, cardId) {
  const card = player.hand.find(c => c.id === cardId);
  if (!card) return { ok: false, reason: 'noCard' };
  if (card.type === 'possession') return { ok: false, reason: 'undroppable' };
  takeCard(player.hand, cardId);
  toDiscard(state, card);
  return { ok: true, card };
}

// How many cards a guest must shed to obey the hand limit (Possession cards excluded).
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

// Espresso (free): gain `extraActions` (2) action points this turn. Used up. Action points are
// never carried over, so the extra ones are gone when the turn ends.
export function useEspresso(state, player, cardId) {
  if (state.finished) return { ok: false, reason: 'finished' };
  if (!player.alive) return { ok: false, reason: 'dead' };
  const card = player.hand.find(c => c.id === cardId && c.type === 'espresso');
  if (!card) return { ok: false, reason: 'noCard' };
  if (player.actionPoints < rules.actionCost.espresso) return { ok: false, reason: 'ap' };
  player.actionPoints += CARDS.espresso.extraActions - rules.actionCost.espresso;
  takeCard(player.hand, cardId); toDiscard(state, card);
  return { ok: true, actionPoints: player.actionPoints, gained: CARDS.espresso.extraActions };
}

// Hand Mirror (1 AP): choose a guest in your room; they show you their whole hand, in private —
// Possession cards included, so seeing one tells you they are possessed. Used up. The table sees
// that the mirror was used and on whom, never what it showed.
export function useHandMirror(state, floor, player, cardId, targetId) {
  const bad = needAp(state, player); if (bad) return bad;
  if (!player.alive) return { ok: false, reason: 'dead' };
  const card = player.hand.find(c => c.id === cardId && c.type === 'handMirror');
  if (!card) return { ok: false, reason: 'noCard' };
  const target = state.players.find(q => q.id === targetId);
  if (!target || target.id === player.id) return { ok: false, reason: 'noTarget' };
  if (!target.alive) return { ok: false, reason: 'targetDead' };
  if (target.currentRoom !== player.currentRoom) return { ok: false, reason: 'notTogether' };
  player.actionPoints -= rules.actionCost.useCard;
  takeCard(player.hand, cardId); toDiscard(state, card);
  const shown = target.hand.map(c => ({ ...c }));
  const unmasked = shown.some(c => c.type === 'possession');
  if (unmasked && !player.possessed) player.knows.add(target.id);
  // The target showed their hand, so they know it was seen: told on their own next private screen.
  target.notes.push(`${player.name} looked at your whole hand with a Hand Mirror.`);
  logPublic(state, `${player.name} used a Hand Mirror on ${target.name}.`);
  return { ok: true, target: target.id, hand: shown, unmasked };
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

// --- Rooms with jobs ---------------------------------------------------------------------------
// Whether `player` can use the job of the room they stand in right now, and why not.
export function canUseRoom(state, floor, player) {
  const room = floor.rooms.get(player.currentRoom);
  if (state.finished) return { ok: false, reason: 'finished' };
  if (!player.alive) return { ok: false, reason: 'dead' };
  if (room?.job === 'infirmary') {
    if (player.health >= rules.maxHealth) return { ok: false, reason: 'full', job: room.job };
    if (player.actionPoints < rules.actionCost.infirmary) return { ok: false, reason: 'ap', job: room.job };
    return { ok: true, job: room.job };
  }
  if (room?.job === 'switchboard') {
    if (state.switchboardCalls?.get(player.id) === state.turn) return { ok: false, reason: 'usedThisTurn', job: room.job };
    if (player.actionPoints < rules.actionCost.switchboard) return { ok: false, reason: 'ap', job: room.job };
    return { ok: true, job: room.job };
  }
  return { ok: false, reason: 'noJob', job: room?.job || null };
}

// Infirmary (1 AP): restore `infirmaryHeal` (2) health, never above the maximum.
export function useInfirmary(state, floor, player) {
  const gate = canUseRoom(state, floor, player);
  if (!gate.ok) return gate;
  if (gate.job !== 'infirmary') return { ok: false, reason: 'noJob', job: gate.job };
  const before = player.health;
  player.actionPoints -= rules.actionCost.infirmary;
  player.health = Math.min(rules.maxHealth, player.health + rules.infirmaryHeal);
  logPublic(state, `${player.name} was treated in the Infirmary.`);
  return { ok: true, health: player.health, healed: player.health - before };
}

// Switchboard (1 AP, once per player per turn): everyone learns how many guests are possessed right
// now — living guests only, since the dead are out of the game — but never who. The count is PUBLIC:
// it goes in the public log for the whole table.
export function useSwitchboard(state, floor, player) {
  const gate = canUseRoom(state, floor, player);
  if (!gate.ok) return gate;
  if (gate.job !== 'switchboard') return { ok: false, reason: 'noJob', job: gate.job };
  player.actionPoints -= rules.actionCost.switchboard;
  state.switchboardCalls.set(player.id, state.turn);
  const count = state.players.filter(q => q.alive && q.possessed).length;
  logPublic(state, `${player.name} rang the Switchboard: ${count} ${count === 1 ? 'guest is' : 'guests are'} possessed.`);
  return { ok: true, count };
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
//   An ordinary trade: a Lantern changes hands like any other card.
//   Receive a Possession card without giving a Lantern -> possessed; you keep the card.
//   Receive a Possession card while giving a Lantern  -> the attempt fails and the Lantern is used
//     up: the Lantern and the Possession card are both discarded, and you learn who tried.
//     (rules.lanternBlock 'attacker' is a comparison variant for the simulator only: the Lantern
//     goes to the possessed guest instead.)
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
    if (rc.type === 'lantern') {
      // Blocked. The Possession card leaves the game; the Lantern is used up (approved rule) —
      // or, in the simulator's comparison variant only, goes to the possessed guest.
      const toAttacker = rules.lanternBlock === 'attacker';
      if (toAttacker) G.hand.push(rc); else toDiscard(state, rc);
      events.received[G.id] = toAttacker ? 'lantern' : null;
      events.received[R.id] = null;
      events.lanternsBurned = toAttacker ? 0 : 1;
      R.knows.add(G.id);
      events.blocks.push({ blocker: R.id, revealed: G.id });
      note(R.id, toAttacker
        ? `Your Lantern burned away a Possession card. ${G.name} is POSSESSED — only you know.`
        : `Your Lantern burned away a Possession card and was used up. ${G.name} is POSSESSED — only you know.`);
      note(G.id, `${R.name} blocked you with a Lantern. They now know what you are.`);
    } else {
      G.hand.push(rc);                                // whatever R gave, G keeps
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
