// Screenshots of the card art inside the game UI (dev only): the hand sheet, the end-of-turn
// discard prompt, a private trade pick and the Hand Mirror's private screen, at iPad landscape size.
//   python3 -m http.server 8123 --bind 127.0.0.1 &      (from the repo root)
//   node tools/card-pipeline/ui-shots.mjs [outDir]       (needs `npm --prefix tests install` once)
import { chromium } from '../../tests/node_modules/playwright-core/index.mjs';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const outDir = process.argv[2] || path.join(here, 'build', 'ui');
fs.mkdirSync(outDir, { recursive: true });
const baseUrl = 'http://127.0.0.1:8123/';
const threeDir = path.join(here, '../../tests/node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on('pageerror', e => errors.push(e.message));
page.on('requestfailed', r => errors.push(`requestfailed ${r.url()}`));
await page.route(`${CDN}**`, route => {
  const rel = route.request().url().slice(CDN.length).split('?')[0];
  const file = path.join(threeDir, rel);
  route.fulfill(fs.existsSync(file) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(file) } : { status: 404, body: 'x' });
});
const game = (fn, arg) => page.evaluate(fn, arg);
const tap = async sel => { await page.click(sel); await page.waitForTimeout(90); };
const imgsReady = () => page.waitForFunction(() => [...document.images].every(i => i.complete), null, { timeout: 10000 }).catch(() => {});
const shot = async n => { await imgsReady(); await page.waitForTimeout(250); await page.screenshot({ path: path.join(outDir, `${n}.png`) }); console.log('shot', n); };
const dressed = () => page.waitForFunction(() => !window.__game || window.__game.dressingDone(), null, { timeout: 90000, polling: 200 });
async function load(query) {
  if (page.url().startsWith('http')) await dressed();
  await page.goto(baseUrl + '?' + query, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && !document.getElementById('btn-begin').disabled, null, { timeout: 45000 });
  await game(() => { window.__game.cfg.player.speed = 16; window.__game.setPixelRatio(0.5); });
  await game(() => { window.__game.revealTile('corridorE', 'hall'); window.__game.revealTile('corridorW'); });
}
async function intoTurn() {
  for (let i = 0; i < 20; i++) {
    if (await game(() => window.__game.inActionPhase() && !window.__game.handoffOpen())) return;
    if (await game(() => window.__game.handoffOpen())) { await tap('#btn-handoff-next'); continue; }
    return;
  }
}
const place = (index, room, ap = null) => page.evaluate(({ index, room, ap }) => {
  const g = window.__game, p = g.state.players[index], c = g.roomCenter(room);
  g.state.discovered.add(room); p.currentRoom = room;
  if (ap != null) p.actionPoints = ap;
  g.movers[index].reset(c[0], c[1]); g.discovery.refresh(); g.refresh();
}, { index, room, ap });
const clickBtn = async (sel, text) => {
  for (const h of await page.$$(sel)) if ((await h.textContent()).trim().startsWith(text)) { await h.click(); await page.waitForTimeout(90); return true; }
  return false;
};

const ALL = ['lantern', 'bandage', 'flashlight', 'knife', 'revolver', 'barricade', 'lockPick', 'masterKey', 'handMirror', 'espresso'];

// 1. practice: the hand sheet with one of every card, then the discard prompt
await load('mode=practice&seed=4242&timer=off');
await tap('#btn-begin'); await intoTurn();
await game(all => { const g = window.__game; g.activePlayer().hand = all.map((t, i) => ({ id: 'h' + i, type: t, ...(t === 'revolver' ? { shots: 2 } : {}) })); g.refresh(); }, ALL);
await tap('#hand-strip');
await page.click('#hand-cards .card-tile[data-card-id="h4"]'); await page.waitForTimeout(120);
await shot('1-hand-sheet');
await page.evaluate(() => { const el = document.querySelector('#hand-cards'); if (el) el.scrollTop = 1e4; });
await shot('1b-hand-sheet-scrolled');
await tap('#btn-hand-close');
await game(() => window.__game.endTurn());
await page.waitForTimeout(200);
await shot('2-discard');

// 2. hot-seat: a private trade pick, then the Hand Mirror's private screen
await load('mode=hotseat&players=6&seed=4242&timer=off');
await tap('#btn-begin'); await intoTurn();
await game(() => {
  const s = window.__game.state;
  s.players.forEach((p, i) => { p.possessed = i === 1; p.notes = []; p.knows = new Set(); });
  s.players[0].hand = [{ id: 'p1', type: 'bandage' }, { id: 'p2', type: 'knife' }, { id: 'p3', type: 'masterKey' }, { id: 'p4', type: 'espresso' }, { id: 'hm1', type: 'handMirror' }];
  s.players[1].hand = [{ id: 'e1', type: 'lantern' }, { id: 'e2', type: 'revolver', shots: 1 }, { id: 'e3', type: 'lockPick' }, { id: 'x1', type: 'possession' }, { id: 'x2', type: 'possession' }];
  s.activeIndex = 0; window.__game.refresh();
});
await place(1, 'corridorE');
await place(0, 'hall', 4);
await game(() => window.__game.moveToRoom('corridorE'));
await page.waitForFunction(() => window.__game.meetingOpen(), null, { timeout: 40000 }).catch(() => {});
if (await clickBtn('#encounter-actions .btn', 'Trade')) await shot('3-trade-pick');
// back out of the trade by staging the mirror on a fresh load
await load('mode=hotseat&players=6&seed=4242&timer=off');
await tap('#btn-begin'); await intoTurn();
await game(() => {
  const s = window.__game.state;
  s.players.forEach((p, i) => { p.possessed = i === 1; p.notes = []; p.knows = new Set(); });
  s.players[0].hand = [{ id: 'hm1', type: 'handMirror' }, { id: 'pb', type: 'bandage' }];
  s.players[1].hand = [{ id: 'e1', type: 'lantern' }, { id: 'e2', type: 'barricade' }, { id: 'e3', type: 'flashlight' }, { id: 'x1', type: 'possession' }, { id: 'x2', type: 'possession' }, { id: 'x3', type: 'possession' }];
  s.activeIndex = 0; window.__game.refresh();
});
await place(1, 'corridorE');
await place(0, 'corridorE', 4);
await tap('#hand-strip');
await page.click('#hand-cards .card-tile[data-card-id="hm1"]'); await page.waitForTimeout(120);
const names = await game(() => window.__game.state.players.map(p => p.name));
await clickBtn('#hand-detail .d-targets .btn', names[1]);
await page.waitForTimeout(200);
await shot('4-mirror');
await dressed();
console.log(errors.length ? 'errors:\n  ' + errors.join('\n  ') : 'no page errors');
await browser.close();
