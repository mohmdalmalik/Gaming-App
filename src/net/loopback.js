// THE REVIEW LINK'S IN-PAGE SERVER (DESIGN §16): the Co-op server's own brain (src/net/rooms.js, with the referee,
// the rules engine and the bots) running inside this page, reached through a pretend WebSocket. Every message still
// goes through JSON text both ways and through the protocol's checks (src/net/protocol.js), so the Co-op screens and
// src/net/onlineTable.js work exactly as they would against the real server. Two seats on one iPad (yours and sam's)
// sit at the same table; bots hold the rest; today's rules.
//
//   const loop = createLoopback({ rules, people, timeScale })
//     rules      ONLINE_RULES.today (src/data/online.js)
//     people     how many devices this page plays (2 on the review link). The real server counts its per-address
//                limits per device; here every seat shares one pretend address, so those limits are multiplied by it.
//     timeScale  1 for people; 20 with ?pace=fast on localhost (the automatic tests: BUILD-PLAN rule 14)
//   ->
//   loop.WebSocketImpl   a WebSocket class for openCoop's `transport` (any url; the review link uses loopback://hotel)
//   loop.tick(now)       call every ONLINE.timing.tickMs (the page's setInterval): deadlines, bots, countdowns
//   loop.rooms           the in-page rooms.js (tests read rooms.debug)
//   loop.drop(socket?)   tests: cut a socket as a lost network would (close 1006 on the device's side)
//   loop.sockets         the pretend sockets that are open
//
// The pretend socket behaves as the real one does where it matters: it opens, delivers and closes later (never
// inside the caller's own call), in order; a message over ONLINE.limits.maxPayload closes it with 1009, more than
// 10 a second (bursts of 20) with 1008, a message the protocol refuses with 1007 / 1003. Device keys are kept as
// FNV-1a (src/net/dataHash.js): there is nothing to keep secret inside one page.
//
// Not pure (it keeps time and schedules deliveries; BUILD-PLAN rule 7 lists it as an exception). Loaded only by the
// review link (src/ui/menu.js, by a dynamic import), so the live site's other pages never fetch it.
import { hotel } from '../data/hotel.js';
import { config } from '../config.js';
import { ONLINE, ONLINE_RULES } from '../data/online.js';
import { createRooms } from './rooms.js';
import { createMemoryStore } from './store.js';
import { validate, CLOSE } from './protocol.js';
import { fnv1a } from './dataHash.js';
import { cryptoRng } from './rng.js';

// The limits the real server counts per client address (server/index.js multiplies the same ones by LIMITS_SCALE).
const PER_ADDRESS = ['socketsPerIp', 'newSocketsPerIpPerMin', 'createsPerIpPerMin', 'openTablesPerIp', 'wrongCodesPerIpPerMin', 'wrongCodesPerIpPer10Min'];
const encoder = new TextEncoder();
const ABNORMAL = 1006;

export function createLoopback({
  rules = ONLINE_RULES.today, people = 2, timeScale = 1,
  now = () => Date.now(),
  randomBytes = b => globalThis.crypto.getRandomValues(b),
  defer = fn => queueMicrotask(fn),
  log = () => {}, botChat = true,
} = {}) {
  const devices = Math.max(1, Math.floor(people) || 1);
  const limits = { ...ONLINE.limits };
  for (const k of PER_ADDRESS) limits[k] = ONLINE.limits[k] * devices;
  const sockets = new Set();
  let seq = 0;

  const rooms = createRooms({
    // (the server's end of a socket is `end`; its device is end.socket)
    send(end, msg) { if (!end.closed) end.socket._deliver(JSON.stringify(msg)); },
    close(end, code, why) { serverClose(end, code, why); },
    now, random: cryptoRng(randomBytes), randomBytes, store: createMemoryStore(), rules, log,
    hotelData: hotel, cfg: config, hashToken: fnv1a, timeScale, limits, botChat,
  });

  // The server's side lets go: the device hears the close after everything already sent to it.
  function serverClose(end, code = 1000, why = '') {
    if (end.closed) return;
    end.closed = true;
    defer(() => rooms.disconnect(end));
    end.socket._closed(code, String(why || ''));
  }

  class LoopbackSocket {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;

    constructor(url) {
      this.url = String(url ?? '');
      this.readyState = 0;
      this.protocol = '';
      this.extensions = '';
      this.binaryType = 'blob';
      this.bufferedAmount = 0;
      this.onopen = null; this.onmessage = null; this.onclose = null; this.onerror = null;
      this._listeners = { open: new Set(), message: new Set(), close: new Set(), error: new Set() };
      this._end = { id: ++seq, socket: this, closed: false };
      this._tokens = ONLINE.limits.burst;
      this._last = now();
      sockets.add(this);
      defer(() => {
        if (this.readyState !== 0) return;
        rooms.connect(this._end, { ip: 'loopback' });
        this.readyState = 1;
        this._fire('open', { type: 'open' });
      });
    }

    get CONNECTING() { return 0; }
    get OPEN() { return 1; }
    get CLOSING() { return 2; }
    get CLOSED() { return 3; }

    addEventListener(type, fn) { this._listeners[type]?.add(fn); }
    removeEventListener(type, fn) { this._listeners[type]?.delete(fn); }
    _fire(type, event) {
      const handler = this[`on${type}`];
      for (const fn of [...(this._listeners[type] || [])]) { try { fn.call(this, event); } catch (err) { console.error(err); } }
      if (typeof handler === 'function') { try { handler.call(this, event); } catch (err) { console.error(err); } }
    }

    send(data) {
      if (this.readyState === 0) throw new Error('InvalidStateError: the socket is still connecting');
      if (this.readyState !== 1) return;
      const end = this._end;
      const text = typeof data === 'string' ? data : null;
      // (the server's own socket rules, in its order: size, rate, then the protocol's checks)
      defer(() => {
        if (end.closed) return;
        if (text != null && encoder.encode(text).length > ONLINE.limits.maxPayload) return serverClose(end, CLOSE.tooBig, 'too big');
        const t = now();
        this._tokens = Math.min(ONLINE.limits.burst, this._tokens + ((t - this._last) * ONLINE.limits.msgsPerSec) / 1000);
        this._last = t;
        if (this._tokens < 1) return serverClose(end, CLOSE.rate, 'too many messages');
        this._tokens -= 1;
        const v = validate(text);
        if (!v.ok) return serverClose(end, v.close, 'bad message');
        rooms.message(end, v.msg);
      });
    }

    close(code = 1000, reason = '') {
      if (this.readyState >= 2) return;
      const end = this._end;
      this.readyState = 2;
      defer(() => {
        if (!end.closed) { end.closed = true; rooms.disconnect(end); }
        this._finish(code, reason, true);
      });
    }

    // the server sent a message (already JSON text)
    _deliver(text) {
      defer(() => { if (this.readyState === 1) this._fire('message', { type: 'message', data: text }); });
    }
    // the server closed it: what it sent before still arrives first (in order), then the close
    _closed(code, reason) {
      if (this.readyState >= 2 || this._closing) return;
      this._closing = true;
      defer(() => this._finish(code, reason, code !== ABNORMAL));
    }
    _finish(code, reason, wasClean) {
      if (this.readyState === 3) return;
      this.readyState = 3;
      sockets.delete(this);
      this._fire('close', { type: 'close', code, reason, wasClean });
    }
  }

  return {
    WebSocketImpl: LoopbackSocket,
    rooms,
    sockets,
    tick(at = now()) { rooms.tick(at); },
    // Tests: the network under one socket (or all of them) goes away; the device sees close 1006, the server a drop.
    drop(socket = null) {
      for (const s of socket ? [socket] : [...sockets]) {
        if (s.readyState >= 2 || s._closing) continue;
        const end = s._end;
        if (!end.closed) { end.closed = true; defer(() => rooms.disconnect(end)); }
        s._closed(ABNORMAL, '');
      }
    },
  };
}
