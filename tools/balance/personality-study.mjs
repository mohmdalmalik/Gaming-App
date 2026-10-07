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
// after each run) or, for proposals the engine has no switch for, a small post-step applied here
// after the engine's own trade result (the `ov` flags: spendOnConvert, returnToGiver, blockKeepsLantern,
// possessNextRound, oneGeneration). src/data/rules.js is never edited. With every flag off and no
// override, a run is the same, seed for seed, as before any flag existed.
//
// The owner's health / possession-chain measures (7 Oct 2026) — an extra "Owner measures (health and possession
// chain)" line under every table, the matching JSON fields, and a "Side by side" table after the proposals —
// print only with --owner-measures, or by themselves when one of the owner's proposals runs (`owner: true`
// below) or a bot option is given. Without them, the output is byte for byte what it was before (run times
// aside). Bot options (simulator only, every run of the call, the baseline included):
//   --no-lantern-leak   a possessed bot with no Possession card and no weapon, holding only Lanterns, does not
//                       walk in on a clean guest (personalities.mjs, decideAction)
// The '+fixedHeal' proposals rerun an owner proposal with the bots healing at the original fixed health numbers
// (personalities.mjs, HEAL_AT_FIXED): a sensitivity row, since at 4 health WHEN a bot heals is a modelling choice.
import { rules, applyMode } from '../../src/data/rules.js';
import { makeRng, shuffle } from '../../src/game/cards.js';
import * as S from '../../src/game/state.js';
import * as A from '../../src/game/actions.js';
import * as P from './personalities.mjs';

let floor, roster;
const MAX_TURNS = 600;
let TRACE = false;          // --trace: print every action of the (single) match
let MEASURES = false;       // the owner's health / possession-chain measures (see the header)
const say = (...a) => { if (TRACE) console.log(...a); };

// --- the common view (see personalities.mjs) ---------------------------------------------------------
function fullOf(st, personas, bots = null) {
  return {
    ...(bots ? { bots } : {}),   // simulator-only bot options (personalities.mjs); none = the usual bots
    round: st.round, turn: st.turn, exitRoom: floor.exitRoom, lobby: floor.start.room, lanternsToEscape: rules.lanternsToEscape, maxHealth: rules.maxHealth,
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
const possessionsIn = cards => cards.filter(c => c.type === 'possession').length;

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
    gen: p.possessed ? 0 : null,   // possession generation: 0 = the first possessed guest, 1 = possessed by him, 2 = by one of those...
    searches: 0, lanternsFound: 0, attacks: 0, kills: 0, killedBy: null, trades: 0, attempts: 0, blocks: 0, wasBlocked: 0, opens: 0, moves: 0, damageDealt: 0,
  }));
  const m = { meetings: 0, trades: 0, attacks: 0, kills: [], attempts: 0, attemptsOnHolder: 0, conversions: 0, convRounds: [], blocks: 0, skipped: 0, exitRound: null, lanternsFound: 0,
    // Bookkeeping only (no dice, no decisions): conversions by the giver's generation, attempts by converted
    // guests, chains stopped by the one-generation proposal, the most guests possessed at once, heals used,
    // and what a possessed guest holding NO Possession card does when it walks in on a clean guest.
    convByGen: {}, attemptsConv: 0, chainStops: 0, maxPossessed: 1, heals: 0, cardless: { meets: 0, attacks: 0, trades: 0, skipped: 0 } };
  const view = () => fullOf(st, personas, ov.bots);

  function meet(p) {
    const cands = S.pendingEncounters(st, floor, p);
    if (!cands.length) return;
    const j = cands.length === 1 ? cands[0].index : P.decideMeetWhom(view(), p.index, cands.map(q => q.index), mem, rng);
    const Q = st.players[j];
    S.lockEncounter(st, p.currentRoom, p.index, Q.index);
    m.meetings++;
    const w = P.decideAttack(view(), p.index, Q.index, mem, rng);
    const cardless = p.possessed && !Q.possessed && possessionsIn(p.hand) === 0;
    if (cardless) m.cardless.meets++;
    say(`    meeting ${p.name}${p.possessed ? '*' : ''} -> ${Q.name}${Q.possessed ? '*' : ''}: ${w ? 'ATTACK' : 'trade'}`);
    if (w) {
      const r = A.resolveAttack(st, floor, p, Q, w);
      if (r.ok) {
        m.attacks++; seats[p.index].attacks++; seats[p.index].damageDealt += r.damage;
        if (cardless) m.cardless.attacks++;
        P.observe(mem, { type: 'attack', by: p.id, target: Q.id, killed: r.killed });
        if (r.killed) {
          seats[p.index].kills++; seats[Q.index].killedBy = p.index;
          m.kills.push({ by: p.index, victim: Q.index, byPossessed: p.possessed, victimPossessed: Q.possessed, round: st.round });
        }
        return;
      }
    }
    if (!A.canTrade(p, Q).ok) { A.skipTrade(st, floor, p, Q); m.skipped++; if (cardless) m.cardless.skipped++; return; }
    const f = view();
    // Proposal: a guest possessed this round cannot hand over a Possession card until the next round.
    const giveable = X => A.tradeableCards(X)
      .filter(c => !(ov.possessNextRound && c.type === 'possession' && seats[X.index].possessedRound === st.round))
      .map(c => c.id);
    const cp = P.decideTradeCard(f, p.index, Q.index, giveable(p), mem, rng);
    const cq = P.decideTradeCard(f, Q.index, p.index, giveable(Q), mem, rng);
    const holding = st.players.map(x => lanternsIn(x.hand));
    const r = A.resolveTrade(st, floor, p, Q, cp, cq);
    if (!r.ok) return;
    say(`    trade: ${p.name} gives ${r.given[p.id]}, ${Q.name} gives ${r.given[Q.id]}${r.possessed.length ? ' => CONVERTED' : ''}${r.blocks.length ? ' => BLOCKED' : ''}`);
    m.trades++; seats[p.index].trades++; seats[Q.index].trades++;
    if (cardless) m.cardless.trades++;
    for (const [X, Y] of [[p, Q], [Q, p]]) {
      if (r.given[X.id] === 'possession' && r.given[Y.id] !== 'possession') {
        m.attempts++; seats[X.index].attempts++;
        if (holding[Y.index] > 0) m.attemptsOnHolder++;
        if (seats[X.index].gen > 0) m.attemptsConv++;
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
      const giver = st.players.find(x => x.id === e.by);
      const gGen = giver ? seats[giver.index].gen ?? 0 : 0;
      seats[X.index].gen = gGen + 1;
      m.convByGen[gGen] = (m.convByGen[gGen] || 0) + 1;
      // Proposal: a Possession card is spent when it converts someone (it leaves the game).
      if (ov.spendOnConvert) { const k = X.hand.findIndex(c => c.type === 'possession'); if (k >= 0) X.hand.splice(k, 1); }
      // Proposal: only the original possessed guest spreads possession — the card goes back to the giver.
      if (ov.returnToGiver) {
        const G = st.players.find(x => x.id === e.by);
        const k = X.hand.findIndex(c => c.type === 'possession');
        if (k >= 0 && G) G.hand.push(X.hand.splice(k, 1)[0]);
      }
      // Proposal "one generation" (the owner's idea, reading 2): only the first possessed guest's cards
      // pass on. A guest HE possessed holds that one card (one chance); when such a converted guest
      // possesses someone with it, the card is used up (it leaves the game), so their victim holds no
      // Possession card and the chain stops there. A blocked attempt is unchanged (both cards discarded).
      if (ov.oneGeneration && gGen > 0) {
        const k = X.hand.findIndex(c => c.type === 'possession');
        if (k >= 0) { X.hand.splice(k, 1); m.chainStops++; }
        say(`    one generation: ${X.name}'s Possession card is used up (the chain stops)`);
      }
    }
    if (r.possessed.length) m.maxPossessed = Math.max(m.maxPossessed, st.players.filter(x => x.alive && x.possessed).length);
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
        // Everything found is kept, even past 6 (approved): settled by the end-of-turn discard below.
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
        if (!d || d.otherRoom(p.currentRoom) !== a.to || !S.doorwayPassable(st, d, p.currentRoom)) return false;
        if (!S.canAffordRoute(st, floor, p, [p.currentRoom, a.to]).ok) return false;
        S.enterRoom(st, floor, p, a.to);
        s.moves++;
        meet(p);
        return true;
      }
      case 'job': {
        const g = A.canUseRoom(st, floor, p);
        if (!g.ok) return false;
        const r = g.job === 'infirmary' ? A.useInfirmary(st, floor, p) : A.useSwitchboard(st, floor, p);
        if (r.ok && g.job === 'infirmary') m.heals++;
        return r.ok;
      }
      case 'card': {
        const r = a.type === 'bandage' ? A.useBandage(st, p, a.card)
          : a.type === 'espresso' ? A.useEspresso(st, p, a.card)
            : a.type === 'handMirror' ? A.useHandMirror(st, floor, p, a.card, a.target)
              : a.type === 'barricade' ? A.useBarricade(st, floor, p, a.card, a.target)
                : (a.type === 'masterKey' || a.type === 'lockPick') ? A.useUnlock(st, floor, p, a.card, a.target)
                  : { ok: false };
        if (r.ok && a.type === 'bandage') m.heals++;
        return r.ok;
      }
      default: return false;
    }
  }

  // Snapshot of the table at the end of round 2 (or at the end of the match, if it ended sooner).
  const origPossessed = st.players.find(p => p.possessed);
  const possIn = cards => cards.filter(c => c.type === 'possession').length;
  let r2 = null;
  const snapR2 = () => ({
    ended: st.finished,
    supplyLeft: origPossessed.alive ? possIn(origPossessed.hand) : 0,   // the starting 3, still in the first possessed guest's hand
    origDead: !origPossessed.alive,                                     // his cards left the game with him, not handed out
    inPlay: st.players.filter(p => p.alive).reduce((n, p) => n + possIn(p.hand), 0),   // Possession cards anyone living still holds
    inPlayConv: st.players.filter(p => p.alive && p !== origPossessed).reduce((n, p) => n + possIn(p.hand), 0),   // ...of them, held by converted guests
    clean: st.players.filter(p => p.alive && !p.possessed).length,     // living clean guests (an escaped guest counts: still clean)
    conversions: m.conversions,
  });

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
    const roundBefore = st.round;
    const passed = S.endTurn(st, floor);
    // (The rules refuse to end a turn over the hand limit; the bots always discard first.)
    if (passed.ok === false) throw new Error(`bot ${p.name} ended a turn ${passed.over} over the hand limit`);
    const endedNow = passed.finished;
    if (!r2 && roundBefore === 2 && st.round === 3) r2 = snapR2();
    if (endedNow) break;
    S.checkWin(st, floor);
  }
  if (!r2) r2 = snapR2();   // the match ended before round 2 was over
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
    seed, players, won: st.won === 'humans' ? 'clean' : 'hotel', how, rounds: Math.min(st.round, rules.roundLimit), turns: Math.min(turns, MAX_TURNS),   // turns actually played (st.turn counts the unplayed dawn turn)
    deaths: st.players.filter(p => !p.alive).length, cleanDead, seats, m, where, r2,
    ghostCardsLeft: origPossessed.alive ? possIn(origPossessed.hand) : 0,   // Possession cards the first possessed guest never used
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
    // The owner's five measurements (4 Oct 2026).
    r2SupplyGone: cnt(r => r.r2.supplyLeft === 0), r2SupplyGoneDead: cnt(r => r.r2.supplyLeft === 0 && r.r2.origDead),
    r2NoneInPlay: cnt(r => r.r2.inPlay === 0),
    r2Running: cnt(r => !r.r2.ended),
    r2SupplyGoneRunning: cnt(r => !r.r2.ended && r.r2.supplyLeft === 0),
    r2CleanMeanRunning: mean(list.filter(r => !r.r2.ended).map(r => r.r2.clean)),
    noConversion: cnt(r => r.m.conversions === 0),
    r2CleanMean: mean(list.map(r => r.r2.clean)), r2CleanMed: med(list.map(r => r.r2.clean)),
    r2CleanHist: (() => { const h = {}; for (const r of list) h[r.r2.clean] = (h[r.r2.clean] || 0) + 1; return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, +(v / list.length * 100).toFixed(1)])); })(),
    r2Ended: cnt(r => r.r2.ended),
    roundsP90: [...list.map(r => r.rounds)].sort((a, b) => a - b)[Math.floor(n * 0.9)] ?? 0,
    per: {},
  };
  s.cleanPct = s.clean / n * 100; s.cleanCI = ci(s.clean, n);
  // The owner's health / possession-chain measurements (7 Oct 2026): added fields only, and only with MEASURES
  // (see the header), so a run without them gives the same JSON as before.
  if (MEASURES) Object.assign(s, {
    deathsClean: mean(list.map(r => r.cleanDead)), deathsPossessed: mean(list.map(r => r.deaths - r.cleanDead)),
    killsByClean: mean(list.map(r => r.m.kills.filter(k => !k.byPossessed).length)),
    attacksPerKill: list.reduce((a, r) => a + r.m.attacks, 0) / Math.max(1, list.reduce((a, r) => a + r.m.kills.length, 0)),
    heals: mean(list.map(r => r.m.heals ?? 0)),
    convByOrig: mean(list.map(r => r.m.convByGen?.[0] ?? 0)),
    convByConv: mean(list.map(r => Object.entries(r.m.convByGen || {}).reduce((a, [g, v]) => a + (+g > 0 ? v : 0), 0))),
    convByGen2: mean(list.map(r => r.m.convByGen?.[1] ?? 0)),     // by a guest the first possessed guest converted
    convByGen3: mean(list.map(r => Object.entries(r.m.convByGen || {}).reduce((a, [g, v]) => a + (+g > 1 ? v : 0), 0))),   // further down the chain
    attemptsConv: mean(list.map(r => r.m.attemptsConv ?? 0)),
    chainStops: mean(list.map(r => r.m.chainStops ?? 0)),
    maxPossMean: mean(list.map(r => r.m.maxPossessed ?? 1)),
    maxPossHist: (() => { const h = {}; for (const r of list) h[r.m.maxPossessed] = (h[r.m.maxPossessed] || 0) + 1; return Object.fromEntries(Object.entries(h).map(([k, v]) => [k, +(v / n * 100).toFixed(1)])); })(),
    r2InPlayMean: mean(list.map(r => r.r2.inPlay)), r2InPlayConv: mean(list.map(r => r.r2.inPlayConv ?? 0)),
    cardless: (() => { const t = { meets: 0, attacks: 0, trades: 0, skipped: 0 }; for (const r of list) for (const k in t) t[k] += r.m.cardless?.[k] ?? 0; return { perMatch: t.meets / Math.max(1, n), ...t }; })(),
    // The first possessed guest: never tried to possess anyone / ended alive still holding Possession cards;
    // and the clean-side win without the matches where he is the Safe bot (who tries only guests claiming no
    // Lantern, so with a Lantern dealt to everyone he rarely uses his cards and inflates every clean-win level).
    ghostNoAttempt: cnt(r => (r.seats.find(x => x.startPossessed)?.attempts ?? 0) === 0),
    ghostKept: cnt(r => (r.ghostCardsLeft ?? 0) > 0),
    safeGhost: cnt(r => r.seats.find(x => x.startPossessed)?.persona === 'safe'),
    cleanNoSafeGhost: cnt(r => r.won === 'clean' && r.seats.find(x => x.startPossessed)?.persona !== 'safe'),
  });
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
// Half-up rounding, for numbers only the owner-measure outputs print (toFixed rounds the binary value, so an
// exact 0.045 prints 0.04). A number an older line also prints keeps that line's formatter, so it reads the same.
const hu = (x, d) => (x == null ? '—' : (Math.round(+(x * 10 ** d).toPrecision(12)) / 10 ** d).toFixed(d));
const h0 = x => (x == null ? '—' : `${hu(x, 0)}%`), h1 = x => hu(x, 1), h2 = x => hu(x, 2);
export function printSummary(s) {
  const pc = k => `${(s[k] / s.n * 100).toFixed(1)}%`;
  console.log(`\n### ${s.label}  (${s.n} matches, ${s.players} players, ${(s.ms / 1000).toFixed(1)} s)\n`);
  console.log(`| Clean win | Hotel win | …escape | …all possessed/dead | (…with a clean guest killed) | …dawn | Rounds med/mean | Turns med/mean (10–90%) | Deaths | Attacks | Trades | Poss. attempts / conversions / blocks | Lanterns found |`);
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  console.log(`| ${s.cleanPct.toFixed(1)}% ±${s.cleanCI.toFixed(1)} | ${(100 - s.cleanPct).toFixed(1)}% | ${pc('escape')} | ${pc('allGone')} | ${pc('allGoneKilled')} | ${pc('dawn')} | ${s.roundsMed} / ${f1(s.roundsMean)} | ${s.turnsMed} / ${f1(s.turnsMean)} (${s.turnsP10}–${s.turnsP90}) | ${f2(s.deaths)} | ${f2(s.attacks)} | ${f1(s.trades)} | ${f2(s.attempts)} / ${f2(s.conversions)} / ${f2(s.blocks)} | ${f1(s.lanternsFound)} |`);
  console.log(`\nLanterns at the end — clean hands ${f1(s.where.clean)}, possessed hands ${f1(s.where.possessed)}, deck ${f1(s.where.deck)}, discard (burned) ${f1(s.where.discard)}, floor ${f1(s.where.floor)}. Fire Exit found in ${f0(s.exitFound / s.n * 100)} (mean round ${f1(s.exitRound)}). Kills per match: clean-on-clean ${f2(s.killsCleanOnClean)}, of possessed ${f2(s.killsOfPossessed)}, by possessed ${f2(s.killsByPossessed)}.`);
  console.log(`Owner measures — after round 2: no Possession card left in play anywhere ${pc('r2NoneInPlay')}; the first possessed guest has none left ${pc('r2SupplyGone')} (of which he was killed ${pc('r2SupplyGoneDead')}; among matches still running ${f0(s.r2SupplyGoneRunning / Math.max(1, s.r2Running) * 100)}); living clean guests mean ${f1(s.r2CleanMean)} (median ${s.r2CleanMed}) of ${s.players - 1} ${JSON.stringify(s.r2CleanHist)}, in matches still running ${f1(s.r2CleanMeanRunning)}; match already over ${pc('r2Ended')}. No successful conversion all match: ${pc('noConversion')}. Fire Exit found: ${pc('exitFound')}. Rounds median ${s.roundsMed} (90th pct ${s.roundsP90}), turns median ${s.turnsMed} (10–90% ${s.turnsP10}–${s.turnsP90}).`);
  if (s.cardless) {   // the owner's health / possession-chain measures (only with MEASURES, see the header)
    const cl = s.cardless, clp = k => h0(cl[k] / Math.max(1, cl.meets) * 100), hp = k => h0(s[k] / s.n * 100);
    console.log(`Owner measures (health and possession chain) — deaths per match ${f2(s.deaths)} (clean guests ${h2(s.deathsClean)}, possessed ${h2(s.deathsPossessed)}); kills by clean guests ${h2(s.killsByClean)}, by possessed guests ${f2(s.killsByPossessed)}; attacks per kill ${h1(s.attacksPerKill)}; heals used ${h2(s.heals)}. Conversions per match ${f2(s.conversions)}: by the first possessed guest ${h2(s.convByOrig)}, by converted guests ${h2(s.convByConv)} (by guests he converted ${h2(s.convByGen2)}, further down the chain ${h2(s.convByGen3)}); possession attempts by converted guests ${h2(s.attemptsConv)}; chains stopped by the one-generation rule ${h2(s.chainStops)}. Most guests possessed at once: mean ${h1(s.maxPossMean)} ${JSON.stringify(s.maxPossHist)}. Possession cards in play after round 2: mean ${h2(s.r2InPlayMean)} (first possessed ${h2(s.r2InPlayMean - s.r2InPlayConv)}, converted guests ${h2(s.r2InPlayConv)}), none ${pc('r2NoneInPlay')}. A possessed guest holding no Possession card walks in on a clean guest ${h2(cl.perMatch)} times a match: attacks ${clp('attacks')}, trades ${clp('trades')}, no trade possible ${clp('skipped')}. The first possessed guest never tried to possess anyone in ${hp('ghostNoAttempt')} of matches and ended alive with unused Possession cards in ${hp('ghostKept')}; he was the Safe bot in ${hp('safeGhost')}, and the clean side won ${h1(s.cleanNoSafeGhost / Math.max(1, s.n - s.safeGhost) * 100)}% of the other matches.`);
  }
  console.log(`Possession attempts on a guest holding a Lantern: ${f0(s.attemptsOnHolderPct)}. Conversions by round (%): ${JSON.stringify(s.convByRound)}. Match ends by round (%): ${JSON.stringify(s.endRoundHist)}.`);
  console.log('\n| Personality | Seats | Survive | Escaped | Got possessed (clean start) | Kills/match | Killed | Clean-side win when starting clean | Hotel win when starting possessed | Searches | Lanterns found | Attacks | Trades |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const [k, v] of Object.entries(s.per)) {
    console.log(`| ${P.LABELS[k]} | ${v.seats} | ${f0(v.survive)} | ${f0(v.escape)} | ${f0(v.gotPossessed)} | ${f2(v.killsPer)} | ${f0(v.killed)} | ${f0(v.winClean)}${v.cleanSeats ? ` ±${v.winCleanCI.toFixed(0)}` : ''} (${v.cleanSeats}) | ${f0(v.winPossessed)}${v.possSeats ? ` ±${v.winPossessedCI.toFixed(0)}` : ''} (${v.possSeats}) | ${f1(v.searches)} | ${f2(v.lanterns)} | ${f2(v.attacks)} | ${f1(v.trades)} |`);
  }
}

// --- the study ----------------------------------------------------------------------------------------
// Rule proposals (simulator only). Each is { label, rulesOver (in-memory rules), ov (sim-only post-steps) }.
// Since the owner approved "every guest starts with 1 Lantern" (rules.lanternsDealtEach = 1), the
// baseline already deals one: the 'dealt1' proposals below now equal the baseline on that point (kept so
// old commands still run), and 'dealt0' measures the old search-only rule for comparison.
export const PROPOSALS = [
  { key: 'dealt0', label: 'The old rule: no Lantern dealt (search only)', rulesOver: { lanternsDealtEach: 0 } },
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
  { key: 'nextRound', label: 'A newly possessed guest can pass possession on only from the next round', ov: { possessNextRound: true } },
  { key: 'dealt1+nextRound', label: 'Each guest starts with 1 Lantern + a newly possessed guest can pass possession on only from the next round', ov: { possessNextRound: true }, rulesOver: { lanternsDealtEach: 1 } },
  { key: 'spend+dealt1+dawn10', label: 'Spent on conversion + 1 Lantern each + dawn after round 10', ov: { spendOnConvert: true }, rulesOver: { lanternsDealtEach: 1, roundLimit: 10 } },
  // The owner's idea (7 Oct 2026): "health 4 instead of 3, the ghost starts with 2 possession and not 3, and who gets
  // possessed has 1 chance to possess someone else", keeping the starting Lantern (lanternsDealtEach 1, already the
  // baseline; owner1/owner2 also set it explicitly). Two readings of the last part:
  //   reading 1 (owner1) — as the card rule already works: every possessed guest holds the one card they received
  //     (one chance) and their victim then holds it, so the chain can go on;
  //   reading 2 (owner2, the 'oneGen' flag) — one generation: the first possessed guest hands out his 2 cards; each
  //     guest HE possesses holds that 1 card (one chance); when one of them possesses someone with it, the card is
  //     used up, so that victim holds no Possession card and the chain stops.
  // owner: true — running one of these turns the owner's measures on (see the header).
  { key: 'hp4', owner: true, label: 'Every guest has 4 health (not 3)', rulesOver: { maxHealth: 4 } },
  { key: 'oneGen', owner: true, label: 'One generation: a guest possessed by a converted guest gets no Possession card (the chain stops)', ov: { oneGeneration: true } },
  { key: 'supply2+oneGen', owner: true, label: '2 Possession cards + one generation (health 3)', rulesOver: { possessionSupply: 2 }, ov: { oneGeneration: true } },
  { key: 'owner1', owner: true, label: "Owner's idea, reading 1: 4 health + 2 Possession cards + 1 Lantern each (each possessed guest passes on the card they received)", rulesOver: { maxHealth: 4, possessionSupply: 2, lanternsDealtEach: 1 } },
  { key: 'owner2', owner: true, label: "Owner's idea, reading 2: 4 health + 2 Possession cards + 1 Lantern each + one generation", rulesOver: { maxHealth: 4, possessionSupply: 2, lanternsDealtEach: 1 }, ov: { oneGeneration: true } },
  // Sensitivity rows (same rules as the proposal named first): the bots heal at the original FIXED health numbers
  // (at 1; the safe one at 2 or less) instead of "2 bars down" / "1 bar down". At 3 health the two are identical, so
  // the baseline needs no such row; at 4 health they bound how much of the change in deaths and heals is the rule
  // and how much is how eagerly the bots heal.
  { key: 'hp4+fixedHeal', owner: true, label: 'Every guest has 4 health — sensitivity: bots heal at the old fixed health numbers', rulesOver: { maxHealth: 4 }, bots: { heal: 'fixed' } },
  { key: 'owner1+dawn10', owner: true, label: "Owner's idea, reading 1 + dawn after round 10", rulesOver: { maxHealth: 4, possessionSupply: 2, lanternsDealtEach: 1, roundLimit: 10 } },
  { key: 'owner2+dawn10', owner: true, label: "Owner's idea, reading 2 + dawn after round 10", rulesOver: { maxHealth: 4, possessionSupply: 2, lanternsDealtEach: 1, roundLimit: 10 }, ov: { oneGeneration: true } },
  { key: 'owner1+fixedHeal', owner: true, label: "Owner's idea, reading 1 — sensitivity: bots heal at the old fixed health numbers", rulesOver: { maxHealth: 4, possessionSupply: 2, lanternsDealtEach: 1 }, bots: { heal: 'fixed' } },
  { key: 'owner2+fixedHeal', owner: true, label: "Owner's idea, reading 2 — sensitivity: bots heal at the old fixed health numbers", rulesOver: { maxHealth: 4, possessionSupply: 2, lanternsDealtEach: 1 }, ov: { oneGeneration: true }, bots: { heal: 'fixed' } },
];

// One line per run, for reading proposals side by side (printed after the proposals, only with MEASURES).
// Columns an older line also prints use its formatter; the owner-measure columns round half-up.
function printComparison(rows) {
  if (!rows.length || !MEASURES) return;
  const p = (s, k) => `${(s[k] / s.n * 100).toFixed(1)}%`;
  console.log('\n### Side by side\n');
  console.log('| Run | Players | Clean win | Clean win, Safe bot not the first possessed | Hotel: all possessed/dead | Hotel: dawn | Rounds med (90%) | Turns med (90%) | Deaths: clean / possessed | Kills by clean / by possessed | Heals used | Conversions: first possessed / converted | Most possessed at once | Poss. cards in play after R2 | Clean guests left after R2: all matches (matches still running) | Over by R2 | No conversion | First possessed never tried | Fire Exit found |');
  console.log('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const { key, s } of rows) {
    console.log(`| ${key} | ${s.players} | ${s.cleanPct.toFixed(1)}% ±${s.cleanCI.toFixed(1)} | ${h1(s.cleanNoSafeGhost / Math.max(1, s.n - s.safeGhost) * 100)}% | ${p(s, 'allGone')} | ${p(s, 'dawn')} | ${s.roundsMed} (${s.roundsP90}) | ${s.turnsMed} (${s.turnsP90}) | ${h2(s.deathsClean)} / ${h2(s.deathsPossessed)} | ${h2(s.killsByClean)} / ${f2(s.killsByPossessed)} | ${h2(s.heals)} | ${h2(s.convByOrig)} / ${h2(s.convByConv)} | ${h1(s.maxPossMean)} | ${h2(s.r2InPlayMean)} | ${f1(s.r2CleanMean)} (${f1(s.r2CleanMeanRunning)}) of ${s.players - 1} | ${p(s, 'r2Ended')} | ${p(s, 'noConversion')} | ${h1(s.ghostNoAttempt / s.n * 100)}% | ${p(s, 'exitFound')} |`);
  }
}

export async function runPersonalityCli({ floor: fl, roster: ro, argv }) {
  floor = fl; roster = ro;
  const opt = (name, def) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : def; };
  const results = [];
  // Bot options for every run of this call (the baseline too); a proposal may add its own (`bots`).
  const BOTS = argv.includes('--no-lantern-leak') ? { noLanternLeak: true } : {};
  const botTag = BOTS.noLanternLeak ? ' [bots: no Lantern leak]' : '';
  const withBots = (ov, extra) => { const b = { ...BOTS, ...(extra || {}) }; return Object.keys(b).length ? { ...(ov || {}), bots: b } : ov; };
  const run = spec => { const s = runSet({ ...spec, label: spec.label + botTag, ov: withBots(spec.ov, spec.bots) }); printSummary(s); results.push(s); return s; };
  const keys = opt('pkeys', null)?.split(',');
  const picked = PROPOSALS.filter(x => !keys || keys.includes(x.key));
  const study = !argv.includes('--personalities'), only = opt('only', null);
  MEASURES = argv.includes('--owner-measures') || Object.keys(BOTS).length > 0
    || (study && (!only || only.split(',').includes('proposals')) && picked.some(x => x.owner));
  if (argv.includes('--personalities')) {
    const list = opt('personalities', PERS.join(',')).split(',').map(x => x.trim());
    for (const x of list) if (!PERS.includes(x)) throw new Error(`unknown personality ${x}`);
    const n = +opt('n', 2000);
    TRACE = argv.includes('--trace');
    run({ label: `Seats: ${list.join(', ')}${argv.includes('--shuffle') ? ' (shuffled each match)' : ''}`, n, players: list.length,
      assign: argv.includes('--shuffle') ? ((st, rng) => shuffle([...list], rng)) : assignFixed(list) });
  } else {
    const scale = +opt('scale', 1);
    const want = k => !only || only.split(',').includes(k);
    if (want('mixed')) run({ label: 'Mixed table: one of each personality, random seats and role', n: 12000 * scale, players: 6, assign: assignMixed(6), seedBase: 1 });
    if (want('alone')) for (const x of PERS) run({ label: `All six seats: ${P.LABELS[x]}`, n: 2000 * scale, players: 6, assign: assignAll(x), seedBase: 2 });
    if (want('vsteam')) for (const x of PERS) run({ label: `${P.LABELS[x]} POSSESSED vs five team players`, n: 2000 * scale, players: 6, assign: assignPossessed(x, 'team'), seedBase: 3 });
    if (want('clean')) for (const x of PERS) run({ label: `${P.LABELS[x]} as one CLEAN guest among the other five`, n: 2000 * scale, players: 6, assign: assignClean(x), seedBase: 4 });
    if (want('counts')) for (const n of [4, 5]) run({ label: `Mixed table, ${n} players (personalities drawn without replacement)`, n: 6000 * scale, players: n, assign: assignMixed(n), seedBase: 5 + n });
    if (want('proposals')) {
      // --pplayers 4,5,6 to measure the proposals at other table sizes; --pkeys spend,dealt1 for a subset.
      for (const k of keys || []) if (k !== 'none' && !PROPOSALS.some(x => x.key === k)) console.error(`(unknown proposal key '${k}' ignored)`);
      const side = [];
      for (const np of (opt('pplayers', '6')).split(',').map(Number)) {
        side.push({ key: 'baseline (rules as they stand)', s: run({ label: `Proposal baseline: mixed table, ${np} players, rules as they stand`, n: 6000 * scale, players: np, assign: assignMixed(np), seedBase: 9 }) });
        for (const pr of picked) {
          side.push({ key: pr.key, s: run({ label: `Proposal (${np} players): ${pr.label}`, n: 6000 * scale, players: np, assign: assignMixed(np), rulesOver: pr.rulesOver, ov: pr.ov, bots: pr.bots, seedBase: 9 }) });
        }
      }
      printComparison(side);
    }
  }
  const json = opt('json', null);
  if (json) { const fs = await import('node:fs'); fs.writeFileSync(json, JSON.stringify(results, null, 1)); }
}
