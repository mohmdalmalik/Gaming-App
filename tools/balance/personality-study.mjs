// Personality matches in the fast rules simulator (dev tool, not part of the game).
// Entered through tools/balance/hotseat-sim.mjs, so the default simulator run is unchanged:
//
//   node tools/balance/hotseat-sim.mjs --personalities rusher,slow,safe,aggressive,killer,team [--n 2000]
//        one table: these personalities in these seats (the role is dealt at random by the seed)
//        add --shuffle to shuffle the seats every match
//   node tools/balance/hotseat-sim.mjs --study [--scale 1] [--json out.json]
//        the whole study behind tests/personality-report.md: the mixed table, each personality alone,
//        each personality as the possessed guest vs five team players, each as one clean guest among
//        the others, 4- and 5-player tables, and the rule proposals (in-memory only)
//
// Plays through the PURE rules engine (src/game/*): every action goes through the same functions the
// game calls, which refuse anything illegal. The decisions come from tools/balance/personalities.mjs,
// shared with the real-UI harness (tests/autoplay.mjs --personalities).
//
// Rule PROPOSALS are measured with temporary in-memory overrides of the shared `rules` object (restored
// after each run) or, for two proposals the engine has no switch for, a small post-step applied here
// after the engine's own trade result. src/data/rules.js is never edited.
import { rules, applyMode } from '../../src/data/rules.js';
import { makeRng, shuffle } from '../../src/game/cards.js';
import * as S from '../../src/game/state.js';
import * as A from '../../src/game/actions.js';
import * as P from './personalities.mjs';

let floor, roster;
const MAX_TURNS = 600;
let TRACE = false;          // --trace: print every action of the (single) match
const say = (...a) => { if (TRACE) console.log(...a); };

// --- the common view (see personalities.mjs) ---------------------------------------------------------
function fullOf(st, personas) {
  return {
    round: st.round, turn: st.turn, exitRoom: floor.exitRoom, lobby: floor.start.room, lanternsToEscape: rules.lanternsToEscape,
    locks: [...st.encounterLocks],
    players: st.players.map(p => ({
      i: p.index, id: p.id, name: p.name, persona: personas[p.index], room: p.currentRoom, ap: p.actionPoints,
      health: p.health, alive: p.alive, escaped: st.escaped.has(p.id), possessed: p.possessed, hand: p.hand, knows: [...p.knows],
    })),
    rooms: floor.roomList.map(r => ({
      id: r.id, name: r.name, isExit: r.isExit, safe: r.safe, dark: r.dark, searchable: r.searchable,
      searched: st.searchedRooms.has(r.id), locked: st.lockedRooms.has(r.id), job: r.job,
      drops: (st.roomDrops.get(r.id) || []).length,
      doors: r.doorways.map(d => ({ id: d.id, to: d.otherRoom(r.id), barricaded: st.barricades.has(d.id) })),
      frontier: (r.frontier || []).map(f => ({ id: f.id, jammed: !!f.jammed })),
    })),
  };
}

const lanternsIn = cards => cards.filter(c => c.type === 'lantern').length;

// --- one match ----------------------------------------------------------------------------------------
// `assign(st, rng)` returns the personality of each seat, AFTER the deal (so a scenario can put a
// personality in the possessed seat). `ov` = sim-only post-steps for proposals.
function playMatch(seed, players, assign, ov = {}) {
  applyMode('hotseat', players);
  const st = S.createState(floor, roster.slice(0, players), seed, { mode: 'hotseat' });
  const rng = makeRng((seed * 2654435761) ^ 0x9e55a1);
  const personas = assign(st, rng);
  const mem = P.newMemory();
  const seats = st.players.map((p, i) => ({
    persona: personas[i], startPossessed: p.possessed, becamePossessed: false, possessedRound: null, alive: true, escaped: false,
    searches: 0, lanternsFound: 0, attacks: 0, kills: 0, killedBy: null, trades: 0, attempts: 0, blocks: 0, wasBlocked: 0, opens: 0, moves: 0, damageDealt: 0,
  }));
  const m = { meetings: 0, trades: 0, attacks: 0, kills: [], attempts: 0, attemptsOnHolder: 0, conversions: 0, convRounds: [], blocks: 0, skipped: 0, exitRound: null, lanternsFound: 0 };
  const view = () => fullOf(st, personas);

  function meet(p) {
    const cands = S.pendingEncounters(st, floor, p);
    if (!cands.length) return;
    const j = cands.length === 1 ? cands[0].index : P.decideMeetWhom(view(), p.index, cands.map(q => q.index), mem, rng);
    const Q = st.players[j];
    S.lockEncounter(st, p.currentRoom, p.index, Q.index);
    m.meetings++;
    const w = P.decideAttack(view(), p.index, Q.index, mem, rng);
    say(`    meeting ${p.name}${p.possessed ? '*' : ''} -> ${Q.name}${Q.possessed ? '*' : ''}: ${w ? 'ATTACK' : 'trade'}`);
    if (w) {
      const r = A.resolveAttack(st, floor, p, Q, w);
      if (r.ok) {
        m.attacks++; seats[p.index].attacks++; seats[p.index].damageDealt += r.damage;
        P.observe(mem, { type: 'attack', by: p.id, target: Q.id, killed: r.killed });
        if (r.killed) {
          seats[p.index].kills++; seats[Q.index].killedBy = p.index;
          m.kills.push({ by: p.index, victim: Q.index, byPossessed: p.possessed, victimPossessed: Q.possessed, round: st.round });
        }
        return;
      }
    }
    if (!A.canTrade(p, Q).ok) { A.skipTrade(st, floor, p, Q); m.skipped++; return; }
    const f = view();
    const cp = P.decideTradeCard(f, p.index, Q.index, A.tradeableCards(p).map(c => c.id), mem, rng);
    const cq = P.decideTradeCard(f, Q.index, p.index, A.tradeableCards(Q).map(c => c.id), mem, rng);
    const holding = st.players.map(x => lanternsIn(x.hand));
    const r = A.resolveTrade(st, floor, p, Q, cp, cq);
    if (!r.ok) return;
    say(`    trade: ${p.name} gives ${r.given[p.id]}, ${Q.name} gives ${r.given[Q.id]}${r.possessed.length ? ' => CONVERTED' : ''}${r.blocks.length ? ' => BLOCKED' : ''}`);
    m.trades++; seats[p.index].trades++; seats[Q.index].trades++;
    for (const [X, Y] of [[p, Q], [Q, p]]) {
      if (r.given[X.id] === 'possession' && r.given[Y.id] !== 'possession') {
        m.attempts++; seats[X.index].attempts++;
        if (holding[Y.index] > 0) m.attemptsOnHolder++;
      }
    }
    for (const b of r.blocks) {
      m.blocks++;
      const B = st.players.find(x => x.id === b.blocker), G = st.players.find(x => x.id === b.revealed);
      seats[B.index].blocks++; seats[G.index].wasBlocked++;
      // Proposal: the blocking Lantern is NOT used up — it goes back to the guest who blocked.
      if (ov.blockKeepsLantern) {
        const k = st.discardPile.findIndex(c => c.type === 'lantern');
        if (k >= 0) B.hand.push(st.discardPile.splice(k, 1)[0]);
      }
    }
    for (const e of r.possessed) {
      m.conversions++; m.convRounds.push(st.round);
      const X = st.players.find(x => x.id === e.newly);
      seats[X.index].becamePossessed = true; seats[X.index].possessedRound = st.round;
      // Proposal: a Possession card is spent when it converts someone (it leaves the game).
      if (ov.spendOnConvert) { const k = X.hand.findIndex(c => c.type === 'possession'); if (k >= 0) X.hand.splice(k, 1); }
      // Proposal: only the original possessed guest spreads possession — the card goes back to the giver.
      if (ov.returnToGiver) {
        const G = st.players.find(x => x.id === e.by);
        const k = X.hand.findIndex(c => c.type === 'possession');
        if (k >= 0 && G) G.hand.push(X.hand.splice(k, 1)[0]);
      }
    }
    S.checkWin(st, floor);
  }

  function exec(p, a) {
    const s = seats[p.index];
    switch (a.k) {
      case 'escape': { const r = A.escape(st, floor, p); if (r.ok) s.escaped = true; return r.ok; }
      case 'search': {
        const r = A.search(st, floor, p);
        if (!r.ok) return false;
        s.searches++;
        const drawn = r.kind === 'card' ? [r.card] : r.kind === 'cards' || r.kind === 'found' ? r.cards : [];
        if (r.kind !== 'found') { const L = lanternsIn(drawn); s.lanternsFound += L; m.lanternsFound += L; }
        for (const c of r.overflow || []) {
          const fh = P.decideFullHand(view(), p.index, c.type);
          A.resolveFullHand(st, p, c, fh.take && fh.dropId ? 'take' : 'leave', fh.dropId);
        }
        return true;
      }
      case 'open': {
        const r = A.openDoor(st, floor, p, a.door);
        if (!r.ok) return false;
        s.opens++;
        if (r.room.isExit) m.exitRound = st.round;
        return true;
      }
      case 'move': {
        const room = floor.rooms.get(p.currentRoom);
        const d = room.doorways.find(x => x.id === a.door);
        if (!d || d.otherRoom(p.currentRoom) !== a.to || !S.doorwayPassable(st, d)) return false;
        if (!S.canAffordRoute(st, floor, p, [p.currentRoom, a.to]).ok) return false;
        S.enterRoom(st, floor, p, a.to);
        s.moves++;
        meet(p);
        return true;
      }
      case 'job': {
        const g = A.canUseRoom(st, floor, p);
        if (!g.ok) return false;
        return (g.job === 'infirmary' ? A.useInfirmary(st, floor, p) : A.useSwitchboard(st, floor, p)).ok;
      }
      case 'card': {
        const r = a.type === 'bandage' ? A.useBandage(st, p, a.card)
          : a.type === 'espresso' ? A.useEspresso(st, p, a.card)
            : a.type === 'handMirror' ? A.useHandMirror(st, floor, p, a.card, a.target)
              : a.type === 'barricade' ? A.useBarricade(st, floor, p, a.card, a.target)
                : (a.type === 'masterKey' || a.type === 'lockPick') ? A.useUnlock(st, floor, p, a.card, a.target)
                  : { ok: false };
        return r.ok;
      }
      default: return false;
    }
  }

  let turns = 0;
  while (!st.finished && turns++ < MAX_TURNS) {
    const p = S.activePlayer(st);
    const failed = new Set();
    for (let guard = 0; guard < 40 && !st.finished; guard++) {
      const plan = P.decideAction(view(), p.index, mem, rng);
      let did = false, ended = false;
      for (const a of plan) {
        if (a.k === 'end') { ended = true; break; }
        const key = JSON.stringify(a);
        if (failed.has(key)) continue;
        if (TRACE && a.k === 'move') say(`  r${st.round} ${p.name}${p.possessed ? '*' : ''} (${personas[p.index]}) move -> ${a.to}`);
        if (exec(p, a)) { did = true; if (a.k !== 'move') say(`  r${st.round} ${p.name}${p.possessed ? '*' : ''} (${personas[p.index]}) ${a.k}${a.type ? ' ' + a.type : ''}${a.to ? ' -> ' + a.to : ''} ap${p.actionPoints} hp${p.health} [${p.hand.map(c => c.type).join(',')}]`); break; }
        failed.add(key);
      }
      if (ended || !did) break;
    }
    if (st.finished) break;
    while (A.overHandLimit(p) > 0) {
      const id = P.decideDiscard(view(), p.index, p.hand.filter(c => c.type !== 'possession').map(c => c.id));
      if (!A.discardCard(st, p, id).ok) break;
    }
    if (S.endTurn(st, floor).finished) break;
    S.checkWin(st, floor);
  }
  st.players.forEach((p, i) => { seats[i].alive = p.alive; seats[i].endPossessed = p.possessed; });
  const how = st.won === 'humans' ? 'escape' : st.dawn ? 'dawn' : st.won === 'possessed' ? 'allGone' : 'unfinished';
  const cleanDead = st.players.filter(p => !p.alive && !p.possessed).length;
  const where = {
    clean: st.players.filter(p => p.alive && !p.possessed).reduce((n, p) => n + lanternsIn(p.hand), 0),
    possessed: st.players.filter(p => p.alive && p.possessed).reduce((n, p) => n + lanternsIn(p.hand), 0),
    deck: lanternsIn(st.drawPile), discard: lanternsIn(st.discardPile),
    floor: [...st.roomDrops.values()].reduce((n, c) => n + lanternsIn(c), 0),
  };
  return {
    seed, players, won: st.won === 'humans' ? 'clean' : 'hotel', how, rounds: Math.min(st.round, rules.roundLimit), turns: st.turn,
    deaths: st.players.filter(p => !p.alive).length, cleanDead, seats, m, where,
    tilesOpened: floor.roomList.length - 1,
  };
}

// --- seat assignments ---------------------------------------------------------------------------------
const PERS = P.PERSONALITIES;
const possessedSeat = st => st.players.findIndex(p => p.possessed);
const assignMixed = players => (st, rng) => shuffle([...PERS], rng).slice(0, players);
const assignFixed = list => () => [...list];
const assignAll = persona => st => st.players.map(() => persona);
// `persona` in the possessed seat, the other seats `rest` (a persona, or 'mixed' for the other five).
const assignPossessed = (persona, rest) => (st, rng) => {
  const k = possessedSeat(st);
  const others = rest === 'mixed' ? shuffle(PERS.filter(x => x !== persona), rng) : st.players.map(() => rest);
  return st.players.map((_, i) => (i === k ? persona : others.shift() ?? rest));
};
// `persona` in a clean seat; the other five personalities (one each) in the other seats, one of them possessed.
const assignClean = persona => (st, rng) => {
  const k = possessedSeat(st);
  const cleanSeats = st.players.map((_, i) => i).filter(i => i !== k);
  const mine = cleanSeats[Math.floor(rng() * cleanSeats.length)];
  const others = shuffle(PERS.filter(x => x !== persona), rng);
  return st.players.map((_, i) => (i === mine ? persona : others.shift()));
};

// --- running a set and summarising it -----------------------------------------------------------------
function withRules(over, fn) {
  const saved = {};
  for (const k of Object.keys(over || {})) { saved[k] = rules[k]; rules[k] = over[k]; }
  if (over?.deck) rules.deck = { ...saved.deck, ...over.deck };
  try { return fn(); } finally { Object.assign(rules, saved); }
}

export function runSet({ label, n, players, assign, rulesOver = null, ov = {}, seedBase = 1 }) {
  const t0 = Date.now();
  const list = withRules(rulesOver, () => {
    const out = [];
    for (let k = 0; k < n; k++) out.push(playMatch(seedBase * 100003 + k * 7919 + 17, players, assign, ov));
    return out;
  });
  return summarise(label, list, players, Date.now() - t0);
}

const med = a => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const h = s.length >> 1; return s.length % 2 ? s[h] : (s[h - 1] + s[h]) / 2; };
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const ci = (k, n) => (n ? 1.96 * Math.sqrt((k / n) * (1 - k / n) / n) * 100 : 0);

export function summarise(label, list, players, ms = 0) {
  const n = list.length;
  const cnt = f => list.filter(f).length;
  const s = {
    label, n, players, ms,
    clean: cnt(r => r.won === 'clean'), escape: cnt(r => r.how === 'escape'), allGone: cnt(r => r.how === 'allGone'),
    allGoneKilled: cnt(r => r.how === 'allGone' && r.cleanDead > 0), dawn: cnt(r => r.how === 'dawn'),
    roundsMed: med(list.map(r => r.rounds)), roundsMean: mean(list.map(r => r.rounds)),
    turnsMed: med(list.map(r => r.turns)), turnsMean: mean(list.map(r => r.turns)),
    turnsP10: [...list.map(r => r.turns)].sort((a, b) => a - b)[Math.floor(n * 0.1)] ?? 0,
    turnsP90: [...list.map(r => r.turns)].sort((a, b) => a - b)[Math.floor(n * 0.9)] ?? 0,
    roundsEscape: mean(list.filter(r => r.how === 'escape').map(r => r.rounds)),
    roundsAllGone: mean(list.filter(r => r.how === 'allGone').map(r => r.rounds)),
    deaths: mean(list.map(r => r.deaths)), meetings: mean(list.map(r => r.m.meetings)), trades: mean(list.map(r => r.m.trades)),
    attacks: mean(list.map(r => r.m.attacks)), attempts: mean(list.map(r => r.m.attempts)), conversions: mean(list.map(r => r.m.conversions)),
    blocks: mean(list.map(r => r.m.blocks)), lanternsFound: mean(list.map(r => r.m.lanternsFound)),
    attemptsOnHolderPct: list.reduce((a, r) => a + r.m.attemptsOnHolder, 0) / Math.max(1, list.reduce((a, r) => a + r.m.attempts, 0)) * 100,
    convByRound: (() => { const h = {}; let t = 0; for (const r of list) for (const x of r.m.convRounds) { h[x] = (h[x] || 0) + 1; t++; } return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, +(v / t * 100).toFixed(1)])); })(),
    endRoundHist: (() => { const h = {}; for (const r of list) h[r.rounds] = (h[r.rounds] || 0) + 1; return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, +(v / list.length * 100).toFixed(1)])); })(),
    exitFound: cnt(r => r.m.exitRound != null), exitRound: mean(list.filter(r => r.m.exitRound != null).map(r => r.m.exitRound)),
    killsCleanOnClean: mean(list.map(r => r.m.kills.filter(k => !k.byPossessed && !k.victimPossessed).length)),
    killsOfPossessed: mean(list.map(r => r.m.kills.filter(k => k.victimPossessed).length)),
    killsByPossessed: mean(list.map(r => r.m.kills.filter(k => k.byPossessed).length)),
    where: Object.fromEntries(['clean', 'possessed', 'deck', 'discard', 'floor'].map(k => [k, mean(list.map(r => r.where[k]))])),
    per: {},
  };
  s.cleanPct = s.clean / n * 100; s.cleanCI = ci(s.clean, n);
  for (const persona of PERS) {
    const seats = list.flatMap(r => r.seats.map(x => ({ ...x, won: r.won }))).filter(x => x.persona === persona);
    if (!seats.length) continue;
    const c = seats.filter(x => !x.startPossessed), p = seats.filter(x => x.startPossessed);
    const k = f => seats.filter(f).length;
    s.per[persona] = {
      seats: seats.length, cleanSeats: c.length, possSeats: p.length,
      survive: k(x => x.alive) / seats.length * 100,
      escape: k(x => x.escaped) / seats.length * 100,
      gotPossessed: c.length ? c.filter(x => x.becamePossessed).length / c.length * 100 : null,
      killsPer: mean(seats.map(x => x.kills)), killed: k(x => x.killedBy != null) / seats.length * 100,
      winClean: c.length ? c.filter(x => x.won === 'clean').length / c.length * 100 : null,
      winCleanCI: ci(c.filter(x => x.won === 'clean').length, c.length),
      winPossessed: p.length ? p.filter(x => x.won === 'hotel').length / p.length * 100 : null,
      winPossessedCI: ci(p.filter(x => x.won === 'hotel').length, p.length),
      endWinning: k(x => (x.endPossessed ? x.won === 'hotel' : x.won === 'clean')) / seats.length * 100,
      searches: mean(seats.map(x => x.searches)), lanterns: mean(seats.map(x => x.lanternsFound)),
      attacks: mean(seats.map(x => x.attacks)), trades: mean(seats.map(x => x.trades)), attempts: mean(p.map(x => x.attempts)),
      conversionsWhenPossessed: null,
    };
  }
  return s;
}

// --- printing -----------------------------------------------------------------------------------------
const f0 = x => (x == null ? '—' : `${Math.round(x)}%`);
const f1 = x => (x == null ? '—' : x.toFixed(1));
const f2 = x => (x == null ? '—' : x.toFixed(2));
export function printSummary(s) {
  const pc = k => `${(s[k] / s.n * 100).toFixed(1)}%`;
  console.log(`\n### ${s.label}  (${s.n} matches, ${s.players} players, ${(s.ms / 1000).toFixed(1)} s)\n`);
  console.log(`| Clean win | Hotel win | …escape | …all possessed/dead | (…with a clean guest killed) | …dawn | Rounds med/mean | Turns med/mean (10–90%) | Deaths | Attacks | Trades | Poss. attempts / conversions / blocks | Lanterns found |`);
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  console.log(`| ${s.cleanPct.toFixed(1)}% ±${s.cleanCI.toFixed(1)} | ${(100 - s.cleanPct).toFixed(1)}% | ${pc('escape')} | ${pc('allGone')} | ${pc('allGoneKilled')} | ${pc('dawn')} | ${s.roundsMed} / ${f1(s.roundsMean)} | ${s.turnsMed} / ${f1(s.turnsMean)} (${s.turnsP10}–${s.turnsP90}) | ${f2(s.deaths)} | ${f2(s.attacks)} | ${f1(s.trades)} | ${f2(s.attempts)} / ${f2(s.conversions)} / ${f2(s.blocks)} | ${f1(s.lanternsFound)} |`);
  console.log(`\nLanterns at the end — clean hands ${f1(s.where.clean)}, possessed hands ${f1(s.where.possessed)}, deck ${f1(s.where.deck)}, discard (burned) ${f1(s.where.discard)}, floor ${f1(s.where.floor)}. Fire Exit found in ${f0(s.exitFound / s.n * 100)} (mean round ${f1(s.exitRound)}). Kills per match: clean-on-clean ${f2(s.killsCleanOnClean)}, of possessed ${f2(s.killsOfPossessed)}, by possessed ${f2(s.killsByPossessed)}.`);
  console.log(`Possession attempts on a guest holding a Lantern: ${f0(s.attemptsOnHolderPct)}. Conversions by round (%): ${JSON.stringify(s.convByRound)}. Match ends by round (%): ${JSON.stringify(s.endRoundHist)}.`);
  console.log('\n| Personality | Seats | Survive | Escaped | Got possessed (clean start) | Kills/match | Killed | Clean-side win when starting clean | Hotel win when starting possessed | Searches | Lanterns found | Attacks | Trades |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [k, v] of Object.entries(s.per)) {
    console.log(`| ${P.LABELS[k]} | ${v.seats} | ${f0(v.survive)} | ${f0(v.escape)} | ${f0(v.gotPossessed)} | ${f2(v.killsPer)} | ${f0(v.killed)} | ${f0(v.winClean)}${v.cleanSeats ? ` ±${v.winCleanCI.toFixed(0)}` : ''} (${v.cleanSeats}) | ${f0(v.winPossessed)}${v.possSeats ? ` ±${v.winPossessedCI.toFixed(0)}` : ''} (${v.possSeats}) | ${f1(v.searches)} | ${f2(v.lanterns)} | ${f2(v.attacks)} | ${f1(v.trades)} |`);
  }
}

// --- the study ----------------------------------------------------------------------------------------
// Rule proposals (simulator only). Each is { label, rulesOver (in-memory rules), ov (sim-only post-steps) }.
export const PROPOSALS = [
  { key: 'spend', label: 'A Possession card is spent when it converts someone', ov: { spendOnConvert: true } },
  { key: 'supply2', label: 'The possessed guest starts with 2 Possession cards (not 3)', rulesOver: { possessionSupply: 2 } },
  { key: 'keepLantern', label: 'A blocking Lantern is not used up (the blocker keeps it)', ov: { blockKeepsLantern: true } },
  { key: 'dawn10', label: 'Dawn after round 10 (not 8)', rulesOver: { roundLimit: 10 } },
  { key: 'dealt1', label: 'Each guest starts with 1 Lantern', rulesOver: { lanternsDealtEach: 1 } },
  { key: 'spend+keep', label: 'Spent on conversion + blocking Lantern kept', ov: { spendOnConvert: true, blockKeepsLantern: true } },
  { key: 'spend+dawn10', label: 'Spent on conversion + dawn after round 10', ov: { spendOnConvert: true }, rulesOver: { roundLimit: 10 } },
  { key: 'return', label: 'Only the first possessed guest can possess (a converted guest hands the card back)', ov: { returnToGiver: true } },
  { key: 'escape2', label: '2 Lanterns to escape (not 3)', rulesOver: { lanternsToEscape: 2 } },
  { key: 'spend+dealt1', label: 'Spent on conversion + each guest starts with 1 Lantern', ov: { spendOnConvert: true }, rulesOver: { lanternsDealtEach: 1 } },
  { key: 'supply2+dealt1', label: '2 Possession cards + each guest starts with 1 Lantern', rulesOver: { possessionSupply: 2, lanternsDealtEach: 1 } },
  { key: 'spend+dealt1+supply2', label: 'Spent on conversion + 1 Lantern each + 2 Possession cards', ov: { spendOnConvert: true }, rulesOver: { lanternsDealtEach: 1, possessionSupply: 2 } },
  { key: 'spend+dealt1+supply2+dawn10', label: 'Spent on conversion + 1 Lantern each + 2 Possession cards + dawn after round 10', ov: { spendOnConvert: true }, rulesOver: { lanternsDealtEach: 1, possessionSupply: 2, roundLimit: 10 } },
  { key: 'spend+dealt1+dawn10', label: 'Spent on conversion + 1 Lantern each + dawn after round 10', ov: { spendOnConvert: true }, rulesOver: { lanternsDealtEach: 1, roundLimit: 10 } },
];

export async function runPersonalityCli({ floor: fl, roster: ro, argv }) {
  floor = fl; roster = ro;
  const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
  const results = [];
  const run = spec => { const s = runSet(spec); printSummary(s); results.push(s); return s; };
  if (argv.includes('--personalities')) {
    const list = opt('personalities', PERS.join(',')).split(',').map(x => x.trim());
    for (const x of list) if (!PERS.includes(x)) throw new Error(`unknown personality ${x}`);
    const n = +opt('n', 2000);
    TRACE = argv.includes('--trace');
    run({ label: `Seats: ${list.join(', ')}${argv.includes('--shuffle') ? ' (shuffled each match)' : ''}`, n, players: list.length,
      assign: argv.includes('--shuffle') ? ((st, rng) => shuffle([...list], rng)) : assignFixed(list) });
  } else {
    const scale = +opt('scale', 1);
    const only = opt('only', null);
    const want = k => !only || only.split(',').includes(k);
    if (want('mixed')) run({ label: 'Mixed table: one of each personality, random seats and role', n: 12000 * scale, players: 6, assign: assignMixed(6), seedBase: 1 });
    if (want('alone')) for (const x of PERS) run({ label: `All six seats: ${P.LABELS[x]}`, n: 2000 * scale, players: 6, assign: assignAll(x), seedBase: 2 });
    if (want('vsteam')) for (const x of PERS) run({ label: `${P.LABELS[x]} POSSESSED vs five team players`, n: 2000 * scale, players: 6, assign: assignPossessed(x, 'team'), seedBase: 3 });
    if (want('clean')) for (const x of PERS) run({ label: `${P.LABELS[x]} as one CLEAN guest among the other five`, n: 2000 * scale, players: 6, assign: assignClean(x), seedBase: 4 });
    if (want('counts')) for (const n of [4, 5]) run({ label: `Mixed table, ${n} players (personalities drawn without replacement)`, n: 6000 * scale, players: n, assign: assignMixed(n), seedBase: 5 + n });
    if (want('proposals')) {
      // --pplayers 4,5,6 to measure the proposals at other table sizes; --pkeys spend,dealt1 for a subset.
      const keys = opt('pkeys', null)?.split(',');
      for (const np of (opt('pplayers', '6')).split(',').map(Number)) {
        run({ label: `Proposal baseline: mixed table, ${np} players, rules as they stand`, n: 6000 * scale, players: np, assign: assignMixed(np), seedBase: 9 });
        for (const pr of PROPOSALS.filter(x => !keys || keys.includes(x.key))) {
          run({ label: `Proposal (${np} players): ${pr.label}`, n: 6000 * scale, players: np, assign: assignMixed(np), rulesOver: pr.rulesOver, ov: pr.ov, seedBase: 9 });
        }
      }
    }
  }
  const json = opt('json', null);
  if (json) { const fs = await import('node:fs'); fs.writeFileSync(json, JSON.stringify(results, null, 1)); }
}
