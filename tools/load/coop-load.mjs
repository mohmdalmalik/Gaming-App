// A LOAD TEST FOR THE CO-OP SERVER (DESIGN §15 "Load"): the real server (server/index.js) as a child process, with
// its tables saved as files (DATA_DIR in a temporary folder) and the game sped up (TIME_SCALE, a test-only switch),
// and many tables of 2 test people each plus bots, all playing whole matches at once over real WebSockets.
//
//   npm ci --prefix server                                       (once: the server's one package, ws)
//   flock <the browser lock> node tools/load/coop-load.mjs --tables 100 --port 9155
//   node tools/load/coop-load.mjs --tables 300 --scale 20 --people 2 --port 9156 [--memory] [--minutes 20]
//
// The gate: every match finishes (0 unfinished) and the server's memory stays under 400 MB. The server's event-loop
// delay (p99) and the time a save takes are MEASUREMENTS, printed but not judged: this machine's CPU is shared with
// other work, so a timing target would mean nothing here. Run it alone (under the browser lock): it measures timing.
// The test people answer every question at once, read their results, and on their own turn search once and end it
// (the bots play the rest), each from its own X-Forwarded-For (the server runs with TRUST_PROXY=render).
// It prints one line every 10 s and a summary; exit code 0 when the gate passes.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { ONLINE } from '../../src/data/online.js';
import { dataHash } from '../../src/net/dataHash.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name, dflt) => { const i = process.argv.indexOf(`--${name}`); return i > 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : dflt; };
const flag = name => process.argv.includes(`--${name}`);
const TABLES = Number(arg('tables', 100));
const SCALE = Number(arg('scale', 20));
const PEOPLE = Number(arg('people', 2));
const MINUTES = Number(arg('minutes', 20));
const MEMORY_ONLY = flag('memory');
const GATE_MB = 400;

let WebSocket;
try { WebSocket = createRequire(new URL('../../server/package.json', import.meta.url))('ws'); } catch {
  console.error('the server\'s package (ws) is not installed: run   npm ci --prefix server   first');
  process.exit(2);
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(pred, ms) { const end = Date.now() + ms; while (!pred()) { if (Date.now() > end) return false; await sleep(20); } return true; }
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const port = Number(arg('port', 0)) || await freePort();
const dataDir = MEMORY_ONLY ? '' : fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-load-'));

// --- the server ---------------------------------------------------------------------------------------------------------
const child = spawn(process.execPath, [path.join(root, 'server/index.js')], {
  cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, NODE_ENV: '', PORT: String(port), DATA_DIR: dataDir, TIME_SCALE: String(SCALE), TRUST_PROXY: 'render', ALLOWED_ORIGINS: '', MAX_TABLES: String(Math.max(300, TABLES + 10)) },
});
const serverLog = [];
let exited = null;
child.on('exit', (code, sig) => { exited = { code, sig }; });
for (const s of [child.stdout, child.stderr]) s.on('data', d => { for (const l of String(d).split('\n')) if (l.trim()) serverLog.push(l); });
process.on('exit', () => { try { child.kill('SIGKILL'); } catch { /* gone */ } if (dataDir) fs.rmSync(dataDir, { recursive: true, force: true }); });
process.on('SIGINT', () => process.exit(130));
if (!(await until(() => serverLog.some(l => l.includes('listening on')) || exited, 20000)) || exited) {
  console.error(`the server did not start: ${serverLog.slice(-4).join(' | ')}`);
  process.exit(2);
}
const health = () => fetch(`http://127.0.0.1:${port}/health`).then(r => r.json()).catch(() => null);

// --- the test people ----------------------------------------------------------------------------------------------------
let ipSeq = 0;
const counts = { sent: 0, recv: 0, bytes: 0, refused: 0, drops: 0 };
function person(name) {
  ipSeq++;
  const ip = `100.${64 + ((ipSeq >> 16) & 63)}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`;
  const p = { name, ws: null, token: null, view: null, lobby: null, live: false, n: 0, plan: null, searched: null, ended: false, stop: false };
  const send = msg => { if (p.live) { p.ws.send(JSON.stringify(msg)); counts.sent++; } };
  const doCmd = cmd => send({ t: 'do', id: `${(p.n++).toString(36)}`, turn: p.view?.turn ?? 0, cmd });
  p.send = send;
  p.connect = () => {
    if (p.stop) return;
    const ws = new WebSocket(`ws://127.0.0.1:${port}/`, { origin: 'http://127.0.0.1:9155', headers: { 'x-forwarded-for': ip }, perMessageDeflate: false });
    p.ws = ws;
    ws.on('open', () => { p.live = true; send({ t: 'hello', v: ONLINE.protocol, app: 'v0.12', data: dataHash(), token: p.token, name, avatar: null, vis: 'visible' }); });
    ws.on('message', raw => {
      counts.recv++; counts.bytes += raw.length;
      const m = JSON.parse(String(raw));
      if (m.t === 'welcome') p.token = m.token;
      else if (m.t === 'lobby') p.lobby = m.lobby;
      else if (m.t === 'view') { p.view = m.view; if (m.view.end) p.ended = true; p.plan = null; }
      else if (m.t === 'res' && !m.ok) counts.refused++;
    });
    ws.on('close', () => { p.live = false; if (!p.stop) { counts.drops++; setTimeout(p.connect, 300); } });
    ws.on('error', () => {});
  };
  // one decision now and then: questions answered at once, results read, a turn = one search and the end
  p.step = now => {
    const v = p.view;
    if (!v || v.end || !p.live) return;
    let key = null;
    if (v.ask) key = `a${v.ask.id}`;
    else if (v.results.length) key = `r${v.results[0].id}`;
    else if (v.phase.kind === 'turn' && v.activeSeat === v.seat && v.me.alive) key = `t${v.turn}`;
    if (!key) return;
    if (p.plan?.key !== key) { p.plan = { key, at: now + 40 + Math.random() * 260 }; return; }
    if (now < p.plan.at) return;
    p.plan = { key: key + '+', at: now + 1000 };
    const a = v.ask;
    if (a) {
      const value = { meetWhom: a.candidates?.[0], meetAct: 'trade', tradeCard: a.cards?.[0], offer: false }[a.kind];
      if (a.kind === 'role') return doCmd({ k: 'ack', what: 'role' });
      if (a.kind === 'discard') return doCmd({ k: 'discard', card: a.cards[0] });
      return doCmd({ k: 'answer', ask: a.id, value });
    }
    if (v.results.length) return doCmd({ k: 'ack', what: 'result', id: v.results[0].id });
    if (p.searched !== v.turn) { p.searched = v.turn; return doCmd({ k: 'search' }); }
    return doCmd({ k: 'end' });
  };
  p.connect();
  return p;
}

// --- the run --------------------------------------------------------------------------------------------------------------
const t0 = Date.now();
console.log(`load: ${TABLES} tables x ${PEOPLE} people + bots, TIME_SCALE ${SCALE}, ${MEMORY_ONLY ? 'memory store' : 'file store'}, server on 127.0.0.1:${port}`);
const tables = [];
const everyone = [];
const driver = setInterval(() => { const now = Date.now(); for (const p of everyone) p.step(now); }, 25);
for (let k = 0; k < TABLES; k++) {
  const ps = Array.from({ length: PEOPLE }, (_, i) => person(`load${k}_${i}`));
  everyone.push(...ps);
  tables.push({ ps, code: null, started: false });
  if (k % 10 === 9) await sleep(150);
}
await until(() => everyone.every(p => p.token), 30000);
for (const t of tables) { t.ps[0].send({ t: 'create', size: 4 + (tables.indexOf(t) % 3) }); }
await until(() => tables.every(t => t.ps[0].lobby?.code), 30000);
for (const t of tables) { t.code = t.ps[0].lobby?.code; for (const p of t.ps.slice(1)) p.send({ t: 'join', code: t.code }); }
await until(() => tables.every(t => t.ps.every(p => p.lobby?.code === t.code)), 30000);
for (const t of tables) t.ps[0].send({ t: 'lobby', id: 'start', op: { k: 'start' } });
const seated = tables.filter(t => t.code && t.ps.every(p => p.lobby?.code === t.code)).length;
console.log(`  ${seated}/${TABLES} tables seated and started (${((Date.now() - t0) / 1000).toFixed(1)} s)`);

let maxRss = 0, lastPrint = 0, samples = [];
const deadline = Date.now() + MINUTES * 60000;
while (Date.now() < deadline) {
  await sleep(2000);
  const h = await health();
  if (h) { maxRss = Math.max(maxRss, h.rssMB); samples.push(h); }
  const done = tables.filter(t => t.ps.every(p => p.ended)).length;
  if (Date.now() - lastPrint > 10000) {
    lastPrint = Date.now();
    console.log(`  ${((Date.now() - t0) / 1000).toFixed(0)} s: ${done}/${TABLES} matches ended, ${h?.matches ?? '?'} playing, server ${h?.rssMB ?? '?'} MB, event-loop p99 ${h?.loopP99Ms ?? '?'} ms, saves ${h?.saves?.n ?? '?'} (mean ${h?.saves?.meanMs ?? '?'} ms)`);
  }
  if (done === TABLES || exited) break;
}
clearInterval(driver);
const h = await health();
const done = tables.filter(t => t.ps.every(p => p.ended)).length;
const stopped = tables.filter(t => t.ps.every(p => p.ended) && t.ps[0].view?.end?.stopped).length;
for (const p of everyone) { p.stop = true; try { p.ws.close(); } catch { /* gone */ } }
const summary = {
  tables: TABLES, people: TABLES * PEOPLE, timeScale: SCALE, store: MEMORY_ONLY ? 'memory' : 'file',
  ended: done, unfinished: TABLES - done, stoppedWithoutResult: stopped,
  seconds: Math.round((Date.now() - t0) / 1000),
  serverMaxRssMB: maxRss, serverEventLoopP99Ms: h?.loopP99Ms ?? null,
  saves: h?.saves ?? null, messages: { sent: counts.sent, received: counts.recv, receivedMB: Math.round(counts.bytes / 1048576), refused: counts.refused, drops: counts.drops },
  serverErrors: serverLog.filter(l => /fault|failed|uncaught|could not/i.test(l)).length,
};
const pass = summary.unfinished === 0 && maxRss < GATE_MB && !exited;
console.log(`  summary ${JSON.stringify(summary)}`);
console.log(pass ? `LOAD GATE PASSED: ${done}/${TABLES} matches finished, server memory at most ${maxRss} MB (< ${GATE_MB}); event-loop p99 ${summary.serverEventLoopP99Ms} ms (a measurement)`
  : `LOAD GATE FAILED: ${TABLES - done} unfinished, server memory at most ${maxRss} MB (gate < ${GATE_MB})${exited ? `; the server exited (${JSON.stringify(exited)})` : ''}`);
child.kill('SIGTERM');
await until(() => exited, 30000);
process.exit(pass ? 0 : 1);
