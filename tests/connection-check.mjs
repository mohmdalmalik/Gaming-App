// THE PAGE'S CO-OP CONNECTION (DESIGN §11, BUILD-PLAN P2B): src/net/connection.js driven with a fake WebSocket, a
// fake `document`/`window` and a fake clock; then src/net/onlineTable.js (openCoop) with two devices at one table,
// through the in-page loopback (src/net/loopback.js) and through the real server (server/index.js) on a local port.
//   node tests/connection-check.mjs                 (the real-server part needs   npm ci --prefix server   once)
//   node tests/connection-check.mjs --port 9170     the real server on that port (default: any free port)
//
//   1. the state machine: hello first, live on welcome; a zombie socket replaced after a silent ping; pageshow
//      (back/forward cache) without visibilitychange reconnects; three background cycles in a row each reconnect;
//      `bye restart` waits retryMs; `bye elsewhere` (or its close code) stops for good; the backoff (0, 0.5, 1, 2, 4,
//      8 s ±25%, then every 10 s at most) never gives up and says "lost" after 20 s; a try stuck connecting is dropped
//      after 10 s; too many hellos waits as told; old handlers are detached (sockets and page events); acts are not
//      sent again after a reconnect, answers and acks are, once each, with the same id
//   2. the device key (src/net/guestKey.js): storage fallbacks, persistent only in localStorage, bad keys ignored;
//      openCoop against a scripted server; a Leave made offline sent on the next opening; a restored match's welcome
//   3. openCoop through the loopback: create, peek, join by a typed code, host-only refusals, start, both dealt, role
//      acks, refusals that never close the socket, unique command ids, quick chat, a dropped device back at the same
//      seat with a fresh view (the other sees Away then back), newest device wins, the table record and ?join=
//   4. openCoop through the real server on 127.0.0.1: create, join, start, views, one device's socket cut and the
//      device back at the same seat
import { createRequire } from 'node:module';
import { ONLINE, ONLINE_RULES } from '../src/data/online.js';
import { rules } from '../src/data/rules.js';
import { createConnection, retryDelay, resendable } from '../src/net/connection.js';
import { guestKey, memoryStorage, pickStorage, TOKEN_RE } from '../src/net/guestKey.js';
import { openCoop, rememberedTable } from '../src/net/onlineTable.js';
import { createLoopback } from '../src/net/loopback.js';
import { dataHash } from '../src/net/dataHash.js';

let failures = 0;
const t0 = Date.now();
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const json = x => JSON.stringify(x);
const T = ONLINE.timing;
const portArg = process.argv.indexOf('--port');
const PORT = portArg > 0 ? Number(process.argv[portArg + 1]) : 0;

// --- fakes ----------------------------------------------------------------------------------------------------------
function fakeClock(start = 1000) {
  let t = start, ids = 0;
  const q = new Map();
  const clock = {
    now: () => t,
    setTimer(fn, ms) { const h = ++ids; q.set(h, { at: t + Math.max(0, Number(ms) || 0), fn }); return h; },
    clearTimer(h) { q.delete(h); },
    advance(ms) {
      const end = t + ms;
      for (;;) {
        let next = null;
        for (const [h, x] of q) if (x.at <= end && (!next || x.at < next[1].at || (x.at === next[1].at && h < next[0]))) next = [h, x];
        if (!next) break;
        q.delete(next[0]);
        t = next[1].at;
        next[1].fn();
      }
      t = end;
    },
    pending: () => q.size,
  };
  return clock;
}
function eventTarget(extra = {}) {
  const l = new Map();
  return Object.assign(extra, {
    addEventListener(type, fn) { if (!l.has(type)) l.set(type, new Set()); l.get(type).add(fn); },
    removeEventListener(type, fn) { l.get(type)?.delete(fn); },
    fire(type, ev = {}) { for (const fn of [...(l.get(type) || [])]) fn({ type, ...ev }); },
    count() { let n = 0; for (const s of l.values()) n += s.size; return n; },
  });
}
function fakeSocketClass(clock) {
  return class FakeSocket {
    static all = [];
    constructor(url) {
      this.url = url; this.readyState = 0; this.sent = []; this.closeTries = []; this.closedWith = null; this.born = clock.now();
      this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
      FakeSocket.all.push(this);
    }
    send(text) { if (this.readyState !== 1) throw new Error('InvalidStateError'); this.sent.push(JSON.parse(text)); }
    // (a browser lets a page close with 1000 or 3000-4999 only)
    close(code = 1000, reason = '') {
      this.closeTries.push(code);
      if (code !== 1000 && (code < 3000 || code > 4999)) throw new Error('InvalidAccessError');
      this.closedWith = { code, reason }; this.readyState = 3;
    }
    // the test plays the network and the server
    open() { this.readyState = 1; this.onopen?.({ type: 'open' }); }
    recv(m) { this.onmessage?.({ data: typeof m === 'string' ? m : JSON.stringify(m) }); }
    die(code = 1006) { this.readyState = 3; this.onclose?.({ code }); }
    fail() { this.onerror?.({}); }
    get detached() { return this.onopen === null && this.onmessage === null && this.onclose === null && this.onerror === null; }
  };
}
const HELLO = { t: 'hello', v: ONLINE.protocol, app: 'test', data: dataHash(), token: null, name: 'nora', avatar: null, vis: 'visible' };
const WELCOME = { t: 'welcome', v: 1, token: 'k'.repeat(32), server: 1, place: 'none' };

function setup({ random = () => 0.5, hidden = false } = {}) {
  const clock = fakeClock();
  const FS = fakeSocketClass(clock);
  const doc = eventTarget({ visibilityState: hidden ? 'hidden' : 'visible' });
  const win = eventTarget({});
  const statuses = [];
  const msgs = [];
  const conn = createConnection({
    url: 'wss://test.example/', hello: () => ({ ...HELLO }), onMessage: m => msgs.push(m), onStatus: s => statuses.push(s),
    WebSocketImpl: FS, doc, win, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, random,
  });
  const H = {
    conn, clock, FS, doc, win, statuses, msgs,
    get sock() { return FS.all[FS.all.length - 1]; },
    live(s = H.sock) { s.open(); s.recv(WELCOME); return s; },
    hide() { doc.visibilityState = 'hidden'; doc.fire('visibilitychange'); },
    show() { doc.visibilityState = 'visible'; doc.fire('visibilitychange'); },
    sentOf: (s, t) => s.sent.filter(m => m.t === t),
  };
  return H;
}

// --- 1. the state machine ---------------------------------------------------------------------------------------------
console.log('1. the connection, with a fake socket, page and clock');
{
  const H = setup();
  check(H.conn.status === 'connecting' && H.FS.all.length === 1, 'starts connecting with one new socket');
  H.sock.open();
  check(H.sock.sent.length === 1 && H.sock.sent[0].t === 'hello' && H.sock.sent[0].vis === 'visible', 'hello is the first message on the socket, with vis');
  check(H.conn.send({ t: 'say', id: 'greet' }) === false && H.sock.sent.length === 1, 'nothing else is sent before welcome');
  H.sock.recv(WELCOME);
  check(H.conn.status === 'live' && json(H.statuses) === json(['live']), 'live on welcome');
  check(H.msgs[0]?.t === 'welcome', 'the welcome is handed on');
  H.sock.recv('{not json');
  H.sock.recv({ t: 'lobby', n: 1, lobby: {} });
  check(H.msgs.length === 2 && H.msgs[1].t === 'lobby', 'messages handed on in order; bad JSON ignored');
  check(H.conn.send({ t: 'say', id: 'greet' }) === true && H.sentOf(H.sock, 'say').length === 1, 'send writes to a live socket');

  // a message within 25 s keeps it quiet; a pong within 3 s keeps the socket
  H.clock.advance(T.liveSilenceMs - 1000);
  H.sock.recv({ t: 'chat', n: 2, msg: {} });
  H.clock.advance(T.liveSilenceMs - 1000);
  check(!H.sentOf(H.sock, 'ping').length, 'no ping while messages keep coming');
  H.clock.advance(1000);
  check(H.sentOf(H.sock, 'ping').length === 1, 'after 25 s of silence while visible: a ping');
  H.clock.advance(T.pingCheckMs - 500);
  H.sock.recv({ t: 'pong', at: 1, server: 1 });
  H.clock.advance(5000);
  check(H.FS.all.length === 1 && H.conn.status === 'live', 'a pong in time keeps the same socket');

  // the zombie: no answer to the ping
  const zombie = H.sock;
  H.clock.advance(T.liveSilenceMs);
  check(H.sentOf(zombie, 'ping').length === 2, 'silent again: another ping');
  H.clock.advance(T.pingCheckMs);
  check(H.conn.status === 'reconnecting', 'no pong in 3 s: reconnecting');
  check(zombie.detached && zombie.closedWith?.code === 1000, 'the zombie socket: handlers removed, closed');
  check(H.FS.all.length === 2 && H.sock !== zombie, 'a NEW socket at once (the page is visible)');
  H.live();
  check(H.conn.status === 'live' && H.sentOf(H.sock, 'hello').length === 1, 'the new socket says hello and goes live');
  zombie.recv({ t: 'bye', why: 'elsewhere' });
  zombie.die(4001);
  check(H.conn.status === 'live' && !H.msgs.some(m => m.t === 'bye'), 'a late message or close from the old socket changes nothing');
}
{
  console.log('   pageshow from the back/forward cache, without visibilitychange');
  const H = setup();
  const first = H.live();
  H.hide();
  check(H.sentOf(first, 'vis').some(m => m.v === 'hidden'), 'hidden: vis hidden sent');
  H.win.fire('pagehide', { persisted: true });
  check(first.detached && first.closeTries[0] === 1001 && first.closedWith?.code === 1000, 'pagehide: socket closed (1001 tried; a browser allows 1000)');
  check(H.conn.status === 'reconnecting', 'pagehide: reconnecting');
  H.clock.advance(120000);
  check(H.FS.all.length === 1, 'while in the cache (hidden), no new socket');
  H.doc.visibilityState = 'visible';
  H.win.fire('pageshow', { persisted: true });
  check(H.FS.all.length === 2, 'pageshow persisted alone: a new socket at once');
  H.live();
  check(H.conn.status === 'live' && H.sock.sent[0].t === 'hello' && H.sock.sent[0].vis === 'visible', 'back live, hello says visible');
}
{
  console.log('   three background cycles in a row');
  const H = setup();
  H.live();
  let ok = 0;
  for (let i = 0; i < 3; i++) {
    const before = H.sock;
    H.hide();
    if (i === 1) before.die(1006);              // (killed in the background with a close event)
    // (otherwise killed without one: Safari's zombie)
    H.clock.advance(60000);
    H.show();
    H.win.fire('focus'); H.win.fire('pageshow', { persisted: false });
    if (i !== 1) H.clock.advance(T.pingCheckMs);   // the zombie fails its ping
    const s = H.sock;
    if (s.readyState === 0) H.live(s);
    if (H.conn.status === 'live' && s !== before && before.detached) ok++;
  }
  check(ok === 3, `each of 3 background cycles ends live on a new socket (${ok}/3)`);
  const opened = H.FS.all.length;
  H.win.fire('focus'); H.win.fire('pageshow', {}); H.win.fire('online');
  check(H.FS.all.length === opened && H.sentOf(H.sock, 'ping').length === 1, 'focus + pageshow + online together while live: one ping, no new socket');
}
{
  console.log('   bye restart, bye elsewhere and the final close codes');
  const H = setup();
  const s = H.live();
  s.recv({ t: 'bye', why: 'restart', retryMs: 3000 });
  check(s.detached && H.conn.status === 'reconnecting', 'bye restart: the socket let go, reconnecting');
  check(H.msgs.some(m => m.t === 'bye' && m.why === 'restart'), 'the restart goodbye is handed on (for the notice)');
  H.clock.advance(2999);
  check(H.FS.all.length === 1, 'no try before retryMs (3 s)');
  H.clock.advance(1);
  check(H.FS.all.length === 2, 'a new socket at 3 s');
  const s2 = H.live();
  s2.recv({ t: 'bye', why: 'elsewhere' });
  check(H.conn.status === 'closed' && H.msgs[H.msgs.length - 1]?.why === 'elsewhere', 'bye elsewhere: closed, the goodbye handed on');
  check(H.doc.count() === 0 && H.win.count() === 0, 'page listeners removed');
  H.clock.advance(600000);
  H.show(); H.win.fire('pageshow', { persisted: true }); H.win.fire('online'); H.win.fire('focus');
  check(H.FS.all.length === 2 && H.conn.send({ t: 'ping', at: 1 }) === false, 'it never tries again (10 min, every page event)');

  for (const [code, why] of [[4002, 'removed'], [4003, 'closed'], [4004, 'update'], [4005, 'serverOld'], [4009, 'busy']]) {
    const G = setup();
    G.live().die(code);
    G.clock.advance(60000);
    check(G.conn.status === 'closed' && G.FS.all.length === 1 && G.msgs.some(m => m.t === 'bye' && m.why === why), `close ${code} without a bye: closed as "${why}", no retry`);
  }
  for (const code of [1012, 1006, 1007, 1008, 1009, 4010, 1000]) {
    const G = setup();
    G.live().die(code);
    G.clock.advance(1);
    check(G.conn.status === 'reconnecting' && G.FS.all.length === 2, `close ${code}: reconnects`);
  }
}
{
  console.log('   the backoff');
  for (const [name, r] of [['low', () => 0], ['high', () => 0.99999], ['mid', () => 0.5]]) {
    const H = setup({ random: r });
    H.live();
    H.sock.die(1006);
    const born = [];
    let lastLen = 0;
    let lostAt = null;
    for (let ms = 0; ms < 15 * 60000; ms += 50) {
      if (H.FS.all.length > lastLen) {
        for (let i = lastLen; i < H.FS.all.length; i++) born.push(H.FS.all[i].born);
        lastLen = H.FS.all.length;
        const s = H.sock;
        if (s.readyState === 0) s.fail();       // every try fails at once
      }
      if (lostAt == null && H.conn.status === 'lost') lostAt = H.clock.now();
      H.clock.advance(50);
    }
    const gaps = born.slice(2).map((b, i) => b - born[i + 1]);
    const firstGap = born[1] - born[0];
    const expect = [500, 1000, 2000, 4000, 8000];
    const early = expect.every((e, i) => gaps[i] >= Math.floor(e * 0.75) - 50 && gaps[i] <= Math.min(10000, e * 1.25) + 50);
    const later = gaps.slice(5);
    if (name === 'mid') {
      check(firstGap <= 50, `first try at once after the drop (${firstGap} ms)`);
      check(early, `then 0.5, 1, 2, 4, 8 s ±25% (${gaps.slice(0, 5).join(', ')} ms)`);
      check(lostAt != null && lostAt - born[0] >= T.lostCardMs - 50 && lostAt - born[0] <= T.lostCardMs + 50, `"lost" 20 s after the drop (${lostAt - born[0]} ms)`);
      check(H.conn.status === 'lost', 'still lost (not closed) after 15 minutes');
    }
    check(Math.max(...gaps) <= 10000 + 50 && later.every(g => g >= 7500 - 50), `${name} jitter: never more than 10 s apart, at the cap 7.5-10 s (max ${Math.max(...gaps)} ms)`);
    check(born.filter(b => b > H.clock.now() - 60000).length >= 6, `${name} jitter: still trying after 15 minutes (${born.length} tries)`);
  }
  check(retryDelay(0, { visible: true }) === 0 && retryDelay(0, { visible: false, random: () => 0.5 }) === 500, 'retryDelay: at once when visible, 0.5 s when hidden');
  {
    const H = setup({ hidden: true });
    H.live();
    H.sock.die(1006);
    H.clock.advance(300);
    const tooSoon = H.FS.all.length;
    H.clock.advance(400);
    check(tooSoon === 1 && H.FS.all.length === 2, 'hidden: the first try waits about 0.5 s');
  }
  {
    const H = setup();
    const stuck = H.sock;
    H.clock.advance(T.retryCapMs - 1);
    check(H.FS.all.length === 1, 'a socket still connecting is given 10 s');
    H.clock.advance(1);
    check(stuck.detached && H.FS.all.length === 2 && H.conn.status === 'reconnecting', 'then dropped for a new one');
    const s = H.sock; s.open();
    s.recv({ t: 'err', code: 'tooMany', retryMs: 5000 });
    check(s.detached && H.msgs.some(m => m.t === 'err'), 'too many hellos before welcome: that socket let go, the error handed on');
    H.clock.advance(4999);
    const n = H.FS.all.length;
    H.clock.advance(1);
    check(n === 2 && H.FS.all.length === 3, 'the next try waits the retryMs the server gave');
  }
}
{
  console.log('   detached handlers and close()');
  const H = setup();
  const a = H.live();
  check(H.doc.count() === 1 && H.win.count() === 4, 'listening: visibilitychange, pageshow, online, focus, pagehide');
  a.die(1006);
  H.clock.advance(0);
  const b = H.sock;
  check(a.detached && b !== a && !b.detached, 'after a drop the old socket has no handlers, the new one has');
  H.live(b);
  H.conn.close();
  check(H.conn.status === 'closed' && b.detached && b.closedWith?.code === 1000, 'close(): closed with 1000, handlers removed');
  check(H.doc.count() === 0 && H.win.count() === 0, 'close(): page listeners removed');
  H.clock.advance(600000);
  check(H.FS.all.length === 2 && H.clock.pending() === 0, 'close(): no timer left, no new socket');
}
{
  console.log('   what is sent again after a reconnect');
  const H = setup();
  const s1 = H.live();
  const act = { t: 'do', id: 'a1', turn: 3, cmd: { k: 'move', to: 'kitchen' } };
  const answer = { t: 'do', id: 'a2', turn: 3, cmd: { k: 'answer', ask: 'q4', value: 'trade' } };
  const ack = { t: 'do', id: 'a3', turn: 3, cmd: { k: 'ack', what: 'result', id: 'r2' } };
  const op = { t: 'lobby', id: 'a4', op: { k: 'start' } };
  check(resendable(answer) && resendable(ack) && !resendable(act) && !resendable(op), 'answers and acks are resendable; acts and waiting-room ops are not');
  for (const m of [act, answer, ack, op]) H.conn.send(m);
  check(s1.sent.filter(m => m.t === 'do' || m.t === 'lobby').length === 4, 'all four sent while live');
  s1.die(1006);
  H.clock.advance(0);
  const s2 = H.live();
  const again = s2.sent.filter(m => m.t !== 'hello');
  check(s2.sent[0].t === 'hello', 'the hello comes first on the new socket');
  check(json(again.map(m => m.id)) === json(['a2', 'a3']), `after the reconnect: the answer and the ack once each, not the act or the op (${again.map(m => m.id).join(', ')})`);
  check(json(again[0]) === json(answer) && json(again[1]) === json(ack), 'sent again unchanged, with the same ids');
  s2.recv({ t: 'res', id: 'a2', ok: true });
  s2.die(1006);
  H.clock.advance(0);
  const s3 = H.live();
  check(json(s3.sent.filter(m => m.t !== 'hello').map(m => m.id)) === json(['a3']), 'answered ones are not sent again; the unanswered ack is (once)');
  s3.recv({ t: 'res', id: 'a3', ok: true });
  s3.die(1006);
  H.clock.advance(0);
  const s4 = H.sock; s4.open();
  const offline = { t: 'do', id: 'a5', turn: 3, cmd: { k: 'ack', what: 'notes' } };
  check(H.conn.send(offline) === false && !s4.sent.some(m => m.id === 'a5'), 'an ack sent while not live: not written now');
  s4.recv(WELCOME);
  check(json(s4.sent.filter(m => m.t !== 'hello').map(m => m.id)) === json(['a5']), '...but written once after the next welcome');
}

// --- 2. the device key ------------------------------------------------------------------------------------------------
console.log('2. the device key');
{
  const mem = memoryStorage();
  const g = guestKey({ storage: mem });
  check(g.token === null && g.persistent === false, 'a new memory storage: no key yet, not persistent');
  g.set('short');
  check(g.token === null && mem.getItem(ONLINE.storage.guest) === null, 'a value that is not a key is ignored');
  const k = 'Ab3_-'.repeat(6) + 'xy';
  g.set(k);
  check(g.token === k && mem.getItem(ONLINE.storage.guest) === k && guestKey({ storage: mem }).token === k, 'the server\'s key is kept and read back');
  mem.setItem(ONLINE.storage.guest, 'not a key!');
  check(guestKey({ storage: mem }).token === null, 'a damaged key reads as none');
  const broken = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  const gb = guestKey({ storage: broken });
  gb.set(k);
  check(gb.token === k, 'blocked storage: the key is kept for the page, nothing throws');
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const savedS = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  try {
    const ls = memoryStorage();
    Object.defineProperty(globalThis, 'localStorage', { value: ls, configurable: true, writable: true });
    const p = pickStorage();
    check(p.storage === ls && p.persistent === true && guestKey().persistent === true, 'default: localStorage, persistent');
    Object.defineProperty(globalThis, 'localStorage', { get() { throw new Error('SecurityError'); }, configurable: true });
    const ss = memoryStorage();
    Object.defineProperty(globalThis, 'sessionStorage', { value: ss, configurable: true, writable: true });
    const p2 = pickStorage();
    check(p2.storage === ss && p2.persistent === false, 'localStorage blocked: sessionStorage, not persistent');
    Object.defineProperty(globalThis, 'sessionStorage', { value: broken, configurable: true, writable: true });
    const p3 = pickStorage();
    check(p3.storage !== broken && p3.persistent === false && typeof p3.storage.getItem === 'function', 'both blocked: memory, not persistent');
  } finally {
    if (saved) Object.defineProperty(globalThis, 'localStorage', saved); else delete globalThis.localStorage;
    if (savedS) Object.defineProperty(globalThis, 'sessionStorage', savedS); else delete globalThis.sessionStorage;
  }
  check(TOKEN_RE.test('Qm9' + 'a'.repeat(29)) && !TOKEN_RE.test('a b'), 'the key pattern matches the server\'s');
}

// --- 2b. openCoop against a scripted server (the test plays the server) ------------------------------------------------
console.log('2b. openCoop against a scripted server');
{
  const clock = fakeClock();
  const FS = fakeSocketClass(clock);
  const store = memoryStorage();
  const flush = () => new Promise(r => setTimeout(r, 0));
  const coop = await openCoop({
    server: { url: 'ws://127.0.0.1:9171/' }, profile: { username: 'nora', avatar: { junk: 'x'.repeat(5000) } },
    intent: { join: { code: 'bk twm' } }, transport: FS, storage: store, doc: undefined, win: undefined,
    now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, random: () => 0.5,
  });
  const w = watch(coop);
  let sock = FS.all[0];
  sock.open();
  const hello = sock.sent[0];
  check(hello?.t === 'hello' && hello.avatar === null && hello.name === 'nora' && hello.token === null, 'a look too big for a hello is left out (the hello would be refused); the name stays');
  const key = 'Z'.repeat(32);
  sock.recv({ ...WELCOME, token: key });
  check(sock.sent[1]?.t === 'join' && sock.sent[1].code === 'BKTWM' && store.getItem(ONLINE.storage.guest) === key, 'welcome: the key kept, then join with the cleaned code');
  const lobby = (n, phase, extra = {}) => ({ t: 'lobby', n, lobby: { code: 'BKTWM', phase, startsInMs: null, size: 6, locked: false, you: 'u1', host: 'u1', canStart: false, why: 'needFriend', people: [], queued: null, ...extra } });
  sock.recv(lobby(1, 'waiting'));
  check(coop.lobby?.code === 'BKTWM' && w.lobbies.length === 1 && rememberedTable({ storage: store, at: Date.now() })?.code === 'BKTWM', 'a lobby: seated, the table remembered');
  const view = (seat, turn, extra = {}) => ({ seat, seats: 4, round: 1, turn, clock: null, me: { inbox: [] }, end: null, ...extra });
  sock.recv(lobby(2, 'playing'));
  sock.recv({ t: 'view', n: 3, fresh: true, view: view(1, 1), events: [{ o: 1, type: 'deal' }, { o: 2, type: 'x' }] });
  const t1 = coop.table;
  check(t1 && w.matches.length === 1 && t1.seat === 1 && json(t1.received.map(e => e.o)) === '[1,2]', 'the first view: a table, the match event, received from o 1');
  sock.recv({ t: 'view', n: 4, view: view(1, 1), events: [{ o: 3, type: 'y' }, { type: 'away', seat: 2 }] });
  check(w.changes.length === 1 && w.changes[0].fresh === false && w.changes[0].events.length === 2 && json(t1.received.map(e => e.o)) === '[1,2,3]', 'a later view: one change, the table event passed on but kept out of received');
  sock.recv({ t: 'chat', n: 6, msg: { seat: 2, id: 'greet', at: 1 } });           // (n 5 went missing)
  sock.recv({ t: 'view', n: 7, view: view(1, 2, { clock: { seat: 1, kind: 'turn', leftMs: 30000, running: true } }), events: [{ o: 4, type: 'z' }] });
  check(w.changes[1]?.fresh === true && json(t1.received.map(e => e.o)) === '[1,2,3,4]', 'a gap in n: the next view is drawn fresh (its events still appended)');
  check(w.chats.length === 1 && w.chats[0].id === 'greet', 'chat reaches table.onChat');
  clock.advance(5000);
  check(Math.abs(t1.clockLeft() - 25) < 0.001 && t1.clockLeft(clock.now() + 40000) === 0, `clockLeft counts down from the view's arrival (${t1.clockLeft()} s), never below 0`);

  // commands while the socket dies
  const pMove = t1.send({ k: 'move', to: 'hall' });
  const pAnswer = t1.send({ k: 'answer', ask: 'q2', value: 'trade' });
  const pOp = coop.lobbyOp({ k: 'look', avatar: {} });
  const moveMsg = sock.sent.find(m => m.cmd?.k === 'move');
  check(moveMsg?.turn === 2 && moveMsg.id.length <= ONLINE.limits.doIdMaxChars, `an act carries the turn this device believes (${moveMsg?.turn}) and a short id (${moveMsg?.id})`);
  sock.die(1006);
  const moved = await pMove, opped = await pOp;
  check(moved.ok === false && moved.reason === 'offline' && opped.reason === 'offline', 'the socket died: the act and the waiting-room request answer offline');
  check(coop.status === 'reconnecting' && w.statuses.includes('reconnecting'), 'status reconnecting reaches the coop');
  const early = await t1.send({ k: 'search' });
  check(early.ok === false && early.reason === 'offline', 'an act while reconnecting: offline at once');
  let answered = null;
  pAnswer.then(r => { answered = r; });
  clock.advance(0);
  sock = FS.all[FS.all.length - 1];
  sock.open();
  check(sock.sent[0].token === key, 'the new socket says hello with the kept key');
  sock.recv({ ...WELCOME, token: key, place: 'match' });
  const again = sock.sent.filter(m => m.t === 'do');
  check(again.length === 1 && again[0].cmd.k === 'answer' && !sock.sent.some(m => m.t === 'join'), 'back in the match: only the answer is sent again (no join: the server still seats us)');
  sock.recv({ t: 'res', id: again[0].id, ok: true });
  await flush();
  check(answered?.ok === true, 'the answer\'s promise resolves with the reply');
  sock.recv(lobby(1, 'playing'));
  sock.recv({ t: 'view', n: 2, fresh: true, view: view(1, 2), events: [{ o: 1, type: 'deal' }, { o: 2, type: 'x' }, { o: 3, type: 'y' }, { o: 4, type: 'z' }, { o: 5, type: 'w' }] });
  check(coop.table === t1 && w.matches.length === 1 && w.changes[w.changes.length - 1].fresh === true && t1.received.length === 5, 'the fresh view after the reconnect: same table, drawn fresh, received replaced');
  const pRes = t1.send({ k: 'move', to: 'hall' });
  const mv = sock.sent.filter(m => m.cmd?.k === 'move').pop();
  sock.recv({ t: 'res', id: mv.id, ok: true, result: { rooms: ['lobby', 'hall'] } });
  check(json(await pRes) === json({ ok: true, result: { rooms: ['lobby', 'hall'] } }), 'a move\'s reply carries { rooms }');

  // the match ends; Play again; the next match is a new table
  sock.recv({ t: 'view', n: 3, view: view(1, 9, { end: { won: 'humans' } }), events: [] });
  sock.recv(lobby(4, 'waiting'));
  sock.recv(lobby(5, 'starting', { startsInMs: 5000 }));
  sock.recv({ t: 'view', n: 6, fresh: true, view: view(3, 1), events: [{ o: 1, type: 'deal' }] });
  check(w.matches.length === 2 && coop.table !== t1 && coop.table.seat === 3 && coop.table.received.length === 1, 'Play again: the next match is a new table (a second match event, a new seat)');
  const n = w.changes.length;
  sock.recv({ t: 'view', n: 7, view: view(3, 1), events: [{ o: 2, type: 'q' }] });
  check(w.changes.length === n + 1 && t1.view.seat === 1, 'the old table hears nothing more');
  // a reconnect that missed the table going back to waiting: a fresh view that can't continue is a new match too
  const t2 = coop.table;
  sock.die(1006); clock.advance(0); sock = FS.all[FS.all.length - 1]; sock.open();
  sock.recv({ ...WELCOME, token: key, place: 'match' });
  sock.recv({ t: 'view', n: 1, fresh: true, view: view(0, 1), events: [{ o: 1, type: 'deal' }] });
  check(w.matches.length === 3 && coop.table !== t2 && coop.table.seat === 0, 'a fresh view of another match (missed waiting): a new table');
  // (and the waiting room in between is enough on its own, even when the next match looks like a continuation)
  const t3 = coop.table;
  sock.recv(lobby(2, 'waiting'));
  sock.recv({ t: 'view', n: 3, fresh: true, view: view(0, 1), events: [{ o: 1, type: 'deal' }] });
  check(w.matches.length === 4 && coop.table !== t3, 'after the table went back to waiting, the next view is always a new match');

  // restarted server without our table: one try to get back, then the table is gone
  sock.recv({ t: 'bye', why: 'restart', retryMs: 3000 });
  check(coop.restarted === true && w.byes.some(b => b.why === 'restart') && coop.status === 'reconnecting', 'bye restart: coop.restarted, reconnecting');
  clock.advance(3000);
  sock = FS.all[FS.all.length - 1]; sock.open();
  sock.recv({ ...WELCOME, token: key, place: 'none' });
  check(sock.sent.some(m => m.t === 'join' && m.code === 'BKTWM'), 'unseated after the restart: one join to get back');
  sock.recv({ t: 'err', code: 'notFound' });
  check(w.byes[w.byes.length - 1]?.why === 'restartLost' && coop.status === 'closed', 'the table is gone (unknown to the server mid-match): bye restartLost ("The hotel closed for a moment"), status closed');
  check(rememberedTable({ storage: store, at: Date.now() }) === null, 'and the table record is forgotten');
  check(rememberedTable({ storage: (() => { const m = memoryStorage(); m.setItem(ONLINE.storage.table, json({ code: 'BKTWM', at: 0 })); return m; })(), at: ONLINE.timing.rememberTableMs + 1 }) === null, 'a record older than 6 h is not offered');
}

// --- 2c. a Leave the server never heard, and a restore without a goodbye (the review, Nov 2026) --------------------------
console.log('\n2c. a Leave made offline reaches the server next time; a restored match says so without a goodbye');
{
  const clock = fakeClock();
  const FS = fakeSocketClass(clock);
  const store = memoryStorage();
  const key = 'Y'.repeat(32);
  const opts = intent => ({ server: { url: 'ws://127.0.0.1:9171/' }, profile: { username: 'bert', avatar: null }, intent, transport: FS, storage: store,
    doc: undefined, win: undefined, now: clock.now, setTimer: clock.setTimer, clearTimer: clock.clearTimer, random: () => 0.5 });
  const lobbyOf = (code, n, phase = 'playing') => ({ t: 'lobby', n, lobby: { code, phase, startsInMs: null, size: 4, locked: false, you: 'u2', host: 'u1', canStart: false, why: null, people: [], queued: null } });
  const viewOf = (code, n, fresh = true) => ({ t: 'view', n, ...(fresh ? { fresh: true } : {}), view: { seat: 1, seats: 4, round: 1, turn: 1, clock: null, me: { inbox: [] }, end: null, table: { code } }, events: [{ o: 1, type: 'deal' }] });
  // in a match; the connection drops; Leave match on the "Still reconnecting" card
  const c1 = await openCoop(opts({ join: { code: 'BKTWM' } }));
  let sock = FS.all[FS.all.length - 1];
  sock.open(); sock.recv({ ...WELCOME, token: key });
  sock.recv(lobbyOf('BKTWM', 1)); sock.recv(viewOf('BKTWM', 2));
  check(!!c1.table && c1.table.view.table.code === 'BKTWM', 'seated in a match at BKTWM');
  sock.die(1006);
  const sentBefore = FS.all.reduce((k, x) => k + x.sent.filter(m => m.t === 'leave').length, 0);
  c1.leave();
  check(FS.all.reduce((k, x) => k + x.sent.filter(m => m.t === 'leave').length, 0) === sentBefore && JSON.parse(store.getItem(ONLINE.storage.leave) || 'null')?.code === 'BKTWM',
    'Leave while not connected: nothing could be sent, so the Leave is kept on the device (BKTWM)');
  // later: Co-op again, Start a table. The server still seats bert at BKTWM (it never heard the Leave)
  const c2 = await openCoop(opts({ create: { size: 4 } }));
  const w2 = watch(c2);
  sock = FS.all[FS.all.length - 1];
  sock.open(); sock.recv({ ...WELCOME, token: key, place: 'match' });
  const after = sock.sent.slice(1).map(m => m.t);
  check(after[0] === 'leave' && after[1] === 'create', `the next opening finds bert still seated: it sends the kept Leave first, then its own request (${after.join(', ')})`);
  sock.recv(lobbyOf('BKTWM', 1)); sock.recv(viewOf('BKTWM', 2));
  check(c2.lobby === null && !c2.table && w2.matches.length === 0, 'what the server still sends of the left table is not shown');
  sock.recv(lobbyOf('CDFGH', 3, 'waiting'));
  check(c2.lobby?.code === 'CDFGH' && store.getItem(ONLINE.storage.leave) === null, 'the new table is seated, and the kept Leave is gone');
  c2.leave();
  // a match restored after a crash (no bye restart): the welcome says so, and the page hears it as a status
  store.removeItem(ONLINE.storage.leave);
  const c3 = await openCoop(opts({ join: { code: 'GHJKM' } }));
  const w3 = watch(c3);
  sock = FS.all[FS.all.length - 1];
  sock.open(); sock.recv({ ...WELCOME, token: key });
  sock.recv(lobbyOf('GHJKM', 1)); sock.recv(viewOf('GHJKM', 2));
  sock.die(1006); clock.advance(0);
  sock = FS.all[FS.all.length - 1]; sock.open();
  const lives = w3.statuses.filter(x => x === 'live').length;
  sock.recv({ ...WELCOME, token: key, place: 'match', restored: 'match' });
  check(c3.restarted === true && c3.restarts === 1 && w3.statuses.filter(x => x === 'live').length === lives + 2 && !sock.sent.some(m => m.t === 'join' || m.t === 'leave'),
    'welcome restored: coop.restarted (1 restart), and the page is told again once the flag is set (no join, no leave)');
  // a polite restart afterwards: bye restart, then the welcome that says restored: ONE more restart, not two
  sock.recv({ t: 'bye', why: 'restart', retryMs: 3000 });
  clock.advance(3000);
  sock = FS.all[FS.all.length - 1]; sock.open();
  sock.recv({ ...WELCOME, token: key, place: 'match', restored: 'match' });
  check(c3.restarts === 2, `a second restart (bye restart, then its welcome): counted once (${c3.restarts} in all)`);
  c3.leave();
}

// --- helpers for the two-device runs ------------------------------------------------------------------------------------
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(pred, ms = 8000, what = '') {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (pred()) return true; await sleep(10); }
  if (what) console.log(`       (timed out waiting for ${what})`);
  return false;
}
// Everything a coop says, kept for the checks.
function watch(coop) {
  const w = { lobbies: [], statuses: [], errors: [], byes: [], peeked: [], matches: [], changes: [], chats: [] };
  coop.on('lobby', lv => w.lobbies.push(lv));
  coop.on('status', s => w.statuses.push(s));
  coop.on('error', e => w.errors.push(e));
  coop.on('bye', b => w.byes.push(b));
  coop.on('peeked', p => w.peeked.push(p));
  coop.on('match', t => { w.matches.push(t); t.on(c => w.changes.push(c)); t.onChat(m => w.chats.push(m)); });
  return w;
}
// A WebSocket class that keeps what each device sends (and its sockets), around another class.
function recording(Base, extraArgs = []) {
  const C = class extends Base {
    constructor(url) {
      super(url, ...extraArgs);
      this.out = []; this.in = [];
      this.addEventListener('message', e => { try { this.in.push(JSON.parse(String(e.data))); } catch { /* not JSON */ } });
      C.all.push(this);
    }
    send(text) { this.out.push(JSON.parse(text)); return super.send(text); }
  };
  C.all = [];
  return C;
}
function fakeWindow(href) {
  const w = eventTarget({
    location: new URL(href),
    history: {
      state: null, calls: [],
      replaceState(state, _t, url) { w.history.calls.push(url); w.location = new URL(url, w.location.href); },
    },
  });
  return w;
}

// The waiting room and a dealt match, for two devices (nora and sam) and an anonymous peek. `transport` builds a
// WebSocket class; `server` is resolveServer()'s answer; `kick(device)` cuts that device's socket as a network would.
async function twoDevices(label, { server, makeTransport, kick, extraWin = false }) {
  const Tn = makeTransport(), Ts = makeTransport(), Tp = makeTransport();
  const noraStore = memoryStorage(), samStore = memoryStorage();
  const win = extraWin ? fakeWindow('http://127.0.0.1:9170/Gaming-App/?friends=1') : undefined;
  const nora = await openCoop({ server, profile: { username: 'nora', avatar: null }, intent: { create: { size: 4 } }, transport: Tn, storage: noraStore, win, doc: undefined });
  const wn = watch(nora);
  check(nora.status === 'connecting' && nora.lobby === null, `${label}: openCoop resolves at once, connecting`);
  await until(() => nora.lobby, 8000, 'nora\'s lobby');
  const code = nora.lobby?.code;
  check(/^[A-Z]{5}$/.test(code || '') && nora.lobby.people.length === 1 && nora.lobby.host === nora.lobby.you, `${label}: nora created table ${code} and hosts it`);
  check(TOKEN_RE.test(noraStore.getItem(ONLINE.storage.guest) || ''), `${label}: nora's device key kept in her storage`);

  // a peek from a device with no name
  const peek = await openCoop({ server, profile: null, intent: { peek: code.toLowerCase() }, transport: Tp, storage: noraStore, win: undefined, doc: undefined });
  const wp = watch(peek);
  await until(() => wp.peeked.length || wp.errors.length, 8000, 'the peek');
  check(wp.peeked[0]?.host === 'nora' && wp.peeked[0]?.code === code, `${label}: a peek (no name) sees "nora's table"`);
  check(Tp.all[0]?.out[0]?.token === null, `${label}: the peek says hello as nobody (no key), so nora's own seat is untouched`);
  peek.leave();
  await sleep(30);
  check(!wn.byes.length && nora.status === 'live' && nora.lobby.people.length === 1, `${label}: nora still live and seated after the peek`);

  const typed = `${code.slice(0, 2).toLowerCase()}-${code.slice(2).toLowerCase()} `;
  const sam = await openCoop({ server, profile: { username: 'sam', avatar: null }, intent: { join: { code: typed } }, transport: Ts, storage: samStore, win: undefined, doc: undefined, remember: false, setUrl: false });
  const ws = watch(sam);
  await until(() => sam.lobby && nora.lobby.people.length === 2, 8000, 'sam seated');
  check(sam.lobby?.code === code && sam.lobby.people.map(p => p.name).join() === 'nora,sam', `${label}: sam joins by the typed code "${typed.trim()}"`);
  check(noraStore.getItem(ONLINE.storage.guest) !== samStore.getItem(ONLINE.storage.guest), `${label}: two device keys, one per seat`);
  const notHost = await sam.lobbyOp({ k: 'start' });
  check(notHost.ok === false && notHost.reason === 'notHost', `${label}: sam may not start (notHost)`);
  const size = await nora.lobbyOp({ k: 'size', n: 5 });
  await until(() => sam.lobby.size === 5);
  check(size.ok === true && sam.lobby.size === 5, `${label}: the host's size reaches sam`);
  if (win) {
    check(win.location.searchParams.get('join') === code && win.location.searchParams.get('friends') === '1' && win.history.calls.every(u => u.startsWith('/')), `${label}: ?join=${code} in nora's address bar (relative, other parameters kept)`);
    check(rememberedTable({ storage: noraStore })?.code === code, `${label}: nora's table remembered`);
  }

  const start = await nora.lobbyOp({ k: 'start' });
  check(start.ok === true, `${label}: nora starts`);
  await until(() => wn.matches.length && ws.matches.length, 15000, 'the deal');
  const tn = nora.table, ts = sam.table;
  check(tn && ts && tn.kind === 'online' && ts.kind === 'online' && wn.matches[0] === tn, `${label}: both dealt ('match' gives the table)`);
  if (!tn || !ts) return { nora, sam };
  check(tn.seat !== ts.seat && tn.view.seat === tn.seat && ts.view.seat === ts.seat && tn.view.seats === 5, `${label}: two seats of 5 (nora ${tn.seat}, sam ${ts.seat})`);
  check(tn.view.ask?.kind === 'role' && ts.view.ask?.kind === 'role', `${label}: each is asked to see their role`);
  check(tn.received.length > 0 && tn.received[0].o === 1 && tn.received.every((e, i) => e.o === i + 1), `${label}: table.received is the stream from o 1`);
  check(Object.isFrozen(tn.view) && Object.isFrozen(tn.view.me), `${label}: the view is frozen (tests and localhost)`);
  check(tn.local === undefined && typeof tn.net.lobbyOp === 'function' && tn.net.status === 'live', `${label}: table.net, no table.local`);
  const c = tn.clockLeft();
  check(c === null || (typeof c === 'number' && c >= 0), `${label}: clockLeft is seconds or null (${c})`);

  const acks = await Promise.all([tn.send({ k: 'ack', what: 'role' }), ts.send({ k: 'ack', what: 'role' })]);
  check(acks.every(r => r.ok === true), `${label}: both acknowledge their role`);
  const foreign = await ts.send({ k: 'card', type: Object.keys(rules.cards)[0], card: 'zzzzzzzz' });
  check(foreign.ok === false && foreign.reason === 'notYourCard', `${label}: a card sam does not hold: notYourCard`);
  const junk = await ts.send({ k: 'fly', to: 'moon' });
  check(junk.ok === false && junk.reason === 'unknown' && !Ts.all[0].out.some(m => m.cmd?.k === 'fly'), `${label}: a command the protocol refuses is never sent (unknown)`);
  check(sam.status === 'live' && Ts.all.length === 1, `${label}: ...so sam's socket stays open`);

  // quick chat
  const said = await tn.say('greet');
  await until(() => wn.chats.length && ws.chats.length);
  check(said?.id === 'greet' && said.seat === tn.seat, `${label}: nora says "Good evening!"`);
  check(ws.chats[0]?.id === 'greet' && ws.chats[0]?.seat === tn.seat && wn.chats[0]?.seat === tn.seat, `${label}: both hear it (nora's own line comes back too)`);
  check(await tn.say('greet') === null, `${label}: again at once: cooling down (null)`);

  // sam's network goes away
  const samSeat = ts.seat;
  const awaySeen = () => wn.changes.some(ch => ch.events.some(e => e.type === 'away' && e.seat === samSeat));
  const backSeen = () => wn.changes.some(ch => ch.events.some(e => e.type === 'back' && e.seat === samSeat));
  const changesBefore = ws.changes.length;
  await kick(Ts.all[Ts.all.length - 1]);
  await until(() => ws.statuses.includes('reconnecting'), 5000, 'sam reconnecting');
  await until(() => sam.status === 'live' && Ts.all.length >= 2 && ws.changes.slice(changesBefore).some(ch => ch.fresh), 10000, 'sam back');
  const back = ws.changes.slice(changesBefore).find(ch => ch.fresh);
  check(ws.statuses.includes('reconnecting') && sam.status === 'live' && Ts.all.length >= 2, `${label}: sam's socket cut: reconnecting, then live on a new socket`);
  check(Ts.all[1]?.out[0]?.t === 'hello' && Ts.all[1].out[0].token === samStore.getItem(ONLINE.storage.guest), `${label}: the new socket says hello with sam's own key`);
  check(back && back.view.seat === samSeat && sam.table === ts && ts.seat === samSeat, `${label}: sam is back at the same seat (${samSeat}), same table, a fresh view`);
  check(ts.received[0]?.o === 1 && ts.received.every((e, i) => e.o === i + 1), `${label}: sam's events rebuilt from o 1`);
  await until(() => awaySeen() && backSeen(), 5000, 'away/back at nora');
  check(awaySeen() && backSeen(), `${label}: nora saw sam Away, then back (the table's own events)`);
  const after = await ts.send({ k: 'ack', what: 'notes' });
  const lastSock = Ts.all[Ts.all.length - 1];
  const afterId = lastSock.out.filter(m => m.t === 'do').pop()?.id;
  check(typeof after.ok === 'boolean' && afterId && lastSock.in.some(m => m.t === 'res' && m.id === afterId), `${label}: sam's next command, on the new socket, gets its own reply (ok ${after.ok})`);
  const ids = Ts.all.flatMap(s => s.out).filter(m => m.t === 'do' || m.t === 'lobby').map(m => m.id);
  check(new Set(ids).size === ids.length && ids.every(id => id.length <= ONLINE.limits.doIdMaxChars), `${label}: sam's ${ids.length} command ids are all different, across both sockets, at most 12 characters`);

  return { nora, sam, tn, ts, wn, ws, noraStore, samStore, Tn, Ts, code, win, makeTransport };
}

// --- 3. through the loopback ----------------------------------------------------------------------------------------------
console.log('3. openCoop through the in-page loopback (two devices)');
{
  check(await openCoop({ server: { comingSoon: true } }).then(() => false, e => e?.code === 'comingSoon'), 'Coming soon: openCoop rejects { code: comingSoon }');
  const loop = createLoopback({ rules: ONLINE_RULES.today, people: 3, timeScale: 20, botChat: false });
  const ticker = setInterval(() => loop.tick(), 50);
  try {
    // (a ws:// address, so the table record and ?join= are written: a loopback:// one never writes them)
    const r = await twoDevices('loopback', {
      server: { url: 'ws://127.0.0.1:9170/' }, extraWin: true,
      makeTransport: () => recording(loop.WebSocketImpl),
      kick: async s => loop.drop(s),
    });
    if (r.tn) {
      // newest device wins: nora opens the table again on "another device" with the same key
      const T2 = r.makeTransport();
      const nora2 = await openCoop({ server: { url: 'ws://127.0.0.1:9170/' }, profile: { username: 'nora', avatar: null }, intent: { resume: true }, transport: T2, storage: r.noraStore, win: undefined, doc: undefined });
      const w2 = watch(nora2);
      await until(() => r.wn.byes.length && nora2.table, 8000, 'newest wins');
      check(r.wn.byes.length === 1 && r.wn.byes[0]?.why === 'elsewhere' && r.nora.status === 'closed', 'newest wins: the first nora gets bye elsewhere (once) and stops');
      check(r.Tn.all[0].in.some(m => m.t === 'bye' && m.why === 'elsewhere'), '...the goodbye message itself arrives before the close (4001)');
      check(nora2.table && nora2.table.seat === r.tn.seat && w2.matches.length === 1, 'the new one goes straight back to nora\'s seat (resume, match)');
      check(rememberedTable({ storage: r.noraStore })?.code === r.code, 'the table record stays after "elsewhere"');
      const ack2 = await nora2.table.send({ k: 'ack', what: 'notes' });
      const firstIds = new Set(r.Tn.all.flatMap(x => x.out).filter(m => m.id && (m.t === 'do' || m.t === 'lobby')).map(m => m.id));
      const secondIds = T2.all.flatMap(x => x.out).filter(m => m.t === 'do').map(m => m.id);
      check(typeof ack2.ok === 'boolean' && secondIds.length >= 1 && secondIds.every(id => !firstIds.has(id)), `the second device's command ids never repeat the first's (${[...firstIds].length} + ${secondIds.length})`);
      // sam leaves the match: his guest stays (TP4), nora sees "left"
      r.sam.leave();
      await until(() => w2.changes.some(ch => ch.events.some(e => e.type === 'left' && e.seat === r.ts.seat)), 5000, 'left');
      check(w2.changes.some(ch => ch.events.some(e => e.type === 'left' && e.seat === r.ts.seat)) && r.sam.status === 'closed', 'sam leaves: nora sees "left", sam\'s connection closed');
      check(nora2.table.view.players[r.ts.seat].away === true, '...and his guest stays at the table, Away');
      nora2.leave();
      await sleep(20);
      check(rememberedTable({ storage: r.noraStore }) === null, 'nora leaves: the table record is gone');
      check(r.win.location.searchParams.get('join') === null || r.win.location.searchParams.get('join') === r.code, '(the first nora\'s address bar is hers to keep after elsewhere)');
    }

    // the review link's own address: nothing is written
    const store = memoryStorage();
    const win = fakeWindow('http://127.0.0.1:9170/?friends=demo');
    const demo = await openCoop({ server: { url: 'loopback://hotel' }, profile: { username: 'tester', avatar: null }, intent: { create: {} }, transport: loop.WebSocketImpl, storage: store, win, doc: undefined });
    await until(() => demo.lobby);
    check(demo.lobby?.size === 6 && !win.history.calls.length && store.getItem(ONLINE.storage.table) === null, 'loopback:// (the review link): default size 6, no ?join= and no table record');
    demo.leave();

    // resume with nothing to resume
    const lone = await openCoop({ server: { url: 'loopback://hotel' }, profile: { username: 'ivy', avatar: null }, intent: { resume: true }, transport: loop.WebSocketImpl, storage: memoryStorage(), doc: undefined });
    const wl = watch(lone);
    await until(() => wl.errors.length);
    check(wl.errors[0]?.code === 'closed', 'resume with no seat on the server: error closed');
    lone.leave();
    const bad = await openCoop({ server: { url: 'loopback://hotel' }, profile: { username: 'ivy', avatar: null }, intent: { join: { code: 'BKTWQ' } }, transport: loop.WebSocketImpl, storage: memoryStorage(), doc: undefined });
    const wb = watch(bad);
    await until(() => wb.errors.length);
    check(wb.errors[0]?.code === 'badCode' || wb.errors[0]?.code === 'notFound', `a code that is not a table: ${wb.errors[0]?.code}`);
    bad.leave();
    const ops = await bad.lobbyOp({ k: 'start' });
    check(ops.ok === false && ops.reason === 'offline', 'after leave(): requests answer offline at once');

    // the loopback's socket rules match the server's
    const Raw = loop.WebSocketImpl;
    const big = new Raw('loopback://hotel');
    let bigClose = null;
    big.onclose = e => { bigClose = e.code; };
    await until(() => big.readyState === 1);
    big.send(JSON.stringify({ t: 'ping', at: 1, pad: 'x'.repeat(5000) }));
    await until(() => bigClose != null);
    const junkSock = new Raw('loopback://hotel');
    let junkClose = null;
    junkSock.onclose = e => { junkClose = e.code; };
    await until(() => junkSock.readyState === 1);
    junkSock.send('{nope');
    await until(() => junkClose != null);
    const flood = new Raw('loopback://hotel');
    let floodClose = null, pongs = 0;
    flood.onclose = e => { floodClose = e.code; };
    flood.onmessage = e => { if (JSON.parse(e.data).t === 'pong') pongs++; };
    await until(() => flood.readyState === 1);
    for (let i = 0; i < 30; i++) flood.send(json({ t: 'ping', at: i }));
    await until(() => floodClose != null);
    check(bigClose === 1009 && junkClose === 1007 && floodClose === 1008 && pongs >= 19 && pongs <= 21, `loopback socket rules: too big 1009, bad JSON 1007, 30 at once ${pongs} answered then 1008`);
    check(loop.rooms.debug.tables.size >= 2, 'the loopback runs the server\'s own rooms.js');
  } finally {
    clearInterval(ticker);
  }
}

// --- 4. through the real server -----------------------------------------------------------------------------------------
console.log('4. openCoop through the real server on 127.0.0.1 (two devices)');
{
  let WS = null;
  try { WS = createRequire(new URL('../server/package.json', import.meta.url))('ws'); } catch { /* not installed */ }
  if (!WS) {
    check(false, 'the server\'s package (ws) is not installed: run   npm ci --prefix server   once, then this suite again');
  } else {
    const { startServer } = await import('../server/index.js');
    const srv = await startServer({ port: PORT, host: '127.0.0.1', timeScale: 20, botChat: false, log: () => {} });
    const origin = `http://127.0.0.1:${srv.port}`;
    try {
      const r = await twoDevices(`server :${srv.port}`, {
        server: { url: srv.url },
        makeTransport: () => recording(WS, [{ origin }]),
        kick: async s => s.terminate(),               // (the device's side of the socket dies at once: close 1006)
      });
      const h = await fetch(`http://127.0.0.1:${srv.port}/health`).then(x => x.json());
      check(h.ok === true && h.data === dataHash() && h.matches === 1 && h.people >= 2, `/health: 1 match, ${h.people} people, data ${h.data}`);
      r.nora?.leave(); r.sam?.leave();
    } finally {
      await srv.close();
    }
  }
}

console.log(`\n${failures ? `${failures} CONNECTION CHECKS FAILED` : 'ALL CONNECTION CHECKS PASSED'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failures ? 1 : 0);
