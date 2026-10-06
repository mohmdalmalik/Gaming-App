// Headless browser test of PRACTICE mode (dev only, not part of the game).
// Setup once (from the repo root):  npm --prefix tests install
// Run:  python3 -m http.server 8123 --bind 127.0.0.1 &   then   node tests/browser-practice.mjs [--screens]
//       node tests/browser-practice.mjs --url http://127.0.0.1:8123/Gaming-App/   (Pages sub-path)
//
// One guest alone under docs/GAME_RULES.md in a random hotel: opening doors and moving, searching,
// dark and locked rooms, a Linen Store's two-card draw, finding three Lanterns, and the fire exit.
// No meetings.
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
// Taps the hand-over screen's own button (Continue, Done, I understand…).
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
// Searching is the magnifier over the room's search spot (#search-spot): tap it, the guest walks up to
// the furniture and searches. Resolves once the walk and the search are done (the reveal is then up;
// everything found goes into the hand, even past the limit).
async function searchHere() {
  await page.click('#search-spot');
  await page.waitForFunction(() => !window.__game.searchPending() && !window.__game.activeMover().walking && window.__game.activeMover().path.length === 0, null, { timeout: 40000, polling: 50 });
  await page.waitForTimeout(80);
}
// The found-card reveal: read it, then "Add to my hand".
const revealText = () => page.evaluate(() => document.getElementById('handoff-notes').textContent);
const revealIds = () => page.evaluate(() => [...document.querySelectorAll('#handoff-found .big-card')].map(c => c.dataset.cardId));
async function takeReveal() { if (await kind() === 'found') await next(); }
const spot = () => game(() => window.__game.searchSpot());
const fanIds = () => game(() => window.__game.fanIds());
const handIds = () => game(() => window.__game.activePlayer().hand.map(c => c.id));
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
// Wait for n drawn frames (headless draws only a few a second).
const frames = n => page.evaluate(n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
// After a resize the cards glide to their new places (a short CSS transition): wait until they stop.
const fanStill = () => page.waitForFunction(() => {
  const now = [...document.querySelectorAll('#hand-fan .fan-card')].map(c => { const r = c.getBoundingClientRect(); return `${Math.round(r.left)},${Math.round(r.top)}`; }).join(';');
  const same = now === window.__fanLast; window.__fanLast = now; return same && now !== '';
}, null, { timeout: 15000, polling: 250 });
// For every card in the fan: is the part of it that shows (left of the next card) really that card
// under a finger, and is the card on screen? The point is worked out in the card's own turned frame.
const fanReach = () => page.evaluate(() => {
  const els = [...document.querySelectorAll('#hand-fan .fan-card')];
  const px = el => parseFloat(el.style.getPropertyValue('--x')) || 0;
  return els.map((c, i) => {
    const W = c.offsetWidth, H = c.offsetHeight, parent = c.offsetParent.getBoundingClientRect();
    const u = i < els.length - 1 ? Math.min(W / 2, (px(els[i + 1]) - px(c)) / 2) : W / 2, v = H * 0.5;
    const m = new DOMMatrix().translate(W / 2, H).multiply(new DOMMatrix(getComputedStyle(c).transform)).translate(-W / 2, -H);
    const p = m.transformPoint(new DOMPoint(u, v));
    const x = parent.left + c.offsetLeft + p.x, y = parent.top + c.offsetTop + p.y;
    const r = c.getBoundingClientRect();
    // (at rest a card is held partly below the screen edge; at least 70% of it shows)
    return { id: c.dataset.cardId, hit: c.contains(document.elementFromPoint(x, y)), inside: r.left >= 0 && r.right <= innerWidth && innerHeight - r.top >= 0.7 * H };
  });
});
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
await load(`seed=${process.env.PRACTICE_SEED || 20260917}`);   // a fixed hotel, so every run explores the same one
const info = await game(() => ({
  problems: window.__game.floor.problems, rooms: window.__game.hotelRooms().length,
  practice: window.__game.state.practice, players: window.__game.state.players.length,
  ap: window.__game.rules.actionPointsPerTurn, move: window.__game.rules.actionCost.move, open: window.__game.rules.actionCost.open,
  dealt: window.__game.activePlayer().hand.filter(c => c.type === 'lantern').length,
  hand: window.__game.activePlayer().hand.length,
  inPile: window.__game.state.drawPile.filter(c => c.type === 'lantern').length, pile: window.__game.state.drawPile.length,
  locked: window.__game.lockedRooms(), timer: window.__game.rules.turnTimerEnabled,
}));
check(info.problems.length === 0, 'no floor problems');
check(info.practice && info.players === 1, 'one guest, practice mode');
check(info.ap === 4 && info.move === 1 && info.open === 1, '4 action points; opening a door costs 1, a move costs 1');
check(info.dealt === 1 && info.hand === 4, 'the same deal as a match: the guest starts with 1 Lantern + 3 other cards');
check(info.inPile === 13 && info.pile === 44, `the other 13 Lanterns are in the ${info.pile}-card deck (48 less a hand of 4), to be found by searching`);
check(info.locked.length === 0 && info.rooms === 1, 'the hotel starts as just the lobby; nothing is locked yet');
check(info.timer === false, 'no turn timer in practice');
const startSub = (await page.textContent('#start-sub')).replace(/\s+/g, ' ').trim();
check(/You start with 1 Lantern — find 2 more and escape through the Fire Exit/.test(startSub),
  `the start screen says the guest starts with 1 Lantern and must find 2 more ("${startSub}")`);
await tap('#btn-begin');
await page.waitForFunction(() => window.__game.isRunning(), null, { timeout: 8000 });
check(!(await visible('#handoff-overlay')), 'no pass-the-device screens alone');
await shot('pr-01-start');

console.log('\n2. interface');
check(await visible('#health-row') && await game(() => document.querySelectorAll('#health .bar').length) === 3, 'three health bars are shown');
check(!(await visible('.hud-top-center')), 'no guest strip for a single guest');
check(!(await visible('#btn-trade')) && !(await visible('#possess-tint')) && !(await visible('#turn-timer')), 'no trade, no tint, no clock');
check(await visible('#btn-restart-practice'), 'Restart practice is there');
check(!(await page.$('#btn-search')) && !(await page.evaluate(() => [...document.querySelectorAll('.action-row button')].some(b => b.offsetParent && /^\s*Search/.test(b.textContent)))),
  'there is no Search button: searching is done from the room');
check(!(await page.$('#hand-strip')) && await visible('#hand-fan'), 'the hand is a fan of cards, not a "cards in hand" button');
check(sameSet(await fanIds(), await handIds()) && (await fanIds()).length === 4, 'the fan holds the four dealt cards, face up');
check(await spot().then(s => s.mode) === null && !(await visible('#search-spot')), 'the lobby has no search icon (nothing to search there)');
check((await page.textContent('#round')).trim() === 'Round 1', 'the round has no "of 8": practice has no dawn deadline');
const lobbyDoors = await game(() => window.__game.closedDoors().length);
check(lobbyDoors === 3 || lobbyDoors === 4, `the lobby has ${lobbyDoors} closed doors (3 or 4)`);
check(await game(() => [...window.__game.doorways.views.values()].filter(v => v.blink.visible).length) === lobbyDoors, 'each has a ring: it can be opened');

console.log('\n3. opening a door, then moving');
const first = await game(() => window.__game.closedDoors()[0].id);
await game(d => window.__game.openDoor(d), first);
let a = await game(() => ({ room: window.__game.activePlayer().currentRoom, ap: window.__game.activePlayer().actionPoints, rooms: window.__game.hotelRooms() }));
check(a.rooms.length === 2 && a.ap === 3 && a.room === 'hall', 'opening a door costs 1, reveals the room behind it, and you stay put');
const opened = a.rooms[1];
check(await game(r => window.__game.roomViews.has(r), opened), 'the new room appears');
await game(r => window.__game.moveToRoom(r), opened);
await settle();
a = await game(() => ({ room: window.__game.activePlayer().currentRoom, ap: window.__game.activePlayer().actionPoints }));
check(a.room === opened && a.ap === 2, 'going in is a normal move: 1');
await game(() => window.__game.moveToRoom('hall'));
await settle();
a = await game(() => ({ room: window.__game.activePlayer().currentRoom, ap: window.__game.activePlayer().actionPoints }));
check(a.room === 'hall' && a.ap === 1, 'walking back also costs 1');
await game(() => window.__game.walkTo(1.2, 1.2));
await settle();
check(await game(() => window.__game.activePlayer().actionPoints) === 1, 'moving about inside a room is free');
await game(() => window.__game.endTurn());
check(await game(() => window.__game.activePlayer().actionPoints) === 4, 'End turn refills to 4');

console.log('\n4. searching from the room');
await game(() => window.__game.revealTile('lounge'));
const plain = 'lounge';
await put(plain, 4);
await settle();
await game(() => { const g = window.__game, m = g.activeMover(); g.rig.setFocus(m.x, m.z, true); });   // (the camera eases slowly in headless: jump it)
await page.waitForTimeout(400);
{
  const s1 = await spot();
  check(s1.mode === 'live' && await visible('#search-spot'), 'an unsearched room shows the search icon');
  const flagged = await game(() => window.__game.floor.rooms.get('lounge').furniture.filter(f => f.search).map(f => ({ kind: f.kind, center: f.center })));
  check(flagged.length === 1 && s1.spot && s1.spot.kind === flagged[0].kind && s1.spot.center.join() === flagged[0].center.join(),
    `it belongs to the furniture flagged as the search spot (${s1.spot?.kind})`);
  // It rests on that furniture: the badge's foot on the piece as the live camera sees it. If that spot
  // is taken by the interface (or off the screen) it moves to the nearest clear place, and a small arrow
  // on the badge points back at the furniture.
  await frames(6);
  const a = await game(() => {
    const g = window.__game, f = g.floor.rooms.get('lounge').furniture.find(f => f.search), cam = g.view.camera;
    const V = cam.position.constructor, W = innerWidth, H = innerHeight;
    const scr = (x, y, z) => { const v = new V(x, y, z).project(cam); return [(v.x + 1) / 2 * W, (1 - v.y) / 2 * H]; };
    const pts = [];
    for (const x of [f.min[0], f.max[0]]) for (const z of [f.min[1], f.max[1]]) for (const y of [0, f.size[1]]) pts.push(scr(x, y, z));
    const b = document.querySelector('#search-spot .ss-badge').getBoundingClientRect();
    const arrow = getComputedStyle(document.querySelector('#search-spot .ss-arrow')).display !== 'none';
    return { x0: Math.min(...pts.map(p => p[0])), x1: Math.max(...pts.map(p => p[0])), y0: Math.min(...pts.map(p => p[1])), y1: Math.max(...pts.map(p => p[1])),
      icon: g.searchSpot().point, foot: b.bottom, arrow };
  });
  const onIt = !!a.icon && a.icon.x >= a.x0 && a.icon.x <= a.x1 && a.foot >= a.y0 - 12 && a.foot <= a.y1 + 4;
  check(!!a.icon && (a.arrow || onIt),
    `on that furniture (icon ${a.icon?.x},${a.icon?.y}, foot at ${Math.round(a.foot)}; furniture ${Math.round(a.x0)}–${Math.round(a.x1)} × ${Math.round(a.y0)}–${Math.round(a.y1)}${a.arrow ? '; moved clear of the interface, arrow pointing at it' : ''})`);
  const box = await page.evaluate(() => { const r = document.querySelector('#search-spot .ss-badge').getBoundingClientRect(); return { w: r.width, h: r.height }; });
  check(box.w >= 48 && box.h >= 48, `big enough to tap (${Math.round(box.w)}×${Math.round(box.h)} px)`);
  await shot('ui-search-lounge');
}
const before = await game(() => window.__game.activePlayer().hand.length);
const top1 = await game(() => window.__game.state.drawPile[0].id);
const start4 = await game(() => { const m = window.__game.activeMover(); return [m.x, m.z]; });
await searchHere();
{
  const g4 = await game(() => { const g = window.__game, m = g.activeMover(), f = g.floor.rooms.get('lounge').furniture.find(f => f.search);
    const dx = Math.max(f.min[0] - m.x, 0, m.x - f.max[0]), dz = Math.max(f.min[1] - m.z, 0, m.z - f.max[1]);
    return { gap: Math.hypot(dx, dz), x: m.x, z: m.z, ap: g.activePlayer().actionPoints }; });
  check(Math.hypot(g4.x - start4[0], g4.z - start4[1]) > 0.5 && g4.gap < 1.0, `tapping it walks the guest up to the furniture (${g4.gap.toFixed(2)} m from it)`);
  check(g4.ap === 3, 'and searches, for 1 action (the walk inside the room is free)');
}
check(await kind() === 'found' && sameSet(await revealIds(), [top1]), 'the card found is shown large');
{
  const r = await page.evaluate(() => { const c = document.querySelector('#handoff-found .big-card'); return c && { img: c.querySelector('img')?.getAttribute('src'), name: c.querySelector('.bc-name')?.textContent, desc: c.querySelector('.bc-desc')?.textContent, w: c.getBoundingClientRect().width }; });
  const meta = await game(id => { const c = window.__game.activePlayer().hand.find(c => c.id === id); return window.__game.rules.cards[c.type]; }, top1);
  check(r && /assets\/cards\/face\//.test(r.img) && r.name === meta.name && r.desc === meta.desc && r.w >= 150,
    `with its card face, its name and what it does ("${r?.name}", ${Math.round(r?.w)} px wide)`);
  check(/You search .+ and find an? /.test(await revealText()), 'and the search is described');
  check(!(await visible('#hand-fan')) && !(await visible('#search-spot')), 'the fan and the icon step aside while it is shown');
}
await shot('ui-search-reveal');
await next();
check(await game(() => window.__game.activePlayer().hand.length) === before + 1, 'searching draws one card');
check(sameSet(await fanIds(), await handIds()) && (await fanIds()).includes(top1), 'it goes into the hand: the fan now shows it too');
check((await spot()).mode === null && !(await visible('#search-spot')), 'the icon is gone once the room is searched (a room gives up its draw once)');
await game(() => window.__game.revealTile('storage'));
const dark = 'storage';
await put(dark, 4);
await game(() => { const p = window.__game.activePlayer(); p.hand = p.hand.filter(c => c.type !== 'flashlight'); window.__game.refresh(); });
await settle();
await page.waitForTimeout(400);
check((await spot()).mode === 'dark' && await visible('#search-spot .ss-hint'), 'a dark room shows the icon dimmed, with a flashlight hint');
check(/Flashlight/.test(await page.textContent('#search-spot .ss-caption')), `which says what is needed ("${(await page.textContent('#search-spot .ss-caption')).trim()}")`);
await shot('ui-search-dark');
{
  const ap = await game(() => window.__game.activePlayer().actionPoints);
  await page.click('#search-spot'); await page.waitForTimeout(150);
  check((await page.textContent('#toast')).trim() === 'Too dark to search — you need a Flashlight.', 'tapping it says it is too dark without a Flashlight');
  check(await game(() => window.__game.activePlayer().actionPoints) === ap && !(await game(() => window.__game.handoffOpen())), 'and nothing is spent');
}
await give(0, [{ id: 'fl1', type: 'flashlight' }]);
await page.waitForTimeout(200);
check((await spot()).mode === 'live', 'with a Flashlight in hand the icon lights up');
await searchHere();
await takeReveal();
check(await game(() => window.__game.state.searchedRooms.has(window.__game.activePlayer().currentRoom)), 'with a Flashlight the dark room can be searched');
check(await game(() => window.__game.activePlayer().hand.some(c => c.id === 'fl1')), 'and the Flashlight is kept');
// No action points left: dimmed, and a tap explains.
await game(() => window.__game.revealTile('dining'));
await put('dining', 0);
await page.waitForTimeout(300);
check((await spot()).mode === 'ap', 'with no action points left the icon is dimmed');
await page.click('#search-spot'); await page.waitForTimeout(150);
check(/No action points left/.test(await page.textContent('#toast')), 'and a tap explains why');
await game(() => { window.__game.activePlayer().actionPoints = 4; window.__game.refresh(); });

console.log('\n4b. the hand, held as a fan of cards');
{
  const want = ['lantern', 'bandage', 'knife'];
  await game(w => { const p = window.__game.activePlayer(); p.hand = w.map((t, i) => ({ id: `h${i}`, type: t })); window.__game.refresh(); }, want);
  await page.waitForTimeout(200);
  const f = await page.evaluate(() => [...document.querySelectorAll('#hand-fan .fan-card')].map(c => ({ id: c.dataset.cardId, type: c.dataset.type, src: c.querySelector('img')?.getAttribute('src'), r: getComputedStyle(c).transform })));
  check(f.length === 3 && sameSet(f.map(c => c.id), ['h0', 'h1', 'h2']), 'the fan shows exactly the cards in hand');
  check(f.every(c => c.src === `assets/cards/face/${c.type}.jpg`), 'each as its card face');
  check(new Set(f.map(c => c.r)).size === 3, 'fanned: each card sits at its own angle');
  await shot('ui-hand-3');
  await page.click('#hand-fan .fan-card[data-card-id="h1"]');
  await page.waitForTimeout(150);
  check(await visible('#hand-overlay') && await game(() => window.__game.cardViewId()) === 'h1', 'tapping a card opens it large');
  check(await page.evaluate(() => !!document.querySelector('#hand-big .big-card[data-card-id="h1"] img[src="assets/cards/face/bandage.jpg"]')), 'with its full card face');
  check((await page.textContent('#hand-detail .d-name')).trim() === 'Bandage' && /Restores 1 health/.test(await page.textContent('#hand-detail')), 'its name and what it does');
  check(/Use · 1 action/.test(await page.textContent('#hand-detail')) && /full health/i.test(await page.textContent('#hand-detail')), 'and its action (Use — not now: already at full health)');
  await shot('ui-hand-detail');
  await tap('#btn-hand-next');
  check(await game(() => window.__game.cardViewId()) === 'h2', '› steps to the next card');
  await page.mouse.click(8, 400); await page.waitForTimeout(120);
  check(!(await visible('#hand-overlay')), 'tapping outside puts it away');
  await page.click('#hand-fan .fan-card[data-card-id="h0"]'); await page.waitForTimeout(120);
  await tap('#btn-hand-close');
  check(!(await visible('#hand-overlay')), 'and so does Close');
  // A big hand: eight cards still fit between the panel and the buttons, every one of them tappable.
  await game(() => { const p = window.__game.activePlayer(); p.hand = ['lantern', 'lantern', 'bandage', 'knife', 'masterKey', 'handMirror', 'espresso', 'barricade'].map((t, i) => ({ id: `b${i}`, type: t })); window.__game.refresh(); });
  await page.waitForTimeout(250);
  await page.waitForFunction(() => !document.querySelector('#hand-fan .fan-card.dealt'), null, { timeout: 10000 });   // (the new cards finish dealing in)
  await fanStill();
  const big = await fanReach();
  check(big.length === 8 && big.every(c => c.hit && c.inside), `eight cards all fit on screen and each can be tapped (${big.filter(c => c.hit).length}/8)`);
  // Held like a hand: the cards rest partly below the screen edge; a finger on one lifts it into full view.
  await page.waitForFunction(() => !document.querySelector('#hand-fan .fan-card.dealt'), null, { timeout: 10000 });   // (the new cards finish dealing in)
  const lifted = await page.evaluate(() => new Promise(res => {
    const c = document.querySelector('#hand-fan .fan-card[data-card-id="b3"]');
    const before = c.getBoundingClientRect().bottom;
    c.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    // (headless draws a few frames a second: wait for the rise, up to 4 s)
    const t0 = performance.now();
    const look = () => {
      const r = c.getBoundingClientRect();
      if (r.bottom <= innerHeight + 1 || performance.now() - t0 > 4000) { c.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); res({ before, after: r.bottom, h: innerHeight }); }
      else requestAnimationFrame(look);
    };
    requestAnimationFrame(look);
  }));
  check(lifted.before > lifted.h && lifted.after <= lifted.h + 1, `a card rests partly below the edge and rises fully when touched (bottom ${Math.round(lifted.before)} → ${Math.round(lifted.after)} px of ${lifted.h})`);
  // Over the limit during a turn is allowed: a calm reminder sits above the fan, clear of everything.
  const warn = await page.evaluate(() => {
    const el = document.querySelector('#hand-fan .fan-limit');
    if (!el || el.hidden) return null;
    const r = el.getBoundingClientRect(), pp = document.getElementById('player-panel').getBoundingClientRect();
    const btns = [...document.querySelectorAll('.hud-bottom-right .btn, .hud-bottom-right .ctl')].filter(b => b.offsetParent).map(b => b.getBoundingClientRect());
    const hit = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    return { text: el.textContent, inside: r.left >= 0 && r.right <= innerWidth && r.top >= 0, clear: !hit(r, pp) && !btns.some(b => hit(r, b)),
      end: document.getElementById('btn-end-turn').textContent };
  });
  check(warn?.text === 'Cards 8/6 · discard 2 at end of turn', `with 8 cards a gentle reminder shows above the fan ("${warn?.text}")`);
  check(warn?.inside && warn?.clear, 'on screen, clear of the guest panel and the buttons');
  check(/Discard 2 first/.test(warn?.end || ''), `and End turn says what comes first ("${(warn?.end || '').replace(/\s+/g, ' ').trim()}")`);
  // One line at both iPad sizes (it wrapped to two before it was shortened).
  const lines = () => page.evaluate(() => {
    const el = document.querySelector('#hand-fan .fan-limit'), r = document.createRange(); r.selectNodeContents(el);
    return new Set([...r.getClientRects()].map(q => Math.round(q.top))).size;
  });
  const sizes = [];
  for (const [w, h] of [[1180, 820], [1024, 768]]) { await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(250); sizes.push(`${w}x${h}: ${await lines()}`); }
  await page.setViewportSize({ width: 1180, height: 820 }); await page.waitForTimeout(250);
  check(sizes.every(t => t.endsWith(': 1')), `the reminder stays on one line on both iPad sizes (${sizes.join(', ')})`);
  await shot('ui-hand-8');
  await game(() => { const p = window.__game.activePlayer(); p.hand = p.hand.slice(0, 4); window.__game.refresh(); });
}

console.log('\n5. locked rooms');
check(await game(() => window.__game.revealTile('cloakroom')) && await game(() => window.__game.lockedRooms().includes('cloakroom')), 'a locked room is locked as soon as it is revealed');
const locked = 'cloakroom';
const nb = await game(l => [...window.__game.floor.rooms.get(l).neighbours][0], locked);
await put(nb, 4);
check(await game(() => window.__game.moveToRoom(window.__game.lockedRooms()[0]).ok) === false, 'you cannot walk into a locked room');
await give(0, [{ id: 'mk', type: 'masterKey' }]);
await page.waitForTimeout(150);
await page.click('#hand-fan .fan-card[data-card-id="mk"]');
await page.waitForTimeout(80);
check(await visible('#hand-overlay'), 'tapping the Master Key in the fan opens it large');
check((await page.textContent('#hand-detail')).includes('Open '), 'a Master Key offers to open the locked room next door');
await page.click('#hand-detail .btn.primary');
await page.waitForTimeout(150);
check(await game(l => !window.__game.state.lockedRooms.has(l), locked), 'the room is unlocked');
check(/door is open until the end of your turn/.test(await page.textContent('#toast')), 'and says it is open until the end of your turn');
check(!(await visible('#hand-overlay')) && !(await fanIds()).includes('mk'), 'the used-up key leaves the hand and the card view closes');
check(await game(() => window.__game.activePlayer().actionPoints) === 3, 'for 1 action point');
await game(l => window.__game.moveToRoom(l), locked);
await settle();
check(await game(() => window.__game.activePlayer().currentRoom) === locked, 'and can now be entered');

console.log('\n5a. the door locks again at the end of the turn; the guest inside can still walk out');
{
  const lockDoor = await game(l => window.__game.floor.rooms.get(l).doorways[0].id, locked);
  const doorView = () => game(d => { const v = window.__game.doorways.views.get(d), u = v.leaf.userData;
    return { locked: v.locked, shut: v.shut, swing: u.swing, target: u.target, pads: u.pads.every(p => p.visible) }; }, lockDoor);
  await game(() => window.__game.endTurn());
  await page.waitForTimeout(200);
  check(await game(l => window.__game.lockedRooms().includes(l) && !window.__game.openLocks().includes(l), locked), 'ending the turn locks the door again');
  check(/door has locked again/.test(await page.textContent('#toast')), 'and the game says so');
  const inside = await doorView();
  check(inside.locked && !inside.shut && inside.pads, `the door is padlocked again, yet stands open for the guest inside (${JSON.stringify(inside)})`);
  check(await game(() => window.__game.activePlayer().currentRoom) === locked, 'the guest is still inside');
  const outPlan = await game(n => window.__game.moveToRoom(n).ok, nb);
  await settle();
  check(outPlan && await game(() => window.__game.activePlayer().currentRoom) === nb, 'the guest inside walks out through the locked door');
  check(await game(l => window.__game.lockedRooms().includes(l), locked), 'the door stays locked behind them');
  await page.waitForFunction(d => window.__game.doorways.views.get(d).leaf.userData.swing < 0.05, lockDoor, { timeout: 8000 }).catch(() => {});
  const behind = await doorView();
  check(behind.shut && behind.target === 0 && behind.swing < 0.05 && behind.pads, `and the padlocked door swings shut behind them (${JSON.stringify(behind)})`);
  await shot('ui-locked-door-relocked');
  check(await game(l => window.__game.moveToRoom(l).ok, locked) === false, 'getting back in takes another key');
}

console.log('\n5b. standing at a door that opens onto a locked room (never stuck)');
{
  // The owner's report: walk up to a closed door, open it, the room behind is locked — then the
  // guest could not move at all. Replayed here with real taps on the screen.
  const setup = await page.evaluate(async () => {
    const g = window.__game;
    const { tileFits } = await import('./src/game/hotel.js');
    const def = g.floor.deck.find(t => t.id === 'suite416');
    if (!def) return null;
    const locked = id => g.state.lockedRooms.has(id);
    for (const d of g.floor.frontier) {
      const room = g.floor.rooms.get(d.room);
      if (d.jammed || locked(d.room) || room.isExit || d.room === 'hall') continue;
      if ([0, 1, 2, 3].some(r => tileFits(g.floor, def, d.cell, r, { isLocked: locked }))) return { room: d.room, door: d.id, center: d.center };
    }
    return null;
  });
  check(!!setup, 'found a closed door where a locked room can appear');
  if (setup) {
    await put(setup.room, 4);
    await settle();
    await page.waitForTimeout(1500);   // let the camera follow the guest to the room
    // 1) tap the floor right in front of the door: the guest walks up to it
    const inward = await game(s => { const c = window.__game.roomCenter(s.room); const dx = c[0] - s.center[0], dz = c[1] - s.center[1]; const l = Math.hypot(dx, dz); return [dx / l, dz / l]; }, setup);
    const front = [setup.center[0] + inward[0] * 1.45, setup.center[1] + inward[1] * 1.45];   // just outside the "tap the door" zone (it covers the whole ring: 1.22 m)
    const tapGround = async ([x, z]) => { const sp = await game(([x, z]) => window.__game.groundToScreen(x, z), [x, z]); await page.touchscreen.tap(sp.x, sp.y); await page.waitForTimeout(120); };
    await tapGround(front);
    await settle();
    const nearDoor = await game(s => { const m = window.__game.activeMover(); return Math.hypot(m.x - s.center[0], m.z - s.center[1]); }, setup);
    check(nearDoor < 1.8, `the guest walks up to the closed door (${nearDoor.toFixed(2)} m away)`);
    // 2) tap the door and confirm: it opens onto a locked room
    await game(() => window.__game.stackDeck('suite416'));
    await tapGround(setup.center);
    check(await visible('#confirm-bar'), 'tapping the door offers to open it');
    await tap('#btn-confirm-move');
    await page.waitForTimeout(300);
    check(await game(() => window.__game.lockedRooms().includes('suite416')), 'the door opens onto a locked room');
    // 3) tapping the door again only explains; then tapping the room's floor walks away
    await tapGround(setup.center);
    check(/locked/i.test(await page.textContent('#toast')), 'tapping the locked door explains it');
    const start = await game(() => { const m = window.__game.activeMover(); return [m.x, m.z]; });
    const c = await game(r => window.__game.roomCenter(r), setup.room);
    await tapGround([c[0] + 0.6, c[1] + 0.6]);
    await settle();
    const after = await game(() => { const g = window.__game, m = g.activeMover(); return { x: m.x, z: m.z, room: g.activePlayer().currentRoom, ap: g.activePlayer().actionPoints }; });
    check(Math.hypot(after.x - start[0], after.z - start[1]) > 1.5 && after.room === setup.room, 'the guest can walk away from the locked door, back into the room');
    check(after.ap === 3, 'and that walk is free (only the door cost 1)');
    await game(() => { window.__game.state.lockedRooms.delete('suite416'); window.__game.discovery.refresh(); window.__game.refresh(); });
  }
}

console.log('\n6. barricade');
await put(opened, 4);
await give(0, [{ id: 'bar', type: 'barricade' }]);
const door = await game(r => window.__game.floor.rooms.get(r).doorways.find(d => d.otherRoom(r) === 'hall').id, opened);
await game(d => window.__game.barricade('bar', d), door);
// (the planned walk to the lobby may go round through other rooms, but never through that doorway)
const straightToLobby = () => game(() => { const g = window.__game, c = g.roomCenter('hall'); const p = g.discovery.plan(c[0], c[1]); return p.ok && p.rooms.length === 2; });
check(!(await straightToLobby()), 'a barricaded doorway cannot be passed');
check(await game(() => window.__game.activePlayer().actionPoints) === 3, 'a Barricade costs 1 action point');
// (the cards given above can push the hand past the limit, and End turn would then ask for a discard)
await game(() => { const p = window.__game.activePlayer(); p.hand = p.hand.slice(0, 5); window.__game.refresh(); });
await game(() => window.__game.endTurn());
const ok6 = await straightToLobby();
check(ok6, 'it comes down after one round');
await settle();

console.log('\n6b. a Linen Store');
{
  check(await game(() => window.__game.revealTile('linenStore1')) && await game(() => window.__game.floor.rooms.get('linenStore1').job) === 'linenStore',
    'a Linen Store is revealed');
  await game(() => window.__game.state.lockedRooms.clear());
  await put('linenStore1', 4);
  await game(() => { const p = window.__game.activePlayer(); p.hand = p.hand.slice(0, 2); window.__game.refresh(); });
  const top = await game(() => window.__game.state.drawPile.slice(0, 2).map(c => c.id));
  const before = await game(() => window.__game.activePlayer().hand.length);
  await searchHere();
  check(await kind() === 'found' && sameSet(await revealIds(), top), 'both cards are shown large');
  const toast = (await revealText()).trim();
  await shot('ui-search-linen');
  await next();
  const ls = await game(ids => ({
    n: window.__game.activePlayer().hand.length, has: ids.every(id => window.__game.activePlayer().hand.some(c => c.id === id)),
    ap: window.__game.activePlayer().actionPoints, full: !document.getElementById('discard-overlay').hidden,
  }), top);
  check(ls.n === before + 2 && ls.has, `the first search there draws two cards (${before} -> ${ls.n}), the top two of the deck`);
  check(ls.ap === 3 && !ls.full, 'for one action, with no prompt while there is room for both');
  check(/find an? .+ and an? /.test(toast), `the message names both cards ("${toast.slice(0, 80)}")`);
  check((await spot()).mode === null, 'and the room gives up its draw once, like any other: no icon now');

  // Six cards in hand: both cards are KEPT (8 in hand) — the hand limit is settled only at the end of the
  // turn (approved rule), on the discard screen.
  check(await game(() => window.__game.revealTile('linenStore2')), 'the second Linen Store is revealed');
  await game(() => window.__game.state.lockedRooms.clear());
  await put('linenStore2', 4);
  await game(() => {
    const g = window.__game, p = g.activePlayer();
    p.hand = ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'].map(id => ({ id, type: 'knife' }));
    // stack the top of the deck so the two draws are known
    g.state.drawPile.unshift({ id: 'ls1', type: 'bandage' }, { id: 'ls2', type: 'flashlight' });
    g.refresh();
  });
  await searchHere();
  check(await kind() === 'found' && sameSet(await revealIds(), ['ls1', 'ls2']), 'with 6 cards in hand the reveal shows both new cards');
  const keepText = await revealText();
  check(/You hold 8 cards, more than 6: keep them all for now, and discard 2 when you end your turn\./.test(keepText), `and says calmly that they are kept for now ("…${keepText.slice(-80)}")`);
  await next();
  const kept = await game(() => {
    const g = window.__game, p = g.activePlayer();
    return { ids: p.hand.map(c => c.id), discard: g.state.discardPile.map(c => c.id), ap: p.actionPoints, overlay: !document.getElementById('discard-overlay').hidden };
  });
  check(kept.ids.length === 8 && kept.ids.includes('ls1') && kept.ids.includes('ls2') && !kept.discard.some(id => /^(k|ls)\d$/.test(id)) && !kept.overlay,
    'both are kept: 8 in hand, nothing discarded, no prompt during the turn');
  check(kept.ap === 3, 'the search cost one action');
  await page.waitForFunction(() => !document.querySelector('#hand-fan .fan-card.dealt'), null, { timeout: 10000 });
  await fanStill();
  check(sameSet(await fanIds(), kept.ids), 'the fan shows all 8 cards');
  check((await page.textContent('#hand-fan .fan-limit')) === 'Cards 8/6 · discard 2 at end of turn', 'with the reminder above it');
  await shot('pr-02c-linen-keep');
  // Ending the turn opens the discard screen first; the turn passes only once the hand is back to 6.
  const turn0 = await game(() => window.__game.state.turn);
  await tap('#btn-end-turn');
  check(await visible('#discard-overlay'), 'End turn with 8 cards opens the discard screen');
  check(await game(() => window.__game.state.turn) === turn0, 'and the turn has not passed yet');
  const d0 = await page.evaluate(() => ({ sub: document.getElementById('discard-sub').textContent, n: document.querySelectorAll('#discard-cards .card-tile').length,
    dis: document.getElementById('btn-discard-done').disabled, kicker: !document.getElementById('discard-kicker').hidden }));
  check(d0.n === 8 && d0.dis && /Choose 2 to discard/.test(d0.sub), `it offers all 8 and asks for 2 ("${d0.sub}")`);
  check(!d0.kicker, 'practice has nobody to hide from: no "private" line');
  await shot('pr-02d-discard');
  await page.click('#discard-cards .card-tile[data-card-id="k2"]'); await page.waitForTimeout(80);
  await page.click('#discard-cards .card-tile[data-card-id="k1"]'); await page.waitForTimeout(80);
  const pick = await page.evaluate(() => ({ sel: [...document.querySelectorAll('#discard-cards .card-tile.selected')].map(t => t.dataset.cardId),
    btn: document.getElementById('btn-discard-done').textContent.trim(), n: window.__game.activePlayer().hand.length }));
  check(pick.sel.join() === 'k1' && pick.btn === 'Discard the Knife' && pick.n === 8, 'tapping a card only picks it (tap another to change your mind); the button names it');
  await tap('#btn-discard-done');
  await page.click('#discard-cards .card-tile[data-card-id="k3"]'); await page.waitForTimeout(80);
  await tap('#btn-discard-done');
  const d1 = await page.evaluate(() => ({ btn: document.getElementById('btn-discard-done').textContent.trim(), n: window.__game.activePlayer().hand.length, turn: window.__game.state.turn }));
  check(d1.n === 6 && d1.btn === 'Keep these 6' && d1.turn === turn0, 'after two discards: 6 cards, "Keep these 6", still the same turn');
  await tap('#btn-discard-done');
  await page.waitForTimeout(150);
  const after = await game(() => ({ turn: window.__game.state.turn, open: !document.getElementById('discard-overlay').hidden,
    discard: window.__game.state.discardPile.map(c => c.id), hand: window.__game.activePlayer().hand.map(c => c.id) }));
  check(!after.open && after.turn === turn0 + 1, 'then the turn passes');
  check(after.discard.includes('k1') && after.discard.includes('k3') && after.hand.length === 6 && after.hand.includes('ls1') && after.hand.includes('ls2'),
    'the two chosen Knives went to the discard pile; the new cards were kept');
  check(!(await page.evaluate(() => { const el = document.querySelector('#hand-fan .fan-limit'); return el && !el.hidden; })), 'and the reminder is gone');
}

console.log('\n7. finding three Lanterns and the fire exit');
// A fresh start builds a new random hotel. Open the whole hotel up, then search room after room for
// real until three Lanterns have turned up.
const before7 = await game(() => window.__game.hotelRooms().length);
check(await page.evaluate(() => document.getElementById('btn-restart-practice').getBoundingClientRect().height >= 44), 'the Restart practice button is at least 44 px tall');
await tap('#btn-restart-practice');
check(await visible('#ask-overlay') && /Restart practice\?/.test(await page.textContent('#ask-title')), 'Restart practice asks first');
check(await game(() => window.__game.hotelRooms().length) === before7, 'and nothing is lost while it asks');
await tap('#btn-ask-no');
check(!(await visible('#ask-overlay')) && await game(() => window.__game.hotelRooms().length) === before7, '"Keep playing" keeps the hotel as it was');
await tap('#btn-restart-practice');
await tap('#btn-ask-yes');
check(await game(() => window.__game.hotelRooms().length) === 1 && before7 > 1, 'Restart practice builds a new hotel: just the lobby again');
await give(0, [{ id: 'fl7', type: 'flashlight' }]);
for (const t of ['lounge', 'ballroom', 'grandCorridor', 'dining', 'library', 'kitchen', 'corridorE', 'corridorW', 'corridorN', 'corridorS', 'infirmary1', 'infirmary2', 'linenStore1', 'linenStore2', 'switchboard', 'cornerCorridor', 'storage', 'stairs', 'serviceCorridor', 'backCorridor', 'housekeeping']) {
  await game(id => window.__game.revealTile(id), t);
}
const rooms = await game(() => window.__game.floor.roomList.filter(r => r.searchable).map(r => r.id));
check(rooms.length >= 15, `the hotel has grown to ${rooms.length} searchable rooms`);
let searched = 0;
const notes7 = [];
for (const r of rooms) {
  if (await game(() => window.__game.lanterns()) >= 3) break;
  await game(r => { window.__game.state.lockedRooms.delete(r); }, r);
  await put(r, 4);
  await settle();
  await searchHere();
  if (await kind() === 'found') { notes7.push(await revealText()); await next(); }
  // (Everything found is kept, even past 6: the hand limit only matters when a turn ends.)
  searched++;
}
const held = await game(() => window.__game.lanterns());
check(held >= 3, `searching ${searched} rooms turned up ${held} Lanterns`);
{
  // One more search with room in hand: what it says keeps count of the Lanterns held.
  const spare = await game(() => { const g = window.__game; return g.floor.roomList.find(r => r.searchable && !g.state.searchedRooms.has(r.id) && !r.job)?.id; });
  if (spare) {
    await game(() => { const g = window.__game, p = g.activePlayer(); p.hand = p.hand.filter(c => c.type === 'lantern' || c.type === 'flashlight'); g.state.lockedRooms.clear(); g.state.drawPile.unshift({ id: 'tally', type: 'bandage' }); g.refresh(); });
    await put(spare, 4);
    await settle();
    await searchHere();
    if (await kind() === 'found') { notes7.push(await revealText()); await next(); }
  }
  const n = await game(() => window.__game.lanterns());
  check(notes7.some(t => new RegExp(`You now hold ${n} Lanterns?\\.`).test(t)), `the search message keeps count of the Lanterns you hold ("…${(notes7.at(-1) || '').slice(-28)}")`);
}
check(sameSet(await fanIds(), await handIds()), 'Lanterns are in the hand like any card: the fan shows them');
await game(() => window.__game.toggleMap());
await page.waitForTimeout(150);
check(await game(() => window.__game.isMapOpen()), 'the map opens');
await shot('pr-02-map');
await game(() => window.__game.toggleMap());
check(await game(() => window.__game.revealTile('exit')), 'the Fire Exit is revealed');
await game(() => { window.__game.state.lockedRooms.clear(); window.__game.refresh(); });
await put(await game(() => [...window.__game.floor.rooms.get(window.__game.floor.exitRoom).neighbours][0]), 4);
await game(() => window.__game.moveToRoom(window.__game.floor.exitRoom));
await settle();
await page.waitForTimeout(300);
check(!(await game(() => window.__game.isFinished())), 'walking into the fire exit does not escape by itself');
check(await page.evaluate(() => { const b = document.getElementById('btn-room'); return !b.hidden && !b.disabled && b.textContent.includes('Escape'); }), 'an Escape button (1 action) appears there');
await tap('#btn-room');
await page.waitForTimeout(300);
check(await game(() => window.__game.isFinished()), 'Escape with three Lanterns ends the practice run');
check(await visible('#end-overlay') && /fire exit/i.test(await page.textContent('#end-title')), 'the end screen says so');
await shot('pr-03-end');
await tap('#btn-restart');
check(await game(() => !window.__game.isFinished() && window.__game.activePlayer().currentRoom === 'hall'), 'Restart practice puts the guest back in the lobby');

console.log('\n7b. playtest fixes');
{
  // The whole painted door ring is the door: a tap anywhere on it offers Open (it used to walk the
  // guest there when the tap was on the ring's room-facing half).
  await page.waitForTimeout(1200);   // (the camera settles on the lobby)
  const pts = await game(() => {
    const g = window.__game, t = g.cfg.walls.thickness, c = g.roomCenter('hall');
    const out = [];
    for (const d of g.closedDoors()) {
      const dx = c[0] - d.center[0], dz = c[1] - d.center[1], l = Math.hypot(dx, dz);
      for (const k of [t + 0.62, t + 0.8, t + 0.93]) {
        const x = d.center[0] + dx / l * k, z = d.center[1] + dz / l * k;
        const sp = g.groundToScreen(x, z);
        const el = document.elementFromPoint(sp.x, sp.y);
        if (el && el.tagName === 'CANVAS') out.push({ door: d.id, k: +k.toFixed(2), x: sp.x, y: sp.y });
      }
    }
    return out;
  });
  const missed = [];
  for (const q of pts) {
    await page.touchscreen.tap(q.x, q.y); await page.waitForTimeout(120);
    const r = await page.evaluate(() => ({ bar: !document.getElementById('confirm-bar').hidden, text: document.getElementById('confirm-text').textContent, walking: window.__game.activeMover().walking || window.__game.activeMover().path.length > 0 }));
    if (!r.bar || !/Open this door/.test(r.text) || r.walking) missed.push(`${q.door}@${q.k}`);
    if (r.bar) await tap('#btn-confirm-cancel');
    await settle();
  }
  const outer = pts.filter(q => q.k > 1.0).length;
  check(pts.length >= 6 && outer >= 2 && !missed.length, `a tap anywhere on a door's ring — up to its room-side edge — offers Open (${pts.length - missed.length}/${pts.length} taps${missed.length ? `; missed ${missed.join(', ')}` : ''})`);

  // A double tap on End turn ends ONE turn (practice has no hand-over screen to catch the second).
  await game(() => { const p = window.__game.activePlayer(); p.hand = p.hand.slice(0, 4); window.__game.refresh(); });
  const t0 = await game(() => window.__game.state.turn);
  await page.click('#btn-end-turn', { clickCount: 2 }); await page.waitForTimeout(150);
  const t1 = await game(() => ({ turn: window.__game.state.turn, ap: window.__game.activePlayer().actionPoints }));
  check(t1.turn === t0 + 1 && t1.ap === 4, `a double tap on End turn ends one turn, not two (turn ${t0} → ${t1.turn})`);
  await page.waitForTimeout(800);
  await tap('#btn-end-turn');
  check(await game(() => window.__game.state.turn) === t0 + 2, 'a deliberate tap a moment later ends the next one');
  await page.waitForTimeout(800);

  // The end-of-turn discard: tap a card to pick it, then confirm. Nothing goes on one tap.
  await game(() => { const p = window.__game.activePlayer(); p.hand = ['lantern', 'lantern', 'bandage', 'knife', 'masterKey', 'handMirror', 'espresso', 'barricade'].map((t, i) => ({ id: `d${i}`, type: t })); window.__game.refresh(); });
  const t2 = await game(() => window.__game.state.turn);
  await tap('#btn-end-turn');
  const dsc = () => page.evaluate(() => ({ open: !document.getElementById('discard-overlay').hidden, title: document.querySelector('#discard-overlay .modal-title').textContent,
    sub: document.getElementById('discard-sub').textContent, btn: document.getElementById('btn-discard-done').textContent.trim(), dis: document.getElementById('btn-discard-done').disabled,
    sel: [...document.querySelectorAll('#discard-cards .card-tile.selected')].map(t => t.dataset.cardId), n: window.__game.activePlayer().hand.length }));
  let d = await dsc();
  check(d.open && d.title === 'End of your turn: too many cards' && /Choose 2 to discard/.test(d.sub), `over the limit, End turn asks for a discard: "${d.title}" — "${d.sub}"`);
  check(!(await page.$('#fullhand-overlay')), 'there is no take-or-leave prompt any more (the limit is settled only here)');
  check(d.dis && d.btn === 'Tap a card to discard', 'until a card is picked, the button says what to do and cannot be pressed');
  await page.click('#discard-cards .card-tile[data-card-id="d2"]'); await page.waitForTimeout(80);
  d = await dsc();
  check(d.n === 8 && d.sel.join() === 'd2' && !d.dis && d.btn === 'Discard the Bandage', `one tap only picks a card: nothing is thrown away yet ("${d.btn}")`);
  await page.click('#discard-cards .card-tile[data-card-id="d2"]'); await page.waitForTimeout(80);
  d = await dsc();
  check(!d.sel.length && d.dis && d.n === 8, 'tapping it again puts it back');
  await page.click('#discard-cards .card-tile[data-card-id="d3"]'); await page.waitForTimeout(80);
  await tap('#btn-discard-done');
  d = await dsc();
  check(d.n === 7 && d.open && !(await game(() => window.__game.activePlayer().hand.some(c => c.id === 'd3'))), 'the button discards the picked card (the Knife)');
  await page.click('#discard-cards .card-tile[data-card-id="d7"]'); await page.waitForTimeout(80);
  await tap('#btn-discard-done');
  d = await dsc();
  check(d.n === 6 && !d.dis && d.btn === 'Keep these 6' && await game(t => window.__game.state.turn === t, t2), 'down to six: "Keep these 6", and the turn has not ended yet');
  await tap('#btn-discard-done');
  check(!(await visible('#discard-overlay')) && await game(t => window.__game.state.turn === t + 1, t2), 'then the turn ends');
  await page.waitForTimeout(800);

  // A tap on a fan card works while the fan is being re-laid out under the finger (a card arriving,
  // the hand changing): the card the finger went down on opens.
  await game(() => { const p = window.__game.activePlayer(); p.hand = ['lantern', 'bandage', 'knife', 'espresso'].map((t, i) => ({ id: `f${i}`, type: t })); window.__game.refresh(); });
  await page.waitForTimeout(300);
  await page.waitForFunction(() => !document.querySelector('#hand-fan .fan-card.dealt'), null, { timeout: 10000 });
  const cdp = await context.newCDPSession(page);
  const centre = id => page.evaluate(i => { const r = document.querySelector(`#hand-fan .fan-card[data-card-id="${i}"]`).getBoundingClientRect(); return { x: r.left + Math.min(r.width * 0.3, 20), y: Math.min(innerHeight - 30, r.top + r.height * 0.3) }; }, id);
  let at = await centre('f1');
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y }] });
  // the hand changes mid-press: two cards arrive, every card moves along the fan
  await game(() => { const p = window.__game.activePlayer(); p.hand.push({ id: 'f8', type: 'lantern' }, { id: 'f9', type: 'barricade' }); window.__game.refresh(); });
  await page.waitForTimeout(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(200);
  check(await game(() => window.__game.cardViewId()) === 'f1', `a card pressed while the fan re-lays itself out still opens (${await game(() => window.__game.cardViewId())})`);
  if (await visible('#hand-overlay')) await tap('#btn-hand-close');
  await page.waitForTimeout(400);
  // ...and a card just dealt in can be tapped at once, at its place, while it is still arriving.
  await game(() => { const p = window.__game.activePlayer(); p.hand.push({ id: 'fz', type: 'masterKey' }); window.__game.refresh(); });
  at = await page.evaluate(() => {
    const el = document.querySelector('#hand-fan .fan-card[data-card-id="fz"]');
    const a = el.getAnimations()[0]; let r;
    if (a) { a.pause(); a.currentTime = 400; r = el.getBoundingClientRect(); a.currentTime = 0; a.play(); } else r = el.getBoundingClientRect();
    return { x: r.left + Math.min(r.width * 0.3, 20), y: Math.min(innerHeight - 30, r.top + r.height * 0.35), dealing: !!a };
  });
  await page.touchscreen.tap(at.x, at.y); await page.waitForTimeout(200);
  check(await game(() => window.__game.cardViewId()) === 'fz', `a card tapped while it is still dealing in opens (${await game(() => window.__game.cardViewId())}${at.dealing ? '' : ', already settled'})`);
  // Practice words: nobody to hide from, nobody to trade with.
  if (await visible('#hand-overlay')) await tap('#btn-hand-close');
  await page.click('#hand-fan .fan-card[data-card-id="f0"]'); await page.waitForTimeout(150);
  const words = await page.evaluate(() => ({ lock: getComputedStyle(document.querySelector('#hand-overlay .lock')).display, detail: document.getElementById('hand-detail').textContent,
    priv: document.getElementById('btn-private').textContent }));
  check(words.lock === 'none' && /My cards/.test(words.priv) && !/Private/.test(words.priv), `practice shows no "Private" labels ("${words.priv.trim()}")`);
  check(!/trade|possess/i.test(words.detail) && /escape/i.test(words.detail), 'and the Lantern is described without trades or possession');
  await tap('#btn-hand-close');
  await game(() => window.__game.revealTile('switchboard'));
  await put('switchboard', 4);
  await game(() => window.__game.useRoom()); await page.waitForTimeout(150);
  const sw = await page.textContent('#notice-body');
  check(await game(() => window.__game.noticeOpen()) && /alone/.test(sw) && !/No guest is possessed right now/.test(sw), `the Switchboard speaks to a guest alone ("${sw.slice(0, 60)}…")`);
  await tap('#btn-notice-ok');

  // Portrait (or a window under ~900 px wide): a calm "turn your iPad sideways" card over everything.
  const rot = () => page.evaluate(() => { const el = document.getElementById('rotate-overlay'); const cs = getComputedStyle(el);
    const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 2); return { shown: cs.display !== 'none', covers: !!hit && el.contains(hit), text: el.textContent }; });
  for (const [w, h] of [[820, 1180], [768, 1024], [860, 700]]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(250);
    const r = await rot();
    check(r.shown && r.covers && /turn your iPad sideways/i.test(r.text), `${w}×${h}: "Please turn your iPad sideways" covers the game`);
    if (w === 820) await shot('ui-portrait-overlay');
  }
  for (const [w, h] of [[1024, 768], [1180, 820], [1440, 900]]) {
    await page.setViewportSize({ width: w, height: h }); await page.waitForTimeout(250);
    check(!(await rot()).shown, `${w}×${h}: landscape — no overlay`);
  }
}

console.log('\n8. layouts');
// The fan and the search icon at iPad landscape sizes and on a desktop: never over the guest's panel,
// the buttons, the top strip or the map button, and the floor stays free to tap.
await game(() => { window.__game.revealTile('library'); window.__game.state.lockedRooms.clear(); });
await put('library', 4);
await game(() => { const p = window.__game.activePlayer(); p.hand = ['lantern', 'lantern', 'bandage', 'knife', 'masterKey', 'handMirror', 'espresso', 'barricade'].map((t, i) => ({ id: `L${i}`, type: t })); window.__game.refresh(); });
await settle();
for (const [name, w, h] of [['ipad-landscape', 1180, 820], ['ipad-small', 1024, 768], ['ipad-pro', 1366, 1024], ['desktop', 1440, 900]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.mouse.move(4, 4);    // (no card under a hovering mouse)
  await page.waitForTimeout(700);
  await page.waitForFunction(() => !document.querySelector('#hand-fan .fan-card.dealt'), null, { timeout: 10000 });   // (cards finish dealing in)
  await fanStill();
  const r = await page.evaluate(() => {
    const box = el => el && el.offsetParent ? el.getBoundingClientRect() : null;
    const hit = (a, b) => !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const b = document.querySelector('.hud-bottom').getBoundingClientRect();
    const e = document.getElementById('btn-end-turn').getBoundingClientRect();
    const cards = [...document.querySelectorAll('#hand-fan .fan-card')].map(c => c.getBoundingClientRect());
    const keep = ['#player-panel', '.hud-bottom-right .control-row', '.action-row', '#btn-map', '.hud-top-left', '.hud-top-right', '.hud-top-center'].map(s => box(document.querySelector(s)));
    const icon = box(document.querySelector('#search-spot .ss-badge'));
    const fanTop = Math.min(...cards.map(c => c.top));
    return { inside: b.right <= innerWidth + 1 && b.bottom <= innerHeight + 1, endH: e.height,
      cardsClear: cards.length === 8 && cards.every(c => !keep.some(k => hit(c, k)) && c.left >= 0 && c.right <= innerWidth),
      why: cards.length !== 8 ? `${cards.length} cards` : cards.map((c, i) => keep.map((k, j) => hit(c, k) ? `card ${i} [${Math.round(c.left)},${Math.round(c.top)},${Math.round(c.right)},${Math.round(c.bottom)}] hits ${['panel', 'controls', 'actions', 'map', 'top-left', 'top-right', 'top-centre'][j]} [${Math.round(k.left)},${Math.round(k.top)},${Math.round(k.right)},${Math.round(k.bottom)}]` : '').filter(Boolean).join('; ')).filter(Boolean).join('; '),
      iconClear: !!icon && !keep.some(k => hit(icon, k)) && !cards.some(c => hit(icon, c)),
      floor: fanTop / innerHeight, fanW: cards[0]?.width };
  });
  check(r.inside, `${name}: the bottom bar fits on screen`);
  check(r.endH >= 44, `${name}: End turn is a comfortable touch size`);
  check(r.cardsClear, `${name}: eight cards in the fan, clear of the panel, buttons, map and top bar${r.cardsClear ? '' : ` (${r.why})`}`);
  check(r.floor >= 0.72, `${name}: the fan leaves the floor free to tap (it starts ${Math.round(r.floor * 100)}% of the way down)`);
  check(r.iconClear, `${name}: the search icon is clear of the fan and the rest of the interface`);
  await shot(`ui-hand-8-${w}x${h}`);
  // (a hand of three, then a card open, then the reveal, at this size)
  if (shots) {
    await game(() => { const p = window.__game.activePlayer(); p.hand = p.hand.slice(0, 3); window.__game.refresh(); });
    await page.waitForTimeout(300);
    await shot(`ui-hand-3-${w}x${h}`);
    await page.click('#hand-fan .fan-card[data-card-id="L2"]'); await page.waitForTimeout(250);
    await shot(`ui-hand-detail-${w}x${h}`);
    await tap('#btn-hand-close');
    await shot(`ui-search-library-${w}x${h}`);
    await game(() => { const p = window.__game.activePlayer(); p.hand = ['lantern', 'lantern', 'bandage', 'knife', 'masterKey', 'handMirror', 'espresso', 'barricade'].map((t, i) => ({ id: `L${i}`, type: t })); window.__game.refresh(); });
    await page.waitForTimeout(200);
  }
}
{
  // A room button (here the Infirmary's) widens the action row: the fan makes room for it.
  await page.setViewportSize({ width: 1024, height: 768 });
  await game(() => { window.__game.revealTile('infirmary2'); window.__game.state.lockedRooms.clear(); });
  await put('infirmary2', 4);
  await settle(); await page.mouse.move(4, 4); await page.waitForTimeout(500);
  await fanStill();
  const r = await page.evaluate(() => {
    const hit = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const btn = document.getElementById('btn-room'), act = document.querySelector('.action-row').getBoundingClientRect(), ctl = document.querySelector('.control-row').getBoundingClientRect();
    const cards = [...document.querySelectorAll('#hand-fan .fan-card')].map(c => c.getBoundingClientRect());
    return { shown: !btn.hidden && !!btn.offsetParent, n: cards.length, clear: cards.every(c => !hit(c, act) && !hit(c, ctl)) };
  });
  check(r.shown && r.n === 8 && r.clear, 'ipad-small, in an Infirmary: eight cards stay clear of the wider button row (with its Infirmary button)');
  await put('library', 4); await settle();
}
if (shots) {
  // The found-card reveal and a dark room at each iPad size.
  await game(() => window.__game.revealTile('storage'));
  for (const [w, h] of [[1180, 820], [1024, 768], [1366, 1024]]) {
    await page.setViewportSize({ width: w, height: h });
    await game(() => { const g = window.__game; g.state.searchedRooms.delete('library'); const p = g.activePlayer(); p.hand = p.hand.slice(0, 3); p.actionPoints = 4; g.state.drawPile.unshift({ id: `rv${Math.random()}`, type: 'lantern' }); g.refresh(); });
    await settle(); await page.waitForTimeout(500);
    await searchHere(); await page.waitForTimeout(500);
    await shot(`ui-search-reveal-${w}x${h}`);
    await takeReveal();
    await put('storage', 4);
    await game(() => { const g = window.__game; g.state.searchedRooms.delete('storage'); const p = g.activePlayer(); p.hand = p.hand.filter(c => c.type !== 'flashlight'); g.refresh(); });
    await settle(); await page.waitForTimeout(700);
    await shot(`ui-search-dark-${w}x${h}`);
    await put('library', 4);
  }
}
await page.setViewportSize({ width: 1180, height: 820 });

console.log('\n9. console');
await finish();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL PRACTICE BROWSER CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
