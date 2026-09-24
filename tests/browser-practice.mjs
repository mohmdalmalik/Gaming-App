// Headless browser test of PRACTICE mode (dev only, not part of the game).
// Setup once (from the repo root):  npm --prefix tests install
// Run:  python3 -m http.server 8123 --bind 127.0.0.1 &   then   node tests/browser-practice.mjs [--screens]
//       node tests/browser-practice.mjs --url http://127.0.0.1:8123/Gaming-App/   (Pages sub-path)
//
// One guest alone under docs/GAME_RULES.md: movement, searching, dark and locked rooms, finding
// three Lanterns, and the fire exit. No meetings.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const baseUrl = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:8123/';
const shots = args.includes('--screens');
const here = path.dirname(new URL(import.meta.url).pathname);
const outDir = path.join(here, 'shots');
fs.mkdirSync(outDir, { recursive: true });
const threeDir = path.join(here, 'node_modules/three');
const CDN = 'https://cdn.jsdelivr.net/npm/three@0.186.0/';

function findChrome() {
  const candidates = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  if (!fs.existsSync(root)) throw new Error('chromium not found: set CHROME_PATH');
  for (const d of fs.readdirSync(root)) for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
    const p = path.join(root, d, sub); if (fs.existsSync(p)) return p;
  }
  throw new Error('chromium not found');
}

const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures.push(msg); } };

const browser = await chromium.launch({ executablePath: findChrome(), headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
// iPad-landscape sized viewport with touch enabled — the primary target.
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true });
const page = await context.newPage();
const consoleMessages = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) consoleMessages.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', e => consoleMessages.push(`pageerror: ${e.message}`));
page.on('requestfailed', r => consoleMessages.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));
await page.route(`${CDN}**`, route => {
  const rel = route.request().url().slice(CDN.length).split('?')[0];
  const file = path.join(threeDir, rel);
  route.fulfill(fs.existsSync(file) ? { status: 200, contentType: 'application/javascript', body: fs.readFileSync(file) } : { status: 404, body: 'x' });
});

const game = (fn, arg) => page.evaluate(fn, arg);
const shot = async n => { if (shots) await page.screenshot({ path: path.join(outDir, `${n}.png`) }); };
const settle = async (t = 40000) => page.waitForFunction(
  () => !window.__game.activeMover().walking && window.__game.activeMover().path.length === 0, null, { timeout: t, polling: 50 });

// Is an element actually painted? (`hidden` alone is not proof — CSS can override it.)
const visible = sel => page.evaluate(s => {
  const el = document.querySelector(s);
  return !!el && el.offsetParent !== null && getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden';
}, sel);
const kind = () => game(() => window.__game.handoffKind());
const tap = async sel => { await page.click(sel); await page.waitForTimeout(70); };
const next = () => tap('#btn-handoff-next');
// Stand a guest in a room for real: the figure moves too, or the discovery watcher walks the
// rules back to where the figure is on the next frame.
const place = (index, room, ap = null) => page.evaluate(({ index, room, ap }) => {
  const g = window.__game, p = g.state.players[index], c = g.roomCenter(room);
  g.state.discovered.add(room);
  p.currentRoom = room;
  if (ap != null) p.actionPoints = ap;
  g.movers[index].reset(c[0], c[1]);
  g.discovery.refresh(); g.refresh();
}, { index, room, ap });
const put = async (room, ap = 4) => place(await game(() => window.__game.state.activeIndex), room, ap);
const give = (index, cards) => page.evaluate(({ index, cards }) => {
  const g = window.__game; g.state.players[index].hand.push(...cards); g.refresh();
}, { index, cards });
// Leaving a page while its furniture is still downloading cancels those downloads, and the game
// rightly warns that a model could not load. So before every navigation, let the current page
// finish dressing its rooms. (A genuinely missing model still fails the console check.)
const dressed = () => page.waitForFunction(() => !window.__game || window.__game.dressingDone(), null, { timeout: 90000, polling: 200 });
async function load(query) {
  if (page.url().startsWith('http')) await dressed();
  const u = baseUrl + (query ? (baseUrl.includes('?') ? '&' : '?') + query : '');
  await page.goto(u, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && !document.getElementById('btn-begin').disabled, null, { timeout: 45000 });
  // Headless software rendering runs at a few frames a second; only the walking speed is raised.
  await game(() => { window.__game.cfg.player.speed = 16; window.__game.setPixelRatio(0.5); });
}
// Click through hand-over screens until the active guest's turn is running.
async function intoTurn() {
  for (let i = 0; i < 14; i++) {
    if (await game(() => window.__game.inActionPhase() && !window.__game.handoffOpen())) return true;
    if (await game(() => window.__game.handoffOpen())) { await next(); continue; }
    return false;
  }
  return false;
}
async function throughRoles() {
  for (let i = 0; i < 20; i++) {
    if (await kind() === 'turn') return;
    if (await game(() => window.__game.handoffOpen())) await next(); else return;
  }
}
// A room that can be searched with no fuss: not dark, not locked, nothing lying in it.
const plainRoom = () => game(() => {
  const g = window.__game;
  return g.floor.roomList.find(r => r.searchable && !r.dark && !g.state.lockedRooms.has(r.id) && !g.state.roomDrops.has(r.id)).id;
});
const finish = async () => {
  await dressed();
  const noisy = consoleMessages.filter(m => !/favicon/i.test(m));
  check(noisy.length === 0, noisy.length ? `console noise:\n    ${noisy.slice(0, 6).join('\n    ')}` : 'no console errors or failed requests (clean)');
  await browser.close();
};

console.log('1. practice loads');
await load('');
const info = await game(() => ({
  problems: window.__game.floor.problems, rooms: window.__game.floor.roomList.length,
  practice: window.__game.state.practice, players: window.__game.state.players.length,
  ap: window.__game.rules.actionPointsPerTurn, move: window.__game.rules.actionCost.move, discover: window.__game.rules.actionCost.discover,
  dealt: window.__game.activePlayer().hand.filter(c => c.type === 'lantern').length,
  inPile: window.__game.state.drawPile.filter(c => c.type === 'lantern').length,
  locked: window.__game.lockedRooms(), timer: window.__game.rules.turnTimerEnabled,
}));
check(info.problems.length === 0, 'no floor problems');
check(info.rooms === 18 && info.practice && info.players === 1, '18 rooms, one guest, practice mode');
check(info.ap === 4 && info.move === 1 && info.discover === 0, '4 action points; any move costs 1');
check(info.dealt === 0 && info.inPile === 12, 'no Lantern is dealt; all 12 are in the deck, to be found by searching');
check(info.locked.length === 2, 'two locked rooms');
check(info.timer === false, 'no turn timer in practice');
await tap('#btn-begin');
await page.waitForFunction(() => window.__game.isRunning(), null, { timeout: 8000 });
check(!(await visible('#handoff-overlay')), 'no pass-the-device screens alone');
await shot('pr-01-start');

console.log('\n2. interface');
check(await visible('#health-row') && await game(() => document.querySelectorAll('#health .bar').length) === 3, 'three health bars are shown');
check(!(await visible('.hud-top-center')), 'no guest strip for a single guest');
check(!(await visible('#btn-trade')) && !(await visible('#possess-tint')) && !(await visible('#turn-timer')), 'no trade, no tint, no clock');
check(await visible('#btn-restart-practice'), 'Restart practice is there');
check((await page.textContent('#round')).trim() === 'Round 1', 'the round has no "of 8": practice has no dawn deadline');
check(await game(() => [...window.__game.doorways.views.values()].filter(v => v.blink.visible).length) === 4, 'four usable doors blink from the lobby');

console.log('\n3. movement');
await game(() => window.__game.moveToRoom('corridorE'));
await settle();
let a = await game(() => ({ room: window.__game.activePlayer().currentRoom, ap: window.__game.activePlayer().actionPoints }));
check(a.room === 'corridorE' && a.ap === 3, 'walking into a new room costs 1');
await game(() => window.__game.moveToRoom('hall'));
await settle();
a = await game(() => ({ room: window.__game.activePlayer().currentRoom, ap: window.__game.activePlayer().actionPoints }));
check(a.room === 'hall' && a.ap === 2, 'walking back into a known room also costs 1');
await game(() => window.__game.walkTo(1.2, 1.2));
await settle();
check(await game(() => window.__game.activePlayer().actionPoints) === 2, 'moving about inside a room is free');
await game(() => window.__game.endTurn());
check(await game(() => window.__game.activePlayer().actionPoints) === 4, 'End turn refills to 4');

console.log('\n4. searching');
const plain = await plainRoom();
await put(plain, 4);
const before = await game(() => window.__game.activePlayer().hand.length);
await tap('#btn-search');
check(await game(() => window.__game.activePlayer().hand.length) === before + 1, 'searching draws one card');
check((await page.textContent('#search-sub')).includes('Already searched'), 'a room gives up its draw once');
const dark = await game(() => window.__game.floor.roomList.find(r => r.dark && r.searchable && !window.__game.state.lockedRooms.has(r.id) && !window.__game.state.roomDrops.has(r.id))?.id);
await put(dark, 4);
await game(() => { const p = window.__game.activePlayer(); p.hand = p.hand.filter(c => c.type !== 'flashlight'); window.__game.refresh(); });
check((await page.textContent('#search-sub')).includes('Flashlight'), 'a dark room says it needs a Flashlight');
await give(0, [{ id: 'fl1', type: 'flashlight' }]);
await tap('#btn-search');
check(await game(() => window.__game.state.searchedRooms.has(window.__game.activePlayer().currentRoom)), 'with a Flashlight the dark room can be searched');
check(await game(() => window.__game.activePlayer().hand.some(c => c.id === 'fl1')), 'and the Flashlight is kept');

console.log('\n5. locked rooms');
const locked = await game(() => window.__game.lockedRooms()[0]);
const nb = await game(l => [...window.__game.floor.rooms.get(l).neighbours][0], locked);
await put(nb, 4);
check(await game(() => window.__game.moveToRoom(window.__game.lockedRooms()[0]).ok) === false, 'you cannot walk into a locked room');
await give(0, [{ id: 'mk', type: 'masterKey' }]);
await game(() => window.__game.openHand());
check(await visible('#hand-overlay'), 'the hand sheet opens');
await page.click('#hand-cards .card-tile[data-card-id="mk"]');
await page.waitForTimeout(80);
check((await page.textContent('#hand-detail')).includes('Open '), 'a Master Key offers to open the locked room next door');
await page.click('#hand-detail .btn.primary');
await page.waitForTimeout(150);
check(await game(l => !window.__game.state.lockedRooms.has(l), locked), 'the room is unlocked');
check(await game(() => window.__game.activePlayer().actionPoints) === 3, 'for 1 action point');
await game(l => window.__game.moveToRoom(l), locked);
await settle();
check(await game(() => window.__game.activePlayer().currentRoom) === locked, 'and can now be entered');

console.log('\n6. barricade');
await put('corridorE', 4);
await give(0, [{ id: 'bar', type: 'barricade' }]);
const door = await game(() => window.__game.floor.rooms.get('corridorE').doorways.find(d => d.otherRoom('corridorE') === 'hall').id);
await game(d => window.__game.barricade('bar', d), door);
check(await game(() => window.__game.moveToRoom('hall').ok) === false, 'a barricaded doorway cannot be passed');
check(await game(() => window.__game.activePlayer().actionPoints) === 3, 'a Barricade costs 1 action point');
await game(() => window.__game.endTurn());
check(await game(() => window.__game.moveToRoom('hall').ok) === true, 'it comes down after one round');
await settle();

console.log('\n7. finding three Lanterns and the fire exit');
// A fresh start on the fixed practice deal, then search room after room for real until three
// Lanterns have turned up.
await tap('#btn-restart-practice');
check(await game(() => window.__game.activePlayer().hand.some(c => c.type === 'flashlight')), 'the fixed practice deal includes a Flashlight for the dark rooms');
const rooms = await game(() => window.__game.floor.roomList.filter(r => r.searchable).map(r => r.id));
let searched = 0, fullHandChecked = false;
for (const r of rooms) {
  if (await game(() => window.__game.lanterns()) >= 3) break;
  await game(r => { window.__game.state.lockedRooms.delete(r); }, r);
  await put(r, 4);
  await tap('#btn-search');
  // A full hand: keep a Lantern (dropping something that is not one); leave anything else.
  if (await game(() => window.__game.fullHandOpen())) {
    const isLantern = await page.evaluate(() => !!document.querySelector('#fullhand-found .card-tile [alt="Lantern"], #fullhand-found .card-tile')
      && /Lantern/.test(document.getElementById('fullhand-found').textContent));
    if (isLantern) {
      await tap('#btn-fullhand-take');
      const drop = await page.evaluate(() => [...document.querySelectorAll('#fullhand-hand .card-tile')].find(t => !/Lantern|Flashlight/.test(t.textContent))?.dataset.cardId);
      // Every card in the hand must be fully on screen and tappable (six cards used to overflow).
      if (!fullHandChecked) {
        fullHandChecked = true;
        const fit = await page.evaluate(() => [...document.querySelectorAll('#fullhand-hand .card-tile')].map(t => {
          const r = t.getBoundingClientRect(); const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && t.contains(top);
        }));
        check(fit.length >= 6 && fit.every(Boolean), `with a full hand, all ${fit.length} cards to choose from are on screen and tappable`);
        await shot('pr-02b-fullhand');
      }
      await page.click(`#fullhand-hand .card-tile[data-card-id="${drop}"]`); await page.waitForTimeout(80);
    } else await tap('#btn-fullhand-leave');
  }
  searched++;
}
const held = await game(() => window.__game.lanterns());
check(held >= 3, `searching ${searched} rooms turned up ${held} Lanterns`);
check(/Lantern/.test(await page.textContent('#toast')), 'the search message keeps count of the Lanterns you hold');
check(await game(() => Number(document.getElementById('hand-count').textContent) === window.__game.activePlayer().hand.length), 'Lanterns count in the hand like any card');
await game(() => window.__game.toggleMap());
await page.waitForTimeout(150);
check(await game(() => window.__game.isMapOpen()), 'the map opens');
await shot('pr-02-map');
await game(() => window.__game.toggleMap());
await put('stairs', 4);
await game(() => window.__game.moveToRoom(window.__game.floor.exitRoom));
await settle();
await page.waitForTimeout(300);
check(await game(() => window.__game.isFinished()), 'entering the fire exit with three Lanterns ends the practice run');
check(await visible('#end-overlay') && /fire exit/i.test(await page.textContent('#end-title')), 'the end screen says so');
await shot('pr-03-end');
await tap('#btn-restart');
check(await game(() => !window.__game.isFinished() && window.__game.activePlayer().currentRoom === 'hall'), 'Restart practice puts the guest back in the lobby');

console.log('\n8. layouts');
for (const [name, w, h] of [['ipad-landscape', 1180, 820], ['ipad-small', 1024, 768], ['desktop', 1440, 900]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(120);
  const r = await page.evaluate(() => {
    const b = document.querySelector('.hud-bottom').getBoundingClientRect();
    const e = document.getElementById('btn-end-turn').getBoundingClientRect();
    return { inside: b.right <= window.innerWidth + 1 && b.bottom <= window.innerHeight + 1, endH: e.height };
  });
  check(r.inside, `${name}: the bottom bar fits on screen`);
  check(r.endH >= 44, `${name}: End turn is a comfortable touch size`);
}
await page.setViewportSize({ width: 1180, height: 820 });

console.log('\n9. console');
await finish();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PRACTICE BROWSER CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
