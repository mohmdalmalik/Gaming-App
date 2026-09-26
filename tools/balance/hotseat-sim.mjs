// Balance simulation (dev tool, not part of the game).
//   node tools/balance/hotseat-sim.mjs [matches] [players]            the rules as they stand
//   node tools/balance/hotseat-sim.mjs [matches] [players] --compare  plus three Lantern variants
//   node tools/balance/hotseat-sim.mjs [matches] [players] --before   plus the same bots, seeds and
//        hotels on the rules BEFORE Part 2 (the 40-card deck, the five job rooms as plain rooms), so the
//        effect of the Part 2 changes is measured like for like
//
// Plays whole matches through the PURE rules engine — no browser — with simple bots, each in a new
// random hotel that grows as the bots open doors. By default it reports the approved rules: who
// wins, dawn, match length, when the Fire Exit turns up, how much of the hotel gets explored,
// meetings, and whether the hotel ever closed itself off (it must not) — then how much the rooms
// with jobs and the new cards get used, read against how often they were there to use. With
// --compare it also runs three comparison variants side by side:
//
//   blocking Lantern:  'discard'  (APPROVED — used up)   vs  'attacker' (goes to the possessed guest)
//   Lanterns at start: 0 dealt    (APPROVED — search only) vs  1 dealt to each guest
//
// Only the simulator switches the variants on; the game always runs the approved rules.
//
// The bots are honest about hidden information with ONE exception: clean guests agree on a
// "carrier" — the clean-looking guest holding the most Lanterns — and bring Lanterns to them,
// standing in for the talking a real table does. Nobody knows who is possessed except a guest
// who blocked them with a Lantern, saw a Possession card in a Hand Mirror, or worked it out from
// the Switchboard's count. A second shortcut, carried over unchanged from the earlier bots so the
// comparison stays fair: POSSESSED bots know every guest's role (who is on their side, whom to hunt)
// and see a target's Lantern count before attacking. So the Hand Mirror and Switchboard numbers below
// measure what they do for the CLEAN side only. Bots never waste a turn and never bluff, so read the numbers as "the
// rules played competently and mechanically", not as a prediction of a real evening.
//
// Rooms with jobs and the new cards — what the bots do with them:
//   Linen Store   searched like any room, and preferred a little: when one is at most one step
//                 further than the nearest other goal, the bot goes there. Of the two cards, any that
//                 do not fit are handled like a single card that does not fit: a Lantern is kept
//                 (something else is dropped), anything else is left.
//   Infirmary     a hurt guest standing in one is treated (1 AP). A guest who would get the full
//                 treatment (health 1 of 3) walks to one that is at most two steps away, and skips the
//                 Bandage that turn. Never for a clean guest carrying three Lanterns: getting out
//                 comes first.
//   Switchboard   a clean guest standing in it rings it once the room is searched, with an action to
//                 spare (never drinking an Espresso for it), at most once per round, and only when the
//                 answer could have changed since the table last heard it (a trade or a death since)
//                 and the number can settle something for that guest: they already know someone is
//                 possessed, or only one or two guests are left to wonder about. (Ringing whenever
//                 possible cost the clean side about a point of wins: most answers changed nothing a
//                 bot does.) One step away and with two actions to spare, it makes the detour.
//                 Every clean guest hears the count (it is public) and
//                 checks it against what they know: if the count equals the possessed guests they
//                 already know about, everyone else is certainly clean (for now — a trade with anyone
//                 not certainly clean undoes that); if the unknown guests are exactly as many as the
//                 possessed ones not yet known, they are all possessed. Possessed guests never ring —
//                 they have nothing to learn.
//   Hand Mirror   used outside meetings: in the game a meeting starts the moment you walk in, and the
//                 mirror is played from your hand. A clean guest sharing a room with a guest it knows
//                 nothing certain about uses it on the carrier (the guest it brings Lanterns to), or
//                 failing that on the guest there holding the most Lanterns, or anyone there. Never on a
//                 guest whose Possession cards it has already seen since that guest's last trade — in a
//                 mirror, or because that guest just traded with it and handed over something else: a
//                 Possession card only changes hands in a trade, so the mirror could show nothing new.
//                 (An earlier version looked only at Lantern holders and so mostly at guests who had
//                 just traded with it; the possessed ones among them had just shown they held no
//                 Possession card, so the mirror almost never unmasked anyone.)
//                 A Possession card seen that way tells the bot the truth (the engine records it), which
//                 steers who it treats as the carrier and whom it attacks; a known possessed guest seen
//                 in a mirror holding NO Possession card gets no Lantern in a trade (nothing to block).
//                 Bots never walk away from a known possessed guest (meetings stay forced), so knowing
//                 helps them less than it would help a person. Possessed bots do not use
//                 it: here the table talk already says who carries the Lanterns and possessed guests
//                 already know each other, so it would tell them nothing they act on (a real player
//                 might still use one to look innocent or to dodge a Lantern block; bots don't bluff).
//   Espresso      drunk only when it will be used: the moment the bot is out of actions and still has
//                 something to do this turn (search, open, move, a room's job, a card).
import { rules, applyMode } from '../../src/data/rules.js';
import { hotel } from '../../src/data/hotel.js';
import { roster } from '../../src/data/characters.js';
import { config } from '../../src/config.js';
import { createHotel, openDoors, exitPlaced } from '../../src/game/hotel.js';
import { weaponsIn, makeRng } from '../../src/game/cards.js';
import * as S from '../../src/game/state.js';
import * as A from '../../src/game/actions.js';

const N = parseInt(process.argv[2], 10) || 400;
const PLAYERS = parseInt(process.argv[3], 10) || 6;
applyMode('hotseat', PLAYERS);
const floor = createHotel(hotel, config);   // rebuilt for every match by createState
const COMPARE = process.argv.includes('--compare');
// Bots: 'explorer' (default) — clean guests open doors whenever the Fire Exit is still hidden;
// 'cautious' (--cautious) — they only open doors once nothing known is left to search.
const EXPLORE = !process.argv.includes('--cautious');
const MAX_TURNS = 600;          // a safety net: with the dawn deadline no match should get near it
const INFIRMARY_REACH = 2;      // bot habit, not a rule: how many steps a badly hurt guest walks for treatment
const lanterns = hand => hand.filter(c => c.type === 'lantern');
// The bots' own choices (which door, which card) come from a generator seeded per match, so the same
// command gives the same numbers every time.
let botRng = makeRng(1);
const rnd = arr => arr[Math.floor(botRng() * arr.length)];

// What the bots remember between turns, reset for every match. Only what that guest saw for
// themselves or what the whole table heard (the public log) — never a hidden role.
let memo;
const freshMemo = () => ({
  events: 0,              // trades and deaths so far (both public)
  switchUnmasked: new Set(),  // possessed guests some clean guest worked out from the Switchboard
  eventsAtCall: 0,        // ...when the table last heard the Switchboard's count (the start: 1)
  rang: new Map(),        // playerId -> round they last rang the Switchboard
  trades: new Map(),      // playerId -> trades they have made so far (public: "X and Y traded")
  seen: new Map(),        // playerId -> Map(targetId -> { trades, armed, mirror }): what I last saw for
                          // myself of a guest's Possession cards — a Hand Mirror (certain) or a trade in
                          // which they handed me something else (they did not use one on me) — and how
                          // many trades they had made then
  trusted: new Map(),     // playerId -> Set of guests they are CERTAIN are clean (from the Switchboard)
  gained: 0,              // extra actions from Espresso this turn
});
const trustOf = p => { if (!memo.trusted.has(p.id)) memo.trusted.set(p.id, new Set()); return memo.trusted.get(p.id); };
const seenBy = p => { if (!memo.seen.has(p.id)) memo.seen.set(p.id, new Map()); return memo.seen.get(p.id); };
const tradesOf = q => memo.trades.get(q.id) || 0;
// What I saw of `q` still holds: they have not traded since (a Possession card only moves in a trade).
const stillSeen = (p, q) => { const s = seenBy(p).get(q.id); return s && s.trades === tradesOf(q) ? s : null; };
const hasEspresso = p => p.hand.some(c => c.type === 'espresso');

// Espresso: make sure I can pay `cost` action points, drinking one only when I am out of them —
// so the extra actions are always spent on the step the bot is about to take.
function spend(st, p, m, cost) {
  if (p.actionPoints >= cost) return true;
  const esp = p.hand.find(c => c.type === 'espresso');
  if (!esp) return false;
  const r = A.useEspresso(st, p, esp.id);
  if (!r.ok) return false;
  m.espresso++; m.espressoAP += r.gained; memo.gained += r.gained;
  return p.actionPoints >= cost;
}
// The same player as the engine's checks should see them if an Espresso would be drunk first.
const ready = p => (p.actionPoints > 0 || !hasEspresso(p) ? p
  : { ...p, actionPoints: rules.cards.espresso.extraActions - rules.actionCost.espresso });

// Shortest room path, honouring locked rooms and barricades. A locked room is allowed only as the
// final step when the bot can open it.
function pathTo(st, from, targets, canOpen = false) {
  const want = new Set(targets);
  if (want.has(from)) return [from];
  const prev = new Map([[from, null]]); const q = [from];
  while (q.length) {
    const here = q.shift();
    for (const d of floor.rooms.get(here).doorways) {
      const n = d.otherRoom(here);
      if (prev.has(n) || S.isBarricaded(st, d.id)) continue;
      if (S.isLocked(st, n) && !(canOpen && want.has(n))) continue;
      prev.set(n, here);
      if (want.has(n)) { const path = [n]; let c = here; while (c) { path.unshift(c); c = prev.get(c); } return path; }
      q.push(n);
    }
  }
  return null;
}

// Rooms with a closed door that can still be opened (the edge of the explored hotel).
const roomsWithClosedDoors = st => [...new Set(openDoors(floor).map(d => d.room))].filter(r => !S.isLocked(st, r));
const roomsWithJob = job => floor.roomList.filter(r => r.job === job);

// Open a closed door of the room I stand in (1 AP). Counts how the hotel grows and checks, every
// time, that it has not closed itself off before the Fire Exit is on the board.
function openHere(st, p, m) {
  const doors = S.openableDoors(st, floor, ready(p));
  if (!doors.length || !spend(st, p, m, rules.actionCost.open)) return false;
  const r = A.openDoor(st, floor, p, rnd(doors).id);
  if (!r.ok) { m.jammed++; return true; }
  m.opened++;
  if (r.room.isExit) m.exitRound = st.round;
  if (!exitPlaced(floor) && openDoors(floor).length === 0) m.closedOff++;
  return true;
}

// TEAM TALK: the clean-looking guest (as far as `me` knows) holding the most Lanterns.
function carrierOf(st, me) {
  return st.players.filter(q => q.alive && !me.knows.has(q.id) && !(me.possessed && q.possessed))
    .sort((a, b) => lanterns(b.hand).length - lanterns(a.hand).length || a.index - b.index)[0] || null;
}

// The card a bot parts with first when its hand is too full: the least useful to it.
function spare(p) {
  const loose = p.hand.filter(c => c.type !== 'lantern' && c.type !== 'possession');
  const keepLast = new Set(['espresso', 'handMirror']);
  return loose.find(c => c.type === 'barricade') || loose.find(c => c.type === 'lockPick')
    || (p.possessed && loose.find(c => c.type === 'handMirror'))
    || loose.find(c => !keepLast.has(c.type)) || loose[0] || null;
}

// The card a bot gives in a trade (null: nothing to give — cards that get used up can empty a hand).
function giveCard(st, me, partner) {
  const hand = A.tradeableCards(me);
  if (!hand.length) return null;
  if (me.possessed) {
    const pc = hand.find(c => c.type === 'possession');
    if (pc && !partner.possessed) return pc.id;
    // Look innocent, and keep the Lanterns away from the clean side.
    const plain = hand.filter(c => c.type !== 'possession' && c.type !== 'lantern');
    return (plain.length ? rnd(plain) : rnd(hand)).id;
  }
  const lan = lanterns(hand);
  const carrier = carrierOf(st, me);
  // A guest I know is possessed, and whose whole hand I saw in a Hand Mirror without a Possession card
  // (no trade since): nothing to block, so no Lantern for them.
  const saw = stillSeen(me, partner);
  if (me.knows.has(partner.id) && saw?.mirror && !saw.armed) {
    const plain = hand.filter(c => c.type !== 'lantern');
    if (plain.length) return rnd(plain).id;
  }
  // A guest I know is possessed may try a Possession card on me: a Lantern blocks it — the carrier too.
  if (me.knows.has(partner.id) && lan.length) return lan[0].id;
  // The carrier keeps their Lanterns and gives something else if they can.
  if (carrier?.id === me.id) {
    const plain = hand.filter(c => c.type !== 'lantern');
    return (plain.length ? rnd(plain) : rnd(hand)).id;
  }
  // Everyone else gives a Lantern when they have one: it blocks possession, and in an ordinary
  // trade it goes to the other guest — ideally the carrier they came to find.
  if (lan.length) return lan[0].id;
  return rnd(hand).id;
}

// Something public happened that can change how many guests are possessed. After a trade, a guest
// who was certainly clean stays so only if the other side was certainly clean too.
function heard(st, P, Q) {
  memo.events++;
  if (!Q) return;
  for (const [id, sure] of memo.trusted) {
    const safe = g => g.id === id || sure.has(g.id);
    const [okP, okQ] = [safe(P), safe(Q)];
    if (!okQ) sure.delete(P.id);
    if (!okP) sure.delete(Q.id);
  }
}

function meet(st, p, m) {
  const cands = S.pendingEncounters(st, floor, p);
  if (!cands.length) return;
  const Q = p.possessed ? (cands.find(q => !q.possessed) || cands[0])
    : (cands.find(q => carrierOf(st, p)?.id === q.id) || cands.find(q => !p.knows.has(q.id)) || cands[0]);
  S.lockEncounter(st, p.currentRoom, p.index, Q.index);
  m.meetings++;
  const weapon = weaponsIn(p.hand)[0];
  const attack = weapon && p.actionPoints >= 1 && (
    (!p.possessed && p.knows.has(Q.id)) ||
    (p.possessed && !Q.possessed && !p.hand.some(c => c.type === 'possession') && lanterns(Q.hand).length >= 2));
  if (attack) {
    const r = A.resolveAttack(st, floor, p, Q, weapon.id);
    if (r.ok) { m.attacks++; if (r.killed) { m.deaths++; heard(st, Q); } }
    return;
  }
  const [cardP, cardQ] = [giveCard(st, p, Q), giveCard(st, Q, p)];
  if (!cardP || !cardQ) { m.emptyHanded++; return; }   // the rules do not say; here the meeting just ends
  const r = A.resolveTrade(st, floor, p, Q, cardP, cardQ);
  if (!r.ok) return;
  m.trades++;
  heard(st, p, Q);
  for (const X of [p, Q]) memo.trades.set(X.id, tradesOf(X) + 1);
  // A clean guest who was handed something other than a Possession card saw, for themselves, that
  // the other guest did not use one on them.
  for (const [X, Y] of [[p, Q], [Q, p]]) {
    if (!X.possessed && r.given[Y.id] !== 'possession') seenBy(X).set(Y.id, { trades: tradesOf(Y), armed: false, mirror: false });
  }
  if (r.given[p.id] === 'possession' || r.given[Q.id] === 'possession') m.attempts++;
  m.possessed += r.possessed.length;
  m.blocked += r.blocks.length;
  m.burned += r.lanternsBurned || 0;
}

// --- Rooms with jobs and the new cards ------------------------------------------------------------
// A search's result: count what was drawn, and settle any card that did not fit.
function takeFinds(st, p, r, m) {
  if (r.kind !== 'card' && r.kind !== 'cards') return;
  const drawn = r.kind === 'cards' ? r.cards : [r.card];
  for (const c of drawn) { m[`drawn:${c.type}`]++; if (c.type === 'lantern') m.found++; }
  if (r.kind === 'cards') { m.linenSearches++; m.linenCards += drawn.length; }
  // Keep a Lantern (drop something else); otherwise leave the new card.
  for (const c of r.overflow || []) {
    const drop = c.type === 'lantern' ? spare(p) : null;
    A.resolveFullHand(st, p, c, drop ? 'take' : 'leave', drop?.id);
    if (!drop && r.kind === 'cards') m.linenLeft++;
  }
}

// Infirmary: a known one close enough for a badly hurt guest to walk to, or null.
function infirmaryNear(st, p) {
  if (p.health > rules.maxHealth - rules.infirmaryHeal) return null;
  const ids = roomsWithJob('infirmary').map(r => r.id);
  const path = ids.length ? pathTo(st, p.currentRoom, ids) : null;
  return path && path.length > 1 && path.length - 1 <= INFIRMARY_REACH ? path[path.length - 1] : null;
}

// Switchboard: worth ringing if the answer could have changed since the table last heard it, and the
// number can settle something for me: I already know someone is possessed (the count may then clear
// everyone else), or only one or two guests are left to wonder about. At most once a round.
function worthRinging(st, p) {
  if (p.possessed || memo.rang.get(p.id) === st.round || memo.events === memo.eventsAtCall) return false;
  const sure = trustOf(p);
  const others = st.players.filter(q => q.alive && q.id !== p.id);
  const suspects = others.filter(q => !p.knows.has(q.id) && !sure.has(q.id)).length;
  return suspects > 0 && (others.some(q => p.knows.has(q.id)) || suspects <= 2);
}
function switchboardNextDoor(st, p) {
  const sw = roomsWithJob('switchboard')[0];
  if (!sw || sw.id === p.currentRoom || !worthRinging(st, p)) return null;
  if (p.actionPoints < rules.actionCost.move + rules.actionCost.switchboard) return null;
  const path = pathTo(st, p.currentRoom, [sw.id]);
  return path?.length === 2 ? sw.id : null;
}
function ring(st, p, m) {
  const r = A.useSwitchboard(st, floor, p);
  if (!r.ok) return;
  m.switchCalls++;
  memo.rang.set(p.id, st.round);
  memo.eventsAtCall = memo.events;
  // Everyone hears the number. Each clean guest checks it against what they already know.
  let learned = false;
  for (const b of st.players) {
    if (!b.alive || b.possessed) continue;
    const others = st.players.filter(q => q.alive && q.id !== b.id);
    const sure = trustOf(b);
    const hidden = r.count - others.filter(q => b.knows.has(q.id)).length;
    const suspects = others.filter(q => !b.knows.has(q.id) && !sure.has(q.id));
    if (!suspects.length) continue;
    if (hidden <= 0) { for (const q of suspects) sure.add(q.id); learned = true; }
    else if (hidden === suspects.length) {
      for (const q of suspects) { b.knows.add(q.id); memo.switchUnmasked.add(q.id); }
      learned = true;
    }
  }
  if (learned) m.switchLearned++;
  m.switchUnmasked = memo.switchUnmasked.size;     // distinct guests, however many listeners worked each out
}

// Hand Mirror, outside meetings, on a guest here I know nothing certain about: the carrier first (the
// guest my Lanterns go to), then whoever here holds the most Lanterns, then anyone. Not on a guest whose
// Possession cards (or lack of them) I have already seen since their last trade — through a mirror, or
// because they just traded with me and handed me something else: a Possession card only changes hands
// in a trade, so the mirror could not show anything new.
function lookInMirror(st, p, m) {
  const mirror = p.hand.find(c => c.type === 'handMirror');
  if (!mirror || p.possessed) return false;
  // Not in the lobby: it is a safe zone (no forced meetings, trades only by agreement), and at the
  // start everyone is there holding nothing yet, so a look would be a blind guess.
  if (floor.rooms.get(p.currentRoom)?.safe) return false;
  const sure = trustOf(p);
  const here = S.playersInRoom(st, p.currentRoom, p.id)
    .filter(q => !p.knows.has(q.id) && !sure.has(q.id) && !stillSeen(p, q));
  if (!here.length) return false;
  const carrier = carrierOf(st, p);
  const target = here.find(q => q.id === carrier?.id)
    || here.filter(q => lanterns(q.hand).length === Math.max(...here.map(x => lanterns(x.hand).length)))
      .reduce((pick, q, i) => (botRng() < 1 / (i + 1) ? q : pick), null);   // ties broken at random
  if (!spend(st, p, m, rules.actionCost.useCard)) return false;
  const r = A.useHandMirror(st, floor, p, mirror.id, target.id);
  if (!r.ok) return false;
  const armed = r.hand.some(c => c.type === 'possession');
  seenBy(p).set(target.id, { trades: tradesOf(target), armed, mirror: true });
  m.mirrors++;
  if (target.possessed) m.mirrorOnPossessed++;
  if (r.unmasked) m.mirrorUnmasked++;
  else if (target.possessed) m.mirrorMissed++;     // possessed, but holding no Possession card
  return true;
}

function botTurn(st, p, m) {
  memo.gained = 0;
  const bd = p.hand.find(c => c.type === 'bandage');
  const escaper = !p.possessed && lanterns(p.hand).length >= rules.lanternsToEscape;
  const clinic = !escaper && (floor.rooms.get(p.currentRoom).job === 'infirmary' || infirmaryNear(st, p));
  if (bd && p.health < rules.maxHealth && !clinic) { A.useBandage(st, p, bd.id); m.bandages++; }
  let guard = 0;
  while ((p.actionPoints > 0 || hasEspresso(p)) && !st.finished && guard++ < 20) {
    const here = p.currentRoom;
    const room = floor.rooms.get(here);
    const opener = p.hand.find(c => c.type === 'masterKey') || p.hand.find(c => c.type === 'lockPick');
    const carrier = carrierOf(st, p);
    const escaping = !p.possessed && lanterns(p.hand).length >= rules.lanternsToEscape;
    let targets;
    // The rooms with jobs, and the Hand Mirror, where I stand.
    if (!escaping && room.job === 'infirmary' && p.health < rules.maxHealth && A.canUseRoom(st, floor, ready(p)).ok
      && spend(st, p, m, rules.actionCost.infirmary)) {
      const r = A.useInfirmary(st, floor, p);
      if (r.ok) { m.infirmaryUses++; m.healthRestored += r.healed; }
      continue;
    }
    if (!escaping && lookInMirror(st, p, m)) continue;
    if (escaping) {
      // Three Lanterns: to the Fire Exit — or, until it has turned up, keep opening doors.
      if (S.canEscape(st, floor, p)) { if (A.escape(st, floor, p).ok) return; break; }   // already there
      if (floor.exitRoom) targets = [floor.exitRoom];
      else { if (openHere(st, p, m)) continue; targets = roomsWithClosedDoors(st); }
    } else {
      if (A.canSearch(st, floor, ready(p)).ok && spend(st, p, m, rules.actionCost.search)) {
        takeFinds(st, p, A.search(st, floor, p), m);
        continue;
      }
      const lockedNear = S.adjacentLockedRooms(st, floor, p).filter(r => !st.searchedRooms.has(r));
      if (lockedNear.length && opener && spend(st, p, m, rules.actionCost.useCard)) { A.useUnlock(st, floor, p, opener.id, lockedNear[0]); continue; }
      // The Switchboard, once the room is searched, with an action to spare (never an Espresso for it).
      if (room.job === 'switchboard' && worthRinging(st, p) && A.canUseRoom(st, floor, p).ok) { ring(st, p, m); continue; }
      const clinic = infirmaryNear(st, p);
      const bringing = !p.possessed && lanterns(p.hand).length && carrier && carrier.id !== p.id;
      const phone = !p.possessed && !bringing ? switchboardNextDoor(st, p) : null;
      if (clinic) targets = [clinic];                  // badly hurt: to the Infirmary nearby
      else if (phone) targets = [phone];               // a one-step detour to ring the Switchboard
      // Clean guests explore while the Fire Exit has not turned up: open a closed door of this room
      // (the room behind is searched next), since searching alone never finds the way out.
      else if (!p.possessed && !floor.exitRoom && EXPLORE && openHere(st, p, m)) continue;
      else if (p.possessed) {
        targets = st.players.filter(q => q.alive && !q.possessed && !floor.rooms.get(q.currentRoom).safe).map(q => q.currentRoom);
        if (!targets.length) { if (openHere(st, p, m)) continue; targets = roomsWithClosedDoors(st); }
      } else if (bringing) {
        targets = [carrier.currentRoom];          // bring my Lanterns to the carrier
      } else {
        targets = [...st.roomDrops.keys()];
        if (!targets.length) {
          targets = floor.roomList.filter(r => r.searchable && !st.searchedRooms.has(r.id)
            && (!r.dark || p.hand.some(c => c.type === 'flashlight')) && (!S.isLocked(st, r.id) || opener)).map(r => r.id);
          // ...and, while the exit is still hidden, rooms with a closed door to open are as good a goal.
          if (!floor.exitRoom && EXPLORE) targets = [...targets, ...roomsWithClosedDoors(st)];
          // A Linen Store's draw gives two cards: worth one extra step.
          const linen = targets.filter(id => floor.rooms.get(id).job === 'linenStore');
          if (linen.length && linen.length < targets.length) {
            const toLinen = pathTo(st, here, linen, !!opener), toAny = pathTo(st, here, targets, !!opener);
            if (toLinen && toAny && toLinen.length <= toAny.length + 1) targets = linen;
          }
        }
        // Nothing known left to search: explore — open a door here, or walk to a room that has one.
        if (!targets.length) {
          if (openHere(st, p, m)) continue;
          targets = roomsWithClosedDoors(st);
        }
        if (!targets.length && carrier?.id === p.id) {
          targets = st.players.filter(q => q.alive && q.id !== p.id && lanterns(q.hand).length && !p.knows.has(q.id)).map(q => q.currentRoom);
        }
      }
      // A meeting happens only on ARRIVAL: if my target is where I stand, step out to come back.
      if (targets.length === 1 && targets[0] === here) targets = [...floor.rooms.get(here).neighbours].filter(r => !S.isLocked(st, r));
    }
    if (!targets?.length) break;
    const path = pathTo(st, here, targets, !!opener);
    const step = path && path.length > 1 ? path[1] : null;
    if (!step) { m.stuckTurns++; break; }
    if (S.isLocked(st, step)) { if (opener && spend(st, p, m, rules.actionCost.useCard)) { A.useUnlock(st, floor, p, opener.id, step); continue; } break; }
    if (!spend(st, p, m, rules.actionCost.move)) break;
    S.enterRoom(st, floor, p, step);
    // In the Fire Exit with three Lanterns: Escape (1 AP) — or next turn, if this move used the last one.
    if (floor.rooms.get(step).isExit && S.canEscape(st, floor, p)) { if (A.escape(st, floor, p).ok) return; break; }
    meet(st, p, m);
  }
}

// Card types in the draw deck, for the "in hand at the start / drawn" counts.
const DECK_TYPES = Object.keys(rules.deck);

function match(seed) {
  const st = S.createState(floor, roster.slice(0, PLAYERS), seed, { mode: 'hotseat' });
  memo = freshMemo();
  botRng = makeRng((seed * 2654435761) ^ 0xb07b07);
  const m = { meetings: 0, trades: 0, attacks: 0, deaths: 0, attempts: 0, possessed: 0, blocked: 0, burned: 0, found: 0, stuckTurns: 0, opened: 0, jammed: 0, closedOff: 0,
    linenSearches: 0, linenCards: 0, linenLeft: 0, infirmaryUses: 0, healthRestored: 0, bandages: 0,
    switchCalls: 0, switchLearned: 0, switchUnmasked: 0, mirrors: 0, mirrorOnPossessed: 0, mirrorUnmasked: 0, mirrorMissed: 0,
    espresso: 0, espressoAP: 0, espressoUnused: 0, emptyHanded: 0 };
  for (const t of DECK_TYPES) {
    m[`dealt:${t}`] = st.players.reduce((n, q) => n + q.hand.filter(c => c.type === t).length, 0);
    m[`drawn:${t}`] = 0;
  }
  let turns = 0;
  while (!st.finished && turns++ < MAX_TURNS) {
    const p = S.activePlayer(st);
    botTurn(st, p, m);
    if (memo.gained) m.espressoUnused += Math.min(Math.max(0, p.actionPoints), memo.gained);
    if (st.finished) break;
    while (A.overHandLimit(p) > 0) {
      const shed = spare(p) || p.hand.find(c => c.type === 'lantern');
      if (!shed || !A.discardCard(st, p, shed.id).ok) break;
    }
    if (S.endTurn(st, floor).finished) break;
    S.checkWin(st, floor);
  }
  // Where every Lantern ended up — to explain the matches that never end.
  const inHands = side => st.players.filter(q => q.alive && (side === 'clean' ? !q.possessed : q.possessed))
    .reduce((n, q) => n + lanterns(q.hand).length, 0);
  const where = {
    clean: inHands('clean'), possessed: inHands('possessed'),
    deck: lanterns(st.drawPile).length, discard: lanterns(st.discardPile).length,
    floor: [...st.roomDrops.values()].reduce((n, cards) => n + lanterns(cards).length, 0),
  };
  // At dawn: could either side still have won? "Stuck" = the clean side can never reach three
  // Lanterns (not counting any held by the possessed) AND the hotel has no Possession cards left.
  const possessionLeft = st.players.filter(q => q.alive).reduce((n, q) => n + q.hand.filter(c => c.type === 'possession').length, 0);
  const cleanCanReach = where.clean + where.deck + where.floor >= rules.lanternsToEscape;
  const dawnState = !st.dawn ? null
    : !cleanCanReach && possessionLeft === 0 ? 'stuck'
      : !cleanCanReach ? 'cleanLockedOut'
        : 'inPlay';
  m.tiles = floor.roomList.length - 1;
  // The rooms with jobs that made it onto the board, and the new cards anyone ever held.
  m.linenOnBoard = roomsWithJob('linenStore').length;
  m.infirmaryOnBoard = roomsWithJob('infirmary').length;
  m.switchOnBoard = roomsWithJob('switchboard').length;
  m.mirrorsHeld = m['dealt:handMirror'] + m['drawn:handMirror'];
  m.espressoHeld = m['dealt:espresso'] + m['drawn:espresso'];
  return { won: st.won, dawn: !!st.dawn, dawnState, rounds: Math.min(st.round, rules.roundLimit), finished: st.finished, m, where,
    possessedAtEnd: st.players.filter(q => q.alive && q.possessed).length,
    possessionCardsLeft: st.players.filter(q => q.alive).reduce((n, q) => n + q.hand.filter(c => c.type === 'possession').length, 0),
    cleanAlive: st.players.filter(q => q.alive && !q.possessed).length };
}

// "Used" key -> "was there to use" key, for the share of matches where it was available and used.
const USE_VS_CHANCE = [['linenSearches', 'linenOnBoard'], ['infirmaryUses', 'infirmaryOnBoard'],
  ['switchCalls', 'switchOnBoard'], ['mirrors', 'mirrorsHeld'], ['espresso', 'espressoHeld']];

function run(label, block, dealt) {
  rules.lanternBlock = block; rules.lanternsDealtEach = dealt;
  const out = { label, humans: 0, hotel: 0, never: 0, rounds: [], roundsH: [], roundsP: [], sums: {}, perRound: {},
    dawn: 0, dawnStates: { stuck: 0, cleanLockedOut: 0, inPlay: 0 }, hotelOther: 0, lanternsAtDawn: [],
    exitRounds: [], exitNever: 0, tiles: [], closedOff: 0, meetingsPer: [],
    neverWhy: { starved: 0, hoarded: 0, other: 0 }, hoardSum: 0, firstPossRound: [],
    anyIn: {}, chance: {}, usedWhenThere: {} };
  for (let i = 1; i <= N; i++) {
    const r = match(i * 7919 + 13);
    if (r.won === 'humans') out.humans++; else if (r.won === 'possessed') out.hotel++; else out.never++;
    if (r.m.exitRound) out.exitRounds.push(r.m.exitRound); else out.exitNever++;
    out.tiles.push(r.m.tiles); out.closedOff += r.m.closedOff; out.meetingsPer.push(r.m.meetings);
    if (r.dawn) { out.dawn++; out.dawnStates[r.dawnState]++; out.lanternsAtDawn.push(r.where); }
    else if (r.won === 'possessed') out.hotelOther++;
    if (r.finished) { out.rounds.push(r.rounds); (r.won === 'humans' ? out.roundsH : out.roundsP).push(r.rounds); }
    for (const [k, v] of Object.entries(r.m)) {
      out.sums[k] = (out.sums[k] || 0) + v; out.perRound[k] = (out.perRound[k] || 0) + v / r.rounds;
      if (v > 0) out.anyIn[k] = (out.anyIn[k] || 0) + 1;
    }
    for (const [used, there] of USE_VS_CHANCE) {
      if (r.m[there] > 0) { out.chance[there] = (out.chance[there] || 0) + 1; if (r.m[used] > 0) out.usedWhenThere[used] = (out.usedWhenThere[used] || 0) + 1; }
    }
    if (!r.finished) {
      // Can the clean side still reach three Lanterns without taking them off a possessed guest?
      const reachable = r.where.clean + r.where.deck + r.where.floor;
      if (reachable < rules.lanternsToEscape) out.neverWhy[r.where.possessed ? 'hoarded' : 'starved']++;
      else out.neverWhy.other++;
      out.hoardSum += r.where.possessed;
      if (r.possessionCardsLeft === 0) out.deadlock = (out.deadlock || 0) + 1;
      out.cleanLeftSum = (out.cleanLeftSum || 0) + r.cleanAlive;
    }
  }
  rules.lanternBlock = 'discard'; rules.lanternsDealtEach = 0;   // back to the approved rules
  return out;
}

const pct = (n) => `${Math.round(n / N * 100)}%`;
const avg = (v, k) => (v.sums[k] / N).toFixed(2);
const median = a => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : '—');
const perRound = (v, k) => (v.perRound[k] / N).toFixed(2);

const approved = run('Approved rules', 'discard', 0);
const v = approved;
const ofDawn = n => (v.dawn ? `${n} (${Math.round(n / v.dawn * 100)}% of dawn matches)` : '0');
const meanAt = k => (v.lanternsAtDawn.length ? (v.lanternsAtDawn.reduce((a, w) => a + w[k], 0) / v.lanternsAtDawn.length).toFixed(1) : '—');
console.log(`${N} matches, ${PLAYERS} players, the rules as they stand (dawn after round ${rules.roundLimit})\n`);
const lines = [
  ['Clean guests win', pct(v.humans)],
  ['The hotel wins', pct(v.hotel)],
  ['  … by possessing or killing every clean guest', pct(v.hotelOther)],
  ['  … at dawn', pct(v.dawn)],
  ['Matches that never end', `${v.never}`],
  ['Match length, median rounds (all matches)', String(median(v.rounds))],
  ['  … when the clean side wins', String(median(v.roundsH))],
  ['  … when the hotel wins', String(median(v.roundsP))],
  ['Reached dawn', `${v.dawn} of ${N}`],
  ['  … no peaceful way left (3 Lanterns only by taking them from the possessed)', ofDawn(v.dawnStates.stuck + v.dawnStates.cleanLockedOut)],
  ['  … 3 Lanterns still reachable without a fight', ofDawn(v.dawnStates.inPlay)],
  ['Lanterns at dawn: clean hands / possessed hands / deck / floor', `${meanAt('clean')} / ${meanAt('possessed')} / ${meanAt('deck')} / ${meanAt('floor')}`],
  ['Fire Exit revealed: median round', `${median(v.exitRounds)} (never revealed in ${v.exitNever} of ${N})`],
  ['  … by round 1-2 / 3-4 / 5-6 / 7-8', [[1, 2], [3, 4], [5, 6], [7, 8]].map(([a, b]) => pct(v.exitRounds.filter(x => x >= a && x <= b).length)).join(' / ')],
  ['Tiles explored per match: median (fewest-most) of 24', `${median(v.tiles)} (${Math.min(...v.tiles)}-${Math.max(...v.tiles)})`],
  ['Doors opened / jammed per match', `${avg(v, 'opened')} / ${avg(v, 'jammed')}`],
  ['Meetings per match: median (average)', `${median(v.meetingsPer)} (${avg(v, 'meetings')})`],
  ['Meetings per round', perRound(v, 'meetings')],
  ['Hotel closed itself off before the Fire Exit', `${v.closedOff} times`],
  ['Possession attempts / succeeded / blocked', `${avg(v, 'attempts')} / ${avg(v, 'possessed')} / ${avg(v, 'blocked')}`],
  ['Lanterns found / burned', `${avg(v, 'found')} / ${avg(v, 'burned')}`],
  ['Attacks / deaths', `${avg(v, 'attacks')} / ${avg(v, 'deaths')}`],
];
for (const [name, val] of lines) console.log(name.padEnd(64) + val);
console.log('\n| | |\n| --- | --- |');
for (const [name, val] of lines) console.log(`| ${name.trim()} | ${val} |`);

// Rooms with jobs and the new cards: averages per match; "in X%" = the share of matches where it
// happened at least once, and — for a room or card — the share of the matches where it was there to
// use (the room on the board, the card in someone's hand).
const inPct = k => pct(v.anyIn[k] || 0);
const whenThere = (used, there) => (v.chance[there] ? `${Math.round((v.usedWhenThere[used] || 0) / v.chance[there] * 100)}%` : '—');
const use = (used, there, what) => `${avg(v, used)} (in ${inPct(used)} of matches; ${whenThere(used, there)} of those with ${what})`;
const NAMES = Object.fromEntries(DECK_TYPES.map(t => [t, rules.cards[t].name]));
const jobs = [
  ['Linen Stores on the board (of 2)', `${avg(v, 'linenOnBoard')} (at least one in ${inPct('linenOnBoard')})`],
  ['Linen Store searches (2-card draws)', use('linenSearches', 'linenOnBoard', 'one on the board')],
  ['  … cards drawn there / left behind (hand full)', `${avg(v, 'linenCards')} / ${avg(v, 'linenLeft')}`],
  ['Infirmaries on the board (of 2)', `${avg(v, 'infirmaryOnBoard')} (at least one in ${inPct('infirmaryOnBoard')})`],
  ['Infirmary treatments', use('infirmaryUses', 'infirmaryOnBoard', 'one on the board')],
  ['  … health restored / Bandages used (for comparison)', `${avg(v, 'healthRestored')} / ${avg(v, 'bandages')}`],
  ['Switchboard on the board', `in ${inPct('switchOnBoard')}`],
  ['Switchboard calls', use('switchCalls', 'switchOnBoard', 'it on the board')],
  ['  … calls that told a clean guest something new', `${avg(v, 'switchLearned')} (in ${inPct('switchLearned')})`],
  ['  … possessed guests worked out from the count', `${avg(v, 'switchUnmasked')}`],
  ['Hand Mirrors in hand at the start / drawn by searching', `${avg(v, 'dealt:handMirror')} / ${avg(v, 'drawn:handMirror')}`],
  ['Hand Mirrors used', use('mirrors', 'mirrorsHeld', 'one in a hand')],
  ['  … used on a possessed guest', `${avg(v, 'mirrorOnPossessed')} (in ${inPct('mirrorOnPossessed')})`],
  ['  … unmasked a possessed guest (saw a Possession card)', `${avg(v, 'mirrorUnmasked')} (in ${inPct('mirrorUnmasked')})`],
  ['  … possessed, but holding no Possession card (looked clean)', `${avg(v, 'mirrorMissed')}`],
  ['Espressos in hand at the start / drawn by searching', `${avg(v, 'dealt:espresso')} / ${avg(v, 'drawn:espresso')}`],
  ['Espressos drunk', use('espresso', 'espressoHeld', 'one in a hand')],
  ['  … extra actions gained / left unused at the end of the turn', `${avg(v, 'espressoAP')} / ${avg(v, 'espressoUnused')}`],
  ['Meetings where a guest had no card to give (no trade made)', `${v.sums.emptyHanded} in ${N} matches`],
  ['Cards drawn by searching, per match', DECK_TYPES.map(t => `${NAMES[t]} ${avg(v, `drawn:${t}`)}`).join(', ')],
];
console.log('\nRooms with jobs and new cards (per match)\n');
for (const [name, val] of jobs) console.log(name.padEnd(64) + val);
console.log('\n| | |\n| --- | --- |');
for (const [name, val] of jobs) console.log(`| ${name.trim()} | ${val} |`);

if (process.argv.includes('--before')) {
  // Before Part 2: the old 40-card deck, and the five rooms with jobs as plain rooms of the same shapes
  // (the five ordinary tiles they replaced had exactly those doorway shapes). Same bots, same seeds.
  const deck = rules.deck, data = floor.data;
  rules.deck = { lantern: 12, bandage: 7, flashlight: 5, knife: 4, barricade: 4, lockPick: 4, revolver: 2, masterKey: 2 };
  floor.data = { ...data, tiles: data.tiles.map(t => ({ ...t, job: undefined })) };
  const before = run('Before Part 2', 'discard', 0);
  rules.deck = deck; floor.data = data;
  const rows = [
    ['Clean guests win', x => pct(x.humans)],
    ['The hotel wins', x => pct(x.hotel)],
    ['  … by possessing or killing every clean guest', x => pct(x.hotelOther)],
    ['  … at dawn', x => pct(x.dawn)],
    ['Match length, median rounds', x => String(median(x.rounds))],
    ['Fire Exit revealed: median round (never)', x => `${median(x.exitRounds)} (${x.exitNever})`],
    ['Tiles explored per match: median', x => String(median(x.tiles))],
    ['Meetings per match: median (average)', x => `${median(x.meetingsPer)} (${avg(x, 'meetings')})`],
    ['Meetings per round', x => perRound(x, 'meetings')],
    ['Hotel closed itself off', x => `${x.closedOff}`],
    ['Possession attempts / succeeded / blocked', x => `${avg(x, 'attempts')} / ${avg(x, 'possessed')} / ${avg(x, 'blocked')}`],
    ['Lanterns found / burned', x => `${avg(x, 'found')} / ${avg(x, 'burned')}`],
    ['Attacks / deaths', x => `${avg(x, 'attacks')} / ${avg(x, 'deaths')}`],
  ];
  console.log('\nBefore and after Part 2 (same bots, seeds and hotels):\n');
  console.log('| | Before Part 2 | Part 2 (the game) |\n| --- | --- | --- |');
  for (const [name, f] of rows) console.log(`| ${name.trim()} | ${f(before)} | ${f(approved)} |`);
}

if (COMPARE) {
  const variants = [
    approved,
    run('Burned · 1 dealt each', 'discard', 1),
    run('To possessed · search only', 'attacker', 0),
    run('To possessed · 1 dealt each', 'attacker', 1),
  ];
  const rows = [
    ['Clean guests win', x => pct(x.humans)],
    ['The hotel wins', x => pct(x.hotel)],
    ['  … at dawn', x => pct(x.dawn)],
    ['Never ends', x => String(x.never)],
    ['Median rounds', x => String(median(x.rounds))],
    ['Possessions succeeded / blocked', x => `${avg(x, 'possessed')} / ${avg(x, 'blocked')}`],
    ['Lanterns found / burned', x => `${avg(x, 'found')} / ${avg(x, 'burned')}`],
  ];
  console.log('\nComparison (only the first column is the game):\n');
  console.log('| | ' + variants.map(x => x.label).join(' | ') + ' |');
  console.log('| --- |' + variants.map(() => ' --- |').join(''));
  for (const [name, f] of rows) console.log(`| ${name.trim()} | ${variants.map(f).join(' | ')} |`);
}
