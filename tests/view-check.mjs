// Checks the per-player view (src/net/playerView.js, viewAsState.js, floorCopy.js, aliases.js): what each person's
// screens receive in Single player and in Co-op (DESIGN §6.8 tests 1-5 and 8). Fast, no browser.
//   node tests/view-check.mjs
//
//   1. purity: the four files use no DOM, THREE, Node API, Math.random, clock, timer or engine random generator
//   2. card aliases: 8 characters, never starting with 'c', never issued twice; a card that leaves a hand loses its
//      alias and comes back with a new one; saved and restored; identity aliases for Single player
//   3. events and ordinals: each seat's stream is the public events plus its own inbox, numbered 1, 2, 3 ... with no
//      gap, no engine `seq`; ordinalOf agrees
//   4. 24 seeded matches at 4, 5 and 6 guests, played by the bots straight through (src/bots/autoplay.js) with every
//      seat treated as a person's. At random points in rounds 1-6, for every living seat:
//      - SCRAMBLE: everything that seat can't know is replaced at random (others' hands, roles, knows, notes,
//        inboxes, convertedBy, action points; the draw and discard piles, keeping whether a search could draw; what
//        lies on floors; the room deck's order; the engine's event numbers; the generators). The view, the question,
//        the results, the event stream and the reason of every command the seat could send are byte-identical;
//      - the key whitelist (exactly DESIGN §6.1; private keys only under `me`, the results and the end);
//      - no engine card id present in the real state appears anywhere in the view (real aliases, set membership);
//      - JSON round trip; card fields (a soul's owner, a Revolver's shots) where the screens draw them;
//      - the button checks (canSearch, canEscape, roomRoute, ...) give the same answers on viewAsState + the floor
//        copy as on the real state, with real aliases and with identity aliases; so does what the seat knows
//        (knownPossessed); the presenter built update by update equals one built at once.
//      Throughout, after every bot action, for every seat:
//      - IDENTITY: one long-lived presenter state per seat (applyView): its guest records and its event list stay
//        the same objects within a match and are new at a new match; a copy of the feed's logic (src/ui/feed.js
//        sync) reports exactly the lines today's feed would, each once; gameSounds' "state.events !== list" reset
//        never fires within a match; the public events and the inbox arrive complete and in order;
//      - the floor copy (one object across all matches) equals the real floor at every 3rd turn and at the end;
//      - the size of each view (mean and max printed).
//      At the end: the roles revealed, the whole history, and Your record (matchSummary) the same as on the real state.
//   5. 12 more matches dealt as a Co-op table deals them (crypto-style sources, the table's own card ids c1, c2 ...):
//      no engine id, round trip, floor copy.
//   6. applyView cases: a seat switch, a new match with the same guests, a reconnect (fresh), the stall end,
//      practice, bot labels off.
import fs from 'node:fs';
import { isDeepStrictEqual } from 'node:util';
import { rules } from '../src/data/rules.js';
import { hotel } from '../src/data/hotel.js';
import { config } from '../src/config.js';
import { roster } from '../src/data/characters.js';
import { makeRng, makeCard, CARDS } from '../src/game/cards.js';
import { createHotel } from '../src/game/hotel.js';
import * as S from '../src/game/state.js';
import * as A from '../src/game/actions.js';
import { roomRoute } from '../src/game/moves.js';
import { knownPossessed } from '../src/game/knowledge.js';
import { playBotTurn, planWalk } from '../src/bots/autoplay.js';
import { botAvatars } from '../src/table.js';
import { matchSummary } from '../src/matchSummary.js';
import { cryptoRng } from '../src/net/rng.js';
import { playerView, seatEvents, ordinalOf, LOG_LINES } from '../src/net/playerView.js';
import { applyView, viewAsState, blankState, HIDDEN_CARD } from '../src/net/viewAsState.js';
import { createFloorCopy, syncFloor, HIDDEN_TILE } from '../src/net/floorCopy.js';
import { createAliases, identityAliases, ALIAS_LENGTH } from '../src/net/aliases.js';
import { newMatch, newFloor } from './lib/matches.mjs';

const t0 = Date.now();
let failures = 0;
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
// A check made many times: counted, and the first few failures shown.
function tally(name) {
  const t = { name, n: 0, bad: 0, notes: [] };
  t.add = (ok, note) => { t.n++; if (!ok) { t.bad++; if (t.notes.length < 3) t.notes.push(note); } return ok; };
  t.report = (msg = name) => check(t.n > 0 && t.bad === 0, `${msg} (${t.n - t.bad}/${t.n})${t.notes.length ? ' — ' + t.notes.join(' | ') : ''}`);
  return t;
}
const seededBytes = seed => { const r = makeRng(seed); return buf => { for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(r() * 256); return buf; }; };
const rint = (rng, n) => Math.floor(rng() * n);

// A deep copy of engine objects (Sets, Maps, arrays, plain objects; functions and the hotel's data shared), keeping
// shared references shared (a doorway in a room and in floor.doorways stays one object).
function deepClone(x, memo = new Map()) {
  if (x === null || typeof x !== 'object') return x;
  if (memo.has(x)) return memo.get(x);
  let out;
  if (Array.isArray(x)) { out = []; memo.set(x, out); for (const v of x) out.push(deepClone(v, memo)); return out; }
  if (x instanceof Set) { out = new Set(); memo.set(x, out); for (const v of x) out.add(deepClone(v, memo)); return out; }
  if (x instanceof Map) { out = new Map(); memo.set(x, out); for (const [k, v] of x) out.set(deepClone(k, memo), deepClone(v, memo)); return out; }
  out = {}; memo.set(x, out);
  for (const k of Object.keys(x)) out[k] = (k === 'data' || k === 'cfg') ? x[k] : deepClone(x[k], memo);
  return out;
}
// A canonical text of a value (Sets and Maps sorted, functions left out): for comparing floors and presenter states.
function canon(x, skip = new Set()) {
  const walk = v => {
    if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v instanceof Set) return { $set: [...v].map(walk).map(e => JSON.stringify(e)).sort() };
    if (v instanceof Map) return { $map: [...v].map(([k, e]) => JSON.stringify([walk(k), walk(e)])).sort() };
    const o = {};
    for (const k of Object.keys(v).sort()) { if (skip.has(k)) continue; const w = walk(v[k]); if (w !== undefined) o[k] = w; }
    return o;
  };
  return JSON.stringify(walk(x));
}
const FLOOR_SKIP = new Set(['data', 'cfg', 'rng', 'version', 'deck', 'problems']);
const floorSig = f => canon(f, FLOOR_SKIP) + `|deck:${f.deck.length}`;

// --- 1. purity ---------------------------------------------------------------------------------------------------
console.log('purity of the per-player view');
for (const f of ['playerView.js', 'viewAsState.js', 'floorCopy.js', 'aliases.js']) {
  const src = fs.readFileSync(new URL(`../src/net/${f}`, import.meta.url), 'utf8');
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const bad = [/\bdocument\b/, /\bwindow\b/, /from ['"]three/, /from ['"]node:/, /require\(/, /Math\.random/, /state\.rng/, /\bprocess\./,
    /Date\.now/, /\bsetTimeout\b/, /\bsetInterval\b/, /\blocalStorage\b/].filter(re => re.test(code));
  check(!bad.length, `${f}: no DOM, THREE, Node API, Math.random, clock, timer, storage or engine random generator${bad.length ? ' — found ' + bad.join(' ') : ''}`);
}

// --- 2. aliases ----------------------------------------------------------------------------------------------------
console.log('\ncard aliases');
{
  const al = createAliases(seededBytes(11));
  const made = [];
  for (let k = 0; k < 3000; k++) made.push(al.aliasFor(k % 6, `c${k + 1}`));
  check(made.every(a => typeof a === 'string' && a.length === ALIAS_LENGTH && /^[a-z2-9]+$/.test(a) && a[0] !== 'c'),
    `3,000 aliases: ${ALIAS_LENGTH} characters, letters and digits, never starting with 'c' (so never like an engine id)`);
  check(new Set(made).size === made.length, 'no alias issued twice');
  const firsts = new Map(); for (const a of made) firsts.set(a[0], (firsts.get(a[0]) || 0) + 1);
  check(firsts.size === 31, `every first character but 'c' turns up (${firsts.size} of 31)`);
  check(al.aliasFor(2, 'c3') === made[2] && al.idFor(2, made[2]) === 'c3' && al.idFor(3, made[2]) === null && al.idFor(2, 'zzzzzzzz') === null,
    'aliasFor is stable; idFor gives the engine id back to its own seat only, null for an unknown alias');
  const pass = al.aliasFor;
  check(pass(2, 'c3') === made[2], 'aliasFor works passed on bare (aliasOf: aliases.aliasFor)');
  // sync: a card that leaves a hand loses its alias; coming back, it gets a new one
  const st = { players: [{ index: 0, hand: [{ id: 'c1' }, { id: 'c2' }] }, { index: 1, hand: [{ id: 'c3' }] }] };
  const a2 = createAliases(seededBytes(12));
  a2.sync(st);
  const x1 = a2.aliasFor(0, 'c1'), x3 = a2.aliasFor(1, 'c3');
  st.players[0].hand = [{ id: 'c2' }, { id: 'c3' }]; st.players[1].hand = [{ id: 'c1' }];
  a2.sync(st);
  check(a2.idFor(0, x1) === null && a2.idFor(1, x3) === null, 'sync: a card that left a hand has no alias there any more');
  check(a2.aliasFor(1, 'c1') !== x1 && a2.aliasFor(0, 'c3') !== x3, '...and a card moving to another hand gets a new alias there');
  st.players[0].hand = [{ id: 'c1' }];
  a2.sync(st);
  check(a2.aliasFor(0, 'c1') !== x1, '...and one coming back to the same hand gets a new alias, never its old one');
  const saved = JSON.parse(JSON.stringify(a2));
  const a3 = createAliases(seededBytes(12));    // the same random source: without the saved list it would repeat aliases
  a3.restore(saved);
  check(a3.aliasFor(0, 'c1') === a2.aliasFor(0, 'c1') && a3.idFor(0, a2.aliasFor(0, 'c1')) === 'c1', 'toJSON/restore keeps every alias');
  const fresh = a3.aliasFor(5, 'c99');
  check(!saved.used.includes(fresh), '...and remembers every alias ever issued, so a restored table never issues one again');
  check(identityAliases.aliasFor(1, 'c7') === 'c7' && identityAliases.idFor(1, 'c7') === 'c7' && Object.isFrozen(identityAliases),
    'identityAliases (Single player): the alias is the engine id');
}

// --- 3. events and ordinals ------------------------------------------------------------------------------------------
console.log('\nevents and ordinals');
{
  const { state, floor, table } = newMatch(6, 4401, { floor: newFloor() });
  for (let t = 0; t < 22 && !state.finished; t++) playBotTurn(state, floor, table);
  const T = tally('stream');
  for (const p of state.players) {
    const { events, lastO } = seatEvents(state, p.index, 0);
    const mine = [...state.events, ...p.inbox].sort((a, b) => a.seq - b.seq);
    T.add(events.length === mine.length && lastO === mine.length && events.every((e, i) => e.o === i + 1), `seat ${p.index}: o not 1..N`);
    T.add(events.every((e, i) => { const { o, ...a } = e; const { seq, ...b } = mine[i]; return isDeepStrictEqual(a, b); }), `seat ${p.index}: content`);
    T.add(events.every(e => !('seq' in e)), 'a seq key');
    T.add(mine.every((e, i) => ordinalOf(state, p.index, e.seq) === i + 1), 'ordinalOf');
    const tail = seatEvents(state, p.index, 7);
    T.add(tail.lastO === lastO && tail.events.length === lastO - 7 && tail.events[0]?.o === 8, 'afterO');
  }
  T.report("each seat's stream is the public events plus its own inbox in engine order, o = 1..N with no gap, no seq; ordinalOf and afterO agree");
}

// --- the 24 matches ------------------------------------------------------------------------------------------------
const TOP = ['v', 'table', 'seat', 'seats', 'round', 'roundLimit', 'turn', 'activeSeat', 'finalRound', 'finished', 'won', 'dawn', 'phase', 'clock',
  'stall', 'hotel', 'discovered', 'searched', 'spent', 'locked', 'openLocks', 'barricades', 'drops', 'deckEmpty', 'met', 'players', 'me', 'log', 'ask',
  'results', 'end'];
const PLAYER_KEYS = ['seat', 'id', 'name', 'color', 'mark', 'avatar', 'room', 'health', 'alive', 'escaped', 'away'];
const ME_KEYS = ['seat', 'id', 'room', 'ap', 'health', 'alive', 'possessed', 'convertedBy', 'roleChangePending', 'roleSeen', 'knows', 'notes', 'hand', 'inbox'];
const PRIVATE = new Set(['hand', 'inbox', 'notes', 'knows', 'possessed', 'convertedBy', 'roleChangePending', 'roleSeen']);
const FORBIDDEN = new Set(['seq', 'seed', 'rng', 'deck', 'drawPile', 'discardPile', 'style', 'eventSeq', 'cardSeq', 'cursor']);
const sameKeys = (o, keys) => o && JSON.stringify(Object.keys(o).sort()) === JSON.stringify([...keys].sort());

function whitelist(v) {
  const bad = [];
  if (!sameKeys(v, TOP)) bad.push('top: ' + Object.keys(v).join());
  if (!sameKeys(v.table, ['kind', 'code', 'rules', 'clockOn', 'relaxed'])) bad.push('table');
  if (!sameKeys(v.hotel, ['lobbyDoors', 'placed', 'jammed', 'roomTilesLeft'])) bad.push('hotel');
  if (!sameKeys(v.me, ME_KEYS)) bad.push('me: ' + Object.keys(v.me).join());
  for (const p of v.players) {
    const ks = Object.keys(p);
    if (!PLAYER_KEYS.every(k => ks.includes(k)) || ks.some(k => !PLAYER_KEYS.includes(k) && k !== 'bot')) bad.push('player: ' + ks.join());
  }
  for (const c of v.me.hand) if (Object.keys(c).some(k => !['id', 'type', 'shots', 'owner'].includes(k))) bad.push('card');
  for (const l of v.log) if (!sameKeys(l, ['round', 'turn', 'text'])) bad.push('log');
  if (v.end && Object.keys(v.end).some(k => !['won', 'dawn', 'reveal', 'history', 'standInTurns', 'stopped'].includes(k))) bad.push('end');
  // private keys only under me, the results and the end; forbidden keys nowhere
  const walk = (x, path, inPrivate) => {
    if (x === null || typeof x !== 'object') return;
    for (const k of Object.keys(x)) {
      if (FORBIDDEN.has(k)) bad.push(`${path}.${k}`);
      if (PRIVATE.has(k) && !inPrivate && !Array.isArray(x)) bad.push(`${path}.${k}`);
      walk(x[k], `${path}.${k}`, inPrivate);
    }
  };
  for (const k of Object.keys(v)) walk(v[k], k, k === 'me' || k === 'results' || k === 'end');
  // ...and inside the end, the roles only in end.reveal and the private events only in end.history
  return bad;
}
function stringsOf(x, out = []) {
  if (typeof x === 'string') out.push(x);
  else if (Array.isArray(x)) for (const v of x) stringsOf(v, out);
  else if (x && typeof x === 'object') for (const k of Object.keys(x)) { out.push(k); stringsOf(x[k], out); }
  return out;
}
function engineIds(state) {
  const ids = new Set();
  const add = cards => { for (const c of cards || []) if (c?.id != null) ids.add(c.id); };
  for (const p of state.players) add(p.hand);
  add(state.drawPile); add(state.discardPile);
  for (const cards of state.roomDrops.values()) add(cards);
  return ids;
}

// The questions and results a referee would hand this seat: built from the seat's own hand and its own past actions
// only (as the referee's are), with real engine ids in them, so playerView has to map them.
function extrasFor(state, seat, stash) {
  const p = state.players[seat];
  const n = state.players.length;
  let other = null;
  for (let k = 1; k < n; k++) { const q = state.players[(seat + k) % n]; if (q.alive) { other = q.index; break; } }
  let ask = null;
  if (p.alive && !state.finished && other != null) {
    // (a fixture: each kind of question in turn, every one built from the seat's own hand)
    const countable = p.hand.filter(c => c.type !== 'possession').map(c => c.id);
    const weapons = p.hand.filter(c => CARDS[c.type]?.weapon).map(c => c.id);
    const kind = (seat + state.turn) % 4;
    if (kind === 0) ask = { id: `q${state.turn}d`, kind: 'discard', over: Math.max(0, countable.length - rules.handLimit), cards: countable, leftMs: 10000 };
    else if (kind === 1) ask = { id: `q${state.turn}m`, kind: 'meetAct', with: other, canAttack: weapons.length > 0 && p.actionPoints >= rules.actionCost.attack, weapons, leftMs: null };
    else if (kind === 2) ask = { id: `q${state.turn}t`, kind: 'tradeCard', with: other, cards: A.tradeableCards(p).map(c => c.id), voluntary: false, leftMs: null };
  }
  const results = [...(stash[seat] || [])];
  if (p.notes.length) results.push({ id: `n${state.turn}`, kind: 'notes', lines: [...p.notes] });
  return {
    table: { kind: 'friends', code: 'BKTWM', rules: 'today', clockOn: true, relaxed: false },
    phase: state.finished ? { kind: 'ended', seats: [] } : { kind: 'turn', seats: [state.activeIndex] },
    clock: state.finished ? null : { seat: state.activeIndex, kind: 'turn', leftMs: 45000 - (state.turn % 9) * 1000, running: true },
    stall: null, ask, results, end: null,
    presence: { [other ?? 0]: { away: state.turn % 5 === 0 } },
  };
}
// What a bot's action gave it privately, kept as the referee keeps results until they are acknowledged (the last 2).
function stashResult(stash, state, seat, a, r) {
  let res = null;
  if (a?.k === 'search' && r?.ok && (r.cards || r.card)) {
    const cards = r.cards || [r.card];
    res = { id: `f${state.turn}.${seat}`, kind: 'found', where: r.room, cards: cards.map(c => ({ id: c.id, type: c.type, ...(c.shots != null ? { shots: c.shots } : {}) })) };
  } else if (a?.k === 'card' && a.type === 'handMirror' && r?.ok) {
    const target = state.players.find(q => q.id === r.target)?.index ?? null;
    res = { id: `m${state.turn}.${seat}`, kind: 'mirror', target, hand: r.hand.map(c => ({ ...c })) };   // (engine copies, ids and all)
  }
  if (res) (stash[seat] ||= []).push(res);
  if (stash[seat]?.length > 2) stash[seat].shift();
}

// Everything `keep` can't know, replaced at random (in a deep copy of the state and the floor).
const TYPES = Object.keys(rules.deck);
function scramble(st, fl, keep, rng) {
  const me = st.players[keep];
  const card = () => makeCard(TYPES[rint(rng, TYPES.length)]);
  for (const p of st.players) {
    if (p.index === keep) continue;
    p.hand = Array.from({ length: 1 + rint(rng, 7) }, card);
    if (rng() < 0.5) p.hand.push(makeCard('possession', { owner: st.players[rint(rng, st.players.length)].id }));
    p.possessed = rng() < 0.5;
    p.knows = new Set(rng() < 0.5 ? [me.id] : []);
    p.notes = ['scrambled', `note ${rint(rng, 99)}`];
    p.inbox = [{ seq: 1, round: 1, turn: 1, type: 'possessed', by: keep, souls: 2 }, { seq: 2, round: 1, turn: 1, type: 'soulSpent', by: keep }];
    p.convertedBy = rng() < 0.5 ? me.id : undefined;
    p.roleChangePending = rng() < 0.5;
    p.roleSeen = rng() < 0.5;
    p.actionPoints = rint(rng, 7);
  }
  if (st.drawPile.length || st.discardPile.length) {
    st.drawPile = Array.from({ length: rint(rng, 30) }, card);
    st.discardPile = Array.from({ length: rint(rng, 10) }, card);
    if (!st.drawPile.length && !st.discardPile.length) st.drawPile.push(card());
  }
  for (const [room, cards] of st.roomDrops) if (cards.length) st.roomDrops.set(room, Array.from({ length: 1 + rint(rng, 5) }, card));
  for (let i = fl.deck.length - 1; i > 0; i--) { const j = rint(rng, i + 1); [fl.deck[i], fl.deck[j]] = [fl.deck[j], fl.deck[i]]; }
  // the engine's event numbers, as if others had had more or fewer private events: same order, other numbers
  const mine = [...st.events, ...me.inbox].sort((a, b) => a.seq - b.seq);
  let seq = rint(rng, 5);
  for (const e of mine) { seq += 1 + rint(rng, 4); e.seq = seq; }
  st.eventSeq = seq + rint(rng, 9);
  for (const p of st.players) if (p.index !== keep) p.inbox.forEach((e, i) => { e.seq = 1 + rint(rng, seq) + i; });
  st.rng = makeRng(1 + rint(rng, 1e9)); st.seed = rint(rng, 1e9); fl.rng = makeRng(1 + rint(rng, 1e9));
}

// The engine's answer to every command the seat could send right now: 'ok' or the refusal's reason. Each one is
// tried on its own copy of the state (and of the floor for a door of its room), with a fixed random source.
function reasons(st, fl, seat) {
  const out = {};
  const p = st.players[seat];
  const fixed = () => 0.42;
  const tryIt = (key, fn, withFloor = false) => {
    const s2 = deepClone(st); s2.rng = fixed;
    let f2 = fl;
    if (withFloor) { f2 = deepClone(fl); f2.rng = fixed; }
    const r = fn(s2, f2, s2.players[seat]);
    out[key] = r?.ok ? 'ok' : (r?.reason ?? String(r));
  };
  for (const r of fl.roomList) { const w = planWalk(st, fl, p, r.id); out[`move:${r.id}`] = w.ok ? `ok:${w.rooms.join('>')}` : w.reason; }
  for (const d of fl.frontier) {
    if (d.room === p.currentRoom) tryIt(`open:${d.id}`, (s, f, q) => A.openDoor(s, f, q, d.id), true);
    else out[`open:${d.id}`] = A.openDoor(st, fl, p, d.id).reason;   // (refused before anything changes)
  }
  tryIt('search', (s, f, q) => A.search(s, f, q));
  tryIt('job', (s, f, q) => { const g = A.canUseRoom(s, f, q); return !g.ok ? g : g.job === 'infirmary' ? A.useInfirmary(s, f, q) : A.useSwitchboard(s, f, q); });
  tryIt('escape', (s, f, q) => A.escape(s, f, q));
  if (st.activeIndex === seat) out.end = JSON.stringify(S.canEndTurn(st));
  for (const c of p.hand) {
    const k = `card:${c.id}`;
    if (c.type === 'bandage') tryIt(k, (s, f, q) => A.useBandage(s, q, c.id));
    else if (c.type === 'espresso') tryIt(k, (s, f, q) => A.useEspresso(s, q, c.id));
    else if (c.type === 'handMirror') for (const t of st.players) tryIt(`${k}>${t.id}`, (s, f, q) => A.useHandMirror(s, f, q, c.id, t.id));
    else if (c.type === 'barricade') for (const d of fl.rooms.get(p.currentRoom)?.doorways || []) tryIt(`${k}>${d.id}`, (s, f, q) => A.useBarricade(s, f, q, c.id, d.id));
    else if (CARDS[c.type]?.unlock) for (const r of fl.rooms.get(p.currentRoom)?.neighbours || []) tryIt(`${k}>${r}`, (s, f, q) => A.useUnlock(s, f, q, c.id, r));
  }
  for (const q of st.players) out[`trade:${q.index}`] = S.canTradeVoluntarily(st, fl, p) && q.alive && q !== p && q.currentRoom === p.currentRoom;
  return JSON.stringify(out);
}

// The button checks the screens ask (DESIGN §6.8 test 8), as text. `mapId`: the seat's alias for an engine id.
function buttons(st, fl, p, mapId = id => id) {
  const rooms = fl.roomList.map(r => {
    const route = roomRoute(st, fl, p, r.id);
    return {
      id: r.id, route, afford: Array.isArray(route) ? S.canAffordRoute(st, fl, p, route) : null, walk: planWalk(st, fl, p, r.id),
      players: S.playersInRoom(st, r.id, p.id).map(q => q.id), meet: S.encountersIn(st, fl, p, r.id).map(q => q.id), left: A.searchLeft(st, r),
    };
  });
  return JSON.stringify({
    canSearch: A.canSearch(st, fl, p), canEscape: S.canEscape(st, fl, p), canUseRoom: A.canUseRoom(st, fl, p),
    openableDoors: S.openableDoors(st, fl, p).map(d => d.id), usableDoorways: S.usableDoorways(st, fl, p).map(d => d.id),
    adjacentLockedRooms: S.adjacentLockedRooms(st, fl, p), canTradeVoluntarily: S.canTradeVoluntarily(st, fl, p),
    pendingEncounters: S.pendingEncounters(st, fl, p).map(q => q.id), overHandLimit: A.overHandLimit(p),
    tradeableCards: A.tradeableCards(p).map(c => mapId(c.id)), canEndTurn: st.activeIndex === p.index ? S.canEndTurn(st) : null,
    known: [...knownPossessed(st, p)].sort(), rooms,
  });
}

// The presenter's state as text (Sets, Maps sorted), for "built update by update" = "built at once".
const presenterSig = st => canon(st);

console.log('\n24 seeded matches, every seat a person');
const T = {
  scramble: tally('scramble'), stream: tally('stream'), reasons: tally('reasons'), whitelist: tally('whitelist'), ids: tally('ids'),
  round: tally('round'), fields: tally('fields'), mirror: tally('mirror'), buttons: tally('buttons'), buttonsId: tally('buttonsId'),
  known: tally('known'), once: tally('once'), identity: tally('identity'), newMatch: tally('newMatch'), feed: tally('feed'),
  sounds: tally('sounds'), complete: tally('complete'), floor: tally('floor'), floorFresh: tally('floorFresh'), end: tally('end'),
  record: tally('record'), log: tally('log'),
};
const sizes = [], sizesBare = [];
const presenters = Array.from({ length: 6 }, () => blankState());
const floorCopy = createFloorCopy(hotel, config);           // one object across every match, as on the page
let stops = 0, livingChecked = 0, refusals = 0, results = { found: 0, mirror: 0, notes: 0 }, asks = new Set();

function playChecked(k, { seats, seed, engine = null, scrambleAt = [] }) {
  const floor = newFloor();
  const m = engine ? newMatch(seats, null, { floor, engine: engine(), botSeed: seed }) : newMatch(seats, seed, { floor });
  const { state, table } = m;
  const looks = botAvatars(state.players.map(p => p.name));
  state.players.forEach((p, i) => { p.avatar = looks[i]; });    // seated with looks, as the page seats them
  const aliases = createAliases(seededBytes(seed * 7 + 1));
  const stash = {};
  const rng = makeRng(seed * 13 + 5);
  const received = state.players.map(() => []);
  const lastO = state.players.map(() => 0);
  const first = state.players.map(() => true);
  const feedSeen = state.players.map(() => new WeakSet()), feedLines = state.players.map(() => []);
  const realSeen = new WeakSet(), realLines = [];
  const sound = state.players.map(() => ({ list: null, idx: 0, resets: 0 }));
  let lastView = null;

  function update() {
    aliases.sync(state);
    for (const l of state.log) if (!realSeen.has(l)) { realSeen.add(l); realLines.push(l.text); }
    for (const p of state.players) {
      const s = p.index;
      const view = playerView(state, floor, s, extrasFor(state, s, stash), { aliasOf: aliases.aliasFor });
      if (!view.end) { sizes.push(JSON.stringify(view).length); sizesBare.push(JSON.stringify({ ...view, players: view.players.map(q => ({ ...q, avatar: null })) }).length); }
      const ev = seatEvents(state, s, lastO[s]);
      received[s].push(...ev.events); lastO[s] = ev.lastO;
      const pres = presenters[s];
      const beforePlayers = pres.players.slice(), beforeEvents = pres.events;
      const out = applyView(pres, view, received[s]);
      if (first[s]) {
        T.newMatch.add(out === pres && pres.players.every(x => !beforePlayers.includes(x)) && pres.events !== beforeEvents, `match ${k} seat ${s}`);
        first[s] = false;
      } else {
        T.identity.add(out === pres && pres.players.length === beforePlayers.length && pres.players.every((x, i) => x === beforePlayers[i]) && pres.events === beforeEvents,
          `match ${k} seat ${s} turn ${state.turn}`);
      }
      // the feed's logic (src/ui/feed.js sync) on the presenter
      for (const l of pres.log) if (!feedSeen[s].has(l)) { feedSeen[s].add(l); feedLines[s].push(l.text); }
      // gameSounds' reset check (src/audio/gameSounds.js update)
      const snd = sound[s];
      if (pres.events !== snd.list || (snd.list && snd.list.length < snd.idx)) { snd.resets++; snd.list = pres.events; }
      snd.idx = pres.events.length;
      lastView = view;
    }
    syncFloor(floorCopy, lastView.hotel);
  }

  function compareFloor(where) {
    T.floor.add(floorSig(floorCopy) === floorSig(floor), `match ${k} ${where}`);
    const fresh = createFloorCopy(hotel, config);
    syncFloor(fresh, lastView.hotel);
    T.floorFresh.add(floorSig(fresh) === floorSig(floor) && fresh.deck.every(t => t === HIDDEN_TILE), `match ${k} ${where}`);
  }

  function honesty() {
    stops++;
    aliases.sync(state);
    const ids = engineIds(state);
    for (const p of state.players) {
      if (!p.alive) continue;
      livingChecked++;
      const s = p.index;
      const ex = extrasFor(state, s, stash);
      const view = playerView(state, floor, s, ex, { aliasOf: aliases.aliasFor });
      const before = JSON.stringify(view);
      const evBefore = JSON.stringify(seatEvents(state, s, 0));
      const rBefore = reasons(state, floor, s);
      const [s2, f2] = deepClone([state, floor]);
      scramble(s2, f2, s, rng);
      const after = JSON.stringify(playerView(s2, f2, s, extrasFor(s2, s, stash), { aliasOf: aliases.aliasFor }));
      T.scramble.add(before === after, `match ${k} seat ${s} turn ${state.turn}: ${diffAt(before, after)}`);
      T.stream.add(evBefore === JSON.stringify(seatEvents(s2, s, 0)), `match ${k} seat ${s}`);
      const rAfter = reasons(s2, f2, s);
      T.reasons.add(rBefore === rAfter, `match ${k} seat ${s}: ${diffAt(rBefore, rAfter)}`);
      refusals += Object.values(JSON.parse(rBefore)).filter(x => typeof x === 'string' && !x.startsWith('ok')).length;
      if (view.ask) asks.add(view.ask.kind);
      for (const r of view.results) results[r.kind] = (results[r.kind] || 0) + 1;
      // whitelist, no engine id, round trip
      const bad = whitelist(view);
      T.whitelist.add(!bad.length, bad.join(', '));
      const leaked = stringsOf(view).filter(x => ids.has(x));
      T.ids.add(!leaked.length, `match ${k} seat ${s}: ${leaked.slice(0, 3).join()}`);
      T.round.add(isDeepStrictEqual(JSON.parse(JSON.stringify(view)), view), `match ${k} seat ${s}`);
      // card fields where the screens draw them
      T.fields.add(view.me.hand.length === p.hand.length && p.hand.every((c, i) => {
        const v = view.me.hand[i];
        return v.type === c.type && v.id === aliases.aliasFor(s, c.id)
          && (c.type === 'possession' ? v.owner === c.owner && c.owner === p.id : !('owner' in v))
          && (c.shots != null ? v.shots === c.shots : !('shots' in v));
      }), `match ${k} seat ${s}`);
      for (const r of view.results.filter(x => x.kind === 'mirror')) {
        const src = ex.results.find(x => x.id === r.id);
        T.mirror.add(r.hand.length === src.hand.length && r.hand.every((c, i) => !('id' in c) && c.type === src.hand[i].type
          && (c.type === 'possession' ? c.owner === src.hand[i].owner && c.owner != null : true)
          && (src.hand[i].shots != null ? c.shots === src.hand[i].shots : true)), `match ${k} seat ${s}`);
      }
      // the button checks on viewAsState + the floor copy (real aliases, then identity aliases)
      const received0 = seatEvents(state, s, 0).events;
      const vs = viewAsState(view, received0);
      const fc = createFloorCopy(hotel, config);
      syncFloor(fc, view.hotel);
      T.buttons.add(buttons(state, floor, p, id => aliases.aliasFor(s, id)) === buttons(vs, fc, vs.players[s]), `match ${k} seat ${s}: ${diffAt(buttons(state, floor, p, id => aliases.aliasFor(s, id)), buttons(vs, fc, vs.players[s]))}`);
      const vsId = viewAsState(playerView(state, floor, s, ex), received0);
      T.buttonsId.add(buttons(state, floor, p) === buttons(vsId, fc, vsId.players[s]), `match ${k} seat ${s}`);
      T.known.add(JSON.stringify([...knownPossessed(state, p)].sort()) === JSON.stringify([...knownPossessed(vs, vs.players[s])].sort()), `match ${k} seat ${s}`);
      // the long-lived presenter (update by update) equals one built at once from the same view and events
      const at = applyView(blankState(), playerView(state, floor, s, extrasFor(state, s, stash), { aliasOf: aliases.aliasFor }), received[s]);
      T.once.add(presenterSig(presenters[s]) === presenterSig(at), `match ${k} seat ${s}: ${diffAt(presenterSig(presenters[s]), presenterSig(at))}`);
    }
  }

  update();
  let turns = 0;
  while (!state.finished && turns < 500) {
    if (scrambleAt.includes(turns)) honesty();
    // the person (or bot) reads "While the others played" at the start of their turn (ui/handoff.js, main.js:703)
    S.activePlayer(state).notes.length = 0;
    const seat = state.activeIndex;
    playBotTurn(state, floor, table, { onStep: (a, r) => { stashResult(stash, state, seat, a, r); update(); } });
    update();
    turns++;
    if (turns % 3 === 0) compareFloor(`turn ${turns}`);
  }
  compareFloor('end');
  // the end: roles revealed, the whole history, Your record
  for (const p of state.players) {
    const s = p.index;
    const view = playerView(state, floor, s, extrasFor(state, s, stash), { aliasOf: aliases.aliasFor });
    const pub = state.events.map(({ seq, ...e }) => e), own = p.inbox.map(({ seq, ...e }) => e);
    const strip = list => list.map(({ o, ...e }) => e);
    T.end.add(!!view.end && view.end.won === state.won && view.end.dawn === !!state.dawn
      && view.end.reveal.every(r => r.possessed === !!state.players[r.seat].possessed && r.alive === !!state.players[r.seat].alive)
      && isDeepStrictEqual(strip(view.end.history.events), pub) && isDeepStrictEqual(strip(view.end.history.inbox), own), `match ${k} seat ${s}`);
    const pres = presenters[s];
    T.complete.add(isDeepStrictEqual(pres.events.map(({ seq, ...e }) => e), pub) && isDeepStrictEqual(pres.players[s].inbox.map(({ seq, ...e }) => e), own)
      && pres.events.every((e, i, l) => i === 0 || e.seq > l[i - 1].seq), `match ${k} seat ${s}`);
    T.end.add(pres.players.every((q, i) => q.possessed === !!state.players[i].possessed), `match ${k} seat ${s}: roles on the presenter`);
    T.record.add(isDeepStrictEqual(matchSummary(pres, s), matchSummary(state, s)), `match ${k} seat ${s}`);
    T.feed.add(JSON.stringify(feedLines[s]) === JSON.stringify(realLines), `match ${k} seat ${s}: ${feedLines[s].length} vs ${realLines.length}`);
    T.sounds.add(sound[s].resets === 1, `match ${k} seat ${s}: ${sound[s].resets} resets`);
    T.log.add(view.log.length <= LOG_LINES, 'log');
  }
  return { turns, won: state.won };
}
function diffAt(a, b) {
  if (a === b) return '';
  let i = 0; while (i < a.length && a[i] === b[i]) i++;
  return `at ${i}: …${a.slice(Math.max(0, i - 60), i + 60)}… vs …${b.slice(Math.max(0, i - 60), i + 60)}…`;
}

{
  const pick = makeRng(2026);
  let turnsAll = 0;
  for (let k = 0; k < 24; k++) {
    const seats = 4 + (k % 3);
    const scrambleAt = [0, 2, 4].map(r => seats * r + rint(pick, seats * 2));   // one in rounds 1-2, 3-4 and 5-6
    const r = playChecked(k, { seats, seed: 9100 + k, scrambleAt });
    turnsAll += r.turns;
  }
  console.log(`  (${stops} stop points, ${livingChecked} living seats checked, ${turnsAll} turns, ${refusals} refused commands compared;`
    + ` asks ${[...asks].join('/')}; results found ${results.found}, mirror ${results.mirror}, notes ${results.notes})`);
  T.scramble.report('SCRAMBLE: the view (question and results included) is byte-identical when everything the seat cannot know is scrambled');
  T.stream.report('...and so is its event stream (others\' private events and the engine\'s numbers never move an ordinal)');
  T.reasons.report('...and so is the engine\'s answer to every command it could send (moves, doors, search, room, escape, end, each card on each target, trades)');
  T.whitelist.report('key whitelist: exactly DESIGN §6.1; hand, inbox, notes, knows, roles only under me / results / end; no seq, seed, rng, deck, piles, style');
  T.ids.report('no engine card id present in the real state appears anywhere in the view (real aliases, set membership)');
  T.round.report('JSON round trip: JSON.parse(JSON.stringify(view)) deep-equals the view');
  T.fields.report('card fields: my hand in order, each under its alias, a soul with its owner (my own id), a Revolver with its shots');
  T.mirror.report('...and a Hand Mirror result shows types, a soul\'s owner and a Revolver\'s shots, never a card id');
  T.buttons.report('button checks on viewAsState + floor copy = on the real state (real aliases): canSearch, canEscape, canUseRoom, doors, locks, trades, meetings, routes, affordability, searchLeft, hand limit, tradeable cards');
  T.buttonsId.report('...and with identity aliases (Single player)');
  T.known.report('what the seat knows for certain (knownPossessed) is the same on the presenter');
  T.once.report('the long-lived presenter, written update by update, equals one written at once (applyView on a blank state)');
  T.identity.report('IDENTITY: within a match the presenter keeps every guest record and its event list (after every bot action, every seat)');
  T.newMatch.report('...and a new match (with the same guest ids) gets new guest records and a new event list');
  T.feed.report("the feed's logic on the presenter reports exactly today's lines, each once");
  T.sounds.report("gameSounds' reset (state.events !== list) fires once per match, at its start, never within it");
  T.complete.report('every public event and every own event reaches the presenter once, in order (seq := o)');
  T.floor.report(`the floor copy (one object across all matches) equals the real floor every 3rd turn and at the end`);
  T.floorFresh.report('...and so does a floor copy built at once from the view; its deck is only placeholders');
  T.end.report('the end: won, dawn, every role revealed, the whole history (public events and own inbox)');
  T.record.report('Your record (matchSummary) on the presenter = on the real state');
  T.log.report('the log in a view is at most 30 lines');
  check(stops >= 48 && livingChecked >= 200, `enough stop points (${stops}) and living seats (${livingChecked})`);
  check(results.found > 20 && results.mirror > 3 && asks.size >= 3, 'the questions and results that carry card ids were exercised');
}

// --- view size -------------------------------------------------------------------------------------------------------
{
  const stat = list => ({ mean: list.reduce((a, b) => a + b, 0) / list.length, max: Math.max(...list) });
  const w = stat(sizes), b = stat(sizesBare);
  console.log(`\nview size over ${sizes.length} views mid-match: with the guests' looks mean ${(w.mean / 1024).toFixed(2)} KB, max ${(w.max / 1024).toFixed(2)} KB;`
    + ` without looks mean ${(b.mean / 1024).toFixed(2)} KB, max ${(b.max / 1024).toFixed(2)} KB`);
  check(b.mean < 5 * 1024, `a full view averages under 5 KB without the looks (${(b.mean / 1024).toFixed(2)} KB; the research measured views without looks)`);
  check(w.mean < 8 * 1024 && w.max < 16 * 1024, `...and stays small with them (mean ${(w.mean / 1024).toFixed(2)} KB, max ${(w.max / 1024).toFixed(2)} KB)`);
}

// --- 5. Co-op deals ------------------------------------------------------------------------------------------------
console.log('\n12 matches dealt as a Co-op table deals them (crypto-style sources, per-table card ids)');
{
  const before = { ids: T.ids.n, floor: T.floor.n };
  for (let k = 0; k < 12; k++) {
    const seats = 4 + (k % 3), seed = 9300 + k;
    const engine = () => ({ rng: cryptoRng(seededBytes(seed)), hotelRng: cryptoRng(seededBytes(seed + 1)), perTableIds: true });
    const pick = makeRng(seed);
    playChecked(100 + k, { seats, seed, engine, scrambleAt: [rint(pick, seats * 6)] });
  }
  T.ids.report('no engine id (c1, c2 ... of the table\'s own counter) in any view');
  T.scramble.report('scramble still byte-identical');
  T.floor.report('floor copy still equal');
  check(T.ids.n > before.ids && T.floor.n > before.floor, '(these matches were checked)');
  check(T.floor.n >= 300, `at least 300 floor comparisons in all (${T.floor.n}: every 3rd turn and at the end of 36 matches)`);
}

// --- 6. applyView cases ----------------------------------------------------------------------------------------------
console.log('\napplyView cases');
{
  const { state, floor, table } = newMatch(5, 4777, { floor: newFloor() });
  for (let t = 0; t < 12 && !state.finished; t++) playBotTurn(state, floor, table);
  const v0 = playerView(state, floor, 0), v1 = playerView(state, floor, 1);
  const ev0 = seatEvents(state, 0).events, ev1 = seatEvents(state, 1).events;
  const pres = applyView(blankState(), v0, ev0);
  const recs = pres.players.slice(), evs = pres.events;
  // a seat switch (the review link's "Show sam's screen"): the same match, another seat, drawn fresh
  applyView(pres, v1, ev1, { fresh: true });
  check(pres.players.every((x, i) => x === recs[i]) && pres.events !== evs && pres.viewerIndex === 1,
    'a seat switch (fresh): the same guest records, a new event list, the other seat');
  check(pres.players[0].hand.length === 0 && pres.players[0].inbox.length === 0 && pres.players[0].knows.size === 0 && !pres.players[0].possessed
    && pres.players[1].hand.length === state.players[1].hand.length, '...and the first seat\'s private screen is gone from it');
  check(presenterSig(pres) === presenterSig(viewAsState(v1, ev1)), '...and it equals seat 1\'s view written at once');
  // a reconnect (fresh, same seat): a new event list; the records stay
  const recs1 = pres.players.slice(), evs1 = pres.events;
  applyView(pres, v1, ev1, { fresh: true });
  check(pres.players.every((x, i) => x === recs1[i]) && pres.events !== evs1 && pres.events.length === evs1.length, 'a reconnect (fresh): the same records, a new event list');
  // a new match with the same guests (the same ids p1..p5)
  const m2 = newMatch(5, 4778, { floor: newFloor() });
  const v2 = playerView(m2.state, m2.floor, 1);
  const recs2 = pres.players.slice();
  applyView(pres, v2, seatEvents(m2.state, 1).events);
  check(pres.players.every(x => !recs2.includes(x)) && pres.events !== evs1 && pres.turn === 1, 'a new match with the same guest ids is noticed: new guest records, a new event list');
  // newMatch: false keeps the records even then
  const recs3 = pres.players.slice();
  applyView(pres, v2, [], { newMatch: false });
  check(pres.players.every((x, i) => x === recs3[i]), 'newMatch: false keeps them');
  // the referee's stall end: no result, roles revealed
  const vs = playerView(state, floor, 2, { end: { won: null, stopped: 'stall' } });
  check(vs.end?.stopped === 'stall' && vs.end.won === null && vs.end.reveal.length === 5 && !vs.finished, "the referee's stall end: { won: null, stopped: 'stall' }, every role revealed");
  // bot labels stay off (ONLINE.botLabels false, owner decision D3)
  const vb = playerView(state, floor, 0, { presence: { 1: { away: true, bot: true } } });
  check(vb.players[1].away === true && !('bot' in vb.players[1]), 'presence: Away shows; a Bot label never does while ONLINE.botLabels is false');
  // the hidden piles: one placeholder card while a search could draw
  const vsState = viewAsState(v0, ev0);
  check(vsState.drawPile.length === 1 && vsState.drawPile[0] === HIDDEN_CARD && vsState.discardPile.length === 0
    && [...vsState.roomDrops.values()].every(c => c.length === 1 && c[0] === HIDDEN_CARD), 'the draw pile and floors hold one placeholder card each (never what or how many)');
  // practice: one guest, no hidden role
  const pf = createHotel(hotel, config);
  const ps = S.createState(pf, roster.slice(0, 1), 31, { mode: 'practice' });
  const pv = playerView(ps, pf, 0);
  const pst = viewAsState(pv, seatEvents(ps, 0).events);
  check(pv.table.kind === 'practice' && pst.practice === true && pst.mode === 'practice' && pv.players.length === 1 && !pv.me.possessed,
    'practice: one guest, table kind practice, the presenter in practice mode');
  // ask and results: card ids through the alias, the rest as given
  const al = createAliases(seededBytes(5));
  const p0 = state.players[0];
  const ids0 = p0.hand.map(c => c.id);
  const va = playerView(state, floor, 0, {
    ask: { id: 'q1', kind: 'tradeCard', with: 1, cards: ids0, voluntary: true, leftMs: 20000 },
    results: [{ id: 'r1', kind: 'found', where: 'x', cards: p0.hand.map(c => ({ id: c.id, type: c.type })) }, { id: 'r2', kind: 'autoDiscarded', cards: ['lantern', 'knife'] },
      { id: 'r3', kind: 'trade', with: 1, gave: { id: ids0[0], type: 'knife' }, got: { id: 'c999999', type: 'lantern' } }],
  }, { aliasOf: al.aliasFor });
  check(JSON.stringify(va.ask.cards) === JSON.stringify(ids0.map(id => al.aliasFor(0, id))) && va.results[0].cards.every((c, i) => c.id === al.aliasFor(0, ids0[i]))
    && JSON.stringify(va.results[1].cards) === '["lantern","knife"]' && !('id' in va.results[2].gave) && !('id' in va.results[2].got),
  'ask cards and found cards go through the alias; types stay types; a trade result\'s cards carry no id');
  const gone = 'c' + 'gone';
  const vg = playerView(state, floor, 0, { ask: { id: 'q2', kind: 'discard', over: 1, cards: [ids0[0], gone] }, results: [{ id: 'r4', kind: 'found', where: 'x', cards: [{ id: gone, type: 'knife' }] }] }, { aliasOf: al.aliasFor });
  check(vg.ask.cards[0] === al.aliasFor(0, ids0[0]) && vg.ask.cards[1] === null && vg.results[0].cards[0].id === null && vg.results[0].cards[0].type === 'knife',
    'a card that has left my hand shows in a question or a kept result with id null (no fresh alias each view, no trail)');
}

console.log(`\n${failures ? `${failures} FAILED` : 'ALL VIEW CHECKS PASSED'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failures ? 1 : 0);
