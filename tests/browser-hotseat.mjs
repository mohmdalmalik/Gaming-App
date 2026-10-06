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
// Searching is the magnifier over the room's search spot (#search-spot): tap it, the guest walks up to
// the furniture and searches. Resolves once the walk and the search are done.
async function searchHere() {
  await page.click('#search-spot');
  await page.waitForFunction(() => !window.__game.searchPending() && !window.__game.activeMover().walking && window.__game.activeMover().path.length === 0, null, { timeout: 40000, polling: 50 });
  await page.waitForTimeout(80);
}
const fanIds = () => game(() => window.__game.fanIds());
const sameSet = (a, b) => a.length === b.length && a.every(x => b.includes(x));
// The hand fan and the search icon must be off the screen (hand-overs, private screens, the end).
const fanGone = async () => !(await visible('#hand-fan')) && !(await visible('#search-spot'));
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
  lanterns: window.__game.state.players.every(p => p.hand.filter(c => c.type === 'lantern').length === 1),
  others: window.__game.state.players.every(p => p.hand.filter(c => c.type !== 'lantern' && c.type !== 'possession').length === 3),
  pileLanterns: window.__game.state.drawPile.filter(c => c.type === 'lantern').length,
  four: window.__game.state.players.every(p => p.hand.filter(c => c.type !== 'possession').length === 4),
  locked: window.__game.lockedRooms(), pile: window.__game.state.drawPile.length,
  rooms: window.__game.hotelRooms(), east: window.__game.floor.rooms.get('corridorE')?.neighbours.has('hall'),
  timer: window.__game.rules.turnTimerEnabled,
}));
check(st.mode === 'hotseat' && st.n === 6, 'six guests, hot-seat');
check(st.poss.length === 1 && st.supply[st.poss[0]] === 3 && st.supply.filter(x => x > 0).length === 1, 'exactly one possessed guest, holding 3 Possession cards');
check(st.lanterns && st.others && st.four, 'every guest starts with exactly 1 Lantern + 3 other cards');
check(st.supply[st.poss[0]] === 3, 'the possessed guest too — with the 3 Possession cards on top of those 4');
check(st.pileLanterns === 8 && st.pile === 24, `the other 8 Lanterns wait in the ${st.pile}-card deck (48 less six hands of 4)`);
check(st.locked.length === 0, 'nothing is locked until a locked room is revealed');
check(st.east && st.rooms.includes('corridorW'), 'the random hotel has grown the rooms these checks use');
check(st.timer, 'the 45-second timer is on');

console.log('\n2. secret roles, one guest at a time');
await tap('#btn-begin');
check(await kind() === 'pass', 'a neutral hand-over screen comes first');
check(await fanGone(), 'no hand fan and no search icon on the hand-over screen');
check(!(await visible('#handoff-role')) && !(await visible('#handoff-hand')), 'with no role and no hand on it');
await next();
check(await kind() === 'role' && /CLEAN GUEST|POSSESSED/.test(await page.textContent('#handoff-role')), 'then that guest alone reads their role');
check(await fanGone(), 'nor on the role screen');
await shot('hs-01-role');
await throughRoles();
check(await game(() => window.__game.state.players.every(p => p.roleSeen)), 'all six acknowledged');
check(await kind() === 'turn', "the first guest's private turn screen follows");
check(await visible('#handoff-hand') && await visible('#handoff-role'), 'it shows their role and their hand');
check((await page.textContent('#handoff-kicker')).includes('health 3 of 3'), 'and their health');
check(await fanGone(), 'the hand fan waits until their turn starts');
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
check(await visible('#hand-fan') && sameSet(await fanIds(), await game(() => window.__game.activePlayer().hand.map(c => c.id))), 'the turn shows their hand as a fan of cards');
check(!(await page.$('#btn-search')), 'there is no Search button');
check(!(await visible('#search-spot')), 'and no search icon in the lobby');
// Possessed guest's private screen carries the tell.
const evilIdx = st.poss[0];
{
  // Their own action phase: as the approved rules say (GAME_RULES.md > Possession), the main screen
  // shows their reminder — a POSSESSED label, "Souls to trade: 3" and the Possession cards as one ×3
  // card in the fan — but no possessed portrait or tint, and the strip still counts ordinary cards only.
  await game(i => { window.__game.state.activeIndex = i; window.__game.refresh(); }, evilIdx);
  await page.waitForTimeout(150);
  const ev = await game(i => { const p = window.__game.state.players[i]; return { ord: p.hand.filter(c => c.type !== 'possession').map(c => c.id),
    first: p.hand.find(c => c.type === 'possession')?.id, n: p.hand.length }; }, evilIdx);
  const fan = await fanIds();
  check(await game(() => window.__game.cfg.ui.hotseatPossessedOnMainScreen === true), 'the main-screen reminder is on by default (approved rule)');
  check(fan.length === ev.ord.length + 1 && ev.ord.every(id => fan.includes(id)) && ev.n === ev.ord.length + 3
    && (await page.textContent('#hand-fan .fan-badge.souls'))?.replace(/\s+/g, ' ').trim() === '×3 souls',
    `the possessed guest's fan shows their ${ev.ord.length} ordinary cards and the 3 Possession cards as one ×3 card`);
  check(await visible('#panel-role') && /POSSESSED/i.test(await page.textContent('#panel-role'))
    && await visible('#panel-souls') && /Souls to trade:\s*3/.test(await page.textContent('#panel-souls')),
    'their panel shows POSSESSED and "Souls to trade: 3" during their own action phase');
  check(!(await visible('#possess-tint')) && await page.evaluate(() => !document.getElementById('player-panel').classList.contains('possessed')),
    'but no possessed tint or portrait on the shared screen');
  await shot('hs-02b-possessed-action-phase');
  const strip = await page.evaluate(i => document.querySelectorAll('#players-strip .mini-where')[i].textContent, evilIdx);
  check(strip.includes(`${ev.ord.length} cards`), `the strip shows the public count only ("${strip}")`);
  // The switch off (?possessedTell=off): nothing of it on the shared screen.
  await game(() => { window.__game.cfg.ui.hotseatPossessedOnMainScreen = false; window.__game.refresh(); });
  await page.waitForTimeout(150);
  check(sameSet(await fanIds(), ev.ord) && !(await visible('#panel-role')) && !(await visible('#panel-souls'))
    && !/POSSESS/i.test(await page.evaluate(() => document.getElementById('hud').innerText)),
    'with the switch off, the shared screen shows none of it');
  await game(() => { window.__game.cfg.ui.hotseatPossessedOnMainScreen = true; window.__game.refresh(); });
}
await game(i => { window.__game.state.activeIndex = i; window.__game.refresh(); }, evilIdx);
await game(() => window.__game.endTurn());
await page.waitForTimeout(150);
// endTurn moved to the next guest; step back to the possessed one directly.
await game(i => { window.__game.state.activeIndex = i; window.__game.refresh(); }, evilIdx);
await game(() => window.__game.handoff.privateTurn(window.__game.state, window.__game.floor, window.__game.activePlayer(), { onStart: () => {} }));
check(/POSSESSED/.test(await page.textContent('#handoff-role')) && await page.evaluate(() => document.querySelector('#handoff-role').classList.contains('evil')),
  'the possessed guest sees POSSESSED on their own private screen');
check(await page.evaluate(() => { const t = [...document.querySelectorAll('#handoff-hand .card-tile')].filter(t => t.classList.contains('evil'));
  return t.length === 1 && t[0].querySelector('.face-badge.souls')?.textContent === '×3'; }),
  'with their three Possession cards (one tile marked ×3)');
check(/Souls to trade:\s*3/.test(await page.textContent('#handoff-role .souls-chip')) && !!(await page.$('#handoff-role .role-portrait'))
  && await page.evaluate(() => document.getElementById('handoff-card').classList.contains('possessed')),
  'their private screen shows their possessed portrait and "Souls to trade: 3"');
await shot('hs-03-possessed-private');
await next();
// Outside their action phase (the private screen put away, the turn not started) the shared main
// screen shows none of it: the reminder is only on while their own turn runs.
check(!(await game(() => window.__game.inActionPhase())) && !(await visible('#panel-role')) && !(await visible('#panel-souls'))
  && !(await page.$('#hand-fan .fan-badge.souls')),
  'outside their own action phase the shared main screen carries no POSSESSED label, souls count or Possession card');
// The card view (private) carries the same tell; the next pass screen carries none of it.
await game(() => window.__game.openHand());
check((await page.textContent('#hand-big .face-badge.souls')) === '×3' && /^Souls to trade:\s*3$/.test((await page.textContent('#hand-detail .souls-line')).trim())
  && /1 of \d/.test(await page.textContent('#hand-pos')),
  'their card view shows the Possession cards as one ×3 stack and "Souls to trade: 3"');
{
  // The Possession card's words are said once: one count line and one description, no repeats.
  const v = await page.evaluate(() => ({ detail: document.getElementById('hand-detail').innerText, banner: document.getElementById('hand-banner').innerText,
    note: document.getElementById('hand-note').textContent, lines: document.querySelectorAll('#hand-detail .d-desc, #hand-detail .d-tag, #hand-detail .d-line').length }));
  const all = `${v.banner} ${v.detail} ${v.note}`;
  check((all.match(/souls to trade/gi) || []).length === 1 && (all.match(/unless they hand you a Lantern/g) || []).length === 1 && v.lines === 2,
    `on the Possession card the count and what it does appear once each (${JSON.stringify(v)})`);
  // On any other card the banner carries the reminder and the count (once: not again in the footer),
  // and the ‹ › arrows stay where they were, so a second tap on the same spot steps on again.
  const arrowAt = () => page.evaluate(() => Math.round(document.getElementById('btn-hand-next').getBoundingClientRect().top));
  await page.evaluate(() => document.querySelector('#hand-overlay .cv-panel').getAnimations().forEach(a => a.finish()));   // (the opening slide is over)
  const y0 = await arrowAt();
  await page.click('#btn-hand-next');
  const y1 = await arrowAt();
  check(/Souls to trade:\s*3/.test(await page.textContent('#hand-banner .souls-chip')) && /In a trade, give a Possession card/.test(await page.textContent('#hand-banner')),
    'on their other cards the banner keeps the reminder and "Souls to trade: 3"');
  check((await page.evaluate(() => document.querySelector('#hand-overlay .cv-panel').innerText.match(/souls to trade/gi) || [])).length === 1,
    'and says the count once (the footer leaves it out)');
  await page.click('#btn-hand-prev');
  const y2 = await arrowAt();
  check(y0 === y1 && y1 === y2, `the arrows do not move when stepping to and from the Possession card (top ${y0} / ${y1} / ${y2})`);
}
// It can open from a fan card on the shared screen too: in hot-seat no portrait and no violet wash.
check(await page.evaluate(() => !document.getElementById('hand-overlay').classList.contains('possessed') && !document.querySelector('#hand-banner .banner-portrait')),
  'in hot-seat the card view has no possessed portrait and no violet wash (seen across the table)');
await game(i => { const p = window.__game.state.players[i]; p.hand.splice(p.hand.findIndex(c => c.type === 'possession'), 1); window.__game.refresh(); }, evilIdx);
check((await page.textContent('#hand-big .face-badge.souls')) === '×2' && /Souls to trade:\s*2/.test(await page.textContent('#hand-detail .souls-line')),
  'and the count follows the hand at once (one given away: ×2)');
await page.click('#btn-hand-close');
check(await page.evaluate(() => { const b = document.getElementById('hand-banner'); return b.innerHTML === '' && b.className === 'banner'; }),
  'closing the card view leaves nothing of the banner behind');
check(await page.evaluate(() => !document.getElementById('hand-big').innerHTML && !document.getElementById('hand-detail').innerHTML && !document.getElementById('hand-note').textContent),
  'nor of the Possession card, its detail or the souls count (the hidden view is emptied)');
await game(() => window.__game.handoff.passTo(window.__game.activePlayer(), '', () => {}));
check(!(await page.$('#handoff-overlay .souls-chip')) && !(await page.$('#handoff-overlay .role-portrait'))
  && !(await visible('#panel-role')) && !(await visible('#panel-souls'))
  && await page.evaluate(() => !document.getElementById('handoff-card').classList.contains('possessed') && !document.getElementById('hand-overlay').classList.contains('possessed')),
  'the pass screen after it shows no portrait, no count and no wash');
await next();

console.log('\n3b. the possessed guest\'s real turn: their reminder on the main screen, gone before the pass');
{
  // A real round from the start, guest by guest (no staging): the reminder is on during the possessed
  // guest's own action phase only — not on any pass or private hand-over screen behind the card, not for
  // a clean guest, and gone the moment their turn ends, before the next guest's pass screen.
  await load('mode=hotseat&players=6&seed=4242&timer=off');
  const evil = (await game(() => window.__game.possessedIndexes()))[0];
  const tellOff = async () => !(await visible('#panel-role')) && !(await visible('#panel-souls'))
    && !(await page.$('#hand-fan .fan-badge.souls')) && !(await page.$('#hand-fan .fan-card[data-type="possession"]'))
    && !/POSSESS|souls to trade/i.test(await page.evaluate(() => document.getElementById('hud').innerText))
    && !(await visible('#possess-tint')) && await page.evaluate(() => !document.getElementById('player-panel').classList.contains('possessed'));
  await tap('#btn-begin');
  await throughRoles();
  // One full round (six turns), plus the turn after the possessed guest's if theirs is the last one.
  let sawEvil = false, cleanTurns = 0, passes = 0, privates = 0, nextChecked = false, prevWasEvil = false;
  for (let t = 0; t < 8 && (t < 6 || !nextChecked); t++) {
    // The private turn screen: the main screen behind it carries no reminder.
    check(await kind() === 'turn' && await tellOff(), `turn ${t + 1}: nothing of the reminder on the main screen behind the private turn screen`);
    privates++;
    await next();
    const i = await game(() => window.__game.state.activeIndex);
    check(await game(() => window.__game.inActionPhase()), `turn ${t + 1}: ${i === evil ? 'the possessed' : 'a clean'} guest's action phase runs`);
    if (i === evil) {
      sawEvil = true;
      const ord = await game(i => window.__game.state.players[i].hand.filter(c => c.type !== 'possession').length, i);
      const panelRole = (await visible('#panel-role')) ? (await page.textContent('#panel-role')).trim() : '';
      const panelSouls = (await visible('#panel-souls')) ? (await page.textContent('#panel-souls')).replace(/\s+/g, ' ').trim() : '';
      const badge = ((await page.textContent('#hand-fan .fan-badge.souls', { timeout: 3000 }).catch(() => '')) || '').replace(/\s+/g, ' ').trim();
      const fan = await game(() => [...document.querySelectorAll('#hand-fan .fan-card')].map(e => e.dataset.type));
      check(/^possessed$/i.test(panelRole) && /Souls to trade:\s*3/.test(panelSouls),
        `the possessed guest's own action phase: POSSESSED and "Souls to trade: 3" in their panel ("${panelRole}" / "${panelSouls}")`);
      check(badge === '×3 souls' && fan.filter(x => x === 'possession').length === 1 && fan.length === ord + 1,
        `their fan shows their ${ord} ordinary cards and the Possession cards as one ×3 card ("${badge}")`);
      check(!(await visible('#possess-tint')) && await page.evaluate(() => !document.getElementById('player-panel').classList.contains('possessed')),
        'but no possessed portrait and no violet tint on the shared screen');
      await shot('hs-03b-possessed-own-turn');
      await tap('#btn-end-turn');
      check(await kind() === 'pass' && await tellOff(), 'their turn ended: the next pass screen comes up with the reminder already gone');
      check(await page.evaluate(() => !document.querySelector('#hand-fan [data-card-id]') && !document.querySelector('#hand-fan .fan-badge.souls')
        && !document.querySelector('#handoff-overlay .souls-chip') && !document.querySelector('#handoff-overlay .role-portrait')),
        'and nothing of their hand or count waits in hidden markup behind it');
      await shot('hs-03c-pass-after-possessed');
    } else {
      check(await tellOff(), `turn ${t + 1}: ${prevWasEvil ? "the next guest's (clean) action phase, right after the possessed guest's" : "a clean guest's action phase"} shows no reminder`);
      if (prevWasEvil) { nextChecked = true; await shot('hs-03d-next-guest-turn'); }
      cleanTurns++;
      await tap('#btn-end-turn');
      check(await kind() === 'pass' && await tellOff(), `turn ${t + 1}: the pass screen after it shows none of it`);
    }
    passes++;
    prevWasEvil = i === evil;
    await next();
  }
  check(sawEvil && nextChecked, `the possessed guest's turn came round and the next guest's was checked (${cleanTurns} clean turns; ${passes} pass and ${privates} private screens)`);
  // ?possessedTell=private turns the main-screen reminder off (private screens only).
  await load('mode=hotseat&players=6&seed=4242&timer=off&possessedTell=private');
  check(await game(() => window.__game.cfg.ui.hotseatPossessedOnMainScreen === false), '?possessedTell=private switches the main-screen reminder off');
  await tap('#btn-begin');
  await throughRoles();
  await next();
  await game(i => { window.__game.state.activeIndex = i; window.__game.refresh(); }, evil);
  await page.waitForTimeout(150);
  check(await game(() => window.__game.inActionPhase()) && await tellOff(), 'with it off, even the possessed guest\'s own action phase shows none of it on the main screen');
}

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
check(await fanGone(), 'the fan is off the screen while cards are picked in private');
check(await page.evaluate(() => document.querySelectorAll('#offer-cards .card-tile').length) === 2, 'from their own hand only');
await page.click('#offer-cards .card-tile[data-card-id="p1"]'); await page.waitForTimeout(80);
check(await kind() === 'pass' && (await page.textContent('#handoff-title')).includes('Pass the device'), 'the device is passed to the other guest');
await next();
check(await kind() === 'pick', 'who chooses in private too');
check(await fanGone(), 'and while the other guest picks theirs');
check(await page.evaluate(() => !!document.querySelector('#offer-cards .card-tile[data-card-id="x1"]')), 'a possessed guest may give a Possession card');
await page.click('#offer-cards .card-tile[data-card-id="x1"]'); await page.waitForTimeout(80);
check(await kind() === 'pass', 'the device goes back');
await next();
check(await kind() === 'note' && /POSSESSED/.test(await page.textContent('#handoff-notes')), 'the receiver privately learns they are now possessed');
await shot('hs-04-possessed-note');
await next();
check(await game(() => window.__game.meetingOpen()) && !/Possession|POSSESS/.test(await page.textContent('#encounter-body')), 'the public result says only that a trade was made');
check(await fanGone(), 'no fan over the public meeting panel');
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

console.log('\n5b. an empty hand: the trade is skipped, and both are told why');
// 'possessed': the other guest is possessed and holds only Possession cards — skipped too, and it must
// read word for word like the clean empty-handed case.
const noTradeText = {};
for (const emptySide of ['mover', 'other', 'possessed']) {
  await load('mode=hotseat&players=6&seed=4242');
  await tap('#btn-begin'); await throughRoles(); await intoTurn();
  await game(({ P, E, emptySide }) => {
    const s = window.__game.state;
    s.players.forEach((p, i) => { p.possessed = i === (emptySide === 'possessed' ? E : 5); p.notes = []; p.knows = new Set(); });
    s.players[P].hand = emptySide === 'mover' ? [] : [{ id: 'p1', type: 'bandage' }, { id: 'p2', type: 'lantern' }];
    s.players[E].hand = emptySide === 'other' ? [] : emptySide === 'possessed' ? [1, 2, 3].map(i => ({ id: `x${i}`, type: 'possession' })) : [{ id: 'e1', type: 'flashlight' }];
    s.activeIndex = P; window.__game.refresh();
  }, { P, E, emptySide });
  const before = await game(({ P, E }) => [P, E].map(i => window.__game.state.players[i].hand.map(c => c.id).join()), { P, E });
  await walkInto(P, E);
  check(await clickBtn('#encounter-actions .btn', 'Trade'), `${emptySide} has no cards: Trade can still be chosen (the button gives nothing away)`);
  check(await kind() === 'note', `${emptySide} empty: no card-pick screen — the mover reads a private note instead`);
  const note = await page.textContent('#handoff-notes');
  check(emptySide === 'mover' ? /You have no ordinary card to give/.test(note) : /has no ordinary card to give/.test(note),
    `${emptySide} empty: the mover is told why ("${note.trim().slice(0, 70)}")`);
  check(await visible('#btn-handoff-next'), `${emptySide} empty: the private screen has a way on`);
  await next();
  check(await game(() => window.__game.meetingOpen()) && /No trade/.test(await page.textContent('#encounter-title')), `${emptySide} empty: the table sees "No trade"`);
  const pub = await page.textContent('#encounter-body');
  check(/one of them has no ordinary card/.test(pub) && !/Bandage|Lantern|Flashlight|Possess/i.test(pub), `${emptySide} empty: the public line names no card and no role`);
  check(await visible('#encounter-actions .btn.primary'), `${emptySide} empty: the public screen has a way on`);
  await tap('#encounter-actions .btn.primary');
  const after = await game(({ P, E }) => ({
    hands: [P, E].map(i => window.__game.state.players[i].hand.map(c => c.id).join()),
    otherNotes: window.__game.state.players[E].notes.join(' '), running: window.__game.inActionPhase(),
    meeting: window.__game.meetingOpen(), handoff: window.__game.handoffOpen(),
    log: window.__game.publicLog().at(-1),
  }), { P, E });
  check(after.hands.join('|') === before.join('|'), `${emptySide} empty: nothing changed hands`);
  check(emptySide === 'mover' ? /has no ordinary card to give/.test(after.otherNotes) : /You have no ordinary card to give/.test(after.otherNotes),
    `${emptySide} empty: the other guest's reason waits for their own private screen`);
  noTradeText[emptySide] = { note, pub, other: after.otherNotes, log: after.log };
  check(!after.meeting && !after.handoff && after.running, `${emptySide} empty: the turn carries on — no soft-lock`);
  check(/no trade/.test(after.log) && !/Bandage|Lantern|Flashlight/.test(after.log), `${emptySide} empty: the public log says only that there was no trade`);
  await shot(`hs-04b-empty-trade-${emptySide}`);
}

{
  const [c, v] = [noTradeText.other, noTradeText.possessed];
  check(!!c && !!v && c.note === v.note && c.pub === v.pub && c.other === v.other && c.log === v.log,
    'a possessed guest holding only Possession cards: every screen and the log read word for word as for an empty-handed clean guest');
}

console.log('\n5c. a big hand: every card in the trade row can be reached');
for (const [w, h] of [[1024, 768], [1180, 820], [1440, 900]]) {
  await page.setViewportSize({ width: w, height: h });
  await load('mode=hotseat&players=6&seed=4242');
  await tap('#btn-begin'); await throughRoles(); await intoTurn();
  await game(({ P, E }) => {
    const s = window.__game.state;
    const eight = ['lantern', 'lantern', 'bandage', 'knife', 'masterKey', 'handMirror', 'espresso', 'barricade'];
    s.players.forEach((p, i) => { p.possessed = i === E; p.notes = []; p.knows = new Set(); });
    s.players[P].hand = eight.map((t, i) => ({ id: `p${i}`, type: t }));
    // the possessed guest: 8 cards and three Possession cards — 11 to choose from
    s.players[E].hand = [...eight.map((t, i) => ({ id: `e${i}`, type: t })), ...[1, 2, 3].map(i => ({ id: `x${i}`, type: 'possession' }))];
    s.activeIndex = P; window.__game.refresh();
  }, { P, E });
  await walkInto(P, E);
  await clickBtn('#encounter-actions .btn', 'Trade');
  const reach = () => page.evaluate(() => {
    const box = document.getElementById('handoff-card').getBoundingClientRect();
    return [...document.querySelectorAll('#offer-cards .card-tile')].map(t => {
      const r = t.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      return { id: t.dataset.cardId, ok: r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= 0 && r.bottom <= innerHeight && !!hit && t.contains(hit) };
    });
  });
  const mine = await reach();
  check(mine.length === 8 && mine.every(c => c.ok), `${w}×${h}: all 8 cards of the trade row are on screen and tappable (${mine.filter(c => c.ok).length}/8)`);
  await shot(`hs-04c-trade-8-${w}x${h}`);
  await page.click('#offer-cards .card-tile[data-card-id="p0"]'); await page.waitForTimeout(80);
  await next();
  const theirs = await reach();
  check(theirs.length === 11 && theirs.every(c => c.ok), `${w}×${h}: all 11 of a possessed guest's (8 + 3 Possession) too (${theirs.filter(c => c.ok).length}/11)`);
  await page.click('#offer-cards .card-tile[data-card-id="e2"]'); await page.waitForTimeout(80);
}
await page.setViewportSize({ width: 1180, height: 820 });

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
check(await clickBtn('#encounter-actions .btn', '‹ Back'), 'the weapon picker has a Back button');
check(await game(() => window.__game.meetingOpen()) && await page.evaluate(() => [...document.querySelectorAll('#encounter-actions .btn')].some(b => /^Trade/.test(b.textContent.trim()))),
  'Back returns to Trade or Attack, with nothing spent');
check(await game(() => window.__game.state.players[0].actionPoints === 3 && window.__game.state.players[1].health === 2), '(no action spent, no damage done)');
await clickBtn('#encounter-actions .btn', 'Attack');
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
{
  // The body lies clear of the living, and a guest walking in later does not stand on it.
  const body = await game(() => {
    const g = window.__game, [ax, az, bx, bz] = g.bodyEnds(1);
    const seg = (px, pz) => { const vx = bx - ax, vz = bz - az; const t = Math.max(0, Math.min(1, ((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz))); return Math.hypot(px - ax - t * vx, pz - az - t * vz); };
    const m0 = g.movers[0];
    const slot = g.standingSlot('corridorE', 2);
    return { attacker: seg(m0.x, m0.z), slot: seg(slot.x, slot.z) };
  });
  check(body.attacker >= 0.6, `the body falls clear of the attacker standing there (${body.attacker.toFixed(2)} m)`);
  check(body.slot >= 0.6, `a guest walking in stands clear of the body (${body.slot.toFixed(2)} m)`);
}
await game(() => { window.__game.activePlayer().actionPoints = 4; window.__game.refresh(); });
await page.waitForTimeout(200);
check(await visible('#search-spot'), 'a room with cards lying in it shows the search icon');
await searchHere();
if (await kind() === 'found') await next();
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
  await settle();
  check((await game(() => window.__game.searchSpot().mode)) === 'live', 'an unsearched room shows the search icon');
  const top = await game(() => window.__game.state.drawPile[0].id);
  await searchHere();
  check(await kind() === 'found', 'the result goes on a private card for the searcher');
  check(/Private/.test(await page.textContent('#handoff-kicker')) && await game(() => getComputedStyle(document.getElementById('handoff-overlay')).backgroundColor) === 'rgba(8, 9, 14, 0.97)',
    'marked private, on the opaque hand-over backdrop');
  check(await page.evaluate(id => !!document.querySelector(`#handoff-found .big-card[data-card-id="${id}"] img`), top), 'the card found is shown large');
  check(await fanGone(), 'the fan and the icon are off the screen meanwhile');
  const note = await page.textContent('#handoff-notes');
  check(/You search .* find an? /.test(note), `it says what they found ("${note.trim().slice(0, 60)}")`);
  await shot('ui-search-reveal-hotseat');
  await next();
  check((await fanIds()).includes(top), 'then it is in their hand fan');
  check(!(await visible('#search-spot')), 'and the icon is gone: the room is searched');
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
check(!(await game(() => window.__game.isFinished())), 'walking in does not escape by itself');
check(await page.evaluate(() => { const b = document.getElementById('btn-room'); return !b.hidden && !b.disabled && /Escape/.test(b.textContent); }), 'the Escape button shows in the exit');
await tap('#btn-room');
await page.waitForTimeout(300);
check(await game(() => window.__game.isFinished() && window.__game.state.won === 'humans'), 'a clean guest with three Lanterns presses Escape (1 action): the guests win');
check(/got out/i.test(await page.textContent('#end-title')), 'the end screen says so');
check(await fanGone(), 'no hand fan on the end screen');
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
{
  // The Escape button is disabled for them, reading exactly as it does for a clean guest who cannot
  // escape (short of Lanterns), so it never tells the table which it is.
  const btn = () => page.evaluate(() => { const b = document.getElementById('btn-room'); return { shown: !b.hidden, disabled: b.disabled, text: b.textContent.trim() }; });
  const evil = await btn();
  await game(() => { const s = window.__game.state; s.players[0].possessed = false; s.players[5].possessed = true; s.players[0].hand = s.players[0].hand.slice(0, 2); window.__game.refresh(); });
  const clean2 = await btn();
  check(evil.shown && evil.disabled, `the Escape button is disabled for a possessed guest with three Lanterns ("${evil.text}")`);
  check(clean2.disabled && clean2.text === evil.text, `and reads exactly the same for a clean guest with two ("${clean2.text}")`);
  await game(() => { const s = window.__game.state; s.players[0].hand.push({ id: 'b3x', type: 'lantern' }); window.__game.refresh(); });
  const clean3 = await btn();
  check(!clean3.disabled && clean3.text !== evil.text, `a clean guest with three can press it ("${clean3.text}")`);
}

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

console.log('\n9. no trading in the lobby; a voluntary trade in the Fire Exit');
await load('mode=hotseat&players=6&seed=4242');
await tap('#btn-begin'); await throughRoles(); await intoTurn();
check(!(await visible('#btn-trade')), 'the lobby offers no Trade button, even with every guest standing there');
await game(() => {
  const g = window.__game, s = g.state;
  g.revealTile('exit');
  s.players.forEach((p, i) => { p.possessed = i === 5; });
  s.players[0].hand = [{ id: 'p1', type: 'lantern' }]; s.players[1].hand = [{ id: 'q1', type: 'knife' }];
  g.refresh();
});
{
  const exit = await game(() => window.__game.floor.exitRoom);
  for (let i = 0; i < 6; i++) await place(i, i > 1 ? 'corridorW' : exit);
  await page.waitForTimeout(300);
}
check(await visible('#btn-trade'), 'the Fire Exit (also safe) still offers a Trade button with someone there');
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
await next();
{
  const active = await game(() => window.__game.activePlayer().name);
  check(await kind() === 'pass' && (await page.textContent('#handoff-title')).includes(active),
    `then the device goes back to the guest whose turn it is (${active}) before the game carries on`);
}
await next();
check(await kind() === 'note' && /Knife/.test(await page.textContent('#handoff-notes')),
  'and they privately read what they received (a Knife) before the public screen');
await next();
check(await game(() => window.__game.meetingOpen()), 'then the table sees the public result');
await tap('#encounter-actions .btn.primary');
check(await game(() => window.__game.inActionPhase() && !window.__game.handoffOpen()), 'and their turn carries on');
check(await game(() => window.__game.state.players[0].hand.some(c => c.id === 'q1') && window.__game.state.players[1].hand.some(c => c.id === 'p1')), 'the cards swapped — a Lantern passes to a teammate like any card');
{
  // The guest whose turn it is chooses second in a Fire Exit trade. Converted there, they must learn it
  // in private first — never from their own main screen in front of the table.
  await game(() => {
    const g = window.__game, s = g.state;
    s.players.forEach((p, i) => { p.possessed = i === 1; p.notes = []; p.roleChangePending = false; });
    s.players[0].hand = [{ id: 'v1', type: 'bandage' }];
    s.players[1].hand = [{ id: 'e1', type: 'knife' }, { id: 'x1', type: 'possession' }, { id: 'x2', type: 'possession' }];
    g.refresh();
  });
  const roleShown = () => visible('#panel-role');
  await tap('#btn-trade');
  await next();
  await clickBtn('#offer-intent .btn', 'Accept');
  await page.click('#offer-cards .card-tile[data-card-id="x1"]'); await page.waitForTimeout(80);
  await next();
  await page.click('#offer-cards .card-tile[data-card-id="v1"]'); await page.waitForTimeout(80);
  await next();
  check(await kind() === 'note' && /bandage/i.test(await page.textContent('#handoff-notes')), 'Fire Exit trade 2: the possessed guest (first) reads what they received');
  await next();
  check(await kind() === 'pass' && !(await roleShown()), 'the device goes back to the guest whose turn it is, with no reminder on the screen');
  await next();
  check(await kind() === 'note' && /now POSSESSED/.test(await page.textContent('#handoff-notes')) && !(await roleShown()),
    'the converted guest whose turn it is reads it in private at once — before the public screen and before their main screen shows anything');
  check(await game(() => window.__game.state.players[0].possessed && !window.__game.state.players[0].roleChangePending),
    'told now, so no second "something has changed" screen at their next turn');
  await next();
  check(await game(() => window.__game.meetingOpen()) && !(await roleShown())
    && !/Possession|POSSESS/i.test(await page.textContent('#encounter-body')), 'the public result names no card and shows no reminder');
  await tap('#encounter-actions .btn.primary');
  await page.waitForTimeout(120);
  check(await game(() => window.__game.inActionPhase() && !window.__game.handoffOpen()), 'and their turn carries on');
  // Give the cards back so the sections below start from the same hands as before.
  await game(() => {
    const s = window.__game.state;
    s.players.forEach((p, i) => { p.possessed = i === 5; p.notes = []; p.roleChangePending = false; });
    s.players[0].hand = [{ id: 'q1', type: 'knife' }]; s.players[1].hand = [{ id: 'p1', type: 'lantern' }];
    window.__game.refresh();
  });
}

console.log('\n10. the clock');
check(await game(() => window.__game.inActionPhase()), 'the turn is still running');
await game(() => window.__game.forceTimeUp());
await page.waitForFunction(() => window.__game.state.activeIndex === 1, null, { timeout: 20000 }).catch(() => {});
check(await game(() => window.__game.state.activeIndex) === 1 && await kind() === 'pass', 'when the clock runs out the turn ends and the device is passed');
check(await game(() => window.__game.timeLeft()) === 0, 'the clock does not run on the hand-over screen');
check(await fanGone(), 'and the last guest\'s cards are off the screen before the device changes hands');

console.log('\n10a. the hand limit is settled at the end of the turn (the clock, and End turn)');
{
  // Over the limit during a turn is fine; when the clock runs out the discard screen comes first —
  // still the active guest's own private moment — and only then the pass screen.
  check(await intoTurn(), 'the next guest starts their turn');
  const me = await game(() => window.__game.state.activeIndex);
  await game(() => {
    const g = window.__game, p = g.activePlayer();
    p.hand = [...['lantern', 'bandage', 'knife', 'flashlight', 'barricade', 'lockPick', 'espresso', 'handMirror'].map((t, i) => ({ id: `ov${i}`, type: t })),
      ...p.hand.filter(c => c.type === 'possession')];
    g.refresh();
  });
  await page.waitForTimeout(200);
  check((await page.textContent('#hand-fan .fan-limit')) === 'Cards 8/6 · discard 2 at end of turn', 'with 8 cards the fan shows a calm reminder');
  await shot('hs-20-hand-8');
  await game(() => window.__game.forceTimeUp());
  await page.waitForFunction(() => !document.getElementById('discard-overlay').hidden || window.__game.handoffOpen(), null, { timeout: 20000 }).catch(() => {});
  const d = await page.evaluate(() => ({ open: !document.getElementById('discard-overlay').hidden, pass: window.__game.handoffOpen(), active: window.__game.state.activeIndex,
    kicker: document.getElementById('discard-kicker').hidden ? '' : document.getElementById('discard-kicker').textContent, n: document.querySelectorAll('#discard-cards .card-tile').length,
    types: [...document.querySelectorAll('#discard-cards .card-tile')].map(t => t.dataset.cardId), timer: window.__game.timeLeft(), name: window.__game.activePlayer().name }));
  check(d.open && !d.pass && d.active === me, 'when the clock runs out with 8 cards the discard screen opens — before any pass screen');
  check(d.kicker === `Private — ${d.name} only`, `it is marked private ("${d.kicker}")`);
  check(d.n === 8 && d.types.every(id => id.startsWith('ov')), 'it offers the 8 ordinary cards and never a Possession card');
  check(d.timer === 0 && await fanGone(), 'the clock has stopped, and the fan is off the screen');
  await shot('hs-21-discard-timeup');
  await game(() => document.getElementById('btn-discard-done').click());   // (a stray press on the disabled button)
  await page.waitForTimeout(100);
  check(await game(i => window.__game.state.activeIndex === i && !document.getElementById('discard-overlay').hidden
    && document.getElementById('btn-discard-done').disabled, me), 'the turn cannot pass while still over the limit (the button waits for a pick)');
  for (const id of ['ov1', 'ov2']) { await page.click(`#discard-cards .card-tile[data-card-id="${id}"]`); await page.waitForTimeout(80); await tap('#btn-discard-done'); }
  check((await page.textContent('#btn-discard-done')).trim() === 'Keep these 6', 'two discards later: "Keep these 6"');
  await tap('#btn-discard-done');
  check(await game(i => window.__game.state.activeIndex === (i + 1) % 6, me) && await kind() === 'pass', 'then the turn passes, to the pass screen');
  check(await game(i => window.__game.state.players[i].hand.filter(c => c.type !== 'possession').length === 6, me), 'with that guest down to 6 cards');
  // The possessed guest ending their turn with End turn: the same screen, and the Possession cards stay.
  check(await intoTurn(), 'the next guest starts their turn');
  const v = await game(() => window.__game.state.activeIndex);
  await game(() => {
    const g = window.__game, p = g.activePlayer();
    p.hand = [...['lantern', 'lantern', 'knife', 'knife', 'bandage', 'bandage', 'espresso', 'barricade'].map((t, i) => ({ id: `pv${i}`, type: t })),
      ...['x1', 'x2', 'x3'].map(id => ({ id, type: 'possession' }))];
    g.refresh();
  });
  await tap('#btn-end-turn');
  const e = await page.evaluate(() => ({ open: !document.getElementById('discard-overlay').hidden, ids: [...document.querySelectorAll('#discard-cards .card-tile')].map(t => t.dataset.cardId),
    sub: document.getElementById('discard-sub').textContent, page: document.getElementById('discard-overlay').innerText }));
  check(e.open && e.ids.length === 8 && !e.ids.some(id => /^x/.test(id)) && !/Possess|soul/i.test(e.page),
    'End turn with 8 ordinary cards + 3 Possession cards: the discard screen offers only the 8, and says nothing of possession');
  check(/You hold 8 cards/.test(e.sub), 'the count ignores Possession cards');
  for (const id of ['pv4', 'pv5']) { await page.click(`#discard-cards .card-tile[data-card-id="${id}"]`); await page.waitForTimeout(80); await tap('#btn-discard-done'); }
  await tap('#btn-discard-done');
  check(await game(i => window.__game.state.players[i].hand.filter(c => c.type === 'possession').length === 3
    && window.__game.state.players[i].hand.length === 9 && window.__game.state.activeIndex === (i + 1) % 6, v), 'the 3 Possession cards are kept; the turn passes');
  // Nothing of that hand waits in hidden markup during the next guest's pass screen: not the kept
  // cards on the discard screen, not the old fan, not the card view.
  await page.waitForTimeout(150);
  const left = await page.evaluate(() => ({ discard: document.querySelectorAll('#discard-cards *').length,
    fan: [...document.querySelectorAll('#hand-fan [data-card-id]')].map(e => e.dataset.cardId), souls: !!document.querySelector('#hand-fan .fan-badge.souls'),
    big: document.getElementById('hand-big').innerHTML, detail: document.getElementById('hand-detail').innerHTML, note: document.getElementById('hand-note').textContent }));
  check(await kind() === 'pass' && left.discard === 0 && !left.fan.some(id => /^(pv|x)/.test(id)) && !left.souls && !left.big && !left.detail && !left.note,
    `on the next pass screen no hidden screen still holds the previous guest's cards (${JSON.stringify(left)})`);
}

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
// Open a card the way a player does: tap it in the hand fan (it opens large, with its actions).
async function handCard(id) {
  if (await game(() => !document.getElementById('hand-overlay').hidden)) await tap('#btn-hand-close');
  await page.waitForTimeout(100);
  await page.click(`#hand-fan .fan-card[data-card-id="${id}"]`); await page.waitForTimeout(80);
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

  // A possessed guest rings it in their own turn. The notice is for the whole table, so their reminder
  // leaves the main screen behind it (the hidden fan included) and comes back once it is put away.
  await tap('#btn-end-turn');
  await intoTurn();
  await game(() => {
    const g = window.__game, p = g.activePlayer();
    p.possessed = true; p.roleChangePending = false; p.hand.push({ id: 'sx1', type: 'possession' }); g.refresh();
  });
  await put('switchboard', 4);
  await page.waitForTimeout(150);
  check(await visible('#panel-role') && await visible('#panel-souls'), 'a possessed guest in their own turn, in the Switchboard: their reminder is on');
  await tap('#btn-room');
  await page.waitForTimeout(150);
  check(await game(() => window.__game.noticeOpen()) && !(await visible('#panel-role')) && !(await visible('#panel-souls'))
    && !/POSSESS|souls to trade/i.test(await page.evaluate(() => document.getElementById('hud').innerText))
    && !(await page.$('#hand-fan .fan-card[data-type="possession"]')) && !(await page.$('#hand-fan .fan-badge.souls')),
    'while the Switchboard notice is up, no POSSESSED label, souls count or Possession card on the main screen behind it (nor in the hidden fan)');
  await shot('hs-11b-switchboard-possessed-own-turn');
  await tap('#btn-notice-ok');
  await page.waitForTimeout(150);
  check(await visible('#panel-role') && await visible('#panel-souls'), 'and it comes back once the notice is put away');
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
  check(await visible('#hand-overlay') && await game(() => window.__game.cardViewId()) === 'hm1', 'tapping the Hand Mirror in the fan opens it large');
  let btns = await detailButtons();
  check(btns.length === 1 && btns[0].text === who[E] && !btns[0].disabled, `the Hand Mirror offers one guest: "${btns[0]?.text}"`);
  check(/Whose hand\? · 1 action/.test(await page.textContent('#hand-detail')), 'and says what it costs');
  await clickBtn('#hand-detail .d-targets .btn', who[E]);
  check(await kind() === 'mirror' && await game(() => window.__game.mirrorOpen()), 'a private hand-over screen opens');
  check(!(await visible('#hand-overlay')), 'and the card view has closed');
  check(await fanGone(), 'the fan is off the screen while the mirror shows their hand');
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
    `the card view's banner now lists the unmasked guest ("${(await page.textContent('#hand-banner')).trim()}")`);
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
  check(await game(() => !window.__game.activePlayer().hand.some(c => c.id === 'es1') && window.__game.state.discardPile.some(c => c.id === 'es1')), 'the Espresso is used up');
  check(!(await visible('#hand-overlay')) && !(await fanIds()).includes('es1'), 'it leaves the fan, and its card view closes');
  await handCard('es2');
  check(/Actions 6 \(\+2\)/.test(await page.textContent('#hand-note')), `the card view says so too ("${(await page.textContent('#hand-note')).trim()}")`);
  await shot('hs-13-espresso');
  await tap('#btn-hand-close');
  // A search spends one of them as normal.
  await put(await plainRoom(), null);
  await settle();
  await searchHere();
  while (await game(() => window.__game.handoffOpen())) await next();
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

console.log('\n10f. a locked door: open until the end of the opener\'s turn, then locked again');
{
  await load(JOBS);
  await tap('#btn-begin'); await throughRoles(); await intoTurn();
  check(await game(() => window.__game.revealTile('cloakroom')), 'the Cloakroom (a locked room) is revealed');
  const L = 'cloakroom';
  const info = await game(l => { const g = window.__game, r = g.floor.rooms.get(l); return { nb: [...r.neighbours][0], door: r.doorways[0].id, n: r.doorways.length }; }, L);
  check(info.n === 1 && await game(l => window.__game.lockedRooms().includes(l), L), 'it has a single doorway, and its door is locked');
  // Everyone else waits in the lobby, so nobody is met on the way.
  await game(() => { const g = window.__game; g.state.players.forEach((p, i) => { p.possessed = i === 5; }); g.refresh(); });
  await put(info.nb, 4);
  await give(0, [{ id: 'mkh', type: 'masterKey' }]);
  await handCard('mkh');
  const btns = await detailButtons();
  check(btns.some(b => /^Open the Cloakroom door/.test(b.text)), `the Master Key offers to open that door (${btns.map(b => b.text).join(' | ')})`);
  check(/for the rest of your turn/.test(await page.textContent('#hand-detail')), 'and says it opens for the rest of your turn');
  check(!/no action left to go in/.test(await page.textContent('#hand-detail')), 'with actions to spare, no warning');
  await clickBtn('#hand-detail .btn', 'Open the Cloakroom door');
  check(await game(l => !window.__game.lockedRooms().includes(l) && window.__game.openLocks().includes(l), L), 'the key opens it');
  check(/Cloakroom door is open until the end of your turn/.test(await page.textContent('#toast')), `the toast says for how long ("${(await page.textContent('#toast')).trim()}")`);
  await game(l => window.__game.moveToRoom(l), L);
  await settle();
  check(await game(() => window.__game.activePlayer().currentRoom) === L, 'the guest who opened it walks in');
  // End of turn: the door locks again.
  await tap('#btn-end-turn');
  await intoTurn();
  check(await game(() => window.__game.state.activeIndex) === 1, 'the next guest\'s turn');
  check(await game(l => window.__game.lockedRooms().includes(l) && !window.__game.openLocks().includes(l), L), 'the door locked again at the end of the opener\'s turn');
  check(/Cloakroom door has locked again/.test(await page.textContent('#toast')), `the next guest is told ("${(await page.textContent('#toast')).trim()}")`);
  await page.waitForFunction(d => window.__game.doorways.views.get(d).leaf.userData.swing < 0.05, info.door, { timeout: 8000 }).catch(() => {});
  check(await game(d => { const v = window.__game.doorways.views.get(d), u = v.leaf.userData; return v.locked && v.shut && u.swing < 0.05 && u.pads.every(p => p.visible); }, info.door),
    'the door swings shut, padlocked, in the scene');
  // The next guest cannot follow in.
  await put(info.nb, 4);
  check(await game(l => window.__game.moveToRoom(l).ok, L) === false, 'the next guest cannot follow in');
  check(await game(d => !window.__game.doorways.views.get(d).blink.visible, info.door), 'and the door has no ring for them');
  await shot('hs-14-locked-again');
  await game(() => { const g = window.__game, p = g.activePlayer(), c = g.roomCenter('hall'); p.currentRoom = 'hall'; g.movers[p.index].reset(c[0], c[1]); g.discovery.refresh(); g.refresh(); });
  // Round the table to the guest inside: they can walk out, and the door stays locked behind them.
  for (let i = 1; i < 6; i++) { await tap('#btn-end-turn'); await intoTurn(); }
  check(await game(() => window.__game.state.activeIndex) === 0 && await game(() => window.__game.activePlayer().currentRoom) === L, 'back to the guest inside the locked room');
  check(await game(d => { const v = window.__game.doorways.views.get(d); return v.locked && !v.shut && v.blink.visible; }, info.door),
    'for them the padlocked door stands open, with a ring: it is the way out');
  const out = await game(n => window.__game.moveToRoom(n).ok, info.nb);
  await settle();
  check(out && await game(() => window.__game.activePlayer().currentRoom) === info.nb, 'the guest inside walks out');
  check(await game(l => window.__game.lockedRooms().includes(l), L), 'the door stays locked behind them');
  check(await game(l => window.__game.moveToRoom(l).ok, L) === false, 'and getting back in takes another key');
}

console.log('\n10g. a key or pick is never wasted without a word');
{
  await load(JOBS);
  await tap('#btn-begin'); await throughRoles(); await intoTurn();
  check(await game(() => window.__game.revealTile('cloakroom')), 'the Cloakroom (a locked room) is revealed');
  const info = await game(() => { const r = window.__game.floor.rooms.get('cloakroom'); return { nb: [...r.neighbours][0], door: r.doorways[0].id }; });
  await game(() => { const g = window.__game; g.state.players.forEach((p, i) => { p.possessed = i === 5; }); g.refresh(); });
  const noEspresso = () => game(() => { const p = window.__game.activePlayer(); p.hand = p.hand.filter(c => c.type !== 'espresso'); window.__game.refresh(); });
  // The last action, and no Espresso: the key may still be played, but the card view warns.
  await noEspresso();
  await put(info.nb, 1);
  await give(0, [{ id: 'mkw', type: 'masterKey' }]);
  await handCard('mkw');
  let btns = await detailButtons();
  check(/You will have no action left to go in/.test(await page.textContent('#hand-detail')) && btns.some(b => /^Open the Cloakroom door/.test(b.text) && !b.disabled),
    `with one action and no Espresso the key can still be played, and the card warns there will be no action left to go in (${btns.map(b => b.text).join(' | ')})`);
  await shot('hs-15-key-last-action-warning');
  await give(0, [{ id: 'esw', type: 'espresso' }]);
  await handCard('mkw');
  check(!/no action left to go in/.test(await page.textContent('#hand-detail')), 'holding an Espresso, no warning (it gives the actions to go in)');
  await noEspresso();
  await put(info.nb, 2);
  await handCard('mkw');
  check(!/no action left to go in/.test(await page.textContent('#hand-detail')), 'with two actions, no warning');
  // A barricaded locked door: the key is refused, and nothing is spent.
  await game(d => { const g = window.__game; g.state.barricades.set(d, { by: g.state.players[3].id, placedTurn: g.state.turn }); g.refresh(); }, info.door);
  await handCard('mkw');
  btns = await detailButtons();
  check(/Cloakroom door is barricaded/.test(await page.textContent('#hand-detail')) && btns.some(b => /^Open the Cloakroom door/.test(b.text) && b.disabled),
    `on a barricaded door the button is greyed out, and the card says why (${btns.map(b => `${b.text}${b.disabled ? ' [off]' : ''}`).join(' | ')})`);
  await shot('hs-16-key-barricaded-door');
  await game(() => window.__game.unlock('mkw', 'cloakroom'));
  check(/barricaded/.test(await page.textContent('#toast')) && await game(() => { const g = window.__game, p = g.activePlayer();
    return p.actionPoints === 2 && p.hand.some(c => c.id === 'mkw') && g.lockedRooms().includes('cloakroom'); }),
    'played anyway, it is refused: the key stays in hand, the actions too, the door stays locked');
  // The door a key has open this turn shows an OPEN padlock; when it locks again, the closed one is back.
  await game(() => { window.__game.state.barricades.clear(); window.__game.refresh(); });
  await put(info.nb, 4);
  const sign = () => game(d => { const v = window.__game.doorways.views.get(d); return { opened: v.openedNow, locked: v.locked, mark: v.mark.visible, mat: v.mark.material.uuid }; }, info.door);
  const before = await sign();
  await handCard('mkw');
  await clickBtn('#hand-detail .btn', 'Open the Cloakroom door');
  const during = await sign();
  check(before.locked && before.mark && !before.opened, 'a locked door shows the closed padlock sign');
  check(during.opened && !during.locked && during.mark && during.mat !== before.mat, `opened by the key, it shows an OPEN padlock sign: it will lock again (${JSON.stringify(during)})`);
  await shot('hs-17-open-padlock-this-turn');
  await tap('#btn-end-turn');
  await intoTurn();
  const after = await sign();
  check(after.locked && !after.opened && after.mark && after.mat === before.mat, 'at the end of the turn it locks again, and the closed padlock is back');
}

console.log('\n11. practice is untouched');
await load('');
check(await game(() => window.__game.mode === 'practice' && window.__game.state.players.length === 1), 'the plain address is still one guest alone');

console.log('\n12. layouts');
for (const [name, w, h] of [['ipad-landscape', 1180, 820], ['ipad-small', 1024, 768], ['ipad-pro', 1366, 1024], ['desktop', 1440, 900]]) {
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
  const fanOk = await page.evaluate(() => {
    const box = el => el && el.offsetParent ? el.getBoundingClientRect() : null;
    const hit = (a, b) => !!a && !!b && a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
    const cards = [...document.querySelectorAll('#hand-fan .fan-card')].map(c => c.getBoundingClientRect());
    const keep = ['#player-panel', '.control-row', '.action-row', '#btn-map', '.hud-top-center', '.hud-top-right'].map(s => box(document.querySelector(s)));
    // (at rest the cards are held partly below the screen edge; at least 70% of each shows)
    return cards.length > 0 && cards.every(c => !keep.some(k => hit(c, k)) && innerHeight - c.top >= 0.68 * c.height);
  });
  check(fanOk, `${name}: the hand fan sits clear of the panel, the buttons, the map and the guest strip`);
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
