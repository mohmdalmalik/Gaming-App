// FAIRNESS AT A CO-OP TABLE: what the server tells each device never gives away what happened in private elsewhere
// (DESIGN §6.8 tests 6, 7, 7b, 7c and 9). It runs the server's brain (src/net/rooms.js) in this process with an
// injected clock, seeded random numbers (so two runs can differ in exactly one private thing) and fake sockets
// that keep every message each device receives, with the moment it arrived and its size. No network, no browser.
//   node tests/fairness-check.mjs
//
//   0. purity: rooms.js and store.js use no DOM, Node API, Math.random, clock, timer or the engine's generator
//   1. phase privacy (test 6): a meeting replayed with the walker's weapon swapped for an ordinary card. A bot walker
//      (scripted to trade both times): the other people's messages, bytes and arrival times are identical (an armed
//      bot takes no extra beat). A person walker is asked Trade or Attack both times (canAttack true / false), and
//      the others' messages are identical again.
//   2. equal traffic (test 7): a person's trade with a bot as a plain trade, a possession, a Lantern block, a spent
//      soul and crossed souls. The person's acknowledgements are scripted so the last one lands at the same moment
//      (a possession has one more screen, the role, inside the same time). Everyone else's messages: identical in
//      count, bytes and arrival times, so the server adds no pause of its own.
//   3. discard privacy (test 7b): a person ends the turn under the hand limit at t, or over it earlier and drops the
//      last card at t, with >= 10 s on the clock. The others' messages are byte- and time-identical.
//   4. looks (test 7c): a person's unlockable item survives the server's check, as a bot's does.
//   5. the alias trail (test 9) and a light wire scan over whole matches of scripted people (they play from their
//      own views only): an alias that left a hand never comes back to that seat; no engine card id, no `seq`, no
//      other seat's role or hand reaches anyone; replies carry { rooms } for a move and nothing else.
//   6. two tables of different sizes interleaved in one process: both finish, each numbers its own cards, nobody
//      hears about the other table.
//   7. playerView through the server: the table, Away (gone at once, hidden after 5 s, back), no Bot label, the
//      table's own events, a reconnect drawing the same presenter, a stale or foreign card refused, replies kept.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { hotel } from '../src/data/hotel.js';
import { config } from '../src/config.js';
import { rules } from '../src/data/rules.js';
import { ONLINE, ONLINE_RULES } from '../src/data/online.js';
import { makeCard, makeRng, nextCardId, weaponsIn } from '../src/game/cards.js';
import * as S from '../src/game/state.js';
import { openFrontierDoor } from '../src/game/hotel.js';
import { createRooms } from '../src/net/rooms.js';
import { createMemoryStore } from '../src/net/store.js';
import { validate } from '../src/net/protocol.js';
import { dataHash } from '../src/net/dataHash.js';
import { applyView, blankState } from '../src/net/viewAsState.js';
import { createFloorCopy, syncFloor } from '../src/net/floorCopy.js';
import { createBotTable } from '../src/bots/index.js';
import { DEFAULT_AVATAR, KEY_SLOTS, COLOUR_SLOTS, item, itemById, itemId, isFree } from '../src/data/wardrobe.js';
import { botAvatars } from '../src/table.js';

let failures = 0;
const t0 = Date.now();
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const json = x => JSON.stringify(x);
const TICK = ONLINE.timing.tickMs;

// --- 0. purity ---------------------------------------------------------------------------------------------------------
console.log('purity of the server\'s brain and its store');
for (const f of ['rooms.js', 'store.js']) {
  const src = fs.readFileSync(new URL(`../src/net/${f}`, import.meta.url), 'utf8');
  const code = src.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
  const bad = [/\bdocument\b/, /\bwindow\b/, /from ['"]three/, /from ['"]node:/, /require\(/, /Math\.random/, /state\.rng/, /\bprocess\./,
    /Date\.now/, /\bsetTimeout\b/, /\bsetInterval\b/, /\blocalStorage\b/].filter(re => re.test(code));
  check(!bad.length, `${f}: no DOM, THREE, Node API, Math.random, clock, timer or engine random generator${bad.length ? ' — found ' + bad.join(' ') : ''}`);
}

// --- the harness: rooms.js with an injected clock, seeded random numbers and fake sockets ------------------------------
function seeded(seed) {
  const rng = makeRng(seed >>> 0 || 1);
  return { random: () => rng(), randomBytes: buf => { for (let i = 0; i < buf.length; i++) buf[i] = Math.floor(rng() * 256); return buf; } };
}
const sha256 = t => createHash('sha256').update(t).digest('hex');

function makeHarness({ seed = 1, rules: r = ONLINE_RULES.today, botChat = false, timeScale = 1, limits } = {}) {
  const clock = { now: 1_000_000 };
  const src = seeded(seed);
  const conns = new Map();
  const logs = [];
  let nextConn = 1;
  const rooms = createRooms({
    send: (conn, msg) => { const c = conns.get(conn); if (c && !c.closed) c.receive(JSON.parse(JSON.stringify(msg))); },
    close: (conn, code, why) => { const c = conns.get(conn); if (c && !c.closed) { c.closed = { code, why }; rooms.disconnect(conn); } },
    now: () => clock.now, random: src.random, randomBytes: src.randomBytes, store: createMemoryStore(), rules: r,
    log: l => logs.push(l), hotelData: hotel, cfg: config, hashToken: sha256, timeScale, limits, botChat,
  });
  const H = {
    rooms, clock, logs,
    connect({ ip = '10.0.0.1', name = null, avatar = null } = {}) {
      const conn = { id: nextConn++ };
      const c = {
        conn, name, avatar, msgs: [], closed: null, token: null, nextId: 1, view: null, lobby: null, listeners: [],
        receive(m) {
          c.msgs.push({ at: clock.now, m, text: json(m) });
          if (m.t === 'welcome') c.token = m.token;
          if (m.t === 'view') c.view = m.view;
          if (m.t === 'lobby') c.lobby = m.lobby;
          for (const fn of c.listeners) fn(m);
        },
        send(msg) { const v = validate(JSON.stringify(msg)); if (!v.ok) throw new Error(`invalid ${json(msg)}`); rooms.message(conn, v.msg); },
        hello(extra = {}) { c.send({ t: 'hello', v: ONLINE.protocol, app: 'v0.12', data: dataHash(), token: c.token, name: c.name, avatar: c.avatar, vis: 'visible', ...extra }); },
        last(t) { for (let i = c.msgs.length - 1; i >= 0; i--) if (c.msgs[i].m.t === t) return c.msgs[i].m; return null; },
        do(cmd, turn = c.view?.turn ?? 0) { const id = String(c.nextId++); c.send({ t: 'do', id, turn, cmd }); return c.res(id); },
        res: id => { for (let i = c.msgs.length - 1; i >= 0; i--) if (c.msgs[i].m.t === 'res' && c.msgs[i].m.id === id) return c.msgs[i].m; return null; },
        op(op) { const id = 'o' + c.nextId++; c.send({ t: 'lobby', id, op }); return c.res(id); },
        drop() { if (!c.closed) { c.closed = { code: 1006 }; rooms.disconnect(conn); } },
        card: type => c.view?.me.hand.find(h => h.type === type)?.id ?? null,
      };
      conns.set(conn, c);
      rooms.connect(conn, { ip });
      return c;
    },
    // (a device's command ids never repeat for its seat, across sockets too: the server keeps each seat's last replies)
    reconnect(c, { ip = '10.0.0.1' } = {}) { const d = H.connect({ ip, name: c.name, avatar: c.avatar }); d.token = c.token; d.nextId = c.nextId + 1000; d.hello(); return d; },
    // the clock moves in ticks, as the server's setInterval; `each(now)` runs before every tick
    advance(ms, each) {
      const end = clock.now + ms;
      while (clock.now < end) { clock.now = Math.min(end, clock.now + TICK); each?.(clock.now); rooms.tick(clock.now); }
    },
    // run a script of [offset ms, fn] from `from`, ticking in between, until `until`
    script(from, steps, until) {
      const list = steps.map(([t, fn]) => [from + t, fn]).sort((a, b) => a[0] - b[0]);
      let i = 0;
      H.advance(from + until - clock.now, now => { while (i < list.length && list[i][0] <= now) list[i++][1](now); });
    },
  };
  return H;
}

// A table with these people (names), dealt and in its start: returns the harness, the people's devices, the code.
function dealtTable({ seed, size = 5, names = ['nora', 'sam'], avatars = [], timeScale = 1, botChat = false }) {
  const H = makeHarness({ seed, timeScale, botChat });
  const cs = names.map((n, i) => H.connect({ name: n, avatar: avatars[i] ?? null, ip: `10.1.${seed % 200}.${i + 1}` }));
  cs.forEach(c => c.hello());
  cs[0].send({ t: 'create', size });
  const code = cs[0].lobby.code;
  cs.slice(1).forEach(c => c.send({ t: 'join', code }));
  cs[0].op({ k: 'start' });
  H.advance(ONLINE.timing.startCountdownMs / timeScale + TICK);
  const T = H.rooms.debug.table(code);
  return { H, cs, code, T, M: T.match };
}
// The first seed (from `from`) whose deal satisfies pred(seatOfPerson[], M).
function seedWhere(pred, opts, from = 1) {
  for (let s = from; s < from + 400; s++) {
    const d = dealtTable({ ...opts, seed: s });
    const seats = d.cs.map(c => c.view?.seat);
    if (pred(seats, d.M)) return s;
  }
  throw new Error('no seed found');
}

// A bot table with some answers replaced (the rest is the real one).
function wrapBots(table, over) {
  const w = Object.create(null);
  for (const k of Object.keys(table)) w[k] = table[k];
  w.calls = [];
  for (const [k, fn] of Object.entries(over)) w[k] = (...args) => { w.calls.push(k); return fn(...args); };
  return w;
}
function useBots(M, over) { M.bots = wrapBots(M.bots, over); M.ref.setBots(M.bots); return M.bots; }

// Open doors as the rules would, until `n` rooms besides the lobby are placed; returns a plain room next to the lobby
// (not safe, not locked, not dark, no trade ban, not the Fire Exit).
function growNear(M, n = 6) {
  const { state, floor } = M;
  for (let guard = 0; guard < 80 && floor.roomList.length < n + 1; guard++) {
    const doors = floor.frontier.filter(d => !d.jammed);
    if (!doors.length) break;
    const r = openFrontierDoor(floor, doors[guard % doors.length].id, { isLocked: id => S.isLocked(state, id) });
    if (r.ok) { state.discovered.add(r.room.id); if (r.room.locked && rules.lockedDoorsEnabled) state.lockedRooms.add(r.room.id); }
  }
  const lobby = floor.start.room;
  return [...floor.rooms.get(lobby).neighbours].map(id => floor.rooms.get(id))
    .find(r => r && !r.safe && !r.locked && !r.isExit && !r.dark && !r.noTrade && !S.isLocked(state, r.id)) ?? null;
}
// Every guest's role and hand, by hand: possessed seats get their own souls (as the deal gives them).
function rigRoles(M, possessedSeats) {
  for (const p of M.state.players) {
    p.possessed = possessedSeats.includes(p.index);
    p.convertedBy = null; p.roleChangePending = false; p.knows = new Set();
    p.hand = p.hand.filter(c => c.type !== 'possession');
    if (p.possessed) for (let k = 0; k < 3; k++) p.hand.push(makeCard('possession', { owner: p.id, id: nextCardId(M.state) }));
  }
}
function rigHand(M, seat, types) {
  const p = M.state.players[seat];
  const souls = p.hand.filter(c => c.type === 'possession');
  p.hand = [...types.map(type => makeCard(type, { id: nextCardId(M.state) })), ...souls];
}
const engineCard = (M, seat, type) => M.state.players[seat].hand.find(c => c.type === type)?.id ?? null;
// One device's messages from `from` (virtual ms) up to `to`, as [at, text].
const trail = (c, from, to = Infinity) => c.msgs.filter(x => x.at >= from && x.at <= to).map(x => [x.at, x.text]);
const sameTrail = (a, b) => a.length === b.length && a.every((x, i) => x[0] === b[i][0] && x[1] === b[i][1]);
const trailBytes = t => t.reduce((n, [, s]) => n + s.length, 0);

// --- 1. phase privacy ---------------------------------------------------------------------------------------------------
console.log('\n1. phase privacy: a meeting with the walker\'s weapon swapped for an ordinary card (DESIGN §6.8 test 6)');
{
  // (a) a bot walker, scripted to trade both times; nora is the guest it meets, sam is outside
  const opts = { size: 4, names: ['nora', 'sam'] };
  const seed = seedWhere((seats, M) => !seats.includes(0) && growNear(M), opts, 11);
  const run = armed => {
    const d = dealtTable({ ...opts, seed });
    const { H, cs, M } = d;
    const [nora, sam] = cs;
    const from = H.clock.now;
    const W = 0, N = nora.view.seat;
    const room = growNear(M);
    rigRoles(M, [[1, 2, 3].find(s => s !== N && s !== sam.view.seat)]);
    rigHand(M, W, [armed ? 'knife' : 'bandage', 'espresso', 'flashlight', 'lantern']);
    rigHand(M, N, ['bandage', 'espresso', 'flashlight', 'lantern']);
    for (const p of M.state.players) p.currentRoom = M.floor.start.room;
    M.state.players[N].currentRoom = room.id;
    let moved = false;
    const bots = useBots(M, {
      thinkMs: () => 1000,
      nextAction: seat => (seat === W && !moved ? (moved = true, { k: 'move', to: room.id }) : { k: 'end' }),
      attackWith: () => null,
      tradeCard: (seat, other, allowed) => allowed.find(id => M.state.players[seat].hand.find(c => c.id === id)?.type === 'espresso') ?? allowed[0],
      meetWhom: (seat, cands) => cands[0],
    });
    H.rooms.debug.refresh(d.code);
    const start = H.clock.now;
    H.script(start, [
      [1000, () => cs.forEach(c => c.do({ k: 'ack', what: 'role' }))],
      [9000, () => { const a = nora.view.ask; if (a?.kind === 'tradeCard') nora.do({ k: 'answer', ask: a.id, value: nora.card('bandage') }); }],
      [14000, () => { const r = nora.view.results.find(x => x.kind === 'trade'); if (r) { if (r.notes?.length) nora.do({ k: 'ack', what: 'notes', lines: r.notes }); nora.do({ k: 'ack', what: 'result', id: r.id }); } }],
    ], 20000);
    const traded = M.state.events.some(e => e.type === 'trade');
    const attacked = M.state.events.some(e => e.type === 'attack');
    return { sam: trail(sam, start, start + 20000), traded, attacked, attackAsked: bots.calls.filter(k => k === 'attackWith').length, from };
  };
  const A = run(true), B = run(false);
  check(A.traded && B.traded && !A.attacked && !B.attacked, `the bot walked in and traded both times (armed: asked attackWith ${A.attackAsked}x and chose to trade; unarmed: asked ${B.attackAsked}x)`);
  check(A.sam.length > 3 && sameTrail(A.sam, B.sam), `a bot walker: the outsider's messages are identical, armed or not (${A.sam.length} messages, ${trailBytes(A.sam)} bytes, same arrival times)`);

  // (b) a person walker (nora, active first) walks into a bot's room; sam is outside
  const seed2 = seedWhere((seats, M) => seats[0] === 0 && growNear(M), opts, 21);
  const runP = armed => {
    const d = dealtTable({ ...opts, seed: seed2 });
    const { H, cs, M } = d;
    const [nora, sam] = cs;
    const S2 = sam.view.seat, Q = [1, 2, 3].find(s => s !== S2);
    const room = growNear(M);
    rigRoles(M, [[1, 2, 3].find(s => s !== S2 && s !== Q)]);
    rigHand(M, 0, [armed ? 'knife' : 'bandage', 'espresso', 'flashlight', 'lantern']);
    rigHand(M, Q, ['bandage', 'espresso', 'flashlight', 'lantern']);
    for (const p of M.state.players) p.currentRoom = M.floor.start.room;
    M.state.players[Q].currentRoom = room.id;
    useBots(M, { thinkMs: () => 1000, tradeCard: (seat, other, allowed) => allowed[0], nextAction: () => ({ k: 'end' }) });
    H.rooms.debug.refresh(d.code);
    const start = H.clock.now;
    let ask = null;
    H.script(start, [
      [1000, () => cs.forEach(c => c.do({ k: 'ack', what: 'role' }))],
      [2000, () => nora.do({ k: 'move', to: room.id })],
      [6000, () => { ask = nora.view.ask; if (ask?.kind === 'meetAct') nora.do({ k: 'answer', ask: ask.id, value: 'trade' }); }],
      [8000, () => { const a = nora.view.ask; if (a?.kind === 'tradeCard') nora.do({ k: 'answer', ask: a.id, value: nora.card('espresso') }); }],
      [12000, () => { const r = nora.view.results.find(x => x.kind === 'trade'); if (r) { if (r.notes?.length) nora.do({ k: 'ack', what: 'notes', lines: r.notes }); nora.do({ k: 'ack', what: 'result', id: r.id }); } }],
      [16000, () => nora.do({ k: 'end' })],
    ], 16500);
    return { sam: trail(sam, start, start + 16500), ask, traded: M.state.events.some(e => e.type === 'trade') };
  };
  const PA = runP(true), PB = runP(false);
  check(PA.ask?.kind === 'meetAct' && PB.ask?.kind === 'meetAct' && PA.ask.canAttack === true && PB.ask.canAttack === false
    && PA.ask.weapons.length === 1 && PB.ask.weapons.length === 0,
    'a person walker is asked Trade or Attack both times (armed: canAttack true with 1 weapon; unarmed: false, none)');
  check(PA.traded && PB.traded && PA.sam.length > 3 && sameTrail(PA.sam, PB.sam),
    `a person walker: the outsider's messages are identical, armed or not (${PA.sam.length} messages, ${trailBytes(PA.sam)} bytes)`);
}

// --- 2. equal traffic ----------------------------------------------------------------------------------------------------
console.log('\n2. equal traffic for every kind of trade (DESIGN §6.8 test 7)');
{
  const opts = { size: 5, names: ['nora', 'sam'] };
  const seed = seedWhere((seats, M) => seats[0] === 0 && growNear(M), opts, 41);
  const CASES = {
    plain:      { noraPossessed: false, noraGives: 'espresso', botGives: 'bandage' },
    possession: { noraPossessed: false, noraGives: 'espresso', botGives: 'possession' },
    block:      { noraPossessed: false, noraGives: 'lantern', botGives: 'possession' },
    spent:      { noraPossessed: true, noraGives: 'espresso', botGives: 'possession' },
    crossed:    { noraPossessed: true, noraGives: 'possession', botGives: 'possession' },
  };
  const out = {};
  for (const [name, k] of Object.entries(CASES)) {
    const d = dealtTable({ ...opts, seed });
    const { H, cs, M } = d;
    const [nora, sam] = cs;
    const S2 = sam.view.seat, Q = [1, 2, 3, 4].find(s => s !== S2);
    const room = growNear(M);
    rigRoles(M, k.noraPossessed ? [0, Q] : [Q]);
    rigHand(M, 0, ['espresso', 'bandage', 'flashlight', 'lantern']);
    rigHand(M, Q, ['bandage', 'espresso', 'flashlight', 'lantern']);
    for (const p of M.state.players) p.currentRoom = M.floor.start.room;
    M.state.players[Q].currentRoom = room.id;
    useBots(M, {
      thinkMs: () => 1000, nextAction: () => ({ k: 'end' }),
      tradeCard: (seat, other, allowed) => allowed.find(id => M.state.players[seat].hand.find(c => c.id === id)?.type === k.botGives) ?? allowed[0],
    });
    H.rooms.debug.refresh(d.code);
    const start = H.clock.now;
    const asked = [];
    const ackAll = (final) => {
      const v = nora.view;
      for (const r of v.results) {
        if (r.notes?.length) nora.do({ k: 'ack', what: 'notes', lines: r.notes });
        nora.do({ k: 'ack', what: 'result', id: r.id });
      }
      if (final && v.ask?.kind === 'role') nora.do({ k: 'ack', what: 'role' });
    };
    H.script(start, [
      [1000, () => cs.forEach(c => c.do({ k: 'ack', what: 'role' }))],
      [2000, () => nora.do({ k: 'move', to: room.id })],
      [6000, () => { const a = nora.view.ask; asked.push(a?.kind); if (a?.kind === 'meetAct') nora.do({ k: 'answer', ask: a.id, value: 'trade' }); }],
      [8000, () => { const a = nora.view.ask; asked.push(a?.kind); if (a?.kind === 'tradeCard') nora.do({ k: 'answer', ask: a.id, value: nora.card(k.noraGives) }); }],
      // the person reads their screens: a possession has one more (the role); the LAST acknowledgement is at 14 s in every case
      [11000, () => { const v = nora.view; asked.push(v.ask?.kind === 'role' ? 'role' : '-'); if (v.ask?.kind === 'role') ackAll(false); }],
      [14000, () => ackAll(true)],
      [16000, () => nora.do({ k: 'end' })],
    ], 16500);
    const res = nora.msgs.map(x => x.m).filter(m => m.t === 'view').flatMap(m => m.view.results).find(r => r.kind === 'trade');
    out[name] = { sam: trail(sam, start, start + 16500), outcome: res?.outcome ?? null, asked, roleChanged: M.state.players[0].possessed, turnPassed: M.state.activeIndex !== 0 };
  }
  const names = Object.keys(CASES);
  check(names.every(n => out[n].asked[0] === 'meetAct' && out[n].asked[1] === 'tradeCard' && out[n].turnPassed), 'each case: the meeting question, the card question, the turn passed at 16 s');
  const outcomes = names.map(n => out[n].outcome);
  check(new Set(outcomes).size === 5 && outcomes.every(Boolean), `five different outcomes for the person: ${names.map((n, i) => `${n} → ${outcomes[i]}`).join(', ')}`);
  check(out.possession.asked[2] === 'role' && out.possession.roleChanged && names.filter(n => n !== 'possession').every(n => out[n].asked[2] === '-'),
    'only the possession brings the extra screen (the role), read before the last acknowledgement');
  const ref = out.plain.sam;
  for (const n of names.slice(1)) {
    check(sameTrail(ref, out[n].sam), `${n}: the outsider's messages equal the plain trade's (${out[n].sam.length} messages, ${trailBytes(out[n].sam)} bytes, same arrival times)`);
  }
}

// --- 3. discard privacy ---------------------------------------------------------------------------------------------------
console.log('\n3. discard privacy: ending under the hand limit, or over it and discarding (DESIGN §6.8 test 7b)');
{
  const opts = { size: 4, names: ['nora', 'sam'] };
  const seed = seedWhere(seats => seats[0] === 0, opts, 61);
  const run = over => {
    const d = dealtTable({ ...opts, seed });
    const { H, cs, M } = d;
    const [nora, sam] = cs;
    rigHand(M, 0, over ? ['espresso', 'bandage', 'flashlight', 'lantern', 'bandage', 'espresso', 'flashlight'] : ['espresso', 'bandage', 'flashlight', 'lantern']);
    useBots(M, { thinkMs: () => 1000, nextAction: () => ({ k: 'end' }) });
    H.rooms.debug.refresh(d.code);
    const start = H.clock.now;
    let ask = null, samSaw = [];
    sam.listeners.push(m => { if (m.t === 'view') samSaw.push([m.view.phase.kind, m.view.clock?.kind ?? null, m.view.ask?.kind ?? null]); });
    const steps = [[1000, () => cs.forEach(c => c.do({ k: 'ack', what: 'role' }))]];
    if (over) {
      steps.push([11250, () => nora.do({ k: 'end' })]);              // (off the server's 1-second check: a view sent then would show)
      steps.push([16000, () => { ask = nora.view.ask; if (ask?.kind === 'discard') nora.do({ k: 'discard', card: ask.cards[ask.cards.length - 1] }); }]);
    } else steps.push([16000, () => nora.do({ k: 'end' })]);
    H.script(start, steps, 16500);
    return { sam: trail(sam, start, start + 16500), ask, passed: M.state.activeIndex !== 0, samSaw, left: nora.msgs.filter(x => x.m.t === 'view' && x.at === start + 11250).map(x => x.m.view.ask?.leftMs)[0] };
  };
  const U = run(false), O = run(true);
  check(O.ask?.kind === 'discard' && O.ask.over === 1 && U.passed && O.passed, `over the limit: the discard question (over by ${O.ask?.over}; ${Math.round((O.left ?? 0) / 1000)} s on the clock at the End), and the turn passed at the same moment both times`);
  check(!O.samSaw.some(([ph, ck, ak]) => ph === 'discard' || ck === 'discard' || ak === 'discard'), 'the outsider never saw a discard phase, a discard clock or the question');
  check(U.sam.length > 2 && sameTrail(U.sam, O.sam), `the outsider's messages are identical (${U.sam.length} messages, ${trailBytes(U.sam)} bytes, same arrival times)`);
}

// --- 4. looks -----------------------------------------------------------------------------------------------------------
console.log('\n4. looks: a person\'s unlockable item survives the server\'s check, as a bot\'s does (DESIGN §6.8 test 7c)');
{
  const look = { ...JSON.parse(json(DEFAULT_AVATAR)), top: 'smoking' };
  const unlockables = av => [...KEY_SLOTS, ...COLOUR_SLOTS].map(sl => item(sl, av?.[sl])).concat((av?.extras || []).map(x => itemById(x) || null))
    .filter(it => it && !isFree(it)).map(itemId);
  check(json(unlockables(look)) === json(['top.smoking']), `the Smoking jacket is an unlockable item (${unlockables(look).join(', ')}), not a free one`);
  const d = dealtTable({ seed: 81, size: 5, names: ['nora', 'sam'], avatars: [look, null] });
  const [nora, sam] = d.cs;
  const seen = sam.view.players[nora.view.seat].avatar;
  check(seen?.top === 'smoking' && nora.view.players[nora.view.seat].avatar.top === 'smoking', 'the person\'s Smoking jacket is on their guest, in their own view and in the others\'');
  nora.op({ k: 'look', avatar: look });
  check(d.T.people.find(p => p.name === 'nora').avatar.top === 'smoking', '...and through a Wardrobe change (lobby look) too');
  const botLooks = d.M.state.players.filter((p, i) => !d.M.people.includes(i)).map(p => p.avatar)
    .concat(botAvatars(Array.from({ length: 400 }, (_, i) => `guest${i}`)));
  const wearing = botLooks.filter(av => unlockables(av).length).length;
  check(wearing > 0, `bots wear unlockable items too, and keep them (${wearing} of ${botLooks.length} bot looks), so no item marks a bot or a person`);
}

// --- scripted people for whole matches ------------------------------------------------------------------------------------
// A person who plays from what their own device is told: the view written into a presenter state and a floor copy,
// a bot's brain over those to choose, random delays. (The same brain a computer guest has, fed only the view.)
function personOf(c, { rng, seed, delay = [200, 1500], endAfter = 12 }) {
  const P = { state: blankState(), floor: createFloorCopy(hotel, config), received: [], mind: null, seat: null, key: null, plan: null,
    acts: 0, turn: null, refused: 0, stats: { cmds: 0, refused: 0, asks: {}, results: {} } };
  c.listeners.push(m => {
    if (m.t === 'view') {
      const key = `${m.view.table?.code}:${m.view.players.map(p => p.id + p.name).join(',')}`;
      const fresh = !!m.fresh;
      const isNew = P.key !== key;
      if (fresh) P.received = m.events.filter(e => e.o != null); else P.received.push(...m.events.filter(e => e.o != null));
      applyView(P.state, m.view, P.received, { fresh, newMatch: isNew || undefined });
      syncFloor(P.floor, m.view.hotel);
      if (isNew || !P.mind) { P.seat = m.view.seat; P.key = key; P.mind = createBotTable(P.state, P.floor, [{ index: m.view.seat, profile: null }], seed); }
    }
    if (m.t === 'res') { P.stats.cmds++; if (!m.ok) { P.stats.refused++; P.lastRefused = m; } }
  });
  const R = (a, b) => a + (b - a) * rng();
  const situation = () => {
    const v = c.view;
    if (!v || v.end || v.phase.kind === 'ended' || c.closed) return null;
    if (v.ask) return 'a' + v.ask.id;
    if (v.results.length) return 'r' + v.results[0].id;
    if (v.phase.kind === 'turn' && v.activeSeat === v.seat && v.me.alive) return `t${v.turn}:${P.acts}`;
    return null;
  };
  function act() {
    const v = c.view, a = v.ask;
    if (a) {
      P.stats.asks[a.kind] = (P.stats.asks[a.kind] || 0) + 1;
      switch (a.kind) {
        case 'role': return c.do({ k: 'ack', what: 'role' });
        case 'meetWhom': return c.do({ k: 'answer', ask: a.id, value: P.mind.meetWhom(P.seat, a.candidates) });
        case 'meetAct': { const w = a.canAttack ? P.mind.attackWith(P.seat, a.with) : null; return c.do({ k: 'answer', ask: a.id, value: w && a.weapons.includes(w) ? { attack: w } : 'trade' }); }
        case 'tradeCard': return c.do({ k: 'answer', ask: a.id, value: P.mind.tradeCard(P.seat, a.with, a.cards) });
        case 'offer': return c.do({ k: 'answer', ask: a.id, value: !!P.mind.acceptTrade(P.seat, a.from) });
        case 'discard': return c.do({ k: 'discard', card: P.mind.discard(P.seat, a.cards) });
        default: return null;
      }
    }
    if (v.results.length) {
      const r = v.results[0];
      P.stats.results[r.kind] = (P.stats.results[r.kind] || 0) + 1;
      if ((r.kind === 'trade' || r.kind === 'noTrade') && r.notes?.length) c.do({ k: 'ack', what: 'notes', lines: r.notes });
      return c.do({ k: 'ack', what: 'result', id: r.id });
    }
    if (P.turn !== v.turn) { P.turn = v.turn; P.acts = 0; P.refused = 0; }
    P.acts++;
    let x = P.acts > endAfter || P.refused >= 3 ? { k: 'end' } : P.mind.nextAction(P.seat);
    if (!x) x = { k: 'end' };
    const cmd = x.k === 'card' ? { k: 'card', type: x.type, card: x.card, ...(x.target != null ? { target: x.target } : {}) } : { ...x };
    const r = c.do(cmd);
    if (r && !r.ok) { P.refused++; try { P.mind.reject(P.seat, x, r.reason); } catch { /* fine */ } }
    return r;
  }
  P.step = now => {
    const sit = situation();
    if (!sit) { P.plan = null; return; }
    if (P.plan?.key !== sit) P.plan = { key: sit, at: now + R(delay[0], delay[1]) };
    if (now >= P.plan.at) { P.plan = null; act(); }
  };
  return P;
}

// Scan everything one seat was sent in one match. Returns a list of problems.
function scanSeat(c, M, { allIds }) {
  const problems = [];
  const gone = new Set(), held = new Set();
  let ended = false;
  const walk = (x, path, at) => {
    if (typeof x === 'string') {
      if (allIds.has(x)) problems.push(`engine card id ${x} at ${path}`);
      if (gone.has(x)) problems.push(`an alias that left the hand came back: ${x} at ${path}`);
      return;
    }
    if (!x || typeof x !== 'object') return;
    if (Array.isArray(x)) { x.forEach((v, i) => walk(v, `${path}[${i}]`, at)); return; }
    for (const [k, v] of Object.entries(x)) {
      if (k === 'seq') problems.push(`a seq at ${path}`);
      if (k === 'possessed' && v === true && !ended && !path.startsWith('view.me') && !path.includes('inbox') && !path.includes('events')) problems.push(`a role at ${path}`);
      if ((k === 'hand' || k === 'knows' || k === 'notes' || k === 'inbox') && !path.startsWith('view.me') && !path.startsWith('view.end') && !path.startsWith('view.results')) problems.push(`${k} at ${path}`);
      walk(v, `${path}.${k}`, at);
    }
  };
  for (const { m } of c.msgs) {
    if (m.t === 'view') {             // (the hand first: an alias that has just left must not appear anywhere else)
      const now = new Set(m.view.me.hand.map(h => h.id));
      for (const a of held) if (!now.has(a)) { gone.add(a); held.delete(a); }
      for (const a of now) {
        if (typeof a !== 'string' || a.length !== 8 || a[0] === 'c') problems.push(`a bad alias ${a}`);
        if (!gone.has(a)) held.add(a);
      }
    }
    if (m.t === 'res') {
      const keys = Object.keys(m).filter(k => !['t', 'id', 'ok', 'reason', 'result'].includes(k));
      if (keys.length || (m.result && json(Object.keys(m.result)) !== '["rooms"]')) problems.push(`a reply with more than { rooms }: ${json(m).slice(0, 80)}`);
      continue;
    }
    if (m.t !== 'view') continue;
    ended = !!m.view.end;
    walk(m.view, 'view', 0);
    const own = new Set(m.view.me.inbox.map(e => e.o));       // (my own private events: a Hand Mirror's shows a hand)
    m.events.forEach((e, i) => walk(e, own.has(e.o) ? `view.me.inbox(events[${i}])` : `events[${i}]`, 0));
  }
  return problems;
}

// --- 5. the alias trail and a wire scan over whole matches ----------------------------------------------------------------
console.log('\n5. whole matches of scripted people: the alias trail (test 9) and what reaches each device');
{
  const agg = { matches: 0, ended: 0, finished: 0, stalled: 0, msgs: 0, views: 0, bytes: 0, problems: [], aliases: 0, cmds: 0, refused: 0 };
  for (let k = 0; k < 12; k++) {
    const size = 4 + (k % 3), names = ['nora', 'sam', 'ivy'].slice(0, 2 + (k % 2));
    const d = dealtTable({ seed: 500 + k, size, names, botChat: k % 3 === 0 });
    const folk = d.cs.map((c, i) => personOf(c, { rng: makeRng(900 + k * 7 + i), seed: 300 + k * 7 + i, delay: k % 4 === 3 ? [800, 6000] : [150, 1500] }));
    let guard = 0;
    while (!d.cs.every(c => c.view?.end) && guard++ < 30000) d.H.advance(TICK, now => folk.forEach(p => p.step(now)));
    agg.matches++;
    const end = d.cs[0].view?.end;
    if (end) { agg.ended++; if (end.stopped) agg.stalled++; else agg.finished++; }
    const M = d.T.match;
    const allIds = new Set(Array.from({ length: M.state.cardSeq }, (_, i) => `c${i + 1}`));
    for (const c of d.cs) {
      agg.problems.push(...scanSeat(c, M, { allIds }).map(p => `match ${k} ${c.name}: ${p}`));
      agg.msgs += c.msgs.length;
      agg.views += c.msgs.filter(x => x.m.t === 'view').length;
      agg.bytes += c.msgs.reduce((n, x) => n + x.text.length, 0);
      agg.aliases += new Set(c.msgs.filter(x => x.m.t === 'view').flatMap(x => x.m.view.me.hand.map(h => h.id))).size;
    }
    for (const p of folk) { agg.cmds += p.stats.cmds; agg.refused += p.stats.refused; }
    if (d.H.logs.some(l => /fault|failed|could not/.test(l))) agg.problems.push(`match ${k}: ${d.H.logs.filter(l => /fault|failed|could not/.test(l))[0]}`);
  }
  check(agg.ended === agg.matches, `every match ended: ${agg.finished} finished, ${agg.stalled} stopped (${agg.matches} matches, ${agg.cmds} commands from the people, ${agg.refused} refused)`);
  check(agg.problems.length === 0, `${agg.msgs} messages (${agg.views} views, ${(agg.bytes / 1048576).toFixed(1)} MB) scanned: no engine card id, no seq, no other seat's role or hand, replies only { rooms }, no alias back after it left (${agg.aliases} aliases)${agg.problems.length ? ' — ' + agg.problems.slice(0, 3).join('; ') : ''}`);
}

// --- 6. two tables of different sizes in one process ----------------------------------------------------------------------
console.log('\n6. two tables of different sizes, interleaved in one process');
{
  const H = makeHarness({ seed: 707 });
  const mk = (names, size, net) => {
    const cs = names.map((n, i) => H.connect({ name: n, ip: `10.9.${net}.${i + 1}` }));
    cs.forEach(c => c.hello());
    cs[0].send({ t: 'create', size });
    const code = cs[0].lobby.code;
    cs.slice(1).forEach(c => c.send({ t: 'join', code }));
    cs[0].op({ k: 'start' });
    return { cs, code };
  };
  const A = mk(['nora', 'sam'], 4, 1);
  H.advance(2000);
  const B = mk(['ivy', 'pebble', 'jules'], 6, 2);
  H.advance(6000);
  const all = [...A.cs, ...B.cs];
  const folk = all.map((c, i) => personOf(c, { rng: makeRng(70 + i), seed: 170 + i }));
  let guard = 0;
  while (!all.every(c => c.view?.end) && guard++ < 40000) H.advance(TICK, now => folk.forEach(p => p.step(now)));
  const TA = H.rooms.debug.table(A.code), TB = H.rooms.debug.table(B.code);
  check(A.cs.every(c => c.view?.end) && B.cs.every(c => c.view?.end), `both matches ended (4 seats: ${TA.match.state.turn} turns; 6 seats: ${TB.match.state.turn} turns)`);
  const ids = T => T.match.state.players.flatMap(p => p.hand.map(c => c.id)).concat(T.match.state.drawPile.map(c => c.id), T.match.state.discardPile.map(c => c.id));
  const idsA = ids(TA), idsB = ids(TB);
  check(new Set(idsA).size === idsA.length && new Set(idsB).size === idsB.length && TA.match.state.cardSeq > 0 && TB.match.state.cardSeq > 0
    && idsA.every(id => /^c\d+$/.test(id) && +id.slice(1) <= TA.match.state.cardSeq) && idsB.every(id => +id.slice(1) <= TB.match.state.cardSeq),
  `each table numbers its own cards c1… (4 seats: ${TA.match.state.cardSeq}, 6 seats: ${TB.match.state.cardSeq}), none twice`);
  const cross = (cs, own, other, seats) => cs.some(c => c.msgs.some(x => (x.m.view && (x.m.view.table.code !== own || x.m.view.seats !== seats)) || x.text.includes(other)));
  check(!cross(A.cs, A.code, B.code, 4) && !cross(B.cs, B.code, A.code, 6), 'nobody at one table was sent anything of the other (codes, seat counts)');
}

// --- 7. playerView through the server ---------------------------------------------------------------------------------------
console.log('\n7. the view through the server: the table, Away, no Bot label, the table\'s events, reconnects, refusals');
{
  const opts = { size: 5, names: ['nora', 'sam', 'ivy'] };
  const seed = seedWhere((seats, M) => seats[0] === 0 && growNear(M), opts, 101);
  const d = dealtTable({ ...opts, seed });
  const { H, cs, M, code } = d;
  let [nora, sam, ivy] = cs;
  const v = sam.view;
  check(isDeepStrictEqual(v.table, { kind: 'friends', code, rules: 'today', clockOn: true, relaxed: false }), `the table: ${json(v.table)}`);
  check(v.players.length === 5 && v.players.every(p => !('bot' in p)) && v.players.every(p => p.away === false), 'five guests, nobody away, no Bot label (owner decision D3 not taken)');
  check(v.phase.kind === 'start' && v.ask?.kind === 'role' && sam.lobby.phase === 'playing', 'the start: each person\'s own role question; the waiting room says playing');
  cs.forEach(c => c.do({ k: 'ack', what: 'role' }));
  H.advance(500);
  check(nora.view.phase.kind === 'turn' && nora.view.activeSeat === 0 && nora.view.clock?.running === true && nora.view.clock.leftMs > 40000, `turn 1: nora's turn, the clock running (${nora.view.clock?.leftMs} ms)`);
  // Away: a socket gone is Away at once; a hidden page after 5 s; back on return
  const ivySeat = ivy.view.seat;
  ivy.drop();
  H.advance(TICK);
  const lastSam = () => sam.last('view');
  check(lastSam().view.players[ivySeat].away === true && lastSam().events.some(e => e.type === 'away' && e.seat === ivySeat && e.o == null),
    'ivy\'s socket closed: Away at once, with the table\'s own event { type: away } (no ordinal)');
  const presenter = applyView(blankState(), sam.view, []);
  const before = json([...presenter.events]);
  applyView(presenter, lastSam().view, lastSam().events);
  check(json([...presenter.events]) === before, '...which the presenter ignores (applyView adds only events with an ordinal)');
  ivy = H.reconnect(ivy, { ip: '10.1.0.3' });
  H.advance(TICK);
  check(ivy.last('welcome')?.place === 'match' && ivy.msgs.some(x => x.m.t === 'view' && x.m.fresh === true && x.m.view.seat === ivySeat)
    && lastSam().view.players[ivySeat].away === false && lastSam().events.some(e => e.type === 'back'), 'ivy is back: the same seat, a fresh view, everyone sees her back');
  sam.send({ t: 'vis', v: 'hidden' });
  H.advance(2000);
  const samSeat = sam.view.seat;
  const awayEarly = nora.view.players[samSeat].away;
  H.advance(3500);
  check(awayEarly === false && nora.view.players[samSeat].away === true, 'sam\'s page hidden: not Away at 2 s, Away after 5 s');
  sam.send({ t: 'vis', v: 'visible' });
  H.advance(TICK);
  check(nora.view.players[samSeat].away === false, '...and back at once when shown');
  // a reconnect draws the same presenter as a device that never left
  const P1 = personOf(nora, { rng: makeRng(1), seed: 1 });
  nora.msgs.filter(x => x.m.t === 'view').forEach(x => nora.listeners.forEach(fn => fn(x.m)));
  const n2 = H.reconnect(nora, { ip: '10.1.0.1' });
  H.advance(TICK);
  const fresh = n2.msgs.find(x => x.m.t === 'view');
  check(nora.closed?.code === 4001 && nora.last('bye')?.why === 'elsewhere', 'the newest socket wins: the old one is told bye elsewhere (4001)');
  const P2 = applyView(blankState(), fresh.m.view, fresh.m.events, { fresh: true });
  const canon = st => JSON.stringify(st, (k, x) => (k === 'leftMs' ? undefined : x instanceof Set ? [...x].sort() : x instanceof Map ? [...x].sort((a, b) => String(a[0]).localeCompare(String(b[0]))) : x));
  check(fresh.m.fresh === true && canon(P2) === canon(P1.state), 'a reconnect: one fresh view draws exactly the presenter of the device that never left');
  nora = n2;
  // refusals and replies
  const stale = nora.do({ k: 'search' }, nora.view.turn + 1);
  const foreign = nora.do({ k: 'card', type: 'bandage', card: 'zzzzzzzz' });
  const engineId = M.state.players[0].hand[0]?.id;
  const raw = nora.do({ k: 'card', type: M.state.players[0].hand[0]?.type || 'bandage', card: engineId });
  const notMine = sam.do({ k: 'search' });
  check(stale?.reason === 'stale' && foreign?.reason === 'notYourCard' && raw?.reason === 'notYourCard' && notMine?.reason === 'notYourTurn',
    `refused: an old turn (${stale?.reason}), an unknown alias (${foreign?.reason}), an engine id (${raw?.reason}), out of turn (${notMine?.reason})`);
  // a move's reply is { rooms } only
  const room = growNear(M);
  H.rooms.debug.refresh(code);
  const mv = room ? nora.do({ k: 'move', to: room.id }) : null;
  check(mv?.ok && isDeepStrictEqual(Object.keys(mv), ['t', 'id', 'ok', 'result']) && Array.isArray(mv.result.rooms) && mv.result.rooms.at(-1) === room.id,
    `a move's reply: { rooms } (${json(mv?.result)})`);
  // the same command id twice: it acts once (the second End would be out of turn), the same reply both times
  const id = String(nora.nextId++);
  const turnBefore = M.state.turn;
  nora.send({ t: 'do', id, turn: nora.view.turn, cmd: { k: 'end' } });
  const turnMid = M.state.turn;
  nora.send({ t: 'do', id, turn: nora.view.turn, cmd: { k: 'end' } });
  const replies = nora.msgs.filter(x => x.m.t === 'res' && x.m.id === id).map(x => x.text);
  check(replies.length === 2 && replies[0] === replies[1] && JSON.parse(replies[0]).ok === true && turnMid === turnBefore + 1 && M.state.turn === turnMid,
    `the same command id twice: the turn ended once, the same reply twice (${replies[0]})`);
  // the saved table: plain JSON with everything to bring it back
  const saved = typeof d.T.saved === 'string' ? JSON.parse(d.T.saved) : d.T.saved;
  check(saved && saved.match && saved.match.engine && saved.match.referee && saved.match.aliases && isDeepStrictEqual(JSON.parse(json(saved)), saved)
    && !json(saved).includes(nora.token), `the table is saved after every step (${(json(saved).length / 1024).toFixed(1)} KB), plain JSON, never a device key`);
}

console.log(`\n${failures ? `${failures} FAILED` : 'ALL FAIRNESS CHECKS PASSED'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failures ? 1 : 0);
