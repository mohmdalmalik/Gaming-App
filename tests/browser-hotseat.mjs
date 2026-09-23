// Headless browser test of HOT-SEAT mode (dev only, not part of the game).
// Setup once (from the repo root):  npm --prefix tests install
// Run:  python3 -m http.server 8123 --bind 127.0.0.1 &   then   node tests/browser-hotseat.mjs [--screens]
//       node tests/browser-hotseat.mjs --url http://127.0.0.1:8123/Gaming-App/   (Pages sub-path)
//
// Four to six guests passing one device under docs/GAME_RULES.md: secret roles, the pass-the-
// device flow, the timer, private trades, possession and the Lantern, attacks and death, the
// three key pieces, escape, and the two ways the hotel wins. And that the public screen never
// leaks a role or a trade result.
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
async function load(query) {
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
  // A request cut off by the test's own page navigation (ERR_ABORTED) is harness noise, not a game error.
  const noisy = consoleMessages.filter(m => !/favicon/i.test(m) && !/requestfailed:.*ERR_ABORTED/.test(m));
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
  lanterns: window.__game.state.players.every(p => p.hand.some(c => c.type === 'lantern')),
  four: window.__game.state.players.every(p => p.hand.filter(c => c.type !== 'possession').length === 4),
  pieces: window.__game.pieces().rooms, locked: window.__game.lockedRooms(), pile: window.__game.state.drawPile.length,
  timer: window.__game.rules.turnTimerEnabled,
}));
check(st.mode === 'hotseat' && st.n === 6, 'six guests, hot-seat');
check(st.poss.length === 1 && st.supply[st.poss[0]] === 3 && st.supply.filter(x => x > 0).length === 1, 'exactly one possessed guest, holding 3 Possession cards');
check(st.lanterns && st.four, 'four cards each, a Lantern among them');
check(st.pieces.length === 3 && st.locked.length === 2 && st.pile === 16, 'three pieces hidden, two rooms locked, 16 cards left in the deck');
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
check(await kind() === 'note' && (await page.textContent('#handoff-notes')).includes('Lantern'), 'the defender is told their Lantern burned the attempt');
await next(); await tap('#encounter-actions .btn.primary');
const blk = await game(({ P, E }) => {
  const s = window.__game.state;
  return { poss: s.players[P].possessed, knows: s.players[P].knows.has(s.players[E].id),
    lanternWent: s.players[E].hand.some(c => c.id === 'p1'), destroyed: !s.players.some(p => p.hand.some(c => c.id === 'x1')) && !s.discardPile.some(c => c.id === 'x1'),
    left: s.players[E].hand.filter(c => c.type === 'possession').length };
}, { P, E });
check(!blk.poss && blk.knows, 'the defender is not possessed and knows who tried');
check(blk.lanternWent, 'the Lantern still went to the attacker');
check(blk.destroyed && blk.left === 2, 'the Possession card is destroyed; two remain');

console.log('\n6. attack, death and dropped cards');
await load('mode=hotseat&players=6&seed=4242');
await tap('#btn-begin'); await throughRoles(); await intoTurn();
await game(() => {
  const s = window.__game.state;
  s.players[0].hand = [{ id: 'rv', type: 'revolver', shots: 2 }];
  s.players[1].hand = [{ id: 'v1', type: 'lantern' }, { id: 'v2', type: 'bow' }];
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
check(!dead.alive && dead.drops.includes('v1') && dead.drops.includes('v2'), 'the dead guest’s cards — the key piece included — lie on the floor');
check(/Dead/.test(dead.strip), 'the strip marks them dead');
check(dead.ap === 2, 'the move and the attack cost one each');
await game(() => { window.__game.activePlayer().actionPoints = 4; window.__game.refresh(); });
await tap('#btn-search');
await page.waitForTimeout(150);
if (await kind() === 'note') await next();
check(await game(() => window.__game.state.players[0].hand.some(c => c.id === 'v2')), 'searching the room picks the dropped piece up');
await game(() => window.__game.endTurn());
await page.waitForTimeout(150);
check(await game(() => window.__game.state.activeIndex) === 2, 'the dead guest is skipped in the turn order');

console.log('\n7. the exit is resolved before any meeting');
await load('mode=hotseat&players=6&seed=4242');
await tap('#btn-begin'); await throughRoles(); await intoTurn();
await game(() => {
  const s = window.__game.state, g = window.__game;
  s.players.forEach((p, i) => { p.possessed = i === 5; });
  s.players[0].hand.push({ id: 'b1', type: 'bow' }, { id: 'b2', type: 'shank' }, { id: 'b3', type: 'bit' });
  g.refresh();
});
await place(1, await game(() => window.__game.floor.exitRoom));
await put('stairs', 4);
await game(() => window.__game.moveToRoom(window.__game.floor.exitRoom));
await settle();
await page.waitForTimeout(300);
check(!(await game(() => window.__game.meetingOpen())), 'no meeting is forced in the exit');
check(await game(() => window.__game.isFinished() && window.__game.state.won === 'humans'), 'a clean guest with all three pieces escapes: the guests win');
check(/got out/i.test(await page.textContent('#end-title')), 'the end screen says so');
await shot('hs-06-escaped');
// A possessed guest cannot.
await load('mode=hotseat&players=6&seed=4242');
await tap('#btn-begin'); await throughRoles(); await intoTurn();
await game(() => {
  const s = window.__game.state;
  s.players.forEach((p, i) => { p.possessed = i === 0; });
  s.players[0].hand.push({ id: 'b1', type: 'bow' }, { id: 'b2', type: 'shank' }, { id: 'b3', type: 'bit' });
  window.__game.refresh();
});
await put('stairs', 4);
await game(() => window.__game.moveToRoom(window.__game.floor.exitRoom));
await settle();
await page.waitForTimeout(200);
check(await game(() => !window.__game.isFinished()), 'a possessed guest with all three pieces cannot escape');

console.log('\n8. the hotel wins');
await game(() => { window.__game.state.players.forEach(p => { p.possessed = true; }); window.__game.endTurn(); });
await page.waitForTimeout(200);
check(await game(() => window.__game.isFinished() && window.__game.state.won === 'possessed'), 'every living guest possessed: the match ends');
check(/keeps them/i.test(await page.textContent('#end-title')) && /Possessed:/.test(await page.textContent('#end-summary')), 'the end screen reveals the possessed');
check((await page.textContent('#btn-restart')).trim() === 'New match', 'and offers a new match');

console.log('\n9. a voluntary trade in the lobby');
await load('mode=hotseat&players=6&seed=4242');
await tap('#btn-begin'); await throughRoles(); await intoTurn();
await game(() => {
  const s = window.__game.state;
  s.players.forEach((p, i) => { p.possessed = i === 5; });
  s.players[0].hand = [{ id: 'p1', type: 'bandage' }]; s.players[1].hand = [{ id: 'q1', type: 'knife' }];
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
check(await kind() === 'note' && /Bandage/.test(await page.textContent('#handoff-notes')), 'the proposer privately reads what they received');
await next(); await tap('#encounter-actions .btn.primary');
check(await game(() => window.__game.state.players[0].hand.some(c => c.id === 'q1') && window.__game.state.players[1].hand.some(c => c.id === 'p1')), 'the cards swapped');

console.log('\n10. the clock');
check(await game(() => window.__game.inActionPhase()), 'the turn is still running');
await game(() => window.__game.forceTimeUp());
await page.waitForFunction(() => window.__game.state.activeIndex === 1, null, { timeout: 20000 }).catch(() => {});
check(await game(() => window.__game.state.activeIndex) === 1 && await kind() === 'pass', 'when the clock runs out the turn ends and the device is passed');
check(await game(() => window.__game.timeLeft()) === 0, 'the clock does not run on the hand-over screen');

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
  await shot(`hs-07-${name}`);
}
await page.setViewportSize({ width: 1180, height: 820 });

console.log('\n13. console');
await finish();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL HOT-SEAT BROWSER CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
