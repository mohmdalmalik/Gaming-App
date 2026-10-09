// THE COMPUTER GUESTS AT A TABLE: one mind per bot seat (src/bots/brain.js), fed only what that guest
// may know (src/bots/view.js). Pure (no DOM, no THREE, no Node APIs): the interface (src/main.js) and the
// Node tools (tools/balance/bot-match.mjs, tests/bots-check.mjs) use it the same way.
//
//   const table = createBotTable(state, floor, [{ index, profile }, ...], seed);
//   table.nextAction(i)                 ONE action for the active bot (call again after it has played out)
//   table.reject(i, action, reason)     the rules refused that action: the bot will not try it again this turn
//   table.meetWhom(i, seats)            it walked into a room with several guests: whom it meets
//   table.attackWith(i, seat)           weapon card id, or null to trade
//   table.tradeCard(i, seat, cardIds)   the card it gives in a trade (either side of a trade)
//   table.acceptTrade(i, seat)          a voluntary trade in the Fire Exit proposed to it
//   table.discard(i, cardIds)           a card to drop at the hand limit (end of its turn)
//   table.thinkMs(i, kind)              how long it "thinks" first (kinds: turn act move meet attack trade reply discard)
//   table.has(i) / table.profile(i) / table.addSeat(i, profile) / table.seats()
//
// Every method first lets the bot read whatever public events (state.events) and own private events
// (its player.inbox) are new since it last looked, so the caller never feeds it anything.
//
// Actions returned by nextAction:
//   { k:'move', to: roomId }   { k:'open', door }   { k:'search' }   { k:'job' }   { k:'escape' }
//   { k:'card', type, card, target? }   (handMirror: target is a player id; masterKey / lockPick: a room
//                                        id; barricade: a doorway id of its room)
//   { k:'trade', with: seatIndex }      (a voluntary trade in the Fire Exit)
//   { k:'end' }
import { botView } from './view.js';
import { createMind } from './brain.js';
import { rollProfile } from './profiles.js';
import { makeRng } from '../game/cards.js';

const mix = (seed, index) => (Math.imul((seed >>> 0) ^ 0x51ed27, 2654435761) ^ Math.imul(index + 1, 0x9e3779b1)) >>> 0;

export function createBotTable(state, floor, seats = [], seed = 1) {
  const minds = new Map();
  const extraRng = makeRng(mix(seed, 99) || 1);   // only for profiles of seats added later without one

  const addSeat = (index, profile = null) => {
    const p = profile || rollProfile(extraRng, { style: 'medium' });
    minds.set(index, createMind(index, p, mix(seed, index)));
    return p;
  };
  for (const s of seats) addSeat(s.index, s.profile);

  // Let the bot catch up on what it may know, and give it the view to decide with.
  const look = index => {
    const mind = minds.get(index);
    if (!mind) return null;
    const view = botView(state, floor, index, mind.cursor);
    mind.observe(view);
    return { mind, view };
  };
  // The brain names a Hand Mirror target by seat; the rules want a player id.
  const toRules = a => (a?.k === 'card' && a.type === 'handMirror' && Number.isInteger(a.target)
    ? { ...a, target: state.players[a.target]?.id ?? a.target } : a);
  const toBrain = a => {
    if (a?.k === 'card' && a.type === 'handMirror' && !Number.isInteger(a.target)) {
      const p = state.players.find(q => q.id === a.target);
      return { ...a, target: p ? p.index : a.target };
    }
    return a;
  };

  return {
    has: index => minds.has(index),
    profile: index => minds.get(index)?.profile ?? null,
    seats: () => [...minds.keys()].sort((a, b) => a - b),
    addSeat,
    removeSeat: index => minds.delete(index),

    nextAction(index) {
      const l = look(index);
      if (!l) return { k: 'end' };
      return toRules(l.mind.nextAction(l.view));
    },
    reject(index, action, reason = null) {
      const l = look(index);
      if (l) l.mind.reject(l.view, toBrain(action), reason);
    },
    meetWhom(index, candidates) {
      const l = look(index);
      if (!l || !candidates?.length) return candidates?.[0];
      const s = l.mind.meetWhom(l.view, candidates);
      return candidates.includes(s) ? s : candidates[0];
    },
    attackWith(index, target) {
      const l = look(index);
      if (!l) return null;
      const id = l.mind.attackWith(l.view, target);
      return id && state.players[index].hand.some(c => c.id === id) ? id : null;
    },
    tradeCard(index, other, allowed) {
      const l = look(index);
      if (!l || !allowed?.length) return allowed?.[0];
      const id = l.mind.tradeCard(l.view, other, allowed);
      return allowed.includes(id) ? id : allowed[0];
    },
    acceptTrade(index, proposer) {
      const l = look(index);
      return l ? !!l.mind.acceptTrade(l.view, proposer) : false;
    },
    discard(index, cardIds) {
      const l = look(index);
      if (!l || !cardIds?.length) return cardIds?.[0];
      const id = l.mind.discard(l.view, cardIds);
      return cardIds.includes(id) ? id : cardIds[0];
    },
    thinkMs(index, kind = 'act') {
      const mind = minds.get(index);
      return mind ? mind.thinkMs(kind) : 0;
    },
    // Tools and tests only: the bot's own record of what it chose (never read by the game).
    decisions: index => minds.get(index)?.decisions ?? [],
    mind: index => minds.get(index) ?? null,
  };
}
