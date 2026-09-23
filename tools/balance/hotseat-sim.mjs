// Balance simulation for the restored ruleset (dev tool, not part of the game).
//   node tools/balance/hotseat-sim.mjs [matches] [players]
//
// Plays whole matches through the PURE rules engine — no browser — with simple bots, and prints
// who wins and how often, possessions and meetings per match, how often Lanterns, weapons and
// Bandages are used, match length, and anything that looks broken.
//
// The bots are honest about hidden information with ONE exception, marked below: clean guests
// know which of their team-mates holds key pieces, standing in for the talking a real table
// does. They never suspect anyone except a guest they have personally unmasked with a Lantern.
// They never waste a turn and never bluff. Read the output as "what the rules do when played
// competently and mechanically", not as a prediction of a real evening.
import { rules, applyMode } from '../../src/data/rules.js';
import { floor1 } from '../../src/data/floor1.js';
import { roster } from '../../src/data/characters.js';
import { config } from '../../src/config.js';
import { buildFloor } from '../../src/game/floor.js';
import { piecesIn, hasAllPieces, weaponsIn } from '../../src/game/cards.js';
import * as S from '../../src/game/state.js';
import * as A from '../../src/game/actions.js';

const N = parseInt(process.argv[2], 10) || 400;
const PLAYERS = parseInt(process.argv[3], 10) || 6;
applyMode('hotseat', PLAYERS);
const floor = buildFloor(floor1, config);
const adj = new Map(floor.roomList.map(r => [r.id, [...r.neighbours]]));
const MAX_TURNS = 600;   // a match that runs this long is reported as stuck

// Shortest room path from `from` to any room in `targets`, honouring locked rooms and barricades.
function pathTo(st, from, targets, { throughLocked = false } = {}) {
  const want = new Set(targets);
  if (want.has(from)) return [from];
  const prev = new Map([[from, null]]); const q = [from];
  while (q.length) {
    const here = q.shift();
    const room = floor.rooms.get(here);
    for (const d of room.doorways) {
      const n = d.otherRoom(here);
      if (prev.has(n)) continue;
      if (S.isBarricaded(st, d.id)) continue;
      if (S.isLocked(st, n) && !(throughLocked && want.has(n))) continue;
      prev.set(n, here);
      if (want.has(n)) { const path = [n]; let c = here; while (c) { path.unshift(c); c = prev.get(c); } return path; }
      q.push(n);
    }
  }
  return null;
}

const rnd = arr => arr[Math.floor(Math.random() * arr.length)];

// TEAM TALK (the one piece of shared knowledge the clean bots have): the clean guest holding the
// most key pieces is "the carrier"; every other clean guest brings their pieces to them.
function carrierOf(st, me) {
  return st.players.filter(q => q.alive && !q.possessed && !me.knows.has(q.id))
    .sort((a, b) => piecesIn(b.hand).length - piecesIn(a.hand).length || a.index - b.index)[0] || null;
}

// What a bot gives in a trade. `partner` is who they are trading with.
function giveCard(st, me, partner, stats) {
  const hand = A.tradeableCards(me);
  if (me.possessed) {
    const pc = hand.find(c => c.type === 'possession');
    if (pc) return pc.id;
    return rnd(hand.filter(c => !piecesIn([c]).length) .length ? hand.filter(c => !c.type.match(/bow|shank|bit/)) : hand).id;
  }
  // Clean: (team talk) hand a key piece to the carrier, if that is who I am trading with.
  const mine = piecesIn(me.hand);
  const carrier = carrierOf(st, me);
  if (mine.length && carrier && carrier.id === partner.id && !partner.possessed) return mine[0].id;
  // Otherwise a Lantern, if I have one, because I cannot be sure who I am dealing with.
  const lan = hand.find(c => c.type === 'lantern');
  if (lan && !(partner.possessed === false && me.knows.size === 0 && false)) return lan.id;
  const spare = hand.filter(c => !c.type.match(/bow|shank|bit/) && !CARDS_WEAPON(c) && c.type !== 'flashlight');
  return (spare.length ? rnd(spare) : rnd(hand)).id;
}
const CARDS_WEAPON = c => !!rules.cards[c.type]?.weapon;

function botTurn(st, p, stats) {
  // Heal if hurt.
  const bd = p.hand.find(c => c.type === 'bandage');
  if (bd && p.health < rules.maxHealth && p.actionPoints >= 1) { if (A.useBandage(st, p, bd.id).ok) stats.bandages++; }

  let guard = 0;
  while (p.actionPoints > 0 && !st.finished && guard++ < 12) {
    const here = p.currentRoom;
    // Escape if I can.
    if (!p.possessed && hasAllPieces(p.hand)) {
      const path = pathTo(st, here, [floor.exitRoom]);
      const step = path && path.length > 1 ? path[1] : null;
      if (step) { S.enterRoom(st, floor, p, step); if (S.checkWin(st, floor, p)) return; if (meet(st, p, stats)) continue; continue; }
    }
    // Search here if worthwhile.
    if (A.canSearch(st, floor, p).ok) {
      const r = A.search(st, floor, p);
      if (r.kind === 'found') { stats.piecesFound += r.pieces.length; stats.pickups += r.cards.length - r.pieces.length; }
      if (r.kind === 'card' && r.full) { A.resolveFullHand(st, p, r.card, 'leave'); }
      continue;
    }
    // Open a locked room next door if I have the means and it is worth it.
    const lockedNear = S.adjacentLockedRooms(st, floor, p).filter(r => !st.searchedRooms.has(r) || st.roomDrops.has(r));
    const opener = p.hand.find(c => c.type === 'masterKey') || p.hand.find(c => c.type === 'lockPick');
    if (lockedNear.length && opener && p.actionPoints >= 1) {
      const r = A.useUnlock(st, floor, p, opener.id, lockedNear[0]);
      if (r.ok) { stats[opener.type === 'masterKey' ? 'masterKeys' : 'lockPicks']++; if (r.opened) stats.unlocked++; }
      continue;
    }
    // Where to go.
    let targets;
    if (p.possessed) {
      // Hunt: rooms holding a clean guest I have not yet possessed.
      targets = st.players.filter(q => q.alive && !q.possessed && q.id !== p.id && !floor.rooms.get(q.currentRoom).safe).map(q => q.currentRoom);
      if (!targets.length) targets = st.players.filter(q => q.alive && !q.possessed && q.id !== p.id).map(q => q.currentRoom);
    } else {
      const drops = [...st.roomDrops.keys()].filter(r => !S.isLocked(st, r) || opener);
      const unsearched = floor.roomList.filter(r => r.searchable && !st.searchedRooms.has(r.id)
        && (!r.dark || p.hand.some(c => c.type === 'flashlight')) && (!S.isLocked(st, r.id) || opener)).map(r => r.id);
      targets = drops.length ? drops : unsearched;
      // Team talk: bring my pieces to the carrier; the carrier goes to whoever holds a piece.
      const mine = piecesIn(p.hand).length;
      const carrier = carrierOf(st, p);
      if (mine && carrier && carrier.id !== p.id) targets = [carrier.currentRoom];
      else if (carrier && carrier.id === p.id && mine < rules.keyPiecesToEscape) {
        const holders = st.players.filter(q => q.alive && !q.possessed && q.id !== p.id && piecesIn(q.hand).length > 0);
        if (holders.length) targets = holders.map(q => q.currentRoom);
      }
      // A meeting only happens on ARRIVAL, so if my target is where I already stand, step out and back.
      if (targets.length === 1 && targets[0] === here) targets = adj.get(here).filter(r => !S.isLocked(st, r));
    }
    if (!targets?.length) targets = floor.roomList.filter(r => !st.discovered.has(r.id)).map(r => r.id);
    if (!targets.length) break;                                  // nothing left to do this turn
    const path = pathTo(st, here, targets, { throughLocked: !!opener });
    const step = path && path.length > 1 ? path[1] : null;
    if (!step || S.isLocked(st, step)) { stats.idleTurns++; break; }
    S.enterRoom(st, floor, p, step);
    stats.moves++;
    if (floor.rooms.get(step).isExit && S.checkWin(st, floor, p)) return;
    meet(st, p, stats);
  }
}

// A forced meeting on arrival, resolved the way the interface would.
function meet(st, p, stats) {
  const cands = S.pendingEncounters(st, floor, p);
  if (!cands.length) return false;
  // Clean: prefer someone not unmasked; possessed: prefer someone not yet possessed.
  const Q = p.possessed
    ? (cands.find(q => !q.possessed) || rnd(cands))
    : (cands.find(q => !p.knows.has(q.id)) || rnd(cands));
  S.lockEncounter(st, p.currentRoom, p.index, Q.index);
  stats.meetings++;
  const weapon = weaponsIn(p.hand)[0];
  const wantsAttack = weapon && p.actionPoints >= 1 && (
    (!p.possessed && p.knows.has(Q.id)) ||                              // I know they are possessed
    (p.possessed && !p.hand.some(c => c.type === 'possession') && !Q.possessed && piecesIn(Q.hand).length > 0));  // out of Possession, they carry pieces
  if (wantsAttack) {
    const r = A.resolveAttack(st, floor, p, Q, weapon.id);
    if (r.ok) { stats.attacks++; if (r.killed) stats.deaths++; }
    return true;
  }
  const mine = giveCard(st, p, Q, stats), theirs = giveCard(st, Q, p, stats);
  const r = A.resolveTrade(st, floor, p, Q, mine, theirs);
  if (r.ok) {
    stats.trades++;
    if (r.given[p.id] === 'lantern') stats.lanternsGiven++;
    if (r.given[Q.id] === 'lantern') stats.lanternsGiven++;
    if (r.given[p.id] === 'possession' || r.given[Q.id] === 'possession') stats.attempts++;
    stats.possessions += r.possessed.length;
    stats.blocks += r.blocks.length;
  }
  return true;
}

function match(seed) {
  const st = S.createState(floor, roster.slice(0, PLAYERS), seed, { mode: 'hotseat' });
  const stats = { meetings: 0, trades: 0, attacks: 0, deaths: 0, attempts: 0, possessions: 0, blocks: 0, lanternsGiven: 0,
    bandages: 0, masterKeys: 0, lockPicks: 0, unlocked: 0, barricades: 0, piecesFound: 0, pickups: 0, moves: 0, idleTurns: 0, reshuffles: 0 };
  let turns = 0;
  while (!st.finished && turns++ < MAX_TURNS) {
    const p = S.activePlayer(st);
    const pileBefore = st.drawPile.length;
    botTurn(st, p, stats);
    if (pileBefore === 0 && st.drawPile.length > 0) stats.reshuffles++;
    if (st.finished) break;
    // Hand limit at the end of the turn: shed the least useful cards.
    while (A.overHandLimit(p) > 0) {
      const shed = p.hand.find(c => c.type === 'barricade') || p.hand.find(c => c.type === 'lockPick') || p.hand.find(c => c.type !== 'possession' && !c.type.match(/bow|shank|bit/) && c.type !== 'lantern') || p.hand.find(c => c.type === 'lantern');
      if (!shed || !A.discardCard(st, p, shed.id).ok) break;
    }
    const r = S.endTurn(st, floor);
    if (r.finished) break;
    S.checkWin(st, floor);
  }
  return { won: st.won, rounds: st.round, turns, stuck: !st.finished, stats,
    possessedAtEnd: st.players.filter(p => p.possessed).length, deadAtEnd: st.players.filter(p => !p.alive).length,
    piecesHeldByClean: st.players.filter(p => !p.possessed && p.alive).reduce((n, p) => n + piecesIn(p.hand).length, 0),
    piecesHeldByPossessed: st.players.filter(p => p.possessed && p.alive).reduce((n, p) => n + piecesIn(p.hand).length, 0),
    piecesOnFloor: [...st.roomDrops.values()].flat().filter(c => rules.cards[c.type]?.piece).length,
    piecesLockedAway: [...st.roomDrops.entries()].filter(([r, cards]) => S.isLocked(st, r) && cards.some(c => rules.cards[c.type]?.piece)).length,
    keysLeft: st.drawPile.concat(st.discardPile, ...st.players.map(p => p.hand)).filter(c => c.type === 'masterKey' || c.type === 'lockPick').length };
}

const sum = {}; let humans = 0, possessed = 0, stuck = 0, rounds = 0, possEnd = 0, deadEnd = 0;
const roundsList = [];
const why = { possessedHoldsPiece: 0, pieceLockedAwayNoKeys: 0, other: 0 };
for (let i = 1; i <= N; i++) {
  const m = match(i * 7919 + 13);
  if (m.won === 'humans') humans++; else if (m.won === 'possessed') possessed++;
  if (m.stuck) {
    stuck++;
    if (m.piecesHeldByPossessed > 0) why.possessedHoldsPiece++;
    else if (m.piecesLockedAway > 0 && m.keysLeft === 0) why.pieceLockedAwayNoKeys++;
    else { why.other++; if (why.other <= 6) console.log(`    [stuck-other] seed ${i}: clean hold ${m.piecesHeldByClean}, floor ${m.piecesOnFloor}, lockedAway ${m.piecesLockedAway}, keysLeft ${m.keysLeft}, possessed ${m.possessedAtEnd}, dead ${m.deadAtEnd}`); }
  }
  rounds += m.rounds; roundsList.push(m.rounds); possEnd += m.possessedAtEnd; deadEnd += m.deadAtEnd;
  for (const [k, v] of Object.entries(m.stats)) sum[k] = (sum[k] || 0) + v;
}
roundsList.sort((a, b) => a - b);
const per = k => (sum[k] / N).toFixed(2);
const pct = n => `${(n / N * 100).toFixed(0)}%`;
console.log(`${N} matches, ${PLAYERS} players, the restored ruleset (docs/GAME_RULES.md)\n`);
console.log(`  clean guests win        ${pct(humans)}`);
console.log(`  the hotel wins          ${pct(possessed)}`);
console.log(`  stuck (no ending)       ${pct(stuck)}   (a match still running after ${MAX_TURNS} turns)`);
if (stuck) console.log(`     because a possessed guest holds a key piece: ${why.possessedHoldsPiece}   a piece is locked away with no keys left: ${why.pieceLockedAwayNoKeys}   other: ${why.other}`);
console.log(`  match length            ${(rounds / N).toFixed(1)} rounds on average; median ${roundsList[Math.floor(N / 2)]}, shortest ${roundsList[0]}, longest ${roundsList[N - 1]}`);
console.log(`  possessed at the end    ${(possEnd / N).toFixed(2)} of ${PLAYERS}   dead at the end ${(deadEnd / N).toFixed(2)}`);
console.log('\n  per match:');
console.log(`    meetings ${per('meetings')}   trades ${per('trades')}   attacks ${per('attacks')}   deaths ${per('deaths')}`);
console.log(`    possession attempts ${per('attempts')}   succeeded ${per('possessions')}   blocked by a Lantern ${per('blocks')}`);
console.log(`    Lanterns given in trades ${per('lanternsGiven')}   Bandages used ${per('bandages')}`);
console.log(`    Master Keys used ${per('masterKeys')}   Lock Picks used ${per('lockPicks')}   rooms unlocked ${per('unlocked')}`);
console.log(`    key pieces found ${per('piecesFound')} of 3   dropped cards picked up ${per('pickups')}   deck reshuffles ${per('reshuffles')}`);
console.log(`    moves ${per('moves')}   turns with nowhere useful to go ${per('idleTurns')}`);
