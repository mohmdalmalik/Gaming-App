// Balance simulation (dev tool, not part of the game).
//   node tools/balance/hotseat-sim.mjs [matches] [players]            the rules as they stand
//   node tools/balance/hotseat-sim.mjs [matches] [players] --compare  plus three Lantern variants
//
// Plays whole matches through the PURE rules engine — no browser — with simple bots, each in a new
// random hotel that grows as the bots open doors. By default it reports the approved rules: who
// wins, dawn, match length, when the Fire Exit turns up, how much of the hotel gets explored,
// meetings, and whether the hotel ever closed itself off (it must not). With
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
// who blocked them with a Lantern. Bots never waste a turn and never bluff, so read the numbers
// as "the rules played competently and mechanically", not as a prediction of a real evening.
import { rules, applyMode } from '../../src/data/rules.js';
import { hotel } from '../../src/data/hotel.js';
import { roster } from '../../src/data/characters.js';
import { config } from '../../src/config.js';
import { createHotel, openDoors, exitPlaced } from '../../src/game/hotel.js';
import { weaponsIn } from '../../src/game/cards.js';
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
const lanterns = hand => hand.filter(c => c.type === 'lantern');
const rnd = arr => arr[Math.floor(Math.random() * arr.length)];

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

// Open a closed door of the room I stand in (1 AP). Counts how the hotel grows and checks, every
// time, that it has not closed itself off before the Fire Exit is on the board.
function openHere(st, p, m) {
  const doors = S.openableDoors(st, floor, p);
  if (!doors.length) return false;
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

// The card a bot gives in a trade.
function giveCard(st, me, partner) {
  const hand = A.tradeableCards(me);
  if (me.possessed) {
    const pc = hand.find(c => c.type === 'possession');
    if (pc && !partner.possessed) return pc.id;
    // Look innocent, and keep the Lanterns away from the clean side.
    const plain = hand.filter(c => c.type !== 'possession' && c.type !== 'lantern');
    return (plain.length ? rnd(plain) : rnd(hand)).id;
  }
  const lan = lanterns(hand);
  const carrier = carrierOf(st, me);
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
    if (r.ok) { m.attacks++; if (r.killed) m.deaths++; }
    return;
  }
  const r = A.resolveTrade(st, floor, p, Q, giveCard(st, p, Q), giveCard(st, Q, p));
  if (!r.ok) return;
  m.trades++;
  if (r.given[p.id] === 'possession' || r.given[Q.id] === 'possession') m.attempts++;
  m.possessed += r.possessed.length;
  m.blocked += r.blocks.length;
  m.burned += r.lanternsBurned || 0;
}

function botTurn(st, p, m) {
  const bd = p.hand.find(c => c.type === 'bandage');
  if (bd && p.health < rules.maxHealth) A.useBandage(st, p, bd.id);
  let guard = 0;
  while (p.actionPoints > 0 && !st.finished && guard++ < 12) {
    const here = p.currentRoom;
    const opener = p.hand.find(c => c.type === 'masterKey') || p.hand.find(c => c.type === 'lockPick');
    const carrier = carrierOf(st, p);
    let targets;
    if (!p.possessed && lanterns(p.hand).length >= rules.lanternsToEscape) {
      // Three Lanterns: to the Fire Exit — or, until it has turned up, keep opening doors.
      if (floor.exitRoom) targets = [floor.exitRoom];
      else { if (openHere(st, p, m)) continue; targets = roomsWithClosedDoors(st); }
    } else {
      if (A.canSearch(st, floor, p).ok) {
        const r = A.search(st, floor, p);
        if (r.kind === 'card') {
          if (r.card.type === 'lantern') m.found++;
          if (r.full) {
            // Keep a Lantern (drop something else); otherwise leave the new card.
            const drop = r.card.type === 'lantern' && p.hand.find(c => c.type !== 'lantern' && c.type !== 'possession');
            A.resolveFullHand(st, p, r.card, drop ? 'take' : 'leave', drop?.id);
          }
        }
        continue;
      }
      const lockedNear = S.adjacentLockedRooms(st, floor, p).filter(r => !st.searchedRooms.has(r));
      if (lockedNear.length && opener) { A.useUnlock(st, floor, p, opener.id, lockedNear[0]); continue; }
      // Clean guests explore while the Fire Exit has not turned up: open a closed door of this room
      // (the room behind is searched next), since searching alone never finds the way out.
      if (!p.possessed && !floor.exitRoom && EXPLORE && openHere(st, p, m)) continue;
      if (p.possessed) {
        targets = st.players.filter(q => q.alive && !q.possessed && !floor.rooms.get(q.currentRoom).safe).map(q => q.currentRoom);
        if (!targets.length) { if (openHere(st, p, m)) continue; targets = roomsWithClosedDoors(st); }
      } else if (lanterns(p.hand).length && carrier && carrier.id !== p.id) {
        targets = [carrier.currentRoom];          // bring my Lanterns to the carrier
      } else {
        targets = [...st.roomDrops.keys()];
        if (!targets.length) targets = floor.roomList.filter(r => r.searchable && !st.searchedRooms.has(r.id)
          && (!r.dark || p.hand.some(c => c.type === 'flashlight')) && (!S.isLocked(st, r.id) || opener)).map(r => r.id);
        // ...and, while the exit is still hidden, rooms with a closed door to open are as good a goal.
        if (!floor.exitRoom && EXPLORE) targets = [...targets, ...roomsWithClosedDoors(st)];
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
    if (S.isLocked(st, step)) { if (opener) { A.useUnlock(st, floor, p, opener.id, step); continue; } break; }
    S.enterRoom(st, floor, p, step);
    if (floor.rooms.get(step).isExit && S.checkWin(st, floor, p)) return;
    meet(st, p, m);
  }
}

function match(seed) {
  const st = S.createState(floor, roster.slice(0, PLAYERS), seed, { mode: 'hotseat' });
  const m = { meetings: 0, trades: 0, attacks: 0, deaths: 0, attempts: 0, possessed: 0, blocked: 0, burned: 0, found: 0, stuckTurns: 0, opened: 0, jammed: 0, closedOff: 0 };
  let turns = 0;
  while (!st.finished && turns++ < MAX_TURNS) {
    const p = S.activePlayer(st);
    botTurn(st, p, m);
    if (st.finished) break;
    while (A.overHandLimit(p) > 0) {
      const shed = p.hand.find(c => c.type === 'barricade') || p.hand.find(c => c.type === 'lockPick')
        || p.hand.find(c => c.type !== 'possession' && c.type !== 'lantern') || p.hand.find(c => c.type === 'lantern');
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
  return { won: st.won, dawn: !!st.dawn, dawnState, rounds: Math.min(st.round, rules.roundLimit), finished: st.finished, m, where,
    possessedAtEnd: st.players.filter(q => q.alive && q.possessed).length,
    possessionCardsLeft: st.players.filter(q => q.alive).reduce((n, q) => n + q.hand.filter(c => c.type === 'possession').length, 0),
    cleanAlive: st.players.filter(q => q.alive && !q.possessed).length };
}

function run(label, block, dealt) {
  rules.lanternBlock = block; rules.lanternsDealtEach = dealt;
  const out = { label, humans: 0, hotel: 0, never: 0, rounds: [], roundsH: [], roundsP: [], sums: {}, perRound: {},
    dawn: 0, dawnStates: { stuck: 0, cleanLockedOut: 0, inPlay: 0 }, hotelOther: 0, lanternsAtDawn: [],
    exitRounds: [], exitNever: 0, tiles: [], closedOff: 0, meetingsPer: [],
    neverWhy: { starved: 0, hoarded: 0, other: 0 }, hoardSum: 0, firstPossRound: [] };
  for (let i = 1; i <= N; i++) {
    const r = match(i * 7919 + 13);
    if (r.won === 'humans') out.humans++; else if (r.won === 'possessed') out.hotel++; else out.never++;
    if (r.m.exitRound) out.exitRounds.push(r.m.exitRound); else out.exitNever++;
    out.tiles.push(r.m.tiles); out.closedOff += r.m.closedOff; out.meetingsPer.push(r.m.meetings);
    if (r.dawn) { out.dawn++; out.dawnStates[r.dawnState]++; out.lanternsAtDawn.push(r.where); }
    else if (r.won === 'possessed') out.hotelOther++;
    if (r.finished) { out.rounds.push(r.rounds); (r.won === 'humans' ? out.roundsH : out.roundsP).push(r.rounds); }
    for (const [k, v] of Object.entries(r.m)) { out.sums[k] = (out.sums[k] || 0) + v; out.perRound[k] = (out.perRound[k] || 0) + v / r.rounds; }
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
