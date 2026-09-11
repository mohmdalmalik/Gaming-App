// Headless browser test of Hotel Escape (dev only, not part of the game).
// Setup once (from the repo root):  npm --prefix tests install
// Run:  python3 -m http.server 8123 --bind 127.0.0.1 &   then   node tests/browser-test.mjs [--screens]
// Chromium is found via CHROME_PATH or Playwright's usual /opt/pw-browsers location; the
// Three.js CDN requests are served from tests/node_modules/three so it works offline.
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
const settle = async (t = 40000) => { await page.waitForFunction(() => !window.__game.activeMover().walking && window.__game.activeMover().path.length === 0, null, { timeout: t, polling: 50 }); };
const active = () => game(() => { const p = window.__game.activePlayer(); return { name: p.name, room: p.currentRoom, ap: p.actionPoints, hp: p.health, possessed: p.possessed, hand: p.hand.map(c => c.type), knows: [...p.knows] }; });

// Arrange an encounter: put player `otherIdx` in `room`, active player (0) in the hall, with
// chosen hands. `room` must be adjacent to the hall.
async function arrange(room, opts) {
  await page.evaluate(({ room, otherIdx, vPoss, oPoss, vHand, oHand }) => {
    const g = window.__game, s = g.state;
    s.discovered.add(room); g.discovery.refresh();
    // Deterministic possession: only the two players in this scenario, as specified.
    s.players.forEach((p, i) => { p.alive = true; p.possessed = i === 0 ? !!vPoss : i === otherIdx ? !!oPoss : false; p.knows = new Set(); });
    const V = s.players[0], O = s.players[otherIdx];
    V.currentRoom = 'hall'; const h = g.roomCenter('hall'); g.movers[0].reset(h[0], h[1]);
    O.currentRoom = room; const c = g.roomCenter(room); g.movers[otherIdx].reset(c[0], c[1]);
    // Park everyone else back in the hall so they can't join the encounter.
    s.players.forEach((p, i) => { if (i !== 0 && i !== otherIdx) { p.currentRoom = 'hall'; g.movers[i].reset(h[0] + (i - 2) * 0.6, h[1] + 1.5); } });
    s.activeIndex = 0; V.actionPoints = 4;
    if (vHand) V.hand = vHand.map((t, i) => ({ id: `v${i}`, type: t, ...(t === 'revolver' ? { shots: 2 } : {}) }));
    if (oHand) O.hand = oHand.map((t, i) => ({ id: `o${i}`, type: t }));
    s.encounterLocks.clear();
  }, { room, otherIdx: opts.otherIdx ?? 1, vPoss: opts.vPoss, oPoss: opts.oPoss, vHand: opts.vHand, oHand: opts.oHand });
}
const openEncounter = async room => { await page.evaluate(id => window.__game.moveToRoom(id), room); await settle(); await page.waitForFunction(() => window.__game.encounterOpen(), null, { timeout: 8000 }); };
const clickBtn = async label => page.evaluate(l => { const b = [...document.querySelectorAll('#encounter-actions button, .modal-actions button')].find(x => x.textContent.trim().startsWith(l)); b?.click(); }, label);
const clickCard = async id => page.evaluate(cid => document.querySelector(`#encounter-body [data-card-id="${cid}"]`)?.click(), id);

// --- 1. Load -----------------------------------------------------------------------------
console.log('1. load');
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
await page.waitForFunction(() => !document.getElementById('btn-begin').disabled, null, { timeout: 10000 });
const info = await game(() => ({ problems: window.__game.floor.problems, rooms: window.__game.floor.roomList.length, programs: window.__game.programCount() }));
check(info.problems.length === 0, `no floor problems (${JSON.stringify(info.problems)})`);
check(info.rooms === 14, `${info.rooms} rooms`);

console.log('2. begin & HUD');
await page.tap('#btn-begin');
// The dressed starting room is fill-rate heavy under the software (swiftshader) renderer used
// here — a real GPU is unaffected. Drop the render resolution so timed walks finish quickly;
// this is a test-harness speed knob only and changes no game logic.
await page.evaluate(() => window.__game.setPixelRatio(0.5));
await page.waitForTimeout(300);
const hud = await game(() => ({
  hudShown: !document.getElementById('hud').hidden,
  hp: document.getElementById('health').children.length,
  strip: document.querySelectorAll('#players-strip .mini-player').length,
  panelPortrait: !!document.querySelector('#portrait-slot svg'),
  stripPortraits: document.querySelectorAll('#players-strip .mini-portrait svg').length,
  handCount: document.getElementById('hand-count').textContent,
  backs: document.querySelectorAll('#hand-backs .card-back').length,
  ap: document.getElementById('action-points').textContent,
  possessedCount: window.__game.state.players.filter(p => p.possessed).length,
  handOk: window.__game.state.players.every(p => p.hand.filter(c => c.type === 'lantern').length >= 1),
  blink: [...window.__game.doorways.views.values()].filter(v => v.blink.visible).length,
}));
check(hud.hudShown && hud.hp === 3 && hud.strip === 5, `HUD: 3 health bars, 5 players in the top strip`);
check(hud.panelPortrait && hud.stripPortraits === 5, `portraits render (panel + ${hud.stripPortraits} in the strip)`);
check(Number(hud.handCount) >= 4 && hud.backs === Number(hud.handCount), `face-down hand shows the card count (${hud.handCount})`);
check(hud.ap === 'AP 4 / 4', `AP starts at 4/4 (${hud.ap})`);
check(hud.possessedCount === 1, 'exactly one player possessed');
check(hud.handOk, 'every hand has a Lantern');
check(hud.blink === 4, `4 usable doors blink from the central hall (${hud.blink})`);
await shot('r1-start');

console.log('2b. possessed portrait, screen tint, hidden top-strip role');
const wasPossessed = await game(() => window.__game.activePlayer().possessed);
await game(() => { window.__game.activePlayer().possessed = true; window.__game.refresh(); });
const poss = await game(() => ({
  tint: !document.getElementById('possess-tint').hidden,
  panel: document.getElementById('player-panel').classList.contains('possessed'),
  panelWeird: !!document.querySelector('#portrait-slot svg.possessed'),
  stripNormal: document.querySelector('#players-strip .mini-player.active .portrait-svg.possessed') === null,
}));
check(poss.tint && poss.panel && poss.panelWeird, 'a possessed active player shows the weird-eye portrait and a screen tint');
check(poss.stripNormal, 'the top strip never reveals a possessed role');
await page.evaluate(w => { window.__game.activePlayer().possessed = w; window.__game.refresh(); }, wasPossessed);

// --- 3. Move by door + confirm -----------------------------------------------------------
console.log('3. move by tapping a door + confirm');
const doorPt = await game(() => { const d = window.__game.floor.doorways.find(d => d.id === 'hall->corridorE'); return window.__game.groundToScreen(d.center[0], d.center[1]); });
await page.touchscreen.tap(doorPt.x, doorPt.y);
await page.waitForTimeout(150);
check(await game(() => !document.getElementById('confirm-bar').hidden && /2 AP/.test(document.getElementById('btn-confirm-move').textContent)), 'tapping an undiscovered door shows a 2 AP confirm');
await page.click('#btn-confirm-move');
await settle();
let a = await active();
check(a.room === 'corridorE' && a.ap === 2, `discovering + entering East Corridor cost 2 AP (${a.room}, ${a.ap})`);

console.log('4. free reposition inside a room (no AP)');
const inside = await game(() => window.__game.groundToScreen(...(() => { const c = window.__game.roomCenter('corridorE'); return [c[0] + 1.5, c[1]]; })()));
await page.touchscreen.tap(inside.x, inside.y);
await settle();
check((await active()).ap === 2, `repositioning inside the room is free (${(await active()).ap})`);

// --- 5. Search ---------------------------------------------------------------------------
console.log('5. search (searchable, once, dark)');
// A corridor cannot be searched — the button is disabled.
check(await game(() => document.getElementById('btn-search').disabled), 'the Search button is disabled in a corridor');
// A searchable room draws once.
await game(() => { const g = window.__game, p = g.activePlayer(); ['dining'].forEach(r => g.state.discovered.add(r)); g.discovery.refresh(); p.currentRoom = 'dining'; const c = g.roomCenter('dining'); g.movers[g.state.activeIndex].reset(c[0], c[1]); p.actionPoints = 4; g.refresh(); });
let before = (await active()).hand.length;
await page.click('#btn-search');
await page.waitForTimeout(200);
a = await active();
check(a.hand.length === before + 1 && a.ap === 3, `a searchable room drew a card for 1 AP (${a.hand.length} cards, ${a.ap} AP)`);
check(await game(() => document.getElementById('hand-count').textContent === String(window.__game.activePlayer().hand.length)), 'the face-down hand count updates after searching');
check(await game(() => document.getElementById('btn-search').disabled), 'Search is disabled after the room has been searched once');
before = (await active()).hand.length;
await game(() => window.__game.search());
await page.waitForTimeout(120);
check((await active()).hand.length === before, 'a room cannot be searched twice');
// A dark searchable room needs a Flashlight.
await game(() => { const g = window.__game, p = g.activePlayer(); g.state.discovered.add('storage'); g.discovery.refresh(); p.currentRoom = 'storage'; const c = g.roomCenter('storage'); g.movers[g.state.activeIndex].reset(c[0], c[1]); p.hand = p.hand.filter(c => c.type !== 'flashlight'); p.actionPoints = 4; g.refresh(); });
const darkBefore = (await active()).hand.length;
await game(() => window.__game.search());
await page.waitForTimeout(150);
check(await game(() => /Flashlight/.test(document.getElementById('toast').textContent)) && (await active()).hand.length === darkBefore, 'a dark room cannot be searched without a Flashlight');
await game(() => { window.__game.activePlayer().hand.push({ id: 'fl', type: 'flashlight' }); window.__game.refresh(); });
const flBefore = (await active()).hand.length;
await page.click('#btn-search');
await page.waitForTimeout(200);
check((await active()).hand.length === flBefore + 1, 'with a Flashlight the dark searchable room can be searched');

// --- 6. Hand panel + bandage -------------------------------------------------------------
console.log('6. hand panel & bandage');
await game(() => { const p = window.__game.activePlayer(); p.health = 1; p.actionPoints = 4; p.hand.push({ id: 'bd', type: 'bandage' }); });
await page.click('#hand-strip');
await page.waitForTimeout(150);
check(await game(() => !document.getElementById('hand-overlay').hidden), 'tapping the face-down hand opens the hand panel');
await page.evaluate(() => [...document.querySelectorAll('#hand-cards .card-tile')].find(t => t.querySelector('.cname')?.textContent === 'Bandage')?.querySelector('button')?.click());
await page.waitForTimeout(150);
check((await active()).hp === 2, `bandage healed to ${(await active()).hp}`);
await page.click('#btn-hand-close');

// --- 7. Encounter: trade blocked by a Lantern (reveal) -----------------------------------
console.log('7. trade — Lantern blocks possession and reveals the possessed');
await arrange('corridorE', { vPoss: true, vHand: ['possession', 'trinket'], oHand: ['lantern', 'trinket'] });
await openEncounter('corridorE');
await shot('r2-encounter');
await clickBtn('Trade');
await page.waitForTimeout(120);
await clickCard('v0');      // Victor gives Possession
await page.waitForTimeout(120);
await clickCard('o0');      // Eleanor gives Lantern
await page.waitForTimeout(150);
const blockText = await game(() => document.getElementById('encounter-body').textContent);
check(/blocked possession/i.test(blockText) && /knows/i.test(blockText), 'the block + reveal is shown');
await clickBtn('Continue');
await page.waitForTimeout(150);
let res = await game(() => { const s = window.__game.state; return { eleanorPossessed: s.players[1].possessed, eleanorKnows: [...s.players[1].knows], victorLanterns: s.players[0].hand.filter(c => c.type === 'lantern').length, locked: [...s.encounterLocks] }; });
check(!res.eleanorPossessed && res.eleanorKnows.includes('p1'), 'Eleanor stayed clean and now knows Victor is possessed');
check(res.victorLanterns >= 1, 'the defended Lantern went to Victor');
check(res.locked.length === 1, 'the encounter is locked for this room this round');

// --- 8. Encounter: possession succeeds ---------------------------------------------------
console.log('8. trade — possession succeeds without a Lantern');
await arrange('corridorE', { vPoss: true, vHand: ['possession', 'trinket'], oHand: ['trinket', 'knife'] });
await openEncounter('corridorE');
await clickBtn('Trade');
await page.waitForTimeout(120);
await clickCard('v0');
await page.waitForTimeout(120);
await clickCard('o0');
await page.waitForTimeout(150);
check(await game(() => /POSSESSED/.test(document.getElementById('encounter-body').textContent)), 'the possession is announced');
await clickBtn('Continue');
await page.waitForTimeout(150);
check(await game(() => window.__game.state.players[1].possessed && window.__game.state.players[1].hand.some(c => c.type === 'possession')), 'Eleanor is now possessed and holds the Possession card');

// --- 9. Encounter: attack ----------------------------------------------------------------
console.log('9. attack with a knife');
await arrange('corridorE', { vPoss: false, vHand: ['knife', 'trinket'], oHand: ['trinket'] });
await game(() => { window.__game.state.players[1].health = 3; window.__game.state.players[1].possessed = false; });
await openEncounter('corridorE');
await clickBtn('Attack');
await page.waitForTimeout(120);
await clickCard('v0');       // knife
await page.waitForTimeout(150);
check(await game(() => /1 damage/.test(document.getElementById('encounter-body').textContent)), 'the attack result shows the damage');
await clickBtn('Continue');
await page.waitForTimeout(150);
check(await game(() => window.__game.state.players[1].health === 2), 'the target lost 1 HP');

// --- 9b. a killed player lies dead with blood --------------------------------------------
console.log('9b. killing a player lays them out with blood');
await arrange('corridorE', { vHand: ['revolver', 'trinket'], oHand: ['trinket'] });
await game(() => { window.__game.state.players[1].health = 2; });
await openEncounter('corridorE');
await clickBtn('Attack');
await page.waitForTimeout(120);
await clickCard('v0');       // revolver, 2 damage
await page.waitForTimeout(150);
check(await game(() => /dead/i.test(document.getElementById('encounter-body').textContent)), 'the kill is announced');
await clickBtn('Continue');
await page.waitForTimeout(200);
const death = await game(() => {
  const g = window.__game;
  const cv = g.characters[1];
  const bloodShown = cv.group.children.some(ch => ch.type === 'Group' && ch.visible && ch.children.some(m => m.geometry && m.geometry.type === 'CircleGeometry'));
  return { alive: g.state.players[1].alive, bloodShown, chipDead: document.querySelectorAll('#players-strip .mini-player')[1].className.includes('dead') };
});
check(!death.alive && death.bloodShown && death.chipDead, `the dead player lies with a blood pool and is crossed out (${JSON.stringify(death)})`);
await shot('r5-dead');

// --- 9c. choosing whom to meet when a room holds two -------------------------------------
console.log('9c. choose who to meet when a room has two people');
await arrange('corridorE', { vHand: ['trinket', 'lantern'], oHand: ['trinket'] });
await game(() => { const g = window.__game; const M = g.state.players[2]; M.currentRoom = 'corridorE'; M.alive = true; const c = g.roomCenter('corridorE'); g.movers[2].reset(c[0] + 1.2, c[1] + 0.6); });
await page.evaluate(() => window.__game.moveToRoom('corridorE'));
await settle();
await page.waitForFunction(() => window.__game.encounterOpen(), null, { timeout: 8000 });
const chooser = await game(() => ({ title: document.getElementById('encounter-title').textContent, buttons: [...document.querySelectorAll('#encounter-actions button')].map(b => b.textContent) }));
check(/Who do you meet/i.test(chooser.title) && chooser.buttons.length === 2, `a chooser lists both people (${chooser.buttons.join(', ')})`);
await page.evaluate(() => [...document.querySelectorAll('#encounter-actions button')].find(b => /Eleanor/.test(b.textContent)).click());
await page.waitForTimeout(120);
await clickBtn('Trade'); await page.waitForTimeout(120);
await clickCard('v0'); await page.waitForTimeout(120);
await clickCard('o0'); await page.waitForTimeout(120);
await clickBtn('Continue'); await page.waitForTimeout(150);
const lockRes = await game(() => ({ open: window.__game.encounterOpen(), locks: [...window.__game.state.encounterLocks] }));
check(!lockRes.open && lockRes.locks.length === 1, `only the chosen pair is met and locked, the third person is not forced (${JSON.stringify(lockRes.locks)})`);

// --- 9d. hand limit: discard down to 6 at end of turn ------------------------------------
console.log('9d. over the hand limit → discard down to 6 before passing');
await game(() => { const g = window.__game, p = g.activePlayer(); p.alive = true; p.hand = Array.from({ length: 8 }, (_, i) => ({ id: `h${i}`, type: 'trinket' })); p.actionPoints = 4; g.state.finished = false; g.refresh(); });
check(await game(() => document.getElementById('hand-count').textContent === '8'), 'the hand shows 8 cards');
const activeBefore = (await active()).name;
await page.click('#btn-end-turn');
await page.waitForTimeout(200);
check(await game(() => !document.getElementById('discard-overlay').hidden), 'ending a turn over the limit opens the discard prompt');
check(await game(() => document.getElementById('btn-discard-done').disabled), 'the Done button is disabled while still over the limit');
await page.evaluate(() => document.querySelector('#discard-cards .card-tile.selectable').click());
await page.waitForTimeout(80);
await page.evaluate(() => document.querySelector('#discard-cards .card-tile.selectable').click());
await page.waitForTimeout(120);
const dis = await game(() => ({ hand: window.__game.activePlayer().hand.length, doneEnabled: !document.getElementById('btn-discard-done').disabled }));
check(dis.hand === 6 && dis.doneEnabled, `discarded down to 6 and Done enables (${dis.hand} cards)`);
await page.click('#btn-discard-done');
await page.waitForTimeout(150);
check(await game(() => document.getElementById('discard-overlay').hidden), 'confirming closes the discard prompt');
check((await active()).name !== activeBefore, `control passed on after discarding (was ${activeBefore}, now ${(await active()).name})`);

// --- 10. Win: humans escape --------------------------------------------------------------
console.log('10. win — a clean player reaches the exit with 3 Lanterns');
await game(() => {
  const g = window.__game, s = g.state;
  ['corridorE', 'serviceCorridor', 'stairs'].forEach(r => s.discovered.add(r)); g.discovery.refresh();
  s.activeIndex = 0; s.finished = false;
  const V = s.players[0]; V.possessed = false; V.alive = true; V.actionPoints = 4; V.currentRoom = 'stairs';
  const c = g.roomCenter('stairs'); g.movers[0].reset(c[0], c[1]);
  V.hand = [{ id: 'k1', type: 'lantern' }, { id: 'k2', type: 'lantern' }, { id: 'k3', type: 'lantern' }];
});
await game(() => window.__game.moveToRoom('exit'));
await settle();
await page.waitForTimeout(300);
check(await game(() => window.__game.isFinished() && !document.getElementById('end-overlay').hidden), 'the game ends when the Exit Key reaches the exit');
check(await game(() => /humans escaped/i.test(document.getElementById('end-title').textContent)), 'the humans win');
await shot('r3-win');

console.log('11. restart');
await page.click('#btn-restart');
await page.waitForTimeout(300);
const rs = await game(() => ({ finished: window.__game.isFinished(), round: window.__game.state.round, disc: window.__game.state.discovered.size, active: window.__game.activePlayer().name, endHidden: document.getElementById('end-overlay').hidden, possessed: window.__game.state.players.filter(p => p.possessed).length }));
check(!rs.finished && rs.round === 1 && rs.disc === 1 && rs.active === 'Victor' && rs.endHidden && rs.possessed === 1, `restart deals a fresh game (${JSON.stringify(rs)})`);

// --- 12. Win: possessed take everyone ----------------------------------------------------
console.log('12. win — possessed side converts the last clean player');
await game(() => {
  const g = window.__game, s = g.state;
  s.players.forEach((p, i) => { p.alive = true; p.possessed = i !== 1; });   // only Eleanor clean
  s.players[0].possessed = true; s.players[0].hand = [{ id: 'pp', type: 'possession' }];
  s.players[1].possessed = false; s.players[1].hand = [{ id: 'tt', type: 'trinket' }];
});
await arrange('corridorE', { vPoss: true, vHand: ['possession', 'trinket'], oHand: ['trinket'] });
await game(() => { window.__game.state.players.forEach((p, i) => { if (i !== 0 && i !== 1) p.possessed = true; }); });
await openEncounter('corridorE');
await clickBtn('Trade');
await page.waitForTimeout(120);
await clickCard('v0');
await page.waitForTimeout(120);
await clickCard('o0');
await page.waitForTimeout(120);
await clickBtn('Continue');
await page.waitForTimeout(250);
check(await game(() => window.__game.isFinished() && /hotel keeps them/i.test(document.getElementById('end-title').textContent)), 'converting the last clean player wins for the possessed side');
await shot('r4-possessed-win');

console.log('\nConsole errors/warnings:', consoleMessages.length ? '\n  ' + consoleMessages.join('\n  ') : 'none');
check(consoleMessages.filter(m => !m.startsWith('warning')).length === 0, 'no console errors / page errors / failed requests');

await browser.close();
console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : failures.length + ' CHECK(S) FAILED'}`);
process.exit(failures.length ? 1 : 0);
