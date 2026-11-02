// THE PAGE'S CONNECTION TO THE CO-OP SERVER (DESIGN §11.2): one WebSocket at a time, a hello on every socket, and
// everything iPad Safari does to a page in the background. A state machine; the WebSocket class, the page's
// `document` and `window`, the clock and the timers are handed in, so connection-check drives it with fakes.
//
//   const c = createConnection({ url, hello, onMessage, onStatus, WebSocketImpl, doc, win, now, setTimer, clearTimer, random })
//     url          the server (wss://…; ws:// on localhost; loopback://… for the in-page review link)
//     hello()      the hello message to send first on every new socket (its `vis` is filled in here)
//     onMessage(m) every message from the server, parsed (welcome, lobby, view, res, chat, err, bye, peeked, pong)
//     onStatus(s)  the status changed
//   c.send(msg) -> true when written to a live socket now. Answers and acknowledgements (`do` with cmd.k 'answer'
//                  or 'ack') are also kept until their `res` arrives and are sent again, once, after each reconnect
//                  (they are safe to repeat: the server answers a repeated id from its stored reply). Acts are never
//                  sent again: after a drop the player sees the fresh view and taps again if needed.
//   c.close()      leave: stop for good (status 'closed')
//   c.status       'connecting' | 'live' | 'reconnecting' | 'lost' | 'closed'
//
// The states:
//   connecting    the first socket is being opened (later tries keep the status reconnecting or lost)
//   live          `welcome` arrived. No message for 25 s while visible: ping; no answer within 3 s: the socket is a
//                 zombie (Safari keeps sockets that look open and are dead) and is replaced
//   reconnecting  the socket closed, failed, missed a ping, or the server said `bye restart`. A NEW socket every
//                 try (the old one's handlers removed): at once if the page is visible, then 0.5, 1, 2, 4, 8 and
//                 10 s (each ±25%, never over 10 s), then every 10 s for as long as the table lives (no retry
//                 budget: iOS 18 dropped a library's reconnects for good after its budget ran out). After `bye
//                 restart` the first try waits its retryMs. A try that has not reached `welcome` in 10 s is dropped.
//   lost          20 s without being live: the same retries go on; the page shows "Still reconnecting…"
//   closed        `bye` elsewhere / removed / closed / update / serverOld / busy (or their close codes), or close()
//
// Page events: hidden -> `vis hidden`; visible, pageshow (Safari's back/forward cache sends no visibilitychange),
// online, focus -> if live, a ping (and a new socket without an answer in 3 s), else a try at once (a try under 3 s
// old is given its chance) and `vis visible` once live. pagehide -> `vis hidden` and the socket closed (1001; a
// browser only lets a page use 1000, so it falls back to that), and a new one on the way back.
import { ONLINE } from '../data/online.js';
import { BYE, CLOSE } from './protocol.js';

const T = ONLINE.timing;
const FIRST_RETRY_MS = 500;
// The goodbyes after which this connection stops (the screens show the matching card).
const FINAL = new Set(['elsewhere', 'removed', 'closed', 'update', 'serverOld', 'busy']);
const FINAL_BY_CODE = new Map(Object.entries(BYE).filter(([why]) => FINAL.has(why)).map(([why, code]) => [code, why]));
const PENDING_KEPT = 64;
const OPEN = 1;

// Safe to send again after a reconnect: answers and acknowledgements (idempotent by ask id and result id).
export const resendable = msg => !!msg && msg.t === 'do' && !!msg.cmd && (msg.cmd.k === 'answer' || msg.cmd.k === 'ack');

// How long to wait before try number `attempt` (0 = the first try after a drop).
export function retryDelay(attempt, { visible = true, random = Math.random } = {}) {
  if (attempt <= 0 && visible) return 0;
  const base = Math.min(T.retryCapMs, FIRST_RETRY_MS * 2 ** Math.max(0, attempt - 1));
  return Math.round(Math.min(T.retryCapMs, base * (0.75 + 0.5 * random())));
}

export function createConnection({
  url, hello, onMessage = () => {}, onStatus = () => {},
  WebSocketImpl = globalThis.WebSocket, doc = globalThis.document, win = globalThis.window,
  now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout, random = Math.random,
} = {}) {
  if (typeof WebSocketImpl !== 'function') throw new Error('createConnection needs a WebSocket');
  let status = 'connecting';
  let ws = null;              // the socket in use
  let wsLive = false;         // `welcome` arrived on it
  let wsStartedAt = 0;
  let attempt = 0;            // tries since the last time live
  let restartWait = null;     // after `bye restart`: the first try waits this long
  const timers = { retry: null, lost: null, silence: null, ping: null, connect: null };
  const pending = new Map();  // id -> answer or ack not yet answered

  const ended = () => status === 'closed' || status === 'closing';
  const visible = () => (doc?.visibilityState ?? 'visible') !== 'hidden';
  const stop = name => { if (timers[name] != null) { try { clearTimer(timers[name]); } catch { /* gone */ } timers[name] = null; } };
  const later = (name, ms, fn) => { stop(name); timers[name] = setTimer(() => { timers[name] = null; fn(); }, ms); };
  const safely = (fn, ...a) => { try { fn(...a); } catch (err) { console.error('connection listener failed:', err); } };

  function setStatus(s) {
    if (status === s) return;
    status = s;
    safely(onStatus, s);
  }
  function write(s, msg) {
    if (!s || s.readyState !== OPEN) return false;
    try { s.send(JSON.stringify(msg)); return true; } catch { return false; }
  }
  // Close a socket quietly. A page may only use 1000 or 3000-4999 (1001 throws), so fall back to 1000.
  function shut(s, code = 1000, reason = '') {
    try { s.close(code, reason); } catch { try { s.close(1000, reason); } catch { /* already gone */ } }
  }
  // Let go of the socket in use: its handlers removed first, so nothing it does later reaches us.
  function drop(code = 1000, reason = '') {
    const s = ws;
    ws = null; wsLive = false;
    stop('connect'); stop('ping'); stop('silence');
    if (!s) return;
    s.onopen = null; s.onmessage = null; s.onclose = null; s.onerror = null;
    if (s.readyState === 0 || s.readyState === OPEN) shut(s, code, reason);
  }

  function connect() {
    if (ended()) return;
    stop('retry');
    drop();
    let s;
    try { s = new WebSocketImpl(url); } catch { return failed(); }
    ws = s; wsLive = false; wsStartedAt = now();
    s.onopen = () => { if (ws === s) write(s, { ...(typeof hello === 'function' ? hello() : hello), vis: visible() ? 'visible' : 'hidden' }); };
    s.onmessage = e => { if (ws === s) receive(e?.data); };
    s.onclose = e => { if (ws === s) failed(e?.code); };
    s.onerror = () => { if (ws === s) failed(); };
    later('connect', T.retryCapMs, () => { if (ws === s && !wsLive) failed(); });
  }

  // The socket in use closed, failed or went silent: try again (or stop, for a final goodbye's close code).
  function failed(code) {
    drop();
    if (ended()) return;
    const why = FINAL_BY_CODE.get(code);
    if (why) { finish(); safely(onMessage, { t: 'bye', why }); setStatus('closed'); return; }
    notLive();
    scheduleRetry();
  }
  function notLive() {
    if (status === 'live' || status === 'connecting') setStatus('reconnecting');
    if (timers.lost == null && status !== 'lost') later('lost', T.lostCardMs, () => { if (status === 'reconnecting' || status === 'connecting') setStatus('lost'); });
  }
  function scheduleRetry() {
    if (ended() || timers.retry != null) return;
    let ms;
    if (restartWait != null) { ms = restartWait; restartWait = null; attempt = Math.max(attempt, 1); }
    else ms = retryDelay(attempt++, { visible: visible(), random });
    later('retry', ms, connect);
  }

  function receive(data) {
    let m;
    try { m = JSON.parse(data); } catch { return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    stop('ping');                                   // anything at all proves the socket is alive
    if (wsLive) armSilence();
    switch (m.t) {
      case 'welcome': {
        wsLive = true; attempt = 0;
        stop('connect'); stop('lost');
        armSilence();
        const again = [...pending.values()];      // (taken first: what the welcome's own handler sends goes once)
        setStatus('live');
        safely(onMessage, m);
        // then the unanswered answers and acks, once each (after the page's own reply to welcome, e.g. a rejoin)
        for (const msg of again) if (ws && wsLive && pending.get(msg.id) === msg) write(ws, msg);
        return;
      }
      case 'res':
        pending.delete(m.id);
        break;
      case 'bye':
        if (m.why === 'restart') {
          restartWait = Number.isFinite(m.retryMs) && m.retryMs >= 0 ? m.retryMs : T.restartRetryMs;
          safely(onMessage, m);
          failed();
          return;
        }
        if (FINAL.has(m.why)) { finish(); safely(onMessage, m); setStatus('closed'); return; }
        break;
      case 'err':
        // refused before welcome (too many hellos): this socket is no use; try again when the server says
        if (!wsLive && m.code === 'tooMany') {
          if (Number.isFinite(m.retryMs)) restartWait = Math.max(0, m.retryMs);
          safely(onMessage, m);
          failed();
          return;
        }
        break;
      default: break;
    }
    safely(onMessage, m);
  }

  function armSilence() {
    later('silence', T.liveSilenceMs, () => { if (status === 'live' && visible()) ping(); });
  }
  function ping() {
    if (!ws || !wsLive || timers.ping != null) return;
    write(ws, { t: 'ping', at: now() });
    later('ping', T.pingCheckMs, () => { if (!ended()) failed(); });
  }

  // The page came back (visible, pageshow, online, focus).
  function wake() {
    if (ended()) return;
    if (ws && wsLive) { ping(); return; }
    if (ws && !wsLive && now() - wsStartedAt < T.pingCheckMs) return;     // a try just begun: give it its chance
    connect();
  }

  // --- the page's events ----------------------------------------------------------------------------------------------
  const onVisibility = () => {
    if (visible()) { if (ws && wsLive) write(ws, { t: 'vis', v: 'visible' }); wake(); }
    else if (ws && wsLive) write(ws, { t: 'vis', v: 'hidden' });
  };
  const onWake = () => wake();
  const onPageHide = () => {
    if (ended()) return;
    if (ws && wsLive) write(ws, { t: 'vis', v: 'hidden' });
    drop(CLOSE.pageHide, 'pagehide');
    stop('retry');
    notLive();
    if (visible()) scheduleRetry();                // (normally hidden: the next pageshow or visibilitychange tries)
  };
  const listening = [
    [doc, 'visibilitychange', onVisibility],
    [win, 'pageshow', onWake], [win, 'online', onWake], [win, 'focus', onWake],
    [win, 'pagehide', onPageHide],
  ].filter(([target]) => target && typeof target.addEventListener === 'function');
  for (const [target, type, fn] of listening) target.addEventListener(type, fn);

  function finish(code = 1000) {
    for (const name of Object.keys(timers)) stop(name);
    for (const [target, type, fn] of listening) { try { target.removeEventListener(type, fn); } catch { /* gone */ } }
    listening.length = 0;
    pending.clear();
    drop(code);
    if (status !== 'closed') status = 'closing';     // (setStatus('closed') follows and tells the page)
  }

  const conn = {
    get status() { return status === 'closing' ? 'closed' : status; },
    send(msg) {
      if (ended() || !msg) return false;
      if (resendable(msg) && msg.id != null) {
        pending.delete(msg.id);
        pending.set(msg.id, msg);
        while (pending.size > PENDING_KEPT) pending.delete(pending.keys().next().value);
      }
      return ws && wsLive ? write(ws, msg) : false;
    },
    close() {
      if (status === 'closed') return;
      finish(1000);
      setStatus('closed');
    },
  };

  later('lost', T.lostCardMs, () => { if (status === 'connecting' || status === 'reconnecting') setStatus('lost'); });
  connect();
  return conn;
}
