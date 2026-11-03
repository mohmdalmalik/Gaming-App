// CO-OP OVER THE WIRE (DESIGN §4.1, §7, §8, §11): `openCoop()` opens one seat's connection to the Co-op server and
// hands the screens the waiting-room calls and, once a match is dealt, the Table interface (the same one Single
// player's LocalTable gives, src/net/localTable.js). Nothing here draws anything: src/ui/coopMenu.js draws the
// waiting room, the match's presenter (P4) draws the match.
//
//   const coop = await openCoop({ server, profile, intent, transport, storage, remember, setUrl, doc, win })
//     server     resolveServer()'s answer (src/net/serverUrl.js): { url } or { comingSoon: true } (-> rejects
//                { code: 'comingSoon' }, the stub's old answer)
//     profile    { username, avatar } (the account's), or null (a peek needs no name)
//     intent     { create: { size } } | { join: { code } } | { resume: true } | { peek: code }
//     transport  the WebSocket class (default: the browser's own; the review link's in-page loopback,
//                src/net/loopback.js; a Node test's `ws`)
//     storage    where the device key (src/net/guestKey.js) and the table record live. Default: localStorage, then
//                sessionStorage, then memory. The review link's second seat passes its own memory storage.
//     remember   keep the table record (ONLINE.storage.table = { code, at }), so a reload within 6 h comes back
//     setUrl     keep ?join=CODE in the address bar while seated (history.replaceState), so a reload goes back
//                (both are off for a loopback:// server: an in-page table cannot outlive the page)
//   ->
//   coop.status    'connecting' | 'live' | 'reconnecting' | 'lost' | 'closed' (src/net/connection.js)
//   coop.lobby     the latest LobbyView (DESIGN §8.4), or null until seated
//   coop.on(kind, fn) -> unsubscribe. kind:
//                  'lobby' (LobbyView) · 'status' (status) · 'error' ({ code, retryMs? }: an `err`, DESIGN §7.2) ·
//                  'peeked' ({ code, host }) · 'match' (coop.table, each time a match is dealt) ·
//                  'bye' ({ why, retryMs? }: elsewhere / removed / closed / update / serverOld / busy end this
//                  connection; restart only says the server restarted, the connection comes back by itself)
//   coop.lobbyOp(op) -> Promise<{ ok, reason? }>  op: {k:'size',n} · {k:'lock',on} · {k:'remove',pid} · {k:'start'} ·
//                  {k:'wait'} · {k:'again'} · {k:'look',avatar}. reason 'offline': it could not be sent (not resent)
//   coop.leave()   leave the table (waiting room: the seat is freed; a match: your guest stays, TP4) and close
//   coop.table     the match's Table (below), from the first view of a match; a new one for each new match
//   coop.restarted true once the server has said `bye restart` (P4 shows its notice once the table is back)
//
// The Table (kind 'online'):
//   table.seat, table.view          my seat; the latest PlayerView (DESIGN §6.1), a new object each time (frozen on
//                                    localhost and in Node, so a screen that writes into it fails loudly in tests)
//   table.received                  every numbered event this device holds for this match, in order (o 1, 2, …):
//                                    what applyView (src/net/viewAsState.js) takes as `received`
//   table.on(fn) -> unsubscribe     fn({ view, events, fresh }) for every new view after the first. events: what
//                                    just happened (numbered events, plus the table's own { type: 'away' | 'back' |
//                                    'left', seat } without an `o`); fresh: after a reconnect, a restore or a gap in
//                                    the message numbers `n` (draw, don't animate)
//   table.send(cmd, { afterView }) -> Promise<{ ok, reason?, result? }>   a command (DESIGN §6.3) as `do` with a fresh
//                                    id and the turn this device believes. Answers and acks are sent again after a
//                                    reconnect and wait for their reply; an act that could not be sent, or whose socket
//                                    died before the reply, gives { ok: false, reason: 'offline' } (the fresh view shows
//                                    what happened). A command the protocol would refuse is never sent: 'unknown'.
//                                    afterView: the server sends its reply, then the views it changed: settle only once
//                                    the view right after the reply has reached the listeners (or the next message is
//                                    not a view, or AFTER_VIEW_MS pass), so the screens read the command's outcome.
//   table.say(id, about?) -> Promise<msg | null>   quick chat (null: cooling down, a bad line, or offline); everyone's
//                                    lines, mine included, arrive through table.onChat(fn) -> unsubscribe.
//                                    table.sayNow(id, about?) is the same, synchronous (the chat screen shows a line, or
//                                    its cooldown, at once); table.chatWait() -> ms still to wait before another line
//   table.clockLeft(now)             seconds left on the clock shown (from view.clock and when it arrived), or null
//   table.leave()                    coop.leave()
//   table.net                        { status, onStatus(fn), lobby, lobbyOp(op), back() } (back: "I'm back", pending R7)
//
// Command ids: 6 random letters for this opening plus a counter (at most 12 characters), so they never repeat for a
// seat over the table's life, across reconnects and reloads (the server answers a repeated id from its stored reply).
import { ONLINE } from '../data/online.js';
import { CHAT } from '../data/chat.js';
import { PROTOCOL, validate } from './protocol.js';
import { dataHash } from './dataHash.js';
import { normaliseCode } from './codes.js';
import { isLocalHost } from './serverUrl.js';
import { cleanMessage } from '../social/chat.js';
import { VERSION } from '../version.js';
import { createConnection, resendable } from './connection.js';
import { guestKey, pickStorage } from './guestKey.js';

const ID_LETTERS = 'abcdefghijkmnpqrstuvwxyz23456789';
const KINDS = ['lobby', 'status', 'error', 'peeked', 'match', 'bye'];
const ENDS_SEAT = new Set(['removed', 'closed']);       // goodbyes after which this device has no table any more
const encoder = new TextEncoder();
const AFTER_VIEW_MS = 150;     // (a reply whose command changed nothing this seat sees is followed by no view)

function deepFreeze(o) {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
}

// The remembered table (DESIGN §11.5), if it is recent: { code, at } or null. A stale or broken record is removed.
export function rememberedTable({ storage, at = Date.now() } = {}) {
  const { storage: s } = pickStorage(storage);
  try {
    const raw = s.getItem(ONLINE.storage.table);
    if (!raw) return null;
    const r = JSON.parse(raw);
    const code = normaliseCode(r?.code);
    if (code && Number.isFinite(r.at) && at - r.at >= 0 && at - r.at < ONLINE.timing.rememberTableMs) return { code, at: r.at };
    s.removeItem(ONLINE.storage.table);
  } catch { /* unreadable: nothing remembered */ }
  return null;
}

export function openCoop({
  server, profile = null, intent = {}, transport = null, storage, remember = true, setUrl = true,
  doc = globalThis.document, win = globalThis.window,
  now = () => performance.now(), wallNow = () => Date.now(),
  randomBytes = b => globalThis.crypto.getRandomValues(b),
  setTimer, clearTimer, random,
} = {}) {
  const url = server?.url;
  if (!url || server?.comingSoon) return Promise.reject({ code: 'comingSoon' });
  intent = intent || {};
  const inPage = /^loopback:/i.test(String(url));
  const anonymous = intent.peek != null;                 // a peek is nobody: no key kept, no seat touched
  const key = guestKey({ storage });
  const keepRecord = !!remember && !inPage && !anonymous;
  const keepUrl = !!setUrl && !inPage && !anonymous && !!win?.history?.replaceState;
  const freezeViews = !win || isLocalHost(win.location);

  const listeners = Object.fromEntries(KINDS.map(k => [k, new Set()]));
  const emit = (kind, x) => {
    for (const fn of [...listeners[kind]]) { try { fn(x); } catch (err) { console.error(`Co-op ${kind} listener failed:`, err); } }
  };

  // --- ids ----------------------------------------------------------------------------------------------------------
  const prefix = (() => {
    const b = new Uint8Array(6);
    try { randomBytes(b); } catch { for (let i = 0; i < 6; i++) b[i] = Math.floor(Math.random() * 256); }
    return [...b].map(x => ID_LETTERS[x % ID_LETTERS.length]).join('');
  })();
  let counter = 0;
  const newId = () => prefix + (++counter).toString(36);

  // --- state ----------------------------------------------------------------------------------------------------------
  let left = false;
  let seated = false;          // a LobbyView has arrived on this opening
  let code = null;             // the table's code once seated
  let rejoining = false;       // a reconnect found us unseated: one `join` to get back
  let lastN = null;            // the last numbered message on this socket
  let gap = false;             // a numbered message went missing: draw the next view fresh
  let matchOver = false;       // the table went back to waiting: the next view is a new match
  const replies = new Map();   // id -> { resolve, kind: 'act' | 'answer' | 'op', afterView }
  const afterView = [];        // replies received, settled once the view that follows them is in (send's afterView)
  let afterTimer = null;

  // --- the wire -------------------------------------------------------------------------------------------------------
  // Send a message the protocol accepts (a malformed one would get this socket closed: never sent).
  function sendChecked(msg) {
    return fits(msg) ? conn.send(msg) : null;
  }
  // (a hello the server would refuse, say a damaged look kept on the device, would close every socket it opens: the
  // look, then the name, is left out instead; the server then gives the default look, or asks for a name)
  const fits = m => { const text = JSON.stringify(m); return validate(text).ok && encoder.encode(text).length <= ONLINE.limits.maxPayload; };
  const helloMsg = () => {
    const h = {
      t: 'hello', v: PROTOCOL, app: VERSION, data: dataHash(), token: anonymous ? null : key.token,
      name: anonymous ? null : (profile?.username ?? null), avatar: anonymous ? null : (profile?.avatar ?? null), vis: 'visible',
    };
    if (!fits(h)) h.avatar = null;
    if (!fits(h)) h.name = null;
    return h;
  };

  function settle(id, value) {
    const r = replies.get(id);
    if (!r) return;
    replies.delete(id);
    r.resolve(value);
  }
  // A reply that waits for the view after it (send's afterView): kept until the next message is handled.
  function settleAfterView(id, value) {
    const r = replies.get(id);
    if (!r) return;
    if (!r.afterView) { settle(id, value); return; }
    replies.delete(id);
    afterView.push(() => r.resolve(value));
    if (afterTimer == null) afterTimer = timer(flushAfterView, AFTER_VIEW_MS);
  }
  function flushAfterView() {
    if (afterTimer != null) { untimer(afterTimer); afterTimer = null; }
    for (const fn of afterView.splice(0)) fn();
  }
  const timer = (fn, ms) => (setTimer ? setTimer(fn, ms) : setTimeout(fn, ms));
  const untimer = h => (clearTimer ? clearTimer(h) : clearTimeout(h));
  // The socket went away: acts and waiting-room requests will not be answered (answers and acks are sent again).
  function dropUnsent({ all = false } = {}) {
    flushAfterView();
    for (const [id, r] of [...replies]) if (all || r.kind !== 'answer') settle(id, { ok: false, reason: 'offline' });
  }

  // --- remembering the table (DESIGN §11.5) ---------------------------------------------------------------------------
  function rememberTable() {
    if (!keepRecord || !code) return;
    try { key.storage.setItem(ONLINE.storage.table, JSON.stringify({ code, at: wallNow() })); } catch { /* kept nowhere */ }
  }
  function forgetTable() {
    if (!keepRecord) return;
    try {
      const raw = key.storage.getItem(ONLINE.storage.table);
      const r = raw ? JSON.parse(raw) : null;
      if (!r || !code || r.code === code) key.storage.removeItem(ONLINE.storage.table);
    } catch { /* nothing to forget */ }
  }
  function urlJoin(on) {
    if (!keepUrl) return;
    try {
      const u = new URL(win.location.href);
      if (on) { if (!code || u.searchParams.get('join') === code) return; u.searchParams.set('join', code); }
      else { if (!u.searchParams.has('join')) return; u.searchParams.delete('join'); }
      win.history.replaceState(win.history.state, '', u.pathname + u.search + u.hash);
    } catch { /* the address bar stays as it is */ }
  }
  function unseat() { forgetTable(); urlJoin(false); }

  // --- what the server says ----------------------------------------------------------------------------------------
  function onMessage(m) {
    if (Number.isInteger(m.n)) {
      if (lastN != null && m.n !== lastN + 1) gap = true;
      lastN = m.n;
    }
    if (afterView.length && m.t !== 'view') flushAfterView();     // (the reply's command changed no view of ours)
    switch (m.t) {
      case 'welcome': return onWelcome(m);
      case 'lobby': return onLobby(m.lobby);
      case 'view': { onView(m); if (afterView.length) flushAfterView(); return undefined; }
      case 'res': return settleAfterView(m.id, reply(m));
      case 'chat': return table?._chat(m.msg);
      case 'peeked': return emit('peeked', { code: m.code, host: m.host ?? '' });
      case 'err': return onErr(m);
      case 'bye': return onBye(m);
      default: return undefined;
    }
  }
  const reply = m => {
    const r = { ok: !!m.ok };
    if (m.reason != null) r.reason = m.reason;
    if (m.result != null) r.result = m.result;
    return r;
  };

  function onWelcome(m) {
    lastN = null;
    if (!anonymous) key.set(m.token);
    if (anonymous) { sendChecked({ t: 'peek', code: String(intent.peek).slice(0, ONLINE.code.inputMax) }); return; }
    // Seated already (a reload, a reconnect, or a table this device never left): the server sends that seat's lobby
    // (and the match) by itself, whatever the intent asked for. A device sits at one table at a time.
    if (m.place !== 'none') return;
    if (seated && code) {                                 // seated before, unseated now: one try to get back
      rejoining = true;
      sendChecked({ t: 'join', code });
      return;
    }
    if (intent.create) sendChecked(Number.isInteger(intent.create.size) ? { t: 'create', size: intent.create.size } : { t: 'create' });
    else if (intent.join) sendChecked({ t: 'join', code: normaliseCode(intent.join.code) ?? String(intent.join.code ?? '').slice(0, ONLINE.code.inputMax) });
    else if (intent.resume) { unseat(); emit('error', { code: 'closed' }); }
  }

  function onLobby(lv) {
    if (!lv || typeof lv !== 'object') return;
    seated = true;
    rejoining = false;
    code = lv.code ?? code;
    coop.lobby = lv;
    if (table && (lv.phase === 'waiting' || lv.phase === 'starting')) matchOver = true;
    rememberTable();
    urlJoin(true);
    emit('lobby', lv);
  }

  function onErr(m) {
    const e = { code: m.code };
    if (Number.isFinite(m.retryMs)) e.retryMs = m.retryMs;
    if (rejoining) {                                     // could not get back to the table: it is gone for us
      rejoining = false;
      const why = m.code === 'removed' ? 'removed' : 'closed';
      unseat();
      conn.close();
      dropUnsent({ all: true });
      emit('bye', { why, rejoin: true });
      return;
    }
    emit('error', e);
  }

  function onBye(m) {
    const b = { why: m.why };
    if (Number.isFinite(m.retryMs)) b.retryMs = m.retryMs;
    if (m.why === 'restart') coop.restarted = true;
    else {
      dropUnsent({ all: true });
      if (ENDS_SEAT.has(m.why)) unseat();
    }
    emit('bye', b);
  }

  function onStatus(s) {
    coop.status = s;
    if (s !== 'live') dropUnsent();
    emit('status', s);
  }

  // --- the match ------------------------------------------------------------------------------------------------------
  let table = null;
  function onView(m) {
    const view = freezeViews ? deepFreeze(m.view) : m.view;
    if (!view || typeof view !== 'object') return;
    const events = Array.isArray(m.events) ? m.events : [];
    const fresh = !!m.fresh || gap;
    const serverFresh = !!m.fresh;
    gap = false;
    if (!table || matchOver || (serverFresh && isNewMatch(table.view, view))) {
      matchOver = false;
      table = makeTable(view, events);
      coop.table = table;
      rememberTable();
      emit('match', table);
      return;
    }
    table._update(view, events, fresh, serverFresh);
  }
  // A fresh view that cannot continue the match this device holds (it missed the table going back to waiting).
  function isNewMatch(old, v) {
    if (!old) return true;
    if (old.seat !== v.seat || old.seats !== v.seats) return true;
    if (v.round < old.round || (v.round === old.round && v.turn < old.turn)) return true;
    return !!old.end && !v.end;
  }

  function makeTable(firstView, firstEvents) {
    const on = new Set();
    const chat = new Set();
    let lastSaid = null;
    const numbered = evs => evs.filter(e => e && Number.isInteger(e.o));
    const t = {
      kind: 'online',
      seat: firstView.seat,
      view: firstView,
      viewAt: now(),
      received: numbered(firstEvents),
      local: undefined,
      on(fn) { on.add(fn); return () => on.delete(fn); },
      send(cmd, { afterView: waitView = false } = {}) {
        const id = newId();
        const msg = { t: 'do', id, turn: Number.isInteger(t.view?.turn) ? t.view.turn : 0, cmd };
        const answer = resendable(msg);
        return new Promise(resolve => {
          if (left || conn.status === 'closed') return resolve({ ok: false, reason: 'offline' });
          replies.set(id, { resolve, kind: answer ? 'answer' : 'act', afterView: !!waitView });
          const sent = sendChecked(msg);
          if (sent === null) settle(id, { ok: false, reason: 'unknown' });
          else if (!sent && !answer) settle(id, { ok: false, reason: 'offline' });
        });
      },
      say(id, about = null) { return Promise.resolve(t.sayNow(id, about)); },
      sayNow(id, about = null) {
        const at = wallNow();
        if (lastSaid != null && at - lastSaid < CHAT.cooldownMs) return null;
        const msg = cleanMessage({ seat: t.seat, id, about, at }, t.view?.seats ?? Infinity, at);
        if (!msg) return null;
        const out = msg.about != null ? { t: 'say', id: msg.id, about: msg.about } : { t: 'say', id: msg.id };
        if (!sendChecked(out)) return null;
        lastSaid = at;
        return msg;
      },
      chatWait() { return lastSaid == null ? 0 : Math.max(0, CHAT.cooldownMs - (wallNow() - lastSaid)); },
      onChat(fn) { chat.add(fn); return () => chat.delete(fn); },
      clockLeft(nowMs = now()) {
        const c = t.view?.clock;
        if (!c || !Number.isFinite(c.leftMs)) return null;
        const ms = c.running ? c.leftMs - (nowMs - t.viewAt) : c.leftMs;
        return Math.max(0, ms) / 1000;
      },
      leave() { coop.leave(); },
      net: {
        get status() { return coop.status; },
        onStatus(fn) { return coop.on('status', fn); },
        get lobby() { return coop.lobby; },
        lobbyOp: op => coop.lobbyOp(op),
        back: () => t.send({ k: 'back' }),
      },
      // (the coop's own calls)
      _update(view, events, fresh, serverFresh) {
        t.view = view;
        t.viewAt = now();
        const evs = numbered(events);
        if (serverFresh) t.received = evs;                       // a fresh view carries the whole stream again
        else {
          const last = t.received.length ? t.received[t.received.length - 1].o : 0;
          for (const e of evs) if (e.o > last) t.received.push(e);
        }
        const change = { view, events, fresh };
        for (const fn of [...on]) { try { fn(change); } catch (err) { console.error('Co-op table listener failed:', err); } }
      },
      _chat(msg) {
        if (!msg || typeof msg !== 'object') return;
        for (const fn of [...chat]) { try { fn(msg); } catch (err) { console.error('Co-op chat listener failed:', err); } }
      },
    };
    return t;
  }

  // --- the coop ----------------------------------------------------------------------------------------------------------
  const coop = {
    status: 'connecting',
    lobby: null,
    table: null,
    restarted: false,
    on(kind, fn) {
      if (!listeners[kind] || typeof fn !== 'function') return () => {};
      listeners[kind].add(fn);
      return () => listeners[kind].delete(fn);
    },
    lobbyOp(op = {}) {
      return new Promise(resolve => {
        if (left || conn.status === 'closed') return resolve({ ok: false, reason: 'offline' });
        const id = newId();
        replies.set(id, { resolve, kind: 'op' });
        const sent = sendChecked({ t: 'lobby', id, op });
        if (sent === null) settle(id, { ok: false, reason: 'unknown' });
        else if (!sent) settle(id, { ok: false, reason: 'offline' });
      });
    },
    leave() {
      if (left) return;
      left = true;
      if (!anonymous && conn.status === 'live') conn.send({ t: 'leave' });
      unseat();
      conn.close();
      dropUnsent({ all: true });
    },
  };

  let conn;
  try {
    conn = createConnection({
      url, hello: helloMsg, onMessage, onStatus,
      WebSocketImpl: transport || globalThis.WebSocket, doc, win, now,
      ...(setTimer ? { setTimer } : {}), ...(clearTimer ? { clearTimer } : {}), ...(random ? { random } : {}),
    });
  } catch {
    return Promise.reject({ code: 'unreachable' });     // (no WebSocket in this browser)
  }
  coop.status = conn.status;
  return Promise.resolve(coop);
}
