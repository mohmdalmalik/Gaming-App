// A SERVER THAT DIES MID-MATCH AND COMES BACK (DESIGN §10, §15): the real server (server/index.js) as a child process
// with its tables saved as files in a temporary folder (DATA_DIR), sped up 20 times (TIME_SCALE=20, a test-only
// switch), and real WebSocket devices, each with its own X-Forwarded-For (TRUST_PROXY=render).
//   npm ci --prefix server        (once: the server's one package, ws)
//   node tests/restore-check.mjs
//
//   1. kill -9: 20 tables of 2-3 scripted people (random delays, random drops of their connection) and bots play
//      while the server is killed without warning several times and started again from its saved tables. Every
//      match must end; every device's history must be a prefix of the final history (no device ever saw something
//      that the server, after a restart, does not hold: the commit rule, save before send); a command sent again with
//      the same id after a restart gets the same reply (it acted once).
//   2. SIGTERM (a deploy): every device is told `bye restart` (come back in 3 s) and its socket closed (1012), the
//      process exits well inside 25 s, and after the restart whoever was playing has their time back: the clock moved
//      on by the outage plus the 15 s grace (scaled: 0.75 s).
// The server's port is a free one chosen at the start (never a fixed default); every process it starts is stopped.
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

let failures = 0;
const t0 = Date.now();
const check = (cond, msg) => { console.log((cond ? '  ok   ' : '  FAIL ') + msg); if (!cond) failures++; };
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let WebSocket;
try {
  WebSocket = createRequire(new URL('../server/package.json', import.meta.url))('ws');
} catch {
  console.log('  FAIL the server\'s package (ws) is not installed: run   npm ci --prefix server   once, then this suite again');
  process.exit(1);
}
const { ONLINE } = await import('../src/data/online.js');
const { dataHash } = await import('../src/net/dataHash.js');
const { applyView, blankState } = await import('../src/net/viewAsState.js');
const { createFloorCopy, syncFloor } = await import('../src/net/floorCopy.js');
const { createBotTable } = await import('../src/bots/index.js');
const { makeRng } = await import('../src/game/cards.js');
const { hotel } = await import('../src/data/hotel.js');
const { config } = await import('../src/config.js');

const TIME_SCALE = 20;
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(pred, ms) { const end = Date.now() + ms; while (!pred()) { if (Date.now() > end) return false; await sleep(10); } return true; }
const freePort = () => new Promise(res => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

// --- the server process -----------------------------------------------------------------------------------------------
const children = new Set();
process.on('exit', () => { for (const c of children) { try { c.kill('SIGKILL'); } catch { /* gone */ } } });
async function startChild(port, dataDir) {
  const child = spawn(process.execPath, [path.join(root, 'server/index.js')], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, NODE_ENV: '', PORT: String(port), DATA_DIR: dataDir, TIME_SCALE: String(TIME_SCALE), TRUST_PROXY: 'render', ALLOWED_ORIGINS: '' },
  });
  children.add(child);
  child.log = [];
  child.exited = null;
  child.on('exit', (code, sig) => { child.exited = { code, sig, at: Date.now() }; children.delete(child); });
  const onData = d => { for (const line of String(d).split('\n')) if (line.trim()) child.log.push(line); };
  child.stdout.on('data', onData);
  child.stderr.on('data', onData);
  const ok = await until(() => child.log.some(l => l.includes('listening on')) || child.exited, 15000);
  if (!ok || child.exited) throw new Error(`the server did not start: ${child.log.slice(-5).join(' | ')}`);
  return child;
}

// --- devices: a WebSocket that reconnects, and a scripted person playing from its own views only ----------------------
let ipSeq = 0;
function device(state, { name }) {
  const ip = `203.0.${(++ipSeq >> 8) & 255}.${ipSeq & 255}`;
  const d = { name, ip, token: null, ws: null, live: false, nextId: 1, view: null, lobby: null, listeners: [], byO: new Map(), conflicts: [],
    replies: new Map(), lastDo: null, resent: [], reconnects: 0, byes: [], closes: [], wantOpen: true, welcomeAt: 0 };
  d.connect = () => {
    if (!d.wantOpen) return;
    const ws = new WebSocket(`ws://127.0.0.1:${state.port}/`, { origin: 'http://127.0.0.1:9160', headers: { 'x-forwarded-for': ip }, perMessageDeflate: false });
    d.ws = ws;
    ws.on('open', () => { d.live = true; ws.send(JSON.stringify({ t: 'hello', v: ONLINE.protocol, app: 'v0.12', data: dataHash(), token: d.token, name, avatar: null, vis: 'visible' })); });
    ws.on('message', raw => {
      const m = JSON.parse(String(raw));
      // (back after a drop or a restart, mid-match: the last command again, with the same id; it must act once)
      if (m.t === 'welcome') { d.token = m.token; d.welcomeAt = Date.now(); if (d.lastDo && d.reconnects && m.place === 'match' && !d.view?.end) { d.resent.push(d.lastDo.id); ws.send(JSON.stringify(d.lastDo.msg)); } }
      if (m.t === 'res') { if (d.replies.has(m.id) && d.replies.get(m.id) !== JSON.stringify(m)) d.conflicts.push(`reply ${m.id}: ${d.replies.get(m.id)} then ${JSON.stringify(m)}`); else d.replies.set(m.id, JSON.stringify(m)); }
      if (m.t === 'bye') d.byes.push(m);
      if (m.t === 'lobby') d.lobby = m.lobby;
      if (m.t === 'view') {
        d.view = m.view;
        d.viewAt = Date.now();
        d.views = (d.views || 0) + 1;
        for (const e of m.events) {
          if (e.o == null) continue;
          const text = JSON.stringify(e);
          const seen = d.byO.get(e.o);
          if (seen != null && seen !== text) d.conflicts.push(`o ${e.o}: ${seen.slice(0, 90)} then ${text.slice(0, 90)}`);
          d.byO.set(e.o, text);
        }
      }
      for (const fn of d.listeners) fn(m);
    });
    ws.on('close', code => { d.live = false; d.closes.push(code); if (d.wantOpen) setTimeout(() => { d.reconnects++; d.connect(); }, 150 + Math.random() * 350); });
    ws.on('error', () => {});
  };
  d.send = (msg, remember = false) => {
    if (!d.live) return null;
    d.ws.send(JSON.stringify(msg));
    if (remember) d.lastDo = { id: msg.id, msg };
    return msg.id;
  };
  d.do = cmd => d.send({ t: 'do', id: `${name}-${d.nextId++}`, turn: d.view?.turn ?? 0, cmd }, true);
  d.op = op => d.send({ t: 'lobby', id: `${name}-o${d.nextId++}`, op });
  d.drop = () => { try { d.ws.terminate(); } catch { /* gone */ } };
  d.stop = () => { d.wantOpen = false; try { d.ws.close(); } catch { /* gone */ } };
  d.connect();
  return d;
}

function person(d, { rng, seed, delay = [40, 400], endAfter = 10 }) {
  const P = { state: blankState(), floor: createFloorCopy(hotel, config), received: [], mind: null, seat: null, key: null, plan: null, acts: 0, turn: null };
  d.listeners.push(m => {
    if (m.t !== 'view') return;
    const key = `${m.view.table?.code}:${m.view.players.map(p => p.id + p.name).join(',')}`;
    const isNew = P.key !== key;
    if (m.fresh) P.received = m.events.filter(e => e.o != null); else P.received.push(...m.events.filter(e => e.o != null));
    applyView(P.state, m.view, P.received, { fresh: !!m.fresh, newMatch: isNew || undefined });
    syncFloor(P.floor, m.view.hotel);
    if (isNew || !P.mind) { P.seat = m.view.seat; P.key = key; P.mind = createBotTable(P.state, P.floor, [{ index: m.view.seat, profile: null }], seed); }
    P.plan = null;
  });
  const R = (a, b) => a + (b - a) * rng();
  const situation = () => {
    const v = d.view;
    if (!v || v.end || v.phase.kind === 'ended' || !d.live) return null;
    if (v.ask) return 'a' + v.ask.id;
    if (v.results.length) return 'r' + v.results[0].id;
    if (v.phase.kind === 'turn' && v.activeSeat === v.seat && v.me.alive) return `t${v.turn}:${P.acts}`;
    return null;
  };
  function act() {
    const v = d.view, a = v.ask;
    try {
      if (a) {
        switch (a.kind) {
          case 'role': return d.do({ k: 'ack', what: 'role' });
          case 'meetWhom': return d.do({ k: 'answer', ask: a.id, value: P.mind.meetWhom(P.seat, a.candidates) });
          case 'meetAct': return d.do({ k: 'answer', ask: a.id, value: 'trade' });
          case 'tradeCard': return d.do({ k: 'answer', ask: a.id, value: P.mind.tradeCard(P.seat, a.with, a.cards) });
          case 'offer': return d.do({ k: 'answer', ask: a.id, value: !!P.mind.acceptTrade(P.seat, a.from) });
          case 'discard': return d.do({ k: 'discard', card: P.mind.discard(P.seat, a.cards) });
          default: return null;
        }
      }
      if (v.results.length) {
        const r = v.results[0];
        if ((r.kind === 'trade' || r.kind === 'noTrade') && r.notes?.length) d.do({ k: 'ack', what: 'notes', lines: r.notes });
        return d.do({ k: 'ack', what: 'result', id: r.id });
      }
      if (P.turn !== v.turn) { P.turn = v.turn; P.acts = 0; }
      P.acts++;
      let x = P.acts > endAfter ? { k: 'end' } : P.mind.nextAction(P.seat);
      if (!x) x = { k: 'end' };
      return d.do(x.k === 'card' ? { k: 'card', type: x.type, card: x.card, ...(x.target != null ? { target: x.target } : {}) } : { ...x });
    } catch { return d.do({ k: 'end' }); }
  }
  P.step = now => {
    const sit = situation();
    if (!sit) { P.plan = null; return; }
    if (P.plan?.key !== sit) P.plan = { key: sit, at: now + R(delay[0], delay[1]) };
    if (now >= P.plan.at) { P.plan = null; act(); }
  };
  return P;
}

// Seat tables: the first device creates, the others join, the host starts.
async function seatTables(state, n, { people = k => 2 + (k % 2), size = k => 4 + (k % 3) } = {}) {
  const tables = [];
  for (let k = 0; k < n; k++) {
    const devs = Array.from({ length: people(k) }, (_, i) => device(state, { name: `r${k}_${i}` }));
    await until(() => devs.every(d => d.token), 10000);
    devs[0].send({ t: 'create', size: size(k) });
    await until(() => devs[0].lobby?.code, 5000);
    const code = devs[0].lobby?.code;
    for (const d of devs.slice(1)) d.send({ t: 'join', code });
    await until(() => devs.every(d => d.lobby?.code === code) && devs[0].lobby.people.length === devs.length, 5000);
    devs[0].op({ k: 'start' });
    tables.push({ code, devs });
  }
  return tables;
}

// The final history of a device, by ordinal, from its end view (public and own events).
function finalHistory(d) {
  const h = d.view?.end?.history;
  const map = new Map();
  for (const e of [...(h?.events || []), ...(h?.inbox || [])]) map.set(e.o, JSON.stringify(e));
  return map;
}

// --- 1. kill -9 ---------------------------------------------------------------------------------------------------------
console.log(`1. kill -9 mid-match: 20 tables of 2-3 scripted people and bots, TIME_SCALE ${TIME_SCALE}, tables saved as files`);
{
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-restore-'));
  const state = { port: await freePort() };
  let child = await startChild(state.port, dataDir);
  const tables = await seatTables(state, 20);
  const devs = tables.flatMap(t => t.devs);
  const folk = devs.map((d, i) => person(d, { rng: makeRng(1000 + i), seed: 500 + i }));
  const driver = setInterval(() => { const now = Date.now(); for (const p of folk) p.step(now); for (const d of devs) if (d.live && Math.random() < 0.0004) d.drop(); }, 20);
  let kills = 0, restarts = [], lastKill = Date.now();
  const deadline = Date.now() + 12 * 60000;
  while (Date.now() < deadline) {
    await sleep(500);
    const ended = devs.filter(d => d.view?.end).length;
    if (ended === devs.length) break;
    const sinceKill = Date.now() - lastKill;
    if (kills < 8 && sinceKill > 9000 + kills * 1500 && ended < devs.length * 0.8) {
      child.kill('SIGKILL');
      await until(() => child.exited, 5000);
      kills++;
      await sleep(300 + Math.random() * 700);
      const t = Date.now();
      child = await startChild(state.port, dataDir);
      restarts.push({ ms: Date.now() - t, line: child.log.find(l => l.includes('restored')) });
      lastKill = Date.now();
    }
  }
  clearInterval(driver);
  const ended = tables.filter(t => t.devs.every(d => d.view?.end));
  const finished = ended.filter(t => !t.devs[0].view.end.stopped).length;
  const restoredMatches = restarts.map(r => Number((r.line || '').match(/\((\d+) matches running/)?.[1] ?? 0));
  check(kills >= 5, `the server was killed with kill -9 ${kills} times and started again from its files (each start ${restarts.map(r => r.ms).join('/')} ms; matches restored: ${restoredMatches.join(', ')})`);
  check(restoredMatches.every(n => n > 0) || kills === 0, 'every restart brought matches back that were running');
  check(ended.length === tables.length, `every match ended: ${ended.length}/${tables.length} (${finished} finished, ${ended.length - finished} stopped without a result)`);
  const conflicts = devs.flatMap(d => d.conflicts.map(c => `${d.name}: ${c}`));
  let notPrefix = 0, seen = 0;
  for (const d of devs) {
    const fin = finalHistory(d);
    for (const [o, text] of d.byO) { seen++; if (fin.get(o) !== text) notPrefix++; }
  }
  check(conflicts.length === 0, `no event ever changed under a device after a restart, and a command sent again with the same id got the same reply (${devs.reduce((n, d) => n + d.resent.length, 0)} sent again)${conflicts.length ? ' — ' + conflicts.slice(0, 2).join('; ') : ''}`);
  check(seen > 1000 && notPrefix === 0, `each device's history is a prefix of the final one (${seen} events checked over ${devs.length} devices, ${notPrefix} not in the final history)`);
  check(devs.reduce((n, d) => n + d.reconnects, 0) >= devs.length, `devices came back after every outage and drop (${devs.reduce((n, d) => n + d.reconnects, 0)} reconnects)`);
  for (const d of devs) d.stop();
  child.kill('SIGKILL');
  await until(() => child.exited, 5000);
  fs.rmSync(dataDir, { recursive: true, force: true });
}

// --- 2. SIGTERM -----------------------------------------------------------------------------------------------------------
console.log('\n2. SIGTERM: the drain, and the clock moved on by the outage plus the grace');
{
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hotel-drain-'));
  const state = { port: await freePort() };
  let child = await startChild(state.port, dataDir);
  const [tbl] = await seatTables(state, 1, { people: () => 2, size: () => 4 });
  const devs = tbl.devs;
  // the people only read their role; then whoever is a person waits on their turn, the clock running
  const ack = setInterval(() => { for (const d of devs) if (d.view?.ask?.kind === 'role') d.do({ k: 'ack', what: 'role' }); }, 50);
  const ready = await until(() => {
    const v = devs[0].view;
    const a = v && devs.find(d => d.view?.seat === v.activeSeat);
    return a && a.view.phase.kind === 'turn' && a.view.clock?.running && a.view.clock.leftMs > 1500;
  }, 60000);
  clearInterval(ack);
  const active = devs.find(d => d.view.seat === d.view.activeSeat);
  const tTerm = Date.now();
  const leftThen = active.view.clock.leftMs - (tTerm - active.viewAt);     // (the clock at the SIGTERM)
  child.kill('SIGTERM');
  await until(() => child.exited, ONLINE.timing.drainMs + 5000);
  const exitMs = child.exited ? child.exited.at - tTerm : Infinity;
  const told = devs.every(d => d.byes.some(b => b.why === 'restart' && b.retryMs === ONLINE.timing.restartRetryMs)) && devs.every(d => d.closes.includes(1012));
  check(ready && told, `every device was told bye restart (come back in ${ONLINE.timing.restartRetryMs / 1000} s) and its socket closed 1012`);
  check(child.exited?.code === 0 && exitMs < ONLINE.timing.drainMs, `the process saved its tables and exited (code ${child.exited?.code}) ${exitMs} ms after the SIGTERM (limit ${ONLINE.timing.drainMs / 1000} s)`);
  check(child.log.some(l => /SIGTERM: saving every table/.test(l)) && fs.readdirSync(dataDir).some(f => f.endsWith('.json')), 'the table is on the disk');
  await sleep(1500);
  const seenBefore = active.views;
  child = await startChild(state.port, dataDir);
  const restoredAt = Date.parse(child.log.find(l => l.includes('restored'))?.split(' ')[0] ?? '') || Date.now();
  const back = await until(() => active.views > seenBefore && active.live, 15000);
  const after = active.view;
  const grace = ONLINE.timing.restoreGraceMs / TIME_SCALE;
  check(back && after.phase.kind === 'turn' && after.activeSeat === after.seat, `after the restart the same person's turn goes on (${active.name})`);
  check(back && Math.abs(after.clock.leftMs - leftThen) <= 300,
    `their clock after a ${((restoredAt - tTerm) / 1000).toFixed(1)} s outage: ${after?.clock?.leftMs} ms left, as at the SIGTERM (${Math.round(leftThen)} ms): the outage was given back`);
  // the referee moved every time it holds by the outage + the grace: the clock waits out the grace, then runs again,
  // so the turn runs out (nobody acts) at the restart + the grace + the time that was left + the 0.5 s command grace
  const turn = after.turn;
  const passed = await until(() => active.view.turn !== turn, 15000);
  const expectedPass = restoredAt + grace + leftThen + ONLINE.timing.graceMs;
  check(passed && Math.abs(active.viewAt - expectedPass) <= 500,
    `the turn ran out ${active.viewAt - restoredAt} ms after the restart (expected about ${Math.round(expectedPass - restoredAt)}: the ${grace} ms grace, then the ${Math.round(leftThen)} ms left, then the ${ONLINE.timing.graceMs} ms command grace)`);
  for (const d of devs) d.stop();
  child.kill('SIGKILL');
  await until(() => child.exited, 5000);
  fs.rmSync(dataDir, { recursive: true, force: true });
}

console.log(`\n${failures ? `${failures} FAILED` : 'ALL RESTORE CHECKS PASSED'} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
process.exit(failures ? 1 : 0);
