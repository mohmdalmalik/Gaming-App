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
  const candidates = [
    process.env.CHROME_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
  ].filter(Boolean);
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
const waitArrived = async (timeout = 30000) => {
  await page.waitForFunction(() => window.__game && window.__game.player.path.length === 0, null, { timeout, polling: 50 });
};
// Like a player would: if the room is still undiscovered, tap its glowing doorway first
// (that reveals it), then walk to the point inside.
const walkToRoom = async (roomId, offset = [0, 0]) => {
  const known = await page.evaluate(id => window.__game.state.discovered.has(id), roomId);
  if (!known) {
    const res = await page.evaluate(id => {
      const g = window.__game;
      const d = g.floor.doorways.find(d => (d.a === id && g.state.discovered.has(d.b)) || (d.b === id && g.state.discovered.has(d.a)));
      if (!d) return { ok: false, reason: 'noFrontierDoorway' };
      return g.walkTo(d.center[0], d.center[1]);
    }, roomId);
    if (!res.ok) return res;
    await waitArrived();
    const arrived = await page.evaluate(() => ({ room: window.__game.state.currentRoom, finished: window.__game.state.finished }));
    if (arrived.room !== roomId) return { ok: false, reason: `ended in ${arrived.room}` };
    if (arrived.finished) return { ok: true, finished: true, transitions: 1 };
  }
  const res = await page.evaluate(([id, off]) => {
    const g = window.__game; const c = g.roomCenter(id);
    return g.walkTo(c[0] + off[0], c[1] + off[1]);
  }, [roomId, offset]);
  if (res.ok) res.transitions = known ? res.transitions : 1; // report the doorway crossing we made
  return res;
};
const snapshot = () => page.evaluate(() => {
  const g = window.__game;
  return { room: g.state.currentRoom, ap: g.state.actionPoints, turn: g.state.turn, discovered: [...g.state.discovered], finished: g.state.finished, pos: [g.player.x, g.player.z], hudRoom: document.getElementById('room-name').textContent, hudAp: document.getElementById('action-points').textContent, startHidden: document.getElementById('start-overlay').hidden, exitHidden: document.getElementById('exit-overlay').hidden, hudHidden: document.getElementById('hud').hidden };
});

console.log('1. load');
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => !!window.__game, null, { timeout: 15000 });
await page.waitForTimeout(600);
let s = await snapshot();
check(!s.startHidden, 'start overlay visible before begin');
check(s.hudHidden, 'HUD hidden before begin');
const problems = await game(() => window.__game.floor.problems);
check(problems.length === 0, `floor data problems: ${JSON.stringify(problems)}`);
await shot('01-start');

console.log('2. tap to begin (real tap)');
await page.waitForFunction(() => !document.getElementById('btn-begin').disabled, null, { timeout: 10000 });
const programs0 = await game(() => window.__game.programCount());
await page.tap('#btn-begin');
await page.waitForTimeout(300);
s = await snapshot();
check(s.startHidden, 'start overlay hidden after begin');
check(!s.hudHidden, 'HUD visible after begin');
check(s.hudRoom === 'Guest Suite 412', `HUD room name = ${s.hudRoom}`);
check(s.hudAp === 'Action points: 10 / 10', `HUD AP = ${s.hudAp}`);
check(s.discovered.length === 1, 'only the start room discovered');
await shot('02-suite');

console.log('3. tap on floor inside the suite with a real touch tap (free move)');
const pt = await game(() => window.__game.groundToScreen(1.5, 0.5));
await page.touchscreen.tap(pt.x, pt.y);
await page.waitForTimeout(200);
let moving = await game(() => window.__game.player.path.length > 0 || window.__game.player.walking);
check(moving, 'player starts walking after a tap on the floor');
await waitArrived();
s = await snapshot();
check(s.ap === 10, `AP unchanged after moving within the room (${s.ap})`);
check(Math.hypot(s.pos[0] - 1.5, s.pos[1] - 0.5) < 0.4, `arrived near the tapped point (${s.pos.map(v => v.toFixed(2))})`);

console.log('4. tap the glowing doorway (real touch) → corridor discovered, AP 9');
const doorPt = await game(() => { const d = window.__game.floor.doorways.find(d => d.id === 'suite->corridorA'); return window.__game.groundToScreen(d.center[0], d.center[1]); });
await page.touchscreen.tap(doorPt.x, doorPt.y);
await page.waitForTimeout(100);
await waitArrived();
s = await snapshot();
check(s.room === 'corridorA', `now in corridorA (${s.room})`);
check(s.ap === 9, `AP 9 after one doorway (${s.ap})`);
check(s.discovered.includes('corridorA'), 'corridorA discovered');
check(s.hudRoom === 'West Corridor', `HUD shows West Corridor (${s.hudRoom})`);
await page.waitForTimeout(700);
await shot('03-corridor');

console.log('5. walk to the lounge via API, then check frontier doorways');
let r = await walkToRoom('lounge');
check(r.ok, `route to lounge ok (${JSON.stringify({ ok: r.ok, reason: r.reason })})`);
await waitArrived();
s = await snapshot();
check(s.room === 'lounge' && s.ap === 8, `in lounge with AP 8 (${s.room}, ${s.ap})`);
const frontier = await game(() => [...window.__game.doorways.views.values()].filter(v => v.marker.visible).map(v => v.doorway.id));
check(frontier.length === 2 && frontier.includes('lounge->servicePassage') && frontier.includes('lounge->corridorB'), `two glowing doorways from lounge: ${frontier.join(', ')}`);
const programs1 = await game(() => window.__game.programCount());
check(programs1 === programs0, `no shader recompiles across reveals (programs ${programs0} → ${programs1})`);
const hiddenRooms = await game(() => [...window.__game.roomViews.values()].filter(v => !v.group.visible).map(v => v.room.id));
check(hiddenRooms.length === 6, `6 rooms still hidden (${hiddenRooms.length}: ${hiddenRooms})`);
await page.waitForTimeout(800);
await shot('04-lounge');

console.log('6. tapping deep inside an undiscovered room does nothing (only the landing is reachable)');
r = await page.evaluate(() => window.__game.walkTo(12, -7));
check(!r.ok, `walkTo storage centre from lounge rejected (${r.reason})`);

console.log('7. dead-end route: passage → storage (AP 6), storage has one doorway');
r = await walkToRoom('servicePassage');
await waitArrived();
r = await walkToRoom('storage');
check(r.ok, 'route into storage from passage ok');
await waitArrived();
s = await snapshot();
check(s.room === 'storage' && s.ap === 6, `in storage with AP 6 (${s.room}, ${s.ap})`);
const storageDoors = await game(() => window.__game.floor.rooms.get('storage').doorways.length);
check(storageDoors === 1, 'storage is a dead end (1 doorway)');
await page.waitForTimeout(800);
await shot('05-storage');

console.log('8. AP lock: set AP to 0, try to leave → rejected with toast; move inside room still free');
await game(() => { window.__game.state.actionPoints = 0; });
r = await walkToRoom('servicePassage');
check(!r.ok && r.reason === 'notEnoughActionPoints', `leaving with 0 AP rejected (${r.reason})`);
const toast = await game(() => ({ hidden: document.getElementById('toast').hidden, text: document.getElementById('toast').textContent }));
check(!toast.hidden && /End turn/.test(toast.text), `toast shown: "${toast.text}"`);
r = await walkToRoom('storage', [1.5, 1.0]);
check(r.ok, 'moving inside the room with 0 AP is allowed');
await waitArrived();

console.log('9. End turn (real click) restores AP');
await page.click('#btn-end-turn');
s = await snapshot();
check(s.ap === 10 && s.turn === 2, `AP 10, turn 2 (${s.ap}, ${s.turn})`);

console.log('10. rotate buttons (real clicks) change yaw; cutaway walls follow');
const yaw0 = await game(() => window.__game.rig.yawIndex);
await page.click('#btn-rotate-right');
await page.waitForTimeout(600);
const yaw1 = await game(() => window.__game.rig.yawIndex);
check(yaw1 === ((yaw0 - 1) % 4 + 4) % 4, `yaw index changed ${yaw0} → ${yaw1}`);
const lowered = await game(() => { const v = window.__game.roomViews.get('storage'); return v.walls.map(w => ({ side: w.wall.side, h: +w.mesh.scale.y.toFixed(2) })); });
check(lowered.some(w => w.h < 1) && lowered.some(w => w.h > 2), `some storage walls lowered, some full: ${JSON.stringify(lowered)}`);
await shot('06-rotated');
await page.click('#btn-rotate-left');
await page.waitForTimeout(600);

console.log('11. map overlay shows only discovered rooms');
await page.click('#btn-map');
await page.waitForTimeout(300);
let mapOpen = await game(() => window.__game.isMapOpen() && !document.getElementById('map-overlay').hidden);
check(mapOpen, 'map open');
await shot('07-map');
await page.click('#btn-map-close');
mapOpen = await game(() => window.__game.isMapOpen());
check(!mapOpen, 'map closed');

console.log('12. walk to the exit: passage → lounge → corridorB → landing → exit');
for (const id of ['servicePassage', 'lounge', 'corridorB', 'landing']) { r = await walkToRoom(id); check(r.ok, `route to ${id} ok`); await waitArrived(); }
s = await snapshot();
check(s.ap === 6, `AP 6 before exit (${s.ap})`);
await page.waitForTimeout(500);
await shot('08-landing');
r = await walkToRoom('exit');
check(r.ok, 'route into exit ok');
await waitArrived();
await page.waitForTimeout(1200);
s = await snapshot();
check(s.finished && !s.exitHidden, `exit overlay shown, game finished (${s.finished}, overlay hidden=${s.exitHidden})`);
await shot('09-exit');
r = await page.evaluate(() => window.__game.walkTo(17, 0));
check(!r.ok && r.reason === 'finished', 'no more walking after finishing');

console.log('13. restart (real click) resets everything');
await page.click('#btn-restart');
await page.waitForTimeout(300);
s = await snapshot();
check(s.exitHidden && s.room === 'suite' && s.ap === 10 && s.turn === 1 && s.discovered.length === 1 && !s.finished, `reset: ${JSON.stringify({ room: s.room, ap: s.ap, turn: s.turn, disc: s.discovered.length })}`);
await page.waitForTimeout(200);
const litRooms = await game(() => [...window.__game.roomViews.values()].filter(v => v.lights.some(l => l.light.intensity > 0)).map(v => v.room.id));
check(litRooms.length === 1 && litRooms[0] === 'suite', `only the suite is lit after restart (${litRooms})`);
const yawAfter = await game(() => window.__game.rig.yawIndex);
check(yawAfter === 0, `view rotation reset after restart (${yawAfter})`);
const visibleRooms = await game(() => [...window.__game.roomViews.values()].filter(v => v.group.visible).map(v => v.room.id));
check(visibleRooms.length === 1 && visibleRooms[0] === 'suite', `only suite visible after restart (${visibleRooms})`);

console.log('14. pinch zoom + two-finger pan via CDP touch events');
const cdp = await context.newCDPSession(page);
const d0 = await game(() => window.__game.rig.distance);
const touch = async (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((p, i) => ({ x: p[0], y: p[1], id: i })) });
await touch('touchStart', [[500, 400], [700, 400]]);
for (let i = 1; i <= 8; i++) { await touch('touchMove', [[500 - i * 10, 400], [700 + i * 10, 400]]); await page.waitForTimeout(16); }
await touch('touchEnd', []);
await page.waitForTimeout(100);
const d1 = await game(() => window.__game.rig.distance);
check(d1 < d0, `pinch out zooms in: distance ${d0.toFixed(2)} → ${d1.toFixed(2)}`);
const pan0 = await game(() => window.__game.rig.pan.length());
await touch('touchStart', [[500, 400], [560, 400]]);
for (let i = 1; i <= 8; i++) { await touch('touchMove', [[500 + i * 15, 400 + i * 10], [560 + i * 15, 400 + i * 10]]); await page.waitForTimeout(16); }
await touch('touchEnd', []);
const pan1 = await game(() => window.__game.rig.pan.length());
check(pan1 > pan0 + 0.2, `two-finger drag pans: ${pan0.toFixed(2)} → ${pan1.toFixed(2)}`);
const walkedDuringGesture = await game(() => window.__game.player.path.length);
check(walkedDuringGesture === 0, 'two-finger gestures did not trigger a walk');
// The software renderer here runs ~7 fps and the game clamps dt, so step the rig deterministically
// (3 simulated seconds) instead of waiting in real time.
const pan2 = await game(() => { for (let i = 0; i < 60; i++) window.__game.rig.update(0.05); return window.__game.rig.pan.length(); });
check(pan2 < pan1 * 0.5, `camera eases back toward the player: ${pan1.toFixed(2)} → ${pan2.toFixed(2)}`);

console.log('15. mouse: wheel zooms, left click walks');
const dBefore = await game(() => window.__game.rig.distance);
await page.mouse.move(590, 410);
await page.mouse.wheel(0, 600);
await page.waitForTimeout(100);
const dAfter = await game(() => window.__game.rig.distance);
check(dAfter > dBefore, `wheel down zooms out ${dBefore.toFixed(2)} → ${dAfter.toFixed(2)}`);
const clickPt = await game(() => window.__game.groundToScreen(-2.0, 1.8));
await page.mouse.click(clickPt.x, clickPt.y);
await page.waitForTimeout(150);
moving = await game(() => window.__game.player.path.length > 0 || window.__game.player.walking);
check(moving, 'mouse click starts a walk');
await waitArrived();

console.log('16. performance sanity: draw calls + frame time');
const perf = await page.evaluate(async () => {
  const g = window.__game; const r = g.view.renderer;
  const t0 = performance.now(); let frames = 0;
  await new Promise(res => { const tick = () => { frames++; if (performance.now() - t0 > 1000) res(); else requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
  return { calls: r.info.render.calls, triangles: r.info.render.triangles, fps: frames, lights: g.view.scene.children.filter(o => o.isLight).length };
});
console.log('   render info:', perf);
check(perf.calls < 200, `draw calls with 1 room visible: ${perf.calls}`);

console.log('\nConsole errors/warnings:', consoleMessages.length ? '\n  ' + consoleMessages.join('\n  ') : 'none');
check(consoleMessages.filter(m => !m.startsWith('warning')).length === 0, 'no console errors / page errors / failed requests');

await browser.close();
console.log(`\n${failures.length === 0 ? 'ALL CHECKS PASSED' : failures.length + ' CHECK(S) FAILED'}`);
process.exit(failures.length ? 1 : 0);
