// Player PERSONALITIES for balance testing (dev tool, not part of the game).
//
// One set of decision rules, used by BOTH the fast rules simulator (tools/balance/hotseat-sim.mjs
// --personalities / --study) and the real-UI hot-seat bot harness (tests/autoplay.mjs --personalities),
// so a personality behaves the same whether it plays the pure rules engine or taps through the game.
// Nothing here changes a rule: every choice is one the game offers, and the caller carries it out
// through the real rules code (the engine or the interface), which refuses anything illegal.
//
// ---------------------------------------------------------------------------------------------
// THE SIX PERSONALITIES — decision rules
//
// Shared by all (clean guests):
//   • Escape first: a clean guest holding 3 Lanterns heads for the Fire Exit (or, while it is still
//     hidden, opens doors to find it) and escapes the moment it can.
//   • Heal when badly hurt: 2 or more health bars down (at 1 of 3 health; at 2 of 4 or less), the
//     Infirmary if standing in one, else a Bandage. (Thresholds count bars LOST and read the maximum
//     from rules.maxHealth, so a 4-health variant scales them; at 3 health they are exactly the
//     original "at 1 health" / safe "at 2 or less". See HURT below.)
//   • A guest it KNOWS is possessed (it blocked them with a Lantern, or saw a Possession card in a Hand
//     Mirror) is attacked if it is armed, and otherwise handed a Lantern in a trade (the block).
//   • A search that does not fit the hand keeps the more valuable card; the hand-limit discard drops
//     the least valuable card (each personality values cards a little differently, see VALUE_TWEAKS).
//
//   rusher      Heads for the Fire Exit as fast as possible. While the exit is hidden it opens a closed
//               door of the room it stands in, else walks to the nearest room with a closed door,
//               preferring rooms further from the lobby ("toward unexplored space"). It searches only
//               the room it is standing in and only while it has fewer than 3 Lanterns (a Lantern "on the
//               way"); once the exit is known it walks to the nearest unsearched rooms, preferring ones
//               near the exit. Drinks Espresso whenever it runs out of actions. Never gives a Lantern
//               away (except to block a known possessed guest). Attacks only known possessed guests.
//   slow        Careful and thorough. Uses at most 2 actions a turn, then ends the turn. Searches every
//               room it enters, uses keys on locked rooms next door, explores the rooms closest to the
//               lobby first, uses a Hand Mirror on an unknown guest it shares a room with. Never drinks
//               Espresso. In a trade gives a Lantern only when it holds 2 or more (a block that still
//               leaves it one). Attacks only known possessed guests.
//   safe        Defensive. Plans its routes around rooms with other guests in them (and would rather wait
//               than walk into one, unless it is escaping). Heals whenever hurt (1 bar down: at 2 of 3
//               health or less; at 3 of 4 or less). Keeps Lanterns as its shield: in a trade with
//               anyone it is not sure of, it gives a Lantern if it has one (a
//               Lantern blocks a Possession card). With its last action, it Barricades a doorway that
//               leads to a room with another guest in it. Uses a Hand Mirror on an unknown guest in its
//               room. Drinks Espresso only to escape. Never attacks unless it knows the target is
//               possessed.
//   aggressive  Seeks meetings: walks to a guest it can reach this turn (known or suspected possessed
//               first) before searching or exploring. When armed it attacks anyone it suspects (known
//               possessed, or seen attacking someone) and anyone else half the time; otherwise it trades.
//               Keeps its Lanterns (gives the least useful card) and pushes for the exit when it has 3.
//               Drinks Espresso when out of actions.
//   killer      Hunts other guests and attacks anyone, possessed or not, whenever it is armed and has an
//               action. Unarmed, it searches for weapons (rooms with a dead guest's things first) and
//               values weapons above everything but Lanterns. With a weapon it walks to the nearest guest
//               it can meet, however far. Still escapes if it ever holds 3 Lanterns.
//   team        Cooperative. The table agrees on a CARRIER: the living guest, not known or suspected
//               possessed, who says they hold the most Lanterns (ties: the lower seat). A team player with
//               Lanterns walks to the carrier to hand them over in a trade (stepping out and back in if
//               they share a room); the carrier keeps its Lanterns. When it has nothing better to do it
//               escorts the carrier (walks to their room). Uses a Hand Mirror on unknown guests. Team
//               players pool what they know about who is possessed. Attacks only known possessed guests,
//               and never the carrier.
//
// When the personality's guest is POSSESSED it keeps its style and also pursues possession:
//   • In a trade with a clean guest it gives a Possession card when it has one — except to a guest who
//     already knows it (they would block), and the SAFE one only tries on guests who say they hold no
//     Lantern (a Lantern would block it and unmask it). Otherwise it gives its least useful card and
//     keeps its Lanterns away from the clean side.
//   • It never attacks a fellow possessed guest. rusher / slow / safe / team never attack (they keep
//     looking innocent) except, for the rusher and team player, once out of Possession cards against a
//     guest holding 2+ Lanterns; aggressive attacks clean guests who hold a Lantern (they would block a
//     Possession card) or when it has no Possession card left; killer attacks every clean guest.
//   • Movement: rusher explores outward and meets a clean guest one step away; slow stays near the lobby
//     and meets only a clean guest next door; safe approaches only Lantern-less clean guests within two
//     steps; aggressive hunts clean guests it can reach this turn; killer hunts clean guests anywhere;
//     team goes to the clean guests (the carrier first).
//
// WHAT A PERSONALITY MAY KNOW (honesty rules):
//   • A clean guest sees what the table sees — rooms, who is where, health, public card counts, the
//     public log (who attacked whom) — plus its own hand and what it learned privately (`knows`).
//   • TABLE TALK: everyone says how many Lanterns they hold; bots take the claim at face value (a
//     possessed bot also states its true count). Team players share what they know about who is
//     possessed with each other (only clean team players speak).
//   • A possessed guest knows who else is possessed (converts are told who possessed them and the
//     possessor is told whom it converted — the simulator keeps that simple: all possessed know each
//     other) and who has worked it out (a blocker is announced to the one blocked).
//
// INTERFACE (all pure; `full` is the true state in the common shape below; the module masks what a
// guest may not know):
//   decideAction(full, i, mem, rng)            -> ordered list of actions to try (first legal one wins)
//     actions: {k:'escape'} {k:'search'} {k:'open', door} {k:'move', to, door} {k:'job'}
//              {k:'card', type, card, target?} {k:'end'}   (target: roomId for keys, doorwayId for a
//              Barricade, playerId for a Hand Mirror)
//   decideMeetWhom(full, i, candidates, mem, rng) -> player index to meet (several guests in the room)
//   decideAttack(full, i, j, mem, rng)         -> weapon card id, or null to trade
//   decideTradeCard(full, i, j, cardIds, mem, rng) -> card id to give
//   decideDiscard(full, i, cardIds)            -> card id to drop at the hand limit
//   newMemory(), observe(mem, event)           -> public events: {type:'attack', by, target, killed}
//
// `full` = { round, turn, exitRoom, lobby, lanternsToEscape, maxHealth?, bots?, locks: ['room:a-b'...],
//            players: [{ i, id, name, persona, room, ap, health, alive, escaped, possessed,
//                        hand: [{id, type, shots}], knows: [ids] }],
//            rooms: [{ id, name, isExit, safe, dark, searchable, searched, locked, job, drops,
//                      doors: [{id, to, barricaded}], frontier: [{id, jammed}] }] }
//   bots (simulator-only options, absent = the usual bots): { heal: 'fixed' } heals at the original fixed health
//   numbers (see HEAL_AT_FIXED); { noLanternLeak: true } (see decideAction).

import { rules } from '../../src/data/rules.js';

export const PERSONALITIES = ['rusher', 'slow', 'safe', 'aggressive', 'killer', 'team'];
export const LABELS = { rusher: 'Rusher', slow: 'Slow', safe: 'Safe', aggressive: 'Aggressive', killer: 'Killer', team: 'Team player' };

const LANTERNS_TO_ESCAPE = 3;
const AP_PER_TURN = 4;
const BASE_VALUE = { barricade: 1, handMirror: 2, lockPick: 2, espresso: 3, bandage: 4, masterKey: 4, knife: 5, flashlight: 6, revolver: 7, lantern: 10, possession: 0 };
const VALUE_TWEAKS = {
  rusher: { espresso: 8, flashlight: 7, knife: 2, revolver: 3 },
  slow: { flashlight: 8, masterKey: 6, lockPick: 5 },
  safe: { bandage: 7, barricade: 5, handMirror: 5 },
  aggressive: { knife: 8, revolver: 9 },
  killer: { knife: 9, revolver: 9.5 },
  team: {},
};
const DAMAGE = { knife: 1, revolver: 2 };
// Healing thresholds, as health bars LOST (never a fixed health number), so they follow rules.maxHealth:
//   badly   2 bars down — everyone but the safe one. maxHealth 3: heal at 1 (as always); 4: heal at 2 or less
//           (also exactly "one Revolver shot from death", and the Infirmary's 2 bars are never wasted).
//   any     1 bar down  — the safe one.            maxHealth 3: heal at 2 or less (as always); 4: at 3 or less.
const HURT = { badly: 2, any: 1 };
// Sensitivity option (simulator only, full.bots.heal === 'fixed'): heal at the original FIXED health numbers
// instead, whatever the maximum — at 1, the safe one at 2 or less. Identical to HURT at maxHealth 3; at 4 the
// bots heal later and less often, which shows how much of a health variant's effect is the bots' healing habit.
const HEAL_AT_FIXED = { badly: 1, any: 2 };
const value = (persona, type) => (VALUE_TWEAKS[persona]?.[type] ?? BASE_VALUE[type] ?? 1);

export function newMemory() { return { attacks: new Map() }; }
// Public events every bot hears (the public log says "X attacked Y").
export function observe(mem, ev) {
  if (ev.type === 'attack') mem.attacks.set(ev.by, (mem.attacks.get(ev.by) || 0) + 1);
}

// --- what a guest knows -------------------------------------------------------------------------
function ctx(full, i, mem, rng) {
  const me = full.players[i];
  const rooms = new Map(full.rooms.map(r => [r.id, r]));
  const here = rooms.get(me.room);
  const persona = me.persona;
  const lan = hand => hand.filter(c => c.type === 'lantern').length;
  const claimed = q => lan(q.hand);                         // table talk: "I hold N Lanterns"
  const has = type => me.hand.find(c => c.type === type) || null;
  const weapons = me.hand.filter(c => c.type === 'knife' || c.type === 'revolver');
  const locks = new Set(full.locks || []);
  const met = (roomId, a, b) => locks.has(`${roomId}:${Math.min(a, b)}-${Math.max(a, b)}`);
  const live = q => q.alive && !q.escaped;
  // Who I KNOW is possessed. Clean team players pool what they know.
  const known = new Set(me.knows || []);
  if (!me.possessed && persona === 'team') {
    for (const q of full.players) if (q.persona === 'team' && !q.possessed && q.alive) for (const k of q.knows || []) known.add(k);
  }
  const attacked = q => (mem.attacks.get(q.id) || 0) > 0;
  const suspect = q => known.has(q.id) || attacked(q);
  // For a possessed guest: who is clean (it knows). For a clean guest this is never used as truth.
  const isAlly = q => me.possessed && q.possessed;
  const cleanTarget = q => me.possessed && !q.possessed;
  const others = full.players.filter(q => q.i !== i && live(q));
  const othersIn = roomId => others.filter(q => q.room === roomId);
  const meetable = (roomId, filter = () => true) => {
    const r = rooms.get(roomId);
    if (!r || r.safe) return [];
    return othersIn(roomId).filter(q => !met(roomId, i, q.i) && filter(q));
  };
  // Breadth-first search over open, passable doorways (never into a locked room). `avoid(roomId)`
  // rooms are not entered, except as the goal itself when `goalOk` allows it.
  const bfs = (from, avoid = null) => {
    const dist = new Map([[from, { d: 0, first: null }]]);
    const q = [from];
    while (q.length) {
      const id = q.shift();
      const r = rooms.get(id);
      const cur = dist.get(id);
      if (id !== from && avoid && avoid(id)) continue;     // may be reached, not passed through
      for (const d of r?.doors || []) {
        if (d.barricaded || dist.has(d.to)) continue;
        const to = rooms.get(d.to);
        if (!to || to.locked) continue;
        dist.set(d.to, { d: cur.d + 1, first: cur.first || { door: d.id, to: d.to } });
        q.push(d.to);
      }
    }
    return dist;
  };
  const fromMe = bfs(me.room);
  const fromLobby = bfs(full.lobby);
  const lobbyDist = id => fromLobby.get(id)?.d ?? 99;
  const occupied = id => { const r = rooms.get(id); return r && !r.safe && othersIn(id).length > 0; };
  const fromMeSafe = persona === 'safe' ? bfs(me.room, id => occupied(id)) : fromMe;
  // The first step toward the best goal room (lowest score). `ids` are candidate goal rooms.
  const stepToward = (ids, { score = null, map = fromMe, avoidGoal = null } = {}) => {
    let best = null, bestS = Infinity;
    for (const id of ids) {
      if (id === me.room) continue;
      const e = map.get(id);
      if (!e || !e.first) continue;
      if (avoidGoal && avoidGoal(id)) continue;
      const s = score ? score(id, e.d) : e.d;
      if (s < bestS || (s === bestS && best && id < best.id)) { bestS = s; best = { id, ...e }; }
    }
    return best ? { k: 'move', to: best.first.to, door: best.first.door, goal: best.id, d: best.d } : null;
  };
  const hasLight = !!has('flashlight');
  const canSearchRoom = r => r && r.searchable && !r.locked && (r.drops > 0 || !r.searched) && (!r.dark || hasLight);
  const lootRooms = () => full.rooms.filter(canSearchRoom).map(r => r.id);
  const dropRooms = () => full.rooms.filter(r => r.drops > 0 && !r.locked && (!r.dark || hasLight)).map(r => r.id);
  const frontierRooms = () => full.rooms.filter(r => !r.locked && r.frontier.some(f => !f.jammed)).map(r => r.id);
  const closedHere = () => (here?.frontier || []).filter(f => !f.jammed);
  const lanterns = lan(me.hand);
  const need = full.lanternsToEscape ?? LANTERNS_TO_ESCAPE;
  const maxHealth = full.maxHealth ?? rules.maxHealth;
  const bots = full.bots || {};       // simulator-only bot options (see HEAL_AT_FIXED, decideAction); none = the usual bots
  const escaping = !me.possessed && lanterns >= need;
  return {
    full, i, me, mem, rng, rooms, here, persona, lan, claimed, has, weapons, met, known, suspect, attacked,
    isAlly, cleanTarget, others, othersIn, meetable, bfs, fromMe, fromMeSafe, lobbyDist, occupied, stepToward,
    canSearchRoom, lootRooms, dropRooms, frontierRooms, closedHere, lanterns, escaping, hasLight, need, maxHealth, bots,
    possCards: me.hand.filter(c => c.type === 'possession').length,
    used: AP_PER_TURN - me.ap,
  };
}

// The carrier the table pools Lanterns on (team talk), as `c` sees it.
function carrierOf(c) {
  const cands = c.full.players.filter(q => q.alive && !q.escaped && !c.suspect(q) && !(c.me.possessed && q.possessed && q.i !== c.i));
  return cands.sort((a, b) => c.claimed(b) - c.claimed(a) || a.i - b.i)[0] || null;
}

// --- building blocks -----------------------------------------------------------------------------
const pick = (arr, rng) => arr[Math.floor(rng() * arr.length)];
function openHere(c) { const doors = c.closedHere(); return doors.length ? { k: 'open', door: pick(doors, c.rng).id } : null; }
function searchHere(c) { return c.canSearchRoom(c.here) ? { k: 'search' } : null; }
function heal(c, how) {
  const at = c.bots.heal === 'fixed' ? HEAL_AT_FIXED[how] : c.maxHealth - HURT[how];
  if (c.me.health > at) return null;
  if (c.here?.job === 'infirmary') return { k: 'job' };
  const b = c.has('bandage');
  return b ? { k: 'card', type: 'bandage', card: b.id } : null;
}
// A key opens a locked door only until the end of this turn (docs/GAME_RULES.md), so it is played only
// with an action left to step in straight after.
function unlockNear(c) {
  const key = c.has('masterKey') || c.has('lockPick');
  if (!key || c.me.ap < 2) return null;
  const lockedNext = (c.here?.doors || []).filter(d => !d.barricaded).map(d => c.rooms.get(d.to)).filter(r => r && r.locked && !r.searched);
  return lockedNext.length ? { k: 'card', type: key.type, card: key.id, target: lockedNext[0].id } : null;
}
function mirror(c) {
  const m = c.has('handMirror');
  if (!m || c.me.possessed || c.here?.safe) return null;
  const t = c.othersIn(c.me.room).filter(q => !c.known.has(q.id));
  if (!t.length) return null;
  const carrier = carrierOf(c);
  const target = t.find(q => q.id === carrier?.id) || t.sort((a, b) => c.claimed(b) - c.claimed(a))[0];
  return { k: 'card', type: 'handMirror', card: m.id, target: target.id };
}
// Escaping with 3 Lanterns: to the exit, or find it.
function goExit(c, map = c.fromMe) {
  if (c.full.exitRoom) {
    const s = c.stepToward([c.full.exitRoom], { map }) || c.stepToward([c.full.exitRoom]);
    return s ? [s] : [];
  }
  return [openHere(c), c.stepToward(c.frontierRooms(), { map }), c.stepToward(c.frontierRooms())].filter(Boolean);
}
function escapeNow(c) {
  if (!c.escaping || !c.here?.isExit) return null;
  return c.me.ap >= 1 ? { k: 'escape' } : { k: 'end' };
}
// Walk to meet someone matching `filter`, within `reach` steps. `strike`: arrive with an action left
// to attack (an armed hunter does not step in with its last action; it waits a turn instead).
function hunt(c, filter, reach = 99, score = null, strike = false) {
  const ids = c.full.rooms.map(r => r.id).filter(id => id !== c.me.room && c.meetable(id, filter).length);
  const s = c.stepToward(ids, { score });
  if (!s || s.d > reach) return null;
  if (strike && s.d === 1 && c.me.ap < 2) return null;
  return s;
}
function barricadeNear(c) {
  const b = c.has('barricade');
  if (!b || c.here?.safe) return null;
  const door = (c.here?.doors || []).find(d => !d.barricaded && c.othersIn(d.to).length && !c.rooms.get(d.to)?.safe);
  return door ? { k: 'card', type: 'barricade', card: b.id, target: door.id } : null;
}

// --- the decisions -------------------------------------------------------------------------------
const PLANS = {
  rusher(c) {
    const out = [heal(c, 'badly')];
    if (c.escaping) return [...out, ...goExit(c)];
    if (c.me.possessed) {
      out.push(searchHere(c), hunt(c, q => c.cleanTarget(q), 1));
    } else if (c.lanterns < c.need) out.push(searchHere(c));
    const outward = (id, d) => d - 0.6 * c.lobbyDist(id);
    if (!c.full.exitRoom) {
      // Push outward: into a room next door that still has closed doors and lies further from the
      // lobby than this one; otherwise open a door here; otherwise walk to the edge of the hotel.
      const further = c.frontierRooms().filter(id => c.fromMe.get(id)?.d === 1 && c.lobbyDist(id) > c.lobbyDist(c.me.room));
      out.push(c.stepToward(further, { score: (id, d) => -c.lobbyDist(id) }), openHere(c), c.stepToward(c.frontierRooms(), { score: outward }));
    }
    else {
      const toExit = c.bfs(c.full.exitRoom);
      out.push(c.stepToward(c.lootRooms(), { score: (id, d) => d + 0.5 * (toExit.get(id)?.d ?? 9) }));
    }
    if (c.me.possessed) out.push(hunt(c, q => c.cleanTarget(q)));
    out.push(unlockNear(c), c.stepToward(c.lootRooms()), openHere(c), c.stepToward(c.frontierRooms()));
    return out;
  },
  slow(c) {
    if (c.used >= 2) return [{ k: 'end' }];
    const out = [heal(c, 'badly')];
    out.push(searchHere(c), unlockNear(c));
    if (c.escaping) return [...out, ...goExit(c)];
    if (c.me.possessed) out.push(hunt(c, q => c.cleanTarget(q), 1));
    else out.push(mirror(c));
    const nearLobby = (id, d) => c.lobbyDist(id) * 2 + d;
    out.push(c.stepToward(c.lootRooms(), { score: (id, d) => (d <= 1 ? d - 10 : nearLobby(id, d)) }));
    out.push(openHere(c), c.stepToward(c.frontierRooms(), { score: nearLobby }));
    return out;
  },
  safe(c) {
    const out = [];
    if (c.escaping) {
      const e = escapeNow(c); if (e) return [e];
      return [heal(c, 'any'), ...goExit(c, c.fromMeSafe)];
    }
    out.push(heal(c, 'any'));
    if (c.me.ap === 1) out.push(barricadeNear(c));
    out.push(searchHere(c), unlockNear(c), mirror(c));
    if (c.me.possessed) {
      const s = c.stepToward(c.full.rooms.map(r => r.id).filter(id => c.meetable(id, q => c.cleanTarget(q) && c.claimed(q) === 0).length), { map: c.fromMeSafe });
      if (s && s.d <= 2) out.push(s);
    }
    const avoid = id => c.occupied(id);
    out.push(c.stepToward(c.lootRooms(), { map: c.fromMeSafe, avoidGoal: avoid }));
    out.push(openHere(c), c.stepToward(c.frontierRooms(), { map: c.fromMeSafe, avoidGoal: avoid }));
    out.push(barricadeNear(c));
    return out;
  },
  aggressive(c) {
    const out = [heal(c, 'badly')];
    if (c.escaping) return [...out, ...goExit(c)];
    const target = c.me.possessed ? (q => c.cleanTarget(q)) : (() => true);
    const first = c.me.possessed ? null : (q => c.suspect(q));
    const armed = c.weapons.length > 0;
    const reach = armed ? c.me.ap - 1 : c.me.ap;
    if (first) out.push(hunt(c, first, reach, null, armed));
    out.push(hunt(c, target, reach, null, armed));
    out.push(searchHere(c), unlockNear(c));
    if (!c.full.exitRoom) out.push(openHere(c));
    out.push(c.stepToward(c.lootRooms()), openHere(c), c.stepToward(c.frontierRooms()));
    return out;
  },
  killer(c) {
    const out = [heal(c, 'badly')];
    if (c.escaping) return [...out, ...goExit(c)];
    const prey = c.me.possessed ? (q => c.cleanTarget(q)) : (() => true);
    if (c.weapons.length) out.push(hunt(c, prey, 99, (id, d) => d * 10 + Math.min(...c.meetable(id, prey).map(q => q.health)), true));
    out.push(searchHere(c), c.stepToward(c.dropRooms()));
    if (c.me.possessed) out.push(hunt(c, prey, 2));
    out.push(c.stepToward(c.lootRooms()), unlockNear(c), openHere(c), c.stepToward(c.frontierRooms()));
    return out;
  },
  team(c) {
    const out = [heal(c, 'badly')];
    if (c.escaping) return [...out, ...goExit(c)];
    if (c.me.possessed) {
      out.push(searchHere(c));
      const carrier = carrierOf(c);
      if (carrier && c.cleanTarget(carrier)) out.push(hunt(c, q => q.id === carrier.id, 3));
      out.push(hunt(c, q => c.cleanTarget(q), 3));
      out.push(c.stepToward(c.lootRooms()), openHere(c), c.stepToward(c.frontierRooms()));
      return out;
    }
    const carrier = carrierOf(c);
    const bringing = carrier && carrier.i !== c.i && c.lanterns > 0;
    if (bringing) {
      const cr = c.rooms.get(carrier.room);
      if (cr && !cr.safe && !c.met(carrier.room, c.i, carrier.i)) {
        if (carrier.room === c.me.room) {
          // Step out to come back in: a meeting starts only on arrival.
          const d = (c.here.doors || []).find(x => !x.barricaded && c.rooms.get(x.to) && !c.rooms.get(x.to).locked);
          if (d && c.me.ap >= 2) out.push({ k: 'move', to: d.to, door: d.id, goal: carrier.room });
        } else out.push(c.stepToward([carrier.room]));
      }
    }
    out.push(mirror(c), searchHere(c), unlockNear(c));
    if (!c.full.exitRoom) out.push(openHere(c));
    out.push(c.stepToward(c.lootRooms()));
    out.push(openHere(c), c.stepToward(c.frontierRooms()));
    if (carrier && carrier.i !== c.i) { const s = c.stepToward([carrier.room]); if (s && s.d > 1) out.push(s); }
    return out;
  },
};
// Who drinks an Espresso when out of actions with something still to do.
const DRINKS = { rusher: 'always', aggressive: 'always', killer: 'always', team: 'always', safe: 'escape', slow: 'never' };

export function decideAction(full, i, mem, rng) {
  const c = ctx(full, i, mem, rng);
  const e = escapeNow(c);
  if (e) return [e];
  let list = PLANS[c.persona](c).filter(Boolean);
  // Simulator-only option (full.bots.noLanternLeak): a possessed guest with no Possession card and no weapon,
  // whose cards are all Lanterns, does not walk in on a clean guest — the trade could only hand the clean side
  // a Lantern. Off by default (the usual bots keep hunting, so a run without the option is unchanged).
  if (c.bots.noLanternLeak && c.me.possessed && c.possCards === 0 && !c.weapons.length
      && c.me.hand.length && c.me.hand.every(x => x.type === 'lantern')) {
    list = list.filter(a => a.k !== 'move' || !c.meetable(a.to, q => !q.possessed).length);
  }
  // Drop steps into a room I would only be walking out of again, and duplicates.
  const seen = new Set(); const plan = [];
  for (const a of list) {
    const key = JSON.stringify(a);
    if (seen.has(key)) continue;
    seen.add(key); plan.push(a);
    if (a.k === 'end') break;
  }
  if (c.me.ap <= 0) {
    const esp = c.has('espresso');
    const wants = plan.find(a => a.k !== 'end');
    const drinks = DRINKS[c.persona] === 'always' || (DRINKS[c.persona] === 'escape' && c.escaping);
    if (esp && wants && drinks && !(c.persona === 'slow')) return [{ k: 'card', type: 'espresso', card: esp.id }, { k: 'end' }];
    return [{ k: 'end' }];
  }
  if (plan.at(-1)?.k !== 'end') plan.push({ k: 'end' });
  return plan;
}

// Several guests in the room: whom to meet.
export function decideMeetWhom(full, i, candidates, mem, rng) {
  const c = ctx(full, i, mem, rng);
  const qs = candidates.map(j => full.players[j]);
  let order;
  if (c.me.possessed) {
    const clean = qs.filter(q => !q.possessed);
    const pool = clean.length ? clean : qs;
    order = ['killer', 'aggressive'].includes(c.persona) ? pool.sort((a, b) => a.health - b.health) : pool.sort((a, b) => c.claimed(a) - c.claimed(b));
  } else if (c.persona === 'team') {
    const carrier = carrierOf(c);
    order = [...qs.filter(q => q.id === carrier?.id), ...qs.filter(q => c.known.has(q.id)), ...qs];
  } else if (c.persona === 'killer') order = [...qs].sort((a, b) => a.health - b.health);
  else if (c.persona === 'aggressive') order = [...qs.filter(q => c.suspect(q)), ...qs];
  else order = [...qs.filter(q => c.known.has(q.id)), ...qs];
  return order[0].i;
}

function chooseWeapon(c, target) {
  const knife = c.weapons.find(w => w.type === 'knife');
  const rev = c.weapons.find(w => w.type === 'revolver');
  if (knife && target.health <= DAMAGE.knife) return knife.id;
  return (rev || knife)?.id ?? null;
}

// Attack (weapon id) or trade (null)?
export function decideAttack(full, i, j, mem, rng) {
  const c = ctx(full, i, mem, rng);
  const q = full.players[j];
  if (!c.weapons.length || c.me.ap < 1 || c.here?.safe) return null;
  let go = false;
  if (c.me.possessed) {
    if (q.possessed) return null;
    const noCards = c.possCards === 0;
    switch (c.persona) {
      case 'killer': go = true; break;
      case 'aggressive': go = noCards || c.claimed(q) > 0 || (q.knows || []).includes(c.me.id); break;
      case 'rusher': case 'team': go = noCards && c.claimed(q) >= 2; break;
      default: go = false;
    }
  } else {
    const knownP = c.known.has(q.id);
    switch (c.persona) {
      case 'killer': go = true; break;
      case 'aggressive': go = c.suspect(q) || rng() < 0.5; break;
      case 'team': go = knownP && q.id !== carrierOf(c)?.id; break;
      default: go = knownP;
    }
  }
  return go ? chooseWeapon(c, q) : null;
}

function leastValuable(c, cards, { keep = [] } = {}) {
  const pool = cards.filter(x => !keep.includes(x.type));
  const use = pool.length ? pool : cards;
  return [...use].sort((a, b) => value(c.persona, a.type) - value(c.persona, b.type))[0] || null;
}

// The card to give in a trade. `cardIds` are the cards the game lets this guest give.
export function decideTradeCard(full, i, j, cardIds, mem, rng) {
  const c = ctx(full, i, mem, rng);
  const q = full.players[j];
  const byId = new Map(c.me.hand.map(x => [x.id, x]));
  const cards = cardIds.map(id => byId.get(id)).filter(Boolean);
  if (!cards.length) return cardIds[0];
  const lan = cards.find(x => x.type === 'lantern');
  const poss = cards.find(x => x.type === 'possession');
  const plain = cards.filter(x => x.type !== 'possession');
  if (c.me.possessed) {
    const knowsMe = (q.knows || []).includes(c.me.id);
    const tries = poss && !q.possessed && !knowsMe && (c.persona !== 'safe' || c.claimed(q) === 0);
    if (tries) return poss.id;
    const give = leastValuable(c, plain, { keep: ['lantern'] });
    return (give || poss || cards[0]).id;
  }
  // Clean.
  if (lan && c.known.has(q.id)) return lan.id;                    // block a known possessed guest
  const worst = () => (leastValuable(c, plain, { keep: ['lantern'] }) || cards[0]).id;
  switch (c.persona) {
    case 'safe': return lan ? lan.id : worst();
    case 'slow': return lan && c.lanterns >= 2 ? lan.id : worst();
    case 'team': {
      const carrier = carrierOf(c);
      if (lan && carrier && carrier.id === q.id && carrier.i !== c.i) return lan.id;
      return worst();
    }
    default: return worst();
  }
}

export function decideDiscard(full, i, cardIds) {
  const me = full.players[i];
  const c = { persona: me.persona };
  const cards = cardIds.map(id => me.hand.find(x => x.id === id)).filter(Boolean);
  return (leastValuable(c, cards, { keep: ['lantern'] }) || cards[0])?.id ?? cardIds[0];
}
