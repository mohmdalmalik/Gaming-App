// Balance simulation (dev tool, not part of the game).
//   node tools/balance/hotseat-sim.mjs [matches] [players]
//
// Plays whole matches through the PURE rules engine — no browser — with simple bots, under the
// approved rules and three comparison variants, and prints them side by side:
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
import { floor1 } from '../../src/data/floor1.js';
import { roster } from '../../src/data/characters.js';
import { config } from '../../src/config.js';
import { buildFloor } from '../../src/game/floor.js';
import { weaponsIn } from '../../src/game/cards.js';
import * as S from '../../src/game/state.js';
import * as A from '../../src/game/actions.js';

const N = parseInt(process.argv[2], 10) || 400;
const PLAYERS = parseInt(process.argv[3], 10) || 6;
applyMode('hotseat', PLAYERS);
const floor = buildFloor(floor1, config);
const MAX_TURNS = 600;          // 100 rounds at six players: a match still going is "never ends"
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
      targets = [floor.exitRoom];
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
      if (p.possessed) {
        targets = st.players.filter(q => q.alive && !q.possessed && !floor.rooms.get(q.currentRoom).safe).map(q => q.currentRoom);
      } else if (lanterns(p.hand).length && carrier && carrier.id !== p.id) {
        targets = [carrier.currentRoom];          // bring my Lanterns to the carrier
      } else {
        targets = [...st.roomDrops.keys()];
        if (!targets.length) targets = floor.roomList.filter(r => r.searchable && !st.searchedRooms.has(r.id)
          && (!r.dark || p.hand.some(c => c.type === 'flashlight')) && (!S.isLocked(st, r.id) || opener)).map(r => r.id);
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
  const m = { meetings: 0, trades: 0, attacks: 0, deaths: 0, attempts: 0, possessed: 0, blocked: 0, burned: 0, found: 0, stuckTurns: 0 };
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
  return { won: st.won, rounds: st.round, finished: st.finished, m, where,
    possessedAtEnd: st.players.filter(q => q.alive && q.possessed).length,
    possessionCardsLeft: st.players.filter(q => q.alive).reduce((n, q) => n + q.hand.filter(c => c.type === 'possession').length, 0),
    cleanAlive: st.players.filter(q => q.alive && !q.possessed).length };
}

function run(label, block, dealt) {
  rules.lanternBlock = block; rules.lanternsDealtEach = dealt;
  const out = { label, humans: 0, hotel: 0, never: 0, rounds: [], roundsH: [], roundsP: [], sums: {}, perRound: {},
    neverWhy: { starved: 0, hoarded: 0, other: 0 }, hoardSum: 0, firstPossRound: [] };
  for (let i = 1; i <= N; i++) {
    const r = match(i * 7919 + 13);
    if (r.won === 'humans') out.humans++; else if (r.won === 'possessed') out.hotel++; else out.never++;
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

const variants = [
  run('Approved: burned · search only', 'discard', 0),
  run('Burned · 1 dealt each', 'discard', 1),
  run('To possessed · search only', 'attacker', 0),
  run('To possessed · 1 dealt each', 'attacker', 1),
];

const pct = (n) => `${Math.round(n / N * 100)}%`;
const avg = (v, k) => (v.sums[k] / N).toFixed(2);
const median = a => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : '—');
const perRound = (v, k) => (v.perRound[k] / N).toFixed(2);
const rows = [
  ['Clean guests win', v => pct(v.humans)],
  ['The hotel wins', v => pct(v.hotel)],
  ['Never ends (100+ rounds)', v => pct(v.never)],
  ['  … clean side can never reach 3 Lanterns', v => pct(v.neverWhy.starved + v.neverWhy.hoarded)],
  ['  … Lanterns stuck with the possessed', v => (v.never ? (v.hoardSum / v.never).toFixed(1) : '—')],
  ['  … and no Possession cards left', v => (v.never ? `${Math.round((v.deadlock || 0) / v.never * 100)}% of them` : '—')],
  ['  … clean guests still alive', v => (v.never ? (v.cleanLeftSum / v.never).toFixed(1) : '—')],
  ['Rounds when the clean side wins (median)', v => String(median(v.roundsH))],
  ['Rounds when the hotel wins (median)', v => String(median(v.roundsP))],
  ['Meetings per round', v => perRound(v, 'meetings')],
  ['Possession attempts', v => avg(v, 'attempts')],
  ['  … succeeded', v => avg(v, 'possessed')],
  ['  … blocked by a Lantern', v => avg(v, 'blocked')],
  ['Lanterns found by searching', v => avg(v, 'found')],
  ['Lanterns burned', v => avg(v, 'burned')],
  ['Attacks / deaths', v => `${avg(v, 'attacks')} / ${avg(v, 'deaths')}`],
];
console.log(`${N} matches per column, ${PLAYERS} players\n`);
const w0 = 42, w = 30;
console.log(''.padEnd(w0) + variants.map(v => v.label.padEnd(w)).join(''));
for (const [name, f] of rows) console.log(name.padEnd(w0) + variants.map(v => f(v).padEnd(w)).join(''));
console.log('\n| | ' + variants.map(v => v.label).join(' | ') + ' |');
console.log('| --- |' + variants.map(() => ' --- |').join(''));
for (const [name, f] of rows) console.log(`| ${name.trim()} | ${variants.map(f).join(' | ')} |`);
