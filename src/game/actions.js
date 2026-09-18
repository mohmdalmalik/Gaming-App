// Player actions that change the game state: search, using a card, and the two ways a
// forced encounter resolves — trade and attack. Pure logic; the interface calls these and
// renders whatever they return. See docs/GAME_RULES.md §4, §7.
import { rules } from '../data/rules.js';
import { CARDS, takeCard, isWeapon, countableCount, countableCards } from './cards.js';
import {
  checkWin, isRoomOpen, exitUnlocked, objectivesRequired, objectivesAreCarried,
  clearOffer, escape, lockOffer, logPublic, convertToPossessed,
} from './state.js';

// What a room yields when searched, from its role in the floor data.
export const roomYield = room =>
  room?.role === 'objective' ? 'objective' : room?.role === 'utility' ? 'nothing' : 'card';

// Whether the current room can still be searched by `player` right now.
export function canSearch(state, floor, player) {
  const room = floor.rooms.get(player.currentRoom);
  if (state.finished) return { ok: false, reason: 'finished' };
  if (!room?.searchable) return { ok: false, reason: 'notSearchable' };
  if (state.searchedRooms.has(player.currentRoom)) return { ok: false, reason: 'searched' };
  if (player.actionPoints < rules.actionCost.search) return { ok: false, reason: 'ap' };
  // Dark rooms are ATMOSPHERE ONLY in v0.1: `darkRoomsRequireLight` is false, so a dark room is
  // entered and searched exactly like any other. There is no Flashlight card to gate it with.
  if (room.dark && rules.darkRoomsRequireLight && !player.hand.some(c => c.type === 'flashlight')) return { ok: false, reason: 'dark' };
  // Only rooms that actually hand out a card need cards left in the pile.
  if (roomYield(room) === 'card' && !state.drawPile.length) return { ok: false, reason: 'empty' };
  return { ok: true };
}

// Search the current room (1 AP). Only searchable rooms, once each. What comes out depends on
// the room's role: an item room gives one card, an objective room gives one objective (never a
// card as well), a utility room gives nothing but still says so.
//
// `full` is true when an item room produced a card the player has no room for — the caller must
// then ask them to take it (and discard something), use it, or leave it. The room counts as
// searched either way, so a full hand can never be used to farm the same room twice.
export function search(state, floor, player) {
  const gate = canSearch(state, floor, player);
  if (!gate.ok) return gate;
  const room = floor.rooms.get(player.currentRoom);
  const kind = roomYield(room);
  player.actionPoints -= rules.actionCost.search;
  lockOffer(player);
  state.searchedRooms.add(player.currentRoom);

  if (kind === 'objective') {
    // PERMANENT PUBLIC TEAM PROGRESS. The objective is recorded against the ROOM, never against
    // the player: it is not dealt into a hand, cannot be offered, cannot be taken and cannot be
    // dropped. `objectivesAreCarried()` is false and nothing here may change that.
    state.objectivesFound.add(player.currentRoom);
    return {
      ok: true, kind, room: room.id, searchPoint: room.searchPoint || null,
      found: state.objectivesFound.size,
      required: objectivesRequired(),
      exitJustUnlocked: exitUnlocked(state) && state.objectivesFound.size === objectivesRequired(),
    };
  }
  if (kind === 'nothing') return { ok: true, kind, room: room.id, searchPoint: room.searchPoint || null };

  const card = state.drawPile.shift();
  const full = countableCards(player.hand).length >= rules.handLimit;
  if (!full) player.hand.push(card);
  return { ok: true, kind, card, full, room: room.id, searchPoint: room.searchPoint || null };
}

// --- Meetings -------------------------------------------------------------------------------
// Resolve a meeting from the two PRE-COMMITTED offers. This function takes no input from the
// player who did not move: everything it needs was chosen by each player on their own turn. That
// is the whole point — nobody is ever prompted, or made to wait, while it is not their turn.
//
// A safe room (the lobby, and the exit end-zone) never produces a meeting at all.
export function resolveMeeting(state, floor, mover, other) {
  if (state.finished) return { ok: false, reason: 'finished' };
  if (floor.rooms.get(mover.currentRoom)?.safe) return { ok: false, reason: 'safeRoom' };
  if (mover.currentRoom !== other.currentRoom) return { ok: false, reason: 'notTogether' };
  if (state.escaped?.has(other.id) || state.escaped?.has(mover.id)) return { ok: false, reason: 'escaped' };
  if (state.hotseat) return hotseatMeeting(state, floor, mover, other);

  const result = { ok: true, mover: mover.id, other: other.id, offers: { [mover.id]: mover.offer, [other.id]: other.offer } };
  if (mover.offer && other.offer) {
    Object.assign(result, resolveTrade(state, floor, mover, other, mover.offer, other.offer));
  } else {
    result.swap = false;   // one side had nothing to give; the meeting still happened
  }
  // Offers never survive the meeting that consumed them.
  clearOffer(mover); clearOffer(other);
  return result;
}

// --- Hot-seat meeting resolution (the approved v1 rules) ---------------------------------------
// Order, and it matters:
//   1. A Distraction from EITHER side cancels the meeting. Nothing is traded, nobody is
//      possessed, and it reveals nothing about who is what.
//   2. A committed possession attempt:
//        target already possessed  -> an ordinary exchange (nothing is given away publicly)
//        target offered a Lantern  -> BLOCKED. The Lantern is spent, no card changes hands, and
//                                     the target alone learns who attacked them.
//        otherwise                 -> the target is possessed. No normal exchange.
//   3. Otherwise both Offers change hands at the same moment. An Offer of Nothing transfers
//      nothing; the meeting still happened.
// Both Offers are reset afterwards either way, and nothing here ever asks the off-turn player
// a question: everything it uses was committed by each player on their own turn.

// The card a player actually committed. If it has since left their hand the Offer is Nothing.
const offeredCard = player => (player.offer ? player.hand.find(c => c.id === player.offer) || null : null);

const addNote = (res, playerId, text) => { (res.notes[playerId] ||= []).push(text); };

function exchangeOffers(res, A, B, ca, cb) {
  if (ca) { takeCard(A.hand, ca.id); B.hand.push(ca); }
  if (cb) { takeCard(B.hand, cb.id); A.hand.push(cb); }
  res.outcome = ca || cb ? 'trade' : 'nothing';
  res.swap = !!(ca && cb);
  const bits = [];
  if (ca) bits.push(`${A.name} handed over a ${CARDS[ca.type].name}`);
  if (cb) bits.push(`${B.name} handed over a ${CARDS[cb.type].name}`);
  res.publicText = bits.length
    ? `${A.name} and ${B.name} met. ${bits.join('; ')}.`
    : `${A.name} and ${B.name} met. No cards changed hands.`;
  return res;
}

function finishMeeting(state, floor, mover, other, res) {
  clearOffer(mover); clearOffer(other);
  state.meetingThisTurn = true;
  logPublic(state, res.publicText);
  // Private consequences are queued on the player they belong to and shown on that player's own
  // screen — never on the public result card, which the whole table can see.
  for (const [pid, lines] of Object.entries(res.notes)) {
    const p = state.players.find(q => q.id === pid);
    if (p) { p.notes ||= []; p.notes.push(...lines); }
  }
  res.win = checkWin(state, floor);
  return res;
}

function hotseatMeeting(state, floor, mover, other) {
  const mc = offeredCard(mover), oc = offeredCard(other);
  const res = {
    ok: true, mover: mover.id, other: other.id, room: mover.currentRoom,
    offered: { [mover.id]: mc?.type ?? null, [other.id]: oc?.type ?? null },
    notes: {}, outcome: null, publicText: '',
  };

  // 1. Distraction — cancels the meeting outright, and gives nothing away.
  if (mc?.type === 'distraction' || oc?.type === 'distraction') {
    if (mc?.type === 'distraction') takeCard(mover.hand, mc.id);
    if (oc?.type === 'distraction') takeCard(other.hand, oc.id);
    res.outcome = 'cancelled';
    res.publicText = `${mover.name} and ${other.name} met — a Distraction broke it up before anything could happen.`;
    return finishMeeting(state, floor, mover, other, res);
  }

  // 2. A possession attempt (only the possessed side can have committed one).
  const attacker = mover.possessed && mover.intent === 'possess' ? mover
    : other.possessed && other.intent === 'possess' ? other : null;
  if (attacker) {
    const target = attacker === mover ? other : mover;
    const targetCard = attacker === mover ? oc : mc;
    if (target.possessed) {
      // Already one of them: it resolves as a perfectly ordinary trade.
      return finishMeeting(state, floor, mover, other, exchangeOffers(res, mover, other, mc, oc));
    }
    if (targetCard?.type === 'lantern') {
      takeCard(target.hand, targetCard.id);      // spent in defence, NOT handed to the attacker
      target.knows.add(attacker.id);
      res.outcome = 'blocked';
      res.publicText = `${mover.name} and ${other.name} met. A possession attempt was blocked by a Lantern.`;
      addNote(res, target.id, `You burned a Lantern to fight it off. ${attacker.name} is POSSESSED — only you know.`);
      addNote(res, attacker.id, `${target.name} blocked you with a Lantern and now knows what you are.`);
      return finishMeeting(state, floor, mover, other, res);
    }
    convertToPossessed(state, target, attacker.id);
    res.outcome = 'possessed';
    // Publicly identical to a meeting where neither side gave anything: that is the cover.
    res.publicText = `${mover.name} and ${other.name} met. No cards changed hands.`;
    addNote(res, target.id, 'Something came back with you from that room. You are now POSSESSED.');
    addNote(res, attacker.id, `${target.name} is now possessed.`);
    return finishMeeting(state, floor, mover, other, res);
  }

  // 3. An ordinary meeting.
  return finishMeeting(state, floor, mover, other, exchangeOffers(res, mover, other, mc, oc));
}

// Resolve a card the player could not hold when they found it.
//   'take'  — keep it and discard `dropId` from the hand to stay within the limit
//   'leave' — put it back at the bottom of the draw pile; the room stays searched
export function resolveFullHand(state, player, card, choice, dropId = null) {
  if (choice === 'take') {
    if (!dropId) return { ok: false, reason: 'noChoice' };
    const dropped = takeCard(player.hand, dropId);
    if (!dropped) return { ok: false, reason: 'noCard' };
    player.hand.push(card);
    return { ok: true, kept: card, dropped };
  }
  state.drawPile.push(card);
  return { ok: true, left: card };
}

// Play a Hint (1 AP): reveals ONE undiscovered room next door to where the player is standing.
// It never moves the player and never reaches past the adjacent rooms. The sealed exit is not
// a valid target — it stays hidden until every objective is found.
export function useHint(state, floor, player, cardId) {
  if (state.finished) return { ok: false, reason: 'finished' };
  if (player.actionPoints < rules.actionCost.useCard) return { ok: false, reason: 'ap' };
  const card = player.hand.find(c => c.id === cardId && c.type === 'hint');
  if (!card) return { ok: false, reason: 'noCard' };
  const room = floor.rooms.get(player.currentRoom);
  const candidates = (room?.doorways || [])
    .map(d => d.otherRoom(player.currentRoom))
    .filter(id => !state.discovered.has(id) && isRoomOpen(state, floor, id));
  if (!candidates.length) return { ok: false, reason: 'nothingAdjacent' };
  const revealed = candidates[0];
  player.actionPoints -= rules.actionCost.useCard;
  lockOffer(player);
  state.discovered.add(revealed);
  takeCard(player.hand, cardId);
  return { ok: true, revealed, name: floor.rooms.get(revealed)?.name };
}

// Discard a card from a player's hand (used to obey the hand limit at end of turn). Free.
export function discardCard(state, player, cardId) {
  const card = takeCard(player.hand, cardId);
  return card ? { ok: true, card } : { ok: false, reason: 'noCard' };
}

// How many cards a player must shed to obey the hand limit (0 if within it). Possession cards
// don't count, so a possessed player is never forced to discard because of them.
export function overHandLimit(player) {
  return Math.max(0, countableCount(player.hand) - rules.handLimit);
}

// Play a Bandage (1 AP) to restore a health bar.
export function useBandage(state, player, cardId) {
  if (state.finished) return { ok: false, reason: 'finished' };
  if (player.actionPoints < rules.actionCost.useCard) return { ok: false, reason: 'ap' };
  const card = player.hand.find(c => c.id === cardId && c.type === 'bandage');
  if (!card) return { ok: false, reason: 'noCard' };
  if (player.health >= rules.maxHealth) return { ok: false, reason: 'full' };
  player.actionPoints -= rules.actionCost.useCard;
  player.health = Math.min(rules.maxHealth, player.health + (CARDS.bandage.heal || 1));
  takeCard(player.hand, cardId);
  return { ok: true, health: player.health };
}

// Which cards a player is allowed to offer in a trade: a clean player may never give a
// Possession card; the possessed side may give anything.
export function tradeableCards(player) {
  return player.hand.filter(c => player.possessed || c.type !== 'possession');
}

// Resolve a trade: P (the player who entered) offers cardIdP, Q offers cardIdQ, simultaneously.
// Applies the Lantern-blocks-Possession rule and possession spread, and returns what happened.
export function resolveTrade(state, floor, P, Q, cardIdP, cardIdQ) {
  const cP = P.hand.find(c => c.id === cardIdP);
  const cQ = Q.hand.find(c => c.id === cardIdQ);
  if (!cP || !cQ) return { ok: false, reason: 'noCard' };
  // Only the possessed side may pass a Possession card.
  if (cP.type === 'possession' && !P.possessed) return { ok: false, reason: 'illegal' };
  if (cQ.type === 'possession' && !Q.possessed) return { ok: false, reason: 'illegal' };

  takeCard(P.hand, cardIdP);
  takeCard(Q.hand, cardIdQ);
  const events = { ok: true, given: { [P.id]: cP.type, [Q.id]: cQ.type }, blocks: [], possessed: [] };

  // Resolve one direction of possession (giver G passes Possession `pc`; receiver R offered `rc`).
  const passPossession = (G, R, pc, rc) => {
    if (rc.type === 'lantern') {
      // Defended: the Lantern goes to the possessed giver, the Possession card returns to
      // them, and the defender now knows the giver is possessed. Possession fails.
      G.hand.push(rc);   // lantern changes hands to the giver
      G.hand.push(pc);   // possession card stays on the possessed side
      R.knows.add(G.id);
      events.blocks.push({ blocker: R.id, revealed: G.id });
    } else {
      // Possession succeeds: cards swap and the receiver joins the possessed side.
      R.hand.push(pc);
      G.hand.push(rc);
      if (!R.possessed) { R.possessed = true; events.possessed.push({ newly: R.id, by: G.id }); }
    }
  };

  if (cP.type === 'possession' && cQ.type !== 'possession') {
    passPossession(P, Q, cP, cQ);
  } else if (cQ.type === 'possession' && cP.type !== 'possession') {
    passPossession(Q, P, cQ, cP);
  } else {
    // No possession attempt (or both sides possessed): a plain swap.
    P.hand.push(cQ);
    Q.hand.push(cP);
    events.swap = true;
  }

  events.win = checkWin(state, floor);
  return events;
}

// Resolve an attack: `attacker` hits `target` with a weapon (1 AP). Knife is reusable;
// the Revolver spends a shot and is discarded when empty.
export function resolveAttack(state, floor, attacker, target, weaponId) {
  if (state.finished) return { ok: false, reason: 'finished' };
  // The hot-seat rules have no health, no weapons and no Challenge. The legacy combat code below
  // stays working and tested, but this mode can never reach it.
  if (state.hotseat) return { ok: false, reason: 'combatDisabled' };
  // Safe rooms include the lobby AND the exit end-zone, so a challenge can never be made at the
  // moment someone escapes. Objectives are not held by players, so nothing here can take one.
  if (floor.rooms.get(attacker.currentRoom)?.safe) return { ok: false, reason: 'safe' };
  if (state.escaped?.has(target.id)) return { ok: false, reason: 'escaped' };
  if (attacker.actionPoints < rules.actionCost.attack) return { ok: false, reason: 'ap' };
  const weapon = attacker.hand.find(c => c.id === weaponId && isWeapon(c));
  if (!weapon) return { ok: false, reason: 'noWeapon' };
  if (!target.alive) return { ok: false, reason: 'targetDead' };
  attacker.actionPoints -= rules.actionCost.attack;
  const damage = CARDS[weapon.type].damage;
  target.health = Math.max(0, target.health - damage);
  const events = { ok: true, attacker: attacker.id, target: target.id, weapon: weapon.type, damage, discarded: false, killed: false };
  if (weapon.type === 'revolver') {
    weapon.shots = (weapon.shots ?? CARDS.revolver.shots) - 1;
    if (weapon.shots <= 0) { takeCard(attacker.hand, weapon.id); events.discarded = true; }
  }
  if (target.health === 0) { target.alive = false; events.killed = true; }
  events.win = checkWin(state, floor);
  return events;
}
