// PLAYING BOT TURNS STRAIGHT THROUGH THE RULES ENGINE (no screen, no waiting). Pure (no DOM, no THREE, no
// Node APIs): the Node tools use it for whole bot matches, and the interface uses playOut to finish a
// match at once when the person at the iPad is out of it.
//
// It carries out each action with the same meaning the interface gives it: a move walks the
// fewest-rooms route (roomRoute) room by room, stopping in the first room where a meeting is forced
// (encountersIn); arriving in a room with guests not yet met there this round forces a meeting: the
// walker picks one (meetWhom), the pair is locked for this room and round (lockEncounter), then it is an
// attack (attackWith -> resolveAttack) or a trade (canTrade ? resolveTrade with both sides' secret
// choices : skipTrade). At the end of the turn the hand limit is settled (discard), then endTurn.
// Every step goes through the engine, which refuses anything illegal; a refusal goes back to the bot
// (table.reject), and three refusals end the turn, as in the interface.
import { rules } from '../data/rules.js';
import {
  activePlayer, endTurn, enterRoom, encountersIn, pendingEncounters, lockEncounter, canAffordRoute,
  checkWin, canTradeVoluntarily,
} from '../game/state.js';
import { roomRoute } from '../game/moves.js';
import * as A from '../game/actions.js';
import { weaponsIn } from '../game/cards.js';

// A meeting forced on `p`, who has just walked into its room.
export function runMeeting(state, floor, table, p, out = null) {
  const cands = pendingEncounters(state, floor, p);
  if (!cands.length) return null;
  let j = cands.length === 1 ? cands[0].index : table.meetWhom(p.index, cands.map(q => q.index));
  const Q = cands.find(q => q.index === j) || cands[0];
  lockEncounter(state, p.currentRoom, p.index, Q.index);
  const res = { with: Q.index, kind: 'trade' };
  if (weaponsIn(p.hand).length && p.actionPoints >= rules.actionCost.attack) {
    const w = table.attackWith(p.index, Q.index);
    if (w) {
      const r = A.resolveAttack(state, floor, p, Q, w);
      if (r.ok) { res.kind = 'attack'; res.result = r; out?.push(res); return res; }
    }
  }
  res.result = runTrade(state, floor, table, p, Q);
  if (res.result?.skipped) res.kind = 'noTrade';
  out?.push(res);
  return res;
}

// A trade between P and Q: both choose in secret, the cards swap at once.
export function runTrade(state, floor, table, P, Q) {
  if (!A.canTrade(P, Q).ok) return A.skipTrade(state, floor, P, Q);
  const choose = (X, Y) => {
    const allowed = A.tradeableCards(X).map(c => c.id);
    if (!table.has(X.index)) table.addSeat(X.index);
    const id = table.tradeCard(X.index, Y.index, allowed);
    return allowed.includes(id) ? id : allowed[0];
  };
  const cp = choose(P, Q);
  const cq = choose(Q, P);
  return A.resolveTrade(state, floor, P, Q, cp, cq);
}

// Carry out one action for the active guest `p`. Returns { ok, reason?, ... }.
export function runAction(state, floor, table, p, a, meetings = null) {
  switch (a?.k) {
    case 'move': {
      let route = roomRoute(state, floor, p, a.to);
      if (!Array.isArray(route)) return { ok: false, reason: route.blocked };
      if (route.length < 2) return { ok: false, reason: 'here' };
      for (let i = 1; i < route.length - 1; i++) {
        if (encountersIn(state, floor, p, route[i]).length) { route = route.slice(0, i + 1); break; }
      }
      const can = canAffordRoute(state, floor, p, route);
      if (!can.ok) return { ok: false, reason: can.reason };
      for (let i = 1; i < route.length; i++) enterRoom(state, floor, p, route[i]);
      const meeting = runMeeting(state, floor, table, p, meetings);
      return { ok: true, rooms: route, meeting };
    }
    case 'open': return A.openDoor(state, floor, p, a.door);
    case 'search': return A.search(state, floor, p);
    case 'escape': return A.escape(state, floor, p);
    case 'job': {
      const g = A.canUseRoom(state, floor, p);
      if (!g.ok) return g;
      return g.job === 'infirmary' ? A.useInfirmary(state, floor, p) : A.useSwitchboard(state, floor, p);
    }
    case 'card': {
      switch (a.type) {
        case 'bandage': return A.useBandage(state, p, a.card);
        case 'espresso': return A.useEspresso(state, p, a.card);
        case 'handMirror': return A.useHandMirror(state, floor, p, a.card, a.target);
        case 'barricade': return A.useBarricade(state, floor, p, a.card, a.target);
        case 'masterKey': case 'lockPick': return A.useUnlock(state, floor, p, a.card, a.target);
        default: return { ok: false, reason: 'unknownCard' };
      }
    }
    case 'trade': {
      if (!canTradeVoluntarily(state, floor, p)) return { ok: false, reason: 'noTradeHere' };
      const Q = state.players[a.with];
      if (!Q || !Q.alive || Q === p || Q.currentRoom !== p.currentRoom) return { ok: false, reason: 'noPartner' };
      if (!table.has(Q.index)) table.addSeat(Q.index);
      const yes = table.acceptTrade(Q.index, p.index);
      if (!yes) return { ok: true, declined: true };
      const r = runTrade(state, floor, table, p, Q);
      meetings?.push({ with: Q.index, kind: r?.skipped ? 'noTrade' : 'trade', voluntary: true, result: r });
      return { ok: true, result: r };
    }
    default: return { ok: false, reason: 'unknownAction' };
  }
}

// Play the ACTIVE guest's whole turn. Returns a summary.
export function playBotTurn(state, floor, table, { maxSteps = 40 } = {}) {
  const p = activePlayer(state);
  const summary = { seat: p.index, round: state.round, actions: [], refusals: [], meetings: [], discards: 0, ended: false };
  if (state.finished) return summary;
  if (!table.has(p.index)) table.addSeat(p.index);
  let refusals = 0;
  for (let step = 0; step < maxSteps && !state.finished && p.alive && activePlayer(state) === p; step++) {
    const a = table.nextAction(p.index);
    if (!a || a.k === 'end') break;
    const r = runAction(state, floor, table, p, a, summary.meetings);
    summary.actions.push(a);
    if (!r?.ok) {
      summary.refusals.push({ action: a, reason: r?.reason ?? null });
      table.reject(p.index, a, r?.reason ?? null);
      if (++refusals >= 3) break;
    }
  }
  if (state.finished) return summary;
  for (let guard = 0; guard < 30 && A.overHandLimit(p) > 0; guard++) {
    const ids = p.hand.filter(c => c.type !== 'possession').map(c => c.id);
    const id = table.discard(p.index, ids);
    if (!A.discardCard(state, p, id).ok) A.discardCard(state, p, ids[0]);
    summary.discards++;
  }
  const res = endTurn(state, floor);
  summary.ended = !!res.ok;
  if (!state.finished) checkWin(state, floor);
  return summary;
}

// Play bot turns until the match ends. Every seat that still plays must be a bot seat; one that is not
// gets a medium-style bot added (table.addSeat), so handing a match over can never stall.
export function playOut(state, floor, table, { maxTurns = 500, onTurn = null } = {}) {
  let turns = 0;
  while (!state.finished && turns < maxTurns) {
    const s = playBotTurn(state, floor, table);
    turns++;
    onTurn?.(s);
  }
  return { finished: !!state.finished, won: state.won, dawn: !!state.dawn, turns, round: state.round };
}
