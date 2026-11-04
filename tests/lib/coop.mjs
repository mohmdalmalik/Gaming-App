// Helpers for tests/browser-coop.mjs (Co-op end to end, DESIGN §15 "Browser"): several people, each in a browser
// context of its own (one Chromium for all of them: each context is its own device, with its own storage, its own
// profile and its own network switch), the page on 127.0.0.1, the Co-op server either in this process
// (server/index.js startServer) or as a child process (so it can be killed with SIGKILL and started again on the same
// DATA_DIR), screenshots for the contact sheet (tools/coop-record/), a driver that plays a whole match through the
// page's own screens, and the secrets scan.
// Not a suite (tests/lib/ is not counted by tests/docs-check.mjs).
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { tipsOff, autoEndOff, profileOn, TEST_PROFILE, GUARD_WAIT } from '../smoke-lib.mjs';

const here = path.dirname(new URL(import.meta.url).pathname);
export const ROOT = path.join(here, '..', '..');
const threeDir = path.join(here, '..', 'node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';
const CHROME = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(fs.existsSync);

// The four iPad sizes (DESIGN §14.2), landscape.
export const SIZES = [[1024, 694], [1024, 768], [1180, 820], [1366, 1024]];

// --- checks ------------------------------------------------------------------------------------------------------------
export function checks() {
  const failures = [];
  const gaps = [];
  let oks = 0;
  return {
    failures, gaps,
    get oks() { return oks; },
    check(cond, msg) { if (cond) { oks++; console.log('  ok  ', msg); } else { console.log('  FAIL', msg); failures.push(msg); } return !!cond; },
    // what the design asks for and the build does not do yet: printed, counted, never a failure of this suite
    gap(msg) { console.log('  GAP ', msg); gaps.push(msg); },
    info(msg) { console.log('  ..  ', msg); },
  };
}

// --- ports and servers -------------------------------------------------------------------------------------------------
export const freePort = () => new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.webmanifest': 'application/manifest+json', '.mp3': 'audio/mpeg', '.glb': 'model/gltf-binary', '.gif': 'image/gif', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
// The page, served from the repo on 127.0.0.1 (port 0: any free port).
export async function staticServer(root = ROOT, port = 0) {
  const server = http.createServer((req, res) => {
    let rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (rel.endsWith('/')) rel += 'index.html';
    const file = path.join(root, rel);
    if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise(r => server.listen(port, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(r => server.close(() => r())) };
}

// A relay between one device and the server (the match's drop). It passes the bytes both ways. cut() makes it a dead
// network, as a lost Wi-Fi is: nothing passes either way and nothing is closed, so the server's heartbeat has to find
// the silence (Chromium's offline mode alone can leave an open socket answering the server's pings). mend() closes the
// dead connections and lets new ones through again. A server restart closes the device's side too, so it reconnects.
export async function relay(targetPort, host = '127.0.0.1') {
  const pairs = new Set();
  let dead = false;
  const server = net.createServer(c => {
    if (dead) { c.destroy(); return; }
    const u = net.connect(targetPort, host);
    const p = { c, u, dead: false };
    pairs.add(p);
    c.on('data', d => { if (!p.dead) u.write(d); });
    u.on('data', d => { if (!p.dead) c.write(d); });
    // (a closed end closes the other, except on a dead network, where the far side hears nothing)
    const end = () => { if (p.dead) return; pairs.delete(p); c.destroy(); u.destroy(); };
    c.on('close', end); u.on('close', end);
    c.on('error', () => {}); u.on('error', () => {});
  });
  await new Promise(r => server.listen(0, host, r));
  return {
    port: server.address().port,
    cut() { dead = true; for (const p of pairs) p.dead = true; },
    mend() { dead = false; for (const p of [...pairs]) if (p.dead) { pairs.delete(p); p.c.destroy(); p.u.destroy(); } },
    close: () => new Promise(r => { for (const p of pairs) { p.c.destroy(); p.u.destroy(); } server.close(() => r()); }),
  };
}

// The Co-op server as a child process (`node server/index.js`), so a test can kill it hard (SIGKILL) or politely
// (SIGTERM) and start it again on the same port and DATA_DIR.
export function childServer({ port, dataDir = null, timeScale = 1, limitsScale = 1, root = ROOT, env = {} }) {
  let proc = null;
  let log = '';
  let exited = null;
  const self = {
    get port() { return port; },
    get log() { return log; },
    get running() { return !!proc && exited == null; },
    async start(timeout = 20000) {
      exited = null;
      const e = { ...process.env, PORT: String(port), TIME_SCALE: String(timeScale), LIMITS_SCALE: String(limitsScale), ...env };
      delete e.NODE_ENV;
      if (dataDir) e.DATA_DIR = dataDir;
      proc = spawn(process.execPath, [path.join(root, 'server', 'index.js')], { env: e, stdio: ['ignore', 'pipe', 'pipe'] });
      const me = proc;
      // (the server goes with this process, however it ends: a stopped test must not leave it listening)
      const reap = () => { try { me.kill('SIGKILL'); } catch { /* gone */ } };
      process.once('exit', reap);
      for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => { reap(); process.exit(1); });
      me.stdout.on('data', d => { log += d; });
      me.stderr.on('data', d => { log += d; });
      me.on('exit', (code, sig) => { if (me === proc) exited = { code, sig }; log += `\n[exit ${code ?? ''}${sig ?? ''}]\n`; });
      const end = Date.now() + timeout;
      while (Date.now() < end) {
        const from = log.lastIndexOf('[exit');
        if (/listening on/.test(from < 0 ? log : log.slice(from))) return true;
        if (exited) return false;
        await new Promise(r => setTimeout(r, 50));
      }
      return false;
    },
    // SIGKILL: no drain, no last save, no goodbye (the saves made after every step are all there is)
    async kill(signal = 'SIGKILL', timeout = 30000) {
      if (!proc || exited) return exited;
      const me = proc;
      const done = new Promise(r => me.once('exit', (code, sig) => r({ code, sig })));
      me.kill(signal);
      return Promise.race([done, new Promise(r => setTimeout(() => r(null), timeout))]);
    },
    pid: () => proc?.pid ?? null,
  };
  return self;
}

// --- browsers, people --------------------------------------------------------------------------------------------------
export async function openBrowser() {
  return chromium.launch({ executablePath: CHROME, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
}

// An emulated on-screen keyboard (the same as tests/coop-menu-check.mjs): visualViewport's height is the window's less
// the keyboard's; window.__keyboard(px) raises or lowers it.
function keyboardScript() {
  const vv = new EventTarget();
  let kb = 0;
  for (const [k, get] of Object.entries({ height: () => innerHeight - kb, width: () => innerWidth, offsetTop: () => 0, offsetLeft: () => 0, pageTop: () => 0, pageLeft: () => 0, scale: () => 1 })) Object.defineProperty(vv, k, { get });
  Object.defineProperty(window, 'visualViewport', { get: () => vv, configurable: true });
  window.__keyboard = px => { kb = px; vv.dispatchEvent(new Event('resize')); };
}

// One person: a browser of their own (a device: its own storage, profile and network switch, and its own GPU process,
// so one person's software-drawn hotel does not wait on another's), with today's test defaults (tips off, no auto end
// turn, a saved profile with their name unless `profile: false`, the three.js CDN served from tests/node_modules).
// Close it with person.close().
export async function person({ name, width = 1024, height = 694, profile = true, keyboard = false } = {}) {
  const browser = await openBrowser();
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, hasTouch: true });
  await context.addInitScript(tipsOff);
  await context.addInitScript(autoEndOff);
  if (profile) await context.addInitScript(profileOn, { ...TEST_PROFILE, username: name, id: `local-${name}` });
  if (keyboard) await context.addInitScript(keyboardScript);
  await context.route(`${CDN}**`, route => {
    const rel = route.request().url().slice(CDN.length).split('?')[0];
    const file = path.join(threeDir, rel);
    route.fulfill(fs.existsSync(file) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(file) } : { status: 404, body: 'x' });
  });
  const page = await context.newPage();
  const messages = [];
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) messages.push(`${m.type()}: ${m.text()}`); });
  page.on('pageerror', e => messages.push(`pageerror: ${e.message}`));
  page.on('requestfailed', r => messages.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
  return { name, browser, context, page, messages, size: [width, height], close: () => browser.close().catch(() => {}) };
}

// The page's own console lines that are not the browser's (a refused socket while the server is down, a download cut
// short by a page change, the favicon).
export const ownMessages = messages => messages.filter(m => !/Failed to load resource|favicon|WebSocket connection to 'ws:\/\/127\.0\.0\.1|ERR_INTERNET_DISCONNECTED|net::ERR_ABORTED|net::ERR_CONNECTION_REFUSED|net::ERR_NETWORK_CHANGED/.test(m));

// --- page helpers ------------------------------------------------------------------------------------------------------
export const text = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return e ? e.textContent.replace(/\s+/g, ' ').trim() : null; }, sel);
export const shown = (page, sel) => page.evaluate(s => { const e = document.querySelector(s); return !!e && !e.closest('[hidden]') && e.getClientRects().length > 0; }, sel);
export const tap = async (page, sel, timeout = 30000) => { await page.waitForTimeout(GUARD_WAIT); await page.click(sel, { timeout }); await page.waitForTimeout(150); };
export const waitScreen = (page, id, timeout = 30000) => page.waitForFunction(s => !document.getElementById(s)?.hidden, id, { timeout, polling: 100 }).then(() => true, () => false);
export const waitFor = (page, fn, arg, timeout = 30000, polling = 150) => page.waitForFunction(fn, arg, { timeout, polling }).then(() => true, () => false);
export const screenNow = page => page.evaluate(() => [...document.querySelectorAll('#menu .menu-screen')].find(s => !s.hidden)?.id || null);
export async function openPage(page, baseUrl, query, { timeout = 180000 } = {}) {
  await page.goto(`${baseUrl}?intro=off${query ? `&${query}` : ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && !document.getElementById('menu').hidden, null, { timeout, polling: 100 });
  await page.waitForTimeout(600);
}
// The menu's screen animations done (a busy machine draws a frame every second or so)
export const still = page => page.waitForFunction(() => !document.getAnimations().some(a => ['running', 'pending'].includes(a.playState) && a.effect?.getTiming?.().iterations !== Infinity && a.effect?.target?.closest?.('#menu')), null, { timeout: 15000, polling: 100 }).catch(() => {});
export const inMatch = (page, timeout = 120000) => waitFor(page, () => window.__game.phase() === 'game' && window.__game.isRunning() && !!window.__net?.view(), null, timeout, 200);
export const coopCard = page => page.evaluate(() => { const c = document.getElementById('coop-match-card'); return c && !c.hidden ? document.getElementById('coop-mc-title')?.textContent : null; });

// --- screenshots (tests/shots/coop/, git-ignored; tools/coop-record/ turns them into a contact sheet) -----------------
// shoot(page, name, { caption, who, sizes }): one JPEG per size (the page is resized to each and back), and a line in
// manifest.json. sizes: 'own' (the page's own size, the default) or 'all' (the four iPad sizes).
export function shots(dir, { enabled = true } = {}) {
  if (enabled) fs.mkdirSync(dir, { recursive: true });
  const manifestFile = path.join(dir, 'manifest.json');
  let manifest = [];
  try { manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8')); } catch { manifest = []; }
  const write = () => { if (enabled) fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1)); };
  return {
    dir,
    reset(section) { manifest = manifest.filter(m => m.section !== section); write(); },
    async shoot(page, name, { caption = name, who = '', section = '', sizes = 'own', settle = 500 } = {}) {
      if (!enabled) return [];
      const vp = page.viewportSize();
      const list = sizes === 'all' ? SIZES : [[vp.width, vp.height]];
      const files = [];
      for (const [w, h] of list) {
        if (w !== vp.width || h !== vp.height) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(settle); await still(page); }
        const file = `${section ? `${section}-` : ''}${name}-${w}x${h}.jpg`;
        try {
          await page.screenshot({ path: path.join(dir, file), type: 'jpeg', quality: 70, timeout: 30000 });
          manifest = manifest.filter(m => m.file !== file);
          manifest.push({ file, section, name, caption, who, size: `${w}x${h}`, at: new Date().toISOString() });
          files.push(file);
        } catch (err) { console.log(`  ..   (screenshot ${file} failed: ${err.message.split('\n')[0]})`); }
      }
      if (sizes === 'all') { await page.setViewportSize(vp); await page.waitForTimeout(200); }
      write();
      return files;
    },
  };
}

// --- one page through a whole match --------------------------------------------------------------------------------------
// The person only ends their turns and answers whatever the page asks, through the page's own screens (the role,
// meetings: Trade first, the card to give: the first, the discard: the first card, "You are out": Watch). It stops at
// the end screen, or at a stopped match's card. Hooks:
//   hold(s)      true: do nothing this round (a test is about to kill the server, say)
//   myTurn(s)    on the person's own turn, before End turn: return true when it did something itself (the next look
//                comes first)
//   card(s, t)   a Co-op card is up (title t): return true when it handled it; otherwise a card that stops the match ends
//                the drive, and the restarted notice and "Still reconnecting…" get their first button
//   meeting(s)   a meeting screen is up: return true when it answered it itself (the default: Trade, else the first)
//   idle(s)      nothing to answer and not the person's turn: return true when it did something (the review link's
//                seat switch)
//   onTick(s)    every look (for the secrets scan)
// Stats: how many of each, and the hand checks (the fan shows only this seat's own cards).
export async function drive(page, { maxMs = 8 * 60000, label = '', hold = null, myTurn = null, card = null, meeting = null, idle = null, onTick = null, stopWhen = null } = {}) {
  const t0 = Date.now();
  let lastLog = 0;
  const stats = { ends: 0, screens: 0, meetings: 0, discards: 0, handChecks: 0, handBad: 0, seen: new Set(), cards: [], unshown: [], maxUnshownMs: 0 };
  // a question in the view that no screen shows (not while the test holds the page): how long, the longest
  let waiting = null;
  while (Date.now() - t0 < maxMs) {
    let s;
    try {
      s = await page.evaluate(() => {
        const g = window.__game, n = window.__net;
        const v = n?.view();
        const card = document.getElementById('coop-match-card');
        return {
          card: card && !card.hidden ? document.getElementById('coop-mc-title')?.textContent : null,
          end: g.endOpen(), handoff: g.handoffOpen(), hk: g.handoffKind(), meeting: g.meetingOpen(), ask: g.askOpen(),
          notice: g.noticeOpen(), myTurn: g.myTurn(), act: g.inActionPhase(), seat: n?.seat(),
          turn: v?.turn, round: v?.round, phase: v?.phase?.kind, vask: v?.ask?.kind ?? null, askId: v?.ask?.id ?? null,
          handIds: (v?.me?.hand || []).map(c => c.id), fanIds: g.fanIds(), alive: v?.me?.alive,
          discard: !document.getElementById('discard-overlay')?.hidden, walking: g.activeMover().walking, running: g.isRunning(),
        };
      });
    } catch (err) {
      if (/closed|Target page/.test(String(err?.message))) return { ...stats, ended: false, error: 'page closed', ms: Date.now() - t0 };
      await page.waitForTimeout(300); continue;
    }
    if (onTick) await onTick(s);
    if (stopWhen && stopWhen(s)) return { ...stats, ended: false, stoppedBy: 'stopWhen', ms: Date.now() - t0 };
    if (Date.now() - lastLog > 20000) { lastLog = Date.now(); console.log(`  ..   ${label} ${Math.round((Date.now() - t0) / 1000)}s seat ${s.seat} r${s.round} t${s.turn} ${s.phase} ask=${s.vask} handoff=${s.handoff}/${s.hk} meeting=${s.meeting} myTurn=${s.myTurn} act=${s.act}${s.card ? ` card="${s.card}"` : ''}`); }
    if (s.end) return { ...stats, ended: true, ms: Date.now() - t0 };
    if (hold && hold(s)) { waiting = null; await page.waitForTimeout(250); continue; }
    const onScreen = s.handoff || s.meeting || s.discard || s.ask || s.notice || s.card || s.walking;
    if (s.vask && s.vask !== 'role' && !onScreen) {
      if (!waiting || waiting.id !== s.askId) waiting = { id: s.askId, kind: s.vask, since: Date.now() };
      const ms = Date.now() - waiting.since;
      if (ms > stats.maxUnshownMs) stats.maxUnshownMs = ms;
      if (ms > 20000 && !waiting.told) { waiting.told = true; stats.unshown.push(`${waiting.kind} ${waiting.id} (r${s.round} t${s.turn})`); }
    } else waiting = null;
    if (s.card) {
      if (card && await card(s, s.card)) { await page.waitForTimeout(300); continue; }
      if (/restarted|Still reconnecting/i.test(s.card)) { stats.cards.push(s.card); await page.evaluate(() => document.getElementById('btn-coop-mc-a')?.click()); await page.waitForTimeout(400); continue; }
      return { ...stats, ended: false, stopped: s.card, ms: Date.now() - t0 };
    }
    if (!s.handoff && !s.meeting && !s.discard && s.fanIds.length) { stats.handChecks++; if (s.fanIds.some(id => !s.handIds.includes(id))) stats.handBad++; }
    if (s.handoff) {
      stats.seen.add(s.hk); stats.screens++;
      // (a card to give: tap the first card, then the gold button that names it, src/ui/handoff.js privatePick; a choice:
      // its first button; anything else: Continue)
      await page.evaluate(() => {
        const give = document.getElementById('btn-offer-give');
        if (give && !give.hidden && !give.disabled) { give.click(); return; }
        const tile = document.querySelector('#handoff-overlay #offer-cards .card-tile');
        if (tile && !document.getElementById('handoff-offer').hidden) { tile.click(); return; }
        const choice = document.querySelector('#handoff-overlay #offer-intent:not([hidden]) button');
        if (choice) { choice.click(); return; }
        document.getElementById('btn-handoff-next')?.click();
      });
      await page.waitForTimeout(400); continue;
    }
    if (s.meeting) {
      stats.seen.add('meeting'); stats.meetings++;
      if (meeting && await meeting(s)) { await page.waitForTimeout(400); continue; }
      await page.evaluate(() => {
        const btns = [...document.querySelectorAll('#encounter-overlay button')].filter(b => !b.disabled && b.offsetParent);
        (btns.find(b => /Trade|Continue|OK|Accept/i.test(b.textContent)) || btns[0])?.click();
      });
      await page.waitForTimeout(400); continue;
    }
    if (s.discard) { stats.seen.add('discard'); stats.discards++; await page.evaluate(() => document.querySelector('#discard-overlay .discard-card, #discard-overlay [data-card]')?.click()); await page.waitForTimeout(400); continue; }
    if (s.ask) { stats.seen.add('ask'); await page.evaluate(() => { const b = [...document.querySelectorAll('#ask-overlay button')].find(x => /Watch|Keep/i.test(x.textContent)); b?.click(); }); await page.waitForTimeout(300); continue; }
    if (s.notice) { await page.evaluate(() => window.__game.clickNotice()); continue; }
    // (End turn only in the turn itself: never while a meeting, a trade or the discard is under way, or a question waits)
    if (s.myTurn && s.act && !s.walking && s.phase === 'turn' && !s.vask) {
      if (myTurn && await myTurn(s)) { await page.waitForTimeout(400); continue; }
      stats.ends++; await page.evaluate(() => window.__game.endTurn()); await page.waitForTimeout(500); continue;
    }
    if (idle && await idle(s)) continue;
    await page.waitForTimeout(250);
  }
  return { ...stats, ended: false, ms: Date.now() - t0 };
}

// --- the secrets scan ----------------------------------------------------------------------------------------------------
// What one page holds that a scan can read: its view (the server's words to this seat), its presenter (what the
// screens draw from), and everything visible on it.
export const pageHolds = page => page.evaluate(() => {
  const v = window.__net?.view();
  const st = window.__game.presenterState;
  const seat = window.__net?.seat();
  return {
    seat,
    view: v ? JSON.stringify(v) : null,
    finished: !!v?.finished || !!v?.end,
    knows: v?.me?.knows || [],
    presenter: (st?.players || []).map((p, i) => ({ i, id: p.id, name: p.name, hand: (p.hand || []).length, possessed: !!p.possessed, convertedBy: p.convertedBy ?? null, knows: (p.knows || []).length, notes: (p.notes || []).length, inbox: (p.inbox || []).length })),
    viewPlayerKeys: [...new Set((v?.players || []).flatMap(p => Object.keys(p)))],
    text: document.body.innerText,
  };
});

// The truth, from the server's own save of the table (DATA_DIR/<id>.json, src/net/rooms.js serialise): each seat's
// role, its cards (engine ids and types) and the aliases its device was given.
export function truthFromSave(save) {
  const m = save?.match;
  if (!m?.engine) return null;
  const st = m.engine.state || m.engine;
  const aliases = new Map((m.aliases?.seats || []).map(([seat, pairs]) => [seat, pairs.map(([, a]) => a)]));
  return {
    players: (st.players || []).map((p, i) => ({ seat: i, id: p.id, name: p.name, possessed: !!p.possessed, hand: (p.hand || []).map(c => ({ id: c.id, type: c.type })), aliases: aliases.get(i) || [] })),
    finished: !!st.finished,
  };
}
export function readSave(dataDir, code) {
  if (!dataDir || !fs.existsSync(dataDir)) return null;
  for (const f of fs.readdirSync(dataDir)) {
    if (!f.endsWith('.json')) continue;
    try { const s = JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8')); if (s.code === code) return s; } catch { /* mid-write */ }
  }
  return null;
}

// One look at one page against the truth: the hits (empty: nothing secret of another seat's on that page).
//   - another seat's card: its engine id (set membership against the view's string values) or its alias (anywhere in the
//     view, the presenter or the visible text);
//   - another seat's role: a key that only `me` may carry, on a player in the view; the presenter marking another seat
//     possessed, or holding its hand, notes, inbox or knows; the visible text naming that seat possessed, before the end
//     and unless this seat was told (me.knows).
export function scanHits(holds, truth) {
  const hits = [];
  if (!holds?.view || !truth) return hits;
  const me = holds.seat;
  const strings = new Set();
  (function walk(x) { if (typeof x === 'string') strings.add(x); else if (x && typeof x === 'object') for (const k of Object.keys(x)) walk(x[k]); })(JSON.parse(holds.view));
  const bad = ['hand', 'inbox', 'notes', 'knows', 'possessed', 'convertedBy', 'roleChangePending'];
  for (const k of holds.viewPlayerKeys) if (bad.includes(k)) hits.push(`view.players carries "${k}"`);
  for (const p of truth.players) {
    if (p.seat === me) continue;
    for (const c of p.hand) if (strings.has(c.id)) hits.push(`engine id ${c.id} (seat ${p.seat}'s ${c.type}) in the view`);
    for (const a of p.aliases) {
      if (holds.view.includes(a)) hits.push(`seat ${p.seat}'s alias ${a} in the view`);
      if (holds.text.includes(a)) hits.push(`seat ${p.seat}'s alias ${a} on screen`);
    }
    const pr = holds.presenter[p.seat];
    if (pr && !holds.finished) {
      if (pr.hand) hits.push(`the presenter holds seat ${p.seat}'s hand (${pr.hand} cards)`);
      if (pr.possessed) hits.push(`the presenter marks seat ${p.seat} possessed`);
      if (pr.convertedBy != null || pr.knows || pr.notes || pr.inbox) hits.push(`the presenter holds seat ${p.seat}'s private fields`);
    }
    if (p.possessed && !holds.finished && !holds.knows.includes(p.id) && p.name) {
      const esc = p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`${esc}[^.\\n]{0,40}\\bpossessed\\b`, 'i');
      // (public lines are not a leak: the Switchboard's count, "X rang the Switchboard: 2 guests are possessed.", and
      // a quick-chat accusation anyone may make, "X is possessed!" (src/data/chat.js isPossessed))
      const said = new RegExp(`${esc} is possessed!`, 'gi');
      const shown = holds.text.split('\n').filter(l => !/rang the Switchboard/i.test(l)).map(l => l.replace(said, '')).join('\n');
      if (re.test(shown)) hits.push(`the screen names ${p.name} (seat ${p.seat}) possessed`);
    }
  }
  return hits;
}
