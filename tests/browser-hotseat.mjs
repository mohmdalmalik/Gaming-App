// Headless browser test of HOT-SEAT mode (dev only, not part of the game).
// Setup once (from the repo root):  npm --prefix tests install
// Run:  python3 -m http.server 8123 --bind 127.0.0.1 &   then   node tests/browser-hotseat.mjs [--screens]
//       node tests/browser-hotseat.mjs --url http://127.0.0.1:8123/Gaming-App/   (Pages sub-path)
//
// Four to six guests passing one device under docs/GAME_RULES.md: secret roles, the pass-the-
// device flow, the timer, private trades, possession and the Lantern, attacks and death, private
// search results, escaping with three Lanterns, and the two ways the hotel wins; the rooms with
// jobs (Infirmary, Switchboard) and the Hand Mirror and Espresso cards. And that the public screen
// never leaks a role, a trade result, a search result or what a Hand Mirror showed.
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
  // The hotel is random and starts as just the lobby: put the two rooms the stagings below use on
  // the board (the East Corridor through a lobby door), as if their doors had been opened.
  await game(() => { window.__game.revealTile('corridorE', 'hall'); window.__game.revealTile('corridorW'); });
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

// Stage a meeting: guest `mover` in the hall with `ap`, guest `other` in corridorE; the mover
// then walks in. Returns once the meeting panel is up.
async function walkInto(mover, other) {
  await place(other, 'corridorE');
  await place(mover, 'hall', 4);
  await game(() => window.__game.moveToRoom('corridorE'));
  await settle();
  await page.waitForFunction(() => window.__game.meetingOpen(), null, { timeout: 8000 }).catch(() => {});
}
const clickBtn = async (sel, text) => {
  const handle = await page.$$(sel);
  for (const h of handle) if ((await h.textContent()).trim().startsWith(text)) { await h.click(); await page.waitForTimeout(80); return true; }
  return false;
};

console.log('1. a six-player match');
await load('mode=hotseat&players=6&seed=4242');
const st = await game(() => ({
  mode: window.__game.mode, n: window.__game.state.players.length, poss: window.__game.possessedIndexes(),
  supply: window.__game.state.players.map(p => p.hand.filter(c => c.type === 'possession').length),
  lanterns: window.__game.state.players.every(p => !p.hand.some(c => c.type === 'lantern')),
  pileLanterns: window.__game.state.drawPile.filter(c => c.type === 'lantern').length,
  four: window.__game.state.players.every(p => p.hand.filter(c => c.type !== 'possession').length === 4),
  locked: window.__game.lockedRooms(), pile: window.__game.state.drawPile.length,
  rooms: window.__game.hotelRooms(), east: window.__game.floor.rooms.get('corridorE')?.neighbours.has('hall'),
  timer: window.__game.rules.turnTimerEnabled,
}));
check(st.mode === 'hotseat' && st.n === 6, 'six guests, hot-seat');
check(st.poss.length === 1 && st.supply[st.poss[0]] === 3 && st.supply.filter(x => x > 0).length === 1, 'exactly one possessed guest, holding 3 Possession cards');
check(st.lanterns && st.four, 'four cards each, and not one Lantern dealt');
check(st.pileLanterns === 14 && st.pile === 24, `all 14 Lanterns wait in the ${st.pile}-card deck (48 less six hands of 4)`);
check(st.locked.length === 0, 'nothing is locked until a locked room is revealed');
check(st.east && st.rooms.includes('corridorW'), 'the random hotel has grown the rooms these checks use');
check(st.timer, 'the 45-second timer is on');

console.log('\n2. secret roles, one guest at a time');
await tap('#btn-begin');
check(await kind() === 'pass', 'a neutral hand-over screen comes first');
check(!(await visible('#handoff-role')) && !(await visible('#handoff-hand')), 'with no role and no hand on it');
await next();
check(await kind() === 'role' && /CLEAN GUEST|POSSESSED/.test(await page.textContent('#handoff-role')), 'then that guest alone reads their role');
await shot('hs-01-role');
await throughRoles();
check(await game(() => window.__game.state.players.every(p => p.roleSeen)), 'all six acknowledged');
check(await kind() === 'turn', "the first guest's private turn screen follows");
check(await visible('#handoff-hand') && await visible('#handoff-role'), 'it shows their role and their hand');
check((await page.textContent('#handoff-kicker')).includes('health 3 of 3'), 'and their health');
await shot('hs-02-private-turn');
await next();

console.log('\n3. the action phase and the public screen');
check(await game(() => window.__game.inActionPhase()) && await visible('#turn-timer'), 'the turn runs with the clock showing');
check(await game(() => Math.round(window.__game.timeLeft())) === 45, 'starting at 45 seconds');
check(await visible('#health-row'), 'health is shown');
const hudText = await page.evaluate(() => document.getElementById('hud').innerText);
check(!/POSSESS/i.test(hudText), 'the word "possessed" is nowhere on the public screen');
check(!(await visible('#possess-tint')) && await page.evaluate(() => !document.getElementById('player-panel').classList.contains('possessed')),
  'no possessed tint or portrait on the shared screen — the tell lives on the private screens');
check(/cards/.test(await page.evaluate(() => document.getElementById('players-strip').innerText)), 'the strip shows rooms, cards and health');
// Possessed guest's private screen carries the tell.
const evilIdx = st.poss[0];
await game(i => { window.__game.state.activeIndex = i; window.__game.refresh(); }, evilIdx);
await game(() => window.__game.endTurn());
await page.waitForTimeout(150);
// endTurn moved to the next guest; step back to the possessed one directly.
await game(i => { window.__game.state.activeIndex = i; window.__game.refresh(); }, evilIdx);
await game(() => window.__game.handoff.privateTurn(window.__game.state, window.__game.floor, window.__game.activePlayer(), { onStart: () => {} }));
check(/POSSESSED/.test(await page.textContent('#handoff-role')) && await page.evaluate(() => document.querySelector('#handoff-role').classList.contains('evil')),
  'the possessed guest sees POSSESSED on their own private screen');
check(await page.evaluate(() => [...document.querySelectorAll('#handoff-hand .card-tile')].filter(t => t.classList.contains('evil')).length) === 3,
  'with their three Possession cards');
await shot('hs-03-possessed-private');
await next();

console.log('\n4. a trade, each side choosing in private');
await load('mode=hotseat&players=6&seed=4242');
await tap('#btn-begin'); await throughRoles(); await intoTurn();
// Guest 0 clean and moving; the possessed guest waits in the corridor.
const P = 0, E = 1;   // the staging below makes guest 1 the possessed one for these two sections
await game(({ P, E }) => {
  const s = window.__game.state;
  s.players.forEach((p, i) => { p.possessed = i === E; p.notes = []; p.knows = new Set(); });
  s.players[P].hand = [{ id: 'p1', type: 'bandage' }, { id: 'p2', type: 'knife' }];
  s.players[E].hand = [{ id: 'e1', type: 'lantern' }, { id: 'x1', type: 'possession' }, { id: 'x2', type: 'possession' }, { id: 'x3', type: 'possession' }];
  s.activeIndex = P; window.__game.refresh();
}, { P, E });
await walkInto(P, E);
check(await game(() => window.__game.meetingOpen()), 'walking in on a guest opens the meeting');
check(await clickBtn('#encounter-actions .btn', 'Trade'), 'the arriving guest chooses Trade');
check(await kind() === 'pick' && (await page.textContent('#handoff-kicker')).includes('Victor'), 'they choose their card in private');
check(await page.evaluate(() => document.querySelectorAll('#offer-cards .card-tile').length) === 2, 'from their own hand only');
await page.click('#offer-cards .card-tile[data-card-id="p1"]'); await page.waitForTimeout(80);
check(await kind() === 'pass' && (await page.textContent('#handoff-title')).includes('Pass the device'), 'the device is passed to the other guest');
await next();
check(await kind() === 'pick', 'who chooses in private too');
check(await page.evaluate(() => !!document.querySelector('#offer-cards .card-tile[data-card-id="x1"]')), 'a possessed guest may give a Possession card');
await page.click('#offer-cards .card-tile[data-card-id="x1"]'); await page.waitForTimeout(80);
check(await kind() === 'pass', 'the device goes back');
await next();
check(await kind() === 'note' && /POSSESSED/.test(await page.textContent('#handoff-notes')), 'the receiver privately learns they are now possessed');
await shot('hs-04-possessed-note');
await next();
check(await game(() => window.__game.meetingOpen()) && !/Possession|POSSESS/.test(await page.textContent('#encounter-body')), 'the public result says only that a trade was made');
await tap('#encounter-actions .btn.primary');
const after = await game(({ P, E }) => ({
  poss: window.__game.state.players[P].possessed, keeps: window.__game.state.players[P].hand.some(c => c.id === 'x1'),
  gave: window.__game.state.players[E].hand.some(c => c.id === 'p1'), log: window.__game.publicLog().join(' '),
}), { P, E });
check(after.poss && after.keeps, 'the guest is possessed and keeps the Possession card');
check(after.gave, 'the possessed giver keeps what they were given');
check(!/possess/i.test(after.log), 'the public log never mentions possession');

console.log('\n5. a Lantern blocks it');
await load('mode=hotseat&players=6&seed=4242');
await tap('#btn-begin'); await throughRoles(); await intoTurn();
await game(({ P, E }) => {
  const s = window.__game.state;
  s.players.forEach((p, i) => { p.possessed = i === E; p.notes = []; p.knows = new Set(); });
  s.players[P].hand = [{ id: 'p1', type: 'lantern' }];
  s.players[E].hand = [{ id: 'e1', type: 'bandage' }, { id: 'x1', type: 'possession' }, { id: 'x2', type: 'possession' }, { id: 'x3', type: 'possession' }];
  s.activeIndex = P; window.__game.refresh();
}, { P, E });
await walkInto(P, E);
await clickBtn('#encounter-actions .btn', 'Trade');
await page.click('#offer-cards .card-tile[data-card-id="p1"]'); await page.waitForTimeout(80);
await next();
await page.click('#offer-cards .card-tile[data-card-id="x1"]'); await page.waitForTimeout(80);
await next();
check(await kind() === 'note' && /Lantern.*used up/.test(await page.textContent('#handoff-notes')), 'the defender is told their Lantern burned the attempt and was used up');
await next(); await tap('#encounter-actions .btn.primary');
const blk = await game(({ P, E }) => {
  const s = window.__game.state;
  return { poss: s.players[P].possessed, knows: s.players[P].knows.has(s.players[E].id),
    lanternGone: !s.players.some(p => p.hand.some(c => c.id === 'p1')) && s.discardPile.some(c => c.id === 'p1'),
    destroyed: !s.players.some(p => p.hand.some(c => c.id === 'x1')) && !s.discardPile.some(c => c.id === 'x1'),
    left: s.players[E].hand.filter(c => c.type === 'possession').length };
}, { P, E });
check(!blk.poss && blk.knows, 'the defender is not possessed and knows who tried');
check(blk.lanternGone, 'the blocking Lantern is used up — nobody holds it, it is on the discard pile');
check(blk.destroyed && blk.left === 2, 'the Possession card is destroyed; two remain');

console.log('\n6. attack, death and dropped cards');
await load('mode=hotseat&players=6&seed=4242');
await tap('#btn-begin'); await throughRoles(); await intoTurn();
await game(() => {
  const s = window.__game.state;
  s.players[0].hand = [{ id: 'rv', type: 'revolver', shots: 2 }];
  s.players[1].hand = [{ id: 'v1', type: 'lantern' }, { id: 'v2', type: 'lantern' }];
  s.players[1].health = 2; s.activeIndex = 0; window.__game.refresh();
});
await walkInto(0, 1);
check(await clickBtn('#encounter-actions .btn', 'Attack'), 'with a weapon, Attack is offered');
await page.click('#encounter-body .card-tile[data-card-id="rv"]'); await page.waitForTimeout(120);
check(/dead/i.test(await page.textContent('#encounter-body')), 'a Revolver at 2 health kills — and says so publicly');
await shot('hs-05-attack');
await tap('#encounter-actions .btn.primary');
const dead = await game(() => ({
  alive: window.__game.state.players[1].alive, drops: (window.__game.state.roomDrops.get('corridorE') || []).map(c => c.id),
  strip: document.getElementById('players-strip').innerText, ap: window.__game.state.players[0].actionPoints,
}));
check(!dead.alive && dead.drops.includes('v1') && dead.drops.includes('v2'), 'the dead guest’s cards — their Lanterns included — lie on the floor');
check(/Dead/.test(dead.strip), 'the strip marks them dead');
check(dead.ap === 2, 'the move and the attack cost one each');
await game(() => { window.__game.activePlayer().actionPoints = 4; window.__game.refresh(); });
await tap('#btn-search');
await page.waitForTimeout(150);
if (await kind() === 'note') await next();
check(await game(() => window.__game.state.players[0].hand.some(c => c.id === 'v2')), 'searching the room picks the dropped Lanterns up');
await game(() => window.__game.endTurn());
await page.waitForTimeout(150);
check(await game(() => window.__game.state.activeIndex) === 2, 'the dead guest is skipped in the turn order');

console.log('\n6b. search results are private');
{
  await intoTurn();
  const room = await plainRoom();
  await put(room, 4);
  const logBefore = await game(() => window.__game.publicLog().length);
  await tap('#btn-search');
  await page.waitForTimeout(120);
  check(await kind() === 'note', 'the result goes on a private card for the searcher');
  const note = await page.textContent('#handoff-notes');
  check(/You search .* find an? /.test(note), `it says what they found ("${note.trim().slice(0, 60)}")`);
  await next();
  const toast = await page.textContent('#toast');
  check(/searched\.$/.test(toast.trim()) && !/find|Lantern|Bandage|Knife|Flashlight|Revolver|Barricade|Lock Pick|Master Key|Hand Mirror|Espresso/.test(toast),
    `the shared screen only says that someone searched ("${toast.trim()}")`);
  const log = await game(() => window.__game.publicLog());
  check(log.length === logBefore + 1 && /searched/.test(log.at(-1)) && !/Lantern|Bandage|Knife|Flashlight|Revolver|Barricade|Lock Pick|Master Key|Hand Mirror|Espresso/.test(log.at(-1)),
    'the public log records the search, not the result');
}

console.log('\n7. the exit is resolved before any meeting');
await load('mode=hotseat&players=6&seed=4242');
await tap('#btn-begin'); await throughRoles(); await intoTurn();
await game(() => {
  const s = window.__game.state, g = window.__game;
  s.players.forEach((p, i) => { p.possessed = i === 5; });
  s.lockedRooms.clear();   // the route to the exit must be open for this staging
  s.players[0].hand = [{ id: 'b1', type: 'lantern' }, { id: 'b2', type: 'lantern' }, { id: 'b3', type: 'lantern' }];
  g.refresh();
});
check(await game(() => window.__game.revealTile('exit')), 'the Fire Exit is revealed');
await game(() => { window.__game.state.lockedRooms.clear(); window.__game.refresh(); });
await place(1, await game(() => window.__game.floor.exitRoom));
await put(await game(() => [...window.__game.floor.rooms.get(window.__game.floor.exitRoom).neighbours][0]), 4);
await game(() => window.__game.moveToRoom(window.__game.floor.exitRoom));
await settle();
await page.waitForTimeout(300);
check(!(await game(() => window.__game.meetingOpen())), 'no meeting is forced in the exit');
check(await game(() => window.__game.isFinished() && window.__game.state.won === 'humans'), 'a clean guest with three Lanterns escapes: the guests win');
check(/got out/i.test(await page.textContent('#end-title')), 'the end screen says so');
await shot('hs-06-escaped');
// A possessed guest cannot.
await load('mode=hotseat&players=6&seed=4242');
await tap('#btn-begin'); await throughRoles(); await intoTurn();
await game(() => {
  const s = window.__game.state;
  s.players.forEach((p, i) => { p.possessed = i === 0; });
  s.lockedRooms.clear();
  s.players[0].hand = [{ id: 'b1', type: 'lantern' }, { id: 'b2', type: 'lantern' }, { id: 'b3', type: 'lantern' }];
  window.__game.refresh();
});
await game(() => { window.__game.revealTile('exit'); window.__game.state.lockedRooms.clear(); window.__game.refresh(); });
await put(await game(() => [...window.__game.floor.rooms.get(window.__game.floor.exitRoom).neighbours][0]), 4);
await game(() => window.__game.moveToRoom(window.__game.floor.exitRoom));
await settle();
await page.waitForTimeout(200);
check(await game(() => !window.__game.isFinished()), 'a possessed guest with three Lanterns cannot escape');

console.log('\n8. the hotel wins');
await game(() => { window.__game.state.players.forEach(p => { p.possessed = true; }); window.__game.endTurn(); });
await page.waitForTimeout(200);
check(await game(() => window.__game.isFinished() && window.__game.state.won === 'possessed'), 'every living guest possessed: the match ends');
check(/keeps them/i.test(await page.textContent('#end-title')) && /Possessed:/.test(await page.textContent('#end-summary')), 'the end screen reveals the possessed');
check((await page.textContent('#btn-restart')).trim() === 'New match', 'and offers a new match');

console.log('\n8b. dawn');
await load('mode=hotseat&players=6&seed=4242');
await tap('#btn-begin'); await throughRoles(); await intoTurn();
check((await page.textContent('#round')).trim() === 'Round 1 of 8', 'the header reads "Round 1 of 8"');
check(!(await page.evaluate(() => document.getElementById('round').classList.contains('final'))), 'round 1 is not marked as the last');
// Jump to the second-to-last turn of round 8 and hand the device on.
await game(() => { const s = window.__game.state; s.players.forEach((p, i) => { p.possessed = i === 0; }); s.round = 8; s.activeIndex = 4; window.__game.refresh(); });
check(/Round 8 of 8/.test(await page.textContent('#round')) && /Final round/.test(await page.textContent('#round')),
  `the last round is marked in the header ("${(await page.textContent('#round')).trim()}")`);
check(await page.evaluate(() => document.getElementById('round').classList.contains('final')), 'and shown in the warning colour');
const fits = await page.evaluate(() => {
  const r = document.getElementById('round').getBoundingClientRect();
  const strip = document.getElementById('players-strip').getBoundingClientRect();
  const overlap = r.left < strip.right && r.right > strip.left && r.top < strip.bottom && r.bottom > strip.top;
  return r.right <= innerWidth + 1 && r.left >= 0 && !overlap;
});
check(fits, 'the longer label fits on screen without covering the guest strip');
await shot('hs-08-final-round');
await game(() => window.__game.endTurn());
await page.waitForTimeout(150);
check(await kind() === 'pass' && /Final round/.test(await page.textContent('#handoff-kicker')), 'the pass-the-device screen warns that this is the final round');
await next();
check(/Final round/.test(await page.textContent('#handoff-kicker')), 'and so does the private turn screen');
await next();
check(await game(() => !window.__game.isFinished()), 'the last guest still gets their round-8 turn');
await game(() => window.__game.endTurn());
await page.waitForTimeout(250);
check(await game(() => window.__game.isFinished() && window.__game.state.won === 'possessed' && window.__game.state.dawn), 'when round 8 ends with nobody out, dawn breaks and the hotel wins');
check(/Dawn breaks/.test(await page.textContent('#end-title')), `the end screen says so ("${(await page.textContent('#end-title')).trim()}")`);
check(/Possessed:/.test(await page.textContent('#end-summary')), 'and reveals who was possessed');
await shot('hs-09-dawn');

console.log('\n9. a voluntary trade in the lobby');
await load('mode=hotseat&players=6&seed=4242');
await tap('#btn-begin'); await throughRoles(); await intoTurn();
await game(() => {
  const s = window.__game.state;
  s.players.forEach((p, i) => { p.possessed = i === 5; });
  s.players[0].hand = [{ id: 'p1', type: 'lantern' }]; s.players[1].hand = [{ id: 'q1', type: 'knife' }];
  s.players.forEach((p, i) => { if (i > 1) p.currentRoom = 'corridorW'; });
  window.__game.refresh();
});
check(await visible('#btn-trade'), 'a Trade button is offered in the lobby with someone there');
await tap('#btn-trade');
check(await kind() === 'pass', 'the other guest is handed the device');
await next();
check(await kind() === 'choice' && /would like to trade/.test(await page.textContent('#handoff-title')), 'and asked in private whether they agree');
await clickBtn('#offer-intent .btn', 'Accept');
check(await kind() === 'pick', 'on accepting, they pick their card first');
await page.click('#offer-cards .card-tile[data-card-id="q1"]'); await page.waitForTimeout(80);
await next();
await page.click('#offer-cards .card-tile[data-card-id="p1"]'); await page.waitForTimeout(80);
await next();
check(await kind() === 'note' && /Lantern/.test(await page.textContent('#handoff-notes')), 'the guest who chose first privately reads what they received — a Lantern');
await next(); await tap('#encounter-actions .btn.primary');
check(await game(() => window.__game.state.players[0].hand.some(c => c.id === 'q1') && window.__game.state.players[1].hand.some(c => c.id === 'p1')), 'the cards swapped — a Lantern passes to a teammate like any card');

console.log('\n10. the clock');
check(await game(() => window.__game.inActionPhase()), 'the turn is still running');
await game(() => window.__game.forceTimeUp());
await page.waitForFunction(() => window.__game.state.activeIndex === 1, null, { timeout: 20000 }).catch(() => {});
check(await game(() => window.__game.state.activeIndex) === 1 && await kind() === 'pass', 'when the clock runs out the turn ends and the device is passed');
check(await game(() => window.__game.timeLeft()) === 0, 'the clock does not run on the hand-over screen');

// Part 2 stagings run with ?timer=off: headless software rendering is slow, and a turn that ran out
// of time half-way would hand the device on in the middle of a check.
const JOBS = 'mode=hotseat&players=6&seed=4242&timer=off';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const names = () => game(() => window.__game.state.players.map(p => p.name));
const pips = () => page.evaluate(() => {
  const all = [...document.querySelectorAll('#ap-pips .pip')];
  return { n: all.length, full: all.filter(p => p.classList.contains('full')).length, bonus: all.filter(p => p.classList.contains('bonus')).length,
    label: document.getElementById('action-points').textContent.trim() };
});
const roomBtn = () => page.evaluate(() => {
  const b = document.getElementById('btn-room');
  return { shown: !!b && !b.hidden && b.offsetParent !== null, disabled: b.disabled,
    main: b.querySelector('.btn-main').textContent.trim(), sub: document.getElementById('room-sub').textContent.trim() };
});
// Open the hand sheet the way a player does (tap the fanned cards) and select one card.
async function handCard(id) {
  if (!(await game(() => !document.getElementById('hand-overlay').hidden))) await tap('#hand-strip');
  await page.click(`#hand-cards .card-tile[data-card-id="${id}"]`); await page.waitForTimeout(80);
}
const detailButtons = () => page.evaluate(() => [...document.querySelectorAll('#hand-detail .btn')].map(b => ({ text: b.textContent.trim(), disabled: b.disabled })));

console.log('\n10b. the Infirmary');
{
  await load(JOBS);
  await tap('#btn-begin'); await throughRoles(); await intoTurn();
  check(!(await roomBtn()).shown, 'in the lobby there is no room button');
  check(await game(() => window.__game.revealTile('infirmary1')) && await game(() => window.__game.floor.rooms.get('infirmary1').job) === 'infirmary', 'an Infirmary is revealed');
  await game(() => { window.__game.state.lockedRooms.clear(); window.__game.activePlayer().health = 1; });
  await put('infirmary1', 4);
  let b = await roomBtn();
  check(b.shown && !b.disabled && b.main === 'Infirmary' && /Heal 2 · 1 action/.test(b.sub), `standing in it shows its button ("${b.main} — ${b.sub}")`);
  const logBefore = await game(() => window.__game.publicLog().length);
  await tap('#btn-room');
  const r = await game(() => ({ h: window.__game.activePlayer().health, ap: window.__game.activePlayer().actionPoints,
    bars: document.querySelectorAll('#health .bar.full').length, log: window.__game.publicLog() }));
  check(r.h === 3 && r.bars === 3, 'tapping it at 1 health restores 2: health 3 of 3, and the health bars show it');
  check(r.ap === 3, '1 action spent');
  check(r.log.length === logBefore + 1 && /treated in the Infirmary/.test(r.log.at(-1)), `the public log records the visit ("${r.log.at(-1)}")`);
  b = await roomBtn();
  check(b.shown && b.disabled && b.sub === 'Full health', `the button then says full health ("${b.sub}")`);
  await shot('hs-10-infirmary');
  // Never above the maximum: at 2 health it restores only 1.
  await game(() => { window.__game.activePlayer().health = 2; window.__game.refresh(); });
  await tap('#btn-room');
  check(await game(() => window.__game.activePlayer().health) === 3 && await game(() => window.__game.activePlayer().actionPoints) === 2, 'at 2 health it tops up to 3, never above');
  // No actions left: the button says so and stays shut.
  await game(() => { const p = window.__game.activePlayer(); p.health = 1; p.actionPoints = 0; window.__game.refresh(); });
  b = await roomBtn();
  check(b.disabled && b.sub === 'No actions left', `with no actions left it cannot be used ("${b.sub}")`);
}

console.log('\n10c. the Switchboard');
{
  await load(JOBS);
  await tap('#btn-begin'); await throughRoles(); await intoTurn();
  // Guests 3 and 4 possessed, guest 5 possessed but dead (the dead are out of the game: not counted).
  await game(() => {
    const s = window.__game.state;
    s.players.forEach((p, i) => { p.possessed = i >= 3; p.notes = []; p.knows = new Set(); });
    s.players[5].alive = false;
    window.__game.refresh();
  });
  const who = await names();
  const evil = [who[3], who[4], who[5]];
  check(await game(() => window.__game.revealTile('switchboard')) && await game(() => window.__game.floor.rooms.get('switchboard').job) === 'switchboard', 'the Switchboard is revealed');
  await game(() => window.__game.state.lockedRooms.clear());
  await put('switchboard', 4);
  let b = await roomBtn();
  check(b.shown && !b.disabled && b.main === 'Switchboard' && /Call · 1 action/.test(b.sub), `standing in it shows its button ("${b.main} — ${b.sub}")`);
  const logBefore = await game(() => window.__game.publicLog().length);
  await tap('#btn-room');
  check(await game(() => window.__game.noticeOpen()) && await visible('#notice-overlay'), 'tapping it puts up a notice for the whole table');
  const title = (await page.textContent('#notice-title')).trim(), body = (await page.textContent('#notice-body')).trim();
  check(title === 'The Switchboard' && body.startsWith(`${who[0]} rang the Switchboard.`), `saying who rang ("${body}")`);
  check(/\b2 guests are possessed\b/.test(body), 'with the right count, living guests only, in the plural (2 guests are)');
  check(!evil.some(n => body.includes(n)), 'and never who');
  check(await game(() => window.__game.activePlayer().actionPoints) === 3, '1 action spent');
  await shot('hs-11-switchboard');
  await tap('#btn-notice-ok');
  check(!(await game(() => window.__game.noticeOpen())), 'Continue closes the notice');
  b = await roomBtn();
  check(b.shown && b.disabled && b.sub === 'Called this turn', `the button then says it was called this turn ("${b.sub}")`);
  let log = await game(() => window.__game.publicLog());
  check(log.length === logBefore + 1 && /rang the Switchboard/.test(log.at(-1)) && /2 guests are possessed/.test(log.at(-1)), `the public log has the count ("${log.at(-1)}")`);
  check(log.slice(logBefore).every(l => !evil.some(n => l.includes(n))), 'and never names a possessed guest');
  check(!/possess/i.test(await page.evaluate(() => document.getElementById('toast').hidden ? '' : document.getElementById('toast').textContent)), 'no toast names anyone as possessed');

  // Singular: the next guest calls once only one living guest is possessed.
  await game(() => { window.__game.state.players[4].possessed = false; });
  await tap('#btn-end-turn');
  await intoTurn();
  check(await game(() => window.__game.state.activeIndex) === 1, "it is the next guest's turn");
  await put('switchboard', 4);
  b = await roomBtn();
  check(!b.disabled && /Call/.test(b.sub), 'each guest may call once in their own turn');
  await tap('#btn-room');
  const body1 = (await page.textContent('#notice-body')).trim();
  check(/\b1 guest is possessed\b/.test(body1) && !/guests are/.test(body1), `with one possessed, the singular ("${body1}")`);
  check(!evil.some(n => body1.includes(n)), 'still never who');
  await tap('#btn-notice-ok');
  log = await game(() => window.__game.publicLog());
  check(log.slice(logBefore).every(l => !evil.some(n => l.includes(n))), 'the public log still never names a possessed guest');
}

console.log('\n10d. the Hand Mirror');
{
  await load(JOBS);
  await tap('#btn-begin'); await throughRoles(); await intoTurn();
  const P = 0, E = 1;
  await game(({ P, E }) => {
    const s = window.__game.state;
    s.players.forEach((p, i) => { p.possessed = i === E; p.notes = []; p.knows = new Set(); });
    s.players[P].hand = [{ id: 'hm1', type: 'handMirror' }, { id: 'hm2', type: 'handMirror' }, { id: 'pb', type: 'bandage' }];
    s.players[E].hand = [{ id: 'e1', type: 'lantern' }, { id: 'e2', type: 'knife' }, { id: 'x1', type: 'possession' }, { id: 'x2', type: 'possession' }, { id: 'x3', type: 'possession' }];
    s.activeIndex = P; window.__game.refresh();
  }, { P, E });
  const who = await names();
  // Both in the East Corridor; everyone else stays in the lobby. (Placed, not walked: no meeting.)
  await place(E, 'corridorE');
  await put('corridorE', 4);
  check(same(await game(() => window.__game.handMirrorTargets()), [await game(e => window.__game.state.players[e].id, E)]), 'the only guest in the room is the possessed one');
  const logBefore = await game(() => window.__game.publicLog().length);
  await handCard('hm1');
  check(await visible('#hand-overlay'), 'tapping the hand opens the hand sheet');
  let btns = await detailButtons();
  check(btns.length === 1 && btns[0].text === who[E] && !btns[0].disabled, `the Hand Mirror offers one guest: "${btns[0]?.text}"`);
  check(/Whose hand\? · 1 action/.test(await page.textContent('#hand-detail')), 'and says what it costs');
  await clickBtn('#hand-detail .d-targets .btn', who[E]);
  check(await kind() === 'mirror' && await game(() => window.__game.mirrorOpen()), 'a private hand-over screen opens');
  check(!(await visible('#hand-overlay')), 'and the hand sheet has closed');
  check((await page.textContent('#handoff-title')).trim() === `${who[E]}'s hand`, `titled "${(await page.textContent('#handoff-title')).trim()}"`);
  check((await page.textContent('#handoff-kicker')).includes(`${who[P]} only`), 'for the mirror user only');
  const tiles = await page.evaluate(() => [...document.querySelectorAll('#handoff-hand .card-tile')].map(t => ({ id: t.dataset.cardId, evil: t.classList.contains('evil') })));
  check(tiles.length === 5 && ['e1', 'e2', 'x1', 'x2', 'x3'].every(id => tiles.some(t => t.id === id)), `it shows every card they hold (${tiles.length})`);
  check(tiles.filter(t => t.evil).length === 3 && tiles[0].evil, 'Possession cards included, shown first');
  check(/POSSESSED/.test(await page.textContent('#handoff-notes')) && (await page.textContent('#handoff-notes')).includes(who[E]), 'and it says plainly that they are possessed');
  check((await page.textContent('#btn-handoff-next')).trim() === 'Done', 'the button says Done');
  check(!(await game(() => window.__game.publicLog().slice(-1)[0] || '')).match(/Lantern|Knife|Possession|possess/i), 'the public log says nothing of what it showed');
  await shot('hs-12-mirror');
  const st2 = await game(({ P, E }) => {
    const s = window.__game.state, p = s.players[P];
    return { gone: !p.hand.some(c => c.id === 'hm1'), discarded: s.discardPile.some(c => c.id === 'hm1'), ap: p.actionPoints, knows: p.knows.has(s.players[E].id),
      eHand: s.players[E].hand.length };
  }, { P, E });
  check(st2.gone && st2.discarded, 'the Hand Mirror is used up (on the discard pile)');
  check(st2.ap === 3, '1 action spent');
  check(st2.knows && st2.eHand === 5, 'the user now knows; the other guest keeps every card');
  await next();
  check(!(await game(() => window.__game.handoffOpen())) && await game(() => window.__game.inActionPhase()), 'Done returns to the turn');
  const toast = (await page.textContent('#toast')).trim();
  check(toast === `${who[P]} used a Hand Mirror on ${who[E]}.`, `the shared toast says only who used it on whom ("${toast}")`);
  const log = await game(() => window.__game.publicLog());
  check(log.length === logBefore + 1 && log.at(-1) === `${who[P]} used a Hand Mirror on ${who[E]}.`, 'and so does the public log');
  check(log.slice(logBefore).every(l => !/possess|Lantern|Knife/i.test(l)), 'with nothing about what it showed');
  check(!/POSSESS/i.test(await page.evaluate(() => document.getElementById('hud').innerText)), 'the shared screen does not say who is possessed');
  await handCard('pb');
  check(await visible('#hand-banner') && (await page.textContent('#hand-banner')).includes(`You have unmasked: ${who[E]}`),
    `the hand sheet banner now lists the unmasked guest ("${(await page.textContent('#hand-banner')).trim()}")`);
  await tap('#btn-hand-close');

  // Nobody else in the room: no one to look at.
  await put('corridorW', 4);
  check(await game(() => window.__game.handMirrorTargets().length) === 0, 'alone in a room there is nobody to look at');
  await handCard('hm2');
  btns = await detailButtons();
  check(btns.length === 0 && /No other guest in this room/.test(await page.textContent('#hand-detail')), 'and the Hand Mirror offers no buttons, saying why');
  check(await game(() => window.__game.activePlayer().hand.some(c => c.id === 'hm2') && window.__game.activePlayer().actionPoints === 4), 'nothing is spent');
  await tap('#btn-hand-close');
}

console.log('\n10e. Espresso');
{
  await load(JOBS);
  await tap('#btn-begin'); await throughRoles(); await intoTurn();
  await game(() => { const s = window.__game.state; s.players[0].hand = [{ id: 'es1', type: 'espresso' }, { id: 'es2', type: 'espresso' }]; window.__game.refresh(); });
  let p = await pips();
  check(p.n === 4 && p.full === 4 && p.bonus === 0 && p.label === '4 / 4', `4 actions to start (${p.label})`);
  await handCard('es1');
  const btns = await detailButtons();
  check(btns.length === 1 && btns[0].text === 'Drink · free' && !btns[0].disabled, `the Espresso offers "${btns[0]?.text}"`);
  await clickBtn('#hand-detail .btn', 'Drink');
  p = await pips();
  check(await game(() => window.__game.activePlayer().actionPoints) === 6, 'drinking it gives 4 -> 6 actions, and costs none');
  check(p.n === 6 && p.full === 6 && p.bonus === 2, `six pips, two of them bonus pips (${p.n} pips, ${p.bonus} bonus)`);
  check(p.label === '6', `the count reads "${p.label}" (the copper pips show the extra two)`);
  check(/Actions 6 \(\+2\)/.test(await page.textContent('#hand-note')), `the hand sheet says so too ("${(await page.textContent('#hand-note')).trim()}")`);
  check(await game(() => !window.__game.activePlayer().hand.some(c => c.id === 'es1') && window.__game.state.discardPile.some(c => c.id === 'es1')), 'the Espresso is used up');
  await shot('hs-13-espresso');
  await tap('#btn-hand-close');
  // A search spends one of them as normal.
  await put(await plainRoom(), null);
  await tap('#btn-search');
  await page.waitForTimeout(120);
  while (await game(() => window.__game.handoffOpen())) await next();
  if (await game(() => window.__game.fullHandOpen())) await tap('#btn-fullhand-leave');
  check(await game(() => window.__game.activePlayer().actionPoints) === 5 && (await pips()).label === '5', `a search spends one of the six (${(await pips()).label})`);
  // End turn and go round the table: the extra actions do not carry over.
  await tap('#btn-end-turn');
  await intoTurn();
  check(await game(() => window.__game.state.activeIndex) === 1 && (await pips()).label === '4 / 4', 'the next guest has the usual 4');
  for (let i = 1; i < 6; i++) { await tap('#btn-end-turn'); await intoTurn(); }
  const back = await game(() => ({ i: window.__game.state.activeIndex, ap: window.__game.activePlayer().actionPoints }));
  p = await pips();
  check(back.i === 0 && back.ap === 4 && p.n === 4 && p.bonus === 0 && p.label === '4 / 4', `round the table, the Espresso drinker is back to 4 (${p.label}, ${p.n} pips)`);
  check(await game(() => window.__game.activePlayer().hand.some(c => c.id === 'es2')), 'the unused Espresso is still in hand');
}

console.log('\n11. practice is untouched');
await load('');
check(await game(() => window.__game.mode === 'practice' && window.__game.state.players.length === 1), 'the plain address is still one guest alone');

console.log('\n12. layouts');
for (const [name, w, h] of [['ipad-landscape', 1180, 820], ['ipad-small', 1024, 768], ['desktop', 1440, 900]]) {
  await page.setViewportSize({ width: w, height: h });
  await load('mode=hotseat&players=6&seed=7');
  await tap('#btn-begin');
  await page.waitForTimeout(120);
  const fits = await page.evaluate(() => {
    const r = document.getElementById('handoff-card').getBoundingClientRect();
    const b = document.getElementById('btn-handoff-next').getBoundingClientRect();
    return { inView: r.top >= -1 && r.bottom <= window.innerHeight + 1, btn: b.height >= 40 && b.bottom <= window.innerHeight + 1 };
  });
  check(fits.inView && fits.btn, `${name}: the hand-over card and its button fit on screen`);
  await throughRoles();
  const turn = await page.evaluate(() => {
    const b = document.getElementById('btn-handoff-next').getBoundingClientRect();
    return b.bottom <= window.innerHeight + 1 && b.height >= 40;
  });
  check(turn, `${name}: the private turn screen's Start button is reachable`);
  await intoTurn();
  const bars = await page.evaluate(() => {
    const t = document.getElementById('turn-timer').getBoundingClientRect();
    const e = document.getElementById('btn-end-turn').getBoundingClientRect();
    return t.right <= window.innerWidth + 1 && e.height >= 44 && e.bottom <= window.innerHeight + 1;
  });
  check(bars, `${name}: the clock and the End turn button sit inside the screen`);
  await game(() => { window.__game.state.round = 8; window.__game.refresh(); });
  const finalFits = await page.evaluate(() => {
    const r = document.getElementById('round').getBoundingClientRect();
    const strip = document.getElementById('players-strip').getBoundingClientRect();
    return r.right <= innerWidth + 1 && !(r.left < strip.right && r.right > strip.left && r.top < strip.bottom && r.bottom > strip.top);
  });
  check(finalFits, `${name}: the final-round label fits without covering the guest strip`);
  await shot(`hs-07-${name}`);
}
await page.setViewportSize({ width: 1180, height: 820 });

console.log('\n13. console');
await finish();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL HOT-SEAT BROWSER CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
