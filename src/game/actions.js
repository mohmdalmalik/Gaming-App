// Player actions that change the game state: search, using a card, and the two ways a
// forced encounter resolves — trade and attack. Pure logic; the interface calls these and
// renders whatever they return. See docs/GAME_RULES.md §4, §7.
import { rules } from '../data/rules.js';
import { CARDS, takeCard, isWeapon } from './cards.js';
import { checkWin } from './state.js';

// Search the current room for a card (1 AP). Dark rooms need a Flashlight in hand.
export function search(state, floor, player) {
  const room = floor.rooms.get(player.currentRoom);
  if (state.finished) return { ok: false, reason: 'finished' };
  if (player.actionPoints < rules.actionCost.search) return { ok: false, reason: 'ap' };
  if (room?.dark && !player.hand.some(c => c.type === 'flashlight')) return { ok: false, reason: 'dark' };
  if (!state.drawPile.length) return { ok: false, reason: 'empty' };
  player.actionPoints -= rules.actionCost.search;
  const card = state.drawPile.shift();
  player.hand.push(card);
  return { ok: true, card };
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
