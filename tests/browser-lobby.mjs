// Headless browser test of the STARTING ROOM's art pass (dev only, not part of the game).
// Run (from the repo root, with a static server on 8123):  node tests/browser-lobby.mjs [--url …] [--screens]
//
// Checks that the baked lobby model loads and lines up with the game's data, that the cutaway
// still folds its walls, the doorway cues (threshold glow, light spill, ring), the dotted path and
// cost tag on a chosen door, the lower default camera and ?camera=classic, the ?stats=1 readout,
// and records draw calls / triangles for the lobby.
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
const chrome = [process.env.CHROME_PATH, '/opt/pw-browsers/chromium-1194/chrome-linux/chrome'].filter(Boolean).find(fs.existsSync);

const failures = [];
const check = (cond, msg) => { if (cond) console.log('  ok  ', msg); else { console.log('  FAIL', msg); failures.push(msg); } };

const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--no-sandbox'] });
const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 }, deviceScaleFactor: 1, hasTouch: true })).newPage();
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
const dressed = () => page.waitForFunction(() => !window.__game || window.__game.dressingDone(), null, { timeout: 90000, polling: 200 });
async function load(query) {
  if (page.url().startsWith('http')) await dressed();
  await page.goto(baseUrl + (query ? `?${query}` : ''), { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__game && !document.getElementById('btn-begin').disabled, null, { timeout: 45000 });
  await dressed();
  await game(() => { window.__game.cfg.player.speed = 16; });
  await page.click('#btn-begin');
  await page.waitForFunction(() => window.__game.isRunning(), null, { timeout: 8000 });
  await page.waitForTimeout(600);
}
// A real tap on the canvas. Headless software rendering can stall the page long enough that press
// and release land more than the game's 0.45 s tap window apart (then it is rightly not a tap),
// so try up to three times.
async function tapDoor({ x, y }) {
  for (let i = 0; i < 3; i++) {
    await page.mouse.click(x, y);
    await page.waitForTimeout(250);
    if (await page.evaluate(() => !document.getElementById('confirm-bar').hidden)) return true;
  }
  return false;
}
// wait until a camera turn has finished (the eased turn runs on game time: slow headless)
const turned = async () => { await page.waitForFunction(() => window.__game.rig.debug.yawT >= 1, null, { timeout: 30000 }); await frames(25); };
const frames = n => page.evaluate(n => new Promise(r => { let k = 0; const f = () => (++k >= n ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
// the camera's angle above the horizon, in degrees
const pitch = () => game(() => {
  const g = window.__game, c = g.view.camera.position, m = g.activeMover(), p = g.rig.pan;
  const dx = c.x - m.x - p.x, dz = c.z - m.z - p.z;
  return Math.atan2(c.y, Math.hypot(dx, dz)) * 180 / Math.PI;
});

console.log('1. the baked lobby loads');
await load('');
const m = await game(() => {
  const g = window.__game, v = g.roomViews.get('hall');
  const names = new Set(); const mats = new Set(); let basic = true, lit = true;
  v.group.traverse(o => {
    if (o.name) names.add(o.name);
    if (o.isMesh && o.visible && o.parent?.visible !== false && o.name && o.name !== '') {
      for (const mt of [].concat(o.material)) {
        mats.add(mt.name);
        if (!mt.isMeshBasicMaterial) basic = false;
        if (mt.name !== 'glow' && !mt.lightMap) lit = false;
      }
    }
  });
  return {
    hasStatic: names.has('static'), hasFloor: names.has('floor'),
    walls: v.walls.length, hooked: v.walls.filter(w => w.baked).length,
    greyboxHidden: !v.floorMesh.visible && v.furniture.every(f => !f.mesh.visible),
    basic, lit, mats: [...mats],
    safe: (() => { const b = document.getElementById('safe-badge'); return !!b && b.offsetParent !== null && getComputedStyle(b).display !== 'none'; })(),
  };
});
check(m.hasStatic && m.hasFloor, 'the lobby model is in the room (furniture/shell + floor)');
check(m.hooked === m.walls && m.walls === 14, `every wall segment has its two model parts (${m.hooked}/${m.walls})`);
check(m.greyboxHidden, 'the greybox floor and furniture boxes are hidden');
check(m.basic && m.lit, `unlit materials with baked light (${m.mats.join(', ')})`);
check(m.safe, 'the lobby still says it is the safe zone');

console.log('\n2. the model sits on the game\'s own data');
const dumped = JSON.parse(fs.readFileSync(path.join(here, '..', 'tools/lobby-pipeline/lobby.json'), 'utf8'));
const live = await game(() => {
  const r = window.__game.floor.rooms.get('hall');
  return {
    walls: r.walls.map(w => ({ id: w.id, min: w.min, max: w.max })),
    doorways: r.doorways.map(d => ({ id: d.id, center: d.center, width: d.width })),
    furniture: r.furniture.map(f => ({ kind: f.kind, center: f.center, size: f.size })),
  };
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check(same(live.walls, dumped.walls.map(w => ({ id: w.id, min: w.min, max: w.max }))), 'walls match the data the model was built from');
check(same(live.doorways, dumped.doorways.map(d => ({ id: d.id, center: d.center, width: d.width }))), 'doorways match');
check(same(live.furniture, dumped.furniture.map(f => ({ kind: f.kind, center: f.center, size: f.size }))), 'furniture footprints (collision) match');
const walk = await game(() => {
  const g = window.__game, starts = g.floor.start.positions;
  const ok = (x, z) => { const c = g.grid.cellAt(x, z); return c >= 0 && g.grid.walkable[c]; };
  return { starts: starts.every(([x, z]) => ok(x, z)), centre: [[0, 0], [1, 1], [-1, -1], [1, -1], [-1, 1]].every(([x, z]) => ok(x, z)) };
});
check(walk.starts && walk.centre, 'all six start spots and the centre are walkable');

console.log('\n3. the cutaway folds the lobby walls like a cut model');
await frames(20);
const cut = () => game(() => {
  const v = window.__game.roomViews.get('hall');
  const by = side => v.walls.filter(w => w.wall.side === side);
  const up = side => by(side).every(w => w.baked.up.visible);
  const down = side => by(side).every(w => !w.baked.up.visible && w.baked.lo.visible);
  return { northUp: by('north').filter(w => !w.wall.neighbour).every(w => w.baked.up.visible), southDown: down('south'), southUp: up('south'), northDown: by('north').filter(w => !w.wall.neighbour).every(w => !w.baked.up.visible) };
});
let c = await cut();
check(c.southDown && c.northUp, 'the near (south) wall is folded down to its cap, the far wall stands');
await shot('lobby-01');
await game(() => window.__game.rotate(2));
await turned();
c = await cut();
check(c.northDown && c.southUp, 'turned round, the north wall folds and the south wall stands');
await game(() => window.__game.rotate(2));
await turned();

console.log('\n4. doorway cues');
const cues = await game(() => {
  const g = window.__game, vs = [...g.doorways.views.values()].filter(v => v.doorway.a === 'hall' || v.doorway.b === 'hall');
  return {
    rings: vs.filter(v => v.blink.visible).length,
    ringsInside: vs.every(v => Math.abs(v.blink.position.x) < 4 && Math.abs(v.blink.position.z) < 4),
    glows: vs.filter(v => v.glow.visible).length,
    spills: vs.filter(v => v.spill.visible).length,
    nearSpill: vs.find(v => v.doorway.id === 'hall->dining').spill.visible,
    noPosts: vs.every(v => !('marker' in v)),
  };
});
check(cues.rings === 4 && cues.ringsInside, 'a ring on the lobby side of each of the four usable doors');
check(cues.glows === 4, 'a soft threshold glow at each door to an undiscovered room');
check(cues.spills === 3 && !cues.nearSpill, 'a light spill in each opening you look into, none standing in the cut near wall');
check(cues.noPosts, 'the old glowing yellow door blocks are gone');

console.log('\n5. choosing a door: dotted path + cost tag');
// where the east door's ring is on screen right now
const ringAt = () => game(() => { const g = window.__game, v = [...g.doorways.views.values()].find(d => d.doorway.id === 'hall->corridorE'); return g.groundToScreen(v.blink.position.x, v.blink.position.z); });
await tapDoor(await ringAt());
await frames(4);
let pv = await game(() => ({ confirm: !document.getElementById('confirm-bar').hidden, on: window.__game.pathPreview.visible, dots: window.__game.pathPreview.dotCount, label: window.__game.pathPreview.labelText }));
check(pv.confirm, 'tapping the ring offers the move');
check(pv.on && pv.dots >= 4, `a dotted path is drawn from the guest to the door (${pv.dots} dots)`);
check(pv.label === 'Explore · 1 AP', `the tag says what it costs ("${pv.label}")`);
const tag = await page.evaluate(() => { const r = document.querySelector('.path-label').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top, w: r.width, vw: innerWidth, vh: innerHeight }; });
check(tag.w > 40 && tag.x > 0 && tag.x < tag.vw && tag.y > 0 && tag.y < tag.vh, 'the tag is on screen');
await shot('lobby-02-path');
await page.click('#btn-confirm-cancel');
await frames(3);
check(await game(() => !window.__game.pathPreview.visible && document.querySelector('.path-label').hidden), 'cancelling clears the path and the tag');
await tapDoor(await ringAt());
await page.click('#btn-confirm-move');
await frames(3);
check(await game(() => !window.__game.pathPreview.visible), 'confirming clears the preview as the guest sets off');
await page.waitForFunction(() => !window.__game.activeMover().walking && window.__game.activeMover().path.length === 0, null, { timeout: 40000 });
check(await game(() => window.__game.activePlayer().currentRoom) === 'corridorE', 'the guest walked through to the corridor');

console.log('\n6. camera');
await load('');
const p1 = await pitch();
check(Math.abs(p1 - 42) < 1.5, `the default camera is lower (${p1.toFixed(1)}° above the floor)`);
await load('camera=classic');
const p2 = await pitch();
check(Math.abs(p2 - 56) < 1.5, `?camera=classic keeps the old angle (${p2.toFixed(1)}°)`);

console.log('\n7. performance readout and budget');
await load('stats=1');
await page.waitForTimeout(2500);
const stats = await page.evaluate(() => document.querySelector('.perf-stats')?.textContent || '');
check(/fps/.test(stats) && /draws/.test(stats), `?stats=1 shows a readout ("${stats}")`);
const perf = await game(() => { const i = window.__game.view.renderer.info; return { calls: i.render.calls, tris: i.render.triangles, programs: i.programs.length, textures: i.memory.textures, geometries: i.memory.geometries }; });
console.log(`       lobby view: ${perf.calls} draw calls, ${perf.tris} triangles, ${perf.programs} shader programs, ${perf.textures} textures, ${perf.geometries} geometries`);
check(perf.calls <= 120, `draw calls within budget (${perf.calls} ≤ 120)`);
check(perf.tris <= 150000, `triangles within budget (${perf.tris} ≤ 150k)`);

console.log('\n8. console');
await dressed();
const noisy = consoleMessages.filter(x => !/favicon/i.test(x));
check(noisy.length === 0, noisy.length ? `console noise:\n    ${noisy.slice(0, 6).join('\n    ')}` : 'no console errors or failed requests (clean)');
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL LOBBY BROWSER CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
