// THE CO-OP SERVER OVER THE WIRE (DESIGN §7, §12, §15): server/index.js started in this process on a free port, with
// an injected clock the test moves itself, and real WebSocket clients (the `ws` package from server/node_modules),
// each with its own X-Forwarded-For so one machine can act as many devices (the server runs with TRUST_PROXY=render).
//   npm ci --prefix server        (once: the server's one package, ws)
//   node tests/protocol-check.mjs
//
//   1. settings and addresses: the test-only switches refused in production; HOTEL_RULES=pending only on a local
//      server; the client address is the right-most X-Forwarded-For entry, IPv6 grouped by /64
//   2. origins: a foreign page and a missing Origin get HTTP 403; a page on http://127.0.0.1:* or localhost is
//      admitted (not in production); the live site's origin is admitted
//   3. hello: a device key; an old or newer protocol or other shared data (bye update / serverOld, 4004 / 4005); no
//      hello in time (4010); a bad name
//   4. codes: create, peek, join by code, link or lower case; bad and unknown codes; the wrong-code limits
//   5. the waiting room: host-only operations, size, lock, removal sticks, start fills the empty seats with bots,
//      a person mid-match can't join, Play again
//   6. a match: refusals (out of turn, stale, not your card, bad answer), the same command id twice acts once, a
//      reconnect gets a full view and the same seat, the newest socket wins
//   7. the socket's own limits: bad JSON (1007), a binary frame and an unknown type (1003), too many messages (1008),
//      an oversized frame (1009, "the spike's crash": the process keeps serving), the heartbeat cutting a silent socket
//   8. limits that bind: sockets per address (HTTP 429), table creations and open tables, the table cap, the
//      TABLES_OPEN kill switch, close timers (an ended table, an unused waiting room, a match with nobody connected)
//   9. render.yaml's build filter equals the server's real import graph
//  10. a 5,000-message fuzz: nothing stops the server, and a normal table still works after it
//  11. the wire scan: 30 matches of 2-3 scripted people and bots, every message each device received (replies
//      included): no engine card id, no seq, no other seat's role, hand, knows, notes or inbox, replies only { rooms }
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

let failures = 0;
const t0 = Date.now();
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const json = x => JSON.stringify(x);
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

let WebSocket;
try {
  WebSocket = createRequire(new URL('../server/package.json', import.meta.url))('ws');
} catch {
  console.log('  FAIL the server\'s package (ws) is not installed: run   npm ci --prefix server   once, then this suite again');
  process.exit(1);
}
const { startServer, readEnv, originAllowed } = await import('../server/index.js');
const { clientIp, normaliseIp } = await import('../server/clientIp.js');
const { ONLINE } = await import('../src/data/online.js');
const { dataHash } = await import('../src/net/dataHash.js');
const { applyView, blankState } = await import('../src/net/viewAsState.js');
const { createFloorCopy, syncFloor } = await import('../src/net/floorCopy.js');
const { createBotTable } = await import('../src/bots/index.js');
const { makeRng } = await import('../src/game/cards.js');
const { hotel } = await import('../src/data/hotel.js');
const { config } = await import('../src/config.js');

let uncaught = 0;
process.on('uncaughtException', e => { uncaught++; console.log(`  FAIL uncaught: ${e?.stack?.split('\n').slice(0, 3).join(' | ')}`); failures++; });

const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(pred, ms = 3000) { const end = Date.now() + ms; while (!pred()) { if (Date.now() > end) return false; await sleep(2); } return true; }
const PAGE = 'http://127.0.0.1:9151';
let ipSeq = 0;
const nextIp = () => `198.51.${(++ipSeq >> 8) & 255}.${ipSeq & 255}`;

// --- servers and devices ----------------------------------------------------------------------------------------------
const servers = [];
async function server(opts = {}) {
  const clock = { now: 1_800_000_000_000 };
  const logs = [];
  const srv = await startServer({ port: 0, host: '127.0.0.1', trustProxy: 'render', now: () => clock.now, autoTick: false,
    heartbeatMs: 60000, log: l => logs.push(l), botChat: false, ...opts });
  srv.clock = clock; srv.logs = logs;
  srv.advance = async (ms, each) => {
    const end = clock.now + ms;
    while (clock.now < end) { clock.now = Math.min(end, clock.now + ONLINE.timing.tickMs); each?.(clock.now); srv.tick(); await sleep(0); }
    await sleep(5);
  };
  servers.push(srv);
  return srv;
}

// A device: a WebSocket with its own address, keeping every message it receives.
async function device(srv, { name = null, avatar = null, ip = nextIp(), origin = PAGE, token = null, hello = true } = {}) {
  const headers = ip ? { 'x-forwarded-for': `10.0.0.9, ${ip}` } : {};
  const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/`, { origin: origin ?? undefined, headers, perMessageDeflate: false });
  const c = { ws, ip, name, avatar, token, msgs: [], closed: null, status: null, nextId: 1, view: null, lobby: null, listeners: [] };
  ws.on('message', (d, bin) => {
    const m = JSON.parse(String(d));
    c.msgs.push({ m, text: String(d), at: srv.clock.now });
    if (m.t === 'welcome') c.token = m.token;
    if (m.t === 'view') c.view = m.view;
    if (m.t === 'lobby') c.lobby = m.lobby;
    for (const fn of c.listeners) fn(m);
  });
  ws.on('close', (code, reason) => { c.closed = { code, reason: String(reason) }; });
  ws.on('error', () => {});
  ws.on('unexpected-response', (req, res) => { c.status = res.statusCode; c.closed = { code: 'http', status: res.statusCode }; req.destroy(); });
  await until(() => ws.readyState === WebSocket.OPEN || c.closed, 3000);
  Object.assign(c, {
    send: obj => { if (ws.readyState === WebSocket.OPEN) ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); },
    hello: (extra = {}) => c.send({ t: 'hello', v: ONLINE.protocol, app: 'v0.12', data: dataHash(), token: c.token, name: c.name, avatar: c.avatar, vis: 'visible', ...extra }),
    last: t => { for (let i = c.msgs.length - 1; i >= 0; i--) if (c.msgs[i].m.t === t) return c.msgs[i].m; return null; },
    count: t => c.msgs.filter(x => x.m.t === t).length,
    res: id => c.msgs.find(x => x.m.t === 'res' && x.m.id === id)?.m ?? null,
    async do(cmd, turn = c.view?.turn ?? 0) { const id = `d${c.nextId++}`; c.send({ t: 'do', id, turn, cmd }); await until(() => c.res(id) || c.closed, 2000); return c.res(id); },
    async op(op) { const id = `o${c.nextId++}`; c.send({ t: 'lobby', id, op }); await until(() => c.res(id) || c.closed, 2000); return c.res(id); },
    async wait(t, n = c.count(t) + 1, ms = 2000) { await until(() => c.count(t) >= n || c.closed, ms); return c.last(t); },
    close: () => ws.close(),
  });
  if (hello && ws.readyState === WebSocket.OPEN) { c.hello(); await c.wait('welcome', 1); }
  return c;
}
const reopen = (srv, c, extra = {}) => device(srv, { name: c.name, avatar: c.avatar, ip: c.ip, token: c.token, ...extra }).then(d => { d.nextId = c.nextId + 1000; return d; });

// A table: the first device creates it, the others join; returns the code.
async function table(srv, devs, size = 5) {
  devs[0].send({ t: 'create', size });
  await until(() => devs[0].lobby?.code);
  const code = devs[0].lobby.code;
  for (const d of devs.slice(1)) { d.send({ t: 'join', code }); await until(() => d.lobby?.code === code || d.last('err')); }
  return code;
}
async function startMatch(srv, devs, code) {
  await devs[0].op({ k: 'start' });
  await srv.advance(ONLINE.timing.startCountdownMs + 300);
  await until(() => devs.every(d => d.view));
  return srv.rooms.debug.table(code);
}

// --- 1. settings and addresses -----------------------------------------------------------------------------------------
console.log('1. settings and the client address');
{
  const thrown = env => { try { readEnv(env); return null; } catch (e) { return e.message; } };
  check(/refused when NODE_ENV=production/.test(thrown({ NODE_ENV: 'production', TIME_SCALE: '20' }) || '') && /refused/.test(thrown({ NODE_ENV: 'production', LIMITS_SCALE: '5' }) || ''),
    'TIME_SCALE and LIMITS_SCALE are refused when NODE_ENV=production');
  check(/at least 1/.test(thrown({ TIME_SCALE: '0.5' }) || '') && readEnv({ TIME_SCALE: '20' }).timeScale === 20, 'TIME_SCALE must be at least 1 (20 accepted locally)');
  const prod = readEnv({ NODE_ENV: 'production' });
  check(prod.host === '0.0.0.0' && prod.devOrigins === false && json(prod.origins) === json(['https://mohmdalmalik.github.io']) && prod.trustProxy === 'none' && prod.rules === 'today',
    'production: listens on 0.0.0.0, only the live site\'s origin, today\'s rules');
  check(readEnv({}).host === '127.0.0.1' && readEnv({}).port === 8787 && readEnv({ PORT: '9150' }).port === 9150, 'on this computer: 127.0.0.1, port 8787 unless PORT says otherwise');
  check(readEnv({ HOTEL_RULES: 'pending', ALLOWED_ORIGINS: 'http://127.0.0.1:9151,http://localhost:9152' }).rules === 'pending'
    && readEnv({ HOTEL_RULES: 'pending' }).rules === 'today' && readEnv({ HOTEL_RULES: 'pending', ALLOWED_ORIGINS: 'http://127.0.0.1:9151,https://x.test' }).rules === 'today'
    && readEnv({ NODE_ENV: 'production', HOTEL_RULES: 'pending', ALLOWED_ORIGINS: 'http://127.0.0.1:1' }).rules === 'today',
    'HOTEL_RULES=pending only on a local server whose allowed origins are all localhost/127.0.0.1');
  const req = (xff, remote) => ({ headers: xff == null ? {} : { 'x-forwarded-for': xff }, socket: { remoteAddress: remote } });
  check(clientIp(req('1.2.3.4, 203.0.113.9', '10.0.0.1'), { trustProxy: 'render' }) === '203.0.113.9'
    && clientIp(req('1.2.3.4, 203.0.113.9', '10.0.0.1')) === '10.0.0.1'
    && clientIp(req(null, '::ffff:10.1.2.3'), { trustProxy: 'render' }) === '10.1.2.3',
    'the client address: the right-most X-Forwarded-For entry behind Render, else the socket\'s own (IPv4-in-IPv6 unwrapped)');
  check(normaliseIp('2001:db8:aa:bb:1:2:3:4') === '2001:db8:aa:bb::/64' && normaliseIp('2001:db8:aa:bb::99') === '2001:db8:aa:bb::/64'
    && normaliseIp('2001:db8::1') === '2001:db8:0:0::/64' && normaliseIp('nonsense') === 'unknown',
    'IPv6 addresses are grouped by their /64');
  check(originAllowed('http://127.0.0.1:9151', { devOrigins: true }) && originAllowed('http://localhost:8123', { devOrigins: true })
    && !originAllowed('http://127.0.0.1:9151', { devOrigins: false }) && !originAllowed('http://127.0.0.1.evil.test', { devOrigins: true })
    && !originAllowed('https://evil.test', { devOrigins: true }) && originAllowed('https://mohmdalmalik.github.io'), 'the origin rule (unit)');
}

// --- 2. origins -----------------------------------------------------------------------------------------------------------
console.log('\n2. origins');
const S = await server();
{
  const foreign = await device(S, { origin: 'https://evil.test', hello: false });
  const none = await device(S, { origin: null, hello: false });
  const local = await device(S, { origin: 'http://127.0.0.1:9151', hello: false });
  const lh = await device(S, { origin: 'http://localhost:9152', hello: false });
  const live = await device(S, { origin: 'https://mohmdalmalik.github.io', hello: false });
  check(foreign.status === 403 && none.status === 403, `a foreign page and a missing Origin: HTTP ${foreign.status} / ${none.status}`);
  check([local, lh, live].every(d => d.ws.readyState === WebSocket.OPEN), 'a page on http://127.0.0.1:*, on localhost and the live site: admitted');
  [local, lh, live].forEach(d => d.close());
  const P = await server({ devOrigins: false });
  const p1 = await device(P, { origin: 'http://127.0.0.1:9151', hello: false });
  check(p1.status === 403, `in production a page on 127.0.0.1 is refused (HTTP ${p1.status})`);
}

// --- 3. hello ---------------------------------------------------------------------------------------------------------------
console.log('\n3. hello');
{
  const a = await device(S, { name: 'nora' });
  const w = a.last('welcome');
  check(w && w.v === 1 && typeof w.token === 'string' && w.token.length === 32 && w.place === 'none' && w.server === S.clock.now, `welcome: a new device key (${w?.token?.length} characters), place none, the server's time`);
  const b = await device(S, { name: 'nora', token: a.token });
  check(b.last('welcome')?.token === a.token && await until(() => a.closed?.code === 4001) && a.last('bye')?.why === 'elsewhere', 'the same key again: the same guest; the older socket is told bye elsewhere (4001)');
  b.close();
  const old = await device(S, { name: 'x', hello: false }); old.hello({ v: 0 });
  const newer = await device(S, { name: 'x', hello: false }); newer.hello({ v: 2 });
  const other = await device(S, { name: 'x', hello: false }); other.hello({ data: 'deadbeef' });
  await until(() => old.closed && newer.closed && other.closed);
  check(old.last('bye')?.why === 'update' && old.closed.code === 4004 && newer.last('bye')?.why === 'serverOld' && newer.closed.code === 4005
    && other.last('bye')?.why === 'update' && other.closed.code === 4004, 'an older protocol or other shared data: bye update (4004); a newer one: bye serverOld (4005)');
  const silent = await device(S, { hello: false });
  await S.advance(ONLINE.timing.helloTimeoutMs + 300);
  check(await until(() => silent.closed) && silent.closed.code === 4010, `no hello within ${ONLINE.timing.helloTimeoutMs / 1000} s: closed 4010`);
  const bad = await device(S, { name: 'Guest' });
  check(bad.last('err')?.code === 'badName' && bad.last('welcome')?.place === 'none', 'a name the rules refuse (Guest): err badName, and the guest stays nameless');
  bad.send({ t: 'create' });
  check((await bad.wait('err', 2))?.code === 'badName', '...so it cannot start a table');
  const early = await device(S, { hello: false });
  early.send({ t: 'create', size: 4 });
  early.send({ t: 'ping', at: 5 });
  const pong = await early.wait('pong');
  check(pong?.at === 5 && pong.server === S.clock.now && !early.last('lobby'), 'before a hello only ping is answered (pong with the server\'s time)');
  early.close();
}

// --- 4. codes ---------------------------------------------------------------------------------------------------------------
console.log('\n4. codes and the wrong-code limits');
{
  const nora = await device(S, { name: 'nora' });
  nora.send({ t: 'create', size: 4 });
  await until(() => nora.lobby);
  const code = nora.lobby.code;
  check(/^[BCDFGHJKMNPRSTVWXZ]{5}$/.test(code) && nora.lobby.host === nora.lobby.you && nora.lobby.why === 'needFriend' && nora.lobby.canStart === false,
    `create: code ${code}, you are the host, "needs a friend"`);
  const sam = await device(S, { name: 'sam' });
  sam.send({ t: 'peek', code: code.toLowerCase().split('').join(' ') });
  const pk = await sam.wait('peeked');
  check(pk?.code === code && pk.host === 'nora', 'peek (any case, spaces): the host\'s name');
  sam.send({ t: 'join', code: `https://example.test/Gaming-App/?join=${code}` });
  await until(() => sam.lobby);
  check(sam.lobby?.code === code && nora.lobby.people.length === 2 && nora.lobby.canStart === true, 'join with a whole pasted link; both see 2 people; Start is possible');
  const ivy = await device(S, { name: 'ivy' });
  ivy.send({ t: 'join', code: 'B4' });
  check((await ivy.wait('err'))?.code === 'badCode', 'a code that can\'t be one: err badCode');
  ivy.send({ t: 'peek', code: 'ZZZZZ' });
  check((await ivy.wait('err', 2))?.code === 'notFound', 'an unknown code: err notFound');
  const g = await device(S, { name: 'guesser' });
  for (let i = 0; i < 12; i++) { await sleep(110); g.send({ t: 'join', code: `ZZZZ${'BCDFGHJKMNPR'[i]}` }); await g.wait('err', i + 1); }
  const errs = g.msgs.filter(x => x.m.t === 'err').map(x => x.m);
  check(errs.slice(0, 10).every(e => e.code === 'notFound') && errs[10].code === 'tooMany' && errs[10].retryMs > 0 && errs[11].code === 'tooMany',
    `10 wrong codes a minute from one address, then err tooMany (retry in ${Math.round(errs[10]?.retryMs / 1000)} s)`);
  g.send({ t: 'join', code });
  check((await g.wait('err', 13))?.code === 'tooMany', '...even the right code waits (no guessing through)');
  await S.advance(61000);
  g.send({ t: 'peek', code });
  check((await g.wait('peeked'))?.code === code, 'a minute later it may try again');
  // (paced under the socket's own 10 messages a second, which would close it first)
  for (let i = 0; i < 9; i++) { await sleep(110); g.send({ t: 'peek', code: 'ZZZZZ' }); await g.wait('err', g.count('err') + 1); }
  await S.advance(61000);
  for (let i = 0; i < 10; i++) { await sleep(110); g.send({ t: 'peek', code: 'ZZZZZ' }); await g.wait('err', g.count('err') + 1); }
  const thirty = g.last('err');
  await S.advance(61000);
  await sleep(110);
  g.send({ t: 'peek', code });
  const after = await g.wait('err', g.count('err') + 1);
  check(!g.closed && thirty?.code === 'notFound' && after?.code === 'tooMany' && after.retryMs > 60000,
    `30 in ten minutes is the other limit, peeks counted too: a fresh minute still waits (retry in ${Math.round((after?.retryMs ?? 0) / 1000)} s)`);
  for (const d of [nora, sam, ivy, g]) d.close();
}

// --- 5. the waiting room ------------------------------------------------------------------------------------------------
console.log('\n5. the waiting room');
let matchDevs, matchCode;
{
  const [nora, sam, ivy, ann] = await Promise.all(['nora', 'sam', 'ivy', 'ann_x'].map(n => device(S, { name: n })));
  const code = await table(S, [nora, sam, ivy], 4);
  await until(() => nora.lobby.people.length === 3);
  check(json((await sam.op({ k: 'size', n: 5 }))) === json({ t: 'res', id: 'o1', ok: false, reason: 'notHost' })
    && (await sam.op({ k: 'start' }))?.reason === 'notHost' && (await sam.op({ k: 'lock', on: true }))?.reason === 'notHost',
    'host-only operations from someone else: notHost');
  check((await nora.op({ k: 'size', n: 6 }))?.ok && nora.lobby.size === 6 && (await nora.op({ k: 'size', n: 4 }))?.ok, 'size 6, back to 4');
  await nora.op({ k: 'lock', on: true });
  ann.send({ t: 'join', code });
  check((await ann.wait('err'))?.code === 'locked' && sam.lobby.locked === true, 'locked: a new guest gets err locked');
  await nora.op({ k: 'lock', on: false });
  const ivyPid = nora.lobby.people.find(p => p.name === 'ivy').pid;
  check((await nora.op({ k: 'remove', pid: ivyPid }))?.ok && await until(() => ivy.closed) && ivy.last('bye')?.why === 'removed' && ivy.closed.code === 4002,
    'remove: the removed device is told bye removed (4002)');
  const ivy2 = await reopen(S, ivy);
  ivy2.send({ t: 'join', code });
  check((await ivy2.wait('err'))?.code === 'removed' && ivy2.last('welcome')?.place === 'none', '...and the removal sticks (same device key: err removed)');
  ann.send({ t: 'join', code });
  await until(() => nora.lobby.people.length === 3);
  const T = await startMatch(S, [nora, sam, ann], code);
  const views = [nora, sam, ann].map(d => d.view);
  check(T.phase === 'playing' && views.every(v => v.seats === 4 && v.players.length === 4) && new Set(views.map(v => v.seat)).size === 3
    && T.match.botSeats.length === 1 && views.every(v => v.ask?.kind === 'role'), 'start: 3 people in random seats, the 4th seat a bot, each person asked their role');
  check(nora.lobby.phase === 'playing', 'the waiting room says playing');
  const late = await device(S, { name: 'late_x' });
  late.send({ t: 'join', code });
  check((await late.wait('err'))?.code === 'midMatch', 'someone new mid-match: err midMatch');
  matchDevs = [nora, sam, ann]; matchCode = code;
  for (const d of [ivy2, late]) d.close();
}

// --- 6. a match --------------------------------------------------------------------------------------------------------
console.log('\n6. a match: refusals, repeated commands, reconnects');
{
  let [nora, sam, ann] = matchDevs;
  const T = S.rooms.debug.table(matchCode);
  for (const d of matchDevs) await d.do({ k: 'ack', what: 'role' });
  // move on until a person has the turn
  let guard = 0;
  while (guard++ < 400 && !(T.match.ref.stage === 'turn' && T.match.people.includes(T.match.state.activeIndex))) await S.advance(500);
  const seatOf = d => d.view.seat;
  const active = [nora, sam, ann].find(d => seatOf(d) === T.match.state.activeIndex);
  const other = [nora, sam, ann].find(d => d !== active);
  await until(() => active.view.activeSeat === seatOf(active));
  check(!!active, `a person's turn came (${active?.name}, after ${guard} half-seconds)`);
  const r1 = await other.do({ k: 'search' });
  const r2 = await active.do({ k: 'search' }, active.view.turn + 3);
  const r3 = await active.do({ k: 'card', type: 'bandage', card: 'qqqqqqqq' });
  const r4 = await active.do({ k: 'answer', ask: 'q999', value: 1 });
  const engineId = T.match.state.players[seatOf(active)].hand[0].id;
  const r5 = await active.do({ k: 'discard', card: engineId });
  check(r1?.reason === 'notYourTurn' && r2?.reason === 'stale' && r3?.reason === 'notYourCard' && r4?.reason === 'badAsk' && r5?.reason === 'notYourCard',
    `refused: out of turn (${r1?.reason}), an old turn (${r2?.reason}), an unknown card (${r3?.reason}), a wrong question (${r4?.reason}), an engine id (${r5?.reason})`);
  const id = 'same1';
  const evBefore = T.match.state.events.length;
  active.send({ t: 'do', id, turn: active.view.turn, cmd: { k: 'end' } });
  await until(() => active.res(id));
  const evAfter = T.match.state.events.length;
  active.send({ t: 'do', id, turn: active.view.turn, cmd: { k: 'end' } });
  await until(() => active.msgs.filter(x => x.m.t === 'res' && x.m.id === id).length === 2);
  const replies = active.msgs.filter(x => x.m.t === 'res' && x.m.id === id).map(x => x.text);
  check(replies.length === 2 && replies[0] === replies[1] && T.match.state.events.length === evAfter && evAfter > evBefore,
    `the same command id twice: one effect (the turn ended once), the same reply twice (${replies[0]})`);
  // reconnect: a full view and the same seat
  const seat = seatOf(other);
  other.close();
  await until(() => other.closed);
  await S.advance(500);
  const back = await reopen(S, other);
  await until(() => back.view);
  const fresh = back.msgs.find(x => x.m.t === 'view')?.m;
  check(back.last('welcome')?.place === 'match' && fresh?.fresh === true && fresh.view.seat === seat && fresh.events.length > 0 && fresh.events[0].o === 1,
    `a reconnect: place match, a fresh full view from the first event (${fresh?.events.length} events), the same seat`);
  check(nora === back || [nora, sam, ann].filter(d => d !== other).every(d => d.view.players[seat].away === false), 'everyone sees the returning guest back (not Away)');
  const twin = await reopen(S, back);
  check(await until(() => back.closed?.code === 4001) && twin.last('welcome')?.place === 'match', 'the newest socket wins mid-match (4001 to the older one)');
  matchDevs = [nora, sam, ann].map(d => (d === other ? twin : d));
}

// --- 7. the socket's own limits -------------------------------------------------------------------------------------------
console.log('\n7. each socket\'s own limits');
{
  const a = await device(S, { name: 'a_x' }); a.send('{not json'); await until(() => a.closed);
  const b = await device(S, { name: 'b_x' }); b.ws.send(Buffer.from([1, 2, 3]), { binary: true }); await until(() => b.closed);
  const c = await device(S, { name: 'c_x' }); c.send({ t: 'teleport' }); await until(() => c.closed);
  const d = await device(S, { name: 'd_x' }); d.send({ t: 'do', id: 'x'.repeat(13), turn: 1, cmd: { k: 'end' } }); await until(() => d.closed);
  check(a.closed?.code === 1007 && b.closed?.code === 1003 && c.closed?.code === 1003 && d.closed?.code === 1007,
    `bad JSON ${a.closed?.code}, a binary frame ${b.closed?.code}, an unknown type ${c.closed?.code}, a command id over ${ONLINE.limits.doIdMaxChars} characters ${d.closed?.code}`);
  const e = await device(S, { name: 'e_x' });
  for (let i = 0; i < 30; i++) e.send({ t: 'ping', at: i });
  await until(() => e.closed);
  check(e.closed?.code === 1008 && e.count('pong') >= ONLINE.limits.burst - 1 && e.count('pong') < 30, `30 messages at once: ${e.count('pong')} answered, then closed 1008 (10 a second, bursts of ${ONLINE.limits.burst})`);
  const f = await device(S, { name: 'f_x' });
  f.ws.send('x'.repeat(ONLINE.limits.maxPayload + 1000));
  await until(() => f.closed);
  const g = await device(S, { name: 'g_x' });
  check(f.closed?.code === 1009 && g.last('welcome') && (await fetch(`http://127.0.0.1:${S.port}/health`).then(r => r.json())).ok === true,
    `an oversized frame: closed ${f.closed?.code}, and the process keeps serving ("the spike's crash" does not happen)`);
  g.close();
  const H = await server({ heartbeatMs: 150 });
  const live = await device(H, { name: 'live_x' });
  const dead = await device(H, { name: 'dead_x' });
  dead.ws._socket.pause();                          // (it stops reading: no pong goes back)
  await sleep(700);
  check(dead.ws._socket.destroyed || H.wss.clients.size === 1, 'the heartbeat: a socket that stops answering pings is cut');
  check(live.ws.readyState === WebSocket.OPEN, '...one that answers stays');
  live.close();
}

// --- 8. limits that bind ----------------------------------------------------------------------------------------------------
console.log('\n8. limits that bind, and close timers');
{
  const ip = nextIp();
  const open = [];
  for (let i = 0; i < ONLINE.limits.socketsPerIp; i++) open.push(await device(S, { ip, hello: false }));
  const extra = await device(S, { ip, hello: false });
  check(open.every(d => d.ws.readyState === WebSocket.OPEN) && extra.status === 429, `${ONLINE.limits.socketsPerIp} open sockets from one address, the next: HTTP ${extra.status}`);
  open.forEach(d => d.close());
  await sleep(50);
  const ip2 = nextIp();
  let refused = 0, made = 0;
  for (let i = 0; i < ONLINE.limits.newSocketsPerIpPerMin + 2; i++) { const d = await device(S, { ip: ip2, hello: false }); if (d.status === 429) refused++; else { made++; d.close(); await until(() => d.closed); } }
  check(made === ONLINE.limits.newSocketsPerIpPerMin && refused === 2, `${made} new sockets a minute from one address, then HTTP 429`);
  // table creations: 5 a minute per address, 3 per device key, 2 open tables per key
  const ipC = nextIp();
  const makers = [];
  for (let i = 0; i < 6; i++) makers.push(await device(S, { name: `maker${i}`, ip: ipC }));
  for (const m of makers) m.send({ t: 'create', size: 4 });
  await until(() => makers.slice(0, 5).every(m => m.lobby) && makers[5].last('err'));
  check(makers.slice(0, 5).every(m => m.lobby) && makers[5].last('err')?.code === 'busy', '5 new tables a minute from one address, the 6th: err busy');
  const solo = await device(S, { name: 'solo_x' });
  const helpers = await Promise.all([0, 1, 2].map(i => device(S, { name: `help${i}` })));
  const codes = [];
  for (let i = 0; i < 3; i++) {
    solo.send({ t: 'create', size: 4 });
    await until(() => solo.lobby && !codes.includes(solo.lobby.code) || solo.count('err') > i - codes.length + 0 && solo.last('err')?.code === 'busy');
    if (solo.last('err')?.code === 'busy') break;
    codes.push(solo.lobby.code);
    helpers[i].send({ t: 'join', code: solo.lobby.code });
    await until(() => helpers[i].lobby);
    solo.send({ t: 'leave' });
    await S.advance(250);
  }
  check(codes.length === 2 && solo.last('err')?.code === 'busy', `one device key with ${codes.length} tables still open: the next create is err busy`);
  for (const m of [...makers, solo, ...helpers]) m.close();
  const cap = await server({ maxTables: 1 });
  const c1 = await device(cap, { name: 'cap1' }), c2 = await device(cap, { name: 'cap2' });
  c1.send({ t: 'create' }); await until(() => c1.lobby);
  c2.send({ t: 'create' });
  check((await c2.wait('err'))?.code === 'busy', 'the table cap (MAX_TABLES): err busy');
  const shut = await server({ tablesOpen: false });
  const s1 = await device(shut, { name: 'shut1' });
  s1.send({ t: 'create' });
  check((await s1.wait('err'))?.code === 'busy', 'TABLES_OPEN=false: err busy');
  // close timers (the injected clock)
  const W = await server();
  const w1 = await device(W, { name: 'idle_x' });
  w1.send({ t: 'create' }); await until(() => w1.lobby);
  const idleCode = w1.lobby.code;
  await W.advance(ONLINE.timing.idleWaitingCloseMs + 1000);
  check(W.rooms.debug.table(idleCode)?.phase === 'closed' && await until(() => w1.closed) && w1.last('bye')?.why === 'closed' && w1.closed.code === 4003,
    'a waiting room unused for an hour closes (bye closed, 4003)');
  const [e1, e2] = await Promise.all([device(W, { name: 'emp1' }), device(W, { name: 'emp2' })]);
  const emptyCode = await table(W, [e1, e2], 4);
  await startMatch(W, [e1, e2], emptyCode);
  e1.close(); e2.close();
  await until(() => e1.closed && e2.closed);
  await W.advance(ONLINE.timing.emptyMatchCloseMs + 1000);
  check(W.rooms.debug.table(emptyCode)?.phase === 'closed', 'a match with nobody connected for 2 minutes ends without a result and closes');
  // the end, Play again, and an ended table closing
  const [p1, p2] = await Promise.all([device(W, { name: 'pa1' }), device(W, { name: 'pa2' })]);
  const pc = await table(W, [p1, p2], 4);
  const PT = await startMatch(W, [p1, p2], pc);
  const folk = [p1, p2].map((d, i) => person(d, { rng: makeRng(31 + i), seed: 41 + i }));
  for (let g = 0; g < 20000 && !(p1.view?.end && p2.view?.end); g++) await W.advance(250, now => folk.forEach(p => p.step(now)));
  check(!!p1.view?.end && p1.lobby.phase === 'ended' && PT.phase === 'ended', `a whole match over the wire: ${p1.view?.end?.won ?? p1.view?.end?.stopped} at turn ${PT.match.state.turn}; the waiting room says ended`);
  check((await p2.op({ k: 'again' }))?.reason === 'notHost' && (await p1.op({ k: 'again' }))?.ok && p1.lobby.phase === 'waiting' && p2.lobby.phase === 'waiting' && p1.lobby.people.length === 2,
    'Play again (host only): back to the waiting room with the same people and code');
  await p1.op({ k: 'start' });
  await W.advance(ONLINE.timing.startCountdownMs + 300);
  check(PT.phase === 'playing' && PT.match.n === 2 && await until(() => p2.msgs.filter(x => x.m.t === 'view' && x.m.fresh).length >= 2), 'a second match at the same table (fresh views)');
  PT.match.ref.skipToEnd?.(W.clock.now);
}

// --- 9. the build filter ----------------------------------------------------------------------------------------------------
console.log('\n9. render.yaml\'s build filter and the server\'s import graph');
{
  const graph = new Set();
  const visit = file => {
    const rel = path.relative(root, file).split(path.sep).join('/');
    if (graph.has(rel)) return;
    graph.add(rel);
    const src = fs.readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]|^\s*import\s+['"](\.{1,2}\/[^'"]+)['"]/gm)) visit(path.resolve(path.dirname(file), m[1] || m[2]));
    for (const m of src.matchAll(/import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)) visit(path.resolve(path.dirname(file), m[1]));
  };
  visit(path.join(root, 'server/index.js'));
  const yaml = fs.readFileSync(path.join(root, 'render.yaml'), 'utf8');
  const block = yaml.slice(yaml.indexOf('buildFilter:'));
  const pats = [...block.slice(block.indexOf('paths:')).matchAll(/^\s+-\s+['"]?([^'"\s#]+)['"]?/gm)].map(m => m[1]).filter(p => !p.includes('=') && p.includes('/'));
  const toRe = p => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*\*/g, '\u0000').replace(/\*/g, '[^/]*').replace(/\u0000/g, '.*')}$`);
  const res = pats.map(toRe);
  const files = [...graph].filter(f => !f.startsWith('server/node_modules'));
  const uncovered = files.filter(f => !res.some(re => re.test(f)));
  const unused = pats.filter((p, i) => !files.some(f => res[i].test(f)));
  check(files.length > 30 && uncovered.length === 0, `every file the server imports (${files.length}) is in the build filter${uncovered.length ? '; missing: ' + uncovered.join(', ') : ''}`);
  check(unused.length === 0, `...and the filter names nothing the server does not import${unused.length ? ': ' + unused.join(', ') : ''}`);
  check(/region:\s*singapore/.test(yaml) && /plan:\s*free/.test(yaml) && /healthCheckPath:\s*\/health/.test(yaml) && /startCommand:\s*node server\/index\.js/.test(yaml)
    && /NODE_ENV[\s\S]{0,40}production/.test(yaml) && /TRUST_PROXY[\s\S]{0,40}render/.test(yaml) && !/TIME_SCALE|LIMITS_SCALE/.test(yaml),
    'render.yaml: Singapore, the free plan, /health, node server/index.js, production, behind Render\'s proxy, no test switch');
}

// --- scripted people (the same brain a computer guest has, fed only the device's own view) ----------------------------------
function person(c, { rng, seed, delay = [200, 1500], endAfter = 12 }) {
  const P = { state: blankState(), floor: createFloorCopy(hotel, config), received: [], mind: null, seat: null, key: null, plan: null, acts: 0, turn: null, refused: 0, sent: 0 };
  c.listeners.push(m => {
    if (m.t !== 'view') return;
    const key = `${m.view.table?.code}:${m.view.players.map(p => p.id + p.name).join(',')}`;
    const isNew = P.key !== key;
    if (m.fresh) P.received = m.events.filter(e => e.o != null); else P.received.push(...m.events.filter(e => e.o != null));
    applyView(P.state, m.view, P.received, { fresh: !!m.fresh, newMatch: isNew || undefined });
    syncFloor(P.floor, m.view.hotel);
    if (isNew || !P.mind) { P.seat = m.view.seat; P.key = key; P.mind = createBotTable(P.state, P.floor, [{ index: m.view.seat, profile: null }], seed); }
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
  const send = cmd => { const id = `p${c.nextId++}`; P.sent++; c.send({ t: 'do', id, turn: c.view.turn, cmd }); return id; };
  function act() {
    const v = c.view, a = v.ask;
    if (a) {
      switch (a.kind) {
        case 'role': return send({ k: 'ack', what: 'role' });
        case 'meetWhom': return send({ k: 'answer', ask: a.id, value: P.mind.meetWhom(P.seat, a.candidates) });
        case 'meetAct': { const w = a.canAttack ? P.mind.attackWith(P.seat, a.with) : null; return send({ k: 'answer', ask: a.id, value: w && a.weapons.includes(w) ? { attack: w } : 'trade' }); }
        case 'tradeCard': return send({ k: 'answer', ask: a.id, value: P.mind.tradeCard(P.seat, a.with, a.cards) });
        case 'offer': return send({ k: 'answer', ask: a.id, value: !!P.mind.acceptTrade(P.seat, a.from) });
        case 'discard': return send({ k: 'discard', card: P.mind.discard(P.seat, a.cards) });
        default: return null;
      }
    }
    if (v.results.length) {
      const r = v.results[0];
      if ((r.kind === 'trade' || r.kind === 'noTrade') && r.notes?.length) send({ k: 'ack', what: 'notes', lines: r.notes });
      return send({ k: 'ack', what: 'result', id: r.id });
    }
    if (P.turn !== v.turn) { P.turn = v.turn; P.acts = 0; P.refused = 0; }
    P.acts++;
    let x = P.acts > endAfter ? { k: 'end' } : P.mind.nextAction(P.seat);
    if (!x) x = { k: 'end' };
    return send(x.k === 'card' ? { k: 'card', type: x.type, card: x.card, ...(x.target != null ? { target: x.target } : {}) } : { ...x });
  }
  P.step = now => {
    const sit = situation();
    if (!sit) { P.plan = null; return; }
    if (P.plan?.key !== sit) P.plan = { key: sit, at: now + R(delay[0], delay[1]) };
    if (now >= P.plan.at) { P.plan = null; act(); }
  };
  return P;
}

// --- 10. the fuzz -------------------------------------------------------------------------------------------------------------
console.log('\n10. a 5,000-message fuzz');
{
  const F = await server();
  const rng = makeRng(2026);
  const pick = list => list[Math.floor(rng() * list.length)];
  const junkValue = () => pick([null, true, false, 0, -1, 1e308, NaN, 'x', '', 'x'.repeat(300), [], [1, [2, [3]]], {}, { k: 'end' }, { $set: [] }, '__proto__', 'constructor', 4.5]);
  const T_ = ['hello', 'peek', 'create', 'join', 'lobby', 'do', 'say', 'vis', 'leave', 'ping', 'welcome', 'view', 'x', '', null];
  const K = ['move', 'open', 'search', 'job', 'escape', 'end', 'back', 'card', 'trade', 'discard', 'answer', 'ack', 'fly', null];
  const OPS = ['size', 'lock', 'remove', 'start', 'wait', 'again', 'look', 'nuke'];
  function message() {
    const r = rng();
    if (r < 0.08) return pick(['{', '[]', 'null', '1', '"t"', '{"t":', '\u0000\u0001', '{"t":"do","cmd":{"k":"end"}', JSON.stringify({ t: 'ping', at: 1 }).repeat(3)]);
    if (r < 0.12) return Buffer.from([0, 255, 1, 2]);
    const m = { t: pick(T_) };
    const fields = ['v', 'app', 'data', 'token', 'name', 'avatar', 'vis', 'code', 'size', 'wait', 'id', 'op', 'turn', 'cmd', 'about', 'at'];
    for (const f of fields) if (rng() < 0.35) m[f] = junkValue();
    if (m.t === 'do' && rng() < 0.7) m.cmd = { k: pick(K), to: junkValue(), card: junkValue(), type: pick(['bandage', 'knife', 'x', null]), ask: junkValue(), value: junkValue(), what: pick(['role', 'notes', 'result', 'x']), lines: rng() < 0.5 ? ['a', 'b'] : junkValue(), id: junkValue(), target: junkValue() };
    if (m.t === 'do' && rng() < 0.6) { m.id = String(Math.floor(rng() * 1e6)); m.turn = Math.floor(rng() * 5); }
    if (m.t === 'lobby' && rng() < 0.7) { m.id = 'l' + Math.floor(rng() * 1e5); m.op = { k: pick(OPS), n: pick([4, 5, 6, 7, 'x']), on: junkValue(), pid: pick(['u1', 'u2', 'x']), avatar: junkValue() }; }
    if (m.t === 'hello' && rng() < 0.6) Object.assign(m, { v: 1, app: 'v0.12', data: dataHash(), token: null, name: pick(['fuzz_a', 'fuzz_b', 'Guest', '', 'x'.repeat(40)]), avatar: null, vis: 'visible' });
    if ((m.t === 'join' || m.t === 'peek') && rng() < 0.5) m.code = pick(['BKTWM', 'zzzzz', '?join=BCDFG', 'x'.repeat(250)]);
    return JSON.stringify(m);
  }
  let sent = 0, sockets = 0;
  const codes = {};
  const live = [];
  while (sent < 5000) {
    const d = await device(F, { hello: rng() < 0.5, name: `fuzz${sockets % 50}` });
    sockets++;
    live.push(d);
    const n = 1 + Math.floor(rng() * 12);
    for (let i = 0; i < n && sent < 5000; i++) { const msg = message(); if (Buffer.isBuffer(msg)) d.ws.send(msg, { binary: true }); else d.send(msg); sent++; }
    if (live.length > 8) { const old = live.shift(); old.close(); }
    if (sockets % 20 === 0) { await F.advance(250); await sleep(5); }
  }
  await sleep(100);
  for (const d of live) d.close();
  await sleep(100);
  for (const d of [...live]) if (d.closed) codes[d.closed.code] = (codes[d.closed.code] || 0) + 1;
  const health = await fetch(`http://127.0.0.1:${F.port}/health`).then(r => r.json());
  const [n1, n2] = await Promise.all([device(F, { name: 'after1' }), device(F, { name: 'after2' })]);
  const code = await table(F, [n1, n2], 4);
  const T = await startMatch(F, [n1, n2], code);
  check(uncaught === 0 && health.ok && T.phase === 'playing' && n1.view?.ask?.kind === 'role',
    `${sent} fuzzed messages over ${sockets} sockets: nothing stopped the server; a normal table still deals afterwards`);
  check(!F.logs.some(l => /failed|fault/.test(l)), `...and no request or table step failed inside (${F.logs.filter(l => /failed|fault/.test(l)).slice(0, 2).join('; ')})`);
}

// --- 11. the wire scan ----------------------------------------------------------------------------------------------------------
console.log('\n11. the wire scan: 30 matches of 2-3 scripted people and bots (every message, replies included)');
{
  const agg = { matches: 0, ended: 0, msgs: 0, res: 0, bytes: 0, problems: [] };
  for (let batch = 0; batch < 3; batch++) {
    const Wx = await server({ botChat: batch === 1 });
    const tables = [];
    for (let k = 0; k < 10; k++) {
      const n = 2 + ((batch * 10 + k) % 2);
      const devs = await Promise.all(Array.from({ length: n }, (_, i) => device(Wx, { name: `w${k}_${i}` })));
      const code = await table(Wx, devs, 4 + ((batch + k) % 3));
      tables.push({ devs, code });
    }
    for (const t of tables) await t.devs[0].op({ k: 'start' });
    await Wx.advance(ONLINE.timing.startCountdownMs + 300);
    const folk = tables.flatMap((t, k) => t.devs.map((d, i) => person(d, { rng: makeRng(batch * 1000 + k * 10 + i + 1), seed: batch * 100 + k * 10 + i + 1 })));
    const all = tables.flatMap(t => t.devs);
    for (let g = 0; g < 30000 && !all.every(d => d.view?.end); g++) await Wx.advance(250, now => folk.forEach(p => p.step(now)));
    for (const t of tables) {
      agg.matches++;
      const T = Wx.rooms.debug.table(t.code);
      if (t.devs.every(d => d.view?.end)) agg.ended++;
      const M = T.match;
      const ids = new Set(Array.from({ length: M.state.cardSeq }, (_, i) => `c${i + 1}`));
      for (const d of t.devs) {
        let ended = false;
        for (const { m, text } of d.msgs) {
          agg.msgs++; agg.bytes += text.length;
          if (m.t === 'res') {
            agg.res++;
            const extra = Object.keys(m).filter(k => !['t', 'id', 'ok', 'reason', 'result'].includes(k));
            if (extra.length || (m.result && json(Object.keys(m.result)) !== '["rooms"]')) agg.problems.push(`reply ${text.slice(0, 80)}`);
          }
          if (m.t === 'view') ended = !!m.view.end;
          const own = new Set(m.t === 'view' ? m.view.me.inbox.map(e => e.o) : []);
          const walk = (x, p) => {
            if (typeof x === 'string') { if (ids.has(x)) agg.problems.push(`engine id ${x} at ${p}`); return; }
            if (!x || typeof x !== 'object') return;
            if (Array.isArray(x)) { x.forEach((v, i) => walk(v, `${p}[${i}]`)); return; }
            for (const [k, v] of Object.entries(x)) {
              if (k === 'seq' || k === 'seed' || k === 'rng' || k === 'drawPile' || k === 'discardPile' || k === 'deck' || k === 'style') agg.problems.push(`${k} at ${p}`);
              const mine = p.startsWith('view.me') || p.startsWith('view.results') || p.startsWith('view.end') || p.startsWith('own');
              if (['hand', 'knows', 'notes', 'inbox', 'convertedBy', 'roleChangePending'].includes(k) && !mine) agg.problems.push(`${k} at ${p}`);
              if (k === 'possessed' && v === true && !mine && !ended) agg.problems.push(`a role at ${p}`);
              walk(v, `${p}.${k}`);
            }
          };
          if (m.t === 'view') { walk(m.view, 'view'); m.events.forEach((e, i) => walk(e, own.has(e.o) ? `own[${i}]` : `events[${i}]`)); } else walk(m, m.t);
        }
      }
    }
  }
  check(agg.ended === agg.matches && agg.matches === 30, `${agg.ended}/${agg.matches} matches ended`);
  check(agg.problems.length === 0, `${agg.msgs} messages (${agg.res} replies, ${(agg.bytes / 1048576).toFixed(1)} MB): 0 secrets on the wire${agg.problems.length ? ' — ' + agg.problems.slice(0, 3).join('; ') : ''}`);
}

for (const s of servers) await s.close().catch(() => {});
console.log(`\n${failures ? `${failures} FAILED` : 'ALL PROTOCOL CHECKS PASSED'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failures ? 1 : 0);
