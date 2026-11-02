// THE CO-OP SERVER: one small Node program (DESIGN §2, §7-§12, §17). The game itself is the same code the page runs
// (src/net/rooms.js, src/net/referee.js, src/game/*, src/bots/*); this file is only the wire around it:
//   - http with GET /health;
//   - the WebSocket upgrade, refused (HTTP 403) unless the page's Origin is allowed, and (HTTP 429) when one client
//     address opens too many sockets;
//   - every socket: at most ONLINE.limits.maxPayload bytes a message (else 1009), no compression, an 'error' listener
//     (without one, a single oversized frame could stop the whole process), 10 messages a second with bursts of 20
//     (else 1008), every message checked by protocol.validate (else 1007 / 1003);
//   - a heartbeat every 10 s (a socket that missed the last ping is cut), rooms.tick every 250 ms, an event-loop
//     delay monitor, and on SIGTERM a drain: every table saved, every device told to come back, exit within 25 s.
//
// Run it on this computer (no account needed):   PORT=9150 node server/index.js      then   curl 127.0.0.1:9150/health
// Settings (environment):
//   PORT              the port (8787 by default)
//   HOST              the address to listen on (127.0.0.1; 0.0.0.0 when NODE_ENV=production, as Render needs)
//   ALLOWED_ORIGINS   the pages that may connect, comma-separated (https://mohmdalmalik.github.io by default). Unless
//                     NODE_ENV=production, http://localhost:* and http://127.0.0.1:* are allowed too.
//   DATA_DIR          save tables as files in this folder (a disk); without it they are kept in memory only
//   TRUST_PROXY       'render': the client address is the right-most X-Forwarded-For entry (Render's own); else none
//   TABLES_OPEN       'false': nobody can start a new table (err busy). The kill switch.
//   MAX_TABLES        open tables at most (300)
//   NODE_ENV          'production' on Render
//   HOTEL_RULES       'pending': play the PROPOSED rules (src/data/online.js), only on this computer: honoured only
//                     when every ALLOWED_ORIGINS entry is localhost/127.0.0.1 and not in production; it warns
//   TIME_SCALE        TESTS ONLY: a number >= 1 that speeds the game up (bot pace, walks, every clock and timer)
//   LIMITS_SCALE      TESTS ONLY: a number >= 1 that multiplies the per-address and per-device limits
//                     (both are refused when NODE_ENV=production)
// No secrets: the server needs none; these are plain settings (Render: environment values, render.yaml).
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { WebSocketServer, WebSocket } from 'ws';
import { createRooms } from '../src/net/rooms.js';
import { createMemoryStore } from '../src/net/store.js';
import { validate, CLOSE } from '../src/net/protocol.js';
import { cryptoRng } from '../src/net/rng.js';
import { ONLINE, ONLINE_RULES, activeOnlineRules } from '../src/data/online.js';
import { hotel } from '../src/data/hotel.js';
import { config } from '../src/config.js';
import { createFileStore } from './fileStore.js';
import { clientIp } from './clientIp.js';

export const DEFAULT_ORIGIN = 'https://mohmdalmalik.github.io';
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d{1,5})?$/;
const SCALED_LIMITS = ['socketsPerIp', 'newSocketsPerIpPerMin', 'hellosPerTokenPerMin', 'createsPerIpPerMin', 'createsPerTokenPerMin',
  'openTablesPerToken', 'openTablesPerIp', 'wrongCodesPerIpPerMin', 'wrongCodesPerIpPer10Min'];

// The settings from the environment. Throws (with a plain message) on a setting that must not be used.
export function readEnv(env = {}) {
  const production = env.NODE_ENV === 'production';
  const num = (name, dflt) => {
    if (env[name] == null || env[name] === '') return dflt;
    const n = Number(env[name]);
    if (!Number.isFinite(n)) throw new Error(`${name} must be a number (got "${env[name]}")`);
    return n;
  };
  const timeScale = num('TIME_SCALE', 1), limitsScale = num('LIMITS_SCALE', 1);
  for (const [name, v] of [['TIME_SCALE', timeScale], ['LIMITS_SCALE', limitsScale]]) {
    if (env[name] != null && env[name] !== '') {
      if (production) throw new Error(`${name} is for tests only and is refused when NODE_ENV=production`);
      if (!(v >= 1)) throw new Error(`${name} must be a number of at least 1`);
    }
  }
  const explicit = env.ALLOWED_ORIGINS != null && env.ALLOWED_ORIGINS !== '';
  const origins = (explicit ? env.ALLOWED_ORIGINS : DEFAULT_ORIGIN).split(',').map(s => s.trim()).filter(Boolean);
  let rules = 'today';
  const warnings = [];
  if (env.HOTEL_RULES === 'pending') {
    if (!production && explicit && origins.length && origins.every(o => LOCAL_ORIGIN.test(o))) {
      rules = 'pending';
      warnings.push('HOTEL_RULES=pending: this server plays the PROPOSED rules (not approved by the owner). For this computer only.');
    } else {
      warnings.push('HOTEL_RULES=pending ignored: only on a local server whose ALLOWED_ORIGINS are all localhost/127.0.0.1.');
    }
  }
  return {
    production,
    port: num('PORT', 8787),
    host: env.HOST || (production ? '0.0.0.0' : '127.0.0.1'),
    origins,
    devOrigins: !production,
    dataDir: env.DATA_DIR || null,
    trustProxy: env.TRUST_PROXY === 'render' ? 'render' : 'none',
    tablesOpen: env.TABLES_OPEN !== 'false',
    maxTables: num('MAX_TABLES', ONLINE.limits.maxTables),
    rules,
    timeScale,
    limitsScale,
    warnings,
  };
}

export function originAllowed(origin, { origins = [DEFAULT_ORIGIN], devOrigins = false } = {}) {
  if (typeof origin !== 'string' || !origin) return false;
  if (origins.includes(origin)) return true;
  return !!devOrigins && LOCAL_ORIGIN.test(origin);
}

// Start a server. Every option has the value readEnv gives; tests pass their own (port 0: any free port; `now`: an
// injected clock; `autoTick: false`: the test calls srv.tick() itself; `heartbeatMs`: a quicker heartbeat).
export async function startServer({
  port = 8787, host = '127.0.0.1', origins = [DEFAULT_ORIGIN], devOrigins = true, dataDir = null, trustProxy = 'none',
  tablesOpen = true, maxTables = ONLINE.limits.maxTables, rules = 'today', timeScale = 1, limitsScale = 1,
  now = Date.now, log = line => console.log(line), store = null, autoTick = true, tickMs = ONLINE.timing.tickMs,
  heartbeatMs = ONLINE.timing.heartbeatMs, botChat = true, drainMs = ONLINE.timing.drainMs,
} = {}) {
  const limits = { ...ONLINE.limits, maxTables };
  for (const k of SCALED_LIMITS) limits[k] = Math.round(ONLINE.limits[k] * limitsScale);
  const baseStore = store || (dataDir ? createFileStore(dataDir, { log }) : createMemoryStore());
  // (every save timed, for /health: how long the commit rule costs per step)
  const saves = { n: 0, ms: 0, maxMs: 0 };
  const theStore = {
    ...baseStore, kind: baseStore.kind,
    save(id, obj) { const t = performance.now(); baseStore.save(id, obj); const ms = performance.now() - t; saves.n++; saves.ms += ms; if (ms > saves.maxMs) saves.maxMs = ms; },
    load: () => baseStore.load(),
    remove: id => baseStore.remove(id),
  };
  const randomBytes = buf => crypto.randomFillSync(buf);
  const random = cryptoRng(randomBytes);
  const lag = monitorEventLoopDelay({ resolution: 20 });
  lag.enable();
  const stats = { refusedOrigin: 0, refusedBusy: 0, rateClosed: 0, badClosed: 0, sockets: 0, terminated: 0 };

  const rooms = createRooms({
    send(ws, msg) {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (ws.bufferedAmount > limits.sendBufferBytes) { stats.terminated++; ws.terminate(); return; }   // (it reconnects)
      ws.send(JSON.stringify(msg));
    },
    close(ws, code, why) { try { ws.close(code, String(why || '').slice(0, 60)); } catch { ws.terminate(); } },
    now, random, randomBytes, store: theStore,
    rules: rules === 'pending' ? ONLINE_RULES.pending : activeOnlineRules(),
    log, hotelData: hotel, cfg: config,
    hashToken: token => crypto.createHash('sha256').update(token).digest('hex'),
    timeScale, limits, tablesOpen, botChat,
  });

  // Every table saved on a disk comes back before the server listens (DESIGN §10.5).
  rooms.restore(now());

  // Sockets per client address (§7.5): open now, and opened in the last minute.
  const perIp = new Map();
  const ipRec = ip => { let r = perIp.get(ip); if (!r) { r = { open: 0, recent: [] }; perIp.set(ip, r); } return r; };
  let draining = false;

  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    if (req.method === 'GET' && url === '/health') {
      const h = rooms.health(now());
      h.loopP99Ms = Math.round(lag.percentile(99) / 1e6);
      h.rssMB = Math.round(process.memoryUsage().rss / 1048576);
      h.saves = { n: saves.n, meanMs: saves.n ? Math.round((saves.ms / saves.n) * 1000) / 1000 : 0, maxMs: Math.round(saves.maxMs * 10) / 10 };
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(h));
      return;
    }
    res.writeHead(url === '/' ? 200 : 404, { 'content-type': 'text/plain' });
    res.end(url === '/' ? 'Hotel Escape: the Co-op server. /health says how it is.\n' : 'Not found\n');
  });
  server.on('clientError', (err, socket) => { try { socket.destroy(); } catch { /* gone */ } });

  const wss = new WebSocketServer({ noServer: true, maxPayload: limits.maxPayload, perMessageDeflate: false, clientTracking: true });
  const refuse = (socket, status, text) => {
    try { socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { /* gone */ }
    socket.destroy();
  };

  server.on('upgrade', (req, socket, head) => {
    socket.on('error', () => {});
    if (draining) return refuse(socket, 503, 'Service Unavailable');
    if (!originAllowed(req.headers.origin, { origins, devOrigins })) { stats.refusedOrigin++; return refuse(socket, 403, 'Forbidden'); }
    const ip = clientIp(req, { trustProxy });
    const r = ipRec(ip);
    const t = now();
    while (r.recent.length && r.recent[0] <= t - 60000) r.recent.shift();
    if (r.open >= limits.socketsPerIp || r.recent.length >= limits.newSocketsPerIpPerMin) { stats.refusedBusy++; return refuse(socket, 429, 'Too Many Requests'); }
    r.recent.push(t);
    wss.handleUpgrade(req, socket, head, ws => onSocket(ws, ip, r));
  });

  function onSocket(ws, ip, r) {
    r.open++;
    stats.sockets++;
    ws.on('error', () => {});                  // a bad frame, a reset: the socket closes; the server goes on
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });
    let tokens = limits.burst, last = performance.now();
    rooms.connect(ws, { ip });
    ws.on('message', (data, isBinary) => {
      const t = performance.now();
      tokens = Math.min(limits.burst, tokens + ((t - last) * limits.msgsPerSec) / 1000);
      last = t;
      if (tokens < 1) { stats.rateClosed++; ws.close(CLOSE.rate, 'too many messages'); return; }
      tokens -= 1;
      const v = validate(isBinary ? data : data.toString('utf8'));
      if (!v.ok) { stats.badClosed++; ws.close(v.close, 'bad message'); return; }
      rooms.message(ws, v.msg);
    });
    ws.on('close', () => {
      r.open = Math.max(0, r.open - 1);
      if (!r.open && !r.recent.length) perIp.delete(ip);
      rooms.disconnect(ws);
    });
  }

  // The heartbeat (§11.3): a socket that did not answer the last ping is cut (its device reconnects).
  const beat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.alive) { stats.terminated++; ws.terminate(); continue; }
      ws.alive = false;
      try { ws.ping(); } catch { /* closing */ }
    }
    const t = now();
    for (const [ip, r] of perIp) { while (r.recent.length && r.recent[0] <= t - 60000) r.recent.shift(); if (!r.open && !r.recent.length) perIp.delete(ip); }
  }, heartbeatMs);
  beat.unref?.();
  const tick = () => { try { rooms.tick(now()); } catch (e) { log(`tick failed: ${e?.message || e}`); } };
  const ticker = autoTick ? setInterval(tick, tickMs) : null;
  ticker?.unref?.();

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });
  const actualPort = server.address().port;

  let stopped = false;
  function stop() {
    if (stopped) return;
    stopped = true;
    clearInterval(beat);
    if (ticker) clearInterval(ticker);
    lag.disable();
  }

  return {
    port: actualPort,
    url: `ws://${host === '0.0.0.0' ? '127.0.0.1' : host}:${actualPort}`,
    rooms, server, wss, stats, store: theStore, limits,
    tick,
    lag: () => ({ p50: lag.percentile(50) / 1e6, p99: lag.percentile(99) / 1e6, max: lag.max / 1e6 }),
    // SIGTERM (§10.5): no new sockets, every table saved, every device told `bye restart` (come back in 3 s) and its
    // socket closed (1012); resolves once every socket is closed, or after drainMs at the latest.
    async drain() {
      if (draining) return;
      draining = true;
      stop();
      rooms.shutdown(now());
      const deadline = Date.now() + drainMs;
      while (wss.clients.size && Date.now() < deadline) await new Promise(r => setTimeout(r, 50));
      for (const ws of wss.clients) ws.terminate();
      await new Promise(r => server.close(() => r()));
    },
    // Tests: stop at once (no drain, no save).
    async close() {
      stop();
      for (const ws of wss.clients) ws.terminate();
      await new Promise(r => server.close(() => r()));
    },
  };
}

async function main() {
  let cfg;
  try { cfg = readEnv(process.env); } catch (e) { console.error(`Hotel Escape server: ${e.message}`); process.exit(2); }
  for (const w of cfg.warnings) console.warn(`Hotel Escape server: WARNING ${w}`);
  const log = line => console.log(`${new Date().toISOString()} ${line}`);
  // A socket-level error must not stop the server; anything else exits, so the host restarts it and the saved
  // tables come back (§10.4).
  process.on('uncaughtException', err => {
    const socketLevel = /^(ECONNRESET|EPIPE|ECONNABORTED|ETIMEDOUT|ERR_STREAM_DESTROYED|ERR_STREAM_WRITE_AFTER_END|WS_ERR_)/.test(String(err?.code || ''));
    log(`uncaught ${socketLevel ? 'socket ' : ''}error: ${err?.stack || err}`);
    if (!socketLevel) process.exit(1);
  });
  const srv = await startServer({ ...cfg, log });
  log(`Hotel Escape server listening on ${cfg.host}:${srv.port} (rules: ${cfg.rules}; store: ${cfg.dataDir ? 'files in ' + cfg.dataDir : 'memory'}${cfg.timeScale !== 1 ? `; TIME_SCALE ${cfg.timeScale}` : ''}${cfg.limitsScale !== 1 ? `; LIMITS_SCALE ${cfg.limitsScale}` : ''})`);
  let leaving = false;
  const leave = async sig => {
    if (leaving) return;
    leaving = true;
    log(`${sig}: saving every table and asking every device to come back shortly`);
    const hard = setTimeout(() => process.exit(0), ONLINE.timing.drainMs + 1000);
    await srv.drain();
    clearTimeout(hard);
    log('drained, exiting');
    process.exit(0);
  };
  process.on('SIGTERM', () => leave('SIGTERM'));
  process.on('SIGINT', () => leave('SIGINT'));
}

const here = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === here) main();
