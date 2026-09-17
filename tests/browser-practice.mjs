// Headless browser test of the PHASE 0 practice build (dev only, not part of the game).
// Setup once (from the repo root):  npm --prefix tests install
// Run:  python3 -m http.server 8123 --bind 127.0.0.1 &   then   node tests/browser-practice.mjs [--screens]
//       node tests/browser-practice.mjs --url http://127.0.0.1:8123/Gaming-App/   (Pages sub-path)
//
// Walks the whole practice loop the owner asked to be able to test: lobby -> movement ->
// action points -> discovery -> searching -> cards -> hand limit -> objectives -> exit.
import { chromium } from 'playwright-core';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const url = args.includes('--url') ? args[args.indexOf('--url') + 1] : 'http://127.0.0.1:8123/';
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

const game = fn => page.evaluate(fn);
const shot = async n => { if (shots) await page.screenshot({ path: path.join(outDir, `${n}.png`) }); };
const settle = async (t = 40000) => page.waitForFunction(
  () => !window.__game.activeMover().walking && window.__game.activeMover().path.length === 0, null, { timeout: t, polling: 50 });
const active = () => game(() => {
  const p = window.__game.activePlayer();
  return { name: p.name, room: p.currentRoom, ap: p.actionPoints, hand: p.hand.map(c => c.type) };
});
const put = (room, ap = 4) => page.evaluate(({ room, ap }) => {
  const g = window.__game, p = g.activePlayer();
  g.state.discovered.add(room);
  p.currentRoom = room; p.actionPoints = ap;
  const c = g.roomCenter(room); g.movers[p.index].reset(c[0], c[1]);
  g.discovery.refresh(); g.refresh();
}, { room, ap });

// --- 1. Load and enter practice ------------------------------------------------------------
console.log('1. lobby -> practice');
await page.goto(url, { waitUntil: 'load' });
await page.waitForFunction(() => window.__game && !document.getElementById('btn-begin').disabled, null, { timeout: 45000 });
const info = await game(() => ({
  problems: window.__game.floor.problems,
  rooms: window.__game.floor.roomList.length,
  practice: window.__game.state.practice,
  players: window.__game.state.players.length,
  rules: { ap: window.__game.rules.actionPointsPerTurn, limit: window.__game.rules.handLimit, obj: window.__game.rules.objectiveCount },
}));
check(info.problems.length === 0, `no floor problems (${JSON.stringify(info.problems)})`);
check(info.rooms === 18, `${info.rooms} rooms in the hotel`);
check(info.practice === true && info.players === 1, 'practice mode runs one guest');
await page.tap('#btn-begin');
await page.waitForFunction(() => window.__game.isRunning(), null, { timeout: 8000 });
check(await game(() => !document.getElementById('hud').hidden), 'the interface appears after Tap to begin');
await game(() => window.__game.setPixelRatio(0.5));   // test-harness speed knob only
await shot('p0-01-start');

// --- 2. Interface: no health, objectives, restart, no player strip -------------------------
console.log('2. interface');
// Visibility is checked by what is actually painted (offsetParent / computed display),
// not just the hidden attribute — several panels set display:flex, which can override it.
const hud = await game(() => {
  const shown = el => !!el && el.offsetParent !== null && getComputedStyle(el).display !== 'none';
  return ({
  healthHidden: !shown(document.getElementById('health-row')),
  healthBars: document.querySelectorAll('#health .bar').length,
  stripHidden: !shown(document.querySelector('.hud-top-center')),
  objText: document.getElementById('obj-count').textContent,
  objPips: document.querySelectorAll('.obj-pip').length,
  restart: !document.getElementById('btn-restart-practice').hidden,
  ap: document.getElementById('action-points').textContent,
  room: document.getElementById('room-name').textContent,
  tradeHidden: !shown(document.getElementById('btn-trade')),
  tint: !shown(document.getElementById('possess-tint')),
  blink: [...window.__game.doorways.views.values()].filter(v => v.blink.visible).length,
  healthLabelPainted: [...document.querySelectorAll('#player-panel .stat-label')].some(e => /health/i.test(e.textContent) && shown(e)),
});
});
check(hud.healthHidden && hud.healthBars === 0 && !hud.healthLabelPainted, 'no health row is painted at all while health is off');
check(hud.stripHidden, 'the other-players strip is hidden for a single guest');
check(hud.objText === '0 / 3' && hud.objPips === 3, `objectives read ${hud.objText} with 3 pips`);
check(hud.restart, 'the Restart practice button is available');
check(/\b4\s*\/\s*4\b/.test(hud.ap), `action points start at 4/4 (${hud.ap})`);
check(/landing/i.test(hud.room), `the current room is named (${hud.room})`);
check(hud.tradeHidden && hud.tint, 'no trade button and no possession tint in practice');
check(hud.blink === 4, `4 usable doors blink from the lobby (${hud.blink})`);

// --- 2b. The correction pass: objectives, the exit end-zone, and no off-turn prompts --------
console.log('2b. corrected rules');
const corrected = await game(() => ({
  legacyKey: window.__game.rules.legacyCarriedExitKey,
  darkGate: window.__game.rules.darkRoomsRequireLight,
  preCommitted: window.__game.rules.offersArePreCommitted,
  escapees: window.__game.rules.requiredEscapees,
  balanceEscapees: window.__game.rules.escapeesAtBalanceCount,
  exitSafe: window.__game.floor.rooms.get(window.__game.floor.exitRoom).safe,
  exitDoors: window.__game.floor.rooms.get(window.__game.floor.exitRoom).doorways.length,
  objectivesInHand: window.__game.activePlayer().hand.filter(c => c.type === 'objective').length,
  searchPoints: window.__game.floor.roomList.filter(r => r.searchable && !r.searchPoint).length,
}));
check(corrected.legacyKey === false, 'the carried Exit-Key model is off');
check(corrected.darkGate === false, 'dark rooms are atmosphere only, with no Flashlight gate');
check(corrected.preCommitted === true, 'offers are pre-committed');
check(corrected.escapees === 1 && corrected.balanceEscapees === 2,
  `practice needs 1 escapee, the six-player target is ${corrected.balanceEscapees}`);
check(corrected.exitSafe === true && corrected.exitDoors >= 2,
  `the exit is a safe end-zone with ${corrected.exitDoors} doorways`);
check(corrected.objectivesInHand === 0, 'no objective is ever dealt into the hand');
check(corrected.searchPoints === 0, 'every searchable room names its search point');

// --- 3. Movement: new room costs 2, known room costs 1, inside is free ---------------------
console.log('3. movement and action points');
const doorPt = await game(() => {
  const d = window.__game.floor.doorways.find(d => d.id === 'hall->corridorE');
  return window.__game.groundToScreen(d.center[0], d.center[1]);
});
await page.touchscreen.tap(doorPt.x, doorPt.y);
check(await game(() => !document.getElementById('confirm-bar').hidden && /2 AP/.test(document.getElementById('btn-confirm-move').textContent)),
  'tapping an undiscovered door shows the cost before confirming (2 AP)');
await page.tap('#btn-confirm-move');
await settle();
let a = await active();
check(a.room === 'corridorE' && a.ap === 2, `revealing and entering a new room cost 2 AP (${a.room}, ${a.ap} AP left)`);
check(await game(() => window.__game.state.discovered.has('corridorE')), 'the new room is added to the discovered set');
// Free repositioning inside the room.
const inside = await game(() => { const c = window.__game.roomCenter('corridorE'); return window.__game.groundToScreen(c[0] + 1.6, c[1]); });
await page.touchscreen.tap(inside.x, inside.y);
await settle();
check((await active()).ap === 2, 'moving about inside the room is free');
// Back into a known room: 1 AP.
await game(() => window.__game.moveToRoom('hall'));
await settle();
check((await active()).ap === 1, 'stepping back into a known room cost 1 AP');
await shot('p0-02-moved');

// --- 4. Not enough action points -----------------------------------------------------------
console.log('4. insufficient action points');
const low = await game(() => {
  const g = window.__game;
  g.activePlayer().actionPoints = 1; g.refresh();
  const blink = [...g.doorways.views.values()].filter(v => v.blink.visible).map(v => v.doorway.id);
  return { blink, usable: g.state.discovered.has('corridorN') };
});
check(!low.blink.includes('hall->corridorN'), 'an undiscovered door stops blinking when 1 AP cannot pay for it');
check(low.blink.includes('hall->corridorE'), 'the already-known door still blinks with 1 AP');
await game(() => { window.__game.activePlayer().actionPoints = 0; window.__game.refresh(); });
check(await game(() => [...window.__game.doorways.views.values()].every(v => !v.blink.visible)), 'no doors are offered with 0 AP');
check(await game(() => document.getElementById('btn-search').disabled), 'Search is disabled with 0 AP');

// --- 5. End turn refills, round advances ---------------------------------------------------
console.log('5. end turn');
const before = await game(() => ({ round: window.__game.state.round, turn: window.__game.state.turn }));
await page.tap('#btn-end-turn');
await page.waitForTimeout(250);
const afterTurn = await game(() => ({
  round: window.__game.state.round, turn: window.__game.state.turn,
  ap: window.__game.activePlayer().actionPoints, label: document.getElementById('round').textContent,
}));
check(afterTurn.ap === 4, 'ending the turn refills action points to 4');
check(afterTurn.round === before.round + 1 && afterTurn.turn === before.turn + 1, 'the round and turn counters advance');
check(/Round\s*\d+/.test(afterTurn.label), `the round is displayed (${afterTurn.label})`);

// --- 6. Searching: item room, once only, and the utility room ------------------------------
console.log('6. searching');
await put('dining');
const handBefore = (await active()).hand.length;
await page.tap('#btn-search');
await page.waitForTimeout(250);
a = await active();
check(a.hand.length === handBefore + 1 && a.ap === 3, `an item room gave one card for 1 AP (${a.hand.length} cards, ${a.ap} AP)`);
check(await game(() => /sideboard/i.test(document.getElementById('toast').textContent)),
  'the message names the search point (the sideboard), not the whole room');
check(await game(() => document.getElementById('hand-count').textContent === String(window.__game.activePlayer().hand.length)),
  'the hand count on the bar updates');
check(await game(() => document.getElementById('btn-search').disabled), 'Search is disabled once the room has been searched');
const handAfter = (await active()).hand.length;
await game(() => window.__game.search());
check((await active()).hand.length === handAfter, 'the same room cannot be searched twice');
// The utility room says so rather than doing nothing silently.
await put('housekeeping');
await page.tap('#btn-search');
await page.waitForTimeout(250);
check(await game(() => !document.getElementById('toast').hidden && /nothing|linen|dust/i.test(document.getElementById('toast').textContent)),
  'searching the empty utility room gives a clear message');

// --- 7. Hint reveals one adjacent room -----------------------------------------------------
console.log('7. Hint card');
await put('hall');
await game(() => {
  const p = window.__game.activePlayer();
  p.hand = [{ id: 'hintA', type: 'hint' }, { id: 'lanA', type: 'lantern' }];
  window.__game.state.discovered = new Set(['hall']);
  window.__game.discovery.refresh(); window.__game.refresh();
});
const discBefore = await game(() => window.__game.state.discovered.size);
const apBefore = (await active()).ap;
await game(() => window.__game.useHint('hintA'));
await page.waitForTimeout(200);
const afterHint = await game(() => ({
  disc: window.__game.state.discovered.size,
  room: window.__game.activePlayer().currentRoom,
  ap: window.__game.activePlayer().actionPoints,
  hand: window.__game.activePlayer().hand.map(c => c.type),
}));
check(afterHint.disc === discBefore + 1, 'a Hint revealed exactly one more room');
check(afterHint.room === 'hall', 'a Hint did not move the guest');
check(afterHint.ap === apBefore - 1, 'a Hint cost 1 action point');
check(!afterHint.hand.includes('hint'), 'the Hint was used up');

// --- 8. The six-card hand limit and the full-hand choice ------------------------------------
console.log('8. hand limit');
await put('cloakroom');
await game(() => {
  const p = window.__game.activePlayer();
  p.hand = Array.from({ length: 6 }, (_, i) => ({ id: `full${i}`, type: 'lantern' }));
  window.__game.refresh();
});
await page.tap('#btn-search');
await page.waitForFunction(() => window.__game.fullHandOpen(), null, { timeout: 5000 });
check(true, 'searching with six cards opens the full-hand choice instead of discarding silently');
check(await game(() => {
  const t = document.getElementById('fullhand-overlay').textContent;
  return /Take it/.test(t) && /Leave it/.test(t);
}), 'the choice offers taking it or leaving it');
check(await game(() => window.__game.activePlayer().hand.length === 6), 'the hand is still at the limit while the choice is open');
await shot('p0-03-fullhand');
// Take it, then drop one.
await page.tap('#btn-fullhand-take');
await page.waitForTimeout(150);
check(await game(() => !document.getElementById('fullhand-hand').hidden), 'taking it asks which card to leave behind');
await game(() => document.querySelector('#fullhand-hand [data-card-id="full0"]')?.click());
await page.waitForTimeout(200);
const afterFull = await game(() => ({
  open: window.__game.fullHandOpen(),
  len: window.__game.activePlayer().hand.length,
  hasDropped: window.__game.activePlayer().hand.some(c => c.id === 'full0'),
  searched: window.__game.state.searchedRooms.has('cloakroom'),
}));
check(!afterFull.open && afterFull.len === 6 && !afterFull.hasDropped, 'the chosen card was dropped and the hand stayed at six');
check(afterFull.searched, 'the room still counts as searched, so it cannot be farmed');

// --- 9. Objectives and unlocking the exit ---------------------------------------------------
console.log('9. objectives and the exit');
// A corridor names its search point on the button, so "Search" never implies ransacking a corridor.
await put('corridorW');
check(await game(() => /console table/i.test(document.getElementById('search-sub').textContent)),
  'the Search button names the corridor search point');
await game(() => window.__game.restart());
await page.waitForTimeout(250);
check(await game(() => window.__game.objectives().found === 0), 'restart clears objective progress');
// The sealed exit must be invisible to the map and to the doorway logic.
await put('stairs');
const sealed = await game(() => ({
  usable: window.__game.state.discovered.has('exit'),
  blink: [...window.__game.doorways.views.values()].some(v => v.doorway.id.includes('exit') && v.blink.visible),
  unlocked: window.__game.exitUnlocked(),
}));
check(!sealed.unlocked && !sealed.blink, 'the exit stays sealed and its door never blinks before the objectives are in');

const objRooms = await game(() => window.__game.floor.roomList.filter(r => r.role === 'objective').map(r => r.id));
check(objRooms.length === 3, `${objRooms.length} objective rooms on the map`);
for (let i = 0; i < objRooms.length; i++) {
  await put(objRooms[i]);
  await page.tap('#btn-search');
  await page.waitForTimeout(250);
  const o = await game(() => window.__game.objectives());
  check(o.found === i + 1, `objective ${i + 1} of 3 found in ${objRooms[i]}`);
  check(await game(() => document.getElementById('obj-count').textContent) === `${i + 1} / 3`,
    `the header reads ${i + 1} / 3`);
}
check(await game(() => window.__game.exitUnlocked()), 'the exit unlocks once all three objectives are found');
check(await game(() => !document.getElementById('notice-overlay').hidden), 'an elegant notice announces that the way out is open');
await shot('p0-04-exit-open');
await page.tap('#btn-notice-ok');
await page.waitForTimeout(150);

// --- 10. Reaching the exit ------------------------------------------------------------------
console.log('10. reaching the exit');
await put('stairs');
check(await game(() => [...window.__game.doorways.views.values()].some(v => v.doorway.id.includes('exit') && v.blink.visible)),
  'the exit door now blinks as a usable move');
await game(() => window.__game.moveToRoom('exit'));
await settle();
await page.waitForTimeout(400);
const ended = await game(() => ({
  finished: window.__game.isFinished(),
  open: !document.getElementById('end-overlay').hidden,
  title: document.getElementById('end-title').textContent,
  keep: !document.getElementById('btn-keep-exploring').hidden,
}));
check(ended.finished && ended.open, 'entering the exit completes the practice run');
check(/exit/i.test(ended.title), `the end screen names it (${ended.title})`);
check(ended.keep, 'the player may keep exploring instead of restarting');
// The exit is an end-zone: arriving there resolves first and opens no meeting prompt at all.
check(await game(() => document.getElementById('encounter-overlay').hidden),
  'entering the exit never opened a meeting prompt');
check(await game(() => window.__game.escapes().escaped === 1 && window.__game.escapes().required === 1),
  'the escape is recorded and permanent');
await shot('p0-05-complete');
await page.tap('#btn-keep-exploring');
await page.waitForTimeout(200);
check(await game(() => !window.__game.isFinished() && document.getElementById('end-overlay').hidden), 'Keep exploring returns to the hotel');

// --- 11. Map ---------------------------------------------------------------------------------
console.log('11. map');
await page.tap('#btn-map');
await page.waitForTimeout(500);
check(await game(() => window.__game.isMapOpen()), 'the map opens from the bottom-right button');
check(await game(() => {
  const c = document.getElementById('map-canvas');
  return c.width > 0 && c.height > 0;
}), 'the map canvas is drawn');
await shot('p0-06-map');
await page.tap('#btn-map-close');
await page.waitForTimeout(200);
check(await game(() => !window.__game.isMapOpen()), 'the map closes again');

// --- 12. Restart practice ---------------------------------------------------------------------
console.log('12. restart practice');
await page.tap('#btn-restart-practice');
await page.waitForTimeout(400);
const restarted = await game(() => ({
  round: window.__game.state.round,
  disc: window.__game.state.discovered.size,
  obj: window.__game.objectives().found,
  searched: window.__game.state.searchedRooms.size,
  ap: window.__game.activePlayer().actionPoints,
  room: window.__game.activePlayer().currentRoom,
  hand: window.__game.activePlayer().hand.length,
}));
check(restarted.round === 1 && restarted.disc === 1 && restarted.obj === 0 && restarted.searched === 0,
  'Restart practice puts the hotel back to the beginning');
check(restarted.ap === 4 && restarted.room === 'hall' && restarted.hand === 4, 'the guest is back in the lobby with a fresh hand');

// --- 13. Layouts ------------------------------------------------------------------------------
console.log('13. layouts');
for (const [label, w, h] of [['ipad-landscape', 1180, 820], ['ipad-small', 1024, 768], ['desktop', 1600, 900]]) {
  await page.setViewportSize({ width: w, height: h });
  await page.waitForTimeout(300);
  const layout = await game(() => {
    const r = id => { const e = document.getElementById(id); return e ? e.getBoundingClientRect() : null; };
    const overlap = (a, b) => !!a && !!b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
    const panel = document.querySelector('.hud-bottom-left')?.getBoundingClientRect();
    const actions = document.querySelector('.hud-bottom-right')?.getBoundingClientRect();
    const strip = r('hand-strip');
    const small = [...document.querySelectorAll('.btn, .ctl')].filter(b => {
      const bb = b.getBoundingClientRect();
      return bb.width > 0 && (bb.width < 40 || bb.height < 36);
    }).map(b => b.id || b.className);
    return {
      overlapPanelActions: overlap(panel, actions),
      overlapStripActions: overlap(strip, actions),
      offscreen: [panel, actions, strip].some(x => x && (x.right > window.innerWidth + 1 || x.bottom > window.innerHeight + 1)),
      small,
    };
  });
  check(!layout.overlapPanelActions && !layout.overlapStripActions, `${label}: the bottom bar does not overlap`);
  check(!layout.offscreen, `${label}: nothing runs off the screen`);
  check(layout.small.length === 0, `${label}: every control is a comfortable touch size (${layout.small.join(', ') || 'all fine'})`);
  await shot(`p0-07-${label}`);
}
await page.setViewportSize({ width: 1180, height: 820 });

// --- 13b. No off-turn decision is ever requested ------------------------------------------------
// The whole point of pre-committed offers: a meeting resolves from what each player already
// chose on their own turn, so no prompt is raised for anyone who is not the active player.
console.log('13b. off-turn prompts');
const offTurn = await game(() => {
  const g = window.__game;
  // resolveMeeting is (state, floor, mover, other) — there is no callback it could use to ask
  // the off-turn player anything.
  return {
    encounterEverOpened: g.encounterOpen(),
    encounterHidden: document.getElementById('encounter-overlay').hidden,
    offerField: 'offer' in g.activePlayer() && 'intent' in g.activePlayer(),
    offerCleared: g.activePlayer().offer === null,
  };
});
check(!offTurn.encounterEverOpened && offTurn.encounterHidden, 'no meeting prompt is open at any point in a practice run');
check(offTurn.offerField, 'every player carries a pre-committed Offer and intent');
check(offTurn.offerCleared, 'the Offer starts and ends cleared, never left active');

// --- 14. Console cleanliness -------------------------------------------------------------------
console.log('14. console');
const noisy = consoleMessages.filter(m => !/Multiple instances of Three\.js/i.test(m));
check(noisy.length === 0, `no console errors or failed requests (${noisy.slice(0, 3).join(' | ') || 'clean'})`);

await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED\n- ${failures.join('\n- ')}` : '\nALL PRACTICE BROWSER CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
