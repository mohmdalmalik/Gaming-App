// The engine's optional parameters for Co-op (no browser, ~10 s), and the small pure modules every later Co-op step
// builds on.
//   node tests/engine-options-check.mjs
//   node tests/engine-options-check.mjs --write-baseline   (only after an APPROVED rules change: re-records the baseline)
//
//   1. the baseline: 150 seeded all-bot matches (seeds 1-50 x 4, 5, 6 guests, through autoplay.playOut) play exactly
//      as recorded in tests/fixtures/engine-baseline.json BEFORE the options were added: winner, dawn, turns, round
//      and a fingerprint of every public event and private inbox. Without options nothing changed. And
//      docs/GAME_RULES.md is the file whose hash tests/fixtures/game-rules.sha256 holds.
//   2. the options reproduce today exactly when fed today's sources: opts.rng = makeRng(seed) and opts.hotelRng =
//      the hotel's own seeded generator with a null seed play the baseline; perTableIds alone changes only the ids
//   3. with crypto sources (src/net/rng.js) and perTableIds, 200 matches deal valid hands (4 cards each with 1 Lantern;
//      one possessed guest with 3 souls of their own) and finish; every card id is the table's own (c1, c2, ...),
//      never from the module counter
//   4. two tables interleaved in one process: within each table no two cards ever share an id, and each numbers its
//      cards on its own (the same ids and the same match as when played alone)
//   5. the hotel: clearHotel empties it, placeLobby + placeTile rebuild a played hotel exactly, resetHotel's rng option
//   6. planWalk answers as a move would walk, and changes nothing
//   7. the small pure modules: src/data/online.js (the keys, the gates still shut), src/net/codes.js, src/net/rng.js,
//      src/net/dataHash.js (fixed when it loads), src/net/serverUrl.js, src/net/protocol.js
import fs from 'node:fs';
import crypto from 'node:crypto';
import { rules, applyMode } from '../src/data/rules.js';
import { hotel } from '../src/data/hotel.js';
import { roster } from '../src/data/characters.js';
import { makeRng, makeCard, nextCardId, buildDrawDeck, buildPossessionSupply, countableCount } from '../src/game/cards.js';
import { clearHotel, placeLobby, placeTile, resetHotel } from '../src/game/hotel.js';
import * as S from '../src/game/state.js';
import { roomRoute } from '../src/game/moves.js';
import { planWalk, playBotTurn, playOut } from '../src/bots/autoplay.js';
import { newMatch, newFloor, playMatch, baselineEntries, eventsHash } from './lib/matches.mjs';
import { ONLINE, LOCAL_LIMITS, ONLINE_RULES, activeOnlineRules } from '../src/data/online.js';
import { ONLINE_TEXT, fill, byRules } from '../src/data/onlineText.js';
import { cryptoRng } from '../src/net/rng.js';
import { newCode, normaliseCode, codeProblem, isBlocked, CODE_BLOCKLIST } from '../src/net/codes.js';
import { dataHash, computeDataHash, fnv1a, canonicalJson } from '../src/net/dataHash.js';
import { resolveServer } from '../src/net/serverUrl.js';
import { validate, C2S, S2C, BYE, ERR, PROTOCOL, MIN_PROTOCOL } from '../src/net/protocol.js';

const t0 = Date.now();
let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const root = new URL('..', import.meta.url);
const BASELINE = new URL('fixtures/engine-baseline.json', import.meta.url);
const RULES_HASH = new URL('fixtures/game-rules.sha256', import.meta.url);
const randomBytes = buf => crypto.randomFillSync(buf);
const hotelSeedOf = seed => ((seed >>> 0) ^ 0x5eed7e11) >>> 0 || 1;      // resetHotel's own generator for a seed

if (process.argv.includes('--write-baseline')) {
  const entries = baselineEntries();
  fs.writeFileSync(BASELINE, '[\n' + entries.map(e => '  ' + JSON.stringify(e)).join(',\n') + '\n]\n');
  console.log(`wrote ${entries.length} entries to tests/fixtures/engine-baseline.json (only after an APPROVED rules change)`);
  process.exit(0);
}

// Every card a table holds right now: hands, the draw and discard piles, what lies on the floors.
const allCards = state => [
  ...state.players.flatMap(p => p.hand), ...state.drawPile, ...state.discardPile,
  ...[...(state.roomDrops?.values() || [])].flat(),
];
const idNum = id => (/^c(\d+)$/.exec(id) ? Number(RegExp.$1) : NaN);
// The module counter's position right now (a throwaway card), so a check can see it did not move.
const counterNow = () => idNum(makeCard('bandage').id);

// --- 1. the baseline ----------------------------------------------------------------------------------------------
console.log('without options: the baseline recorded before the engine options were added');
{
  const want = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  check(want.length === 150, `the baseline has 150 entries (seeds 1-50 x 4, 5, 6 guests): ${want.length}`);
  const got = baselineEntries();
  const differ = got.filter((e, i) => JSON.stringify(e) !== JSON.stringify(want[i]));
  check(differ.length === 0, `all ${got.length} matches play exactly as recorded: winner, dawn, turns, round, every event and inbox${differ.length ? ` — ${differ.length} differ, first: ${JSON.stringify(differ[0])}` : ''}`);
  const wins = got.reduce((m, e) => ((m[e.won] = (m[e.won] || 0) + 1), m), {});
  console.log(`         (humans ${wins.humans || 0}, possessed ${wins.possessed || 0}, dawn ${got.filter(e => e.dawn).length})`);
  const recorded = fs.readFileSync(RULES_HASH, 'utf8').trim().split(/\s+/)[0];
  const now = crypto.createHash('sha256').update(fs.readFileSync(new URL('docs/GAME_RULES.md', root))).digest('hex');
  check(recorded === now, `docs/GAME_RULES.md is unchanged (sha256 ${now.slice(0, 12)}…, recorded in tests/fixtures/game-rules.sha256)`);
}

// --- 2. the options fed today's sources ----------------------------------------------------------------------------
console.log('\nthe options, fed today\'s own sources, reproduce today');
{
  const want = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  let same = 0, ids = 0, seedNull = 0, sameIds = 0;
  for (const w of want) {
    const viaOpts = playMatch(w.seats, null, { botSeed: w.seed, engine: { rng: makeRng(w.seed), hotelRng: makeRng(hotelSeedOf(w.seed)) } });
    const { match, ...e } = viaOpts;
    if (JSON.stringify({ ...e, seed: w.seed }) === JSON.stringify(w)) same++;
    if (match.state.seed === null) seedNull++;
    const perTable = playMatch(w.seats, w.seed, { engine: { perTableIds: true } });
    const { match: m2, ...e2 } = perTable;
    if (JSON.stringify(e2) === JSON.stringify(w)) sameIds++;
    if (allCards(m2.state).every(c => idNum(c.id) <= m2.state.cardSeq)) ids++;
  }
  check(same === want.length, `opts.rng = makeRng(seed) and opts.hotelRng = the hotel's seeded generator, seed null: the same ${same}/${want.length} matches (the deal, the possessed seat, reshuffles, Lock Picks and the hotel all come from them)`);
  check(seedNull === want.length, `...and state.seed is null (${seedNull}/${want.length})`);
  check(sameIds === want.length, `perTableIds alone changes nothing but the ids: the same ${sameIds}/${want.length} matches`);
  check(ids === want.length, `...and every card is numbered by its table (${ids}/${want.length})`);
  let threw = false;
  try { S.createState(newFloor(), roster.slice(0, 4), null, { mode: 'match' }); } catch { threw = true; }
  check(threw, 'no seed and no opts.rng is still refused (a missing seed is a bug)');
}

// --- 3. crypto sources and per-table ids -------------------------------------------------------------------------
console.log('\ncrypto sources and per-table ids: 200 matches');
{
  const before = counterNow();
  let validDeal = 0, finished = 0, ownIds = 0, uniqueIds = 0, soulsOwn = 0, seatOk = 0, sourcesKept = 0;
  const possessedAt = new Map(), lobbies = new Set(), sizes = new Map();
  const bad = [];
  for (let k = 0; k < 200; k++) {
    const seats = [4, 5, 6][k % 3];
    sizes.set(seats, (sizes.get(seats) || 0) + 1);
    const rng = cryptoRng(randomBytes), hotelRng = cryptoRng(randomBytes);
    const botSeed = crypto.randomInt(1, 2 ** 31);
    const { state, floor, table } = newMatch(seats, null, { floor: newFloor(), botSeed, engine: { rng, hotelRng, perTableIds: true } });
    if (state.rng === rng && floor.rng === hotelRng && state.seed === null && state.cardSeq > 0) sourcesKept++;
    // the deal
    const possessed = state.players.filter(p => p.possessed);
    const dealOk = state.players.every(p => countableCount(p.hand) === rules.handSize
        && p.hand.filter(c => c.type === 'lantern').length === rules.lanternsDealtEach)
      && possessed.length === 1
      && possessed[0].hand.filter(c => c.type === 'possession').length === rules.possessionSupply
      && possessed[0].hand.filter(c => c.type === 'possession').every(c => c.owner === possessed[0].id)
      && state.players.filter(p => !p.possessed).every(p => !p.hand.some(c => c.type === 'possession'));
    if (dealOk) validDeal++; else if (bad.length < 3) bad.push(`deal ${k}`);
    possessedAt.set(possessed[0]?.index, (possessedAt.get(possessed[0]?.index) || 0) + 1);
    lobbies.add([...floor.rooms.get(floor.start.room).doorSides].sort().join());
    const dealt = allCards(state).map(c => c.id);
    const n = dealt.length;
    if (state.cardSeq === n && new Set(dealt).size === n && dealt.every(id => idNum(id) >= 1 && idNum(id) <= n)) seatOk++;
    // the whole match
    const r = playOut(state, floor, table);
    if (r.finished) finished++; else if (bad.length < 3) bad.push(`unfinished ${k}`);
    const ids = allCards(state).map(c => c.id);
    if (ids.every(id => idNum(id) >= 1 && idNum(id) <= state.cardSeq)) ownIds++;
    if (new Set(ids).size === ids.length) uniqueIds++;
    if (allCards(state).filter(c => c.type === 'possession').every(c => idNum(c.id) <= state.cardSeq)) soulsOwn++;
  }
  check(sourcesKept === 200, `state.rng and floor.rng are the sources given, state.seed is null (${sourcesKept}/200)`);
  check(validDeal === 200, `every deal is valid: ${rules.handSize} ordinary cards each with ${rules.lanternsDealtEach} Lantern, one possessed guest with ${rules.possessionSupply} souls of their own, no soul elsewhere (${validDeal}/200)${bad.length ? ' — ' + bad.join(', ') : ''}`);
  check(seatOk === 200, `the deal numbers its cards c1…cN with the table's own counter (${seatOk}/200)`);
  check(finished === 200, `every match finishes (${finished}/200)`);
  check(ownIds === 200 && soulsOwn === 200, `at the end every card id is the table's own, the souls made in play included (${ownIds}/200, souls ${soulsOwn}/200)`);
  check(uniqueIds === 200, `no two cards of a table ever share an id (${uniqueIds}/200)`);
  check(counterNow() === before + 1, 'the module counter never moved (Single player\'s ids are untouched)');
  check(possessedAt.size >= 4 && lobbies.size >= 2, `the crypto deals differ: the possessed seat fell on ${possessedAt.size} different seats, ${lobbies.size} different lobbies`);
}

// --- 4. two tables interleaved -----------------------------------------------------------------------------------
console.log('\ntwo tables interleaved in one process');
{
  const before = counterNow();
  const make = (seats, seed) => newMatch(seats, seed, { floor: newFloor(), engine: { perTableIds: true } });
  const runs = [[6, 4242, 4, 777], [5, 31, 4, 32], [4, 9001, 6, 9002]];
  let identical = 0, unique = 0, numbered = 0, apart = 0;
  for (const [sa, seedA, sb, seedB] of runs) {
    const A = make(sa, seedA), B = make(sb, seedB);
    let dupWithin = 0, shareObj = 0;
    for (let guard = 0; guard < 600 && !(A.state.finished && B.state.finished); guard++) {
      const T = guard % 2 ? B : A;
      if (!T.state.finished) playBotTurn(T.state, T.floor, T.table);
      for (const M of [A, B]) { const ids = allCards(M.state).map(c => c.id); if (new Set(ids).size !== ids.length) dupWithin++; }
      const objsA = new Set(allCards(A.state));
      if (allCards(B.state).some(c => objsA.has(c))) shareObj++;
    }
    if (dupWithin === 0) unique++;
    if (shareObj === 0) apart++;
    if ([A, B].every(M => allCards(M.state).every(c => idNum(c.id) >= 1 && idNum(c.id) <= M.state.cardSeq))) numbered++;
    // each the same as when played alone
    const alone = [[sa, seedA], [sb, seedB]].map(([s, seed]) => { const M = make(s, seed); playOut(M.state, M.floor, M.table); return M; });
    const sig = M => JSON.stringify([eventsHash(M.state), M.state.won, M.state.turn, allCards(M.state).map(c => c.id).sort()]);
    if (sig(A) === sig(alone[0]) && sig(B) === sig(alone[1])) identical++;
  }
  check(unique === runs.length, `within each table no two cards ever share an id, checked after every turn (${unique}/${runs.length} pairs, 4-6 guests)`);
  check(numbered === runs.length, `each table numbers its own cards c1… (${numbered}/${runs.length})`);
  check(apart === runs.length, `no card object is ever in both tables (${apart}/${runs.length})`);
  check(identical === runs.length, `each table plays exactly as when played alone: events, winner, turns, card ids (${identical}/${runs.length})`);
  check(counterNow() === before + 1, 'the module counter never moved');
}

// --- 5. the hotel --------------------------------------------------------------------------------------------------
console.log('\nthe hotel: clearHotel, placeLobby, resetHotel(floor, seed, rng)');
{
  const describe = f => JSON.stringify({
    rooms: f.roomList.map(r => [r.id, r.cell, r.rotation, [...r.doorSides].sort(), r.doorways.map(d => d.id), r.frontier.map(d => [d.id, d.jammed]), r.walls.map(w => [w.id, w.min, w.max, w.neighbour])]),
    doorways: f.doorways.map(d => [d.id, d.center]), frontier: f.frontier.map(d => [d.id, d.jammed]).sort(),
    walls: f.walls.length, cells: [...f.cells].sort(), exit: f.exitRoom, bounds: f.bounds, start: f.start,
  });
  let rebuilt = 0, games = 0;
  for (let seed = 1; seed <= 30; seed++) {
    const { state, floor, table } = newMatch(4 + (seed % 3), seed, { floor: newFloor() });
    playOut(state, floor, table);
    games++;
    const copy = newFloor();
    clearHotel(copy);
    const lobby = placeLobby(copy, [...floor.rooms.get(floor.start.room).doorSides]);
    for (const r of floor.roomList.slice(1)) placeTile(copy, hotel.tiles.find(t => t.id === r.tile), r.cell, r.rotation);
    for (const d of floor.frontier) if (d.jammed) copy.frontier.find(x => x.id === d.id).jammed = true;
    if (lobby === copy.rooms.get(copy.start.room) && describe(copy) === describe(floor)) rebuilt++;
  }
  check(rebuilt === games, `placeLobby (with the lobby's open sides) + placeTile in placement order rebuild ${rebuilt}/${games} played hotels exactly: rooms, rotations, doorways, closed and jammed doors, walls, exit, bounds, start`);
  const f = newFloor();
  resetHotel(f, 5);
  clearHotel(f);
  check(f.rooms.size === 0 && f.roomList.length === 0 && f.doorways.length === 0 && f.walls.length === 0 && f.frontier.length === 0
    && f.cells.size === 0 && f.exitRoom === null && f.problems.length === 0 && f.bounds.min[0] === Infinity && f.bounds.max[1] === -Infinity,
    'clearHotel empties rooms, doorways, walls, closed doors, cells, the exit, problems and bounds');
  let same = 0;
  for (let seed = 1; seed <= 40; seed++) {
    const a = newFloor(), b = newFloor();
    resetHotel(a, seed);
    resetHotel(b, 999, makeRng(hotelSeedOf(seed)));
    if (describe(a) === describe(b) && a.deck.map(t => t.id).join() === b.deck.map(t => t.id).join()) same++;
  }
  check(same === 40, `resetHotel(floor, seed, rng) builds its hotel from rng (the seed's own generator gives the seed's hotel: ${same}/40)`);
}

// --- 6. planWalk -----------------------------------------------------------------------------------------------------
console.log('\nplanWalk');
{
  // A move as autoplay made it before planWalk existed (the reference).
  const oldPlan = (state, floor, p, to) => {
    let route = roomRoute(state, floor, p, to);
    if (!Array.isArray(route)) return { ok: false, reason: route.blocked };
    if (route.length < 2) return { ok: false, reason: 'here' };
    for (let i = 1; i < route.length - 1; i++) if (S.encountersIn(state, floor, p, route[i]).length) { route = route.slice(0, i + 1); break; }
    const can = S.canAffordRoute(state, floor, p, route);
    return can.ok ? { ok: true, rooms: route } : { ok: false, reason: can.reason };
  };
  let asked = 0, agree = 0, untouched = 0, turns = 0, cut = 0, refused = 0, here = 0;
  for (let seed = 100; seed < 130; seed++) {
    const { state, floor, table } = newMatch(4 + (seed % 3), seed, { floor: newFloor() });
    for (let turn = 0; turn < 40 && !state.finished; turn++) {
      const p = S.activePlayer(state);
      turns++;
      const before = JSON.stringify([state.events.length, state.players.map(q => [q.currentRoom, q.actionPoints]), [...state.encounterLocks]]);
      for (const room of floor.roomList) {
        const got = planWalk(state, floor, p, room.id);
        asked++;
        if (JSON.stringify(got) === JSON.stringify(oldPlan(state, floor, p, room.id))) agree++;
        if (got.ok && got.rooms.at(-1) !== room.id) cut++;
        if (!got.ok) { refused++; if (got.reason === 'here') here++; }
      }
      if (JSON.stringify([state.events.length, state.players.map(q => [q.currentRoom, q.actionPoints]), [...state.encounterLocks]]) === before) untouched++;
      playBotTurn(state, floor, table);
    }
  }
  check(agree === asked, `planWalk gives the route a move walks, or the same refusal (${agree}/${asked} questions; ${cut} cut short at a forced meeting, ${refused} refused, ${here} 'here')`);
  check(cut > 0 && here > 0 && refused > here, '...covering cut routes, \'here\' and the other refusals');
  check(turns > 0 && untouched === turns, `asking changes nothing in the game: events, rooms, actions, meetings (${untouched}/${turns} turns)`);
}

// --- 6b. the card helpers ------------------------------------------------------------------------------------------
console.log('\ncard ids');
{
  const before = counterNow();
  const c = makeCard('possession', { owner: 'p3', id: 'c7' });
  check(c.id === 'c7' && c.owner === 'p3' && c.type === 'possession', 'makeCard keeps the id it is given');
  check(counterNow() === before + 1, '...without moving the module counter');
  const r = makeCard('revolver');
  check(/^c\d+$/.test(r.id) && idNum(r.id) === before + 2 && r.shots === rules.cards.revolver.shots, 'without one it takes the module counter, as always (and a Revolver its shots)');
  check(nextCardId(null) === null && nextCardId({}) === null, 'nextCardId: null for a table without its own ids');
  const t = { cardSeq: 0 };
  check(nextCardId(t) === 'c1' && nextCardId(t) === 'c2' && t.cardSeq === 2, 'nextCardId: c1, c2, … for a table with its own ids');
  const u = { cardSeq: 0 };
  const deck = buildDrawDeck(rules.deck, () => nextCardId(u));
  const total = Object.values(rules.deck).reduce((a, b) => a + b, 0);
  check(deck.length === total && deck.every((d, i) => d.id === `c${i + 1}`), `buildDrawDeck(spec, newId) numbers the ${total} cards from newId`);
  const souls = buildPossessionSupply('p2', () => nextCardId(u));
  check(souls.length === rules.possessionSupply && souls.every((s, i) => s.id === `c${total + i + 1}` && s.owner === 'p2'), 'buildPossessionSupply(owner, newId) too');
  const s = S.createState(newFloor(), roster.slice(0, 4), 3, { mode: 'match', perTableIds: true });
  const before2 = counterNow();
  S.resetState(s, newFloor(), 3);
  check(s.cardSeq === undefined && allCards(s).every(card => idNum(card.id) > before2), 'a later resetState without the option goes back to the module counter');
}

// --- 7. the small pure modules -------------------------------------------------------------------------------------
console.log('\nsrc/data/online.js and src/data/onlineText.js');
{
  check(ONLINE.protocol === 1 && ONLINE.minProtocol === 1 && PROTOCOL === 1 && MIN_PROTOCOL === 1, 'protocol 1 (min 1)');
  check(ONLINE.server.open === false && ONLINE.server.live === null, 'the gates are shut: no live server, server.open false (the live site says Coming soon)');
  check(ONLINE_RULES.approved === false && activeOnlineRules() === ONLINE_RULES.today, 'ONLINE_RULES.approved is false, so Co-op uses today\'s rules, never the pending proposal');
  const T = ONLINE_RULES.today, P = ONLINE_RULES.pending;
  check(T.turnMs === rules.turnTimerSeconds * 1000 && T.discardMinMs === rules.discardMinSeconds * 1000 && T.meetMs === null && T.cardMs === null
    && T.offerMs === null && T.screenCapMs === null && T.standIn === false && T.stallMs === 300000 && T.startAckMs === 20000 && T.clock === 'server',
  `today: the ${rules.turnTimerSeconds} s turn, at least ${rules.discardMinSeconds} s to discard, no other limit, the 5-minute stall placeholder (TP3)`);
  check(P.meetMs === 20000 && P.cardMs === 20000 && P.offerMs === 20000 && P.screenCapMs === 10000 && P.standIn === true && P.idleTimeouts === 2
    && P.relaxedFactor === 2 && P.stallMs === null && P.turnMs === T.turnMs, 'pending (PROPOSED, NOT RULES): R3 R4 R5 R6 R7 R10 as the design lists them');
  applyMode('match', 6);
  const onMatch = LOCAL_LIMITS.clock;
  applyMode('practice');
  check(onMatch === 'device' && LOCAL_LIMITS.clock === null && LOCAL_LIMITS.devicePauses === true && LOCAL_LIMITS.turnMs === rules.turnTimerSeconds * 1000,
    'LOCAL_LIMITS: the device\'s clock in a match, none in practice, device pauses, today\'s numbers');
  const keys = ['tickMs', 'graceMs', 'startCountdownMs', 'roleAckMs', 'heartbeatMs', 'awayAfterHiddenMs', 'hostAwayMs', 'lobbyAwayFreeMs', 'emptyMatchCloseMs',
    'idleWaitingCloseMs', 'afterMatchCloseMs', 'closedFilesKeepMs', 'reconnectPillMs', 'backToastKeepMs', 'lostCardMs', 'retryCapMs', 'pingCheckMs', 'liveSilenceMs', 'wakeSlowMs',
    'stallBannerMs', 'rememberTableMs', 'pendingLeaveMs', 'walkMsPerRoom', 'helloTimeoutMs', 'restartRetryMs', 'restoreGraceMs', 'faultWindowMs', 'drainMs'];
  check(keys.every(k => Number.isFinite(ONLINE.timing[k]) && ONLINE.timing[k] > 0) && Object.keys(ONLINE.timing).length === keys.length,
    `ONLINE.timing has its ${keys.length} numbers (walkMsPerRoom ${ONLINE.timing.walkMsPerRoom})`);
  check(ONLINE.limits.maxPayload === 4096 && ONLINE.limits.doIdMaxChars === 12 && ONLINE.code.inputMax === 200 && ONLINE.code.length === 5
    && ONLINE.code.alphabet === 'BCDFGHJKMNPRSTVWXZ' && ONLINE.botLabels === false && ONLINE.countInRecord === false,
  'limits, the code, botLabels and countInRecord (owner decisions D3-D5 still open)');
  check(ONLINE_TEXT.label === 'Co-op' && fill(ONLINE_TEXT.menu.coop) === 'Co-op' && fill(ONLINE_TEXT.table.kickerGuest, { host: 'nora' }) === "Co-op · nora's table",
    'onlineText: the label is "Co-op" (owner decision D1) and fill() puts it and the names in');
  check(ONLINE_TEXT.demo.note === 'Test table: the online rules are not decided yet.' && ONLINE_TEXT.demo.dealt === 'Match dealt: the match itself arrives next.', 'onlineText: the review link\'s two lines');
  check(byRules(ONLINE_TEXT.recovery.lost.line) === ONLINE_TEXT.recovery.lost.line.today && byRules(ONLINE_TEXT.recovery.lost.line, true) === ONLINE_TEXT.recovery.lost.line.pending
    && byRules('x') === 'x', 'onlineText: byRules picks today\'s words unless the list is approved');
  const errCards = ['notFound', 'full', 'midMatch', 'locked', 'removed', 'closed', 'tooMany', 'busy', 'offline', 'unreachable', 'update', 'serverOld'];
  check(errCards.every(k => ONLINE_TEXT.errors[k]?.title && ONLINE_TEXT.errors[k].line && ONLINE_TEXT.errors[k].buttons.length), 'onlineText: a card (title, line, buttons) for every can\'t-join case');
}
console.log('\nsrc/net/codes.js and src/net/rng.js');
{
  const counts = new Map();
  let ok = 0, blocked = 0;
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const c = newCode(randomBytes);
    if (/^[BCDFGHJKMNPRSTVWXZ]{5}$/.test(c)) ok++;
    if (isBlocked(c)) blocked++;
    for (const ch of c) counts.set(ch, (counts.get(ch) || 0) + 1);
  }
  const expect = N * 5 / 18;
  const worst = Math.max(...[...counts.values()].map(v => Math.abs(v - expect) / expect));
  check(ok === N && blocked === 0, `${N} codes: 5 letters from the 18 consonants, none with a blocked run (${CODE_BLOCKLIST.length} on the list)`);
  check(counts.size === 18 && worst < 0.06, `every letter about equally likely (largest gap from even ${(worst * 100).toFixed(1)}%)`);
  // a source that always gives 255 then real bytes: rejection sampling skips the high bytes
  let calls = 0;
  const skewed = buf => { calls++; if (calls === 1) buf.fill(255); else crypto.randomFillSync(buf); return buf; };
  check(/^[BCDFGHJKMNPRSTVWXZ]{5}$/.test(newCode(skewed)) && calls >= 2, 'a byte of 252 or more is drawn again, never folded into a letter');
  const cases = [['bktwm', 'BKTWM'], [' B K T W M ', 'BKTWM'], ['bk-twm', 'BKTWM'], ['https://mohmdalmalik.github.io/Gaming-App/?join=BKTWM', 'BKTWM'],
    ['…?join=bktwm&x=1', 'BKTWM'], ['BKTW', null], ['BKTWMN', null], ['BATWM', null], ['', null]];
  check(cases.every(([t, w]) => normaliseCode(t) === w), 'normaliseCode: any case, spaces, dashes, a whole pasted link; null when it is no code');
  check(codeProblem('BKTWM') === null && codeProblem('BATWM') === 'letters' && codeProblem('BKTW') === 'length' && codeProblem('BK1WM') === 'letters'
    && codeProblem('') === 'length', 'codeProblem: null, \'letters\' or \'length\'');
  const rng = cryptoRng(randomBytes);
  const xs = Array.from({ length: 20000 }, rng);
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  check(xs.every(x => x >= 0 && x < 1) && Math.abs(mean - 0.5) < 0.01 && new Set(xs).size === xs.length, `cryptoRng: 20000 values in [0, 1), mean ${mean.toFixed(3)}, all different`);
  check(cryptoRng(b => b.fill(0))() === 0 && cryptoRng(b => b.fill(255))() < 1, 'cryptoRng: never reaches 1 (all bytes 255), 0 at all bytes 0');
}
console.log('\nsrc/net/dataHash.js');
{
  const h = dataHash();
  check(/^[0-9a-f]{8}$/.test(h) && h === computeDataHash(), `dataHash() is 8 hex digits: ${h}`);
  check(fnv1a('') === '811c9dc5' && fnv1a('a') === 'e40c292c' && fnv1a('foobar') === 'bf9cf968', 'fnv1a matches the published FNV-1a 32-bit test values');
  check(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] }) === '{"a":[2,{"c":4,"d":3}],"b":1}', 'canonical JSON sorts every object\'s keys');
  applyMode('match', 4);
  const afterMode = computeDataHash();
  applyMode('practice');
  check(afterMode === h && computeDataHash() === h, 'applyMode (the four per-match fields) never changes it');
  rules.handLimit += 1;
  const changed = computeDataHash();
  rules.handLimit -= 1;
  check(changed !== h && dataHash() === h, 'a rule number is part of it, and dataHash() stays the value fixed when the module loaded');
}
console.log('\nsrc/net/serverUrl.js');
{
  const loc = url => { const u = new URL(url); return { hostname: u.hostname, search: u.search }; };
  const live = ONLINE.server.live;
  check(resolveServer(loc('http://127.0.0.1:9100/')).url === ONLINE.server.local, 'on 127.0.0.1: the local server');
  check(resolveServer(loc('http://localhost:9100/?server=ws://127.0.0.1:9101')).url === 'ws://127.0.0.1:9101', 'on localhost: ?server=ws://127.0.0.1:PORT');
  check(resolveServer(loc('http://localhost:9100/?server=wss://x.onrender.com')).url === 'wss://x.onrender.com', '...or wss://');
  check(resolveServer(loc('http://localhost:9100/?server=ws://evil.example:80')).url === ONLINE.server.local, '...never another ws:// host');
  check(resolveServer(loc('http://127.0.0.1:9100/?coop=soon')).comingSoon === true, 'on 127.0.0.1: ?coop=soon forces Coming soon');
  check(resolveServer(loc('https://mohmdalmalik.github.io/Gaming-App/')).comingSoon === true
    && resolveServer(loc('https://mohmdalmalik.github.io/Gaming-App/?server=wss://x.onrender.com&coop=preview')).comingSoon === true,
  'the live site: Coming soon (no live server yet), and ?server= is ignored there');
  ONLINE.server.live = 'wss://hotel.example';
  const preview = resolveServer(loc('https://mohmdalmalik.github.io/Gaming-App/?coop=preview')).url;
  const shut = resolveServer(loc('https://mohmdalmalik.github.io/Gaming-App/')).comingSoon;
  ONLINE.server.open = true;
  const open = resolveServer(loc('https://mohmdalmalik.github.io/Gaming-App/')).url;
  ONLINE.server.live = live; ONLINE.server.open = false;
  check(preview === 'wss://hotel.example' && shut === true && open === 'wss://hotel.example', 'with a live server: ?coop=preview reaches it while shut; open lets everyone in');
}
console.log('\nsrc/net/protocol.js');
{
  check(C2S.length === 10 && S2C.length === 9 && BYE.elsewhere === 4001 && BYE.restart === 1012 && BYE.noHello === 4010 && ERR.busy === 'busy', 'message types, bye close codes and err codes');
  const good = [
    { t: 'hello', v: 1, app: 'v0.12', data: dataHash(), token: null, name: 'nora', avatar: { v: 2 }, vis: 'visible' },
    { t: 'peek', code: 'BKTWM' }, { t: 'create' }, { t: 'create', size: 5 }, { t: 'join', code: 'BKTWM', wait: false },
    { t: 'lobby', id: 'a1', op: { k: 'size', n: 4 } }, { t: 'lobby', id: 'a2', op: { k: 'lock', on: true } }, { t: 'lobby', id: 'a3', op: { k: 'start' } },
    { t: 'do', id: '7', turn: 1, cmd: { k: 'ack', what: 'role' } }, { t: 'do', id: '8', turn: 3, cmd: { k: 'move', to: 'kitchen' } },
    { t: 'do', id: '9', turn: 3, cmd: { k: 'card', type: 'handMirror', card: 'Zx8k2Lp0', target: 2 } },
    { t: 'do', id: '10', turn: 3, cmd: { k: 'answer', ask: 'q2', value: { attack: 'Zx8k2Lp0' } } },
    { t: 'do', id: '11', turn: 3, cmd: { k: 'ack', what: 'notes', lines: ['One line.'] } },
    { t: 'say', id: 'greet' }, { t: 'say', id: 'isPossessed', about: 3 }, { t: 'vis', v: 'hidden' }, { t: 'leave' }, { t: 'ping', at: 12.5 },
  ];
  check(good.every(m => validate(JSON.stringify(m)).ok), `${good.length} good messages pass`);
  const stripped = validate(JSON.stringify({ t: 'do', id: '1', turn: 2, cmd: { k: 'end', seat: 0, role: 'possessed' }, seed: 5 }));
  check(stripped.ok && JSON.stringify(stripped.msg) === '{"t":"do","id":"1","turn":2,"cmd":{"k":"end"}}', 'unknown fields are dropped (a seat, a role or a seed never get through)');
  const bad = [
    ['{not json', 1007], [JSON.stringify({ t: 'shout' }), 1003], [JSON.stringify([1]), 1003], [Buffer.from('{}'), 1003],
    [JSON.stringify({ t: 'do', id: 'x'.repeat(13), turn: 1, cmd: { k: 'end' } }), 1007], [JSON.stringify({ t: 'do', id: '1', turn: 1, cmd: { k: 'fly' } }), 1007],
    [JSON.stringify({ t: 'create', size: 7 }), 1007], [JSON.stringify({ t: 'hello', v: 1, app: 'v0.12', data: 'XYZ', token: null, name: null, avatar: null, vis: 'visible' }), 1007],
    [JSON.stringify({ t: 'lobby', id: 'a', op: { k: 'size', n: 3 } }), 1007], [JSON.stringify({ t: 'vis', v: 'gone' }), 1007],
    [JSON.stringify({ t: 'do', id: '1', turn: 1, cmd: { k: 'card', type: 'jetpack', card: 'a' } }), 1007], [JSON.stringify({ t: 'ping', at: 'now' }), 1007],
  ];
  const wrong = bad.filter(([raw, code]) => { const r = validate(raw); return r.ok || r.close !== code; });
  check(wrong.length === 0, `${bad.length} bad messages refused with the right close code (bad JSON or fields 1007, unknown type or binary 1003)${wrong.length ? ' — wrong: ' + String(wrong[0][0]).slice(0, 60) : ''}`);
}

console.log(`\n${failures ? failures + ' FAILED' : 'ALL PASSED'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failures ? 1 : 0);
