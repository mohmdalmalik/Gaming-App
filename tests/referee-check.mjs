// Checks for the referee (src/net/referee.js), the snapshot (src/net/snapshot.js) and the trade outcomes
// (src/net/outcomes.js) — no browser, about a minute.
//   node tests/referee-check.mjs
//
//   0. purity: the three files use no DOM, THREE, Node API, Math.random, clock, timer or the engine's generator;
//      outcomes.js is exactly the tradeOutcome of src/ui/tradeReveal.js
//   1. REPLAY: all-bot tables through the referee (botRules 'autoplay', atomic walks, no pauses) play bots-check's
//      seeded matches and the engine baseline exactly as autoplay.playOut does: every public event, every inbox, the
//      winner, dawn, the turns and the round
//   2. PAGE RULES: one case for each of the four ways botRules 'page' differs from autoplay (a jammed door; the meet
//      beat before a bot-to-bot meeting; a bot timing out over the hand limit chooses its own discards; bots' notes
//      cleared each turn)
//   3. 200 matches with 1-6 scripted people under today's online rules (random legal commands, answers and acks after
//      random delays, junk commands, some people who never answer): every match ends, or stops by the stall (TP3); no
//      exception, no stuck phase; command results whitelisted; the discard never public. And Single player's limits:
//      matches with one scripted person in the page's own walk mode and clock
//   4. every question, result and time-out, built on purpose: today's online rules, Single player's (LOCAL_LIMITS)
//      and the pending proposals (R3/R4/R5); a person walker always asked Trade or Attack; a sealed trade; whitelisted
//      results; discard privacy; refusals; repeated answers
//   5. DEVICE WALKS: a scripted page calling step/arrived reproduces today's action point per doorway and the walk cut
//      short when the clock runs out (main.js:634-648) on 100 seeded walks; step works with no walk in progress;
//      holds stop the clock and the bots
//   6. SNAPSHOT: (a) lossless: 150 matches stopped mid-way and forked, one branch on the live objects, the other
//      through toSnapshot + ref.toJSON as JSON text and back, both with fresh minds of the same seed and the same
//      random sources at the same position: identical to the end; (b) fresh minds of new seeds after a restore finish
//      every match legally. toJSON is plain data.
import fs from 'node:fs';
import { rules } from '../src/data/rules.js';
import { hotel } from '../src/data/hotel.js';
import { config } from '../src/config.js';
import { makeCard, countableCount } from '../src/game/cards.js';
import * as S from '../src/game/state.js';
import * as A from '../src/game/actions.js';
import { openFrontierDoor, growTo } from '../src/game/hotel.js';
import { createBotTable } from '../src/bots/index.js';
import { playBotTurn, playOut, planWalk } from '../src/bots/autoplay.js';
import { ONLINE, LOCAL_LIMITS, ONLINE_RULES } from '../src/data/online.js';
import { createReferee } from '../src/net/referee.js';
import { toSnapshot, fromSnapshot, SNAPSHOT_VERSION } from '../src/net/snapshot.js';
import { TRADE_OUTCOMES } from '../src/net/outcomes.js';
import { playerView } from '../src/net/playerView.js';
import { newMatch, newFloor, eventsHash } from './lib/matches.mjs';

const t0 = Date.now();
let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const TODAY = ONLINE_RULES.today, PENDING = ONLINE_RULES.pending, GRACE = ONLINE.timing.graceMs;
const json = x => JSON.stringify(x);
const same = (a, b) => json(a) === json(b);
const BASELINE = JSON.parse(fs.readFileSync(new URL('fixtures/engine-baseline.json', import.meta.url), 'utf8'));

// A random source whose position can be copied (mulberry32 with its state in view): .fork() continues independently
// from the same point. The fork test hands one copy to each branch.
function forkRng(seed) {
  let a = (seed >>> 0) || 1;
  const f = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.fork = () => { const g = forkRng(1); g.seek(a); return g; };
  f.seek = v => { a = v; };
  return f;
}

// Drive a referee with no people on virtual time, jumping from one due moment to the next, until it ends.
function runToEnd(ref, now = 0, limit = 1e9) {
  let guard = 0;
  while (ref.stage !== 'ended' && guard++ < 200000) {
    const t = ref.nextDue();
    if (t == null || t > limit) break;
    now = Math.max(now, t);
    ref.tick(now);
  }
  return now;
}

// --- 0. purity -------------------------------------------------------------------------------------------------------
console.log('purity of the referee, the snapshot and the trade outcomes');
for (const f of ['referee.js', 'snapshot.js', 'outcomes.js']) {
  const src = fs.readFileSync(new URL(`../src/net/${f}`, import.meta.url), 'utf8');
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const bad = [/\bdocument\b/, /\bwindow\b/, /from ['"]three/, /from ['"]node:/, /require\(/, /Math\.random/, /state\.rng/, /\bprocess\./,
    /Date\.now/, /\bsetTimeout\b/, /\bsetInterval\b/, /\blocalStorage\b/].filter(re => re.test(code));
  check(!bad.length, `${f}: no DOM, THREE, Node API, Math.random, clock, timer or engine random generator${bad.length ? ' — found ' + bad.join(' ') : ''}`);
}
{
  const body = (file, name) => {
    const src = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
    const i = src.indexOf(`export function ${name}(`);
    const j = src.indexOf('\n}\n', i);
    return i < 0 || j < 0 ? null : src.slice(i, j + 2).replace(/\s+/g, ' ');
  };
  // (P1C: the page's trade reveal re-exports the referee's own, so the two can never differ)
  const tr = fs.readFileSync(new URL('../src/ui/tradeReveal.js', import.meta.url), 'utf8');
  check(/export \{ tradeOutcome, TRADE_OUTCOMES \} from '\.\.\/net\/outcomes\.js';/.test(tr) && !body('../src/ui/tradeReveal.js', 'tradeOutcome') && !/export const TRADE_OUTCOMES/.test(tr),
    'src/ui/tradeReveal.js re-exports tradeOutcome and TRADE_OUTCOMES from src/net/outcomes.js (no copy of its own)');
  check(body('../src/net/outcomes.js', 'tradeOutcome') && TRADE_OUTCOMES.length === 9, `outcomes.js names the ${TRADE_OUTCOMES.length} outcomes`);
}

// --- 1. replay ---------------------------------------------------------------------------------------------------------
console.log('\nreplay: all-bot tables through the referee (botRules autoplay) play exactly as autoplay.playOut');
const autoplayReferee = m => createReferee({
  state: m.state, floor: m.floor, bots: m.table, people: [], mode: 'online', walkMode: 'atomic', botRules: 'autoplay',
  limits: { clock: null }, pace: () => 0, now: 0, maxStepsPerTick: 1e6,
});
{
  let okBase = 0;
  const bad = [];
  for (const e of BASELINE) {
    const m = newMatch(e.seats, e.seed);
    const ref = autoplayReferee(m);
    runToEnd(ref);
    const got = { seed: e.seed, seats: e.seats, won: m.state.won, dawn: !!m.state.dawn, turns: ref.turns, round: m.state.round, eventsHash: eventsHash(m.state) };
    if (same(got, e)) okBase++; else bad.push(`${e.seats}/${e.seed}`);
  }
  check(okBase === BASELINE.length, `the engine baseline (tests/fixtures/engine-baseline.json): ${okBase}/${BASELINE.length} matches identical (winner, dawn, turns, round, every event and inbox)${bad.length ? ' — differ: ' + bad.slice(0, 5).join(' ') : ''}`);

  // bots-check's seeded matches (section 4 there: seeds 10000 + 37k, 4-6 guests, playBotTurn with 40 steps a turn)
  let okBc = 0, n = 0, steps = 0;
  const badBc = [];
  for (let j = 0; j < 150; j++) {
    const k = 3 * j + (j % 3);
    const players = 4 + (k % 3), seed = 10000 + k * 37;
    const a = newMatch(players, seed);
    let turns = 0;
    while (!a.state.finished && turns < 300) { playBotTurn(a.state, a.floor, a.table, { maxSteps: 40 }); turns++; }
    const want = json({ events: a.state.events, inbox: a.state.players.map(p => p.inbox), won: a.state.won, dawn: a.state.dawn, round: a.state.round, turn: a.state.turn, turns });
    const b = newMatch(players, seed);
    const ref = autoplayReferee(b);
    runToEnd(ref);
    steps += b.state.events.length;
    const got = json({ events: b.state.events, inbox: b.state.players.map(p => p.inbox), won: b.state.won, dawn: b.state.dawn, round: b.state.round, turn: b.state.turn, turns: ref.turns });
    n++;
    if (got === want) okBc++; else badBc.push(`${players}/${seed}`);
  }
  check(okBc === n, `bots-check's seeded matches (150 of its 450, every guest count): ${okBc}/${n} identical event for event (${steps} events)${badBc.length ? ' — differ: ' + badBc.slice(0, 5).join(' ') : ''}`);

  // bots-check's determinism configurations (playOut, 300 turns at most)
  let okDet = 0;
  for (const [seed, pl] of [[123, 6], [456, 5], [789, 4], [2024, 6]]) {
    const a = newMatch(pl, seed);
    const r = playOut(a.state, a.floor, a.table, { maxTurns: 300 });
    const want = json({ won: a.state.won, round: a.state.round, events: a.state.events, inbox: a.state.players.map(p => p.inbox), turns: r.turns });
    const b = newMatch(pl, seed);
    const ref = autoplayReferee(b);
    runToEnd(ref);
    if (json({ won: b.state.won, round: b.state.round, events: b.state.events, inbox: b.state.players.map(p => p.inbox), turns: ref.turns }) === want) okDet++;
  }
  check(okDet === 4, `bots-check's determinism matches: ${okDet}/4 identical`);
}

// --- helpers for built scenarios ---------------------------------------------------------------------------------------
// A table: a fresh match on its own hotel, `people` seats played by people (roles already read unless ackRoles is
// false), every other seat a bot. `wrap(table)`: a bot table with some answers overridden.
function makeTable({ seats = 4, seed = 1, people = [0], mode = 'online', walkMode, botRules = 'page', limits = TODAY,
  pace = () => 1000, wrap = null, random = null, ackRoles = true, now = 0, walkMs, grow = 0 } = {}) {
  const floor = newFloor();
  const botSeats = [...Array(seats).keys()].filter(i => !people.includes(i));
  const m = newMatch(seats, seed, { floor, seats: botSeats });
  if (ackRoles) for (const s of people) m.state.players[s].roleSeen = true;
  if (grow) reveal(m.state, floor, grow);
  const bots = wrap ? wrap(m.table) : m.table;
  const ref = createReferee({ state: m.state, floor, bots, people, mode, walkMode, botRules, limits, pace, random, now, walkMs });
  return { state: m.state, floor, bots, table: m.table, ref, people };
}
// Open doors (as the rules open them) until `n` rooms besides the lobby are placed and revealed.
function reveal(state, floor, n) {
  for (let guard = 0; guard < 80 && floor.roomList.length < n + 1; guard++) {
    const doors = floor.frontier.filter(d => !d.jammed);
    if (!doors.length) break;
    const r = openFrontierDoor(floor, doors[guard % doors.length].id, { isLocked: id => S.isLocked(state, id) });
    if (r.ok) { state.discovered.add(r.room.id); if (r.room.locked && rules.lockedDoorsEnabled) state.lockedRooms.add(r.room.id); }
  }
}
const lobbyOf = t => t.floor.start.room;
// A plain room next to the lobby: not safe, not locked, not dark, not the Fire Exit, searchable.
const plainRoomNextToLobby = t => [...t.floor.rooms.get(lobbyOf(t)).neighbours].map(id => t.floor.rooms.get(id))
  .find(r => !r.safe && !r.locked && !r.isExit && !r.dark && r.searchable && !r.job);
const hand = (types, owner = null) => types.map(type => makeCard(type, type === 'possession' ? { owner } : {}));
// A wrapper over a real bot table with some methods replaced (and every call to them counted).
function wrapBots(over = {}) {
  return table => {
    const w = Object.create(null);
    for (const k of Object.keys(table)) w[k] = table[k];
    w.calls = [];
    for (const [k, fn] of Object.entries(over)) w[k] = (...args) => { w.calls.push([k, ...args.map(x => (x && typeof x === 'object' ? json(x) : x))]); return fn(...args, table); };
    return w;
  };
}
// Scenario seeds: the first seed from `from` whose hotel has a plain room next to the lobby after growing.
function scenarioTable(opts) {
  for (let seed = opts.seed ?? 1; seed < (opts.seed ?? 1) + 200; seed++) {
    const t = makeTable({ ...opts, seed, grow: opts.grow ?? 6 });
    if (plainRoomNextToLobby(t)) return t;
  }
  throw new Error('no scenario hotel');
}

// --- 2. page rules -----------------------------------------------------------------------------------------------------
console.log("\nbotRules 'page': the four ways today's page plays bots differently from autoplay");
{
  // (a) A jammed door: page - no refusal, no reject; autoplay - a refusal with reject('jammed').
  const run = botRules => {
    const queue = [];
    const t = scenarioTable({ seats: 4, people: [], botRules, limits: { clock: null }, pace: () => 1000,
      wrap: wrapBots({ nextAction: () => queue.shift() || { k: 'end' }, reject: () => undefined }) });
    const door = t.floor.rooms.get(lobbyOf(t)).frontier[0] || t.floor.frontier.find(d => d.room === t.state.players[0].currentRoom);
    if (!door) return null;
    door.jammed = true;
    queue.push({ k: 'open', door: door.id });
    t.ref.tick(1000);
    return { rejects: t.bots.calls.filter(c => c[0] === 'reject'), refusals: t.ref.toJSON().bot?.refusals ?? null, bot: t.ref.toJSON().bot };
  };
  const page = run('page'), auto = run('autoplay');
  check(page && page.rejects.length === 0 && page.bot.refusals === 0 && page.bot.steps === 1,
    'jammed door, page: not a refusal (0 refusals) and no reject');
  check(auto && auto.rejects.length === 1 && auto.rejects[0][3] === 'jammed' && auto.bot.refusals === 1,
    "jammed door, autoplay: a refusal, reported to the bot with reject(..., 'jammed')");
}
{
  // (b) A bot walks into a room with another bot: page - a 'meet' beat first (pace asked for 'meet'), the meeting
  // resolves only when it is due; autoplay - at once.
  const run = botRules => {
    const queue = [];
    const paces = [];
    const t = scenarioTable({ seats: 4, people: [], botRules, limits: { clock: null }, pace: (s, k) => { paces.push(k); return 900; },
      wrap: wrapBots({ nextAction: (i, tb) => queue.shift() || { k: 'end' }, attackWith: () => null }) });
    const Y = plainRoomNextToLobby(t).id;
    t.state.players[1].currentRoom = Y;
    queue.push({ k: 'move', to: Y });
    const due = t.ref.toJSON().bot.due;
    t.ref.tick(due);
    const right = { stage: t.ref.stage, trades: t.state.events.filter(e => e.type === 'trade' || e.type === 'noTrade').length, phase: t.ref.phase };
    t.ref.tick(due + 899);
    const before = t.state.events.filter(e => e.type === 'trade' || e.type === 'noTrade').length;
    t.ref.tick(due + 900);
    const after = t.state.events.filter(e => e.type === 'trade' || e.type === 'noTrade').length;
    return { right, before, after, paces };
  };
  const page = run('page'), auto = run('autoplay');
  check(page.right.stage === 'meet:whom' && page.right.trades === 0 && page.right.phase.kind === 'meeting' && same(page.right.phase.seats, [0, 1])
    && page.paces.includes('meet') && page.before === 0 && page.after === 1,
  "bot-to-bot meeting, page: a 'meet' beat first (phase meeting, seats [walker, met]); resolved only when the beat is due");
  check(auto.right.stage === 'turn' && auto.right.trades === 1 && !auto.paces.includes('meet'), 'bot-to-bot meeting, autoplay: resolved at once, no beat');
}
{
  // (c) A bot's turn times out over the hand limit: page - the bot chooses its discards (bots.discard); autoplay - random.
  const run = botRules => {
    const t = scenarioTable({ seats: 4, people: [], botRules, limits: TODAY, pace: () => 10 * 60000,
      wrap: wrapBots({ discard: (i, ids) => ids[ids.length - 1] }) });
    const p = t.state.players[0];
    p.hand.push(...hand(['knife', 'bandage', 'espresso', 'barricade', 'flashlight']));
    const over = A.overHandLimit(p);
    const last = p.hand.filter(c => c.type !== 'possession').slice(-over).map(c => c.id).sort();
    t.ref.tick(TODAY.turnMs + GRACE);
    const kept = new Set(p.hand.map(c => c.id));
    return { over, turn: t.state.turn, discards: t.bots.calls.filter(c => c[0] === 'discard').length, choseLast: last.every(id => !kept.has(id)), left: A.overHandLimit(p) };
  };
  const page = run('page'), auto = run('autoplay');
  check(page.over >= 2 && page.turn === 2 && page.discards === page.over && page.choseLast && page.left === 0,
    `a bot timing out ${page.over} cards over the limit, page: it chooses its own ${page.discards} discards (bots.discard), then the turn passes`);
  check(auto.turn === 2 && auto.discards === 0 && auto.left === 0, 'the same, autoplay: random discards (no bots.discard call)');
}
{
  // (d) Bots' private notes: page clears them each turn; autoplay keeps them.
  const run = botRules => {
    const t = scenarioTable({ seats: 4, people: [], botRules, limits: { clock: null }, pace: () => 1000,
      wrap: wrapBots({ nextAction: () => ({ k: 'end' }) }) });
    t.state.players[2].notes.push('Somebody looked at your whole hand with a Hand Mirror.');
    t.ref.tick(1000);
    return { turn: t.state.turn, notes: t.state.players[2].notes.length };
  };
  const page = run('page'), auto = run('autoplay');
  check(page.turn === 2 && page.notes === 0, "bots' notes, page: cleared as the turn passes");
  check(auto.turn === 2 && auto.notes === 1, "bots' notes, autoplay: kept");
}

// --- scripted people ---------------------------------------------------------------------------------------------------
// The people's side of a table: each person answers their own questions, acknowledges their results and plays their
// turns through ref.do, after random delays, using a mind of their own (a bot table over the same state, used only to
// choose legal-looking commands). Some send junk first; an unreliable person ignores some questions for ever.
// Everything a person does is checked as it happens (whitelisted results, junk refused, the discard never public).
const COMMAND_KEYS = new Set(['ok', 'reason', 'result']);
function createPeople(t, { seed, unreliable = [], junk = 0.06, delay = [150, 5000], maxActs = 14, rng = null, shadowSeed = null } = {}) {
  const R = rng || forkRng(seed);
  const shadow = createBotTable(t.state, t.floor, t.people.map(index => ({ index, profile: null })), shadowSeed ?? seed);
  const plan = {};           // seat -> { key, at }
  const acts = {};           // seat -> commands sent this turn
  const ignored = new Set();
  const stats = { cmds: 0, refused: 0, junk: 0, junkOk: 0, badResult: 0, asks: {}, results: {}, timedOutTurns: 0, timedOutDiscards: 0 };
  const rand = (lo, hi) => lo + (hi - lo) * R();
  const send = (s, cmd, now) => {
    const r = t.ref.do(s, cmd, now);
    stats.cmds++;
    if (!r.ok) stats.refused++;
    const keys = Object.keys(r);
    if (keys.some(k => !COMMAND_KEYS.has(k)) || ('result' in r && !(cmd.k === 'move' && r.ok && same(Object.keys(r.result), ['rooms'])))) stats.badResult++;
    return r;
  };
  const junkCmd = s => {
    const pick = Math.floor(R() * 7);
    const other = (s + 1) % t.state.players.length;
    return [
      [s, { k: 'move', to: 'nowhere' }], [s, { k: 'answer', ask: 'q9999', value: 1 }], [s, { k: 'card', type: 'bandage', card: 'cNone' }],
      [s, { k: 'end', turn: t.state.turn + 5 }], [s, { k: 'discard', card: 'cNone' }], [s, { k: 'fly' }],
      [t.people.includes(other) ? other : s, { k: 'search', turn: t.state.turn - 1 }],
    ][pick];
  };
  function situation(s, now) {
    const ex = t.ref.extras(s, now);
    if (ex.ask) return { key: `a${ex.ask.id}`, ex };
    if (ex.results.length) return { key: `r${ex.results[0].id}`, ex };
    if (ex.phase.kind === 'turn' && t.state.activeIndex === s && t.ref.stage === 'turn' && !t.ref.walking) return { key: `t${t.state.turn}:${acts[s]?.n ?? 0}`, ex };
    return null;
  }
  function act(s, now, ex) {
    if (junk && R() < junk) {
      const [js, jc] = junkCmd(s);
      const before = json(t.state.events.length);
      const r = send(js, jc, now);
      stats.junk++;
      if (r.ok) stats.junkOk++;
      if (json(t.state.events.length) !== before) stats.junkOk++;
    }
    const a = ex.ask;
    if (a) {
      stats.asks[a.kind] = (stats.asks[a.kind] || 0) + 1;
      switch (a.kind) {
        case 'role': return R() < 0.5 ? send(s, { k: 'ack', what: 'role' }, now) : send(s, { k: 'answer', ask: a.id, value: true }, now);
        case 'meetWhom': return send(s, { k: 'answer', ask: a.id, value: shadow.meetWhom(s, a.candidates) }, now);
        case 'meetAct': {
          const w = a.canAttack ? shadow.attackWith(s, a.with) : null;
          return send(s, { k: 'answer', ask: a.id, value: w && a.weapons.includes(w) ? { attack: w } : 'trade' }, now);
        }
        case 'tradeCard': return send(s, { k: 'answer', ask: a.id, value: shadow.tradeCard(s, a.with, a.cards) }, now);
        case 'offer': return send(s, { k: 'answer', ask: a.id, value: shadow.acceptTrade(s, a.from) }, now);
        case 'discard': return send(s, { k: 'discard', card: shadow.discard(s, a.cards) }, now);
        default: return null;
      }
    }
    if (ex.results.length) {
      const r = ex.results[0];
      stats.results[r.kind] = (stats.results[r.kind] || 0) + 1;
      if ((r.kind === 'trade' || r.kind === 'noTrade') && r.notes?.length) send(s, { k: 'ack', what: 'notes', lines: r.notes }, now);
      return send(s, { k: 'ack', what: 'result', id: r.id }, now);
    }
    // my turn: one command
    const mine = (acts[s] ||= { turn: t.state.turn, n: 0, refused: 0 });
    if (mine.turn !== t.state.turn) { mine.turn = t.state.turn; mine.n = 0; mine.refused = 0; }
    mine.n++;
    let a2 = mine.n > maxActs || mine.refused >= 3 ? { k: 'end' } : shadow.nextAction(s);
    if (!a2) a2 = { k: 'end' };
    const cmd = a2.k === 'card' ? { k: 'card', type: a2.type, card: a2.card, ...(a2.target != null ? { target: a2.target } : {}) } : { ...a2 };
    const r = send(s, { ...cmd, turn: t.state.turn }, now);
    if (!r.ok) { mine.refused++; shadow.reject(s, a2, r.reason); }
    return r;
  }
  return {
    stats, shadow, rng: R,
    // What each person does at `now`; returns the earliest time one of them will next act (Infinity: nothing planned).
    step(now) {
      let next = Infinity;
      for (const s of t.people) {
        const sit = situation(s, now);
        if (!sit) { delete plan[s]; continue; }
        if (plan[s]?.key !== sit.key) {
          if (unreliable.includes(s) && sit.key[0] === 'a' && R() < 0.3) { ignored.add(sit.key); plan[s] = { key: sit.key, at: Infinity }; continue; }
          plan[s] = { key: sit.key, at: now + rand(delay[0], delay[1]) };
        }
        if (plan[s].at <= now) {
          delete plan[s];
          act(s, now, situation(s, now)?.ex ?? sit.ex);
          const again = situation(s, now);
          if (again) { plan[s] = { key: again.key, at: now + rand(delay[0], delay[1]) }; }
        }
        if (plan[s] && plan[s].at < next) next = plan[s].at;
      }
      return next;
    },
    fork(t2) {          // the same people on another table, at the same position (the fork test)
      const p2 = createPeople(t2, { seed, unreliable, junk, delay, maxActs, rng: R.fork(), shadowSeed: shadowSeed ?? seed });
      p2._copyPlan(plan, acts, ignored);
      return p2;
    },
    _copyPlan(p, a, ig) { Object.assign(plan, JSON.parse(json(p), (k, v) => (v === null && k === 'at' ? Infinity : v))); Object.assign(acts, JSON.parse(json(a))); for (const x of ig) ignored.add(x); },
    _plan: plan,
  };
}

// Run a table with scripted people on virtual time until it ends (or `until`). Checks run on every change.
function drive(t, people, { now = 0, until = 8 * 3600e3, onChange = null } = {}) {
  let guard = 0, stuck = false;
  while (t.ref.stage !== 'ended' && now <= until && guard++ < 400000) {
    people.step(now);
    const active = t.state.activeIndex, stage = t.ref.stage, turn = t.state.turn;
    const changed = t.ref.tick(now);
    if (changed && t.people.includes(active) && t.state.turn !== turn && (stage === 'turn' || stage === 'discard')) {
      if (stage === 'discard') people.stats.timedOutDiscards++; else people.stats.timedOutTurns++;
    }
    onChange?.(now);
    const next = people.step(now);           // (after the tick: plan for what it has just asked)
    const due = t.ref.nextDue();
    const n = Math.min(next, due ?? Infinity);
    if (!Number.isFinite(n)) { if (t.ref.stage !== 'ended') stuck = true; break; }
    now = Math.max(now + 1, n);
  }
  return { now, stuck, guard };
}

// --- 3. 200 matches with scripted people -------------------------------------------------------------------------------
console.log('\n200 matches with 1-6 scripted people, today\'s online rules (random legal commands, junk, silences)');
{
  const agg = { ended: 0, finished: 0, stalled: 0, stuck: 0, errors: 0, cmds: 0, refused: 0, junk: 0, junkOk: 0, badResult: 0,
    discardLeak: 0, discardSeen: 0, phaseLeak: 0, asks: {}, results: {}, timedOutTurns: 0, timedOutDiscards: 0, views: 0, viewBad: 0 };
  let firstErr = null;
  for (let k = 0; k < 200; k++) {
    const seats = 4 + (k % 3);
    const nPeople = 1 + (k % seats);
    const order = [...Array(seats).keys()].sort((a, b) => ((a * 7 + k * 13) % seats) - ((b * 7 + k * 13) % seats));
    const people = order.slice(0, nPeople).sort((a, b) => a - b);
    const unreliable = k % 5 === 0 ? [people[k % people.length]] : [];
    const slow = k % 4 === 1;
    try {
      const t = makeTable({ seats, seed: 50000 + k * 101, people, mode: 'online', walkMode: 'atomic', botRules: 'page', limits: TODAY,
        ackRoles: false, random: forkRng(k + 1), walkMs: (s, rooms) => (rooms.length - 1) * 300 });
      const folk = createPeople(t, { seed: 7000 + k, unreliable, delay: slow ? [2000, 12000] : [150, 5000] });
      const res = drive(t, folk, {
        onChange: now => {
          if (t.ref.stage === 'discard') {
            agg.discardSeen++;
            for (let s = 0; s < seats; s++) {
              if (s === t.state.activeIndex) continue;
              const ex = t.ref.extras(s, now);
              if (ex.phase.kind !== 'turn' || (ex.clock && ex.clock.kind !== 'turn') || ex.ask?.kind === 'discard') agg.discardLeak++;
            }
          }
          if (t.ref.stage.startsWith('meet:')) for (let s = 0; s < seats; s++) if (t.ref.extras(s, now).phase.kind !== 'meeting') agg.phaseLeak++;
          if (k % 10 === 0 && agg.views < 4000) {
            for (const s of people) {
              const v = playerView(t.state, t.floor, s, t.ref.extras(s, now));
              agg.views++;
              if (!same(JSON.parse(json(v)), v)) agg.viewBad++;
            }
          }
        },
      });
      if (res.stuck) agg.stuck++;
      if (t.ref.stage === 'ended') { agg.ended++; if (t.state.finished) agg.finished++; else if (t.ref.extras(people[0]).end?.stopped === 'stall') agg.stalled++; }
      const st = folk.stats;
      for (const key of ['cmds', 'refused', 'junk', 'junkOk', 'badResult', 'timedOutTurns', 'timedOutDiscards']) agg[key] += st[key];
      for (const [kind, n] of Object.entries(st.asks)) agg.asks[kind] = (agg.asks[kind] || 0) + n;
      for (const [kind, n] of Object.entries(st.results)) agg.results[kind] = (agg.results[kind] || 0) + n;
    } catch (err) {
      agg.errors++;
      firstErr ||= `${k}: ${err.stack.split('\n').slice(0, 3).join(' | ')}`;
    }
  }
  check(agg.errors === 0, `no exception (${agg.errors})${firstErr ? ' — ' + firstErr : ''}`);
  check(agg.ended === 200 && agg.stuck === 0, `every match ended: ${agg.finished} finished, ${agg.stalled} stopped by the stall (TP3); none stuck (${agg.stuck})`);
  check(agg.badResult === 0, `command results whitelisted: { rooms } for a move, nothing else (${agg.cmds} commands, ${agg.refused} refused)`);
  check(agg.junk > 300 && agg.junkOk === 0, `junk commands are all refused and change nothing (${agg.junk})`);
  check(agg.discardSeen > 50 && agg.discardLeak === 0, `discard privacy: during ${agg.discardSeen} discard moments no other seat saw a discard phase, clock or question`);
  check(agg.phaseLeak === 0, 'during a meeting every seat sees the same public phase: meeting');
  check(agg.views > 300 && agg.viewBad === 0, `the views built with the referee's extras survive a JSON round trip (${agg.views})`);
  const askKinds = ['role', 'meetWhom', 'meetAct', 'tradeCard', 'offer', 'discard'];
  check(askKinds.every(k => agg.asks[k] > 0), `every question was asked and answered: ${askKinds.map(k => `${k} ${agg.asks[k] || 0}`).join(', ')}`);
  const resKinds = ['found', 'mirror', 'trade', 'notes', 'declined', 'autoDiscarded'];
  check(resKinds.every(k => agg.results[k] > 0), `results seen: ${Object.entries(agg.results).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  check(agg.timedOutTurns > 0 && agg.timedOutDiscards > 0 && agg.stalled > 0,
    `time-outs happened: ${agg.timedOutTurns} turns and ${agg.timedOutDiscards} discards ran out, ${agg.stalled} matches stopped by the stall`);
}

// --- 4. built on purpose: questions, results, time-outs --------------------------------------------------------------
console.log('\nquestions, results and time-outs, built on purpose');
{
  // The start: every person reads their role; turn 1 waits for them (online at most startAckMs).
  const t = makeTable({ seats: 5, seed: 31, people: [0, 2], ackRoles: false, limits: TODAY });
  const a0 = t.ref.extras(0, 0).ask, a2 = t.ref.extras(2, 0).ask;
  check(t.ref.stage === 'start' && same(t.ref.phase, { kind: 'start', seats: [] }) && a0?.kind === 'role' && a2?.kind === 'role'
    && a0.role === (t.state.players[0].possessed ? 'possessed' : 'clean') && t.ref.extras(1, 0).ask === null,
  'the start: each person is asked to read their own role (role question), nobody else');
  t.ref.do(0, { k: 'ack', what: 'role' }, 1000);
  const still = t.ref.stage;
  t.ref.do(2, { k: 'answer', ask: a2.id, value: true }, 2000);
  check(still === 'start' && t.ref.stage === 'turn' && t.state.players[2].roleSeen, 'turn 1 starts once both have read it (an ack or an answer)');
  const u = makeTable({ seats: 5, seed: 31, people: [0, 2], ackRoles: false, limits: TODAY });
  u.ref.do(2, { k: 'ack', what: 'role' }, 1000);
  u.ref.tick(TODAY.startAckMs - 1);
  const before = u.ref.stage;
  u.ref.tick(TODAY.startAckMs);
  check(before === 'start' && u.ref.stage === 'turn' && u.ref.extras(0, TODAY.startAckMs).ask?.kind === 'role',
    `online, one person never reads it: turn 1 starts after ${TODAY.startAckMs / 1000} s, and their role screen stays`);
  const ex = u.ref.extras(0, TODAY.startAckMs + 5000);
  check(ex.clock && ex.clock.running === false && ex.clock.leftMs === TODAY.turnMs, '...their unread role screen pauses their own clock (online, today: no cap)');
  const l = makeTable({ seats: 4, seed: 31, people: [0], ackRoles: false, limits: LOCAL_LIMITS, mode: 'local' });
  l.ref.tick(10 * 60e3);
  check(l.ref.stage === 'start', 'Single player: the match waits for you to read your role, however long');
}
{
  // A person walks into a room with two bots: whom, then Trade or Attack (always asked), then the card, sealed.
  const t = scenarioTable({ seats: 4, people: [0], limits: TODAY, pace: () => 700 });
  const Y = plainRoomNextToLobby(t).id;
  for (const s of [1, 2]) t.state.players[s].currentRoom = Y;
  const p = t.state.players[0];
  p.hand = hand(['lantern', 'bandage', 'espresso']);
  p.possessed = false;
  for (const s of [1, 2]) { const q = t.state.players[s]; q.hand = hand(['flashlight', 'lantern']); q.possessed = false; }
  const r = t.ref.do(0, { k: 'move', to: Y, turn: 1 }, 100);
  const q1 = t.ref.extras(0, 100).ask;
  check(r.ok && same(r.result, { rooms: [lobbyOf(t), Y] }) && q1?.kind === 'meetWhom' && same(q1.candidates, [1, 2]) && q1.leftMs === null,
    'a move: result { rooms } only; two guests there: the walker is asked whom to meet (no time limit today)');
  check(same(t.ref.extras(1, 100).phase, { kind: 'meeting', seats: [0] }) && t.ref.extras(1, 100).ask === null, '...everyone else sees only "a meeting" (no sub-step, no question)');
  t.ref.do(0, { k: 'answer', ask: q1.id, value: 2 }, 200);
  const q2 = t.ref.extras(0, 200).ask;
  check(q2?.kind === 'meetAct' && q2.with === 2 && q2.canAttack === false && same(q2.weapons, []),
    'a person walker is always asked Trade or Attack: unarmed, canAttack false');
  check(same(t.ref.extras(3, 200).phase, { kind: 'meeting', seats: [0, 2] }), '...the public phase names the two guests, nothing more');
  t.ref.do(0, { k: 'answer', ask: q2.id, value: 'trade' }, 300);
  const q3 = t.ref.extras(0, 300).ask;
  const hidden = t.ref.toJSON().meet.hidden[2];
  check(q3?.kind === 'tradeCard' && q3.with === 2 && q3.voluntary === false && same(q3.cards, A.tradeableCards(p).map(c => c.id))
    && typeof hidden === 'string' && !json(t.ref.extras(0, 300)).includes(hidden),
  "the card question lists the walker's tradeable cards; the bot's card is already chosen and hidden from the person");
  const give = q3.cards.find(id => p.hand.find(c => c.id === id).type === 'bandage');
  const rr = t.ref.do(0, { k: 'answer', ask: q3.id, value: give }, 400);
  const again = t.ref.do(0, { k: 'answer', ask: q3.id, value: give }, 450);
  check(rr.ok && same(again, rr) && t.ref.stage === 'meet:cards', 'an answer is safe to repeat (the same reply); the bot side then takes its trade beat');
  t.ref.tick(400 + 699);
  const mid = t.state.events.filter(e => e.type === 'trade').length;
  t.ref.tick(400 + 700);
  const res = t.ref.extras(0, 1100).results;
  check(mid === 0 && t.state.events.filter(e => e.type === 'trade').length === 1 && res.length === 1 && res[0].kind === 'trade'
    && res[0].with === 2 && res[0].outcome === 'swap' && same(res[0].gave, { type: 'bandage' }) && res[0].got && !('id' in res[0].got)
    && res[0].voluntary === false && t.ref.stage === 'turn',
  'the swap after the beat: a private trade result (outcome, the two cards as types, no ids); back to the turn');
  const ex = t.ref.extras(0, 2000);
  check(ex.clock.running === false && ex.clock.leftMs === TODAY.turnMs - 100,
    "online, the clock froze during the meeting, and the trade reveal pauses the active person's own clock until they acknowledge it");
  t.ref.do(0, { k: 'ack', what: 'result', id: res[0].id }, 5000);
  check(t.ref.extras(0, 5000).results.length === 0 && t.ref.extras(0, 6000).clock.running === true && t.ref.extras(0, 6000).clock.leftMs === TODAY.turnMs - 1100,
    '...acknowledged: the result goes and the clock runs again');
  check(same(t.ref.do(0, { k: 'ack', what: 'result', id: res[0].id }, 6000), { ok: true }), 'an acknowledgement is safe to repeat');
}
{
  // Armed: canAttack true; the attack answer resolves the meeting; a bad weapon id is refused and the question stays.
  const t = scenarioTable({ seats: 4, people: [0], limits: TODAY });
  const Y = plainRoomNextToLobby(t).id;
  t.state.players[1].currentRoom = Y;
  const p = t.state.players[0];
  p.hand = hand(['lantern', 'knife', 'bandage']);
  t.ref.do(0, { k: 'move', to: Y }, 0);
  const q = t.ref.extras(0, 0).ask;
  const knife = p.hand.find(c => c.type === 'knife').id;
  const bad1 = t.ref.do(0, { k: 'answer', ask: q.id, value: { attack: 'cNope' } }, 10);
  const lantern = p.hand.find(c => c.type === 'lantern').id;
  const bad2 = t.ref.do(0, { k: 'answer', ask: q.id, value: { attack: lantern } }, 20);
  const bad3 = t.ref.do(0, { k: 'answer', ask: 'q999', value: 'trade' }, 30);
  const okA = t.ref.do(0, { k: 'answer', ask: q.id, value: { attack: knife } }, 40);
  check(q.kind === 'meetAct' && q.canAttack === true && same(q.weapons, [knife]) && bad1.reason === 'notYourCard' && bad2.reason === 'badAsk'
    && bad3.reason === 'badAsk' && okA.ok && t.state.events.at(-1).type === 'attack' && t.ref.stage === 'turn',
  'armed: canAttack with the weapons listed; a card not yours (notYourCard), a non-weapon or a wrong question (badAsk) refused; the attack resolves');
}
{
  // A sealed trade between two people: neither answer is visible before the swap, to anyone.
  const t = scenarioTable({ seats: 4, people: [0, 1], limits: TODAY });
  const Y = plainRoomNextToLobby(t).id;
  t.state.players[1].currentRoom = Y;
  t.ref.do(0, { k: 'move', to: Y }, 0);
  t.ref.do(0, { k: 'answer', ask: t.ref.extras(0, 0).ask.id, value: 'trade' }, 10);
  const q0 = t.ref.extras(0, 10).ask, q1 = t.ref.extras(1, 10).ask;
  const views = s => [0, 1, 2, 3].map(x => json(playerView(t.state, t.floor, x, t.ref.extras(x, 20)))).filter((_, x) => x !== s);
  const before = views(1);
  const before0 = json(playerView(t.state, t.floor, 0, t.ref.extras(0, 20)));
  t.ref.do(1, { k: 'answer', ask: q1.id, value: q1.cards[0] }, 15);
  const after = views(1);
  const after0 = json(playerView(t.state, t.floor, 0, t.ref.extras(0, 20)));
  check(q0?.kind === 'tradeCard' && q1?.kind === 'tradeCard' && q1.with === 0 && same(before, after) && before0 === after0,
    "a sealed trade between two people: both asked at once; one answering changes nothing anybody else sees (the other person's view byte-identical)");
  t.ref.do(0, { k: 'answer', ask: q0.id, value: q0.cards[0] }, 30);
  check(t.ref.stage === 'turn' && t.ref.extras(0, 30).results[0]?.kind === 'trade' && t.ref.extras(1, 30).results[0]?.kind === 'trade',
    '...the last answer swaps at once (no bot side, no beat); each gets their own trade result');
}
{
  // Fire Exit proposals: a person to a bot that declines (declined result); a bot to a person (offer question).
  const exitTable = (people, wrap) => {
    for (let seed = 1; seed < 100; seed++) {
      const t = makeTable({ seats: 4, seed, people, limits: TODAY, wrap, pace: () => 500 });
      growTo(t.floor, 'exit', { isLocked: id => S.isLocked(t.state, id) });
      for (const r of t.floor.roomList) t.state.discovered.add(r.id);
      if (!t.floor.exitRoom) continue;
      for (const s of [0, 1]) t.state.players[s].currentRoom = t.floor.exitRoom;
      return t;
    }
    return null;
  };
  const t = exitTable([0], wrapBots({ acceptTrade: () => false }));
  const r = t.ref.do(0, { k: 'trade', with: 1 }, 0);
  const mid = { phase: t.ref.extras(2, 0).phase, stage: t.ref.stage };
  t.ref.tick(500);
  const res = t.ref.extras(0, 500).results;
  check(r.ok && mid.stage === 'offer' && same(mid.phase, { kind: 'offer', seats: [0, 1] }) && res[0]?.kind === 'declined' && res[0].with === 1 && t.ref.stage === 'turn',
    "a person's Fire Exit proposal: the bot's reply beat, then a private 'declined' result");
  const once = makeTable({ seats: 4, seed: 3, people: [0], limits: PENDING });
  check(once.ref.toJSON().limits.offerOncePerTurn === true, '(the pending rules ask for one proposal a turn)');
  let nextA = { k: 'trade', with: 0 };
  const u = exitTable([0], wrapBots({ nextAction: () => { const a = nextA; nextA = { k: 'end' }; return a; } }));
  u.state.activeIndex = 1;
  const u2 = createReferee({ state: u.state, floor: u.floor, bots: u.bots, people: [0], mode: 'online', walkMode: 'atomic', limits: TODAY, pace: () => 500, now: 0 });
  u2.tick(500);
  const q = u2.extras(0, 500).ask;
  check(q?.kind === 'offer' && q.from === 1 && same(u2.phase, { kind: 'offer', seats: [1, 0] }), "a bot's proposal to a person: the person is asked (offer, from)");
  u2.do(0, { k: 'answer', ask: q.id, value: true }, 600);
  const q2 = u2.extras(0, 600).ask;
  check(q2?.kind === 'tradeCard' && q2.voluntary === true && q2.with === 1, '...accepted: the card question, marked voluntary');
}
{
  // The discard: private to the active person; the discard clock; discard privacy; the time-out.
  const t = scenarioTable({ seats: 4, people: [0], limits: TODAY });
  const p = t.state.players[0];
  p.hand.push(...hand(['knife', 'bandage', 'espresso', 'barricade']));
  const over = A.overHandLimit(p);
  t.ref.do(0, { k: 'end' }, 40000);          // 5 s left: the discard gets 10 s
  const q = t.ref.extras(0, 40000).ask;
  const out = t.ref.extras(2, 40000);
  check(t.ref.stage === 'discard' && q?.kind === 'discard' && q.over === over && q.leftMs === TODAY.discardMinMs && t.ref.extras(0, 40000).phase.kind === 'discard'
    && out.phase.kind === 'turn' && out.clock.kind === 'turn' && out.clock.leftMs === 5000 && out.ask === null,
  `ending ${over} over the limit with 5 s left: a private discard question with 10 s; everyone else sees the turn and its clock (5 s)`);
  const out2 = t.ref.extras(2, 46000);
  check(out2.clock.leftMs === 0 && out2.phase.kind === 'turn', '...after 6 s the others see the turn clock holding at 0:00, still the turn');
  const r1 = t.ref.do(0, { k: 'discard', card: q.cards[0] }, 41000);
  const q2 = t.ref.extras(0, 41000).ask;
  const poss = p.hand.find(c => c.type === 'possession');
  const rp = poss ? t.ref.do(0, { k: 'discard', card: poss.id }, 41000) : { ok: false, reason: 'undroppable' };
  check(r1.ok && q2.kind === 'discard' && q2.over === over - 1 && q2.id === q.id && !rp.ok, 'each discard updates the question; a Possession card cannot be discarded');
  t.ref.tick(40000 + TODAY.discardMinMs + GRACE);
  const res = t.ref.extras(0, 50600).results;
  check(t.state.turn === 2 && A.overHandLimit(p) === 0 && res.some(r => r.kind === 'autoDiscarded' && r.cards.length === over - 1),
    '...the discard clock runs out (+ the 0.5 s grace): random ordinary discards, a private autoDiscarded result, the turn passes');
  // 7b in miniature: the same outsider extras whether the person ends under the limit at t, or over it earlier and
  // discards the last card at t.
  const run = overLimit => {
    const v = scenarioTable({ seats: 4, people: [0], limits: TODAY, seed: 5 });
    const pv = v.state.players[0];
    pv.hand = hand(overLimit ? ['lantern', 'knife', 'bandage', 'espresso', 'barricade', 'flashlight', 'handMirror'] : ['lantern', 'knife']);
    const seen = [];
    const look = now => seen.push(json([1, 2, 3].map(s => v.ref.extras(s, now))));
    for (const now of [1000, 5000]) look(now);
    if (overLimit) { v.ref.do(0, { k: 'end' }, 6000); look(7000); v.ref.do(0, { k: 'discard', card: v.ref.extras(0, 7000).ask.cards[0] }, 9000); }
    else { look(7000); v.ref.do(0, { k: 'end' }, 9000); }
    look(9000); look(12000);
    return seen;
  };
  check(same(run(false), run(true)), 'discard privacy: what the others see is identical whether the turn passed under the limit or after a discard (same moment)');
}
{
  // Results: found (a search), mirror (a Hand Mirror), notes (at the turn start), noTrade, autoDiscarded (turn clock).
  const t = scenarioTable({ seats: 4, people: [0], limits: TODAY });
  const p = t.state.players[0];
  const Y = plainRoomNextToLobby(t).id;
  p.currentRoom = Y;
  const s1 = t.ref.do(0, { k: 'search' }, 100);
  const f = t.ref.extras(0, 100).results[0];
  check(s1.ok && !('result' in s1) && f?.kind === 'found' && Array.isArray(f.cards) && f.cards.every(c => p.hand.some(h => h.id === c.id)) && 'where' in f && f.pickup === false,
    'a search: no command result; a private found result (cards with ids, where, pickup)');
  t.ref.do(0, { k: 'ack', what: 'result', id: f.id }, 200);
  t.state.players[1].currentRoom = Y;
  p.hand.push(...hand(['handMirror']));
  const mid = p.hand.find(c => c.type === 'handMirror').id;
  const bad = t.ref.do(0, { k: 'card', type: 'handMirror', card: mid, target: 9 }, 300);
  const m1 = t.ref.do(0, { k: 'card', type: 'handMirror', card: mid, target: 1 }, 300);
  const mr = t.ref.extras(0, 300).results[0];
  check(bad.reason === 'badTarget' && m1.ok && !('result' in m1) && mr?.kind === 'mirror' && mr.target === 1
    && same(mr.hand.map(c => c.type).sort(), t.state.players[1].hand.map(c => c.type).sort()) && mr.hand.every(c => !('id' in c)),
  "a Hand Mirror on seat 1: a private mirror result with seat 1's cards as types (never ids); a missing seat is badTarget");
  t.ref.do(0, { k: 'ack', what: 'result', id: mr.id }, 400);
  // noTrade: a guest with no ordinary card
  const u = scenarioTable({ seats: 4, people: [0], limits: TODAY, pace: () => 100 });
  const Y2 = plainRoomNextToLobby(u).id;
  u.state.players[1].currentRoom = Y2;
  u.state.players[1].hand = u.state.players[1].hand.filter(c => c.type === 'possession');
  u.ref.do(0, { k: 'move', to: Y2 }, 0);
  u.ref.do(0, { k: 'answer', ask: u.ref.extras(0, 0).ask.id, value: 'trade' }, 10);
  const nt = u.ref.extras(0, 10).results[0];
  check(nt?.kind === 'noTrade' && nt.with === 1 && same(nt.empty, [u.state.players[1].id]) && nt.notes.length === 1 && u.ref.stage === 'turn',
    'a trade with a guest who has no ordinary card: skipped at once, a private noTrade result naming who had nothing');
  // notes at the turn start
  const w = makeTable({ seats: 4, seed: 8, people: [1], limits: TODAY, pace: () => 0, wrap: wrapBots({ nextAction: () => ({ k: 'end' }) }) });
  w.state.players[1].notes.push('A line for later.');
  w.ref.tick(0);
  const nr = w.ref.extras(1, 0).results.find(r => r.kind === 'notes');
  check(w.state.activeIndex === 1 && nr && same(nr.lines, ['A line for later.']), 'your turn starts with notes waiting: a private notes result ("While the others played")');
  w.ref.do(1, { k: 'ack', what: 'notes', lines: ['A line for later.'] }, 10);
  check(w.state.players[1].notes.length === 0 && !w.ref.extras(1, 10).results.some(r => r.kind === 'notes'), '...ack notes with those lines removes them, and the notes result with them');
  // the turn clock runs out over the limit: random discards, autoDiscarded
  const x = scenarioTable({ seats: 4, people: [0], limits: TODAY });
  x.state.players[0].hand.push(...hand(['knife', 'bandage', 'espresso']));
  x.ref.tick(TODAY.turnMs + GRACE - 1);
  const t1 = x.state.turn;
  const late = x.ref.do(0, { k: 'move', to: plainRoomNextToLobby(x).id }, TODAY.turnMs + 300);
  x.ref.tick(TODAY.turnMs + GRACE);
  x.ref.tick(TODAY.turnMs + 1000 + GRACE);
  const ad = x.ref.extras(0, TODAY.turnMs + 2000).results.find(r => r.kind === 'autoDiscarded');
  check(t1 === 1 && x.state.turn === 2 && ad && ad.cards.length >= 1 && A.overHandLimit(x.state.players[0]) === 0,
    "today's turn clock runs out over the hand limit: random ordinary discards and a private autoDiscarded result");
  check(late.ok && late.result.rooms.length === 2, '...a command 0.3 s after zero still counts (the 0.5 s grace): the move was made');
}
{
  // The stall (TP3): one wait over 5 minutes stops the match without a result; its countdown shows after 60 s.
  const t = scenarioTable({ seats: 4, people: [0], limits: TODAY });
  const Y = plainRoomNextToLobby(t).id;
  t.state.players[1].currentRoom = Y;
  t.ref.do(0, { k: 'move', to: Y }, 0);
  t.ref.tick(59000);
  const a = t.ref.extras(2, 59000).stall;
  t.ref.tick(60000);
  const b = t.ref.extras(2, 60000).stall;
  t.ref.tick(TODAY.stallMs - 1);
  const c = t.ref.stage;
  t.ref.tick(TODAY.stallMs);
  const end = t.ref.extras(0, TODAY.stallMs).end;
  const v = playerView(t.state, t.floor, 0, t.ref.extras(0, TODAY.stallMs));
  check(a === null && b?.leftMs === TODAY.stallMs - 60000 && c === 'meet:act' && t.ref.stage === 'ended' && same(end, { won: null, dawn: false, stopped: 'stall' })
    && v.end?.stopped === 'stall' && v.end.won === null && v.end.reveal.length === 4 && !t.state.finished,
  'a person never answers: after 60 s everyone sees the stall countdown; at 5 minutes the match stops without a result (end.stopped stall)');
  const l = scenarioTable({ seats: 4, people: [0], limits: LOCAL_LIMITS, mode: 'local', walkMode: 'atomic' });
  const Y2 = plainRoomNextToLobby(l).id;
  l.state.players[1].currentRoom = Y2;
  l.ref.do(0, { k: 'move', to: Y2 }, 0);
  l.ref.tick(60 * 60e3);
  check(l.ref.stage === 'meet:act' && l.ref.extras(0, 3600e3).stall === null, 'Single player: no stall, the question simply waits for you');
}
{
  // The pending proposals (R3/R4/R5): time-outs after 20 s with a private timedOut result; the screen pause capped.
  const t = scenarioTable({ seats: 4, people: [0], limits: PENDING, random: forkRng(9), pace: () => 100 });
  const Y = plainRoomNextToLobby(t).id;
  for (const s of [1, 2]) t.state.players[s].currentRoom = Y;
  t.ref.do(0, { k: 'move', to: Y }, 0);
  const q = t.ref.extras(0, 0).ask;
  t.ref.tick(PENDING.meetMs + GRACE - 1);
  const q1 = t.ref.extras(0, PENDING.meetMs).ask;
  t.ref.tick(PENDING.meetMs + GRACE);
  const q2 = t.ref.extras(0, PENDING.meetMs + GRACE).ask;
  check(q.kind === 'meetWhom' && q.leftMs === PENDING.meetMs && q1.id === q.id && q2?.kind === 'meetAct'
    && t.ref.extras(0, PENDING.meetMs + GRACE).results.some(r => r.kind === 'timedOut' && r.ask === 'meetWhom'),
  'pending R3: whom to meet times out after 20 s (+ grace): a random guest, a private timedOut result');
  const t2 = PENDING.meetMs + GRACE;
  t.ref.tick(t2 + PENDING.meetMs + GRACE);
  const q3 = t.ref.extras(0, t2 + PENDING.meetMs + GRACE).ask;
  check(q3?.kind === 'tradeCard', '...Trade or Attack times out to Trade');
  const t3 = t2 + PENDING.meetMs + GRACE;
  t.ref.tick(t3 + PENDING.cardMs + GRACE);
  const res = t.ref.extras(0, t3 + PENDING.cardMs + GRACE).results;
  t.ref.tick(t3 + PENDING.cardMs + GRACE + 100);
  const res2 = t.ref.extras(0, t3 + PENDING.cardMs + GRACE + 200).results;
  check(res.some(r => r.kind === 'timedOut' && r.ask === 'tradeCard' && r.gave && r.gave !== 'possession') && res2.some(r => r.kind === 'trade'),
    '...the card times out to a random ordinary card (timedOut names it); then the swap');
  const now = t3 + PENDING.cardMs + GRACE + 200;
  const ex1 = t.ref.extras(0, now + 5000).clock, ex2 = t.ref.extras(0, now + 20000).clock;
  check(ex1.running === false && ex2.running === true && ex2.leftMs < ex1.leftMs,
    'pending R4: the private-screen pause is capped (10 s), then the clock runs on');
}
{
  // Refusals, with their reasons.
  const t = scenarioTable({ seats: 4, people: [0, 1], limits: TODAY });
  const p = t.state.players[0];
  const reasons = [
    t.ref.do(1, { k: 'search' }, 0).reason,
    t.ref.do(0, { k: 'search', turn: 7 }, 0).reason,
    t.ref.do(0, { k: 'card', type: 'bandage', card: t.state.players[1].hand[0].id }, 0).reason,
    t.ref.do(0, { k: 'answer', ask: 'q42', value: 1 }, 0).reason,
    t.ref.do(0, { k: 'discard', card: p.hand[0].id }, 0).reason,
    t.ref.do(0, { k: 'wave' }, 0).reason,
    t.ref.do(2, { k: 'end' }, 0).reason,
    t.ref.do(0, { k: 'move', to: lobbyOf(t) }, 0).reason,
  ];
  check(same(reasons, ['notYourTurn', 'stale', 'notYourCard', 'badAsk', 'notNow', 'unknown', 'notYourTurn', 'here']),
    `refusals: not your turn, stale, not your card, bad question, not now, unknown, a bot's seat, the engine's own (${reasons.join(', ')})`);
  check(t.state.events.length === 1 && t.state.turn === 1, '...and none of them changed anything');
}

// --- 5. device walks -------------------------------------------------------------------------------------------------
console.log('\ndevice walks (Single player): the page walks the figure, the referee charges each doorway and cuts walks short');
{
  // Today's rule in miniature (main.js:610-648), written out independently: a walk along route R whose clock runs out
  // after k rooms were entered (k = 0: still in the room it started from) ends in R[1] when k = 0, else in R[k]; one
  // action point per room entered; the turn then ends once the guest has arrived.
  const expected = (route, k) => (k === 0 ? route[1] : route[k]);
  let walks = 0, good = 0, cuts = 0, full = 0, multi = 0;
  const bad = [];
  for (let seed = 1; walks < 100 && seed < 2000; seed++) {
    const t = makeTable({ seats: 4, seed: 900 + seed, people: [0], mode: 'local', walkMode: 'device', limits: LOCAL_LIMITS, grow: 9, pace: () => 1e9 });
    const p = t.state.players[0];
    for (const q of t.state.players) q.currentRoom = lobbyOf(t);
    const dests = t.floor.roomList.map(r => r.id).filter(id => id !== lobbyOf(t));
    const plans = dests.map(id => planWalk(t.state, t.floor, p, id)).filter(x => x.ok);
    if (!plans.length) continue;
    const plan = plans.sort((a, b) => b.rooms.length - a.rooms.length)[seed % Math.min(3, plans.length)];
    const route = plan.rooms, n = route.length - 1;
    if (n >= 2) multi++;
    const k = seed % (n + 1);           // rooms entered before the clock runs out (n: it never does)
    walks++;
    const r = t.ref.do(0, { k: 'move', to: route[n] }, 0);
    const ev = t.ref.drain();
    const busy = t.ref.do(0, { k: 'search' }, 0).reason;
    const okStart = r.ok && same(r.result.rooms, route) && same(ev, [{ to: 'all', ev: { type: 'walk', seat: 0, rooms: route } }]) && p.actionPoints === 4 && p.currentRoom === route[0]
      && busy === 'notNow';
    let now = 0;
    for (let i = 1; i <= Math.min(k, n); i++) { t.ref.step(route[i], now += 400); t.ref.advance(16, now); }
    let cutTo = null, ended = false;
    if (k < n) {
      t.ref.setTimeLeft(30);
      t.ref.advance(50, now += 50);
      const c = t.ref.drain();
      cutTo = c[0]?.ev?.type === 'walkCut' ? c[0].ev.to : 'none';
      if (cutTo !== p.currentRoom) t.ref.step(cutTo, now += 400);
      t.ref.advance(16, now += 16);
      const stillTurn = t.state.turn === 1;
      t.ref.arrived(now);
      t.ref.advance(16, now += 16);
      ended = stillTurn && t.state.turn === 2;
      cuts++;
    } else {
      t.ref.arrived(now);
      ended = t.state.turn === 1;          // (not cut: the turn goes on)
      full++;
    }
    const want = k < n ? expected(route, k) : route[n];
    const entered = k < n ? (k === 0 ? 1 : k) : n;
    const okEnd = (k < n ? cutTo === want : true) && t.state.players[0].currentRoom === want && (t.state.turn === 2 || p.actionPoints === 4 - entered)
      && t.state.events.filter(e => e.type === 'enter').length === entered && ended;
    if (okStart && okEnd) good++; else bad.push(`seed ${seed}: route ${route.length} k ${k} -> ${t.state.players[0].currentRoom} want ${want} cut ${cutTo}`);
  }
  check(walks === 100 && good === 100, `100 seeded walks: one action point per doorway, cut short at zero exactly as today (${cuts} cut, ${full} whole, ${multi} of 2+ rooms) — ${good}/${walks}${bad.length ? ' — ' + bad[0] : ''}`);
}
{
  // step with no walk in progress (the walkTo debug path), holds, and the 50 ms frame cap.
  const t = scenarioTable({ seats: 4, people: [0], mode: 'local', walkMode: 'device', limits: LOCAL_LIMITS, pace: () => 300 });
  const p = t.state.players[0];
  for (const q of t.state.players) q.currentRoom = lobbyOf(t);
  const Y = plainRoomNextToLobby(t).id;
  const far = t.floor.roomList.find(r => r.id !== lobbyOf(t) && !t.floor.rooms.get(lobbyOf(t)).neighbours.has(r.id))?.id;
  const r1 = far ? t.ref.step(far, 0) : { ok: false, reason: 'notAdjacent' };
  const r2 = t.ref.step(Y, 0);
  check(r1.reason === 'notAdjacent' && r2.ok && p.currentRoom === Y && p.actionPoints === 3 && t.state.events.at(-1).type === 'enter',
    'step with no walk in progress: into an adjacent room (one action point, the enter event); a room not next door is refused');
  t.ref.arrived(0);
  p.actionPoints = 0;
  check(t.ref.step(lobbyOf(t), 0).reason === 'ap', '...and with no action point left it is refused');
  p.actionPoints = 4;
  const left0 = t.ref.timeLeft();
  t.ref.hold({ clock: true });
  for (let i = 0; i < 10; i++) t.ref.advance(16);
  const held = t.ref.timeLeft();
  t.ref.hold({});
  t.ref.advance(500);
  check(held === left0 && t.ref.timeLeft() === left0 - 50, 'hold.clock stops the clock; one frame never counts more than 50 ms');
  t.ref.do(0, { k: 'end' }, 1000);
  const b = t.ref.toJSON().bot;
  t.ref.hold({ bots: true });
  t.ref.tick(b.due + 5000);
  const heldBot = t.ref.toJSON().bot.steps;
  t.ref.hold({});
  t.ref.tick(b.due + 5001);
  check(t.state.activeIndex === 1 && heldBot === 0 && t.ref.toJSON().bot.steps === 1, 'hold.bots: a bot waits however long, then steps when released');
}
{
  // A bot's walk in device mode: the walk event, the page's steps, the meeting beat on arrival; walkFailed is a refusal.
  const goal = {};
  const t = scenarioTable({ seats: 4, people: [3], mode: 'local', walkMode: 'device', limits: LOCAL_LIMITS, pace: () => 500,
    wrap: wrapBots({ nextAction: () => ({ k: 'move', to: goal.room }), attackWith: () => null }) });
  const Y = plainRoomNextToLobby(t).id;
  goal.room = Y;
  t.state.players[1].currentRoom = Y;
  t.ref.tick(500);
  const ev = t.ref.drain();
  const walk = ev[0]?.ev;
  const mid = t.ref.tick(5000);
  t.ref.step(Y, 5100);
  t.ref.arrived(5200);
  const stage = t.ref.stage;
  t.ref.tick(5700);
  check(walk?.type === 'walk' && walk.seat === 0 && same(walk.rooms, [lobbyOf(t), Y]) && mid === false && stage === 'meet:whom'
    && t.state.events.some(e => e.type === 'trade' || e.type === 'noTrade'),
  "a bot's walk: the walk event, nothing until the page reports it; on arrival the meet beat, then the meeting");
  const goal2 = {};
  const u = scenarioTable({ seats: 4, people: [3], mode: 'local', walkMode: 'device', limits: LOCAL_LIMITS, pace: () => 500,
    wrap: wrapBots({ nextAction: () => ({ k: 'move', to: goal2.room }), reject: () => undefined }) });
  goal2.room = plainRoomNextToLobby(u).id;
  u.ref.tick(500);
  u.ref.drain();
  u.ref.walkFailed(600);
  const bj = u.ref.toJSON().bot;
  check(bj.refusals === 1 && bj.due === 750 && u.bots.calls.some(c => c[0] === 'reject' && c[3] === 'refused') && !u.ref.walking,
    'walkFailed (the page could not plan the walk): a refused action, reported to the bot, tried again 150 ms later');
}
{
  // Single player's whole matches: one scripted person in device walks, the page's clock and holds, LOCAL_LIMITS.
  let ended = 0, errors = 0, frames = 0, cuts = 0, firstErr = null, holds = 0;
  for (let k = 0; k < 10; k++) {
    try {
      const seats = 4 + (k % 3);
      const t = makeTable({ seats, seed: 61000 + k * 17, people: [k % seats], mode: 'local', walkMode: 'device', limits: LOCAL_LIMITS,
        ackRoles: false, pace: (s, kind) => 300 + 100 * ((s + kind.length) % 5) });
      const folk = createPeople(t, { seed: 300 + k, junk: 0.03, delay: k % 2 ? [1500, 9000] : [100, 3000] });
      let now = 0, walk = null, wi = 0, cut = null;
      while (t.ref.stage !== 'ended' && frames < 4e6 && now < 6 * 3600e3) {
        frames++;
        now += 50;
        const screens = t.people.some(s => t.ref.extras(s, now).results.length > 0);
        t.ref.hold({ bots: screens || !!walk, clock: screens });
        if (screens) holds++;
        t.ref.advance(50, now);
        for (const { ev } of t.ref.drain()) {
          if (ev.type === 'walk') { walk = ev; wi = 1; cut = null; }
          if (ev.type === 'walkCut') { cut = ev.to; cuts++; }
        }
        if (walk && now % 400 === 0) {
          const p = t.state.players[walk.seat];
          if (cut != null) { if (p.currentRoom !== cut) t.ref.step(cut, now); t.ref.arrived(now); walk = null; }
          else if (wi < walk.rooms.length) t.ref.step(walk.rooms[wi++], now);
          else { t.ref.arrived(now); walk = null; }
        }
        if (!walk) folk.step(now);
        t.ref.tick(now);
      }
      if (t.ref.stage === 'ended' && t.state.finished) ended++;
    } catch (err) { errors++; firstErr ||= err.stack.split('\n').slice(0, 3).join(' | '); }
  }
  check(errors === 0 && ended === 10, `10 Single player matches (LOCAL_LIMITS, device walks, the page's holds): all finished, no exception (${frames} frames, ${cuts} walks cut short)${firstErr ? ' — ' + firstErr : ''}`);
}

// --- 6. snapshot ---------------------------------------------------------------------------------------------------------
console.log('\nsnapshot and restore');
{
  // The hotel and state through the snapshot: identical.
  const m = newMatch(6, 4242, { floor: newFloor() });
  const ref = autoplayReferee(m);
  for (let i = 0; i < 400 && m.state.turn < 14; i++) { const d = ref.nextDue(); if (d == null) break; ref.tick(d); }
  const snap = toSnapshot(m.state, m.floor);
  const back = fromSnapshot(json(snap), { hotelData: hotel, cfg: config, rng: () => 0.5, hotelRng: () => 0.5 });
  const shape = f => json({ rooms: f.roomList.map(r => [r.id, r.cell, r.rotation, [...r.doorSides], r.doorways.map(d => d.id), r.frontier.map(d => [d.id, d.jammed]), r.walls.length, [...r.neighbours]]),
    doorways: f.doorways.map(d => [d.id, d.a, d.b]), frontier: f.frontier.map(d => [d.id, d.jammed]), walls: f.walls.map(w => w.id), bounds: f.bounds, start: f.start, exit: f.exitRoom, deck: f.deck.map(t => t.id), version: f.version });
  check(snap.v === SNAPSHOT_VERSION && same(JSON.parse(json(snap)), snap) && !json(snap).includes('"rng"'), 'a snapshot is plain JSON data (no functions, no generator)');
  check(shape(back.floor) === shape(m.floor), `the hotel rebuilt from its placements is the same hotel (${m.floor.roomList.length} rooms, doorways, closed and jammed doors, walls, deck order)`);
  check(same(toSnapshot(back.state, back.floor), snap) && back.state.discovered instanceof Set && back.state.roomDrops instanceof Map && back.state.players[0].knows instanceof Set,
    'the state comes back whole (Sets and Maps as Sets and Maps); its snapshot again is identical');
}

{
  // A restored table gets its time back: shift(outage + 15 s) moves every clock, deadline and step later.
  const t = makeTable({ seats: 4, seed: 12, people: [0], limits: TODAY });
  t.ref.tick(15000);
  const saved = json({ engine: toSnapshot(t.state, t.floor), referee: t.ref.toJSON() });
  const back = fromSnapshot(JSON.parse(saved).engine, { hotelData: hotel, cfg: config, rng: forkRng(1), hotelRng: forkRng(2) });
  const r2 = createReferee.restore(JSON.parse(saved).referee, { state: back.state, floor: back.floor, bots: createBotTable(back.state, back.floor, [1, 2, 3].map(index => ({ index, profile: null })), 5) });
  r2.shift(60000 + ONLINE.timing.restoreGraceMs);
  const a = r2.extras(0, 75000).clock.leftMs, b = r2.extras(0, 105000).clock.leftMs;
  r2.tick(75000 + 30000 + 15000 + GRACE - 1);
  const before = back.state.turn;
  r2.tick(75000 + 30000 + 15000 + GRACE);
  check(a === 30000 && b === 15000 && before === 1 && back.state.turn === 2,
    'a restore after a 60 s outage, shifted by the outage + 15 s: the person still has their 30 s, plus 15 s; the turn then ends on time');
}

// drive() with a stop condition: until the turn number reaches `stopTurn`.
function driveTo(t, folk, stopTurn, now = 0) {
  let guard = 0;
  while (t.ref.stage !== 'ended' && t.state.turn < stopTurn && guard++ < 400000) {
    folk.step(now);
    t.ref.tick(now);
    const next = folk.step(now);
    const due = t.ref.nextDue();
    const n = Math.min(next, due ?? Infinity);
    if (!Number.isFinite(n)) break;
    now = Math.max(now + 1, n);
  }
  return now;
}
{
  let identical = 0, cases = 0, ended = 0, errors = 0, firstErr = null, plainRef = 0;
  const sizes = [], at = {};
  for (let k = 0; cases < 150 && k < 400; k++) {
    try {
      const seats = 4 + (k % 3);
      const people = k % 3 === 0 ? [] : k % 3 === 1 ? [k % seats] : [0, 1 + (k % (seats - 1))];
      const floor = newFloor();
      const botSeats = [...Array(seats).keys()].filter(i => !people.includes(i));
      const m = newMatch(seats, 80000 + k * 7, { floor, seats: botSeats });
      m.state.rng = forkRng(k * 3 + 1); floor.rng = forkRng(k * 3 + 2);
      const randomA = { fn: forkRng(k * 3 + 3) };
      const limits = k % 4 === 0 ? PENDING : TODAY;
      const base = { people, mode: 'online', walkMode: 'atomic', botRules: 'page', limits, walkMs: (s, rooms) => (rooms.length - 1) * 250 };
      const t = { state: m.state, floor, people };
      t.ref = createReferee({ ...base, state: m.state, floor, bots: m.table, random: () => randomA.fn(), now: 0 });
      const folk = createPeople(t, { seed: 900 + k, unreliable: k % 7 === 0 ? people.slice(0, 1) : [], junk: 0.03 });
      const now0 = driveTo(t, folk, 4 + (k % 19));
      // fork at a moment inside the turn (a meeting, a question, a beat or a discard may be under way)
      const { now } = drive(t, folk, { now: now0, until: now0 + ((k * 7919) % 30000) });
      if (t.ref.stage === 'ended') continue;
      cases++;
      const R0 = t.ref.toJSON();
      const what = R0.beat ? `${R0.beat.kind} beat` : Object.values(R0.asks).length ? `${Object.values(R0.asks)[0].kind} question` : R0.stage;
      at[what] = (at[what] || 0) + 1;
      // the fork
      const text = json({ engine: toSnapshot(m.state, floor), referee: t.ref.toJSON() });
      sizes.push(json(toSnapshot(m.state, floor)).length);
      if (same(JSON.parse(json(t.ref.toJSON())), t.ref.toJSON())) plainRef++;
      const forkSeed = 31337 + k;
      const srcB = { state: m.state.rng.fork(), hotel: floor.rng.fork(), random: randomA.fn.fork() };
      // A: the live objects, fresh minds
      const botsA = createBotTable(m.state, floor, botSeats.map(index => ({ index, profile: null })), forkSeed);
      t.ref.setBots(botsA);
      const folkA = folk.fork(t);
      // B: through the JSON text
      const saved = JSON.parse(text);
      const back = fromSnapshot(saved.engine, { hotelData: hotel, cfg: config, rng: srcB.state, hotelRng: srcB.hotel });
      const botsB = createBotTable(back.state, back.floor, botSeats.map(index => ({ index, profile: null })), forkSeed);
      const tB = { state: back.state, floor: back.floor, people };
      tB.ref = createReferee.restore(saved.referee, { ...base, state: back.state, floor: back.floor, bots: botsB, random: () => srcB.random() });
      const folkB = folk.fork(tB);
      drive(t, folkA, { now });
      drive(tB, folkB, { now });
      const fin = x => json({ events: x.state.events, inbox: x.state.players.map(p => p.inbox), won: x.state.won, dawn: x.state.dawn, turn: x.state.turn,
        round: x.state.round, stage: x.ref.stage, end: x.ref.extras(0).end, hands: x.state.players.map(p => p.hand.map(c => c.type)) });
      if (t.ref.stage === 'ended' && tB.ref.stage === 'ended') ended++;
      if (fin(t) === fin(tB)) identical++;
    } catch (err) { errors++; firstErr ||= `${k}: ${err.stack.split('\n').slice(0, 4).join(' | ')}`; }
  }
  sizes.sort((a, b) => a - b);
  check(errors === 0, `no exception (${errors})${firstErr ? ' — ' + firstErr : ''}`);
  check(cases === 150 && identical === cases && ended === cases,
    `6a. lossless: ${identical}/${cases} forked matches play out identically on the live objects and through the JSON snapshot (fresh minds of one seed, forked random sources); all ended`);
  check(plainRef === cases, `ref.toJSON() is plain data: JSON round trip deep-equal (${plainRef}/${cases})`);
  console.log(`       forked during: ${Object.entries(at).sort((a, b) => b[1] - a[1]).map(([w, n]) => `${w} ${n}`).join(', ')}`);
  check(Object.keys(at).length >= 5, `...forks were taken in the middle of things too (${Object.keys(at).length} different situations)`);
  console.log(`       snapshot size: median ${(sizes[sizes.length >> 1] / 1024).toFixed(1)} KB, max ${(sizes.at(-1) / 1024).toFixed(1)} KB (${sizes.length} snapshots)`);
}
{
  // 6b. Fresh minds of NEW seeds after a restore catch up from the start of the match and finish it legally.
  let finished = 0, cases = 0, errors = 0, firstErr = null, legal = 0;
  for (let k = 0; cases < 100 && k < 300; k++) {
    try {
      const seats = 4 + (k % 3);
      const people = k % 2 ? [k % seats] : [];
      const floor = newFloor();
      const botSeats = [...Array(seats).keys()].filter(i => !people.includes(i));
      const m = newMatch(seats, 120000 + k * 11, { floor, seats: botSeats });
      const base = { people, mode: 'online', walkMode: 'atomic', botRules: 'page', limits: TODAY, walkMs: (s, rooms) => (rooms.length - 1) * 250 };
      const t = { state: m.state, floor, people };
      t.ref = createReferee({ ...base, state: m.state, floor, bots: m.table, random: forkRng(k + 5), now: 0 });
      const folk = createPeople(t, { seed: 1300 + k, junk: 0 });
      const now = driveTo(t, folk, 3 + (k % 20));
      if (t.ref.stage === 'ended') continue;
      cases++;
      const saved = JSON.parse(json({ engine: toSnapshot(m.state, floor), referee: t.ref.toJSON() }));
      const back = fromSnapshot(saved.engine, { hotelData: hotel, cfg: config, rng: forkRng(k + 77), hotelRng: forkRng(k + 78) });
      const bots = createBotTable(back.state, back.floor, botSeats.map(index => ({ index, profile: null })), 999000 + k);
      const tB = { state: back.state, floor: back.floor, people };
      tB.ref = createReferee.restore(json(saved.referee), { ...base, state: back.state, floor: back.floor, bots, random: forkRng(k + 79) });
      drive(tB, createPeople(tB, { seed: 1300 + k, junk: 0 }), { now });
      if (tB.ref.stage === 'ended' && (tB.state.finished || tB.ref.extras(0).end?.stopped)) finished++;
      const cards = tB.state.players.reduce((n, p) => n + countableCount(p.hand), 0) + tB.state.drawPile.length + tB.state.discardPile.length
        + [...tB.state.roomDrops.values()].reduce((n, l) => n + l.length, 0);
      const deckSize = Object.values(rules.deck).reduce((a, b) => a + b, 0);
      if (cards <= deckSize && tB.state.players.every(p => p.health >= 0 && p.actionPoints >= 0)) legal++;
    } catch (err) { errors++; firstErr ||= `${k}: ${err.stack.split('\n').slice(0, 4).join(' | ')}`; }
  }
  check(errors === 0 && cases === 100 && finished === cases && legal === cases,
    `6b. fresh minds of new seeds after a restore: ${finished}/${cases} matches finished, legally (cards accounted for, nothing negative)${firstErr ? ' — ' + firstErr : ''}`);
}

console.log(`\n${failures ? `${failures} FAILED` : 'ALL REFEREE CHECKS PASSED'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failures ? 1 : 0);
