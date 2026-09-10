// Headless browser test of the greybox prototype (dev only, not part of the game).
// Setup once (from the repo root):  npm --prefix tests install   (installs playwright-core + three)
// Run:  python3 -m http.server 8123 --bind 127.0.0.1 &   then   node tests/browser-test.mjs [--screens]
// Needs a Chromium binary: set CHROME_PATH, or Playwright's usual /opt/pw-browsers location is searched.
// The Three.js CDN requests are intercepted and served from tests/node_modules/three so the test
// also works offline / where the CDN is blocked.
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
  for (const d of fs.readdirSync(root)) {
    for (const sub of ['chrome-linux/chrome', 'chrome-linux64/chrome']) {
      const p = path.join(root, d, sub);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error('chromium not found');
}

const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures.push(msg); } };

const browser = await chromium.launch({
  executablePath: findChrome(),
  headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'],
});
const context = await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 2, hasTouch: true });
const page = await context.newPage();

const consoleMessages = [];
page.on('console', m => { if (['error', 'warning'].includes(m.type())) consoleMessages.push(`${m.type()}: ${m.text()}`); });
page.on('pageerror', e => consoleMessages.push(`pageerror: ${e.message}`));
page.on('requestfailed', r => consoleMessages.push(`requestfailed: ${r.url()} ${r.failure()?.errorText}`));

await page.route(`${CDN}**`, async route => {
  const rel = route.request().url().slice(CDN.length).split('?')[0];
  const file = path.join(threeDir, rel);
  if (!fs.existsSync(file)) return route.fulfill({ status: 404, body: 'not found: ' + rel });
  route.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(file) });
});

const shot = async name => { if (shots) await page.screenshot({ path: path.join(outDir, `${name}.png`) }); };
const game = fn => page.evaluate(fn);
const waitArrived = async (timeout = 40000) => {
  await page.waitForFunction(() => window.__game && window.__game.activeMover().path.length === 0, null, { timeout, polling: 50 });
};
// Like a player would: if the room is still undiscovered, tap its glowing doorway first
// (that reveals it), then walk to the point inside.
const walkToRoom = async (roomId, offset = [0, 0]) => {
  const known = await page.evaluate(id => window.__game.state.discovered.has(id), roomId);
  if (!known) {
    const res = await page.evaluate(id => {
      const g = window.__game; const m = g.activeMover();
      const options = g.floor.doorways.filter(d => (d.a === id && g.state.discovered.has(d.b)) || (d.b === id && g.state.discovered.has(d.a)));
      if (!options.length) return { ok: false, reason: 'noFrontierDoorway' };
      // nearest glowing doorway into that room, as a player would pick
      const d = options.sort((p, q) => Math.hypot(p.center[0] - m.x, p.center[1] - m.z) - Math.hypot(q.center[0] - m.x, q.center[1] - m.z))[0];
      return g.walkTo(d.center[0], d.center[1]);
    }, roomId);
    if (!res.ok) return res;
    await waitArrived();
    const arrived = await page.evaluate(() => ({ room: window.__game.activePlayer().currentRoom, escaped: window.__game.activePlayer().escaped }));
    if (arrived.room !== roomId) return { ok: false, reason: `ended in ${arrived.room}` };
    if (arrived.escaped) return { ok: true, escaped: true };
  }
  const res = await page.evaluate(([id, off]) => {
    const g = window.__game; const c = g.roomCenter(id);
    return g.walkTo(c[0] + off[0], c[1] + off[1]);
  }, [roomId, offset]);
  return res;
};
const snapshot = () => page.evaluate(() => {
  const g = window.__game; const p = g.activePlayer();
  return {
    active: p.name, index: g.state.activeIndex, room: p.currentRoom, ap: p.actionPoints, round: g.state.round, escaped: p.escaped,
    discovered: [...g.state.discovered], finished: g.state.finished, pos: [g.activeMover().x, g.activeMover().z],
    hudPlayer: document.getElementById('active-player').textContent, hudRoom: document.getElementById('room-name').textContent,
    hudAp: document.getElementById('action-points').textContent, hudEnd: document.getElementById('btn-end-turn').textContent,
    chips: [...document.querySelectorAll('#turn-order .chip')].map(c => c.className),
    startHidden: document.getElementById('start-overlay').hidden, exitHidden: document.getElementById('exit-overlay').hidden,
    exitTitle: document.getElementById('exit-title').textContent, hudHidden: document.getElementById('hud').hidden,
    markers: g.characters.map(c => c.group.children.find(o => o.geometry && o.geometry.type === 'OctahedronGeometry').visible),
    positions: g.movers.map(m => [+m.x.toFixed(2), +m.z.toFixed(2)]),
  };
});
const endTurn = async () => { await page.click('#btn-end-turn'); await page.waitForTimeout(150); };

console.log('1. load');
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
await page.waitForFunction(() => !document.getElementById('btn-begin').disabled, null, { timeout: 10000 });
let s = await snapshot();
check(!s.startHidden && s.hudHidden, 'start overlay visible, HUD hidden before begin');
const info = await game(() => ({ problems: window.__game.floor.problems, rooms: window.__game.floor.roomList.length, lights: window.__game.view.scene.children.filter(o => o.isLight).length, programs: window.__game.programCount() }));
check(info.problems.length === 0, `floor data problems: ${JSON.stringify(info.problems)}`);
check(info.rooms >= 12 && info.rooms <= 14, `${info.rooms} rooms`);
console.log('   lights:', info.lights, 'programs:', info.programs);
await shot('01-start');

console.log('2. tap to begin');
await page.tap('#btn-begin');
await page.waitForTimeout(300);
s = await snapshot();
check(s.startHidden && !s.hudHidden, 'HUD visible after begin');
check(s.hudPlayer === "Victor's turn" && s.hudRoom === 'Fourth Floor Landing' && s.hudAp === 'Action points: 5 / 5', `HUD: ${s.hudPlayer} | ${s.hudRoom} | ${s.hudAp}`);
check(s.chips.length === 5 && s.chips[0].includes('active') && !s.chips[1].includes('active'), `turn order chips: ${s.chips.join(' | ')}`);
check(s.hudEnd === 'End turn → Eleanor', `end turn button says who is next (${s.hudEnd})`);
check(s.markers.filter(Boolean).length === 1 && s.markers[0], 'only Victor has the active marker');
const uniquePos = new Set(s.positions.map(p => p.join(','))).size;
check(uniquePos === 5, `five characters at distinct start spots: ${JSON.stringify(s.positions)}`);
const visibleChars = await game(() => window.__game.characters.filter(c => c.group.visible).length);
check(visibleChars === 5, 'five characters visible');
const glowSteady = await game(() => { const v = [...window.__game.doorways.views.values()][0]; const m = v.marker.children[0].material; return !m.transparent && m.opacity === 1; });
check(glowSteady, 'doorway highlight material is opaque and steady (no pulse)');
await shot('02-hall');

console.log('3. only the active player moves (real touch tap)');
const before = s.positions;
const pt = await game(() => window.__game.groundToScreen(0.8, 2.6));
await page.touchscreen.tap(pt.x, pt.y);
await page.waitForTimeout(150);
check(await game(() => window.__game.activeMover().path.length > 0 || window.__game.activeMover().walking), 'Victor starts walking');
await waitArrived();
s = await snapshot();
check(s.ap === 5, `moving inside the hall is free (${s.ap})`);
check(s.positions.slice(1).every((p, i) => p[0] === before[i + 1][0] && p[1] === before[i + 1][1]), 'the other four did not move');
const rig = await game(() => { const body = window.__game.characters[0].group.children[2]; return { parts: body.children.length, pivots: body.children.filter(o => o.type === 'Group').length }; });
check(rig.parts > 8 && rig.pivots === 4, `character rig has ${rig.parts} parts incl. ${rig.pivots} limb pivots`);
const swing = await game(() => { const g = window.__game; g.walkTo(-1.5, 2.6); return new Promise(res => setTimeout(() => { const body = g.characters[0].group.children[2]; const legs = body.children.filter(o => o.type === 'Group'); res(Math.max(...legs.map(l => Math.abs(l.rotation.x)))); }, 400)); });
check(swing > 0.05, `limbs swing while walking (max ${swing.toFixed(2)} rad)`);
await waitArrived();

console.log('4. Victor goes east through the glowing doorway');
const doorPt = await game(() => { const d = window.__game.floor.doorways.find(d => d.id === 'hall->corridorE'); return window.__game.groundToScreen(d.center[0], d.center[1]); });
await page.touchscreen.tap(doorPt.x, doorPt.y);
await page.waitForTimeout(100);
await waitArrived();
s = await snapshot();
check(s.room === 'corridorE' && s.ap === 4 && s.discovered.includes('corridorE'), `Victor in corridorE with 4 points (${s.room}, ${s.ap})`);
check(s.hudRoom === 'East Corridor', `HUD room ${s.hudRoom}`);
const programs1 = await game(() => window.__game.programCount());
check(programs1 === info.programs, `no shader recompiles on reveal (${info.programs} → ${programs1})`);
await page.waitForTimeout(700);
await shot('03-corridorE');

console.log('5. End turn passes to Eleanor with 5 points');
await endTurn();
s = await snapshot();
check(s.active === 'Eleanor' && s.index === 1 && s.ap === 5 && s.round === 1, `Eleanor's turn, 5 points, round 1 (${s.active}, ${s.ap}, r${s.round})`);
check(s.markers[1] && !s.markers[0], 'active marker moved to Eleanor');
check(s.chips[1].includes('active') && !s.chips[0].includes('active'), 'turn order highlights Eleanor');
check(s.hudEnd === 'End turn → Marcus', `next is Marcus (${s.hudEnd})`);
check(s.room === 'hall', 'Eleanor is still in the hall');

console.log('6. Eleanor goes west to the suite (dead end)');
let r = await walkToRoom('corridorW'); check(r.ok, `route to corridorW (${r.reason || 'ok'})`); await waitArrived();
r = await walkToRoom('suite412'); check(r.ok, `route to suite412 (${r.reason || 'ok'})`); await waitArrived();
s = await snapshot();
check(s.room === 'suite412' && s.ap === 3, `Eleanor in the suite with 3 points (${s.room}, ${s.ap})`);
const suiteDoors = await game(() => window.__game.floor.rooms.get('suite412').doorways.length);
check(suiteDoors === 1, 'suite is a dead end');
await page.waitForTimeout(700);
await shot('04-suite');

console.log('7. points lock at 0 (per player)');
await game(() => { window.__game.activePlayer().actionPoints = 0; });
r = await walkToRoom('corridorW');
check(!r.ok && r.reason === 'notEnoughActionPoints', `leaving with 0 points rejected (${r.reason})`);
const toast = await game(() => ({ hidden: document.getElementById('toast').hidden, text: document.getElementById('toast').textContent }));
check(!toast.hidden && /Eleanor/.test(toast.text) && /End turn/.test(toast.text), `toast names the player: "${toast.text}"`);
r = await walkToRoom('suite412', [1.0, 0.5]); check(r.ok, 'moving inside the suite still allowed'); await waitArrived();

console.log('8. Marcus walks the north loop until his points run out');
await endTurn();
s = await snapshot();
check(s.active === 'Marcus' && s.ap === 5, `Marcus's turn with 5 points`);
for (const id of ['corridorN', 'lounge', 'library', 'backCorridor', 'kitchen']) { r = await walkToRoom(id); check(r.ok, `Marcus → ${id} (${r.reason || 'ok'})`); await waitArrived(); }
s = await snapshot();
check(s.room === 'kitchen' && s.ap === 0, `Marcus in the kitchen with 0 points (${s.room}, ${s.ap})`);
const apClass = await game(() => document.getElementById('action-points').className);
check(/empty/.test(apClass), 'action-point pill flagged empty at 0');
r = await walkToRoom('serviceCorridor');
check(!r.ok && r.reason === 'notEnoughActionPoints', 'no points left to enter the service corridor');
await page.waitForTimeout(600);
await shot('05-kitchen');

console.log('9. round 2: Victor reaches the exit');
await endTurn(); await endTurn(); await endTurn(); // Beatrice, Henry, back to Victor
s = await snapshot();
check(s.active === 'Victor' && s.round === 2 && s.ap === 5 && s.room === 'corridorE', `Victor again in round 2 with 5 points (${s.active}, r${s.round}, ${s.ap}, ${s.room})`);
for (const id of ['serviceCorridor', 'stairs']) { r = await walkToRoom(id); check(r.ok, `Victor → ${id} (${r.reason || 'ok'})`); await waitArrived(); }
r = await walkToRoom('exit'); check(r.ok, `Victor → exit (${r.reason || 'ok'})`);
await waitArrived();
await page.waitForTimeout(1200);
s = await snapshot();
check(s.escaped && !s.exitHidden && /Victor found the exit/.test(s.exitTitle), `exit overlay: "${s.exitTitle}"`);
check(!s.finished, 'game continues for the others');
const contVisible = await game(() => !document.getElementById('btn-continue').hidden);
check(contVisible, 'Continue button offered');
await shot('06-exit');
r = await page.evaluate(() => window.__game.walkTo(17, 0));
check(!r.ok && r.reason === 'escaped', 'an escaped player cannot walk');

console.log('10. Continue → Eleanor; Victor is skipped from now on');
await page.click('#btn-continue');
await page.waitForTimeout(150);
s = await snapshot();
check(s.exitHidden && s.active === 'Eleanor' && s.ap === 5, `Eleanor's turn after Continue (${s.active}, ${s.ap})`);
check(s.chips[0].includes('escaped'), 'Victor marked escaped in the turn order');
const order = [];
for (let i = 0; i < 4; i++) { await endTurn(); order.push((await snapshot()).active); }
check(order.join(',') === 'Marcus,Beatrice,Henry,Eleanor', `rotation skips Victor: ${order.join(' → ')}`);

console.log('11. map shows discovered rooms and all players');
await page.click('#btn-map');
await page.waitForTimeout(300);
check(await game(() => window.__game.isMapOpen()), 'map open');
await shot('07-map');
await page.click('#btn-map-close');
check(!(await game(() => window.__game.isMapOpen())), 'map closed');

console.log('12. rotate, pinch, pan, wheel still work');
const yaw0 = await game(() => window.__game.rig.yawIndex);
await page.click('#btn-rotate-right'); await page.waitForTimeout(400);
check((await game(() => window.__game.rig.yawIndex)) === ((yaw0 - 1) % 4 + 4) % 4, 'rotate right changes yaw index');
await page.click('#btn-rotate-left'); await page.waitForTimeout(400);
const cdp = await context.newCDPSession(page);
const touch = async (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p[0], y: p[1], id: i })) });
const d0 = await game(() => window.__game.rig.distance);
await touch('touchStart', [[500, 400], [700, 400]]);
for (let i = 1; i <= 8; i++) { await touch('touchMove', [[500 - i * 10, 400], [700 + i * 10, 400]]); await page.waitForTimeout(16); }
await touch('touchEnd', []);
await page.waitForTimeout(100);
check((await game(() => window.__game.rig.distance)) < d0, 'pinch zooms in');
await touch('touchStart', [[500, 400], [560, 400]]);
for (let i = 1; i <= 8; i++) { await touch('touchMove', [[500 + i * 15, 400 + i * 10], [560 + i * 15, 400 + i * 10]]); await page.waitForTimeout(16); }
await touch('touchEnd', []);
const pan1 = await game(() => window.__game.rig.pan.length());
check(pan1 > 0.2, `two-finger drag pans (${pan1.toFixed(2)})`);
check((await game(() => window.__game.activeMover().path.length)) === 0, 'gestures did not trigger a walk');
const pan2 = await game(() => { for (let i = 0; i < 60; i++) window.__game.rig.update(0.05); return window.__game.rig.pan.length(); });
check(pan2 < pan1 * 0.3, `camera eases back (${pan1.toFixed(2)} → ${pan2.toFixed(2)})`);
const dBefore = await game(() => window.__game.rig.distance);
await page.mouse.move(590, 410); await page.mouse.wheel(0, 600); await page.waitForTimeout(100);
check((await game(() => window.__game.rig.distance)) > dBefore, 'wheel zooms out');

console.log('13. restart resets everything');
await page.click('#btn-restart').catch(() => {});
if (!(await game(() => document.getElementById('exit-overlay').hidden))) await page.click('#btn-restart');
else await game(() => window.__game.restart());
await page.waitForTimeout(300);
s = await snapshot();
check(s.active === 'Victor' && s.ap === 5 && s.round === 1 && s.discovered.length === 1 && !s.finished && !s.escaped, `reset: ${JSON.stringify({ active: s.active, ap: s.ap, round: s.round, disc: s.discovered.length })}`);
check(s.positions.every((p, i) => Math.abs(p[0] - before[i][0]) < 0.01 && Math.abs(p[1] - before[i][1]) < 0.01), 'all five back at their start spots');
check(!s.chips.some(c => c.includes('escaped')), 'nobody marked escaped');
const lit = await game(() => [...window.__game.roomViews.values()].filter(v => v.lights.some(l => l.light.intensity > 0)).map(v => v.room.id));
check(lit.length === 1 && lit[0] === 'hall', `only the hall is lit after restart (${lit})`);

console.log('14. performance sanity');
const perf = await page.evaluate(async () => {
  const r = window.__game.view.renderer;
  await new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
  return { calls: r.info.render.calls, triangles: r.info.render.triangles, programs: r.info.programs.length };
});
console.log('   render info:', perf);
check(perf.calls < 200, `draw calls with 1 room + 5 characters: ${perf.calls}`);

console.log('\nConsole errors/warnings:', consoleMessages.length ? '\n  ' + consoleMessages.join('\n  ') : 'none');
check(consoleMessages.filter(m => !m.startsWith('warning')).length === 0, 'no console errors / page errors / failed requests');

await browser.close();
console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : failures.length + ' CHECK(S) FAILED'}`);
process.exit(failures.length ? 1 : 0);
