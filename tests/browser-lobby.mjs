// Headless browser test of the STARTING ROOM's art pass (dev only, not part of the game).
// Run (from the repo root, with a static server on 8123):  node tests/browser-lobby.mjs [--url …] [--screens]
//
// Checks that the baked lobby model loads and lines up with the game's data, that the cutaway
// still folds its walls, the closed doors with a fogged room beyond each (tap the fog: the door opens),
// the dotted path, outline and cost tag of a move to a tapped room, the camera (corner-on, zooming out
// over a big hotel, panning to its far side, "centre on me"), ?camera=classic, the ?stats=1 readout, and
// records draw calls / triangles for the lobby and for a big hotel seen whole.
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
  // (?mode=practice: the direct link to practice, past the main menu)
  await page.goto(`${baseUrl}?${['mode=practice', query].filter(Boolean).join('&')}`, { waitUntil: 'domcontentloaded' });
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

console.log('1. the baked lobby loads');
await load(`seed=${process.env.LOBBY_SEED || 7}`);   // a fixed hotel (seed 7: a lobby with one side closed off)
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
    walls: v.walls.length, hooked: v.walls.filter(w => w.baked?.length).length,
    doors: v.room.doorSides.size,
    // every model wall part is either on show for this match's layout or hidden
    shown: [...names].filter(n => /^W_.*_lo$/.test(n)).map(n => { let o; v.group.traverse(x => { if (x.name === n) o = x; }); return o.visible; }).filter(Boolean).length,
    // every shown part really draws: all the meshes inside it are visible too (a part with several
    // materials is a group of meshes; hiding those once left the lobby's upper walls missing)
    partsDraw: v.walls.every(w => w.baked.every(p => [p.lo, p.up].every(n => { let ok = true; n.traverse(x => { if (x.isMesh && !x.visible) ok = false; }); return ok; }))),
    greyboxHidden: !v.floorMesh.visible && v.furniture.every(f => !f.mesh.visible),
    basic, lit, mats: [...mats],
    safe: (() => { const b = document.getElementById('safe-badge'); return !!b && b.offsetParent !== null && getComputedStyle(b).display !== 'none'; })(),
  };
});
check(m.hasStatic && m.hasFloor, 'the lobby model is in the room (furniture/shell + floor)');
check(m.doors === 3 || m.doors === 4, `this match's lobby has ${m.doors} open doorways`);
check(m.hooked === m.walls && m.walls === 4 + m.doors, `every wall segment has its model parts (${m.hooked}/${m.walls})`);
check(m.shown === 4 * 3 + m.doors, `open sides show their doorway, the closed side a plain wall (${m.shown} wall parts on show)`);
check(m.partsDraw, 'every wall part on show draws all of its pieces (no missing upper walls)');
check(m.greyboxHidden, 'the greybox floor and furniture boxes are hidden');
check(m.basic && m.lit, `unlit materials with baked light (${m.mats.join(', ')})`);
check(m.safe, 'the lobby still says it is the safe zone');

console.log('\n2. the model sits on the game\'s own data');
const dumped = JSON.parse(fs.readFileSync(path.join(here, '..', 'tools/lobby-pipeline/lobby.json'), 'utf8'));
const live = await game(() => {
  const r = window.__game.floor.rooms.get('hall');
  return {
    size: r.size,
    doorways: r.frontier.map(d => ({ side: d.side, center: d.center, width: d.width })),
    furniture: r.furniture.map(f => ({ kind: f.kind, center: f.center, size: f.size })),
  };
});
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check(same(live.size, dumped.size), 'the lobby is the size the model was built for');
check(live.doorways.every(d => dumped.doorways.some(e => e.side === d.side && same(e.center, d.center) && e.width === d.width)), 'every doorway is one the model has a doorway for');
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
  const up = side => by(side).every(w => w.baked.every(p => p.up.visible));
  const down = side => by(side).every(w => w.baked.every(p => !p.up.visible && p.lo.visible));
  return { northUp: up('north'), southDown: down('south'), southUp: up('south'), northDown: down('north') };
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

console.log('\n4. closed doors, and the fogged rooms beyond them');
const cues = await game(() => {
  const g = window.__game, vs = [...g.doorways.views.values()].filter(v => v.doorway.room === 'hall');
  return {
    n: vs.length,
    noRings: [...g.doorways.views.values()].every(v => !('blink' in v)),
    glows: vs.filter(v => v.glow.visible).length,
    leaves: vs.filter(v => v.leaf && v.leaf.parent).length,
    noPosts: vs.every(v => !('marker' in v) && !('spill' in v)),
    fog: g.fogCells(), doors: vs.map(v => v.doorway.id),
    fogDraws: g.fog.mesh.count, fogMeshes: g.view.scene.children.filter(o => o.name === 'fog').length,
  };
});
check(cues.n === m.doors, `the lobby's ${cues.n} doorways are closed doors`);
check(cues.leaves === cues.n, 'each has a door leaf standing in it');
check(cues.noRings, 'no rings on the floor to tap: doors are not what you tap any more');
check(cues.glows === cues.n, 'a soft glow at the threshold of each door you can open');
check(cues.noPosts, 'no glowing yellow door blocks');
check(cues.fog.length === cues.n && cues.doors.every(d => cues.fog.some(f => f.doors.includes(d))) && cues.fog.every(f => f.explorable && f.shown > 0.9),
  `beyond each door lies a fogged, unknown room (${cues.fog.length}), bright: it can be explored from here`);
check(cues.fogMeshes === 1 && cues.fogDraws === cues.n * 3, `all the fog is one mesh, one draw call (${cues.fogDraws} see-through layers)`);
{
  const tags = await game(() => window.__game.fogLabels());
  check(tags.length === cues.n && tags.every(t => t.text === 'Explore · 1 AP'), `each fogged room carries an "Explore · 1 AP" tag (${tags.length})`);
}
// The hand is a fan of cards along the bottom and searching is an icon over the room's search spot:
// at every size and every turn of the view, each fogged room can still be tapped somewhere, and a tap
// there means that fogged room.
for (const [w, h] of [[1180, 820], [1024, 768], [1366, 1024], [1440, 900]]) {
  await page.setViewportSize({ width: w, height: h });
  await frames(4);
  const missing = [];
  for (const steps of [0, 1, 2, 3]) {
    if (steps) { await game(() => window.__game.rotate(1)); await turned(); }
    const miss = await game(() => window.__game.fogCells().filter(f => f.explorable && !window.__game.tapPointFor({ fog: f.key })).map(f => f.key));
    if (miss.length) missing.push(`${steps * 90}°: ${miss.join(' ')}`);
  }
  await game(() => window.__game.rotate(1)); await turned();
  check(!missing.length, `${w}×${h}: at every camera turn each fogged room has a spot free to tap${missing.length ? ` (missing ${missing.join('; ')})` : ''}`);
}
await page.setViewportSize({ width: 1180, height: 820 });
await frames(4);
check(await game(() => window.__game.fanIds().length) === 4, 'the hand shows as a fan of four cards');
check(!(await page.$('#btn-search')) && await game(() => window.__game.searchSpot().mode === null) && await page.evaluate(() => document.getElementById('search-spot').hidden),
  'no Search button, and no search icon in the lobby: there is nothing to search there');

console.log('\n5. tap a fogged room: its door opens; tap the room: walk there');
// A real tap (headless software rendering can stall long enough that press and release land more than
// the game's tap window apart — then it is rightly not a tap — so try up to three times).
async function tapWhere(where, done) {
  for (let i = 0; i < 3; i++) {
    const p = await game(w => window.__game.tapPointFor(w), where);
    if (!p) return false;
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(250);
    if (await done()) return true;
  }
  return false;
}
const fog0 = cues.fog[0];
const rooms0 = await game(() => window.__game.hotelRooms().length);
const tapped = await tapWhere({ fog: fog0.key }, () => game(n => window.__game.hotelRooms().length > n, rooms0));
await frames(4);
const opened = await game(() => ({ rooms: window.__game.hotelRooms(), ap: window.__game.activePlayer().actionPoints, room: window.__game.activePlayer().currentRoom,
  bar: !document.getElementById('confirm-bar').hidden, toast: document.getElementById('toast').textContent }));
check(tapped && opened.rooms.length === 2 && opened.ap === 3 && opened.room === 'hall' && !opened.bar,
  `tapping a fogged room opens its door at once, no question asked: 1 action point, ${opened.rooms[1]} is revealed, and you stay in the lobby`);
check(/^The door opens/.test(opened.toast.trim()), `the game says what is there ("${opened.toast.trim()}")`);
const doorwayId = `hall->${opened.rooms[1]}`;
await page.waitForTimeout(800); await frames(10);
check(await game(i => { const v = window.__game.doorways.views.get(i); return v.kind === 'open' && Math.abs(v.leaf.rotation.y) > 1; }, doorwayId), 'its door swings open and stays open');
check(!(await game(k => window.__game.fogCells().some(f => f.key === k), fog0.key)), 'its fog has cleared: the real room stands there');
const dest = opened.rooms[1];
await tapWhere({ room: dest }, () => page.evaluate(() => !document.getElementById('confirm-bar').hidden));
await frames(4);
let pv = await game(() => ({ confirm: !document.getElementById('confirm-bar').hidden, text: document.getElementById('confirm-text').textContent, on: window.__game.pathPreview.visible,
  dots: window.__game.pathPreview.dotCount, label: window.__game.pathPreview.labelText, outline: window.__game.pathPreview.outlined }));
const destName = await game(id => window.__game.floor.rooms.get(id).name, dest);
check(pv.confirm && pv.text === `Move to ${destName}?`, `tapping the revealed room (anywhere on it) asks first: "${pv.text}"`);
check(pv.on && pv.dots >= 4, `with a dotted path (${pv.dots} dots)`);
check(pv.label === 'Move · 1 AP', `and a tag saying what it costs ("${pv.label}")`);
const dc = await game(id => window.__game.roomCenter(id), dest);
check(!!pv.outline && Math.hypot(pv.outline[0] - dc[0], pv.outline[1] - dc[1]) < 0.01, 'and an outline round the room you are about to walk to');
const tag = await page.evaluate(() => { const r = document.querySelector('.path-label').getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top, w: r.width, vw: innerWidth, vh: innerHeight }; });
check(tag.w > 40 && tag.x > 0 && tag.x < tag.vw && tag.y > 0 && tag.y < tag.vh, 'the tag is on screen');
// The dots never run under the Move/Cancel bar: with the view dragged so the middle of the path lies
// under the bar, the dots there are left out (and come back when the view moves off it).
{
  const pts0 = await game(() => window.__game.pathPreview.dotPoints());
  const mid = pts0[Math.floor(pts0.length / 2)];
  const bar = await page.evaluate(() => { const b = document.getElementById('confirm-bar').getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom }; });
  const g0 = await game(([x, y]) => window.__game.screenToGround(x, y), [(bar.l + bar.r) / 2, (bar.t + bar.b) / 2]);
  await game(([dx, dz]) => window.__game.rig.panByWorld(dx, dz), [mid.x - g0[0], mid.z - g0[1]]);
  await frames(4);
  const pts1 = await game(() => window.__game.pathPreview.dotPoints());
  const at = await game(([x, z]) => window.__game.groundToScreen(x, z), [mid.x, mid.z]);
  const inBar = pts1.filter(q => q.sx > bar.l && q.sx < bar.r && q.sy > bar.t && q.sy < bar.b).length;
  const crossed = at.x > bar.l && at.x < bar.r && at.y > bar.t - 10 && at.y < bar.b + 10;
  check(crossed && pts1.length < pts0.length && inBar === 0, `the path's dots never run under the Move/Cancel bar (dragged under it: ${pts0.length} → ${pts1.length} dots, ${inBar} under the bar)`);
  await game(() => window.__game.centreOnMe());
  await page.waitForFunction(() => !window.__game.rig.returning, null, { timeout: 30000 });
  await frames(4);
  check((await game(() => window.__game.pathPreview.dotCount)) === pts0.length, 'and they come back when the view moves off it');
}
await page.click('#btn-confirm-cancel');
await frames(3);
check(await game(() => !window.__game.pathPreview.visible && document.querySelector('.path-label').hidden && !window.__game.pathPreview.outlined), 'Cancel clears the preview');
await tapWhere({ room: dest }, () => page.evaluate(() => !document.getElementById('confirm-bar').hidden));
await shot('lobby-02-path');
await page.click('#btn-confirm-move');
await frames(3);
check(await game(() => !window.__game.pathPreview.visible), 'confirming clears the preview as the guest sets off');
await page.waitForFunction(() => !window.__game.activeMover().walking && window.__game.activeMover().path.length === 0, null, { timeout: 40000 });
const arrived = await game(() => { const g = window.__game, m = g.activeMover(), p = g.activePlayer(), c = g.roomCenter(p.currentRoom); return { room: p.currentRoom, ap: p.actionPoints, off: Math.hypot(m.x - c[0], m.z - c[1]) }; });
check(arrived.room === dest && arrived.ap === 2, 'the guest walked through into the new room, for 1 action point');
check(arrived.off < 0.05, `and stands in its middle (${arrived.off.toFixed(2)} m off)`);

console.log('\n6. camera');
// the view's own direction: its angle below the horizon, and how far it is turned off the room's axes
const look = () => game(() => {
  const d = new (window.__game.view.camera.position.constructor)();
  window.__game.view.camera.getWorldDirection(d);
  const turn = Math.abs(Math.atan2(d.x, d.z) * 180 / Math.PI) % 90;
  return { pitch: Math.asin(-d.y) * 180 / Math.PI, turn: Math.min(turn, 90 - turn) };
});
await load('');
const l1 = await look();
check(Math.abs(l1.turn - 45) < 2 && Math.abs(l1.pitch - 44) < 1.5,
  `the standard view is corner-on, like the room pictures (turned ${l1.turn.toFixed(1)}° off square, ${l1.pitch.toFixed(1)}° down)`);
await load('camera=square');
const l2 = await look();
check(l2.turn < 1 && Math.abs(l2.pitch - 42) < 1.5, `?camera=square gives the previous square-on view (${l2.turn.toFixed(1)}°, ${l2.pitch.toFixed(1)}° down)`);
await load('camera=classic');
const l3 = await look();
check(l3.turn < 1 && Math.abs(l3.pitch - 56) < 1.5, `?camera=classic keeps the old higher angle (${l3.pitch.toFixed(1)}°)`);

console.log('\n6b. looking round a big hotel');
{
  await load(`seed=${process.env.LOBBY_SEED || 7}`);
  for (const t of ['lounge', 'ballroom', 'grandCorridor', 'dining', 'library', 'kitchen', 'corridorE', 'corridorW', 'corridorN', 'corridorS', 'infirmary1', 'infirmary2', 'linenStore1', 'switchboard', 'cornerCorridor', 'storage', 'stairs', 'serviceCorridor']) {
    await game(id => window.__game.revealTile(id), t);
  }
  await dressed(); await frames(6);
  const cam = () => game(() => { const g = window.__game, m = g.activeMover(); return { d: g.rig.distance, max: g.rig.maxDistance, centre: g.rig.centre, returning: g.rig.returning, guest: [m.x, m.z] }; });
  const c0 = await cam();
  // Zoom out with the mouse wheel until it stops.
  for (let k = 0; k < 40; k++) { await page.mouse.move(590, 420); await page.mouse.wheel(0, 400); await frames(1); }
  await frames(8);
  const c1 = await cam();
  const view = await game(() => {
    const g = window.__game, cam = g.view.camera, V = cam.position.constructor;
    const top = document.querySelector('.hud-top-left').getBoundingClientRect().bottom;
    let off = 0, n = 0, hidden = 0;
    for (const r of g.floor.roomList) {
      for (const [x, z] of [[r.min[0], r.min[1]], [r.max[0], r.min[1]], [r.min[0], r.max[1]], [r.max[0], r.max[1]]]) {
        const v = new V(x, 0, z).project(cam); n++;
        if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1) off++;
      }
      const c = new V(r.center[0], 0, r.center[1]).project(cam);
      const sx = (c.x + 1) / 2 * innerWidth, sy = (1 - c.y) / 2 * innerHeight;
      const el = document.elementFromPoint(sx, sy);
      if (!el || el.tagName !== 'CANVAS') hidden++;
    }
    const i = g.view.renderer.info;
    return { off, n, hidden, rooms: g.floor.roomList.length, calls: i.render.calls, tris: i.render.triangles, top };
  });
  check(c1.max > 26 && Math.abs(c1.d - c1.max) < 0.01, `pinch/wheel zooms out until the whole hotel fits (${c1.d.toFixed(1)} m out; the old limit was 26)`);
  check(view.off === 0 && view.hidden === 0, `all ${view.rooms} revealed rooms are in view at once, none under the interface (${view.off}/${view.n} corners off screen)`);
  check(view.calls <= 600, `a big hotel seen whole stays within the draw-call budget (${view.calls} draw calls, ${view.tris} triangles)`);
  console.log(`       big hotel (${view.rooms} rooms) seen whole: ${view.calls} draw calls, ${view.tris} triangles`);
  await frames(2);
  const tags = await game(() => window.__game.tags('guest:'));
  check(tags.length === 1 && /Victor/.test(tags[0].text), `zoomed far out, the guest carries a name tag so they can be found ("${tags[0]?.text}")`);
  await shot('lobby-03-overview');
  // One zoom-out limit for all four turns of the view: turning it while zoomed right out never jolts
  // the zoom, and the whole hotel stays in view.
  {
    const ds = [];
    for (let k = 0; k < 4; k++) {
      await game(() => window.__game.rotate(1)); await turned();
      await page.waitForFunction(() => !window.__game.rig.returning, null, { timeout: 30000 });
      const r = await game(() => {
        const g = window.__game, cam = g.view.camera, V = cam.position.constructor;
        let off = 0;
        for (const q of g.floor.roomList) for (const [x, z] of [[q.min[0], q.min[1]], [q.max[0], q.min[1]], [q.min[0], q.max[1]], [q.max[0], q.max[1]]]) {
          const v = new V(x, 0, z).project(cam); if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1) off++;
        }
        return { d: g.rig.distance, max: g.rig.maxDistance, off };
      });
      ds.push(r);
    }
    check(ds.every(r => Math.abs(r.d - ds[0].d) < 0.01 && Math.abs(r.max - ds[0].max) < 0.01) && ds.every(r => r.off === 0),
      `turning the view while zoomed right out keeps the same zoom and the whole hotel in view (${ds.map(r => `${r.d.toFixed(1)} m, ${r.off} off`).join(' / ')})`);
  }
  // Pan with a one-finger drag to the room furthest from the guest, a little zoomed in.
  for (let k = 0; k < 4; k++) { await page.mouse.wheel(0, -300); await frames(1); }
  const far = await game(() => { const g = window.__game, m = g.activeMover(); return [...g.floor.roomList].sort((a, b) => Math.hypot(b.center[0] - m.x, b.center[1] - m.z) - Math.hypot(a.center[0] - m.x, a.center[1] - m.z))[0]; });
  const cdp = await page.context().newCDPSession(page);
  for (let k = 0; k < 12; k++) {
    const p = await game(([x, z]) => window.__game.groundToScreen(x, z), far.center);
    const fx = Math.max(80, Math.min(1100, p.x)), fy = Math.max(170, Math.min(620, p.y));
    if (Math.hypot(fx - 590, fy - 400) < 20) break;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: fx, y: fy }] });
    for (let st = 1; st <= 8; st++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: fx + (590 - fx) * st / 8, y: fy + (400 - fy) * st / 8 }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await frames(2);
  }
  const p1 = await game(([x, z]) => window.__game.groundToScreen(x, z), far.center);
  const c2 = await cam();
  check(Math.hypot(p1.x - 590, p1.y - 400) < 120, `a one-finger drag pans the view to the far side of the hotel (${far.id} is now mid-screen)`);
  await page.waitForTimeout(3000); await frames(10);
  const c3 = await cam();
  check(Math.hypot(c3.centre[0] - c2.centre[0], c3.centre[1] - c2.centre[1]) < 0.01 && !c3.returning, 'and it stays there: no drifting back to the guest');
  await shot('lobby-04-far-side');
  // A one-finger drag moves the floor with the finger from where it first touched: the first few pixels
  // (before a touch counts as a drag) are not lost.
  {
    const [x0, y0] = [520, 380];
    const g0 = await game(([x, y]) => window.__game.screenToGround(x, y), [x0, y0]);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (const [dx, dy] of [[3, 1], [7, 3], [13, 6], [30, 14], [45, 22], [60, 30]]) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + dx, y: y0 + dy }] });
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await frames(3); await page.waitForTimeout(600); await frames(3);
    const s1 = await game(([x, z]) => window.__game.groundToScreen(x, z), g0);
    const miss = Math.hypot(s1.x - (x0 + 60), s1.y - (y0 + 30));
    check(miss < 4, `a one-finger drag keeps the floor under the finger from the first touch (${miss.toFixed(1)} px off after a 67 px drag)`);
  }
  // However hard the view is dragged — fully zoomed in, at the standard zoom, zoomed out — the middle of
  // the screen stays over a revealed room (within a small margin), so the hotel never leaves the screen.
  {
    const res = [];
    for (const d of [8, 16, 40]) {
      await game(d => { const g = window.__game; g.rig.zoomBy(g.rig.distance / d); }, d);
      for (const [dx, dz] of [[60, 0], [-60, 0], [0, 60], [0, -60], [50, 50], [-50, -50], [50, -50], [-50, 50]]) {
        for (let k = 0; k < 6; k++) await game(([dx, dz]) => window.__game.rig.panByWorld(dx / 6, dz / 6), [dx, dz]);
        await frames(2);
        res.push(await game(() => {
          const g = window.__game, [ax, az] = g.rig.aim, dist = g.rig.distance, R = 1.5 + 0.15 * Math.max(0, dist - 16) + 0.05;
          const near = g.floor.roomList.some(q => ax >= q.min[0] - R && ax <= q.max[0] + R && az >= q.min[1] - R && az <= q.max[1] + R);
          // and a revealed room is really on the screen: its nearest point to the middle projects inside it
          const cam = g.view.camera, V = cam.position.constructor;
          const seen = g.floor.roomList.some(q => {
            const x = Math.min(Math.max(ax, q.min[0] + 0.5), q.max[0] - 0.5), z = Math.min(Math.max(az, q.min[1] + 0.5), q.max[1] - 0.5);
            const v = new V(x, 0, z).project(cam); return Math.abs(v.x) < 0.95 && Math.abs(v.y) < 0.95;
          });
          return { d: Math.round(dist), near, seen };
        }));
      }
    }
    const bad = res.filter(r => !r.near || !r.seen);
    check(!bad.length, `dragged as far as it goes in 8 directions at 3 zooms, the middle of the screen stays over the revealed hotel and a room stays in view (${res.length - bad.length}/${res.length})`);
  }
  await page.click('#btn-centre');
  await page.waitForFunction(() => !window.__game.rig.returning, null, { timeout: 30000 });
  const c4 = await cam();
  check(Math.hypot(c4.centre[0] - c4.guest[0], c4.centre[1] - c4.guest[1]) < 0.05 && Math.abs(c4.d - c0.d) < 0.01, 'the "centre on me" button brings the view back to the guest, at the standard zoom');
  const btn = await page.evaluate(() => { const r = document.getElementById('btn-centre').getBoundingClientRect(), a = document.getElementById('btn-rotate-right').getBoundingClientRect(); return { w: r.width, h: r.height, beside: Math.abs(r.top - a.top) < 2 && r.left > a.right }; });
  check(btn.w >= 48 && btn.h >= 48 && btn.beside, `it sits beside the rotate buttons, a ${Math.round(btn.w)}×${Math.round(btn.h)} px touch target`);
  // Opening a door, moving and a new turn also bring the view back.
  const spot = await game(() => {
    const g = window.__game, d = g.floor.frontier.find(x => !x.jammed && !g.state.lockedRooms.has(x.room));
    if (!d) return null;
    const p = g.activePlayer(), c = g.roomCenter(d.room);
    p.currentRoom = d.room; p.actionPoints = 4; g.movers[p.index].reset(c[0], c[1]);
    g.discovery.refresh(); g.refresh(); g.rig.setFocus(c[0], c[1], true);
    return { door: d.id, room: d.room, next: [...g.floor.rooms.get(d.room).neighbours].find(n => !g.state.lockedRooms.has(n)) };
  });
  check(!!spot, 'found a room with a closed door');
  if (spot) {
    await game(() => window.__game.rig.panByWorld(-12, -12));
    await frames(3);
    await game(d => window.__game.openDoor(d), spot.door);
    await page.waitForFunction(() => !window.__game.rig.returning, null, { timeout: 30000 });
    // The view eases so the guest's room AND the room just revealed are both on screen, guest included.
    const c5 = await game(({ room }) => {
      const g = window.__game, cam = g.view.camera, V = cam.position.constructor, W = innerWidth, H = innerHeight;
      const on = (x, z, y = 0) => { const v = new V(x, y, z).project(cam); return { x: (v.x + 1) / 2 * W, y: (1 - v.y) / 2 * H, in: Math.abs(v.x) <= 1 && Math.abs(v.y) <= 1 }; };
      const fresh = g.floor.roomList.at(-1);   // the room revealed last
      const corners = q => [[q.min[0], q.min[1]], [q.max[0], q.min[1]], [q.min[0], q.max[1]], [q.max[0], q.max[1]]];
      const mine = g.floor.rooms.get(room), m = g.activeMover();
      return { mine: corners(mine).every(([x, z]) => on(x, z).in), fresh: corners(fresh).every(([x, z]) => on(x, z).in),
        guest: on(m.x, m.z, 1).in, d: g.rig.distance, freshId: fresh.id };
    }, spot);
    check(c5.mine && c5.fresh && c5.guest, `opening a door eases the view so the guest's room and the new room (${c5.freshId}) are both on screen, guest included (${c5.d.toFixed(1)} m)`);
    await game(() => window.__game.rig.panByWorld(12, -8));
    await frames(3);
    await game(n => window.__game.moveToRoom(n), spot.next);
    await page.waitForFunction(() => !window.__game.activeMover().walking && window.__game.activeMover().path.length === 0 && !window.__game.rig.returning, null, { timeout: 40000 });
    await frames(30);
    const c7 = await cam();
    check(Math.hypot(c7.centre[0] - c7.guest[0], c7.centre[1] - c7.guest[1]) < 0.3, 'and so does a move (the view follows the guest there)');
  }
  await game(() => { window.__game.rig.panByWorld(10, -10); window.__game.rig.zoomBy(0.5); });
  await frames(3);
  await game(() => window.__game.endTurn());
  await page.waitForFunction(() => !window.__game.rig.returning, null, { timeout: 30000 });
  const c6 = await cam();
  check(Math.hypot(c6.centre[0] - c6.guest[0], c6.centre[1] - c6.guest[1]) < 0.05 && Math.abs(c6.d - c0.d) < 0.01, 'and so does a new turn');
}

console.log('\n7. performance readout and budget');
await load('stats=1');
await page.waitForTimeout(2500);
const stats = await page.evaluate(() => document.querySelector('.perf-stats')?.textContent || '');
check(/fps/.test(stats) && /draws/.test(stats), `?stats=1 shows a readout ("${stats}")`);
const perf = await game(() => { const i = window.__game.view.renderer.info; return { calls: i.render.calls, tris: i.render.triangles, programs: i.programs.length, textures: i.memory.textures, geometries: i.memory.geometries }; });
console.log(`       lobby view: ${perf.calls} draw calls, ${perf.tris} triangles, ${perf.programs} shader programs, ${perf.textures} textures, ${perf.geometries} geometries`);
check(perf.calls <= 120, `draw calls within budget (${perf.calls} ≤ 120)`);
check(perf.tris <= 150000, `triangles within budget (${perf.tris} ≤ 150k)`);

console.log('\n7b. locked rooms look locked');
{
  const r = await game(() => { const g = window.__game;
    g.revealTile('corridorE', 'hall'); g.revealTile('cloakroom', 'corridorE');
    const views = [...g.doorways.views.values()].filter(v => v.kind === 'open' && [v.doorway.a, v.doorway.b].includes('cloakroom'));
    return { locked: g.state.lockedRooms.has('cloakroom'), n: views.length,
      shut: views.every(v => v.leaf && v.leaf.userData.target === 0 && v.leaf.userData.pads.every(p => p.visible) && v.leaf.userData.leaf.material.map && v.warn.visible) };
  });
  check(r.locked && r.n >= 1 && r.shut, `a doorway into a locked room keeps a shut, padlocked door (${r.n} doorway${r.n === 1 ? '' : 's'})`);
  await game(() => { const g = window.__game;
    g.state.lockedRooms.delete('cloakroom'); g.refresh();
    for (const v of g.doorways.views.values()) v.sync?.(); });
  // (software rendering in the test runs few frames a second: allow the swing time to finish)
  await page.waitForFunction(() => [...window.__game.doorways.views.values()]
    .filter(v => v.kind === 'open' && [v.doorway.a, v.doorway.b].includes('cloakroom'))
    .every(v => v.leaf.userData.swing > 0.9), null, { timeout: 8000 }).catch(() => {});
  const u = await game(() => { const g = window.__game;
    const views = [...g.doorways.views.values()].filter(v => v.kind === 'open' && [v.doorway.a, v.doorway.b].includes('cloakroom'));
    return { ok: views.every(v => v.leaf.userData.swing > 0.9 && v.leaf.userData.pads.every(p => !p.visible) && !v.warn.visible),
      info: views.map(v => [v.leaf.userData.swing.toFixed(2), v.leaf.userData.target, v.locked, v.warn.visible, v.leaf.userData.pads.map(p => p.visible)]) };
  });
  check(u.ok, `once it is opened, the door swings open and the padlocks go ${u.ok ? '' : JSON.stringify(u.info)}`);
  // The door locks again (the end of the opener's turn): it swings shut, padlocks back on.
  await game(() => { const g = window.__game; g.state.lockedRooms.add('cloakroom'); g.refresh(); g.doorways.sync(); });
  await page.waitForFunction(() => [...window.__game.doorways.views.values()]
    .filter(v => v.kind === 'open' && [v.doorway.a, v.doorway.b].includes('cloakroom'))
    .every(v => v.leaf.userData.swing < 0.05), null, { timeout: 8000 }).catch(() => {});
  const re = await game(() => { const g = window.__game;
    const views = [...g.doorways.views.values()].filter(v => v.kind === 'open' && [v.doorway.a, v.doorway.b].includes('cloakroom'));
    return { ok: views.every(v => v.leaf.userData.swing < 0.05 && v.leaf.userData.target === 0 && v.leaf.userData.pads.every(p => p.visible) && v.warn.visible),
      info: views.map(v => [v.leaf.userData.swing.toFixed(2), v.leaf.userData.target, v.locked, v.warn.visible]) };
  });
  check(re.ok, `when it locks again, the door swings shut and the padlocks come back ${re.ok ? '' : JSON.stringify(re.info)}`);
}

console.log('\n8. console');
await dressed();
const noisy = consoleMessages.filter(x => !/favicon/i.test(x));
check(noisy.length === 0, noisy.length ? `console noise:\n    ${noisy.slice(0, 6).join('\n    ')}` : 'no console errors or failed requests (clean)');
await browser.close();
console.log(failures.length ? `\n${failures.length} FAILED` : '\nALL LOBBY BROWSER CHECKS PASSED');
process.exit(failures.length ? 1 : 0);
